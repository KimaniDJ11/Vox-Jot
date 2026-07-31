use crate::commands::tts::preset_from_input;
use crate::settings::{
    get_settings, write_settings, AppSettings, TtsVoicePreset, TtsVoicePresetInput,
};
use crate::tts::{SpeakRequest, TtsManager};
use hound::{WavSpec, WavWriter};
use log::warn;
use once_cell::sync::Lazy;
use regex::Regex;
use rodio::Source;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const STORY_SAMPLE_RATE: u32 = 24_000;
const STORY_PEAK_TARGET: f32 = 0.95;
const STORY_WAVEFORM_PEAKS: usize = 96;
const STORY_SOUND_OVERLAY_GAIN: f32 = 0.55;
const STABLE_AUDIO3_SOURCE_URL: &str = "https://github.com/Stability-AI/stable-audio-3";
const CREATIVE_AUDIO_RUNTIME_HF_REPO_ID: &str = "IrieDinamik/vox-jot-creative-audio-runtime";
const STABLE_AUDIO3_RUNTIME_ARCHIVE: &str = "stable-audio-3-mlx-macos-aarch64.tar.gz";
const STABLE_AUDIO3_RUNTIME_CHECKSUM: &str = "stable-audio-3-mlx-macos-aarch64.tar.gz.sha256";
const STABLE_AUDIO3_MODEL_SFX_ID: &str = "stable-audio-3-small-sfx";
const STABLE_AUDIO3_MODEL_MUSIC_ID: &str = "stable-audio-3-small-music";
const HF_CREATIVE_RUNTIME_ID: &str = "hf-text-to-audio";
const HF_CREATIVE_RUNTIME_SCRIPT: &str = "hf_text_to_audio_generate.py";
const MUSICGEN_SMALL_MODEL_ID: &str = "musicgen-small";
const AUDIOLDM2_MODEL_ID: &str = "audioldm2";
const AUDIOLDM2_MUSIC_MODEL_ID: &str = "audioldm2-music";
const ACE_STEP_15_MUSIC_ID: &str = "ace-step-1-5-music";
const ACE_STEP_15_HF_REPO_ID: &str = "ACE-Step/Ace-Step1.5";
const ACE_STEP_RUNTIME_ARCHIVE: &str = "ace-step-runtime-macos-aarch64.tar.gz";
const ACE_STEP_RUNTIME_CHECKSUM: &str = "ace-step-runtime-macos-aarch64.tar.gz.sha256";
const DIFFRHYTHM_MODEL_ID: &str = "diffrhythm-full-song";
const DIFFRHYTHM_HF_REPO_ID: &str = "ASLP-lab/DiffRhythm-1_2-full";
const DIFFRHYTHM_RUNTIME_ARCHIVE: &str = "diffrhythm-runtime-macos-aarch64.tar.gz";
const DIFFRHYTHM_RUNTIME_CHECKSUM: &str = "diffrhythm-runtime-macos-aarch64.tar.gz.sha256";
const YUE_MODEL_ID: &str = "yue-full-song";
const YUE_STAGE1_HF_REPO_ID: &str = "m-a-p/YuE-s1-7B-anneal-en-cot";
const YUE_STAGE2_HF_REPO_ID: &str = "m-a-p/YuE-s2-1B-general";
const YUE_RUNTIME_ARCHIVE: &str = "yue-runtime-macos-aarch64.tar.gz";
const YUE_RUNTIME_CHECKSUM: &str = "yue-runtime-macos-aarch64.tar.gz.sha256";
const FIGARO_MODEL_ID: &str = "figaro-symbolic";
const FIGARO_HF_REPO_ID: &str = "IrieDinamik/figaro-symbolic-checkpoints";
const FIGARO_RUNTIME_ARCHIVE: &str = "figaro-runtime-macos-aarch64.tar.gz";
const FIGARO_RUNTIME_CHECKSUM: &str = "figaro-runtime-macos-aarch64.tar.gz.sha256";
static STORY_SOUND_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\[sound\s+([^\]\n]{1,512})\]"#).unwrap());
static STORY_SOUND_TAG_ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"([A-Za-z_][A-Za-z0-9_-]*)="([^"]*)""#).unwrap());

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryCastMember {
    pub character_name: String,
    pub preset_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryScriptLine {
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Clone)]
struct StoryRenderScriptLine {
    speaker: Option<String>,
    parts: Vec<StoryScriptPart>,
}

#[derive(Debug, Clone)]
enum StoryScriptPart {
    Text(String),
    Sound(StoryParsedSoundCue),
}

#[derive(Debug, Clone)]
struct StoryParsedSoundCue {
    sound_id: String,
    title: String,
    mode: StorySoundCueMode,
}

#[derive(Debug, Clone)]
struct ResolvedStorySoundCue {
    sound_id: String,
    title: String,
    mode: StorySoundCueMode,
    path: PathBuf,
}

#[derive(Debug, Clone)]
enum StoryTimelineEvent {
    Audio {
        files: Vec<PathBuf>,
        clip_index: Option<usize>,
        cue: Option<ResolvedStorySoundCue>,
        advances_cursor: bool,
    },
    Pause(u32),
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryRenderRequest {
    pub render_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub title: String,
    pub cast: Vec<StoryCastMember>,
    pub script_text: String,
    pub pause_ms_between_lines: u32,
    #[serde(default)]
    pub line_instructions: Vec<StoryLineInstructionOverride>,
    #[serde(default)]
    pub audio_effect: StoryAudioEffectPreset,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateSpeechAudioRequest {
    pub render_id: String,
    pub title: String,
    pub text: String,
    pub preset: TtsVoicePresetInput,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum StorySoundMode {
    #[default]
    Sfx,
    Ambience,
    Music,
    Song,
    Composition,
}

impl StorySoundMode {
    fn label(self) -> &'static str {
        match self {
            Self::Sfx => "SFX",
            Self::Ambience => "Ambience",
            Self::Music => "Music",
            Self::Song => "Song",
            Self::Composition => "Composition",
        }
    }

    fn stable_audio3_dit(self) -> Result<&'static str, String> {
        match self {
            Self::Sfx | Self::Ambience => Ok("sm-sfx"),
            Self::Music => Ok("sm-music"),
            Self::Song | Self::Composition => {
                Err("Stable Audio 3 does not support this Studio mode.".to_string())
            }
        }
    }

    fn stable_audio3_decoder(self) -> Result<&'static str, String> {
        match self {
            Self::Sfx | Self::Ambience | Self::Music => Ok("same-s"),
            Self::Song | Self::Composition => {
                Err("Stable Audio 3 does not support this Studio mode.".to_string())
            }
        }
    }

    fn max_seconds(self) -> u32 {
        match self {
            Self::Sfx => 15,
            Self::Ambience | Self::Music => 60,
            Self::Song | Self::Composition => 600,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CreativeAudioModelSourceKind {
    OfficialSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CreativeAudioAvailability {
    Ready,
    Downloadable,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreativeAudioModelDescriptor {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub provider_id: String,
    pub description: String,
    pub source_kind: CreativeAudioModelSourceKind,
    pub source_url: String,
    pub license_label: String,
    pub runtime_label: String,
    pub size_hint_label: String,
    pub installed: bool,
    pub runnable: bool,
    pub selected: bool,
    pub active: bool,
    pub downloadable: bool,
    pub recommended: bool,
    pub status_label: String,
    pub availability: CreativeAudioAvailability,
    pub experimental: bool,
    pub unavailable_reason: Option<String>,
    pub modes: Vec<StorySoundMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreativeAudioModelCatalog {
    pub install_root: String,
    pub models: Vec<CreativeAudioModelDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreativeAudioDownloadProgress {
    pub model_id: String,
    pub phase: String,
    pub percentage: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StableAudio3Status {
    pub installed: bool,
    pub sfx_ready: bool,
    pub ambience_ready: bool,
    pub music_ready: bool,
    pub runtime_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PrepareStableAudio3Request {
    pub mode: StorySoundMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GenerateStorySoundRequest {
    pub render_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub model_id: String,
    pub mode: StorySoundMode,
    pub duration_seconds: u32,
    pub seed: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryLineInstructionOverride {
    pub line_number: u32,
    pub style_instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryRenderProgress {
    pub render_id: String,
    pub current_line: u32,
    pub total_lines: u32,
    pub speaker: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryRenderResult {
    pub render_id: String,
    pub output_path: String,
    pub duration_ms: u32,
    pub line_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryRenderEnqueueResult {
    pub render_id: String,
    pub queue_position: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProcessStoryAudioRequest {
    pub id: String,
    pub playback_rate: f32,
    pub sample_rate_hz: u32,
    #[serde(default)]
    pub audio_effect: StoryAudioEffectPreset,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum StoryAudioEffectPreset {
    #[default]
    Clean,
    VoicePolish,
    Radio,
    WarmRoom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum StoryAudioKind {
    #[default]
    StoryRender,
    Sound,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum StorySoundCueMode {
    #[default]
    Insert,
    Overlay,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StorySoundCueMetadata {
    pub sound_id: String,
    pub title: String,
    pub mode: StorySoundCueMode,
    pub output_path: String,
    pub offset_ms: u32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryClipMetadata {
    pub id: String,
    pub line_number: u32,
    pub speaker: String,
    pub text: String,
    pub hash: String,
    pub file_path: String,
    pub duration_ms: u32,
    pub offset_ms: u32,
    pub waveform_peaks: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryProjectMetadata {
    pub project_id: String,
    pub render_id: String,
    pub title: String,
    pub output_path: String,
    pub pause_ms_between_lines: u32,
    pub audio_effect: StoryAudioEffectPreset,
    pub sample_rate_hz: u32,
    pub clips: Vec<StoryClipMetadata>,
    #[serde(default)]
    pub sound_cues: Vec<StorySoundCueMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryRenderJobSummary {
    pub render_id: String,
    pub title: String,
    pub status: String,
    pub created_at_ms: i64,
    pub queued_at_ms: i64,
    pub started_at_ms: Option<i64>,
    pub current_line: u32,
    pub total_lines: u32,
    pub speaker: Option<String>,
    pub error: Option<String>,
    pub queue_position: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryAudioItem {
    pub id: String,
    #[serde(default)]
    pub kind: StoryAudioKind,
    #[serde(default)]
    pub project_id: Option<String>,
    pub title: String,
    pub script_text: String,
    #[serde(default)]
    pub line_instructions: Vec<StoryLineInstructionOverride>,
    pub output_path: String,
    #[serde(default)]
    pub clips_path: Option<String>,
    pub created_at_ms: i64,
    pub duration_ms: u32,
    pub line_count: u32,
    #[serde(default)]
    pub cast_count: u32,
    #[serde(default)]
    pub generation_time_ms: u32,
    #[serde(default = "default_story_sample_rate")]
    pub sample_rate_hz: u32,
    #[serde(default)]
    pub expression_tags_used: bool,
    #[serde(default)]
    pub inline_prompt_used: bool,
    #[serde(default)]
    pub audio_effect: StoryAudioEffectPreset,
    #[serde(default)]
    pub sound_mode: Option<StorySoundMode>,
    #[serde(default)]
    pub source_model_id: Option<String>,
    pub starred: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum StoryRenderJobStatus {
    Queued,
    Rendering,
    Assembling,
    Completed,
    Failed,
    Cancelled,
}

impl StoryRenderJobStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Rendering => "rendering",
            Self::Assembling => "assembling",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    fn is_active(&self) -> bool {
        matches!(self, Self::Queued | Self::Rendering | Self::Assembling)
    }
}

#[derive(Clone)]
struct StoryRenderJob {
    request: StoryRenderRequest,
    stop_flag: Arc<AtomicBool>,
    status: StoryRenderJobStatus,
    created_at_ms: i64,
    queued_at_ms: i64,
    started_at_ms: Option<i64>,
    current_line: u32,
    total_lines: u32,
    speaker: Option<String>,
    error: Option<String>,
}

impl StoryRenderJob {
    fn summary(&self, queue_position: Option<u32>) -> StoryRenderJobSummary {
        StoryRenderJobSummary {
            render_id: self.request.render_id.clone(),
            title: story_title_label(&self.request.title),
            status: self.status.as_str().to_string(),
            created_at_ms: self.created_at_ms,
            queued_at_ms: self.queued_at_ms,
            started_at_ms: self.started_at_ms,
            current_line: self.current_line,
            total_lines: self.total_lines,
            speaker: self.speaker.clone(),
            error: self.error.clone(),
            queue_position,
        }
    }
}

#[derive(Default)]
struct StoryRenderQueueState {
    jobs: VecDeque<StoryRenderJob>,
    worker_running: bool,
}

static STORY_RENDER_QUEUE: Lazy<Mutex<StoryRenderQueueState>> =
    Lazy::new(|| Mutex::new(StoryRenderQueueState::default()));
static ACTIVE_STORY_PLAYBACK: Lazy<Mutex<Option<Arc<AtomicBool>>>> = Lazy::new(|| Mutex::new(None));
static ACTIVE_STORY_SOUND_GENERATIONS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static ACTIVE_CREATIVE_AUDIO_DOWNLOADS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static CREATIVE_AUDIO_INSTALL_LOCK: Lazy<tokio::sync::Mutex<()>> =
    Lazy::new(|| tokio::sync::Mutex::new(()));
const STORY_GENERATION_STACK_BYTES: usize = 64 * 1024 * 1024;
const CREATIVE_AUDIO_COMMAND_STACK_BYTES: usize = 64 * 1024 * 1024;

async fn run_creative_audio_command_on_stack<T, F, Fut>(
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
        .stack_size(CREATIVE_AUDIO_COMMAND_STACK_BYTES)
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|err| {
                        format!("Failed to start creative audio command runtime: {err}")
                    })?;
                runtime.block_on(task())
            })();
            let _ = tx.send(result);
        })
        .map_err(|err| format!("Failed to start creative audio command thread: {err}"))?;

    rx.await
        .map_err(|_| "Creative audio command thread stopped before returning data.".to_string())?
}

pub(crate) fn active_story_render_references_tts_model(
    settings: &AppSettings,
    model_id: &str,
) -> bool {
    let preset_ids_for_model = settings
        .tts_voice_presets
        .iter()
        .filter(|preset| preset.model_id == model_id)
        .map(|preset| preset.id.as_str())
        .collect::<HashSet<_>>();
    if preset_ids_for_model.is_empty() {
        return false;
    }

    let queue = STORY_RENDER_QUEUE
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    queue.jobs.iter().any(|job| {
        job.status.is_active()
            && job
                .request
                .cast
                .iter()
                .any(|member| preset_ids_for_model.contains(member.preset_id.trim()))
    })
}

#[tauri::command]
#[specta::specta]
pub async fn render_story_audio(
    app: AppHandle,
    request: StoryRenderRequest,
) -> Result<StoryRenderEnqueueResult, String> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let now = now_ms();
    let render_id = request.render_id.clone();
    let (queue_position, should_start_worker) = {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        queue.jobs.push_back(StoryRenderJob {
            request,
            stop_flag,
            status: StoryRenderJobStatus::Queued,
            created_at_ms: now,
            queued_at_ms: now,
            started_at_ms: None,
            current_line: 0,
            total_lines: 0,
            speaker: None,
            error: None,
        });
        let queue_position = queue_position_for_locked(&queue, &render_id).unwrap_or(1);
        let should_start_worker = !queue.worker_running;
        if should_start_worker {
            queue.worker_running = true;
        }
        (queue_position, should_start_worker)
    };

    emit_story_render_queue_updated(&app);
    if should_start_worker {
        spawn_story_render_worker_thread(app.clone());
    }

    Ok(StoryRenderEnqueueResult {
        render_id,
        queue_position,
    })
}

pub async fn render_story_audio_now(
    app: AppHandle,
    request: StoryRenderRequest,
) -> Result<StoryRenderResult, String> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    run_creative_audio_command_on_stack("http-api-story-render", move || async move {
        render_story_audio_inner(app, request, stop_flag).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn cancel_story_render(app: AppHandle, render_id: String) -> Result<(), String> {
    let changed = {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        cancel_story_render_locked(&mut queue, &render_id)
    };
    if changed {
        emit_story_render_queue_updated(&app);
    }
    Ok(())
}

fn cancel_story_render_locked(queue: &mut StoryRenderQueueState, render_id: &str) -> bool {
    let Some(job) = queue
        .jobs
        .iter_mut()
        .find(|job| job.request.render_id == render_id && job.status.is_active())
    else {
        return false;
    };
    job.stop_flag.store(true, Ordering::Relaxed);
    job.status = StoryRenderJobStatus::Cancelled;
    job.speaker = None;
    job.error = None;
    true
}

#[tauri::command]
#[specta::specta]
pub fn list_story_render_jobs() -> Result<Vec<StoryRenderJobSummary>, String> {
    Ok(story_render_job_summaries())
}

#[tauri::command]
#[specta::specta]
pub async fn generate_create_speech_audio(
    app: AppHandle,
    request: CreateSpeechAudioRequest,
) -> Result<StoryRenderEnqueueResult, String> {
    let text = request.text.trim().to_string();
    if text.is_empty() {
        return Err("Enter speech text before generating audio.".to_string());
    }

    let render_id = request.render_id.clone();
    let _ = preset_from_input(request.preset.clone(), None)?;
    spawn_story_generation_thread(app.clone(), request)?;

    Ok(StoryRenderEnqueueResult {
        render_id,
        queue_position: 1,
    })
}

fn spawn_story_generation_thread(
    app: AppHandle,
    request: CreateSpeechAudioRequest,
) -> Result<(), String> {
    let thread_app = app.clone();
    thread::Builder::new()
        .name("create-speech-generate".to_string())
        .stack_size(STORY_GENERATION_STACK_BYTES)
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    warn!("Failed to start Create Speech runtime: {error}");
                    emit_story_audio_updated(&thread_app);
                    return;
                }
            };
            if let Err(error) = runtime.block_on(generate_create_speech_audio_inner(
                thread_app.clone(),
                request,
            )) {
                warn!("Create Speech generation failed: {error}");
                emit_story_audio_updated(&thread_app);
            }
        })
        .map(|_| ())
        .map_err(|error| {
            warn!("Failed to start Create Speech generation thread: {error}");
            emit_story_audio_updated(&app);
            format!("Failed to start Create Speech generation thread: {error}")
        })
}

#[tauri::command]
#[specta::specta]
pub fn get_stable_audio3_status(app: AppHandle) -> Result<StableAudio3Status, String> {
    stable_audio3_status(&app)
}

#[tauri::command]
#[specta::specta]
pub fn get_creative_audio_model_catalog(
    app: AppHandle,
) -> Result<CreativeAudioModelCatalog, String> {
    creative_audio_model_catalog(&app)
}

#[tauri::command]
#[specta::specta]
pub fn set_creative_audio_model_selection(
    app: AppHandle,
    model_id: String,
) -> Result<CreativeAudioModelCatalog, String> {
    let model = creative_audio_model_by_id(&app, &model_id)?;
    if !model.runnable {
        return Err(format!(
            "{} is not ready yet. Download it before making it active.",
            model.label
        ));
    }

    let mut settings = get_settings(&app);
    settings.selected_creative_audio_model_id = Some(model.id);
    write_settings(&app, settings.clone());
    let _ = app.emit("settings-changed", settings);
    let _ = app.emit("creative-audio-selection-changed", &model_id);
    creative_audio_model_catalog(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn download_creative_audio_model(
    app: AppHandle,
    model_id: String,
) -> Result<CreativeAudioModelDescriptor, String> {
    run_creative_audio_command_on_stack("download-creative-audio-model", move || async move {
        download_creative_audio_model_impl(&app, model_id).await
    })
    .await
}

async fn download_creative_audio_model_impl(
    app: &AppHandle,
    model_id: String,
) -> Result<CreativeAudioModelDescriptor, String> {
    let model = creative_audio_model_by_id(app, &model_id)?;
    if model.installed {
        return Ok(model);
    }
    if !model.downloadable {
        return Err(model.unavailable_reason.unwrap_or_else(|| {
            format!(
                "{} is blocked until its app-managed runtime validates.",
                model.label
            )
        }));
    }
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut downloads = ACTIVE_CREATIVE_AUDIO_DOWNLOADS
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if downloads.contains_key(&model_id) {
            return Err(format!("{} is already downloading.", model.label));
        }
        downloads.insert(model_id.clone(), Arc::clone(&stop_flag));
    }

    emit_creative_audio_download_progress(app, &model_id, "preparing", Some(0.0), None);
    let _install_guard = CREATIVE_AUDIO_INSTALL_LOCK.lock().await;
    let result = download_creative_audio_model_inner(app, &model_id, Arc::clone(&stop_flag)).await;

    ACTIVE_CREATIVE_AUDIO_DOWNLOADS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(&model_id);

    match result {
        Ok(_) => {
            emit_creative_audio_download_progress(app, &model_id, "complete", Some(100.0), None);
            creative_audio_model_by_id(app, &model_id)
        }
        Err(error) => {
            let phase = if error.to_lowercase().contains("cancelled") {
                "cancelled"
            } else {
                "failed"
            };
            emit_creative_audio_download_progress(app, &model_id, phase, None, Some(&error));
            Err(error)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_creative_audio_model_download(
    app: AppHandle,
    model_id: String,
) -> Result<(), String> {
    let Some(stop_flag) = ACTIVE_CREATIVE_AUDIO_DOWNLOADS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(&model_id)
        .cloned()
    else {
        return Ok(());
    };
    stop_flag.store(true, Ordering::Relaxed);
    emit_creative_audio_download_progress(&app, &model_id, "cancelling", None, None);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_active_creative_audio_downloads() -> Result<Vec<String>, String> {
    Ok(ACTIVE_CREATIVE_AUDIO_DOWNLOADS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .keys()
        .cloned()
        .collect())
}

#[tauri::command]
#[specta::specta]
pub fn delete_creative_audio_model(
    app: AppHandle,
    model_id: String,
) -> Result<CreativeAudioModelDescriptor, String> {
    let model = creative_audio_model_by_id(&app, &model_id)?;
    if ACTIVE_CREATIVE_AUDIO_DOWNLOADS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .contains_key(&model_id)
    {
        return Err(format!("{} is currently downloading.", model.label));
    }
    if !model.installed {
        return Ok(model);
    }

    if model_id == ACE_STEP_15_MUSIC_ID {
        let model_dir = ace_step_model_dir(&app)?;
        if model_dir.exists() {
            fs::remove_dir_all(&model_dir).map_err(|err| {
                format!(
                    "Failed to remove ACE-Step model files '{}': {err}",
                    model_dir.display()
                )
            })?;
        }
        clear_creative_audio_selection_if_deleted(&app, &model_id);
        return creative_audio_model_by_id(&app, &model_id);
    }

    if hf_creative_audio_spec(&model_id).is_some() {
        let model_dir = hf_creative_audio_model_dir(&app, &model_id)?;
        if model_dir.exists() {
            fs::remove_dir_all(&model_dir).map_err(|err| {
                format!(
                    "Failed to remove creative audio model files '{}': {err}",
                    model_dir.display()
                )
            })?;
        }
        clear_creative_audio_selection_if_deleted(&app, &model_id);
        return creative_audio_model_by_id(&app, &model_id);
    }

    let generic_model_dir = match model_id.as_str() {
        DIFFRHYTHM_MODEL_ID => Some(diffrhythm_model_dir(&app)?),
        YUE_MODEL_ID => Some(yue_model_dir(&app)?),
        FIGARO_MODEL_ID => Some(figaro_model_dir(&app)?),
        _ => None,
    };
    if let Some(model_dir) = generic_model_dir {
        if model_dir.exists() {
            fs::remove_dir_all(&model_dir).map_err(|err| {
                format!(
                    "Failed to remove creative audio model files '{}': {err}",
                    model_dir.display()
                )
            })?;
        }
        clear_creative_audio_selection_if_deleted(&app, &model_id);
        return creative_audio_model_by_id(&app, &model_id);
    }

    let runtime_dir = stable_audio3_runtime_dir(&app)?;
    for rel_path in stable_audio3_model_specific_weights(mode_for_creative_audio_model(&model_id)?)
    {
        let path = runtime_dir.join(rel_path);
        if path.exists() {
            fs::remove_file(&path).map_err(|err| {
                format!(
                    "Failed to remove creative audio model file '{}': {err}",
                    path.display()
                )
            })?;
        }
    }
    clear_creative_audio_selection_if_deleted(&app, &model_id);
    creative_audio_model_by_id(&app, &model_id)
}

fn clear_creative_audio_selection_if_deleted(app: &AppHandle, model_id: &str) {
    let mut settings = get_settings(app);
    if settings.selected_creative_audio_model_id.as_deref() != Some(model_id) {
        return;
    }
    settings.selected_creative_audio_model_id = None;
    write_settings(app, settings.clone());
    let _ = app.emit("settings-changed", settings);
    let _ = app.emit("creative-audio-selection-changed", "");
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_stable_audio3(
    app: AppHandle,
    request: PrepareStableAudio3Request,
) -> Result<StableAudio3Status, String> {
    request.mode.stable_audio3_dit()?;
    let stop_flag = Arc::new(AtomicBool::new(false));
    ensure_stable_audio3_runtime_installed(&app, STABLE_AUDIO3_MODEL_MUSIC_ID, stop_flag).await?;
    tokio::task::spawn_blocking(move || {
        run_stable_audio3_install(&app, request.mode, None)?;
        stable_audio3_status(&app)
    })
    .await
    .map_err(|err| format!("Stable Audio 3 preparation task failed: {err}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn generate_story_sound(
    app: AppHandle,
    request: GenerateStorySoundRequest,
) -> Result<StoryAudioItem, String> {
    let render_id = request.render_id.clone();
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        ACTIVE_STORY_SOUND_GENERATIONS
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .insert(render_id.clone(), Arc::clone(&stop_flag));
    }
    let result =
        tokio::task::spawn_blocking(move || generate_story_sound_inner(app, request, stop_flag))
            .await
            .map_err(|err| format!("Story sound generation task failed: {err}"))?;
    ACTIVE_STORY_SOUND_GENERATIONS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(&render_id);
    result
}

#[tauri::command]
#[specta::specta]
pub fn cancel_story_sound_generation(render_id: String) -> Result<(), String> {
    if let Some(stop_flag) = ACTIVE_STORY_SOUND_GENERATIONS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(&render_id)
    {
        stop_flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

async fn generate_create_speech_audio_inner(
    app: AppHandle,
    request: CreateSpeechAudioRequest,
) -> Result<StoryRenderResult, String> {
    let text = request.text.trim().to_string();
    let render_started_at = Instant::now();
    let mut inline_preset = preset_from_input(request.preset, None)?;
    if inline_preset.label.trim().is_empty() {
        inline_preset.label = "Create Speech".to_string();
    }

    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    let stop_flag = Arc::new(AtomicBool::new(false));
    let rendered_files = manager
        .synthesize_to_temp_files(
            SpeakRequest {
                text: text.clone(),
                locale: inline_preset.locale_snapshot.clone(),
                preferred_voice_id: inline_preset.voice_id.clone(),
                preset_id: None,
                // Generate should render audio only. Voice profiles are persisted exclusively
                // through create_tts_voice_preset, which is used by Save Tuned Voice.
                inline_preset: Some(inline_preset.clone()),
                trigger: Some("create_speech_generate".to_string()),
                remember_last_output: false,
            },
            Arc::clone(&stop_flag),
        )
        .await?;

    let output_path = output_path_for_story(&app, &request.title)?;
    let rendered_groups = vec![rendered_files];
    let duration_result = assemble_story_wav(&rendered_groups, 0, &output_path, &stop_flag);
    cleanup_file_groups(&rendered_groups);
    let duration_ms = duration_result?;

    let output_path = output_path.to_string_lossy().to_string();
    let result = StoryRenderResult {
        render_id: request.render_id.clone(),
        output_path: output_path.clone(),
        duration_ms,
        line_count: 1,
    };
    upsert_story_audio_item(
        &app,
        StoryAudioItem {
            id: request.render_id,
            kind: StoryAudioKind::StoryRender,
            project_id: None,
            title: story_title_label(&request.title),
            script_text: text.clone(),
            line_instructions: Vec::new(),
            output_path,
            clips_path: None,
            created_at_ms: now_ms(),
            duration_ms,
            line_count: 1,
            cast_count: 1,
            generation_time_ms: elapsed_ms_u32(render_started_at),
            sample_rate_hz: STORY_SAMPLE_RATE,
            expression_tags_used: contains_expression_tag(&text),
            inline_prompt_used: inline_preset
                .tuning
                .style_instructions
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()),
            audio_effect: StoryAudioEffectPreset::Clean,
            sound_mode: None,
            source_model_id: None,
            starred: false,
        },
    )?;
    emit_story_audio_updated(&app);

    Ok(result)
}

fn stable_audio3_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::stable_audio3_mlx_dir(app)
        .map_err(|err| format!("Failed to resolve Stable Audio 3 runtime dir: {err}"))
}

fn ace_step_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::ace_step_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve ACE-Step runtime dir: {err}"))
}

fn ace_step_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::ace_step_model_dir(app)
        .map_err(|err| format!("Failed to resolve ACE-Step model dir: {err}"))
}

fn diffrhythm_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::diffrhythm_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve DiffRhythm runtime dir: {err}"))
}

fn diffrhythm_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::diffrhythm_model_dir(app)
        .map_err(|err| format!("Failed to resolve DiffRhythm model dir: {err}"))
}

fn yue_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::yue_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve YuE runtime dir: {err}"))
}

fn yue_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::yue_model_dir(app)
        .map_err(|err| format!("Failed to resolve YuE model dir: {err}"))
}

fn figaro_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::figaro_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve FIGARO runtime dir: {err}"))
}

fn figaro_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::figaro_model_dir(app)
        .map_err(|err| format!("Failed to resolve FIGARO model dir: {err}"))
}

fn hf_creative_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::creative_audio_runtime_dir(app)
        .map(|dir| dir.join(HF_CREATIVE_RUNTIME_ID))
        .map_err(|err| format!("Failed to resolve HF creative runtime dir: {err}"))
}

fn hf_creative_audio_model_dir(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    crate::storage_paths::creative_audio_models_dir(app)
        .map(|dir| dir.join(model_id))
        .map_err(|err| format!("Failed to resolve HF creative audio model dir: {err}"))
}

fn hf_creative_audio_spec(model_id: &str) -> Option<&'static HfCreativeAudioModelSpec> {
    HF_CREATIVE_AUDIO_MODEL_SPECS
        .iter()
        .find(|spec| spec.id == model_id)
}

fn stable_audio3_status(app: &AppHandle) -> Result<StableAudio3Status, String> {
    let runtime_dir = stable_audio3_runtime_dir(app)?;
    let installed = stable_audio3_python_path(&runtime_dir).exists()
        && runtime_dir.join("scripts").join("sa3_mlx.py").exists();
    let sfx_ready = installed && stable_audio3_mode_ready(&runtime_dir, StorySoundMode::Sfx);
    let music_ready = installed && stable_audio3_mode_ready(&runtime_dir, StorySoundMode::Music);
    let ambience_ready = sfx_ready;
    let message = if !installed {
        "Stable Audio 3 MLX runtime is not installed. Prepare it from Sound Design before generating sounds.".to_string()
    } else if sfx_ready && music_ready {
        "Stable Audio 3 is ready for SFX, ambience, and music generation.".to_string()
    } else {
        "Stable Audio 3 runtime is installed. Prepare the selected sound mode to download its weights.".to_string()
    };

    Ok(StableAudio3Status {
        installed,
        sfx_ready,
        ambience_ready,
        music_ready,
        runtime_path: runtime_dir.to_string_lossy().to_string(),
        message,
    })
}

fn creative_audio_model_catalog(app: &AppHandle) -> Result<CreativeAudioModelCatalog, String> {
    let install_root = crate::storage_paths::creative_audio_models_dir(app)
        .map_err(|err| format!("Failed to resolve creative audio model dir: {err}"))?;
    let settings = get_settings(app);
    let active_downloads = ACTIVE_CREATIVE_AUDIO_DOWNLOADS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .keys()
        .cloned()
        .collect::<HashSet<_>>();

    let mut models = vec![
        stable_audio3_catalog_model(
            app,
            STABLE_AUDIO3_MODEL_SFX_ID,
            "Stable Audio 3 Small SFX",
            "Fast local sound-effect and ambience generation for story beats, foley, UI sounds, room tone, and short environmental audio.",
            "3.1 GB",
            vec![StorySoundMode::Sfx, StorySoundMode::Ambience],
            active_downloads.contains(STABLE_AUDIO3_MODEL_SFX_ID),
            true,
        )?,
        stable_audio3_catalog_model(
            app,
            STABLE_AUDIO3_MODEL_MUSIC_ID,
            "Stable Audio 3 Small Music",
            "Fast local music-bed generation for underscore, loops, transitions, stingers, and mood sketches.",
            "3.1 GB",
            vec![StorySoundMode::Music],
            active_downloads.contains(STABLE_AUDIO3_MODEL_MUSIC_ID),
            true,
        )?,
    ];

    for spec in HF_CREATIVE_AUDIO_MODEL_SPECS {
        models.push(hf_creative_audio_catalog_model(
            app,
            spec,
            active_downloads.contains(spec.id),
        )?);
    }
    let selected_model_id = selected_creative_audio_model_id(&settings, &models);
    for model in &mut models {
        model.selected = selected_model_id.as_deref() == Some(model.id.as_str());
        model.active = model.selected && model.runnable;
    }

    Ok(CreativeAudioModelCatalog {
        install_root: install_root.to_string_lossy().to_string(),
        models,
    })
}

fn selected_creative_audio_model_id(
    settings: &AppSettings,
    models: &[CreativeAudioModelDescriptor],
) -> Option<String> {
    settings
        .selected_creative_audio_model_id
        .as_deref()
        .and_then(|selected_id| {
            models
                .iter()
                .any(|model| model.id == selected_id && model.runnable)
                .then(|| selected_id.to_string())
        })
        .or_else(|| {
            models
                .iter()
                .find(|model| model.runnable)
                .map(|model| model.id.clone())
        })
}

fn stable_audio3_catalog_model(
    app: &AppHandle,
    id: &str,
    label: &str,
    description: &str,
    size_hint_label: &str,
    modes: Vec<StorySoundMode>,
    downloading: bool,
    recommended: bool,
) -> Result<CreativeAudioModelDescriptor, String> {
    let runtime_dir = stable_audio3_runtime_dir(app)?;
    let installed = modes
        .first()
        .is_some_and(|mode| stable_audio3_mode_ready(&runtime_dir, *mode));
    Ok(CreativeAudioModelDescriptor {
        id: id.to_string(),
        label: label.to_string(),
        provider: "Stability AI".to_string(),
        provider_id: "stability_ai".to_string(),
        description: description.to_string(),
        source_kind: CreativeAudioModelSourceKind::OfficialSource,
        source_url: STABLE_AUDIO3_SOURCE_URL.to_string(),
        license_label: "Stability AI Community License".to_string(),
        runtime_label: "Apple Silicon MLX".to_string(),
        size_hint_label: size_hint_label.to_string(),
        installed,
        runnable: installed && !downloading,
        selected: false,
        active: false,
        downloadable: true,
        recommended,
        status_label: if installed && !downloading {
            "Ready".to_string()
        } else {
            "Download required".to_string()
        },
        availability: if installed && !downloading {
            CreativeAudioAvailability::Ready
        } else {
            CreativeAudioAvailability::Downloadable
        },
        experimental: false,
        unavailable_reason: None,
        modes,
    })
}

fn hf_creative_audio_catalog_model(
    app: &AppHandle,
    spec: &HfCreativeAudioModelSpec,
    downloading: bool,
) -> Result<CreativeAudioModelDescriptor, String> {
    let model_dir = hf_creative_audio_model_dir(app, spec.id)?;
    let installed = hf_creative_audio_runtime_ready(app)
        && generic_creative_model_ready(&model_dir, spec.required_model_files);
    Ok(CreativeAudioModelDescriptor {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        provider: spec.provider.to_string(),
        provider_id: spec.provider_id.to_string(),
        description: spec.description.to_string(),
        source_kind: CreativeAudioModelSourceKind::OfficialSource,
        source_url: spec.source_url.to_string(),
        license_label: spec.license_label.to_string(),
        runtime_label: "Bundled PyTorch/MPS runtime".to_string(),
        size_hint_label: spec.size_hint_label.to_string(),
        installed,
        runnable: installed && !downloading,
        selected: false,
        active: false,
        downloadable: true,
        recommended: spec.recommended,
        status_label: if installed && !downloading {
            "Ready".to_string()
        } else {
            "Download required".to_string()
        },
        availability: if installed && !downloading {
            CreativeAudioAvailability::Ready
        } else {
            CreativeAudioAvailability::Downloadable
        },
        experimental: spec.experimental,
        unavailable_reason: None,
        modes: spec.modes.to_vec(),
    })
}

#[derive(Clone, Copy)]
enum HfCreativeAudioBackend {
    MusicGen,
    AudioLdm2,
}

struct HfCreativeAudioModelSpec {
    id: &'static str,
    label: &'static str,
    provider: &'static str,
    provider_id: &'static str,
    description: &'static str,
    source_url: &'static str,
    hf_repo_id: &'static str,
    license_label: &'static str,
    size_hint_label: &'static str,
    recommended: bool,
    experimental: bool,
    modes: &'static [StorySoundMode],
    backend: HfCreativeAudioBackend,
    required_model_files: &'static [&'static str],
    ignored_download_patterns: &'static [&'static str],
}

const HF_CREATIVE_AUDIO_MODEL_SPECS: &[HfCreativeAudioModelSpec] = &[
    HfCreativeAudioModelSpec {
        id: MUSICGEN_SMALL_MODEL_ID,
        label: "MusicGen Small",
        provider: "Meta AudioCraft",
        provider_id: "musicgen",
        description: "Open-weight local text-to-music model for loops, transitions, story beds, and short musical cues.",
        source_url: "https://huggingface.co/facebook/musicgen-small",
        hf_repo_id: "facebook/musicgen-small",
        license_label: "CC-BY-NC-4.0",
        size_hint_label: "2.2 GB safetensors snapshot",
        recommended: true,
        experimental: false,
        modes: &[StorySoundMode::Music],
        backend: HfCreativeAudioBackend::MusicGen,
        required_model_files: &[
            "config.json",
            "model.safetensors",
            "generation_config.json",
            "tokenizer.json",
            "preprocessor_config.json",
        ],
        ignored_download_patterns: &[],
    },
    HfCreativeAudioModelSpec {
        id: AUDIOLDM2_MODEL_ID,
        label: "AudioLDM 2",
        provider: "CVSSP",
        provider_id: "audioldm2",
        description: "Open-weight text-to-audio diffusion model for SFX, room tone, ambience, and general sound-design prompts.",
        source_url: "https://huggingface.co/cvssp/audioldm2",
        hf_repo_id: "cvssp/audioldm2",
        license_label: "CC-BY-NC-SA-4.0",
        size_hint_label: "4.2 GB safetensors snapshot",
        recommended: true,
        experimental: false,
        modes: &[StorySoundMode::Sfx, StorySoundMode::Ambience],
        backend: HfCreativeAudioBackend::AudioLdm2,
        required_model_files: &[
            "model_index.json",
            "scheduler/scheduler_config.json",
            "unet/diffusion_pytorch_model.safetensors",
            "vae/diffusion_pytorch_model.safetensors",
            "vocoder/model.safetensors",
        ],
        ignored_download_patterns: &["**/pytorch_model.bin", "**/diffusion_pytorch_model.bin"],
    },
    HfCreativeAudioModelSpec {
        id: AUDIOLDM2_MUSIC_MODEL_ID,
        label: "AudioLDM 2 Music",
        provider: "CVSSP",
        provider_id: "audioldm2_music",
        description: "Open-weight text-to-music diffusion model for short musical sketches and alternate music-bed generation.",
        source_url: "https://huggingface.co/cvssp/audioldm2-music",
        hf_repo_id: "cvssp/audioldm2-music",
        license_label: "CC-BY-NC-SA-4.0",
        size_hint_label: "4.2 GB safetensors snapshot",
        recommended: false,
        experimental: false,
        modes: &[StorySoundMode::Music],
        backend: HfCreativeAudioBackend::AudioLdm2,
        required_model_files: &[
            "model_index.json",
            "scheduler/scheduler_config.json",
            "unet/diffusion_pytorch_model.safetensors",
            "vae/diffusion_pytorch_model.safetensors",
            "vocoder/model.safetensors",
        ],
        ignored_download_patterns: &["**/pytorch_model.bin", "**/diffusion_pytorch_model.bin"],
    },
];

fn creative_audio_model_by_id(
    app: &AppHandle,
    model_id: &str,
) -> Result<CreativeAudioModelDescriptor, String> {
    creative_audio_model_catalog(app)?
        .models
        .into_iter()
        .find(|model| model.id == model_id)
        .ok_or_else(|| format!("Unknown creative audio model: {model_id}"))
}

fn mode_for_creative_audio_model(model_id: &str) -> Result<StorySoundMode, String> {
    match model_id {
        STABLE_AUDIO3_MODEL_SFX_ID => Ok(StorySoundMode::Sfx),
        STABLE_AUDIO3_MODEL_MUSIC_ID => Ok(StorySoundMode::Music),
        MUSICGEN_SMALL_MODEL_ID | AUDIOLDM2_MUSIC_MODEL_ID => Ok(StorySoundMode::Music),
        AUDIOLDM2_MODEL_ID => Ok(StorySoundMode::Sfx),
        ACE_STEP_15_MUSIC_ID => Ok(StorySoundMode::Music),
        DIFFRHYTHM_MODEL_ID | YUE_MODEL_ID => Ok(StorySoundMode::Song),
        FIGARO_MODEL_ID => Ok(StorySoundMode::Composition),
        _ => Err(format!("Unknown creative audio model: {model_id}")),
    }
}

fn model_supports_story_sound_mode(model_id: &str, mode: StorySoundMode) -> bool {
    match model_id {
        STABLE_AUDIO3_MODEL_SFX_ID => {
            matches!(mode, StorySoundMode::Sfx | StorySoundMode::Ambience)
        }
        STABLE_AUDIO3_MODEL_MUSIC_ID => matches!(mode, StorySoundMode::Music),
        MUSICGEN_SMALL_MODEL_ID | AUDIOLDM2_MUSIC_MODEL_ID => {
            matches!(mode, StorySoundMode::Music)
        }
        AUDIOLDM2_MODEL_ID => {
            matches!(mode, StorySoundMode::Sfx | StorySoundMode::Ambience)
        }
        ACE_STEP_15_MUSIC_ID => matches!(mode, StorySoundMode::Music | StorySoundMode::Song),
        DIFFRHYTHM_MODEL_ID | YUE_MODEL_ID => matches!(mode, StorySoundMode::Song),
        FIGARO_MODEL_ID => matches!(mode, StorySoundMode::Composition),
        _ => false,
    }
}

async fn download_creative_audio_model_inner(
    app: &AppHandle,
    model_id: &str,
    stop_flag: Arc<AtomicBool>,
) -> Result<CreativeAudioModelDescriptor, String> {
    match model_id {
        STABLE_AUDIO3_MODEL_SFX_ID | STABLE_AUDIO3_MODEL_MUSIC_ID => {
            let mode = mode_for_creative_audio_model(model_id)?;
            ensure_download_not_cancelled(&stop_flag)?;
            ensure_stable_audio3_runtime_installed(app, model_id, Arc::clone(&stop_flag)).await?;
            ensure_download_not_cancelled(&stop_flag)?;
            emit_creative_audio_download_progress(app, model_id, "downloading-weights", None, None);
            let app_for_task = app.clone();
            tokio::task::spawn_blocking(move || {
                run_stable_audio3_install(&app_for_task, mode, Some(&stop_flag))
            })
            .await
            .map_err(|err| format!("Stable Audio 3 installer task failed: {err}"))??;
            creative_audio_model_by_id(app, model_id)
        }
        id if hf_creative_audio_spec(id).is_some() => {
            let spec = hf_creative_audio_spec(id).expect("checked above");
            ensure_download_not_cancelled(&stop_flag)?;
            ensure_hf_creative_runtime_installed(app, model_id, Arc::clone(&stop_flag)).await?;
            ensure_download_not_cancelled(&stop_flag)?;
            download_hf_creative_model_snapshot(app, model_id, spec, Arc::clone(&stop_flag))
                .await?;
            creative_audio_model_by_id(app, model_id)
        }
        ACE_STEP_15_MUSIC_ID => {
            ensure_download_not_cancelled(&stop_flag)?;
            ensure_ace_step_runtime_installed(app, model_id, Arc::clone(&stop_flag)).await?;
            ensure_download_not_cancelled(&stop_flag)?;
            download_ace_step_model_snapshot(app, model_id, Arc::clone(&stop_flag)).await?;
            creative_audio_model_by_id(app, model_id)
        }
        DIFFRHYTHM_MODEL_ID => {
            ensure_generic_creative_runtime_installed(
                app,
                model_id,
                &diffrhythm_runtime_dir(app)?,
                DIFFRHYTHM_RUNTIME_ARCHIVE,
                DIFFRHYTHM_RUNTIME_CHECKSUM,
                "diffrhythm_generate.py",
                Arc::clone(&stop_flag),
            )
            .await?;
            download_creative_model_snapshot(
                app,
                model_id,
                DIFFRHYTHM_HF_REPO_ID,
                &diffrhythm_model_dir(app)?,
                &["config.json", "cfm_model.pt"],
                Arc::clone(&stop_flag),
            )
            .await?;
            creative_audio_model_by_id(app, model_id)
        }
        YUE_MODEL_ID => {
            ensure_generic_creative_runtime_installed(
                app,
                model_id,
                &yue_runtime_dir(app)?,
                YUE_RUNTIME_ARCHIVE,
                YUE_RUNTIME_CHECKSUM,
                "yue_generate.py",
                Arc::clone(&stop_flag),
            )
            .await?;
            let model_dir = yue_model_dir(app)?;
            download_creative_model_snapshot(
                app,
                model_id,
                YUE_STAGE1_HF_REPO_ID,
                &model_dir.join("stage1"),
                &["config.json", "model.safetensors.index.json"],
                Arc::clone(&stop_flag),
            )
            .await?;
            download_creative_model_snapshot(
                app,
                model_id,
                YUE_STAGE2_HF_REPO_ID,
                &model_dir.join("stage2"),
                &["config.json", "model.safetensors"],
                Arc::clone(&stop_flag),
            )
            .await?;
            creative_audio_model_by_id(app, model_id)
        }
        FIGARO_MODEL_ID => {
            ensure_generic_creative_runtime_installed(
                app,
                model_id,
                &figaro_runtime_dir(app)?,
                FIGARO_RUNTIME_ARCHIVE,
                FIGARO_RUNTIME_CHECKSUM,
                "figaro_generate.py",
                Arc::clone(&stop_flag),
            )
            .await?;
            download_creative_model_snapshot(
                app,
                model_id,
                FIGARO_HF_REPO_ID,
                &figaro_model_dir(app)?,
                &["checkpoints/figaro-expert.ckpt"],
                Arc::clone(&stop_flag),
            )
            .await?;
            creative_audio_model_by_id(app, model_id)
        }
        _ => Err(format!("Unknown creative audio model: {model_id}")),
    }
}

fn ensure_download_not_cancelled(stop_flag: &AtomicBool) -> Result<(), String> {
    if stop_flag.load(Ordering::Relaxed) {
        Err("Download cancelled.".to_string())
    } else {
        Ok(())
    }
}

fn emit_creative_audio_download_progress(
    app: &AppHandle,
    model_id: &str,
    phase: &str,
    percentage: Option<f64>,
    error: Option<&str>,
) {
    let _ = app.emit(
        "creative-audio-download-progress",
        CreativeAudioDownloadProgress {
            model_id: model_id.to_string(),
            phase: phase.to_string(),
            percentage,
            error: error.map(str::to_string),
        },
    );
}

fn stable_audio3_python_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(".venv").join("bin").join("python")
}

fn stable_audio3_runtime_ready(runtime_dir: &Path) -> bool {
    stable_audio3_python_path(runtime_dir).exists()
        && runtime_dir.join("scripts").join("sa3_mlx.py").exists()
        && runtime_dir.join("install.sh").exists()
}

fn stable_audio3_mode_ready(runtime_dir: &Path, mode: StorySoundMode) -> bool {
    stable_audio3_required_weights(mode)
        .iter()
        .all(|rel_path| runtime_dir.join(rel_path).exists())
}

fn stable_audio3_required_weights(mode: StorySoundMode) -> &'static [&'static str] {
    match mode {
        StorySoundMode::Sfx | StorySoundMode::Ambience => &[
            "models/mlx/t5gemma_f16.npz",
            "models/mlx/dit_sm-sfx_f16.npz",
            "models/mlx/same_s_decoder_f32.npz",
            "models/mlx/same_s_encoder_f32.npz",
        ],
        StorySoundMode::Music => &[
            "models/mlx/t5gemma_f16.npz",
            "models/mlx/dit_sm-music_f16.npz",
            "models/mlx/same_s_decoder_f32.npz",
            "models/mlx/same_s_encoder_f32.npz",
        ],
        StorySoundMode::Song | StorySoundMode::Composition => {
            &["__stable_audio3_studio_mode_is_unsupported__"]
        }
    }
}

fn stable_audio3_model_specific_weights(mode: StorySoundMode) -> &'static [&'static str] {
    match mode {
        StorySoundMode::Sfx | StorySoundMode::Ambience => &["models/mlx/dit_sm-sfx_f16.npz"],
        StorySoundMode::Music => &["models/mlx/dit_sm-music_f16.npz"],
        StorySoundMode::Song | StorySoundMode::Composition => &[],
    }
}

async fn ensure_stable_audio3_runtime_installed(
    app: &AppHandle,
    model_id: &str,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let runtime_dir = stable_audio3_runtime_dir(app)?;
    if stable_audio3_runtime_ready(&runtime_dir) {
        return Ok(());
    }
    emit_creative_audio_download_progress(app, model_id, "downloading-runtime", Some(0.0), None);
    download_creative_audio_runtime_archive(
        app,
        model_id,
        CREATIVE_AUDIO_RUNTIME_HF_REPO_ID,
        STABLE_AUDIO3_RUNTIME_ARCHIVE,
        STABLE_AUDIO3_RUNTIME_CHECKSUM,
        &runtime_dir,
        Arc::clone(&stop_flag),
    )
    .await?;
    if !stable_audio3_runtime_ready(&runtime_dir) {
        return Err("Stable Audio 3 runtime download completed, but the runtime entrypoint or Python environment is missing.".to_string());
    }
    ensure_executable(&runtime_dir.join("install.sh"));
    ensure_executable(&runtime_dir.join("sa3"));
    Ok(())
}

fn ace_step_python_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(".venv").join("bin").join("python")
}

fn ace_step_runtime_ready(runtime_dir: &Path) -> bool {
    ace_step_python_path(runtime_dir).exists()
        && (runtime_dir
            .join("scripts")
            .join("ace_step_generate.py")
            .exists()
            || runtime_dir.join("ace_step_generate.py").exists())
}

fn ace_step_entrypoint(runtime_dir: &Path) -> PathBuf {
    let script = runtime_dir.join("scripts").join("ace_step_generate.py");
    if script.exists() {
        script
    } else {
        runtime_dir.join("ace_step_generate.py")
    }
}

fn ace_step_model_ready(model_dir: &Path) -> bool {
    [
        "config.json",
        "acestep-v15-turbo/config.json",
        "acestep-v15-turbo/model.safetensors",
        "acestep-5Hz-lm-1.7B/config.json",
        "acestep-5Hz-lm-1.7B/model.safetensors",
        "vae/config.json",
        "vae/diffusion_pytorch_model.safetensors",
    ]
    .iter()
    .all(|rel_path| model_dir.join(rel_path).exists())
}

fn generic_creative_python_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(".venv").join("bin").join("python")
}

fn generic_creative_runtime_entrypoint(runtime_dir: &Path, script_name: &str) -> PathBuf {
    let script = runtime_dir.join("scripts").join(script_name);
    if script.exists() {
        script
    } else {
        runtime_dir.join(script_name)
    }
}

fn generic_creative_runtime_ready(runtime_dir: &Path, script_name: &str) -> bool {
    generic_creative_python_path(runtime_dir).exists()
        && generic_creative_runtime_entrypoint(runtime_dir, script_name).exists()
}

fn hf_creative_speech_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let (platform_id, _archive_name) = crate::tts::managed_speech_runtime_archive_for_app()
        .ok_or_else(|| {
            "The bundled PyTorch/MPS runtime is not available on this platform.".to_string()
        })?;
    let install_dir = crate::settings::default_speech_runtime_install_dir(app, platform_id);
    crate::tts::resolve_speech_runtime_root_for_app(&install_dir)
        .ok_or_else(|| "The bundled PyTorch/MPS runtime is not installed yet.".to_string())
}

fn hf_creative_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = hf_creative_speech_runtime_root(app)?;
    crate::sidecar::SidecarManager::runtime_python_path(&root).ok_or_else(|| {
        "The bundled PyTorch/MPS runtime is missing its Python interpreter.".to_string()
    })
}

fn hf_creative_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(hf_creative_runtime_dir(app)?
        .join("scripts")
        .join(HF_CREATIVE_RUNTIME_SCRIPT))
}

fn hf_creative_audio_runtime_ready(app: &AppHandle) -> bool {
    hf_creative_python_path(app).is_ok_and(|python| python.exists())
        && hf_creative_script_path(app).is_ok_and(|script| script.exists())
}

fn generic_creative_model_ready(model_dir: &Path, required_files: &[&str]) -> bool {
    required_files
        .iter()
        .all(|rel_path| model_dir.join(rel_path).exists())
}

fn creative_hf_model_file_allowed(path: &str, ignored_patterns: &[&str]) -> bool {
    !ignored_patterns
        .iter()
        .any(|pattern| creative_hf_ignore_pattern_matches(pattern, path))
}

fn creative_hf_ignore_pattern_matches(pattern: &str, path: &str) -> bool {
    if let Some(suffix) = pattern.strip_prefix("**/") {
        path == suffix || path.ends_with(&format!("/{suffix}"))
    } else {
        path == pattern
    }
}

async fn ensure_hf_creative_runtime_installed(
    app: &AppHandle,
    model_id: &str,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    ensure_download_not_cancelled(&stop_flag)?;
    emit_creative_audio_download_progress(app, model_id, "installing-runtime", None, None);
    let app_for_task = app.clone();
    tokio::task::spawn_blocking(move || {
        ensure_hf_creative_runtime_installed_blocking(&app_for_task, &stop_flag)
    })
    .await
    .map_err(|err| format!("HF creative runtime install task failed: {err}"))?
}

fn ensure_hf_creative_runtime_installed_blocking(
    app: &AppHandle,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    ensure_download_not_cancelled(stop_flag)?;
    let (platform_id, archive_name) = crate::tts::managed_speech_runtime_archive_for_app()
        .ok_or_else(|| {
            "The bundled PyTorch/MPS runtime is not available on this platform.".to_string()
        })?;
    let install_dir = crate::settings::default_speech_runtime_install_dir(app, platform_id);
    let mut runtime_root = crate::tts::resolve_speech_runtime_root_for_app(&install_dir);

    let runtime_python_ready = runtime_root
        .as_ref()
        .and_then(|root| crate::sidecar::SidecarManager::runtime_python_path(root))
        .is_some();

    if !runtime_python_ready {
        let archive_path = crate::portable::resolve_resource(
            app,
            &format!("resources/tts-runtime/{}", archive_name),
        )
        .map_err(|err| format!("Failed to resolve bundled PyTorch/MPS runtime: {err}"))?;
        if !archive_path.exists() {
            return Err(format!(
                "Bundled PyTorch/MPS runtime archive is missing: {}",
                archive_path.display()
            ));
        }
        crate::tts::extract_speech_runtime_archive_for_app(&archive_path, &install_dir)?;
        runtime_root = crate::tts::resolve_speech_runtime_root_for_app(&install_dir);
    }

    let runtime_root = runtime_root
        .ok_or_else(|| "Bundled PyTorch/MPS runtime extraction produced no files.".to_string())?;
    // Validate the bundled runtime ships a usable interpreter (relocatable
    // `.python/` or legacy `.venv/`); the path itself is not needed here.
    let _python =
        crate::sidecar::SidecarManager::runtime_python_path(&runtime_root).ok_or_else(|| {
            format!(
                "Bundled PyTorch/MPS runtime is missing a Python interpreter under {}.",
                runtime_root.display()
            )
        })?;

    ensure_download_not_cancelled(stop_flag)?;
    let runtime_dir = hf_creative_runtime_dir(app)?;
    let script_dir = runtime_dir.join("scripts");
    fs::create_dir_all(&script_dir).map_err(|err| {
        format!(
            "Failed to create HF creative runtime script dir '{}': {err}",
            script_dir.display()
        )
    })?;
    {
        let (resource, target_name) = (
            "resources/python/creative_audio_hf_generate.py",
            HF_CREATIVE_RUNTIME_SCRIPT,
        );
        let source_script = crate::portable::resolve_resource(app, resource)
            .map_err(|err| format!("Failed to resolve HF creative runtime script: {err}"))?;
        if !source_script.exists() {
            return Err(format!(
                "HF creative runtime script is missing: {}",
                source_script.display()
            ));
        }
        let target_script = script_dir.join(target_name);
        fs::copy(&source_script, &target_script).map_err(|err| {
            format!(
                "Failed to install HF creative runtime script '{}': {err}",
                target_script.display()
            )
        })?;
        ensure_executable(&target_script);
    }
    Ok(())
}

async fn ensure_ace_step_runtime_installed(
    app: &AppHandle,
    model_id: &str,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let runtime_dir = ace_step_runtime_dir(app)?;
    if ace_step_runtime_ready(&runtime_dir) {
        return Ok(());
    }
    emit_creative_audio_download_progress(app, model_id, "downloading-runtime", Some(0.0), None);
    download_creative_audio_runtime_archive(
        app,
        model_id,
        CREATIVE_AUDIO_RUNTIME_HF_REPO_ID,
        ACE_STEP_RUNTIME_ARCHIVE,
        ACE_STEP_RUNTIME_CHECKSUM,
        &runtime_dir,
        Arc::clone(&stop_flag),
    )
    .await?;
    if !ace_step_runtime_ready(&runtime_dir) {
        return Err("ACE-Step runtime download completed, but the runtime entrypoint or Python environment is missing.".to_string());
    }
    ensure_executable(&ace_step_entrypoint(&runtime_dir));
    Ok(())
}

async fn ensure_generic_creative_runtime_installed(
    app: &AppHandle,
    model_id: &str,
    runtime_dir: &Path,
    archive_name: &str,
    checksum_name: &str,
    entrypoint: &str,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    ensure_download_not_cancelled(&stop_flag)?;
    if generic_creative_runtime_ready(runtime_dir, entrypoint) {
        return Ok(());
    }
    emit_creative_audio_download_progress(app, model_id, "downloading-runtime", Some(0.0), None);
    download_creative_audio_runtime_archive(
        app,
        model_id,
        CREATIVE_AUDIO_RUNTIME_HF_REPO_ID,
        archive_name,
        checksum_name,
        runtime_dir,
        Arc::clone(&stop_flag),
    )
    .await?;
    if !generic_creative_runtime_ready(runtime_dir, entrypoint) {
        return Err(format!(
            "{} runtime download completed, but the runtime entrypoint or Python environment is missing.",
            model_id
        ));
    }
    ensure_executable(&generic_creative_runtime_entrypoint(
        runtime_dir,
        entrypoint,
    ));
    Ok(())
}

async fn download_ace_step_model_snapshot(
    app: &AppHandle,
    model_id: &str,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let model_dir = ace_step_model_dir(app)?;
    if ace_step_model_ready(&model_dir) {
        return Ok(());
    }
    let staging_dir = model_dir.with_file_name(".staging-ace-step-1.5");
    let progress_app = app.clone();
    let progress_model_id = model_id.to_string();
    let progress = Arc::new(
        move |progress: crate::artifact_download::ArtifactProgress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress.clone());
            emit_creative_audio_download_progress(
                &progress_app,
                &progress_model_id,
                "downloading-weights",
                Some(progress.percentage),
                progress.error.as_deref(),
            );
        },
    );

    crate::artifact_download::download_hf_repo(crate::artifact_download::HfRepoDownloadOptions {
        domain: "creative_audio".to_string(),
        artifact_id: model_id.to_string(),
        repo_id: ACE_STEP_15_HF_REPO_ID.to_string(),
        staging_dir,
        final_dir: model_dir.clone(),
        token: crate::speech_analysis::hugging_face_token_for_runtime(),
        gated: false,
        resume_existing_staging: true,
        cancel_flag: Some(stop_flag),
        file_filter: None,
        progress: Some(progress),
    })
    .await?;
    if ace_step_model_ready(&model_dir) {
        Ok(())
    } else {
        Err("ACE-Step model download completed, but required weights are missing.".to_string())
    }
}

async fn download_hf_creative_model_snapshot(
    app: &AppHandle,
    model_id: &str,
    spec: &'static HfCreativeAudioModelSpec,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let model_dir = hf_creative_audio_model_dir(app, model_id)?;
    if generic_creative_model_ready(&model_dir, spec.required_model_files) {
        return Ok(());
    }

    emit_creative_audio_download_progress(app, model_id, "downloading-weights", None, None);
    let staging_dir = model_dir.with_file_name(format!(
        ".staging-{}",
        sanitize_creative_artifact_id(&format!("{model_id}-{}", spec.hf_repo_id))
    ));
    let progress_app = app.clone();
    let progress_model_id = model_id.to_string();
    let progress = Arc::new(
        move |progress: crate::artifact_download::ArtifactProgress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress.clone());
            emit_creative_audio_download_progress(
                &progress_app,
                &progress_model_id,
                "downloading-weights",
                Some(progress.percentage),
                progress.error.as_deref(),
            );
        },
    );
    let ignored_patterns = spec.ignored_download_patterns;
    let file_filter: crate::artifact_download::HfFileFilter =
        Arc::new(move |path: &str| creative_hf_model_file_allowed(path, ignored_patterns));

    crate::artifact_download::download_hf_repo(crate::artifact_download::HfRepoDownloadOptions {
        domain: "creative_audio".to_string(),
        artifact_id: model_id.to_string(),
        repo_id: spec.hf_repo_id.to_string(),
        staging_dir,
        final_dir: model_dir.clone(),
        token: crate::speech_analysis::hugging_face_token_for_runtime(),
        gated: false,
        resume_existing_staging: true,
        cancel_flag: Some(stop_flag),
        file_filter: Some(file_filter),
        progress: Some(progress),
    })
    .await?;

    if generic_creative_model_ready(&model_dir, spec.required_model_files) {
        Ok(())
    } else {
        Err(format!(
            "{} model download completed, but required files are missing.",
            model_id
        ))
    }
}

async fn download_creative_model_snapshot(
    app: &AppHandle,
    model_id: &str,
    repo_id: &str,
    model_dir: &Path,
    required_files: &[&str],
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    if generic_creative_model_ready(model_dir, required_files) {
        return Ok(());
    }
    let staging_dir = model_dir.with_file_name(format!(
        ".staging-{}",
        sanitize_creative_artifact_id(&format!("{model_id}-{repo_id}"))
    ));
    let progress_app = app.clone();
    let progress_model_id = model_id.to_string();
    let progress = Arc::new(
        move |progress: crate::artifact_download::ArtifactProgress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress.clone());
            emit_creative_audio_download_progress(
                &progress_app,
                &progress_model_id,
                "downloading-weights",
                Some(progress.percentage),
                progress.error.as_deref(),
            );
        },
    );

    crate::artifact_download::download_hf_repo(crate::artifact_download::HfRepoDownloadOptions {
        domain: "creative_audio".to_string(),
        artifact_id: format!("{model_id}:{repo_id}"),
        repo_id: repo_id.to_string(),
        staging_dir,
        final_dir: model_dir.to_path_buf(),
        token: crate::speech_analysis::hugging_face_token_for_runtime(),
        gated: false,
        resume_existing_staging: true,
        cancel_flag: Some(stop_flag),
        file_filter: None,
        progress: Some(progress),
    })
    .await?;
    if generic_creative_model_ready(model_dir, required_files) {
        Ok(())
    } else {
        Err(format!(
            "{} model download completed, but required weights are missing.",
            model_id
        ))
    }
}

fn sanitize_creative_artifact_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

async fn download_creative_audio_runtime_archive(
    app: &AppHandle,
    model_id: &str,
    repo_id: &str,
    archive_name: &str,
    checksum_name: &str,
    runtime_dir: &Path,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1800))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let token = crate::speech_analysis::hugging_face_token_for_runtime();
    let archive_url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        repo_id, archive_name
    );
    let checksum_url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        repo_id, checksum_name
    );
    let expected_sha256 =
        fetch_creative_audio_runtime_sha256(&client, &checksum_url, token.as_deref(), archive_name)
            .await?;
    let download_dir = crate::storage_paths::creative_audio_downloads_dir(app)
        .map_err(|err| format!("Failed to resolve creative audio downloads dir: {err}"))?;
    fs::create_dir_all(&download_dir)
        .map_err(|err| format!("Failed to create creative audio download dir: {err}"))?;
    let archive_path = download_dir.join(archive_name);
    let partial_path = download_dir.join(format!("{archive_name}.partial"));
    if archive_path.exists() {
        fs::remove_file(&archive_path).map_err(|err| {
            format!("Failed to clear previous creative audio runtime archive: {err}")
        })?;
    }

    let progress_app = app.clone();
    let progress_model_id = model_id.to_string();
    let progress = Arc::new(
        move |progress: crate::artifact_download::ArtifactProgress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress.clone());
            emit_creative_audio_download_progress(
                &progress_app,
                &progress_model_id,
                "downloading-runtime",
                Some(progress.percentage),
                progress.error.as_deref(),
            );
        },
    );

    crate::artifact_download::download_file(crate::artifact_download::FileDownloadOptions {
        domain: "creative_audio_runtime".to_string(),
        artifact_id: archive_name.to_string(),
        url: archive_url,
        partial_path,
        final_path: archive_path.clone(),
        expected_sha256: Some(expected_sha256),
        expected_size: None,
        bearer_token: token,
        cancel_flag: Some(stop_flag),
        progress: Some(progress),
    })
    .await?;

    emit_creative_audio_download_progress(app, model_id, "installing-runtime", None, None);
    let staging_dir = runtime_dir.with_file_name(format!(
        ".staging-{}",
        runtime_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("creative-audio-runtime")
    ));
    let archive_for_task = archive_path.clone();
    let staging_for_task = staging_dir.clone();
    tokio::task::spawn_blocking(move || {
        extract_tar_gz_archive(&archive_for_task, &staging_for_task)
    })
    .await
    .map_err(|err| format!("Creative audio runtime extraction task failed: {err}"))??;
    flatten_single_child_runtime_dir(&staging_dir)?;
    if runtime_dir.exists() {
        fs::remove_dir_all(runtime_dir)
            .map_err(|err| format!("Failed to clear old creative audio runtime: {err}"))?;
    }
    if let Some(parent) = runtime_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create creative audio runtime parent: {err}"))?;
    }
    fs::rename(&staging_dir, runtime_dir)
        .map_err(|err| format!("Failed to install creative audio runtime: {err}"))?;
    let _ = fs::remove_file(&archive_path);
    Ok(())
}

async fn fetch_creative_audio_runtime_sha256(
    client: &reqwest::Client,
    checksum_url: &str,
    token: Option<&str>,
    archive_name: &str,
) -> Result<String, String> {
    let mut request = client.get(checksum_url);
    if let Some(token) = token.filter(|token| !token.trim().is_empty()) {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("Failed to download {archive_name} checksum: {err}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {archive_name} checksum from Hugging Face: HTTP {}",
            response.status()
        ));
    }
    let body = response
        .text()
        .await
        .map_err(|err| format!("Failed to read {archive_name} checksum: {err}"))?;
    let checksum = body
        .split_whitespace()
        .next()
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if checksum.len() == 64 && checksum.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Ok(checksum)
    } else {
        Err(format!(
            "{archive_name} checksum file did not contain a valid SHA-256 digest."
        ))
    }
}

fn extract_tar_gz_archive(archive_path: &Path, install_dir: &Path) -> Result<(), String> {
    if install_dir.exists() {
        fs::remove_dir_all(install_dir)
            .map_err(|err| format!("Failed to clear runtime staging dir: {err}"))?;
    }
    fs::create_dir_all(install_dir)
        .map_err(|err| format!("Failed to create runtime staging dir: {err}"))?;
    let file =
        File::open(archive_path).map_err(|err| format!("Failed to open runtime archive: {err}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    for entry in archive
        .entries()
        .map_err(|err| format!("Failed to read runtime archive: {err}"))?
    {
        let mut entry =
            entry.map_err(|err| format!("Failed to read runtime archive entry: {err}"))?;
        let relative_path = sanitize_runtime_archive_path(
            entry
                .path()
                .map_err(|err| format!("Failed to read runtime archive path: {err}"))?,
        )?;
        if relative_path.as_os_str().is_empty() || is_macos_metadata_path(&relative_path) {
            continue;
        }
        if entry.header().entry_type().is_symlink() || entry.header().entry_type().is_hard_link() {
            return Err(
                "Creative audio runtime archive contains links, which are not supported."
                    .to_string(),
            );
        }
        let destination = install_dir.join(&relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create runtime extraction dir: {err}"))?;
        }
        entry
            .unpack(&destination)
            .map_err(|err| format!("Failed to extract runtime archive: {err}"))?;
    }
    Ok(())
}

fn sanitize_runtime_archive_path(path: std::borrow::Cow<'_, Path>) -> Result<PathBuf, String> {
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "Creative audio runtime archive contains unsafe path: {}",
                    path.display()
                ));
            }
        }
    }
    Ok(safe)
}

fn is_macos_metadata_path(path: &Path) -> bool {
    path.components().any(|component| {
        component.as_os_str() == "__MACOSX"
            || component
                .as_os_str()
                .to_str()
                .is_some_and(|part| part.starts_with("._"))
    })
}

fn flatten_single_child_runtime_dir(dir: &Path) -> Result<(), String> {
    let mut child_dirs = Vec::new();
    let mut saw_file = false;
    for entry in fs::read_dir(dir).map_err(|err| format!("Failed to inspect runtime dir: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to inspect runtime entry: {err}"))?;
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with('.'))
        {
            continue;
        }
        if entry
            .file_type()
            .map_err(|err| format!("Failed to inspect runtime entry type: {err}"))?
            .is_dir()
        {
            child_dirs.push(path);
        } else {
            saw_file = true;
        }
    }
    if saw_file || child_dirs.len() != 1 {
        return Ok(());
    }

    let temp_dir = dir.with_file_name(format!(
        ".flattening-{}",
        dir.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("creative-audio-runtime")
    ));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|err| format!("Failed to clear runtime flattening dir: {err}"))?;
    }
    fs::rename(&child_dirs[0], &temp_dir)
        .map_err(|err| format!("Failed to stage flattened runtime dir: {err}"))?;
    fs::remove_dir_all(dir).map_err(|err| format!("Failed to clear nested runtime dir: {err}"))?;
    fs::rename(&temp_dir, dir).map_err(|err| format!("Failed to flatten runtime dir: {err}"))
}

fn run_stable_audio3_install(
    app: &AppHandle,
    mode: StorySoundMode,
    stop_flag: Option<&AtomicBool>,
) -> Result<(), String> {
    let runtime_dir = stable_audio3_runtime_dir(app)?;
    let dit = mode.stable_audio3_dit()?;
    let mut command = Command::new(runtime_dir.join("install.sh"));
    command
        .current_dir(&runtime_dir)
        .arg("-y")
        .arg("--download")
        .arg(dit)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(token) = crate::speech_analysis::hugging_face_token_for_runtime() {
        command.env("HF_TOKEN", &token);
        command.env("HUGGINGFACE_HUB_TOKEN", token);
    }
    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start Stable Audio 3 installer: {err}"))?;

    loop {
        if stop_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Download cancelled.".to_string());
        }
        match child
            .try_wait()
            .map_err(|err| format!("Failed to monitor Stable Audio 3 installer: {err}"))?
        {
            Some(_) => break,
            None => thread::sleep(Duration::from_millis(250)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed to read Stable Audio 3 installer output: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "Stable Audio 3 installer failed: {}",
            command_output_preview(&output)
        ));
    }
    Ok(())
}

fn generate_story_sound_inner(
    app: AppHandle,
    request: GenerateStorySoundRequest,
    stop_flag: Arc<AtomicBool>,
) -> Result<StoryAudioItem, String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Describe the sound before generating.".to_string());
    }
    let model = creative_audio_model_by_id(&app, &request.model_id)?;
    if matches!(model.availability, CreativeAudioAvailability::Blocked) {
        return Err(model.unavailable_reason.unwrap_or_else(|| {
            format!(
                "{} is blocked until its runtime and model artifacts validate.",
                model.label
            )
        }));
    }
    if !model_supports_story_sound_mode(&request.model_id, request.mode) {
        return Err(format!(
            "{} does not support {} generation.",
            model.label,
            request.mode.label()
        ));
    }
    if !model.runnable {
        return Err(format!(
            "{} is not installed yet. Download it from Creative Audio Models first.",
            model.label
        ));
    }
    let started = Instant::now();
    let duration_seconds = request
        .duration_seconds
        .clamp(1, request.mode.max_seconds());
    let seed = request.seed.unwrap_or_else(random_story_sound_seed);
    let title = story_sound_title(request.mode, &request.title, prompt);
    let output_path = output_path_for_story(&app, &title)?;

    if request.model_id == ACE_STEP_15_MUSIC_ID {
        let ace_runtime_dir = ace_step_runtime_dir(&app)?;
        let ace_model_dir = ace_step_model_dir(&app)?;
        if !ace_step_runtime_ready(&ace_runtime_dir) || !ace_step_model_ready(&ace_model_dir) {
            return Err(
                "ACE-Step is not installed yet. Download it from Creative Audio Models first."
                    .to_string(),
            );
        }
        run_ace_step_generate(
            &ace_runtime_dir,
            &ace_model_dir,
            &request,
            prompt,
            duration_seconds,
            seed,
            &output_path,
            &stop_flag,
        )?;
    } else if let Some(spec) = hf_creative_audio_spec(&request.model_id) {
        run_hf_creative_generate(
            spec,
            &app,
            &hf_creative_audio_model_dir(&app, &request.model_id)?,
            &request,
            prompt,
            duration_seconds,
            seed,
            &output_path,
            &stop_flag,
        )?;
    } else if request.model_id == DIFFRHYTHM_MODEL_ID {
        run_generic_creative_generate(
            "DiffRhythm",
            &diffrhythm_runtime_dir(&app)?,
            &diffrhythm_model_dir(&app)?,
            "diffrhythm_generate.py",
            &request,
            prompt,
            duration_seconds,
            seed,
            &output_path,
            &stop_flag,
        )?;
    } else if request.model_id == YUE_MODEL_ID {
        run_generic_creative_generate(
            "YuE",
            &yue_runtime_dir(&app)?,
            &yue_model_dir(&app)?,
            "yue_generate.py",
            &request,
            prompt,
            duration_seconds,
            seed,
            &output_path,
            &stop_flag,
        )?;
    } else if request.model_id == FIGARO_MODEL_ID {
        run_generic_creative_generate(
            "FIGARO",
            &figaro_runtime_dir(&app)?,
            &figaro_model_dir(&app)?,
            "figaro_generate.py",
            &request,
            prompt,
            duration_seconds,
            seed,
            &output_path,
            &stop_flag,
        )?;
    } else {
        let runtime_dir = stable_audio3_runtime_dir(&app)?;
        if !stable_audio3_python_path(&runtime_dir).exists()
            || !runtime_dir.join("scripts").join("sa3_mlx.py").exists()
        {
            return Err(
                "Stable Audio 3 is not installed yet. Download a Creative Audio model first."
                    .to_string(),
            );
        }
        if !stable_audio3_mode_ready(&runtime_dir, request.mode) {
            return Err(format!(
                "{} weights are not ready. Download this Creative Audio model before generating.",
                request.mode.label()
            ));
        }
        run_stable_audio3_generate(
            &runtime_dir,
            &request,
            prompt,
            duration_seconds,
            seed,
            &output_path,
            &stop_flag,
        )?;
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&output_path);
        return Err("Sound generation was cancelled.".to_string());
    }
    if !output_path.exists() {
        return Err(format!(
            "{} finished without creating an output WAV.",
            model.label
        ));
    }
    let duration_ms = wav_duration_ms(&output_path).unwrap_or(duration_seconds * 1000);
    let sample_rate_hz = wav_sample_rate_hz(&output_path).unwrap_or(44_100);
    let output_path_string = output_path.to_string_lossy().to_string();
    let item = StoryAudioItem {
        id: request.render_id,
        kind: StoryAudioKind::Sound,
        project_id: request.project_id.as_deref().map(sanitize_project_id),
        title,
        script_text: format!("{} prompt (seed {seed}): {prompt}", request.mode.label()),
        line_instructions: Vec::new(),
        output_path: output_path_string,
        clips_path: None,
        created_at_ms: now_ms(),
        duration_ms,
        line_count: 0,
        cast_count: 0,
        generation_time_ms: elapsed_ms_u32(started),
        sample_rate_hz,
        expression_tags_used: false,
        inline_prompt_used: true,
        audio_effect: StoryAudioEffectPreset::Clean,
        sound_mode: Some(request.mode),
        source_model_id: Some(request.model_id.clone()),
        starred: false,
    };
    upsert_story_audio_item(&app, item.clone())?;
    emit_story_audio_updated(&app);
    Ok(item)
}

fn run_stable_audio3_generate(
    runtime_dir: &Path,
    request: &GenerateStorySoundRequest,
    prompt: &str,
    duration_seconds: u32,
    seed: u32,
    output_path: &Path,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let dit = request.mode.stable_audio3_dit()?;
    let decoder = request.mode.stable_audio3_decoder()?;
    let mut child = Command::new(stable_audio3_python_path(runtime_dir))
        .current_dir(runtime_dir)
        .env("PYTHONUNBUFFERED", "1")
        .env("HF_HUB_OFFLINE", "1")
        .arg("scripts/sa3_mlx.py")
        .arg("--prompt")
        .arg(prompt)
        .arg("--dit")
        .arg(dit)
        .arg("--decoder")
        .arg(decoder)
        .arg("--seconds")
        .arg(duration_seconds.to_string())
        .arg("--steps")
        .arg("8")
        .arg("--cfg")
        .arg("1.0")
        .arg("--seed")
        .arg(seed.to_string())
        .arg("--out")
        .arg(output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start Stable Audio 3: {err}"))?;

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Sound generation was cancelled.".to_string());
        }
        match child
            .try_wait()
            .map_err(|err| format!("Failed to monitor Stable Audio 3: {err}"))?
        {
            Some(_) => break,
            None => thread::sleep(Duration::from_millis(150)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed to read Stable Audio 3 output: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "Stable Audio 3 failed: {}",
            command_output_preview(&output)
        ));
    }
    Ok(())
}

fn run_ace_step_generate(
    runtime_dir: &Path,
    model_dir: &Path,
    request: &GenerateStorySoundRequest,
    prompt: &str,
    duration_seconds: u32,
    seed: u32,
    output_path: &Path,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let mut child = Command::new(ace_step_python_path(runtime_dir))
        .current_dir(runtime_dir)
        .env("PYTHONUNBUFFERED", "1")
        .env("HF_HUB_OFFLINE", "1")
        .env("ACE_STEP_MODEL_DIR", model_dir)
        .arg(ace_step_entrypoint(runtime_dir))
        .arg("--prompt")
        .arg(prompt)
        .arg("--mode")
        .arg(match request.mode {
            StorySoundMode::Song => "song",
            _ => "music",
        })
        .arg("--model-dir")
        .arg(model_dir)
        .arg("--seconds")
        .arg(duration_seconds.to_string())
        .arg("--seed")
        .arg(seed.to_string())
        .arg("--out")
        .arg(output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start ACE-Step: {err}"))?;

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Sound generation was cancelled.".to_string());
        }
        match child
            .try_wait()
            .map_err(|err| format!("Failed to monitor ACE-Step: {err}"))?
        {
            Some(_) => break,
            None => thread::sleep(Duration::from_millis(250)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed to read ACE-Step output: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "ACE-Step failed: {}",
            command_output_preview(&output)
        ));
    }
    Ok(())
}

fn run_hf_creative_generate(
    spec: &HfCreativeAudioModelSpec,
    app: &AppHandle,
    model_dir: &Path,
    request: &GenerateStorySoundRequest,
    prompt: &str,
    duration_seconds: u32,
    seed: u32,
    output_path: &Path,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if !hf_creative_audio_runtime_ready(app) {
        return Err(format!(
            "{} is missing the bundled PyTorch/MPS runtime. Download it from Creative Audio Models first.",
            spec.label
        ));
    }
    if !generic_creative_model_ready(model_dir, spec.required_model_files) {
        return Err(format!(
            "{} is not installed yet. Download it from Creative Audio Models first.",
            spec.label
        ));
    }
    let backend = match spec.backend {
        HfCreativeAudioBackend::MusicGen => "musicgen",
        HfCreativeAudioBackend::AudioLdm2 => "audioldm2",
    };
    let mut child = Command::new(hf_creative_python_path(app)?)
        .current_dir(hf_creative_runtime_dir(app)?)
        .env("PYTHONUNBUFFERED", "1")
        .env("HF_HUB_OFFLINE", "1")
        .arg(hf_creative_script_path(app)?)
        .arg("--backend")
        .arg(backend)
        .arg("--prompt")
        .arg(prompt)
        .arg("--mode")
        .arg(request.mode.label().to_ascii_lowercase())
        .arg("--model-dir")
        .arg(model_dir)
        .arg("--seconds")
        .arg(duration_seconds.to_string())
        .arg("--seed")
        .arg(seed.to_string())
        .arg("--out")
        .arg(output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start {}: {err}", spec.label))?;

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Sound generation was cancelled.".to_string());
        }
        match child
            .try_wait()
            .map_err(|err| format!("Failed to monitor {}: {err}", spec.label))?
        {
            Some(_) => break,
            None => thread::sleep(Duration::from_millis(250)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed to read {} output: {err}", spec.label))?;
    if !output.status.success() {
        return Err(format!(
            "{} failed: {}",
            spec.label,
            command_output_preview(&output)
        ));
    }
    Ok(())
}

fn run_generic_creative_generate(
    label: &str,
    runtime_dir: &Path,
    model_dir: &Path,
    entrypoint: &str,
    request: &GenerateStorySoundRequest,
    prompt: &str,
    duration_seconds: u32,
    seed: u32,
    output_path: &Path,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if !generic_creative_runtime_ready(runtime_dir, entrypoint) {
        return Err(format!(
            "{label} is not installed yet. Download it from Creative Audio Models first."
        ));
    }
    let mut child = Command::new(generic_creative_python_path(runtime_dir))
        .current_dir(runtime_dir)
        .env("PYTHONUNBUFFERED", "1")
        .env("HF_HUB_OFFLINE", "1")
        .env("CREATIVE_AUDIO_MODEL_DIR", model_dir)
        .arg(generic_creative_runtime_entrypoint(runtime_dir, entrypoint))
        .arg("--prompt")
        .arg(prompt)
        .arg("--mode")
        .arg(request.mode.label().to_ascii_lowercase())
        .arg("--model-dir")
        .arg(model_dir)
        .arg("--seconds")
        .arg(duration_seconds.to_string())
        .arg("--seed")
        .arg(seed.to_string())
        .arg("--out")
        .arg(output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start {label}: {err}"))?;

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Sound generation was cancelled.".to_string());
        }
        match child
            .try_wait()
            .map_err(|err| format!("Failed to monitor {label}: {err}"))?
        {
            Some(_) => break,
            None => thread::sleep(Duration::from_millis(250)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed to read {label} output: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "{label} failed: {}",
            command_output_preview(&output)
        ));
    }
    Ok(())
}

fn story_sound_title(mode: StorySoundMode, title: &str, prompt: &str) -> String {
    let trimmed_title = title.trim();
    if !trimmed_title.is_empty() {
        return format!("{} - {}", mode.label(), story_title_label(trimmed_title));
    }
    let prompt_title = prompt
        .split_whitespace()
        .take(8)
        .collect::<Vec<_>>()
        .join(" ");
    format!("{} - {}", mode.label(), story_title_label(&prompt_title))
}

fn random_story_sound_seed() -> u32 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    (millis & u128::from(u32::MAX)) as u32
}

fn command_output_preview(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{stderr}\n{stdout}");
    let preview = combined
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join(" ");
    if preview.is_empty() {
        format!("process exited with {}", output.status)
    } else {
        preview
    }
}

#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        let _ = fs::set_permissions(path, permissions);
    }
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) {}

fn spawn_story_render_worker_thread(app: AppHandle) {
    let thread_app = app.clone();
    match thread::Builder::new()
        .name("story-studio-render".to_string())
        .stack_size(STORY_GENERATION_STACK_BYTES)
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    warn!("Failed to start Story Studio runtime: {error}");
                    reset_story_render_worker(&thread_app, "Story Studio runtime failed to start.");
                    return;
                }
            };
            runtime.block_on(story_render_worker(thread_app));
        }) {
        Ok(_) => {}
        Err(error) => {
            warn!("Failed to start Story Studio render thread: {error}");
            reset_story_render_worker(&app, "Story Studio render thread failed to start.");
        }
    }
}

fn reset_story_render_worker(app: &AppHandle, error: &str) {
    {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        queue.worker_running = false;
        for job in queue.jobs.iter_mut().filter(|job| job.status.is_active()) {
            job.status = StoryRenderJobStatus::Failed;
            job.error = Some(error.to_string());
        }
    }
    emit_story_render_queue_updated(app);
}

async fn story_render_worker(app: AppHandle) {
    loop {
        let Some((request, stop_flag)) = take_next_story_render_job(&app) else {
            return;
        };
        let render_id = request.render_id.clone();
        let result = render_story_audio_inner(app.clone(), request, Arc::clone(&stop_flag)).await;
        match result {
            Ok(_) => {
                if stop_flag.load(Ordering::Relaxed) {
                    mark_story_render_job_cancelled(&app, &render_id);
                } else {
                    mark_story_render_job_completed(&app, &render_id);
                    emit_story_audio_updated(&app);
                    remove_story_render_job(&app, &render_id);
                }
            }
            Err(error) => {
                if stop_flag.load(Ordering::Relaxed)
                    || error.to_ascii_lowercase().contains("cancelled")
                {
                    mark_story_render_job_cancelled(&app, &render_id);
                } else {
                    mark_story_render_job_failed(&app, &render_id, error);
                }
            }
        }
    }
}

fn take_next_story_render_job(app: &AppHandle) -> Option<(StoryRenderRequest, Arc<AtomicBool>)> {
    let next = {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let Some(index) = queue
            .jobs
            .iter()
            .position(|job| job.status == StoryRenderJobStatus::Queued)
        else {
            queue.worker_running = false;
            return None;
        };
        let job = &mut queue.jobs[index];
        job.status = StoryRenderJobStatus::Rendering;
        job.started_at_ms = Some(now_ms());
        job.error = None;
        (job.request.clone(), Arc::clone(&job.stop_flag))
    };
    emit_story_render_queue_updated(app);
    Some(next)
}

fn update_story_render_job_progress(progress: &StoryRenderProgress) {
    let mut queue = STORY_RENDER_QUEUE
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    update_story_render_job_progress_locked(&mut queue, progress);
}

fn update_story_render_job_progress_locked(
    queue: &mut StoryRenderQueueState,
    progress: &StoryRenderProgress,
) {
    if let Some(job) = queue
        .jobs
        .iter_mut()
        .find(|job| job.request.render_id == progress.render_id)
    {
        if !job.status.is_active() {
            return;
        }
        job.current_line = progress.current_line;
        job.total_lines = progress.total_lines;
        job.speaker = progress.speaker.clone();
        job.status = match progress.status.as_str() {
            "assembling" => StoryRenderJobStatus::Assembling,
            "complete" => StoryRenderJobStatus::Completed,
            "rendering" | "validating" => StoryRenderJobStatus::Rendering,
            _ => job.status.clone(),
        };
    }
}

fn mark_story_render_job_completed(app: &AppHandle, render_id: &str) {
    {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if let Some(job) = queue
            .jobs
            .iter_mut()
            .find(|job| job.request.render_id == render_id)
        {
            job.status = StoryRenderJobStatus::Completed;
            job.speaker = None;
        }
    }
    emit_story_render_queue_updated(app);
}

fn remove_story_render_job(app: &AppHandle, render_id: &str) {
    {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        queue.jobs.retain(|job| job.request.render_id != render_id);
    }
    emit_story_render_queue_updated(app);
}

fn mark_story_render_job_cancelled(app: &AppHandle, render_id: &str) {
    {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if let Some(job) = queue
            .jobs
            .iter_mut()
            .find(|job| job.request.render_id == render_id)
        {
            job.status = StoryRenderJobStatus::Cancelled;
            job.speaker = None;
            job.error = None;
        }
    }
    emit_story_render_queue_updated(app);
}

fn mark_story_render_job_failed(app: &AppHandle, render_id: &str, error: String) {
    {
        let mut queue = STORY_RENDER_QUEUE
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if let Some(job) = queue
            .jobs
            .iter_mut()
            .find(|job| job.request.render_id == render_id)
        {
            job.status = StoryRenderJobStatus::Failed;
            job.speaker = None;
            job.error = Some(error);
        }
    }
    emit_story_render_queue_updated(app);
}

fn story_render_job_summaries() -> Vec<StoryRenderJobSummary> {
    let queue = STORY_RENDER_QUEUE
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    queue
        .jobs
        .iter()
        .map(|job| {
            let queue_position = if job.status == StoryRenderJobStatus::Queued {
                queue_position_for_locked(&queue, &job.request.render_id)
            } else {
                None
            };
            job.summary(queue_position)
        })
        .collect()
}

fn queue_position_for_locked(queue: &StoryRenderQueueState, render_id: &str) -> Option<u32> {
    queue
        .jobs
        .iter()
        .filter(|job| job.status == StoryRenderJobStatus::Queued)
        .position(|job| job.request.render_id == render_id)
        .and_then(|index| u32::try_from(index + 1).ok())
}

fn emit_story_render_queue_updated(app: &AppHandle) {
    let _ = app.emit("story-render-queue-updated", story_render_job_summaries());
}

#[tauri::command]
#[specta::specta]
pub async fn play_story_audio(app: AppHandle, path: String) -> Result<(), String> {
    let settings = get_settings(&app);
    let output_device = settings.selected_output_device.clone();
    let volume = settings.tts_volume.clamp(0.0, 1.0);
    let path = PathBuf::from(path);
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut active = ACTIVE_STORY_PLAYBACK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if let Some(previous_flag) = active.as_ref() {
            previous_flag.store(true, Ordering::Relaxed);
        }
        *active = Some(Arc::clone(&stop_flag));
    }

    let playback_flag = Arc::clone(&stop_flag);
    let result = tokio::task::spawn_blocking(move || {
        crate::audio_playback::play_audio_file_with_stop(
            &path,
            output_device,
            volume,
            &playback_flag,
        )
        .map_err(|err| format!("Failed to play story audio: {err}"))
    })
    .await
    .map_err(|err| format!("Story audio playback task failed: {err}"))
    .and_then(|result| result);

    let mut active = ACTIVE_STORY_PLAYBACK
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if active
        .as_ref()
        .is_some_and(|active_flag| Arc::ptr_eq(active_flag, &stop_flag))
    {
        *active = None;
    }

    result
}

#[tauri::command]
#[specta::specta]
pub fn stop_story_audio() -> Result<(), String> {
    if let Some(stop_flag) = ACTIVE_STORY_PLAYBACK
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .as_ref()
    {
        stop_flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn reveal_story_audio(path: String) -> Result<(), String> {
    reveal_path(Path::new(&path))
}

#[tauri::command]
#[specta::specta]
pub fn list_story_audio(app: AppHandle) -> Result<Vec<StoryAudioItem>, String> {
    read_story_audio_items(&app)
}

fn project_story_sounds_by_id(
    app: &AppHandle,
    project_id: &str,
) -> Result<HashMap<String, StoryAudioItem>, String> {
    Ok(read_story_audio_items(app)?
        .into_iter()
        .filter(|item| {
            item.kind == StoryAudioKind::Sound && item.project_id.as_deref() == Some(project_id)
        })
        .map(|item| (item.id.clone(), item))
        .collect())
}

#[tauri::command]
#[specta::specta]
pub fn toggle_story_audio_starred(app: AppHandle, id: String) -> Result<StoryAudioItem, String> {
    let mut items = read_story_audio_items(&app)?;
    let Some(item) = items.iter_mut().find(|item| item.id == id) else {
        return Err("Story audio item no longer exists.".to_string());
    };
    item.starred = !item.starred;
    let updated = item.clone();
    write_story_audio_items(&app, &items)?;
    emit_story_audio_updated(&app);
    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn rename_story_audio(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<StoryAudioItem, String> {
    let mut items = read_story_audio_items(&app)?;
    let Some(item) = items.iter_mut().find(|item| item.id == id) else {
        return Err("Story audio item no longer exists.".to_string());
    };
    item.title = story_title_label(&title);
    let updated = item.clone();
    write_story_audio_items(&app, &items)?;
    emit_story_audio_updated(&app);
    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn update_story_audio_title(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<StoryAudioItem, String> {
    rename_story_audio(app, id, title)
}

#[tauri::command]
#[specta::specta]
pub fn delete_story_audio(app: AppHandle, id: String) -> Result<(), String> {
    let mut items = read_story_audio_items(&app)?;
    let Some(index) = items.iter().position(|item| item.id == id) else {
        return Err("Story audio item no longer exists.".to_string());
    };
    let item = items.remove(index);
    let path = PathBuf::from(&item.output_path);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|err| format!("Failed to delete story audio file: {err}"))?;
    }
    if let Some(clips_path) = item.clips_path.as_deref() {
        let clips_path_is_still_used = items
            .iter()
            .any(|remaining| remaining.clips_path.as_deref() == Some(clips_path));
        if !clips_path_is_still_used {
            if let Some(project_dir) = Path::new(clips_path).parent() {
                let _ = fs::remove_dir_all(project_dir);
            }
        }
    }
    write_story_audio_items(&app, &items)?;
    emit_story_audio_updated(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn create_processed_story_audio(
    app: AppHandle,
    request: ProcessStoryAudioRequest,
) -> Result<StoryAudioItem, String> {
    let playback_rate = validate_story_audio_playback_rate(request.playback_rate)?;
    let output_sample_rate = validate_story_audio_sample_rate(request.sample_rate_hz)?;
    let mut items = read_story_audio_items(&app)?;
    let Some(source) = items.iter().find(|item| item.id == request.id).cloned() else {
        return Err("Story audio item no longer exists.".to_string());
    };
    let source_path = PathBuf::from(&source.output_path);
    if !source_path.exists() {
        return Err("Story audio file no longer exists.".to_string());
    }

    let source_sample_rate = wav_sample_rate_hz(&source_path).unwrap_or(source.sample_rate_hz);
    let source_samples = decode_audio_file_mono(&source_path, source_sample_rate)?;
    let sped_samples = apply_story_audio_playback_rate(&source_samples, playback_rate);
    let mut output_samples = resample_linear(&sped_samples, source_sample_rate, output_sample_rate);
    apply_story_audio_effect(
        &mut output_samples,
        output_sample_rate,
        request.audio_effect,
    );
    normalize_story_samples(&mut output_samples);

    let title = processed_story_title(
        &source.title,
        playback_rate,
        output_sample_rate,
        request.audio_effect,
    );
    let output_path = output_path_for_story(&app, &title)?;
    write_story_wav(&output_samples, output_sample_rate, &output_path)?;
    let duration_ms =
        ((output_samples.len() as f64 / output_sample_rate as f64) * 1000.0).round() as u32;
    let output_path_string = output_path.to_string_lossy().to_string();
    let processed = StoryAudioItem {
        id: Uuid::new_v4().to_string(),
        kind: source.kind,
        project_id: source.project_id,
        title,
        script_text: source.script_text,
        line_instructions: source.line_instructions,
        output_path: output_path_string,
        clips_path: None,
        created_at_ms: now_ms(),
        duration_ms,
        line_count: source.line_count,
        cast_count: source.cast_count,
        generation_time_ms: source.generation_time_ms,
        sample_rate_hz: output_sample_rate,
        expression_tags_used: source.expression_tags_used,
        inline_prompt_used: source.inline_prompt_used,
        audio_effect: request.audio_effect,
        sound_mode: source.sound_mode,
        source_model_id: source.source_model_id,
        starred: false,
    };
    items.push(processed.clone());
    write_story_audio_items(&app, &items)?;
    emit_story_audio_updated(&app);
    Ok(processed)
}

async fn render_story_audio_inner(
    app: AppHandle,
    request: StoryRenderRequest,
    stop_flag: Arc<AtomicBool>,
) -> Result<StoryRenderResult, String> {
    let render_started_at = Instant::now();
    let settings = get_settings(&app);
    let preset_by_id = settings
        .tts_voice_presets
        .into_iter()
        .map(|preset| (preset.id.clone(), preset))
        .collect::<HashMap<_, _>>();
    let cast = validate_cast(&request.cast, &preset_by_id)?;
    let lines = parse_script_for_render(&request.script_text)?;
    validate_render_script_speakers(&lines, &cast)?;
    let project_id = sanitize_project_id(
        request
            .project_id
            .as_deref()
            .unwrap_or(request.render_id.as_str()),
    );
    let story_sounds = project_story_sounds_by_id(&app, &project_id)?;
    validate_render_sound_cues(&lines, &story_sounds)?;
    let line_instructions = normalize_line_instructions(&request.line_instructions);
    let expression_tags_used = lines.iter().any(|line| {
        line.parts.iter().any(|part| match part {
            StoryScriptPart::Text(text) => contains_expression_tag(text),
            StoryScriptPart::Sound(_) => false,
        })
    });
    let inline_prompt_used = !line_instructions.is_empty();
    let project_dir = story_project_dir(&app, &project_id)?;
    let clips_dir = project_dir.join("clips");
    fs::create_dir_all(&clips_dir)
        .map_err(|err| format!("Failed to create story clip directory: {err}"))?;
    let existing_clips = read_story_project_metadata(&project_dir)
        .map(|metadata| {
            metadata
                .clips
                .into_iter()
                .filter(|clip| Path::new(&clip.file_path).exists())
                .map(|clip| (clip.hash.clone(), clip))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();

    let total_lines = lines.len() as u32;
    emit_progress(&app, &request.render_id, 0, total_lines, None, "validating");

    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    let mut timeline_events: Vec<StoryTimelineEvent> = Vec::new();
    let mut clips: Vec<StoryClipMetadata> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if stop_flag.load(Ordering::Relaxed) {
            return Err("Story rendering was cancelled.".to_string());
        }

        emit_progress(
            &app,
            &request.render_id,
            index as u32 + 1,
            total_lines,
            line.speaker.clone(),
            "rendering",
        );

        let line_number = index as u32 + 1;
        for (part_index, part) in line.parts.iter().enumerate() {
            match part {
                StoryScriptPart::Sound(cue) => {
                    let sound = story_sounds.get(&cue.sound_id).ok_or_else(|| {
                        format!("Sound '{}' is not in this project's Sound list.", cue.title)
                    })?;
                    let path = PathBuf::from(&sound.output_path);
                    if !path.exists() {
                        return Err(format!("Sound '{}' file is missing.", sound.title));
                    }
                    timeline_events.push(StoryTimelineEvent::Audio {
                        files: vec![path.clone()],
                        clip_index: None,
                        cue: Some(ResolvedStorySoundCue {
                            sound_id: sound.id.clone(),
                            title: sound.title.clone(),
                            mode: cue.mode,
                            path,
                        }),
                        advances_cursor: cue.mode == StorySoundCueMode::Insert,
                    });
                }
                StoryScriptPart::Text(text) => {
                    let Some(speaker) = line.speaker.as_deref() else {
                        return Err(format!(
                            "Line {} needs the format 'Character: dialogue'.",
                            line_number
                        ));
                    };
                    let mut preset = cast
                        .get(&normalize_name(speaker))
                        .ok_or_else(|| format!("No voice is assigned to '{}'.", speaker))?
                        .clone();
                    if let Some(instruction) = line_instructions.get(&line_number) {
                        preset.tuning.style_instructions = Some(instruction.clone());
                    }
                    let hash_line = StoryScriptLine {
                        speaker: speaker.to_string(),
                        text: text.clone(),
                    };
                    let line_hash =
                        story_line_hash(line_number + part_index as u32, &hash_line, &preset);
                    let clip_index = clips.len();
                    if let Some(existing_clip) = existing_clips.get(&line_hash) {
                        timeline_events.push(StoryTimelineEvent::Audio {
                            files: vec![PathBuf::from(&existing_clip.file_path)],
                            clip_index: Some(clip_index),
                            cue: None,
                            advances_cursor: true,
                        });
                        clips.push(StoryClipMetadata {
                            id: existing_clip.id.clone(),
                            line_number,
                            speaker: speaker.to_string(),
                            text: text.clone(),
                            hash: line_hash,
                            file_path: existing_clip.file_path.clone(),
                            duration_ms: existing_clip.duration_ms,
                            offset_ms: 0,
                            waveform_peaks: existing_clip.waveform_peaks.clone(),
                        });
                        continue;
                    }
                    let files = manager
                        .synthesize_to_temp_files(
                            SpeakRequest {
                                text: text.clone(),
                                locale: preset.locale_snapshot.clone(),
                                preferred_voice_id: preset.voice_id.clone(),
                                preset_id: None,
                                inline_preset: Some(preset),
                                trigger: Some("story_studio".to_string()),
                                remember_last_output: false,
                            },
                            Arc::clone(&stop_flag),
                        )
                        .await?;
                    let clip_path = clips_dir.join(format!(
                        "line-{line_number}-part-{part_index}-{}.wav",
                        &line_hash[..12]
                    ));
                    let (duration_ms, waveform_peaks) =
                        assemble_story_line_clip(&files, &clip_path)?;
                    cleanup_files(&files);
                    timeline_events.push(StoryTimelineEvent::Audio {
                        files: vec![clip_path.clone()],
                        clip_index: Some(clip_index),
                        cue: None,
                        advances_cursor: true,
                    });
                    clips.push(StoryClipMetadata {
                        id: format!("line-{line_number}-part-{part_index}-{}", &line_hash[..12]),
                        line_number,
                        speaker: speaker.to_string(),
                        text: text.clone(),
                        hash: line_hash,
                        file_path: clip_path.to_string_lossy().to_string(),
                        duration_ms,
                        offset_ms: 0,
                        waveform_peaks,
                    });
                }
            }
        }
        if index + 1 < lines.len() {
            timeline_events.push(StoryTimelineEvent::Pause(
                request.pause_ms_between_lines.clamp(0, 10_000),
            ));
        }
    }

    if stop_flag.load(Ordering::Relaxed) {
        return Err("Story rendering was cancelled.".to_string());
    }

    emit_progress(
        &app,
        &request.render_id,
        total_lines,
        total_lines,
        None,
        "assembling",
    );

    let output_path = output_path_for_story(&app, &request.title)?;
    let (duration_ms, clip_timing, sound_cues) = assemble_story_timeline_with_effect(
        &timeline_events,
        &output_path,
        &stop_flag,
        request.audio_effect,
    )?;
    for (clip_index, timing) in clip_timing {
        if let Some(clip) = clips.get_mut(clip_index) {
            clip.offset_ms = timing.offset_ms;
            clip.duration_ms = timing.duration_ms;
            if clip.waveform_peaks.is_empty() {
                clip.waveform_peaks = timing.waveform_peaks;
            }
        }
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&output_path);
        return Err("Story rendering was cancelled.".to_string());
    }

    emit_progress(
        &app,
        &request.render_id,
        total_lines,
        total_lines,
        None,
        "complete",
    );

    let output_path = output_path.to_string_lossy().to_string();
    let project_metadata = StoryProjectMetadata {
        project_id: project_id.clone(),
        render_id: request.render_id.clone(),
        title: story_title_label(&request.title),
        output_path: output_path.clone(),
        pause_ms_between_lines: request.pause_ms_between_lines.clamp(0, 10_000),
        audio_effect: request.audio_effect,
        sample_rate_hz: STORY_SAMPLE_RATE,
        clips,
        sound_cues,
    };
    let clips_path = write_story_project_metadata(&project_dir, &project_metadata)?;
    let result = StoryRenderResult {
        render_id: request.render_id.clone(),
        output_path: output_path.clone(),
        duration_ms,
        line_count: total_lines,
    };
    upsert_story_audio_item(
        &app,
        StoryAudioItem {
            id: request.render_id,
            kind: StoryAudioKind::StoryRender,
            project_id: Some(project_id),
            title: story_title_label(&request.title),
            script_text: request.script_text,
            line_instructions: request.line_instructions,
            output_path,
            clips_path: Some(clips_path.to_string_lossy().to_string()),
            created_at_ms: now_ms(),
            duration_ms,
            line_count: total_lines,
            cast_count: request.cast.len() as u32,
            generation_time_ms: elapsed_ms_u32(render_started_at),
            sample_rate_hz: STORY_SAMPLE_RATE,
            expression_tags_used,
            inline_prompt_used,
            audio_effect: request.audio_effect,
            sound_mode: None,
            source_model_id: None,
            starred: false,
        },
    )?;

    Ok(result)
}

fn normalize_line_instructions(
    instructions: &[StoryLineInstructionOverride],
) -> HashMap<u32, String> {
    instructions
        .iter()
        .filter_map(|instruction| {
            let value = instruction.style_instructions.trim();
            if instruction.line_number == 0 || value.is_empty() {
                None
            } else {
                Some((instruction.line_number, value.to_string()))
            }
        })
        .collect()
}

fn contains_expression_tag(text: &str) -> bool {
    contains_balanced_marker(text, '[', ']') || contains_balanced_marker(text, '(', ')')
}

fn contains_balanced_marker(text: &str, open: char, close: char) -> bool {
    let mut started = false;
    let mut has_content = false;
    for ch in text.chars() {
        if !started {
            started = ch == open;
            has_content = false;
            continue;
        }
        if ch == close {
            if has_content {
                return true;
            }
            started = false;
            continue;
        }
        has_content |= !ch.is_whitespace();
    }
    false
}

fn emit_progress(
    app: &AppHandle,
    render_id: &str,
    current_line: u32,
    total_lines: u32,
    speaker: Option<String>,
    status: &str,
) {
    let progress = StoryRenderProgress {
        render_id: render_id.to_string(),
        current_line,
        total_lines,
        speaker,
        status: status.to_string(),
    };
    update_story_render_job_progress(&progress);
    let _ = app.emit("story-render-progress", progress);
    emit_story_render_queue_updated(app);
}

fn validate_cast(
    cast: &[StoryCastMember],
    preset_by_id: &HashMap<String, TtsVoicePreset>,
) -> Result<HashMap<String, TtsVoicePreset>, String> {
    if cast.is_empty() {
        return Err("Add at least one character before rendering.".to_string());
    }

    let mut seen = HashSet::new();
    let mut resolved = HashMap::new();
    for member in cast {
        let name = member.character_name.trim();
        if name.is_empty() {
            return Err("Every cast member needs a character name.".to_string());
        }
        let normalized = normalize_name(name);
        if !seen.insert(normalized.clone()) {
            return Err(format!("Duplicate character name '{}'.", name));
        }
        let preset = preset_by_id
            .get(member.preset_id.trim())
            .ok_or_else(|| format!("Voice preset for '{}' is no longer available.", name))?;
        resolved.insert(normalized, preset.clone());
    }
    Ok(resolved)
}

#[cfg(test)]
pub fn parse_script(script_text: &str) -> Result<Vec<StoryScriptLine>, String> {
    let mut lines = Vec::new();
    for (index, raw_line) in script_text.lines().enumerate() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((speaker, text)) = trimmed.split_once(':') else {
            return Err(format!(
                "Line {} needs the format 'Character: dialogue'.",
                index + 1
            ));
        };
        let speaker = speaker.trim();
        let text = text.trim();
        if speaker.is_empty() || text.is_empty() {
            return Err(format!(
                "Line {} needs both a character and dialogue.",
                index + 1
            ));
        }
        lines.push(StoryScriptLine {
            speaker: speaker.to_string(),
            text: text.to_string(),
        });
    }

    if lines.is_empty() {
        return Err("Write at least one script line before rendering.".to_string());
    }
    Ok(lines)
}

fn parse_script_for_render(script_text: &str) -> Result<Vec<StoryRenderScriptLine>, String> {
    let mut lines = Vec::new();
    for (index, raw_line) in script_text.lines().enumerate() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some((speaker, text)) = trimmed.split_once(':') {
            let speaker = speaker.trim();
            if speaker.is_empty() {
                return Err(format!(
                    "Line {} needs both a character and dialogue.",
                    index + 1
                ));
            }
            let parts = parse_script_parts(text.trim(), index + 1)?;
            if parts.is_empty() {
                return Err(format!("Line {} needs dialogue or a sound tag.", index + 1));
            }
            lines.push(StoryRenderScriptLine {
                speaker: Some(speaker.to_string()),
                parts,
            });
            continue;
        }

        let parts = parse_script_parts(trimmed, index + 1)?;
        if parts.is_empty()
            || parts
                .iter()
                .any(|part| matches!(part, StoryScriptPart::Text(_)))
        {
            return Err(format!(
                "Line {} needs the format 'Character: dialogue' unless it contains only sound tags.",
                index + 1
            ));
        }
        lines.push(StoryRenderScriptLine {
            speaker: None,
            parts,
        });
    }

    if lines.is_empty() {
        return Err("Write at least one script line before rendering.".to_string());
    }
    Ok(lines)
}

fn parse_script_parts(text: &str, line_number: usize) -> Result<Vec<StoryScriptPart>, String> {
    let mut parts = Vec::new();
    let mut cursor = 0;
    for capture in STORY_SOUND_TAG_RE.captures_iter(text) {
        let Some(full_match) = capture.get(0) else {
            continue;
        };
        if full_match.start() > cursor {
            let chunk = text[cursor..full_match.start()].trim();
            if !chunk.is_empty() {
                parts.push(StoryScriptPart::Text(chunk.to_string()));
            }
        }
        let attrs = capture.get(1).map(|value| value.as_str()).unwrap_or("");
        parts.push(StoryScriptPart::Sound(parse_sound_tag_attrs(
            attrs,
            line_number,
        )?));
        cursor = full_match.end();
    }

    if cursor < text.len() {
        let chunk = text[cursor..].trim();
        if !chunk.is_empty() {
            parts.push(StoryScriptPart::Text(chunk.to_string()));
        }
    }

    Ok(parts)
}

fn parse_sound_tag_attrs(attrs: &str, line_number: usize) -> Result<StoryParsedSoundCue, String> {
    let mut values = HashMap::new();
    for capture in STORY_SOUND_TAG_ATTR_RE.captures_iter(attrs) {
        let key = capture.get(1).map(|value| value.as_str()).unwrap_or("");
        let value = capture.get(2).map(|value| value.as_str()).unwrap_or("");
        values.insert(key.to_ascii_lowercase(), value.to_string());
    }
    let sound_id = values
        .get("id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Line {line_number} has a sound tag without an id."))?;
    let mode = match values
        .get("mode")
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("insert") | None => StorySoundCueMode::Insert,
        Some("overlay") => StorySoundCueMode::Overlay,
        Some(other) => {
            return Err(format!(
                "Line {line_number} has an unsupported sound tag mode '{other}'."
            ))
        }
    };
    let title = values
        .get("title")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(sound_id)
        .to_string();

    Ok(StoryParsedSoundCue {
        sound_id: sound_id.to_string(),
        title,
        mode,
    })
}

fn validate_render_script_speakers(
    lines: &[StoryRenderScriptLine],
    cast: &HashMap<String, TtsVoicePreset>,
) -> Result<(), String> {
    for line in lines {
        let Some(speaker) = line.speaker.as_deref() else {
            continue;
        };
        if !cast.contains_key(&normalize_name(speaker)) {
            return Err(format!(
                "'{}' appears in the script but is not in the cast.",
                speaker
            ));
        }
    }
    Ok(())
}

fn validate_render_sound_cues(
    lines: &[StoryRenderScriptLine],
    story_sounds: &HashMap<String, StoryAudioItem>,
) -> Result<(), String> {
    for line in lines {
        for part in &line.parts {
            let StoryScriptPart::Sound(cue) = part else {
                continue;
            };
            let sound = story_sounds.get(&cue.sound_id).ok_or_else(|| {
                format!("Sound '{}' is not in this project's Sound list.", cue.title)
            })?;
            if !Path::new(&sound.output_path).exists() {
                return Err(format!("Sound '{}' file is missing.", sound.title));
            }
        }
    }
    Ok(())
}

fn normalize_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn story_audio_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = crate::portable::app_data_dir(app)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let stories_dir = app_data_dir.join("stories");
    std::fs::create_dir_all(&stories_dir)
        .map_err(|err| format!("Failed to create stories directory: {err}"))?;
    Ok(stories_dir)
}

fn story_project_dir(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let project_id = sanitize_project_id(project_id);
    let dir = story_audio_dir(app)?.join("projects").join(project_id);
    fs::create_dir_all(&dir).map_err(|err| format!("Failed to create story project: {err}"))?;
    Ok(dir)
}

fn story_audio_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(story_audio_dir(app)?.join("story-audio-index.json"))
}

fn story_project_metadata_path(project_dir: &Path) -> PathBuf {
    project_dir.join("clips.json")
}

fn read_story_project_metadata(project_dir: &Path) -> Result<StoryProjectMetadata, String> {
    let path = story_project_metadata_path(project_dir);
    let bytes =
        fs::read(&path).map_err(|err| format!("Failed to read story clip metadata: {err}"))?;
    serde_json::from_slice::<StoryProjectMetadata>(&bytes)
        .map_err(|err| format!("Failed to parse story clip metadata: {err}"))
}

fn write_story_project_metadata(
    project_dir: &Path,
    metadata: &StoryProjectMetadata,
) -> Result<PathBuf, String> {
    let path = story_project_metadata_path(project_dir);
    let bytes = serde_json::to_vec_pretty(metadata)
        .map_err(|err| format!("Failed to serialize story clip metadata: {err}"))?;
    fs::write(&path, bytes).map_err(|err| format!("Failed to write story clip metadata: {err}"))?;
    Ok(path)
}

fn output_path_for_story(app: &AppHandle, title: &str) -> Result<PathBuf, String> {
    let stories_dir = story_audio_dir(app)?;
    let title = sanitize_file_stem(title)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Story Studio".to_string());
    Ok(stories_dir.join(format!("{title}-{}.wav", Uuid::new_v4())))
}

fn read_story_audio_items(app: &AppHandle) -> Result<Vec<StoryAudioItem>, String> {
    let mut items = read_story_audio_index(app)?;
    let mut seen_paths = items
        .iter()
        .map(|item| item.output_path.clone())
        .collect::<HashSet<_>>();
    let mut changed = false;
    for item in discover_story_audio_files(app)? {
        if seen_paths.insert(item.output_path.clone()) {
            items.push(item);
            changed = true;
        }
    }
    let before_retain = items.len();
    items.retain(|item| Path::new(&item.output_path).exists());
    changed |= items.len() != before_retain;
    sort_story_audio_items(&mut items);
    if changed {
        write_story_audio_items(app, &items)?;
    }
    Ok(items)
}

fn read_story_audio_index(app: &AppHandle) -> Result<Vec<StoryAudioItem>, String> {
    let path = story_audio_index_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes =
        fs::read(&path).map_err(|err| format!("Failed to read story audio index: {err}"))?;
    serde_json::from_slice::<Vec<StoryAudioItem>>(&bytes)
        .map_err(|err| format!("Failed to parse story audio index: {err}"))
}

fn write_story_audio_items(app: &AppHandle, items: &[StoryAudioItem]) -> Result<(), String> {
    let mut items = items.to_vec();
    sort_story_audio_items(&mut items);
    let path = story_audio_index_path(app)?;
    let bytes = serde_json::to_vec_pretty(&items)
        .map_err(|err| format!("Failed to serialize story audio index: {err}"))?;
    fs::write(path, bytes).map_err(|err| format!("Failed to write story audio index: {err}"))
}

fn upsert_story_audio_item(app: &AppHandle, item: StoryAudioItem) -> Result<(), String> {
    let mut items = read_story_audio_items(app)?;
    items.retain(|current| current.id != item.id && current.output_path != item.output_path);
    items.push(item);
    write_story_audio_items(app, &items)
}

fn discover_story_audio_files(app: &AppHandle) -> Result<Vec<StoryAudioItem>, String> {
    let stories_dir = story_audio_dir(app)?;
    let mut items = Vec::new();
    for entry in fs::read_dir(stories_dir)
        .map_err(|err| format!("Failed to read story audio directory: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Failed to read story audio entry: {err}"))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("wav") {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|err| format!("Failed to inspect story audio file: {err}"))?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("story-audio.wav")
            .to_string();
        let title = path
            .file_stem()
            .and_then(|name| name.to_str())
            .map(story_title_from_file_stem)
            .unwrap_or_else(|| "Untitled Story".to_string());
        items.push(StoryAudioItem {
            id: format!("file:{file_name}"),
            kind: StoryAudioKind::StoryRender,
            project_id: None,
            title,
            script_text: String::new(),
            line_instructions: Vec::new(),
            output_path: path.to_string_lossy().to_string(),
            clips_path: None,
            created_at_ms: metadata_time_ms(&metadata),
            duration_ms: wav_duration_ms(&path).unwrap_or(0),
            line_count: 0,
            cast_count: 0,
            generation_time_ms: 0,
            sample_rate_hz: wav_sample_rate_hz(&path).unwrap_or(STORY_SAMPLE_RATE),
            expression_tags_used: false,
            inline_prompt_used: false,
            audio_effect: StoryAudioEffectPreset::Clean,
            sound_mode: None,
            source_model_id: None,
            starred: false,
        });
    }
    Ok(items)
}

fn sort_story_audio_items(items: &mut [StoryAudioItem]) {
    items.sort_by(|left, right| {
        right
            .starred
            .cmp(&left.starred)
            .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
    });
}

fn story_title_label(title: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        "Untitled Story".to_string()
    } else {
        title.to_string()
    }
}

fn story_title_from_file_stem(stem: &str) -> String {
    let without_uuid = stem
        .rsplit_once('-')
        .map(|(prefix, suffix)| {
            if Uuid::parse_str(suffix).is_ok() {
                prefix
            } else {
                stem
            }
        })
        .unwrap_or(stem);
    let title = without_uuid.replace('-', " ");
    story_title_label(&title)
}

fn metadata_time_ms(metadata: &fs::Metadata) -> i64 {
    metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()
        .and_then(system_time_ms)
        .unwrap_or_else(now_ms)
}

fn system_time_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn now_ms() -> i64 {
    system_time_ms(SystemTime::now()).unwrap_or(0)
}

fn elapsed_ms_u32(started_at: Instant) -> u32 {
    u32::try_from(started_at.elapsed().as_millis()).unwrap_or(u32::MAX)
}

fn default_story_sample_rate() -> u32 {
    STORY_SAMPLE_RATE
}

fn wav_sample_rate_hz(path: &Path) -> Result<u32, String> {
    let reader = hound::WavReader::open(path)
        .map_err(|err| format!("Failed to read story WAV metadata: {err}"))?;
    Ok(reader.spec().sample_rate)
}

fn wav_duration_ms(path: &Path) -> Result<u32, String> {
    let reader = hound::WavReader::open(path)
        .map_err(|err| format!("Failed to read story WAV metadata: {err}"))?;
    let spec = reader.spec();
    if spec.sample_rate == 0 || spec.channels == 0 {
        return Ok(0);
    }
    let frames = reader.duration() as f64;
    Ok(((frames / f64::from(spec.sample_rate)) * 1000.0).round() as u32)
}

fn emit_story_audio_updated(app: &AppHandle) {
    let _ = app.emit("story-audio-updated", ());
}

fn sanitize_file_stem(value: &str) -> Option<String> {
    let sanitized = value
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_' || *ch == ' ')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    Some(sanitized).filter(|value| !value.is_empty())
}

fn sanitize_project_id(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    if sanitized.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        sanitized
    }
}

fn assemble_story_wav(
    line_files: &[Vec<PathBuf>],
    pause_ms_between_lines: u32,
    output_path: &Path,
    stop_flag: &AtomicBool,
) -> Result<u32, String> {
    let (duration_ms, _) = assemble_story_wav_with_effect(
        line_files,
        pause_ms_between_lines,
        output_path,
        stop_flag,
        StoryAudioEffectPreset::Clean,
    )?;
    Ok(duration_ms)
}

#[derive(Debug, Clone)]
struct StoryClipTiming {
    duration_ms: u32,
    offset_ms: u32,
    waveform_peaks: Vec<f32>,
}

fn assemble_story_wav_with_effect(
    line_files: &[Vec<PathBuf>],
    pause_ms_between_lines: u32,
    output_path: &Path,
    stop_flag: &AtomicBool,
    effect: StoryAudioEffectPreset,
) -> Result<(u32, Vec<StoryClipTiming>), String> {
    if line_files.is_empty() {
        return Err("No rendered audio was produced.".to_string());
    }

    let mut events = Vec::new();
    for (index, files) in line_files.iter().enumerate() {
        events.push(StoryTimelineEvent::Audio {
            files: files.clone(),
            clip_index: Some(index),
            cue: None,
            advances_cursor: true,
        });
        if index + 1 < line_files.len() && pause_ms_between_lines > 0 {
            events.push(StoryTimelineEvent::Pause(pause_ms_between_lines));
        }
    }

    let (duration_ms, clip_timing, _) =
        assemble_story_timeline_with_effect(&events, output_path, stop_flag, effect)?;
    let mut timings = vec![
        StoryClipTiming {
            duration_ms: 0,
            offset_ms: 0,
            waveform_peaks: Vec::new(),
        };
        line_files.len()
    ];
    for (index, timing) in clip_timing {
        if let Some(slot) = timings.get_mut(index) {
            *slot = timing;
        }
    }
    Ok((duration_ms, timings))
}

fn assemble_story_timeline_with_effect(
    events: &[StoryTimelineEvent],
    output_path: &Path,
    stop_flag: &AtomicBool,
    effect: StoryAudioEffectPreset,
) -> Result<
    (
        u32,
        Vec<(usize, StoryClipTiming)>,
        Vec<StorySoundCueMetadata>,
    ),
    String,
> {
    if events.is_empty() {
        return Err("No rendered audio was produced.".to_string());
    }

    let mut samples = Vec::new();
    let mut cursor = 0usize;
    let mut timings = Vec::new();
    let mut sound_cues = Vec::new();
    for event in events {
        if stop_flag.load(Ordering::Relaxed) {
            return Err("Story rendering was cancelled.".to_string());
        }

        match event {
            StoryTimelineEvent::Pause(pause_ms) => {
                let silence_len = (STORY_SAMPLE_RATE as u64 * *pause_ms as u64 / 1000) as usize;
                cursor = cursor.saturating_add(silence_len);
                if samples.len() < cursor {
                    samples.resize(cursor, 0.0);
                }
            }
            StoryTimelineEvent::Audio {
                files,
                clip_index,
                cue,
                advances_cursor,
            } => {
                let offset_ms =
                    ((cursor as f64 / STORY_SAMPLE_RATE as f64) * 1000.0).round() as u32;
                let mut event_samples = Vec::new();
                for path in files {
                    let mut decoded = decode_audio_file_mono(path, STORY_SAMPLE_RATE)?;
                    event_samples.append(&mut decoded);
                }
                let gain = if cue
                    .as_ref()
                    .is_some_and(|cue| cue.mode == StorySoundCueMode::Overlay)
                {
                    STORY_SOUND_OVERLAY_GAIN
                } else {
                    1.0
                };
                mix_samples_at(&mut samples, cursor, &event_samples, gain);
                let duration_ms = ((event_samples.len() as f64 / STORY_SAMPLE_RATE as f64) * 1000.0)
                    .round() as u32;
                if let Some(index) = clip_index {
                    timings.push((
                        *index,
                        StoryClipTiming {
                            duration_ms,
                            offset_ms,
                            waveform_peaks: waveform_peaks(&event_samples, STORY_WAVEFORM_PEAKS),
                        },
                    ));
                }
                if let Some(cue) = cue {
                    sound_cues.push(StorySoundCueMetadata {
                        sound_id: cue.sound_id.clone(),
                        title: cue.title.clone(),
                        mode: cue.mode,
                        output_path: cue.path.to_string_lossy().to_string(),
                        offset_ms,
                        duration_ms,
                    });
                }
                if *advances_cursor {
                    cursor = cursor.saturating_add(event_samples.len());
                }
            }
        }
    }

    apply_story_audio_effect(&mut samples, STORY_SAMPLE_RATE, effect);
    normalize_story_samples(&mut samples);

    write_story_wav(&samples, STORY_SAMPLE_RATE, output_path)?;

    let duration_ms = ((samples.len() as f64 / STORY_SAMPLE_RATE as f64) * 1000.0).round() as u32;
    Ok((duration_ms, timings, sound_cues))
}

fn mix_samples_at(target: &mut Vec<f32>, start: usize, source: &[f32], gain: f32) {
    let required_len = start.saturating_add(source.len());
    if target.len() < required_len {
        target.resize(required_len, 0.0);
    }
    for (index, sample) in source.iter().enumerate() {
        target[start + index] += sample * gain;
    }
}

fn assemble_story_line_clip(
    source_files: &[PathBuf],
    output_path: &Path,
) -> Result<(u32, Vec<f32>), String> {
    let mut samples = Vec::new();
    for path in source_files {
        let mut decoded = decode_audio_file_mono(path, STORY_SAMPLE_RATE)?;
        samples.append(&mut decoded);
    }
    normalize_story_samples(&mut samples);
    write_story_wav(&samples, STORY_SAMPLE_RATE, output_path)?;
    let duration_ms = ((samples.len() as f64 / STORY_SAMPLE_RATE as f64) * 1000.0).round() as u32;
    Ok((duration_ms, waveform_peaks(&samples, STORY_WAVEFORM_PEAKS)))
}

fn validate_story_audio_playback_rate(value: f32) -> Result<f32, String> {
    if !value.is_finite() {
        return Err("Playback speed must be a finite number.".to_string());
    }
    let rounded = (value * 100.0).round() / 100.0;
    const SUPPORTED: &[f32] = &[0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    if SUPPORTED
        .iter()
        .any(|supported| (rounded - supported).abs() < 0.001)
    {
        Ok(rounded)
    } else {
        Err("Choose a supported playback speed.".to_string())
    }
}

fn validate_story_audio_sample_rate(value: u32) -> Result<u32, String> {
    match value {
        16_000 | 24_000 | 44_100 | 48_000 => Ok(value),
        _ => Err("Choose a supported sample rate.".to_string()),
    }
}

fn processed_story_title(
    title: &str,
    playback_rate: f32,
    sample_rate_hz: u32,
    effect: StoryAudioEffectPreset,
) -> String {
    let effect_label = match effect {
        StoryAudioEffectPreset::Clean => None,
        StoryAudioEffectPreset::VoicePolish => Some("voice polish"),
        StoryAudioEffectPreset::Radio => Some("radio"),
        StoryAudioEffectPreset::WarmRoom => Some("warm room"),
    };
    let suffix = match effect_label {
        Some(effect_label) => format!(
            "processed {}x {} {}",
            format_story_playback_rate(playback_rate),
            format_story_sample_rate(sample_rate_hz),
            effect_label
        ),
        None => format!(
            "processed {}x {}",
            format_story_playback_rate(playback_rate),
            format_story_sample_rate(sample_rate_hz)
        ),
    };
    format!("{} ({})", story_title_label(title), suffix)
}

fn format_story_playback_rate(value: f32) -> String {
    if (value.fract()).abs() < 0.001 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

fn format_story_sample_rate(sample_rate_hz: u32) -> String {
    if sample_rate_hz.is_multiple_of(1000) {
        format!("{} kHz", sample_rate_hz / 1000)
    } else {
        format!("{:.1} kHz", sample_rate_hz as f32 / 1000.0)
    }
}

fn normalize_story_samples(samples: &mut [f32]) {
    let peak = samples
        .iter()
        .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
    if peak > STORY_PEAK_TARGET {
        let scale = STORY_PEAK_TARGET / peak;
        for sample in samples {
            *sample *= scale;
        }
    }
}

fn story_line_hash(_line_number: u32, line: &StoryScriptLine, preset: &TtsVoicePreset) -> String {
    let payload = serde_json::json!({
        "sample_rate": STORY_SAMPLE_RATE,
        "speaker": line.speaker,
        "text": line.text,
        "provider_id": preset.provider_id,
        "model_id": preset.model_id,
        "voice_id": preset.voice_id,
        "voice_profile_id": preset.voice_profile_id,
        "locale": preset.locale_snapshot,
        "tuning": preset.tuning,
    });
    let mut hasher = Sha256::new();
    hasher.update(payload.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

fn waveform_peaks(samples: &[f32], peak_count: usize) -> Vec<f32> {
    if samples.is_empty() || peak_count == 0 {
        return Vec::new();
    }
    let chunk_len = samples.len().div_ceil(peak_count).max(1);
    samples
        .chunks(chunk_len)
        .map(|chunk| {
            chunk
                .iter()
                .fold(0.0_f32, |peak, sample| peak.max(sample.abs()))
                .min(1.0)
        })
        .collect()
}

fn apply_story_audio_effect(samples: &mut [f32], sample_rate: u32, effect: StoryAudioEffectPreset) {
    if samples.is_empty() {
        return;
    }
    match effect {
        StoryAudioEffectPreset::Clean => {}
        StoryAudioEffectPreset::VoicePolish => {
            apply_biquad(samples, Biquad::high_pass(sample_rate as f32, 90.0, 0.707));
            apply_soft_knee_compressor(samples, 0.32, 0.16, 2.8, 1.18);
            apply_limiter(samples, 0.94);
        }
        StoryAudioEffectPreset::Radio => {
            apply_biquad(samples, Biquad::high_pass(sample_rate as f32, 180.0, 0.707));
            apply_biquad(
                samples,
                Biquad::low_pass(sample_rate as f32, 3_800.0, 0.707),
            );
            apply_soft_knee_compressor(samples, 0.22, 0.18, 4.2, 1.35);
            apply_limiter(samples, 0.92);
        }
        StoryAudioEffectPreset::WarmRoom => {
            apply_biquad(samples, Biquad::high_pass(sample_rate as f32, 75.0, 0.707));
            apply_soft_knee_compressor(samples, 0.34, 0.18, 2.3, 1.12);
            apply_short_room_tail(samples, sample_rate, 0.11);
            apply_limiter(samples, 0.94);
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl Biquad {
    fn high_pass(sample_rate: f32, cutoff_hz: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * cutoff_hz / sample_rate;
        let cos_omega = omega.cos();
        let alpha = omega.sin() / (2.0 * q);
        let b0 = (1.0 + cos_omega) / 2.0;
        let b1 = -(1.0 + cos_omega);
        let b2 = (1.0 + cos_omega) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha;
        Self::normalized(b0, b1, b2, a0, a1, a2)
    }

    fn low_pass(sample_rate: f32, cutoff_hz: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * cutoff_hz / sample_rate;
        let cos_omega = omega.cos();
        let alpha = omega.sin() / (2.0 * q);
        let b0 = (1.0 - cos_omega) / 2.0;
        let b1 = 1.0 - cos_omega;
        let b2 = (1.0 - cos_omega) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha;
        Self::normalized(b0, b1, b2, a0, a1, a2)
    }

    fn normalized(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

fn apply_biquad(samples: &mut [f32], filter: Biquad) {
    let mut x1 = 0.0;
    let mut x2 = 0.0;
    let mut y1 = 0.0;
    let mut y2 = 0.0;
    for sample in samples {
        let x0 = *sample;
        let y0 = filter.b0 * x0 + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
        *sample = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
    }
}

fn apply_soft_knee_compressor(
    samples: &mut [f32],
    threshold: f32,
    knee_width: f32,
    ratio: f32,
    makeup_gain: f32,
) {
    let half_knee = knee_width / 2.0;
    for sample in samples {
        let input = *sample;
        let level = input.abs();
        let compressed = if level <= threshold - half_knee {
            level
        } else if level >= threshold + half_knee {
            threshold + (level - threshold) / ratio
        } else {
            let x = level - (threshold - half_knee);
            level + ((1.0 / ratio - 1.0) * x * x) / (2.0 * knee_width.max(0.001))
        };
        *sample = input.signum() * compressed * makeup_gain;
    }
}

fn apply_limiter(samples: &mut [f32], ceiling: f32) {
    for sample in samples {
        *sample = (*sample).clamp(-ceiling, ceiling);
    }
}

fn apply_short_room_tail(samples: &mut [f32], sample_rate: u32, wet: f32) {
    let delay_a = (sample_rate as f32 * 0.021).round() as usize;
    let delay_b = (sample_rate as f32 * 0.047).round() as usize;
    let original = samples.to_vec();
    for index in 0..samples.len() {
        let mut tail = 0.0;
        if index >= delay_a {
            tail += original[index - delay_a] * 0.55;
        }
        if index >= delay_b {
            tail += original[index - delay_b] * 0.28;
        }
        samples[index] = original[index] * (1.0 - wet) + tail * wet;
    }
}

fn write_story_wav(samples: &[f32], sample_rate: u32, output_path: &Path) -> Result<(), String> {
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

fn apply_story_audio_playback_rate(samples: &[f32], playback_rate: f32) -> Vec<f32> {
    if samples.is_empty() || (playback_rate - 1.0).abs() < f32::EPSILON {
        return samples.to_vec();
    }

    let output_len = ((samples.len() as f64) / playback_rate as f64).round() as usize;
    resample_to_len(samples, output_len.max(1))
}

fn decode_audio_file_mono(path: &Path, target_sample_rate: u32) -> Result<Vec<f32>, String> {
    let file = File::open(path)
        .map_err(|err| format!("Failed to open rendered audio '{}': {err}", path.display()))?;
    let decoder = rodio::Decoder::try_from(file).map_err(|err| {
        format!(
            "Failed to decode rendered audio '{}': {err}",
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
    Ok(resample_linear(&mono, sample_rate, target_sample_rate))
}

fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let output_len =
        ((samples.len() as f64 * target_rate as f64) / source_rate as f64).round() as usize;
    if output_len == 0 {
        return Vec::new();
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

fn resample_to_len(samples: &[f32], output_len: usize) -> Vec<f32> {
    if samples.is_empty() || samples.len() == output_len {
        return samples.to_vec();
    }
    if output_len == 0 {
        return Vec::new();
    }
    if output_len == 1 {
        return vec![samples[0]];
    }
    if samples.len() == 1 {
        return vec![samples[0]; output_len];
    }

    let ratio = (samples.len() - 1) as f64 / (output_len - 1) as f64;
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

fn cleanup_files(paths: &[PathBuf]) {
    for path in paths {
        let _ = std::fs::remove_file(path);
    }
}

fn cleanup_file_groups(groups: &[Vec<PathBuf>]) {
    for group in groups {
        cleanup_files(group);
    }
}

fn reveal_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("Story audio file no longer exists.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to reveal story audio in Finder: {err}"))
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to reveal story audio in Explorer: {err}"))
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to reveal story audio folder: {err}"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = path;
        Err("Revealing files is not supported on this platform.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn production_creative_audio_model_ids_for_tests() -> Vec<&'static str> {
        vec![
            STABLE_AUDIO3_MODEL_SFX_ID,
            STABLE_AUDIO3_MODEL_MUSIC_ID,
            ACE_STEP_15_MUSIC_ID,
            DIFFRHYTHM_MODEL_ID,
            YUE_MODEL_ID,
            FIGARO_MODEL_ID,
        ]
    }

    #[test]
    fn parses_script_lines() {
        let lines = parse_script("Narrator: Once\nHero: Hello").unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].speaker, "Narrator");
        assert_eq!(lines[1].text, "Hello");
    }

    #[test]
    fn rejects_malformed_script_line() {
        let error = parse_script("Narrator says hello").unwrap_err();
        assert!(error.contains("Line 1"));
    }

    #[test]
    fn keeps_song_mode_out_of_stable_audio3_runtime() {
        assert_eq!(StorySoundMode::Song.label(), "Song");
        assert_eq!(StorySoundMode::Song.max_seconds(), 600);
        assert!(StorySoundMode::Song.stable_audio3_dit().is_err());
        assert!(StorySoundMode::Song.stable_audio3_decoder().is_err());
        assert!(!model_supports_story_sound_mode(
            STABLE_AUDIO3_MODEL_MUSIC_ID,
            StorySoundMode::Song
        ));
    }

    #[test]
    fn supports_ace_step_music_and_song_modes() {
        assert!(model_supports_story_sound_mode(
            ACE_STEP_15_MUSIC_ID,
            StorySoundMode::Music
        ));
        assert!(model_supports_story_sound_mode(
            ACE_STEP_15_MUSIC_ID,
            StorySoundMode::Song
        ));
        assert!(!model_supports_story_sound_mode(
            ACE_STEP_15_MUSIC_ID,
            StorySoundMode::Sfx
        ));
        assert!(model_supports_story_sound_mode(
            DIFFRHYTHM_MODEL_ID,
            StorySoundMode::Song
        ));
        assert!(model_supports_story_sound_mode(
            YUE_MODEL_ID,
            StorySoundMode::Song
        ));
        assert!(model_supports_story_sound_mode(
            FIGARO_MODEL_ID,
            StorySoundMode::Composition
        ));
    }

    #[test]
    fn production_creative_audio_catalog_excludes_license_blocked_rows() {
        let ids = production_creative_audio_model_ids_for_tests();

        assert!(ids.contains(&YUE_MODEL_ID));
        assert!(ids.contains(&DIFFRHYTHM_MODEL_ID));
        assert!(ids.contains(&FIGARO_MODEL_ID));
        assert!(!ids.contains(&"audiocraft-musicgen"));
        assert!(!ids.contains(&"levo-2-songgeneration"));
    }

    #[test]
    fn hf_creative_download_filter_skips_bin_checkpoint_duplicates() {
        let ignored = &["**/pytorch_model.bin", "**/diffusion_pytorch_model.bin"];

        assert!(!creative_hf_model_file_allowed(
            "text_encoder/pytorch_model.bin",
            ignored
        ));
        assert!(!creative_hf_model_file_allowed(
            "unet/diffusion_pytorch_model.bin",
            ignored
        ));
        assert!(creative_hf_model_file_allowed(
            "unet/diffusion_pytorch_model.safetensors",
            ignored
        ));
        assert!(creative_hf_model_file_allowed(
            "scheduler/scheduler_config.json",
            ignored
        ));
    }

    #[test]
    fn normalizes_line_instruction_overrides() {
        let instructions = normalize_line_instructions(&[
            StoryLineInstructionOverride {
                line_number: 2,
                style_instructions: "  whisper this line  ".to_string(),
            },
            StoryLineInstructionOverride {
                line_number: 0,
                style_instructions: "ignored".to_string(),
            },
            StoryLineInstructionOverride {
                line_number: 3,
                style_instructions: "   ".to_string(),
            },
        ]);

        assert_eq!(instructions.len(), 1);
        assert_eq!(
            instructions.get(&2).map(String::as_str),
            Some("whisper this line")
        );
    }

    #[test]
    fn detects_expression_tags_in_script_text() {
        assert!(contains_expression_tag("[whispering] Hello."));
        assert!(contains_expression_tag("Hello (laughs)."));
        assert!(contains_expression_tag("Hello [] [happy]."));
        assert!(!contains_expression_tag("Hello without cue markers."));
        assert!(!contains_expression_tag("Hello [] without cue content."));
    }

    #[test]
    fn parses_sound_tags_and_cue_only_lines_for_render() {
        let lines = parse_script_for_render(
            "[sound id=\"door\" mode=\"insert\" title=\"Door slam\"]\nNarrator: Hold still [sound id=\"rain\" mode=\"overlay\" title=\"Rain\"] now.",
        )
        .unwrap();

        assert_eq!(lines.len(), 2);
        assert!(lines[0].speaker.is_none());
        assert_eq!(lines[1].speaker.as_deref(), Some("Narrator"));
        match &lines[0].parts[0] {
            StoryScriptPart::Sound(cue) => {
                assert_eq!(cue.sound_id, "door");
                assert_eq!(cue.title, "Door slam");
                assert_eq!(cue.mode, StorySoundCueMode::Insert);
            }
            StoryScriptPart::Text(_) => panic!("expected sound cue"),
        }
        assert!(matches!(&lines[1].parts[0], StoryScriptPart::Text(text) if text == "Hold still"));
        assert!(
            matches!(&lines[1].parts[1], StoryScriptPart::Sound(cue) if cue.sound_id == "rain" && cue.mode == StorySoundCueMode::Overlay)
        );
        assert!(matches!(&lines[1].parts[2], StoryScriptPart::Text(text) if text == "now."));
    }

    #[test]
    fn rejects_invalid_sound_tag_modes() {
        let error =
            parse_script_for_render("[sound id=\"door\" mode=\"sidechain\" title=\"Door slam\"]")
                .unwrap_err();
        assert!(error.contains("unsupported sound tag mode"));
    }

    #[test]
    fn assembles_wav_with_pause() {
        let dir = tempdir().unwrap();
        let first = dir.path().join("first.wav");
        let second = dir.path().join("second.wav");
        write_test_wav(&first, &[0.25; 240]).unwrap();
        write_test_wav(&second, &[0.5; 240]).unwrap();
        let out = dir.path().join("story.wav");
        let stop = AtomicBool::new(false);
        let duration_ms =
            assemble_story_wav(&[vec![first], vec![second]], 100, &out, &stop).unwrap();
        assert!(out.exists());
        assert_eq!(duration_ms, 120);
    }

    #[test]
    fn cancelled_assembly_returns_error() {
        let dir = tempdir().unwrap();
        let first = dir.path().join("first.wav");
        write_test_wav(&first, &[0.25; 240]).unwrap();
        let out = dir.path().join("story.wav");
        let stop = AtomicBool::new(true);
        let error = assemble_story_wav(&[vec![first]], 0, &out, &stop).unwrap_err();
        assert!(error.contains("cancelled"));
    }

    #[test]
    fn assembles_timeline_with_insert_and_overlay_sound_cues() {
        let dir = tempdir().unwrap();
        let voice = dir.path().join("voice.wav");
        let insert = dir.path().join("insert.wav");
        let overlay = dir.path().join("overlay.wav");
        write_test_wav(&voice, &[0.25; 240]).unwrap();
        write_test_wav(&insert, &[0.25; 240]).unwrap();
        write_test_wav(&overlay, &[0.1; 480]).unwrap();
        let out = dir.path().join("story.wav");
        let stop = AtomicBool::new(false);

        let events = vec![
            StoryTimelineEvent::Audio {
                files: vec![insert.clone()],
                clip_index: None,
                cue: Some(ResolvedStorySoundCue {
                    sound_id: "insert-sound".to_string(),
                    title: "Door slam".to_string(),
                    mode: StorySoundCueMode::Insert,
                    path: insert,
                }),
                advances_cursor: true,
            },
            StoryTimelineEvent::Audio {
                files: vec![overlay.clone()],
                clip_index: None,
                cue: Some(ResolvedStorySoundCue {
                    sound_id: "overlay-sound".to_string(),
                    title: "Rain".to_string(),
                    mode: StorySoundCueMode::Overlay,
                    path: overlay,
                }),
                advances_cursor: false,
            },
            StoryTimelineEvent::Audio {
                files: vec![voice],
                clip_index: Some(0),
                cue: None,
                advances_cursor: true,
            },
        ];

        let (duration_ms, timings, sound_cues) = assemble_story_timeline_with_effect(
            &events,
            &out,
            &stop,
            StoryAudioEffectPreset::Clean,
        )
        .unwrap();

        assert!(out.exists());
        assert_eq!(duration_ms, 30);
        assert_eq!(timings[0].1.offset_ms, 10);
        assert_eq!(sound_cues.len(), 2);
        assert_eq!(sound_cues[0].offset_ms, 0);
        assert_eq!(sound_cues[1].offset_ms, 10);
        assert_eq!(sound_cues[1].mode, StorySoundCueMode::Overlay);
    }

    #[test]
    fn queued_render_jobs_get_fifo_positions() {
        let mut queue = StoryRenderQueueState::default();
        queue
            .jobs
            .push_back(test_job("first", StoryRenderJobStatus::Queued));
        queue
            .jobs
            .push_back(test_job("second", StoryRenderJobStatus::Queued));
        queue
            .jobs
            .push_back(test_job("third", StoryRenderJobStatus::Queued));

        assert_eq!(queue_position_for_locked(&queue, "first"), Some(1));
        assert_eq!(queue_position_for_locked(&queue, "second"), Some(2));
        assert_eq!(queue_position_for_locked(&queue, "third"), Some(3));
    }

    #[test]
    fn cancelling_queued_render_marks_only_that_job() {
        let mut queue = StoryRenderQueueState::default();
        queue
            .jobs
            .push_back(test_job("first", StoryRenderJobStatus::Queued));
        queue
            .jobs
            .push_back(test_job("second", StoryRenderJobStatus::Queued));
        queue
            .jobs
            .push_back(test_job("third", StoryRenderJobStatus::Queued));

        assert!(cancel_story_render_locked(&mut queue, "second"));
        assert_eq!(queue.jobs[0].status, StoryRenderJobStatus::Queued);
        assert_eq!(queue.jobs[1].status, StoryRenderJobStatus::Cancelled);
        assert!(queue.jobs[1].stop_flag.load(Ordering::Relaxed));
        assert_eq!(queue.jobs[2].status, StoryRenderJobStatus::Queued);
        assert_eq!(queue_position_for_locked(&queue, "third"), Some(2));
    }

    #[test]
    fn cancelling_active_render_trips_stop_flag() {
        let mut queue = StoryRenderQueueState::default();
        queue
            .jobs
            .push_back(test_job("active", StoryRenderJobStatus::Rendering));

        assert!(cancel_story_render_locked(&mut queue, "active"));
        assert_eq!(queue.jobs[0].status, StoryRenderJobStatus::Cancelled);
        assert!(queue.jobs[0].stop_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn cancelled_render_ignores_late_progress() {
        let mut queue = StoryRenderQueueState::default();
        queue
            .jobs
            .push_back(test_job("active", StoryRenderJobStatus::Rendering));
        assert!(cancel_story_render_locked(&mut queue, "active"));

        let progress = StoryRenderProgress {
            render_id: "active".to_string(),
            current_line: 1,
            total_lines: 1,
            speaker: Some("Narrator".to_string()),
            status: "rendering".to_string(),
        };
        update_story_render_job_progress_locked(&mut queue, &progress);

        assert_eq!(queue.jobs[0].status, StoryRenderJobStatus::Cancelled);
        assert_eq!(queue.jobs[0].current_line, 0);
        assert_eq!(queue.jobs[0].speaker, None);
    }

    #[test]
    fn story_audio_items_sort_starred_then_newest() {
        let mut items = vec![
            test_audio_item("old", 1, false),
            test_audio_item("starred", 2, true),
            test_audio_item("new", 3, false),
        ];

        sort_story_audio_items(&mut items);

        assert_eq!(items[0].id, "starred");
        assert_eq!(items[1].id, "new");
        assert_eq!(items[2].id, "old");
    }

    #[test]
    fn validates_supported_processed_audio_options() {
        assert_eq!(validate_story_audio_playback_rate(1.25).unwrap(), 1.25);
        assert_eq!(validate_story_audio_sample_rate(44_100).unwrap(), 44_100);
        assert!(validate_story_audio_playback_rate(1.1).is_err());
        assert!(validate_story_audio_sample_rate(22_050).is_err());
    }

    #[test]
    fn playback_rate_processing_changes_sample_length() {
        let samples = vec![0.0; 24_000];
        assert_eq!(apply_story_audio_playback_rate(&samples, 2.0).len(), 12_000);
        assert_eq!(apply_story_audio_playback_rate(&samples, 0.5).len(), 48_000);
    }

    #[test]
    fn writes_processed_wav_at_requested_sample_rate() {
        let dir = tempdir().unwrap();
        let out = dir.path().join("processed.wav");
        let mut samples = apply_story_audio_playback_rate(&[0.25; 24_000], 2.0);
        samples = resample_linear(&samples, STORY_SAMPLE_RATE, 48_000);
        write_story_wav(&samples, 48_000, &out).unwrap();

        assert_eq!(wav_sample_rate_hz(&out).unwrap(), 48_000);
        assert_eq!(wav_duration_ms(&out).unwrap(), 500);
    }

    #[test]
    fn wav_duration_ms_reads_stereo_duration_once() {
        let dir = tempdir().unwrap();
        let out = dir.path().join("stereo.wav");
        let spec = WavSpec {
            channels: 2,
            sample_rate: 44_100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = WavWriter::create(&out, spec).unwrap();
        for _ in 0..44_100 {
            writer.write_sample(0_i16).unwrap();
            writer.write_sample(0_i16).unwrap();
        }
        writer.finalize().unwrap();

        assert_eq!(wav_duration_ms(&out).unwrap(), 1000);
    }

    fn test_job(render_id: &str, status: StoryRenderJobStatus) -> StoryRenderJob {
        StoryRenderJob {
            request: StoryRenderRequest {
                render_id: render_id.to_string(),
                project_id: None,
                title: render_id.to_string(),
                cast: Vec::new(),
                script_text: String::new(),
                pause_ms_between_lines: 0,
                audio_effect: StoryAudioEffectPreset::Clean,
                line_instructions: Vec::new(),
            },
            stop_flag: Arc::new(AtomicBool::new(false)),
            status,
            created_at_ms: 0,
            queued_at_ms: 0,
            started_at_ms: None,
            current_line: 0,
            total_lines: 0,
            speaker: None,
            error: None,
        }
    }

    fn test_audio_item(id: &str, created_at_ms: i64, starred: bool) -> StoryAudioItem {
        StoryAudioItem {
            id: id.to_string(),
            kind: StoryAudioKind::StoryRender,
            project_id: None,
            title: id.to_string(),
            script_text: String::new(),
            line_instructions: Vec::new(),
            output_path: format!("{id}.wav"),
            clips_path: None,
            created_at_ms,
            duration_ms: 0,
            line_count: 0,
            cast_count: 0,
            generation_time_ms: 0,
            sample_rate_hz: STORY_SAMPLE_RATE,
            expression_tags_used: false,
            inline_prompt_used: false,
            audio_effect: StoryAudioEffectPreset::Clean,
            sound_mode: None,
            source_model_id: None,
            starred,
        }
    }

    fn write_test_wav(path: &Path, samples: &[f32]) -> Result<(), String> {
        let spec = WavSpec {
            channels: 1,
            sample_rate: STORY_SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = WavWriter::create(path, spec).map_err(|err| err.to_string())?;
        for sample in samples {
            writer
                .write_sample((sample * i16::MAX as f32) as i16)
                .map_err(|err| err.to_string())?;
        }
        writer.finalize().map_err(|err| err.to_string())
    }
}
