use crate::actions::{
    analyze_post_process_route, extract_spoken_submit_command, maybe_convert_chinese_variant,
    post_process_transcription, should_block_paste_candidate,
    should_fallback_to_plain_text_candidate,
};
use crate::audio_toolkit::{apply_custom_words, filter_transcription_output};
use crate::cli::CliArgs;
use crate::managers::apple_speech::{AppleSpeechEngine, AppleSpeechMode};
use crate::managers::model::EngineType;
use crate::post_processing::{apply_personal_dictionary, PostProcessResult};
use crate::settings::{get_default_settings, AppSettings};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;
use transcribe_rs::{
    onnx::{
        gigaam::GigaAMModel,
        moonshine::{MoonshineModel, MoonshineStreamingParams, MoonshineVariant, StreamingModel},
        parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity},
        sense_voice::{SenseVoiceModel, SenseVoiceParams},
        Quantization,
    },
    whisper_cpp::{WhisperEngine, WhisperInferenceParams},
    SpeechModel, TranscribeOptions,
};

const APP_DIR_NAME: &str = "com.iriedinamik.voxjot";
const DEFAULT_REPORT_PATH: &str = "test-data/audio-regression/reports/latest-report.json";

#[derive(Debug, Deserialize)]
struct SettingsEnvelope {
    settings: AppSettings,
}

#[derive(Debug, Deserialize, Serialize)]
struct RegressionManifest {
    metadata: RegressionManifestMetadata,
    entries: Vec<RegressionEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
struct RegressionManifestMetadata {
    dataset_id: String,
    dataset_url: String,
    license: String,
    generated_at: String,
    clip_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RegressionEntry {
    id: String,
    audio_path: String,
    expected_text: String,
    duration_secs: f32,
    source_relpath: String,
    speaker_id: String,
    chapter_id: String,
    utterance_id: String,
}

#[derive(Debug, Serialize)]
struct RegressionReport {
    generated_at: String,
    manifest_path: String,
    settings_path: String,
    model_id: String,
    model_path: String,
    post_process_enabled: bool,
    post_process_provider_id: String,
    post_process_model: String,
    summary: RegressionSummary,
    entries: Vec<RegressionEntryReport>,
}

#[derive(Debug, Default, Serialize)]
struct RegressionSummary {
    total_entries: usize,
    processed_entries: usize,
    failed_entries: usize,
    raw_exact_matches: usize,
    final_exact_matches: usize,
    raw_normalized_matches: usize,
    final_normalized_matches: usize,
    improved_entries: usize,
    worsened_entries: usize,
    unchanged_entries: usize,
    average_raw_wer: f32,
    average_final_wer: f32,
    stt_latency_ms_p50: u64,
    stt_latency_ms_p95: u64,
    stt_latency_ms_max: u64,
    stt_rtf_p50: f32,
    stt_rtf_p95: f32,
}

#[derive(Debug, Serialize)]
struct RegressionEntryReport {
    id: String,
    audio_path: String,
    duration_secs: f32,
    expected_text: String,
    raw_transcription: Option<String>,
    plain_text_fallback: Option<String>,
    dictionary_hits: Vec<String>,
    post_processed_text: Option<String>,
    final_paste_text: Option<String>,
    raw_wer: Option<f32>,
    final_wer: Option<f32>,
    raw_exact_match: bool,
    final_exact_match: bool,
    raw_normalized_match: bool,
    final_normalized_match: bool,
    post_process_route: Option<String>,
    paste_gate_fallback_applied: bool,
    stt_latency_ms: Option<u64>,
    stt_real_time_factor: Option<f32>,
    error: Option<String>,
}

struct ModelRuntime {
    engine_type: EngineType,
    model_path: PathBuf,
}

struct MlxAudioRegressionEngine {
    base_url: String,
    model_source: String,
}

#[derive(Debug, Deserialize)]
struct MlxAudioTranscriptionResponse {
    text: String,
}

enum RegressionEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
    Moonshine(MoonshineModel),
    MoonshineStreaming(StreamingModel),
    SenseVoice(SenseVoiceModel),
    GigaAM(GigaAMModel),
    MlxAudioStt(MlxAudioRegressionEngine),
    AppleSpeech(AppleSpeechEngine),
    AppleSpeechStreaming(AppleSpeechEngine),
}

impl MlxAudioRegressionEngine {
    fn new(model_source: String) -> Result<Self> {
        let engine = Self {
            base_url: std::env::var("VOX_JOT_MLX_AUDIO_BASE_URL")
                .ok()
                .map(|value| value.trim().trim_end_matches('/').to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "http://127.0.0.1:8018".to_string()),
            model_source,
        };
        engine.ensure_running()?;
        Ok(engine)
    }

    fn ensure_running(&self) -> Result<()> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_millis(750))
            .timeout(Duration::from_millis(750))
            .build()
            .context("Failed to create mlx-audio health client")?;
        let response = client
            .get(format!("{}/v1/models", self.base_url.trim_end_matches('/')))
            .send()
            .map_err(|err| {
                anyhow!(
                    "mlx-audio sidecar is not running at {}: {}. Start Vox Jot with the MLX speech backend, or run the benchmark script so it can start the managed sidecar.",
                    self.base_url,
                    err
                )
            })?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(anyhow!(
                "mlx-audio sidecar health check failed with HTTP {}",
                response.status()
            ))
        }
    }

    fn transcribe(&self, audio: Vec<f32>, sample_rate: u32) -> Result<String> {
        let wav_bytes = encode_wav(audio, sample_rate)?;
        let file_part = reqwest::blocking::multipart::Part::bytes(wav_bytes)
            .file_name("vox-jot-regression.wav")
            .mime_str("audio/wav")
            .context("Failed to prepare mlx-audio WAV upload")?;
        let form = reqwest::blocking::multipart::Form::new()
            .part("file", file_part)
            .text("model", self.model_source.clone());

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .context("Failed to create mlx-audio regression client")?;
        let response = client
            .post(format!(
                "{}/v1/audio/transcriptions",
                self.base_url.trim_end_matches('/')
            ))
            .multipart(form)
            .send()
            .map_err(|err| anyhow!("mlx-audio transcription request failed: {}", err))?
            .error_for_status()
            .map_err(|err| anyhow!("mlx-audio transcription failed: {}", err))?;
        let payload = response
            .json::<MlxAudioTranscriptionResponse>()
            .context("Failed to decode mlx-audio transcription response")?;

        Ok(payload.text)
    }
}

pub(crate) fn run_cli(cli_args: &CliArgs) -> Result<()> {
    let manifest_path = PathBuf::from(
        cli_args
            .regression_manifest
            .as_ref()
            .ok_or_else(|| anyhow!("Missing --regression-manifest"))?,
    );
    let settings_path = cli_args
        .regression_settings_file
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_settings_store_path);
    let output_path = cli_args
        .regression_output
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_REPORT_PATH));

    let settings = load_settings(&settings_path)?;
    let model_id = cli_args
        .regression_model_id
        .clone()
        .unwrap_or_else(|| settings.selected_model.clone());
    if model_id.trim().is_empty() {
        return Err(anyhow!(
            "No selected model found. Choose a model in Vox Jot or pass --regression-model-id."
        ));
    }

    let models_dir = settings_path
        .parent()
        .map(|parent| parent.join("models").join("stt"))
        .ok_or_else(|| anyhow!("Could not determine models directory from settings path"))?;
    let model_runtime = resolve_model_runtime(&models_dir, &model_id)?;
    let manifest = load_manifest(&manifest_path, cli_args.regression_limit)?;

    eprintln!(
        "Running regression on {} clips with model '{}'{}",
        manifest.entries.len(),
        model_id,
        if cli_args.regression_skip_post_process {
            " (post-process disabled)"
        } else {
            ""
        }
    );

    let mut engine = load_regression_engine(&model_runtime)?;
    let mut reports = Vec::with_capacity(manifest.entries.len());
    for (index, entry) in manifest.entries.iter().enumerate() {
        eprintln!("[{}/{}] {}", index + 1, manifest.entries.len(), entry.id);
        reports.push(run_entry(
            &settings,
            &mut engine,
            entry,
            cli_args.regression_skip_post_process,
        ));
    }

    let summary = summarize_reports(&reports);
    let report = RegressionReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        manifest_path: manifest_path.display().to_string(),
        settings_path: settings_path.display().to_string(),
        model_id,
        model_path: model_runtime.model_path.display().to_string(),
        post_process_enabled: settings.post_process_enabled
            && !cli_args.regression_skip_post_process,
        post_process_provider_id: settings.post_process_provider_id.clone(),
        post_process_model: settings
            .post_process_models
            .get(&settings.post_process_provider_id)
            .cloned()
            .unwrap_or_default(),
        summary,
        entries: reports,
    };

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create regression report directory '{}'",
                parent.display()
            )
        })?;
    }
    fs::write(&output_path, serde_json::to_vec_pretty(&report)?).with_context(|| {
        format!(
            "Failed to write regression report to '{}'",
            output_path.display()
        )
    })?;

    eprintln!(
        "Regression report written to {}",
        output_path.as_path().display()
    );
    eprintln!(
        "Summary: processed={}, failed={}, avg raw WER={:.3}, avg final WER={:.3}, improved={}",
        report.summary.processed_entries,
        report.summary.failed_entries,
        report.summary.average_raw_wer,
        report.summary.average_final_wer,
        report.summary.improved_entries
    );
    eprintln!(
        "STT latency: p50={}ms, p95={}ms, max={}ms | RTF p50={:.2}, p95={:.2}",
        report.summary.stt_latency_ms_p50,
        report.summary.stt_latency_ms_p95,
        report.summary.stt_latency_ms_max,
        report.summary.stt_rtf_p50,
        report.summary.stt_rtf_p95,
    );

    Ok(())
}

fn default_settings_store_path() -> PathBuf {
    default_app_data_dir().join("settings_store.json")
}

fn default_app_data_dir() -> PathBuf {
    if let Some(dir) = crate::portable::data_dir() {
        return dir.clone();
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        home.join("Library")
            .join("Application Support")
            .join(APP_DIR_NAME)
    }

    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_default();
        return base.join(APP_DIR_NAME);
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from) {
            return xdg.join(APP_DIR_NAME);
        }

        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        return home.join(".local").join("share").join(APP_DIR_NAME);
    }
}

fn load_settings(settings_path: &Path) -> Result<AppSettings> {
    if !settings_path.exists() {
        return Ok(get_default_settings());
    }

    let raw = fs::read_to_string(settings_path)
        .with_context(|| format!("Failed to read settings file '{}'", settings_path.display()))?;
    let parsed: SettingsEnvelope = serde_json::from_str(&raw).with_context(|| {
        format!(
            "Failed to parse settings file '{}'",
            settings_path.as_os_str().to_string_lossy()
        )
    })?;

    Ok(parsed.settings)
}

fn load_manifest(manifest_path: &Path, limit: Option<usize>) -> Result<RegressionManifest> {
    let raw = fs::read_to_string(manifest_path).with_context(|| {
        format!(
            "Failed to read regression manifest '{}'",
            manifest_path.display()
        )
    })?;
    let mut manifest: RegressionManifest = serde_json::from_str(&raw).with_context(|| {
        format!(
            "Failed to parse regression manifest '{}'",
            manifest_path.display()
        )
    })?;

    if let Some(limit) = limit {
        manifest.entries.truncate(limit);
    }

    Ok(manifest)
}

fn resolve_model_runtime(models_dir: &Path, model_id: &str) -> Result<ModelRuntime> {
    let (engine_type, filename, is_directory) = known_model_runtime(model_id).ok_or_else(|| {
        anyhow!(
            "Unsupported model '{}'. Add it to regression.rs or pass a model with a known runtime mapping.",
            model_id
        )
    })?;

    if matches!(
        engine_type,
        EngineType::AppleSpeech | EngineType::AppleSpeechStreaming
    ) {
        return Ok(ModelRuntime {
            engine_type,
            model_path: PathBuf::from(format!("app-runtime://{model_id}")),
        });
    }

    let candidate = models_dir.join(filename);
    if candidate.exists() {
        return Ok(ModelRuntime {
            engine_type,
            model_path: candidate,
        });
    }

    if matches!(engine_type, EngineType::Whisper) {
        let custom = models_dir.join(format!("{model_id}.bin"));
        if custom.exists() && custom.is_file() {
            return Ok(ModelRuntime {
                engine_type,
                model_path: custom,
            });
        }
    }

    let kind = if is_directory { "directory" } else { "file" };
    Err(anyhow!(
        "Model '{}' is selected but the expected {} '{}' does not exist",
        model_id,
        kind,
        candidate.display()
    ))
}

fn known_model_runtime(model_id: &str) -> Option<(EngineType, &'static str, bool)> {
    match model_id {
        "tiny" => Some((EngineType::Whisper, "ggml-tiny.bin", false)),
        "tiny.en" => Some((EngineType::Whisper, "ggml-tiny.en.bin", false)),
        "base" => Some((EngineType::Whisper, "ggml-base.bin", false)),
        "base.en" => Some((EngineType::Whisper, "ggml-base.en.bin", false)),
        "small" => Some((EngineType::Whisper, "ggml-small.bin", false)),
        "small.en" => Some((EngineType::Whisper, "ggml-small.en.bin", false)),
        "medium" => Some((EngineType::Whisper, "ggml-medium.bin", false)),
        "medium.en" => Some((EngineType::Whisper, "ggml-medium.en.bin", false)),
        "turbo" => Some((EngineType::Whisper, "ggml-large-v3-turbo.bin", false)),
        "large" | "large-v3-q5" => Some((EngineType::Whisper, "ggml-large-v3-q5_0.bin", false)),
        "breeze-asr" | "breeze-asr-q5" => Some((EngineType::Whisper, "breeze-asr-q5_k.bin", false)),
        "whisper-medium-q4_1" => Some((EngineType::Whisper, "whisper-medium-q4_1.bin", false)),
        "parakeet-tdt-0.6b-v2" => Some((EngineType::Parakeet, "parakeet-tdt-0.6b-v2-int8", true)),
        "parakeet-tdt-0.6b-v3" => Some((EngineType::Parakeet, "parakeet-tdt-0.6b-v3-int8", true)),
        "moonshine-base" => Some((EngineType::Moonshine, "moonshine-base", true)),
        "moonshine-tiny-streaming-en" => Some((
            EngineType::MoonshineStreaming,
            "moonshine-tiny-streaming-en",
            true,
        )),
        "moonshine-small-streaming-en" => Some((
            EngineType::MoonshineStreaming,
            "moonshine-small-streaming-en",
            true,
        )),
        "moonshine-medium-streaming-en" => Some((
            EngineType::MoonshineStreaming,
            "moonshine-medium-streaming-en",
            true,
        )),
        "sense-voice-int8" => Some((EngineType::SenseVoice, "sense-voice-int8", true)),
        "gigaam-v3-e2e-ctc" => Some((EngineType::GigaAM, "gigaam-v3-e2e-ctc", true)),
        "mlx-whisper-large-v3-turbo" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/whisper-large-v3-turbo-asr-fp16",
            true,
        )),
        "mlx-distil-whisper-large-v3" => Some((
            EngineType::MlxAudioStt,
            "MLX/distil-whisper/distil-large-v3",
            true,
        )),
        "mlx-qwen3-asr" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/Qwen3-ASR-1.7B-8bit",
            true,
        )),
        "mlx-qwen3-asr-0.6b" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/Qwen3-ASR-0.6B-8bit",
            true,
        )),
        "mlx-fireredasr2-aed" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/FireRedASR2-AED-mlx",
            true,
        )),
        "mlx-vibevoice-asr-bf16" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/VibeVoice-ASR-bf16",
            true,
        )),
        "mlx-parakeet-v3" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/parakeet-tdt-0.6b-v3",
            true,
        )),
        "mlx-voxtral-mini-3b" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/Voxtral-Mini-3B-2507-bf16",
            true,
        )),
        "mlx-voxtral-mini-4b-realtime" => Some((
            EngineType::MlxAudioStt,
            "MLX/mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
            true,
        )),
        "apple-speech-analyzer" => Some((
            EngineType::AppleSpeech,
            "app-runtime://apple-speech-analyzer",
            false,
        )),
        "apple-speech-progressive" => Some((
            EngineType::AppleSpeechStreaming,
            "app-runtime://apple-speech-progressive",
            false,
        )),
        _ => None,
    }
}

fn run_entry(
    settings: &AppSettings,
    engine: &mut RegressionEngine,
    entry: &RegressionEntry,
    skip_post_process: bool,
) -> RegressionEntryReport {
    match run_entry_inner(settings, engine, entry, skip_post_process) {
        Ok(report) => report,
        Err(err) => RegressionEntryReport {
            id: entry.id.clone(),
            audio_path: entry.audio_path.clone(),
            duration_secs: entry.duration_secs,
            expected_text: entry.expected_text.clone(),
            raw_transcription: None,
            plain_text_fallback: None,
            dictionary_hits: Vec::new(),
            post_processed_text: None,
            final_paste_text: None,
            raw_wer: None,
            final_wer: None,
            raw_exact_match: false,
            final_exact_match: false,
            raw_normalized_match: false,
            final_normalized_match: false,
            post_process_route: None,
            paste_gate_fallback_applied: false,
            stt_latency_ms: None,
            stt_real_time_factor: None,
            error: Some(err.to_string()),
        },
    }
}

fn run_entry_inner(
    settings: &AppSettings,
    engine: &mut RegressionEngine,
    entry: &RegressionEntry,
    skip_post_process: bool,
) -> Result<RegressionEntryReport> {
    let (mono, sample_rate) = read_wav_as_mono_f32(Path::new(&entry.audio_path))?;
    let audio_16k = resample_linear(&mono, sample_rate, 16_000);
    let stt_start = std::time::Instant::now();
    let raw_transcription = transcribe_audio(settings, engine, audio_16k)?;
    let stt_latency_ms = stt_start.elapsed().as_millis() as u64;
    let stt_real_time_factor = if entry.duration_secs > 0.0 {
        Some((stt_latency_ms as f32 / 1000.0) / entry.duration_secs)
    } else {
        None
    };

    let mut final_text = raw_transcription.clone();
    if let Some(converted) =
        tauri::async_runtime::block_on(maybe_convert_chinese_variant(settings, &final_text))
    {
        final_text = converted;
    }

    let dictionary_result = apply_personal_dictionary(&final_text, &settings.personal_dictionary);
    let safe_plain_text_fallback = dictionary_result.text.clone();
    final_text = dictionary_result.text;

    let route_debug = analyze_post_process_route(&final_text);

    let post_processed: Option<PostProcessResult> =
        if settings.post_process_enabled && !skip_post_process && !final_text.trim().is_empty() {
            tauri::async_runtime::block_on(post_process_transcription(
                settings,
                &final_text,
                None,
                None,
                None,
                None,
            ))
            .map(|result| result.result)
        } else {
            None
        };

    let mut final_paste_text = post_processed
        .as_ref()
        .map(|result| result.final_text.clone())
        .unwrap_or_else(|| final_text.clone());
    let (cleaned_text, _) = extract_spoken_submit_command(&final_paste_text);
    final_paste_text = cleaned_text;

    let mut paste_gate_fallback_applied = false;
    if should_block_paste_candidate(&final_paste_text)
        || should_fallback_to_plain_text_candidate(&final_paste_text, &safe_plain_text_fallback)
    {
        final_paste_text = safe_plain_text_fallback.clone();
        paste_gate_fallback_applied = true;
    }

    let raw_wer = word_error_rate(&entry.expected_text, &raw_transcription);
    let final_wer = word_error_rate(&entry.expected_text, &final_paste_text);

    Ok(RegressionEntryReport {
        id: entry.id.clone(),
        audio_path: entry.audio_path.clone(),
        duration_secs: entry.duration_secs,
        expected_text: entry.expected_text.clone(),
        raw_transcription: Some(raw_transcription.clone()),
        plain_text_fallback: Some(safe_plain_text_fallback),
        dictionary_hits: collect_dictionary_hits(&dictionary_result.hits, &post_processed),
        post_processed_text: post_processed
            .as_ref()
            .map(|result| result.final_text.clone()),
        final_paste_text: Some(final_paste_text.clone()),
        raw_wer: Some(raw_wer),
        final_wer: Some(final_wer),
        raw_exact_match: raw_transcription.trim() == entry.expected_text.trim(),
        final_exact_match: final_paste_text.trim() == entry.expected_text.trim(),
        raw_normalized_match: normalize_compare_text(&raw_transcription)
            == normalize_compare_text(&entry.expected_text),
        final_normalized_match: normalize_compare_text(&final_paste_text)
            == normalize_compare_text(&entry.expected_text),
        post_process_route: Some(route_debug.route),
        paste_gate_fallback_applied,
        stt_latency_ms: Some(stt_latency_ms),
        stt_real_time_factor,
        error: None,
    })
}

fn collect_dictionary_hits(
    base_hits: &[String],
    post_processed: &Option<PostProcessResult>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();

    for hit in base_hits.iter().chain(
        post_processed
            .iter()
            .flat_map(|result| result.dictionary_hits.iter()),
    ) {
        if seen.insert(hit.clone()) {
            ordered.push(hit.clone());
        }
    }

    ordered
}

fn load_regression_engine(model_runtime: &ModelRuntime) -> Result<RegressionEngine> {
    match model_runtime.engine_type {
        EngineType::Whisper => Ok(RegressionEngine::Whisper(
            WhisperEngine::load(&model_runtime.model_path)
                .map_err(|err| anyhow!("Failed to load Whisper model: {}", err))?,
        )),
        EngineType::Parakeet => Ok(RegressionEngine::Parakeet(
            ParakeetModel::load(&model_runtime.model_path, &Quantization::Int8)
                .map_err(|err| anyhow!("Failed to load Parakeet model: {}", err))?,
        )),
        EngineType::Moonshine => Ok(RegressionEngine::Moonshine(
            MoonshineModel::load(
                &model_runtime.model_path,
                MoonshineVariant::Base,
                &Quantization::FP32,
            )
            .map_err(|err| anyhow!("Failed to load Moonshine model: {}", err))?,
        )),
        EngineType::MoonshineStreaming => Ok(RegressionEngine::MoonshineStreaming(
            StreamingModel::load(&model_runtime.model_path, 1, &Quantization::FP32)
                .map_err(|err| anyhow!("Failed to load Moonshine streaming model: {}", err))?,
        )),
        EngineType::SenseVoice => Ok(RegressionEngine::SenseVoice(
            SenseVoiceModel::load(&model_runtime.model_path, &Quantization::Int8)
                .map_err(|err| anyhow!("Failed to load SenseVoice model: {}", err))?,
        )),
        EngineType::GigaAM => {
            normalize_gigaam_layout(&model_runtime.model_path)?;
            Ok(RegressionEngine::GigaAM(
                GigaAMModel::load(&model_runtime.model_path, &Quantization::Int8)
                    .map_err(|err| anyhow!("Failed to load GigaAM model: {}", err))?,
            ))
        }
        EngineType::MlxAudioStt => Ok(RegressionEngine::MlxAudioStt(
            MlxAudioRegressionEngine::new(model_runtime.model_path.display().to_string())?,
        )),
        EngineType::AppleSpeech => Ok(RegressionEngine::AppleSpeech(AppleSpeechEngine::new(
            AppleSpeechMode::Offline,
        )?)),
        EngineType::AppleSpeechStreaming => Ok(RegressionEngine::AppleSpeechStreaming(
            AppleSpeechEngine::new(AppleSpeechMode::Progressive)?,
        )),
    }
}

fn normalize_gigaam_layout(model_path: &Path) -> Result<()> {
    let expected = model_path.join("model.onnx");
    let mirrored = model_path.join("v3_e2e_ctc.int8.onnx");
    if !expected.exists() && mirrored.exists() {
        fs::hard_link(&mirrored, &expected)
            .or_else(|_| fs::copy(&mirrored, &expected).map(|_| ()))
            .with_context(|| {
                format!(
                    "Failed to create GigaAM model alias '{}'",
                    expected.display()
                )
            })?;
    }

    let vocab = model_path.join("vocab.txt");
    if !vocab.exists() {
        let mirrored_vocab = model_path.join("v3_e2e_ctc_vocab.txt");
        if mirrored_vocab.exists() {
            fs::copy(&mirrored_vocab, &vocab).with_context(|| {
                format!("Failed to create GigaAM vocab alias '{}'", vocab.display())
            })?;
        }
    }

    Ok(())
}

fn transcribe_audio(
    settings: &AppSettings,
    engine: &mut RegressionEngine,
    audio: Vec<f32>,
) -> Result<String> {
    let mut result_text = match engine {
        RegressionEngine::Whisper(engine) => {
            let result = engine
                .transcribe_with(
                    &audio,
                    &WhisperInferenceParams {
                        language: (settings.selected_language != "auto")
                            .then(|| settings.selected_language.clone()),
                        translate: settings.translate_to_english,
                        ..Default::default()
                    },
                )
                .map_err(|err| anyhow!("Whisper transcription failed: {}", err))?;
            result.text
        }
        RegressionEngine::Parakeet(engine) => {
            let result = engine
                .transcribe_with(
                    &audio,
                    &ParakeetParams {
                        timestamp_granularity: Some(TimestampGranularity::Segment),
                        ..Default::default()
                    },
                )
                .map_err(|err| anyhow!("Parakeet transcription failed: {}", err))?;
            result.text
        }
        RegressionEngine::Moonshine(engine) => {
            let result = engine
                .transcribe(&audio, &TranscribeOptions::default())
                .map_err(|err| anyhow!("Moonshine transcription failed: {}", err))?;
            result.text
        }
        RegressionEngine::MoonshineStreaming(engine) => {
            let result = engine
                .transcribe_with(&audio, &MoonshineStreamingParams::default())
                .map_err(|err| anyhow!("Moonshine streaming transcription failed: {}", err))?;
            result.text
        }
        RegressionEngine::SenseVoice(engine) => {
            let language = match settings.selected_language.as_str() {
                "zh" | "zh-Hans" | "zh-Hant" => Some("zh".to_string()),
                "en" | "ja" | "ko" | "yue" => Some(settings.selected_language.clone()),
                _ => None,
            };
            let result = engine
                .transcribe_with(
                    &audio,
                    &SenseVoiceParams {
                        language,
                        use_itn: Some(true),
                    },
                )
                .map_err(|err| anyhow!("SenseVoice transcription failed: {}", err))?;
            result.text
        }
        RegressionEngine::GigaAM(engine) => {
            let result = engine
                .transcribe(&audio, &TranscribeOptions::default())
                .map_err(|err| anyhow!("GigaAM transcription failed: {}", err))?;
            result.text
        }
        RegressionEngine::MlxAudioStt(engine) => engine.transcribe(audio, 16_000)?,
        RegressionEngine::AppleSpeech(engine) | RegressionEngine::AppleSpeechStreaming(engine) => {
            let language = if settings.selected_language == "auto" {
                None
            } else {
                Some(settings.selected_language.as_str())
            };
            let (text, _) = engine
                .transcribe(&audio, 16_000, language)
                .map_err(|err| anyhow!("Apple Speech transcription failed: {}", err))?;
            text
        }
    };

    if !settings.custom_words.is_empty() {
        result_text = apply_custom_words(
            &result_text,
            &settings.custom_words,
            settings.word_correction_threshold,
        );
    }

    let filter_language = match settings.selected_language.as_str() {
        "auto" => "auto",
        "zh-Hans" | "zh-Hant" => "zh",
        lang => lang,
    };

    Ok(filter_transcription_output(
        &result_text,
        filter_language,
        &settings.custom_filler_words,
    ))
}

fn read_wav_as_mono_f32(path: &Path) -> Result<(Vec<f32>, u32)> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| anyhow!("Failed to open WAV file '{}': {}", path.display(), e))?;
    let spec = reader.spec();

    if spec.channels == 0 {
        return Err(anyhow!("WAV file has no channels: {}", path.display()));
    }

    let mut mono = Vec::new();
    match spec.sample_format {
        hound::SampleFormat::Float => {
            let all: Vec<f32> = reader
                .samples::<f32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| anyhow!("Failed reading WAV float samples: {}", e))?;

            for frame in all.chunks(spec.channels as usize) {
                let sum: f32 = frame.iter().copied().sum();
                mono.push(sum / frame.len() as f32);
            }
        }
        hound::SampleFormat::Int => {
            let all: Vec<i32> = reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| anyhow!("Failed reading WAV int samples: {}", e))?;

            let scale = 2f32.powi((spec.bits_per_sample as i32) - 1);
            for frame in all.chunks(spec.channels as usize) {
                let sum: f32 = frame.iter().map(|sample| (*sample as f32) / scale).sum();
                mono.push(sum / frame.len() as f32);
            }
        }
    }

    Ok((mono, spec.sample_rate))
}

fn encode_wav(audio: Vec<f32>, sample_rate: u32) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|err| anyhow!("Failed to create regression WAV encoder: {}", err))?;
        for sample in audio {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            writer
                .write_sample(value)
                .map_err(|err| anyhow!("Failed to encode regression WAV sample: {}", err))?;
        }
        writer
            .finalize()
            .map_err(|err| anyhow!("Failed to finalize regression WAV output: {}", err))?;
    }
    Ok(cursor.into_inner())
}

fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let ratio = target_rate as f64 / source_rate as f64;
    let output_len = ((samples.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = (i as f64) / ratio;
        let left = (src_pos.floor() as usize).min(samples.len().saturating_sub(1));
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let frac = (src_pos - left as f64) as f32;
        let value = if left == right {
            samples[left]
        } else {
            samples[left] * (1.0 - frac) + samples[right] * frac
        };
        output.push(value);
    }

    output
}

fn summarize_reports(reports: &[RegressionEntryReport]) -> RegressionSummary {
    let mut summary = RegressionSummary {
        total_entries: reports.len(),
        ..Default::default()
    };
    let mut raw_wer_total = 0.0f32;
    let mut final_wer_total = 0.0f32;
    let mut latencies_ms: Vec<u64> = Vec::with_capacity(reports.len());
    let mut rtfs: Vec<f32> = Vec::with_capacity(reports.len());

    for report in reports {
        if report.error.is_some() {
            summary.failed_entries += 1;
            continue;
        }

        summary.processed_entries += 1;
        if report.raw_exact_match {
            summary.raw_exact_matches += 1;
        }
        if report.final_exact_match {
            summary.final_exact_matches += 1;
        }
        if report.raw_normalized_match {
            summary.raw_normalized_matches += 1;
        }
        if report.final_normalized_match {
            summary.final_normalized_matches += 1;
        }

        if let (Some(raw_wer), Some(final_wer)) = (report.raw_wer, report.final_wer) {
            raw_wer_total += raw_wer;
            final_wer_total += final_wer;
            if final_wer + 0.0001 < raw_wer {
                summary.improved_entries += 1;
            } else if final_wer > raw_wer + 0.0001 {
                summary.worsened_entries += 1;
            } else {
                summary.unchanged_entries += 1;
            }
        }

        if let Some(ms) = report.stt_latency_ms {
            latencies_ms.push(ms);
        }
        if let Some(rtf) = report.stt_real_time_factor {
            rtfs.push(rtf);
        }
    }

    if summary.processed_entries > 0 {
        let denom = summary.processed_entries as f32;
        summary.average_raw_wer = raw_wer_total / denom;
        summary.average_final_wer = final_wer_total / denom;
    }

    if !latencies_ms.is_empty() {
        latencies_ms.sort_unstable();
        summary.stt_latency_ms_p50 = percentile_u64(&latencies_ms, 0.50);
        summary.stt_latency_ms_p95 = percentile_u64(&latencies_ms, 0.95);
        summary.stt_latency_ms_max = *latencies_ms.last().unwrap();
    }
    if !rtfs.is_empty() {
        rtfs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        summary.stt_rtf_p50 = percentile_f32(&rtfs, 0.50);
        summary.stt_rtf_p95 = percentile_f32(&rtfs, 0.95);
    }

    summary
}

fn percentile_u64(sorted: &[u64], q: f32) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f32 - 1.0) * q).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn percentile_f32(sorted: &[f32], q: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f32 - 1.0) * q).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn word_error_rate(expected: &str, actual: &str) -> f32 {
    let expected_tokens = tokenize_for_compare(expected);
    let actual_tokens = tokenize_for_compare(actual);

    if expected_tokens.is_empty() {
        return if actual_tokens.is_empty() { 0.0 } else { 1.0 };
    }

    let distance = levenshtein(&expected_tokens, &actual_tokens);
    distance as f32 / expected_tokens.len() as f32
}

fn normalize_compare_text(text: &str) -> String {
    tokenize_for_compare(text).join(" ")
}

fn tokenize_for_compare(text: &str) -> Vec<String> {
    let mut normalized = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '\'' {
            normalized.extend(ch.to_lowercase());
        } else {
            normalized.push(' ');
        }
    }

    normalized
        .split_whitespace()
        .map(|token| token.to_string())
        .collect()
}

fn levenshtein(left: &[String], right: &[String]) -> usize {
    let mut prev: Vec<usize> = (0..=right.len()).collect();
    let mut curr = vec![0usize; right.len() + 1];

    for (i, l) in left.iter().enumerate() {
        curr[0] = i + 1;
        for (j, r) in right.iter().enumerate() {
            let cost = usize::from(l != r);
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        prev.clone_from(&curr);
    }

    prev[right.len()]
}

#[cfg(test)]
mod tests {
    use super::{normalize_compare_text, word_error_rate};

    #[test]
    fn normalization_ignores_case_and_punctuation() {
        assert_eq!(
            normalize_compare_text("Hello, Vox Jot!"),
            normalize_compare_text("hello vox jot")
        );
    }

    #[test]
    fn normalization_ignores_unicode_case() {
        assert_eq!(
            normalize_compare_text("Сегодня утром"),
            normalize_compare_text("сегодня утром")
        );
    }

    #[test]
    fn word_error_rate_is_zero_for_identical_text() {
        assert_eq!(
            word_error_rate("power rangers time", "power rangers time"),
            0.0
        );
    }
}
