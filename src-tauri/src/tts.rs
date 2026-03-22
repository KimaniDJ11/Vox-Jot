use crate::github_release;
use crate::model_platform::{
    CapabilityFlags, CatalogModelDescriptor, DomainCatalog, ModelDomain, ProviderDescriptor,
    RuntimeRequirement,
};
use crate::settings::{
    get_settings, is_local_base_url, AppSettings, TtsAutoReadbackMode, TtsAutoReadbackScope,
    TtsEnginePreference, TtsReadbackTextMode, TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID,
    TTS_MODEL_SYSTEM_DEFAULT_ID, TTS_PROVIDER_FISH_SPEECH_LOCAL_ID, TTS_PROVIDER_HF_S2S_LOCAL_ID,
    TTS_PROVIDER_LOCAL_SIDECAR_API_ID, TTS_PROVIDER_QWEN3_NATIVE_ID, TTS_PROVIDER_SHERPA_PACK_ID,
    TTS_PROVIDER_SYSTEM_BUILTIN_ID, TTS_PROVIDER_TADA_LOCAL_ID,
};
use crate::translation::TranslationOrigin;
use crate::{audio_playback, portable};
use log::info;
use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static SAY_VOICE_RE: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| {
    Regex::new(r"^(?P<name>.+?)\s{2,}(?P<locale>[A-Za-z_]+)\s+#").expect("valid say voice regex")
});

const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:8008/v1/audio/speech";
const PREVIEW_SAMPLE_TEXT: &str = "Vox Jot is ready.";
const PACK_MANIFEST_NAME: &str = "vox_jot_tts_manifest.json";
const DEFAULT_TTS_ASSET_BASE_URL: &str =
    "https://github.com/KimaniDJ11/Vox-Jot/releases/download/v0.3.0-tts-models";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsEngineKind {
    System,
    SherpaOnnx,
    Sidecar,
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
    pub installed: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SherpaModelFamily {
    Vits,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SherpaPackManifest {
    id: String,
    label: String,
    locale: String,
    source_url: String,
    source_name: String,
    model_family: SherpaModelFamily,
    model_file: String,
    tokens_file: String,
    data_dir: Option<String>,
    lexicon_file: Option<String>,
    rule_fsts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeakRequest {
    pub text: String,
    pub locale: Option<String>,
    pub preferred_voice_id: Option<String>,
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

#[derive(Debug, Clone)]
struct LastOutput {
    text: String,
    locale: Option<String>,
}

#[derive(Debug, Clone)]
struct PackDefinition {
    id: &'static str,
    label: &'static str,
    locale: &'static str,
    voice_id: &'static str,
    archive_name: &'static str,
    source_name: &'static str,
    source_url: &'static str,
    model_family: SherpaModelFamily,
    model_file: &'static str,
    tokens_file: &'static str,
    data_dir: Option<&'static str>,
    lexicon_file: Option<&'static str>,
    rule_fsts: &'static [&'static str],
}

const PACK_DEFINITIONS: &[PackDefinition] = &[
    PackDefinition {
        id: "tts-sherpa-en-us-lessac-medium",
        label: "English (US) - Lessac",
        locale: "en-US",
        voice_id: "lessac-medium",
        archive_name: "tts-sherpa-en-us-lessac-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "en_US-lessac-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-zh-cn-melo",
        label: "Chinese + English - Melo",
        locale: "zh-CN",
        voice_id: "melo-zh-en",
        archive_name: "tts-sherpa-zh-cn-melo.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "model.onnx",
        tokens_file: "tokens.txt",
        data_dir: None,
        lexicon_file: Some("lexicon.txt"),
        rule_fsts: &["date.fst", "number.fst", "phone.fst", "new_heteronym.fst"],
    },
];

#[derive(Debug, Clone)]
struct SherpaRuntimeDefinition {
    platform_id: &'static str,
    archive_name: &'static str,
    source_url: &'static str,
}

#[derive(Debug, Clone)]
struct SherpaContext {
    runtime_root: PathBuf,
    pack_root: PathBuf,
    manifest: SherpaPackManifest,
}

pub struct TtsManager {
    app_handle: AppHandle,
    current_stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    last_output: Mutex<Option<LastOutput>>,
    cached_system_voices: Mutex<Option<Vec<VoiceInfo>>>,
}

impl TtsManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            current_stop_flag: Mutex::new(None),
            last_output: Mutex::new(None),
            cached_system_voices: Mutex::new(None),
        }
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
            trigger: Some("speak_last_output".to_string()),
            remember_last_output: false,
        })
    }

    pub fn get_available_voices(&self) -> Result<Vec<VoiceInfo>, String> {
        let settings = get_settings(&self.app_handle);
        let mut voices = self.system_voices()?;
        if matches!(
            self.resolve_engine_kind(&settings, None)?,
            TtsEngineKind::SherpaOnnx
        ) {
            voices.extend(self.installed_pack_voices());
        }
        Ok(voices)
    }

    pub fn get_available_packs(&self) -> Vec<TtsPackInfo> {
        PACK_DEFINITIONS
            .iter()
            .map(|definition| TtsPackInfo {
                id: definition.id.to_string(),
                label: definition.label.to_string(),
                locale: definition.locale.to_string(),
                voice_id: definition.voice_id.to_string(),
                archive_name: definition.archive_name.to_string(),
                installed: self.installed_pack_root(definition.id).is_some(),
            })
            .collect()
    }

    pub fn selected_provider_id(&self, settings: &AppSettings) -> String {
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

    pub fn domain_catalog(&self, settings: &AppSettings) -> DomainCatalog {
        let selected_provider_id = self.selected_provider_id(settings);
        let selected_model_id = self.selected_model_id(settings);

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

        let mut providers = vec![
            ProviderDescriptor {
                id: TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "System Built-In".to_string(),
                description: "Use platform speech synthesis and choose from installed system voices."
                    .to_string(),
                source_label: "Platform runtime".to_string(),
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
                label: "Sherpa Pack".to_string(),
                description:
                    "Use Vox Jot-managed offline voice packs with automatic local runtime routing."
                        .to_string(),
                source_label: "Vox Jot curated assets".to_string(),
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
            ProviderDescriptor {
                id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "Local Sidecar API".to_string(),
                description:
                    "Route speech to a local OpenAI-compatible speech endpoint managed outside the app."
                        .to_string(),
                source_label: "User-managed local endpoint".to_string(),
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
            },
        ];

        let planned_capabilities = CapabilityFlags {
            downloadable: false,
            loadable: false,
            local_only: true,
            supports_translation: false,
            supports_streaming: true,
            supports_voice_cloning: true,
            supports_instruction_prompt: true,
            supports_inline_tags: true,
            coming_soon: true,
        };

        providers.extend([
            ProviderDescriptor {
                id: TTS_PROVIDER_QWEN3_NATIVE_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "Qwen3 Native".to_string(),
                description:
                    "Planned native Rust Qwen3 runtime with preset voices, instructions, and cloning."
                        .to_string(),
                source_label: "Provider-hosted model weights".to_string(),
                runtime: RuntimeRequirement {
                    id: "qwen3_native".to_string(),
                    label: "Qwen3 native runtime".to_string(),
                    engine_family: "qwen3".to_string(),
                    auto_routed: true,
                },
                available: false,
                local_only: true,
                coming_soon: true,
                license_label: Some("Apache-2.0".to_string()),
                capabilities: planned_capabilities.clone(),
            },
            ProviderDescriptor {
                id: TTS_PROVIDER_FISH_SPEECH_LOCAL_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "Fish Speech Local".to_string(),
                description:
                    "Planned local server integration for Fish Speech multilingual expressive cloning."
                        .to_string(),
                source_label: "Provider-hosted local server".to_string(),
                runtime: RuntimeRequirement {
                    id: "fish_speech_local".to_string(),
                    label: "Fish Speech local server".to_string(),
                    engine_family: "fish_speech".to_string(),
                    auto_routed: true,
                },
                available: false,
                local_only: true,
                coming_soon: true,
                license_label: Some("Fish Audio Research License".to_string()),
                capabilities: planned_capabilities.clone(),
            },
            ProviderDescriptor {
                id: TTS_PROVIDER_TADA_LOCAL_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "TADA Local".to_string(),
                description: "Planned local sidecar integration for Hume TADA models.".to_string(),
                source_label: "Provider-hosted model weights".to_string(),
                runtime: RuntimeRequirement {
                    id: "tada_local".to_string(),
                    label: "TADA local sidecar".to_string(),
                    engine_family: "tada".to_string(),
                    auto_routed: true,
                },
                available: false,
                local_only: true,
                coming_soon: true,
                license_label: Some("Llama 3.2".to_string()),
                capabilities: planned_capabilities.clone(),
            },
            ProviderDescriptor {
                id: TTS_PROVIDER_HF_S2S_LOCAL_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "HF Speech-to-Speech".to_string(),
                description:
                    "Planned local adapter for the Hugging Face speech-to-speech pipeline."
                        .to_string(),
                source_label: "Local pipeline adapter".to_string(),
                runtime: RuntimeRequirement {
                    id: "hf_s2s_local".to_string(),
                    label: "speech-to-speech local pipeline".to_string(),
                    engine_family: "speech_to_speech".to_string(),
                    auto_routed: true,
                },
                available: false,
                local_only: true,
                coming_soon: true,
                license_label: None,
                capabilities: planned_capabilities.clone(),
            },
        ]);

        let mut models = vec![
            CatalogModelDescriptor {
                id: TTS_MODEL_SYSTEM_DEFAULT_ID.to_string(),
                provider_id: TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "System Voices".to_string(),
                description: "Uses the operating system voice inventory.".to_string(),
                installed: true,
                selected: selected_provider_id == TTS_PROVIDER_SYSTEM_BUILTIN_ID
                    && selected_model_id.as_deref() == Some(TTS_MODEL_SYSTEM_DEFAULT_ID),
                downloadable: false,
                source_label: "Platform runtime".to_string(),
                runtime: system_runtime,
                license_label: None,
                locale: None,
                supported_languages: Vec::new(),
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
            CatalogModelDescriptor {
                id: TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string(),
                provider_id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
                domain: ModelDomain::Tts,
                label: "OpenAI-Compatible Speech API".to_string(),
                description: "Routes synthesis to the configured local speech endpoint."
                    .to_string(),
                installed: true,
                selected: selected_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                    && selected_model_id.as_deref() == Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID),
                downloadable: false,
                source_label: "User-managed local endpoint".to_string(),
                runtime: sidecar_runtime,
                license_label: None,
                locale: None,
                supported_languages: Vec::new(),
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
        ];

        models.extend(
            self.get_available_packs()
                .into_iter()
                .map(|pack| CatalogModelDescriptor {
                    id: pack.id.clone(),
                    provider_id: TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
                    domain: ModelDomain::Tts,
                    label: pack.label.clone(),
                    description: format!("Offline pack for {}", pack.locale),
                    installed: pack.installed,
                    selected: selected_provider_id == TTS_PROVIDER_SHERPA_PACK_ID
                        && selected_model_id.as_deref() == Some(pack.id.as_str()),
                    downloadable: true,
                    source_label: "Vox Jot curated assets".to_string(),
                    runtime: sherpa_runtime.clone(),
                    license_label: Some("Sherpa ONNX model assets".to_string()),
                    locale: Some(pack.locale.clone()),
                    supported_languages: vec![pack.locale.clone()],
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
                }),
        );

        models.extend(
            [
                (
                    "qwen3-0.6b-base",
                    TTS_PROVIDER_QWEN3_NATIVE_ID,
                    "Qwen3 0.6B Base",
                    "Voice cloning from reference audio.",
                    Some("Apache-2.0"),
                ),
                (
                    "qwen3-0.6b-customvoice",
                    TTS_PROVIDER_QWEN3_NATIVE_ID,
                    "Qwen3 0.6B CustomVoice",
                    "Preset voices with local native runtime.",
                    Some("Apache-2.0"),
                ),
                (
                    "qwen3-1.7b-customvoice",
                    TTS_PROVIDER_QWEN3_NATIVE_ID,
                    "Qwen3 1.7B CustomVoice",
                    "Preset voices plus expressive instruction control.",
                    Some("Apache-2.0"),
                ),
                (
                    "fish-s2-pro",
                    TTS_PROVIDER_FISH_SPEECH_LOCAL_ID,
                    "Fish Speech S2 Pro",
                    "Multilingual expressive local server runtime.",
                    Some("Fish Audio Research License"),
                ),
                (
                    "tada-1b",
                    TTS_PROVIDER_TADA_LOCAL_ID,
                    "TADA 1B",
                    "English voice cloning and long-form generation.",
                    Some("Llama 3.2"),
                ),
                (
                    "tada-3b-ml",
                    TTS_PROVIDER_TADA_LOCAL_ID,
                    "TADA 3B ML",
                    "Multilingual local sidecar model.",
                    Some("Llama 3.2"),
                ),
                (
                    "hf-s2s-default",
                    TTS_PROVIDER_HF_S2S_LOCAL_ID,
                    "speech-to-speech Adapter",
                    "Local adapter that orchestrates external TTS backends.",
                    None,
                ),
            ]
            .into_iter()
            .map(
                |(id, provider_id, label, description, license_label)| CatalogModelDescriptor {
                    id: id.to_string(),
                    provider_id: provider_id.to_string(),
                    domain: ModelDomain::Tts,
                    label: label.to_string(),
                    description: description.to_string(),
                    installed: false,
                    selected: selected_provider_id == provider_id
                        && selected_model_id.as_deref() == Some(id),
                    downloadable: false,
                    source_label: "Planned provider integration".to_string(),
                    runtime: providers
                        .iter()
                        .find(|provider| provider.id == provider_id)
                        .map(|provider| provider.runtime.clone())
                        .unwrap_or(RuntimeRequirement {
                            id: provider_id.to_string(),
                            label: provider_id.to_string(),
                            engine_family: provider_id.to_string(),
                            auto_routed: true,
                        }),
                    license_label: license_label.map(|value| value.to_string()),
                    locale: None,
                    supported_languages: Vec::new(),
                    capabilities: planned_capabilities.clone(),
                },
            ),
        );

        DomainCatalog { providers, models }
    }

    pub async fn download_pack(&self, pack_id: &str) -> Result<(), String> {
        let definition = PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == pack_id)
            .ok_or_else(|| format!("Unknown TTS pack '{pack_id}'"))?;
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
        Ok(())
    }

    pub fn remove_pack(&self, pack_id: &str) -> Result<(), String> {
        let install_dir = self.pack_install_dir(pack_id);
        if install_dir.exists() {
            fs::remove_dir_all(&install_dir)
                .map_err(|err| format!("Failed to remove TTS pack: {err}"))?;
        }
        Ok(())
    }

    pub async fn speak(&self, request: SpeakRequest) -> Result<(), String> {
        let settings = get_settings(&self.app_handle);
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
        let chunks = chunk_text(trimmed);
        let engine = self.resolve_engine_kind(&settings, locale.as_deref())?;
        let voice = self.select_voice(
            &settings,
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
        let tts_volume = settings.tts_volume.clamp(0.0, 1.0);
        let output_device = settings.selected_output_device.clone();
        let app_handle = self.app_handle.clone();
        let preferred_voice_id = voice.as_ref().map(|voice| voice.id.clone());
        let trigger = request.trigger.clone();

        info!(
            "Speaking {} chunk(s) with {:?} engine, voice {:?}, trigger {:?}",
            chunks.len(),
            engine,
            preferred_voice_id,
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
                            settings.tts_rate,
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
                            settings.tts_rate,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::Sidecar => {
                        speak_sidecar_chunk(
                            &chunk,
                            locale.as_deref(),
                            voice.as_ref(),
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
            TTS_PROVIDER_QWEN3_NATIVE_ID => {
                return Err(
                    "Qwen3 native TTS is planned but not available in this build yet.".to_string(),
                )
            }
            TTS_PROVIDER_FISH_SPEECH_LOCAL_ID => {
                return Err(
                    "Fish Speech local TTS is planned but not available in this build yet."
                        .to_string(),
                )
            }
            TTS_PROVIDER_TADA_LOCAL_ID => {
                return Err(
                    "TADA local TTS is planned but not available in this build yet.".to_string(),
                )
            }
            TTS_PROVIDER_HF_S2S_LOCAL_ID => {
                return Err(
                    "HF speech-to-speech TTS is planned but not available in this build yet."
                        .to_string(),
                )
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
        portable::app_data_dir(&self.app_handle)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("tts-packs")
            .join(pack_id)
    }

    fn runtime_install_dir(&self, platform_id: &str) -> PathBuf {
        portable::app_data_dir(&self.app_handle)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("tts-runtime")
            .join(platform_id)
    }

    #[cfg(target_os = "linux")]
    fn has_installed_pack_for_locale(&self, locale: Option<&str>) -> bool {
        let Some(locale) = locale else {
            return self.get_available_packs().iter().any(|pack| pack.installed);
        };
        self.get_available_packs()
            .iter()
            .any(|pack| pack.installed && locale_matches(Some(pack.locale.as_str()), Some(locale)))
    }

    fn installed_pack_voices(&self) -> Vec<VoiceInfo> {
        self.get_available_packs()
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

    async fn download_and_extract_archive(
        &self,
        candidate_urls: &[String],
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        let app_data_dir = portable::app_data_dir(&self.app_handle)
            .map_err(|err| format!("TTS dir error: {err}"))?;
        let download_dir = app_data_dir.join("tts-downloads");
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
        let client = reqwest::Client::new();
        let response = github_release::get_with_optional_github_auth(&client, url, None)
            .await
            .map_err(|err| format!("Failed to download {label}: {err}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Failed to download {label}: HTTP {} ({url})",
                response.status()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|err| format!("Failed to read {label} bytes: {err}"))?;

        let file_name = url
            .split('/')
            .next_back()
            .filter(|name| !name.is_empty())
            .unwrap_or("tts-asset.tar.gz");
        let archive_path = download_dir.join(format!("{}-{}", Uuid::new_v4(), file_name));
        fs::write(&archive_path, bytes).map_err(|err| format!("Failed to save {label}: {err}"))?;
        Ok(archive_path)
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
            TtsEngineKind::Sidecar => Vec::new(),
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

#[cfg(target_os = "macos")]
fn macos_system_voices() -> Result<Vec<VoiceInfo>, String> {
    let output = Command::new("/usr/bin/say")
        .args(["-v", "?"])
        .output()
        .map_err(|err| format!("Failed to enumerate macOS voices: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut voices = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(captures) = SAY_VOICE_RE.captures(trimmed) {
            let name = captures
                .name("name")
                .map(|value| value.as_str().trim().to_string())
                .unwrap_or_default();
            let locale = captures
                .name("locale")
                .map(|value| value.as_str().replace('_', "-"));
            voices.push(VoiceInfo {
                id: name.clone(),
                label: name,
                locale,
                engine: TtsEngineKind::System,
                installed: true,
                available: true,
            });
        }
    }

    Ok(voices)
}

#[cfg(target_os = "windows")]
fn windows_system_voices() -> Result<Vec<VoiceInfo>, String> {
    let script = r#"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object {
  $info = $_.VoiceInfo
  [PSCustomObject]@{
    id = $info.Name
    label = $info.Name
    locale = $info.Culture.Name
  }
}
$voices | ConvertTo-Json -Compress
"#;
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .map_err(|err| format!("Failed to enumerate Windows voices: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|err| format!("Failed to parse Windows voices: {err}"))?;
    let entries = match parsed {
        serde_json::Value::Array(values) => values,
        serde_json::Value::Object(_) => vec![parsed],
        _ => Vec::new(),
    };

    let voices = entries
        .into_iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?.to_string();
            let label = entry
                .get("label")
                .and_then(|value| value.as_str())
                .unwrap_or(&id)
                .to_string();
            let locale = entry
                .get("locale")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            Some(VoiceInfo {
                id,
                label,
                locale,
                engine: TtsEngineKind::System,
                installed: true,
                available: true,
            })
        })
        .collect();

    Ok(voices)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn windows_system_voices() -> Result<Vec<VoiceInfo>, String> {
    Ok(Vec::new())
}

fn sherpa_runtime_definition() -> Option<SherpaRuntimeDefinition> {
    #[cfg(target_os = "macos")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "macos-universal2",
            archive_name: "tts-sherpa-runtime-macos-universal2.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-osx-universal2-shared.tar.bz2",
        });
    }
    #[cfg(target_os = "linux")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "linux-x64",
            archive_name: "tts-sherpa-runtime-linux-x64.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-linux-x64-shared.tar.bz2",
        });
    }
    #[cfg(target_os = "windows")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "windows-x64",
            archive_name: "tts-sherpa-runtime-win-x64.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-win-x64-shared.tar.bz2",
        });
    }
    #[allow(unreachable_code)]
    None
}

fn sherpa_runtime_binary_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return runtime_root.join("bin").join("sherpa-onnx-offline-tts.exe");
    }
    #[cfg(not(target_os = "windows"))]
    {
        runtime_root.join("bin").join("sherpa-onnx-offline-tts")
    }
}

fn resolve_extracted_root(base_dir: &Path) -> Option<PathBuf> {
    if !base_dir.exists() {
        return None;
    }

    let mut current = base_dir.to_path_buf();
    loop {
        let entries = fs::read_dir(&current).ok()?;
        let mut child_dirs = Vec::new();
        let mut saw_file = false;

        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }

            if entry.file_type().ok()?.is_dir() {
                child_dirs.push(path);
            } else {
                saw_file = true;
            }
        }

        if !saw_file && child_dirs.len() == 1 {
            current = child_dirs.pop().unwrap();
            continue;
        }

        return Some(current);
    }
}

fn extract_archive(archive_path: &Path, install_dir: &Path) -> Result<(), String> {
    if install_dir.exists() {
        fs::remove_dir_all(install_dir)
            .map_err(|err| format!("Failed to clear archive destination: {err}"))?;
    }
    fs::create_dir_all(install_dir)
        .map_err(|err| format!("Failed to create archive destination: {err}"))?;

    let file = File::open(archive_path)
        .map_err(|err| format!("Failed to open archive {:?}: {err}", archive_path))?;
    let archive_name = archive_path.to_string_lossy();

    if archive_name.ends_with(".tar.gz") {
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(install_dir)
            .map_err(|err| format!("Failed to extract tar.gz archive: {err}"))?;
    } else if archive_name.ends_with(".tar.bz2") {
        let decoder = bzip2::read::BzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(install_dir)
            .map_err(|err| format!("Failed to extract tar.bz2 archive: {err}"))?;
    } else {
        return Err(format!(
            "Unsupported TTS archive format: {}",
            archive_path.display()
        ));
    }

    Ok(())
}

fn speak_sherpa_chunk(
    text: &str,
    context: &SherpaContext,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let temp_file = std::env::temp_dir().join(format!("vox-jot-sherpa-{}.wav", Uuid::new_v4()));
    let binary_path = sherpa_runtime_binary_path(&context.runtime_root);
    let lib_dir = context.runtime_root.join("lib");
    let mut command = Command::new(&binary_path);
    command
        .arg("--output-filename")
        .arg(&temp_file)
        .arg("--num-threads")
        .arg("2");

    match context.manifest.model_family {
        SherpaModelFamily::Vits => {
            command
                .arg("--vits-model")
                .arg(context.pack_root.join(&context.manifest.model_file))
                .arg("--vits-tokens")
                .arg(context.pack_root.join(&context.manifest.tokens_file))
                .arg("--vits-length-scale")
                .arg(format!(
                    "{:.3}",
                    (1.0 / rate.clamp(0.5, 2.0)).clamp(0.5, 2.0)
                ));

            if let Some(data_dir) = context.manifest.data_dir.as_deref() {
                command
                    .arg("--vits-data-dir")
                    .arg(context.pack_root.join(data_dir));
            }
            if let Some(lexicon_file) = context.manifest.lexicon_file.as_deref() {
                command
                    .arg("--vits-lexicon")
                    .arg(context.pack_root.join(lexicon_file));
            }
        }
    }

    if !context.manifest.rule_fsts.is_empty() {
        let joined = context
            .manifest
            .rule_fsts
            .iter()
            .map(|file| context.pack_root.join(file).display().to_string())
            .collect::<Vec<_>>()
            .join(",");
        command.arg("--tts-rule-fsts").arg(joined);
    }

    #[cfg(target_os = "macos")]
    command.env("DYLD_LIBRARY_PATH", &lib_dir);
    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", &lib_dir);
    #[cfg(target_os = "windows")]
    {
        let existing_path = std::env::var_os("PATH").unwrap_or_default();
        let mut runtime_path = std::ffi::OsString::from(lib_dir.as_os_str());
        runtime_path.push(";");
        runtime_path.push(context.runtime_root.join("bin"));
        runtime_path.push(";");
        runtime_path.push(existing_path);
        command.env("PATH", runtime_path);
    }

    let output = command
        .arg(text)
        .output()
        .map_err(|err| format!("Failed to run Sherpa-ONNX TTS: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            format!("Sherpa-ONNX TTS failed: {stderr}")
        } else if !stdout.is_empty() {
            format!("Sherpa-ONNX TTS failed: {stdout}")
        } else {
            "Sherpa-ONNX TTS failed without a detailed error.".to_string()
        });
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_file);
        return Ok(());
    }

    let play_result =
        audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play Sherpa-ONNX speech audio: {err}"));
    let _ = fs::remove_file(&temp_file);
    play_result
}

fn speak_system_chunk(
    app_handle: &AppHandle,
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = locale;
        speak_system_chunk_macos(
            app_handle,
            text,
            voice,
            rate,
            volume,
            output_device,
            stop_flag,
        )
    }
    #[cfg(target_os = "windows")]
    {
        speak_system_chunk_windows(
            app_handle,
            text,
            locale,
            voice,
            rate,
            volume,
            output_device,
            stop_flag,
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (
            app_handle,
            text,
            locale,
            voice,
            rate,
            volume,
            output_device,
            stop_flag,
        );
        Err("System TTS is not supported on this platform.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn speak_system_chunk_macos(
    app_handle: &AppHandle,
    text: &str,
    voice: Option<&VoiceInfo>,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    // `say` on this macOS stack will happily synthesize AIFF, while our playback
    // path is happiest with PCM WAV. Generate AIFF first, then normalize with
    // `afconvert` before playback.
    let synthesized_file = tts_temp_file(app_handle, "aiff")?;
    let playback_file = tts_temp_file(app_handle, "wav")?;
    let rate_wpm = (rate_to_words_per_minute(rate)).to_string();
    let mut command = Command::new("/usr/bin/say");
    if let Some(voice) = voice {
        command.args(["-v", &voice.id]);
    }
    command
        .arg("-r")
        .arg(rate_wpm)
        .arg("-o")
        .arg(&synthesized_file)
        .arg(text)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start macOS speech synthesis: {err}"))?;

    while !stop_flag.load(Ordering::Relaxed) {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let output = child.wait_with_output().map_err(|err| {
                        format!("Failed to read macOS speech synthesis error: {err}")
                    })?;
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(if stderr.is_empty() {
                        "macOS speech synthesis failed.".to_string()
                    } else {
                        format!("macOS speech synthesis failed: {stderr}")
                    });
                }
                break;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(err) => return Err(format!("Failed to monitor speech synthesis: {err}")),
        }
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(&synthesized_file);
        let _ = fs::remove_file(&playback_file);
        return Ok(());
    }

    if !synthesized_file.exists() {
        return Err("macOS speech synthesis did not create an audio file.".to_string());
    }

    let afconvert_output = Command::new("/usr/bin/afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@22050"])
        .arg(&synthesized_file)
        .arg(&playback_file)
        .output()
        .map_err(|err| format!("Failed to start macOS audio conversion: {err}"))?;
    if !afconvert_output.status.success() {
        let stderr = String::from_utf8_lossy(&afconvert_output.stderr)
            .trim()
            .to_string();
        let _ = fs::remove_file(&synthesized_file);
        let _ = fs::remove_file(&playback_file);
        return Err(if stderr.is_empty() {
            "macOS audio conversion failed.".to_string()
        } else {
            format!("macOS audio conversion failed: {stderr}")
        });
    }

    audio_playback::play_audio_file_with_stop(&playback_file, output_device, volume, stop_flag)
        .map_err(|err| format!("Failed to play speech audio: {err}"))?;
    let _ = fs::remove_file(&synthesized_file);
    let _ = fs::remove_file(&playback_file);
    Ok(())
}

#[cfg(target_os = "windows")]
fn speak_system_chunk_windows(
    app_handle: &AppHandle,
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let temp_file = tts_temp_file(app_handle, "wav")?;
    let mut script = String::from(
        "Add-Type -AssemblyName System.Speech\n$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer\n",
    );
    if let Some(voice) = voice {
        script.push_str(&format!(
            "$synth.SelectVoice('{}')\n",
            voice.id.replace('\'', "''")
        ));
    } else if let Some(locale) = locale {
        script.push_str(
            "$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq '",
        );
        script.push_str(&locale.replace('\'', "''"));
        script.push_str("' } | Select-Object -First 1\nif ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }\n");
    }
    script.push_str(&format!(
        "$synth.Rate = {}\n$synth.SetOutputToWaveFile('{}')\n$synth.Speak('{}')\n$synth.Dispose()\n",
        rate_to_windows_rate(rate),
        temp_file.display().to_string().replace('\'', "''"),
        text.replace('\'', "''")
    ));

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|err| format!("Failed to run Windows speech synthesis: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_file);
        return Ok(());
    }

    audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
        .map_err(|err| format!("Failed to play speech audio: {err}"))?;
    let _ = fs::remove_file(&temp_file);
    Ok(())
}

fn speak_sidecar_chunk(
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let runtime = tokio::runtime::Handle::current();
    let sidecar_url = std::env::var("VOX_JOT_TTS_SIDECAR_URL")
        .unwrap_or_else(|_| DEFAULT_SIDECAR_URL.to_string());

    let payload = serde_json::json!({
        "input": text,
        "voice": voice.map(|voice| voice.id.clone()),
        "locale": locale,
        "format": "wav"
    });

    let bytes = runtime.block_on(async {
        let client = reqwest::Client::new();
        let response = client
            .post(&sidecar_url)
            .json(&payload)
            .send()
            .await
            .map_err(|err| format!("Failed to call TTS sidecar: {err}"))?;
        if !response.status().is_success() {
            return Err(format!("TTS sidecar returned HTTP {}", response.status()));
        }
        response
            .bytes()
            .await
            .map_err(|err| format!("Failed to read TTS sidecar audio: {err}"))
    })?;

    let temp_file = std::env::temp_dir().join(format!("vox-jot-sidecar-{}.wav", Uuid::new_v4()));
    fs::write(&temp_file, &bytes).map_err(|err| format!("Failed to save sidecar audio: {err}"))?;
    let play_result =
        audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play sidecar speech audio: {err}"));
    let _ = fs::remove_file(&temp_file);
    play_result
}

fn tts_temp_file(app_handle: &AppHandle, extension: &str) -> Result<PathBuf, String> {
    let base_dir = portable::app_data_dir(app_handle)
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;
    let tts_dir = base_dir.join("tts-cache");
    fs::create_dir_all(&tts_dir).map_err(|err| format!("Failed to create TTS cache dir: {err}"))?;
    Ok(tts_dir.join(format!("{}.{}", Uuid::new_v4(), extension)))
}

fn rate_to_words_per_minute(rate: f32) -> u32 {
    let normalized = rate.clamp(0.5, 2.0);
    let words_per_minute = 180.0 * normalized;
    words_per_minute.round() as u32
}

#[cfg(target_os = "windows")]
fn rate_to_windows_rate(rate: f32) -> i32 {
    let normalized = rate.clamp(0.5, 2.0);
    (((normalized - 1.0) * 10.0).round() as i32).clamp(-10, 10)
}

pub fn normalize_locale(locale: Option<&str>) -> Option<String> {
    locale
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.replace('_', "-"))
}

fn locale_language(locale: &str) -> String {
    locale
        .split(['-', '_'])
        .next()
        .unwrap_or(locale)
        .to_ascii_lowercase()
}

fn locale_matches(lhs: Option<&str>, rhs: Option<&str>) -> bool {
    match (lhs, rhs) {
        (Some(lhs), Some(rhs)) => lhs.eq_ignore_ascii_case(rhs),
        _ => false,
    }
}

pub fn chunk_text(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n") {
        let trimmed = paragraph.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.chars().count() > 1200 {
            for sentence in split_sentences(trimmed) {
                push_chunk(&mut chunks, &mut current, &sentence, 1200);
            }
        } else {
            push_chunk(&mut chunks, &mut current, trimmed, 1200);
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.trim().to_string());
    }

    chunks
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | '\n') {
            if !current.trim().is_empty() {
                segments.push(current.trim().to_string());
            }
            current.clear();
        }
    }

    if !current.trim().is_empty() {
        segments.push(current.trim().to_string());
    }

    segments
}

fn push_chunk(chunks: &mut Vec<String>, current: &mut String, candidate: &str, max_len: usize) {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return;
    }

    if current.is_empty() {
        if candidate.chars().count() <= max_len {
            current.push_str(candidate);
            return;
        }

        for hard_chunk in hard_split(candidate, max_len) {
            chunks.push(hard_chunk);
        }
        return;
    }

    let proposed = format!("{current}\n\n{candidate}");
    if proposed.chars().count() <= max_len {
        *current = proposed;
        return;
    }

    chunks.push(current.trim().to_string());
    current.clear();

    if candidate.chars().count() <= max_len {
        current.push_str(candidate);
    } else {
        for hard_chunk in hard_split(candidate, max_len) {
            chunks.push(hard_chunk);
        }
    }
}

fn hard_split(text: &str, max_len: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        let proposed = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };

        if proposed.chars().count() <= max_len {
            current = proposed;
        } else {
            if !current.is_empty() {
                chunks.push(current.trim().to_string());
            }
            current = word.to_string();
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    chunks
}

pub fn build_auto_speak_plan(
    settings: &AppSettings,
    origin: TranslationOrigin,
    had_preview: bool,
    final_text: &str,
    translated_text: Option<&str>,
    locale: Option<String>,
) -> TtsAutoSpeakPlan {
    let scope_allows = match settings.tts_auto_readback_scope {
        TtsAutoReadbackScope::DictationOnly => matches!(origin, TranslationOrigin::Dictation),
        TtsAutoReadbackScope::DictationAndSelection => true,
    };
    let mode_allows = match settings.tts_auto_readback_mode {
        TtsAutoReadbackMode::Off => false,
        TtsAutoReadbackMode::AfterOutput => true,
        TtsAutoReadbackMode::AfterPreviewConfirm => had_preview,
    };

    let should_speak =
        settings.tts_enabled && scope_allows && mode_allows && !final_text.trim().is_empty();
    let text = match settings.tts_readback_text_mode {
        TtsReadbackTextMode::TranslatedBlock => translated_text
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(final_text)
            .to_string(),
        TtsReadbackTextMode::FinalOutput => final_text.to_string(),
    };

    let engine = if should_speak {
        Some(
            match settings.tts_engine_preference {
                TtsEnginePreference::Auto => "auto",
                TtsEnginePreference::System => "system",
                TtsEnginePreference::SherpaOnnx => "sherpa_onnx",
                TtsEnginePreference::Sidecar => "sidecar",
            }
            .to_string(),
        )
    } else {
        None
    };

    TtsAutoSpeakPlan {
        should_speak,
        text,
        locale: locale.clone(),
        trigger: match origin {
            TranslationOrigin::Dictation => "auto_readback_dictation".to_string(),
            TranslationOrigin::Selection => "auto_readback_selection".to_string(),
        },
        tts_requested: should_speak,
        tts_engine: engine,
        tts_voice_id: settings.tts_default_voice_id.clone(),
        tts_locale: locale,
        tts_status: if should_speak {
            Some("pending".to_string())
        } else {
            None
        },
    }
}

pub fn choose_readback_locale(
    settings: &AppSettings,
    origin: TranslationOrigin,
    source_language: Option<&str>,
    target_language: Option<&str>,
) -> Option<String> {
    match settings.tts_readback_text_mode {
        TtsReadbackTextMode::TranslatedBlock => {
            normalize_locale(target_language.or(source_language))
        }
        TtsReadbackTextMode::FinalOutput => {
            if matches!(origin, TranslationOrigin::Dictation)
                && settings.translation_output_mode
                    == crate::settings::TranslationOutputMode::Bilingual
            {
                normalize_locale(target_language.or(source_language))
            } else {
                normalize_locale(source_language.or(target_language))
            }
        }
    }
}

pub fn default_preview_request(voice_id: Option<String>) -> SpeakRequest {
    SpeakRequest {
        text: PREVIEW_SAMPLE_TEXT.to_string(),
        locale: None,
        preferred_voice_id: voice_id,
        trigger: Some("preview_tts_voice".to_string()),
        remember_last_output: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_splits_long_input() {
        let text = format!("{}\n\n{}", "hello ".repeat(250), "world ".repeat(250));
        let chunks = chunk_text(&text);
        assert!(chunks.len() >= 2);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 1200));
    }

    #[test]
    fn auto_speak_plan_prefers_translated_block_when_requested() {
        let mut settings = crate::settings::get_default_settings();
        settings.tts_enabled = true;
        settings.tts_auto_readback_mode = TtsAutoReadbackMode::AfterOutput;
        settings.tts_auto_readback_scope = TtsAutoReadbackScope::DictationAndSelection;
        settings.tts_readback_text_mode = TtsReadbackTextMode::TranslatedBlock;

        let plan = build_auto_speak_plan(
            &settings,
            TranslationOrigin::Dictation,
            false,
            "hola\n\nhello",
            Some("hello"),
            Some("en".to_string()),
        );

        assert!(plan.should_speak);
        assert_eq!(plan.text, "hello");
        assert_eq!(plan.tts_status.as_deref(), Some("pending"));
    }

    #[test]
    fn auto_speak_plan_respects_preview_only_mode() {
        let mut settings = crate::settings::get_default_settings();
        settings.tts_enabled = true;
        settings.tts_auto_readback_mode = TtsAutoReadbackMode::AfterPreviewConfirm;

        let without_preview = build_auto_speak_plan(
            &settings,
            TranslationOrigin::Dictation,
            false,
            "hello",
            None,
            Some("en".to_string()),
        );
        assert!(!without_preview.should_speak);

        let with_preview = build_auto_speak_plan(
            &settings,
            TranslationOrigin::Dictation,
            true,
            "hello",
            None,
            Some("en".to_string()),
        );
        assert!(with_preview.should_speak);
    }
}
