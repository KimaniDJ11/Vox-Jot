use crate::managers::model::{model_is_available, EngineType, ModelInfo, ModelManager};
use crate::managers::transcription::TranscriptionManager;
use crate::model_platform::{
    CapabilityFlags, CatalogModelDescriptor, CatalogSourceKind, DomainCatalog, ModelDomain,
    ModelPlatformOverview, ModelPlatformSelectionState, ProviderDescriptor, RuntimeRequirement,
    TtsDeliverySupport, TtsExpressivenessMode,
};
use crate::settings::{
    get_settings, write_settings, AppSettings, TTS_PROVIDER_CHATTERBOX_ID, TTS_PROVIDER_KOKORO_ID,
    TTS_PROVIDER_LOCAL_SIDECAR_API_ID, TTS_PROVIDER_OPENVOICE_ID, TTS_PROVIDER_QWEN3_NATIVE_ID,
    TTS_PROVIDER_SHERPA_PACK_ID, TTS_PROVIDER_SUPERTONIC_ID, TTS_PROVIDER_SYSTEM_BUILTIN_ID,
    TTS_PROVIDER_XTTS_ID,
};
use crate::tts::{tts_model_id_for_hf_repo, TtsManager};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const STT_HF_VERIFIED_PROVIDER_ID: &str = "stt_hf_verified";
const STT_HF_COLLECTION_ENV: &str = "VOXJOT_HF_STT_COLLECTION_SLUG";
const STT_HF_COLLECTION_DEFAULT: &str = "IrieDinamik/vox-jot-stt-verified";

const TTS_HF_COLLECTION_ENV: &str = "VOXJOT_HF_TTS_COLLECTION_SLUG";
const TTS_HF_COLLECTION_DEFAULT: &str = "IrieDinamik/vox-jot-tts-verified";

const HF_COLLECTION_CACHE_TTL: Duration = Duration::from_secs(300);
const HF_COLLECTION_FETCH_TIMEOUT: Duration = Duration::from_secs(4);
const HF_COLLECTION_MAX_ITEMS: usize = 48;

static HF_COLLECTION_CACHE: Lazy<std::sync::Mutex<HashMap<String, (Instant, Vec<String>)>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

#[derive(Debug, Deserialize)]
struct HfCollectionItem {
    id: String,
    #[serde(default)]
    r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HfCollectionInfo {
    #[serde(default)]
    items: Vec<HfCollectionItem>,
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

fn hf_repo_title(repo_id: &str) -> String {
    let repo_name = repo_id.split('/').nth(1).unwrap_or(repo_id);
    repo_name
        .replace("-GGUF", "")
        .replace("-gguf", "")
        .replace('_', " ")
}

fn sanitize_hf_repo_id(repo_id: &str) -> String {
    repo_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn tts_hf_install_dir(app: &AppHandle, repo_id: &str) -> Option<std::path::PathBuf> {
    crate::storage_paths::tts_hf_models_dir(app)
        .ok()
        .map(|dir| dir.join(sanitize_hf_repo_id(repo_id)))
}

fn tts_hf_repo_is_installed(app: &AppHandle, repo_id: &str) -> bool {
    let Some(dir) = tts_hf_install_dir(app, repo_id) else {
        return false;
    };
    if !dir.exists() {
        return false;
    }
    std::fs::read_dir(&dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

fn stt_hf_repo_to_model_id(repo_id: &str) -> Option<&'static str> {
    let lower = repo_id.to_ascii_lowercase();

    if lower.contains("faster-whisper-tiny.en") {
        return Some("tiny.en");
    }
    if lower.contains("faster-whisper-tiny") {
        return Some("tiny");
    }
    if lower.contains("faster-whisper-base.en") {
        return Some("base.en");
    }
    if lower.contains("faster-whisper-base") {
        return Some("base");
    }
    if lower.contains("faster-whisper-small.en") {
        return Some("small.en");
    }
    if lower.contains("faster-whisper-small") {
        return Some("small");
    }
    if lower.contains("faster-whisper-medium.en") {
        return Some("medium.en");
    }
    if lower.contains("faster-whisper-medium") {
        return Some("medium");
    }
    if lower.contains("large-v3-turbo") {
        return Some("turbo");
    }
    if lower.contains("faster-whisper-large-v3") {
        return Some("large");
    }

    None
}

fn stt_hf_alias_to_model_id(alias_model_id: &str) -> Option<&'static str> {
    let repo_id = alias_model_id.strip_prefix("hf_stt::")?;
    stt_hf_repo_to_model_id(repo_id)
}

async fn fetch_hf_collection_repo_ids(collection_slug: &str) -> Vec<String> {
    if collection_slug.is_empty() {
        return Vec::new();
    }

    {
        let cache = HF_COLLECTION_CACHE
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some((fetched_at, ids)) = cache.get(collection_slug) {
            if fetched_at.elapsed() < HF_COLLECTION_CACHE_TTL {
                return ids.clone();
            }
        }
    }

    let client = match reqwest::Client::builder()
        .timeout(HF_COLLECTION_FETCH_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            log::warn!("Failed to create Hugging Face client: {err}");
            return Vec::new();
        }
    };

    let url = format!("https://huggingface.co/api/collections/{collection_slug}");
    let fetched = match client.get(&url).send().await {
        Ok(response) => match response.error_for_status() {
            Ok(ok) => match ok.json::<HfCollectionInfo>().await {
                Ok(collection) => {
                    let mut repo_ids = Vec::new();
                    let mut seen = std::collections::HashSet::new();
                    for item in collection.items {
                        if !matches!(item.r#type.as_deref(), Some("model") | None) {
                            continue;
                        }
                        let repo_id = item.id.trim();
                        if !repo_id.contains('/') {
                            continue;
                        }
                        if !seen.insert(repo_id.to_string()) {
                            continue;
                        }
                        repo_ids.push(repo_id.to_string());
                        if repo_ids.len() >= HF_COLLECTION_MAX_ITEMS {
                            break;
                        }
                    }
                    repo_ids
                }
                Err(err) => {
                    log::warn!(
                        "Failed to parse Hugging Face collection '{}': {err}",
                        collection_slug
                    );
                    Vec::new()
                }
            },
            Err(err) => {
                log::warn!(
                    "Hugging Face collection '{}' request failed: {err}",
                    collection_slug
                );
                Vec::new()
            }
        },
        Err(err) => {
            log::warn!(
                "Failed to query Hugging Face collection '{}': {err}",
                collection_slug
            );
            Vec::new()
        }
    };

    {
        let mut cache = HF_COLLECTION_CACHE
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        cache.insert(
            collection_slug.to_string(),
            (Instant::now(), fetched.clone()),
        );
    }

    fetched
}

fn stt_collection_slug() -> String {
    normalize_collection_slug(
        &std::env::var(STT_HF_COLLECTION_ENV)
            .unwrap_or_else(|_| STT_HF_COLLECTION_DEFAULT.to_string()),
    )
}

fn tts_collection_slug() -> String {
    normalize_collection_slug(
        &std::env::var(TTS_HF_COLLECTION_ENV)
            .unwrap_or_else(|_| TTS_HF_COLLECTION_DEFAULT.to_string()),
    )
}

fn unsupported_delivery_support() -> TtsDeliverySupport {
    TtsDeliverySupport {
        expressiveness_mode: TtsExpressivenessMode::Unsupported,
        advanced_controls: Vec::new(),
    }
}

fn stt_provider_meta(
    engine_type: &EngineType,
) -> (&'static str, &'static str, &'static str, &'static str) {
    match engine_type {
        EngineType::Whisper => (
            "stt_whisper",
            "OpenAI Whisper",
            "OpenAI Whisper / whisper.cpp assets",
            "Whisper.cpp runtime",
        ),
        EngineType::Parakeet => (
            "stt_parakeet",
            "NVIDIA Parakeet",
            "NVIDIA NeMo / Vox Jot assets",
            "Parakeet runtime",
        ),
        EngineType::Moonshine => (
            "stt_moonshine",
            "Useful Sensors Moonshine",
            "Useful Sensors / Vox Jot assets",
            "Moonshine engine",
        ),
        EngineType::MoonshineStreaming => (
            "stt_moonshine_streaming",
            "Useful Sensors Moonshine Streaming",
            "Useful Sensors / Vox Jot assets",
            "Moonshine streaming engine",
        ),
        EngineType::SenseVoice => (
            "stt_sensevoice",
            "FunAudioLLM SenseVoice",
            "FunAudioLLM / Vox Jot assets",
            "SenseVoice engine",
        ),
        EngineType::GigaAM => (
            "stt_gigaam",
            "Sber GigaAM",
            "Sber / Vox Jot assets",
            "GigaAM engine",
        ),
        EngineType::MlxAudioStt => (
            "stt_mlx_audio",
            "MLX Audio Runtime",
            "mlx-audio",
            "Shared mlx-audio sidecar",
        ),
        EngineType::AppleSpeech | EngineType::AppleSpeechStreaming => (
            "stt_apple_speech",
            "Apple Speech",
            "macOS Speech framework",
            "Apple SpeechAnalyzer",
        ),
    }
}

fn stt_catalog_provider_id(model: &ModelInfo, runtime_provider_id: &'static str) -> &'static str {
    if runtime_provider_id == "stt_mlx_audio" {
        let title = format!("{} {}", model.name, model.id).to_lowercase();
        if title.contains("qwen3-asr") || title.contains("qwen3 asr") || title.contains("qwen3_asr")
        {
            return "stt_qwen";
        }
    }

    runtime_provider_id
}

fn stt_selection_provider_id(
    settings: &AppSettings,
    model_manager: &ModelManager,
) -> Option<String> {
    if !settings.selected_stt_provider_id.trim().is_empty() {
        return Some(settings.selected_stt_provider_id.clone());
    }

    model_manager
        .get_model_info(&settings.selected_model)
        .map(|model| stt_provider_meta(&model.engine_type).0.to_string())
}

fn sync_stt_selection_fields(settings: &mut AppSettings, model_info: &ModelInfo) {
    settings.selected_model = model_info.id.clone();
    settings.selected_stt_model_id = model_info.id.clone();
    settings.selected_stt_provider_id = stt_provider_meta(&model_info.engine_type).0.to_string();
}

async fn build_stt_catalog(model_manager: &ModelManager, settings: &AppSettings) -> DomainCatalog {
    let models = model_manager.get_available_models();
    let model_lookup = models
        .iter()
        .map(|model| (model.id.clone(), model.clone()))
        .collect::<HashMap<_, _>>();
    let selected_provider_id = stt_selection_provider_id(settings, model_manager);
    let selected_model_id = if !settings.selected_stt_model_id.trim().is_empty() {
        Some(settings.selected_stt_model_id.clone())
    } else if !settings.selected_model.trim().is_empty() {
        Some(settings.selected_model.clone())
    } else {
        None
    };

    let provider_order = [
        "stt_mlx_audio",
        "stt_whisper",
        "stt_parakeet",
        "stt_moonshine",
        "stt_moonshine_streaming",
        "stt_apple_speech",
        "stt_sensevoice",
        "stt_gigaam",
        "stt_qwen",
    ];

    let mut providers: Vec<ProviderDescriptor> = provider_order
        .iter()
        .filter_map(|provider_id| {
            let model = models.iter().find(|model| stt_provider_meta(&model.engine_type).0 == *provider_id)?;
            let (provider_id, label, source_label, runtime_label) = stt_provider_meta(&model.engine_type);
            let downloadable = model.url.is_some();
            Some(ProviderDescriptor {
                id: provider_id.to_string(),
                domain: ModelDomain::Stt,
                source_kind: CatalogSourceKind::Builtin,
                label: label.to_string(),
                description: format!("{label} models are downloaded through Vox Jot-managed assets and auto-routed to the correct transcription runtime."),
                source_label: source_label.to_string(),
                runtime: RuntimeRequirement {
                    id: provider_id.to_string(),
                    label: runtime_label.to_string(),
                    engine_family: label.to_lowercase().replace(' ', "_"),
                    auto_routed: true,
                },
                available: true,
                local_only: true,
                coming_soon: false,
                license_label: None,
                capabilities: CapabilityFlags {
                    downloadable,
                    loadable: true,
                    local_only: true,
                    supports_translation: model.supports_translation,
                    supports_streaming: matches!(
                        model.engine_type,
                        EngineType::MoonshineStreaming | EngineType::AppleSpeechStreaming
                    ),
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            })
        })
        .collect();

    let mut catalog_models: Vec<CatalogModelDescriptor> = models
        .into_iter()
        .map(|model| {
            let (provider_id, _, source_label, runtime_label) =
                stt_provider_meta(&model.engine_type);
            let catalog_provider_id = stt_catalog_provider_id(&model, provider_id);
            let catalog_runtime_label =
                if provider_id == "stt_mlx_audio" && catalog_provider_id == "stt_qwen" {
                    "Alibaba Qwen"
                } else {
                    runtime_label
                };
            let available = model_is_available(&model);
            let downloadable = model.url.is_some();
            CatalogModelDescriptor {
                id: model.id.clone(),
                provider_id: catalog_provider_id.to_string(),
                domain: ModelDomain::Stt,
                source_kind: CatalogSourceKind::Builtin,
                label: model.name.clone(),
                description: model.description.clone(),
                installed: available,
                selected: selected_provider_id.as_deref() == Some(provider_id)
                    && selected_model_id.as_deref() == Some(model.id.as_str()),
                active: selected_provider_id.as_deref() == Some(provider_id)
                    && selected_model_id.as_deref() == Some(model.id.as_str())
                    && available,
                runnable: available,
                downloadable,
                source_label: source_label.to_string(),
                runtime: RuntimeRequirement {
                    id: provider_id.to_string(),
                    label: catalog_runtime_label.to_string(),
                    engine_family: provider_id.trim_start_matches("stt_").to_string(),
                    auto_routed: true,
                },
                license_label: None,
                locale: None,
                supported_languages: model.supported_languages.clone(),
                capabilities: CapabilityFlags {
                    downloadable,
                    loadable: true,
                    local_only: true,
                    supports_translation: model.supports_translation,
                    supports_streaming: matches!(
                        model.engine_type,
                        EngineType::MoonshineStreaming | EngineType::AppleSpeechStreaming
                    ),
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
                delivery_support: unsupported_delivery_support(),
                readiness_status: Some(if available {
                    "ready".to_string()
                } else {
                    "missing".to_string()
                }),
                readiness_issues: if available {
                    Vec::new()
                } else {
                    vec![format!(
                        "{} is listed in Vox Jot but not downloaded yet.",
                        model.name
                    )]
                },
            }
        })
        .collect();

    if catalog_models
        .iter()
        .any(|model| model.provider_id == "stt_qwen")
        && !providers.iter().any(|provider| provider.id == "stt_qwen")
    {
        providers.push(ProviderDescriptor {
            id: "stt_qwen".to_string(),
            domain: ModelDomain::Stt,
            source_kind: CatalogSourceKind::Builtin,
            label: "Alibaba Qwen ASR".to_string(),
            description:
                "Qwen speech recognition models served through the shared local transcription runtime."
                    .to_string(),
            source_label: "Alibaba Cloud / Qwen".to_string(),
            runtime: RuntimeRequirement {
                id: "stt_mlx_audio".to_string(),
                label: "Shared mlx-audio sidecar".to_string(),
                engine_family: "qwen_asr".to_string(),
                auto_routed: true,
            },
            available: true,
            local_only: true,
            coming_soon: false,
            license_label: None,
            capabilities: CapabilityFlags {
                downloadable: true,
                loadable: true,
                local_only: true,
                supports_translation: false,
                supports_streaming: false,
                supports_voice_cloning: false,
                supports_instruction_prompt: false,
                supports_inline_tags: false,
                coming_soon: false,
            },
        });
    }

    let stt_collection = fetch_hf_collection_repo_ids(&stt_collection_slug()).await;
    if !stt_collection.is_empty() {
        let alias_models = stt_collection
            .into_iter()
            .filter_map(|repo_id| {
                let mapped_model_id = stt_hf_repo_to_model_id(&repo_id)?;
                let mapped = model_lookup.get(mapped_model_id)?;
                let available = model_is_available(mapped);
                let downloadable = mapped.url.is_some();
                let alias_id = format!("hf_stt::{repo_id}");

                Some(CatalogModelDescriptor {
                    id: alias_id,
                    provider_id: STT_HF_VERIFIED_PROVIDER_ID.to_string(),
                    domain: ModelDomain::Stt,
                    source_kind: CatalogSourceKind::Builtin,
                    label: hf_repo_title(&repo_id),
                    description: format!(
                        "Collection alias mapped to local model '{}'.",
                        mapped.name
                    ),
                    installed: available,
                    selected: selected_model_id.as_deref() == Some(mapped_model_id),
                    active: selected_model_id.as_deref() == Some(mapped_model_id) && available,
                    runnable: available,
                    downloadable,
                    source_label: "Hugging Face collection".to_string(),
                    runtime: RuntimeRequirement {
                        id: STT_HF_VERIFIED_PROVIDER_ID.to_string(),
                        label: "Whisper engine".to_string(),
                        engine_family: "whisper".to_string(),
                        auto_routed: true,
                    },
                    license_label: None,
                    locale: None,
                    supported_languages: mapped.supported_languages.clone(),
                    capabilities: CapabilityFlags {
                        downloadable,
                        loadable: true,
                        local_only: true,
                        supports_translation: mapped.supports_translation,
                        supports_streaming: false,
                        supports_voice_cloning: false,
                        supports_instruction_prompt: false,
                        supports_inline_tags: false,
                        coming_soon: false,
                    },
                    delivery_support: unsupported_delivery_support(),
                    readiness_status: Some(if available {
                        "ready".to_string()
                    } else {
                        "missing".to_string()
                    }),
                    readiness_issues: if available {
                        Vec::new()
                    } else {
                        vec![format!(
                            "{} is available from the mapped local Whisper asset and will download on selection.",
                            mapped.name
                        )]
                    },
                })
            })
            .collect::<Vec<_>>();

        let has_aliases = !alias_models.is_empty();

        if has_aliases {
            providers.push(ProviderDescriptor {
            id: STT_HF_VERIFIED_PROVIDER_ID.to_string(),
            domain: ModelDomain::Stt,
            source_kind: CatalogSourceKind::Builtin,
            label: "Hugging Face STT Verified".to_string(),
            description: "Auto-synced STT aliases from your verified Hugging Face collection, mapped to installable local Whisper assets.".to_string(),
            source_label: "Hugging Face collection".to_string(),
            runtime: RuntimeRequirement {
                id: "stt_hf_verified".to_string(),
                label: "Whisper engine".to_string(),
                engine_family: "huggingface_stt".to_string(),
                auto_routed: true,
            },
            available: true,
            local_only: true,
            coming_soon: false,
            license_label: None,
            capabilities: CapabilityFlags {
                downloadable: true,
                loadable: true,
                local_only: true,
                supports_translation: true,
                supports_streaming: false,
                supports_voice_cloning: false,
                supports_instruction_prompt: false,
                supports_inline_tags: false,
                coming_soon: false,
            },
        });
            catalog_models.extend(alias_models);
        }
    }

    DomainCatalog {
        providers,
        models: catalog_models,
    }
}

fn augment_tts_catalog_with_hf_verified(
    app: &AppHandle,
    tts_catalog: &mut DomainCatalog,
    repo_ids: Vec<String>,
) {
    let native_tts_model_ids = tts_catalog
        .models
        .iter()
        .filter(|model| model.provider_id != TTS_PROVIDER_LOCAL_SIDECAR_API_ID)
        .map(|model| model.id.to_ascii_lowercase())
        .collect::<std::collections::HashSet<_>>();
    let repo_ids = repo_ids
        .into_iter()
        .filter(|repo_id| {
            if tts_model_id_for_hf_repo(repo_id).is_some() {
                return false;
            }

            let repo_id_key = repo_id.to_ascii_lowercase();
            let repo_title_key = hf_repo_title(repo_id).to_ascii_lowercase();
            let sanitized_repo_key = sanitize_hf_repo_id(repo_id).to_ascii_lowercase();

            !native_tts_model_ids.contains(&repo_id_key)
                && !native_tts_model_ids.contains(&repo_title_key)
                && !native_tts_model_ids.contains(&sanitized_repo_key)
        })
        .collect::<Vec<_>>();

    if repo_ids.is_empty() {
        return;
    }

    if !tts_catalog
        .providers
        .iter()
        .any(|provider| provider.id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID)
    {
        tts_catalog.providers.push(ProviderDescriptor {
            id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Runtime,
            label: "Hugging Face TTS Verified".to_string(),
            description: "Auto-synced from your verified Hugging Face TTS collection. Tap Download on a card to pull the repo into Vox Jot's local TTS store.".to_string(),
            source_label: "Hugging Face collection".to_string(),
            runtime: RuntimeRequirement {
                id: "local_sidecar_api".to_string(),
                label: "Local speech API runtime".to_string(),
                engine_family: "sidecar".to_string(),
                auto_routed: true,
            },
            available: true,
            local_only: true,
            coming_soon: false,
            license_label: None,
            capabilities: CapabilityFlags {
                downloadable: true,
                loadable: true,
                local_only: true,
                supports_translation: false,
                supports_streaming: true,
                supports_voice_cloning: true,
                supports_instruction_prompt: true,
                supports_inline_tags: false,
                coming_soon: false,
            },
        });
    }

    let mut seen = tts_catalog
        .models
        .iter()
        .filter(|model| model.provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID)
        .map(|model| model.id.clone())
        .collect::<std::collections::HashSet<_>>();

    for repo_id in repo_ids {
        let model_id = repo_id.clone();
        if !seen.insert(model_id.clone()) {
            continue;
        }

        let lower = repo_id.to_ascii_lowercase();
        let supports_cloning = lower.contains("f5")
            || lower.contains("oute")
            || lower.contains("xtts")
            || lower.contains("voice");
        let supports_instructions = lower.contains("parler") || lower.contains("qwen");

        let installed = tts_hf_repo_is_installed(app, &repo_id);
        let downloadable = !installed;

        tts_catalog.models.push(CatalogModelDescriptor {
            id: model_id,
            provider_id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Runtime,
            label: hf_repo_title(&repo_id),
            description: format!("Verified TTS model from Hugging Face collection ({repo_id})."),
            installed,
            selected: false,
            active: false,
            runnable: installed,
            downloadable,
            source_label: "Hugging Face collection".to_string(),
            runtime: RuntimeRequirement {
                id: "local_sidecar_api".to_string(),
                label: "Local speech API runtime".to_string(),
                engine_family: "sidecar".to_string(),
                auto_routed: true,
            },
            license_label: None,
            locale: None,
            supported_languages: Vec::new(),
            readiness_status: Some(if installed { "ready" } else { "missing" }.to_string()),
            readiness_issues: if installed {
                Vec::new()
            } else {
                vec![format!(
                    "Tap Download to pull {repo_id} into Vox Jot's local TTS store."
                )]
            },
            capabilities: CapabilityFlags {
                downloadable,
                loadable: installed,
                local_only: true,
                supports_translation: false,
                supports_streaming: true,
                supports_voice_cloning: supports_cloning,
                supports_instruction_prompt: supports_instructions,
                supports_inline_tags: false,
                coming_soon: false,
            },
            delivery_support: unsupported_delivery_support(),
        });
    }
}

// --- HF TTS download path -----------------------------------------------

#[derive(Debug, Deserialize)]
struct HfRepoSibling {
    rfilename: String,
}

#[derive(Debug, Deserialize)]
struct HfRepoInfo {
    #[serde(default)]
    siblings: Vec<HfRepoSibling>,
}

fn hf_tts_filter_file(name: &str) -> bool {
    !name.starts_with('.')
        && !name.contains("/.cache/")
        && !name.starts_with(".cache/")
        && !name.contains("/.git/")
        && !name.starts_with(".git/")
}

async fn fetch_hf_repo_files(repo_id: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let url = format!("https://huggingface.co/api/models/{repo_id}");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("Failed to query {repo_id}: {err}"))?;
    if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        return Err(format!(
            "{repo_id} is private on Hugging Face. Publish the mirror before downloading."
        ));
    }
    if resp.status().as_u16() == 404 {
        return Err(format!("{repo_id} was not found on Hugging Face."));
    }
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to fetch repo info for {repo_id}: HTTP {}",
            resp.status()
        ));
    }
    let info: HfRepoInfo = resp
        .json()
        .await
        .map_err(|err| format!("Failed to decode repo info for {repo_id}: {err}"))?;
    let files: Vec<String> = info
        .siblings
        .into_iter()
        .map(|s| s.rfilename)
        .filter(|name| hf_tts_filter_file(name))
        .collect();
    if files.is_empty() {
        return Err(format!("No downloadable files in {repo_id}."));
    }
    Ok(files)
}

fn emit_tts_download_progress(
    app: &AppHandle,
    repo_id: &str,
    stage: &str,
    file: Option<&str>,
    file_index: Option<usize>,
    file_count: Option<usize>,
    error: Option<&str>,
) {
    let payload = serde_json::json!({
        "repo_id": repo_id,
        "stage": stage,
        "file": file,
        "file_index": file_index,
        "file_count": file_count,
        "error": error,
    });
    let _ = app.emit("tts-hf-download-progress", payload);
}

pub async fn download_hf_tts_repo_impl(
    app: &AppHandle,
    repo_id: &str,
) -> Result<std::path::PathBuf, String> {
    use tokio::fs as tokio_fs;
    use tokio::io::AsyncWriteExt;

    if !repo_id.contains('/') {
        return Err(format!("Invalid HF repo id '{}'", repo_id));
    }

    let install_dir = tts_hf_install_dir(app, repo_id)
        .ok_or_else(|| "Failed to resolve TTS HF install directory.".to_string())?;
    let staging_dir =
        install_dir.with_file_name(format!(".staging-{}", sanitize_hf_repo_id(repo_id)));

    if staging_dir.exists() {
        let _ = tokio_fs::remove_dir_all(&staging_dir).await;
    }
    tokio_fs::create_dir_all(&staging_dir)
        .await
        .map_err(|err| format!("Failed to create staging dir: {err}"))?;

    emit_tts_download_progress(app, repo_id, "preparing", None, None, None, None);

    let files = match fetch_hf_repo_files(repo_id).await {
        Ok(files) => files,
        Err(err) => {
            let _ = tokio_fs::remove_dir_all(&staging_dir).await;
            emit_tts_download_progress(app, repo_id, "failed", None, None, None, Some(&err));
            return Err(err);
        }
    };
    let file_count = files.len();
    emit_tts_download_progress(
        app,
        repo_id,
        "downloading",
        None,
        Some(0),
        Some(file_count),
        None,
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    for (idx, rel) in files.iter().enumerate() {
        let encoded = rel
            .split('/')
            .map(|seg| seg.replace(' ', "%20"))
            .collect::<Vec<_>>()
            .join("/");
        let url = format!("https://huggingface.co/{repo_id}/resolve/main/{encoded}");
        let target = staging_dir.join(rel);
        if let Some(parent) = target.parent() {
            if let Err(err) = tokio_fs::create_dir_all(parent).await {
                let _ = tokio_fs::remove_dir_all(&staging_dir).await;
                let msg = format!("Failed to create {}: {err}", parent.display());
                emit_tts_download_progress(
                    app,
                    repo_id,
                    "failed",
                    Some(rel),
                    None,
                    None,
                    Some(&msg),
                );
                return Err(msg);
            }
        }

        let response = match client.get(&url).send().await {
            Ok(r) => r,
            Err(err) => {
                let _ = tokio_fs::remove_dir_all(&staging_dir).await;
                let msg = format!("Failed to fetch {rel}: {err}");
                emit_tts_download_progress(
                    app,
                    repo_id,
                    "failed",
                    Some(rel),
                    None,
                    None,
                    Some(&msg),
                );
                return Err(msg);
            }
        };
        if !response.status().is_success() {
            let _ = tokio_fs::remove_dir_all(&staging_dir).await;
            let msg = format!("Failed to download {rel}: HTTP {}", response.status());
            emit_tts_download_progress(app, repo_id, "failed", Some(rel), None, None, Some(&msg));
            return Err(msg);
        }

        let mut file = match tokio_fs::File::create(&target).await {
            Ok(f) => f,
            Err(err) => {
                let _ = tokio_fs::remove_dir_all(&staging_dir).await;
                let msg = format!("Failed to open {}: {err}", target.display());
                emit_tts_download_progress(
                    app,
                    repo_id,
                    "failed",
                    Some(rel),
                    None,
                    None,
                    Some(&msg),
                );
                return Err(msg);
            }
        };

        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(err) => {
                    let _ = tokio_fs::remove_dir_all(&staging_dir).await;
                    let msg = format!("Stream failed for {rel}: {err}");
                    emit_tts_download_progress(
                        app,
                        repo_id,
                        "failed",
                        Some(rel),
                        None,
                        None,
                        Some(&msg),
                    );
                    return Err(msg);
                }
            };
            if let Err(err) = file.write_all(&chunk).await {
                let _ = tokio_fs::remove_dir_all(&staging_dir).await;
                let msg = format!("Failed to write {rel}: {err}");
                emit_tts_download_progress(
                    app,
                    repo_id,
                    "failed",
                    Some(rel),
                    None,
                    None,
                    Some(&msg),
                );
                return Err(msg);
            }
        }
        let _ = file.flush().await;
        emit_tts_download_progress(
            app,
            repo_id,
            "downloading",
            Some(rel),
            Some(idx + 1),
            Some(file_count),
            None,
        );
    }

    if install_dir.exists() {
        let _ = tokio_fs::remove_dir_all(&install_dir).await;
    }
    if let Some(parent) = install_dir.parent() {
        let _ = tokio_fs::create_dir_all(parent).await;
    }
    tokio_fs::rename(&staging_dir, &install_dir)
        .await
        .map_err(|err| {
            let msg = format!(
                "Failed to move staging into place ({} -> {}): {err}",
                staging_dir.display(),
                install_dir.display()
            );
            let _ = std::fs::remove_dir_all(&staging_dir);
            msg
        })?;

    emit_tts_download_progress(
        app,
        repo_id,
        "complete",
        None,
        Some(file_count),
        Some(file_count),
        None,
    );
    Ok(install_dir)
}

#[tauri::command]
#[specta::specta]
pub async fn download_tts_hf_model(app_handle: AppHandle, repo_id: String) -> Result<(), String> {
    download_hf_tts_repo_impl(&app_handle, &repo_id).await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_tts_hf_model(app_handle: AppHandle, repo_id: String) -> Result<(), String> {
    let dir = tts_hf_install_dir(&app_handle, &repo_id)
        .ok_or_else(|| "Failed to resolve TTS HF install dir.".to_string())?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|err| format!("Failed to remove '{}': {err}", dir.display()))?;
    }
    Ok(())
}

fn build_llm_catalog(settings: &AppSettings) -> DomainCatalog {
    let selected_provider_id = if !settings.selected_llm_provider_id.trim().is_empty() {
        settings.selected_llm_provider_id.clone()
    } else {
        settings.post_process_provider_id.clone()
    };
    let selected_model_id = if !settings.selected_llm_model_id.trim().is_empty() {
        settings.selected_llm_model_id.clone()
    } else {
        settings
            .post_process_models
            .get(&selected_provider_id)
            .cloned()
            .unwrap_or_default()
    };

    let providers = settings
        .post_process_providers
        .iter()
        .map(|provider| ProviderDescriptor {
            id: provider.id.clone(),
            domain: ModelDomain::Llm,
            source_kind: CatalogSourceKind::Builtin,
            label: provider.label.clone(),
            description: "Configured local or API-backed LLM provider used by Vox Jot for language cleanup and related workflows.".to_string(),
            source_label: if provider.base_url.trim().is_empty() {
                "Managed provider".to_string()
            } else {
                provider.base_url.clone()
            },
            runtime: RuntimeRequirement {
                id: provider.id.clone(),
                label: format!("{} runtime", provider.label),
                engine_family: provider.id.clone(),
                auto_routed: true,
            },
            available: true,
            local_only: crate::settings::post_process_provider_is_local(provider),
            coming_soon: false,
            license_label: None,
            capabilities: CapabilityFlags {
                downloadable: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                loadable: true,
                local_only: crate::settings::post_process_provider_is_local(provider),
                supports_translation: true,
                supports_streaming: false,
                supports_voice_cloning: false,
                supports_instruction_prompt: true,
                supports_inline_tags: false,
                coming_soon: false,
            },
        })
        .collect();

    let models = settings
        .post_process_providers
        .iter()
        .map(|provider| {
            let model_id = settings
                .post_process_models
                .get(&provider.id)
                .cloned()
                .unwrap_or_default();
            CatalogModelDescriptor {
                id: format!("{}::{}", provider.id, model_id),
                provider_id: provider.id.clone(),
                domain: ModelDomain::Llm,
                source_kind: CatalogSourceKind::Builtin,
                label: if model_id.is_empty() {
                    format!("{} Default", provider.label)
                } else {
                    model_id.clone()
                },
                description: "Current default model for this provider.".to_string(),
                installed: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                selected: selected_provider_id == provider.id && selected_model_id == model_id,
                active: selected_provider_id == provider.id && selected_model_id == model_id,
                runnable: true,
                downloadable: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                source_label: if provider.base_url.trim().is_empty() {
                    "Managed provider".to_string()
                } else {
                    provider.base_url.clone()
                },
                runtime: RuntimeRequirement {
                    id: provider.id.clone(),
                    label: format!("{} runtime", provider.label),
                    engine_family: provider.id.clone(),
                    auto_routed: true,
                },
                license_label: None,
                locale: None,
                supported_languages: Vec::new(),
                capabilities: CapabilityFlags {
                    downloadable: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                    loadable: true,
                    local_only: crate::settings::post_process_provider_is_local(provider),
                    supports_translation: true,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: true,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
                delivery_support: unsupported_delivery_support(),
                readiness_status: Some("ready".to_string()),
                readiness_issues: Vec::new(),
            }
        })
        .collect();

    DomainCatalog { providers, models }
}

fn tts_model_supports_voice_profile(model: &CatalogModelDescriptor) -> bool {
    model.capabilities.supports_voice_cloning
        && model.runnable
        && (model.source_kind == CatalogSourceKind::Runtime
            || (model.provider_id == TTS_PROVIDER_QWEN3_NATIVE_ID && model.id == "qwen3-0.6b-base"))
}

#[tauri::command]
#[specta::specta]
pub async fn get_available_models(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<Vec<ModelInfo>, String> {
    Ok(model_manager.get_available_models())
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_info(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<Option<ModelInfo>, String> {
    Ok(model_manager.get_model_info(&model_id))
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_platform_overview(
    app_handle: AppHandle,
) -> Result<ModelPlatformOverview, String> {
    let settings = get_settings(&app_handle);
    let model_manager = app_handle.state::<Arc<ModelManager>>();
    let tts_manager = app_handle.state::<Arc<TtsManager>>();

    let tts_collection_slug = tts_collection_slug();
    let (tts_collection_ids, mut tts_catalog) = tokio::join!(
        fetch_hf_collection_repo_ids(&tts_collection_slug),
        tts_manager.domain_catalog(&settings)
    );

    augment_tts_catalog_with_hf_verified(&app_handle, &mut tts_catalog, tts_collection_ids);

    let active_tts_model = tts_catalog
        .models
        .iter()
        .find(|model| model.active)
        .cloned();

    Ok(ModelPlatformOverview {
        stt: build_stt_catalog(&model_manager, &settings).await,
        llm: build_llm_catalog(&settings),
        tts: tts_catalog,
        selection: ModelPlatformSelectionState {
            selected_stt_provider_id: stt_selection_provider_id(&settings, &model_manager),
            selected_stt_model_id: (!settings.selected_stt_model_id.trim().is_empty())
                .then_some(settings.selected_stt_model_id.clone())
                .or_else(|| {
                    (!settings.selected_model.trim().is_empty())
                        .then_some(settings.selected_model.clone())
                }),
            selected_llm_provider_id: (!settings.selected_llm_provider_id.trim().is_empty())
                .then_some(settings.selected_llm_provider_id.clone())
                .or_else(|| {
                    (!settings.post_process_provider_id.trim().is_empty())
                        .then_some(settings.post_process_provider_id.clone())
                }),
            selected_llm_model_id: (!settings.selected_llm_model_id.trim().is_empty())
                .then_some(settings.selected_llm_model_id.clone()),
            selected_tts_provider_id: Some(tts_manager.selected_provider_id(&settings)),
            selected_tts_model_id: tts_manager.selected_model_id(&settings),
            selected_tts_voice_id: settings
                .selected_tts_voice_id
                .clone()
                .or_else(|| settings.tts_default_voice_id.clone()),
            selected_tts_profile_id: settings.selected_tts_profile_id.clone(),
            active_tts_provider_id: active_tts_model
                .as_ref()
                .map(|model| model.provider_id.clone()),
            active_tts_model_id: active_tts_model.as_ref().map(|model| model.id.clone()),
        },
    })
}

#[tauri::command]
#[specta::specta]
pub async fn download_model(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    model_manager
        .download_model(&model_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    let settings = get_settings(&app_handle);
    if settings.selected_model == model_id {
        transcription_manager
            .unload_model()
            .map_err(|e| format!("Failed to unload model: {}", e))?;

        let mut settings = get_settings(&app_handle);
        settings.selected_model = String::new();
        settings.selected_stt_model_id = String::new();
        settings.selected_stt_provider_id = String::new();
        write_settings(&app_handle, settings);
    }

    model_manager
        .delete_model(&model_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn set_stt_platform_selection(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    let resolved_model_id = if provider_id == STT_HF_VERIFIED_PROVIDER_ID {
        stt_hf_alias_to_model_id(&model_id)
            .map(str::to_string)
            .ok_or_else(|| format!("Unsupported STT collection model: {}", model_id))?
    } else {
        model_id.clone()
    };

    let mut model_info = model_manager
        .get_model_info(&resolved_model_id)
        .ok_or_else(|| format!("Model not found: {}", resolved_model_id))?;

    let expected_provider_id = stt_provider_meta(&model_info.engine_type).0;
    let catalog_provider_id = stt_catalog_provider_id(&model_info, expected_provider_id);
    if provider_id != expected_provider_id
        && provider_id != catalog_provider_id
        && provider_id != STT_HF_VERIFIED_PROVIDER_ID
    {
        return Err(format!(
            "Model '{}' belongs to provider '{}' rather than '{}'",
            resolved_model_id, expected_provider_id, provider_id
        ));
    }

    if !model_is_available(&model_info) && model_info.url.is_some() {
        model_manager
            .download_model(&resolved_model_id)
            .await
            .map_err(|err| format!("Failed to download model '{}': {err}", resolved_model_id))?;
        model_info = model_manager
            .get_model_info(&resolved_model_id)
            .ok_or_else(|| format!("Model not found after download: {}", resolved_model_id))?;
    }

    if !model_is_available(&model_info) {
        return Err(format!("Model not downloaded: {}", resolved_model_id));
    }

    transcription_manager
        .load_model(&resolved_model_id)
        .map_err(|e| e.to_string())?;

    let mut settings = get_settings(&app_handle);
    sync_stt_selection_fields(&mut settings, &model_info);
    write_settings(&app_handle, settings);
    app_handle
        .emit("active-model-changed", resolved_model_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_active_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    let model_info = model_manager
        .get_model_info(&model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    if !model_is_available(&model_info) {
        return Err(format!("Model not downloaded: {}", model_id));
    }

    transcription_manager
        .load_model(&model_id)
        .map_err(|e| e.to_string())?;

    let mut settings = get_settings(&app_handle);
    sync_stt_selection_fields(&mut settings, &model_info);
    write_settings(&app_handle, settings);
    app_handle
        .emit("active-model-changed", model_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_tts_platform_selection(
    app_handle: AppHandle,
    provider_id: String,
    model_id: Option<String>,
) -> Result<(), String> {
    let settings = get_settings(&app_handle);
    let tts_manager = app_handle.state::<Arc<TtsManager>>();
    let tts_collection_slug = tts_collection_slug();
    let (tts_collection_ids, mut catalog) = tokio::join!(
        fetch_hf_collection_repo_ids(&tts_collection_slug),
        tts_manager.domain_catalog(&settings)
    );
    augment_tts_catalog_with_hf_verified(&app_handle, &mut catalog, tts_collection_ids);

    let mut provider_id = provider_id;
    let mut model_id = model_id;
    if provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID {
        if let Some(requested_model_id) = model_id.as_deref() {
            let canonical_model_id = tts_model_id_for_hf_repo(requested_model_id)
                .map(str::to_string)
                .or_else(|| {
                    catalog
                        .models
                        .iter()
                        .find(|model| {
                            model.provider_id != TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                                && model.id.eq_ignore_ascii_case(requested_model_id)
                        })
                        .map(|model| model.id.clone())
                });

            if let Some(canonical_model_id) = canonical_model_id {
                if let Some(native_model) = catalog.models.iter().find(|model| {
                    model.provider_id != TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                        && model.id == canonical_model_id
                }) {
                    provider_id = native_model.provider_id.clone();
                    model_id = Some(native_model.id.clone());
                }
            }
        }
    }

    let provider = catalog
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| format!("Unknown TTS provider '{}'", provider_id))?;

    if provider.coming_soon || !provider.available {
        return Err(format!(
            "TTS provider '{}' is not available in this build",
            provider.label
        ));
    }

    let resolved_model_id = model_id.or_else(|| {
        catalog
            .models
            .iter()
            .find(|model| model.provider_id == provider_id)
            .map(|model| model.id.clone())
    });

    let Some(resolved_model_id) = resolved_model_id else {
        return Err(format!(
            "No selectable models are available for '{}'",
            provider.label
        ));
    };

    let model = catalog
        .models
        .iter()
        .find(|model| model.provider_id == provider_id && model.id == resolved_model_id)
        .ok_or_else(|| format!("Unknown TTS model '{}'", resolved_model_id))?;

    if model.capabilities.coming_soon {
        return Err(format!(
            "TTS model '{}' is not available in this build",
            model.label
        ));
    }
    if !model.installed && model.downloadable {
        if model.provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID {
            download_hf_tts_repo_impl(&app_handle, &resolved_model_id).await?;
        } else {
            tts_manager.download_pack(&resolved_model_id).await?;
        }
    }

    let mut settings = get_settings(&app_handle);
    settings.tts_engine_preference = match provider_id.as_str() {
        TTS_PROVIDER_SYSTEM_BUILTIN_ID => crate::settings::TtsEnginePreference::System,
        TTS_PROVIDER_SHERPA_PACK_ID => crate::settings::TtsEnginePreference::SherpaOnnx,
        TTS_PROVIDER_LOCAL_SIDECAR_API_ID
        | TTS_PROVIDER_OPENVOICE_ID
        | TTS_PROVIDER_CHATTERBOX_ID
        | TTS_PROVIDER_KOKORO_ID
        | TTS_PROVIDER_SUPERTONIC_ID
        | TTS_PROVIDER_XTTS_ID => crate::settings::TtsEnginePreference::Sidecar,
        _ => {
            if model.source_kind == CatalogSourceKind::Runtime {
                crate::settings::TtsEnginePreference::Sidecar
            } else {
                settings.tts_engine_preference
            }
        }
    };

    let next_profile_id = if tts_model_supports_voice_profile(model) {
        settings
            .active_tts_preset()
            .and_then(|preset| preset.voice_profile_id.clone())
            .or_else(|| settings.selected_tts_profile_id.clone())
    } else {
        None
    };

    if let Some(active_preset) = settings.active_tts_preset_mut() {
        let previous_provider_id = active_preset.provider_id.clone();
        active_preset.provider_id = provider_id.clone();
        active_preset.model_id = resolved_model_id.clone();
        match provider_id.as_str() {
            TTS_PROVIDER_SHERPA_PACK_ID | TTS_PROVIDER_QWEN3_NATIVE_ID => {
                active_preset.voice_id = Some(resolved_model_id.clone());
                active_preset.voice_label_snapshot = Some(model.label.clone());
            }
            TTS_PROVIDER_SYSTEM_BUILTIN_ID => {}
            _ => {
                // Clear stale voice_id when switching between providers so a
                // voice identifier from one engine isn't misinterpreted by
                // another (e.g. a Qwen3 model ID treated as a Kokoro voice).
                if previous_provider_id != provider_id {
                    active_preset.voice_id = None;
                }
                if active_preset.voice_profile_id.is_none() {
                    active_preset.voice_label_snapshot = active_preset
                        .voice_label_snapshot
                        .clone()
                        .or_else(|| active_preset.voice_id.clone());
                }
            }
        }
        active_preset.voice_profile_id = next_profile_id.clone();
    }

    settings.set_active_tts_preset_id(settings.tts_active_preset_id.clone());
    settings.sync_legacy_tts_state_from_active_preset();

    if model.source_kind == CatalogSourceKind::Runtime {
        tts_manager
            .sync_runtime_selection(
                &provider_id,
                &resolved_model_id,
                settings.selected_tts_profile_id.as_deref(),
            )
            .await?;
    }

    write_settings(&app_handle, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_current_model(app_handle: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app_handle);
    Ok(settings.selected_model)
}

#[tauri::command]
#[specta::specta]
pub async fn get_transcription_model_status(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<Option<String>, String> {
    Ok(transcription_manager.get_current_model())
}

#[tauri::command]
#[specta::specta]
pub async fn is_model_loading(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<bool, String> {
    let current_model = transcription_manager.get_current_model();
    Ok(current_model.is_none())
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_available(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    Ok(models.iter().any(model_is_available))
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_or_downloads(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    Ok(models.iter().any(model_is_available))
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_download(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    model_manager
        .cancel_download(&model_id)
        .map_err(|e| e.to_string())
}
