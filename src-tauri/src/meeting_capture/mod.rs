//! Meetings have their own native capture stream, bounded queue, storage worker,
//! and background ASR. No meeting audio enters the live dictation recorder.
mod storage;
pub mod templates;

use crate::managers::{model::ModelManager, FileTranscriptionEngine};
use crate::settings::get_settings;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use storage::{TrackStats, TrackWriter, SAMPLE_RATE};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct MeetingCaptureManager {
    active: Mutex<Option<Arc<RunSignals>>>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    recovering: AtomicBool,
}

impl Default for MeetingCaptureManager {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            jobs: Mutex::new(HashMap::new()),
            recovering: AtomicBool::new(true),
        }
    }
}

struct RunSignals {
    id: String,
    stop: AtomicBool,
    finished: AtomicBool,
    dropped: AtomicU64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MeetingSource {
    pub id: i32,
    pub name: String,
    pub bundle_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MeetingMicrophone {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MeetingCapabilities {
    pub supported: bool,
    pub screen_permission: bool,
    pub microphone_permission: bool,
    pub applications: Vec<MeetingSource>,
    pub microphones: Vec<MeetingMicrophone>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MeetingSession {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub state: String,
    pub error: Option<String>,
    pub system_source: String,
    pub system_process_id: i32,
    pub microphone_id: String,
    pub include_microphone: bool,
    pub sample_rate: u32,
    pub duration_ms: u64,
    pub dropped_buffers: u64,
    pub system: TrackStats,
    pub microphone: TrackStats,
    pub transcript_ready: bool,
    pub summary_ready: bool,
    pub analysis_error: Option<String>,
    pub backend: String,
    #[serde(default)]
    pub enhanced: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
    #[serde(default)]
    pub speaker_names: HashMap<String, String>,
}

impl MeetingSession {
    pub fn apply_analysis_outcome(&mut self, outcome: &AnalysisOutcome) {
        self.state = "ready".into();
        self.summary_ready = false;
        self.transcript_ready = true;
        self.analysis_error = None;
        self.enhanced = outcome.enhanced;
        self.audio_source = Some(outcome.audio_source.clone());
        self.fallback_reason = outcome.fallback_reason.clone();
    }

    pub fn apply_analysis_failure(&mut self, outcome: Option<&AnalysisOutcome>, error: String) {
        self.state = "recorded".into();
        self.analysis_error = Some(error);
        if let Some(outcome) = outcome {
            self.enhanced = outcome.enhanced;
            self.audio_source = Some(outcome.audio_source.clone());
            self.fallback_reason = outcome.fallback_reason.clone();
        } else {
            // A failure before enhancement has no new provenance. Do not
            // fabricate a fallback state, and clear any stale explanation.
            self.fallback_reason = None;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnalysisOutcome {
    pub enhanced: bool,
    pub audio_source: String,
    pub fallback_reason: Option<String>,
}

#[derive(Debug)]
struct AnalysisFailure {
    error: String,
    outcome: Option<AnalysisOutcome>,
}

impl AnalysisFailure {
    fn before_provenance(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            outcome: None,
        }
    }

    fn with_outcome(outcome: &AnalysisOutcome, error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            outcome: Some(outcome.clone()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MeetingSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MeetingDetail {
    pub session: MeetingSession,
    pub segments: Vec<MeetingSegment>,
    pub summary: Option<String>,
}

struct AudioPacket {
    track: usize,
    samples: Vec<f32>,
    timestamp_us: i64,
    rate: i32,
    channels: i32,
}
#[cfg_attr(
    not(all(target_os = "macos", target_arch = "aarch64")),
    allow(dead_code)
)]
struct Sink {
    sender: mpsc::SyncSender<AudioPacket>,
    signals: Arc<RunSignals>,
}
static SINKS: Lazy<Mutex<HashMap<u64, Arc<Sink>>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static NEXT_CAPTURE: AtomicU64 = AtomicU64::new(1);
static EXIT_AFTER_CAPTURE: AtomicBool = AtomicBool::new(false);

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod native {
    use super::*;
    use std::ffi::{c_char, c_void, CStr, CString};
    type Callback = extern "C" fn(u64, i32, *const f32, i32, i64, i32, i32);
    extern "C" {
        fn meeting_capture_start_apple(
            context: u64,
            pid: i32,
            mic: *const c_char,
            include_mic: i32,
            callback: Callback,
        ) -> *mut c_void;
        fn meeting_capture_status_apple(handle: *mut c_void) -> *mut c_char;
        fn meeting_capture_stop_apple(handle: *mut c_void);
        fn meeting_capture_release_apple(handle: *mut c_void);
        fn meeting_capture_capabilities_apple() -> *mut c_char;
        fn meeting_capture_request_permissions_apple();
        fn meeting_capture_free_string_apple(value: *mut c_char);
        fn meeting_capture_available_space_apple(path: *const c_char) -> i64;
    }
    fn json<T: serde::de::DeserializeOwned>(raw: *mut c_char) -> Result<T, String> {
        if raw.is_null() {
            return Err("Native meeting capture returned no response.".into());
        }
        let result = serde_json::from_slice(unsafe { CStr::from_ptr(raw) }.to_bytes())
            .map_err(|e| e.to_string());
        unsafe { meeting_capture_free_string_apple(raw) };
        result
    }
    pub fn capabilities() -> Result<MeetingCapabilities, String> {
        json(unsafe { meeting_capture_capabilities_apple() })
    }
    pub fn request_permissions() {
        unsafe { meeting_capture_request_permissions_apple() }
    }
    pub fn available_space(path: &Path) -> Result<u64, String> {
        let path = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let value = unsafe { meeting_capture_available_space_apple(path.as_ptr()) };
        u64::try_from(value)
            .map_err(|_| "Could not check free disk space for meeting recordings.".into())
    }
    pub struct Capture(usize);
    impl Capture {
        pub fn start(key: u64, session: &MeetingSession) -> Result<Self, String> {
            let mic = CString::new(session.microphone_id.as_str()).map_err(|e| e.to_string())?;
            let raw = unsafe {
                meeting_capture_start_apple(
                    key,
                    session.system_process_id,
                    mic.as_ptr(),
                    i32::from(session.include_microphone),
                    receive_audio,
                )
            };
            if raw.is_null() {
                Err("Meeting capture requires macOS 15 or newer on Apple Silicon.".into())
            } else {
                Ok(Self(raw as usize))
            }
        }
        pub fn status(&self) -> Result<NativeStatus, String> {
            json(unsafe { meeting_capture_status_apple(self.0 as *mut c_void) })
        }
        pub fn stop(&self) {
            unsafe { meeting_capture_stop_apple(self.0 as *mut c_void) }
        }
    }
    impl Drop for Capture {
        fn drop(&mut self) {
            unsafe { meeting_capture_release_apple(self.0 as *mut c_void) }
        }
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
mod native {
    use super::*;
    pub fn capabilities() -> Result<MeetingCapabilities, String> {
        Ok(MeetingCapabilities {
            supported: false,
            screen_permission: false,
            microphone_permission: false,
            applications: vec![],
            microphones: vec![],
        })
    }
    pub fn request_permissions() {}
    pub fn available_space(_: &Path) -> Result<u64, String> {
        Err("Meeting capture is unsupported on this platform.".into())
    }
    pub struct Capture;
    impl Capture {
        pub fn start(_: u64, _: &MeetingSession) -> Result<Self, String> {
            Err("Meeting capture requires macOS 15 or newer on Apple Silicon.".into())
        }
        pub fn status(&self) -> Result<NativeStatus, String> {
            Err("Unsupported platform.".into())
        }
        pub fn stop(&self) {}
    }
}

#[derive(Deserialize)]
struct NativeStatus {
    state: String,
    error: Option<String>,
}

#[cfg_attr(
    not(all(target_os = "macos", target_arch = "aarch64")),
    allow(dead_code)
)]
extern "C" fn receive_audio(
    key: u64,
    track: i32,
    raw: *const f32,
    count: i32,
    timestamp_us: i64,
    rate: i32,
    channels: i32,
) {
    if raw.is_null() || !(0..=1).contains(&track) || !(1..=16_000).contains(&count) {
        return;
    }
    let sink = SINKS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&key)
        .cloned();
    if let Some(sink) = sink {
        // The native buffer is valid only during this callback. Copy once into
        // a bounded queue; never block ScreenCaptureKit waiting for disk IO.
        let packet = AudioPacket {
            track: track as usize,
            samples: unsafe { std::slice::from_raw_parts(raw, count as usize) }.to_vec(),
            timestamp_us,
            rate,
            channels,
        };
        if sink.sender.try_send(packet).is_err() {
            sink.signals.dropped.fetch_add(1, Ordering::Relaxed);
            sink.signals.stop.store(true, Ordering::Release);
        }
    }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("meetings");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn directory(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if uuid::Uuid::parse_str(id)
        .map(|v| v.to_string() != id)
        .unwrap_or(true)
    {
        return Err("Invalid meeting identifier.".into());
    }
    let path = root(app)?.join(id);
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Meeting directories cannot be symbolic links.".into());
    }
    Ok(path)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn save(directory: &Path, session: &MeetingSession) -> Result<(), String> {
    write_atomic(
        &directory.join("session.json"),
        &serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?,
    )
}
fn load(directory: &Path) -> Result<MeetingSession, String> {
    let path = directory.join("session.json");
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 65_536 {
        return Err("Meeting metadata is too large.".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn read_document(path: &Path, limit: u64) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("Meeting document is not a regular file or exceeds its safety limit.".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}
fn changed(app: &AppHandle, session: &MeetingSession) {
    let _ = app.emit(
        "meeting-updated",
        serde_json::json!({"id": session.id, "state": session.state, "session": session}),
    );
}

fn append_packet(
    tracks: &mut [TrackWriter; 2],
    packet: AudioPacket,
    elapsed: Duration,
) -> Result<(), String> {
    if packet.timestamp_us > elapsed.as_micros() as i64 + 5_000_000 {
        return Err("Audio clock moved ahead of the recording clock. Recording stopped; captured audio is preserved.".into());
    }
    tracks[packet.track].append(
        &packet.samples,
        packet.timestamp_us,
        packet.rate,
        packet.channels,
    )
}

fn run_capture(
    app: AppHandle,
    path: PathBuf,
    mut session: MeetingSession,
    signals: Arc<RunSignals>,
) {
    let key = NEXT_CAPTURE.fetch_add(1, Ordering::Relaxed);
    // Up to 16 MiB at the callback's hard sample cap; typically well below 1 MiB.
    // Absorb short APFS flush stalls without blocking the native callback.
    let (sender, receiver) = mpsc::sync_channel(256);
    SINKS.lock().unwrap_or_else(|e| e.into_inner()).insert(
        key,
        Arc::new(Sink {
            sender,
            signals: signals.clone(),
        }),
    );
    let result = (|| -> Result<(), String> {
        let mut tracks = [
            TrackWriter::create(&path.join("microphone.partial.wav"))?,
            TrackWriter::create(&path.join("system.partial.wav"))?,
        ];
        let capture = native::Capture::start(key, &session)?;
        let started = Instant::now();
        let mut checkpoint = Instant::now();
        let mut stopping = None;
        let mut terminal_error = None;
        loop {
            if signals.stop.load(Ordering::Acquire) && stopping.is_none() {
                capture.stop();
                session.state = "stopping".into();
                stopping = Some(Instant::now());
            }
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(packet) => {
                    if terminal_error.is_none() {
                        if let Err(error) = append_packet(&mut tracks, packet, started.elapsed()) {
                            terminal_error = Some(error);
                            signals.stop.store(true, Ordering::Release);
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            if checkpoint.elapsed() >= Duration::from_secs(1) {
                let status = match capture.status() {
                    Ok(status) => status,
                    Err(error) => {
                        terminal_error = terminal_error.or(Some(error));
                        signals.stop.store(true, Ordering::Release);
                        if stopping.is_some_and(|at| at.elapsed() > Duration::from_secs(15)) {
                            break;
                        }
                        checkpoint = Instant::now();
                        continue;
                    }
                };
                if status.state == "failed" || status.state == "stopped" {
                    // stopCapture drains native callbacks before terminal status.
                    for packet in receiver.try_iter() {
                        if terminal_error.is_none() {
                            if let Err(error) =
                                append_packet(&mut tracks, packet, started.elapsed())
                            {
                                terminal_error = Some(error);
                            }
                        }
                    }
                    terminal_error = terminal_error.or(status.error);
                    break;
                }
                session.state = status.state;
                session.duration_ms =
                    tracks[0].stats.frames.max(tracks[1].stats.frames) * 1000 / SAMPLE_RATE;
                session.microphone = tracks[0].stats.clone();
                session.system = tracks[1].stats.clone();
                session.dropped_buffers = signals.dropped.load(Ordering::Relaxed);
                for track in &mut tracks {
                    track.checkpoint()?;
                }
                save(&path, &session)?;
                changed(&app, &session);
                checkpoint = Instant::now();
                if native::available_space(&path)? < 64 * 1024 * 1024 {
                    terminal_error = Some(
                        "Recording stopped because disk space is low. Captured audio is preserved."
                            .into(),
                    );
                    signals.stop.store(true, Ordering::Release);
                }
                if started.elapsed() > Duration::from_secs(8 * 3600) {
                    terminal_error =
                        Some("Eight-hour recording limit reached. Audio was preserved.".into());
                    signals.stop.store(true, Ordering::Release);
                }
                if session.state == "starting" && started.elapsed() > Duration::from_secs(30) {
                    terminal_error = Some("System-audio capture did not start within 30 seconds. Check recording permissions.".into());
                    signals.stop.store(true, Ordering::Release);
                }
                if stopping.is_some_and(|at| at.elapsed() > Duration::from_secs(15)) {
                    terminal_error = Some(
                        "The native stream did not stop cleanly. Saved audio is recoverable."
                            .into(),
                    );
                    break;
                }
            }
        }
        capture.stop();
        let [mic, system] = tracks;
        let frames = mic.stats.frames.max(system.stats.frames);
        session.microphone = mic.finish(if session.include_microphone {
            frames
        } else {
            0
        })?;
        session.system = system.finish(frames)?;
        session.duration_ms = frames * 1000 / SAMPLE_RATE;
        session.dropped_buffers = signals.dropped.load(Ordering::Relaxed);
        for name in ["microphone", "system"] {
            if name == "microphone" && !session.include_microphone {
                fs::remove_file(path.join("microphone.partial.wav")).map_err(|e| e.to_string())?;
                continue;
            }
            fs::rename(
                path.join(format!("{name}.partial.wav")),
                path.join(format!("{name}.wav")),
            )
            .map_err(|e| e.to_string())?;
        }
        if frames > 0 {
            storage::mix_tracks(&path, session.include_microphone)?;
        }
        if session.dropped_buffers > 0 {
            terminal_error = Some(format!("{} audio buffers were lost because storage could not keep up. Audio is preserved, but incomplete.", session.dropped_buffers));
        }
        if session.system.received_frames == 0 {
            terminal_error = Some("No system-audio buffers arrived. Check the source application and recording permissions; microphone audio alone is not a complete meeting.".into());
        }
        if session.include_microphone && session.microphone.received_frames == 0 {
            terminal_error = Some("No microphone buffers arrived. Check microphone access and reconnect the selected device.".into());
        }
        if let Some(error) = terminal_error {
            return Err(error);
        }
        Ok(())
    })();
    SINKS.lock().unwrap_or_else(|e| e.into_inner()).remove(&key);
    session.state = if result.is_ok() {
        "recorded"
    } else {
        "interrupted"
    }
    .into();
    session.error = result.err();
    if let Err(error) = save(&path, &session) {
        log::error!("Failed to persist meeting status: {error}");
    }
    signals.finished.store(true, Ordering::Release);
    changed(&app, &session);
    crate::tray::refresh_current_menu(&app);
}

pub fn recover(app: &AppHandle) -> Result<(), String> {
    // Block new recording/analysis until recovery has finished, including errors.
    struct RecoveryGuard<'a>(&'a AtomicBool);
    impl Drop for RecoveryGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let manager = app.state::<MeetingCaptureManager>();
    let _guard = RecoveryGuard(&manager.recovering);
    for entry in fs::read_dir(root(app)?)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let id = entry.file_name().to_string_lossy().to_string();
        let Ok(path) = directory(app, &id) else {
            continue;
        };
        let Ok(mut session) = load(&path) else {
            continue;
        };
        let has_partial_audio = ["microphone.partial.wav", "system.partial.wav"]
            .iter()
            .any(|name| path.join(name).exists());
        if has_partial_audio
            || [
                "starting",
                "recording",
                "stopping",
                "transcribing",
                "summarizing",
            ]
            .contains(&session.state.as_str())
        {
            session.state = "interrupted".into();
            session.error = Some("Vox Jot closed during this meeting or analysis. Original audio was preserved; retry transcription below.".into());
            for name in ["microphone", "system"] {
                let partial = path.join(format!("{name}.partial.wav"));
                if partial.exists() {
                    match storage::repair_partial(&partial) {
                        Ok(frames) => {
                            let stats = if name == "system" {
                                &mut session.system
                            } else {
                                &mut session.microphone
                            };
                            stats.frames = frames;
                            session.duration_ms =
                                session.duration_ms.max(frames * 1000 / SAMPLE_RATE);
                            let target = path.join(format!("{name}.wav"));
                            if !target.exists() {
                                fs::rename(partial, target).map_err(|e| e.to_string())?;
                            }
                        }
                        Err(error) => {
                            session.error = Some(format!("Partial audio needs inspection: {error}"))
                        }
                    }
                }
            }
            save(&path, &session)?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_meeting_capabilities() -> Result<MeetingCapabilities, String> {
    tokio::task::spawn_blocking(native::capabilities)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub fn request_meeting_permissions() {
    native::request_permissions();
}

#[tauri::command]
#[specta::specta]
pub async fn list_meetings(app: AppHandle) -> Result<Vec<MeetingSession>, String> {
    tokio::task::spawn_blocking(move || {
        let mut sessions = Vec::new();
        for entry in fs::read_dir(root(&app)?)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let id = entry.file_name().to_string_lossy().to_string();
            let Ok(path) = directory(&app, &id) else {
                continue;
            };
            if let Ok(session) = load(&path) {
                sessions.push(session);
            }
        }
        sessions.sort_by_key(|a| std::cmp::Reverse(a.created_at));
        Ok(sessions)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn start_meeting(
    app: AppHandle,
    manager: State<'_, MeetingCaptureManager>,
    title: String,
    process_id: i32,
    microphone_id: String,
    include_microphone: bool,
) -> Result<MeetingSession, String> {
    if manager.recovering.load(Ordering::Acquire) {
        return Err("Recovering saved meetings. Please try again in a moment.".into());
    }
    let capabilities = get_meeting_capabilities().await?;
    if !capabilities.supported {
        return Err("Meeting capture requires macOS 15 or newer on Apple Silicon.".into());
    }
    if !capabilities.screen_permission
        || (include_microphone && !capabilities.microphone_permission)
    {
        return Err(
            "Allow recording permissions, then restart Vox Jot if macOS asks you to.".into(),
        );
    }
    if process_id < 0 {
        return Err("Invalid audio source.".into());
    }
    if microphone_id.len() > 512 || microphone_id.contains('\0') {
        return Err("Invalid microphone.".into());
    }
    let source = if process_id == 0 {
        "All system audio".to_string()
    } else {
        capabilities
            .applications
            .iter()
            .find(|a| a.id == process_id)
            .ok_or("Selected source application is no longer running.")?
            .name
            .clone()
    };
    let id = uuid::Uuid::new_v4().to_string();
    let signals = Arc::new(RunSignals {
        id: id.clone(),
        stop: AtomicBool::new(false),
        finished: AtomicBool::new(false),
        dropped: AtomicU64::new(0),
    });
    {
        let mut active = manager.active.lock().map_err(|e| e.to_string())?;
        if active
            .as_ref()
            .is_some_and(|s| !s.finished.load(Ordering::Acquire))
        {
            return Err("A meeting is already recording or stopping.".into());
        }
        let jobs = manager.jobs.lock().map_err(|e| e.to_string())?;
        if !jobs.is_empty() {
            return Err(
                "A meeting operation is already running. Wait for it or cancel analysis before starting a recording."
                    .into(),
            );
        }
        *active = Some(signals.clone());
    }
    crate::tray::refresh_current_menu(&app);
    let result = tokio::task::spawn_blocking({
        let signals = signals.clone();
        let app = app.clone();
        move || {
            let path = root(&app)?.join(&id);
            if native::available_space(path.parent().ok_or("Missing meeting store")?)?
                < 256 * 1024 * 1024
            {
                return Err(
                    "At least 256 MB of free disk space is required to start a meeting recording."
                        .into(),
                );
            }
            fs::create_dir(&path).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
            let session = MeetingSession {
                id,
                title: if title.trim().is_empty() {
                    "Meeting".into()
                } else {
                    title.trim().chars().take(120).collect()
                },
                created_at: chrono::Utc::now().timestamp_millis(),
                state: "starting".into(),
                error: None,
                system_source: source,
                system_process_id: process_id,
                microphone_id,
                include_microphone,
                sample_rate: SAMPLE_RATE as u32,
                duration_ms: 0,
                dropped_buffers: 0,
                system: TrackStats::default(),
                microphone: TrackStats::default(),
                transcript_ready: false,
                summary_ready: false,
                analysis_error: None,
                backend: "ScreenCaptureKit separate audio/microphone outputs".into(),
                enhanced: false,
                audio_source: None,
                fallback_reason: None,
                speaker_names: HashMap::new(),
            };
            save(&path, &session)?;
            let worker_session = session.clone();
            std::thread::Builder::new()
                .name("meeting-storage".into())
                .spawn(move || run_capture(app, path, worker_session, signals))
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(session)
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    if result.is_err() {
        signals.finished.store(true, Ordering::Release);
        crate::tray::refresh_current_menu(&app);
    }
    result
}

#[tauri::command]
#[specta::specta]
pub fn stop_meeting(manager: State<'_, MeetingCaptureManager>, id: String) -> Result<(), String> {
    let active = manager.active.lock().map_err(|e| e.to_string())?;
    let run = active
        .as_ref()
        .filter(|s| s.id == id && !s.finished.load(Ordering::Acquire))
        .ok_or("That meeting is not recording.")?;
    run.stop.store(true, Ordering::Release);
    Ok(())
}

pub fn prepare_exit(app: &AppHandle) -> bool {
    if EXIT_AFTER_CAPTURE.load(Ordering::Acquire) {
        return false;
    }
    if !stop_active(app) {
        return false;
    }
    !EXIT_AFTER_CAPTURE.swap(true, Ordering::AcqRel)
}

pub fn stop_active(app: &AppHandle) -> bool {
    let Some(manager) = app.try_state::<MeetingCaptureManager>() else {
        return false;
    };
    let active = manager.active.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(run) = active
        .as_ref()
        .filter(|s| !s.finished.load(Ordering::Acquire))
    {
        run.stop.store(true, Ordering::Release);
        return true;
    }
    false
}

pub fn is_active(app: &AppHandle) -> bool {
    let Some(manager) = app.try_state::<MeetingCaptureManager>() else {
        return false;
    };
    let active = manager
        .active
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|run| !run.finished.load(Ordering::Acquire));
    active
}

#[tauri::command]
#[specta::specta]
pub fn cancel_meeting_analysis(app: AppHandle, id: String) -> Result<(), String> {
    let manager = app.state::<MeetingCaptureManager>();
    let jobs = manager.jobs.lock().map_err(|e| e.to_string())?;
    let flag = jobs
        .get(&id)
        .ok_or("This meeting has no analysis running.")?;
    flag.store(true, Ordering::Release);
    Ok(())
}

struct JobGuard {
    app: AppHandle,
    id: String,
    cancel: Arc<AtomicBool>,
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        self.app
            .state::<MeetingCaptureManager>()
            .jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}
fn claim_job(app: &AppHandle, id: &str) -> Result<JobGuard, String> {
    let manager = app.state::<MeetingCaptureManager>();
    if manager.recovering.load(Ordering::Acquire) {
        return Err("Meeting recovery is still running. Try again shortly.".into());
    }
    if manager
        .active
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .is_some_and(|s| !s.finished.load(Ordering::Acquire))
    {
        return Err("Stop the active meeting and wait for audio to finish saving first.".into());
    }
    let mut jobs = manager.jobs.lock().map_err(|e| e.to_string())?;
    if !jobs.is_empty() {
        return Err("A meeting operation is already running. Wait for it or cancel analysis before starting another.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.insert(id.into(), cancel.clone());
    Ok(JobGuard {
        app: app.clone(),
        id: id.into(),
        cancel,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn read_meeting(app: AppHandle, id: String) -> Result<MeetingDetail, String> {
    tokio::task::spawn_blocking(move || {
        let path = directory(&app, &id)?;
        let session = load(&path)?;
        let segments = if session.transcript_ready {
            serde_json::from_str(&read_document(
                &path.join("transcript.json"),
                32 * 1024 * 1024,
            )?)
            .map_err(|e| e.to_string())?
        } else {
            vec![]
        };
        let summary = if session.summary_ready {
            Some(read_document(&path.join("summary.md"), 1024 * 1024)?)
        } else {
            None
        };
        Ok(MeetingDetail {
            session,
            segments,
            summary,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn render_meeting_markdown(
    title: &str,
    segments: &[MeetingSegment],
    speaker_names: &HashMap<String, String>,
) -> String {
    let mut markdown = format!(
        "# {}\n\nSource labels identify audio tracks, not verified people. Speaker labels are machine estimates within each numbered analysis island, not identities across islands. Use headphones to avoid microphone echo of system audio.\n\n",
        title.replace(['\n', '\r'], " ")
    );
    for s in segments {
        let display_speaker = speaker_names
            .get(&s.speaker)
            .cloned()
            .unwrap_or_else(|| s.speaker.clone());
        markdown.push_str(&format!(
            "**{:02}:{:02} — {}**\n\n{}\n\n",
            s.start_ms / 60_000,
            (s.start_ms / 1000) % 60,
            display_speaker,
            s.text
        ));
    }
    markdown
}

pub(crate) fn prepare_enhanced_track_sync<F>(
    path: &Path,
    name: &str,
    cancel: &AtomicBool,
    is_recording: F,
) -> Result<PathBuf, String>
where
    F: Fn() -> bool,
{
    let raw_path = path.join(format!("{name}.wav"));
    let enhanced_path = path.join(format!("{name}.enhanced.wav"));
    if !raw_path.is_file() {
        return Err(format!("Track audio not found: {name}.wav"));
    }
    if enhanced_path.is_file() {
        if storage::is_valid_analysis_track(&enhanced_path) {
            return Ok(enhanced_path);
        }
        let _ = std::fs::remove_file(&enhanced_path);
    }
    if cancel.load(Ordering::Acquire) {
        return Err("Enhancement cancelled.".into());
    }

    let enhance_result =
        storage::enhance_analysis_track(&raw_path, &enhanced_path, cancel, is_recording);

    match enhance_result {
        Ok(_) => {
            if storage::is_valid_analysis_track(&enhanced_path) {
                Ok(enhanced_path)
            } else {
                let _ = std::fs::remove_file(&enhanced_path);
                Err(format!(
                    "Enhanced track for {name} was not a valid analysis track"
                ))
            }
        }
        Err(err) => {
            let _ = std::fs::remove_file(&enhanced_path);
            Err(format!("Enhancement failed for track {name}: {err}"))
        }
    }
}

async fn ensure_enhanced_track(
    app: &AppHandle,
    path: &Path,
    name: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    let raw_path = path.join(format!("{name}.wav"));
    let enhanced_path = path.join(format!("{name}.enhanced.wav"));
    if !raw_path.is_file() {
        return Err(format!("Track audio not found: {name}.wav"));
    }
    if enhanced_path.is_file() {
        if storage::is_valid_analysis_track(&enhanced_path) {
            return Ok(enhanced_path);
        }
        let _ = std::fs::remove_file(&enhanced_path);
    }
    if cancel.load(Ordering::Acquire) {
        return Err("Enhancement cancelled.".into());
    }
    while app
        .try_state::<Arc<crate::managers::audio::AudioRecordingManager>>()
        .is_some_and(|m| m.is_recording())
    {
        if cancel.load(Ordering::Acquire) {
            return Err("Enhancement cancelled.".into());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let app_handle = app.clone();
    let dir_path = path.to_path_buf();
    let track_name = name.to_string();
    let cancel_flag = cancel.clone();

    tokio::task::spawn_blocking(move || {
        prepare_enhanced_track_sync(&dir_path, &track_name, &cancel_flag, || {
            app_handle
                .try_state::<Arc<crate::managers::audio::AudioRecordingManager>>()
                .is_some_and(|m| m.is_recording())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn enhance_meeting(app: AppHandle, id: String) -> Result<(), String> {
    transcribe_meeting(app, id, Some(true)).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_meeting_speakers(
    app: AppHandle,
    id: String,
    speaker_names: HashMap<String, String>,
) -> Result<(), String> {
    // Analysis retains and later writes a MeetingSession copy. Claim the same
    // job slot so a speaker edit cannot be silently overwritten by that save.
    let _job = claim_job(&app, &id)?;
    let path = directory(&app, &id)?;
    let mut session = load(&path)?;
    session.speaker_names = speaker_names;
    save(&path, &session)?;
    if session.transcript_ready {
        let transcript_json_path = path.join("transcript.json");
        if transcript_json_path.is_file() {
            let json_str = read_document(&transcript_json_path, 32 * 1024 * 1024)?;
            if let Ok(segments) = serde_json::from_str::<Vec<MeetingSegment>>(&json_str) {
                let markdown =
                    render_meeting_markdown(&session.title, &segments, &session.speaker_names);
                let path_clone = path.clone();
                tokio::task::spawn_blocking(move || {
                    write_atomic(&path_clone.join("transcript.md"), markdown.as_bytes())
                })
                .await
                .map_err(|e| e.to_string())??;
            }
        }
    }
    changed(&app, &session);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_meeting_templates() -> Vec<templates::MeetingTemplate> {
    templates::builtin_meeting_templates()
}

#[tauri::command]
#[specta::specta]
pub async fn transcribe_meeting(
    app: AppHandle,
    id: String,
    enhance: Option<bool>,
) -> Result<(), String> {
    let job = claim_job(&app, &id)?;
    let path = directory(&app, &id)?;
    let mut session = load(&path)?;
    let request_enhance = enhance.unwrap_or(session.enhanced);
    let selection = crate::speech_analysis::selection_from_settings(&app);
    let request_settings = get_settings(&app);
    // External live-engine servers have shared locks/ports. Never let an hours-
    // long meeting steal them from dictation. File-analysis sidecars are separate.
    if selection.asr_model_id == crate::speech_analysis::CURRENT_DICTATION_ASR_ID {
        let models = app.state::<Arc<ModelManager>>();
        let info = models
            .get_model_info(&request_settings.selected_model)
            .ok_or("Select and download a local transcription model first.")?;
        if crate::managers::model::engine_uses_remote_runtime(&info.engine_type) {
            return Err("Choose a dedicated File Transcription ASR model, or an in-process dictation model such as Whisper, before processing meetings. Your live dictation engine will not be blocked.".into());
        }
        if app.try_state::<FileTranscriptionEngine>().is_none() {
            return Err("Background transcription engine is unavailable.".into());
        }
    }
    if !path.join("system.wav").is_file() {
        return Err("No finalized system-audio track is available. Restart Vox Jot to recover a partial recording.".into());
    }
    session.state = "transcribing".into();
    session.analysis_error = None;
    save(&path, &session)?;
    changed(&app, &session);
    tauri::async_runtime::spawn(async move {
        let _job = job;
        let result = analyze_tracks(
            &app,
            &path,
            &session,
            request_enhance,
            selection,
            request_settings,
            &_job.cancel,
        )
        .await;
        match result {
            Ok(outcome) => {
                session.apply_analysis_outcome(&outcome);
            }
            Err(failure) => {
                session.apply_analysis_failure(failure.outcome.as_ref(), failure.error);
            }
        }
        if let Err(error) = save(&path, &session) {
            log::error!("Meeting analysis status could not be saved: {error}");
        }
        changed(&app, &session);
    });
    Ok(())
}

async fn analyze_tracks(
    app: &AppHandle,
    path: &Path,
    session: &MeetingSession,
    request_enhance: bool,
    selection: crate::speech_analysis::SpeechAnalysisSelection,
    request_settings: crate::settings::AppSettings,
    cancel: &Arc<AtomicBool>,
) -> Result<AnalysisOutcome, AnalysisFailure> {
    let sidecar = app
        .state::<Arc<crate::sidecar::SidecarManager>>()
        .inner()
        .clone();
    let corrections = app
        .state::<Arc<crate::correction_tracker::store::CorrectionStore>>()
        .inner()
        .clone();
    let mut segments = Vec::new();
    let mut all_tracks_enhanced = request_enhance;
    let mut fallback_reason = None;
    let mut tracks = Vec::new();

    // Resolve every track before ASR begins. This gives all later failures an
    // accurate, durable audio provenance instead of inferring it from whether
    // enhancement was requested.
    for (name, label) in [("system", "System audio"), ("microphone", "Microphone")] {
        if name == "microphone" && !session.include_microphone {
            continue;
        }
        let source = if request_enhance {
            match ensure_enhanced_track(app, path, name, cancel).await {
                Ok(enhanced_track) => enhanced_track,
                Err(reason) => {
                    if cancel.load(Ordering::Acquire) {
                        return Err(AnalysisFailure::before_provenance(reason));
                    }
                    log::warn!(
                        "Enhancement failed for track {name}: {reason}; falling back to raw audio."
                    );
                    all_tracks_enhanced = false;
                    if fallback_reason.is_none() {
                        fallback_reason = Some(reason);
                    }
                    path.join(format!("{name}.wav"))
                }
            }
        } else {
            all_tracks_enhanced = false;
            path.join(format!("{name}.wav"))
        };

        if !storage::is_valid_analysis_track(&source) {
            return Err(AnalysisFailure::before_provenance(format!(
                "Audio track {name} is missing or invalid."
            )));
        }

        tracks.push((name, label, source));
    }

    let outcome = determine_analysis_outcome(request_enhance, all_tracks_enhanced, fallback_reason);

    for (name, label, source) in tracks {
        for core_start_ms in (0..session.duration_ms).step_by(300_000) {
            if cancel.load(Ordering::Acquire) {
                return Err(AnalysisFailure::with_outcome(
                    &outcome,
                    "Analysis cancelled. Original audio and any previous transcript are preserved.",
                ));
            }
            // Do not begin another inference window while live mic capture is active.
            while app
                .try_state::<Arc<crate::managers::audio::AudioRecordingManager>>()
                .is_some_and(|m| m.is_recording())
            {
                if cancel.load(Ordering::Acquire) {
                    return Err(AnalysisFailure::with_outcome(
                        &outcome,
                        "Analysis cancelled.",
                    ));
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            let track_source = source.clone();
            let chunks = tokio::task::spawn_blocking(move || {
                storage::analysis_chunks(&track_source, core_start_ms * SAMPLE_RATE / 1000)
            })
            .await
            .map_err(|error| AnalysisFailure::with_outcome(&outcome, error.to_string()))?
            .map_err(|error| AnalysisFailure::with_outcome(&outcome, error))?;
            for (chunk_index, chunk) in chunks.into_iter().enumerate() {
                if cancel.load(Ordering::Acquire) {
                    return Err(AnalysisFailure::with_outcome(
                        &outcome,
                        "Analysis cancelled. Original audio and any previous transcript are preserved."
                    ));
                }
                // Each speech island is a separate inference request. Yield before
                // every one so meeting analysis cannot monopolize the engine after
                // the user starts live dictation between islands.
                while app
                    .try_state::<Arc<crate::managers::audio::AudioRecordingManager>>()
                    .is_some_and(|m| m.is_recording())
                {
                    if cancel.load(Ordering::Acquire) {
                        return Err(AnalysisFailure::with_outcome(
                            &outcome,
                            "Analysis cancelled.",
                        ));
                    }
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                let result = crate::commands::transcription::transcribe_file_impl_with_snapshot(
                    app.clone(),
                    sidecar.clone(),
                    corrections.clone(),
                    chunk.file.path().to_string_lossy().into_owned(),
                    selection.asr_model_id.clone(),
                    if name == "system" {
                        selection.diarization_model_id.clone()
                    } else {
                        crate::speech_analysis::NO_DIARIZATION_ID.into()
                    },
                    crate::speech_analysis::NO_EMOTION_ID.into(),
                    Some(request_settings.clone()),
                )
                .await
                .map_err(|error| AnalysisFailure::with_outcome(&outcome, error))?;
                let mut chunk_segments = Vec::new();
                if !result.speaker_segments.is_empty() {
                    // Speaker IDs are local to each diarization window. Never imply
                    // that Speaker 1 in different windows is the same person.
                    chunk_segments.extend(result.speaker_segments.into_iter().map(|s| {
                        MeetingSegment {
                            start_ms: s.start_ms,
                            end_ms: s.end_ms,
                            speaker: format!(
                                "System block {} · island {} · {}",
                                core_start_ms / 300_000 + 1,
                                chunk_index + 1,
                                s.speaker_id
                            ),
                            text: s.text,
                        }
                    }));
                } else if !result.segments.is_empty() {
                    chunk_segments.extend(result.segments.into_iter().map(|s| MeetingSegment {
                        start_ms: s.start_ms,
                        end_ms: s.end_ms,
                        speaker: label.into(),
                        text: s.text,
                    }));
                } else if !result.text.trim().is_empty() {
                    chunk_segments.push(MeetingSegment {
                        start_ms: 0,
                        end_ms: chunk.duration_ms,
                        speaker: label.into(),
                        text: result.text,
                    });
                }
                for mut segment in chunk_segments {
                    segment.start_ms += chunk.start_ms;
                    segment.end_ms += chunk.start_ms;
                    let midpoint =
                        segment.start_ms + segment.end_ms.saturating_sub(segment.start_ms) / 2;
                    if (core_start_ms..core_start_ms + 300_000).contains(&midpoint) {
                        segment.end_ms = segment.end_ms.min(session.duration_ms);
                        segments.push(segment);
                    }
                }
            }
        }
    }
    segments.sort_by_key(|s| (s.start_ms, s.end_ms));
    if segments.is_empty() {
        return Err(AnalysisFailure::with_outcome(
            &outcome,
            "No speech was recognized. Original recordings are preserved.",
        ));
    }
    if cancel.load(Ordering::Acquire) {
        return Err(AnalysisFailure::with_outcome(
            &outcome,
            "Analysis cancelled; audio and previous results are preserved.",
        ));
    }
    let markdown = render_meeting_markdown(&session.title, &segments, &session.speaker_names);
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        let mix_path = path.join("mix.wav");
        match fs::symlink_metadata(&mix_path) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => return Err("The meeting mix path is not a regular file.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                storage::mix_tracks(&path, session_include_mic(&path)?)?;
            }
            Err(error) => return Err(error.to_string()),
        }
        write_atomic(
            &path.join("transcript.json"),
            &serde_json::to_vec_pretty(&segments).map_err(|e| e.to_string())?,
        )?;
        write_atomic(&path.join("transcript.md"), markdown.as_bytes())
    })
    .await
    .map_err(|error| AnalysisFailure::with_outcome(&outcome, error.to_string()))?
    .map_err(|error| AnalysisFailure::with_outcome(&outcome, error))?;

    Ok(outcome)
}

pub(crate) fn determine_analysis_outcome(
    request_enhance: bool,
    all_tracks_enhanced: bool,
    fallback_reason: Option<String>,
) -> AnalysisOutcome {
    let (audio_source, final_enhanced) = if all_tracks_enhanced {
        ("enhanced".to_string(), true)
    } else if request_enhance {
        ("fallback".to_string(), false)
    } else {
        ("original".to_string(), false)
    };

    AnalysisOutcome {
        enhanced: final_enhanced,
        audio_source,
        fallback_reason: if final_enhanced {
            None
        } else {
            fallback_reason
        },
    }
}
fn session_include_mic(path: &Path) -> Result<bool, String> {
    Ok(load(path)?.include_microphone)
}

#[tauri::command]
#[specta::specta]
pub async fn summarize_meeting(
    app: AppHandle,
    id: String,
    template_id: Option<String>,
) -> Result<(), String> {
    let job = claim_job(&app, &id)?;
    let path = directory(&app, &id)?;
    let mut session = load(&path)?;
    if !session.transcript_ready {
        return Err("Transcribe the meeting before creating a summary.".into());
    }
    let settings = get_settings(&app);
    let provider = settings
        .active_post_process_provider()
        .ok_or("Choose a local Refine provider first.")?
        .clone();
    if !crate::settings::post_process_provider_is_local(&provider) {
        return Err("Meeting summaries are local-only. Choose Apple Intelligence or a local model in Refine settings first.".into());
    }
    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if provider.id != crate::settings::APPLE_INTELLIGENCE_PROVIDER_ID && model.trim().is_empty() {
        return Err("Select a local Refine model before generating a summary.".into());
    }
    let transcript = read_document(&path.join("transcript.md"), 32 * 1024 * 1024)?;
    let (_template_id, system_prompt) = templates::resolve_template(template_id.as_deref())?;
    session.state = "summarizing".into();
    session.analysis_error = None;
    save(&path, &session)?;
    changed(&app, &session);
    tauri::async_runtime::spawn(async move {
        let _job = job;
        let result = summarize_local(
            &app,
            provider,
            &model,
            &transcript,
            &system_prompt,
            &_job.cancel,
        )
        .await;
        session.state = "ready".into();
        match result {
            Ok(summary) => match write_atomic(&path.join("summary.md"), summary.as_bytes()) {
                Ok(()) => session.summary_ready = true,
                Err(error) => session.analysis_error = Some(error),
            },
            Err(error) => session.analysis_error = Some(error),
        }
        if let Err(error) = save(&path, &session) {
            log::error!("Meeting summary status could not be saved: {error}");
        }
        changed(&app, &session);
    });
    Ok(())
}

async fn summarize_local(
    app: &AppHandle,
    provider: crate::settings::PostProcessProvider,
    model: &str,
    transcript: &str,
    system_prompt: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    if transcript.split_whitespace().any(|word| word.len() > 6000) {
        return Err("The transcript contains an unbroken token larger than the local model context budget. Inspect the transcript before summarizing; original audio is preserved.".into());
    }
    let mut input = transcript.to_string();
    // Bound each request for small local context windows; reduce hierarchically.
    for _ in 0..5 {
        let chunks = split_summary_chunks(&input, 6000);
        let single = chunks.len() == 1;
        let mut summaries = Vec::new();
        for chunk in chunks {
            if cancel.load(Ordering::Acquire) {
                return Err(
                    "Summary cancelled. Previous notes and transcript are preserved.".into(),
                );
            }
            let text = if provider.id == crate::settings::APPLE_INTELLIGENCE_PROVIDER_ID {
                #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
                {
                    let prompt = system_prompt.to_string();
                    tokio::task::spawn_blocking(move || {
                        crate::apple_intelligence::process_text_with_system_prompt(
                            &prompt, &chunk, 1200,
                        )
                    })
                    .await
                    .map_err(|e| e.to_string())??
                }
                #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
                {
                    return Err("Apple Intelligence requires Apple Silicon macOS.".into());
                }
            } else {
                let key = crate::secret_store::get_post_process_api_key(&provider.id)
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default();
                crate::llm_client::send_chat_completion_with_schema(
                    Some(app),
                    &provider,
                    key,
                    model,
                    chunk,
                    Some(system_prompt.into()),
                    None,
                )
                .await?
                .ok_or("Local summary model returned no content.")?
            };
            if text.trim().is_empty() {
                return Err("Local model returned an empty summary.".into());
            }
            summaries.push(text);
        }
        input = summaries.join("\n\n");
        if input.split_whitespace().any(|word| word.len() > 6000) || input.len() > 32 * 1024 * 1024
        {
            return Err("The local model returned an oversized summary. Audio and previous notes are preserved.".into());
        }
        if cancel.load(Ordering::Acquire) {
            return Err("Summary cancelled.".into());
        }
        if single {
            return Ok(format!("# Meeting summary\n\nMachine-generated; verify against the transcript before relying on it.\n\n{input}\n"));
        }
    }
    Err("Summary could not be reduced within the local model's context limit. The transcript and audio are preserved.".into())
}
fn split_summary_chunks(text: &str, limit: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if !current.is_empty() && current.len() + word.len() + 1 > limit {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

#[tauri::command]
#[specta::specta]
pub async fn reveal_meeting(app: AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = directory(&app, &id)?;
    app.opener()
        .reveal_item_in_dir(path.join("session.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_meeting(app: AppHandle, id: String, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("Confirm deletion before removing meeting recordings.".into());
    }
    let _job = claim_job(&app, &id)?;
    let path = directory(&app, &id)?;
    // Recoverable removal: move the exact session into app-owned Deleted Meetings.
    // Never recursively delete the meeting store or user-selected directories.
    tokio::task::spawn_blocking(move || {
        let deleted = root(&app)?.join("deleted");
        fs::create_dir_all(&deleted).map_err(|e| e.to_string())?;
        let destination = deleted.join(&id);
        if destination.exists() {
            return Err("A recoverable deleted copy already exists; nothing was removed.".into());
        }
        fs::rename(path, destination).map_err(|e| e.to_string())?;
        let _ = app.emit(
            "meeting-updated",
            serde_json::json!({"id": id, "state": "deleted"}),
        );
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn meeting_document_reads_are_bounded_and_reject_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("transcript.md");
        fs::write(&path, "Meeting notes").unwrap();
        assert_eq!(read_document(&path, 128).unwrap(), "Meeting notes");
        assert!(read_document(&path, 4).is_err());
        #[cfg(unix)]
        {
            let link = directory.path().join("link.md");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(read_document(&link, 128).is_err());
        }
    }
    #[test]
    fn summary_chunks_preserve_unicode_and_every_word() {
        let input = "Hello 世界 and a meeting about résumé details repeated here";
        let chunks = split_summary_chunks(input, 18);
        assert_eq!(chunks.join(" "), input);
        assert!(chunks.iter().all(|s| s.len() <= 18));
    }
    #[test]
    fn bounded_audio_queue_reports_loss_and_stops() {
        let key = NEXT_CAPTURE.fetch_add(1, Ordering::Relaxed);
        let signals = Arc::new(RunSignals {
            id: "test".into(),
            stop: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            dropped: AtomicU64::new(0),
        });
        let (sender, _receiver) = mpsc::sync_channel(1);
        SINKS.lock().unwrap().insert(
            key,
            Arc::new(Sink {
                sender,
                signals: signals.clone(),
            }),
        );
        let samples = [0.25f32; 16];
        receive_audio(key, 1, samples.as_ptr(), 16, 0, 48000, 1);
        receive_audio(key, 1, samples.as_ptr(), 16, 1000, 48000, 1);
        assert_eq!(signals.dropped.load(Ordering::Relaxed), 1);
        assert!(signals.stop.load(Ordering::Acquire));
        SINKS.lock().unwrap().remove(&key);
        // Late callbacks from released sessions are safely ignored.
        receive_audio(key, 1, samples.as_ptr(), 16, 2000, 48000, 1);
    }
    #[test]
    fn test_render_meeting_markdown_uses_speaker_names() {
        let segments = vec![
            MeetingSegment {
                start_ms: 0,
                end_ms: 10_000,
                speaker: "System block 1 · island 1 · 0".into(),
                text: "Hello everyone.".into(),
            },
            MeetingSegment {
                start_ms: 12_000,
                end_ms: 20_000,
                speaker: "Microphone".into(),
                text: "Thanks for joining.".into(),
            },
        ];
        let mut speaker_names = HashMap::new();
        speaker_names.insert("System block 1 · island 1 · 0".into(), "Alice".into());
        speaker_names.insert("Microphone".into(), "Bob".into());

        let markdown = render_meeting_markdown("Sprint Sync", &segments, &speaker_names);
        assert!(markdown.contains("# Sprint Sync"));
        assert!(markdown.contains("**00:00 — Alice**\n\nHello everyone."));
        assert!(markdown.contains("**00:12 — Bob**\n\nThanks for joining."));
    }

    #[test]
    fn test_meeting_session_serde_backward_compatibility() {
        // Old session without enhanced, audio_source, fallback_reason, or speaker_names
        let legacy_json = r#"{
            "id": "legacy-session-1",
            "title": "Old Meeting",
            "created_at": 1700000000,
            "state": "ready",
            "error": null,
            "system_source": "Default",
            "system_process_id": 0,
            "microphone_id": "Default",
            "include_microphone": false,
            "sample_rate": 16000,
            "duration_ms": 60000,
            "dropped_buffers": 0,
            "system": {
                "frames": 960000,
                "received_frames": 960000,
                "inserted_silence_frames": 0,
                "overlap_frames": 0,
                "first_timestamp_us": null,
                "source_sample_rates": [],
                "source_channel_counts": [],
                "peak": 0.5
            },
            "microphone": {
                "frames": 0,
                "received_frames": 0,
                "inserted_silence_frames": 0,
                "overlap_frames": 0,
                "first_timestamp_us": null,
                "source_sample_rates": [],
                "source_channel_counts": [],
                "peak": 0.0
            },
            "transcript_ready": true,
            "summary_ready": false,
            "analysis_error": null,
            "backend": "local"
        }"#;

        let session: MeetingSession = serde_json::from_str(legacy_json).unwrap();
        assert_eq!(session.id, "legacy-session-1");
        assert!(!session.enhanced);
        assert_eq!(session.audio_source, None);
        assert_eq!(session.fallback_reason, None);
        assert!(session.speaker_names.is_empty());

        // Now test serialization round-trip with enhancement state
        let mut updated = session.clone();
        updated.enhanced = false;
        updated.audio_source = Some("fallback".into());
        updated.fallback_reason = Some("Enhancement failed for system: RNNoise error".into());

        let serialized = serde_json::to_string_pretty(&updated).unwrap();
        let reloaded: MeetingSession = serde_json::from_str(&serialized).unwrap();
        assert!(!reloaded.enhanced);
        assert_eq!(reloaded.audio_source.as_deref(), Some("fallback"));
        assert_eq!(
            reloaded.fallback_reason.as_deref(),
            Some("Enhancement failed for system: RNNoise error")
        );
    }

    #[test]
    fn test_enhancement_succeeds_state_and_artifact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        let raw_path = path.join("system.wav");

        // Write a valid 16kHz mono raw track
        let mut writer = storage::TrackWriter::create(&raw_path).unwrap();
        let samples = vec![0.1f32; 1600];
        writer.append(&samples, 0, 16000, 1).unwrap();
        writer.finish(1600).unwrap();
        assert!(storage::is_valid_analysis_track(&raw_path));

        let cancel = AtomicBool::new(false);
        let enhanced_path = prepare_enhanced_track_sync(path, "system", &cancel, || false)
            .expect("Enhancement should succeed for valid raw track");

        assert!(enhanced_path.is_file());
        assert!(storage::is_valid_analysis_track(&enhanced_path));

        // When all tracks succeed, outcome reports enhanced with no fallback
        let outcome = determine_analysis_outcome(true, true, None);
        assert!(outcome.enhanced);
        assert_eq!(outcome.audio_source, "enhanced");
        assert_eq!(outcome.fallback_reason, None);

        let mut session = MeetingSession {
            id: "test-session".into(),
            title: "Test".into(),
            created_at: 0,
            state: "recording".into(),
            error: None,
            system_source: "Default".into(),
            system_process_id: 0,
            microphone_id: "Default".into(),
            include_microphone: false,
            sample_rate: 16000,
            duration_ms: 100,
            dropped_buffers: 0,
            system: TrackStats::default(),
            microphone: TrackStats::default(),
            transcript_ready: false,
            summary_ready: false,
            analysis_error: None,
            backend: "local".into(),
            enhanced: false,
            audio_source: None,
            fallback_reason: None,
            speaker_names: HashMap::new(),
        };

        session.apply_analysis_outcome(&outcome);
        assert!(session.enhanced);
        assert_eq!(session.audio_source.as_deref(), Some("enhanced"));
        assert_eq!(session.fallback_reason, None);
        assert_eq!(session.state, "ready");
        assert!(session.transcript_ready);
    }

    #[test]
    fn analysis_failure_preserves_audio_provenance_and_clears_stale_fallback_reason() {
        let mut session = MeetingSession {
            id: "test-session".into(),
            title: "Test".into(),
            created_at: 0,
            state: "transcribing".into(),
            error: None,
            system_source: "Default".into(),
            system_process_id: 0,
            microphone_id: "Default".into(),
            include_microphone: false,
            sample_rate: 16000,
            duration_ms: 100,
            dropped_buffers: 0,
            system: TrackStats::default(),
            microphone: TrackStats::default(),
            transcript_ready: false,
            summary_ready: false,
            analysis_error: None,
            backend: "local".into(),
            enhanced: true,
            audio_source: Some("enhanced".into()),
            fallback_reason: Some("stale fallback".into()),
            speaker_names: HashMap::new(),
        };

        let outcome = AnalysisOutcome {
            enhanced: true,
            audio_source: "enhanced".into(),
            fallback_reason: None,
        };
        session.apply_analysis_failure(Some(&outcome), "ASR failed after enhancement".into());

        assert_eq!(session.state, "recorded");
        assert_eq!(
            session.analysis_error.as_deref(),
            Some("ASR failed after enhancement")
        );
        assert!(session.enhanced);
        assert_eq!(session.audio_source.as_deref(), Some("enhanced"));
        assert_eq!(session.fallback_reason, None);
    }

    #[test]
    fn test_enhancement_fails_fallback_to_raw_audio() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        let raw_path = path.join("system.wav");

        // Write a valid 16kHz mono raw track
        let mut writer = storage::TrackWriter::create(&raw_path).unwrap();
        let samples = vec![0.1f32; 1600];
        writer.append(&samples, 0, 16000, 1).unwrap();
        writer.finish(1600).unwrap();
        assert!(storage::is_valid_analysis_track(&raw_path));

        // Trigger enhancement failure via cancellation flag
        let cancel = AtomicBool::new(true);
        let enhance_res = prepare_enhanced_track_sync(path, "system", &cancel, || false);
        assert!(enhance_res.is_err());
        let failure_reason = enhance_res.err().unwrap();

        // Fallback selects the original raw audio, which remains valid
        let fallback_source = path.join("system.wav");
        assert!(fallback_source.is_file());
        assert!(storage::is_valid_analysis_track(&fallback_source));

        // When enhancement fails, outcome reports fallback and records reason
        let outcome = determine_analysis_outcome(true, false, Some(failure_reason.clone()));
        assert!(!outcome.enhanced);
        assert_eq!(outcome.audio_source, "fallback");
        assert_eq!(
            outcome.fallback_reason.as_deref(),
            Some(failure_reason.as_str())
        );

        let mut session = MeetingSession {
            id: "test-session".into(),
            title: "Test".into(),
            created_at: 0,
            state: "recording".into(),
            error: None,
            system_source: "Default".into(),
            system_process_id: 0,
            microphone_id: "Default".into(),
            include_microphone: false,
            sample_rate: 16000,
            duration_ms: 100,
            dropped_buffers: 0,
            system: TrackStats::default(),
            microphone: TrackStats::default(),
            transcript_ready: false,
            summary_ready: false,
            analysis_error: None,
            backend: "local".into(),
            enhanced: false,
            audio_source: None,
            fallback_reason: None,
            speaker_names: HashMap::new(),
        };

        session.apply_analysis_outcome(&outcome);
        assert!(!session.enhanced);
        assert_eq!(session.audio_source.as_deref(), Some("fallback"));
        assert_eq!(
            session.fallback_reason.as_deref(),
            Some(failure_reason.as_str())
        );
    }

    #[test]
    fn test_corrupt_enhanced_artifact_cleaned_and_never_claimed_enhanced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        let raw_path = path.join("system.wav");
        let enhanced_path = path.join("system.enhanced.wav");

        // Write a valid 16kHz mono raw track
        let mut writer = storage::TrackWriter::create(&raw_path).unwrap();
        let samples = vec![0.1f32; 1600];
        writer.append(&samples, 0, 16000, 1).unwrap();
        writer.finish(1600).unwrap();
        assert!(storage::is_valid_analysis_track(&raw_path));

        // Create a corrupt enhanced file (garbage content)
        std::fs::write(&enhanced_path, b"corrupted incomplete header").unwrap();
        assert!(!storage::is_valid_analysis_track(&enhanced_path));

        // Pre-existing corrupt artifact is purged by prepare_enhanced_track_sync
        let cancel = AtomicBool::new(false);
        let result = prepare_enhanced_track_sync(path, "system", &cancel, || false);
        assert!(result.is_ok());
        assert!(enhanced_path.is_file());
        assert!(storage::is_valid_analysis_track(&enhanced_path));

        // If corrupt file cannot be regenerated (e.g. cancelled), it is removed from disk
        std::fs::write(&enhanced_path, b"corrupted again").unwrap();
        let cancel_cancelled = AtomicBool::new(true);
        let failed_result =
            prepare_enhanced_track_sync(path, "system", &cancel_cancelled, || false);
        assert!(failed_result.is_err());
        assert!(
            !enhanced_path.exists(),
            "Corrupt artifact must be removed from disk"
        );

        // Fallback uses the intact original raw audio
        assert!(storage::is_valid_analysis_track(&raw_path));

        // Session never claims enhanced
        let outcome = determine_analysis_outcome(true, false, Some("Corrupt artifact".into()));
        assert!(!outcome.enhanced);
        assert_eq!(outcome.audio_source, "fallback");

        let mut session = MeetingSession {
            id: "test-session".into(),
            title: "Test".into(),
            created_at: 0,
            state: "recording".into(),
            error: None,
            system_source: "Default".into(),
            system_process_id: 0,
            microphone_id: "Default".into(),
            include_microphone: false,
            sample_rate: 16000,
            duration_ms: 100,
            dropped_buffers: 0,
            system: TrackStats::default(),
            microphone: TrackStats::default(),
            transcript_ready: false,
            summary_ready: false,
            analysis_error: None,
            backend: "local".into(),
            enhanced: false,
            audio_source: None,
            fallback_reason: None,
            speaker_names: HashMap::new(),
        };

        session.apply_analysis_outcome(&outcome);
        assert!(!session.enhanced);
        assert_eq!(session.audio_source.as_deref(), Some("fallback"));
    }
}
