use crate::model_platform::{
    CapabilityFlags, CatalogModelDescriptor, CatalogSourceKind, DomainCatalog, ModelDomain,
    ProviderDescriptor, RuntimeRequirement, TtsAdvancedControlDescriptor, TtsAdvancedControlKind,
    TtsControlGroup, TtsDeliverySupport, TtsExpressivenessMode,
};
use crate::portable;
use crate::settings::{
    default_tts_model_store_dir, get_settings, is_local_base_url, write_settings, AppSettings,
    TtsEnginePreference, TtsStyleControlValue, TtsVoicePreset, TtsVoiceTuningSettings,
    TTS_MODEL_LFM_AUDIO_GGUF_DEFAULT_ID, TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID,
    TTS_MODEL_SYSTEM_DEFAULT_ID, TTS_MODEL_VIBEVOICE_DEFAULT_ID, TTS_PROVIDER_CHATTERBOX_ID,
    TTS_PROVIDER_KOKORO_ID, TTS_PROVIDER_LFM_AUDIO_GGUF_ID, TTS_PROVIDER_LOCAL_SIDECAR_API_ID,
    TTS_PROVIDER_MLX_BARK_ID, TTS_PROVIDER_MLX_CHATTERBOX_ID, TTS_PROVIDER_MLX_DIA_ID,
    TTS_PROVIDER_MLX_FISH_AUDIO_ID, TTS_PROVIDER_MLX_HIGGS_AUDIO_ID, TTS_PROVIDER_MLX_INDEXTTS_ID,
    TTS_PROVIDER_MLX_IRODORI_TTS_ID, TTS_PROVIDER_MLX_KOKORO_ID, TTS_PROVIDER_MLX_KUGEL_ID,
    TTS_PROVIDER_MLX_LFM_AUDIO_ID, TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID,
    TTS_PROVIDER_MLX_MELOTTS_ID, TTS_PROVIDER_MLX_MING_OMNI_ID, TTS_PROVIDER_MLX_MOSS_TTS_ID,
    TTS_PROVIDER_MLX_OMNIVOICE_ID, TTS_PROVIDER_MLX_POCKET_TTS_ID, TTS_PROVIDER_MLX_QWEN3TTS_ID,
    TTS_PROVIDER_MLX_SOPRANO_ID, TTS_PROVIDER_MLX_SPARK_ID, TTS_PROVIDER_MLX_VIBEVOICE_ID,
    TTS_PROVIDER_MLX_VOXCPM_ID, TTS_PROVIDER_MLX_VOXTRAL_TTS_ID, TTS_PROVIDER_OPENVOICE_ID,
    TTS_PROVIDER_QWEN3_NATIVE_ID, TTS_PROVIDER_SHERPA_PACK_ID, TTS_PROVIDER_SUPERTONIC_ID,
    TTS_PROVIDER_SYSTEM_BUILTIN_ID, TTS_PROVIDER_VIBEVOICE_ID, TTS_PROVIDER_XTTS_ID,
};
use crate::sidecar::SidecarBackend;
use crate::tts_profiles;
use futures_util::StreamExt;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

mod catalog;
mod chunking;
mod migration;
mod readback;
mod runtime;
mod sidecar;
mod voices;

#[cfg(test)]
mod tests;

pub(crate) use catalog::{
    retired_tts_model_ids, supported_voice_profile_compatibility, tts_model_id_for_hf_repo,
};
pub use chunking::{chunk_text, normalize_locale};
pub use readback::{build_auto_speak_plan, choose_readback_locale, default_preview_request};

use catalog::{
    ensure_mlx_audio_definition_available, first_mlx_audio_model_for_provider,
    mlx_audio_definition_available, mlx_audio_model_supports_inline_tags,
    mlx_audio_runtime_supported, mlx_audio_tts_model_definition, provider_is_mlx_audio,
    provider_uses_managed_speech_runtime, ManagedRuntimeModelDefinition,
    MlxAudioTtsModelDefinition, PackDefinition, Qwen3PackDefinition, Qwen3PackFeatures,
    RuntimeListenCapabilities, RuntimeListenCatalogResponse, RuntimeListenModelCatalogEntry,
    RuntimeListenProviderCatalogEntry, RuntimeListenProviderDefinition, RuntimeListenReadiness,
    RuntimeListenState, RuntimeListenVoiceEntry, RuntimeStyleControl, SherpaPackManifest,
    MANAGED_RUNTIME_MODEL_DEFINITIONS, MLX_AUDIO_TTS_MODEL_DEFINITIONS, PACK_DEFINITIONS,
    QWEN3_PACK_DEFINITIONS,
};
use chunking::{locale_language, locale_matches};
use migration::{legacy_dev_tts_store_dir, migrate_legacy_tts_model_layout};
use readback::{is_preview_trigger, LastOutput};
use runtime::{
    copy_directory_recursive, current_runtime_platform_id, ensure_profile_supports_qwen3_base,
    extract_archive, managed_speech_runtime_definition, managed_speech_runtime_entrypoint,
    mlx_audio_language_for_locale, qwen3_language_for_locale, qwen3_runtime_binary_path,
    qwen3_runtime_definition, resolve_extracted_root, sherpa_runtime_binary_path,
    sherpa_runtime_definition, speak_lfm_audio_gguf_chunk, speak_mlx_audio_chunk,
    speak_qwen3_chunk, speak_sherpa_chunk, speak_system_chunk, speak_vibevoice_chunk,
    synthesize_lfm_audio_gguf_chunk, synthesize_mlx_audio_chunk, synthesize_qwen3_chunk,
    synthesize_sherpa_chunk, synthesize_system_chunk, synthesize_vibevoice_chunk,
    ManagedSpeechRuntimeDefinition, MlxAudioCloneProfile, MlxAudioContext, Qwen3CloneProfile,
    Qwen3Context, SherpaContext,
};
use sidecar::{
    sidecar_error_detail, sidecar_request_url_from_base, sidecar_runtime_target,
    speak_sidecar_chunk, synthesize_sidecar_chunk, DEFAULT_SIDECAR_URL,
};
#[cfg(target_os = "macos")]
use voices::macos_system_voices;
#[cfg(target_os = "windows")]
use voices::windows_system_voices;
use voices::{
    is_valid_mlx_voice_id, mlx_voice_label, mlx_voice_locale, mlx_voice_locale_for_provider,
};

const PACK_MANIFEST_NAME: &str = "vox_jot_tts_manifest.json";
const DEFAULT_TTS_ASSET_BASE_URL: &str =
    "https://github.com/KimaniDJ11/Vox-Jot/releases/download/v0.3.0-tts-models";
const HIDDEN_RUNTIME_MODEL_IDS: &[&str] = &[];
const LFM_AUDIO_GGUF_HF_REPO_ID: &str = "IrieDinamik/LiquidAI-LFM2.5-Audio-1.5B-GGUF";
const LFM_AUDIO_GGUF_HF_FILES: &[(&str, &str)] = &[
    ("LFM2.5-Audio-1.5B-Q4_0.gguf", "LFM2.5-Audio-1.5B-Q4_0.gguf"),
    (
        "mmproj-LFM2.5-Audio-1.5B-Q4_0.gguf",
        "mmproj-LFM2.5-Audio-1.5B-Q4_0.gguf",
    ),
    (
        "vocoder-LFM2.5-Audio-1.5B-Q4_0.gguf",
        "vocoder-LFM2.5-Audio-1.5B-Q4_0.gguf",
    ),
    (
        "tokenizer-LFM2.5-Audio-1.5B-Q4_0.gguf",
        "tokenizer-LFM2.5-Audio-1.5B-Q4_0.gguf",
    ),
    (
        "runners/llama-liquid-audio-macos-arm64.zip",
        "llama-liquid-audio-macos-arm64.zip",
    ),
];
const VIBEVOICE_HF_REPO_ID: &str = "IrieDinamik/microsoft-VibeVoice-Realtime-0.5B";
const VIBEVOICE_HF_FILES: &[(&str, &str)] = &[
    ("config.json", "config.json"),
    ("model.safetensors", "model.safetensors"),
    ("preprocessor_config.json", "preprocessor_config.json"),
];

fn hf_get(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    let request = client.get(url);
    if let Some(token) = crate::speech_analysis::hugging_face_token_for_runtime() {
        request.bearer_auth(token)
    } else {
        request
    }
}

fn hf_access_error(repo_id: &str) -> String {
    format!(
        "{repo_id} requires Hugging Face access. Open https://huggingface.co/{repo_id}, accept the model terms, save a Hugging Face read token in Vox Jot, then download again."
    )
}

fn managed_speech_runtime_is_current(root: &Path) -> bool {
    if managed_speech_runtime_entrypoint(root).is_none() {
        return false;
    }

    let config_path = root.join("runtime").join("config.py");
    let config_path = if config_path.exists() {
        config_path
    } else {
        root.join("config.py")
    };
    let Ok(config) = fs::read_to_string(&config_path) else {
        return false;
    };

    let missing_model_ids: Vec<_> = MANAGED_RUNTIME_MODEL_DEFINITIONS
        .iter()
        .filter(|definition| !config.contains(definition.model_id))
        .map(|definition| definition.model_id)
        .collect();
    if !missing_model_ids.is_empty() {
        warn!(
            "Installed Speech runtime is missing managed model support: {}",
            missing_model_ids.join(", ")
        );
        return false;
    }

    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsEngineKind {
    System,
    SherpaOnnx,
    Sidecar,
    MlxNative,
    Qwen3Native,
    LfmAudioGguf,
    VibeVoice,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceInfo {
    pub id: String,
    pub label: String,
    pub locale: Option<String>,
    pub engine: TtsEngineKind,
    pub installed: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TtsPackInfo {
    pub id: String,
    pub label: String,
    pub locale: String,
    pub voice_id: String,
    pub archive_name: String,
    pub source_url: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeakRequest {
    pub text: String,
    pub locale: Option<String>,
    pub preferred_voice_id: Option<String>,
    pub preset_id: Option<String>,
    pub inline_preset: Option<TtsVoicePreset>,
    pub trigger: Option<String>,
    pub remember_last_output: bool,
}

#[derive(Debug, Clone, Default)]
pub struct TtsHistoryContext {
    pub tts_requested: Option<bool>,
    pub tts_engine: Option<String>,
    pub tts_voice_id: Option<String>,
    pub tts_locale: Option<String>,
    pub tts_trigger: Option<String>,
    pub tts_status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TtsAutoSpeakPlan {
    pub should_speak: bool,
    pub text: String,
    pub locale: Option<String>,
    pub trigger: String,
    pub tts_requested: bool,
    pub tts_engine: Option<String>,
    pub tts_voice_id: Option<String>,
    pub tts_locale: Option<String>,
    pub tts_status: Option<String>,
}

pub struct TtsManager {
    app_handle: AppHandle,
    current_stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    last_output: Mutex<Option<LastOutput>>,
    cached_system_voices: Mutex<Option<Vec<VoiceInfo>>>,
    active_model_uses: Arc<Mutex<HashMap<String, usize>>>,
}

pub(crate) struct TtsModelUseGuard {
    active_model_uses: Arc<Mutex<HashMap<String, usize>>>,
    model_id: Option<String>,
}

impl Drop for TtsModelUseGuard {
    fn drop(&mut self) {
        let Some(model_id) = self.model_id.as_deref() else {
            return;
        };
        let mut active = self
            .active_model_uses
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let Some(count) = active.get_mut(model_id) else {
            return;
        };
        *count = count.saturating_sub(1);
        if *count == 0 {
            active.remove(model_id);
        }
    }
}

impl TtsManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        let manager = Self {
            app_handle: app_handle.clone(),
            current_stop_flag: Mutex::new(None),
            last_output: Mutex::new(None),
            cached_system_voices: Mutex::new(None),
            active_model_uses: Arc::new(Mutex::new(HashMap::new())),
        };

        if let Err(err) = migrate_legacy_tts_model_layout(app_handle) {
            warn!("Failed to migrate legacy TTS assets: {err}");
        }

        manager
    }

    pub(crate) fn track_model_use(&self, model_id: Option<&str>) -> TtsModelUseGuard {
        let model_id = model_id
            .map(str::trim)
            .filter(|model_id| !model_id.is_empty())
            .map(ToOwned::to_owned);
        if let Some(model_id) = model_id.as_deref() {
            let mut active = self
                .active_model_uses
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            *active.entry(model_id.to_string()).or_insert(0) += 1;
        }
        TtsModelUseGuard {
            active_model_uses: Arc::clone(&self.active_model_uses),
            model_id,
        }
    }

    fn model_in_use(&self, model_id: &str) -> bool {
        let active = self
            .active_model_uses
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        active.get(model_id).copied().unwrap_or(0) > 0
    }

    fn ensure_pack_not_in_use_for_delete(&self, pack_id: &str) -> Result<(), String> {
        if self.model_in_use(pack_id) {
            return Err(format!(
                "The speech model '{pack_id}' is currently being used. Try deleting it again after playback, rendering, or voice conversion finishes."
            ));
        }
        let settings = get_settings(&self.app_handle);
        if crate::commands::story_studio::active_story_render_references_tts_model(
            &settings, pack_id,
        ) {
            return Err(format!(
                "The speech model '{pack_id}' is referenced by a queued or running Studio render. Cancel or wait for the render before deleting it."
            ));
        }
        Ok(())
    }

    fn qwen3_pack_features(&self, definition: &Qwen3PackDefinition) -> Qwen3PackFeatures {
        match definition.id {
            "qwen3-0.6b-base" => Qwen3PackFeatures {
                description: "Voice cloning from reference audio.",
                supports_voice_cloning: true,
                supports_instruction_prompt: false,
            },
            _ => Qwen3PackFeatures {
                description: "Qwen3 Native text-to-speech engine model.",
                supports_voice_cloning: false,
                supports_instruction_prompt: false,
            },
        }
    }

    fn qwen3_pack_archive_name(&self, definition: &Qwen3PackDefinition) -> String {
        format!("{}.tar.gz", definition.id)
    }

    fn tts_model_store_root(&self) -> PathBuf {
        let configured = get_settings(&self.app_handle)
            .tts_model_store_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);

        if let Some(path) = configured {
            if legacy_dev_tts_store_dir()
                .as_ref()
                .is_some_and(|legacy| legacy == &path)
            {
                return default_tts_model_store_dir(&self.app_handle);
            }

            return path;
        }

        default_tts_model_store_dir(&self.app_handle)
    }

    fn mlx_audio_model_candidate_paths(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        let configured_store = self.tts_model_store_root();
        let (hf_repo_namespace, hf_repo_basename) = definition
            .hf_model_id
            .rsplit_once('/')
            .map(|(namespace, basename)| (Some(namespace), basename))
            .unwrap_or((None, definition.model_id));

        for store in [configured_store.clone(), configured_store.join("MLX")] {
            candidates.push(store.join(definition.model_id));
            candidates.push(store.join(hf_repo_basename));
            for dir_name in definition.local_dir_names {
                candidates.push(store.join(dir_name));
            }
            if let Some(namespace) = hf_repo_namespace {
                candidates.push(store.join(namespace).join(hf_repo_basename));
                candidates.push(store.join(namespace).join(definition.model_id));
                for dir_name in definition.local_dir_names {
                    candidates.push(store.join(namespace).join(dir_name));
                }
            }
        }

        candidates
    }

    fn resolved_mlx_audio_model_root(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Option<PathBuf> {
        self.mlx_audio_model_candidate_paths(definition)
            .into_iter()
            .find_map(|candidate| {
                if !candidate.exists() {
                    return None;
                }

                if candidate.is_dir() && candidate.join("config.json").exists() {
                    return Some(candidate);
                }

                resolve_extracted_root(&candidate).and_then(|root| {
                    if root.join("config.json").exists() {
                        Some(root)
                    } else {
                        None
                    }
                })
            })
    }

    fn mlx_audio_model_install_dir(&self, definition: &MlxAudioTtsModelDefinition) -> PathBuf {
        let repo_basename = definition
            .hf_model_id
            .rsplit('/')
            .next()
            .unwrap_or(definition.model_id);
        let directory_name = definition
            .local_dir_names
            .first()
            .copied()
            .unwrap_or(repo_basename);
        self.tts_model_store_root().join("MLX").join(directory_name)
    }

    fn mlx_audio_model_installed(&self, definition: &MlxAudioTtsModelDefinition) -> bool {
        self.resolved_mlx_audio_model_root(definition).is_some()
    }

    fn ensure_mlx_audio_model_root(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Result<PathBuf, String> {
        self.resolved_mlx_audio_model_root(definition)
            .ok_or_else(|| {
                format!(
                    "{} is not installed yet. Download it from Speech Output settings first.",
                    definition.label
                )
            })
    }

    fn resolve_mlx_audio_model_source(&self, definition: &MlxAudioTtsModelDefinition) -> String {
        self.resolved_mlx_audio_model_root(definition)
            .unwrap_or_else(|| PathBuf::from(definition.hf_model_id))
            .to_string_lossy()
            .to_string()
    }

    fn settings_for_voice_selection(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> AppSettings {
        let mut settings = get_settings(&self.app_handle);
        settings.tts_active_preset_id = None;
        settings.selected_tts_provider_id = provider_id.to_string();
        settings.selected_tts_model_id = model_id.map(str::to_string);
        settings.selected_tts_voice_id = None;
        settings.selected_tts_profile_id = None;
        settings
    }

    fn mlx_audio_voice_inventory(&self, settings: &AppSettings) -> Vec<VoiceInfo> {
        let provider_id = self.selected_provider_id(settings);
        let definition = settings
            .explicit_active_tts_preset()
            .and_then(|preset| mlx_audio_tts_model_definition(&preset.model_id))
            .or_else(|| {
                settings
                    .selected_tts_model_id
                    .as_deref()
                    .and_then(mlx_audio_tts_model_definition)
            })
            .or_else(|| first_mlx_audio_model_for_provider(&provider_id));

        definition
            .map(|definition| self.mlx_audio_voice_inventory_for_definition(definition))
            .unwrap_or_default()
    }

    fn mlx_audio_voice_inventory_for_definition(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Vec<VoiceInfo> {
        let provider_id = definition.provider_id;
        let model_source = PathBuf::from(self.resolve_mlx_audio_model_source(definition));

        let voices = if provider_id == TTS_PROVIDER_MLX_KOKORO_ID {
            self.kokoro_voice_inventory(&model_source)
        } else {
            self.mlx_embedded_voice_inventory(&model_source)
        };

        if !voices.is_empty() {
            return voices
                .into_iter()
                .map(|mut voice| {
                    voice.locale = mlx_voice_locale_for_provider(provider_id, &voice.id);
                    voice
                })
                .collect();
        }

        self.mlx_config_voice_inventory(&model_source, provider_id)
    }

    fn kokoro_voice_inventory(&self, model_source: &Path) -> Vec<VoiceInfo> {
        let voices_dir = [
            model_source.join("checkpoints").join("voices"),
            model_source.join("voices"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_dir());

        let Some(voices_dir) = voices_dir else {
            return Vec::new();
        };

        let Ok(entries) = fs::read_dir(&voices_dir) else {
            warn!(
                "Failed to enumerate Kokoro voices from {}",
                voices_dir.display()
            );
            return Vec::new();
        };

        let mut voices = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let is_voice_file = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("pt"))
                    .unwrap_or(false);
                if !is_voice_file {
                    return None;
                }

                let voice_id = path.file_stem()?.to_str()?.to_string();
                Some(VoiceInfo {
                    label: mlx_voice_label(&voice_id),
                    locale: mlx_voice_locale(&voice_id).map(str::to_string),
                    id: voice_id,
                    engine: TtsEngineKind::MlxNative,
                    installed: true,
                    available: true,
                })
            })
            .collect::<Vec<_>>();

        voices.sort_by(|left, right| left.label.cmp(&right.label).then(left.id.cmp(&right.id)));
        voices
    }

    fn mlx_embedded_voice_inventory(&self, model_source: &Path) -> Vec<VoiceInfo> {
        let voices_dir = ["voice_embedding", "embeddings", "voices"]
            .into_iter()
            .map(|dir| model_source.join(dir))
            .find(|candidate| candidate.is_dir());
        let Some(voices_dir) = voices_dir else {
            return Vec::new();
        };

        let Ok(entries) = fs::read_dir(&voices_dir) else {
            warn!(
                "Failed to enumerate MLX embedded voices from {}",
                voices_dir.display()
            );
            return Vec::new();
        };

        let mut voices = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let extension = path.extension().and_then(|ext| ext.to_str())?;
                let is_embedding_file = matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "safetensors" | "pt" | "bin"
                );
                if !is_embedding_file {
                    return None;
                }

                let voice_id = path.file_stem()?.to_str()?.to_string();
                Some(VoiceInfo {
                    label: mlx_voice_label(&voice_id),
                    locale: None,
                    id: voice_id,
                    engine: TtsEngineKind::MlxNative,
                    installed: true,
                    available: true,
                })
            })
            .collect::<Vec<_>>();

        voices.sort_by(|left, right| left.label.cmp(&right.label).then(left.id.cmp(&right.id)));
        voices
    }

    fn mlx_config_voice_inventory(&self, model_source: &Path, provider_id: &str) -> Vec<VoiceInfo> {
        let voice_ids = ["config.json", "params.json"]
            .into_iter()
            .filter_map(|filename| {
                let path = model_source.join(filename);
                let raw = fs::read_to_string(path).ok()?;
                let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
                value
                    .pointer("/multimodal/audio_tokenizer_args/voice")
                    .and_then(|voice_map| voice_map.as_object())
                    .map(|voice_map| voice_map.keys().cloned().collect::<Vec<_>>())
            })
            .flatten()
            .collect::<std::collections::BTreeSet<_>>();

        voice_ids
            .into_iter()
            .map(|voice_id| VoiceInfo {
                label: mlx_voice_label(&voice_id),
                locale: mlx_voice_locale_for_provider(provider_id, &voice_id),
                id: voice_id,
                engine: TtsEngineKind::MlxNative,
                installed: true,
                available: true,
            })
            .collect()
    }

    pub fn get_available_voices_for_selection(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> Result<Vec<VoiceInfo>, String> {
        if provider_is_mlx_audio(provider_id) {
            if let Some(definition) = model_id
                .and_then(mlx_audio_tts_model_definition)
                .or_else(|| first_mlx_audio_model_for_provider(provider_id))
            {
                ensure_mlx_audio_definition_available(definition)?;
            }
        }

        let settings = self.settings_for_voice_selection(provider_id, model_id);
        match self.resolve_engine_kind(&settings, None)? {
            TtsEngineKind::System => self.system_voices(),
            TtsEngineKind::SherpaOnnx => Ok(self.installed_pack_voices()),
            TtsEngineKind::MlxNative => Ok(self.mlx_audio_voice_inventory(&settings)),
            TtsEngineKind::Qwen3Native => Ok(self.installed_qwen3_voices()),
            TtsEngineKind::Sidecar => self.runtime_managed_voices(&settings),
            TtsEngineKind::LfmAudioGguf | TtsEngineKind::VibeVoice => Ok(Vec::new()),
        }
    }

    fn managed_runtime_model_definition(
        &self,
        model_id: &str,
    ) -> Option<&'static ManagedRuntimeModelDefinition> {
        MANAGED_RUNTIME_MODEL_DEFINITIONS
            .iter()
            .find(|definition| definition.model_id == model_id)
    }

    fn managed_runtime_model_install_dir(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> PathBuf {
        self.tts_model_store_root().join(definition.install_subdir)
    }

    fn managed_runtime_model_source_dir(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Option<PathBuf> {
        let configured_store = self.tts_model_store_root();
        let source_repo_dir = definition.source_repo_dir?;
        let configured_path = configured_store.join(source_repo_dir);
        if configured_path.exists() {
            return Some(configured_path);
        }

        None
    }

    fn managed_runtime_model_installed(&self, definition: &ManagedRuntimeModelDefinition) -> bool {
        let install_dir = self.managed_runtime_model_install_dir(definition);
        let resolved = resolve_extracted_root(&install_dir).unwrap_or(install_dir);
        if resolved.exists()
            && resolved
                .read_dir()
                .map(|mut entries| entries.next().is_some())
                .unwrap_or(false)
        {
            return true;
        }

        self.managed_runtime_model_source_dir(definition)
            .and_then(|source_dir| {
                source_dir
                    .read_dir()
                    .ok()
                    .map(|mut entries| entries.next().is_some())
            })
            .unwrap_or(false)
    }

    fn managed_runtime_model_candidate_paths(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        for relative_path in [
            format!("resources/tts-runtime-models/{}", definition.archive_name),
            format!("resources/tts-runtime-models/{}", definition.model_id),
        ] {
            if let Ok(path) = portable::resolve_resource(&self.app_handle, &relative_path) {
                candidates.push(path);
            }
        }

        #[cfg(debug_assertions)]
        {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let repo_root = manifest_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or(manifest_dir.clone());
            candidates.push(
                manifest_dir
                    .join("resources")
                    .join("tts-runtime-models")
                    .join(definition.archive_name),
            );
            candidates.push(
                manifest_dir
                    .join("resources")
                    .join("tts-runtime-models")
                    .join(definition.model_id),
            );
            candidates.push(repo_root.join(definition.archive_name));
            candidates.push(repo_root.join(definition.model_id));
        }

        candidates
    }

    fn find_managed_runtime_model_source(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Option<PathBuf> {
        self.managed_runtime_model_candidate_paths(definition)
            .into_iter()
            .find(|candidate| candidate.exists())
    }

    fn qwen3_pack_candidate_paths(&self, definition: &Qwen3PackDefinition) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        let archive_name = self.qwen3_pack_archive_name(definition);

        for relative_path in [
            format!("resources/tts-packs/qwen3/{archive_name}"),
            format!("resources/tts-packs/qwen3/{}", definition.id),
            format!("resources/tts/qwen3/{archive_name}"),
            format!("resources/tts/qwen3/{}", definition.id),
        ] {
            if let Ok(path) = portable::resolve_resource(&self.app_handle, &relative_path) {
                candidates.push(path);
            }
        }

        #[cfg(debug_assertions)]
        {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let repo_root = manifest_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or(manifest_dir.clone());
            candidates.push(
                manifest_dir
                    .join("resources")
                    .join("tts-packs")
                    .join("qwen3")
                    .join(&archive_name),
            );
            candidates.push(
                manifest_dir
                    .join("resources")
                    .join("tts-packs")
                    .join("qwen3")
                    .join(definition.id),
            );
            candidates.push(repo_root.join(&archive_name));
            candidates.push(repo_root.join(definition.id));
        }

        let configured_store = self.tts_model_store_root();
        for central_store in [configured_store.join("qwen3"), configured_store] {
            candidates.push(central_store.join(&archive_name));
            candidates.push(central_store.join(definition.id));
        }

        candidates
    }

    fn find_qwen3_pack_source(&self, definition: &Qwen3PackDefinition) -> Option<PathBuf> {
        self.qwen3_pack_candidate_paths(definition)
            .into_iter()
            .find(|candidate| candidate.exists())
    }

    fn resolved_qwen3_pack_root(&self, definition: &Qwen3PackDefinition) -> Option<PathBuf> {
        if let Some(root) = resolve_extracted_root(&self.pack_install_dir(definition.id)) {
            return Some(root);
        }

        self.qwen3_pack_candidate_paths(definition)
            .into_iter()
            .find(|candidate| {
                candidate.is_dir()
                    && candidate.join("config.json").exists()
                    && candidate.join("speech_tokenizer").exists()
            })
    }

    fn install_local_pack_source(
        &self,
        source_path: &Path,
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        if source_path.is_dir() {
            if install_dir.exists() {
                fs::remove_dir_all(install_dir)
                    .map_err(|err| format!("Failed to clear archive destination: {err}"))?;
            }
            copy_directory_recursive(source_path, install_dir)
                .map_err(|err| format!("Failed to install {label}: {err}"))?;
            return Ok(());
        }

        if source_path.is_file() {
            return extract_archive(source_path, install_dir);
        }

        Err(format!(
            "{} source could not be found at {}",
            label,
            source_path.display()
        ))
    }

    async fn install_qwen3_pack(&self, definition: &Qwen3PackDefinition) -> Result<(), String> {
        let install_dir = self.pack_install_dir(definition.id);
        let label = format!("Qwen3 pack '{}'", definition.label);
        if let Some(source_path) = self.find_qwen3_pack_source(definition) {
            match self.install_local_pack_source(&source_path, &install_dir, &label) {
                Ok(()) => return Ok(()),
                Err(local_error) => {
                    info!("{label}: local source failed ({local_error}), trying remote download");
                }
            }
        }

        // Try GitHub release archive first, then fall back to HuggingFace if configured.
        let archive_name = self.qwen3_pack_archive_name(definition);
        let github_result = self
            .download_and_extract_archive(
                &[self.asset_download_url(&archive_name)],
                &install_dir,
                &label,
            )
            .await;

        match github_result {
            Ok(()) => Ok(()),
            Err(github_error) => {
                if let Some(hf_repo) = definition.hf_repo_id {
                    info!(
                        "{label}: GitHub download failed ({github_error}), falling back to HuggingFace ({hf_repo})"
                    );
                    self.download_hf_snapshot(hf_repo, &install_dir, &label)
                        .await
                } else {
                    Err(github_error)
                }
            }
        }
    }

    async fn ensure_managed_speech_runtime_installed(&self) -> Result<PathBuf, String> {
        let definition = managed_speech_runtime_definition().ok_or_else(|| {
            "The managed Speech runtime is not available on this platform yet.".to_string()
        })?;

        let install_dir = crate::settings::default_speech_runtime_install_dir(
            &self.app_handle,
            definition.platform_id,
        );
        if let Some(root) = resolve_extracted_root(&install_dir) {
            if managed_speech_runtime_is_current(&root) {
                return Ok(root);
            }
        }

        if let Some(source_path) = self.find_managed_speech_runtime_source(&definition) {
            self.install_local_pack_source(&source_path, &install_dir, "Speech runtime")?;
            let root = resolve_extracted_root(&install_dir).ok_or_else(|| {
                "Speech runtime extraction did not produce any files.".to_string()
            })?;
            if managed_speech_runtime_is_current(&root) {
                return Ok(root);
            }
        }

        self.download_and_extract_archive(
            &[self.asset_download_url(definition.archive_name)],
            &install_dir,
            "Speech runtime",
        )
        .await?;

        let root = resolve_extracted_root(&install_dir)
            .ok_or_else(|| "Speech runtime extraction did not produce any files.".to_string())?;
        if !managed_speech_runtime_is_current(&root) {
            return Err(
                "Speech runtime download completed, but the runtime is missing managed model support."
                    .to_string(),
            );
        }

        Ok(root)
    }

    pub async fn ensure_managed_speech_runtime_available(
        &self,
        provider_id: &str,
    ) -> Result<(), String> {
        if provider_uses_managed_speech_runtime(provider_id) {
            // Only skip installation if the *speech-runtime* specifically is
            // already running (e.g. from iCloud or a custom path).  A generic
            // `is_running()` check can be fooled by `mlx_audio.server` which
            // does not serve these providers.
            if let Some(sidecar) = self
                .app_handle
                .try_state::<std::sync::Arc<crate::sidecar::SidecarManager>>()
            {
                let sidecar = Arc::clone(&*sidecar);
                let runtime_state = tokio::task::spawn_blocking(move || {
                    (
                        sidecar.is_speech_runtime_running(),
                        sidecar.has_speech_runtime_source(),
                    )
                })
                .await
                .map_err(|err| format!("Failed to check speech runtime availability: {err}"))?;
                let (runtime_running, runtime_available) = runtime_state;
                if runtime_running || runtime_available {
                    return Ok(());
                }
            }
            let _ = self.ensure_managed_speech_runtime_installed().await?;
        }
        Ok(())
    }

    pub async fn prepare_sidecar_provider(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> Result<(), String> {
        if provider_is_mlx_audio(provider_id) {
            let sidecar = self
                .app_handle
                .try_state::<Arc<crate::sidecar::SidecarManager>>()
                .map(|state| Arc::clone(&*state))
                .ok_or_else(|| "MLX speech runtime manager is not available.".to_string())?;
            tokio::task::spawn_blocking(move || sidecar.ensure_mlx_audio_environment())
                .await
                .map_err(|err| format!("Failed to prepare MLX speech runtime: {err}"))??;
            return Ok(());
        }

        self.ensure_managed_speech_runtime_available(provider_id)
            .await?;

        if let Some(sidecar) = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
        {
            let sidecar = Arc::clone(&*sidecar);
            // Sidecar-managed providers (kokoro, chatterbox, xtts, etc.)
            // require the speech-runtime, not mlx_audio.server.  Use
            // `ensure_speech_runtime()` to stop the wrong backend if needed.
            tokio::task::spawn_blocking(move || sidecar.ensure_speech_runtime())
                .await
                .map_err(|err| format!("Failed to start speech runtime: {err}"))??;
        }

        let prepare_url = self
            .sidecar_request_url("listen/prepare")
            .ok_or_else(|| "Failed to resolve the local speech runtime URL.".to_string())?;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(|err| format!("Failed to create HTTP client: {err}"))?;
        let response = client
            .post(prepare_url)
            .json(&serde_json::json!({
                "provider_id": provider_id,
                "model_id": model_id,
            }))
            .send()
            .await
            .map_err(|err| {
                format!(
                    "Failed to reach speech runtime while preparing {}: {err}",
                    sidecar_runtime_target(provider_id, model_id)
                )
            })?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let detail = sidecar_error_detail(&body);
            return Err(if detail.is_empty() {
                format!(
                    "{} preparation failed with HTTP {status}",
                    sidecar_runtime_target(provider_id, model_id)
                )
            } else {
                format!(
                    "{} preparation failed: {detail}",
                    sidecar_runtime_target(provider_id, model_id)
                )
            });
        }

        Ok(())
    }

    fn managed_speech_runtime_candidate_paths(
        &self,
        definition: &ManagedSpeechRuntimeDefinition,
    ) -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        if let Ok(path) = portable::resolve_resource(
            &self.app_handle,
            &format!("resources/tts-runtime/{}", definition.archive_name),
        ) {
            candidates.push(path);
        }

        #[cfg(debug_assertions)]
        {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let repo_root = manifest_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| manifest_dir.clone());
            candidates.push(
                manifest_dir
                    .join("resources")
                    .join("tts-runtime")
                    .join(definition.archive_name),
            );
            candidates.push(repo_root.join("dist").join(definition.archive_name));
            candidates.push(repo_root.join(definition.archive_name));
        }

        candidates
    }

    fn find_managed_speech_runtime_source(
        &self,
        definition: &ManagedSpeechRuntimeDefinition,
    ) -> Option<PathBuf> {
        self.managed_speech_runtime_candidate_paths(definition)
            .into_iter()
            .find(|candidate| candidate.exists())
    }

    async fn install_managed_runtime_model(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Result<(), String> {
        let install_dir = self.managed_runtime_model_install_dir(definition);
        let label = format!("{} model assets", definition.label);

        if let Some(source_path) = self.find_managed_runtime_model_source(definition) {
            match self.install_local_pack_source(&source_path, &install_dir, &label) {
                Ok(()) => {
                    let _ = self.ensure_managed_speech_runtime_installed().await?;
                    return Ok(());
                }
                Err(local_error) => {
                    info!("{label}: local source failed ({local_error}), trying remote download");
                }
            }
        }

        // Try GitHub release archive first.
        let github_result = self
            .download_and_extract_archive(
                &[self.asset_download_url(definition.archive_name)],
                &install_dir,
                &label,
            )
            .await;

        match github_result {
            Ok(()) => {
                let _ = self.ensure_managed_speech_runtime_installed().await?;
                Ok(())
            }
            Err(github_error) => {
                if let Some(hf_repo) = definition.hf_repo_id {
                    info!(
                        "{label}: GitHub download failed ({github_error}), falling back to HuggingFace ({hf_repo})"
                    );
                    self.download_hf_snapshot(hf_repo, &install_dir, &label)
                        .await?;
                    let _ = self.ensure_managed_speech_runtime_installed().await?;
                    Ok(())
                } else {
                    Err(github_error)
                }
            }
        }
    }

    async fn install_mlx_audio_model(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Result<(), String> {
        let install_dir = self.mlx_audio_model_install_dir(definition);
        let label = format!("{} MLX model assets", definition.label);

        self.download_hf_snapshot_into_exact_dir(definition.hf_model_id, &install_dir, &label)
            .await
    }

    async fn download_hf_file_set_into_dir(
        &self,
        repo_id: &str,
        files: &[(&str, &str)],
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        use futures_util::StreamExt;
        use tokio::fs as tokio_fs;
        use tokio::io::AsyncWriteExt;

        if files.is_empty() {
            return Err(format!("No files configured for {label}."));
        }

        let parent = install_dir
            .parent()
            .ok_or_else(|| format!("Invalid install directory '{}'.", install_dir.display()))?;
        tokio_fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
        let staging_dir = parent.join(format!(
            ".staging-{}-{}",
            install_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("tts-model"),
            Uuid::new_v4()
        ));
        tokio_fs::create_dir_all(&staging_dir)
            .await
            .map_err(|err| format!("Failed to create staging dir for {label}: {err}"))?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(900))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        for (source, destination) in files {
            let encoded = source
                .split('/')
                .map(|segment| segment.replace(' ', "%20"))
                .collect::<Vec<_>>()
                .join("/");
            let url = format!("https://huggingface.co/{repo_id}/resolve/main/{encoded}");
            let target = staging_dir.join(destination);
            if let Some(parent) = target.parent() {
                tokio_fs::create_dir_all(parent)
                    .await
                    .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
            }

            let response = hf_get(&client, &url)
                .send()
                .await
                .map_err(|err| format!("Failed to fetch {source} for {label}: {err}"))?;
            if !response.status().is_success() {
                let _ = tokio_fs::remove_dir_all(&staging_dir).await;
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                    return Err(hf_access_error(repo_id));
                }
                return Err(format!(
                    "Failed to download {source} for {label}: HTTP {}",
                    response.status()
                ));
            }

            let mut output = tokio_fs::File::create(&target)
                .await
                .map_err(|err| format!("Failed to create {}: {err}", target.display()))?;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|err| format!("Download stream failed for {source}: {err}"))?;
                output
                    .write_all(&chunk)
                    .await
                    .map_err(|err| format!("Failed to write {source}: {err}"))?;
            }
            output
                .flush()
                .await
                .map_err(|err| format!("Failed to flush {source}: {err}"))?;
        }

        if install_dir.exists() {
            tokio_fs::remove_dir_all(install_dir)
                .await
                .map_err(|err| format!("Failed to clear existing {label}: {err}"))?;
        }
        tokio_fs::rename(&staging_dir, install_dir)
            .await
            .map_err(|err| {
                format!(
                    "Failed to install {label} ({} -> {}): {err}",
                    staging_dir.display(),
                    install_dir.display()
                )
            })?;
        Ok(())
    }

    async fn install_lfm_audio_gguf_model(&self) -> Result<(), String> {
        let install_dir = crate::storage_paths::lfm_audio_gguf_dir(&self.app_handle)
            .map_err(|err| format!("Failed to resolve LFM Audio install dir: {err}"))?;
        self.download_hf_file_set_into_dir(
            LFM_AUDIO_GGUF_HF_REPO_ID,
            LFM_AUDIO_GGUF_HF_FILES,
            &install_dir,
            "LFM2.5 Audio GGUF assets",
        )
        .await
    }

    async fn install_vibevoice_model(&self) -> Result<(), String> {
        let install_dir = crate::storage_paths::vibevoice_dir(&self.app_handle)
            .map_err(|err| format!("Failed to resolve VibeVoice install dir: {err}"))?;
        self.download_hf_file_set_into_dir(
            VIBEVOICE_HF_REPO_ID,
            VIBEVOICE_HF_FILES,
            &install_dir,
            "VibeVoice assets",
        )
        .await
    }

    pub fn stop(&self) {
        if let Some(flag) = self
            .current_stop_flag
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn set_last_output(&self, text: String, locale: Option<String>) {
        *self.last_output.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(LastOutput { text, locale });
    }

    pub fn speak_last_output_request(&self) -> Result<SpeakRequest, String> {
        let Some(last_output) = self
            .last_output
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        else {
            return Err("No previous output is available to speak yet.".to_string());
        };

        Ok(SpeakRequest {
            text: last_output.text,
            locale: last_output.locale,
            preferred_voice_id: None,
            preset_id: None,
            inline_preset: None,
            trigger: Some("speak_last_output".to_string()),
            remember_last_output: false,
        })
    }

    pub fn get_available_voices(&self) -> Result<Vec<VoiceInfo>, String> {
        let settings = get_settings(&self.app_handle);
        match self.resolve_engine_kind(&settings, None)? {
            TtsEngineKind::System => self.system_voices(),
            TtsEngineKind::SherpaOnnx => Ok(self.installed_pack_voices()),
            TtsEngineKind::MlxNative => Ok(self.mlx_audio_voice_inventory(&settings)),
            TtsEngineKind::Qwen3Native => Ok(self.installed_qwen3_voices()),
            TtsEngineKind::Sidecar => self.runtime_managed_voices(&settings),
            TtsEngineKind::LfmAudioGguf | TtsEngineKind::VibeVoice => Ok(Vec::new()),
        }
    }

    pub fn warm_system_voice_cache(&self) -> Result<(), String> {
        let _ = self.system_voices()?;
        Ok(())
    }

    fn get_available_sherpa_packs(&self) -> Vec<TtsPackInfo> {
        PACK_DEFINITIONS
            .iter()
            .map(|definition| TtsPackInfo {
                id: definition.id.to_string(),
                label: definition.label.to_string(),
                locale: definition.locale.to_string(),
                voice_id: definition.voice_id.to_string(),
                archive_name: definition.archive_name.to_string(),
                source_url: definition.source_url.to_string(),
                installed: self.installed_pack_root(definition.id).is_some(),
            })
            .collect()
    }

    fn get_available_qwen3_packs(&self) -> Vec<TtsPackInfo> {
        QWEN3_PACK_DEFINITIONS
            .iter()
            .map(|definition| TtsPackInfo {
                id: definition.id.to_string(),
                label: definition.label.to_string(),
                locale: definition.locale.to_string(),
                voice_id: definition.id.to_string(),
                archive_name: self.qwen3_pack_archive_name(definition),
                source_url: definition
                    .hf_repo_id
                    .map(|repo| format!("https://huggingface.co/{repo}"))
                    .unwrap_or_else(|| {
                        "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base".to_string()
                    }),
                installed: self.resolved_qwen3_pack_root(definition).is_some(),
            })
            .collect()
    }

    pub fn get_available_packs(&self) -> Vec<TtsPackInfo> {
        let mut packs = self.get_available_sherpa_packs();
        packs.extend(self.get_available_qwen3_packs());
        packs
    }

    fn runtime_advanced_controls(
        &self,
        model: &RuntimeListenModelCatalogEntry,
    ) -> Vec<TtsAdvancedControlDescriptor> {
        let mut controls = if model.style_controls.is_empty() {
            self.runtime_fallback_advanced_controls_for_target(&model.provider_id, Some(&model.id))
        } else {
            model
                .style_controls
                .iter()
                .filter_map(Self::map_runtime_style_control)
                .collect()
        };

        if model.capabilities.supports_instruction_prompt
            && !controls
                .iter()
                .any(|control| control.id == "style_instructions")
        {
            controls.push(Self::instruction_prompt_control(
                "Optional provider-specific speaking instructions passed through to the runtime.",
            ));
        }

        controls
    }

    fn map_runtime_style_control(
        control: &RuntimeStyleControl,
    ) -> Option<TtsAdvancedControlDescriptor> {
        let kind = match control.kind.trim().to_ascii_lowercase().as_str() {
            "slider" => TtsAdvancedControlKind::Slider,
            "toggle" => TtsAdvancedControlKind::Toggle,
            "select" => TtsAdvancedControlKind::Select,
            "text" => TtsAdvancedControlKind::Text,
            _ => return None,
        };

        Some(TtsAdvancedControlDescriptor {
            id: control.id.clone(),
            group: Self::runtime_control_group(control.group.as_deref(), control.id.as_str()),
            label: control.label.clone(),
            description: control.description.clone(),
            kind,
            min: control.min.map(|value| value as f32),
            max: control.max.map(|value| value as f32),
            step: control.step.map(|value| value as f32),
            unit: control.unit.clone(),
            options: control
                .options
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|option| crate::model_platform::TtsAdvancedControlOption {
                    value: option.value,
                    label: option.label,
                })
                .collect(),
            default_value: control
                .default_value
                .map(|value| TtsStyleControlValue::Number(value as f32)),
        })
    }

    fn instruction_prompt_control(description: &str) -> TtsAdvancedControlDescriptor {
        TtsAdvancedControlDescriptor {
            id: "style_instructions".to_string(),
            group: TtsControlGroup::Steering,
            label: "Style Instructions".to_string(),
            description: Some(description.to_string()),
            kind: TtsAdvancedControlKind::Text,
            min: None,
            max: None,
            step: None,
            unit: None,
            options: Vec::new(),
            default_value: None,
        }
    }

    fn slider_advanced_control(
        id: &str,
        group: TtsControlGroup,
        label: &str,
        description: &str,
        min: f32,
        max: f32,
        step: f32,
        default_value: f32,
        unit: Option<&str>,
    ) -> TtsAdvancedControlDescriptor {
        TtsAdvancedControlDescriptor {
            id: id.to_string(),
            group,
            label: label.to_string(),
            description: Some(description.to_string()),
            kind: TtsAdvancedControlKind::Slider,
            min: Some(min),
            max: Some(max),
            step: Some(step),
            unit: unit.map(str::to_string),
            options: Vec::new(),
            default_value: Some(TtsStyleControlValue::Number(default_value)),
        }
    }

    fn tempo_advanced_control(description: &str) -> TtsAdvancedControlDescriptor {
        Self::slider_advanced_control(
            "tempo_rate",
            TtsControlGroup::Tempo,
            "Tempo",
            description,
            0.5,
            2.0,
            0.05,
            1.0,
            Some("x"),
        )
    }

    fn randomness_advanced_control(default_value: f32) -> TtsAdvancedControlDescriptor {
        Self::slider_advanced_control(
            "randomness",
            TtsControlGroup::Sampler,
            "Temperature",
            "Controls sampling variation during audio generation.",
            0.0,
            1.0,
            0.05,
            default_value,
            None,
        )
    }

    fn repetition_penalty_advanced_control(default_value: f32) -> TtsAdvancedControlDescriptor {
        Self::slider_advanced_control(
            "repetition_penalty",
            TtsControlGroup::Guidance,
            "Repetition Penalty",
            "Discourages repeated words or token loops in longer reads.",
            1.0,
            3.0,
            0.1,
            default_value,
            None,
        )
    }

    fn top_p_advanced_control(default_value: f32) -> TtsAdvancedControlDescriptor {
        Self::slider_advanced_control(
            "top_p",
            TtsControlGroup::Sampler,
            "Top P",
            "Keeps sampling inside the most likely token mass.",
            0.5,
            1.0,
            0.05,
            default_value,
            None,
        )
    }

    fn top_k_advanced_control(default_value: f32) -> TtsAdvancedControlDescriptor {
        Self::slider_advanced_control(
            "top_k",
            TtsControlGroup::Sampler,
            "Top K",
            "Caps how many candidate audio tokens can be sampled.",
            1.0,
            100.0,
            1.0,
            default_value,
            None,
        )
    }

    fn min_p_advanced_control(default_value: f32) -> TtsAdvancedControlDescriptor {
        Self::slider_advanced_control(
            "min_p",
            TtsControlGroup::Sampler,
            "Min P",
            "Filters very unlikely audio tokens while keeping expressive options open.",
            0.0,
            1.0,
            0.01,
            default_value,
            None,
        )
    }

    fn runtime_fallback_advanced_controls_for_target(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> Vec<TtsAdvancedControlDescriptor> {
        let provider_id = provider_id.to_ascii_lowercase();
        let target_key = model_id
            .map(|model_id| format!("{} {}", provider_id, model_id.to_ascii_lowercase()))
            .unwrap_or_else(|| provider_id.clone());

        if provider_id == TTS_PROVIDER_MLX_KOKORO_ID {
            return vec![Self::tempo_advanced_control(
                "Adjusts Kokoro delivery speed for this preset.",
            )];
        }

        if provider_id == TTS_PROVIDER_MLX_CHATTERBOX_ID {
            return vec![
                Self::tempo_advanced_control(
                    "Adjusts MLX Chatterbox delivery speed when supported by the model.",
                ),
                Self::randomness_advanced_control(0.7),
                Self::slider_advanced_control(
                    "cfg_weight",
                    TtsControlGroup::Guidance,
                    "Guidance",
                    "Controls how strongly Chatterbox follows its conditioning signal.",
                    0.0,
                    1.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::slider_advanced_control(
                    "exaggeration",
                    TtsControlGroup::Style,
                    "Exaggeration",
                    "Pushes Chatterbox toward a more pronounced style.",
                    0.25,
                    2.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::repetition_penalty_advanced_control(1.2),
                Self::top_p_advanced_control(0.95),
                Self::min_p_advanced_control(0.05),
            ];
        }

        if provider_id == TTS_PROVIDER_MLX_QWEN3TTS_ID
            || provider_id == TTS_PROVIDER_MLX_FISH_AUDIO_ID
            || provider_id == TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID
            || provider_id == TTS_PROVIDER_MLX_HIGGS_AUDIO_ID
            || provider_id == TTS_PROVIDER_MLX_IRODORI_TTS_ID
            || provider_id == TTS_PROVIDER_MLX_INDEXTTS_ID
            || provider_id == TTS_PROVIDER_MLX_OMNIVOICE_ID
        {
            return vec![
                Self::tempo_advanced_control(
                    "Adjusts delivery speed when supported by this MLX model.",
                ),
                Self::randomness_advanced_control(0.7),
                Self::repetition_penalty_advanced_control(1.2),
                Self::top_p_advanced_control(0.8),
                Self::top_k_advanced_control(50.0),
            ];
        }

        if provider_id == TTS_PROVIDER_MLX_DIA_ID
            || provider_id == TTS_PROVIDER_MLX_SPARK_ID
            || provider_id == TTS_PROVIDER_MLX_MOSS_TTS_ID
            || provider_id == TTS_PROVIDER_MLX_VIBEVOICE_ID
            || provider_id == TTS_PROVIDER_MLX_VOXTRAL_TTS_ID
        {
            return vec![
                Self::randomness_advanced_control(0.7),
                Self::top_p_advanced_control(0.8),
                Self::top_k_advanced_control(50.0),
            ];
        }

        if provider_id == TTS_PROVIDER_MLX_MING_OMNI_ID {
            return vec![
                Self::tempo_advanced_control("Adjusts Ming Omni delivery speed."),
                Self::randomness_advanced_control(0.7),
                Self::top_p_advanced_control(0.8),
                Self::top_k_advanced_control(50.0),
            ];
        }

        if provider_id == TTS_PROVIDER_MLX_LFM_AUDIO_ID {
            return vec![Self::randomness_advanced_control(0.7)];
        }

        if provider_id == TTS_PROVIDER_MLX_POCKET_TTS_ID
            || provider_id == TTS_PROVIDER_MLX_SOPRANO_ID
            || provider_id == TTS_PROVIDER_MLX_MELOTTS_ID
        {
            return vec![Self::randomness_advanced_control(0.7)];
        }

        if provider_id == TTS_PROVIDER_MLX_KUGEL_ID || provider_id == TTS_PROVIDER_MLX_BARK_ID {
            return Vec::new();
        }

        if provider_id == TTS_PROVIDER_MLX_VOXCPM_ID {
            return vec![Self::slider_advanced_control(
                "cfg_weight",
                TtsControlGroup::Guidance,
                "Guidance",
                "Controls VoxCPM2 conditioning strength.",
                0.0,
                5.0,
                0.1,
                2.0,
                None,
            )];
        }

        if target_key.contains("kokoro") {
            return vec![Self::tempo_advanced_control(
                "Adjusts Kokoro delivery speed for this preset.",
            )];
        }

        if target_key.contains("chatterbox-turbo") {
            return vec![
                Self::randomness_advanced_control(0.8),
                Self::repetition_penalty_advanced_control(1.2),
                Self::top_p_advanced_control(0.95),
                Self::slider_advanced_control(
                    "top_k",
                    TtsControlGroup::Sampler,
                    "Top K",
                    "Caps how many candidate speech tokens can be sampled.",
                    1.0,
                    1000.0,
                    1.0,
                    1000.0,
                    None,
                ),
            ];
        }

        if target_key.contains("chatterbox-multilingual") {
            return vec![
                Self::slider_advanced_control(
                    "guidance",
                    TtsControlGroup::Guidance,
                    "Guidance",
                    "Controls how strongly Chatterbox follows its conditioning signal.",
                    0.0,
                    1.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::randomness_advanced_control(0.8),
                Self::slider_advanced_control(
                    "exaggeration",
                    TtsControlGroup::Style,
                    "Exaggeration",
                    "Pushes Chatterbox toward a more pronounced style.",
                    0.25,
                    2.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::repetition_penalty_advanced_control(2.0),
                Self::top_p_advanced_control(1.0),
                Self::min_p_advanced_control(0.05),
            ];
        }

        if target_key.contains("chatterbox") {
            return vec![
                Self::slider_advanced_control(
                    "guidance",
                    TtsControlGroup::Guidance,
                    "Guidance",
                    "Controls how strongly Chatterbox follows its conditioning signal.",
                    0.0,
                    1.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::randomness_advanced_control(0.8),
                Self::slider_advanced_control(
                    "exaggeration",
                    TtsControlGroup::Style,
                    "Exaggeration",
                    "Pushes Chatterbox toward a more pronounced style.",
                    0.25,
                    2.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::repetition_penalty_advanced_control(1.2),
                Self::top_p_advanced_control(0.95),
                Self::min_p_advanced_control(0.05),
            ];
        }

        if target_key.contains("xtts") || target_key.contains("coqui") {
            return vec![
                Self::tempo_advanced_control("Adjusts XTTS delivery speed."),
                Self::randomness_advanced_control(0.65),
                Self::repetition_penalty_advanced_control(2.0),
                Self::top_p_advanced_control(0.8),
                Self::top_k_advanced_control(50.0),
            ];
        }

        if provider_id == TTS_PROVIDER_SUPERTONIC_ID || target_key.contains("supertonic") {
            return vec![
                Self::slider_advanced_control(
                    "tempo_rate",
                    TtsControlGroup::Tempo,
                    "Tempo",
                    "Adjusts Supertonic speech speed.",
                    0.7,
                    2.0,
                    0.05,
                    1.05,
                    Some("x"),
                ),
                Self::slider_advanced_control(
                    "quality_steps",
                    TtsControlGroup::Sampler,
                    "Quality Steps",
                    "Sets Supertonic denoising steps; higher can improve quality at the cost of latency.",
                    1.0,
                    12.0,
                    1.0,
                    5.0,
                    None,
                ),
            ];
        }

        if target_key.contains("openvoice") {
            return vec![
                Self::tempo_advanced_control(
                    "Speeds OpenVoice up or down for a tighter delivery fit.",
                ),
                Self::slider_advanced_control(
                    "sdp_ratio",
                    TtsControlGroup::Style,
                    "SDP Ratio",
                    "Balances deterministic and stochastic duration prediction.",
                    0.0,
                    1.0,
                    0.05,
                    0.2,
                    None,
                ),
                Self::slider_advanced_control(
                    "noise_scale",
                    TtsControlGroup::Sampler,
                    "Noise Scale",
                    "Controls base voice acoustic variation before tone conversion.",
                    0.0,
                    1.0,
                    0.05,
                    0.6,
                    None,
                ),
                Self::slider_advanced_control(
                    "noise_scale_w",
                    TtsControlGroup::Sampler,
                    "Duration Noise",
                    "Controls stochastic duration variation in the base voice.",
                    0.0,
                    1.0,
                    0.05,
                    0.8,
                    None,
                ),
                Self::slider_advanced_control(
                    "tau",
                    TtsControlGroup::Style,
                    "Tone Blend",
                    "Adjusts tone-color conversion strength for cloned voices.",
                    0.0,
                    1.0,
                    0.05,
                    0.3,
                    None,
                ),
            ];
        }

        Vec::new()
    }

    fn builtin_delivery_support(&self, provider_id: &str) -> TtsDeliverySupport {
        let expressiveness_mode = if provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID {
            TtsExpressivenessMode::Native
        } else {
            TtsExpressivenessMode::Unsupported
        };

        let advanced_controls = match provider_id {
            TTS_PROVIDER_SYSTEM_BUILTIN_ID => vec![Self::tempo_advanced_control(
                "Adjusts the operating system voice speaking rate.",
            )],
            TTS_PROVIDER_SHERPA_PACK_ID => vec![Self::tempo_advanced_control(
                "Adjusts Sherpa VITS length scale for faster or slower delivery.",
            )],
            TTS_PROVIDER_LOCAL_SIDECAR_API_ID => vec![
                Self::tempo_advanced_control(
                    "Sends a speed hint to compatible local speech APIs.",
                ),
                TtsAdvancedControlDescriptor {
                    id: "style_instructions".to_string(),
                    group: TtsControlGroup::Steering,
                    label: "Style Instructions".to_string(),
                    description: Some(
                        "Optional sidecar-specific instructions passed through with speech generation."
                            .to_string(),
                    ),
                    kind: TtsAdvancedControlKind::Text,
                    min: None,
                    max: None,
                    step: None,
                    unit: None,
                    options: Vec::new(),
                    default_value: None,
                },
            ],
            TTS_PROVIDER_VIBEVOICE_ID => vec![Self::slider_advanced_control(
                "cfg_weight",
                TtsControlGroup::Guidance,
                "Guidance",
                "Controls VibeVoice classifier-free guidance strength.",
                0.0,
                5.0,
                0.1,
                1.3,
                None,
            )],
            TTS_PROVIDER_LFM_AUDIO_GGUF_ID => Vec::new(),
            _ => Vec::new(),
        };

        TtsDeliverySupport {
            expressiveness_mode,
            advanced_controls,
        }
    }

    fn runtime_control_group(raw_group: Option<&str>, control_id: &str) -> TtsControlGroup {
        match raw_group
            .unwrap_or(control_id)
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "identity" => TtsControlGroup::Identity,
            "tempo" => TtsControlGroup::Tempo,
            "style" => TtsControlGroup::Style,
            "sampler" => TtsControlGroup::Sampler,
            "steering" => TtsControlGroup::Steering,
            "tempo_rate" | "speed" => TtsControlGroup::Tempo,
            "expressiveness" | "exaggeration" => TtsControlGroup::Style,
            "randomness" | "temperature" | "top_p" | "top_k" | "min_p" | "noise_scale"
            | "noise_scale_w" => TtsControlGroup::Sampler,
            "guidance" | "cfg_weight" | "stability" | "repetition_penalty" | "sdp_ratio"
            | "tau" => TtsControlGroup::Guidance,
            "style_instructions" => TtsControlGroup::Steering,
            _ => TtsControlGroup::Style,
        }
    }

    fn runtime_delivery_support(
        &self,
        model: &RuntimeListenModelCatalogEntry,
    ) -> TtsDeliverySupport {
        let controls = self.runtime_advanced_controls(model);
        TtsDeliverySupport {
            expressiveness_mode: if controls
                .iter()
                .any(|control| control.id == "expressiveness")
            {
                TtsExpressivenessMode::Native
            } else {
                TtsExpressivenessMode::Unsupported
            },
            advanced_controls: controls,
        }
    }

    fn managed_runtime_definition_delivery_support(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> TtsDeliverySupport {
        let mut controls = self.runtime_fallback_advanced_controls_for_target(
            definition.provider_id,
            Some(definition.model_id),
        );
        if definition.supports_instruction_prompt
            && !controls
                .iter()
                .any(|control| control.id == "style_instructions")
        {
            controls.push(Self::instruction_prompt_control(
                "Optional provider-specific speaking instructions passed through to the runtime.",
            ));
        }

        TtsDeliverySupport {
            expressiveness_mode: if controls
                .iter()
                .any(|control| control.id == "expressiveness")
            {
                TtsExpressivenessMode::Native
            } else {
                TtsExpressivenessMode::Unsupported
            },
            advanced_controls: controls,
        }
    }

    fn qwen3_delivery_support(&self, features: Qwen3PackFeatures) -> TtsDeliverySupport {
        TtsDeliverySupport {
            expressiveness_mode: TtsExpressivenessMode::Unsupported,
            advanced_controls: if features.supports_instruction_prompt {
                vec![Self::instruction_prompt_control(
                    "Optional Qwen3 style instruction for 1.7B CustomVoice voices.",
                )]
            } else {
                Vec::new()
            },
        }
    }

    fn sidecar_backend(&self) -> Option<SidecarBackend> {
        self.app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
            .map(|sidecar| sidecar.backend())
    }

    fn mlx_audio_runtime_state(&self) -> RuntimeListenState {
        let providers = MLX_AUDIO_TTS_MODEL_DEFINITIONS
            .iter()
            .filter(|definition| mlx_audio_definition_available(definition))
            .fold(Vec::new(), |mut entries, definition| {
                if entries
                    .iter()
                    .any(|entry: &RuntimeListenProviderCatalogEntry| {
                        entry.id == definition.provider_id
                    })
                {
                    return entries;
                }

                entries.push(RuntimeListenProviderCatalogEntry {
                    id: definition.provider_id.to_string(),
                    label: definition.provider_label.to_string(),
                    description: definition.provider_description.to_string(),
                    source_label: "mlx-audio runtime".to_string(),
                    provider: RuntimeListenProviderDefinition {
                        id: definition.provider_id.to_string(),
                        label: definition.provider_label.to_string(),
                        engine_family: definition.engine_family.to_string(),
                        supported_platforms: vec!["darwin".to_string()],
                        license_label: definition.license_label.map(str::to_string),
                    },
                });
                entries
            });

        let models = MLX_AUDIO_TTS_MODEL_DEFINITIONS
            .iter()
            .filter(|definition| mlx_audio_definition_available(definition))
            .map(|definition| {
                let installed = self.mlx_audio_model_installed(definition);
                RuntimeListenModelCatalogEntry {
                    id: definition.model_id.to_string(),
                    provider_id: definition.provider_id.to_string(),
                    label: definition.label.to_string(),
                    description: definition.description.to_string(),
                    source_label: "mlx-audio runtime".to_string(),
                    capabilities: RuntimeListenCapabilities {
                        supports_basic_tts: true,
                        supports_voice_cloning: definition.supports_voice_cloning,
                        supports_instruction_prompt: definition.supports_instruction_prompt,
                        supports_inline_tags: mlx_audio_model_supports_inline_tags(
                            definition.model_id,
                        ),
                        supports_streaming: false,
                    },
                    readiness: RuntimeListenReadiness {
                        status: if installed {
                            "ready".to_string()
                        } else {
                            "missing".to_string()
                        },
                        runtime_label: "mlx-audio runtime".to_string(),
                        issues: if installed {
                            Vec::new()
                        } else {
                            vec![format!(
                                "{} is available from Hugging Face but is not installed locally yet.",
                                definition.label
                            )]
                        },
                    },
                    supported_languages: definition
                        .supported_languages
                        .iter()
                        .map(|value| value.to_string())
                        .collect(),
                    style_controls: Vec::new(),
                }
            })
            .collect();

        RuntimeListenState {
            providers,
            models,
            selection: None,
        }
    }

    fn managed_runtime_provider_descriptors(&self) -> Vec<ProviderDescriptor> {
        let mut providers = Vec::new();

        for definition in MANAGED_RUNTIME_MODEL_DEFINITIONS {
            if providers
                .iter()
                .any(|provider: &ProviderDescriptor| provider.id == definition.provider_id)
            {
                continue;
            }

            let provider_definitions = MANAGED_RUNTIME_MODEL_DEFINITIONS
                .iter()
                .filter(|candidate| candidate.provider_id == definition.provider_id)
                .collect::<Vec<_>>();

            providers.push(ProviderDescriptor {
                id: definition.provider_id.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: definition.label.to_string(),
                description: format!(
                    "{} Managed by Vox Jot and served through the bundled Speech runtime.",
                    definition.description
                ),
                source_label: "Vox Jot managed runtime".to_string(),
                source_url: definition
                    .hf_repo_id
                    .map(|repo| format!("https://huggingface.co/{repo}")),
                runtime: RuntimeRequirement {
                    id: format!("managed_{}", definition.provider_id),
                    label: "Speech runtime".to_string(),
                    engine_family: definition.engine_family.to_string(),
                    auto_routed: true,
                },
                available: managed_speech_runtime_definition().is_some(),
                local_only: true,
                coming_soon: false,
                license_label: definition.license_label.map(str::to_string),
                capabilities: CapabilityFlags {
                    downloadable: true,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: provider_definitions
                        .iter()
                        .any(|candidate| candidate.supports_voice_cloning),
                    supports_instruction_prompt: provider_definitions
                        .iter()
                        .any(|candidate| candidate.supports_instruction_prompt),
                    supports_inline_tags: provider_definitions
                        .iter()
                        .any(|candidate| candidate.supports_inline_tags),
                    coming_soon: false,
                },
            });
        }

        providers
    }

    fn managed_runtime_placeholder_models(
        &self,
        selected_provider_id: &str,
        selected_model_id: Option<&str>,
    ) -> Vec<CatalogModelDescriptor> {
        MANAGED_RUNTIME_MODEL_DEFINITIONS
            .iter()
            .map(|definition| {
                let installed = self.managed_runtime_model_installed(definition);
                let selected = selected_provider_id == definition.provider_id
                    && selected_model_id == Some(definition.model_id);
                CatalogModelDescriptor {
                    id: definition.model_id.to_string(),
                    provider_id: definition.provider_id.to_string(),
                    domain: ModelDomain::Tts,
                    source_kind: CatalogSourceKind::Builtin,
                    label: definition.label.to_string(),
                    description: definition.description.to_string(),
                    installed,
                    selected,
                    active: selected && installed,
                    runnable: installed,
                    downloadable: true,
                    source_label: "Vox Jot model assets".to_string(),
                    source_url: definition
                        .hf_repo_id
                        .map(|repo| format!("https://huggingface.co/{repo}")),
                    runtime: RuntimeRequirement {
                        id: format!("managed_{}", definition.provider_id),
                        label: "Speech runtime".to_string(),
                        engine_family: definition.engine_family.to_string(),
                        auto_routed: true,
                    },
                    license_label: definition.license_label.map(str::to_string),
                    locale: definition.locale.map(str::to_string),
                    supported_languages: definition
                        .supported_languages
                        .iter()
                        .map(|value| value.to_string())
                        .collect(),
                    readiness_status: Some(if installed { "ready" } else { "missing" }.to_string()),
                    readiness_issues: if installed {
                        Vec::new()
                    } else {
                        vec![format!(
                            "{} is available to download and Vox Jot will install the required Speech runtime automatically.",
                            definition.label
                        )]
                    },
                    capabilities: CapabilityFlags {
                        downloadable: true,
                        loadable: true,
                        local_only: true,
                        supports_translation: false,
                        supports_streaming: false,
                        supports_voice_cloning: definition.supports_voice_cloning,
                        supports_instruction_prompt: definition.supports_instruction_prompt,
                        supports_inline_tags: definition.supports_inline_tags,
                        coming_soon: false,
                    },
                    delivery_support: self.managed_runtime_definition_delivery_support(definition),
                }
            })
            .collect()
    }

    fn local_binary_provider_descriptors(&self, settings: &AppSettings) -> Vec<ProviderDescriptor> {
        let mut descriptors = Vec::new();

        let lfm_capabilities = CapabilityFlags {
            downloadable: true,
            loadable: true,
            local_only: true,
            supports_translation: false,
            supports_streaming: false,
            supports_voice_cloning: false,
            supports_instruction_prompt: false,
            supports_inline_tags: false,
            coming_soon: false,
        };
        let lfm_runtime = RuntimeRequirement {
            id: "lfm_audio_gguf".to_string(),
            label: "LFM Audio native runner".to_string(),
            engine_family: "lfm_audio_gguf".to_string(),
            auto_routed: true,
        };
        descriptors.push(ProviderDescriptor {
            id: TTS_PROVIDER_LFM_AUDIO_GGUF_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Builtin,
            label: "LFM Audio (GGUF)".to_string(),
            description:
                "Liquid LFM2.5-Audio 1.5B running through the bundled native llama-liquid-audio runner."
                    .to_string(),
            source_label: "Vox Jot model assets".to_string(),
            source_url: Some("https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B".to_string()),
            runtime: lfm_runtime,
            available: self.ensure_lfm_audio_gguf_supported().is_ok(),
            local_only: true,
            coming_soon: false,
            license_label: Some("LFM Open License v1.0".to_string()),
            capabilities: lfm_capabilities,
        });

        let vv_capabilities = CapabilityFlags {
            downloadable: true,
            loadable: true,
            local_only: true,
            supports_translation: false,
            supports_streaming: false,
            supports_voice_cloning: false,
            supports_instruction_prompt: false,
            supports_inline_tags: false,
            coming_soon: false,
        };
        let vv_runtime = RuntimeRequirement {
            id: "vibevoice".to_string(),
            label: "VibeVoice Python bridge".to_string(),
            engine_family: "vibevoice".to_string(),
            auto_routed: true,
        };
        descriptors.push(ProviderDescriptor {
            id: TTS_PROVIDER_VIBEVOICE_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Builtin,
            label: "VibeVoice (Experimental)".to_string(),
            description:
                "Microsoft VibeVoice-Realtime 0.5B via PyTorch/MPS bridge. Research license — enable Labs to use."
                    .to_string(),
            source_label: "Research-licensed model".to_string(),
            source_url: Some("https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B".to_string()),
            runtime: vv_runtime,
            available: settings.experimental_enabled
                && self.ensure_vibevoice_supported(settings).is_ok(),
            local_only: true,
            coming_soon: false,
            license_label: Some("Research-only".to_string()),
            capabilities: vv_capabilities,
        });

        descriptors
    }

    fn local_binary_catalog_models(
        &self,
        settings: &AppSettings,
        selected_provider_id: &str,
        selected_model_id: Option<&str>,
    ) -> Vec<CatalogModelDescriptor> {
        let mut models = Vec::new();

        let lfm_installed =
            crate::lfm_audio_gguf::LfmAudioGgufContext::from_managed_store(&self.app_handle)
                .map(|ctx| ctx.is_ready())
                .unwrap_or(false);
        let lfm_selected = selected_provider_id == TTS_PROVIDER_LFM_AUDIO_GGUF_ID
            && selected_model_id == Some(TTS_MODEL_LFM_AUDIO_GGUF_DEFAULT_ID);
        models.push(CatalogModelDescriptor {
            id: TTS_MODEL_LFM_AUDIO_GGUF_DEFAULT_ID.to_string(),
            provider_id: TTS_PROVIDER_LFM_AUDIO_GGUF_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Builtin,
            label: "LFM2.5 Audio 1.5B (Q4_0 GGUF)".to_string(),
            description: "Quantized Liquid Audio model running through a native CLI runner."
                .to_string(),
            installed: lfm_installed,
            selected: lfm_selected,
            active: lfm_selected && lfm_installed,
            runnable: lfm_installed,
            downloadable: true,
            source_label: "Vox Jot model assets".to_string(),
            source_url: Some(
                "https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B".to_string(),
            ),
            runtime: RuntimeRequirement {
                id: "lfm_audio_gguf".to_string(),
                label: "LFM Audio native runner".to_string(),
                engine_family: "lfm_audio_gguf".to_string(),
                auto_routed: true,
            },
            license_label: Some("LFM Open License v1.0".to_string()),
            locale: Some("en".to_string()),
            supported_languages: vec!["en".to_string()],
            readiness_status: Some(if lfm_installed { "ready" } else { "missing" }.to_string()),
            readiness_issues: if lfm_installed {
                Vec::new()
            } else {
                vec![
                    "Download the LFM2.5 Audio GGUF assets from Hugging Face to install the Q4_0 model and macOS runner."
                        .to_string(),
                ]
            },
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
            delivery_support: self.builtin_delivery_support(TTS_PROVIDER_LFM_AUDIO_GGUF_ID),
        });

        let vv_dir_ok = crate::storage_paths::vibevoice_dir(&self.app_handle)
            .ok()
            .map(|dir| dir.join("model.safetensors").exists())
            .unwrap_or(false);
        let vv_installed = vv_dir_ok && settings.experimental_enabled;
        let vv_selected = selected_provider_id == TTS_PROVIDER_VIBEVOICE_ID
            && selected_model_id == Some(TTS_MODEL_VIBEVOICE_DEFAULT_ID);
        models.push(CatalogModelDescriptor {
            id: TTS_MODEL_VIBEVOICE_DEFAULT_ID.to_string(),
            provider_id: TTS_PROVIDER_VIBEVOICE_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Builtin,
            label: "VibeVoice Realtime 0.5B".to_string(),
            description:
                "Research-only VibeVoice. Requires Labs flag and a Python venv with torch + transformers + soundfile."
                    .to_string(),
            installed: vv_installed,
            selected: vv_selected,
            active: vv_selected && vv_installed,
            runnable: vv_installed,
            downloadable: true,
            source_label: "Research-licensed model".to_string(),
            source_url: Some("https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B".to_string()),
            runtime: RuntimeRequirement {
                id: "vibevoice".to_string(),
                label: "VibeVoice Python bridge".to_string(),
                engine_family: "vibevoice".to_string(),
                auto_routed: true,
            },
            license_label: Some("Research-only".to_string()),
            locale: None,
            supported_languages: Vec::new(),
            readiness_status: Some(
                if vv_installed {
                    "ready"
                } else if !settings.experimental_enabled {
                    "experimental"
                } else {
                    "missing"
                }
                .to_string(),
            ),
            readiness_issues: if vv_installed {
                Vec::new()
            } else if !settings.experimental_enabled {
                vec![
                    "Enable experimental features in Settings → Labs to use VibeVoice."
                        .to_string(),
                ]
            } else {
                vec![
                    "Download the VibeVoice files from Hugging Face, then run speech-runtime/install_vibevoice_deps.sh if the Python runtime is not prepared yet."
                        .to_string(),
                ]
            },
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
            delivery_support: self.builtin_delivery_support(TTS_PROVIDER_VIBEVOICE_ID),
        });

        models
    }

    fn resolved_preset_for_request(
        &self,
        settings: &AppSettings,
        request: &SpeakRequest,
    ) -> Option<TtsVoicePreset> {
        request
            .inline_preset
            .clone()
            .or_else(|| {
                request
                    .preset_id
                    .as_deref()
                    .and_then(|preset_id| settings.tts_preset(preset_id).cloned())
            })
            .or_else(|| settings.active_tts_preset().cloned())
    }

    pub fn selected_provider_id(&self, settings: &AppSettings) -> String {
        if let Some(preset) = settings.explicit_active_tts_preset() {
            if !preset.provider_id.trim().is_empty() {
                return preset.provider_id.clone();
            }
        }
        if !settings.selected_tts_provider_id.trim().is_empty() {
            return settings.selected_tts_provider_id.clone();
        }

        match settings.tts_engine_preference {
            TtsEnginePreference::System => TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
            TtsEnginePreference::SherpaOnnx => TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
            TtsEnginePreference::Sidecar => TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
            TtsEnginePreference::Auto => {
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                {
                    TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string()
                }
                #[cfg(target_os = "linux")]
                {
                    TTS_PROVIDER_SHERPA_PACK_ID.to_string()
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
                {
                    TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string()
                }
            }
        }
    }

    pub fn selected_model_id(&self, settings: &AppSettings) -> Option<String> {
        if let Some(preset) = settings.explicit_active_tts_preset() {
            if !preset.model_id.trim().is_empty() {
                return Some(preset.model_id.clone());
            }
        }
        settings
            .selected_tts_model_id
            .clone()
            .or_else(|| settings.selected_tts_voice_id.clone())
            .or_else(|| settings.tts_default_voice_id.clone())
            .or_else(|| {
                let provider_id = self.selected_provider_id(settings);
                match provider_id.as_str() {
                    TTS_PROVIDER_SYSTEM_BUILTIN_ID => Some(TTS_MODEL_SYSTEM_DEFAULT_ID.to_string()),
                    TTS_PROVIDER_LOCAL_SIDECAR_API_ID => {
                        Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string())
                    }
                    _ => None,
                }
            })
    }

    pub async fn domain_catalog(&self, settings: &AppSettings) -> DomainCatalog {
        let requested_provider_id = self.selected_provider_id(settings);
        let requested_model_id = self.selected_model_id(settings);
        let runtime_listen_state = self.fetch_runtime_listen_state().await;
        let runtime_provider_ids = runtime_listen_state
            .as_ref()
            .map(|state| {
                state
                    .providers
                    .iter()
                    .map(|provider| provider.id.clone())
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        let runtime_selected_provider_id = runtime_listen_state
            .as_ref()
            .and_then(|state| state.selection.as_ref())
            .and_then(|selection| selection.selected_provider_id.clone());
        let runtime_selected_model_id = runtime_listen_state
            .as_ref()
            .and_then(|state| state.selection.as_ref())
            .and_then(|selection| selection.selected_model_id.clone());
        let selected_provider_id = if runtime_listen_state.is_some()
            && (requested_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                || runtime_provider_ids.contains(&requested_provider_id))
        {
            runtime_selected_provider_id.unwrap_or(requested_provider_id.clone())
        } else {
            requested_provider_id.clone()
        };
        let selected_model_id = if runtime_listen_state.is_some()
            && (requested_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                || runtime_provider_ids.contains(&requested_provider_id))
        {
            runtime_selected_model_id.or(requested_model_id.clone())
        } else {
            requested_model_id.clone()
        };
        let runtime_catalog_available = runtime_listen_state
            .as_ref()
            .map(|state| !state.models.is_empty())
            .unwrap_or(false);
        let show_local_sidecar_api = std::env::var("VOX_JOT_ENABLE_LOCAL_SIDECAR_API")
            .ok()
            .as_deref()
            == Some("1");

        let system_runtime = RuntimeRequirement {
            id: "system_tts".to_string(),
            label: "OS speech runtime".to_string(),
            engine_family: "system".to_string(),
            auto_routed: true,
        };
        let sherpa_runtime = RuntimeRequirement {
            id: "sherpa_onnx".to_string(),
            label: "Sherpa ONNX offline runtime".to_string(),
            engine_family: "sherpa_onnx".to_string(),
            auto_routed: true,
        };
        let sidecar_runtime = RuntimeRequirement {
            id: "local_sidecar_api".to_string(),
            label: "Local speech API runtime".to_string(),
            engine_family: "sidecar".to_string(),
            auto_routed: true,
        };

        let qwen3_capabilities = CapabilityFlags {
            downloadable: true,
            loadable: true,
            local_only: true,
            supports_translation: false,
            supports_streaming: true,
            supports_voice_cloning: true,
            supports_instruction_prompt: true,
            supports_inline_tags: false,
            coming_soon: false,
        };
        let qwen3_models = QWEN3_PACK_DEFINITIONS.iter().collect::<Vec<_>>();

        let mut providers = vec![
            ProviderDescriptor {
                id: TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "System Built-In".to_string(),
                description:
                    "Use platform speech synthesis and choose from installed system voices."
                        .to_string(),
                source_label: "Platform runtime".to_string(),
                source_url: None,
                runtime: system_runtime.clone(),
                available: self.ensure_system_engine_supported().is_ok(),
                local_only: true,
                coming_soon: false,
                license_label: None,
                capabilities: CapabilityFlags {
                    downloadable: false,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            },
            ProviderDescriptor {
                id: TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "Sherpa Pack".to_string(),
                description:
                    "Use Vox Jot-managed offline voice packs with automatic local runtime routing."
                        .to_string(),
                source_label: "Vox Jot curated assets".to_string(),
                source_url: Some(
                    "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models".to_string(),
                ),
                runtime: sherpa_runtime.clone(),
                available: true,
                local_only: true,
                coming_soon: false,
                license_label: Some("Sherpa ONNX model assets".to_string()),
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
            },
        ];

        if !runtime_catalog_available && show_local_sidecar_api {
            providers.push(ProviderDescriptor {
                id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "Local Sidecar API".to_string(),
                description:
                    "Route speech to a local OpenAI-compatible speech endpoint managed outside the app."
                        .to_string(),
                source_label: "User-managed local endpoint".to_string(),
                source_url: None,
                runtime: sidecar_runtime.clone(),
                available: self.ensure_sidecar_supported(settings).is_ok(),
                local_only: true,
                coming_soon: false,
                license_label: None,
                capabilities: CapabilityFlags {
                    downloadable: false,
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

        providers.push(ProviderDescriptor {
            id: TTS_PROVIDER_QWEN3_NATIVE_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Builtin,
            label: "Qwen3 Native".to_string(),
            description:
                "Native Qwen3 runtime with preset voices, instructions, and cloning support."
                    .to_string(),
            source_label: "Provider-hosted model weights".to_string(),
            source_url: Some("https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base".to_string()),
            runtime: RuntimeRequirement {
                id: "qwen3_native".to_string(),
                label: "Qwen3 native runtime".to_string(),
                engine_family: "qwen3".to_string(),
                auto_routed: true,
            },
            available: qwen3_runtime_definition().is_some(),
            local_only: true,
            coming_soon: false,
            license_label: Some("Apache-2.0".to_string()),
            capabilities: qwen3_capabilities.clone(),
        });

        providers.extend(self.managed_runtime_provider_descriptors());
        providers.extend(self.local_binary_provider_descriptors(settings));

        let mut models = vec![CatalogModelDescriptor {
            id: TTS_MODEL_SYSTEM_DEFAULT_ID.to_string(),
            provider_id: TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Builtin,
            label: "System Voices".to_string(),
            description: "Uses the operating system voice inventory.".to_string(),
            installed: true,
            selected: selected_provider_id == TTS_PROVIDER_SYSTEM_BUILTIN_ID
                && selected_model_id.as_deref() == Some(TTS_MODEL_SYSTEM_DEFAULT_ID),
            active: selected_provider_id == TTS_PROVIDER_SYSTEM_BUILTIN_ID
                && selected_model_id.as_deref() == Some(TTS_MODEL_SYSTEM_DEFAULT_ID),
            runnable: true,
            downloadable: false,
            source_label: "Platform runtime".to_string(),
            source_url: None,
            runtime: system_runtime,
            license_label: None,
            locale: None,
            supported_languages: Vec::new(),
            readiness_status: Some("ready".to_string()),
            readiness_issues: Vec::new(),
            capabilities: CapabilityFlags {
                downloadable: false,
                loadable: true,
                local_only: true,
                supports_translation: false,
                supports_streaming: false,
                supports_voice_cloning: false,
                supports_instruction_prompt: false,
                supports_inline_tags: false,
                coming_soon: false,
            },
            delivery_support: self.builtin_delivery_support(TTS_PROVIDER_SYSTEM_BUILTIN_ID),
        }];

        if !runtime_catalog_available && show_local_sidecar_api {
            models.push(CatalogModelDescriptor {
                id: TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string(),
                provider_id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "OpenAI-Compatible Speech API".to_string(),
                description: "Routes synthesis to the configured local speech endpoint."
                    .to_string(),
                installed: true,
                selected: selected_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                    && selected_model_id.as_deref() == Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID),
                active: selected_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                    && selected_model_id.as_deref() == Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID),
                runnable: self.ensure_sidecar_supported(settings).is_ok(),
                downloadable: false,
                source_label: "User-managed local endpoint".to_string(),
                source_url: None,
                runtime: sidecar_runtime.clone(),
                license_label: None,
                locale: None,
                supported_languages: Vec::new(),
                readiness_status: Some("ready".to_string()),
                readiness_issues: Vec::new(),
                capabilities: CapabilityFlags {
                    downloadable: false,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
                delivery_support: self.builtin_delivery_support(TTS_PROVIDER_LOCAL_SIDECAR_API_ID),
            });
        }

        models.extend(self.managed_runtime_placeholder_models(
            &selected_provider_id,
            selected_model_id.as_deref(),
        ));
        models.extend(self.local_binary_catalog_models(
            settings,
            &selected_provider_id,
            selected_model_id.as_deref(),
        ));

        models.extend(
            qwen3_models
                .into_iter()
                .map(|pack| {
                    let installed = self.installed_pack_root(pack.id).is_some();
                    let selected = selected_provider_id == TTS_PROVIDER_QWEN3_NATIVE_ID
                        && selected_model_id.as_deref() == Some(pack.id);
                    let features = self.qwen3_pack_features(pack);
                    let mut capabilities = qwen3_capabilities.clone();
                    capabilities.supports_voice_cloning = features.supports_voice_cloning;
                    capabilities.supports_instruction_prompt = features.supports_instruction_prompt;
                    CatalogModelDescriptor {
                        id: pack.id.to_string(),
                        provider_id: TTS_PROVIDER_QWEN3_NATIVE_ID.to_string(),
                        domain: ModelDomain::Tts,
                        source_kind: CatalogSourceKind::Builtin,
                        label: pack.label.to_string(),
                        description: features.description.to_string(),
                        installed,
                        selected,
                        active: selected && installed,
                        runnable: installed,
                        downloadable: true,
                        source_label: "Vox Jot model assets".to_string(),
                        source_url: pack
                            .hf_repo_id
                            .map(|repo| format!("https://huggingface.co/{repo}")),
                        runtime: RuntimeRequirement {
                            id: "qwen3_native".to_string(),
                            label: "Qwen3 native runtime".to_string(),
                            engine_family: "qwen3".to_string(),
                            auto_routed: true,
                        },
                        license_label: Some("Apache-2.0".to_string()),
                        locale: Some(pack.locale.to_string()),
                        supported_languages: vec![pack.locale.to_string()],
                        readiness_status: Some(if installed { "ready" } else { "missing" }.to_string()),
                        readiness_issues: if installed {
                            Vec::new()
                        } else {
                            vec![format!(
                                "{} is available from Vox Jot model assets, but it has not been installed locally yet.",
                                pack.label
                            )]
                        },
                        capabilities,
                        delivery_support: self.qwen3_delivery_support(features),
                    }
                }),
        );

        models.extend(self.get_available_packs().into_iter().map(|pack| {
            let selected = selected_provider_id == TTS_PROVIDER_SHERPA_PACK_ID
                && selected_model_id.as_deref() == Some(pack.id.as_str());
            CatalogModelDescriptor {
                id: pack.id.clone(),
                provider_id: TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: pack.label.clone(),
                description: format!("Offline pack for {}", pack.locale),
                installed: pack.installed,
                selected,
                active: selected && pack.installed,
                runnable: pack.installed,
                downloadable: true,
                source_label: "Vox Jot curated assets".to_string(),
                source_url: Some(pack.source_url.clone()),
                runtime: sherpa_runtime.clone(),
                license_label: Some("Sherpa ONNX model assets".to_string()),
                locale: Some(pack.locale.clone()),
                supported_languages: vec![pack.locale.clone()],
                readiness_status: Some(
                    if pack.installed { "ready" } else { "missing" }.to_string(),
                ),
                readiness_issues: if pack.installed {
                    Vec::new()
                } else {
                    vec![format!(
                        "{} is listed in Vox Jot but not downloaded yet.",
                        pack.label
                    )]
                },
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
                delivery_support: self.builtin_delivery_support(TTS_PROVIDER_SHERPA_PACK_ID),
            }
        }));

        if let Some(runtime_state) = runtime_listen_state {
            let current_platform = current_runtime_platform_id();
            let runtime_models = runtime_state
                .models
                .into_iter()
                .filter(|model| {
                    model.capabilities.supports_basic_tts
                        && !HIDDEN_RUNTIME_MODEL_IDS.contains(&model.id.as_str())
                })
                .collect::<Vec<_>>();
            let runtime_provider_ids = runtime_models
                .iter()
                .map(|model| model.provider_id.clone())
                .collect::<std::collections::HashSet<_>>();

            for provider in runtime_state.providers.into_iter().filter(|provider| {
                provider
                    .provider
                    .supported_platforms
                    .iter()
                    .any(|platform| platform.eq_ignore_ascii_case(current_platform))
                    && runtime_provider_ids.contains(&provider.id)
            }) {
                let provider_models = runtime_models
                    .iter()
                    .filter(|model| model.provider_id == provider.id)
                    .collect::<Vec<_>>();
                let descriptor = ProviderDescriptor {
                    id: provider.id.clone(),
                    domain: ModelDomain::Tts,
                    source_kind: CatalogSourceKind::Runtime,
                    label: provider.label.clone(),
                    description: provider.description.clone(),
                    source_label: provider.source_label.clone(),
                    source_url: None,
                    runtime: RuntimeRequirement {
                        id: format!("runtime_{}", provider.provider.id),
                        label: format!("{} runtime", provider.provider.label),
                        engine_family: provider.provider.engine_family.clone(),
                        auto_routed: true,
                    },
                    available: true,
                    local_only: true,
                    coming_soon: false,
                    license_label: provider.provider.license_label.clone(),
                    capabilities: CapabilityFlags {
                        downloadable: provider_is_mlx_audio(&provider.id),
                        loadable: true,
                        local_only: true,
                        supports_translation: false,
                        supports_streaming: provider_models
                            .iter()
                            .any(|model| model.capabilities.supports_streaming),
                        supports_voice_cloning: provider_models
                            .iter()
                            .any(|model| model.capabilities.supports_voice_cloning),
                        supports_instruction_prompt: provider_models
                            .iter()
                            .any(|model| model.capabilities.supports_instruction_prompt),
                        supports_inline_tags: provider_models
                            .iter()
                            .any(|model| model.capabilities.supports_inline_tags),
                        coming_soon: false,
                    },
                };

                if let Some(existing) = providers.iter_mut().find(|item| item.id == descriptor.id) {
                    *existing = descriptor;
                } else {
                    providers.push(descriptor);
                }
            }

            let runtime_provider_map = providers
                .iter()
                .filter(|provider| provider.source_kind == CatalogSourceKind::Runtime)
                .map(|provider| (provider.id.clone(), provider))
                .collect::<std::collections::HashMap<_, _>>();

            models.extend(runtime_models.into_iter().filter_map(|model| {
                let provider = runtime_provider_map.get(&model.provider_id)?;
                let selected = selected_provider_id == model.provider_id
                    && selected_model_id.as_deref() == Some(model.id.as_str());
                let is_mlx_runtime_model = provider_is_mlx_audio(&model.provider_id);
                let source_url = mlx_audio_tts_model_definition(&model.id)
                    .map(|definition| format!("https://huggingface.co/{}", definition.hf_model_id));
                let installed = !model.readiness.status.eq_ignore_ascii_case("missing");
                let runnable = model.readiness.status.eq_ignore_ascii_case("ready");
                Some(CatalogModelDescriptor {
                    id: model.id.clone(),
                    provider_id: model.provider_id.clone(),
                    domain: ModelDomain::Tts,
                    source_kind: CatalogSourceKind::Runtime,
                    label: model.label.clone(),
                    description: model.description.clone(),
                    installed,
                    selected,
                    active: selected && runnable,
                    runnable,
                    downloadable: is_mlx_runtime_model,
                    source_label: model.source_label.clone(),
                    source_url,
                    runtime: RuntimeRequirement {
                        id: provider.runtime.id.clone(),
                        label: model.readiness.runtime_label.clone(),
                        engine_family: provider.runtime.engine_family.clone(),
                        auto_routed: true,
                    },
                    license_label: provider.license_label.clone(),
                    locale: None,
                    supported_languages: model.supported_languages.clone(),
                    readiness_status: Some(model.readiness.status.clone()),
                    readiness_issues: model.readiness.issues.clone(),
                    capabilities: CapabilityFlags {
                        downloadable: is_mlx_runtime_model,
                        loadable: true,
                        local_only: true,
                        supports_translation: false,
                        supports_streaming: model.capabilities.supports_streaming,
                        supports_voice_cloning: model.capabilities.supports_voice_cloning,
                        supports_instruction_prompt: model.capabilities.supports_instruction_prompt,
                        supports_inline_tags: model.capabilities.supports_inline_tags,
                        coming_soon: false,
                    },
                    delivery_support: self.runtime_delivery_support(&model),
                })
            }));

            let mut deduped_models: Vec<CatalogModelDescriptor> = Vec::with_capacity(models.len());
            for model in models.into_iter() {
                if let Some(existing) = deduped_models
                    .iter_mut()
                    .find(|item| item.id == model.id && item.provider_id == model.provider_id)
                {
                    let prefer_runtime = model.source_kind == CatalogSourceKind::Runtime
                        || (!existing.installed && model.installed);
                    if prefer_runtime {
                        *existing = model;
                    }
                } else {
                    deduped_models.push(model);
                }
            }
            models = deduped_models;
        }

        DomainCatalog { providers, models }
    }

    async fn fetch_runtime_listen_state(&self) -> Option<RuntimeListenState> {
        if self.sidecar_backend() == Some(SidecarBackend::MlxAudio) {
            return Some(self.mlx_audio_runtime_state());
        }

        if let Some(sidecar) = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
        {
            let sidecar = Arc::clone(&*sidecar);
            let sidecar_result =
                tokio::task::spawn_blocking(move || sidecar.ensure_running_if_available())
                    .await
                    .ok()?;

            if let Err(err) = sidecar_result {
                warn!("Speech runtime sidecar catalog auto-start failed: {err}");
            }
        }

        let root_url = self.sidecar_root_url()?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .ok()?;

        let catalog = client
            .get(root_url.join("listen/catalog").ok()?)
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .json::<RuntimeListenCatalogResponse>()
            .await
            .ok()?;

        Some(RuntimeListenState {
            providers: catalog.providers,
            models: catalog.models,
            selection: Some(catalog.selection),
        })
    }

    pub async fn sync_runtime_selection(
        &self,
        provider_id: &str,
        model_id: &str,
        profile_id: Option<&str>,
    ) -> Result<(), String> {
        if provider_is_mlx_audio(provider_id)
            && self.sidecar_backend() == Some(SidecarBackend::MlxAudio)
        {
            return Ok(());
        }

        let root_url = self
            .sidecar_root_url()
            .ok_or_else(|| "Failed to resolve the local speech runtime URL.".to_string())?;
        let payload = serde_json::json!({
            "provider_id": provider_id,
            "model_id": model_id,
            "profile_id": profile_id,
        });

        let response = reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
            .map_err(|err| format!("Failed to create runtime client: {err}"))?
            .post(
                root_url
                    .join("listen/selection")
                    .map_err(|err| format!("Failed to build runtime selection URL: {err}"))?,
            )
            .json(&payload)
            .send()
            .await
            .map_err(|err| format!("Failed to save runtime selection: {err}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let detail = body.trim();
            return Err(if detail.is_empty() {
                format!("Runtime selection update failed with HTTP {}.", status)
            } else {
                format!(
                    "Runtime selection update failed with HTTP {}: {}",
                    status, detail
                )
            });
        }

        Ok(())
    }

    fn sidecar_root_url(&self) -> Option<reqwest::Url> {
        self.sidecar_request_url("/")
    }

    fn sidecar_request_url(&self, path: &str) -> Option<reqwest::Url> {
        sidecar_request_url_from_base(&self.sidecar_base_url(), path)
    }

    fn ensure_sidecar_running_blocking(&self, provider_id: &str) -> Result<(), String> {
        if let Some(sidecar) = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
        {
            if provider_uses_managed_speech_runtime(provider_id) {
                sidecar.ensure_speech_runtime()?;
            } else if sidecar.backend() == SidecarBackend::MlxAudio {
                sidecar.ensure_running()?;
            } else {
                sidecar.ensure_running_if_available()?;
            }
        }
        Ok(())
    }

    fn fetch_runtime_listen_voices(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> Result<Vec<VoiceInfo>, String> {
        if provider_is_mlx_audio(provider_id)
            && self.sidecar_backend() == Some(SidecarBackend::MlxAudio)
        {
            return Ok(Vec::new());
        }

        self.ensure_sidecar_running_blocking(provider_id)?;

        let root_url = self
            .sidecar_root_url()
            .ok_or_else(|| "Failed to resolve the local speech runtime URL.".to_string())?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|err| format!("Failed to create runtime client: {err}"))?;
        let url = root_url
            .join("listen/voices")
            .map_err(|err| format!("Failed to build runtime voice URL: {err}"))?;

        let response = client
            .get(url)
            .query(&[
                ("provider_id", provider_id),
                ("model_id", model_id.unwrap_or("")),
            ])
            .send()
            .map_err(|err| format!("Failed to fetch runtime voice inventory: {err}"))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            warn!(
                "Speech runtime does not expose /listen/voices yet for provider '{}' model '{}'; returning an empty voice inventory.",
                provider_id,
                model_id.unwrap_or("")
            );
            return Ok(Vec::new());
        }

        if !response.status().is_success() {
            let body = response.text().unwrap_or_default();
            let detail = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|value| {
                    value
                        .get("detail")
                        .and_then(|detail| detail.as_str().map(str::to_string))
                })
                .unwrap_or(body);
            return Err(format!("Failed to fetch runtime voices: {detail}"));
        }

        let runtime_voices = response
            .json::<Vec<RuntimeListenVoiceEntry>>()
            .map_err(|err| format!("Failed to decode runtime voice inventory: {err}"))?;

        Ok(runtime_voices
            .into_iter()
            .map(|voice| VoiceInfo {
                id: voice.id,
                label: voice.label,
                locale: voice.locale,
                engine: TtsEngineKind::Sidecar,
                installed: voice.installed,
                available: voice.available,
            })
            .collect())
    }

    fn runtime_managed_voices(&self, settings: &AppSettings) -> Result<Vec<VoiceInfo>, String> {
        let provider_id = self.selected_provider_id(settings);
        if !provider_uses_managed_speech_runtime(&provider_id) {
            return Ok(Vec::new());
        }

        let model_id = self.selected_model_id(settings);
        self.fetch_runtime_listen_voices(&provider_id, model_id.as_deref())
    }

    pub async fn download_pack(&self, pack_id: &str) -> Result<(), String> {
        if let Some(definition) = PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == pack_id)
        {
            let install_dir = self.pack_install_dir(definition.id);
            self.download_and_extract_archive(
                &[
                    self.asset_download_url(definition.archive_name),
                    definition.source_url.to_string(),
                ],
                &install_dir,
                &format!("TTS pack '{}'", definition.label),
            )
            .await?;

            let pack_root = self.installed_pack_root(definition.id).ok_or_else(|| {
                format!(
                    "Downloaded TTS pack '{}' could not be located",
                    definition.id
                )
            })?;
            self.write_default_pack_manifest(definition, &pack_root)?;
            let _ = self.ensure_sherpa_runtime_installed().await?;
            return Ok(());
        }

        if let Some(definition) = QWEN3_PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == pack_id)
        {
            return self.install_qwen3_pack(definition).await;
        }

        if let Some(definition) = mlx_audio_tts_model_definition(pack_id) {
            return self.install_mlx_audio_model(definition).await;
        }

        if let Some(definition) = self.managed_runtime_model_definition(pack_id) {
            return self.install_managed_runtime_model(definition).await;
        }

        if pack_id == TTS_MODEL_LFM_AUDIO_GGUF_DEFAULT_ID {
            return self.install_lfm_audio_gguf_model().await;
        }

        if pack_id == TTS_MODEL_VIBEVOICE_DEFAULT_ID {
            return self.install_vibevoice_model().await;
        }

        Err(format!("Unknown TTS pack '{pack_id}'"))
    }

    pub fn remove_pack(&self, pack_id: &str) -> Result<(), String> {
        self.ensure_pack_not_in_use_for_delete(pack_id)?;

        if pack_id == TTS_MODEL_LFM_AUDIO_GGUF_DEFAULT_ID {
            let install_dir = crate::storage_paths::lfm_audio_gguf_dir(&self.app_handle)
                .map_err(|err| format!("Failed to resolve LFM Audio install dir: {err}"))?;
            if install_dir.exists() {
                fs::remove_dir_all(&install_dir)
                    .map_err(|err| format!("Failed to remove LFM Audio assets: {err}"))?;
            }
            self.prune_tts_presets_for_removed_pack(pack_id);
            return Ok(());
        }

        if pack_id == TTS_MODEL_VIBEVOICE_DEFAULT_ID {
            let install_dir = crate::storage_paths::vibevoice_dir(&self.app_handle)
                .map_err(|err| format!("Failed to resolve VibeVoice install dir: {err}"))?;
            if install_dir.exists() {
                fs::remove_dir_all(&install_dir)
                    .map_err(|err| format!("Failed to remove VibeVoice assets: {err}"))?;
            }
            self.prune_tts_presets_for_removed_pack(pack_id);
            return Ok(());
        }

        if let Some(definition) = mlx_audio_tts_model_definition(pack_id) {
            let install_dir = self.mlx_audio_model_install_dir(definition);
            if install_dir.exists() {
                fs::remove_dir_all(&install_dir).map_err(|err| {
                    format!(
                        "Failed to remove MLX TTS model '{}': {err}",
                        definition.model_id
                    )
                })?;
            }
            self.prune_tts_presets_for_removed_pack(pack_id);
            return Ok(());
        }

        if let Some(definition) = self.managed_runtime_model_definition(pack_id) {
            let install_dir = self.managed_runtime_model_install_dir(definition);
            if install_dir.exists() {
                fs::remove_dir_all(&install_dir).map_err(|err| {
                    format!(
                        "Failed to remove downloaded runtime model '{}': {err}",
                        definition.model_id
                    )
                })?;
            }
            self.prune_tts_presets_for_removed_pack(pack_id);
            return Ok(());
        }

        // Pack ids that look like HF repo slugs (`<author>/<name>`) come from
        // the verified TTS collection augmenter. Route them to the per-repo
        // install dir under `models/tts/store/hf/`.
        if pack_id.contains('/') {
            if let Ok(hf_root) = crate::storage_paths::tts_hf_models_dir(&self.app_handle) {
                let sanitized: String = pack_id
                    .chars()
                    .map(|c| {
                        if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                            c
                        } else {
                            '_'
                        }
                    })
                    .collect();
                let install_dir = hf_root.join(&sanitized);
                if install_dir.exists() {
                    fs::remove_dir_all(&install_dir).map_err(|err| {
                        format!("Failed to remove HF TTS model '{}': {err}", pack_id)
                    })?;
                }
                self.prune_tts_presets_for_removed_pack(pack_id);
                return Ok(());
            }
        }

        let install_dir = self.pack_install_dir(pack_id);
        if install_dir.exists() {
            fs::remove_dir_all(&install_dir)
                .map_err(|err| format!("Failed to remove TTS pack: {err}"))?;
        }
        self.prune_tts_presets_for_removed_pack(pack_id);
        Ok(())
    }

    fn prune_tts_presets_for_removed_pack(&self, pack_id: &str) {
        let mut settings = get_settings(&self.app_handle);
        let selected_removed_model = settings.selected_tts_model_id.as_deref() == Some(pack_id);
        let removed_presets = settings.delete_tts_presets_for_model(pack_id);
        let fallback_to_system = selected_removed_model
            && settings.selected_tts_model_id.is_none()
            && settings.explicit_active_tts_preset().is_none();

        if fallback_to_system {
            settings.selected_tts_provider_id = TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string();
            settings.selected_tts_model_id = Some(TTS_MODEL_SYSTEM_DEFAULT_ID.to_string());
            settings.selected_tts_profile_id = None;
            settings.selected_tts_voice_id = None;
            settings.tts_default_voice_id = None;
            settings.tts_engine_preference = TtsEnginePreference::System;
        }

        if removed_presets > 0 || selected_removed_model || fallback_to_system {
            if removed_presets > 0 {
                info!(
                    "Removed {} saved TTS voice preset(s) that referenced deleted model '{}'",
                    removed_presets, pack_id
                );
            }
            write_settings(&self.app_handle, settings.clone());
            let _ = self.app_handle.emit("settings-changed", settings);
        }
    }

    pub async fn speak(&self, request: SpeakRequest) -> Result<(), String> {
        let settings = get_settings(&self.app_handle);
        let selected_preset = self.resolved_preset_for_request(&settings, &request);
        let mut effective_settings = settings.clone();
        if let Some(preset) = selected_preset.as_ref() {
            effective_settings.tts_active_preset_id = None;
            effective_settings.selected_tts_provider_id = preset.provider_id.clone();
            effective_settings.selected_tts_model_id = Some(preset.model_id.clone());
            effective_settings.selected_tts_profile_id = preset.voice_profile_id.clone();
            effective_settings.selected_tts_voice_id = preset.voice_id.clone();
            effective_settings.tts_default_voice_id = preset.voice_id.clone();
            effective_settings.tts_rate = preset.tuning.tempo_rate.clamp(0.5, 2.0);
        }
        let trimmed = request.text.trim();
        if trimmed.is_empty() {
            return Ok(());
        }

        if let Some(audio_manager) = self
            .app_handle
            .try_state::<Arc<crate::managers::audio::AudioRecordingManager>>()
        {
            if audio_manager.is_recording() {
                return Err("Stop recording before playing speech output.".to_string());
            }
        }

        self.stop();

        if request.remember_last_output {
            self.set_last_output(trimmed.to_string(), request.locale.clone());
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        {
            let mut guard = self
                .current_stop_flag
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *guard = Some(stop_flag.clone());
        }

        let locale = normalize_locale(request.locale.as_deref());
        let engine = self.resolve_engine_kind(&effective_settings, locale.as_deref())?;
        let selected_provider_id = self.selected_provider_id(&effective_settings);
        let selected_model_id = selected_preset
            .as_ref()
            .map(|preset| preset.model_id.clone())
            .or_else(|| self.selected_model_id(&effective_settings));
        let selected_profile_id = selected_preset
            .as_ref()
            .and_then(|preset| preset.voice_profile_id.clone())
            .or_else(|| effective_settings.selected_tts_profile_id.clone());
        let _model_use_guard = self.track_model_use(selected_model_id.as_deref());

        let chunks = chunk_text(trimmed);
        if engine == TtsEngineKind::Sidecar {
            if is_preview_trigger(request.trigger.as_deref())
                && provider_uses_managed_speech_runtime(&selected_provider_id)
            {
                self.prepare_sidecar_provider(&selected_provider_id, selected_model_id.as_deref())
                    .await?;
            } else {
                self.ensure_managed_speech_runtime_available(&selected_provider_id)
                    .await?;
                if let Some(sidecar) = self
                    .app_handle
                    .try_state::<Arc<crate::sidecar::SidecarManager>>()
                {
                    let sidecar = Arc::clone(&*sidecar);
                    let uses_speech_runtime =
                        provider_uses_managed_speech_runtime(&selected_provider_id);
                    let ensure_result = tokio::task::spawn_blocking(move || {
                        if uses_speech_runtime {
                            sidecar.ensure_speech_runtime()
                        } else {
                            sidecar.ensure_running()
                        }
                    })
                    .await;
                    match ensure_result {
                        Ok(Ok(())) => {}
                        Ok(Err(err)) => return Err(err),
                        Err(err) => {
                            return Err(format!(
                                "Failed to start the local Speech runtime before playback: {err}"
                            ))
                        }
                    }
                }
            }
        }
        let voice = self.select_voice(
            &effective_settings,
            engine,
            locale.as_deref(),
            request.preferred_voice_id.as_deref(),
        )?;
        let sherpa_context = match engine {
            TtsEngineKind::SherpaOnnx => Some(
                self.prepare_sherpa_context(locale.as_deref(), voice.as_ref())
                    .await?,
            ),
            _ => None,
        };
        let qwen3_context = match engine {
            TtsEngineKind::Qwen3Native => Some(
                self.prepare_qwen3_context(&effective_settings, locale.as_deref(), voice.as_ref())
                    .await?,
            ),
            _ => None,
        };
        let mlx_audio_context = match engine {
            TtsEngineKind::MlxNative => Some(
                self.prepare_mlx_audio_context(&effective_settings, locale.as_deref())
                    .await?,
            ),
            _ => None,
        };
        let lfm_audio_gguf_context = match engine {
            TtsEngineKind::LfmAudioGguf => Some(
                crate::lfm_audio_gguf::LfmAudioGgufContext::from_managed_store(&self.app_handle)
                    .ok_or_else(|| "LFM Audio GGUF model is not installed.".to_string())?,
            ),
            _ => None,
        };
        let vibevoice_context = match engine {
            TtsEngineKind::VibeVoice => Some(self.prepare_vibevoice_context()?),
            _ => None,
        };
        let tts_volume = settings.tts_volume.clamp(0.0, 1.0);
        let output_device = settings.selected_output_device.clone();
        let app_handle = self.app_handle.clone();
        let preferred_voice_id = request
            .preferred_voice_id
            .clone()
            .or_else(|| voice.as_ref().map(|voice| voice.id.clone()))
            .or_else(|| {
                selected_preset
                    .as_ref()
                    .and_then(|preset| preset.voice_id.clone())
            });
        // For MLX models the voice_id is model-specific (e.g. Kokoro voice
        // names like "af_heart"). Drop any stale voice_id that looks like a
        // model identifier from another provider (e.g. "qwen3-0.6b-base").
        let preferred_voice_id = if engine == TtsEngineKind::MlxNative {
            preferred_voice_id.filter(|voice_id| is_valid_mlx_voice_id(voice_id))
        } else {
            preferred_voice_id
        };
        let tuning = selected_preset
            .as_ref()
            .map(|preset| preset.tuning.clone())
            .unwrap_or(TtsVoiceTuningSettings {
                tempo_rate: effective_settings.tts_rate.clamp(0.5, 2.0),
                expressiveness: 0.5,
                exaggeration: 0.5,
                randomness: 0.7,
                guidance: 0.5,
                stability: 0.5,
                repetition_penalty: 1.2,
                style_instructions: None,
                advanced_overrides: std::collections::HashMap::new(),
            });
        let trigger = request.trigger.clone();

        info!(
            "Speaking {} chunk(s) with {:?} engine, voice {:?}, preset {:?}, trigger {:?}",
            chunks.len(),
            engine,
            preferred_voice_id,
            selected_preset.as_ref().map(|preset| preset.id.as_str()),
            trigger
        );

        let join_result = tokio::task::spawn_blocking(move || {
            for chunk in chunks {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }

                match engine {
                    TtsEngineKind::System => {
                        speak_system_chunk(
                            &app_handle,
                            &chunk,
                            locale.as_deref(),
                            voice.as_ref(),
                            tuning.tempo_rate,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::SherpaOnnx => {
                        let sherpa_context = sherpa_context
                            .as_ref()
                            .ok_or_else(|| "No Sherpa-ONNX TTS pack is available.".to_string())?;
                        speak_sherpa_chunk(
                            &chunk,
                            sherpa_context,
                            tuning.tempo_rate,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::Qwen3Native => {
                        let qwen3_context = qwen3_context
                            .as_ref()
                            .ok_or_else(|| "No Qwen3 Native models are available.".to_string())?;
                        speak_qwen3_chunk(
                            &chunk,
                            qwen3_context,
                            &tuning,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::MlxNative => {
                        let mlx_audio_context = mlx_audio_context
                            .as_ref()
                            .ok_or_else(|| "No MLX speech models are available.".to_string())?;
                        speak_mlx_audio_chunk(
                            &chunk,
                            mlx_audio_context,
                            preferred_voice_id.as_deref(),
                            voice.as_ref(),
                            &tuning,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::Sidecar => {
                        speak_sidecar_chunk(
                            &chunk,
                            &selected_provider_id,
                            selected_model_id.as_deref(),
                            selected_profile_id.as_deref(),
                            locale.as_deref(),
                            preferred_voice_id.as_deref(),
                            voice.as_ref(),
                            &tuning,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::LfmAudioGguf => {
                        let context = lfm_audio_gguf_context.as_ref().ok_or_else(|| {
                            "LFM Audio GGUF context is not initialized.".to_string()
                        })?;
                        speak_lfm_audio_gguf_chunk(
                            &chunk,
                            context,
                            preferred_voice_id.as_deref(),
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::VibeVoice => {
                        let context = vibevoice_context
                            .as_ref()
                            .ok_or_else(|| "VibeVoice context is not initialized.".to_string())?;
                        speak_vibevoice_chunk(
                            &chunk,
                            context,
                            preferred_voice_id.as_deref(),
                            &tuning,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                }
            }

            Ok::<(), String>(())
        })
        .await
        .map_err(|err| format!("TTS task failed: {err}"))?;
        self.current_stop_flag
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();

        join_result
    }

    pub async fn synthesize_to_temp_files(
        &self,
        request: SpeakRequest,
        stop_flag: Arc<AtomicBool>,
    ) -> Result<Vec<PathBuf>, String> {
        let settings = get_settings(&self.app_handle);
        let selected_preset = self.resolved_preset_for_request(&settings, &request);
        let mut effective_settings = settings.clone();
        if let Some(preset) = selected_preset.as_ref() {
            effective_settings.tts_active_preset_id = None;
            effective_settings.selected_tts_provider_id = preset.provider_id.clone();
            effective_settings.selected_tts_model_id = Some(preset.model_id.clone());
            effective_settings.selected_tts_profile_id = preset.voice_profile_id.clone();
            effective_settings.selected_tts_voice_id = preset.voice_id.clone();
            effective_settings.tts_default_voice_id = preset.voice_id.clone();
            effective_settings.tts_rate = preset.tuning.tempo_rate.clamp(0.5, 2.0);
        }

        let trimmed = request.text.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let locale = normalize_locale(request.locale.as_deref());
        let engine = self.resolve_engine_kind(&effective_settings, locale.as_deref())?;
        let selected_provider_id = self.selected_provider_id(&effective_settings);
        let selected_model_id = selected_preset
            .as_ref()
            .map(|preset| preset.model_id.clone())
            .or_else(|| self.selected_model_id(&effective_settings));
        let selected_profile_id = selected_preset
            .as_ref()
            .and_then(|preset| preset.voice_profile_id.clone())
            .or_else(|| effective_settings.selected_tts_profile_id.clone());
        let _model_use_guard = self.track_model_use(selected_model_id.as_deref());

        let chunks = chunk_text(trimmed);
        if engine == TtsEngineKind::Sidecar {
            self.ensure_managed_speech_runtime_available(&selected_provider_id)
                .await?;
            if let Some(sidecar) = self
                .app_handle
                .try_state::<Arc<crate::sidecar::SidecarManager>>()
            {
                let sidecar = Arc::clone(&*sidecar);
                let uses_speech_runtime =
                    provider_uses_managed_speech_runtime(&selected_provider_id);
                let ensure_result = tokio::task::spawn_blocking(move || {
                    if uses_speech_runtime {
                        sidecar.ensure_speech_runtime()
                    } else {
                        sidecar.ensure_running()
                    }
                })
                .await;
                match ensure_result {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => return Err(err),
                    Err(err) => {
                        return Err(format!(
                            "Failed to start the local Speech runtime before story rendering: {err}"
                        ))
                    }
                }
            }
        }

        let voice = self.select_voice(
            &effective_settings,
            engine,
            locale.as_deref(),
            request.preferred_voice_id.as_deref(),
        )?;
        let sherpa_context = match engine {
            TtsEngineKind::SherpaOnnx => Some(
                self.prepare_sherpa_context(locale.as_deref(), voice.as_ref())
                    .await?,
            ),
            _ => None,
        };
        let qwen3_context = match engine {
            TtsEngineKind::Qwen3Native => Some(
                self.prepare_qwen3_context(&effective_settings, locale.as_deref(), voice.as_ref())
                    .await?,
            ),
            _ => None,
        };
        let mlx_audio_context = match engine {
            TtsEngineKind::MlxNative => Some(
                self.prepare_mlx_audio_context(&effective_settings, locale.as_deref())
                    .await?,
            ),
            _ => None,
        };
        let lfm_audio_gguf_context = match engine {
            TtsEngineKind::LfmAudioGguf => Some(
                crate::lfm_audio_gguf::LfmAudioGgufContext::from_managed_store(&self.app_handle)
                    .ok_or_else(|| "LFM Audio GGUF model is not installed.".to_string())?,
            ),
            _ => None,
        };
        let vibevoice_context = match engine {
            TtsEngineKind::VibeVoice => Some(self.prepare_vibevoice_context()?),
            _ => None,
        };
        let app_handle = self.app_handle.clone();
        let preferred_voice_id = request
            .preferred_voice_id
            .clone()
            .or_else(|| voice.as_ref().map(|voice| voice.id.clone()))
            .or_else(|| {
                selected_preset
                    .as_ref()
                    .and_then(|preset| preset.voice_id.clone())
            });
        let preferred_voice_id = if engine == TtsEngineKind::MlxNative {
            preferred_voice_id.filter(|voice_id| is_valid_mlx_voice_id(voice_id))
        } else {
            preferred_voice_id
        };
        let tuning = selected_preset
            .as_ref()
            .map(|preset| preset.tuning.clone())
            .unwrap_or(TtsVoiceTuningSettings {
                tempo_rate: effective_settings.tts_rate.clamp(0.5, 2.0),
                expressiveness: 0.5,
                exaggeration: 0.5,
                randomness: 0.7,
                guidance: 0.5,
                stability: 0.5,
                repetition_penalty: 1.2,
                style_instructions: None,
                advanced_overrides: std::collections::HashMap::new(),
            });

        info!(
            "Rendering {} story chunk(s) with {:?} engine, voice {:?}, preset {:?}",
            chunks.len(),
            engine,
            preferred_voice_id,
            selected_preset.as_ref().map(|preset| preset.id.as_str())
        );

        tokio::task::spawn_blocking(move || {
            let mut files = Vec::new();
            for chunk in chunks {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }

                let file = match engine {
                    TtsEngineKind::System => synthesize_system_chunk(
                        &app_handle,
                        &chunk,
                        locale.as_deref(),
                        voice.as_ref(),
                        tuning.tempo_rate,
                        &stop_flag,
                    )?,
                    TtsEngineKind::SherpaOnnx => {
                        let sherpa_context = sherpa_context
                            .as_ref()
                            .ok_or_else(|| "No Sherpa-ONNX TTS pack is available.".to_string())?;
                        synthesize_sherpa_chunk(
                            &chunk,
                            sherpa_context,
                            tuning.tempo_rate,
                            &stop_flag,
                        )?
                    }
                    TtsEngineKind::Qwen3Native => {
                        let qwen3_context = qwen3_context
                            .as_ref()
                            .ok_or_else(|| "No Qwen3 Native models are available.".to_string())?;
                        synthesize_qwen3_chunk(&chunk, qwen3_context, &tuning, &stop_flag)?
                    }
                    TtsEngineKind::MlxNative => {
                        let mlx_audio_context = mlx_audio_context
                            .as_ref()
                            .ok_or_else(|| "No MLX speech models are available.".to_string())?;
                        synthesize_mlx_audio_chunk(
                            &chunk,
                            mlx_audio_context,
                            preferred_voice_id.as_deref(),
                            voice.as_ref(),
                            &tuning,
                            &stop_flag,
                        )?
                    }
                    TtsEngineKind::Sidecar => synthesize_sidecar_chunk(
                        &chunk,
                        &selected_provider_id,
                        selected_model_id.as_deref(),
                        selected_profile_id.as_deref(),
                        locale.as_deref(),
                        preferred_voice_id.as_deref(),
                        voice.as_ref(),
                        &tuning,
                        &stop_flag,
                    )?,
                    TtsEngineKind::LfmAudioGguf => {
                        let context = lfm_audio_gguf_context.as_ref().ok_or_else(|| {
                            "LFM Audio GGUF context is not initialized.".to_string()
                        })?;
                        synthesize_lfm_audio_gguf_chunk(
                            &chunk,
                            context,
                            preferred_voice_id.as_deref(),
                            &stop_flag,
                        )?
                    }
                    TtsEngineKind::VibeVoice => {
                        let context = vibevoice_context
                            .as_ref()
                            .ok_or_else(|| "VibeVoice context is not initialized.".to_string())?;
                        synthesize_vibevoice_chunk(
                            &chunk,
                            context,
                            preferred_voice_id.as_deref(),
                            &tuning,
                            &stop_flag,
                        )?
                    }
                };
                files.push(file);
            }
            Ok::<Vec<PathBuf>, String>(files)
        })
        .await
        .map_err(|err| format!("TTS render task failed: {err}"))?
    }

    pub fn sidecar_base_url(&self) -> String {
        std::env::var("VOX_JOT_TTS_SIDECAR_URL").unwrap_or_else(|_| DEFAULT_SIDECAR_URL.to_string())
    }

    fn tts_asset_base_url(&self) -> String {
        std::env::var("VOX_JOT_TTS_MODELS_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_TTS_ASSET_BASE_URL.to_string())
    }

    fn resolve_engine_kind(
        &self,
        settings: &AppSettings,
        locale: Option<&str>,
    ) -> Result<TtsEngineKind, String> {
        match self.selected_provider_id(settings).as_str() {
            TTS_PROVIDER_SYSTEM_BUILTIN_ID => return self.ensure_system_engine_supported(),
            TTS_PROVIDER_SHERPA_PACK_ID => return Ok(TtsEngineKind::SherpaOnnx),
            TTS_PROVIDER_LOCAL_SIDECAR_API_ID => return self.ensure_sidecar_supported(settings),
            TTS_PROVIDER_QWEN3_NATIVE_ID => return Ok(TtsEngineKind::Qwen3Native),
            TTS_PROVIDER_LFM_AUDIO_GGUF_ID => return self.ensure_lfm_audio_gguf_supported(),
            TTS_PROVIDER_VIBEVOICE_ID => return self.ensure_vibevoice_supported(settings),
            provider_id if provider_is_mlx_audio(provider_id) => {
                return self.ensure_mlx_audio_supported()
            }
            TTS_PROVIDER_OPENVOICE_ID
            | TTS_PROVIDER_CHATTERBOX_ID
            | TTS_PROVIDER_KOKORO_ID
            | TTS_PROVIDER_SUPERTONIC_ID
            | TTS_PROVIDER_XTTS_ID => return self.ensure_sidecar_supported(settings),
            other if !other.is_empty() => {
                // Unknown provider IDs are assumed to be runtime-managed providers
                // served through the sidecar.
                return self.ensure_sidecar_supported(settings);
            }
            _ => {}
        }

        match settings.tts_engine_preference {
            TtsEnginePreference::System => self.ensure_system_engine_supported(),
            TtsEnginePreference::SherpaOnnx => Ok(TtsEngineKind::SherpaOnnx),
            TtsEnginePreference::Sidecar => self.ensure_sidecar_supported(settings),
            TtsEnginePreference::Auto => {
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                {
                    let _ = locale;
                    self.ensure_system_engine_supported()
                }
                #[cfg(target_os = "linux")]
                {
                    if self.has_installed_pack_for_locale(locale) {
                        Ok(TtsEngineKind::SherpaOnnx)
                    } else {
                        self.ensure_sidecar_supported(settings).or_else(|_| {
                            Err("Install a TTS pack or configure a local sidecar to enable speech output on Linux.".to_string())
                        })
                    }
                }
            }
        }
    }

    fn ensure_mlx_audio_supported(&self) -> Result<TtsEngineKind, String> {
        if mlx_audio_runtime_supported() {
            Ok(TtsEngineKind::MlxNative)
        } else {
            Err("MLX speech models currently require macOS on Apple Silicon.".to_string())
        }
    }

    fn ensure_lfm_audio_gguf_supported(&self) -> Result<TtsEngineKind, String> {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            let context = crate::lfm_audio_gguf::LfmAudioGgufContext::from_managed_store(
                &self.app_handle,
            )
            .ok_or_else(|| {
                "LFM Audio GGUF model is not installed. Download it from Model Hub before selecting it.".to_string()
            })?;
            if !context.is_ready() {
                return Err(
                    "LFM Audio GGUF assets are present but the runner zip or quant files are incomplete.".to_string()
                );
            }
            Ok(TtsEngineKind::LfmAudioGguf)
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            Err("LFM Audio GGUF currently only ships a macOS arm64 runner.".to_string())
        }
    }

    fn ensure_vibevoice_supported(&self, settings: &AppSettings) -> Result<TtsEngineKind, String> {
        if !settings.experimental_enabled {
            return Err(
                "VibeVoice is research-licensed and only available when experimental features are enabled in Settings → Labs.".to_string()
            );
        }
        let model_dir = crate::storage_paths::vibevoice_dir(&self.app_handle)
            .map_err(|err| format!("Failed to resolve VibeVoice model dir: {err}"))?;
        for name in ["model.safetensors", "preprocessor_config.json"] {
            if !model_dir.join(name).exists() {
                return Err(format!(
                    "VibeVoice snapshot is incomplete (missing {name}). Re-download it from Model Hub."
                ));
            }
        }
        Ok(TtsEngineKind::VibeVoice)
    }

    fn ensure_system_engine_supported(&self) -> Result<TtsEngineKind, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            Ok(TtsEngineKind::System)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("System TTS is not available on this platform.".to_string())
        }
    }

    fn ensure_sidecar_supported(&self, settings: &AppSettings) -> Result<TtsEngineKind, String> {
        let base_url = self.sidecar_base_url();
        if settings.local_privacy_mode && !is_local_base_url(&base_url) {
            return Err("Local privacy mode requires a localhost TTS sidecar URL.".to_string());
        }
        Ok(TtsEngineKind::Sidecar)
    }

    fn asset_download_url(&self, archive_name: &str) -> String {
        format!(
            "{}/{}",
            self.tts_asset_base_url().trim_end_matches('/'),
            archive_name
        )
    }

    fn pack_install_dir(&self, pack_id: &str) -> PathBuf {
        crate::storage_paths::tts_packs_dir(&self.app_handle)
            .unwrap_or_else(|_| default_tts_model_store_dir(&self.app_handle))
            .join(pack_id)
    }

    fn runtime_install_dir(&self, platform_id: &str) -> PathBuf {
        crate::storage_paths::tts_runtime_dir(&self.app_handle)
            .unwrap_or_else(|_| default_tts_model_store_dir(&self.app_handle))
            .join(platform_id)
    }

    fn qwen3_runtime_install_dir(&self, platform_id: &str) -> PathBuf {
        crate::storage_paths::tts_runtime_dir(&self.app_handle)
            .unwrap_or_else(|_| default_tts_model_store_dir(&self.app_handle))
            .join(format!("qwen3-{platform_id}"))
    }

    #[cfg(target_os = "linux")]
    fn has_installed_pack_for_locale(&self, locale: Option<&str>) -> bool {
        let Some(locale) = locale else {
            return self
                .get_available_sherpa_packs()
                .iter()
                .any(|pack| pack.installed);
        };
        self.get_available_sherpa_packs()
            .iter()
            .any(|pack| pack.installed && locale_matches(Some(pack.locale.as_str()), Some(locale)))
    }

    fn installed_pack_voices(&self) -> Vec<VoiceInfo> {
        self.get_available_sherpa_packs()
            .into_iter()
            .filter(|pack| pack.installed)
            .map(|pack| VoiceInfo {
                id: pack.id,
                label: pack.label,
                locale: Some(pack.locale),
                engine: TtsEngineKind::SherpaOnnx,
                installed: true,
                available: true,
            })
            .collect()
    }

    fn installed_pack_root(&self, pack_id: &str) -> Option<PathBuf> {
        resolve_extracted_root(&self.pack_install_dir(pack_id))
    }

    fn definition_for_voice(&self, voice: &VoiceInfo) -> Option<&'static PackDefinition> {
        PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == voice.id || definition.voice_id == voice.id)
    }

    async fn prepare_sherpa_context(
        &self,
        locale: Option<&str>,
        voice: Option<&VoiceInfo>,
    ) -> Result<SherpaContext, String> {
        let runtime_root = self.ensure_sherpa_runtime_installed().await?;

        let definition = if let Some(voice) = voice {
            self.definition_for_voice(voice)
        } else {
            PACK_DEFINITIONS.iter().find(|definition| {
                self.installed_pack_root(definition.id).is_some()
                    && locale_matches(Some(definition.locale), locale)
            })
        }
        .or_else(|| {
            PACK_DEFINITIONS
                .iter()
                .find(|definition| self.installed_pack_root(definition.id).is_some())
        })
        .ok_or_else(|| {
            "No Sherpa-ONNX TTS pack is installed yet. Download a pack in Speech Output settings first."
                .to_string()
        })?;

        let pack_root = self
            .installed_pack_root(definition.id)
            .ok_or_else(|| format!("Installed pack '{}' is missing on disk", definition.id))?;
        self.write_default_pack_manifest(definition, &pack_root)?;
        let manifest = self
            .read_pack_manifest(&pack_root)
            .unwrap_or_else(|_| self.default_pack_manifest(definition));

        Ok(SherpaContext {
            runtime_root,
            pack_root,
            manifest,
        })
    }

    async fn ensure_sherpa_runtime_installed(&self) -> Result<PathBuf, String> {
        let definition = sherpa_runtime_definition().ok_or_else(|| {
            "Sherpa-ONNX runtime is not supported on this platform yet.".to_string()
        })?;

        let install_dir = self.runtime_install_dir(definition.platform_id);
        if let Some(root) = resolve_extracted_root(&install_dir) {
            if sherpa_runtime_binary_path(&root).exists() {
                return Ok(root);
            }
        }

        self.download_and_extract_archive(
            &[
                self.asset_download_url(definition.archive_name),
                definition.source_url.to_string(),
            ],
            &install_dir,
            "Sherpa-ONNX runtime",
        )
        .await?;

        let root = resolve_extracted_root(&install_dir).ok_or_else(|| {
            "Sherpa-ONNX runtime extraction did not produce any files.".to_string()
        })?;
        if !sherpa_runtime_binary_path(&root).exists() {
            return Err(
                "Sherpa-ONNX runtime download completed, but the offline-tts binary is missing."
                    .to_string(),
            );
        }

        Ok(root)
    }

    async fn ensure_qwen3_runtime_installed(&self) -> Result<PathBuf, String> {
        let (platform_id, archive_name, source_url) =
            qwen3_runtime_definition().ok_or_else(|| {
                "Qwen3 TTS runtime is not supported on this platform yet.".to_string()
            })?;

        let install_dir = self.qwen3_runtime_install_dir(platform_id);
        if let Some(root) = resolve_extracted_root(&install_dir) {
            if qwen3_runtime_binary_path(&root).exists() {
                return Ok(root);
            }
        }

        self.download_and_extract_archive(
            &[
                self.asset_download_url(archive_name),
                source_url.to_string(),
            ],
            &install_dir,
            "Qwen3 Native runtime",
        )
        .await?;

        let root = resolve_extracted_root(&install_dir).ok_or_else(|| {
            "Qwen3 Native runtime extraction did not produce any files.".to_string()
        })?;
        if !qwen3_runtime_binary_path(&root).exists() {
            return Err(
                "Qwen3 Native runtime download completed, but the binary is missing.".to_string(),
            );
        }

        Ok(root)
    }

    fn installed_qwen3_voices(&self) -> Vec<VoiceInfo> {
        QWEN3_PACK_DEFINITIONS
            .iter()
            .filter(|definition| self.resolved_qwen3_pack_root(definition).is_some())
            .map(|def| VoiceInfo {
                id: def.id.to_string(),
                label: def.label.to_string(),
                locale: Some(def.locale.to_string()),
                engine: TtsEngineKind::Qwen3Native,
                installed: true,
                available: true,
            })
            .collect()
    }

    async fn prepare_qwen3_context(
        &self,
        settings: &AppSettings,
        locale: Option<&str>,
        voice: Option<&VoiceInfo>,
    ) -> Result<Qwen3Context, String> {
        let runtime_root = self.ensure_qwen3_runtime_installed().await?;

        let voice = voice
            .cloned()
            .or_else(|| self.installed_qwen3_voices().first().cloned())
            .ok_or_else(|| {
                "No Qwen3 Native models installed. Download one from settings.".to_string()
            })?;

        let model_root = self
            .resolved_qwen3_pack_root(
                QWEN3_PACK_DEFINITIONS
                    .iter()
                    .find(|definition| definition.id == voice.id)
                    .ok_or_else(|| {
                        format!("Unknown Qwen3 model '{}' is not supported", voice.id)
                    })?,
            )
            .ok_or_else(|| format!("Installed Qwen3 model '{}' is missing on disk", voice.id))?;

        let features = QWEN3_PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == voice.id)
            .map(|definition| self.qwen3_pack_features(definition))
            .ok_or_else(|| format!("Unknown Qwen3 model '{}' is not supported", voice.id))?;
        let clone_profile = self.resolve_qwen3_clone_profile(settings, &voice.id)?;

        Ok(Qwen3Context {
            runtime_root,
            model_root,
            clone_profile,
            language: qwen3_language_for_locale(locale),
            supports_instruction_prompt: features.supports_instruction_prompt,
        })
    }

    fn prepare_vibevoice_context(&self) -> Result<crate::vibevoice::VibeVoiceContext, String> {
        let sidecar = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
            .ok_or_else(|| "Sidecar manager is not initialized.".to_string())?;
        let runtime_root = sidecar.resolve_runtime_path().ok_or_else(|| {
            "VibeVoice requires the speech-runtime checkout (with vibevoice_bridge.py) — install it or set speech_runtime_path in settings.".to_string()
        })?;
        let python_path = crate::sidecar::SidecarManager::runtime_python_path(&runtime_root)
            .ok_or_else(|| {
                format!(
                    "VibeVoice requires a Python venv inside the speech runtime at {}.",
                    runtime_root.display()
                )
            })?;
        crate::vibevoice::VibeVoiceContext::from_managed_store(
            &self.app_handle,
            python_path,
            &runtime_root,
        )
        .ok_or_else(|| {
            "VibeVoice is not ready: need models/tts/store/vibevoice/{config.json,model.safetensors,preprocessor_config.json}, speech-runtime/vibevoice_bridge.py, vendor voice .pt presets, and `pip install -e speech-runtime/vendor/VibeVoice[streamingtts]`."
                .to_string()
        })
    }

    async fn prepare_mlx_audio_context(
        &self,
        settings: &AppSettings,
        locale: Option<&str>,
    ) -> Result<MlxAudioContext, String> {
        let provider_id = self.selected_provider_id(settings);
        let definition = settings
            .explicit_active_tts_preset()
            .and_then(|preset| mlx_audio_tts_model_definition(&preset.model_id))
            .or_else(|| {
                settings
                    .selected_tts_model_id
                    .as_deref()
                    .and_then(mlx_audio_tts_model_definition)
            })
            .or_else(|| first_mlx_audio_model_for_provider(&provider_id))
            .ok_or_else(|| format!("No MLX model is configured for provider '{provider_id}'."))?;
        ensure_mlx_audio_definition_available(definition)?;
        let model_root = self.ensure_mlx_audio_model_root(definition)?;

        let sidecar = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
            .map(|state| Arc::clone(&*state))
            .ok_or_else(|| "MLX speech runtime manager is not available.".to_string())?;
        let python_path =
            tokio::task::spawn_blocking(move || sidecar.ensure_mlx_audio_environment())
                .await
                .map_err(|err| format!("Failed to prepare mlx-audio environment: {err}"))??;
        let bridge_script_path =
            portable::resolve_resource(&self.app_handle, "resources/python/mlx_audio_generate.py")
                .map_err(|err| format!("Failed to resolve MLX audio bridge script: {err}"))?;
        if !bridge_script_path.exists() {
            return Err(format!(
                "MLX audio bridge script is missing: {}",
                bridge_script_path.display()
            ));
        }

        Ok(MlxAudioContext {
            provider_id: definition.provider_id.to_string(),
            model_id: definition.model_id.to_string(),
            model_label: definition.label.to_string(),
            python_path,
            bridge_script_path,
            model_source: model_root.to_string_lossy().to_string(),
            clone_profile: self.resolve_mlx_audio_clone_profile(settings, definition)?,
            language: mlx_audio_language_for_locale(locale),
            supports_instruction_prompt: definition.supports_instruction_prompt,
        })
    }

    fn resolve_qwen3_clone_profile(
        &self,
        settings: &AppSettings,
        model_id: &str,
    ) -> Result<Option<Qwen3CloneProfile>, String> {
        let Some(profile_id) = settings
            .selected_tts_profile_id
            .as_deref()
            .filter(|profile_id| !profile_id.trim().is_empty())
        else {
            return Ok(None);
        };

        if model_id != "qwen3-0.6b-base" {
            return Err(
                "Voice cloning currently requires the Qwen3 0.6B Base model. Switch the speech model or clear the selected voice profile."
                    .to_string(),
            );
        }

        let profile = tts_profiles::resolve_voice_profile(&self.app_handle, profile_id)?;
        ensure_profile_supports_qwen3_base(&profile)?;

        Ok(Some(Qwen3CloneProfile {
            reference_audio_path: profile.reference_audio_path,
            transcript: profile.transcript,
        }))
    }

    fn resolve_mlx_audio_clone_profile(
        &self,
        settings: &AppSettings,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Result<Option<MlxAudioCloneProfile>, String> {
        let Some(profile_id) = settings
            .selected_tts_profile_id
            .as_deref()
            .filter(|profile_id| !profile_id.trim().is_empty())
        else {
            return Ok(None);
        };

        if !definition.supports_voice_cloning {
            return Ok(None);
        }

        let profile = tts_profiles::resolve_voice_profile(&self.app_handle, profile_id)?;
        let provider_compatible = profile.compatible_provider_ids.is_empty()
            || profile
                .compatible_provider_ids
                .iter()
                .any(|provider_id| provider_id == definition.provider_id);
        let model_compatible = profile.compatible_model_ids.is_empty()
            || profile
                .compatible_model_ids
                .iter()
                .any(|model_id| model_id == definition.model_id);

        if !(provider_compatible && model_compatible) {
            return Ok(None);
        }

        Ok(Some(MlxAudioCloneProfile {
            reference_audio_path: profile.reference_audio_path,
            transcript: profile.transcript,
        }))
    }

    async fn download_and_extract_archive(
        &self,
        candidate_urls: &[String],
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        let download_dir = crate::storage_paths::tts_downloads_dir(&self.app_handle)
            .map_err(|err| format!("TTS dir error: {err}"))?;
        fs::create_dir_all(&download_dir)
            .map_err(|err| format!("Failed to create TTS download dir: {err}"))?;

        let mut last_error = None;
        for url in candidate_urls {
            match self.download_archive(url, &download_dir, label).await {
                Ok(archive_path) => {
                    let extract_result = extract_archive(&archive_path, install_dir);
                    let _ = fs::remove_file(&archive_path);
                    return extract_result;
                }
                Err(err) => last_error = Some(err),
            }
        }

        Err(last_error.unwrap_or_else(|| format!("Failed to download {label}.")))
    }

    async fn download_archive(
        &self,
        url: &str,
        download_dir: &Path,
        label: &str,
    ) -> Result<PathBuf, String> {
        let file_name = url
            .split('/')
            .next_back()
            .filter(|name| !name.is_empty())
            .unwrap_or("tts-asset.tar.gz");
        let archive_path = download_dir.join(file_name);
        let partial_path = download_dir.join(format!("{file_name}.partial"));
        if archive_path.exists() {
            fs::remove_file(&archive_path)
                .map_err(|err| format!("Failed to clear previous {label} archive: {err}"))?;
        }

        let progress_app = self.app_handle.clone();
        let artifact_id = label.to_string();
        let progress = std::sync::Arc::new(move |progress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress);
        });

        crate::artifact_download::download_file(crate::artifact_download::FileDownloadOptions {
            domain: "tts".to_string(),
            artifact_id,
            url: url.to_string(),
            partial_path,
            final_path: archive_path.clone(),
            expected_sha256: None,
            expected_size: None,
            cancel_flag: None,
            progress: Some(progress),
        })
        .await
        .map(|report| report.final_path)
    }

    /// Download all files from a HuggingFace model repository into `install_dir`.
    /// Used as a fallback for models too large for GitHub release assets (>2 GB).
    async fn download_hf_snapshot(
        &self,
        repo_id: &str,
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        use tokio::fs as tokio_fs;
        use tokio::io::AsyncWriteExt;

        #[derive(Deserialize)]
        struct HfSibling {
            rfilename: String,
            size: Option<u64>,
        }
        #[derive(Deserialize)]
        struct HfModelInfo {
            siblings: Vec<HfSibling>,
        }

        let client = reqwest::Client::new();
        let api_url = format!("https://huggingface.co/api/models/{repo_id}");
        info!("HF snapshot: listing files from {api_url}");
        self.emit_tts_hf_download_progress(
            repo_id,
            "preparing",
            None,
            None,
            None,
            None,
            None,
            None,
        );

        let response = hf_get(&client, &api_url)
            .send()
            .await
            .map_err(|e| format!("Failed to query HuggingFace API for {label}: {e}"))?;
        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(hf_access_error(repo_id));
        }
        if !response.status().is_success() {
            return Err(format!(
                "Failed to query HuggingFace API for {label}: HTTP {}",
                response.status()
            ));
        }
        let model_info: HfModelInfo = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse HuggingFace API response for {label}: {e}"))?;
        let file_count = model_info.siblings.len();
        let total_bytes = model_info.siblings.iter().try_fold(0_u64, |acc, sibling| {
            sibling.size.map(|size| acc.saturating_add(size))
        });
        let mut downloaded_bytes = 0_u64;
        self.emit_tts_hf_download_progress(
            repo_id,
            "downloading",
            None,
            Some(0),
            Some(file_count),
            Some(downloaded_bytes),
            total_bytes,
            None,
        );

        if install_dir.exists() {
            fs::remove_dir_all(install_dir)
                .map_err(|e| format!("Failed to clear install dir for {label}: {e}"))?;
        }
        // Create a subdirectory matching the repo basename so the extracted
        // layout mirrors the GitHub-release tar structure (archive contains a
        // single top-level directory named after the pack id).
        let inner_dir = install_dir.join(repo_id.rsplit('/').next().unwrap_or(repo_id));
        fs::create_dir_all(&inner_dir)
            .map_err(|e| format!("Failed to create install dir for {label}: {e}"))?;

        for (idx, sibling) in model_info.siblings.iter().enumerate() {
            let file_url = format!(
                "https://huggingface.co/{repo_id}/resolve/main/{}",
                sibling.rfilename
            );
            let dest = inner_dir.join(&sibling.rfilename);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create directory for {}: {e}", sibling.rfilename)
                })?;
            }
            info!("HF snapshot: downloading {}", sibling.rfilename);
            self.emit_tts_hf_download_progress(
                repo_id,
                "downloading",
                Some(&sibling.rfilename),
                Some(idx),
                Some(file_count),
                Some(downloaded_bytes),
                total_bytes,
                None,
            );
            let response = hf_get(&client, &file_url)
                .send()
                .await
                .map_err(|e| format!("Failed to download {}: {e}", sibling.rfilename))?;
            if !response.status().is_success() {
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                    return Err(hf_access_error(repo_id));
                }
                return Err(format!(
                    "Failed to download {}: HTTP {}",
                    sibling.rfilename,
                    response.status()
                ));
            }
            let mut file = tokio_fs::File::create(&dest)
                .await
                .map_err(|e| format!("Failed to write {}: {e}", sibling.rfilename))?;
            let mut last_emit_bytes = downloaded_bytes;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|e| format!("Failed to read {}: {e}", sibling.rfilename))?;
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("Failed to write {}: {e}", sibling.rfilename))?;
                downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
                if downloaded_bytes.saturating_sub(last_emit_bytes) >= 1_048_576 {
                    self.emit_tts_hf_download_progress(
                        repo_id,
                        "downloading",
                        Some(&sibling.rfilename),
                        Some(idx),
                        Some(file_count),
                        Some(downloaded_bytes),
                        total_bytes,
                        None,
                    );
                    last_emit_bytes = downloaded_bytes;
                }
            }
            file.flush()
                .await
                .map_err(|e| format!("Failed to finalize {}: {e}", sibling.rfilename))?;
            self.emit_tts_hf_download_progress(
                repo_id,
                "downloading",
                Some(&sibling.rfilename),
                Some(idx + 1),
                Some(file_count),
                Some(downloaded_bytes),
                total_bytes,
                None,
            );
        }

        info!(
            "HF snapshot: completed {label} ({} files)",
            model_info.siblings.len()
        );
        self.emit_tts_hf_download_progress(
            repo_id,
            "complete",
            None,
            Some(file_count),
            Some(file_count),
            Some(downloaded_bytes),
            total_bytes,
            None,
        );
        Ok(())
    }

    async fn download_hf_snapshot_into_exact_dir(
        &self,
        repo_id: &str,
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        use tokio::fs as tokio_fs;
        use tokio::io::AsyncWriteExt;

        #[derive(Deserialize)]
        struct HfSibling {
            rfilename: String,
            size: Option<u64>,
        }
        #[derive(Deserialize)]
        struct HfModelInfo {
            siblings: Vec<HfSibling>,
        }

        let client = reqwest::Client::new();
        let api_url = format!("https://huggingface.co/api/models/{repo_id}");
        info!("HF snapshot: listing files from {api_url}");
        self.emit_tts_hf_download_progress(
            repo_id,
            "preparing",
            None,
            None,
            None,
            None,
            None,
            None,
        );

        let response = hf_get(&client, &api_url)
            .send()
            .await
            .map_err(|e| format!("Failed to query HuggingFace API for {label}: {e}"))?;
        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(hf_access_error(repo_id));
        }
        if !response.status().is_success() {
            return Err(format!(
                "Failed to query HuggingFace API for {label}: HTTP {}",
                response.status()
            ));
        }
        let model_info: HfModelInfo = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse HuggingFace API response for {label}: {e}"))?;
        let file_count = model_info.siblings.len();
        let total_bytes = model_info.siblings.iter().try_fold(0_u64, |acc, sibling| {
            sibling.size.map(|size| acc.saturating_add(size))
        });
        let mut downloaded_bytes = 0_u64;
        self.emit_tts_hf_download_progress(
            repo_id,
            "downloading",
            None,
            Some(0),
            Some(file_count),
            Some(downloaded_bytes),
            total_bytes,
            None,
        );

        if install_dir.exists() {
            fs::remove_dir_all(install_dir)
                .map_err(|e| format!("Failed to clear install dir for {label}: {e}"))?;
        }
        fs::create_dir_all(install_dir)
            .map_err(|e| format!("Failed to create install dir for {label}: {e}"))?;

        for (idx, sibling) in model_info.siblings.iter().enumerate() {
            let file_url = format!(
                "https://huggingface.co/{repo_id}/resolve/main/{}",
                sibling.rfilename
            );
            let dest = install_dir.join(&sibling.rfilename);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create directory for {}: {e}", sibling.rfilename)
                })?;
            }
            info!("HF snapshot: downloading {}", sibling.rfilename);
            self.emit_tts_hf_download_progress(
                repo_id,
                "downloading",
                Some(&sibling.rfilename),
                Some(idx),
                Some(file_count),
                Some(downloaded_bytes),
                total_bytes,
                None,
            );
            let response = hf_get(&client, &file_url)
                .send()
                .await
                .map_err(|e| format!("Failed to download {}: {e}", sibling.rfilename))?;
            if !response.status().is_success() {
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                    return Err(hf_access_error(repo_id));
                }
                return Err(format!(
                    "Failed to download {}: HTTP {}",
                    sibling.rfilename,
                    response.status()
                ));
            }
            let mut file = tokio_fs::File::create(&dest)
                .await
                .map_err(|e| format!("Failed to write {}: {e}", sibling.rfilename))?;
            let mut last_emit_bytes = downloaded_bytes;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|e| format!("Failed to read {}: {e}", sibling.rfilename))?;
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("Failed to write {}: {e}", sibling.rfilename))?;
                downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
                if downloaded_bytes.saturating_sub(last_emit_bytes) >= 1_048_576 {
                    self.emit_tts_hf_download_progress(
                        repo_id,
                        "downloading",
                        Some(&sibling.rfilename),
                        Some(idx),
                        Some(file_count),
                        Some(downloaded_bytes),
                        total_bytes,
                        None,
                    );
                    last_emit_bytes = downloaded_bytes;
                }
            }
            file.flush()
                .await
                .map_err(|e| format!("Failed to finalize {}: {e}", sibling.rfilename))?;
            self.emit_tts_hf_download_progress(
                repo_id,
                "downloading",
                Some(&sibling.rfilename),
                Some(idx + 1),
                Some(file_count),
                Some(downloaded_bytes),
                total_bytes,
                None,
            );
        }

        info!(
            "HF snapshot: completed {label} ({} files)",
            model_info.siblings.len()
        );
        self.emit_tts_hf_download_progress(
            repo_id,
            "complete",
            None,
            Some(file_count),
            Some(file_count),
            Some(downloaded_bytes),
            total_bytes,
            None,
        );
        Ok(())
    }

    fn emit_tts_hf_download_progress(
        &self,
        repo_id: &str,
        stage: &str,
        file: Option<&str>,
        file_index: Option<usize>,
        file_count: Option<usize>,
        downloaded_bytes: Option<u64>,
        total_bytes: Option<u64>,
        error: Option<&str>,
    ) {
        let payload = serde_json::json!({
            "repo_id": repo_id,
            "stage": stage,
            "file": file,
            "file_index": file_index,
            "file_count": file_count,
            "downloaded_bytes": downloaded_bytes,
            "total_bytes": total_bytes,
            "error": error,
        });
        let _ = self.app_handle.emit("tts-hf-download-progress", payload);
    }

    fn default_pack_manifest(&self, definition: &PackDefinition) -> SherpaPackManifest {
        SherpaPackManifest {
            id: definition.id.to_string(),
            label: definition.label.to_string(),
            locale: definition.locale.to_string(),
            source_url: definition.source_url.to_string(),
            source_name: definition.source_name.to_string(),
            model_family: definition.model_family,
            model_file: definition.model_file.to_string(),
            tokens_file: definition.tokens_file.to_string(),
            data_dir: definition.data_dir.map(ToString::to_string),
            lexicon_file: definition.lexicon_file.map(ToString::to_string),
            rule_fsts: definition
                .rule_fsts
                .iter()
                .map(|value| value.to_string())
                .collect(),
        }
    }

    fn write_default_pack_manifest(
        &self,
        definition: &PackDefinition,
        pack_root: &Path,
    ) -> Result<(), String> {
        let manifest_path = pack_root.join(PACK_MANIFEST_NAME);
        if manifest_path.exists() {
            return Ok(());
        }

        let manifest = self.default_pack_manifest(definition);
        let bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|err| format!("Failed to serialize TTS pack manifest: {err}"))?;
        fs::write(&manifest_path, bytes)
            .map_err(|err| format!("Failed to write TTS pack manifest: {err}"))
    }

    fn read_pack_manifest(&self, pack_root: &Path) -> Result<SherpaPackManifest, String> {
        let bytes = fs::read(pack_root.join(PACK_MANIFEST_NAME))
            .map_err(|err| format!("Failed to read TTS pack manifest: {err}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|err| format!("Failed to parse TTS pack manifest: {err}"))
    }

    fn system_voices(&self) -> Result<Vec<VoiceInfo>, String> {
        {
            let cache = self
                .cached_system_voices
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(voices) = cache.as_ref() {
                return Ok(voices.clone());
            }
        }

        let voices = {
            #[cfg(target_os = "macos")]
            {
                macos_system_voices()?
            }
            #[cfg(target_os = "windows")]
            {
                windows_system_voices()?
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                Vec::new()
            }
        };

        let mut cache = self
            .cached_system_voices
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *cache = Some(voices.clone());
        Ok(voices)
    }

    /// Clear the cached system voices so the next call re-enumerates.
    pub fn invalidate_voice_cache(&self) {
        let mut cache = self
            .cached_system_voices
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *cache = None;
    }

    fn select_voice(
        &self,
        settings: &AppSettings,
        engine: TtsEngineKind,
        locale: Option<&str>,
        preferred_voice_id: Option<&str>,
    ) -> Result<Option<VoiceInfo>, String> {
        let voices = match engine {
            TtsEngineKind::System => self.system_voices()?,
            TtsEngineKind::SherpaOnnx => self.installed_pack_voices(),
            TtsEngineKind::MlxNative => self.mlx_audio_voice_inventory(settings),
            TtsEngineKind::Qwen3Native => self.installed_qwen3_voices(),
            TtsEngineKind::Sidecar => Vec::new(),
            TtsEngineKind::LfmAudioGguf | TtsEngineKind::VibeVoice => Vec::new(),
        };

        if voices.is_empty() {
            return Ok(None);
        }

        if let Some(voice_id) = preferred_voice_id {
            if let Some(voice) = voices.iter().find(|voice| voice.id == voice_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(voice_id) = settings
            .selected_tts_voice_id
            .as_deref()
            .filter(|voice_id| !voice_id.trim().is_empty())
        {
            if let Some(voice) = voices.iter().find(|voice| voice.id == voice_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(model_id) = settings
            .selected_tts_model_id
            .as_deref()
            .filter(|model_id| !model_id.trim().is_empty())
        {
            if let Some(voice) = voices.iter().find(|voice| voice.id == model_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(voice_id) = settings
            .tts_default_voice_id
            .as_deref()
            .filter(|voice_id| !voice_id.trim().is_empty())
        {
            if let Some(voice) = voices.iter().find(|voice| voice.id == voice_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(locale) = locale {
            if let Some(voice) = voices
                .iter()
                .find(|voice| locale_matches(voice.locale.as_deref(), Some(locale)))
            {
                return Ok(Some(voice.clone()));
            }

            let language = locale_language(locale);
            if let Some(voice) = voices.iter().find(|voice| {
                voice
                    .locale
                    .as_deref()
                    .map(locale_language)
                    .map(|voice_language| voice_language == language)
                    .unwrap_or(false)
            }) {
                return Ok(Some(voice.clone()));
            }
        }

        Ok(voices.first().cloned())
    }
}
