use crate::audio_toolkit::{apply_custom_words, filter_transcription_output};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::continuous_cloning::ContinuousCloningManager;
use crate::managers::model::{model_is_available, EngineType, ModelInfo, ModelManager};
use crate::settings::{get_settings, AppSettings, ModelUnloadTimeout};
use anyhow::Result;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use transcribe_rs::{
    engines::{
        gigaam::GigaAMEngine,
        moonshine::{
            ModelVariant, MoonshineEngine, MoonshineModelParams, MoonshineStreamingEngine,
            StreamingModelParams,
        },
        parakeet::{
            ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
        },
        sense_voice::{
            Language as SenseVoiceLanguage, SenseVoiceEngine, SenseVoiceInferenceParams,
            SenseVoiceModelParams,
        },
        whisper::{WhisperEngine, WhisperInferenceParams},
    },
    TranscriptionEngine,
};

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

struct MlxAudioSttEngine {
    base_url: String,
    model_source: String,
}

#[derive(Debug, Deserialize)]
struct MlxAudioTranscriptionResponse {
    text: String,
}

enum LoadedEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetEngine),
    Moonshine(MoonshineEngine),
    MoonshineStreaming(MoonshineStreamingEngine),
    SenseVoice(SenseVoiceEngine),
    GigaAM(GigaAMEngine),
    MlxAudioStt(MlxAudioSttEngine),
}

#[derive(Clone, Debug)]
struct PartialProviderConfig {
    interval: Duration,
    min_samples: usize,
    min_growth: usize,
    max_samples: Option<usize>,
}

#[derive(Debug)]
struct PartialProviderSession {
    generation: u64,
    binding_id: String,
    cancel: Arc<AtomicBool>,
}

impl MlxAudioSttEngine {
    fn transcribe(
        &self,
        audio: Vec<f32>,
        sample_rate: u32,
    ) -> Result<transcribe_rs::TranscriptionResult> {
        let wav_bytes = self.encode_wav(audio, sample_rate)?;
        let file_part = reqwest::blocking::multipart::Part::bytes(wav_bytes)
            .file_name("vox-jot.wav")
            .mime_str("audio/wav")
            .map_err(|err| anyhow::anyhow!("Failed to prepare mlx-audio upload: {}", err))?;
        let form = reqwest::blocking::multipart::Form::new()
            .part("file", file_part)
            .text("model", self.model_source.clone());

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|err| anyhow::anyhow!("Failed to create mlx-audio client: {}", err))?;
        let response = client
            .post(format!(
                "{}/v1/audio/transcriptions",
                self.base_url.trim_end_matches('/')
            ))
            .multipart(form)
            .send()
            .map_err(|err| anyhow::anyhow!("mlx-audio transcription request failed: {}", err))?;

        let response = response
            .error_for_status()
            .map_err(|err| anyhow::anyhow!("mlx-audio transcription failed: {}", err))?;
        let payload = response
            .json::<MlxAudioTranscriptionResponse>()
            .map_err(|err| anyhow::anyhow!("Failed to decode mlx-audio response: {}", err))?;

        Ok(transcribe_rs::TranscriptionResult {
            text: payload.text,
            segments: None,
        })
    }

    fn encode_wav(&self, audio: Vec<f32>, sample_rate: u32) -> Result<Vec<u8>> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec)
                .map_err(|err| anyhow::anyhow!("Failed to create WAV encoder: {}", err))?;
            for sample in audio {
                let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
                writer
                    .write_sample(value)
                    .map_err(|err| anyhow::anyhow!("Failed to encode WAV sample: {}", err))?;
            }
            writer
                .finalize()
                .map_err(|err| anyhow::anyhow!("Failed to finalize WAV output: {}", err))?;
        }
        Ok(cursor.into_inner())
    }
}

fn mlx_audio_stt_model_ref(model_id: &str) -> Option<&'static str> {
    match model_id {
        "mlx-whisper-large-v3-turbo" => Some("mlx-community/whisper-large-v3-turbo-asr-fp16"),
        "mlx-distil-whisper-large-v3" => Some("distil-whisper/distil-large-v3"),
        "mlx-qwen3-asr" => Some("mlx-community/Qwen3-ASR-1.7B-8bit"),
        "mlx-parakeet-v3" => Some("mlx-community/parakeet-tdt-0.6b-v3"),
        "mlx-voxtral-mini-3b" => Some("mlx-community/Voxtral-Mini-3B-2507-bf16"),
        "mlx-voxtral-mini-4b-realtime" => Some("mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit"),
        _ => None,
    }
}

fn mlx_audio_base_url() -> String {
    "http://127.0.0.1:8008".to_string()
}

fn partial_provider_config_for_model(model_id: &str) -> PartialProviderConfig {
    let lower = model_id.to_ascii_lowercase();

    if lower.contains("moonshine") && lower.contains("stream") {
        return PartialProviderConfig {
            interval: Duration::from_millis(450),
            min_samples: 8_000,
            min_growth: 2_400,
            max_samples: Some(192_000),
        };
    }
    if lower.contains("moonshine") {
        return PartialProviderConfig {
            interval: Duration::from_millis(650),
            min_samples: 12_000,
            min_growth: 3_200,
            max_samples: Some(96_000),
        };
    }
    if lower.contains("whisper") {
        return PartialProviderConfig {
            interval: Duration::from_millis(1_200),
            min_samples: 20_000,
            min_growth: 6_400,
            max_samples: Some(128_000),
        };
    }
    if lower.contains("parakeet") {
        return PartialProviderConfig {
            interval: Duration::from_millis(900),
            min_samples: 16_000,
            min_growth: 4_800,
            max_samples: Some(112_000),
        };
    }

    PartialProviderConfig {
        interval: Duration::from_millis(900),
        min_samples: 16_000,
        min_growth: 4_800,
        max_samples: Some(96_000),
    }
}

fn trim_partial_audio(mut samples: Vec<f32>, max_samples: Option<usize>) -> Vec<f32> {
    let Some(max_samples) = max_samples else {
        return samples;
    };

    if samples.len() <= max_samples {
        return samples;
    }

    let start = samples.len().saturating_sub(max_samples);
    samples.drain(..start);
    samples
}

#[derive(Clone)]
pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<LoadedEngine>>>,
    transcribe_lock: Arc<Mutex<()>>,
    lifecycle_lock: Arc<Mutex<()>>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
    partial_session: Arc<Mutex<Option<PartialProviderSession>>>,
    partial_generation: Arc<AtomicU64>,
    processing_generation: Arc<AtomicU64>,
    canceled_processing_generation: Arc<AtomicU64>,
}

impl TranscriptionManager {
    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            transcribe_lock: Arc::new(Mutex::new(())),
            lifecycle_lock: Arc::new(Mutex::new(())),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
            )),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
            partial_session: Arc::new(Mutex::new(None)),
            partial_generation: Arc::new(AtomicU64::new(0)),
            processing_generation: Arc::new(AtomicU64::new(0)),
            canceled_processing_generation: Arc::new(AtomicU64::new(0)),
        };

        // Start the idle watcher
        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                while !shutdown_signal.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(10)); // Check every 10 seconds

                    // Check shutdown signal again after sleep
                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    let settings = get_settings(&app_handle_cloned);
                    let timeout_seconds = settings.model_unload_timeout.to_seconds();

                    if let Some(limit_seconds) = timeout_seconds {
                        // Skip polling-based unloading for immediate timeout since it's handled directly in transcribe()
                        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
                            continue;
                        }

                        let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                        let now_ms = SystemTime::now()
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;

                        if now_ms.saturating_sub(last) > limit_seconds * 1000 {
                            // idle -> unload
                            if manager_cloned.is_model_loaded() {
                                let unload_start = std::time::Instant::now();
                                debug!("Starting to unload model due to inactivity");

                                if let Ok(()) = manager_cloned.unload_model() {
                                    let _ = app_handle_cloned.emit(
                                        "model-state-changed",
                                        ModelStateEvent {
                                            event_type: "unloaded".to_string(),
                                            model_id: None,
                                            model_name: None,
                                            error: None,
                                        },
                                    );
                                    let unload_duration = unload_start.elapsed();
                                    debug!(
                                        "Model unloaded due to inactivity (took {}ms)",
                                        unload_duration.as_millis()
                                    );
                                }
                            }
                        }
                    }
                }
                debug!("Idle watcher thread shutting down gracefully");
            });
            *manager
                .watcher_handle
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        }

        Ok(manager)
    }

    /// Lock the engine mutex, recovering from poison if a previous transcription panicked.
    fn lock_engine(&self) -> MutexGuard<'_, Option<LoadedEngine>> {
        self.engine.lock().unwrap_or_else(|poisoned| {
            warn!("Engine mutex was poisoned by a previous panic, recovering");
            poisoned.into_inner()
        })
    }

    fn lock_lifecycle(&self) -> MutexGuard<'_, ()> {
        self.lifecycle_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn next_partial_generation(&self) -> u64 {
        self.partial_generation.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn partial_generation_is_current(&self, generation: u64) -> bool {
        self.partial_generation.load(Ordering::Relaxed) == generation
    }

    pub fn begin_processing_run(&self) -> u64 {
        self.processing_generation.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn cancel_active_processing(&self) {
        let active_generation = self.processing_generation.load(Ordering::Relaxed);
        self.canceled_processing_generation
            .store(active_generation, Ordering::Relaxed);
    }

    pub fn is_processing_cancelled(&self, generation: u64) -> bool {
        self.canceled_processing_generation.load(Ordering::Relaxed) >= generation
    }

    fn stop_partial_session_internal(&self) {
        if let Some(session) = self
            .partial_session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            debug!(
                "Stopping partial transcription session {} for binding {}",
                session.generation, session.binding_id
            );
            session.cancel.store(true, Ordering::Relaxed);
        }
        self.next_partial_generation();
    }

    fn create_loaded_engine(
        &self,
        model_id: &str,
        model_info: &ModelInfo,
        emit_state_events: bool,
    ) -> Result<LoadedEngine> {
        let emit_loading_failure = |error_msg: String| {
            if emit_state_events {
                let _ = self.app_handle.emit(
                    "model-state-changed",
                    ModelStateEvent {
                        event_type: "loading_failed".to_string(),
                        model_id: Some(model_id.to_string()),
                        model_name: Some(model_info.name.clone()),
                        error: Some(error_msg.clone()),
                    },
                );
            }
            anyhow::anyhow!(error_msg)
        };

        let loaded_engine = match model_info.engine_type {
            EngineType::Whisper => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let mut engine = WhisperEngine::new();
                engine.load_model(&model_path).map_err(|e| {
                    emit_loading_failure(format!(
                        "Failed to load whisper model {}: {}",
                        model_id, e
                    ))
                })?;
                LoadedEngine::Whisper(engine)
            }
            EngineType::Parakeet => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let mut engine = ParakeetEngine::new();
                engine
                    .load_model_with_params(&model_path, ParakeetModelParams::int8())
                    .map_err(|e| {
                        emit_loading_failure(format!(
                            "Failed to load parakeet model {}: {}",
                            model_id, e
                        ))
                    })?;
                LoadedEngine::Parakeet(engine)
            }
            EngineType::Moonshine => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let mut engine = MoonshineEngine::new();
                engine
                    .load_model_with_params(
                        &model_path,
                        MoonshineModelParams::variant(ModelVariant::Base),
                    )
                    .map_err(|e| {
                        emit_loading_failure(format!(
                            "Failed to load moonshine model {}: {}",
                            model_id, e
                        ))
                    })?;
                LoadedEngine::Moonshine(engine)
            }
            EngineType::MoonshineStreaming => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let mut engine = MoonshineStreamingEngine::new();
                engine
                    .load_model_with_params(&model_path, StreamingModelParams::default())
                    .map_err(|e| {
                        emit_loading_failure(format!(
                            "Failed to load moonshine streaming model {}: {}",
                            model_id, e
                        ))
                    })?;
                LoadedEngine::MoonshineStreaming(engine)
            }
            EngineType::SenseVoice => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let mut engine = SenseVoiceEngine::new();
                engine
                    .load_model_with_params(&model_path, SenseVoiceModelParams::int8())
                    .map_err(|e| {
                        emit_loading_failure(format!(
                            "Failed to load SenseVoice model {}: {}",
                            model_id, e
                        ))
                    })?;
                LoadedEngine::SenseVoice(engine)
            }
            EngineType::GigaAM => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let mut engine = GigaAMEngine::new();
                engine.load_model(&model_path).map_err(|e| {
                    emit_loading_failure(format!("Failed to load gigaam model {}: {}", model_id, e))
                })?;
                LoadedEngine::GigaAM(engine)
            }
            EngineType::QwenAudio => {
                return Err(anyhow::anyhow!(
                    "QwenAudio engine implementation is coming soon."
                ));
            }
            EngineType::MlxAudioStt => {
                let sidecar = self
                    .app_handle
                    .try_state::<Arc<crate::sidecar::SidecarManager>>()
                    .ok_or_else(|| anyhow::anyhow!("SidecarManager is not available."))?;
                sidecar
                    .ensure_running()
                    .map_err(|err| anyhow::anyhow!(err))?;
                let model_source = self
                    .model_manager
                    .get_model_path(model_id)
                    .map(|path| path.to_string_lossy().to_string())
                    .or_else(|_| {
                        mlx_audio_stt_model_ref(model_id)
                            .map(str::to_string)
                            .ok_or_else(|| {
                                anyhow::anyhow!("No mlx-audio model mapping found for {}", model_id)
                            })
                    })?;
                LoadedEngine::MlxAudioStt(MlxAudioSttEngine {
                    base_url: mlx_audio_base_url(),
                    model_source,
                })
            }
        };

        Ok(loaded_engine)
    }

    fn transcribe_with_loaded_engine(
        engine: &mut LoadedEngine,
        audio: Vec<f32>,
        settings: &AppSettings,
    ) -> Result<String> {
        let result = match engine {
            LoadedEngine::Whisper(whisper_engine) => {
                let whisper_language = if settings.selected_language == "auto" {
                    None
                } else {
                    let normalized = if settings.selected_language == "zh-Hans"
                        || settings.selected_language == "zh-Hant"
                    {
                        "zh".to_string()
                    } else {
                        settings.selected_language.clone()
                    };
                    Some(normalized)
                };

                let whisper_translate_to_english = settings.translation_output_mode
                    == crate::settings::TranslationOutputMode::Translated
                    && settings.translation_target_language == "en"
                    && matches!(
                        settings.translation_route_preference,
                        crate::settings::TranslationRoutePreference::Auto
                            | crate::settings::TranslationRoutePreference::WhisperEnglish
                    );

                let params = WhisperInferenceParams {
                    language: whisper_language,
                    translate: whisper_translate_to_english,
                    ..Default::default()
                };

                whisper_engine
                    .transcribe_samples(audio, Some(params))
                    .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))?
                    .text
            }
            LoadedEngine::Parakeet(parakeet_engine) => {
                let params = ParakeetInferenceParams {
                    timestamp_granularity: TimestampGranularity::Segment,
                    ..Default::default()
                };
                parakeet_engine
                    .transcribe_samples(audio, Some(params))
                    .map_err(|e| anyhow::anyhow!("Parakeet transcription failed: {}", e))?
                    .text
            }
            LoadedEngine::Moonshine(moonshine_engine) => {
                moonshine_engine
                    .transcribe_samples(audio, None)
                    .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e))?
                    .text
            }
            LoadedEngine::MoonshineStreaming(streaming_engine) => {
                streaming_engine
                    .transcribe_samples(audio, None)
                    .map_err(|e| {
                        anyhow::anyhow!("Moonshine streaming transcription failed: {}", e)
                    })?
                    .text
            }
            LoadedEngine::SenseVoice(sense_voice_engine) => {
                let language = match settings.selected_language.as_str() {
                    "zh" | "zh-Hans" | "zh-Hant" => SenseVoiceLanguage::Chinese,
                    "en" => SenseVoiceLanguage::English,
                    "ja" => SenseVoiceLanguage::Japanese,
                    "ko" => SenseVoiceLanguage::Korean,
                    "yue" => SenseVoiceLanguage::Cantonese,
                    _ => SenseVoiceLanguage::Auto,
                };
                let params = SenseVoiceInferenceParams {
                    language,
                    use_itn: true,
                };
                sense_voice_engine
                    .transcribe_samples(audio, Some(params))
                    .map_err(|e| anyhow::anyhow!("SenseVoice transcription failed: {}", e))?
                    .text
            }
            LoadedEngine::GigaAM(gigaam_engine) => {
                gigaam_engine
                    .transcribe_samples(audio, None)
                    .map_err(|e| anyhow::anyhow!("GigaAM transcription failed: {}", e))?
                    .text
            }
            LoadedEngine::MlxAudioStt(mlx_engine) => {
                mlx_engine
                    .transcribe(audio, 16_000)
                    .map_err(|e| anyhow::anyhow!("MLX transcription failed: {}", e))?
                    .text
            }
        };

        let corrected_result = if !settings.custom_words.is_empty() {
            apply_custom_words(
                &result,
                &settings.custom_words,
                settings.word_correction_threshold,
            )
        } else {
            result
        };

        let filter_language = match settings.selected_language.as_str() {
            "auto" => settings.app_language.as_str(),
            "zh-Hans" | "zh-Hant" => "zh",
            lang => lang,
        };

        Ok(filter_transcription_output(
            &corrected_result,
            filter_language,
            &settings.custom_filler_words,
        ))
    }

    fn transcribe_partial_snapshot(
        &self,
        engine: &mut LoadedEngine,
        audio: Vec<f32>,
        settings: &AppSettings,
    ) -> Result<String> {
        match catch_unwind(AssertUnwindSafe(|| {
            Self::transcribe_with_loaded_engine(engine, audio, settings)
        })) {
            Ok(result) => result,
            Err(panic_payload) => {
                let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };
                Err(anyhow::anyhow!(
                    "Partial transcription engine panicked: {}",
                    panic_msg
                ))
            }
        }
    }

    fn run_partial_provider(
        &self,
        generation: u64,
        binding_id: String,
        config: PartialProviderConfig,
        cancel: Arc<AtomicBool>,
        recording_manager: Arc<AudioRecordingManager>,
        model_id: String,
    ) {
        let Some(model_info) = self.model_manager.get_model_info(&model_id) else {
            debug!(
                "Skipping partial transcription for binding {} because model {} is unknown",
                binding_id, model_id
            );
            return;
        };

        if !model_is_available(&model_info) {
            debug!(
                "Skipping partial transcription for binding {} because model {} is not available",
                binding_id, model_id
            );
            return;
        }

        let mut engine = match self.create_loaded_engine(&model_id, &model_info, false) {
            Ok(engine) => engine,
            Err(err) => {
                warn!(
                    "Failed to start partial transcription provider for binding {}: {}",
                    binding_id, err
                );
                return;
            }
        };

        let mut last_snapshot_len = 0usize;
        let mut last_emitted = String::new();

        while !cancel.load(Ordering::Relaxed)
            && !self.shutdown_signal.load(Ordering::Relaxed)
            && self.partial_generation_is_current(generation)
        {
            thread::sleep(config.interval);

            if cancel.load(Ordering::Relaxed)
                || self.shutdown_signal.load(Ordering::Relaxed)
                || !self.partial_generation_is_current(generation)
            {
                break;
            }

            let Some(snapshot) = recording_manager.snapshot_recording() else {
                break;
            };
            let snapshot_len = snapshot.len();
            let growth = snapshot_len.saturating_sub(last_snapshot_len);
            if snapshot_len < config.min_samples || growth < config.min_growth {
                continue;
            }
            last_snapshot_len = snapshot_len;

            let settings = get_settings(&self.app_handle);
            let partial_audio = trim_partial_audio(snapshot, config.max_samples);
            let partial_text =
                match self.transcribe_partial_snapshot(&mut engine, partial_audio, &settings) {
                    Ok(text) => text,
                    Err(err) => {
                        warn!(
                            "Partial transcription failed for binding {}: {}",
                            binding_id, err
                        );
                        continue;
                    }
                };

            if !self.partial_generation_is_current(generation) {
                break;
            }

            let trimmed = partial_text.trim();
            if trimmed.is_empty() || trimmed == last_emitted {
                continue;
            }

            last_emitted = trimmed.to_string();
            crate::overlay::emit_partial_transcription(&self.app_handle, trimmed);
        }
    }

    pub fn is_model_loaded(&self) -> bool {
        let engine = self.lock_engine();
        engine.is_some()
    }

    pub fn start_partial_provider(
        &self,
        binding_id: &str,
        recording_manager: Arc<AudioRecordingManager>,
    ) {
        self.stop_partial_session_internal();

        let settings = get_settings(&self.app_handle);
        let model_id = settings.selected_model.trim().to_string();
        if model_id.is_empty() {
            return;
        }

        let generation = self.next_partial_generation();
        let cancel = Arc::new(AtomicBool::new(false));
        *self
            .partial_session
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(PartialProviderSession {
            generation,
            binding_id: binding_id.to_string(),
            cancel: Arc::clone(&cancel),
        });

        let config = partial_provider_config_for_model(&model_id);
        let manager = self.clone();
        let binding_id = binding_id.to_string();
        thread::spawn(move || {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            manager.run_partial_provider(
                generation,
                binding_id,
                config,
                cancel,
                recording_manager,
                model_id,
            );
        });
    }

    pub fn stop_partial_provider(&self) {
        self.stop_partial_session_internal();
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");
        self.stop_partial_session_internal();
        let _lifecycle_guard = self.lock_lifecycle();

        {
            let mut engine = self.lock_engine();
            if let Some(ref mut loaded_engine) = *engine {
                match loaded_engine {
                    LoadedEngine::Whisper(ref mut e) => e.unload_model(),
                    LoadedEngine::Parakeet(ref mut e) => e.unload_model(),
                    LoadedEngine::Moonshine(ref mut e) => e.unload_model(),
                    LoadedEngine::MoonshineStreaming(ref mut e) => e.unload_model(),
                    LoadedEngine::SenseVoice(ref mut e) => e.unload_model(),
                    LoadedEngine::GigaAM(ref mut e) => e.unload_model(),
                    LoadedEngine::MlxAudioStt(_) => {}
                }
            }
            *engine = None; // Drop the engine to free memory
        }
        {
            let mut current_model = self
                .current_model_id
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *current_model = None;
        }

        // Emit unloaded event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "unloaded".to_string(),
                model_id: None,
                model_name: None,
                error: None,
            },
        );

        let unload_duration = unload_start.elapsed();
        debug!(
            "Model unloaded manually (took {}ms)",
            unload_duration.as_millis()
        );
        Ok(())
    }

    /// Unloads the model immediately if the setting is enabled and the model is loaded
    pub fn maybe_unload_immediately(&self, context: &str) {
        let settings = get_settings(&self.app_handle);
        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately
            && self.is_model_loaded()
        {
            info!("Immediately unloading model after {}", context);
            if let Err(e) = self.unload_model() {
                warn!("Failed to immediately unload model: {}", e);
            }
        }
    }

    pub fn load_model(&self, model_id: &str) -> Result<()> {
        let load_start = std::time::Instant::now();
        debug!("Starting to load model: {}", model_id);

        // Emit loading started event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_started".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: None,
                error: None,
            },
        );

        let model_info = self
            .model_manager
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_is_available(&model_info) {
            let error_msg = "Model not downloaded";
            let _ = self.app_handle.emit(
                "model-state-changed",
                ModelStateEvent {
                    event_type: "loading_failed".to_string(),
                    model_id: Some(model_id.to_string()),
                    model_name: Some(model_info.name.clone()),
                    error: Some(error_msg.to_string()),
                },
            );
            return Err(anyhow::anyhow!(error_msg));
        }

        let _lifecycle_guard = self.lock_lifecycle();
        let loaded_engine = self.create_loaded_engine(model_id, &model_info, true)?;

        // Update the current engine and model ID
        {
            let mut engine = self.lock_engine();
            *engine = Some(loaded_engine);
        }
        {
            let mut current_model = self
                .current_model_id
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *current_model = Some(model_id.to_string());
        }

        // Emit loading completed event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_completed".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: Some(model_info.name.clone()),
                error: None,
            },
        );

        let load_duration = load_start.elapsed();
        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_duration.as_millis()
        );
        Ok(())
    }

    /// Kicks off the model loading in a background thread if it's not already loaded
    pub fn initiate_model_load(&self) {
        let mut is_loading = self.is_loading.lock().unwrap_or_else(|e| e.into_inner());
        if *is_loading || self.is_model_loaded() {
            return;
        }

        *is_loading = true;
        let self_clone = self.clone();
        thread::spawn(move || {
            let settings = get_settings(&self_clone.app_handle);
            if let Err(e) = self_clone.load_model(&settings.selected_model) {
                error!("Failed to load model: {}", e);
            }
            let mut is_loading = self_clone
                .is_loading
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *is_loading = false;
            self_clone.loading_condvar.notify_all();
        });
    }

    pub fn get_current_model(&self) -> Option<String> {
        let current_model = self
            .current_model_id
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        current_model.clone()
    }

    pub fn last_activity_ms(&self) -> u64 {
        self.last_activity.load(Ordering::Relaxed)
    }

    pub fn transcribe(&self, audio: Vec<f32>) -> Result<String> {
        // Live partials and the final stop-triggered transcription share one engine.
        // Serialize transcribe calls so a long-running partial cannot steal the engine
        // and cause the final full transcription to fail or return nothing.
        let _transcribe_guard = self
            .transcribe_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // Update last activity timestamp
        self.last_activity.store(
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            Ordering::Relaxed,
        );

        let st = std::time::Instant::now();

        debug!("Audio vector length: {}", audio.len());

        if audio.is_empty() {
            debug!("Empty audio vector");
            self.maybe_unload_immediately("empty audio");
            return Ok(String::new());
        }

        // Keep a copy of the audio for continuous voice cloning (before it's consumed by the engine)
        let audio_for_cloning = audio.clone();

        // Check if model is loaded, if not try to load it
        {
            // If the model is loading, wait for it to complete.
            let mut is_loading = self.is_loading.lock().unwrap_or_else(|e| e.into_inner());
            while *is_loading {
                is_loading = self
                    .loading_condvar
                    .wait(is_loading)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }

            let engine_guard = self.lock_engine();
            if engine_guard.is_none() {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        }

        // Get current settings for configuration
        let settings = get_settings(&self.app_handle);

        // Perform transcription with the appropriate engine.
        // We use catch_unwind to prevent engine panics from poisoning the mutex,
        // which would make the app hang indefinitely on subsequent operations.
        let result = {
            let _lifecycle_guard = self.lock_lifecycle();
            let mut engine_guard = self.lock_engine();

            // Take the engine out so we own it during transcription.
            // If the engine panics, we simply don't put it back (effectively unloading it)
            // instead of poisoning the mutex.
            let mut engine = match engine_guard.take() {
                Some(e) => e,
                None => {
                    return Err(anyhow::anyhow!(
                        "Model failed to load after auto-load attempt. Please check your model settings."
                    ));
                }
            };

            // Release the lock before transcribing — no mutex held during the engine call
            drop(engine_guard);

            let transcribe_result = catch_unwind(AssertUnwindSafe(|| {
                Self::transcribe_with_loaded_engine(&mut engine, audio, &settings)
            }));

            match transcribe_result {
                Ok(inner_result) => {
                    // Success or normal error — put the engine back
                    let mut engine_guard = self.lock_engine();
                    *engine_guard = Some(engine);
                    inner_result?
                }
                Err(panic_payload) => {
                    // Engine panicked — do NOT put it back (it's in an unknown state).
                    // The engine is dropped here, effectively unloading it.
                    let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    error!(
                        "Transcription engine panicked: {}. Model has been unloaded.",
                        panic_msg
                    );

                    // Clear the model ID so it will be reloaded on next attempt
                    {
                        let mut current_model = self
                            .current_model_id
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        *current_model = None;
                    }

                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "unloaded".to_string(),
                            model_id: None,
                            model_name: None,
                            error: Some(format!("Engine panicked: {}", panic_msg)),
                        },
                    );

                    return Err(anyhow::anyhow!(
                        "Transcription engine panicked: {}. The model has been unloaded and will reload on next attempt.",
                        panic_msg
                    ));
                }
            }
        };

        let et = std::time::Instant::now();
        let translation_note = if settings.translation_output_mode
            == crate::settings::TranslationOutputMode::Translated
            && settings.translation_target_language == "en"
            && matches!(
                settings.translation_route_preference,
                crate::settings::TranslationRoutePreference::Auto
                    | crate::settings::TranslationRoutePreference::WhisperEnglish
            ) {
            " (translated)"
        } else {
            ""
        };
        info!(
            "Transcription completed in {}ms{}",
            (et - st).as_millis(),
            translation_note
        );

        let final_result = result;

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            debug!(
                "Transcription produced {} chars after cleanup",
                final_result.len()
            );
        }

        self.maybe_unload_immediately("transcription");

        // Feed audio to continuous voice cloning (async, non-blocking)
        if !final_result.is_empty() {
            let app = self.app_handle.clone();
            let transcript_for_cloning = final_result.clone();
            thread::spawn(move || {
                use tauri::Manager;
                if let Some(cloning_manager) = app.try_state::<Arc<ContinuousCloningManager>>() {
                    cloning_manager.process_stt_result(audio_for_cloning, &transcript_for_cloning);
                }
            });
        }

        Ok(final_result)
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        // `TranscriptionManager` is `Clone` (shared `Arc` state), so every cloned
        // copy runs this Drop when it goes out of scope — including the clone
        // captured by the watcher thread itself. We must release the
        // `watcher_handle` mutex BEFORE joining, otherwise the watcher thread's
        // own Drop will block on that same mutex while we wait on `join()`.

        // Signal the watcher thread to shut down. Do this first so it can make
        // progress while we release locks.
        self.shutdown_signal.store(true, Ordering::Relaxed);

        self.stop_partial_session_internal();

        // Take the handle out of the mutex and drop the guard immediately.
        // Only the first clone to race here will observe `Some(handle)` and
        // perform the join; subsequent drops see `None` and return quickly.
        let watcher_handle = self
            .watcher_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();

        if let Some(handle) = watcher_handle {
            // Lock guard has been dropped above — the watcher thread can now
            // finish cleanly even though its own clone runs Drop on exit.
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            } else {
                debug!("Idle watcher thread joined successfully");
            }
        }
    }
}
