use crate::settings::{get_settings, TtsVoicePreset};
use crate::tts::{SpeakRequest, TtsManager};
use hound::{WavSpec, WavWriter};
use once_cell::sync::Lazy;
use rodio::Source;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
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

struct ActiveStoryRender {
    render_id: String,
    stop_flag: Arc<AtomicBool>,
}

static ACTIVE_STORY_RENDER: Lazy<Mutex<Option<ActiveStoryRender>>> = Lazy::new(|| Mutex::new(None));
static ACTIVE_STORY_PLAYBACK: Lazy<Mutex<Option<Arc<AtomicBool>>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
#[specta::specta]
pub async fn render_story_audio(
    app: AppHandle,
    request: StoryRenderRequest,
) -> Result<StoryRenderResult, String> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut active = ACTIVE_STORY_RENDER
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if active.is_some() {
            return Err("A Story Studio render is already running.".to_string());
        }
        *active = Some(ActiveStoryRender {
            render_id: request.render_id.clone(),
            stop_flag: Arc::clone(&stop_flag),
        });
    }

    let result = render_story_audio_inner(app, request, Arc::clone(&stop_flag)).await;

    let mut active = ACTIVE_STORY_RENDER
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if active
        .as_ref()
        .is_some_and(|active| Arc::ptr_eq(&active.stop_flag, &stop_flag))
    {
        *active = None;
    }

    result
}

#[tauri::command]
#[specta::specta]
pub fn cancel_story_render(render_id: String) -> Result<(), String> {
    let active = ACTIVE_STORY_RENDER
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if let Some(active) = active.as_ref() {
        if active.render_id == render_id {
            active.stop_flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
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
    emit_story_audio_updated(&app);

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
    let _ = app.emit(
        "story-render-progress",
        StoryRenderProgress {
            render_id: render_id.to_string(),
            current_line,
            total_lines,
            speaker,
            status: status.to_string(),
        },
    );
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

    let peak = samples
        .iter()
        .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
    if peak > STORY_PEAK_TARGET {
        let scale = STORY_PEAK_TARGET / peak;
        for sample in &mut samples {
            *sample *= scale;
        }
    }

    let spec = WavSpec {
        channels: 1,
        sample_rate: STORY_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        WavWriter::create(output_path, spec).map_err(|err| format!("WAV write error: {err}"))?;
    for sample in &samples {
        let sample_i16 = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer
            .write_sample(sample_i16)
            .map_err(|err| format!("WAV sample write error: {err}"))?;
    }
    writer
        .finalize()
        .map_err(|err| format!("WAV finalize error: {err}"))?;

    Ok(((samples.len() as f64 / STORY_SAMPLE_RATE as f64) * 1000.0).round() as u32)
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
