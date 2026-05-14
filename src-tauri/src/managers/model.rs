use crate::github_release;
use crate::settings::{get_settings, write_settings};
use anyhow::Result;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tar::Archive;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum EngineType {
    Whisper,
    Parakeet,
    Moonshine,
    MoonshineStreaming,
    SenseVoice,
    GigaAM,
    MlxAudioStt,
    AppleSpeech,
    AppleSpeechStreaming,
}

pub fn engine_uses_remote_runtime(engine_type: &EngineType) -> bool {
    matches!(
        engine_type,
        EngineType::MlxAudioStt | EngineType::AppleSpeech | EngineType::AppleSpeechStreaming
    )
}

pub fn model_is_available(model: &ModelInfo) -> bool {
    model.is_downloaded || (engine_uses_remote_runtime(&model.engine_type) && model.url.is_none())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub filename: String,
    pub url: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    pub size_mb: u64,
    pub is_downloaded: bool,
    pub is_downloading: bool,
    pub partial_size: u64,
    pub is_directory: bool,
    pub engine_type: EngineType,
    pub accuracy_score: f32,        // 0.0 to 1.0, higher is more accurate
    pub speed_score: f32,           // 0.0 to 1.0, higher is faster
    pub supports_translation: bool, // Whether the model supports translating to English
    pub is_recommended: bool,       // Whether this is the recommended model for new users
    pub supported_languages: Vec<String>, // Languages this model can transcribe
    pub is_custom: bool,            // Whether this is a user-provided custom model
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
}

#[derive(Debug, Deserialize)]
struct HfModelInfo {
    #[serde(default)]
    siblings: Vec<HfSibling>,
}

pub struct ModelManager {
    app_handle: AppHandle,
    models_dir: PathBuf,
    available_models: Mutex<HashMap<String, ModelInfo>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    extracting_models: Arc<Mutex<HashSet<String>>>,
}

impl ModelManager {
    fn stt_provider_id_for_engine(engine_type: &EngineType) -> &'static str {
        match engine_type {
            EngineType::Whisper => "stt_whisper",
            EngineType::Parakeet => "stt_parakeet",
            EngineType::Moonshine => "stt_moonshine",
            EngineType::MoonshineStreaming => "stt_moonshine_streaming",
            EngineType::SenseVoice => "stt_sensevoice",
            EngineType::GigaAM => "stt_gigaam",
            EngineType::MlxAudioStt => "stt_mlx_audio",
            EngineType::AppleSpeech | EngineType::AppleSpeechStreaming => "stt_apple_speech",
        }
    }

    fn whisper_models_base_url() -> String {
        std::env::var("VOX_JOT_WHISPER_MODELS_BASE_URL").unwrap_or_else(|_| {
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main".to_string()
        })
    }

    fn model_source_base_url() -> String {
        std::env::var("VOX_JOT_STT_MODELS_BASE_URL").unwrap_or_else(|_| {
            "https://huggingface.co/IrieDinamik/vox-jot-models/resolve/main".to_string()
        })
    }

    fn model_url_for(model_id: &str, filename: &str, use_hf_base: bool) -> String {
        let override_key = format!(
            "VOX_JOT_STT_MODEL_URL_{}",
            model_id.replace('-', "_").to_uppercase()
        );

        if let Ok(override_url) = std::env::var(override_key) {
            let trimmed = override_url.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }

        let base_url = if use_hf_base {
            Self::whisper_models_base_url()
        } else {
            Self::model_source_base_url()
        };

        format!("{}/{}", base_url.trim_end_matches('/'), filename)
    }

    fn whisper_cpp_resolve_url(filename: &str) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            filename
        )
    }

    fn vox_jot_models_resolve_url(path: &str) -> String {
        format!(
            "{}/{}",
            Self::model_source_base_url().trim_end_matches('/'),
            path
        )
    }

    fn hf_snapshot_url(repo_id: &str) -> String {
        format!("hf-snapshot://{repo_id}")
    }

    fn parse_hf_snapshot_url(url: &str) -> Option<&str> {
        url.strip_prefix("hf-snapshot://")
            .map(str::trim)
            .filter(|repo_id| repo_id.contains('/') && !repo_id.is_empty())
    }

    fn is_tar_gz_url(url: &str) -> bool {
        let path = url.split('?').next().unwrap_or(url);
        path.ends_with(".tar.gz")
    }

    fn catalog_progress_total_bytes(model_info: &ModelInfo) -> u64 {
        model_info.size_mb.saturating_mul(1024 * 1024)
    }

    fn download_progress_percentage(
        downloaded: u64,
        total: u64,
        has_exact_total: bool,
        complete: bool,
    ) -> f64 {
        if complete {
            return 100.0;
        }

        if total == 0 {
            return 0.0;
        }

        let percentage = (downloaded as f64 / total as f64) * 100.0;
        if has_exact_total {
            percentage.clamp(0.0, 100.0)
        } else {
            percentage.clamp(0.0, 99.0)
        }
    }

    fn hf_snapshot_file_is_needed(name: &str) -> bool {
        !name.starts_with('.')
            && !name.contains("/.cache/")
            && !name.starts_with(".cache/")
            && !name.contains("/.git/")
            && !name.starts_with(".git/")
    }

    fn collect_files_recursive(root: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(root)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                Self::collect_files_recursive(&path, files)?;
            } else {
                files.push(path);
            }
        }

        Ok(())
    }

    fn copy_path_if_missing(source: &Path, destination: &Path) -> Result<()> {
        if !source.exists() || destination.exists() {
            return Ok(());
        }

        if source.is_file() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(source, destination)?;
            return Ok(());
        }

        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            Self::copy_path_if_missing(&entry.path(), &destination.join(entry.file_name()))?;
        }

        Ok(())
    }

    fn verify_optional_sha256(path: &Path, expected_sha256: Option<&str>) -> Result<()> {
        let Some(expected_sha256) = expected_sha256.map(str::trim).filter(|s| !s.is_empty()) else {
            return Ok(());
        };

        let mut file = File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let actual_sha256 = format!("{:x}", hasher.finalize());
        if actual_sha256.eq_ignore_ascii_case(expected_sha256) {
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "SHA-256 mismatch for downloaded model: expected {}, got {}",
                expected_sha256,
                actual_sha256
            ))
        }
    }

    fn set_model_downloading(&self, model_id: &str, is_downloading: bool) {
        let mut models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(model) = models.get_mut(model_id) {
            model.is_downloading = is_downloading;
        }
    }

    fn clear_download_cancel_flag(&self, model_id: &str) {
        let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
        flags.remove(model_id);
    }

    fn remove_extracting_model(&self, model_id: &str) {
        let mut extracting = self
            .extracting_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        extracting.remove(model_id);
    }

    fn migrate_local_mlx_stt_assets(app_handle: &AppHandle, models_dir: &Path) -> Result<()> {
        let Some(home) = dirs::home_dir() else {
            return Ok(());
        };

        let asset_names = [
            "Voxtral-Mini-3B-2507-bf16",
            "Voxtral-Mini-4B-Realtime-2602-4bit",
        ];
        let tts_store_dir = crate::storage_paths::tts_model_store_dir(app_handle)
            .map_err(|err| anyhow::anyhow!("Failed to resolve TTS store dir: {err}"))?;
        let stt_mlx_dir = models_dir.join("MLX").join("mlx-community");

        for asset_name in asset_names {
            let destination = stt_mlx_dir.join(asset_name);
            let candidate_sources = [
                tts_store_dir
                    .join("MLX")
                    .join("mlx-community")
                    .join(asset_name),
                home.join("Apps")
                    .join("Models")
                    .join("MLX")
                    .join("mlx-community")
                    .join(asset_name),
            ];

            for source in candidate_sources {
                if source.exists() {
                    Self::copy_path_if_missing(&source, &destination)?;
                    break;
                }
            }
        }

        Ok(())
    }

    fn normalize_extracted_model_layout(model_id: &str, final_model_path: &Path) -> Result<()> {
        if model_id != "gigaam-v3-e2e-ctc" {
            return Ok(());
        }

        let expected = final_model_path.join("model.onnx");
        let mirrored = final_model_path.join("v3_e2e_ctc.int8.onnx");
        if !expected.exists() && mirrored.exists() {
            if let Err(err) = fs::hard_link(&mirrored, &expected) {
                warn!(
                    "Failed to hard-link GigaAM model alias, copying instead: {}",
                    err
                );
                fs::copy(&mirrored, &expected)?;
            }
        }

        let vocab = final_model_path.join("vocab.txt");
        if !vocab.exists() {
            let mirrored_vocab = final_model_path.join("v3_e2e_ctc_vocab.txt");
            if mirrored_vocab.exists() {
                fs::copy(&mirrored_vocab, &vocab)?;
            }
        }

        Ok(())
    }

    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create models directory in app data
        let models_dir = crate::storage_paths::stt_models_dir(app_handle)
            .map_err(|e| anyhow::anyhow!("Failed to get STT model dir: {}", e))?;

        if !models_dir.exists() {
            fs::create_dir_all(&models_dir)?;
        }

        Self::migrate_local_mlx_stt_assets(app_handle, &models_dir)?;

        let mut available_models = HashMap::new();

        // Whisper supported languages (99 languages from tokenizer)
        // Including zh-Hans and zh-Hant variants to match frontend language codes
        let whisper_languages: Vec<String> = vec![
            "en", "zh", "zh-Hans", "zh-Hant", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl",
            "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs",
            "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy",
            "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is",
            "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo",
            "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht",
            "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln",
            "ha", "ba", "jw", "su", "yue",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        available_models.insert(
            "apple-speech-analyzer".to_string(),
            ModelInfo {
                id: "apple-speech-analyzer".to_string(),
                name: "Apple Speech".to_string(),
                description:
                    "Built-in Apple SpeechAnalyzer engine. Requires macOS 26 and no Vox Jot model download."
                        .to_string(),
                filename: "apple-speech-analyzer".to_string(),
                url: None,
                sha256: None,
                size_mb: 0,
                is_downloaded: cfg!(target_os = "macos"),
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::AppleSpeech,
                accuracy_score: 0.78,
                speed_score: 0.85,
                supports_translation: false,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "apple-speech-progressive".to_string(),
            ModelInfo {
                id: "apple-speech-progressive".to_string(),
                name: "Apple Speech (Progressive)".to_string(),
                description:
                    "Built-in Apple SpeechAnalyzer progressive preset for faster partial-style results. Requires macOS 26."
                        .to_string(),
                filename: "apple-speech-progressive".to_string(),
                url: None,
                sha256: None,
                size_mb: 0,
                is_downloaded: cfg!(target_os = "macos"),
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::AppleSpeechStreaming,
                accuracy_score: 0.76,
                speed_score: 0.90,
                supports_translation: false,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        // TODO this should be read from a JSON file or something..
        available_models.insert(
            "tiny".to_string(),
            ModelInfo {
                id: "tiny".to_string(),
                name: "Whisper Tiny".to_string(),
                description: "Fastest multilingual Whisper model.".to_string(),
                filename: "ggml-tiny.bin".to_string(),
                url: Some(Self::whisper_cpp_resolve_url("ggml-tiny.bin")),
                sha256: None,
                size_mb: 75,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.45,
                speed_score: 0.98,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "tiny.en".to_string(),
            ModelInfo {
                id: "tiny.en".to_string(),
                name: "Whisper Tiny (English)".to_string(),
                description: "Fastest English-only Whisper model.".to_string(),
                filename: "ggml-tiny.en.bin".to_string(),
                url: Some(Self::whisper_cpp_resolve_url("ggml-tiny.en.bin")),
                sha256: None,
                size_mb: 75,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.47,
                speed_score: 0.99,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        available_models.insert(
            "base".to_string(),
            ModelInfo {
                id: "base".to_string(),
                name: "Whisper Base".to_string(),
                description: "Fast multilingual Whisper model.".to_string(),
                filename: "ggml-base.bin".to_string(),
                url: Some(Self::whisper_cpp_resolve_url("ggml-base.bin")),
                sha256: None,
                size_mb: 142,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.52,
                speed_score: 0.94,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "base.en".to_string(),
            ModelInfo {
                id: "base.en".to_string(),
                name: "Whisper Base (English)".to_string(),
                description: "Fast English-only Whisper model.".to_string(),
                filename: "ggml-base.en.bin".to_string(),
                url: Some(Self::whisper_cpp_resolve_url("ggml-base.en.bin")),
                sha256: None,
                size_mb: 142,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.55,
                speed_score: 0.95,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        available_models.insert(
            "small".to_string(),
            ModelInfo {
                id: "small".to_string(),
                name: "Whisper Small".to_string(),
                description: "Fast and fairly accurate.".to_string(),
                filename: "ggml-small.bin".to_string(),
                url: Some(Self::model_url_for("small", "ggml-small.bin", true)),
                sha256: None,
                size_mb: 487,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.60,
                speed_score: 0.85,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "small.en".to_string(),
            ModelInfo {
                id: "small.en".to_string(),
                name: "Whisper Small (English)".to_string(),
                description: "Balanced English-only model with strong speed and quality."
                    .to_string(),
                filename: "ggml-small.en.bin".to_string(),
                url: Some(Self::whisper_cpp_resolve_url("ggml-small.en.bin")),
                sha256: None,
                size_mb: 487,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.64,
                speed_score: 0.86,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        // Add downloadable models
        available_models.insert(
            "medium".to_string(),
            ModelInfo {
                id: "medium".to_string(),
                name: "Whisper Medium".to_string(),
                description: "Good accuracy, medium speed".to_string(),
                filename: "ggml-medium.bin".to_string(),
                url: Some(Self::model_url_for("medium", "ggml-medium.bin", true)),
                sha256: None,
                size_mb: 1500, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.75,
                speed_score: 0.60,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "medium.en".to_string(),
            ModelInfo {
                id: "medium.en".to_string(),
                name: "Whisper Medium (English)".to_string(),
                description: "High-quality English-only Whisper model.".to_string(),
                filename: "ggml-medium.en.bin".to_string(),
                url: Some(Self::whisper_cpp_resolve_url("ggml-medium.en.bin")),
                sha256: None,
                size_mb: 1500,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.78,
                speed_score: 0.62,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        available_models.insert(
            "whisper-medium-q4_1".to_string(),
            ModelInfo {
                id: "whisper-medium-q4_1".to_string(),
                name: "Whisper Medium Q4_1".to_string(),
                description: "Preserved local Whisper Medium Q4_1 model, mirrored to Hugging Face for recovery.".to_string(),
                filename: "whisper-medium-q4_1.bin".to_string(),
                url: Some(
                    "https://huggingface.co/IrieDinamik/vox-jot-stt-whisper-medium-q4_1/resolve/main/whisper-medium-q4_1.bin"
                        .to_string(),
                ),
                sha256: None,
                size_mb: 469,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.74,
                speed_score: 0.68,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "turbo".to_string(),
            ModelInfo {
                id: "turbo".to_string(),
                name: "Whisper Turbo".to_string(),
                description: "Balanced accuracy and speed.".to_string(),
                filename: "ggml-large-v3-turbo.bin".to_string(),
                url: Some(Self::model_url_for(
                    "turbo",
                    "ggml-large-v3-turbo.bin",
                    true,
                )),
                sha256: None,
                size_mb: 1600, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.80,
                speed_score: 0.40,
                supports_translation: false, // Turbo doesn't support translation
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "large".to_string(),
            ModelInfo {
                id: "large".to_string(),
                name: "Whisper Large".to_string(),
                description: "Good accuracy, but slow.".to_string(),
                filename: "ggml-large-v3-q5_0.bin".to_string(),
                url: Some(Self::model_url_for("large", "ggml-large-v3-q5_0.bin", true)),
                sha256: None,
                size_mb: 1100, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.85,
                speed_score: 0.30,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        available_models.insert(
            "breeze-asr".to_string(),
            ModelInfo {
                id: "breeze-asr".to_string(),
                name: "Breeze ASR".to_string(),
                description: "Optimized for Taiwanese Mandarin. Code-switching support."
                    .to_string(),
                filename: "breeze-asr-q5_k.bin".to_string(),
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/breeze/breeze-asr-q5_k.bin",
                )),
                sha256: Some(
                    "8efbf0ce8a3f50fe332b7617da787fb81354b358c288b008d3bdef8359df64c6".to_string(),
                ),
                size_mb: 1080,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.85,
                speed_score: 0.35,
                supports_translation: false,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                is_custom: false,
            },
        );

        // Add NVIDIA Parakeet models (directory-based)
        available_models.insert(
            "parakeet-tdt-0.6b-v2".to_string(),
            ModelInfo {
                id: "parakeet-tdt-0.6b-v2".to_string(),
                name: "Parakeet V2".to_string(),
                description: "English only. The best model for English speakers.".to_string(),
                filename: "parakeet-tdt-0.6b-v2-int8".to_string(), // Directory name
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/parakeet/parakeet-v2-int8.tar.gz",
                )),
                sha256: Some(
                    "0cfb21f242e32b08e029fdd2936da44ff1ed404aa0a64266720d3bb7e8805ae3".to_string(),
                ),
                size_mb: 473, // Approximate size for int8 quantized model
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::Parakeet,
                accuracy_score: 0.85,
                speed_score: 0.85,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        // Parakeet V3 supported languages (25 EU languages + Russian/Ukrainian):
        // bg, hr, cs, da, nl, en, et, fi, fr, de, el, hu, it, lv, lt, mt, pl, pt, ro, sk, sl, es, sv, ru, uk
        let parakeet_v3_languages: Vec<String> = vec![
            "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv",
            "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        available_models.insert(
            "parakeet-tdt-0.6b-v3".to_string(),
            ModelInfo {
                id: "parakeet-tdt-0.6b-v3".to_string(),
                name: "Parakeet V3".to_string(),
                description: "Fast and accurate. Supports 25 European languages.".to_string(),
                filename: "parakeet-tdt-0.6b-v3-int8".to_string(), // Directory name
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/parakeet/parakeet-v3-int8.tar.gz",
                )),
                sha256: Some(
                    "d5c1089f9f73666adfea5d62e15d4e078b911cc9cb1db557c3637fd4b80218cb".to_string(),
                ),
                size_mb: 478, // Approximate size for int8 quantized model
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::Parakeet,
                accuracy_score: 0.80,
                speed_score: 0.85,
                supports_translation: false,
                is_recommended: true,
                supported_languages: parakeet_v3_languages,
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-base".to_string(),
            ModelInfo {
                id: "moonshine-base".to_string(),
                name: "Moonshine Base".to_string(),
                description: "Very fast, English only. Handles accents well.".to_string(),
                filename: "moonshine-base".to_string(),
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/moonshine/moonshine-base.tar.gz",
                )),
                sha256: Some(
                    "40dfa1a3a345612d4e52fefddaad06ebd4683e5224e8d6a9708121e2c36928cf".to_string(),
                ),
                size_mb: 58,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::Moonshine,
                accuracy_score: 0.70,
                speed_score: 0.90,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-tiny-streaming-en".to_string(),
            ModelInfo {
                id: "moonshine-tiny-streaming-en".to_string(),
                name: "Moonshine V2 Tiny".to_string(),
                description: "Ultra-fast, English only".to_string(),
                filename: "moonshine-tiny-streaming-en".to_string(),
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/moonshine/moonshine-tiny-streaming-en.tar.gz",
                )),
                sha256: Some(
                    "1ccd0e672a664acd268b100342c997bc680de71354474a489fe6ebf28a770760".to_string(),
                ),
                size_mb: 31,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::MoonshineStreaming,
                accuracy_score: 0.55,
                speed_score: 0.95,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-small-streaming-en".to_string(),
            ModelInfo {
                id: "moonshine-small-streaming-en".to_string(),
                name: "Moonshine V2 Small".to_string(),
                description: "Fast, English only. Good balance of speed and accuracy.".to_string(),
                filename: "moonshine-small-streaming-en".to_string(),
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/moonshine/moonshine-small-streaming-en.tar.gz",
                )),
                sha256: Some(
                    "f6548b1215e7f9837cf2df2c041c1b43d9e0bbcf826b9670d04d011b452a3048".to_string(),
                ),
                size_mb: 100,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::MoonshineStreaming,
                accuracy_score: 0.65,
                speed_score: 0.90,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-medium-streaming-en".to_string(),
            ModelInfo {
                id: "moonshine-medium-streaming-en".to_string(),
                name: "Moonshine V2 Medium".to_string(),
                description: "English only. High quality.".to_string(),
                filename: "moonshine-medium-streaming-en".to_string(),
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/moonshine/moonshine-medium-streaming-en.tar.gz",
                )),
                sha256: Some(
                    "301cb6a0eda5d0b608cd70d09435e78af960059f8e1c6a779f8428d27ede82a9".to_string(),
                ),
                size_mb: 192,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::MoonshineStreaming,
                accuracy_score: 0.75,
                speed_score: 0.80,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        // SenseVoice supported languages
        let sense_voice_languages: Vec<String> =
            vec!["zh", "zh-Hans", "zh-Hant", "en", "yue", "ja", "ko"]
                .into_iter()
                .map(String::from)
                .collect();

        available_models.insert(
            "sense-voice-int8".to_string(),
            ModelInfo {
                id: "sense-voice-int8".to_string(),
                name: "SenseVoice".to_string(),
                description: "Very fast. Chinese, English, Japanese, Korean, Cantonese."
                    .to_string(),
                filename: "sense-voice-int8".to_string(),
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/sensevoice/sense-voice-int8.tar.gz",
                )),
                sha256: Some(
                    "0d70ff6378fc516f7d4aae04b4daca8a4f7644dd00e17833b3c009e97c32ed3b".to_string(),
                ),
                size_mb: 160,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SenseVoice,
                accuracy_score: 0.65,
                speed_score: 0.95,
                supports_translation: false,
                is_recommended: false,
                supported_languages: sense_voice_languages,
                is_custom: false,
            },
        );

        // GigaAM v3 supported languages
        let gigaam_languages: Vec<String> = vec!["ru"].into_iter().map(String::from).collect();

        available_models.insert(
            "gigaam-v3-e2e-ctc".to_string(),
            ModelInfo {
                id: "gigaam-v3-e2e-ctc".to_string(),
                name: "GigaAM v3".to_string(),
                description: "Russian speech recognition. Fast and accurate.".to_string(),
                filename: "gigaam-v3-e2e-ctc".to_string(),
                url: Some(Self::vox_jot_models_resolve_url(
                    "stt/gigaam/giga-am-v3.tar.gz",
                )),
                sha256: Some(
                    "61095c8fd66a0f107baaa851ab037b637254a5baa552b0fd1bc224b1c6a6dbe4".to_string(),
                ),
                size_mb: 225,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::GigaAM,
                accuracy_score: 0.85,
                speed_score: 0.75,
                supports_translation: false,
                is_recommended: false,
                supported_languages: gigaam_languages,
                is_custom: false,
            },
        );

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            available_models.insert(
                "mlx-whisper-large-v3-turbo".to_string(),
                ModelInfo {
                    id: "mlx-whisper-large-v3-turbo".to_string(),
                    name: "Whisper Large V3 Turbo (MLX)".to_string(),
                    description:
                        "MLX-accelerated Whisper served through the shared mlx-audio sidecar."
                            .to_string(),
                    filename: "MLX/mlx-community/whisper-large-v3-turbo-asr-fp16".to_string(),
                    url: Some(Self::hf_snapshot_url(
                        "mlx-community/whisper-large-v3-turbo-asr-fp16",
                    )),
                    sha256: None,
                    size_mb: 3200,
                    is_downloaded: false,
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: true,
                    engine_type: EngineType::MlxAudioStt,
                    accuracy_score: 0.90,
                    speed_score: 0.80,
                    supports_translation: false,
                    is_recommended: true,
                    supported_languages: whisper_languages.clone(),
                    is_custom: false,
                },
            );

            available_models.insert(
                "mlx-distil-whisper-large-v3".to_string(),
                ModelInfo {
                    id: "mlx-distil-whisper-large-v3".to_string(),
                    name: "Distil-Whisper Large V3 (MLX)".to_string(),
                    description: "Fast MLX Distil-Whisper transcription via mlx-audio.".to_string(),
                    filename: "MLX/distil-whisper/distil-large-v3".to_string(),
                    url: Some(Self::hf_snapshot_url("distil-whisper/distil-large-v3")),
                    sha256: None,
                    size_mb: 3000,
                    is_downloaded: false,
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: true,
                    engine_type: EngineType::MlxAudioStt,
                    accuracy_score: 0.84,
                    speed_score: 0.92,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec!["en".to_string()],
                    is_custom: false,
                },
            );

            available_models.insert(
                "mlx-qwen3-asr".to_string(),
                ModelInfo {
                    id: "mlx-qwen3-asr".to_string(),
                    name: "Qwen3 ASR (MLX)".to_string(),
                    description:
                        "Qwen3 ASR running inside mlx-audio for multilingual Apple Silicon STT."
                            .to_string(),
                    filename: "MLX/mlx-community/Qwen3-ASR-1.7B-8bit".to_string(),
                    url: Some(Self::hf_snapshot_url("mlx-community/Qwen3-ASR-1.7B-8bit")),
                    sha256: None,
                    size_mb: 2000,
                    is_downloaded: false,
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: true,
                    engine_type: EngineType::MlxAudioStt,
                    accuracy_score: 0.90,
                    speed_score: 0.78,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec![
                        "zh".to_string(),
                        "en".to_string(),
                        "ja".to_string(),
                        "ko".to_string(),
                        "mul".to_string(),
                    ],
                    is_custom: false,
                },
            );

            available_models.insert(
                "mlx-parakeet-v3".to_string(),
                ModelInfo {
                    id: "mlx-parakeet-v3".to_string(),
                    name: "Parakeet V3 (MLX)".to_string(),
                    description: "MLX Parakeet served over the shared mlx-audio transcription API."
                        .to_string(),
                    filename: "MLX/mlx-community/parakeet-tdt-0.6b-v3".to_string(),
                    url: Some(Self::hf_snapshot_url("mlx-community/parakeet-tdt-0.6b-v3")),
                    sha256: None,
                    size_mb: 1300,
                    is_downloaded: false,
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: true,
                    engine_type: EngineType::MlxAudioStt,
                    accuracy_score: 0.88,
                    speed_score: 0.82,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec![
                        "bg".to_string(),
                        "hr".to_string(),
                        "cs".to_string(),
                        "da".to_string(),
                        "nl".to_string(),
                        "en".to_string(),
                        "et".to_string(),
                        "fi".to_string(),
                        "fr".to_string(),
                        "de".to_string(),
                        "el".to_string(),
                        "hu".to_string(),
                        "it".to_string(),
                        "lv".to_string(),
                        "lt".to_string(),
                        "mt".to_string(),
                        "pl".to_string(),
                        "pt".to_string(),
                        "ro".to_string(),
                        "sk".to_string(),
                        "sl".to_string(),
                        "es".to_string(),
                        "sv".to_string(),
                        "ru".to_string(),
                        "uk".to_string(),
                    ],
                    is_custom: false,
                },
            );

            available_models.insert(
                "mlx-voxtral-mini-3b".to_string(),
                ModelInfo {
                    id: "mlx-voxtral-mini-3b".to_string(),
                    name: "Voxtral Mini 3B (MLX)".to_string(),
                    description:
                        "Local Voxtral Mini 3B transcription from the shared mlx-audio runtime."
                            .to_string(),
                    filename: "MLX/mlx-community/Voxtral-Mini-3B-2507-bf16".to_string(),
                    url: Some(Self::hf_snapshot_url(
                        "mlx-community/Voxtral-Mini-3B-2507-bf16",
                    )),
                    sha256: None,
                    size_mb: 6000,
                    is_downloaded: false,
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: true,
                    engine_type: EngineType::MlxAudioStt,
                    accuracy_score: 0.90,
                    speed_score: 0.70,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec![
                        "en".to_string(),
                        "fr".to_string(),
                        "de".to_string(),
                        "es".to_string(),
                        "it".to_string(),
                        "pt".to_string(),
                        "nl".to_string(),
                        "hi".to_string(),
                    ],
                    is_custom: false,
                },
            );

            available_models.insert(
                "mlx-voxtral-mini-4b-realtime".to_string(),
                ModelInfo {
                    id: "mlx-voxtral-mini-4b-realtime".to_string(),
                    name: "Voxtral Mini 4B Realtime (MLX)".to_string(),
                    description:
                        "Streaming Voxtral realtime transcription through the shared mlx-audio runtime."
                            .to_string(),
                    filename: "MLX/mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit"
                        .to_string(),
                    url: Some(Self::hf_snapshot_url(
                        "mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
                    )),
                    sha256: None,
                    size_mb: 3000,
                    is_downloaded: false,
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: true,
                    engine_type: EngineType::MlxAudioStt,
                    accuracy_score: 0.92,
                    speed_score: 0.88,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec![
                        "ar".to_string(),
                        "de".to_string(),
                        "en".to_string(),
                        "es".to_string(),
                        "fr".to_string(),
                        "hi".to_string(),
                        "it".to_string(),
                        "nl".to_string(),
                        "pt".to_string(),
                        "zh".to_string(),
                        "ja".to_string(),
                        "ko".to_string(),
                        "ru".to_string(),
                    ],
                    is_custom: false,
                },
            );

            let mut insert_mlx_audio_stt =
                |id: &str,
                 name: &str,
                 description: &str,
                 repo_id: &str,
                 size_mb: u64,
                 accuracy_score: f32,
                 speed_score: f32,
                 supported_languages: &[&str]| {
                    available_models.insert(
                        id.to_string(),
                        ModelInfo {
                            id: id.to_string(),
                            name: name.to_string(),
                            description: description.to_string(),
                            filename: format!("MLX/{repo_id}"),
                            url: Some(Self::hf_snapshot_url(repo_id)),
                            sha256: None,
                            size_mb,
                            is_downloaded: false,
                            is_downloading: false,
                            partial_size: 0,
                            is_directory: true,
                            engine_type: EngineType::MlxAudioStt,
                            accuracy_score,
                            speed_score,
                            supports_translation: false,
                            is_recommended: false,
                            supported_languages: supported_languages
                                .iter()
                                .map(|language| (*language).to_string())
                                .collect(),
                            is_custom: false,
                        },
                    );
                };

            insert_mlx_audio_stt(
                "mlx-qwen3-asr-0.6b",
                "Qwen3 ASR 0.6B (MLX)",
                "Smaller Qwen3 ASR checkpoint for multilingual Apple Silicon transcription.",
                "mlx-community/Qwen3-ASR-0.6B-8bit",
                900,
                0.86,
                0.88,
                &["zh", "en", "ja", "ko", "mul"],
            );
            insert_mlx_audio_stt(
                "mlx-fireredasr2-aed",
                "FireRedASR2 AED (MLX)",
                "Chinese and English conformer-decoder ASR through the shared mlx-audio runtime.",
                "mlx-community/FireRedASR2-AED-mlx",
                2600,
                0.87,
                0.62,
                &["zh", "en"],
            );
            insert_mlx_audio_stt(
                "mlx-vibevoice-asr-bf16",
                "VibeVoice ASR 9B (MLX)",
                "Large ASR model with timestamp and diarization-oriented outputs; best for longer files, not low-latency dictation.",
                "mlx-community/VibeVoice-ASR-bf16",
                18000,
                0.90,
                0.35,
                &["en", "zh"],
            );
        }

        // Auto-discover custom Whisper models (.bin files) in the models directory
        if let Err(e) = Self::discover_custom_whisper_models(&models_dir, &mut available_models) {
            warn!("Failed to discover custom models: {}", e);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            models_dir,
            available_models: Mutex::new(available_models),
            cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            extracting_models: Arc::new(Mutex::new(HashSet::new())),
        };

        // Migrate any bundled models to user directory
        manager.migrate_bundled_models()?;

        // Check which models are already downloaded
        manager.update_download_status()?;

        // Auto-select a model if none is currently selected
        manager.auto_select_model_if_needed()?;

        Ok(manager)
    }

    pub fn get_available_models(&self) -> Vec<ModelInfo> {
        if let Err(err) = self.update_download_status() {
            warn!("Failed to refresh model download status: {}", err);
        }

        let models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        models.values().cloned().collect()
    }

    pub fn get_model_info(&self, model_id: &str) -> Option<ModelInfo> {
        let models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        models.get(model_id).cloned()
    }

    fn migrate_bundled_models(&self) -> Result<()> {
        // Check for bundled models and copy them to user directory
        let bundled_models = ["ggml-small.bin"]; // Add other bundled models here if any

        for filename in &bundled_models {
            let bundled_path = crate::portable::resolve_resource(
                &self.app_handle,
                &format!("resources/models/{}", filename),
            );

            if let Ok(bundled_path) = bundled_path {
                if bundled_path.exists() {
                    let user_path = self.models_dir.join(filename);

                    // Only copy if user doesn't already have the model
                    if !user_path.exists() {
                        info!("Migrating bundled model {} to user directory", filename);
                        fs::copy(&bundled_path, &user_path)?;
                        info!("Successfully migrated {}", filename);
                    }
                }
            }
        }

        Ok(())
    }

    fn update_download_status(&self) -> Result<()> {
        let active_downloads: HashSet<String> = {
            let flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            flags
                .iter()
                .filter(|(_, flag)| !flag.load(Ordering::Relaxed))
                .map(|(model_id, _)| model_id.clone())
                .collect()
        };

        let mut models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        for model in models.values_mut() {
            if engine_uses_remote_runtime(&model.engine_type) {
                model.is_downloaded = if model.url.is_none() && model.size_mb == 0 {
                    true
                } else {
                    let model_path = self.models_dir.join(&model.filename);
                    let primary_path_exists = if model.is_directory {
                        model_path.is_dir()
                    } else {
                        model_path.is_file()
                    };
                    primary_path_exists
                        || crate::shared_model_assets::installed_shared_model_dir(
                            &self.app_handle,
                            &model.id,
                        )
                        .ok()
                        .flatten()
                        .is_some()
                };
                model.is_downloading = active_downloads.contains(&model.id);
                model.partial_size = 0;
                continue;
            }

            if model.is_directory {
                // For directory-based models, check if the directory exists
                let model_path = self.models_dir.join(&model.filename);
                let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));
                let extracting_path = self
                    .models_dir
                    .join(format!("{}.extracting", &model.filename));

                // Clean up any leftover .extracting directories from interrupted extractions
                // But only if this model is NOT currently being extracted
                let is_currently_extracting = {
                    let extracting = self
                        .extracting_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    extracting.contains(&model.id)
                };
                if extracting_path.exists() && !is_currently_extracting {
                    warn!("Cleaning up interrupted extraction for model: {}", model.id);
                    let _ = fs::remove_dir_all(&extracting_path);
                }

                model.is_downloaded = model_path.exists() && model_path.is_dir();
                model.is_downloading = active_downloads.contains(&model.id);

                // Get partial file size if it exists (for the .tar.gz being downloaded)
                if partial_path.exists() {
                    model.partial_size = partial_path.metadata().map(|m| m.len()).unwrap_or(0);
                } else {
                    model.partial_size = 0;
                }
            } else {
                // For file-based models (existing logic)
                let model_path = self.models_dir.join(&model.filename);
                let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));

                model.is_downloaded = model_path.exists();
                model.is_downloading = active_downloads.contains(&model.id);

                // Get partial file size if it exists
                if partial_path.exists() {
                    model.partial_size = partial_path.metadata().map(|m| m.len()).unwrap_or(0);
                } else {
                    model.partial_size = 0;
                }
            }
        }

        Ok(())
    }

    fn auto_select_model_if_needed(&self) -> Result<()> {
        let mut settings = get_settings(&self.app_handle);

        // Clear stale selection: selected model is set but doesn't exist
        // in available_models (e.g. deleted custom model file)
        if !settings.selected_model.is_empty() {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let exists = models.contains_key(&settings.selected_model);
            drop(models);

            if !exists {
                info!(
                    "Selected model '{}' not found in available models, clearing selection",
                    settings.selected_model
                );
                settings.selected_model = String::new();
                settings.selected_stt_model_id = String::new();
                settings.selected_stt_provider_id = String::new();
                write_settings(&self.app_handle, settings.clone());
            }
        }

        // If no model is selected, pick the first available one
        if settings.selected_model.is_empty() {
            // Find the first available model
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(available_model) = models.values().find(|model| model_is_available(model)) {
                info!(
                    "Auto-selecting model: {} ({})",
                    available_model.id, available_model.name
                );

                // Update settings with the selected model
                let mut updated_settings = settings;
                updated_settings.selected_model = available_model.id.clone();
                updated_settings.selected_stt_model_id = available_model.id.clone();
                updated_settings.selected_stt_provider_id =
                    Self::stt_provider_id_for_engine(&available_model.engine_type).to_string();
                write_settings(&self.app_handle, updated_settings);

                info!("Successfully auto-selected model: {}", available_model.id);
            }
        }

        Ok(())
    }

    /// Discover custom Whisper models (.bin files) in the models directory.
    /// Skips files that match predefined model filenames.
    fn discover_custom_whisper_models(
        models_dir: &Path,
        available_models: &mut HashMap<String, ModelInfo>,
    ) -> Result<()> {
        if !models_dir.exists() {
            return Ok(());
        }

        // Collect filenames of predefined Whisper file-based models to skip
        let predefined_filenames: HashSet<String> = available_models
            .values()
            .filter(|m| matches!(m.engine_type, EngineType::Whisper) && !m.is_directory)
            .map(|m| m.filename.clone())
            .collect();

        // Scan models directory for .bin files
        for entry in fs::read_dir(models_dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    warn!("Failed to read directory entry: {}", e);
                    continue;
                }
            };

            let path = entry.path();

            // Only process .bin files (not directories)
            if !path.is_file() {
                continue;
            }

            let filename = match path.file_name().and_then(|s| s.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };

            // Skip hidden files
            if filename.starts_with('.') {
                continue;
            }

            // Only process .bin files (Whisper GGML format).
            // This also excludes .partial downloads (e.g., "model.bin.partial").
            // If we add discovery for other formats, add a .partial check before this filter.
            if !filename.ends_with(".bin") {
                continue;
            }

            // Skip predefined model files
            if predefined_filenames.contains(&filename) {
                continue;
            }

            // Generate model ID from filename (remove .bin extension)
            let model_id = filename.trim_end_matches(".bin").to_string();

            // Skip if model ID already exists (shouldn't happen, but be safe)
            if available_models.contains_key(&model_id) {
                continue;
            }

            // Generate display name: replace - and _ with space, capitalize words
            let display_name = model_id
                .replace(['-', '_'], " ")
                .split_whitespace()
                .map(|word| {
                    let mut chars = word.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");

            // Get file size — skip models with unknown or zero size
            let file_len = match path.metadata() {
                Ok(meta) => meta.len(),
                Err(e) => {
                    warn!(
                        "Skipping custom model {} — failed to get metadata: {}",
                        filename, e
                    );
                    continue;
                }
            };

            if file_len == 0 {
                warn!("Skipping custom model {} — file size is 0 bytes", filename);
                continue;
            }

            let size_mb = file_len / (1024 * 1024);

            info!(
                "Discovered custom Whisper model: {} ({}, {} MB)",
                model_id, filename, size_mb
            );

            available_models.insert(
                model_id.clone(),
                ModelInfo {
                    id: model_id,
                    name: display_name,
                    description: "Not officially supported".to_string(),
                    filename,
                    url: None, // Custom models have no download URL
                    sha256: None,
                    size_mb,
                    is_downloaded: true, // Already present on disk
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: false,
                    engine_type: EngineType::Whisper,
                    accuracy_score: 0.0, // Sentinel: UI hides score bars when both are 0
                    speed_score: 0.0,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec![],
                    is_custom: true,
                },
            );
        }

        Ok(())
    }

    async fn download_hf_snapshot_model(
        &self,
        model_id: &str,
        model_info: &ModelInfo,
        repo_id: &str,
    ) -> Result<()> {
        struct SnapshotDownloadGuard<'a> {
            manager: &'a ModelManager,
            model_id: String,
            staging_path: PathBuf,
            active: bool,
        }

        impl SnapshotDownloadGuard<'_> {
            fn disarm(&mut self) {
                self.active = false;
            }
        }

        impl Drop for SnapshotDownloadGuard<'_> {
            fn drop(&mut self) {
                if !self.active {
                    return;
                }

                self.manager.set_model_downloading(&self.model_id, false);
                self.manager.clear_download_cancel_flag(&self.model_id);
                let _ = fs::remove_dir_all(&self.staging_path);
            }
        }

        let model_path = self.models_dir.join(&model_info.filename);
        if model_path.exists() {
            self.update_download_status()?;
            return Ok(());
        }

        let parent = model_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid model path: {}", model_path.display()))?;
        fs::create_dir_all(parent)?;
        let staging_path = parent.join(format!(".staging-{}", model_info.id));
        if staging_path.exists() {
            fs::remove_dir_all(&staging_path)?;
        }
        fs::create_dir_all(&staging_path)?;

        {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = true;
            }
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            flags.insert(model_id.to_string(), Arc::clone(&cancel_flag));
        }
        let mut download_guard = SnapshotDownloadGuard {
            manager: self,
            model_id: model_id.to_string(),
            staging_path: staging_path.clone(),
            active: true,
        };

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(900))
            .build()?;
        let api_url = format!("https://huggingface.co/api/models/{repo_id}");
        let repo_info: HfModelInfo = client
            .get(&api_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let files = repo_info
            .siblings
            .into_iter()
            .map(|sibling| sibling.rfilename)
            .filter(|name| Self::hf_snapshot_file_is_needed(name))
            .collect::<Vec<_>>();

        if files.is_empty() {
            let _ = fs::remove_dir_all(&staging_path);
            self.set_model_downloading(model_id, false);
            return Err(anyhow::anyhow!("No downloadable files found in {repo_id}"));
        }

        let total = files.len() as u64;
        for (idx, rel_path) in files.iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                info!("Hugging Face snapshot download cancelled for: {}", model_id);
                return Ok(());
            }

            let encoded_path = rel_path
                .split('/')
                .map(|segment| segment.replace(' ', "%20"))
                .collect::<Vec<_>>()
                .join("/");
            let url = format!("https://huggingface.co/{repo_id}/resolve/main/{encoded_path}");
            let target = staging_path.join(rel_path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }

            let response = client.get(&url).send().await?.error_for_status()?;
            let mut output = File::create(&target)?;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if cancel_flag.load(Ordering::Relaxed) {
                    drop(output);
                    let _ = fs::remove_file(&target);
                    info!("Hugging Face snapshot download cancelled for: {}", model_id);
                    return Ok(());
                }
                output.write_all(&chunk?)?;
            }
            output.flush()?;

            let downloaded = (idx + 1) as u64;
            let progress = DownloadProgress {
                model_id: model_id.to_string(),
                downloaded,
                total,
                percentage: (downloaded as f64 / total as f64) * 100.0,
            };
            let _ = self.app_handle.emit("model-download-progress", &progress);
        }

        if model_path.exists() {
            fs::remove_dir_all(&model_path)?;
        }
        fs::rename(&staging_path, &model_path)?;

        {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
                model.is_downloaded = true;
                model.partial_size = 0;
            }
        }

        let _ = self.app_handle.emit("model-download-complete", model_id);
        info!(
            "Successfully downloaded Hugging Face snapshot {} to {:?}",
            repo_id, model_path
        );
        self.clear_download_cancel_flag(model_id);
        download_guard.disarm();
        Ok(())
    }

    pub async fn download_model(&self, model_id: &str) -> Result<()> {
        struct DownloadStateGuard<'a> {
            manager: &'a ModelManager,
            model_id: String,
            clear_extracting: bool,
            active: bool,
        }

        impl DownloadStateGuard<'_> {
            fn mark_extracting(&mut self) {
                self.clear_extracting = true;
            }

            fn disarm(&mut self) {
                self.active = false;
            }
        }

        impl Drop for DownloadStateGuard<'_> {
            fn drop(&mut self) {
                if !self.active {
                    return;
                }

                self.manager.set_model_downloading(&self.model_id, false);
                self.manager.clear_download_cancel_flag(&self.model_id);
                if self.clear_extracting {
                    self.manager.remove_extracting_model(&self.model_id);
                }
            }
        }

        let model_info = {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            models.get(model_id).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        let url = model_info
            .url
            .clone()
            .ok_or_else(|| anyhow::anyhow!("No download URL for model"))?;

        if let Some(repo_id) = Self::parse_hf_snapshot_url(&url) {
            return self
                .download_hf_snapshot_model(model_id, &model_info, repo_id)
                .await;
        }

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        // Don't download if complete version already exists
        if model_path.exists() {
            // Clean up any partial file that might exist
            if partial_path.exists() {
                let _ = fs::remove_file(&partial_path);
            }
            self.update_download_status()?;
            return Ok(());
        }

        // Check if we have a partial download to resume
        let mut resume_from = if partial_path.exists() {
            let size = partial_path.metadata()?.len();
            info!("Resuming download of model {} from byte {}", model_id, size);
            size
        } else {
            info!("Starting fresh download of model {} from {}", model_id, url);
            0
        };

        // Mark as downloading
        {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = true;
            }
        }

        // Create cancellation flag for this download
        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            flags.insert(model_id.to_string(), cancel_flag.clone());
        }
        let mut download_guard = DownloadStateGuard {
            manager: self,
            model_id: model_id.to_string(),
            clear_extracting: false,
            active: true,
        };

        // Create HTTP client with range request for resuming
        let client = reqwest::Client::new();
        let mut response =
            github_release::get_with_optional_github_auth(&client, &url, Some(resume_from))
                .await
                .map_err(anyhow::Error::msg)?;

        // If we tried to resume but server returned 200 (not 206 Partial Content),
        // the server doesn't support range requests. Delete partial file and restart
        // fresh to avoid file corruption (appending full file to partial).
        if resume_from > 0 && response.status() == reqwest::StatusCode::OK {
            warn!(
                "Server doesn't support range requests for model {}, restarting download",
                model_id
            );
            drop(response);
            let _ = fs::remove_file(&partial_path);

            // Reset resume_from since we're starting fresh
            resume_from = 0;

            // Restart download without range header
            response = github_release::get_with_optional_github_auth(&client, &url, None)
                .await
                .map_err(anyhow::Error::msg)?;
        }

        // Check for success or partial content status
        if !response.status().is_success()
            && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
        {
            // Mark as not downloading on error
            {
                let mut models = self
                    .available_models
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(model) = models.get_mut(model_id) {
                    model.is_downloading = false;
                }
            }
            return Err(anyhow::anyhow!(
                "Failed to download model: HTTP {}",
                response.status()
            ));
        }

        let response_total_size = if resume_from > 0 {
            // For resumed downloads, add the resume point to content length
            resume_from + response.content_length().unwrap_or(0)
        } else {
            response.content_length().unwrap_or(0)
        };
        let has_exact_total_size = response_total_size > 0;
        let progress_total_size = if has_exact_total_size {
            response_total_size
        } else {
            Self::catalog_progress_total_bytes(&model_info)
        };

        let mut downloaded = resume_from;
        let mut stream = response.bytes_stream();

        // Open file for appending if resuming, or create new if starting fresh
        let mut file = if resume_from > 0 {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&partial_path)?
        } else {
            std::fs::File::create(&partial_path)?
        };

        // Emit initial progress
        let initial_progress = DownloadProgress {
            model_id: model_id.to_string(),
            downloaded,
            total: progress_total_size,
            percentage: Self::download_progress_percentage(
                downloaded,
                progress_total_size,
                has_exact_total_size,
                false,
            ),
        };
        let _ = self
            .app_handle
            .emit("model-download-progress", &initial_progress);

        // Throttle progress events to max 10/sec (100ms intervals)
        let mut last_emit = Instant::now();
        let throttle_duration = Duration::from_millis(100);

        // Download with progress
        while let Some(chunk) = stream.next().await {
            // Check if download was cancelled
            if cancel_flag.load(Ordering::Relaxed) {
                // Close the file before returning
                drop(file);
                info!("Download cancelled for: {}", model_id);

                // Update state to mark as not downloading
                {
                    let mut models = self
                        .available_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    if let Some(model) = models.get_mut(model_id) {
                        model.is_downloading = false;
                    }
                }

                // Remove cancel flag
                {
                    let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
                    flags.remove(model_id);
                }

                // Keep partial file for resume functionality
                return Ok(());
            }

            let chunk = chunk.inspect_err(|_| {
                // Mark as not downloading on error
                {
                    let mut models = self
                        .available_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    if let Some(model) = models.get_mut(model_id) {
                        model.is_downloading = false;
                    }
                }
            })?;

            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;

            let percentage = Self::download_progress_percentage(
                downloaded,
                progress_total_size,
                has_exact_total_size,
                false,
            );

            // Emit progress event (throttled to avoid UI freeze)
            if last_emit.elapsed() >= throttle_duration {
                let progress = DownloadProgress {
                    model_id: model_id.to_string(),
                    downloaded,
                    total: progress_total_size,
                    percentage,
                };
                let _ = self.app_handle.emit("model-download-progress", &progress);
                last_emit = Instant::now();
            }
        }

        // Emit final progress to ensure 100% is shown
        let final_progress = DownloadProgress {
            model_id: model_id.to_string(),
            downloaded,
            total: progress_total_size,
            percentage: Self::download_progress_percentage(
                downloaded,
                progress_total_size,
                has_exact_total_size,
                true,
            ),
        };
        let _ = self
            .app_handle
            .emit("model-download-progress", &final_progress);

        file.flush()?;
        drop(file); // Ensure file is closed before moving

        // Verify downloaded file size matches expected size
        if response_total_size > 0 {
            let actual_size = partial_path.metadata()?.len();
            if actual_size != response_total_size {
                // Download is incomplete/corrupted - delete partial and return error
                let _ = fs::remove_file(&partial_path);
                {
                    let mut models = self
                        .available_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    if let Some(model) = models.get_mut(model_id) {
                        model.is_downloading = false;
                    }
                }
                return Err(anyhow::anyhow!(
                    "Download incomplete: expected {} bytes, got {} bytes",
                    response_total_size,
                    actual_size
                ));
            }
        }

        if let Err(error) =
            Self::verify_optional_sha256(&partial_path, model_info.sha256.as_deref())
        {
            let _ = fs::remove_file(&partial_path);
            {
                let mut models = self
                    .available_models
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(model) = models.get_mut(model_id) {
                    model.is_downloading = false;
                }
            }
            return Err(error);
        }

        let is_archive_download = Self::is_tar_gz_url(&url);

        // Handle extracted archives before falling back to plain file moves.
        if model_info.is_directory || is_archive_download {
            // Track that this model is being extracted
            {
                let mut extracting = self
                    .extracting_models
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                extracting.insert(model_id.to_string());
            }
            download_guard.mark_extracting();

            // Emit extraction started event
            let _ = self.app_handle.emit("model-extraction-started", model_id);
            info!("Extracting archive for model: {}", model_id);

            // Use a temporary extraction directory to ensure atomic operations
            let temp_extract_dir = self
                .models_dir
                .join(format!("{}.extracting", &model_info.filename));
            let final_model_path = self.models_dir.join(&model_info.filename);

            // Clean up any previous incomplete extraction
            if temp_extract_dir.exists() {
                let _ = fs::remove_dir_all(&temp_extract_dir);
            }

            // Create temporary extraction directory
            fs::create_dir_all(&temp_extract_dir)?;

            // Open the downloaded tar.gz file
            let tar_gz = File::open(&partial_path)?;
            let tar = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(tar);

            // Extract to the temporary directory first
            archive.unpack(&temp_extract_dir).map_err(|e| {
                let error_msg = format!("Failed to extract archive: {}", e);
                // Clean up failed extraction
                let _ = fs::remove_dir_all(&temp_extract_dir);
                // Remove from extracting set
                {
                    let mut extracting = self
                        .extracting_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    extracting.remove(model_id);
                }
                let _ = self.app_handle.emit(
                    "model-extraction-failed",
                    &serde_json::json!({
                        "model_id": model_id,
                        "error": error_msg
                    }),
                );
                anyhow::anyhow!(error_msg)
            })?;

            let extraction_result: Result<()> = if model_info.is_directory {
                // Find the actual extracted directory (archive might have a nested structure)
                let extracted_dirs: Vec<_> = fs::read_dir(&temp_extract_dir)?
                    .filter_map(|entry| entry.ok())
                    .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                    .collect();

                if extracted_dirs.len() == 1 {
                    // Single directory extracted, move it to the final location
                    let source_dir = extracted_dirs[0].path();
                    if final_model_path.exists() {
                        fs::remove_dir_all(&final_model_path)?;
                    }
                    fs::rename(&source_dir, &final_model_path)?;
                    // Clean up temp directory
                    let _ = fs::remove_dir_all(&temp_extract_dir);
                } else {
                    // Multiple items or no directories, rename the temp directory itself
                    if final_model_path.exists() {
                        fs::remove_dir_all(&final_model_path)?;
                    }
                    fs::rename(&temp_extract_dir, &final_model_path)?;
                }

                Ok(())
            } else {
                let mut extracted_files = Vec::new();
                Self::collect_files_recursive(&temp_extract_dir, &mut extracted_files)?;

                let source_file = extracted_files
                    .iter()
                    .find(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .map(|name| name == model_info.filename)
                            .unwrap_or(false)
                    })
                    .cloned()
                    .or_else(|| {
                        if extracted_files.len() == 1 {
                            extracted_files.into_iter().next()
                        } else {
                            None
                        }
                    })
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "Archive for {} did not contain expected file {}",
                            model_id,
                            model_info.filename
                        )
                    })?;

                if final_model_path.exists() {
                    fs::remove_file(&final_model_path)?;
                }
                fs::rename(&source_file, &final_model_path)?;
                let _ = fs::remove_dir_all(&temp_extract_dir);

                Ok(())
            };

            if let Err(e) = extraction_result {
                let error_msg = format!("Failed to finalize extracted model: {}", e);
                let _ = fs::remove_dir_all(&temp_extract_dir);
                {
                    let mut extracting = self
                        .extracting_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    extracting.remove(model_id);
                }
                let _ = self.app_handle.emit(
                    "model-extraction-failed",
                    &serde_json::json!({
                        "model_id": model_id,
                        "error": error_msg
                    }),
                );
                return Err(e);
            }

            if let Err(e) = Self::normalize_extracted_model_layout(model_id, &final_model_path) {
                let error_msg = format!("Failed to normalize extracted model layout: {}", e);
                let _ = self.app_handle.emit(
                    "model-extraction-failed",
                    &serde_json::json!({
                        "model_id": model_id,
                        "error": error_msg
                    }),
                );
                return Err(e);
            }

            info!("Successfully extracted archive for model: {}", model_id);
            // Remove from extracting set
            {
                let mut extracting = self
                    .extracting_models
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                extracting.remove(model_id);
            }
            // Emit extraction completed event
            let _ = self.app_handle.emit("model-extraction-completed", model_id);

            // Remove the downloaded tar.gz file
            let _ = fs::remove_file(&partial_path);
        } else {
            // Move partial file to final location for file-based models
            fs::rename(&partial_path, &model_path)?;
        }

        // Update download status
        {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
                model.is_downloaded = true;
                model.partial_size = 0;
            }
        }

        // Remove cancel flag on successful completion
        // Emit completion event
        let _ = self.app_handle.emit("model-download-complete", model_id);

        info!(
            "Successfully downloaded model {} to {:?}",
            model_id, model_path
        );

        self.set_model_downloading(model_id, false);
        self.clear_download_cancel_flag(model_id);
        if download_guard.clear_extracting {
            self.remove_extracting_model(model_id);
        }
        download_guard.disarm();

        Ok(())
    }

    pub fn delete_model(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: delete_model called for: {}", model_id);

        let model_info = {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            models.get(model_id).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        debug!("ModelManager: Found model info: {:?}", model_info);

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));
        debug!("ModelManager: Model path: {:?}", model_path);
        debug!("ModelManager: Partial path: {:?}", partial_path);

        let mut deleted_something = false;
        let is_shared_model = crate::shared_model_assets::is_shared_model_asset(model_id);

        if model_info.is_directory {
            if is_shared_model {
                deleted_something |= crate::shared_model_assets::delete_shared_model_assets(
                    &self.app_handle,
                    model_id,
                )
                .map_err(anyhow::Error::msg)?;
            } else {
                // Delete complete model directory if it exists
                if model_path.exists() && model_path.is_dir() {
                    info!("Deleting model directory at: {:?}", model_path);
                    fs::remove_dir_all(&model_path)?;
                    info!("Model directory deleted successfully");
                    deleted_something = true;
                }
            }
        } else {
            // Delete complete model file if it exists
            if model_path.exists() {
                info!("Deleting model file at: {:?}", model_path);
                fs::remove_file(&model_path)?;
                info!("Model file deleted successfully");
                deleted_something = true;
            }
        }

        // Delete partial file if it exists (same for both types)
        if !is_shared_model && partial_path.exists() {
            info!("Deleting partial file at: {:?}", partial_path);
            fs::remove_file(&partial_path)?;
            info!("Partial file deleted successfully");
            deleted_something = true;
        }

        if !deleted_something {
            return Err(anyhow::anyhow!("No model files found to delete"));
        }

        // Custom models should be removed from the list entirely since they
        // have no download URL and can't be re-downloaded
        if model_info.is_custom {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            models.remove(model_id);
            debug!("ModelManager: removed custom model from available models");
        } else {
            // Update download status (marks predefined models as not downloaded)
            self.update_download_status()?;
            debug!("ModelManager: download status updated");
        }

        // Emit event to notify UI
        let _ = self.app_handle.emit("model-deleted", model_id);

        Ok(())
    }

    pub fn get_model_path(&self, model_id: &str) -> Result<PathBuf> {
        let model_info = self
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            return Err(anyhow::anyhow!("Model not available: {}", model_id));
        }

        // Ensure we don't return partial files/directories
        if model_info.is_downloading {
            return Err(anyhow::anyhow!(
                "Model is currently downloading: {}",
                model_id
            ));
        }

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        if model_info.is_directory {
            // For directory-based models, ensure the directory exists and is complete
            if model_path.exists() && model_path.is_dir() && !partial_path.exists() {
                Ok(model_path)
            } else if let Some(shared_path) =
                crate::shared_model_assets::installed_shared_model_dir(&self.app_handle, model_id)
                    .map_err(|err| anyhow::anyhow!(err))?
            {
                Ok(shared_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model directory not found: {}",
                    model_id
                ))
            }
        } else {
            // For file-based models (existing logic)
            if model_path.exists() && !partial_path.exists() {
                Ok(model_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model file not found: {}",
                    model_id
                ))
            }
        }
    }

    pub fn cancel_download(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: cancel_download called for: {}", model_id);

        // Set the cancellation flag to stop the download loop
        {
            let flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(flag) = flags.get(model_id) {
                flag.store(true, Ordering::Relaxed);
                info!("Cancellation flag set for: {}", model_id);
            } else {
                warn!("No active download found for: {}", model_id);
            }
        }

        // Update state immediately for UI responsiveness
        {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
            }
        }

        // Update download status to reflect current state
        self.update_download_status()?;

        // Emit cancellation event so all UI components can clear their state
        let _ = self.app_handle.emit("model-download-cancelled", model_id);

        info!("Download cancellation initiated for: {}", model_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn test_model_info(size_mb: u64) -> ModelInfo {
        ModelInfo {
            id: "test-model".to_string(),
            name: "Test Model".to_string(),
            description: "Test".to_string(),
            filename: "test-model.bin".to_string(),
            url: Some("https://example.com/test-model.bin".to_string()),
            sha256: None,
            size_mb,
            is_downloaded: false,
            is_downloading: false,
            partial_size: 0,
            is_directory: false,
            engine_type: EngineType::Whisper,
            accuracy_score: 0.5,
            speed_score: 0.5,
            supports_translation: true,
            is_recommended: false,
            supported_languages: vec!["en".to_string()],
            is_custom: false,
        }
    }

    #[test]
    fn uses_catalog_size_for_progress_when_http_total_is_missing() {
        let model = test_model_info(225);

        assert_eq!(
            ModelManager::catalog_progress_total_bytes(&model),
            225 * 1024 * 1024
        );

        let percentage = ModelManager::download_progress_percentage(
            112 * 1024 * 1024,
            225 * 1024 * 1024,
            false,
            false,
        );

        assert!(percentage > 49.0);
        assert!(percentage < 50.0);
    }

    #[test]
    fn approximate_progress_is_capped_until_completion() {
        let total = 225 * 1024 * 1024;

        assert_eq!(
            ModelManager::download_progress_percentage(total + 1, total, false, false),
            99.0
        );
        assert_eq!(
            ModelManager::download_progress_percentage(total + 1, total, false, true),
            100.0
        );
    }

    #[test]
    fn test_discover_custom_whisper_models() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().to_path_buf();

        // Create test .bin files
        let mut custom_file = File::create(models_dir.join("my-custom-model.bin")).unwrap();
        custom_file.write_all(b"fake model data").unwrap();

        let mut another_file = File::create(models_dir.join("whisper_medical_v2.bin")).unwrap();
        another_file.write_all(b"another fake model").unwrap();

        // Create files that should be ignored
        File::create(models_dir.join(".hidden-model.bin")).unwrap(); // Hidden file
        File::create(models_dir.join("readme.txt")).unwrap(); // Non-.bin file
        File::create(models_dir.join("ggml-small.bin")).unwrap(); // Predefined filename
        fs::create_dir(models_dir.join("some-directory.bin")).unwrap(); // Directory

        // Set up available_models with a predefined Whisper model
        let mut models = HashMap::new();
        models.insert(
            "small".to_string(),
            ModelInfo {
                id: "small".to_string(),
                name: "Whisper Small".to_string(),
                description: "Test".to_string(),
                filename: "ggml-small.bin".to_string(),
                url: Some("https://example.com".to_string()),
                sha256: None,
                size_mb: 100,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.5,
                speed_score: 0.5,
                supports_translation: true,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
            },
        );

        // Discover custom models
        ModelManager::discover_custom_whisper_models(&models_dir, &mut models).unwrap();

        // Should have discovered 2 custom models (my-custom-model and whisper_medical_v2)
        assert!(models.contains_key("my-custom-model"));
        assert!(models.contains_key("whisper_medical_v2"));

        // Verify custom model properties
        let custom = models.get("my-custom-model").unwrap();
        assert_eq!(custom.name, "My Custom Model");
        assert_eq!(custom.filename, "my-custom-model.bin");
        assert!(custom.url.is_none()); // Custom models have no URL
        assert!(custom.is_downloaded);
        assert!(custom.is_custom);
        assert_eq!(custom.accuracy_score, 0.0);
        assert_eq!(custom.speed_score, 0.0);
        assert!(custom.supported_languages.is_empty());

        // Verify underscore handling
        let medical = models.get("whisper_medical_v2").unwrap();
        assert_eq!(medical.name, "Whisper Medical V2");

        // Should NOT have discovered hidden, non-.bin, predefined, or directories
        assert!(!models.contains_key(".hidden-model"));
        assert!(!models.contains_key("readme"));
        assert!(!models.contains_key("some-directory"));
    }

    #[test]
    fn test_discover_custom_models_empty_dir() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().to_path_buf();

        let mut models = HashMap::new();
        let count_before = models.len();

        ModelManager::discover_custom_whisper_models(&models_dir, &mut models).unwrap();

        // No new models should be added
        assert_eq!(models.len(), count_before);
    }

    #[test]
    fn test_discover_custom_models_nonexistent_dir() {
        let models_dir = PathBuf::from("/nonexistent/path/that/does/not/exist");

        let mut models = HashMap::new();
        let count_before = models.len();

        // Should not error, just return Ok
        let result = ModelManager::discover_custom_whisper_models(&models_dir, &mut models);
        assert!(result.is_ok());
        assert_eq!(models.len(), count_before);
    }
}
