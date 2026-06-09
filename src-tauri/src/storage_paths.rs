use log::{info, warn};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::portable;

const MODEL_ROOT_DIR: &str = "models";
const STT_MODELS_DIR: &str = "stt";
const TTS_MODELS_DIR: &str = "tts";
const TTS_STORE_DIR: &str = "store";
const TTS_PACKS_DIR: &str = "packs";
const TTS_RUNTIME_DIR: &str = "runtime";
const TTS_DOWNLOADS_DIR: &str = "downloads";
const LLM_MODELS_DIR: &str = "llm";
const QWEN3_CACHE_DIR: &str = "qwen3-cache";
const PERSONAPLEX_DIR: &str = "personaplex";
const PERSONAPLEX_HELPER_NAME: &str = "audio-server";
const LFM_AUDIO_GGUF_DIR: &str = "lfm-audio-gguf";
const VIBEVOICE_DIR: &str = "vibevoice";
const LFM2_TOOL_DIR: &str = "lfm2-tool";
const OCR_MODELS_DIR: &str = "ocr";
const OCR_RUNTIME_DIR: &str = "ocr-runtime";
const READER_DIR: &str = "reader";
const READER_RUNTIME_DIR: &str = "reader-runtime";
const DENOISE_RUNTIME_DIR: &str = "denoise-runtime";
const SPEECH_ANALYSIS_MODELS_DIR: &str = "speech-analysis";
const CREATIVE_AUDIO_MODELS_DIR: &str = "creative-audio";
const CREATIVE_AUDIO_RUNTIME_DIR: &str = "runtime";
const CREATIVE_AUDIO_DOWNLOADS_DIR: &str = "downloads";
const STABLE_AUDIO3_MLX_DIR: &str = "stable-audio-3-mlx";
const ACE_STEP_RUNTIME_DIR: &str = "ace-step-runtime";
const ACE_STEP_MODEL_DIR: &str = "ace-step-1.5";
const DIFFRHYTHM_RUNTIME_DIR: &str = "diffrhythm-runtime";
const DIFFRHYTHM_MODEL_DIR: &str = "diffrhythm-1.2-full";
const YUE_RUNTIME_DIR: &str = "yue-runtime";
const YUE_MODEL_DIR: &str = "yue-full-song";
const FIGARO_RUNTIME_DIR: &str = "figaro-runtime";
const FIGARO_MODEL_DIR: &str = "figaro-symbolic";

// LFM2.5-Audio GGUF assets (Q4_0 quant by default — smaller and ~5x faster than F16
// while remaining production-quality for dictation readback).
const LFM_AUDIO_QUANT: &str = "Q4_0";
const LFM_AUDIO_RUNNER_ZIP: &str = "llama-liquid-audio-macos-arm64.zip";

// LFM2-Tool default quant — Q4_K_M is the standard balance between quality and size.
const LFM2_TOOL_QUANT_FILE: &str = "LFM2-1.2B-Tool-Q4_K_M.gguf";

// VibeVoice files needed at runtime (figures/, README.md and .cache/ are skipped).
const VIBEVOICE_FILES: &[&str] = &[
    "config.json",
    "model.safetensors",
    "preprocessor_config.json",
];

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| format!("Failed to create '{}': {err}", path.display()))
}

fn copy_dir_if_missing(source: &Path, destination: &Path, label: &str) -> Result<(), String> {
    if !source.exists() || destination.exists() {
        return Ok(());
    }

    if source.is_file() {
        if let Some(parent) = destination.parent() {
            ensure_dir(parent)?;
        }
        fs::copy(source, destination).map_err(|err| {
            format!(
                "Failed to migrate {label} from '{}' to '{}': {err}",
                source.display(),
                destination.display()
            )
        })?;
        info!(
            "Migrated {label} from '{}' to '{}'",
            source.display(),
            destination.display()
        );
        return Ok(());
    }

    ensure_dir(destination)?;

    for entry in fs::read_dir(source)
        .map_err(|err| format!("Failed to read '{}': {err}", source.display()))?
    {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {err}"))?;
        let child_source = entry.path();
        let child_destination = destination.join(entry.file_name());
        copy_dir_if_missing(&child_source, &child_destination, label)?;
    }

    info!(
        "Migrated {label} from '{}' to '{}'",
        source.display(),
        destination.display()
    );
    Ok(())
}

pub fn model_root_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(portable::app_data_dir(app)?.join(MODEL_ROOT_DIR))
}

pub fn stt_models_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(STT_MODELS_DIR))
}

pub fn tts_models_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(TTS_MODELS_DIR))
}

pub fn tts_model_store_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(tts_models_dir(app)?.join(TTS_STORE_DIR))
}

pub fn tts_packs_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(tts_models_dir(app)?.join(TTS_PACKS_DIR))
}

pub fn tts_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(tts_models_dir(app)?.join(TTS_RUNTIME_DIR))
}

pub fn tts_downloads_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(tts_models_dir(app)?.join(TTS_DOWNLOADS_DIR))
}

pub fn llm_models_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(LLM_MODELS_DIR))
}

pub fn qwen3_cache_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(llm_models_dir(app)?.join(QWEN3_CACHE_DIR))
}

pub fn personaplex_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(llm_models_dir(app)?.join(PERSONAPLEX_DIR))
}

pub fn personaplex_helper_path(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(personaplex_dir(app)?.join(PERSONAPLEX_HELPER_NAME))
}

pub fn lfm_audio_gguf_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(tts_model_store_dir(app)?.join(LFM_AUDIO_GGUF_DIR))
}

/// Root for OCR-model assets managed by the app. Each registry entry installs
/// to `<this>/<catalog_id>/`; the app never reads from the user's staging
/// directory at runtime.
pub fn ocr_models_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(OCR_MODELS_DIR))
}

/// Root for OCR runtime dependency bundles managed by the app.
/// Platform-specific archives install to `<this>/<platform_id>/`.
pub fn ocr_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(OCR_RUNTIME_DIR))
}

/// Root for Reader library metadata, extracted document cache, and thumbnails.
pub fn reader_data_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(portable::app_data_dir(app)?.join(READER_DIR))
}

/// Root for Reader Python extraction dependencies managed by the app.
pub fn reader_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(READER_RUNTIME_DIR))
}

/// Root for the neural denoiser (DeepFilterNet) Python runtime managed by the app.
pub fn denoise_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(DENOISE_RUNTIME_DIR))
}

/// Root for file-ASR and speaker-isolation assets managed by the app.
/// Each catalog entry installs to `<this>/<model_id>/`.
pub fn speech_analysis_models_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(SPEECH_ANALYSIS_MODELS_DIR))
}

/// Root for creative-audio generation assets managed by the app.
/// These runtimes must stay off the dictation hot path.
pub fn creative_audio_models_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(model_root_dir(app)?.join(CREATIVE_AUDIO_MODELS_DIR))
}

/// Root for creative-audio runtime bundles managed by the app.
pub fn creative_audio_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_models_dir(app)?.join(CREATIVE_AUDIO_RUNTIME_DIR))
}

/// Root for resumable creative-audio runtime/model downloads.
pub fn creative_audio_downloads_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_models_dir(app)?.join(CREATIVE_AUDIO_DOWNLOADS_DIR))
}

/// Official Stable Audio 3 MLX runtime checkout.
pub fn stable_audio3_mlx_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_runtime_dir(app)?.join(STABLE_AUDIO3_MLX_DIR))
}

/// Managed ACE-Step runtime checkout.
pub fn ace_step_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_runtime_dir(app)?.join(ACE_STEP_RUNTIME_DIR))
}

/// ACE-Step model snapshot managed by the app.
pub fn ace_step_model_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_models_dir(app)?.join(ACE_STEP_MODEL_DIR))
}

pub fn diffrhythm_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_runtime_dir(app)?.join(DIFFRHYTHM_RUNTIME_DIR))
}

pub fn diffrhythm_model_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_models_dir(app)?.join(DIFFRHYTHM_MODEL_DIR))
}

pub fn yue_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_runtime_dir(app)?.join(YUE_RUNTIME_DIR))
}

pub fn yue_model_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_models_dir(app)?.join(YUE_MODEL_DIR))
}

pub fn figaro_runtime_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_runtime_dir(app)?.join(FIGARO_RUNTIME_DIR))
}

pub fn figaro_model_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(creative_audio_models_dir(app)?.join(FIGARO_MODEL_DIR))
}

/// Per-repo install root for TTS models pulled in from the verified HF
/// collection. Each repo lives at `<this>/<sanitized-repo>/`.
pub fn tts_hf_models_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(tts_model_store_dir(app)?.join("hf"))
}

pub fn vibevoice_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(tts_model_store_dir(app)?.join(VIBEVOICE_DIR))
}

pub fn lfm2_tool_staging_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(llm_models_dir(app)?.join(LFM2_TOOL_DIR))
}

fn migrate_legacy_stt_layout(app: &AppHandle) -> Result<(), String> {
    let legacy_dir = portable::app_data_dir(app)
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?
        .join(MODEL_ROOT_DIR);
    let stt_dir =
        stt_models_dir(app).map_err(|err| format!("Failed to resolve STT model dir: {err}"))?;

    ensure_dir(&stt_dir)?;

    if !legacy_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&legacy_dir).map_err(|err| {
        format!(
            "Failed to read legacy model dir '{}': {err}",
            legacy_dir.display()
        )
    })? {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {err}"))?;
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if matches!(
            name_str.as_ref(),
            STT_MODELS_DIR | TTS_MODELS_DIR | LLM_MODELS_DIR
        ) {
            continue;
        }

        if name_str.starts_with('.') {
            continue;
        }

        let destination = stt_dir.join(&name);
        if destination.exists() {
            continue;
        }

        fs::rename(&path, &destination).map_err(|err| {
            format!(
                "Failed to move legacy STT asset '{}' to '{}': {err}",
                path.display(),
                destination.display()
            )
        })?;
        info!(
            "Moved legacy STT asset '{}' to '{}'",
            path.display(),
            destination.display()
        );
    }

    Ok(())
}

fn migrate_legacy_llm_layout(app: &AppHandle) -> Result<(), String> {
    let llm_dir =
        llm_models_dir(app).map_err(|err| format!("Failed to resolve LLM model dir: {err}"))?;
    let qwen_cache_dir =
        qwen3_cache_dir(app).map_err(|err| format!("Failed to resolve Qwen cache dir: {err}"))?;
    let personaplex_dir =
        personaplex_dir(app).map_err(|err| format!("Failed to resolve PersonaPlex dir: {err}"))?;
    let personaplex_helper = personaplex_helper_path(app)
        .map_err(|err| format!("Failed to resolve PersonaPlex helper path: {err}"))?;

    ensure_dir(&llm_dir)?;
    ensure_dir(&qwen_cache_dir)?;
    ensure_dir(&personaplex_dir)?;

    if let Some(home) = dirs::home_dir() {
        let legacy_qwen_cache = home.join("Apps").join("Models").join(QWEN3_CACHE_DIR);
        if legacy_qwen_cache.exists() {
            for entry in fs::read_dir(&legacy_qwen_cache).map_err(|err| {
                format!(
                    "Failed to read legacy Qwen cache '{}': {err}",
                    legacy_qwen_cache.display()
                )
            })? {
                let entry = entry
                    .map_err(|err| format!("Failed to read legacy Qwen cache entry: {err}"))?;
                copy_dir_if_missing(
                    &entry.path(),
                    &qwen_cache_dir.join(entry.file_name()),
                    "legacy Qwen cache",
                )?;
            }
        }

        for legacy_helper in [
            home.join("Apps")
                .join("speech-swift")
                .join(".build")
                .join("release")
                .join(PERSONAPLEX_HELPER_NAME),
            home.join("Apps")
                .join("speech-swift")
                .join(".build")
                .join("arm64-apple-macosx")
                .join("release")
                .join(PERSONAPLEX_HELPER_NAME),
            home.join("Apps")
                .join("Models")
                .join("speech-swift")
                .join(".build")
                .join("release")
                .join(PERSONAPLEX_HELPER_NAME),
            home.join("Apps")
                .join("Models")
                .join("speech-swift")
                .join(".build")
                .join("arm64-apple-macosx")
                .join("release")
                .join(PERSONAPLEX_HELPER_NAME),
        ] {
            copy_dir_if_missing(
                &legacy_helper,
                &personaplex_helper,
                "PersonaPlex helper binary",
            )?;
        }
    }

    Ok(())
}

fn migrate_local_model_snapshots(app: &AppHandle) -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let snapshots = home.join("Apps").join("Models");
    if !snapshots.exists() {
        return Ok(());
    }

    // LFM2.5-Audio GGUF (Q4_0 quant + macOS runner zip) → models/tts/store/lfm-audio-gguf/
    let lfm_audio_src = snapshots.join("LiquidAI_LFM2.5-Audio-1.5B-GGUF");
    let lfm_audio_dst = lfm_audio_gguf_dir(app)
        .map_err(|err| format!("Failed to resolve LFM Audio GGUF dir: {err}"))?;
    if lfm_audio_src.exists() {
        ensure_dir(&lfm_audio_dst)?;
        let q = LFM_AUDIO_QUANT;
        let needed_files = [
            format!("LFM2.5-Audio-1.5B-{q}.gguf"),
            format!("mmproj-LFM2.5-Audio-1.5B-{q}.gguf"),
            format!("vocoder-LFM2.5-Audio-1.5B-{q}.gguf"),
            format!("tokenizer-LFM2.5-Audio-1.5B-{q}.gguf"),
        ];
        for file in needed_files.iter() {
            let src = lfm_audio_src.join(file);
            let dst = lfm_audio_dst.join(file);
            copy_dir_if_missing(&src, &dst, "LFM2.5-Audio GGUF")?;
        }
        let runner_src = lfm_audio_src.join("runners").join(LFM_AUDIO_RUNNER_ZIP);
        let runner_dst = lfm_audio_dst.join(LFM_AUDIO_RUNNER_ZIP);
        copy_dir_if_missing(&runner_src, &runner_dst, "LFM2.5-Audio runner zip")?;
    }

    // VibeVoice → models/tts/store/vibevoice/
    let vv_src = snapshots.join("microsoft_VibeVoice-Realtime-0.5B");
    let vv_dst =
        vibevoice_dir(app).map_err(|err| format!("Failed to resolve VibeVoice dir: {err}"))?;
    if vv_src.exists() {
        ensure_dir(&vv_dst)?;
        for file in VIBEVOICE_FILES {
            let src = vv_src.join(file);
            let dst = vv_dst.join(file);
            copy_dir_if_missing(&src, &dst, "VibeVoice asset")?;
        }
    }

    // LFM2-Tool GGUF (Q4_K_M) → models/llm/lfm2-tool/ (staging for Ollama import)
    let lfm2_src = snapshots.join("LiquidAI_LFM2-1.2B-Tool-GGUF");
    let lfm2_dst = lfm2_tool_staging_dir(app)
        .map_err(|err| format!("Failed to resolve LFM2-Tool staging dir: {err}"))?;
    if lfm2_src.exists() {
        ensure_dir(&lfm2_dst)?;
        let src = lfm2_src.join(LFM2_TOOL_QUANT_FILE);
        let dst = lfm2_dst.join(LFM2_TOOL_QUANT_FILE);
        copy_dir_if_missing(&src, &dst, "LFM2-Tool GGUF")?;
    }

    Ok(())
}

fn migrate_legacy_creative_audio_layout(app: &AppHandle) -> Result<(), String> {
    let creative_root = creative_audio_models_dir(app)
        .map_err(|err| format!("Failed to resolve creative audio dir: {err}"))?;
    let legacy_stable_audio3 = creative_root.join(STABLE_AUDIO3_MLX_DIR);
    let managed_stable_audio3 = stable_audio3_mlx_dir(app)
        .map_err(|err| format!("Failed to resolve Stable Audio 3 runtime dir: {err}"))?;

    if legacy_stable_audio3.exists() && !managed_stable_audio3.exists() {
        copy_dir_if_missing(
            &legacy_stable_audio3,
            &managed_stable_audio3,
            "Stable Audio 3 creative-audio runtime",
        )?;
    }

    Ok(())
}

pub fn ensure_model_storage_layout(app: &AppHandle) -> Result<(), String> {
    for dir in [
        model_root_dir(app).map_err(|err| format!("Failed to resolve model root: {err}"))?,
        stt_models_dir(app).map_err(|err| format!("Failed to resolve STT dir: {err}"))?,
        tts_models_dir(app).map_err(|err| format!("Failed to resolve TTS dir: {err}"))?,
        tts_model_store_dir(app).map_err(|err| format!("Failed to resolve TTS store: {err}"))?,
        tts_packs_dir(app).map_err(|err| format!("Failed to resolve TTS packs: {err}"))?,
        tts_runtime_dir(app).map_err(|err| format!("Failed to resolve TTS runtime: {err}"))?,
        tts_downloads_dir(app)
            .map_err(|err| format!("Failed to resolve TTS download dir: {err}"))?,
        llm_models_dir(app).map_err(|err| format!("Failed to resolve LLM dir: {err}"))?,
        qwen3_cache_dir(app).map_err(|err| format!("Failed to resolve Qwen cache: {err}"))?,
        personaplex_dir(app).map_err(|err| format!("Failed to resolve PersonaPlex dir: {err}"))?,
    ] {
        if let Err(err) = ensure_dir(&dir) {
            warn!("{err}");
            return Err(err);
        }
    }

    ensure_dir(&ocr_models_dir(app).map_err(|err| format!("Failed to resolve OCR dir: {err}"))?)?;
    ensure_dir(
        &speech_analysis_models_dir(app)
            .map_err(|err| format!("Failed to resolve speech analysis dir: {err}"))?,
    )?;
    ensure_dir(
        &creative_audio_models_dir(app)
            .map_err(|err| format!("Failed to resolve creative audio dir: {err}"))?,
    )?;
    ensure_dir(
        &creative_audio_runtime_dir(app)
            .map_err(|err| format!("Failed to resolve creative audio runtime dir: {err}"))?,
    )?;
    ensure_dir(
        &creative_audio_downloads_dir(app)
            .map_err(|err| format!("Failed to resolve creative audio downloads dir: {err}"))?,
    )?;

    migrate_legacy_stt_layout(app)?;
    migrate_legacy_llm_layout(app)?;
    migrate_local_model_snapshots(app)?;
    migrate_legacy_creative_audio_layout(app)?;
    crate::ocr_models::migrate_local_ocr_snapshots(app);

    Ok(())
}
