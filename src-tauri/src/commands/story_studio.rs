use crate::settings::{get_settings, TtsVoicePreset};
use crate::tts::{SpeakRequest, TtsManager};
use hound::{WavSpec, WavWriter};
use once_cell::sync::Lazy;
use rodio::Source;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const STORY_SAMPLE_RATE: u32 = 24_000;
const STORY_PEAK_TARGET: f32 = 0.95;

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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoryRenderRequest {
    pub render_id: String,
    pub title: String,
    pub cast: Vec<StoryCastMember>,
    pub script_text: String,
    pub pause_ms_between_lines: u32,
    #[serde(default)]
    pub line_instructions: Vec<StoryLineInstructionOverride>,
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
    pub title: String,
    pub script_text: String,
    #[serde(default)]
    pub line_instructions: Vec<StoryLineInstructionOverride>,
    pub output_path: String,
    pub created_at_ms: i64,
    pub duration_ms: u32,
    pub line_count: u32,
    #[serde(default)]
    pub generation_time_ms: u32,
    #[serde(default = "default_story_sample_rate")]
    pub sample_rate_hz: u32,
    #[serde(default)]
    pub expression_tags_used: bool,
    #[serde(default)]
    pub inline_prompt_used: bool,
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
        tauri::async_runtime::spawn(story_render_worker(app.clone()));
    }

    Ok(StoryRenderEnqueueResult {
        render_id,
        queue_position,
    })
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
    if job.status == StoryRenderJobStatus::Queued {
        job.status = StoryRenderJobStatus::Cancelled;
        job.error = None;
    }
    true
}

#[tauri::command]
#[specta::specta]
pub fn list_story_render_jobs() -> Result<Vec<StoryRenderJobSummary>, String> {
    Ok(story_render_job_summaries())
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
                mark_story_render_job_completed(&app, &render_id);
                emit_story_audio_updated(&app);
                remove_story_render_job(&app, &render_id);
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
    if let Some(job) = queue
        .jobs
        .iter_mut()
        .find(|job| job.request.render_id == progress.render_id)
    {
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
    normalize_story_samples(&mut output_samples);

    let title = processed_story_title(&source.title, playback_rate, output_sample_rate);
    let output_path = output_path_for_story(&app, &title)?;
    write_story_wav(&output_samples, output_sample_rate, &output_path)?;
    let duration_ms =
        ((output_samples.len() as f64 / output_sample_rate as f64) * 1000.0).round() as u32;
    let output_path_string = output_path.to_string_lossy().to_string();
    let processed = StoryAudioItem {
        id: Uuid::new_v4().to_string(),
        title,
        script_text: source.script_text,
        line_instructions: source.line_instructions,
        output_path: output_path_string,
        created_at_ms: now_ms(),
        duration_ms,
        line_count: source.line_count,
        generation_time_ms: source.generation_time_ms,
        sample_rate_hz: output_sample_rate,
        expression_tags_used: source.expression_tags_used,
        inline_prompt_used: source.inline_prompt_used,
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
    let lines = parse_script(&request.script_text)?;
    validate_script_speakers(&lines, &cast)?;
    let line_instructions = normalize_line_instructions(&request.line_instructions);
    let expression_tags_used = lines.iter().any(|line| contains_expression_tag(&line.text));
    let inline_prompt_used = !line_instructions.is_empty();

    let total_lines = lines.len() as u32;
    emit_progress(&app, &request.render_id, 0, total_lines, None, "validating");

    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    let mut rendered_line_files: Vec<Vec<PathBuf>> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if stop_flag.load(Ordering::Relaxed) {
            cleanup_file_groups(&rendered_line_files);
            return Err("Story rendering was cancelled.".to_string());
        }

        emit_progress(
            &app,
            &request.render_id,
            index as u32 + 1,
            total_lines,
            Some(line.speaker.clone()),
            "rendering",
        );

        let mut preset = cast
            .get(&normalize_name(&line.speaker))
            .ok_or_else(|| format!("No voice is assigned to '{}'.", line.speaker))?
            .clone();
        if let Some(instruction) = line_instructions.get(&(index as u32 + 1)) {
            preset.tuning.style_instructions = Some(instruction.clone());
        }
        let files = manager
            .synthesize_to_temp_files(
                SpeakRequest {
                    text: line.text.clone(),
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
        rendered_line_files.push(files);
    }

    if stop_flag.load(Ordering::Relaxed) {
        cleanup_file_groups(&rendered_line_files);
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
    let duration_ms = assemble_story_wav(
        &rendered_line_files,
        request.pause_ms_between_lines.clamp(0, 10_000),
        &output_path,
        &stop_flag,
    )?;
    cleanup_file_groups(&rendered_line_files);

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
            title: story_title_label(&request.title),
            script_text: request.script_text,
            line_instructions: request.line_instructions,
            output_path,
            created_at_ms: now_ms(),
            duration_ms,
            line_count: total_lines,
            generation_time_ms: elapsed_ms_u32(render_started_at),
            sample_rate_hz: STORY_SAMPLE_RATE,
            expression_tags_used,
            inline_prompt_used,
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

fn validate_script_speakers(
    lines: &[StoryScriptLine],
    cast: &HashMap<String, TtsVoicePreset>,
) -> Result<(), String> {
    for line in lines {
        if !cast.contains_key(&normalize_name(&line.speaker)) {
            return Err(format!(
                "'{}' appears in the script but is not in the cast.",
                line.speaker
            ));
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

fn story_audio_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(story_audio_dir(app)?.join("story-audio-index.json"))
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
            title,
            script_text: String::new(),
            line_instructions: Vec::new(),
            output_path: path.to_string_lossy().to_string(),
            created_at_ms: metadata_time_ms(&metadata),
            duration_ms: wav_duration_ms(&path).unwrap_or(0),
            line_count: 0,
            generation_time_ms: 0,
            sample_rate_hz: wav_sample_rate_hz(&path).unwrap_or(STORY_SAMPLE_RATE),
            expression_tags_used: false,
            inline_prompt_used: false,
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
    let frames = reader.duration() as f64 / f64::from(spec.channels);
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

fn assemble_story_wav(
    line_files: &[Vec<PathBuf>],
    pause_ms_between_lines: u32,
    output_path: &Path,
    stop_flag: &AtomicBool,
) -> Result<u32, String> {
    if line_files.is_empty() {
        return Err("No rendered audio was produced.".to_string());
    }

    let mut samples = Vec::new();
    let silence_len = (STORY_SAMPLE_RATE as u64 * pause_ms_between_lines as u64 / 1000) as usize;
    for (line_index, files) in line_files.iter().enumerate() {
        if stop_flag.load(Ordering::Relaxed) {
            return Err("Story rendering was cancelled.".to_string());
        }
        for path in files {
            let mut line_samples = decode_audio_file_mono(path, STORY_SAMPLE_RATE)?;
            samples.append(&mut line_samples);
        }
        if line_index + 1 < line_files.len() && silence_len > 0 {
            samples.extend(std::iter::repeat_n(0.0, silence_len));
        }
    }

    normalize_story_samples(&mut samples);

    write_story_wav(&samples, STORY_SAMPLE_RATE, output_path)?;

    Ok(((samples.len() as f64 / STORY_SAMPLE_RATE as f64) * 1000.0).round() as u32)
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

fn processed_story_title(title: &str, playback_rate: f32, sample_rate_hz: u32) -> String {
    format!(
        "{} (processed {}x {})",
        story_title_label(title),
        format_story_playback_rate(playback_rate),
        format_story_sample_rate(sample_rate_hz)
    )
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
    if sample_rate_hz % 1000 == 0 {
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
        assert_eq!(queue.jobs[0].status, StoryRenderJobStatus::Rendering);
        assert!(queue.jobs[0].stop_flag.load(Ordering::Relaxed));
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

    fn test_job(render_id: &str, status: StoryRenderJobStatus) -> StoryRenderJob {
        StoryRenderJob {
            request: StoryRenderRequest {
                render_id: render_id.to_string(),
                title: render_id.to_string(),
                cast: Vec::new(),
                script_text: String::new(),
                pause_ms_between_lines: 0,
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
            title: id.to_string(),
            script_text: String::new(),
            line_instructions: Vec::new(),
            output_path: format!("{id}.wav"),
            created_at_ms,
            duration_ms: 0,
            line_count: 0,
            generation_time_ms: 0,
            sample_rate_hz: STORY_SAMPLE_RATE,
            expression_tags_used: false,
            inline_prompt_used: false,
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
