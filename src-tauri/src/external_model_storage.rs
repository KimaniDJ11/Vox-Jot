//! Cascading model storage: local app-support first, then an optional external
//! volume. Disk checks for the external root are cached off the dictation hot
//! path and refreshed from a background mount watcher.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use log::{info, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::{get_settings, write_settings};

pub const STATUS_EVENT: &str = "external-model-storage-changed";
pub const DISCONNECT_TOAST_EVENT: &str = "external-model-storage-disconnected";
const WATCH_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ModelStorageLocation {
    Local,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ExternalModelStorageStatus {
    pub enabled: bool,
    pub auto_detect: bool,
    pub connected: bool,
    pub configured_path: Option<String>,
    pub resolved_path: Option<String>,
    pub volume_name: Option<String>,
    pub model_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ExternalModelStorageDisconnectEvent {
    pub volume_name: Option<String>,
    pub fell_back: bool,
}

impl Default for ExternalModelStorageStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_detect: true,
            connected: false,
            configured_path: None,
            resolved_path: None,
            volume_name: None,
            model_count: 0,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct CachedRoot {
    status: ExternalModelStorageStatus,
    local_root: Option<PathBuf>,
    external_root: Option<PathBuf>,
}

static CACHE: OnceLock<Mutex<CachedRoot>> = OnceLock::new();
static CONNECTED: AtomicBool = AtomicBool::new(false);
static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

fn cache() -> &'static Mutex<CachedRoot> {
    CACHE.get_or_init(|| Mutex::new(CachedRoot::default()))
}

fn snapshot() -> CachedRoot {
    cache()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
}

fn store_snapshot(next: CachedRoot) {
    CONNECTED.store(next.status.connected, Ordering::Relaxed);
    *cache().lock().unwrap_or_else(|poison| poison.into_inner()) = next;
}

/// Cached connected flag. Never performs disk I/O.
pub fn is_connected() -> bool {
    CONNECTED.load(Ordering::Relaxed)
}

/// Cached status. Never performs disk I/O.
pub fn cached_status() -> ExternalModelStorageStatus {
    snapshot().status
}

/// Cached external model root (`…/models`). Never performs disk I/O.
pub fn cached_external_root() -> Option<PathBuf> {
    snapshot().external_root.filter(|_| is_connected())
}

pub fn cached_local_root() -> Option<PathBuf> {
    snapshot().local_root
}

pub fn volume_name_from_path(path: &Path) -> Option<String> {
    for ancestor in path.ancestors() {
        let Some(parent) = ancestor.parent() else {
            continue;
        };
        if parent == Path::new("/Volumes")
            || parent == Path::new("/media")
            || parent == Path::new("/mnt")
        {
            return ancestor
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .filter(|name| !name.is_empty());
        }
    }

    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
}

/// Accept a user-picked folder that may be a volume root, a `VoxJot` folder,
/// `app-support`, or the `models` directory itself.
pub fn normalize_external_model_root(path: &Path) -> PathBuf {
    if looks_like_model_root(path) {
        return path.to_path_buf();
    }

    let models = path.join("models");
    if looks_like_model_root(&models) {
        return models;
    }

    let app_support_models = path.join("app-support").join("models");
    if looks_like_model_root(&app_support_models) {
        return app_support_models;
    }

    let voxjot_models = path.join("VoxJot").join("app-support").join("models");
    if looks_like_model_root(&voxjot_models) {
        return voxjot_models;
    }

    let apps_models = path.join("Apps").join("Models").join("VoxJot");
    if looks_like_model_root(&apps_models) {
        return apps_models;
    }
    let apps_models_nested = apps_models.join("app-support").join("models");
    if looks_like_model_root(&apps_models_nested) {
        return apps_models_nested;
    }

    if path.join("stt").is_dir()
        || path.join("tts").is_dir()
        || path.join("llm").is_dir()
        || path.join("ocr").is_dir()
    {
        return path.to_path_buf();
    }

    if models.is_dir() {
        return models;
    }
    if app_support_models.is_dir() {
        return app_support_models;
    }
    if voxjot_models.is_dir() {
        return voxjot_models;
    }

    path.to_path_buf()
}

fn looks_like_model_root(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    path.join("stt").is_dir()
        || path.join("tts").is_dir()
        || path.join("llm").is_dir()
        || path.join("ocr").is_dir()
        || path.join("speech-analysis").is_dir()
        || path.join("creative-audio").is_dir()
        || path.join("audio-cleanup").is_dir()
}

fn skip_volume_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "macintosh hd"
        || lower.starts_with("com.apple.timemachine")
        || lower.contains("timemachine")
        || lower == "com.apple.system-update"
        || name.starts_with('.')
}

pub fn auto_detect_candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for volume in mounted_volume_roots() {
        let Some(name) = volume.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if skip_volume_name(name) {
            continue;
        }
        for candidate in [
            volume.join("VoxJot").join("app-support").join("models"),
            volume
                .join("Apps")
                .join("Models")
                .join("VoxJot")
                .join("app-support")
                .join("models"),
            volume.join("Apps").join("Models").join("VoxJot"),
        ] {
            if looks_like_model_root(&candidate) {
                roots.push(candidate);
            }
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

fn mounted_volume_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(target_os = "macos")]
    {
        collect_child_dirs(Path::new("/Volumes"), &mut roots);
    }
    #[cfg(target_os = "linux")]
    {
        collect_child_dirs(Path::new("/media"), &mut roots);
        collect_child_dirs(Path::new("/mnt"), &mut roots);
        if let Some(home) = dirs::home_dir() {
            collect_child_dirs(&home.join("media"), &mut roots);
        }
        collect_child_dirs(Path::new("/run/media"), &mut roots);
        if let Ok(entries) = fs::read_dir("/run/media") {
            for entry in entries.flatten() {
                collect_child_dirs(&entry.path(), &mut roots);
            }
        }
    }
    roots
}

fn collect_child_dirs(parent: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.push(path);
        }
    }
}

pub fn count_model_artifacts(root: &Path) -> u32 {
    count_model_artifacts_inner(root, 0)
}

fn count_model_artifacts_inner(path: &Path, depth: u8) -> u32 {
    if depth > 6 {
        return 0;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    let mut count = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "__MACOSX" {
            continue;
        }
        let child = entry.path();
        if child.is_file() {
            if is_model_file(&child) {
                count += 1;
            }
            continue;
        }
        if !child.is_dir() {
            continue;
        }
        if dir_looks_like_model(&child) {
            count += 1;
        } else {
            count += count_model_artifacts_inner(&child, depth + 1);
        }
    }
    count
}

fn is_model_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "bin" | "gguf" | "onnx" | "mlmodelc" | "safetensors")
    )
}

fn dir_looks_like_model(path: &Path) -> bool {
    path.join("config.json").is_file()
        || path.join("model.onnx").is_file()
        || path.join("model.safetensors").is_file()
        || path.join("model.safetensors.index.json").is_file()
}

pub fn map_local_path_to_external(
    local_path: &Path,
    local_root: &Path,
    external_root: &Path,
) -> Option<PathBuf> {
    let relative = local_path.strip_prefix(local_root).ok()?;
    if relative.as_os_str().is_empty() {
        return Some(external_root.to_path_buf());
    }
    Some(external_root.join(relative))
}

pub fn location_of_path(
    path: &Path,
    local_root: Option<&Path>,
    external_root: Option<&Path>,
) -> Option<ModelStorageLocation> {
    if let Some(local) = local_root {
        if path.starts_with(local) {
            return Some(ModelStorageLocation::Local);
        }
    }
    if let Some(external) = external_root {
        if path.starts_with(external) {
            return Some(ModelStorageLocation::External);
        }
    }
    None
}

/// Classify a resolved path using the cached local/external roots. No disk I/O.
pub fn location_of_resolved(path: &Path) -> Option<ModelStorageLocation> {
    let snap = snapshot();
    location_of_path(
        path,
        snap.local_root.as_deref(),
        snap.external_root.as_deref(),
    )
}

/// Expand a local candidate path with its external equivalent when connected.
/// Does not touch disk beyond reading the in-memory cache.
pub fn expand_candidate(local_path: PathBuf) -> Vec<PathBuf> {
    let mut paths = vec![local_path.clone()];
    let snap = snapshot();
    if !snap.status.connected {
        return paths;
    }
    if let (Some(local_root), Some(external_root)) =
        (snap.local_root.as_ref(), snap.external_root.as_ref())
    {
        if let Some(mapped) = map_local_path_to_external(&local_path, local_root, external_root) {
            if mapped != local_path {
                paths.push(mapped);
            }
        }
    }
    paths
}

pub fn expand_candidates(local_paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for path in local_paths {
        out.extend(expand_candidate(path));
    }
    out
}

/// Resolve an existing file/directory, preferring the local copy.
/// External existence is skipped when the cached volume is disconnected.
pub fn resolve_existing(local_path: &Path) -> Option<(PathBuf, ModelStorageLocation)> {
    if path_ready(local_path) {
        return Some((local_path.to_path_buf(), ModelStorageLocation::Local));
    }

    if !is_connected() {
        return None;
    }

    let snap = snapshot();
    let (Some(local_root), Some(external_root)) =
        (snap.local_root.as_ref(), snap.external_root.as_ref())
    else {
        return None;
    };
    let mapped = map_local_path_to_external(local_path, local_root, external_root)?;
    if path_ready(&mapped) {
        Some((mapped, ModelStorageLocation::External))
    } else {
        None
    }
}

fn path_ready(path: &Path) -> bool {
    match fs::metadata(path) {
        Ok(meta) => {
            if meta.is_file() {
                meta.len() > 0
            } else {
                true
            }
        }
        Err(_) => false,
    }
}

fn local_model_root(app: &AppHandle) -> Option<PathBuf> {
    crate::storage_paths::model_root_dir(app).ok()
}

fn configured_path(settings_path: &Option<String>) -> Option<PathBuf> {
    settings_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn select_auto_detected_root() -> Option<PathBuf> {
    auto_detect_candidate_roots()
        .into_iter()
        .max_by_key(|root| count_model_artifacts(root))
}

fn build_snapshot(app: &AppHandle) -> CachedRoot {
    let settings = get_settings(app);
    let local_root = local_model_root(app);
    let configured = configured_path(&settings.external_model_storage_path);
    let enabled = settings.external_model_storage_enabled;
    let auto_detect = settings.external_model_storage_auto_detect;

    if !enabled {
        return CachedRoot {
            status: ExternalModelStorageStatus {
                enabled: false,
                auto_detect,
                connected: false,
                configured_path: configured.as_ref().map(|path| path.display().to_string()),
                resolved_path: None,
                volume_name: None,
                model_count: 0,
            },
            local_root,
            external_root: None,
        };
    }

    let mut resolved: Option<PathBuf> = None;
    if let Some(path) = configured.as_ref() {
        if path.exists() {
            let normalized = normalize_external_model_root(path);
            if normalized.is_dir() {
                resolved = Some(normalized);
            }
        }
    } else if auto_detect {
        resolved = select_auto_detected_root();
    }

    let connected = resolved.as_ref().is_some_and(|path| path.is_dir());
    let model_count = resolved
        .as_ref()
        .filter(|_| connected)
        .map(|path| count_model_artifacts(path))
        .unwrap_or(0);
    let volume_name = resolved.as_deref().and_then(volume_name_from_path);

    CachedRoot {
        status: ExternalModelStorageStatus {
            enabled: true,
            auto_detect,
            connected,
            configured_path: configured.as_ref().map(|path| path.display().to_string()),
            resolved_path: resolved.as_ref().map(|path| path.display().to_string()),
            volume_name,
            model_count,
        },
        local_root,
        external_root: resolved.filter(|_| connected),
    }
}

pub fn refresh(app: &AppHandle) -> ExternalModelStorageStatus {
    let next = build_snapshot(app);
    let status = next.status.clone();
    store_snapshot(next);
    status
}

pub fn refresh_and_notify(app: &AppHandle) -> ExternalModelStorageStatus {
    let previous = snapshot();
    let next = build_snapshot(app);
    let changed = previous.status != next.status;
    let disconnected = previous.status.connected && !next.status.connected;
    let volume_name = previous.status.volume_name.clone();
    let status = next.status.clone();
    store_snapshot(next);

    if changed {
        let _ = app.emit(STATUS_EVENT, &status);
        apply_catalog_refresh(app, disconnected, volume_name.as_deref());
    }

    status
}

fn apply_catalog_refresh(app: &AppHandle, disconnected: bool, volume_name: Option<&str>) {
    if let Some(model_manager) =
        app.try_state::<std::sync::Arc<crate::managers::model::ModelManager>>()
    {
        if let Err(error) = model_manager.refresh_external_storage_availability() {
            warn!("Failed to refresh model availability after external storage change: {error:#}");
        }
        if disconnected {
            match model_manager.fallback_selected_model_if_unavailable() {
                Ok(crate::managers::model::SelectedModelDisconnectOutcome::FellBack(model_id)) => {
                    info!(
                        "Fell back to local STT model '{model_id}' after external storage disconnect"
                    );
                    let _ = app.emit(
                        DISCONNECT_TOAST_EVENT,
                        ExternalModelStorageDisconnectEvent {
                            volume_name: volume_name.map(str::to_string),
                            fell_back: true,
                        },
                    );
                }
                Ok(crate::managers::model::SelectedModelDisconnectOutcome::Unavailable) => {
                    let _ = app.emit(
                        DISCONNECT_TOAST_EVENT,
                        ExternalModelStorageDisconnectEvent {
                            volume_name: volume_name.map(str::to_string),
                            fell_back: false,
                        },
                    );
                }
                Ok(crate::managers::model::SelectedModelDisconnectOutcome::StillAvailable) => {}
                Err(error) => {
                    warn!(
                        "Failed to apply local STT fallback after external disconnect: {error:#}"
                    );
                    let _ = app.emit(
                        DISCONNECT_TOAST_EVENT,
                        ExternalModelStorageDisconnectEvent {
                            volume_name: volume_name.map(str::to_string),
                            fell_back: false,
                        },
                    );
                }
            }
        }
    } else if disconnected {
        let _ = app.emit(
            DISCONNECT_TOAST_EVENT,
            ExternalModelStorageDisconnectEvent {
                volume_name: volume_name.map(str::to_string),
                fell_back: false,
            },
        );
    }
}

pub fn start_watcher(app: &AppHandle) {
    if WATCHER_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    if let Err(error) = thread::Builder::new()
        .name("vox-jot-external-model-storage".into())
        .spawn(move || loop {
            thread::sleep(WATCH_INTERVAL);
            if watcher_needs_refresh() {
                let _ = refresh_and_notify(&app);
            }
        })
    {
        WATCHER_STARTED.store(false, Ordering::Relaxed);
        warn!("Failed to start external model storage watcher: {error}");
    }
}

fn watcher_needs_refresh() -> bool {
    let snap = snapshot();
    if !snap.status.enabled {
        return false;
    }
    if let Some(root) = snap.external_root.as_ref() {
        return !root.is_dir();
    }
    snap.status.auto_detect || snap.status.configured_path.is_some()
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<ExternalModelStorageStatus, String> {
    let mut settings = get_settings(app);
    settings.external_model_storage_enabled = enabled;
    write_settings(app, settings);
    Ok(refresh_and_notify(app))
}

pub fn set_auto_detect(
    app: &AppHandle,
    auto_detect: bool,
) -> Result<ExternalModelStorageStatus, String> {
    let mut settings = get_settings(app);
    settings.external_model_storage_auto_detect = auto_detect;
    write_settings(app, settings);
    Ok(refresh_and_notify(app))
}

pub fn set_path(
    app: &AppHandle,
    path: Option<String>,
) -> Result<ExternalModelStorageStatus, String> {
    let mut settings = get_settings(app);
    settings.external_model_storage_path = path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    if settings.external_model_storage_path.is_some() {
        settings.external_model_storage_enabled = true;
    }
    write_settings(app, settings);
    Ok(refresh_and_notify(app))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn maps_local_relative_path_onto_external_root() {
        let local =
            Path::new("/Users/me/Library/Application Support/com.iriedinamik.voxjot/models");
        let external = Path::new("/Volumes/AI Storage/VoxJot/app-support/models");
        let file = local.join("stt").join("ggml-small.bin");
        assert_eq!(
            map_local_path_to_external(&file, local, external).unwrap(),
            external.join("stt").join("ggml-small.bin")
        );
    }

    #[test]
    fn volume_name_reads_macos_volumes_prefix() {
        let path = Path::new("/Volumes/AI Storage/VoxJot/app-support/models/stt");
        assert_eq!(volume_name_from_path(path).as_deref(), Some("AI Storage"));
    }

    #[test]
    fn normalize_accepts_volume_voxjot_layout() {
        let temp = tempfile::TempDir::new().unwrap();
        let models = temp
            .path()
            .join("VoxJot")
            .join("app-support")
            .join("models");
        fs::create_dir_all(models.join("stt")).unwrap();
        assert_eq!(normalize_external_model_root(temp.path()), models);
        assert_eq!(
            normalize_external_model_root(&temp.path().join("VoxJot")),
            models
        );
        assert_eq!(
            normalize_external_model_root(&temp.path().join("VoxJot").join("app-support")),
            models
        );
        assert_eq!(normalize_external_model_root(&models), models);
    }

    #[test]
    fn counts_bin_files_and_config_dirs() {
        let temp = tempfile::TempDir::new().unwrap();
        let stt = temp.path().join("stt");
        fs::create_dir_all(&stt).unwrap();
        File::create(stt.join("ggml-small.bin"))
            .unwrap()
            .write_all(b"weights")
            .unwrap();
        let mlx = temp
            .path()
            .join("stt")
            .join("MLX")
            .join("mlx-community")
            .join("Mega-ASR-8bit");
        fs::create_dir_all(&mlx).unwrap();
        File::create(mlx.join("config.json"))
            .unwrap()
            .write_all(b"{}")
            .unwrap();
        fs::create_dir_all(temp.path().join("tts").join("store")).unwrap();
        assert_eq!(count_model_artifacts(temp.path()), 2);
    }

    #[test]
    fn expand_candidate_skips_external_when_disconnected() {
        store_snapshot(CachedRoot::default());
        let local = PathBuf::from("/tmp/vox-jot-models/stt/ggml-small.bin");
        assert_eq!(expand_candidate(local.clone()), vec![local]);
    }

    #[test]
    fn live_auto_detects_connected_ai_storage_volume() {
        let volume = Path::new("/Volumes/AI Storage");
        if !volume.is_dir() {
            eprintln!("skipping: /Volumes/AI Storage is not mounted");
            return;
        }

        let expected = volume
            .join("Apps")
            .join("Models")
            .join("VoxJot")
            .join("app-support")
            .join("models");
        assert!(
            expected.is_dir(),
            "expected live model root at {}",
            expected.display()
        );
        assert!(
            looks_like_model_root(&expected),
            "live model root should contain STT/TTS/LLM/OCR catalogs"
        );

        let detected = auto_detect_candidate_roots();
        assert!(
            detected.iter().any(|root| root == &expected),
            "auto-detect missed {expected:?}; found {detected:?}"
        );

        assert_eq!(normalize_external_model_root(volume), expected);
        assert_eq!(
            normalize_external_model_root(&volume.join("Apps").join("Models").join("VoxJot")),
            expected
        );
        assert_eq!(
            volume_name_from_path(&expected).as_deref(),
            Some("AI Storage")
        );

        let count = count_model_artifacts(&expected);
        assert!(
            count >= 20,
            "expected dozens of artifacts on AI Storage, found {count}"
        );

        let whisper_small = expected.join("stt").join("ggml-small.bin");
        assert!(
            whisper_small.is_file(),
            "Whisper Small should be usable from the external drive"
        );

        let local_root =
            Path::new("/Users/me/Library/Application Support/com.iriedinamik.voxjot/models");
        assert_eq!(
            map_local_path_to_external(
                &local_root.join("stt").join("ggml-small.bin"),
                local_root,
                &expected
            )
            .unwrap(),
            whisper_small
        );
    }
}
