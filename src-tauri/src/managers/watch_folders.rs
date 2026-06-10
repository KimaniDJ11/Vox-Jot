//! Auto-transcription for files dropped into watched folders.
//!
//! ## Design in plain English
//!
//! - The user adds folders in **Dictate → File transcription**.
//! - For each enabled folder we ask the OS for filesystem events using
//!   the `notify` crate, then debounce them so a file that's still being
//!   copied isn't transcribed mid-write. The supervisor also does a cheap
//!   root-exists health check so a deleted watched folder is not silent.
//! - When a settled audio file appears, we run the existing
//!   `transcribe_with_segments` pipeline on a Tokio task and write the
//!   transcript next to the source file (or as `.srt`/`.vtt`).
//! - All work happens off the dictation hot path. Recording-start latency
//!   is unaffected because nothing in this module runs unless a file
//!   actually changes.
//!
//! ## Lifecycle
//!
//! `WatchFolderManager::new()` returns immediately and starts a single
//! supervisor thread. The supervisor reads `settings.watch_folders` and
//! re-initializes the underlying watcher whenever the list changes
//! (driven by a `settings-changed` event listener registered in `lib.rs`).

use crate::helpers::subtitles::{to_srt, to_vtt};
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, WatchFolderConfig, WatchFolderOutputFormat};
use anyhow::Result;
use log::{debug, info, warn};
use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

/// Audio/video extensions we'll auto-transcribe. Mirrors the frontend
/// drag-drop allow-list in `FileTranscriptionPanel.tsx`.
const AUDIO_VIDEO_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "mp4", "mov", "m4v", "webm",
    "mkv", "3gp",
];
const WATCH_FOLDER_MAX_CONCURRENT_FILES: usize = 2;
const WATCH_FOLDER_STABLE_CHECKS: usize = 3;
const WATCH_FOLDER_STABLE_INTERVAL: Duration = Duration::from_millis(500);
const WATCH_FOLDER_STABLE_MAX_WAIT: Duration = Duration::from_secs(30);

#[derive(Clone, serde::Serialize)]
pub struct WatchFolderProgressEvent {
    pub folder_id: String,
    pub source_path: String,
    pub stage: WatchFolderStage,
    pub message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WatchFolderStage {
    Started,
    Completed,
    Failed,
    Missing,
}

pub struct WatchFolderManager {
    app: AppHandle,
    /// Sentinel that tells the supervisor thread to shut down on app exit.
    shutdown: Arc<AtomicBool>,
    /// Join handle for the supervisor thread. Tauri does not guarantee managed
    /// state drops before native finalizers run, so shutdown is explicit.
    supervisor_handle: Mutex<Option<thread::JoinHandle<()>>>,
    /// Files we've already started processing — guard against the same
    /// `notify` event firing twice (which is common across editors).
    in_flight: Arc<Mutex<HashSet<PathBuf>>>,
    /// Expensive decode/transcribe work is bounded so a large folder drop
    /// cannot monopolize all blocking worker threads.
    processing_slots: Arc<Semaphore>,
    /// Folder ids already reported as missing so a deleted directory does not
    /// spam the activity feed while settings still contain its row.
    missing_reported: Arc<Mutex<HashSet<String>>>,
    /// Bumped from `reload_from_settings` so the supervisor thread
    /// rebuilds its watcher on the next iteration.
    config_version: Arc<std::sync::atomic::AtomicU64>,
}

impl WatchFolderManager {
    pub fn new(app: &AppHandle) -> Arc<Self> {
        let manager = Arc::new(Self {
            app: app.clone(),
            shutdown: Arc::new(AtomicBool::new(false)),
            supervisor_handle: Mutex::new(None),
            in_flight: Arc::new(Mutex::new(HashSet::new())),
            processing_slots: Arc::new(Semaphore::new(WATCH_FOLDER_MAX_CONCURRENT_FILES)),
            missing_reported: Arc::new(Mutex::new(HashSet::new())),
            config_version: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        });

        let manager_for_thread = Arc::clone(&manager);
        match thread::Builder::new()
            .name("watch-folders".into())
            .spawn(move || manager_for_thread.run_supervisor())
        {
            Ok(handle) => {
                *manager
                    .supervisor_handle
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
            }
            Err(error) => {
                // Don't crash on launch if the OS can't spawn the supervisor
                // thread (e.g. resource exhaustion); folder watching is simply
                // disabled for this session.
                log::error!("Failed to spawn watch-folders supervisor thread; folder watching disabled: {error}");
            }
        }

        manager
    }

    /// Called from the `settings-changed` listener so the supervisor
    /// rebuilds its watch list on the next tick.
    pub fn reload_from_settings(&self) {
        self.config_version.fetch_add(1, Ordering::Relaxed);
    }

    /// Stop the supervisor and join it before process teardown reaches native
    /// filesystem watcher finalizers.
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        self.config_version.fetch_add(1, Ordering::Relaxed);

        let handle = self
            .supervisor_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();

        if let Some(handle) = handle {
            if handle.thread().id() == thread::current().id() {
                return;
            }
            if let Err(err) = handle.join() {
                warn!("watch-folders: supervisor thread panicked during shutdown: {err:?}");
            } else {
                debug!("watch-folders: supervisor joined during shutdown");
            }
        }
    }

    fn run_supervisor(self: Arc<Self>) {
        // Outer loop: rebuild the debouncer whenever the user changes
        // the watch list. Each iteration owns one `Debouncer`; it dies
        // when the inner loop returns and we start fresh.
        let mut last_seen_version = u64::MAX;
        while !self.shutdown.load(Ordering::Relaxed) {
            let current_version = self.config_version.load(Ordering::Relaxed);
            if current_version == last_seen_version {
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            last_seen_version = current_version;

            let enabled_folders: Vec<WatchFolderConfig> = get_settings(&self.app)
                .watch_folders
                .into_iter()
                .filter(|f| f.enabled)
                .collect();
            let mut folders = Vec::new();

            for cfg in enabled_folders {
                if Path::new(&cfg.path).is_dir() {
                    self.clear_missing_reported(&cfg.id);
                    folders.push(cfg);
                } else {
                    self.emit_missing_folder(&cfg);
                }
            }

            if folders.is_empty() {
                debug!("watch-folders: no enabled folders; supervisor idle");
                continue;
            }

            info!(
                "watch-folders: starting watcher for {} folder(s)",
                folders.len()
            );

            let folders_by_root: HashMap<PathBuf, WatchFolderConfig> = folders
                .iter()
                .map(|f| (PathBuf::from(&f.path), f.clone()))
                .collect();

            let manager_for_handler = Arc::clone(&self);
            let folders_for_handler = folders_by_root.clone();
            let mut debouncer = match new_debouncer(
                Duration::from_millis(750),
                None,
                move |res: DebounceEventResult| match res {
                    Ok(events) => {
                        for ev in events {
                            for path in &ev.paths {
                                if let Some((root, cfg)) =
                                    find_owning_folder(path, &folders_for_handler)
                                {
                                    if !root.is_dir() {
                                        manager_for_handler.emit_missing_folder(cfg);
                                        manager_for_handler.reload_from_settings();
                                        continue;
                                    }
                                    manager_for_handler.maybe_handle_file(
                                        path.clone(),
                                        cfg.clone(),
                                        root,
                                    );
                                }
                            }
                        }
                    }
                    Err(errors) => {
                        for err in errors {
                            warn!("watch-folders: debouncer error: {}", err);
                        }
                    }
                },
            ) {
                Ok(d) => d,
                Err(err) => {
                    warn!("watch-folders: failed to start debouncer: {}", err);
                    thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };

            for cfg in &folders {
                if let Err(err) = debouncer
                    .watcher()
                    .watch(Path::new(&cfg.path), RecursiveMode::Recursive)
                {
                    warn!("watch-folders: failed to watch '{}': {}", cfg.path, err);
                    self.emit_missing_folder(cfg);
                }
            }

            // Hold the debouncer alive while the version is unchanged.
            while !self.shutdown.load(Ordering::Relaxed)
                && self.config_version.load(Ordering::Relaxed) == last_seen_version
            {
                if let Some(cfg) = folders.iter().find(|cfg| !Path::new(&cfg.path).is_dir()) {
                    self.emit_missing_folder(cfg);
                    self.reload_from_settings();
                    break;
                }
                thread::sleep(Duration::from_millis(500));
            }

            // Dropping the debouncer here unsubscribes from filesystem
            // events for all folders it was managing.
            drop(debouncer);
            debug!("watch-folders: supervisor reloading config");
        }
    }

    fn maybe_handle_file(self: &Arc<Self>, path: PathBuf, cfg: WatchFolderConfig, _root: PathBuf) {
        // Only process actual audio/video files.
        let Some(ext) = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
        else {
            return;
        };
        if !AUDIO_VIDEO_EXTENSIONS.iter().any(|allowed| *allowed == ext) {
            return;
        }
        if !path.is_file() {
            return;
        }

        // Skip if we're already processing this file.
        {
            let mut in_flight = self
                .in_flight
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !in_flight.insert(path.clone()) {
                return;
            }
        }

        let manager = Arc::clone(self);
        let slots = Arc::clone(&self.processing_slots);
        // The transcription call is sync; queue an async task first so heavy
        // blocking work is bounded by the semaphore.
        tauri::async_runtime::spawn(async move {
            let permit = match slots.acquire_owned().await {
                Ok(permit) => permit,
                Err(err) => {
                    warn!("watch-folders: processing semaphore closed: {err}");
                    manager
                        .in_flight
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .remove(&path);
                    return;
                }
            };

            let manager_for_blocking = Arc::clone(&manager);
            let path_for_blocking = path.clone();
            let join_result = tauri::async_runtime::spawn_blocking(move || {
                manager_for_blocking.process_file(path_for_blocking, cfg);
            })
            .await;

            drop(permit);

            if let Err(err) = join_result {
                warn!("watch-folders: processing task failed to join: {err}");
            }

            manager
                .in_flight
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&path);
        });
    }

    fn process_file(&self, path: PathBuf, cfg: WatchFolderConfig) {
        let path_str = path.to_string_lossy().to_string();
        let _ = self.app.emit(
            "watch-folder-progress",
            WatchFolderProgressEvent {
                folder_id: cfg.id.clone(),
                source_path: path_str.clone(),
                stage: WatchFolderStage::Started,
                message: None,
            },
        );

        let manager = match self.app.try_state::<Arc<TranscriptionManager>>() {
            Some(m) => m.inner().clone(),
            None => {
                warn!("watch-folders: TranscriptionManager not available");
                return;
            }
        };

        if let Err(err) = wait_for_stable_file(&path) {
            self.emit_failure(&cfg, &path_str, &err);
            return;
        }

        // Reuse the same audio-decoding helpers the file command uses.
        let audio_result = decode_audio_file(&path);
        let audio = match audio_result {
            Ok(samples) => samples,
            Err(err) => {
                self.emit_failure(&cfg, &path_str, &err);
                return;
            }
        };

        let result = manager.transcribe_with_segments(Arc::new(audio));
        let (text, segments) = match result {
            Ok(pair) => pair,
            Err(err) => {
                self.emit_failure(&cfg, &path_str, &err.to_string());
                return;
            }
        };

        let output_path = build_output_path(&path, cfg.output_format);
        let body = match cfg.output_format {
            WatchFolderOutputFormat::Text => text.clone(),
            WatchFolderOutputFormat::Srt => to_srt(&segments),
            WatchFolderOutputFormat::Vtt => to_vtt(&segments),
        };

        if let Err(err) = std::fs::write(&output_path, body.as_bytes()) {
            self.emit_failure(
                &cfg,
                &path_str,
                &format!("failed to write {}: {}", output_path.display(), err),
            );
            return;
        }

        if cfg.delete_after {
            if let Err(err) = std::fs::remove_file(&path) {
                warn!(
                    "watch-folders: transcribed but could not delete '{}': {}",
                    path.display(),
                    err
                );
            }
        }

        let _ = self.app.emit(
            "watch-folder-progress",
            WatchFolderProgressEvent {
                folder_id: cfg.id.clone(),
                source_path: path_str,
                stage: WatchFolderStage::Completed,
                message: Some(output_path.to_string_lossy().to_string()),
            },
        );
    }

    fn emit_failure(&self, cfg: &WatchFolderConfig, source: &str, msg: &str) {
        warn!("watch-folders: '{}' failed: {}", source, msg);
        let _ = self.app.emit(
            "watch-folder-progress",
            WatchFolderProgressEvent {
                folder_id: cfg.id.clone(),
                source_path: source.to_string(),
                stage: WatchFolderStage::Failed,
                message: Some(msg.to_string()),
            },
        );
    }

    fn emit_missing_folder(&self, cfg: &WatchFolderConfig) {
        let mut reported = self
            .missing_reported
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !reported.insert(cfg.id.clone()) {
            return;
        }
        drop(reported);

        warn!("watch-folders: watched folder '{}' is missing", cfg.path);
        let _ = self.app.emit(
            "watch-folder-progress",
            WatchFolderProgressEvent {
                folder_id: cfg.id.clone(),
                source_path: cfg.path.clone(),
                stage: WatchFolderStage::Missing,
                message: Some("Folder was deleted or is no longer available.".to_string()),
            },
        );
    }

    fn clear_missing_reported(&self, id: &str) {
        self.missing_reported
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(id);
    }
}

impl Drop for WatchFolderManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn find_owning_folder<'a>(
    path: &Path,
    folders: &'a HashMap<PathBuf, WatchFolderConfig>,
) -> Option<(PathBuf, &'a WatchFolderConfig)> {
    folders
        .iter()
        .find(|(root, _)| path.starts_with(root))
        .map(|(root, cfg)| (root.clone(), cfg))
}

fn build_output_path(input: &Path, format: WatchFolderOutputFormat) -> PathBuf {
    let ext = match format {
        WatchFolderOutputFormat::Text => "txt",
        WatchFolderOutputFormat::Srt => "srt",
        WatchFolderOutputFormat::Vtt => "vtt",
    };
    let mut out = input.to_path_buf();
    out.set_extension(ext);
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileStabilitySignature {
    len: u64,
    modified: Option<SystemTime>,
}

fn file_stability_signature(path: &Path) -> Result<FileStabilitySignature, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("failed to inspect '{}': {}", path.display(), err))?;
    if !metadata.is_file() {
        return Err(format!("'{}' is not a file", path.display()));
    }

    Ok(FileStabilitySignature {
        len: metadata.len(),
        modified: metadata.modified().ok(),
    })
}

fn wait_for_stable_file(path: &Path) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let mut stable_count = 0usize;
    let mut last_signature = file_stability_signature(path)?;

    loop {
        if started_at.elapsed() >= WATCH_FOLDER_STABLE_MAX_WAIT {
            return Err(format!(
                "file did not become stable within {} seconds",
                WATCH_FOLDER_STABLE_MAX_WAIT.as_secs()
            ));
        }

        thread::sleep(WATCH_FOLDER_STABLE_INTERVAL);
        let next_signature = file_stability_signature(path)?;
        if next_signature == last_signature {
            stable_count += 1;
            if stable_count >= WATCH_FOLDER_STABLE_CHECKS {
                return Ok(());
            }
        } else {
            stable_count = 0;
            last_signature = next_signature;
        }
    }
}

/// Decode an audio file into 16 kHz mono f32 samples by reusing the
/// helpers from `commands::transcription`. We call them directly (rather
/// than invoking the Tauri command) so we don't need the `State` plumbing.
fn decode_audio_file(path: &Path) -> Result<Vec<f32>, String> {
    let path_str = path.to_string_lossy().to_string();
    let is_wav = path_str.to_ascii_lowercase().ends_with(".wav");
    if is_wav {
        let (mono, sample_rate) = crate::commands::transcription::read_wav_as_mono_f32(&path_str)?;
        Ok(crate::commands::transcription::resample_linear(
            &mono,
            sample_rate,
            16_000,
        ))
    } else {
        let ffmpeg_exe = crate::commands::transcription::resolve_ffmpeg_exe();
        crate::commands::transcription::decode_with_ffmpeg_blocking(&ffmpeg_exe, &path_str)
    }
}
