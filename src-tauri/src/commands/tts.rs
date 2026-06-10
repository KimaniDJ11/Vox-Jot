use crate::managers::transcription::TranscriptionManager;
use crate::settings::{
    build_tts_preset_from_legacy, get_settings, sanitize_tts_voice_tuning_for_target,
    write_settings, AppSettings, TtsStyleControlValue, TtsVoicePreset, TtsVoicePresetInput,
    TtsVoiceTuningSettings,
};
use crate::tts::{default_preview_request, SpeakRequest, TtsManager, TtsPackInfo, VoiceInfo};
use crate::tts_profiles::{
    clear_collected_data, create_voice_profile, delete_voice_profile, get_profile_progress,
    import_profile_reference_audio, list_voice_profiles, maybe_backfill_profile_transcript,
    read_wav_as_mono_16k, resolve_voice_profile, set_continuous_improvement,
    TtsVoiceProfileDescriptor,
};
use hound::{WavSpec, WavWriter};
use log::warn;
use rodio::Source;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const TTS_COMMAND_STACK_BYTES: usize = 64 * 1024 * 1024;
const READER_EXPORT_SAMPLE_RATE: u32 = 24_000;
const READER_EXPORT_UNIT_GAP_SECONDS: f32 = 0.12;
const READER_AUDIO_CACHE_DIR: &str = "audio-cache";
const READER_AUDIO_CACHE_VERSION: &str = "reader-audio-cache-v1";

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_reader_playback_rate(value: Option<f32>) -> Result<Option<f32>, String> {
    match value {
        Some(rate) if !rate.is_finite() => {
            Err("Reader playback speed must be a finite number.".to_string())
        }
        Some(rate) => Ok(Some(rate.clamp(0.5, 2.0))),
        None => Ok(None),
    }
}

fn reader_preset_for_request(
    settings: &AppSettings,
    preset_id: Option<&str>,
    playback_rate: Option<f32>,
) -> Result<TtsVoicePreset, String> {
    let mut preset = if let Some(preset_id) = preset_id.filter(|value| !value.trim().is_empty()) {
        settings
            .tts_preset(preset_id)
            .cloned()
            .ok_or_else(|| format!("Unknown Reader voice preset '{}'.", preset_id))?
    } else {
        settings
            .active_tts_preset()
            .cloned()
            .unwrap_or_else(|| build_tts_preset_from_legacy(settings, None))
    };

    if let Some(rate) = playback_rate {
        preset.tuning.tempo_rate = rate.clamp(0.5, 2.0);
    }

    Ok(preset)
}

fn sanitize_tuning(tuning: &mut TtsVoiceTuningSettings, provider_id: &str, model_id: &str) {
    tuning.tempo_rate = tuning.tempo_rate.clamp(0.5, 2.0);
    tuning.expressiveness = tuning.expressiveness.clamp(0.0, 1.0);
    tuning.exaggeration = tuning.exaggeration.clamp(0.0, 2.0);
    tuning.randomness = tuning.randomness.clamp(0.0, 1.0);
    tuning.guidance = tuning.guidance.clamp(0.0, 1.0);
    tuning.stability = tuning.stability.clamp(0.0, 1.0);
    let _ = sanitize_tts_voice_tuning_for_target(tuning, provider_id, model_id);
    tuning.style_instructions = normalize_optional_string(tuning.style_instructions.clone());
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceChangerResult {
    pub source_path: String,
    pub output_path: String,
    pub target_profile_label: String,
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioExportUnit {
    pub text: String,
    pub preset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioCacheUnit {
    pub id: String,
    pub text: String,
    pub preset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioExportResult {
    pub output_path: String,
    pub unit_count: usize,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioCacheStatus {
    pub total_count: usize,
    pub ready_count: usize,
    pub missing_count: usize,
    pub cache_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioCachePrepareResult {
    pub total_count: usize,
    pub reused_count: usize,
    pub generated_count: usize,
    pub cache_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioCachePlayResult {
    pub cache_hit: bool,
}

/// One spoken word (whitespace token) with its time span inside a unit's audio.
/// `words` always has one entry per whitespace token of the unit text and is
/// index-aligned with the on-screen word spans, so the frontend highlights the
/// active word by `currentTime`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderWordTiming {
    pub text: String,
    pub start_ms: u32,
    pub end_ms: u32,
}

/// Result of ensuring a reader unit is synthesized: the on-disk cache WAV path
/// (read by the frontend `<audio>` via `readFile` → blob URL), its duration,
/// and per-word timings for word-by-word highlighting.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioUnitRender {
    pub path: String,
    pub duration_ms: u32,
    pub words: Vec<ReaderWordTiming>,
    pub cache_hit: bool,
    /// True when the timings came from precise (Whisper) forced alignment,
    /// false when from the deterministic proportional fallback.
    pub aligned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudiobookChapter {
    pub title: String,
    /// Reading units belonging to this chapter, in order. Carry unit ids so the
    /// export reuses the per-unit audio cache instead of re-synthesizing.
    pub units: Vec<ReaderAudioCacheUnit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudiobookResult {
    pub output_path: String,
    pub chapter_count: usize,
    pub unit_count: usize,
    pub duration_ms: u32,
    pub format: String,
}

#[derive(Serialize)]
struct ReaderAudioCacheKey<'a> {
    version: &'static str,
    document_id: &'a str,
    unit_id: &'a str,
    text: &'a str,
    provider_id: &'a str,
    model_id: &'a str,
    voice_id: &'a Option<String>,
    voice_profile_id: &'a Option<String>,
    locale_snapshot: &'a Option<String>,
    /// Per-document language override (gap: per-document language selection),
    /// keyed so switching the document language re-synthesizes in the new voice.
    language: Option<&'a str>,
    playback_rate: Option<f32>,
    tuning: ReaderAudioCacheTuningKey<'a>,
}

#[derive(Serialize)]
struct ReaderAudioCacheTuningKey<'a> {
    tempo_rate: f32,
    expressiveness: f32,
    exaggeration: f32,
    randomness: f32,
    guidance: f32,
    stability: f32,
    repetition_penalty: f32,
    style_instructions: &'a Option<String>,
    advanced_overrides: BTreeMap<&'a str, &'a TtsStyleControlValue>,
}

fn fallback_preset_label(input: &TtsVoicePresetInput) -> String {
    if let Some(label) = input
        .label
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return label.trim().to_string();
    }
    if let Some(snapshot) = input
        .voice_label_snapshot
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return snapshot.trim().to_string();
    }
    if input
        .voice_profile_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return "Cloned Voice".to_string();
    }
    if let Some(voice_id) = input
        .voice_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return voice_id.to_string();
    }
    if !input.model_id.trim().is_empty() {
        return input.model_id.trim().to_string();
    }
    "Voice Preset".to_string()
}

pub(crate) fn preset_from_input(
    input: TtsVoicePresetInput,
    preset_id: Option<String>,
) -> Result<TtsVoicePreset, String> {
    if input.provider_id.trim().is_empty() {
        return Err("A TTS provider is required for voice presets.".to_string());
    }
    if input.model_id.trim().is_empty() {
        return Err("A TTS model is required for voice presets.".to_string());
    }

    let label = fallback_preset_label(&input);
    let mut tuning = input.tuning;
    sanitize_tuning(&mut tuning, &input.provider_id, &input.model_id);

    Ok(TtsVoicePreset {
        id: preset_id.unwrap_or_else(|| format!("tts-preset-{}", Uuid::new_v4())),
        label,
        provider_id: input.provider_id.trim().to_string(),
        model_id: input.model_id.trim().to_string(),
        voice_id: normalize_optional_string(input.voice_id),
        voice_profile_id: normalize_optional_string(input.voice_profile_id),
        voice_label_snapshot: normalize_optional_string(input.voice_label_snapshot),
        locale_snapshot: normalize_optional_string(input.locale_snapshot),
        tuning,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn tts_speak(
    app: AppHandle,
    text: String,
    locale: Option<String>,
    preferred_voice_id: Option<String>,
    trigger: Option<String>,
    remember_last_output: Option<bool>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        SpeakRequest {
            text,
            locale,
            preferred_voice_id,
            preset_id: None,
            inline_preset: None,
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
        },
        "tts-command-speak",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn tts_speak_with_preset(
    app: AppHandle,
    text: String,
    locale: Option<String>,
    preset_id: String,
    trigger: Option<String>,
    remember_last_output: Option<bool>,
) -> Result<(), String> {
    let normalized_preset_id = preset_id.trim().to_string();
    if normalized_preset_id.is_empty() {
        return Err("A voice preset is required for Reader playback.".to_string());
    }

    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        SpeakRequest {
            text,
            locale,
            preferred_voice_id: None,
            preset_id: Some(normalized_preset_id),
            inline_preset: None,
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
        },
        "tts-command-speak-preset",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn tts_speak_reader(
    app: AppHandle,
    text: String,
    locale: Option<String>,
    preset_id: Option<String>,
    playback_rate: Option<f32>,
    trigger: Option<String>,
    remember_last_output: Option<bool>,
) -> Result<(), String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let settings = get_settings(&app);
    let preset = reader_preset_for_request(&settings, preset_id.as_deref(), normalized_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        SpeakRequest {
            text,
            locale,
            preferred_voice_id: None,
            preset_id: None,
            inline_preset: Some(preset),
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
        },
        "tts-command-reader-speak",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn export_reader_audio(
    app: AppHandle,
    units: Vec<ReaderAudioExportUnit>,
    output_path: String,
    playback_rate: Option<f32>,
) -> Result<ReaderAudioExportResult, String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-reader-export", move || async move {
        export_reader_audio_inner(app, manager, units, output_path, normalized_rate).await
    })
    .await
}

/// Export a full audiobook (chaptered) from the document's reading units. WAV is
/// written directly; `mp3` and `m4b` are encoded via ffmpeg with embedded
/// chapter markers (and cover art when provided). Reuses the per-unit audio
/// cache so a prepared document exports without re-synthesizing.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn export_reader_audiobook(
    app: AppHandle,
    document_id: String,
    chapters: Vec<ReaderAudiobookChapter>,
    output_path: String,
    format: String,
    playback_rate: Option<f32>,
    language: Option<String>,
    title: Option<String>,
    author: Option<String>,
    cover_data_url: Option<String>,
) -> Result<ReaderAudiobookResult, String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-reader-audiobook", move || async move {
        export_reader_audiobook_inner(
            app,
            manager,
            document_id,
            chapters,
            output_path,
            format,
            normalized_rate,
            language,
            title,
            author,
            cover_data_url,
        )
        .await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_reader_audio_cache_status(
    app: AppHandle,
    document_id: String,
    units: Vec<ReaderAudioCacheUnit>,
    playback_rate: Option<f32>,
    language: Option<String>,
) -> Result<ReaderAudioCacheStatus, String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let settings = get_settings(&app);
    reader_audio_cache_status(
        &app,
        &settings,
        &document_id,
        &units,
        normalized_rate,
        language.as_deref(),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_reader_audio_cache(
    app: AppHandle,
    document_id: String,
    units: Vec<ReaderAudioCacheUnit>,
    playback_rate: Option<f32>,
    language: Option<String>,
) -> Result<ReaderAudioCachePrepareResult, String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-reader-cache-prepare", move || async move {
        prepare_reader_audio_cache_inner(
            app,
            manager,
            document_id,
            units,
            normalized_rate,
            language,
        )
        .await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn play_reader_audio_unit(
    app: AppHandle,
    document_id: String,
    unit: ReaderAudioCacheUnit,
    playback_rate: Option<f32>,
    language: Option<String>,
) -> Result<ReaderAudioCachePlayResult, String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-reader-cache-play", move || async move {
        let settings = get_settings(&app);
        let (cache_path, cache_hit) = ensure_reader_audio_cache_unit(
            &app,
            Arc::clone(&manager),
            &settings,
            &document_id,
            &unit,
            normalized_rate,
            language.as_deref(),
        )
        .await?;
        manager.play_cached_audio_file(cache_path)?;
        Ok(ReaderAudioCachePlayResult { cache_hit })
    })
    .await
}

/// Ensure a reader unit is synthesized to its cache WAV and return the on-disk
/// path plus per-word timings, WITHOUT playing it. The frontend `<audio>`
/// element plays the file (read via `readFile` → blob URL), which gives a
/// precise timeline for word-by-word highlighting, gapless preloading, and
/// resume. Timings are precise (Whisper forced alignment) when a `.words.json`
/// sidecar exists (produced by `prepare_reader_audio_cache`), otherwise a
/// deterministic proportional fallback derived from the audio duration.
#[tauri::command]
#[specta::specta]
pub async fn synthesize_reader_audio_unit(
    app: AppHandle,
    document_id: String,
    unit: ReaderAudioCacheUnit,
    playback_rate: Option<f32>,
    language: Option<String>,
) -> Result<ReaderAudioUnitRender, String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-reader-cache-synth", move || async move {
        let settings = get_settings(&app);
        let (cache_path, cache_hit) = ensure_reader_audio_cache_unit(
            &app,
            Arc::clone(&manager),
            &settings,
            &document_id,
            &unit,
            normalized_rate,
            language.as_deref(),
        )
        .await?;
        let duration_ms = reader_audio_wav_duration_ms(&cache_path).unwrap_or(0);
        let (words, aligned) = reader_word_timings(&cache_path, &unit.text, duration_ms);
        Ok(ReaderAudioUnitRender {
            path: cache_path.to_string_lossy().to_string(),
            duration_ms,
            words,
            cache_hit,
            aligned,
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn tts_stop(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.stop();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_available_tts_voices(app: AppHandle) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-list-voices", move || async move {
        let settings = get_settings(&app);
        let provider_id = manager.selected_provider_id(&settings);
        manager
            .ensure_managed_speech_runtime_available(&provider_id)
            .await?;
        manager.get_available_voices()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_tts_voices_for_selection(
    app: AppHandle,
    provider_id: String,
    model_id: Option<String>,
) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-selection-voices", move || async move {
        manager
            .ensure_managed_speech_runtime_available(&provider_id)
            .await?;
        manager.get_available_voices_for_selection(&provider_id, model_id.as_deref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn refresh_tts_voices(app: AppHandle) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-refresh-voices", move || async move {
        let settings = get_settings(&app);
        let provider_id = manager.selected_provider_id(&settings);
        manager
            .ensure_managed_speech_runtime_available(&provider_id)
            .await?;
        manager.invalidate_voice_cache();
        manager.get_available_voices()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice(
    app: AppHandle,
    voice_id: Option<String>,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        default_preview_request(voice_id, normalize_optional_string(preview_text)),
        "tts-command-preview-voice",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice_preset(
    app: AppHandle,
    preset_id: String,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    let mut request = default_preview_request(None, normalize_optional_string(preview_text));
    request.trigger = Some("preview_tts_voice_preset".to_string());
    request.preset_id = Some(preset_id);
    speak_on_command_thread(manager, request, "tts-command-preview-preset").await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice_preset_draft(
    app: AppHandle,
    input: TtsVoicePresetInput,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    let mut request = default_preview_request(None, normalize_optional_string(preview_text));
    request.trigger = Some("preview_tts_voice_preset_draft".to_string());
    request.inline_preset = Some(preset_from_input(input, None)?);
    speak_on_command_thread(manager, request, "tts-command-preview-draft").await
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_sidecar_engine(app: AppHandle, provider_id: String) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-prepare-sidecar", move || async move {
        manager.prepare_sidecar_provider(&provider_id, None).await
    })
    .await
}

async fn run_tts_async_command_on_stack<T, F, Fut>(
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
        .stack_size(TTS_COMMAND_STACK_BYTES)
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|err| format!("Failed to start TTS command runtime: {err}"))?;
                runtime.block_on(task())
            })();
            let _ = tx.send(result);
        })
        .map_err(|err| format!("Failed to start TTS command thread: {err}"))?;

    rx.await
        .map_err(|_| "TTS command thread stopped before returning a result.".to_string())?
}

async fn speak_on_command_thread(
    manager: Arc<TtsManager>,
    request: SpeakRequest,
    thread_name: &'static str,
) -> Result<(), String> {
    run_tts_async_command_on_stack(
        thread_name,
        move || async move { manager.speak(request).await },
    )
    .await
}

fn validate_reader_document_id(document_id: &str) -> Result<&str, String> {
    let trimmed = document_id.trim();
    if !trimmed.is_empty()
        && trimmed.len() <= 32
        && trimmed.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        Ok(trimmed)
    } else {
        Err("Invalid Reader document id.".to_string())
    }
}

fn reader_audio_cache_document_dir(app: &AppHandle, document_id: &str) -> Result<PathBuf, String> {
    let document_id = validate_reader_document_id(document_id)?;
    let reader_data_dir = crate::storage_paths::reader_data_dir(app)
        .map_err(|err| format!("Failed to resolve Reader audio cache directory: {err}"))?;
    Ok(reader_data_dir
        .join(READER_AUDIO_CACHE_DIR)
        .join(document_id))
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn reader_audio_tuning_cache_key(tuning: &TtsVoiceTuningSettings) -> ReaderAudioCacheTuningKey<'_> {
    ReaderAudioCacheTuningKey {
        tempo_rate: tuning.tempo_rate,
        expressiveness: tuning.expressiveness,
        exaggeration: tuning.exaggeration,
        randomness: tuning.randomness,
        guidance: tuning.guidance,
        stability: tuning.stability,
        repetition_penalty: tuning.repetition_penalty,
        style_instructions: &tuning.style_instructions,
        advanced_overrides: tuning
            .advanced_overrides
            .iter()
            .map(|(key, value)| (key.as_str(), value))
            .collect(),
    }
}

fn normalize_reader_language(language: Option<&str>) -> Option<String> {
    language.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn reader_audio_cache_path(
    app: &AppHandle,
    settings: &AppSettings,
    document_id: &str,
    unit: &ReaderAudioCacheUnit,
    playback_rate: Option<f32>,
    language: Option<&str>,
) -> Result<(PathBuf, TtsVoicePreset), String> {
    let document_dir = reader_audio_cache_document_dir(app, document_id)?;
    let preset = reader_preset_for_request(settings, unit.preset_id.as_deref(), playback_rate)?;
    let normalized_language = normalize_reader_language(language);
    let key = ReaderAudioCacheKey {
        version: READER_AUDIO_CACHE_VERSION,
        document_id: validate_reader_document_id(document_id)?,
        unit_id: unit.id.trim(),
        text: unit.text.trim(),
        provider_id: &preset.provider_id,
        model_id: &preset.model_id,
        voice_id: &preset.voice_id,
        voice_profile_id: &preset.voice_profile_id,
        locale_snapshot: &preset.locale_snapshot,
        language: normalized_language.as_deref(),
        playback_rate,
        tuning: reader_audio_tuning_cache_key(&preset.tuning),
    };
    let key_bytes = serde_json::to_vec(&key)
        .map_err(|err| format!("Failed to encode Reader audio cache key: {err}"))?;
    let digest = Sha256::digest(&key_bytes);
    Ok((
        document_dir.join(format!("{}.wav", hex_digest(&digest))),
        preset,
    ))
}

fn reader_audio_cache_bytes(app: &AppHandle, document_id: &str) -> Result<u64, String> {
    let dir = reader_audio_cache_document_dir(app, document_id)?;
    if !dir.is_dir() {
        return Ok(0);
    }
    let mut total = 0u64;
    for entry in fs::read_dir(&dir).map_err(|err| {
        format!(
            "Failed to read Reader audio cache '{}': {err}",
            dir.display()
        )
    })? {
        let entry =
            entry.map_err(|err| format!("Failed to read Reader audio cache entry: {err}"))?;
        let path = entry.path();
        if path.is_file() {
            total =
                total.saturating_add(entry.metadata().map(|metadata| metadata.len()).unwrap_or(0));
        }
    }
    Ok(total)
}

fn reader_audio_cache_status(
    app: &AppHandle,
    settings: &AppSettings,
    document_id: &str,
    units: &[ReaderAudioCacheUnit],
    playback_rate: Option<f32>,
    language: Option<&str>,
) -> Result<ReaderAudioCacheStatus, String> {
    let mut total_count = 0usize;
    let mut ready_count = 0usize;
    for unit in units {
        if unit.text.trim().is_empty() {
            continue;
        }
        total_count += 1;
        let (path, _) =
            reader_audio_cache_path(app, settings, document_id, unit, playback_rate, language)?;
        if path.is_file() {
            ready_count += 1;
        }
    }
    let cache_bytes = reader_audio_cache_bytes(app, document_id)?;
    Ok(ReaderAudioCacheStatus {
        total_count,
        ready_count,
        missing_count: total_count.saturating_sub(ready_count),
        cache_bytes,
    })
}

async fn prepare_reader_audio_cache_inner(
    app: AppHandle,
    manager: Arc<TtsManager>,
    document_id: String,
    units: Vec<ReaderAudioCacheUnit>,
    playback_rate: Option<f32>,
    language: Option<String>,
) -> Result<ReaderAudioCachePrepareResult, String> {
    let settings = get_settings(&app);
    let mut total_count = 0usize;
    let mut reused_count = 0usize;
    let mut generated_count = 0usize;
    // Collect (wav, text) pairs that still need precise word alignment so we can
    // align them all in a single aligner process (one model load).
    let mut alignment_jobs: Vec<(PathBuf, String)> = Vec::new();

    for unit in &units {
        if unit.text.trim().is_empty() {
            continue;
        }
        total_count += 1;
        let (cache_path, cache_hit) = ensure_reader_audio_cache_unit(
            &app,
            Arc::clone(&manager),
            &settings,
            &document_id,
            unit,
            playback_rate,
            language.as_deref(),
        )
        .await?;
        if cache_hit {
            reused_count += 1;
        } else {
            generated_count += 1;
        }
        if !reader_word_timings_path(&cache_path).is_file() {
            alignment_jobs.push((cache_path, unit.text.trim().to_string()));
        }
    }

    // Precise (Whisper) alignment is best-effort: if the aligner runtime is
    // unavailable, playback still gets proportional word timings, so a failure
    // here never blocks "Prepare audio".
    if !alignment_jobs.is_empty() {
        if let Err(err) = run_reader_alignment(&app, &alignment_jobs, language.as_deref()).await {
            warn!("Reader word alignment skipped: {err}");
        }
    }

    Ok(ReaderAudioCachePrepareResult {
        total_count,
        reused_count,
        generated_count,
        cache_bytes: reader_audio_cache_bytes(&app, &document_id)?,
    })
}

async fn ensure_reader_audio_cache_unit(
    app: &AppHandle,
    manager: Arc<TtsManager>,
    settings: &AppSettings,
    document_id: &str,
    unit: &ReaderAudioCacheUnit,
    playback_rate: Option<f32>,
    language: Option<&str>,
) -> Result<(PathBuf, bool), String> {
    let text = unit.text.trim().to_string();
    if text.is_empty() {
        return Err("There is no readable text for this Reader part.".to_string());
    }

    let (cache_path, preset) =
        reader_audio_cache_path(app, settings, document_id, unit, playback_rate, language)?;
    if cache_path.is_file() {
        return Ok((cache_path, true));
    }

    let synthesis_locale = normalize_reader_language(language);

    let cache_dir = cache_path
        .parent()
        .ok_or_else(|| "Failed to resolve Reader audio cache folder.".to_string())?;
    fs::create_dir_all(cache_dir).map_err(|err| {
        format!(
            "Failed to create Reader audio cache '{}': {err}",
            cache_dir.display()
        )
    })?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let temp_paths = manager
        .synthesize_to_temp_files(
            SpeakRequest {
                text,
                locale: synthesis_locale,
                preferred_voice_id: None,
                preset_id: None,
                inline_preset: Some(preset),
                trigger: Some("reader_audio_cache".to_string()),
                remember_last_output: false,
            },
            stop_flag,
        )
        .await?;

    let mut unit_samples = Vec::new();
    for temp_path in temp_paths {
        let decoded = decode_rendered_audio_file_mono(&temp_path, READER_EXPORT_SAMPLE_RATE)?;
        unit_samples.extend(decoded);
        let _ = fs::remove_file(temp_path);
    }
    if unit_samples.is_empty() {
        return Err("Reader audio generation produced no audio.".to_string());
    }

    let temp_cache_path = cache_path.with_extension("tmp");
    if temp_cache_path.exists() {
        let _ = fs::remove_file(&temp_cache_path);
    }
    write_reader_export_wav(&unit_samples, READER_EXPORT_SAMPLE_RATE, &temp_cache_path)?;
    fs::rename(&temp_cache_path, &cache_path).map_err(|err| {
        format!(
            "Failed to store Reader audio cache '{}': {err}",
            cache_path.display()
        )
    })?;

    Ok((cache_path, false))
}

/// Path of the precise word-timing sidecar next to a unit's cache WAV.
fn reader_word_timings_path(wav_path: &Path) -> PathBuf {
    wav_path.with_extension("words.json")
}

/// Duration of a cache WAV in milliseconds (read from its header).
fn reader_audio_wav_duration_ms(path: &Path) -> Option<u32> {
    let reader = hound::WavReader::open(path).ok()?;
    let spec = reader.spec();
    let frames = reader.len() as u64 / u64::from(spec.channels.max(1));
    let ms = frames.saturating_mul(1000) / u64::from(spec.sample_rate.max(1));
    Some(ms as u32)
}

#[derive(Deserialize)]
struct AlignedWordRecord {
    start_ms: u32,
    end_ms: u32,
}

/// Whitespace tokens of a unit, matching the frontend's per-word `<span>` split
/// exactly so word timings are index-aligned with what's on screen.
fn reader_word_tokens(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

/// Word timings for a unit: precise (Whisper forced alignment, cached as a
/// `.words.json` sidecar) when available, else a deterministic proportional
/// fallback so word-by-word highlighting always works. Returns `(words,
/// aligned)`.
fn reader_word_timings(
    wav_path: &Path,
    text: &str,
    duration_ms: u32,
) -> (Vec<ReaderWordTiming>, bool) {
    if let Some(words) = load_reader_word_timings(wav_path, text) {
        return (words, true);
    }
    (proportional_reader_word_timings(text, duration_ms), false)
}

fn load_reader_word_timings(wav_path: &Path, text: &str) -> Option<Vec<ReaderWordTiming>> {
    let bytes = fs::read(reader_word_timings_path(wav_path)).ok()?;
    let parsed: Vec<AlignedWordRecord> = serde_json::from_slice(&bytes).ok()?;
    let tokens = reader_word_tokens(text);
    // The aligner writes one record per whitespace token, in order. If the count
    // drifted (e.g. text changed), discard and fall back to proportional.
    if parsed.is_empty() || parsed.len() != tokens.len() {
        return None;
    }
    let mut last_end = 0u32;
    Some(
        parsed
            .into_iter()
            .zip(tokens)
            .map(|(record, token)| {
                let start_ms = record.start_ms.max(last_end);
                let end_ms = record.end_ms.max(start_ms);
                last_end = end_ms;
                ReaderWordTiming {
                    text: token.to_string(),
                    start_ms,
                    end_ms,
                }
            })
            .collect(),
    )
}

/// Distribute a unit's known audio duration across its words, weighting by
/// character count plus a pause after sentence/clause punctuation. Short units
/// re-sync at every boundary, so the visual drift within a unit stays small.
fn proportional_reader_word_timings(text: &str, duration_ms: u32) -> Vec<ReaderWordTiming> {
    let tokens = reader_word_tokens(text);
    if tokens.is_empty() {
        return Vec::new();
    }
    let weights: Vec<f64> = tokens
        .iter()
        .map(|token| {
            let chars = token.chars().count().max(1) as f64;
            let pause = if token.ends_with(['.', '!', '?', '…', '。', '！', '？']) {
                4.0
            } else if token.ends_with([',', ';', ':', '—', '–', '、', '，']) {
                2.0
            } else {
                0.0
            };
            chars + pause + 1.0
        })
        .collect();
    let total: f64 = weights.iter().sum::<f64>().max(1.0);
    let duration = f64::from(duration_ms.max(1));
    let mut acc = 0.0f64;
    let mut out = Vec::with_capacity(tokens.len());
    for (index, token) in tokens.iter().enumerate() {
        let start = (acc / total) * duration;
        acc += weights[index];
        let end = (acc / total) * duration;
        out.push(ReaderWordTiming {
            text: (*token).to_string(),
            start_ms: start.round() as u32,
            end_ms: end.round() as u32,
        });
    }
    if let Some(last) = out.last_mut() {
        last.end_ms = duration_ms;
    }
    out
}

/// Run precise word alignment over a batch of (wav, text) jobs in a single
/// aligner process (one model load). Writes a `.words.json` sidecar next to each
/// WAV. Best-effort: errors are returned to the caller, which logs and continues
/// with proportional timings.
async fn run_reader_alignment(
    app: &AppHandle,
    jobs: &[(PathBuf, String)],
    language: Option<&str>,
) -> Result<(), String> {
    if jobs.is_empty() {
        return Ok(());
    }
    let python = crate::commands::reader::ensure_reader_alignment_runtime(app)?;
    let script = crate::commands::reader::resolve_reader_script(app, "reader_align.py")?;

    let items: Vec<serde_json::Value> = jobs
        .iter()
        .map(|(wav, text)| {
            serde_json::json!({
                "wav": wav.to_string_lossy(),
                "text": text,
                "out": reader_word_timings_path(wav).to_string_lossy(),
            })
        })
        .collect();
    let manifest = serde_json::json!({
        "language": normalize_reader_language(language),
        "items": items,
    });
    let manifest_bytes = serde_json::to_vec(&manifest)
        .map_err(|err| format!("Failed to encode alignment manifest: {err}"))?;
    let manifest_path =
        std::env::temp_dir().join(format!("voxjot-reader-align-{}.json", Uuid::new_v4()));
    fs::write(&manifest_path, manifest_bytes)
        .map_err(|err| format!("Failed to write alignment manifest: {err}"))?;

    let manifest_for_task = manifest_path.clone();
    let output = tokio::task::spawn_blocking(move || {
        let result = Command::new(&python)
            .arg(&script)
            .arg("--manifest")
            .arg(&manifest_for_task)
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();
        let _ = fs::remove_file(&manifest_for_task);
        result
    })
    .await
    .map_err(|err| format!("Reader alignment task failed to join: {err}"))?
    .map_err(|err| format!("Failed to run Reader aligner: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Reader aligner exited with status {}", output.status)
        } else {
            stderr
        });
    }
    Ok(())
}

async fn export_reader_audio_inner(
    app: AppHandle,
    manager: Arc<TtsManager>,
    units: Vec<ReaderAudioExportUnit>,
    output_path: String,
    playback_rate: Option<f32>,
) -> Result<ReaderAudioExportResult, String> {
    let target = PathBuf::from(output_path.trim());
    if target.as_os_str().is_empty() {
        return Err("Choose where to save the Reader audio file.".to_string());
    }
    if let Some(parent) = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create Reader audio export folder: {err}"))?;
    }

    let settings = get_settings(&app);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let mut output_samples = Vec::new();
    let mut rendered_units = 0usize;
    let gap_samples =
        (READER_EXPORT_SAMPLE_RATE as f32 * READER_EXPORT_UNIT_GAP_SECONDS).round() as usize;

    for unit in units {
        let text = unit.text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let preset =
            reader_preset_for_request(&settings, unit.preset_id.as_deref(), playback_rate)?;
        let temp_paths = manager
            .synthesize_to_temp_files(
                SpeakRequest {
                    text,
                    locale: None,
                    preferred_voice_id: None,
                    preset_id: None,
                    inline_preset: Some(preset),
                    trigger: Some("reader_audio_export".to_string()),
                    remember_last_output: false,
                },
                Arc::clone(&stop_flag),
            )
            .await?;

        let mut unit_samples = Vec::new();
        for temp_path in temp_paths {
            let decoded = decode_rendered_audio_file_mono(&temp_path, READER_EXPORT_SAMPLE_RATE)?;
            unit_samples.extend(decoded);
            let _ = fs::remove_file(temp_path);
        }
        if unit_samples.is_empty() {
            continue;
        }
        if !output_samples.is_empty() && gap_samples > 0 {
            output_samples.extend(std::iter::repeat_n(0.0, gap_samples));
        }
        output_samples.extend(unit_samples);
        rendered_units += 1;
    }

    if rendered_units == 0 || output_samples.is_empty() {
        return Err("There is no readable text to export.".to_string());
    }

    write_reader_export_wav(&output_samples, READER_EXPORT_SAMPLE_RATE, &target)?;
    let duration_ms = ((output_samples.len() as f64 / f64::from(READER_EXPORT_SAMPLE_RATE))
        * 1000.0)
        .round() as u32;

    Ok(ReaderAudioExportResult {
        output_path: target.to_string_lossy().to_string(),
        unit_count: rendered_units,
        duration_ms,
    })
}

fn reader_samples_to_ms(sample_count: usize) -> u32 {
    ((sample_count as f64 / f64::from(READER_EXPORT_SAMPLE_RATE)) * 1000.0).round() as u32
}

/// Locate the ffmpeg binary: `VOX_JOT_FFMPEG` override, then PATH, then the
/// common Homebrew/system install dirs (matching the Python/Tesseract lookups).
fn locate_ffmpeg() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("VOX_JOT_FFMPEG") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Some(path);
        }
    }
    let binary = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(binary);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/opt/local/bin",
    ] {
        let candidate = Path::new(dir).join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Escape a value for the ffmetadata (FFMETADATA1) format.
fn escape_ffmetadata(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '=' | ';' | '#' | '\\' | '\n') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn build_ffmetadata(
    title: Option<&str>,
    author: Option<&str>,
    chapters: &[(String, u32, u32)],
) -> String {
    let mut out = String::from(";FFMETADATA1\n");
    if let Some(title) = title.filter(|value| !value.trim().is_empty()) {
        out.push_str(&format!("title={}\n", escape_ffmetadata(title.trim())));
        out.push_str(&format!("album={}\n", escape_ffmetadata(title.trim())));
    }
    if let Some(author) = author.filter(|value| !value.trim().is_empty()) {
        out.push_str(&format!("artist={}\n", escape_ffmetadata(author.trim())));
        out.push_str(&format!(
            "album_artist={}\n",
            escape_ffmetadata(author.trim())
        ));
    }
    for (chapter_title, start_ms, end_ms) in chapters {
        out.push_str("[CHAPTER]\nTIMEBASE=1/1000\n");
        out.push_str(&format!("START={start_ms}\n"));
        out.push_str(&format!("END={end_ms}\n"));
        out.push_str(&format!("title={}\n", escape_ffmetadata(chapter_title)));
    }
    out
}

/// Decode an optional `data:image/...;base64,...` cover into a temp file.
fn write_cover_temp(cover_data_url: Option<&str>) -> Option<PathBuf> {
    use base64::Engine as _;
    let data_url = cover_data_url?.trim();
    let comma = data_url.find(',')?;
    let header = &data_url[..comma];
    if !header.contains("base64") {
        return None;
    }
    let extension = if header.contains("jpeg") || header.contains("jpg") {
        "jpg"
    } else {
        "png"
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_url[comma + 1..].trim().as_bytes())
        .ok()?;
    if bytes.is_empty() {
        return None;
    }
    let path = std::env::temp_dir().join(format!(
        "voxjot-reader-cover-{}.{extension}",
        Uuid::new_v4()
    ));
    fs::write(&path, bytes).ok()?;
    Some(path)
}

#[allow(clippy::too_many_arguments)]
async fn export_reader_audiobook_inner(
    app: AppHandle,
    manager: Arc<TtsManager>,
    document_id: String,
    chapters: Vec<ReaderAudiobookChapter>,
    output_path: String,
    format: String,
    playback_rate: Option<f32>,
    language: Option<String>,
    title: Option<String>,
    author: Option<String>,
    cover_data_url: Option<String>,
) -> Result<ReaderAudiobookResult, String> {
    let format = format.trim().to_lowercase();
    if !matches!(format.as_str(), "m4b" | "mp3" | "wav") {
        return Err(format!("Unsupported audiobook format '{format}'."));
    }
    let target = PathBuf::from(output_path.trim());
    if target.as_os_str().is_empty() {
        return Err("Choose where to save the audiobook.".to_string());
    }
    if let Some(parent) = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create audiobook export folder: {err}"))?;
    }

    let settings = get_settings(&app);
    let gap_samples =
        (READER_EXPORT_SAMPLE_RATE as f32 * READER_EXPORT_UNIT_GAP_SECONDS).round() as usize;
    let mut book_samples: Vec<f32> = Vec::new();
    let mut chapter_marks: Vec<(String, u32, u32)> = Vec::new();
    let mut unit_count = 0usize;

    for (chapter_index, chapter) in chapters.iter().enumerate() {
        let chapter_start = book_samples.len();
        for unit in &chapter.units {
            if unit.text.trim().is_empty() {
                continue;
            }
            let (cache_path, _) = ensure_reader_audio_cache_unit(
                &app,
                Arc::clone(&manager),
                &settings,
                &document_id,
                unit,
                playback_rate,
                language.as_deref(),
            )
            .await?;
            let decoded = decode_rendered_audio_file_mono(&cache_path, READER_EXPORT_SAMPLE_RATE)?;
            if decoded.is_empty() {
                continue;
            }
            if !book_samples.is_empty() && gap_samples > 0 {
                book_samples.extend(std::iter::repeat_n(0.0, gap_samples));
            }
            book_samples.extend(decoded);
            unit_count += 1;
        }
        if book_samples.len() > chapter_start {
            let chapter_title = if chapter.title.trim().is_empty() {
                format!("Chapter {}", chapter_index + 1)
            } else {
                chapter.title.trim().to_string()
            };
            chapter_marks.push((
                chapter_title,
                reader_samples_to_ms(chapter_start),
                reader_samples_to_ms(book_samples.len()),
            ));
        }
    }

    if unit_count == 0 || book_samples.is_empty() {
        return Err("There is no readable text to export.".to_string());
    }
    let duration_ms = reader_samples_to_ms(book_samples.len());

    if format == "wav" {
        write_reader_export_wav(&book_samples, READER_EXPORT_SAMPLE_RATE, &target)?;
        return Ok(ReaderAudiobookResult {
            output_path: target.to_string_lossy().to_string(),
            chapter_count: chapter_marks.len(),
            unit_count,
            duration_ms,
            format,
        });
    }

    let ffmpeg = locate_ffmpeg().ok_or_else(|| {
        "ffmpeg is required to export MP3 / M4B audiobooks. Install it (e.g. `brew install ffmpeg`) or export WAV instead.".to_string()
    })?;

    // Stage the concatenated audio + chapter metadata next to the target.
    let temp_wav = target.with_extension("voxjot-tmp.wav");
    write_reader_export_wav(&book_samples, READER_EXPORT_SAMPLE_RATE, &temp_wav)?;
    let meta_path = target.with_extension("voxjot-ffmeta");
    let metadata = build_ffmetadata(title.as_deref(), author.as_deref(), &chapter_marks);
    fs::write(&meta_path, metadata)
        .map_err(|err| format!("Failed to write audiobook chapter metadata: {err}"))?;
    let cover_path = write_cover_temp(cover_data_url.as_deref());

    let mut args: Vec<String> = vec!["-y".into(), "-i".into()];
    args.push(temp_wav.to_string_lossy().to_string());
    args.push("-i".into());
    args.push(meta_path.to_string_lossy().to_string());
    if let Some(cover) = cover_path.as_ref() {
        args.push("-i".into());
        args.push(cover.to_string_lossy().to_string());
    }
    args.push("-map".into());
    args.push("0:a".into());
    if cover_path.is_some() {
        args.push("-map".into());
        args.push("2:v".into());
    }
    args.push("-map_metadata".into());
    args.push("1".into());
    match format.as_str() {
        "m4b" => {
            args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "96k".into()]);
            if cover_path.is_some() {
                args.extend([
                    "-c:v".into(),
                    "mjpeg".into(),
                    "-disposition:v".into(),
                    "attached_pic".into(),
                ]);
            }
            args.extend(["-f".into(), "ipod".into()]);
        }
        "mp3" => {
            args.extend([
                "-c:a".into(),
                "libmp3lame".into(),
                "-b:a".into(),
                "128k".into(),
                "-write_id3v2".into(),
                "1".into(),
            ]);
            if cover_path.is_some() {
                args.extend(["-c:v".into(), "mjpeg".into()]);
            }
        }
        _ => unreachable!(),
    }
    args.push(target.to_string_lossy().to_string());

    let run = tokio::task::spawn_blocking(move || {
        Command::new(&ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    })
    .await
    .map_err(|err| format!("Audiobook encode task failed to join: {err}"))?;

    let _ = fs::remove_file(&temp_wav);
    let _ = fs::remove_file(&meta_path);
    if let Some(cover) = cover_path {
        let _ = fs::remove_file(cover);
    }

    let output = run.map_err(|err| format!("Failed to run ffmpeg: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail = stderr.trim().lines().last().unwrap_or("").to_string();
        return Err(format!(
            "ffmpeg failed to encode the audiobook ({}): {}",
            output.status, tail
        ));
    }

    Ok(ReaderAudiobookResult {
        output_path: target.to_string_lossy().to_string(),
        chapter_count: chapter_marks.len(),
        unit_count,
        duration_ms,
        format,
    })
}

fn decode_rendered_audio_file_mono(
    path: &Path,
    target_sample_rate: u32,
) -> Result<Vec<f32>, String> {
    let file = File::open(path).map_err(|err| {
        format!(
            "Failed to open rendered Reader audio '{}': {err}",
            path.display()
        )
    })?;
    let decoder = rodio::Decoder::try_from(file).map_err(|err| {
        format!(
            "Failed to decode rendered Reader audio '{}': {err}",
            path.display()
        )
    })?;
    let channels = usize::from(decoder.channels()).max(1);
    let sample_rate = decoder.sample_rate();
    let interleaved = decoder.collect::<Vec<f32>>();
    let mono = if channels == 1 {
        interleaved
    } else {
        interleaved
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
            .collect::<Vec<_>>()
    };
    Ok(resample_reader_audio_linear(
        &mono,
        sample_rate,
        target_sample_rate,
    ))
}

fn resample_reader_audio_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let output_len =
        ((samples.len() as f64 * target_rate as f64) / source_rate as f64).round() as usize;
    if output_len == 0 {
        return Vec::new();
    }
    if samples.len() == 1 {
        return vec![samples[0]; output_len];
    }

    let ratio = source_rate as f64 / target_rate as f64;
    (0..output_len)
        .map(|index| {
            let source_pos = index as f64 * ratio;
            let left = source_pos.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let frac = (source_pos - left as f64) as f32;
            samples[left] * (1.0 - frac) + samples[right] * frac
        })
        .collect()
}

fn write_reader_export_wav(
    samples: &[f32],
    sample_rate: u32,
    output_path: &Path,
) -> Result<(), String> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        WavWriter::create(output_path, spec).map_err(|err| format!("WAV write error: {err}"))?;
    for sample in samples {
        let sample_i16 = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer
            .write_sample(sample_i16)
            .map_err(|err| format!("WAV sample write error: {err}"))?;
    }
    writer
        .finalize()
        .map_err(|err| format!("WAV finalize error: {err}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_available_tts_packs(app: AppHandle) -> Result<Vec<TtsPackInfo>, String> {
    let manager = app.state::<Arc<TtsManager>>();
    Ok(manager.get_available_packs())
}

#[tauri::command]
#[specta::specta]
pub fn download_tts_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    if pack_id.trim().is_empty() {
        return Err("TTS pack id is required.".to_string());
    }

    let manager = app.state::<Arc<TtsManager>>().inner().clone();
    let event_app = app.clone();
    let event_pack_id = pack_id.clone();
    let cancel_flag = crate::artifact_download::register_download_cancel_flag("tts", &pack_id);
    // download_pack has a large async state machine that overflows the default 2 MB tokio
    // worker stack on macOS ARM64. Spawn a dedicated OS thread with TTS_COMMAND_STACK_BYTES.
    thread::Builder::new()
        .name("tts-command-download-pack".to_string())
        .stack_size(TTS_COMMAND_STACK_BYTES)
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    let msg = format!("Failed to start TTS download runtime: {err}");
                    warn!("{msg}");
                    emit_tts_pack_download_progress(
                        &event_app,
                        &event_pack_id,
                        "failed",
                        Some(&msg),
                    );
                    return;
                }
            };
            emit_tts_pack_download_progress(&event_app, &event_pack_id, "preparing", None);
            let result =
                runtime.block_on(manager.download_pack(&pack_id, Some(Arc::clone(&cancel_flag))));
            crate::artifact_download::clear_download_cancel_flag("tts", &event_pack_id);
            match result {
                Ok(()) => {
                    emit_tts_pack_download_progress(&event_app, &event_pack_id, "complete", None)
                }
                Err(error) => {
                    warn!("TTS pack download failed for {event_pack_id}: {error}");
                    emit_tts_pack_download_progress(
                        &event_app,
                        &event_pack_id,
                        "failed",
                        Some(&error),
                    );
                }
            }
        })
        .map_err(|err| format!("Failed to start TTS download thread: {err}"))?;
    Ok(())
}

fn emit_tts_pack_download_progress(
    app: &AppHandle,
    pack_id: &str,
    stage: &str,
    error: Option<&str>,
) {
    let payload = serde_json::json!({
        "repo_id": pack_id,
        "stage": stage,
        "file": null,
        "file_index": null,
        "file_count": null,
        "downloaded_bytes": null,
        "total_bytes": null,
        "error": error,
    });
    let _ = app.emit("tts-hf-download-progress", payload);
}

#[tauri::command]
#[specta::specta]
pub fn remove_tts_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.remove_pack(&pack_id)
}

#[tauri::command]
#[specta::specta]
pub fn list_tts_voice_presets(app: AppHandle) -> Result<Vec<TtsVoicePreset>, String> {
    let mut settings = get_settings(&app);
    let profiles = list_voice_profiles(&app)?;
    let removed_presets = settings.delete_tts_presets_for_missing_profiles(
        profiles.iter().map(|profile| profile.id.as_str()),
    );
    let removed_retired_presets =
        settings.delete_tts_presets_for_models(crate::tts::retired_tts_model_ids().iter().copied());
    if removed_presets > 0 || removed_retired_presets > 0 {
        write_settings(&app, settings.clone());
    }
    Ok(settings.tts_voice_presets)
}

#[tauri::command]
#[specta::specta]
pub fn create_tts_voice_preset(
    app: AppHandle,
    input: TtsVoicePresetInput,
) -> Result<TtsVoicePreset, String> {
    let mut settings = get_settings(&app);
    let preset = preset_from_input(input, None)?;
    settings.upsert_tts_preset(preset.clone());
    settings.set_active_tts_preset_id(Some(preset.id.clone()));
    settings.sync_legacy_tts_state_from_active_preset();
    write_settings(&app, settings);
    Ok(preset)
}

#[tauri::command]
#[specta::specta]
pub fn update_tts_voice_preset(
    app: AppHandle,
    preset_id: String,
    input: TtsVoicePresetInput,
) -> Result<TtsVoicePreset, String> {
    let mut settings = get_settings(&app);
    if settings.tts_preset(&preset_id).is_none() {
        return Err(format!("Unknown voice preset '{}'.", preset_id));
    }

    let preset = preset_from_input(input, Some(preset_id.clone()))?;
    settings.upsert_tts_preset(preset.clone());
    if settings.tts_active_preset_id.as_deref() == Some(preset_id.as_str()) {
        settings.sync_legacy_tts_state_from_active_preset();
    }
    write_settings(&app, settings);
    Ok(preset)
}

#[tauri::command]
#[specta::specta]
pub fn delete_tts_voice_preset(app: AppHandle, preset_id: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    if !settings.delete_tts_preset(&preset_id) {
        return Err(format!("Unknown voice preset '{}'.", preset_id));
    }
    settings.set_active_tts_preset_id(settings.tts_active_preset_id.clone());
    settings.sync_legacy_tts_state_from_active_preset();
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_active_tts_voice_preset(
    app: AppHandle,
    preset_id: String,
) -> Result<TtsVoicePreset, String> {
    let mut settings = get_settings(&app);
    let Some(preset) = settings.tts_preset(&preset_id).cloned() else {
        return Err(format!("Unknown voice preset '{}'.", preset_id));
    };
    settings.set_active_tts_preset_id(Some(preset_id));
    settings.sync_legacy_tts_state_from_active_preset();
    write_settings(&app, settings);
    Ok(preset)
}

#[tauri::command]
#[specta::specta]
pub fn list_tts_voice_profiles(app: AppHandle) -> Result<Vec<TtsVoiceProfileDescriptor>, String> {
    list_voice_profiles(&app)
}

#[tauri::command]
#[specta::specta]
pub fn create_tts_voice_profile(
    app: AppHandle,
    label: String,
    description: Option<String>,
    transcript: Option<String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    create_voice_profile(&app, label, description, transcript)
}

#[tauri::command]
#[specta::specta]
pub fn import_tts_voice_profile_sample(
    app: AppHandle,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    profile_id: String,
    source_path: String,
    transcript: Option<String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let descriptor = import_profile_reference_audio(&app, &profile_id, &source_path, transcript)?;
    let has_transcript = descriptor
        .transcript
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if has_transcript {
        return Ok(descriptor);
    }

    let manager = Arc::clone(&*transcription_manager);
    match maybe_backfill_profile_transcript(&app, &profile_id, |reference_audio_path| {
        manager.initiate_model_load();
        let audio_16k = read_wav_as_mono_16k(reference_audio_path)?;
        if audio_16k.is_empty() {
            return Ok(None);
        }
        let transcript = manager
            .transcribe(Arc::new(audio_16k))
            .map_err(|err| format!("Failed to auto-transcribe voice reference audio: {err}"))?;
        let trimmed = transcript.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        Ok(Some(trimmed.to_string()))
    }) {
        Ok(updated) => Ok(updated),
        Err(err) => {
            warn!(
                "Could not auto-transcribe reference audio for profile '{}': {}",
                profile_id, err
            );
            Ok(descriptor)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn delete_tts_voice_profile(app: AppHandle, profile_id: String) -> Result<(), String> {
    delete_voice_profile(&app, &profile_id)
}

#[tauri::command]
#[specta::specta]
pub fn set_active_improvement_profile(
    app: AppHandle,
    profile_id: String,
    enabled: bool,
) -> Result<TtsVoiceProfileDescriptor, String> {
    set_continuous_improvement(&app, &profile_id, enabled)
}

#[tauri::command]
#[specta::specta]
pub fn clear_profile_collected_data(
    app: AppHandle,
    profile_id: String,
) -> Result<TtsVoiceProfileDescriptor, String> {
    clear_collected_data(&app, &profile_id)
}

#[tauri::command]
#[specta::specta]
pub fn get_voice_profile_progress(
    app: AppHandle,
    profile_id: String,
) -> Result<TtsVoiceProfileDescriptor, String> {
    get_profile_progress(&app, &profile_id)
}

#[tauri::command]
#[specta::specta]
pub async fn convert_voice_sample(
    app: AppHandle,
    source_path: String,
    profile_id: String,
    tau: Option<f32>,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<VoiceChangerResult, String> {
    let source = PathBuf::from(source_path.trim());
    convert_voice_source(app, source, profile_id, tau, provider_id, model_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn convert_voice_recording(
    app: AppHandle,
    wav_bytes: Vec<u8>,
    profile_id: String,
    tau: Option<f32>,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<VoiceChangerResult, String> {
    if wav_bytes.is_empty() {
        return Err("No microphone audio was captured.".to_string());
    }

    let app_data_dir = crate::portable::app_data_dir(&app)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let source_dir = app_data_dir.join("voice-changer").join("sources");
    std::fs::create_dir_all(&source_dir)
        .map_err(|err| format!("Failed to create Voice Changer source directory: {err}"))?;
    let source = source_dir.join(format!(
        "voice-changer-source-{}-{}.wav",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        Uuid::new_v4()
    ));
    std::fs::write(&source, wav_bytes)
        .map_err(|err| format!("Failed to save microphone recording: {err}"))?;

    convert_voice_source(app, source, profile_id, tau, provider_id, model_id).await
}

fn resolve_voice_changer_model(
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<(String, String), String> {
    let requested_model_id = model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider_id = provider_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or({
            if matches!(
                requested_model_id,
                Some("chatterbox" | "chatterbox-turbo" | "chatterbox-multilingual")
            ) {
                "chatterbox"
            } else {
                "openvoice"
            }
        });
    let model_id = requested_model_id.unwrap_or(provider_id);

    let supported = matches!(
        (provider_id, model_id),
        ("openvoice", "openvoice")
            | ("chatterbox", "chatterbox")
            | ("chatterbox", "chatterbox-turbo")
            | ("chatterbox", "chatterbox-multilingual")
    );
    if !supported {
        return Err(format!(
            "{provider_id}/{model_id} does not support Voice Changer audio conversion."
        ));
    }

    Ok((provider_id.to_string(), model_id.to_string()))
}

async fn convert_voice_source(
    app: AppHandle,
    source: PathBuf,
    profile_id: String,
    tau: Option<f32>,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<VoiceChangerResult, String> {
    if !source.exists() {
        return Err(format!("Source audio file not found: {}", source.display()));
    }

    if source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("wav"))
        != Some(true)
    {
        return Err("Voice Changer currently accepts WAV source audio.".to_string());
    }

    let (provider_id, model_id) = resolve_voice_changer_model(provider_id, model_id)?;
    let profile = resolve_voice_profile(&app, &profile_id)?;
    let _model_use_guard = app
        .try_state::<Arc<TtsManager>>()
        .map(|manager| manager.track_model_use(Some(model_id.as_str())));
    let sidecar = app
        .try_state::<Arc<crate::sidecar::SidecarManager>>()
        .ok_or_else(|| "Speech runtime manager is not available.".to_string())?;
    let sidecar = Arc::clone(&*sidecar);
    let sidecar_for_start = Arc::clone(&sidecar);
    tokio::task::spawn_blocking(move || sidecar_for_start.ensure_speech_runtime())
        .await
        .map_err(|err| format!("Failed to start Speech runtime: {err}"))??;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|err| format!("Failed to create voice changer client: {err}"))?;
    let request_payload = serde_json::json!({
        "source_audio_path": source.to_string_lossy(),
        "provider_id": provider_id.clone(),
        "model": model_id.clone(),
        "profile_id": profile_id,
        "tau": tau.unwrap_or(0.3).clamp(0.0, 1.0),
    });
    let mut response = client
        .post("http://127.0.0.1:8008/v1/audio/voice-conversion")
        .json(&request_payload)
        .send()
        .await
        .map_err(|err| format!("Voice Changer request failed: {err}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        let sidecar_for_restart = Arc::clone(&sidecar);
        tokio::task::spawn_blocking(move || sidecar_for_restart.restart_speech_runtime())
            .await
            .map_err(|err| format!("Failed to restart Speech runtime: {err}"))??;
        response = client
            .post("http://127.0.0.1:8008/v1/audio/voice-conversion")
            .json(&request_payload)
            .send()
            .await
            .map_err(|err| format!("Voice Changer request failed after runtime restart: {err}"))?;
    }

    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .text()
            .await
            .unwrap_or_else(|_| "No error detail returned.".to_string());
        return Err(format!("Voice Changer failed ({status}): {detail}"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read converted voice audio: {err}"))?;
    if bytes.is_empty() {
        return Err("Voice Changer returned empty audio.".to_string());
    }

    let app_data_dir = crate::portable::app_data_dir(&app)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let output_dir = app_data_dir.join("voice-changer");
    std::fs::create_dir_all(&output_dir)
        .map_err(|err| format!("Failed to create Voice Changer output directory: {err}"))?;
    let output_path = output_dir.join(format!(
        "voice-changer-{}-{}.wav",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        Uuid::new_v4()
    ));
    std::fs::write(&output_path, bytes)
        .map_err(|err| format!("Failed to save converted voice audio: {err}"))?;

    Ok(VoiceChangerResult {
        source_path: source.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        target_profile_label: profile.label,
        provider_id,
        model_id,
    })
}
