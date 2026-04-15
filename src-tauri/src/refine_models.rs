use crate::llm_client;
use crate::ollama;
use crate::settings::{self, OLLAMA_PROVIDER_ID};
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs as tokio_fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;

static ACTIVE_INSTALLS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RefineModelSourceKind {
    Ollama,
    LmStudio,
    HuggingFace,
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

const HF_IMPORT_SPECS: &[HfImportSpec] = &[
    HfImportSpec {
        id: "hf:qwen3-0.6b",
        title: "Qwen3 0.6B",
        description: "Ultra-light Q4_K_M GGUF tuned for low-latency dictation cleanup on-device.",
        repo_id: "bartowski/Qwen_Qwen3-0.6B-GGUF",
        file_name: "Qwen_Qwen3-0.6B-Q4_K_M.gguf",
        runtime_model_id: "qwen3-0.6b-q4_k_m",
    },
    HfImportSpec {
        id: "hf:qwen3-1.7b",
        title: "Qwen3 1.7B",
        description: "Balanced Q4_K_M GGUF with enough headroom for cleanup, tone, and light rewrites.",
        repo_id: "bartowski/Qwen_Qwen3-1.7B-GGUF",
        file_name: "Qwen_Qwen3-1.7B-Q4_K_M.gguf",
        runtime_model_id: "qwen3-1.7b-q4_k_m",
    },
    HfImportSpec {
        id: "hf:gemma-3-1b",
        title: "Gemma 3 1B IT",
        description: "Compact Gemma GGUF that stays fast while following short dictation cleanup instructions well.",
        repo_id: "lmstudio-community/gemma-3-1b-it-GGUF",
        file_name: "gemma-3-1b-it-Q4_K_M.gguf",
        runtime_model_id: "gemma-3-1b-it-q4_k_m",
    },
    HfImportSpec {
        id: "hf:smollm2-1.7b",
        title: "SmolLM2 1.7B Instruct",
        description: "Small-device-friendly GGUF with good cleanup quality at roughly 1 GB.",
        repo_id: "lmstudio-community/SmolLM2-1.7B-Instruct-GGUF",
        file_name: "SmolLM2-1.7B-Instruct-Q4_K_M.gguf",
        runtime_model_id: "smollm2-1.7b-instruct-q4_k_m",
    },
    HfImportSpec {
        id: "hf:phi-3-mini-4k",
        title: "Phi-3 Mini 4K",
        description: "A slightly larger fallback when you want more structure-following without jumping to 8B.",
        repo_id: "microsoft/Phi-3-mini-4k-instruct-gguf",
        file_name: "Phi-3-mini-4k-instruct-q4.gguf",
        runtime_model_id: "phi-3-mini-4k-instruct-q4",
    },
];

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
}

#[derive(Debug, Deserialize)]
struct HfModelInfo {
    siblings: Vec<HfSibling>,
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
    installed.iter().any(|model| {
        model == candidate
            || model.starts_with(candidate)
            || candidate.starts_with(model.split(':').next().unwrap_or(model))
    })
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

fn build_hf_curated_models(
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

pub async fn get_refine_model_catalog_impl(app: &AppHandle) -> Result<RefineModelCatalog, String> {
    let settings = settings::get_settings(app);
    let ollama_status = ollama::get_ollama_status().await;
    let mut providers = vec![make_ollama_provider_status(&ollama_status)];
    providers.push(RefineProviderStatus {
        id: "huggingface".to_string(),
        label: "Hugging Face".to_string(),
        available: true,
        local_only: false,
        installed: true,
        running: true,
        detail:
            "Curated GGUF imports can be downloaded and installed into Ollama from this catalog."
                .to_string(),
    });

    let mut models = build_local_ollama_models(&settings, &ollama_status);
    let registry_models = ollama::get_recommended_ollama_models().await;
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
    models.extend(lmstudio_models);
    models.extend(build_hf_curated_models(&settings, &ollama_status));

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

async fn ensure_hf_gguf_downloaded(
    app: &AppHandle,
    model_id: &str,
    repo_id: &str,
    file_name: &str,
    target_path: &Path,
) -> Result<(), String> {
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
                    log::info!("ensure_hf_gguf_downloaded: {file_name} already complete ({local_size} / {expected} bytes)");
                    return Ok(());
                }
                log::warn!(
                    "ensure_hf_gguf_downloaded: {file_name} is truncated ({local_size} / {expected} bytes), re-downloading"
                );
            } else {
                log::info!("ensure_hf_gguf_downloaded: {file_name} exists ({local_size} bytes), cannot verify size — assuming complete");
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

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {file_name}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {file_name}: HTTP {}",
            response.status()
        ));
    }

    let expected_size = response.content_length().unwrap_or(0);

    let _ = app.emit(
        "refine-download-progress",
        serde_json::json!({
            "model_id": model_id,
            "downloaded": 0u64,
            "total": expected_size,
            "percentage": 0.0f64,
            "stage": "downloading",
        }),
    );

    let mut output = tokio_fs::File::create(target_path)
        .await
        .map_err(|e| format!("Failed to create {}: {e}", target_path.display()))?;

    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let throttle = Duration::from_millis(150);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream failed for {file_name}: {e}"))?;
        downloaded += chunk.len() as u64;
        output
            .write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write {file_name}: {e}"))?;

        if last_emit.elapsed() >= throttle {
            let pct = if expected_size > 0 {
                (downloaded as f64 / expected_size as f64) * 100.0
            } else {
                0.0
            };
            let _ = app.emit(
                "refine-download-progress",
                serde_json::json!({
                    "model_id": model_id,
                    "downloaded": downloaded,
                    "total": expected_size,
                    "percentage": pct,
                    "stage": "downloading",
                }),
            );
            last_emit = Instant::now();
        }
    }

    output
        .flush()
        .await
        .map_err(|e| format!("Failed to flush {file_name}: {e}"))?;

    if expected_size > 0 && downloaded != expected_size {
        let _ = app.emit(
            "refine-download-progress",
            serde_json::json!({
                "model_id": model_id,
                "downloaded": 0u64,
                "total": 0u64,
                "percentage": 0.0f64,
                "stage": "failed",
            }),
        );
        let _ = tokio_fs::remove_file(target_path).await;
        return Err(format!(
            "Download incomplete for {file_name}: got {downloaded} bytes, expected {expected_size}"
        ));
    }

    let _ = app.emit(
        "refine-download-progress",
        serde_json::json!({
            "model_id": model_id,
            "downloaded": downloaded,
            "total": downloaded,
            "percentage": 100.0f64,
            "stage": "importing",
        }),
    );

    log::info!("ensure_hf_gguf_downloaded: {file_name} downloaded ({downloaded} bytes)");
    Ok(())
}

async fn import_hf_gguf_to_ollama(
    app: &AppHandle,
    model_id: &str,
    repo_id: &str,
    file_name: Option<String>,
) -> Result<(), String> {
    log::info!(
        "import_hf_gguf_to_ollama: model_id={model_id}, repo_id={repo_id}, file_name={file_name:?}"
    );

    if !ollama::is_ollama_available().await {
        return Err("Install and start Ollama before importing Hugging Face models.".to_string());
    }

    let resolved_file = match file_name {
        Some(file) if !file.trim().is_empty() => file,
        _ => resolve_hf_gguf_file(repo_id).await?,
    };

    let import_dir = refine_import_dir(model_id);
    let gguf_path = import_dir.join(&resolved_file);
    ensure_hf_gguf_downloaded(app, model_id, repo_id, &resolved_file, &gguf_path).await?;
    log::info!("import_hf_gguf_to_ollama: download complete, running ollama create");

    let modelfile_path = import_dir.join("Modelfile");
    let modelfile = format!("FROM {}\n", gguf_path.to_string_lossy());
    tokio_fs::write(&modelfile_path, modelfile)
        .await
        .map_err(|e| format!("Failed to write Modelfile: {e}"))?;

    let binary = ollama::find_ollama_binary().ok_or_else(|| {
        "Ollama is not installed. Install it before importing models.".to_string()
    })?;

    let output = Command::new(binary)
        .arg("create")
        .arg(model_id)
        .arg("-f")
        .arg(&modelfile_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run ollama create: {e}"))?;

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

pub async fn get_active_refine_installs_impl() -> Vec<String> {
    ACTIVE_INSTALLS.lock().await.iter().cloned().collect()
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

    {
        let mut active = ACTIVE_INSTALLS.lock().await;
        if !active.insert(model_id.clone()) {
            return Err(format!(
                "'{}' is already being downloaded. Please wait for it to finish.",
                model_id
            ));
        }
    }

    let result = async {
        if let Some(repo_id) = source_repo_id {
            import_hf_gguf_to_ollama(app, &model_id, &repo_id, source_file_name).await?;
        } else {
            ollama::pull_ollama_model_impl(app, model_id.clone()).await?;
        }
        set_refine_model_selection_impl(app, provider_id, model_id.clone()).await
    }
    .await;

    ACTIVE_INSTALLS.lock().await.remove(&model_id);
    result
}

#[tauri::command]
#[specta::specta]
pub async fn get_refine_model_catalog(app: AppHandle) -> Result<RefineModelCatalog, String> {
    get_refine_model_catalog_impl(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_refine_model_selection(
    app: AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    set_refine_model_selection_impl(&app, provider_id, model_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_active_refine_installs() -> Vec<String> {
    get_active_refine_installs_impl().await
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
    install_refine_model_impl(
        &app,
        provider_id,
        model_id,
        source_repo_id,
        source_file_name,
    )
    .await
}
