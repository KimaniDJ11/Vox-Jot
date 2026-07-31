//! Auto-transcription for files dropped into watched folders.
//!
//! ## Design in plain English
//!
//! - The user adds folders in **Dictate → File transcription**.
//! - For each enabled folder we ask the OS for filesystem events using
//!   the `notify` crate, then debounce them so a file that's still being
//!   copied isn't transcribed mid-write. The supervisor also does a cheap
//!   root-exists health check so a deleted watched folder is not silent.
//! - When a settled audio file appears, we run the same `transcribe_file_impl`
//!   pipeline as the File Transcription panel (File-ASR model selection,
//!   personal dictionary, speaker labels) and write the transcript next to
//!   the source file (or as `.srt`/`.vtt`).
//! - All work happens off the dictation hot path. Recording-start latency
//!   is unaffected because nothing in this module runs unless a file
//!   actually changes, and transcription itself runs on the dedicated
//!   background engine (or a sidecar process), never the live dictation
//!   engine's lock.
//!
//! ## Lifecycle
//!
//! `WatchFolderManager::new()` returns immediately and starts a single
//! supervisor thread. The supervisor reads `settings.watch_folders` and
//! re-initializes the underlying watcher whenever the list changes
//! (driven by a `settings-changed` event listener registered in `lib.rs`).

use crate::correction_tracker::store::CorrectionStore;
use crate::helpers::subtitles::{to_srt, to_vtt};
use crate::settings::{get_settings, WatchFolderConfig, WatchFolderOutputFormat};
use crate::sidecar::SidecarManager;
use anyhow::Result;
use log::{debug, info, warn};
use notify::RecursiveMode;
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
pub const AUDIO_VIDEO_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "mp4", "mov", "m4v", "webm",
    "mkv", "3gp",
];
/// Cap for the "existing files" scan so a watched Downloads-style folder
/// with tens of thousands of entries cannot stall the UI thread that
/// awaits the command.
pub const EXISTING_SCAN_MAX_FILES: usize = 1000;
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

    /// Push files that already existed in a watched folder through the same
    /// bounded pipeline used for filesystem events. Called from the
    /// `transcribe_watch_folder_files` command when the user opts in to
    /// transcribing pre-existing files. Returns how many files were queued
    /// (files already in flight are skipped by `maybe_handle_file`).
    pub fn enqueue_existing_files(
        self: &Arc<Self>,
        paths: Vec<PathBuf>,
        cfg: &WatchFolderConfig,
    ) -> usize {
        let mut queued = 0;
        for path in paths {
            if self.maybe_handle_file(path, cfg.clone(), PathBuf::from(&cfg.path)) {
                queued += 1;
            }
        }
        queued
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
                if let Err(err) = debouncer.watch(Path::new(&cfg.path), RecursiveMode::Recursive) {
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

    /// Returns `true` when the file was accepted and queued for processing,
    /// `false` when it was filtered out (wrong type, missing, already in flight).
    fn maybe_handle_file(
        self: &Arc<Self>,
        path: PathBuf,
        cfg: WatchFolderConfig,
        _root: PathBuf,
    ) -> bool {
        // Only process actual audio/video files.
        if !is_supported_media_file(&path) {
            return false;
        }
        if !path.is_file() {
            return false;
        }

        // Skip if we're already processing this file.
        {
            let mut in_flight = self
                .in_flight
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !in_flight.insert(path.clone()) {
                return false;
            }
        }

        let manager = Arc::clone(self);
        let slots = Arc::clone(&self.processing_slots);
        // Queue an async task so the heavy decode/transcribe pipeline is
        // bounded by the semaphore.
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

            let manager_for_processing = Arc::clone(&manager);
            let path_for_processing = path.clone();
            manager_for_processing
                .process_file(path_for_processing, cfg)
                .await;

            drop(permit);

            manager
                .in_flight
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&path);
        });
        true
    }

    async fn process_file(&self, path: PathBuf, cfg: WatchFolderConfig) {
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

        let Some(sidecar_manager) = self
            .app
            .try_state::<Arc<SidecarManager>>()
            .map(|state| state.inner().clone())
        else {
            self.emit_failure(&cfg, &path_str, "SidecarManager not available");
            return;
        };
        let Some(correction_store) = self
            .app
            .try_state::<Arc<CorrectionStore>>()
            .map(|state| state.inner().clone())
        else {
            self.emit_failure(&cfg, &path_str, "CorrectionStore not available");
            return;
        };

        // The stability probe sleeps in a loop; keep it off the async runtime.
        let stability_path = path.clone();
        let stability =
            tauri::async_runtime::spawn_blocking(move || wait_for_stable_file(&stability_path))
                .await;
        match stability {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                self.emit_failure(&cfg, &path_str, &err);
                return;
            }
            Err(err) => {
                self.emit_failure(&cfg, &path_str, &format!("stability check failed: {err}"));
                return;
            }
        }

        // Same pipeline as the File Transcription panel: decodes the media,
        // honors the File-ASR/diarization/emotion selection (sidecar models
        // run in their own process), applies the personal dictionary, and
        // runs in-process ASR on the dedicated background engine so live
        // dictation stays responsive throughout.
        let result = crate::commands::transcription::transcribe_file_impl(
            self.app.clone(),
            sidecar_manager,
            correction_store,
            path_str.clone(),
        )
        .await;
        let file_result = match result {
            Ok(result) => result,
            Err(err) => {
                self.emit_failure(&cfg, &path_str, &err);
                return;
            }
        };

        let output_path = build_output_path(&path, cfg.output_format);
        let body = match cfg.output_format {
            WatchFolderOutputFormat::Text => file_result.text,
            WatchFolderOutputFormat::Srt => to_srt(&file_result.segments),
            WatchFolderOutputFormat::Vtt => to_vtt(&file_result.segments),
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

/// True when the path has one of the audio/video extensions we transcribe.
pub fn is_supported_media_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|ext| AUDIO_VIDEO_EXTENSIONS.iter().any(|allowed| *allowed == ext))
}

/// Recursively list audio/video files already present under `root`,
/// mirroring the watcher's `RecursiveMode::Recursive`. Hidden entries are
/// skipped and the walk stops at [`EXISTING_SCAN_MAX_FILES`] results so a
/// huge folder cannot hang the command. Results are sorted for stable UI.
pub fn scan_existing_media_files(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];

    while let Some(dir) = pending.pop() {
        if found.len() >= EXISTING_SCAN_MAX_FILES {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if found.len() >= EXISTING_SCAN_MAX_FILES {
                break;
            }
            let path = entry.path();
            let hidden = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with('.'));
            if hidden {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file() && is_supported_media_file(&path) {
                found.push(path);
            }
        }
    }

    found.sort();
    found
}

pub fn build_output_path(input: &Path, format: WatchFolderOutputFormat) -> PathBuf {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_finds_nested_media_and_skips_hidden_and_unsupported() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let nested = root.join("interviews/2026");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(root.join(".cache")).unwrap();

        std::fs::write(root.join("a.mp3"), b"x").unwrap();
        std::fs::write(nested.join("b.MOV"), b"x").unwrap(); // extension case-insensitive
        std::fs::write(root.join("notes.txt"), b"x").unwrap(); // unsupported
        std::fs::write(root.join(".hidden.wav"), b"x").unwrap(); // hidden file
        std::fs::write(root.join(".cache").join("c.wav"), b"x").unwrap(); // hidden dir

        let found = scan_existing_media_files(root);
        let names: Vec<String> = found
            .iter()
            .map(|p| {
                p.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        assert_eq!(names, vec!["a.mp3", "interviews/2026/b.MOV"]);
    }

    #[test]
    fn output_path_replaces_extension_per_format() {
        let input = Path::new("/tmp/recording.mp3");
        assert_eq!(
            build_output_path(input, WatchFolderOutputFormat::Text),
            Path::new("/tmp/recording.txt")
        );
        assert_eq!(
            build_output_path(input, WatchFolderOutputFormat::Srt),
            Path::new("/tmp/recording.srt")
        );
    }
}
