use crate::llm_client;
use crate::ollama;
use crate::settings::{self, APPLE_INTELLIGENCE_PROVIDER_ID, OLLAMA_PROVIDER_ID};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::fs as tokio_fs;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::Mutex;

static ACTIVE_INSTALLS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Refine catalog/download commands can run under WebKit's URL-scheme callback.
// Keep large Ollama/Hugging Face work off that stack on macOS.
const REFINE_COMMAND_STACK_BYTES: usize = 64 * 1024 * 1024;

async fn run_refine_command_on_stack<T, F, Fut>(
    thread_name: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, String>> + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    thread::Builder::new()
        .name(thread_name.to_string())
        .stack_size(REFINE_COMMAND_STACK_BYTES)
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|err| format!("Failed to start refine command runtime: {err}"))?;
                runtime.block_on(task())
            })();
            let _ = tx.send(result);
        })
        .map_err(|err| format!("Failed to start refine command thread: {err}"))?;

    rx.await
        .map_err(|_| "Refine command thread stopped before returning data.".to_string())?
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RefineModelSourceKind {
    Ollama,
    LmStudio,
    HuggingFace,
    ManagedProvider,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RefineProviderStatus {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub local_only: bool,
    pub installed: bool,
    pub running: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RefineModelDescriptor {
    pub id: String,
    pub title: String,
    pub description: String,
    pub source_kind: RefineModelSourceKind,
    pub source_label: String,
    pub runtime_provider_id: String,
    pub runtime_model_id: String,
    pub runtime_label: String,
    pub installed: bool,
    pub active: bool,
    pub runnable: bool,
    pub downloadable: bool,
    pub requires_api_key: bool,
    pub source_repo_id: Option<String>,
    pub source_file_name: Option<String>,
    pub source_url: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RefineModelCatalog {
    pub providers: Vec<RefineProviderStatus>,
    pub models: Vec<RefineModelDescriptor>,
}

#[derive(Debug, Clone)]
struct HfImportSpec {
    id: &'static str,
    title: &'static str,
    description: &'static str,
    repo_id: &'static str,
    file_name: &'static str,
    runtime_model_id: &'static str,
}

const HF_COLLECTION_SLUG_ENV: &str = "VOXJOT_HF_COLLECTION_SLUG";
const HF_DEFAULT_COLLECTION_SLUG: &str = "IrieDinamik/vox-jot-llm-verified";
const HF_DYNAMIC_SEARCH_QUERY: &str = "bartowski GGUF instruct";
const HF_DYNAMIC_SEARCH_LIMIT: usize = 24;
const HF_DYNAMIC_SEARCH_MAX_RESULTS: usize = 8;
const HF_DYNAMIC_COLLECTION_MAX_RESULTS: usize = 32;
const HF_DYNAMIC_MAX_PARAMETER_BILLIONS: f32 = 4.0;

const HF_IMPORT_SPECS: &[HfImportSpec] = &[
    HfImportSpec {
        id: "hf:llama-3.2-3b",
        title: "Llama 3.2 3B Instruct",
        description: "Best balance of speed and intelligence. Excellent instruction-following for dictation cleanup.",
        repo_id: "bartowski/Llama-3.2-3B-Instruct-GGUF",
        file_name: "",
        runtime_model_id: "llama-3.2-3b-instruct-q4_k_m",
    },
    HfImportSpec {
        id: "hf:llama-3.2-1b",
        title: "Llama 3.2 1B Instruct",
        description: "Fastest responses from Meta. Perfect for getting nearly instant grammar fixes.",
        repo_id: "bartowski/Llama-3.2-1B-Instruct-GGUF",
        file_name: "",
        runtime_model_id: "llama-3.2-1b-instruct-q4_k_m",
    },
    HfImportSpec {
        id: "hf:qwen-2.5-1.5b",
        title: "Qwen 2.5 1.5B Instruct",
        description: "Highly capable model from Alibaba punching above its weight class for language tasks.",
        repo_id: "bartowski/Qwen2.5-1.5B-Instruct-GGUF",
        file_name: "",
        runtime_model_id: "qwen2.5-1.5b-instruct-q4_k_m",
    },
    HfImportSpec {
        id: "hf:qwen-2.5-0.5b",
        title: "Qwen 2.5 0.5B Instruct",
        description: "The absolute minimum RAM option. Blazing fast, handles simple dictation cleanup reliably.",
        repo_id: "bartowski/Qwen2.5-0.5B-Instruct-GGUF",
        file_name: "",
        runtime_model_id: "qwen2.5-0.5b-instruct-q4_k_m",
    },
    HfImportSpec {
        id: "hf:phi-4-mini",
        title: "Phi-4 Mini Instruct",
        description: "Microsoft's Phi-4 Mini is an overachiever for grammar, focusing heavily on text quality and reasoning.",
        repo_id: "bartowski/microsoft_Phi-4-mini-instruct-GGUF",
        file_name: "",
        runtime_model_id: "phi-4-mini-instruct-q4_k_m",
    },
    HfImportSpec {
        id: "hf:lfm2-1.2b-tool",
        title: "LFM2 1.2B Tool",
        description: "Liquid AI edge model tuned for tool use and structured output. Fast dictation cleanup.",
        repo_id: "LiquidAI/LFM2-1.2B-Tool-GGUF",
        file_name: "LFM2-1.2B-Tool-Q4_K_M.gguf",
        runtime_model_id: "lfm2-1.2b-tool-q4_k_m",
    },
];

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
}

#[derive(Debug, Deserialize)]
struct HfModelInfo {
    #[serde(default)]
    siblings: Vec<HfSibling>,
}

#[derive(Debug, Deserialize)]
struct HfSearchModel {
    id: String,
    #[serde(default)]
    downloads: u64,
    pipeline_tag: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HfCollectionItem {
    id: String,
}

#[derive(Debug, Deserialize)]
struct HfCollectionInfo {
    #[serde(default)]
    items: Vec<HfCollectionItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HfDiscoverySource {
    Collection,
    Search,
}

fn find_provider<'a>(
    settings: &'a settings::AppSettings,
    provider_id: &str,
) -> Option<&'a settings::PostProcessProvider> {
    settings
        .post_process_providers
        .iter()
        .find(|provider| provider.id == provider_id)
}

fn configured_model_id(settings: &settings::AppSettings, provider_id: &str) -> String {
    settings
        .post_process_models
        .get(provider_id)
        .cloned()
        .unwrap_or_else(|| settings::default_model_for_provider(provider_id))
}

fn provider_detail(provider: &settings::PostProcessProvider) -> String {
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        if crate::apple_intelligence::check_apple_intelligence_availability() {
            return "Built into macOS on supported Apple Silicon Macs.".to_string();
        }
        return "Requires an Apple Silicon Mac with Apple Intelligence enabled.".to_string();
    }

    if provider.base_url.trim().is_empty() {
        return "Managed provider configured inside Vox Jot.".to_string();
    }

    if settings::post_process_provider_is_local(provider) {
        return format!("Local endpoint: {}", provider.base_url);
    }

    format!("Provider endpoint: {}", provider.base_url)
}

fn managed_provider_requires_api_key(provider: &settings::PostProcessProvider) -> bool {
    provider.id != APPLE_INTELLIGENCE_PROVIDER_ID
        && provider.id != OLLAMA_PROVIDER_ID
        && provider.id != "lmstudio"
        && provider.id != "custom"
        && !settings::post_process_provider_is_local(provider)
}

fn managed_provider_has_api_key(
    settings: &settings::AppSettings,
    provider: &settings::PostProcessProvider,
) -> bool {
    !managed_provider_requires_api_key(provider)
        || settings
            .post_process_api_key_status
            .get(&provider.id)
            .copied()
            .unwrap_or(false)
}

fn make_managed_provider_status(
    settings: &settings::AppSettings,
    provider: &settings::PostProcessProvider,
) -> RefineProviderStatus {
    let available = if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        crate::apple_intelligence::check_apple_intelligence_availability()
    } else {
        managed_provider_has_api_key(settings, provider)
    };

    RefineProviderStatus {
        id: provider.id.clone(),
        label: provider.label.clone(),
        available,
        local_only: settings::post_process_provider_is_local(provider),
        installed: true,
        running: available,
        detail: provider_detail(provider),
    }
}

fn make_managed_provider_model(
    settings: &settings::AppSettings,
    provider: &settings::PostProcessProvider,
) -> Option<RefineModelDescriptor> {
    let runtime_model_id = configured_model_id(settings, &provider.id);
    let needs_api_key = managed_provider_requires_api_key(provider)
        && !managed_provider_has_api_key(settings, provider);
    let is_active = is_active_model(settings, &provider.id, &runtime_model_id) && !needs_api_key;
    let available = if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        crate::apple_intelligence::check_apple_intelligence_availability()
    } else {
        !needs_api_key
    };

    if runtime_model_id.trim().is_empty() && !is_active {
        return None;
    }

    let title =
        if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID || runtime_model_id.trim().is_empty() {
            provider.label.clone()
        } else {
            runtime_model_id.clone()
        };

    let description = if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        "Built-in Apple Intelligence cleanup and refinement on supported Macs.".to_string()
    } else if runtime_model_id.trim().is_empty() {
        format!(
            "Managed {} provider ready for Vox Jot cleanup once a model is selected.",
            provider.label
        )
    } else {
        format!("Current configured model for {}.", provider.label)
    };

    Some(RefineModelDescriptor {
        id: format!("provider:{}", provider.id),
        title,
        description,
        source_kind: RefineModelSourceKind::ManagedProvider,
        source_label: if provider.base_url.trim().is_empty() {
            "Managed provider".to_string()
        } else {
            provider.base_url.clone()
        },
        runtime_provider_id: provider.id.clone(),
        runtime_model_id,
        runtime_label: format!("{} runtime", provider.label),
        installed: !needs_api_key,
        active: is_active,
        runnable: available,
        downloadable: false,
        requires_api_key: needs_api_key,
        source_repo_id: None,
        source_file_name: None,
        source_url: None,
        note: if needs_api_key {
            Some(format!(
                "Add an API key for {} before using this cloud model.",
                provider.label
            ))
        } else if available {
            None
        } else {
            Some("This provider is configured but unavailable on this machine.".to_string())
        },
    })
}

fn is_active_model(
    settings: &settings::AppSettings,
    provider_id: &str,
    runtime_model_id: &str,
) -> bool {
    settings.post_process_provider_id == provider_id
        && settings
            .post_process_models
            .get(provider_id)
            .map(|model| model == runtime_model_id)
            .unwrap_or(false)
}

fn ollama_model_matches(installed: &[String], candidate: &str) -> bool {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return false;
    }

    installed
        .iter()
        .map(|model| model.trim())
        .filter(|model| !model.is_empty())
        .any(|model| {
            model == candidate
                || model == format!("{candidate}:latest")
                || candidate == format!("{model}:latest")
        })
}

fn ollama_model_ids_equivalent(left: &str, right: &str) -> bool {
    ollama_model_matches(&[left.to_string()], right)
        || ollama_model_matches(&[right.to_string()], left)
}

fn replacement_ollama_model_id(
    installed_models: &[String],
    removed_model_id: &str,
) -> Option<String> {
    installed_models
        .iter()
        .find(|candidate| !ollama_model_ids_equivalent(candidate, removed_model_id))
        .cloned()
}

fn remove_local_ollama_rows_shadowed_by_installed_hf_imports(
    models: &mut Vec<RefineModelDescriptor>,
    hf_models: &[RefineModelDescriptor],
) {
    let installed_hf_ollama_model_ids = hf_models
        .iter()
        .filter(|model| {
            model.runtime_provider_id == OLLAMA_PROVIDER_ID
                && model.installed
                && matches!(model.source_kind, RefineModelSourceKind::HuggingFace)
        })
        .map(|model| model.runtime_model_id.clone())
        .collect::<Vec<_>>();

    models.retain(|model| {
        if model.runtime_provider_id != OLLAMA_PROVIDER_ID
            || !matches!(model.source_kind, RefineModelSourceKind::Ollama)
        {
            return true;
        }

        !installed_hf_ollama_model_ids
            .iter()
            .any(|hf_model_id| ollama_model_ids_equivalent(&model.runtime_model_id, hf_model_id))
    });
}

#[cfg(test)]
mod tests {
    use super::{
        ollama_model_ids_equivalent, ollama_model_matches,
        remove_local_ollama_rows_shadowed_by_installed_hf_imports, replacement_ollama_model_id,
        RefineModelDescriptor, RefineModelSourceKind, OLLAMA_PROVIDER_ID,
    };

    fn refine_model(
        source_kind: RefineModelSourceKind,
        runtime_model_id: &str,
        installed: bool,
    ) -> RefineModelDescriptor {
        RefineModelDescriptor {
            id: format!("{source_kind:?}:{runtime_model_id}"),
            title: runtime_model_id.to_string(),
            description: String::new(),
            source_kind,
            source_label: String::new(),
            runtime_provider_id: OLLAMA_PROVIDER_ID.to_string(),
            runtime_model_id: runtime_model_id.to_string(),
            runtime_label: String::new(),
            installed,
            active: false,
            runnable: installed,
            downloadable: !installed,
            requires_api_key: false,
            source_repo_id: None,
            source_file_name: None,
            source_url: None,
            note: None,
        }
    }

    #[test]
    fn ollama_model_matches_exact_tags_without_cross_tag_bleed() {
        let installed = vec!["smollm2:1.7b".to_string()];

        assert!(ollama_model_matches(&installed, "smollm2:1.7b"));
        assert!(!ollama_model_matches(&installed, "smollm2:360m"));
        assert!(!ollama_model_matches(&installed, "smollm2:135m"));
    }

    #[test]
    fn ollama_model_matches_latest_tag_alias_only() {
        assert!(ollama_model_matches(
            &["llama3.2:latest".to_string()],
            "llama3.2",
        ));
        assert!(ollama_model_matches(
            &["llama3.2".to_string()],
            "llama3.2:latest",
        ));
        assert!(!ollama_model_matches(
            &["llama3.2:3b".to_string()],
            "llama3.2:1b",
        ));
    }

    #[test]
    fn ollama_model_ids_equivalent_handles_hf_import_latest_alias() {
        assert!(ollama_model_ids_equivalent(
            "smollm2-1.7b-instruct-gguf-q4_k_m",
            "smollm2-1.7b-instruct-gguf-q4_k_m:latest",
        ));
        assert!(!ollama_model_ids_equivalent("smollm2:1.7b", "smollm2:360m",));
    }

    #[test]
    fn installed_hf_imports_hide_duplicate_local_ollama_rows() {
        let mut local_models = vec![
            refine_model(
                RefineModelSourceKind::Ollama,
                "smollm2-1.7b-instruct-gguf-q4_k_m:latest",
                true,
            ),
            refine_model(RefineModelSourceKind::Ollama, "mistral:7b", true),
            refine_model(RefineModelSourceKind::Ollama, "qwen2.5:0.5b", true),
        ];
        let hf_models = vec![
            refine_model(
                RefineModelSourceKind::HuggingFace,
                "smollm2-1.7b-instruct-gguf-q4_k_m",
                true,
            ),
            refine_model(RefineModelSourceKind::HuggingFace, "qwen2.5:0.5b", false),
        ];

        remove_local_ollama_rows_shadowed_by_installed_hf_imports(&mut local_models, &hf_models);

        let remaining = local_models
            .iter()
            .map(|model| model.runtime_model_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(remaining, vec!["mistral:7b", "qwen2.5:0.5b"]);
    }

    #[test]
    fn replacement_ollama_model_skips_removed_aliases() {
        let installed = vec![
            "smollm2:135m".to_string(),
            "qwen2.5-0.5b-instruct-q4_k_m".to_string(),
        ];

        assert_eq!(
            replacement_ollama_model_id(&installed, "smollm2:135m"),
            Some("qwen2.5-0.5b-instruct-q4_k_m".to_string())
        );
        assert_eq!(
            replacement_ollama_model_id(&installed, "smollm2:135m:latest"),
            Some("qwen2.5-0.5b-instruct-q4_k_m".to_string())
        );
    }

    #[test]
    fn replacement_ollama_model_returns_none_when_last_model_removed() {
        let installed = vec!["smollm2:135m".to_string()];

        assert_eq!(
            replacement_ollama_model_id(&installed, "smollm2:135m"),
            None
        );
    }
}

fn sanitize_runtime_model_id(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    let mut previous_was_dash = false;

    for ch in value.chars() {
        let normalized = ch.to_ascii_lowercase();
        let keep = normalized.is_ascii_alphanumeric() || matches!(normalized, '.' | '_' | '-');
        if keep {
            sanitized.push(normalized);
            previous_was_dash = false;
        } else if !previous_was_dash {
            sanitized.push('-');
            previous_was_dash = true;
        }
    }

    sanitized.trim_matches('-').to_string()
}

fn parse_parameter_billions(repo_id: &str) -> Option<f32> {
    let lower = repo_id.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut i = 0usize;

    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }

        let start = i;
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }

        if i < bytes.len() && bytes[i] == b'.' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
        }

        if i < bytes.len() && bytes[i] == b'b' {
            if let Ok(value) = lower[start..i].parse::<f32>() {
                return Some(value);
            }
        }
    }

    None
}

fn is_hf_repo_safe_candidate(repo_id: &str) -> bool {
    let lower = repo_id.to_ascii_lowercase();
    if !lower.contains("gguf") || !lower.contains("instruct") {
        return false;
    }

    if let Some(param_size) = parse_parameter_billions(&lower) {
        return param_size <= HF_DYNAMIC_MAX_PARAMETER_BILLIONS;
    }

    lower.contains("mini") || lower.contains("smol") || lower.contains("tiny")
}

fn make_dynamic_hf_runtime_model_id(repo_id: &str) -> String {
    let repo_name = repo_id.split('/').nth(1).unwrap_or(repo_id);
    let base = sanitize_runtime_model_id(repo_name);
    if base.ends_with("q4_k_m") {
        base
    } else {
        format!("{base}-q4_k_m")
    }
}

fn make_dynamic_hf_title(repo_id: &str) -> String {
    let repo_name = repo_id.split('/').nth(1).unwrap_or(repo_id);
    repo_name
        .replace("-GGUF", "")
        .replace("-gguf", "")
        .replace('_', " ")
}

fn normalize_collection_slug(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(path) = trimmed.strip_prefix("https://huggingface.co/collections/") {
        return path.to_string();
    }
    if let Some(path) = trimmed.strip_prefix("http://huggingface.co/collections/") {
        return path.to_string();
    }
    if let Some(path) = trimmed.strip_prefix("collections/") {
        return path.to_string();
    }

    trimmed.to_string()
}

async fn fetch_dynamic_hf_repo_ids(
    client: &reqwest::Client,
) -> Result<(Vec<String>, HfDiscoverySource), String> {
    let env_slug = std::env::var(HF_COLLECTION_SLUG_ENV).unwrap_or_default();
    let collection_slug = normalize_collection_slug(if env_slug.trim().is_empty() {
        HF_DEFAULT_COLLECTION_SLUG
    } else {
        &env_slug
    });

    if !collection_slug.is_empty() {
        let collection_url = format!("https://huggingface.co/api/collections/{collection_slug}");
        let collection: HfCollectionInfo = client
            .get(&collection_url)
            .send()
            .await
            .map_err(|err| {
                format!(
                    "Failed to query Hugging Face collection '{}': {err}",
                    collection_slug
                )
            })?
            .json()
            .await
            .map_err(|err| {
                format!(
                    "Failed to parse Hugging Face collection '{}': {err}",
                    collection_slug
                )
            })?;

        let mut seen = HashSet::new();
        let mut repo_ids = Vec::new();
        for item in collection.items {
            let repo_id = item.id.trim();
            if repo_id.is_empty() || !seen.insert(repo_id.to_string()) {
                continue;
            }
            // Trust the curated collection — every entry is one the user has
            // explicitly verified for Vox Jot. The size/keyword heuristics in
            // `is_hf_repo_safe_candidate` are only useful for the open
            // search-discovery fallback.
            repo_ids.push(repo_id.to_string());
            if repo_ids.len() >= HF_DYNAMIC_COLLECTION_MAX_RESULTS {
                break;
            }
        }

        if !repo_ids.is_empty() {
            return Ok((repo_ids, HfDiscoverySource::Collection));
        }

        log::warn!(
            "Hugging Face collection '{}' returned no items; falling back to search.",
            collection_slug
        );
    }

    let query_params = vec![
        ("search".to_string(), HF_DYNAMIC_SEARCH_QUERY.to_string()),
        ("sort".to_string(), "downloads".to_string()),
        ("direction".to_string(), "-1".to_string()),
        ("limit".to_string(), HF_DYNAMIC_SEARCH_LIMIT.to_string()),
    ];

    let models: Vec<HfSearchModel> = client
        .get("https://huggingface.co/api/models")
        .query(&query_params)
        .send()
        .await
        .map_err(|err| format!("Failed to query Hugging Face model search: {err}"))?
        .json()
        .await
        .map_err(|err| format!("Failed to parse Hugging Face model search: {err}"))?;

    let mut seen = HashSet::new();
    let mut repo_ids = Vec::new();
    for model in models {
        if let Some(tag) = model.pipeline_tag.as_deref() {
            if tag != "text-generation" {
                continue;
            }
        }

        let repo_id = model.id.trim();
        if repo_id.is_empty() || !seen.insert(repo_id.to_string()) {
            continue;
        }
        if !is_hf_repo_safe_candidate(repo_id) {
            continue;
        }
        if model.downloads == 0 {
            continue;
        }

        repo_ids.push(repo_id.to_string());
        if repo_ids.len() >= HF_DYNAMIC_SEARCH_MAX_RESULTS {
            break;
        }
    }

    if repo_ids.is_empty() {
        return Err("Hugging Face search returned no safe GGUF instruct models.".to_string());
    }

    Ok((repo_ids, HfDiscoverySource::Search))
}

async fn fetch_lmstudio_models(
    settings: &settings::AppSettings,
) -> (RefineProviderStatus, Vec<RefineModelDescriptor>) {
    let Some(provider) = find_provider(settings, "lmstudio") else {
        return (
            RefineProviderStatus {
                id: "lmstudio".to_string(),
                label: "LM Studio".to_string(),
                available: false,
                local_only: true,
                installed: true,
                running: false,
                detail: "LM Studio is not configured in this build.".to_string(),
            },
            Vec::new(),
        );
    };

    match llm_client::fetch_models(provider, String::new()).await {
        Ok(models) => {
            let descriptors = models
                .into_iter()
                .map(|model_id| RefineModelDescriptor {
                    id: format!("lmstudio:{model_id}"),
                    title: model_id.clone(),
                    description: "Exposed by LM Studio's local OpenAI-compatible server."
                        .to_string(),
                    source_kind: RefineModelSourceKind::LmStudio,
                    source_label: "LM Studio".to_string(),
                    runtime_provider_id: "lmstudio".to_string(),
                    runtime_model_id: model_id.clone(),
                    runtime_label: "LM Studio runtime".to_string(),
                    installed: true,
                    active: is_active_model(settings, "lmstudio", &model_id),
                    runnable: true,
                    downloadable: false,
                    requires_api_key: false,
                    source_repo_id: None,
                    source_file_name: None,
                    source_url: Some("http://localhost:1234".to_string()),
                    note: None,
                })
                .collect();

            (
                RefineProviderStatus {
                    id: "lmstudio".to_string(),
                    label: "LM Studio".to_string(),
                    available: true,
                    local_only: true,
                    installed: true,
                    running: true,
                    detail: "Local server reachable. Any loaded LM Studio models can be used immediately."
                        .to_string(),
                },
                descriptors,
            )
        }
        Err(err) => (
            RefineProviderStatus {
                id: "lmstudio".to_string(),
                label: "LM Studio".to_string(),
                available: false,
                local_only: true,
                installed: true,
                running: false,
                detail: format!("Start LM Studio's local server to use its models. {err}"),
            },
            Vec::new(),
        ),
    }
}

fn make_ollama_provider_status(status: &ollama::OllamaStatus) -> RefineProviderStatus {
    let detail = if !status.installed {
        "Install Ollama to download and run local refine models.".to_string()
    } else if !status.running {
        "Ollama is installed but not running. Start it to use downloaded models and imports."
            .to_string()
    } else {
        format!(
            "Ollama is ready. {} local model{} available now.",
            status.models.len(),
            if status.models.len() == 1 { "" } else { "s" }
        )
    };

    RefineProviderStatus {
        id: OLLAMA_PROVIDER_ID.to_string(),
        label: "Ollama".to_string(),
        available: status.installed && status.running,
        local_only: true,
        installed: status.installed,
        running: status.running,
        detail,
    }
}

fn build_local_ollama_models(
    settings: &settings::AppSettings,
    status: &ollama::OllamaStatus,
) -> Vec<RefineModelDescriptor> {
    status
        .models
        .iter()
        .map(|model_id| RefineModelDescriptor {
            id: format!("ollama:local:{model_id}"),
            title: model_id.clone(),
            description: "Already installed in Ollama.".to_string(),
            source_kind: RefineModelSourceKind::Ollama,
            source_label: "Ollama".to_string(),
            runtime_provider_id: OLLAMA_PROVIDER_ID.to_string(),
            runtime_model_id: model_id.clone(),
            runtime_label: "Ollama runtime".to_string(),
            installed: true,
            active: is_active_model(settings, OLLAMA_PROVIDER_ID, model_id),
            runnable: status.running,
            downloadable: false,
            requires_api_key: false,
            source_repo_id: None,
            source_file_name: None,
            source_url: Some("https://ollama.com/library".to_string()),
            note: if status.running {
                None
            } else {
                Some("Start Ollama to use this local model.".to_string())
            },
        })
        .collect()
}

fn build_hf_fallback_models(
    settings: &settings::AppSettings,
    ollama_status: &ollama::OllamaStatus,
) -> Vec<RefineModelDescriptor> {
    HF_IMPORT_SPECS
        .iter()
        .map(|spec| RefineModelDescriptor {
            id: spec.id.to_string(),
            title: spec.title.to_string(),
            description: spec.description.to_string(),
            source_kind: RefineModelSourceKind::HuggingFace,
            source_label: "Hugging Face".to_string(),
            runtime_provider_id: OLLAMA_PROVIDER_ID.to_string(),
            runtime_model_id: spec.runtime_model_id.to_string(),
            runtime_label: "Imported into Ollama".to_string(),
            installed: ollama_model_matches(&ollama_status.models, spec.runtime_model_id),
            active: is_active_model(settings, OLLAMA_PROVIDER_ID, spec.runtime_model_id),
            runnable: ollama_status.installed && ollama_status.running,
            downloadable: true,
            requires_api_key: false,
            source_repo_id: Some(spec.repo_id.to_string()),
            source_file_name: Some(spec.file_name.to_string()),
            source_url: Some(format!("https://huggingface.co/{}", spec.repo_id)),
            note: if ollama_status.installed && ollama_status.running {
                None
            } else {
                Some(
                    "Install and start Ollama before importing Hugging Face GGUF models."
                        .to_string(),
                )
            },
        })
        .collect()
}

fn build_dynamic_hf_models(
    settings: &settings::AppSettings,
    ollama_status: &ollama::OllamaStatus,
    repo_ids: &[String],
    source: HfDiscoverySource,
) -> Vec<RefineModelDescriptor> {
    repo_ids
        .iter()
        .map(|repo_id| {
            let runtime_model_id = make_dynamic_hf_runtime_model_id(repo_id);
            let title = make_dynamic_hf_title(repo_id);
            let description = match source {
                HfDiscoverySource::Collection => {
                    "Auto-listed from your verified Hugging Face collection. GGUF file is resolved automatically during import.".to_string()
                }
                HfDiscoverySource::Search => {
                    "Auto-discovered top-downloaded small GGUF instruct model. GGUF file is resolved automatically during import.".to_string()
                }
            };

            RefineModelDescriptor {
                id: format!("hf:auto:{runtime_model_id}"),
                title,
                description,
                source_kind: RefineModelSourceKind::HuggingFace,
                source_label: "Hugging Face".to_string(),
                runtime_provider_id: OLLAMA_PROVIDER_ID.to_string(),
                runtime_model_id: runtime_model_id.clone(),
                runtime_label: "Imported into Ollama".to_string(),
                installed: ollama_model_matches(&ollama_status.models, &runtime_model_id),
                active: is_active_model(settings, OLLAMA_PROVIDER_ID, &runtime_model_id),
                runnable: ollama_status.installed && ollama_status.running,
                downloadable: true,
                requires_api_key: false,
                source_repo_id: Some(repo_id.clone()),
                source_file_name: None,
                source_url: Some(format!("https://huggingface.co/{repo_id}")),
                note: if ollama_status.installed && ollama_status.running {
                    None
                } else {
                    Some(
                        "Install and start Ollama before importing Hugging Face GGUF models."
                            .to_string(),
                    )
                },
            }
        })
        .collect()
}

async fn build_hf_catalog_models(
    settings: &settings::AppSettings,
    ollama_status: &ollama::OllamaStatus,
) -> (Vec<RefineModelDescriptor>, String) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    match fetch_dynamic_hf_repo_ids(&client).await {
        Ok((repo_ids, source)) => {
            let models = build_dynamic_hf_models(settings, ollama_status, &repo_ids, source);
            let detail = match source {
                HfDiscoverySource::Collection => {
                    "Auto-updating verified Hugging Face collection. Add or remove collection items to update this catalog without an app release.".to_string()
                }
                HfDiscoverySource::Search => {
                    "Auto-discovered small Hugging Face GGUF instruct models ranked by downloads with safety filters.".to_string()
                }
            };
            (models, detail)
        }
        Err(err) => {
            log::warn!("Hugging Face dynamic model discovery failed, using fallback list: {err}");
            (
                build_hf_fallback_models(settings, ollama_status),
                "Using bundled verified Hugging Face imports (offline-safe fallback).".to_string(),
            )
        }
    }
}

pub async fn get_refine_model_catalog_impl(app: &AppHandle) -> Result<RefineModelCatalog, String> {
    let settings = settings::get_settings(app);
    let ollama_status = ollama::get_ollama_status().await;
    let (hf_models, hf_provider_detail) = build_hf_catalog_models(&settings, &ollama_status).await;
    let mut providers = vec![make_ollama_provider_status(&ollama_status)];
    providers.push(RefineProviderStatus {
        id: "huggingface".to_string(),
        label: "Hugging Face".to_string(),
        available: true,
        local_only: false,
        installed: true,
        running: true,
        detail: hf_provider_detail,
    });

    let mut models = build_local_ollama_models(&settings, &ollama_status);
    let registry_models = ollama::get_recommended_ollama_models_impl().await;
    for model in registry_models {
        let installed = ollama_model_matches(&ollama_status.models, &model.id);
        if models.iter().any(|existing| {
            existing.runtime_provider_id == OLLAMA_PROVIDER_ID
                && existing.runtime_model_id == model.id
        }) {
            continue;
        }

        models.push(RefineModelDescriptor {
            id: format!("ollama:registry:{}", model.id),
            title: model.label,
            description: model.description,
            source_kind: RefineModelSourceKind::Ollama,
            source_label: "Ollama registry".to_string(),
            runtime_provider_id: OLLAMA_PROVIDER_ID.to_string(),
            runtime_model_id: model.id.clone(),
            runtime_label: "Ollama runtime".to_string(),
            installed,
            active: is_active_model(&settings, OLLAMA_PROVIDER_ID, &model.id),
            runnable: installed && ollama_status.running,
            downloadable: !installed,
            requires_api_key: false,
            source_repo_id: None,
            source_file_name: None,
            source_url: Some(format!("https://ollama.com/library/{}", model.id)),
            note: if ollama_status.installed && ollama_status.running {
                None
            } else if !ollama_status.installed {
                Some("Install Ollama to download this model.".to_string())
            } else {
                Some("Start Ollama to download or use this model.".to_string())
            },
        });
    }

    let (lmstudio_status, lmstudio_models) = fetch_lmstudio_models(&settings).await;
    providers.push(lmstudio_status);
    remove_local_ollama_rows_shadowed_by_installed_hf_imports(&mut models, &hf_models);
    models.extend(lmstudio_models);
    models.extend(hf_models);

    let mut seen_provider_ids = providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect::<HashSet<_>>();
    for provider in &settings.post_process_providers {
        if seen_provider_ids.insert(provider.id.clone()) {
            providers.push(make_managed_provider_status(&settings, provider));
        }
    }

    let mut seen_runtime_keys = models
        .iter()
        .map(|model| {
            (
                model.runtime_provider_id.clone(),
                model.runtime_model_id.clone(),
            )
        })
        .collect::<HashSet<_>>();

    for provider in &settings.post_process_providers {
        if provider.id == OLLAMA_PROVIDER_ID || provider.id == "lmstudio" {
            continue;
        }
        let Some(model) = make_managed_provider_model(&settings, provider) else {
            continue;
        };
        let key = (
            model.runtime_provider_id.clone(),
            model.runtime_model_id.clone(),
        );
        if seen_runtime_keys.insert(key) {
            models.push(model);
        }
    }

    models.sort_by(|a, b| {
        let a_rank = (
            !a.active,
            !a.installed,
            !a.runnable,
            !matches!(a.source_kind, RefineModelSourceKind::HuggingFace),
            a.title.to_lowercase(),
        );
        let b_rank = (
            !b.active,
            !b.installed,
            !b.runnable,
            !matches!(b.source_kind, RefineModelSourceKind::HuggingFace),
            b.title.to_lowercase(),
        );
        a_rank.cmp(&b_rank)
    });

    Ok(RefineModelCatalog { providers, models })
}

fn validate_provider_exists(
    settings: &settings::AppSettings,
    provider_id: &str,
) -> Result<(), String> {
    if settings
        .post_process_providers
        .iter()
        .any(|provider| provider.id == provider_id)
    {
        Ok(())
    } else {
        Err(format!(
            "Provider '{}' is not configured in this build.",
            provider_id
        ))
    }
}

pub async fn set_refine_model_selection_impl(
    app: &AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(app);
    validate_provider_exists(&settings, &provider_id)?;

    if settings.local_privacy_mode && !settings.is_post_process_provider_local(&provider_id) {
        return Err(
            "Local privacy mode is enabled. Select a local post-processing provider.".to_string(),
        );
    }

    if provider_id == OLLAMA_PROVIDER_ID {
        let status = ollama::get_ollama_status().await;
        if !status.running {
            return Err("Start Ollama before selecting an Ollama refine model.".to_string());
        }
        if !ollama_model_matches(&status.models, &model_id) {
            return Err(format!(
                "Ollama model '{}' is not available locally yet.",
                model_id
            ));
        }
    } else if provider_id == "lmstudio" {
        let Some(provider) = find_provider(&settings, "lmstudio") else {
            return Err("LM Studio is not configured in this build.".to_string());
        };
        let models = llm_client::fetch_models(provider, String::new())
            .await
            .map_err(|err| format!("LM Studio is not reachable: {err}"))?;
        if !models.iter().any(|candidate| candidate == &model_id) {
            return Err(format!(
                "LM Studio does not currently expose '{}'. Load it in LM Studio first.",
                model_id
            ));
        }
    } else {
        let Some(provider) = find_provider(&settings, &provider_id) else {
            return Err(format!(
                "Provider '{}' is not configured in this build.",
                provider_id
            ));
        };
        if managed_provider_requires_api_key(provider)
            && !managed_provider_has_api_key(&settings, provider)
        {
            return Err(format!(
                "Add an API key for {} before selecting this cloud refine model.",
                provider.label
            ));
        }
    }

    settings
        .post_process_models
        .insert(provider_id.clone(), model_id.clone());
    settings.post_process_provider_id = provider_id.clone();
    settings.selected_llm_provider_id = provider_id;
    settings.selected_llm_model_id = model_id;
    settings.enforce_local_privacy_mode();
    settings::write_settings(app, settings);
    Ok(())
}

async fn resolve_hf_gguf_file(repo_id: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let api_url = format!("https://huggingface.co/api/models/{repo_id}");
    let info: HfModelInfo = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Failed to query Hugging Face for {repo_id}: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Hugging Face response for {repo_id}: {e}"))?;

    let preferred_tokens = ["q4_k_m", "q4_0", "q5_k_m", "q6_k", "q8_0", "bf16"];
    let mut candidates = info
        .siblings
        .into_iter()
        .map(|sibling| sibling.rfilename)
        .filter(|file| file.to_ascii_lowercase().ends_with(".gguf"))
        .filter(|file| {
            let lower = file.to_ascii_lowercase();
            !lower.contains("mmproj") && !lower.contains("imatrix")
        })
        .collect::<Vec<_>>();

    candidates.sort_by_key(|file| {
        let lower = file.to_ascii_lowercase();
        preferred_tokens
            .iter()
            .position(|token| lower.contains(token))
            .unwrap_or(preferred_tokens.len())
    });

    candidates.into_iter().next().ok_or_else(|| {
        format!(
            "No usable GGUF file was found in Hugging Face repo '{}'.",
            repo_id
        )
    })
}

/// Resolve the true file size from a Hugging Face resolve URL.
///
/// HF returns a 302 redirect with `x-linked-size` on the redirect response.
/// `reqwest`'s default redirect-following loses that header, so we first try
/// a no-redirect HEAD to read it directly. If that fails we fall back to a
/// redirect-following HEAD and read `Content-Length` from the final CDN response.
async fn resolve_remote_file_size(client: &reqwest::Client, url: &str) -> Option<u64> {
    if let Ok(no_redir) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        if let Ok(resp) = no_redir.head(url).send().await {
            let linked = resp
                .headers()
                .get("x-linked-size")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            if linked.is_some() {
                return linked;
            }
        }
    }

    client
        .head(url)
        .send()
        .await
        .ok()
        .and_then(|r| r.content_length())
}

fn refine_import_dir(model_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("vox-jot-refine-imports")
        .join(sanitize_runtime_model_id(model_id))
}

/// Look up a pre-staged GGUF file in the app-managed model store. Returns the
/// path if a file with matching name exists and is non-empty. Today only the
/// LFM2-Tool staging dir is checked, but the matcher is keyed by file name so
/// future managed quants drop in without code changes.
fn locate_managed_staging_gguf(app: &AppHandle, file_name: &str) -> Option<PathBuf> {
    let candidates = [crate::storage_paths::lfm2_tool_staging_dir(app).ok()?];
    for dir in candidates {
        let candidate = dir.join(file_name);
        if candidate.is_file() {
            if let Ok(metadata) = std::fs::metadata(&candidate) {
                if metadata.len() > 0 {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

async fn ensure_hf_gguf_downloaded(
    app: &AppHandle,
    model_id: &str,
    repo_id: &str,
    file_name: &str,
    target_path: &Path,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    ensure_refine_install_not_cancelled(&cancel_flag)?;
    let encoded_file = file_name.replace(' ', "%20");
    let url = format!("https://huggingface.co/{repo_id}/resolve/main/{encoded_file}");
    let client = reqwest::Client::new();

    if target_path.exists() {
        let local_size = tokio_fs::metadata(target_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        if local_size > 0 {
            let remote_size = resolve_remote_file_size(&client, &url).await;

            if let Some(expected) = remote_size {
                if local_size >= expected {
                    ensure_refine_install_not_cancelled(&cancel_flag)?;
                    log::info!("ensure_hf_gguf_downloaded: {file_name} already complete ({local_size} / {expected} bytes)");
                    let _ = app.emit(
                        "refine-download-progress",
                        serde_json::json!({
                            "model_id": model_id,
                            "downloaded": local_size,
                            "total": expected,
                            "percentage": 100.0f64,
                            "stage": "importing",
                        }),
                    );
                    return Ok(());
                }
                log::warn!(
                    "ensure_hf_gguf_downloaded: {file_name} is truncated ({local_size} / {expected} bytes), re-downloading"
                );
            } else {
                ensure_refine_install_not_cancelled(&cancel_flag)?;
                log::info!("ensure_hf_gguf_downloaded: {file_name} exists ({local_size} bytes), cannot verify size — assuming complete");
                let _ = app.emit(
                    "refine-download-progress",
                    serde_json::json!({
                        "model_id": model_id,
                        "downloaded": local_size,
                        "total": local_size,
                        "percentage": 100.0f64,
                        "stage": "importing",
                    }),
                );
                return Ok(());
            }
        }

        let _ = tokio_fs::remove_file(target_path).await;
    }

    if let Some(parent) = target_path.parent() {
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create download directory: {e}"))?;
    }

    log::info!("ensure_hf_gguf_downloaded: downloading {file_name} from {url}");

    let expected_size = resolve_remote_file_size(&client, &url).await.unwrap_or(0);
    let partial_path = target_path.with_extension(format!(
        "{}partial",
        target_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| format!("{extension}."))
            .unwrap_or_default()
    ));
    let progress_app = app.clone();
    let progress_model_id = model_id.to_string();
    let progress = std::sync::Arc::new(
        move |progress: crate::artifact_download::ArtifactProgress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress.clone());
            let _ = progress_app.emit(
                "refine-download-progress",
                serde_json::json!({
                    "model_id": progress_model_id,
                    "downloaded": progress.downloaded_bytes,
                    "total": progress.total_bytes,
                    "percentage": progress.percentage,
                    "stage": if progress.phase == "complete" { "importing" } else { "downloading" },
                }),
            );
        },
    );

    let report = match crate::artifact_download::download_file(
        crate::artifact_download::FileDownloadOptions {
            domain: "refine".to_string(),
            artifact_id: model_id.to_string(),
            url,
            partial_path,
            final_path: target_path.to_path_buf(),
            expected_sha256: None,
            expected_size: (expected_size > 0).then_some(expected_size),
            bearer_token: None,
            cancel_flag: Some(Arc::clone(&cancel_flag)),
            progress: Some(progress),
        },
    )
    .await
    {
        Ok(report) => report,
        Err(err) => {
            let stage = if crate::artifact_download::is_cancelled_error(&err) {
                "cancelled"
            } else {
                "failed"
            };
            let _ = app.emit(
                "refine-download-progress",
                serde_json::json!({
                    "model_id": model_id,
                    "downloaded": 0u64,
                    "total": 0u64,
                    "percentage": 0.0f64,
                    "stage": stage,
                }),
            );
            return Err(err);
        }
    };

    let _ = app.emit(
        "refine-download-progress",
        serde_json::json!({
            "model_id": model_id,
            "downloaded": report.downloaded_bytes,
            "total": report.total_bytes,
            "percentage": 100.0f64,
            "stage": "importing",
        }),
    );

    log::info!(
        "ensure_hf_gguf_downloaded: {file_name} downloaded ({} bytes)",
        report.downloaded_bytes
    );
    Ok(())
}

async fn import_hf_gguf_to_ollama(
    app: &AppHandle,
    model_id: &str,
    repo_id: &str,
    file_name: Option<String>,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    log::info!(
        "import_hf_gguf_to_ollama: model_id={model_id}, repo_id={repo_id}, file_name={file_name:?}"
    );

    ensure_refine_install_not_cancelled(&cancel_flag)?;
    if !ollama::is_ollama_available().await {
        return Err("Install and start Ollama before importing Hugging Face models.".to_string());
    }

    let resolved_file = match file_name {
        Some(file) if !file.trim().is_empty() => file,
        _ => resolve_hf_gguf_file(repo_id).await?,
    };

    let import_dir = refine_import_dir(model_id);
    let gguf_path = import_dir.join(&resolved_file);

    if !gguf_path.exists() {
        if let Some(staged) = locate_managed_staging_gguf(app, &resolved_file) {
            if let Some(parent) = gguf_path.parent() {
                tokio_fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("Failed to create import dir: {e}"))?;
            }
            tokio_fs::copy(&staged, &gguf_path)
                .await
                .map_err(|e| format!("Failed to copy staged GGUF '{}': {e}", staged.display()))?;
            log::info!(
                "import_hf_gguf_to_ollama: copied staged GGUF from {} → {}",
                staged.display(),
                gguf_path.display()
            );
        }
    }

    ensure_hf_gguf_downloaded(
        app,
        model_id,
        repo_id,
        &resolved_file,
        &gguf_path,
        Arc::clone(&cancel_flag),
    )
    .await?;
    ensure_refine_install_not_cancelled(&cancel_flag)?;
    log::info!("import_hf_gguf_to_ollama: download complete, running ollama create");

    let modelfile_path = import_dir.join("Modelfile");
    let modelfile = format!("FROM {}\n", gguf_path.to_string_lossy());
    tokio_fs::write(&modelfile_path, modelfile)
        .await
        .map_err(|e| format!("Failed to write Modelfile: {e}"))?;

    let binary = ollama::find_ollama_binary().ok_or_else(|| {
        "Ollama is not installed. Install it before importing models.".to_string()
    })?;

    let mut command = Command::new(binary);
    command
        .arg("create")
        .arg(model_id)
        .arg("-f")
        .arg(&modelfile_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let output = run_refine_child_with_cancel(command, &cancel_flag, "ollama create").await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let details = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        let _ = app.emit(
            "refine-download-progress",
            serde_json::json!({ "model_id": model_id, "stage": "failed" }),
        );
        return Err(format!("Ollama import failed: {details}"));
    }

    let _ = app.emit(
        "refine-download-progress",
        serde_json::json!({ "model_id": model_id, "stage": "complete" }),
    );

    Ok(())
}

fn ensure_refine_install_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        Err(crate::artifact_download::DOWNLOAD_CANCELLED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

fn spawn_async_pipe_reader<R>(
    reader: Option<R>,
    label: String,
    stream_name: &'static str,
) -> Option<tokio::task::JoinHandle<Result<Vec<u8>, String>>>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    reader.map(|mut reader| {
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            reader
                .read_to_end(&mut buffer)
                .await
                .map_err(|err| format!("Failed to read {label} {stream_name}: {err}"))?;
            Ok(buffer)
        })
    })
}

async fn join_async_pipe_reader(
    reader: Option<tokio::task::JoinHandle<Result<Vec<u8>, String>>>,
    label: &str,
    stream_name: &'static str,
) -> Result<Vec<u8>, String> {
    match reader {
        Some(handle) => handle
            .await
            .map_err(|_| format!("{label} {stream_name} reader stopped"))?,
        None => Ok(Vec::new()),
    }
}

async fn run_refine_child_with_cancel(
    mut command: Command,
    cancel_flag: &Arc<AtomicBool>,
    label: &str,
) -> Result<std::process::Output, String> {
    ensure_refine_install_not_cancelled(cancel_flag)?;
    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to run {label}: {err}"))?;
    let mut stdout_reader =
        spawn_async_pipe_reader(child.stdout.take(), label.to_string(), "stdout");
    let mut stderr_reader =
        spawn_async_pipe_reader(child.stderr.take(), label.to_string(), "stderr");

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = child.start_kill();
            let _ = child.wait().await;
            let _ = join_async_pipe_reader(stdout_reader.take(), label, "stdout").await;
            let _ = join_async_pipe_reader(stderr_reader.take(), label, "stderr").await;
            return Err(crate::artifact_download::DOWNLOAD_CANCELLED_MESSAGE.to_string());
        }

        match child
            .try_wait()
            .map_err(|err| format!("Failed to monitor {label}: {err}"))?
        {
            Some(status) => {
                let stdout_buf =
                    join_async_pipe_reader(stdout_reader.take(), label, "stdout").await?;
                let stderr_buf =
                    join_async_pipe_reader(stderr_reader.take(), label, "stderr").await?;
                return Ok(std::process::Output {
                    status,
                    stdout: stdout_buf,
                    stderr: stderr_buf,
                });
            }
            None => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }
}

pub async fn get_active_refine_installs_impl() -> Vec<String> {
    ACTIVE_INSTALLS.lock().await.keys().cloned().collect()
}

pub async fn delete_refine_model_impl(
    app: &AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    if provider_id != OLLAMA_PROVIDER_ID {
        return Err("Only Ollama-managed refine models can be removed from here.".to_string());
    }

    {
        let active = ACTIVE_INSTALLS.lock().await;
        if active.contains_key(&model_id) {
            return Err(format!(
                "'{}' is still downloading or importing. Wait for it to finish.",
                model_id
            ));
        }
    }

    ollama::delete_ollama_model_impl(model_id.clone()).await?;

    let import_dir = refine_import_dir(&model_id);
    if import_dir.exists() {
        tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&import_dir))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Failed to remove refine import cache: {e}"))?;
    }

    let replacement_model_id = {
        let status = ollama::get_ollama_status().await;
        replacement_ollama_model_id(&status.models, &model_id)
    };

    let mut settings = settings::get_settings(app);

    if settings
        .post_process_models
        .get(&provider_id)
        .map(|s| s.as_str())
        == Some(model_id.as_str())
    {
        settings.post_process_models.insert(
            provider_id.clone(),
            replacement_model_id.clone().unwrap_or_default(),
        );
    }

    if settings.selected_llm_provider_id == provider_id
        && settings.selected_llm_model_id == model_id
    {
        settings.selected_llm_model_id = replacement_model_id.unwrap_or_default();
    }

    settings.enforce_local_privacy_mode();
    settings::write_settings(app, settings.clone());
    let _ = app.emit("settings-changed", settings);
    Ok(())
}

pub async fn install_refine_model_impl(
    app: &AppHandle,
    provider_id: String,
    model_id: String,
    source_repo_id: Option<String>,
    source_file_name: Option<String>,
) -> Result<(), String> {
    if provider_id != OLLAMA_PROVIDER_ID {
        return Err(format!(
            "Downloading is only supported for Ollama-backed refine models right now, not '{}'.",
            provider_id
        ));
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut active = ACTIVE_INSTALLS.lock().await;
        if active.contains_key(&model_id) {
            return Err(format!(
                "'{}' is already being downloaded. Please wait for it to finish.",
                model_id
            ));
        }
        active.insert(model_id.clone(), Arc::clone(&cancel_flag));
    }

    let result = async {
        if let Some(repo_id) = source_repo_id {
            import_hf_gguf_to_ollama(
                app,
                &model_id,
                &repo_id,
                source_file_name,
                Arc::clone(&cancel_flag),
            )
            .await?;
        } else {
            ollama::pull_ollama_model_with_cancel_impl(
                app,
                model_id.clone(),
                Some(Arc::clone(&cancel_flag)),
            )
            .await?;
        }
        ensure_refine_install_not_cancelled(&cancel_flag)?;
        set_refine_model_selection_impl(app, provider_id, model_id.clone()).await
    }
    .await;

    ACTIVE_INSTALLS.lock().await.remove(&model_id);
    if let Err(error) = &result {
        if crate::artifact_download::is_cancelled_error(error) {
            let _ = app.emit(
                "refine-download-progress",
                serde_json::json!({ "model_id": model_id, "stage": "cancelled" }),
            );
        }
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn get_refine_model_catalog(app: AppHandle) -> Result<RefineModelCatalog, String> {
    run_refine_command_on_stack("get-refine-model-catalog", move || async move {
        get_refine_model_catalog_impl(&app).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn set_refine_model_selection(
    app: AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    run_refine_command_on_stack("set-refine-model-selection", move || async move {
        set_refine_model_selection_impl(&app, provider_id, model_id).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_active_refine_installs() -> Vec<String> {
    get_active_refine_installs_impl().await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_refine_model_install(app: AppHandle, model_id: String) -> Result<(), String> {
    let Some(cancel_flag) = ACTIVE_INSTALLS.lock().await.get(&model_id).cloned() else {
        return Ok(());
    };
    cancel_flag.store(true, Ordering::Relaxed);
    let _ = app.emit(
        "refine-download-progress",
        serde_json::json!({ "model_id": model_id, "stage": "cancelling" }),
    );
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn install_refine_model(
    app: AppHandle,
    provider_id: String,
    model_id: String,
    source_repo_id: Option<String>,
    source_file_name: Option<String>,
) -> Result<(), String> {
    run_refine_command_on_stack("install-refine-model", move || async move {
        install_refine_model_impl(
            &app,
            provider_id,
            model_id,
            source_repo_id,
            source_file_name,
        )
        .await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_refine_model(
    app: AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    run_refine_command_on_stack("delete-refine-model", move || async move {
        delete_refine_model_impl(&app, provider_id, model_id).await
    })
    .await
}
