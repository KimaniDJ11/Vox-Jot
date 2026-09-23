//! OCR runtime manager.
//!
//! Owns the long-lived Python sidecar process that holds a vision-language
//! model in memory and answers OCR requests over line-delimited JSON. The
//! Rust callers include the screen-context worker and background probe
//! threads started from OCR model selection. Concurrent callers are
//! serialised via [`OcrRuntimeManager`]'s transition gate for every
//! ownership change (start, cancel, park, shutdown). The gate is never
//! held across recv/inference, so supersession remains possible mid-wait.
//!
//! Lifecycle:
//!
//! * The manager spawns the child lazily on the first request that targets
//!   a model, and keeps it alive across captures.
//! * If the user picks a different neural model the manager kills the old
//!   child and spawns a new one against the new install root — VL model
//!   loads cost 5–30 s, so we never reload mid-session.
//! * On any IPC error (timeout, broken pipe, malformed JSON) the manager
//!   tears the child down so the next request gets a fresh process.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::{self, File};
use std::future::Future;
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::ocr_models::OcrBackendKind;
use crate::screen_context::NativeScreenContextSnippet;
use crate::screen_context_ocr_backup::{OcrFrame, PixelFormat};

/// Shared singleton. Callers include the screen-context worker and
/// background model-selection probe threads; `transition_gate` serialises
/// the start/supersession transition so two idle callers cannot both claim
/// ownership.
static MANAGER: Lazy<OcrRuntimeManager> = Lazy::new(OcrRuntimeManager::new);
static PREREQUISITE_CACHE: Lazy<Mutex<HashMap<OcrBackendKind, bool>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static MANAGED_RUNTIME_INSTALL_LOCK: Lazy<tokio::sync::Mutex<()>> =
    Lazy::new(|| tokio::sync::Mutex::new(()));

pub fn shared() -> &'static OcrRuntimeManager {
    &MANAGER
}

#[derive(Debug, Clone)]
pub struct ManagedOcrRuntimeDefinition {
    pub platform_id: &'static str,
    pub manifest_platform: &'static str,
    pub manifest_arch: &'static str,
    pub manifest_profile: &'static str,
    pub archive_name: &'static str,
    pub checksum_name: &'static str,
    pub hf_repo_id: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OcrRuntimeProvenance {
    ExplicitDeveloperOverride,
    CurrentManagedRuntime,
    DevelopmentCheckout,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedOcrRuntime {
    root: PathBuf,
    python: PathBuf,
    provenance: OcrRuntimeProvenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OcrRuntimeResolutionMode {
    ProductionInstalled,
    DevelopmentCheckout,
}

#[derive(Debug, Clone)]
struct OcrRuntimeResolutionInputs {
    mode: OcrRuntimeResolutionMode,
    explicit_root: Option<PathBuf>,
    explicit_python: Option<PathBuf>,
    managed_candidates: Vec<PathBuf>,
    development_roots: Vec<PathBuf>,
    development_pythons: Vec<PathBuf>,
}

/// Expected managed OCR runtime revision. Must match `ocr-runtime/VERSION`
/// and the `version` field written into `voxjot-ocr-runtime.json` by
/// `scripts/build-ocr-runtime.sh`. Stale App Support installs (e.g. the
/// June 2026.06.15 bundle) are rejected so Hub cannot treat them as ready.
pub const EXPECTED_OCR_RUNTIME_VERSION: &str = "2026-09-19.1";

const OCR_RUNTIME_MANIFEST_NAME: &str = "voxjot-ocr-runtime.json";

#[derive(Debug, Deserialize)]
struct OcrRuntimeManifest {
    name: String,
    version: String,
    platform: String,
    arch: String,
    profile: String,
    entrypoint: String,
    python_root: String,
    python_unix: String,
    python_windows: String,
}

fn read_ocr_runtime_manifest(runtime_root: &Path) -> Result<OcrRuntimeManifest, String> {
    let path = runtime_root.join(OCR_RUNTIME_MANIFEST_NAME);
    let raw = fs::read_to_string(&path)
        .map_err(|err| format!("OCR runtime manifest missing at {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| {
        format!(
            "OCR runtime manifest at {} is invalid JSON: {err}",
            path.display()
        )
    })
}

/// Managed installs must match the archive definition for this target. Dev
/// overrides (`OCR_RUNTIME_ROOT`, repo checkout) intentionally skip this gate.
fn require_managed_runtime_compatible(
    runtime_root: &Path,
    definition: &ManagedOcrRuntimeDefinition,
) -> Result<(), String> {
    let manifest = read_ocr_runtime_manifest(runtime_root)?;
    if manifest.name != "vox-jot-ocr-runtime" {
        return Err(format!(
            "OCR runtime manifest name is {:?}, expected \"vox-jot-ocr-runtime\"",
            manifest.name
        ));
    }
    if manifest.version != EXPECTED_OCR_RUNTIME_VERSION {
        return Err(format!(
            "OCR runtime version is {}, expected {}. Reinstall the managed runtime.",
            manifest.version, EXPECTED_OCR_RUNTIME_VERSION
        ));
    }
    if manifest.platform != definition.manifest_platform {
        return Err(format!(
            "OCR runtime platform is {}, expected {}.",
            manifest.platform, definition.manifest_platform
        ));
    }
    if manifest.arch != definition.manifest_arch {
        return Err(format!(
            "OCR runtime architecture is {}, expected {}.",
            manifest.arch, definition.manifest_arch
        ));
    }
    if manifest.profile != definition.manifest_profile {
        return Err(format!(
            "OCR runtime profile is {}, expected {}.",
            manifest.profile, definition.manifest_profile
        ));
    }
    if manifest.entrypoint != "ocr_runtime/__main__.py" {
        return Err(format!(
            "OCR runtime entrypoint is {:?}, expected \"ocr_runtime/__main__.py\".",
            manifest.entrypoint
        ));
    }
    if manifest.python_root != ".python" {
        return Err(format!(
            "OCR runtime Python root is {:?}, expected \".python\".",
            manifest.python_root
        ));
    }
    if manifest.python_unix != ".python/bin/python3" {
        return Err(format!(
            "OCR runtime Unix Python path is {:?}, expected \".python/bin/python3\".",
            manifest.python_unix
        ));
    }
    if manifest.python_windows != ".python/python.exe" {
        return Err(format!(
            "OCR runtime Windows Python path is {:?}, expected \".python/python.exe\".",
            manifest.python_windows
        ));
    }

    let entrypoint = runtime_root.join(&manifest.entrypoint);
    if !entrypoint.is_file() {
        return Err(format!(
            "OCR runtime manifest entrypoint is missing at {}.",
            entrypoint.display()
        ));
    }
    let python = if definition.manifest_platform == "windows" {
        runtime_root.join(&manifest.python_windows)
    } else {
        runtime_root.join(&manifest.python_unix)
    };
    if !python.is_file() {
        return Err(format!(
            "OCR runtime manifest Python interpreter is missing at {}.",
            python.display()
        ));
    }
    Ok(())
}

fn managed_runtime_matches_definition(
    runtime_root: &Path,
    definition: &ManagedOcrRuntimeDefinition,
) -> bool {
    require_managed_runtime_compatible(runtime_root, definition).is_ok()
}

pub fn managed_ocr_runtime_definition() -> Option<ManagedOcrRuntimeDefinition> {
    const HF_REPO_ID: &str = "IrieDinamik/vox-jot-ocr-runtime";

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some(ManagedOcrRuntimeDefinition {
            platform_id: "macos-aarch64",
            manifest_platform: "macos",
            manifest_arch: "aarch64",
            manifest_profile: "all",
            archive_name: "ocr-runtime-macos-aarch64-all.tar.gz",
            checksum_name: "ocr-runtime-macos-aarch64-all.tar.gz.sha256",
            hf_repo_id: HF_REPO_ID,
        });
    }
    // Neural OCR's `all` runtime depends on Torch >= 2.4. PyPI no longer
    // publishes matching x86_64 macOS wheels, so do not advertise a managed
    // Intel macOS runtime until that dependency path changes.
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Some(ManagedOcrRuntimeDefinition {
            platform_id: "linux-x64",
            manifest_platform: "linux",
            manifest_arch: "x64",
            manifest_profile: "all",
            archive_name: "ocr-runtime-linux-x64-all.tar.gz",
            checksum_name: "ocr-runtime-linux-x64-all.tar.gz.sha256",
            hf_repo_id: HF_REPO_ID,
        });
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some(ManagedOcrRuntimeDefinition {
            platform_id: "windows-x64",
            manifest_platform: "windows",
            manifest_arch: "x64",
            manifest_profile: "all",
            archive_name: "ocr-runtime-windows-x64-all.tar.gz",
            checksum_name: "ocr-runtime-windows-x64-all.tar.gz.sha256",
            hf_repo_id: HF_REPO_ID,
        });
    }
    #[allow(unreachable_code)]
    None
}

pub fn runtime_prerequisites_available(app: &AppHandle, backend: OcrBackendKind) -> bool {
    if matches!(backend, OcrBackendKind::TessdataPack) {
        return true;
    }

    let mut cache = PREREQUISITE_CACHE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if let Some(available) = cache.get(&backend) {
        return *available;
    }

    let available = check_runtime_prerequisites(app, backend).is_ok();
    cache.insert(backend, available);
    available
}

pub async fn ensure_managed_ocr_runtime_installed(
    app: &AppHandle,
    progress_catalog_id: Option<&str>,
) -> Result<PathBuf, String> {
    serialized_managed_runtime_install(async {
        ensure_managed_ocr_runtime_installed_locked(app, progress_catalog_id).await
    })
    .await
}

async fn serialized_managed_runtime_install<T>(
    transaction: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    // Different OCR model jobs share one managed runtime archive/install path.
    // Serialise the complete check/download/extract/validate transaction so two
    // concurrent model downloads cannot truncate each other's partial archive
    // or remove an install while the peer is validating it.
    let _install_guard = MANAGED_RUNTIME_INSTALL_LOCK.lock().await;
    transaction.await
}

async fn ensure_managed_ocr_runtime_installed_locked(
    app: &AppHandle,
    progress_catalog_id: Option<&str>,
) -> Result<PathBuf, String> {
    let definition = managed_ocr_runtime_definition().ok_or_else(|| {
        "The managed OCR runtime is not available on this platform yet.".to_string()
    })?;
    let install_dir = managed_ocr_runtime_install_dir(app, definition.platform_id)?;

    if let Some(root) = resolve_extracted_root(&install_dir) {
        if managed_runtime_matches_definition(&root, &definition) {
            clear_prerequisite_cache();
            return Ok(root);
        }
        // Stale, incomplete, or mislabelled managed install: remove it before
        // the one allowed repair download. Validation after download fails
        // closed instead of recursively re-entering this function.
        warn!(
            "rejecting incompatible managed OCR runtime at {} for {}",
            root.display(),
            definition.platform_id
        );
        fs::remove_dir_all(&install_dir).map_err(|err| {
            format!(
                "Failed to remove incompatible OCR runtime at {}: {err}",
                install_dir.display()
            )
        })?;
    }

    let archive_url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        definition.hf_repo_id, definition.archive_name
    );
    let checksum_url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        definition.hf_repo_id, definition.checksum_name
    );
    download_and_extract_runtime_archive(
        app,
        progress_catalog_id,
        &archive_url,
        &checksum_url,
        definition.archive_name,
        &install_dir,
    )
    .await?;

    let root_result = resolve_extracted_root(&install_dir)
        .ok_or_else(|| "OCR runtime extraction did not produce any files.".to_string())
        .and_then(|root| {
            // Fail closed after a single download attempt — never loop
            // re-fetching a still-incompatible or mislabelled archive.
            require_managed_runtime_compatible(&root, &definition).map(|()| root)
        });
    let root = root_result.map_err(|err| {
        let _ = fs::remove_dir_all(&install_dir);
        format!("Downloaded OCR runtime failed compatibility checks: {err}")
    })?;

    clear_prerequisite_cache();
    Ok(root)
}

fn clear_prerequisite_cache() {
    PREREQUISITE_CACHE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clear();
}

fn check_runtime_prerequisites(_app: &AppHandle, backend: OcrBackendKind) -> Result<(), String> {
    let runtime = resolve_ocr_runtime()?;

    let modules = match backend {
        OcrBackendKind::TransformersVl | OcrBackendKind::PaddleVl => "PIL,torch,transformers",
        OcrBackendKind::MlxVl => "PIL,mlx_vlm",
        OcrBackendKind::PaddleDetRec => "PIL,paddleocr",
        OcrBackendKind::TessdataPack => return Ok(()),
    };

    let script = r#"
import importlib.util
import os
import sys

missing = [
    name
    for name in os.environ["VOX_JOT_OCR_REQUIRED_MODULES"].split(",")
    if importlib.util.find_spec(name) is None
]
sys.exit(1 if missing else 0)
"#;

    let status = Command::new(&runtime.python)
        .current_dir(&runtime.root)
        .env("VOX_JOT_OCR_REQUIRED_MODULES", modules)
        .arg("-c")
        .arg(script)
        .status()
        .map_err(|err| format!("Failed to check OCR runtime dependencies: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "OCR runtime dependency check failed for backend {:?}.",
            backend
        ))
    }
}

fn managed_ocr_runtime_install_dir(app: &AppHandle, platform_id: &str) -> Result<PathBuf, String> {
    Ok(crate::storage_paths::ocr_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve OCR runtime dir: {err}"))?
        .join(platform_id))
}

fn runtime_local_python(runtime_root: &Path) -> Option<PathBuf> {
    [
        runtime_root.join(".python").join("bin").join("python3"),
        runtime_root.join(".python").join("bin").join("python3.11"),
        runtime_root.join(".python").join("bin").join("python"),
        runtime_root.join(".python").join("python.exe"),
        runtime_root.join(".venv").join("bin").join("python"),
        runtime_root
            .join(".venv")
            .join("Scripts")
            .join("python.exe"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn resolve_extracted_root(base_dir: &Path) -> Option<PathBuf> {
    if !base_dir.exists() {
        return None;
    }

    let mut current = base_dir.to_path_buf();
    loop {
        let entries = fs::read_dir(&current).ok()?;
        let mut child_dirs = Vec::new();
        let mut saw_file = false;

        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }

            if entry.file_type().ok()?.is_dir() {
                child_dirs.push(path);
            } else {
                saw_file = true;
            }
        }

        if !saw_file && child_dirs.len() == 1 {
            current = child_dirs.pop().unwrap();
            continue;
        }

        return Some(current);
    }
}

async fn download_and_extract_runtime_archive(
    app: &AppHandle,
    progress_catalog_id: Option<&str>,
    url: &str,
    checksum_url: &str,
    archive_name: &str,
    install_dir: &Path,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1800))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let download_dir = crate::storage_paths::ocr_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve OCR runtime dir: {err}"))?
        .join("downloads");
    fs::create_dir_all(&download_dir)
        .map_err(|err| format!("Failed to create OCR runtime download dir: {err}"))?;

    let expected_sha256 = fetch_runtime_sha256(&client, checksum_url).await?;
    let archive_path = download_dir.join(archive_name);
    let partial_path = download_dir.join(format!("{archive_name}.partial"));
    if archive_path.exists() {
        fs::remove_file(&archive_path)
            .map_err(|err| format!("Failed to clear previous OCR runtime archive: {err}"))?;
    }

    let progress_app = app.clone();
    let progress_catalog_id = progress_catalog_id.map(str::to_string);
    let progress_catalog_id_for_progress = progress_catalog_id.clone();
    let archive_name_for_progress = archive_name.to_string();
    let progress = std::sync::Arc::new(
        move |progress: crate::artifact_download::ArtifactProgress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress.clone());
            if let Some(catalog_id) = progress_catalog_id_for_progress.as_deref() {
                crate::ocr_models::emit_progress(
                    &progress_app,
                    catalog_id,
                    "runtime-downloading",
                    progress.downloaded_bytes,
                    progress.total_bytes,
                    progress
                        .file
                        .as_deref()
                        .or(Some(&archive_name_for_progress)),
                    progress.file_index,
                    progress.file_count,
                    progress.error.as_deref(),
                );
            }
        },
    );

    let report =
        crate::artifact_download::download_file(crate::artifact_download::FileDownloadOptions {
            domain: "ocr_runtime".to_string(),
            artifact_id: archive_name.to_string(),
            url: url.to_string(),
            partial_path,
            final_path: archive_path.clone(),
            expected_sha256: Some(expected_sha256),
            expected_size: None,
            bearer_token: None,
            cancel_flag: None,
            progress: Some(progress),
        })
        .await?;

    if let Some(catalog_id) = progress_catalog_id.as_deref() {
        crate::ocr_models::emit_progress(
            app,
            catalog_id,
            "runtime-installing",
            report.downloaded_bytes,
            report.total_bytes,
            Some(archive_name),
            None,
            None,
            None,
        );
    }

    let extract_result = extract_archive_cleanly(&archive_path, install_dir);
    let _ = fs::remove_file(&archive_path);
    extract_result
}

async fn fetch_runtime_sha256(
    client: &reqwest::Client,
    checksum_url: &str,
) -> Result<String, String> {
    let response = client
        .get(checksum_url)
        .send()
        .await
        .map_err(|err| format!("Failed to download OCR runtime checksum: {err}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download OCR runtime checksum: HTTP {} ({checksum_url})",
            response.status()
        ));
    }
    let body = response
        .text()
        .await
        .map_err(|err| format!("Failed to read OCR runtime checksum: {err}"))?;
    let checksum = body
        .split_whitespace()
        .next()
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if checksum.len() == 64 && checksum.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Ok(checksum)
    } else {
        Err("OCR runtime checksum file did not contain a valid SHA-256 digest.".to_string())
    }
}

fn extract_archive(archive_path: &Path, install_dir: &Path) -> Result<(), String> {
    if install_dir.exists() {
        fs::remove_dir_all(install_dir)
            .map_err(|err| format!("Failed to clear OCR runtime destination: {err}"))?;
    }
    fs::create_dir_all(install_dir)
        .map_err(|err| format!("Failed to create OCR runtime destination: {err}"))?;

    let file = File::open(archive_path)
        .map_err(|err| format!("Failed to open OCR runtime archive: {err}"))?;
    let archive_name = archive_path.to_string_lossy();
    if archive_name.ends_with(".tar.gz") {
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        for entry in archive
            .entries()
            .map_err(|err| format!("Failed to read OCR runtime archive: {err}"))?
        {
            let mut entry =
                entry.map_err(|err| format!("Failed to read OCR runtime archive entry: {err}"))?;
            let relative_path =
                sanitize_archive_path(entry.path().map_err(|err| {
                    format!("Failed to read OCR runtime archive entry path: {err}")
                })?)?;
            if relative_path.as_os_str().is_empty() {
                continue;
            }
            if is_macos_metadata_path(&relative_path) {
                continue;
            }
            let destination = install_dir.join(&relative_path);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    format!("Failed to create OCR runtime extraction directory: {err}")
                })?;
            }
            let entry_type = entry.header().entry_type();
            if entry_type.is_symlink() {
                extract_safe_symlink(&mut entry, &relative_path, &destination)?;
            } else if entry_type.is_hard_link() {
                extract_safe_hard_link(&mut entry, install_dir, &relative_path, &destination)?;
            } else {
                entry
                    .unpack(&destination)
                    .map_err(|err| format!("Failed to extract OCR runtime archive: {err}"))?;
            }
        }
        Ok(())
    } else {
        Err(format!(
            "Unsupported OCR runtime archive format: {}",
            archive_path.display()
        ))
    }
}

fn extract_archive_cleanly(archive_path: &Path, install_dir: &Path) -> Result<(), String> {
    let result = extract_archive(archive_path, install_dir);
    if result.is_err() {
        // Never leave a partially unpacked directory looking like an install.
        // The resumable download partial is separate; extraction is retried
        // from a newly verified archive on the next repair attempt.
        let _ = fs::remove_dir_all(install_dir);
    }
    result
}

fn extract_safe_symlink<R: std::io::Read>(
    entry: &mut tar::Entry<'_, R>,
    relative_path: &Path,
    destination: &Path,
) -> Result<(), String> {
    let link_name = entry_link_name(entry)?;
    validate_archive_link_target(relative_path, &link_name)?;

    #[cfg(unix)]
    {
        if destination.exists() || destination.symlink_metadata().is_ok() {
            fs::remove_file(destination)
                .map_err(|err| format!("Failed to replace OCR runtime symlink: {err}"))?;
        }
        std::os::unix::fs::symlink(&link_name, destination)
            .map_err(|err| format!("Failed to extract OCR runtime symlink: {err}"))?;
        Ok(())
    }

    #[cfg(not(unix))]
    {
        let _ = (link_name, destination);
        Err("OCR runtime archive contains symlinks that are not supported on this platform.".into())
    }
}

fn extract_safe_hard_link<R: std::io::Read>(
    entry: &mut tar::Entry<'_, R>,
    install_dir: &Path,
    relative_path: &Path,
    destination: &Path,
) -> Result<(), String> {
    let link_name = entry_link_name(entry)?;
    let resolved_link = validate_archive_link_target(relative_path, &link_name)?;
    let source = install_dir.join(resolved_link);
    fs::hard_link(&source, destination)
        .map_err(|err| format!("Failed to extract OCR runtime hard link: {err}"))
}

fn entry_link_name<R: std::io::Read>(entry: &mut tar::Entry<'_, R>) -> Result<PathBuf, String> {
    entry
        .link_name()
        .map_err(|err| format!("Failed to read OCR runtime archive link target: {err}"))?
        .map(|target| target.into_owned())
        .ok_or_else(|| "OCR runtime archive link entry is missing its target.".to_string())
}

fn validate_archive_link_target(relative_path: &Path, link_name: &Path) -> Result<PathBuf, String> {
    if link_name.is_absolute() {
        return Err(format!(
            "OCR runtime archive contains unsafe link target: {}",
            link_name.display()
        ));
    }

    let destination_parent = relative_path
        .parent()
        .ok_or_else(|| "OCR runtime archive link destination has no parent.".to_string())?;
    let mut resolved = PathBuf::from(destination_parent);
    resolved.push(link_name);
    normalize_relative_to_install_root(&resolved)
}

fn normalize_relative_to_install_root(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!(
                        "OCR runtime archive contains unsafe link target: {}",
                        path.display()
                    ));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "OCR runtime archive contains unsafe link target: {}",
                    path.display()
                ));
            }
        }
    }
    Ok(normalized)
}

fn sanitize_archive_path(path: std::borrow::Cow<'_, Path>) -> Result<PathBuf, String> {
    let mut sanitized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "OCR runtime archive contains unsafe path: {}",
                    path.display()
                ));
            }
        }
    }
    Ok(sanitized)
}

fn is_macos_metadata_path(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::Normal(part) if part == "__MACOSX"))
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("._"))
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::OcrRuntimeManager;
    use super::{
        managed_runtime_matches_definition, read_ocr_runtime_manifest,
        require_managed_runtime_compatible, resolve_ocr_runtime_from_candidates,
        runtime_resolution_mode_for_executable, serialized_managed_runtime_install, ActiveOp,
        ManagedOcrRuntimeDefinition, OcrRuntimeProvenance, OcrRuntimeResolutionInputs,
        OcrRuntimeResolutionMode, EXPECTED_OCR_RUNTIME_VERSION,
    };
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Barrier, Mutex};
    use std::thread;
    use std::time::Duration;

    /// Cross-platform lingering child: blocks on stdin until killed.
    /// Avoids Unix-only `sleep` so native Windows test runs stay green.
    fn spawn_lingering_test_child() -> Child {
        let candidates: &[&[&str]] = if cfg!(windows) {
            &[
                &["python", "-c", "import sys; sys.stdin.read()"],
                &["py", "-3", "-c", "import sys; sys.stdin.read()"],
                &["cmd", "/C", "pause"],
            ]
        } else {
            &[
                &["python3", "-c", "import sys; sys.stdin.read()"],
                &["python", "-c", "import sys; sys.stdin.read()"],
                &["cat"],
            ]
        };
        let mut last_err = None;
        for argv in candidates {
            let (prog, args) = argv.split_first().expect("non-empty");
            match Command::new(prog)
                .args(args)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(child) => return child,
                Err(err) => last_err = Some(err),
            }
        }
        panic!("failed to spawn lingering test child: {last_err:?}");
    }

    const SCRIPTED_RUNTIME: &str = r#"
import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    request_id = request.get("request_id", 0)
    if request.get("op") == "probe":
        response = {
            "request_id": request_id,
            "ok": True,
            "info": {"loaded": True},
        }
    elif request.get("op") == "ocr":
        response = {"request_id": request_id, "snippets": []}
    else:
        response = {"request_id": request_id, "error": "unexpected test op"}
    print(json.dumps(response, separators=(",", ":")), flush=True)
"#;

    #[derive(Default)]
    struct ScriptedRuntimeHarness {
        spawn_count: AtomicUsize,
        catalogs: Mutex<Vec<String>>,
        children: Mutex<Vec<Arc<Mutex<Child>>>>,
    }

    impl ScriptedRuntimeHarness {
        fn spawn(&self, catalog_id: &str) -> Result<super::RunningChild, String> {
            let candidates: &[&[&str]] = if cfg!(windows) {
                &[&["python", "-u", "-c"], &["py", "-3", "-u", "-c"]]
            } else {
                &[&["python3", "-u", "-c"], &["python", "-u", "-c"]]
            };
            let mut spawned = None;
            let mut last_error = None;
            for argv in candidates {
                let (program, args) = argv.split_first().expect("python command");
                match Command::new(program)
                    .args(args)
                    .arg(SCRIPTED_RUNTIME)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                {
                    Ok(child) => {
                        spawned = Some(child);
                        break;
                    }
                    Err(err) => last_error = Some(err),
                }
            }
            let mut child = spawned
                .ok_or_else(|| format!("failed to spawn scripted OCR runtime: {last_error:?}"))?;
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| "scripted runtime stdin missing".to_string())?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "scripted runtime stdout missing".to_string())?;
            let child = Arc::new(Mutex::new(child));
            let (tx, rx) = mpsc::channel();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else {
                        break;
                    };
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });

            self.spawn_count.fetch_add(1, Ordering::SeqCst);
            self.catalogs.lock().unwrap().push(catalog_id.to_string());
            self.children.lock().unwrap().push(Arc::clone(&child));
            Ok(super::RunningChild { child, stdin, rx })
        }

        fn install(self: &Arc<Self>, manager: &OcrRuntimeManager) {
            let harness = Arc::clone(self);
            manager.set_test_spawner(Some(Arc::new(move |catalog_id, _, _| {
                harness.spawn(catalog_id)
            })));
        }

        fn assert_all_children_reaped(&self) {
            for child in self.children.lock().unwrap().iter() {
                assert!(
                    child.lock().unwrap().try_wait().unwrap().is_some(),
                    "scripted OCR child was left running"
                );
            }
        }
    }

    fn run_test_probe(manager: &OcrRuntimeManager, catalog_id: &str) -> Result<bool, String> {
        manager.probe(
            catalog_id,
            super::OcrBackendKind::TransformersVl,
            Path::new("/unused-test-model"),
            Duration::from_secs(2),
        )
    }

    fn run_test_ocr(
        manager: &OcrRuntimeManager,
        catalog_id: &str,
    ) -> Result<Vec<super::NativeScreenContextSnippet>, String> {
        let pixels = [0_u8, 0, 0, 255];
        let frame = super::OcrFrame::new_packed(1, 1, &pixels, super::PixelFormat::Bgra8);
        manager.run_ocr(
            catalog_id,
            super::OcrBackendKind::TransformersVl,
            Path::new("/unused-test-model"),
            &frame,
            32,
            Duration::from_secs(2),
        )
    }

    #[test]
    fn expected_ocr_runtime_version_matches_version_file() {
        let version_path =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../ocr-runtime/VERSION");
        let file_version = std::fs::read_to_string(&version_path)
            .expect("ocr-runtime/VERSION")
            .trim()
            .to_string();
        assert_eq!(file_version, EXPECTED_OCR_RUNTIME_VERSION);
    }

    const TEST_RUNTIME_DEFINITION: ManagedOcrRuntimeDefinition = ManagedOcrRuntimeDefinition {
        platform_id: "macos-aarch64",
        manifest_platform: "macos",
        manifest_arch: "aarch64",
        manifest_profile: "all",
        archive_name: "ocr-runtime-macos-aarch64-all.tar.gz",
        checksum_name: "ocr-runtime-macos-aarch64-all.tar.gz.sha256",
        hf_repo_id: "test/runtime",
    };

    fn setup_manifest_runtime() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        std::fs::create_dir_all(root.join("ocr_runtime")).unwrap();
        std::fs::write(root.join("ocr_runtime").join("__main__.py"), b"#").unwrap();
        std::fs::create_dir_all(root.join(".python").join("bin")).unwrap();
        std::fs::write(root.join(".python").join("bin").join("python3"), b"#").unwrap();
        dir
    }

    fn write_runtime_manifest(root: &Path, overrides: &[(&str, &str)]) {
        let mut manifest = serde_json::json!({
            "name": "vox-jot-ocr-runtime",
            "version": EXPECTED_OCR_RUNTIME_VERSION,
            "platform": "macos",
            "arch": "aarch64",
            "profile": "all",
            "entrypoint": "ocr_runtime/__main__.py",
            "python_root": ".python",
            "python_unix": ".python/bin/python3",
            "python_windows": ".python/python.exe",
        });
        for (key, value) in overrides {
            manifest[*key] = serde_json::Value::String((*value).to_string());
        }
        std::fs::write(
            root.join("voxjot-ocr-runtime.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn managed_runtime_accepts_current_manifest() {
        let dir = setup_manifest_runtime();
        write_runtime_manifest(dir.path(), &[]);

        assert!(managed_runtime_matches_definition(
            dir.path(),
            &TEST_RUNTIME_DEFINITION
        ));
        require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION).unwrap();
        let manifest = read_ocr_runtime_manifest(dir.path()).unwrap();
        assert_eq!(manifest.version, EXPECTED_OCR_RUNTIME_VERSION);
    }

    #[test]
    fn managed_runtime_rejects_stale_version() {
        let dir = setup_manifest_runtime();
        write_runtime_manifest(dir.path(), &[("version", "2026-06-15")]);

        assert!(!managed_runtime_matches_definition(
            dir.path(),
            &TEST_RUNTIME_DEFINITION
        ));
        let err =
            require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION).unwrap_err();
        assert!(err.contains("2026-06-15"), "{err}");
        assert!(err.contains(EXPECTED_OCR_RUNTIME_VERSION), "{err}");
    }

    #[test]
    fn managed_runtime_rejects_wrong_name() {
        let dir = setup_manifest_runtime();
        write_runtime_manifest(dir.path(), &[("name", "untrusted-runtime")]);

        let err =
            require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION).unwrap_err();
        assert!(err.contains("manifest name"), "{err}");
        assert!(err.contains("vox-jot-ocr-runtime"), "{err}");
    }

    #[test]
    fn managed_runtime_rejects_wrong_platform() {
        let dir = setup_manifest_runtime();
        write_runtime_manifest(dir.path(), &[("platform", "linux")]);
        let err =
            require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION).unwrap_err();
        assert!(err.contains("platform"), "{err}");
        assert!(err.contains("macos"), "{err}");
    }

    #[test]
    fn managed_runtime_rejects_wrong_architecture() {
        let dir = setup_manifest_runtime();
        write_runtime_manifest(dir.path(), &[("arch", "x64")]);
        let err =
            require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION).unwrap_err();
        assert!(err.contains("architecture"), "{err}");
        assert!(err.contains("aarch64"), "{err}");
    }

    #[test]
    fn managed_runtime_rejects_wrong_profile() {
        let dir = setup_manifest_runtime();
        write_runtime_manifest(dir.path(), &[("profile", "transformers-vl")]);
        let err =
            require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION).unwrap_err();
        assert!(err.contains("profile"), "{err}");
        assert!(err.contains("all"), "{err}");
    }

    #[test]
    fn managed_runtime_rejects_missing_or_malformed_manifest() {
        let dir = setup_manifest_runtime();
        assert!(!managed_runtime_matches_definition(
            dir.path(),
            &TEST_RUNTIME_DEFINITION
        ));

        std::fs::write(
            dir.path().join("voxjot-ocr-runtime.json"),
            b"{not valid JSON",
        )
        .unwrap();
        assert!(!managed_runtime_matches_definition(
            dir.path(),
            &TEST_RUNTIME_DEFINITION
        ));

        std::fs::write(
            dir.path().join("voxjot-ocr-runtime.json"),
            br#"{"name":"vox-jot-ocr-runtime"}"#,
        )
        .unwrap();
        assert!(!managed_runtime_matches_definition(
            dir.path(),
            &TEST_RUNTIME_DEFINITION
        ));
    }

    #[test]
    fn managed_runtime_rejects_wrong_entrypoint_or_python_metadata() {
        let dir = setup_manifest_runtime();
        write_runtime_manifest(dir.path(), &[("entrypoint", "other.py")]);
        assert!(
            require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION)
                .unwrap_err()
                .contains("entrypoint")
        );

        write_runtime_manifest(dir.path(), &[("python_root", ".venv")]);
        assert!(
            require_managed_runtime_compatible(dir.path(), &TEST_RUNTIME_DEFINITION)
                .unwrap_err()
                .contains("Python root")
        );
    }

    fn setup_source_runtime() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("source runtime tempdir");
        std::fs::create_dir_all(dir.path().join("ocr_runtime")).unwrap();
        std::fs::write(dir.path().join("ocr_runtime").join("__main__.py"), b"#").unwrap();
        dir
    }

    fn setup_python_file() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("python tempdir");
        let python = dir.path().join(if cfg!(windows) {
            "python.exe"
        } else {
            "python3"
        });
        std::fs::write(&python, b"#").unwrap();
        (dir, python)
    }

    #[test]
    fn production_stale_managed_runtime_cannot_fall_through_to_source_and_path_python() {
        let stale = setup_manifest_runtime();
        write_runtime_manifest(stale.path(), &[("version", "2026-06-15")]);
        let bundled_source = setup_source_runtime();
        let (_python_dir, path_python) = setup_python_file();
        let inputs = OcrRuntimeResolutionInputs {
            mode: OcrRuntimeResolutionMode::ProductionInstalled,
            explicit_root: None,
            explicit_python: None,
            managed_candidates: vec![stale.path().to_path_buf()],
            development_roots: vec![bundled_source.path().to_path_buf()],
            development_pythons: vec![path_python],
        };

        let error = resolve_ocr_runtime_from_candidates(&inputs, Some(&TEST_RUNTIME_DEFINITION))
            .unwrap_err();
        assert!(error.contains("current compatible managed OCR runtime"));
    }

    #[test]
    fn production_missing_managed_runtime_cannot_use_path_python() {
        let bundled_source = setup_source_runtime();
        let (_python_dir, path_python) = setup_python_file();
        let inputs = OcrRuntimeResolutionInputs {
            mode: OcrRuntimeResolutionMode::ProductionInstalled,
            explicit_root: None,
            explicit_python: None,
            managed_candidates: Vec::new(),
            development_roots: vec![bundled_source.path().to_path_buf()],
            development_pythons: vec![path_python],
        };

        let error = resolve_ocr_runtime_from_candidates(&inputs, Some(&TEST_RUNTIME_DEFINITION))
            .unwrap_err();
        assert!(error.contains("current compatible managed OCR runtime"));
    }

    #[test]
    fn production_current_managed_runtime_returns_its_own_root_and_python() {
        let managed = setup_manifest_runtime();
        write_runtime_manifest(managed.path(), &[]);
        let decoy_source = setup_source_runtime();
        let (_python_dir, decoy_python) = setup_python_file();
        let inputs = OcrRuntimeResolutionInputs {
            mode: OcrRuntimeResolutionMode::ProductionInstalled,
            explicit_root: None,
            explicit_python: None,
            managed_candidates: vec![managed.path().to_path_buf()],
            development_roots: vec![decoy_source.path().to_path_buf()],
            development_pythons: vec![decoy_python],
        };

        let runtime =
            resolve_ocr_runtime_from_candidates(&inputs, Some(&TEST_RUNTIME_DEFINITION)).unwrap();
        assert_eq!(runtime.root, managed.path());
        assert_eq!(
            runtime.python,
            managed.path().join(".python").join("bin").join("python3")
        );
        assert_eq!(
            runtime.provenance,
            OcrRuntimeProvenance::CurrentManagedRuntime
        );
    }

    #[test]
    fn explicit_developer_override_pairs_exact_root_and_python_in_production_mode() {
        let source = setup_source_runtime();
        let (_python_dir, python) = setup_python_file();
        let inputs = OcrRuntimeResolutionInputs {
            mode: OcrRuntimeResolutionMode::ProductionInstalled,
            explicit_root: Some(source.path().to_path_buf()),
            explicit_python: Some(python.clone()),
            managed_candidates: Vec::new(),
            development_roots: Vec::new(),
            development_pythons: Vec::new(),
        };

        let runtime =
            resolve_ocr_runtime_from_candidates(&inputs, Some(&TEST_RUNTIME_DEFINITION)).unwrap();
        assert_eq!(runtime.root, source.path());
        assert_eq!(runtime.python, python);
        assert_eq!(
            runtime.provenance,
            OcrRuntimeProvenance::ExplicitDeveloperOverride
        );
    }

    #[test]
    fn checkout_runtime_and_path_python_are_available_only_in_development_mode() {
        let source = setup_source_runtime();
        let (_python_dir, python) = setup_python_file();
        let inputs = OcrRuntimeResolutionInputs {
            mode: OcrRuntimeResolutionMode::DevelopmentCheckout,
            explicit_root: None,
            explicit_python: None,
            managed_candidates: Vec::new(),
            development_roots: vec![source.path().to_path_buf()],
            development_pythons: vec![python.clone()],
        };

        let runtime =
            resolve_ocr_runtime_from_candidates(&inputs, Some(&TEST_RUNTIME_DEFINITION)).unwrap();
        assert_eq!(runtime.root, source.path());
        assert_eq!(runtime.python, python);
        assert_eq!(
            runtime.provenance,
            OcrRuntimeProvenance::DevelopmentCheckout
        );
    }

    #[test]
    fn executable_location_not_debug_assertions_controls_development_resolution() {
        let manifest_dir = Path::new("checkout/src-tauri");
        assert_eq!(
            runtime_resolution_mode_for_executable(
                Path::new("checkout/src-tauri/target/debug/vox-jot"),
                manifest_dir,
            ),
            OcrRuntimeResolutionMode::DevelopmentCheckout
        );
        assert_eq!(
            runtime_resolution_mode_for_executable(
                Path::new("Applications/Vox Jot.app/Contents/MacOS/Vox Jot"),
                manifest_dir,
            ),
            OcrRuntimeResolutionMode::ProductionInstalled
        );
    }

    #[tokio::test]
    async fn concurrent_managed_runtime_transactions_recheck_after_install_lock() {
        async fn ensure_test_runtime(
            marker: PathBuf,
            transactions: Arc<AtomicUsize>,
        ) -> Result<PathBuf, String> {
            serialized_managed_runtime_install(async move {
                if marker.is_file() {
                    return Ok(marker);
                }
                transactions.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                std::fs::write(&marker, b"current")
                    .map_err(|error| format!("test install failed: {error}"))?;
                Ok(marker)
            })
            .await
        }

        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("valid-runtime.marker");
        let transactions = Arc::new(AtomicUsize::new(0));
        let first = ensure_test_runtime(marker.clone(), Arc::clone(&transactions));
        let second = ensure_test_runtime(marker.clone(), Arc::clone(&transactions));
        let (first, second) = tokio::join!(first, second);

        assert_eq!(first.unwrap(), marker);
        assert_eq!(second.unwrap(), marker);
        assert_eq!(transactions.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn should_coalesce_same_model_probe_and_ocr_but_not_ocr_to_ocr() {
        let manager = OcrRuntimeManager::new();
        manager.active_request_id.store(7, Ordering::SeqCst);
        *manager.active_meta.lock().unwrap() = Some(super::ActiveRequestMeta {
            request_id: 7,
            catalog_id: "jina-ocr-v1".into(),
            op: ActiveOp::Probe,
        });
        assert!(manager.should_coalesce_locked("jina-ocr-v1", ActiveOp::Ocr));
        assert!(manager.should_coalesce_locked("jina-ocr-v1", ActiveOp::Probe));
        // OCR→OCR same model: latest-wins (no coalesce)
        *manager.active_meta.lock().unwrap() = Some(super::ActiveRequestMeta {
            request_id: 7,
            catalog_id: "jina-ocr-v1".into(),
            op: ActiveOp::Ocr,
        });
        assert!(!manager.should_coalesce_locked("jina-ocr-v1", ActiveOp::Ocr));
        assert!(manager.should_coalesce_locked("jina-ocr-v1", ActiveOp::Probe));
        // Different-model probe may be superseded by OCR (no coalesce)
        *manager.active_meta.lock().unwrap() = Some(super::ActiveRequestMeta {
            request_id: 7,
            catalog_id: "other-model".into(),
            op: ActiveOp::Probe,
        });
        assert!(!manager.should_coalesce_locked("jina-ocr-v1", ActiveOp::Ocr));
        // Different-model OCR must not be killed by a probe (coalesce/wait)
        *manager.active_meta.lock().unwrap() = Some(super::ActiveRequestMeta {
            request_id: 7,
            catalog_id: "other-model".into(),
            op: ActiveOp::Ocr,
        });
        assert!(manager.should_coalesce_locked("jina-ocr-v1", ActiveOp::Probe));
        // OCR A→B latest-wins
        assert!(!manager.should_coalesce_locked("jina-ocr-v1", ActiveOp::Ocr));
    }

    #[test]
    fn production_probe_then_waiting_ocr_reuses_warm_child() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let harness = Arc::new(ScriptedRuntimeHarness::default());
        harness.install(&manager);

        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));
        let probe_manager = Arc::clone(&manager);
        let (probe_tx, probe_rx) = mpsc::channel();
        let probe = thread::spawn(move || {
            let _ = probe_tx.send(run_test_probe(&probe_manager, "jina-ocr-v1"));
        });
        finalize_barrier.wait();
        manager.set_block_before_finalize(None);

        let (wait_tx, wait_rx) = mpsc::channel();
        manager.set_coalesce_wait_observer(Some(wait_tx));
        let ocr_manager = Arc::clone(&manager);
        let (ocr_tx, ocr_rx) = mpsc::channel();
        let ocr = thread::spawn(move || {
            let _ = ocr_tx.send(run_test_ocr(&ocr_manager, "jina-ocr-v1"));
        });
        wait_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("OCR must enter the production coalescing wait");

        finalize_barrier.wait();
        assert!(probe_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("probe result")
            .unwrap());
        assert!(ocr_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("OCR result")
            .unwrap()
            .is_empty());
        probe.join().unwrap();
        ocr.join().unwrap();

        assert_eq!(harness.spawn_count.load(Ordering::SeqCst), 1);
        assert_eq!(harness.catalogs.lock().unwrap().as_slice(), ["jina-ocr-v1"]);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.inner.lock().unwrap().child.is_some());
        manager.shutdown();
        harness.assert_all_children_reaped();
    }

    #[test]
    fn production_escape_invalidates_probe_and_queued_ocr() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let harness = Arc::new(ScriptedRuntimeHarness::default());
        harness.install(&manager);

        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));
        let probe_manager = Arc::clone(&manager);
        let (probe_tx, probe_rx) = mpsc::channel();
        let probe = thread::spawn(move || {
            let _ = probe_tx.send(run_test_probe(&probe_manager, "jina-ocr-v1"));
        });
        finalize_barrier.wait();
        manager.set_block_before_finalize(None);

        let (wait_tx, wait_rx) = mpsc::channel();
        manager.set_coalesce_wait_observer(Some(wait_tx));
        let ocr_manager = Arc::clone(&manager);
        let (ocr_tx, ocr_rx) = mpsc::channel();
        let ocr = thread::spawn(move || {
            let _ = ocr_tx.send(run_test_ocr(&ocr_manager, "jina-ocr-v1"));
        });
        wait_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("OCR must be queued behind probe");

        assert!(manager.cancel_active());
        assert!(ocr_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("queued OCR cancellation")
            .unwrap_err()
            .contains("cancelled"));
        finalize_barrier.wait();
        assert!(probe_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("probe cancellation")
            .unwrap_err()
            .contains("cancelled"));
        probe.join().unwrap();
        ocr.join().unwrap();

        assert_eq!(harness.spawn_count.load(Ordering::SeqCst), 1);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.inner.lock().unwrap().child.is_none());
        manager.shutdown();
        harness.assert_all_children_reaped();
    }

    #[test]
    fn production_shutdown_invalidates_queued_ocr_without_restart() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let harness = Arc::new(ScriptedRuntimeHarness::default());
        harness.install(&manager);

        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));
        let probe_manager = Arc::clone(&manager);
        let (probe_tx, probe_rx) = mpsc::channel();
        let probe = thread::spawn(move || {
            let _ = probe_tx.send(run_test_probe(&probe_manager, "jina-ocr-v1"));
        });
        finalize_barrier.wait();
        manager.set_block_before_finalize(None);

        let (wait_tx, wait_rx) = mpsc::channel();
        manager.set_coalesce_wait_observer(Some(wait_tx));
        let ocr_manager = Arc::clone(&manager);
        let (ocr_tx, ocr_rx) = mpsc::channel();
        let ocr = thread::spawn(move || {
            let _ = ocr_tx.send(run_test_ocr(&ocr_manager, "jina-ocr-v1"));
        });
        wait_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("OCR must be queued behind probe");

        manager.shutdown();
        assert!(ocr_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("queued OCR shutdown cancellation")
            .unwrap_err()
            .contains("cancelled"));
        finalize_barrier.wait();
        assert!(probe_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("probe shutdown cancellation")
            .unwrap_err()
            .contains("cancelled"));
        probe.join().unwrap();
        ocr.join().unwrap();

        assert_eq!(harness.spawn_count.load(Ordering::SeqCst), 1);
        assert!(manager.inner.lock().unwrap().current_catalog_id.is_none());
        harness.assert_all_children_reaped();
    }

    #[test]
    fn production_newer_model_invalidates_older_queued_waiter() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let harness = Arc::new(ScriptedRuntimeHarness::default());
        harness.install(&manager);

        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));
        let probe_manager = Arc::clone(&manager);
        let (probe_tx, probe_rx) = mpsc::channel();
        let probe = thread::spawn(move || {
            let _ = probe_tx.send(run_test_probe(&probe_manager, "model-a"));
        });
        finalize_barrier.wait();
        manager.set_block_before_finalize(None);

        let (wait_tx, wait_rx) = mpsc::channel();
        manager.set_coalesce_wait_observer(Some(wait_tx));
        let old_manager = Arc::clone(&manager);
        let (old_tx, old_rx) = mpsc::channel();
        let old_ocr = thread::spawn(move || {
            let _ = old_tx.send(run_test_ocr(&old_manager, "model-a"));
        });
        wait_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("old OCR must queue behind probe");

        let new_manager = Arc::clone(&manager);
        let (new_tx, new_rx) = mpsc::channel();
        let new_ocr = thread::spawn(move || {
            let _ = new_tx.send(run_test_ocr(&new_manager, "model-b"));
        });
        assert!(new_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("newer model OCR result")
            .unwrap()
            .is_empty());
        assert!(old_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("old queued OCR cancellation")
            .unwrap_err()
            .contains("cancelled"));
        finalize_barrier.wait();
        assert!(probe_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("superseded probe result")
            .unwrap_err()
            .contains("cancelled"));
        probe.join().unwrap();
        old_ocr.join().unwrap();
        new_ocr.join().unwrap();

        assert_eq!(
            harness.catalogs.lock().unwrap().as_slice(),
            ["model-a", "model-b"]
        );
        assert_eq!(
            manager.inner.lock().unwrap().current_catalog_id.as_deref(),
            Some("model-b")
        );
        manager.shutdown();
        harness.assert_all_children_reaped();
    }

    #[test]
    fn production_ocr_then_probe_waits_without_killing_ocr() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let harness = Arc::new(ScriptedRuntimeHarness::default());
        harness.install(&manager);

        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));
        let ocr_manager = Arc::clone(&manager);
        let (ocr_tx, ocr_rx) = mpsc::channel();
        let ocr = thread::spawn(move || {
            let _ = ocr_tx.send(run_test_ocr(&ocr_manager, "jina-ocr-v1"));
        });
        finalize_barrier.wait();
        manager.set_block_before_finalize(None);

        let (wait_tx, wait_rx) = mpsc::channel();
        manager.set_coalesce_wait_observer(Some(wait_tx));
        let probe_manager = Arc::clone(&manager);
        let (probe_tx, probe_rx) = mpsc::channel();
        let probe = thread::spawn(move || {
            let _ = probe_tx.send(run_test_probe(&probe_manager, "jina-ocr-v1"));
        });
        wait_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("probe must wait for active OCR");

        finalize_barrier.wait();
        assert!(ocr_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("OCR result")
            .unwrap()
            .is_empty());
        assert!(probe_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("probe result")
            .unwrap());
        ocr.join().unwrap();
        probe.join().unwrap();

        assert_eq!(harness.spawn_count.load(Ordering::SeqCst), 1);
        manager.shutdown();
        harness.assert_all_children_reaped();
    }

    #[test]
    fn production_ocr_to_newer_ocr_remains_latest_wins() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let harness = Arc::new(ScriptedRuntimeHarness::default());
        harness.install(&manager);

        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));
        let old_manager = Arc::clone(&manager);
        let (old_tx, old_rx) = mpsc::channel();
        let old_ocr = thread::spawn(move || {
            let _ = old_tx.send(run_test_ocr(&old_manager, "model-a"));
        });
        finalize_barrier.wait();
        manager.set_block_before_finalize(None);

        let new_manager = Arc::clone(&manager);
        let (new_tx, new_rx) = mpsc::channel();
        let new_ocr = thread::spawn(move || {
            let _ = new_tx.send(run_test_ocr(&new_manager, "model-b"));
        });
        assert!(new_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("new OCR result")
            .unwrap()
            .is_empty());
        finalize_barrier.wait();
        assert!(old_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("old OCR cancellation")
            .unwrap_err()
            .contains("cancelled"));
        old_ocr.join().unwrap();
        new_ocr.join().unwrap();

        assert_eq!(
            harness.catalogs.lock().unwrap().as_slice(),
            ["model-a", "model-b"]
        );
        assert_eq!(
            manager.inner.lock().unwrap().current_catalog_id.as_deref(),
            Some("model-b")
        );
        manager.shutdown();
        harness.assert_all_children_reaped();
    }

    #[test]
    fn production_multiple_waiters_keep_latest_without_lost_wakeup() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let harness = Arc::new(ScriptedRuntimeHarness::default());
        harness.install(&manager);

        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));
        let probe_manager = Arc::clone(&manager);
        let (probe_tx, probe_rx) = mpsc::channel();
        let probe = thread::spawn(move || {
            let _ = probe_tx.send(run_test_probe(&probe_manager, "jina-ocr-v1"));
        });
        finalize_barrier.wait();
        manager.set_block_before_finalize(None);

        let (wait_tx, wait_rx) = mpsc::channel();
        manager.set_coalesce_wait_observer(Some(wait_tx));
        let older_manager = Arc::clone(&manager);
        let (older_tx, older_rx) = mpsc::channel();
        let older = thread::spawn(move || {
            let _ = older_tx.send(run_test_ocr(&older_manager, "jina-ocr-v1"));
        });
        let older_intent = wait_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("older waiter must sleep");

        let newer_manager = Arc::clone(&manager);
        let (newer_tx, newer_rx) = mpsc::channel();
        let newer = thread::spawn(move || {
            let _ = newer_tx.send(run_test_ocr(&newer_manager, "jina-ocr-v1"));
        });
        let newer_intent = wait_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("newer waiter must sleep");
        assert!(newer_intent > older_intent);

        // Completion may notify immediately after the observer signal. The
        // transition-gate predicate must prevent a lost wakeup.
        finalize_barrier.wait();
        assert!(probe_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("probe result")
            .unwrap());
        assert!(older_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("older waiter result")
            .unwrap_err()
            .contains("cancelled"));
        assert!(newer_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("newer waiter result")
            .unwrap()
            .is_empty());
        probe.join().unwrap();
        older.join().unwrap();
        newer.join().unwrap();

        assert_eq!(harness.spawn_count.load(Ordering::SeqCst), 1);
        manager.shutdown();
        harness.assert_all_children_reaped();
    }

    fn wrap_child(child: Child) -> Arc<Mutex<Child>> {
        Arc::new(Mutex::new(child))
    }

    fn reap(child: &Arc<Mutex<Child>>) {
        if let Ok(mut guard) = child.lock() {
            let _ = guard.kill();
            let _ = guard.wait();
        }
    }

    #[test]
    fn cancel_active_bumps_epoch_and_clears_active_request() {
        let manager = OcrRuntimeManager::new();
        manager.active_request_id.store(42, Ordering::SeqCst);
        let epoch_before = manager.epoch.load(Ordering::SeqCst);
        assert!(manager.cancel_active());
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.epoch.load(Ordering::SeqCst) > epoch_before);
    }

    #[test]
    fn stale_epoch_is_treated_as_cancellation() {
        let manager = OcrRuntimeManager::new();
        let epoch_at_start = manager.epoch.load(Ordering::SeqCst);
        manager.epoch.fetch_add(1, Ordering::SeqCst);
        assert_ne!(epoch_at_start, manager.epoch.load(Ordering::SeqCst));
    }

    /// A→B supersession: when A wakes after B has taken ownership, A's cleanup
    /// must not wipe B's kill_target / active_request_id.
    #[test]
    fn superseded_waiter_does_not_clear_newer_request_ownership() {
        let manager = OcrRuntimeManager::new();

        let child_a = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn a */;
        let child_b = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn b */;

        // A owns the wait slots.
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_a));
        manager.active_request_id.store(1, Ordering::SeqCst);
        let epoch_a = manager.epoch.load(Ordering::SeqCst);

        // B supersedes A.
        assert!(manager.cancel_active());
        assert!(manager.epoch.load(Ordering::SeqCst) > epoch_a);
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_b));
        manager.active_request_id.store(2, Ordering::SeqCst);

        // A wakes and runs request-owned release (must not clobber B).
        manager.release_wait_ownership(1, &child_a);

        assert!(
            manager
                .kill_target
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|c| Arc::ptr_eq(c, &child_b)),
            "A must not clear B's kill_target"
        );
        assert_eq!(
            manager.active_request_id.load(Ordering::SeqCst),
            2,
            "A must not clear B's active_request_id"
        );

        // Escape / cancel of B must still work.
        assert!(
            manager.cancel_active(),
            "B must remain cancellable after A's late cleanup"
        );

        let _ = child_a.lock().unwrap().kill();
        let _ = child_a.lock().unwrap().wait();
        let _ = child_b.lock().unwrap().kill();
        let _ = child_b.lock().unwrap().wait();
    }

    /// Cancelling B after A has already awakened/released must still succeed
    /// when B owns the slots.
    #[test]
    fn cancel_b_after_a_release_still_kills_b() {
        let manager = OcrRuntimeManager::new();
        let child_a = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn a */;
        let child_b = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn b */;

        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_a));
        manager.active_request_id.store(1, Ordering::SeqCst);
        assert!(manager.cancel_active());

        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_b));
        manager.active_request_id.store(2, Ordering::SeqCst);
        manager.release_wait_ownership(1, &child_a);

        assert!(manager.cancel_active());
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());

        let _ = child_a.lock().unwrap().kill();
        let _ = child_a.lock().unwrap().wait();
        let _ = child_b.lock().unwrap().kill();
        let _ = child_b.lock().unwrap().wait();
    }

    #[test]
    fn release_ownership_is_idempotent_for_owner() {
        let manager = OcrRuntimeManager::new();
        let child = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn */;
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child));
        manager.active_request_id.store(7, Ordering::SeqCst);
        manager.release_wait_ownership(7, &child);
        manager.release_wait_ownership(7, &child);
        assert!(manager.kill_target.lock().unwrap().is_none());
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        let _ = child.lock().unwrap().kill();
        let _ = child.lock().unwrap().wait();
    }

    #[test]
    fn repeated_cancel_active_is_safe() {
        let manager = OcrRuntimeManager::new();
        assert!(!manager.cancel_active());
        assert!(!manager.cancel_active());
        manager.active_request_id.store(9, Ordering::SeqCst);
        assert!(manager.cancel_active());
        assert!(!manager.cancel_active());
    }

    #[test]
    fn release_does_not_clear_foreign_kill_target() {
        let manager = OcrRuntimeManager::new();
        let child_a = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn a */;
        let child_b = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn b */;
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_b));
        manager.active_request_id.store(2, Ordering::SeqCst);
        // Stale A tries to release with its old child pointer / id.
        manager.release_wait_ownership(1, &child_a);
        assert!(manager
            .kill_target
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|c| Arc::ptr_eq(c, &child_b)));
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 2);
        let _ = child_a.lock().unwrap().kill();
        let _ = child_a.lock().unwrap().wait();
        let _ = child_b.lock().unwrap().kill();
        let _ = child_b.lock().unwrap().wait();
    }

    #[test]
    fn escape_without_successor_clears_catalog_id() {
        let manager = OcrRuntimeManager::new();
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("jina-ocr-v1".into());
        }
        let child = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn */;
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child));
        manager.active_request_id.store(3, Ordering::SeqCst);
        manager.latest_started_request_id.store(3, Ordering::SeqCst);
        assert!(manager.cancel_active());
        manager.release_wait_ownership(3, &child);
        manager.clear_catalog_if_no_successor(3);
        assert!(manager.inner.lock().unwrap().current_catalog_id.is_none());
        let _ = child.lock().unwrap().kill();
        let _ = child.lock().unwrap().wait();
    }

    #[test]
    fn superseded_waiter_does_not_clear_successor_catalog() {
        let manager = OcrRuntimeManager::new();
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("jina-ocr-v1".into());
        }
        let child_a = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn a */;
        let child_b = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn b */;
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_a));
        manager.active_request_id.store(1, Ordering::SeqCst);
        manager.latest_started_request_id.store(1, Ordering::SeqCst);
        assert!(manager.cancel_active());
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_b));
        manager.active_request_id.store(2, Ordering::SeqCst);
        manager.latest_started_request_id.store(2, Ordering::SeqCst);
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("jina-ocr-v1".into());
        }
        manager.release_wait_ownership(1, &child_a);
        manager.clear_catalog_if_no_successor(1);
        assert_eq!(
            manager.inner.lock().unwrap().current_catalog_id.as_deref(),
            Some("jina-ocr-v1")
        );
        let _ = child_a.lock().unwrap().kill();
        let _ = child_a.lock().unwrap().wait();
        let _ = child_b.lock().unwrap().kill();
        let _ = child_b.lock().unwrap().wait();
    }

    /// B finishes and releases wait slots before stale A cleans up.
    /// Idle active/kill slots must NOT let A wipe B's catalog while B is
    /// about to park its healthy warm child.
    #[test]
    fn successor_finishes_before_stale_waiter_cleanup_preserves_catalog_and_warm_child() {
        let manager = OcrRuntimeManager::new();
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("jina-ocr-v1".into());
        }

        let child_a = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn a */;
        let child_b = wrap_child(spawn_lingering_test_child()) /* was sleep: spawn b */;

        // A starts.
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_a));
        manager.active_request_id.store(1, Ordering::SeqCst);
        manager.latest_started_request_id.store(1, Ordering::SeqCst);

        // B supersedes A.
        assert!(manager.cancel_active());
        *manager.kill_target.lock().unwrap() = Some(Arc::clone(&child_b));
        manager.active_request_id.store(2, Ordering::SeqCst);
        manager.latest_started_request_id.store(2, Ordering::SeqCst);
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("jina-ocr-v1".into());
        }

        // B successfully finishes: releases wait slots BEFORE parking child.
        manager.release_wait_ownership(2, &child_b);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());

        // Stale A wakes during the window and attempts catalog clear.
        manager.release_wait_ownership(1, &child_a);
        manager.clear_catalog_if_no_successor(1);

        assert_eq!(
            manager.inner.lock().unwrap().current_catalog_id.as_deref(),
            Some("jina-ocr-v1"),
            "stale A must not clear catalog after B has started, even if B already released wait slots"
        );

        // B parks its healthy warm child afterward.
        {
            let mut state = manager.inner.lock().unwrap();
            // Simulate warm restore: catalog must still match so next request reuses child.
            assert_eq!(state.current_catalog_id.as_deref(), Some("jina-ocr-v1"));
            state.child = None; // child handle type differs in unit test; catalog is the contract
        }

        // Escape with genuinely no successor still clears.
        manager.latest_started_request_id.store(2, Ordering::SeqCst);
        manager.active_request_id.store(0, Ordering::SeqCst);
        manager.clear_catalog_if_no_successor(2);
        assert!(manager.inner.lock().unwrap().current_catalog_id.is_none());

        let _ = child_a.lock().unwrap().kill();
        let _ = child_a.lock().unwrap().wait();
        let _ = child_b.lock().unwrap().kill();
        let _ = child_b.lock().unwrap().wait();
    }

    #[test]
    fn timeout_without_successor_clears_catalog_id() {
        let manager = OcrRuntimeManager::new();
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("jina-ocr-v1".into());
        }
        manager.active_request_id.store(0, Ordering::SeqCst);
        manager.latest_started_request_id.store(5, Ordering::SeqCst);
        manager.clear_catalog_if_no_successor(5);
        assert!(manager.inner.lock().unwrap().current_catalog_id.is_none());
    }

    #[test]
    fn model_switch_still_replaces_catalog_id_on_next_start() {
        let manager = OcrRuntimeManager::new();
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("jina-ocr-v1".into());
            state.next_request_id = 10;
        }
        manager.latest_started_request_id.store(9, Ordering::SeqCst);
        // Simulate the catalog swap that request_inner performs on mismatch
        // before starting the successor request.
        {
            let mut state = manager.inner.lock().unwrap();
            let new_catalog = "apple-vision";
            if state.current_catalog_id.as_deref() != Some(new_catalog) {
                state.child = None;
                state.current_catalog_id = Some(new_catalog.into());
            }
            let request_id = state.next_request_id;
            state.next_request_id = state.next_request_id.wrapping_add(1).max(1);
            manager
                .active_request_id
                .store(request_id, Ordering::SeqCst);
            manager
                .latest_started_request_id
                .store(request_id, Ordering::SeqCst);
        }
        assert_eq!(
            manager.inner.lock().unwrap().current_catalog_id.as_deref(),
            Some("apple-vision")
        );
        assert_eq!(manager.latest_started_request_id.load(Ordering::SeqCst), 10);
    }

    #[test]
    fn concurrent_idle_starts_serialize_and_later_request_owns_runtime() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();
        let results = Arc::new(Mutex::new(Vec::new()));

        for idx in 0..2 {
            let manager = Arc::clone(&manager);
            let barrier = Arc::clone(&barrier);
            let results = Arc::clone(&results);
            handles.push(thread::spawn(move || {
                let child = wrap_child(spawn_lingering_test_child());
                barrier.wait();
                let request_id = manager.start_test_wait(&child);
                results
                    .lock()
                    .unwrap()
                    .push((idx, request_id, Arc::clone(&child)));
                // Hold briefly so the peer contends on the start gate.
                thread::sleep(Duration::from_millis(30));
                (request_id, child)
            }));
        }

        barrier.wait();
        let finished: Vec<(u64, Arc<Mutex<Child>>)> = handles
            .into_iter()
            .map(|h| h.join().expect("join"))
            .collect();

        let active = manager.active_request_id.load(Ordering::SeqCst);
        let latest = manager.latest_started_request_id.load(Ordering::SeqCst);
        assert!(active != 0, "one request must own active_request_id");
        assert_eq!(active, latest, "active owner must be the latest started");
        assert_eq!(
            finished.iter().map(|(id, _)| *id).max(),
            Some(latest),
            "later start must win latest_started_request_id"
        );

        let kill = manager
            .kill_target
            .lock()
            .unwrap()
            .as_ref()
            .map(Arc::clone)
            .expect("kill_target must belong to the winning request");
        let winner = finished
            .iter()
            .find(|(id, _)| *id == latest)
            .expect("winner child");
        assert!(
            Arc::ptr_eq(&kill, &winner.1),
            "kill_target must point at the later request's child"
        );

        // Earlier child must have been killed by supersession.
        let loser = finished
            .iter()
            .find(|(id, _)| *id != latest)
            .expect("loser child");
        {
            let mut guard = loser.1.lock().unwrap();
            let status = guard.try_wait().expect("try_wait loser");
            assert!(
                status.is_some(),
                "superseded idle-start child must be reaped, not left orphaned"
            );
        }

        assert!(manager.cancel_active());
        for (_, child) in &finished {
            reap(child);
        }
    }

    #[test]
    fn rapid_a_b_c_supersession_leaves_only_latest_owner() {
        let manager = OcrRuntimeManager::new();
        let child_a = wrap_child(spawn_lingering_test_child());
        let child_b = wrap_child(spawn_lingering_test_child());
        let child_c = wrap_child(spawn_lingering_test_child());

        let id_a = manager.start_test_wait(&child_a);
        let id_b = manager.start_test_wait(&child_b);
        let id_c = manager.start_test_wait(&child_c);

        assert_ne!(id_a, id_b);
        assert_ne!(id_b, id_c);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), id_c);
        assert_eq!(
            manager.latest_started_request_id.load(Ordering::SeqCst),
            id_c
        );
        assert!(manager
            .kill_target
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|c| Arc::ptr_eq(c, &child_c)));
        assert!(child_a.lock().unwrap().try_wait().unwrap().is_some());
        assert!(child_b.lock().unwrap().try_wait().unwrap().is_some());
        assert!(child_c.lock().unwrap().try_wait().unwrap().is_none());

        assert!(manager.cancel_active());
        reap(&child_a);
        reap(&child_b);
        reap(&child_c);
    }

    #[test]
    fn probe_and_ocr_overlap_via_start_gate_keeps_single_owner() {
        // Models selection probe and screen OCR both call through the same
        // start-gate helper; overlapping idle starts must not orphan a child.
        let manager = Arc::new(OcrRuntimeManager::new());
        let barrier = Arc::new(Barrier::new(3));
        let probe_mgr = Arc::clone(&manager);
        let ocr_mgr = Arc::clone(&manager);
        let probe_barrier = Arc::clone(&barrier);
        let ocr_barrier = Arc::clone(&barrier);

        let probe = thread::spawn(move || {
            let child = wrap_child(spawn_lingering_test_child());
            probe_barrier.wait();
            let id = probe_mgr.start_test_wait(&child);
            thread::sleep(Duration::from_millis(20));
            (id, child)
        });
        let ocr = thread::spawn(move || {
            let child = wrap_child(spawn_lingering_test_child());
            ocr_barrier.wait();
            let id = ocr_mgr.start_test_wait(&child);
            thread::sleep(Duration::from_millis(20));
            (id, child)
        });

        barrier.wait();
        let (probe_id, probe_child) = probe.join().unwrap();
        let (ocr_id, ocr_child) = ocr.join().unwrap();
        let latest = manager.latest_started_request_id.load(Ordering::SeqCst);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), latest);
        assert!(latest == probe_id || latest == ocr_id);
        let winner = if latest == probe_id {
            &probe_child
        } else {
            &ocr_child
        };
        let loser = if latest == probe_id {
            &ocr_child
        } else {
            &probe_child
        };
        assert!(manager
            .kill_target
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|c| Arc::ptr_eq(c, winner)));
        assert!(loser.lock().unwrap().try_wait().unwrap().is_some());
        assert!(manager.cancel_active());
        reap(&probe_child);
        reap(&ocr_child);
    }

    #[test]
    fn escape_during_overlap_clears_owner() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let child = wrap_child(spawn_lingering_test_child());
        let id = manager.start_test_wait(&child);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), id);
        assert!(manager.cancel_active());
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());
        reap(&child);
    }

    #[test]
    fn shutdown_during_overlap_clears_runtime() {
        let manager = OcrRuntimeManager::new();
        let child = wrap_child(spawn_lingering_test_child());
        let _id = manager.start_test_wait(&child);
        manager.shutdown();
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());
        assert!(manager.inner.lock().unwrap().current_catalog_id.is_none());
        reap(&child);
    }

    #[test]
    fn successor_finishes_before_stale_predecessor_cleanup_keeps_latest_owner_slots_clearable_only_by_latest(
    ) {
        let manager = OcrRuntimeManager::new();
        let child_a = wrap_child(spawn_lingering_test_child());
        let child_b = wrap_child(spawn_lingering_test_child());
        let id_a = manager.start_test_wait(&child_a);
        let id_b = manager.start_test_wait(&child_b);
        // B finishes successfully: release wait slots before parking.
        manager.release_wait_ownership(id_b, &child_b);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        // Stale A cleans up — must not claim it can clear successor catalog ownership.
        manager.release_wait_ownership(id_a, &child_a);
        manager.clear_catalog_if_no_successor(id_a);
        assert_eq!(
            manager.latest_started_request_id.load(Ordering::SeqCst),
            id_b
        );
        reap(&child_a);
        reap(&child_b);
    }

    fn make_test_running_child() -> super::RunningChild {
        let mut child = spawn_lingering_test_child();
        let stdin = child
            .stdin
            .take()
            .expect("lingering test child must have piped stdin");
        let (_tx, rx) = std::sync::mpsc::channel();
        super::RunningChild {
            child: Arc::new(Mutex::new(child)),
            stdin,
            rx,
        }
    }

    fn process_alive(child: &Arc<Mutex<Child>>) -> bool {
        match child.lock().unwrap().try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false,
            Err(_) => false,
        }
    }

    fn success_line(request_id: u64) -> String {
        format!(
            r#"{{"request_id":{request_id},"ok":true,"snippets":[{{"text":"hi","confidence":1.0,"x":0,"y":0,"width":1,"height":1}}]}}"#
        )
    }

    /// HIGH-1: A is ready to park, but B supersedes before A's finalize gate.
    /// A must kill locally and must NEVER park into state.child.
    #[test]
    fn successful_completion_racing_with_successor_start_never_parks_stale_child() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));

        let running_a = make_test_running_child();
        let child_a_proc = Arc::clone(&running_a.child);
        let id_a = manager.start_test_wait(&child_a_proc);
        let epoch_a = manager.epoch.load(Ordering::SeqCst);
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("model-a".into());
        }

        let mgr_a = Arc::clone(&manager);
        let line_a = success_line(id_a);
        let t_a = std::thread::spawn(move || {
            mgr_a.finalize_test_wait(id_a, epoch_a, running_a, Some(line_a))
        });

        // Pause A after recv-classify equivalent, before finalize transition.
        finalize_barrier.wait();

        // B starts and supersedes while A is paused before park.
        let running_b = make_test_running_child();
        let child_b_proc = Arc::clone(&running_b.child);
        let id_b = manager.start_test_wait(&child_b_proc);
        assert_ne!(id_a, id_b);
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), id_b);
        assert!(
            manager
                .kill_target
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|c| Arc::ptr_eq(c, &child_b_proc)),
            "B must own kill_target"
        );
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("model-b".into());
        }

        // Resume A finalize — must observe stale and refuse to park.
        finalize_barrier.wait();
        let result_a = t_a.join().expect("A thread");
        assert!(result_a.is_err(), "stale A must not succeed: {result_a:?}");
        assert!(
            !process_alive(&child_a_proc),
            "stale A child must be killed/reaped"
        );

        // state.child must not be A's process. It may be None (B still waiting)
        // or later B — never A.
        {
            let state = manager.inner.lock().unwrap();
            if let Some(parked) = state.child.as_ref() {
                assert!(
                    !Arc::ptr_eq(&parked.child, &child_a_proc),
                    "stale A must never be parked in state.child"
                );
            }
            assert_eq!(state.current_catalog_id.as_deref(), Some("model-b"));
        }
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), id_b);
        assert!(manager
            .kill_target
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|c| Arc::ptr_eq(c, &child_b_proc)));

        // B completes successfully and parks atomically.
        manager.set_block_before_finalize(None);
        let epoch_b = manager.epoch.load(Ordering::SeqCst);
        let line_b = success_line(id_b);
        manager
            .finalize_test_wait(id_b, epoch_b, running_b, Some(line_b))
            .expect("B finalize");
        {
            let state = manager.inner.lock().unwrap();
            let parked = state.child.as_ref().expect("B must park warm child");
            assert!(Arc::ptr_eq(&parked.child, &child_b_proc));
            assert_eq!(state.current_catalog_id.as_deref(), Some("model-b"));
        }
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());
        assert!(process_alive(&child_b_proc), "parked B must remain alive");

        // Cleanup parked B via shutdown.
        manager.shutdown();
        assert!(!process_alive(&child_b_proc));
        reap(&child_a_proc);
        reap(&child_b_proc);
    }

    /// HIGH-2: Escape begins while A holds the transition gate before publish.
    /// After A publishes and drops the gate, cancel must kill the child.
    #[test]
    fn cancel_active_racing_with_start_publication_kills_child_immediately() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let publish_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_publish(Some(Arc::clone(&publish_barrier)));

        let child = wrap_child(spawn_lingering_test_child());
        let mgr_a = Arc::clone(&manager);
        let child_a = Arc::clone(&child);
        let t_a = std::thread::spawn(move || mgr_a.start_test_wait(&child_a));

        // A holds transition_gate, paused before publish.
        publish_barrier.wait();

        let mgr_c = Arc::clone(&manager);
        let t_cancel = std::thread::spawn(move || mgr_c.cancel_active());

        // Give cancel a moment to block on the gate, then release A to publish.
        std::thread::sleep(std::time::Duration::from_millis(50));
        publish_barrier.wait();

        let id_a = t_a.join().expect("start thread");
        let cancelled = t_cancel.join().expect("cancel thread");
        assert!(cancelled, "cancel must observe the published request");
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());
        assert!(manager.inner.lock().unwrap().child.is_none());
        assert!(!process_alive(&child), "Escape must kill+reap child A");
        assert!(id_a >= 1);
        reap(&child);
        manager.set_block_before_publish(None);
    }

    #[test]
    fn shutdown_racing_with_start_publication_leaves_no_child() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let publish_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_publish(Some(Arc::clone(&publish_barrier)));

        let child = wrap_child(spawn_lingering_test_child());
        let mgr_a = Arc::clone(&manager);
        let child_a = Arc::clone(&child);
        let t_a = std::thread::spawn(move || mgr_a.start_test_wait(&child_a));

        publish_barrier.wait();
        let mgr_s = Arc::clone(&manager);
        let t_shutdown = std::thread::spawn(move || mgr_s.shutdown());
        std::thread::sleep(std::time::Duration::from_millis(50));
        publish_barrier.wait();

        let _id = t_a.join().expect("start");
        t_shutdown.join().expect("shutdown");
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());
        assert!(manager.inner.lock().unwrap().child.is_none());
        assert!(manager.inner.lock().unwrap().current_catalog_id.is_none());
        assert!(!process_alive(&child));
        reap(&child);
        manager.set_block_before_publish(None);
    }

    /// Completion wins the gate before B: warm child parks atomically with
    /// ownership release (never exposes active=0 + child=None).
    #[test]
    fn completion_before_successor_parks_warm_child_atomically() {
        let manager = OcrRuntimeManager::new();
        let running = make_test_running_child();
        let proc = Arc::clone(&running.child);
        let id = manager.start_test_wait(&proc);
        let epoch = manager.epoch.load(Ordering::SeqCst);
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("model-a".into());
        }
        manager
            .finalize_test_wait(id, epoch, running, Some(success_line(id)))
            .expect("finalize");
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), 0);
        assert!(manager.kill_target.lock().unwrap().is_none());
        {
            let state = manager.inner.lock().unwrap();
            let parked = state.child.as_ref().expect("parked");
            assert!(Arc::ptr_eq(&parked.child, &proc));
            assert_eq!(state.current_catalog_id.as_deref(), Some("model-a"));
        }
        assert!(process_alive(&proc));
        manager.shutdown();
        reap(&proc);
    }

    #[test]
    fn malformed_stale_predecessor_response_cannot_kill_successor() {
        let manager = Arc::new(OcrRuntimeManager::new());
        let finalize_barrier = Arc::new(Barrier::new(2));
        manager.set_block_before_finalize(Some(Arc::clone(&finalize_barrier)));

        let running_a = make_test_running_child();
        let proc_a = Arc::clone(&running_a.child);
        let id_a = manager.start_test_wait(&proc_a);
        let epoch_a = manager.epoch.load(Ordering::SeqCst);

        let mgr_a = Arc::clone(&manager);
        let t_a = std::thread::spawn(move || {
            mgr_a.finalize_test_wait(id_a, epoch_a, running_a, Some("not-json".into()))
        });
        finalize_barrier.wait();

        let running_b = make_test_running_child();
        let proc_b = Arc::clone(&running_b.child);
        let id_b = manager.start_test_wait(&proc_b);
        {
            let mut state = manager.inner.lock().unwrap();
            state.current_catalog_id = Some("model-b".into());
        }
        finalize_barrier.wait();
        assert!(t_a.join().unwrap().is_err());

        // Successor ownership intact despite A's malformed payload.
        assert_eq!(manager.active_request_id.load(Ordering::SeqCst), id_b);
        assert!(manager
            .kill_target
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|c| Arc::ptr_eq(c, &proc_b)));
        assert_eq!(
            manager.inner.lock().unwrap().current_catalog_id.as_deref(),
            Some("model-b")
        );
        assert!(process_alive(&proc_b));
        assert!(!process_alive(&proc_a));

        manager.set_block_before_finalize(None);
        let epoch_b = manager.epoch.load(Ordering::SeqCst);
        manager
            .finalize_test_wait(id_b, epoch_b, running_b, Some(success_line(id_b)))
            .unwrap();
        manager.shutdown();
        reap(&proc_a);
        reap(&proc_b);
    }

    use super::{
        extract_archive_cleanly, is_macos_metadata_path, sanitize_archive_path,
        validate_archive_link_target,
    };
    use std::borrow::Cow;
    use std::path::{Path, PathBuf};

    #[test]
    fn sanitize_archive_path_keeps_safe_relative_entries() {
        let path = sanitize_archive_path(Cow::Borrowed(Path::new("./runtime/bin/tool")))
            .expect("safe relative path should sanitize");

        assert_eq!(path, PathBuf::from("runtime/bin/tool"));
    }

    #[test]
    fn sanitize_archive_path_rejects_traversal_entries() {
        let error = sanitize_archive_path(Cow::Borrowed(Path::new("../outside")))
            .expect_err("parent traversal should be rejected");

        assert!(error.contains("unsafe path"));
    }

    #[test]
    fn failed_runtime_extraction_removes_partial_install() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("runtime.tar.gz");
        let install = dir.path().join("installed-runtime");
        std::fs::write(&archive, b"not a gzip archive").unwrap();

        assert!(extract_archive_cleanly(&archive, &install).is_err());
        assert!(
            !install.exists(),
            "failed extraction must not leave a partial managed runtime"
        );
    }

    #[test]
    fn macos_metadata_path_detection_skips_appledouble_files() {
        assert!(is_macos_metadata_path(Path::new(
            "runtime/.python/lib/python3.11/site-packages/matplotlib/._style.mplstyle"
        )));
        assert!(is_macos_metadata_path(Path::new(
            "__MACOSX/runtime/.python/lib/._style.mplstyle"
        )));
        assert!(!is_macos_metadata_path(Path::new(
            "runtime/.python/lib/python3.11/site-packages/matplotlib/style.mplstyle"
        )));
    }

    #[test]
    fn validate_archive_link_target_allows_relative_links_inside_archive_root() {
        let target = validate_archive_link_target(
            Path::new("runtime/.venv/bin/python"),
            Path::new("python3.11"),
        )
        .expect("relative link within the runtime should be allowed");

        assert_eq!(target, PathBuf::from("runtime/.venv/bin/python3.11"));
    }

    #[test]
    fn validate_archive_link_target_allows_parent_segments_inside_archive_root() {
        let target = validate_archive_link_target(
            Path::new("runtime/bin/python"),
            Path::new("../.python/bin/python3"),
        )
        .expect("relative link that stays inside the runtime should be allowed");

        assert_eq!(target, PathBuf::from("runtime/.python/bin/python3"));
    }

    #[test]
    fn validate_archive_link_target_rejects_links_outside_install_root() {
        let error = validate_archive_link_target(
            Path::new("runtime/bin/python"),
            Path::new("../../../outside"),
        )
        .expect_err("link target escaping the install root should be rejected");

        assert!(error.contains("unsafe link target"));
    }

    #[test]
    fn validate_archive_link_target_rejects_absolute_links() {
        let error =
            validate_archive_link_target(Path::new("runtime/bin/python"), Path::new("/tmp/python"))
                .expect_err("absolute link target should be rejected");

        assert!(error.contains("unsafe link target"));
    }
}

#[cfg(test)]
struct TestHooks {
    /// Wait here just before kill_target / active / latest are published.
    block_before_publish: Mutex<Option<std::sync::Arc<std::sync::Barrier>>>,
    /// Wait here after recv returns, before the finalize ownership transition.
    block_before_finalize: Mutex<Option<std::sync::Arc<std::sync::Barrier>>>,
    /// Reports that a production request is about to sleep in `idle_cv`.
    coalesce_wait_observer: Mutex<Option<mpsc::Sender<u64>>>,
    /// Deterministic IPC child factory used by production-path lifecycle tests.
    spawner: Mutex<Option<Arc<TestSpawner>>>,
}

#[cfg(test)]
type TestSpawner =
    dyn Fn(&str, OcrBackendKind, &Path) -> Result<RunningChild, String> + Send + Sync;

#[cfg(test)]
impl TestHooks {
    fn new() -> Self {
        Self {
            block_before_publish: Mutex::new(None),
            block_before_finalize: Mutex::new(None),
            coalesce_wait_observer: Mutex::new(None),
            spawner: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveOp {
    Probe,
    Ocr,
}

impl ActiveOp {
    fn from_op(op: &str) -> Self {
        if op == "probe" {
            ActiveOp::Probe
        } else {
            ActiveOp::Ocr
        }
    }
}

#[derive(Debug, Clone)]
struct ActiveRequestMeta {
    request_id: u64,
    catalog_id: String,
    op: ActiveOp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RequestIntent {
    sequence: u64,
}

pub struct OcrRuntimeManager {
    inner: Mutex<ManagerState>,
    /// Serialises ALL ownership transitions (start, supersession, Escape/
    /// cancel, successful park, failed/stale completion, shutdown). Never
    /// held across `recv_timeout` / model inference. Two idle callers cannot
    /// both observe `active_request_id == 0` and spawn concurrent children;
    transition_gate: Mutex<()>,
    /// In-flight request id (0 = idle).
    active_request_id: AtomicU64,
    /// Highest request id that has started a wait. Monotonic ownership token:
    /// "no request active right now" is not the same as "no successor ever started."
    latest_started_request_id: AtomicU64,
    /// Bumped by `cancel_active` so waiters observe supersession.
    epoch: AtomicU64,
    /// Monotonic request-arrival sequence. A request captures its token at the
    /// public API boundary (before frame encoding) and may start only while it
    /// remains the newest queued intent.
    intent_sequence: AtomicU64,
    /// Highest arrival sequence invalidated by Escape/shutdown/supersession.
    /// Kept separate from `intent_sequence` so a request that arrives after a
    /// cancellation linearises is not accidentally cancelled by that older
    /// transition.
    cancelled_through_intent: AtomicU64,
    /// Child eligible for kill from `cancel_active` while a waiter is blocked.
    kill_target: Mutex<Option<Arc<Mutex<Child>>>>,
    /// Catalog/op metadata for the in-flight request. Used so same-model
    /// probe↔OCR can coalesce instead of cancelling a warm prewarm.
    active_meta: Mutex<Option<ActiveRequestMeta>>,
    /// Wakes coalesce waiters when the active request finishes or is cancelled.
    /// Paired with `transition_gate` (never wait while holding other locks).
    idle_cv: Condvar,
    /// Test-only barriers that pause production transitions for race tests.
    #[cfg(test)]
    test_hooks: TestHooks,
}

struct ManagerState {
    child: Option<RunningChild>,
    /// Catalog id of the model currently loaded in the child. We respawn
    /// when this no longer matches the request.
    current_catalog_id: Option<String>,
    next_request_id: u64,
}

struct RunningChild {
    /// Shared so `cancel_active` can kill while `request_inner` waits off-mutex.
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
    rx: mpsc::Receiver<String>,
}

impl Drop for RunningChild {
    fn drop(&mut self) {
        // Defense-in-depth: dropping a Child does not kill it. Explicit
        // kill/wait paths remain the primary teardown; this guard reaps any
        // process that still escapes those paths (e.g. a stale predecessor
        // that must not park after supersession).
        if let Ok(mut guard) = self.child.lock() {
            match guard.try_wait() {
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => {
                    let _ = guard.kill();
                    let _ = guard.wait();
                }
            }
        }
    }
}

#[derive(Debug, Serialize)]
struct RequestEnvelope<'a> {
    request_id: u64,
    op: &'a str,
    #[serde(flatten)]
    body: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct ResponseEnvelope {
    #[serde(default)]
    request_id: u64,
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    info: Option<serde_json::Value>,
    #[serde(default)]
    snippets: Option<Vec<RawSnippet>>,
}

#[derive(Debug, Deserialize)]
struct RawSnippet {
    text: String,
    #[serde(default)]
    confidence: f32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl OcrRuntimeManager {
    fn new() -> Self {
        Self {
            inner: Mutex::new(ManagerState {
                child: None,
                current_catalog_id: None,
                next_request_id: 1,
            }),
            transition_gate: Mutex::new(()),
            active_request_id: AtomicU64::new(0),
            latest_started_request_id: AtomicU64::new(0),
            epoch: AtomicU64::new(1),
            intent_sequence: AtomicU64::new(0),
            cancelled_through_intent: AtomicU64::new(0),
            kill_target: Mutex::new(None),
            active_meta: Mutex::new(None),
            idle_cv: Condvar::new(),
            #[cfg(test)]
            test_hooks: TestHooks::new(),
        }
    }

    /// Probe the child to confirm the loader for `catalog_id` initialised.
    /// Spawns the child if necessary, swaps to a different `model_root` if
    /// the user changed selection. The boolean we return ends up driving
    /// `OcrModelDescriptor.runnable` for VL families.
    pub fn probe(
        &self,
        catalog_id: &str,
        backend: OcrBackendKind,
        model_root: &Path,
        timeout: Duration,
    ) -> Result<bool, String> {
        let intent = self.issue_intent();
        let response = self.request_inner(
            intent,
            catalog_id,
            backend,
            model_root,
            "probe",
            serde_json::json!({}),
            timeout,
        )?;
        if let Some(err) = response.error {
            return Err(err);
        }
        let loaded = response.ok.unwrap_or(false)
            && response
                .info
                .as_ref()
                .and_then(|info| info.get("loaded"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
        Ok(loaded)
    }

    /// Run inference for one frame. The frame is a packed-BGRA buffer
    /// matching `OcrFrame`.
    pub fn run_ocr(
        &self,
        catalog_id: &str,
        backend: OcrBackendKind,
        model_root: &Path,
        frame: &OcrFrame,
        max_words: usize,
        timeout: Duration,
    ) -> Result<Vec<NativeScreenContextSnippet>, String> {
        // Capture arrival order before base64 encoding. A large frame must not
        // become a logically newer request merely because a later caller
        // finished its request-body preparation first.
        let intent = self.issue_intent();
        let frame_b64 = BASE64.encode(frame.pixels);
        let pixel_format = match frame.format {
            #[cfg(any(target_os = "macos", target_os = "windows", test))]
            PixelFormat::Bgra8 => "bgra8",
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            PixelFormat::Rgba8 => "rgba8",
        };
        let body = serde_json::json!({
            "frame_b64": frame_b64,
            "width": frame.width,
            "height": frame.height,
            "stride": frame.stride_bytes,
            "pixel_format": pixel_format,
            "max_words": max_words,
        });
        let response = self.request_inner(
            intent, catalog_id, backend, model_root, "ocr", body, timeout,
        )?;
        if let Some(err) = response.error {
            return Err(err);
        }
        let raw = response.snippets.unwrap_or_default();
        Ok(raw
            .into_iter()
            .map(|r| NativeScreenContextSnippet {
                text: r.text,
                confidence: r.confidence,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            })
            .collect())
    }

    fn request_inner(
        &self,
        intent: RequestIntent,
        catalog_id: &str,
        backend: OcrBackendKind,
        model_root: &Path,
        op: &str,
        body: serde_json::Value,
        timeout: Duration,
    ) -> Result<ResponseEnvelope, String> {
        // Serialise start/supersession under the transition gate. Hold only
        // until ownership is published; release before recv so Escape / a
        // successor can cancel mid-wait.
        let (request_id, epoch_at_start, running) = {
            let mut gate = self
                .transition_gate
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());

            if !self.intent_is_current(intent) {
                return Err("ocr-runtime request cancelled".to_string());
            }

            let incoming_op = ActiveOp::from_op(op);
            loop {
                if !self.should_coalesce_locked(catalog_id, incoming_op) {
                    break;
                }
                // Same-model probe↔OCR (or OCR→probe): wait for the active
                // request to finish and park the warm child. Do NOT cancel.
                // Escape/shutdown notify `idle_cv` after clearing ownership.
                #[cfg(test)]
                self.notify_test_coalesce_wait(intent.sequence);
                gate = self
                    .idle_cv
                    .wait(gate)
                    .unwrap_or_else(|poison| poison.into_inner());
                if !self.intent_is_current(intent) {
                    return Err("ocr-runtime request cancelled".to_string());
                }
            }

            if self.active_request_id.load(Ordering::SeqCst) != 0 {
                let invalidate_before_successor = intent.sequence.saturating_sub(1);
                let _ = self.cancel_active_locked(invalidate_before_successor);
            }

            let mut state = self
                .inner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());

            if state.current_catalog_id.as_deref() != Some(catalog_id) {
                kill_child_in_place(&mut state);
                state.current_catalog_id = Some(catalog_id.to_string());
            }

            if state.child.is_none() {
                let spawned = self.spawn_for_request(catalog_id, backend, model_root)?;
                state.child = Some(spawned);
            }

            let request_id = state.next_request_id;
            state.next_request_id = state.next_request_id.wrapping_add(1).max(1);

            let envelope = RequestEnvelope {
                request_id,
                op,
                body,
            };
            let line = serde_json::to_string(&envelope)
                .map_err(|err| format!("Failed to encode OCR request: {err}"))?;

            let send_result = {
                let running = state
                    .child
                    .as_mut()
                    .expect("spawn_child returned without setting child");
                running
                    .stdin
                    .write_all(line.as_bytes())
                    .and_then(|()| running.stdin.write_all(b"\n"))
                    .and_then(|()| running.stdin.flush())
            };
            if let Err(err) = send_result {
                debug!("ocr-runtime stdin write failed: {err}; tearing child down");
                kill_child_in_place(&mut state);
                return Err(err.to_string());
            }

            let running = state.child.take().expect("child must exist after send");
            drop(state);

            #[cfg(test)]
            self.wait_test_hook_before_publish();

            self.publish_wait_ownership(request_id, &running.child);
            if let Ok(mut meta) = self.active_meta.lock() {
                *meta = Some(ActiveRequestMeta {
                    request_id,
                    catalog_id: catalog_id.to_string(),
                    op: incoming_op,
                });
            }
            let epoch_at_start = self.epoch.load(Ordering::SeqCst);
            // Keep `gate` alive until end of block so coalesce waiters stay
            // serialized with ownership publication, then drop before recv.
            drop(gate);
            (request_id, epoch_at_start, running)
        };

        // Wait WITHOUT any transition lock so cancel/successor can proceed.
        let recv_result = running.rx.recv_timeout(timeout);

        #[cfg(test)]
        self.wait_test_hook_before_finalize();

        // Classify the recv outcome. Ownership is still held until finalize.
        let classified = match recv_result {
            Ok(line) => ClassifiedRecv::Line(line),
            Err(mpsc::RecvTimeoutError::Timeout) => ClassifiedRecv::Timeout,
            Err(mpsc::RecvTimeoutError::Disconnected) => ClassifiedRecv::Disconnected,
        };

        self.finalize_after_wait(request_id, epoch_at_start, running, classified)
    }

    fn issue_intent(&self) -> RequestIntent {
        RequestIntent {
            sequence: self
                .intent_sequence
                .fetch_add(1, Ordering::SeqCst)
                .wrapping_add(1),
        }
    }

    fn intent_is_current(&self, intent: RequestIntent) -> bool {
        self.intent_sequence.load(Ordering::SeqCst) == intent.sequence
            && self.cancelled_through_intent.load(Ordering::SeqCst) < intent.sequence
    }

    fn spawn_for_request(
        &self,
        catalog_id: &str,
        backend: OcrBackendKind,
        model_root: &Path,
    ) -> Result<RunningChild, String> {
        #[cfg(test)]
        {
            let spawner = self
                .test_hooks
                .spawner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .clone();
            if let Some(spawner) = spawner {
                return spawner(catalog_id, backend, model_root);
            }
        }
        spawn_child(catalog_id, backend, model_root)
    }

    /// True when the incoming request should wait for the active one instead
    /// of cancelling it (same-model probe↔OCR coalesce; don't kill OCR for a
    /// different-model probe). Precondition: `transition_gate` held.
    fn should_coalesce_locked(&self, catalog_id: &str, incoming: ActiveOp) -> bool {
        if self.active_request_id.load(Ordering::SeqCst) == 0 {
            return false;
        }
        let meta = self
            .active_meta
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(active) = meta.as_ref() else {
            return false;
        };
        if active.catalog_id == catalog_id {
            // Same model: coalesce whenever a probe is involved. OCR→OCR on
            // the same catalog still latest-wins (rapid capture refresh).
            !matches!((active.op, incoming), (ActiveOp::Ocr, ActiveOp::Ocr))
        } else {
            // Different model: supersede an active probe; OCR A→B latest-wins;
            // a probe must not kill a different-model OCR already in flight.
            matches!((active.op, incoming), (ActiveOp::Ocr, ActiveOp::Probe))
        }
    }

    /// Publish kill_target / active / latest for a newly started wait.
    /// Precondition: `transition_gate` held.
    fn publish_wait_ownership(&self, request_id: u64, child: &Arc<Mutex<Child>>) {
        if let Ok(mut slot) = self.kill_target.lock() {
            *slot = Some(Arc::clone(child));
        }
        self.active_request_id.store(request_id, Ordering::SeqCst);
        self.latest_started_request_id
            .store(request_id, Ordering::SeqCst);
    }

    /// True when this request still owns the wait slots and has not been
    /// superseded or Escape-cancelled. Precondition: `transition_gate` held.
    fn is_current_wait_owner(
        &self,
        request_id: u64,
        epoch_at_start: u64,
        our_child: &Arc<Mutex<Child>>,
    ) -> bool {
        if self.epoch.load(Ordering::SeqCst) != epoch_at_start {
            return false;
        }
        if self.latest_started_request_id.load(Ordering::SeqCst) != request_id {
            return false;
        }
        if self.active_request_id.load(Ordering::SeqCst) != request_id {
            return false;
        }
        match self.kill_target.lock() {
            Ok(slot) => slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, our_child)),
            Err(_) => false,
        }
    }

    /// Serialized completion: park on success if still current, otherwise
    /// kill the local child without touching successor ownership.
    fn finalize_after_wait(
        &self,
        request_id: u64,
        epoch_at_start: u64,
        mut running: RunningChild,
        classified: ClassifiedRecv,
    ) -> Result<ResponseEnvelope, String> {
        let _gate = self
            .transition_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let child_arc = Arc::clone(&running.child);
        let still_current = self.is_current_wait_owner(request_id, epoch_at_start, &child_arc);

        if !still_current {
            // Superseded or Escape already moved ownership. Never park, and
            // never touch the successor's slots/catalog.
            kill_running_child(&mut running);
            return Err("ocr-runtime request cancelled".to_string());
        }

        match classified {
            ClassifiedRecv::Line(response_line) => {
                match serde_json::from_str::<ResponseEnvelope>(&response_line) {
                    Ok(resp) if resp.request_id == request_id => {
                        // Atomic park + ownership release — never expose
                        // active=0 with state.child=None while we still hold
                        // the warm child locally.
                        {
                            let mut state = self
                                .inner
                                .lock()
                                .unwrap_or_else(|poison| poison.into_inner());
                            state.child = Some(running);
                        }
                        self.clear_wait_slots_if_owner(request_id, &child_arc);
                        Ok(resp)
                    }
                    Ok(resp) => {
                        kill_running_child(&mut running);
                        self.clear_wait_slots_if_owner(request_id, &child_arc);
                        self.clear_catalog_locked();
                        Err(format!(
                            "ocr-runtime response id mismatch: expected {}, got {}",
                            request_id, resp.request_id
                        ))
                    }
                    Err(err) => {
                        kill_running_child(&mut running);
                        self.clear_wait_slots_if_owner(request_id, &child_arc);
                        self.clear_catalog_locked();
                        Err(format!(
                            "ocr-runtime returned malformed JSON: {err} ({})",
                            response_line.trim()
                        ))
                    }
                }
            }
            ClassifiedRecv::Timeout => {
                kill_running_child(&mut running);
                self.clear_wait_slots_if_owner(request_id, &child_arc);
                self.clear_catalog_locked();
                Err("ocr-runtime timed out".to_string())
            }
            ClassifiedRecv::Disconnected => {
                kill_running_child(&mut running);
                self.clear_wait_slots_if_owner(request_id, &child_arc);
                self.clear_catalog_locked();
                Err("ocr-runtime stdout closed unexpectedly".to_string())
            }
        }
    }

    /// Clear kill_target / active_request_id only when we still own them.
    /// Precondition: `transition_gate` held.
    fn clear_wait_slots_if_owner(&self, request_id: u64, our_child: &Arc<Mutex<Child>>) {
        if let Ok(mut slot) = self.kill_target.lock() {
            let still_ours = slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, our_child));
            if still_ours {
                *slot = None;
            }
        }
        let cleared = self
            .active_request_id
            .compare_exchange(request_id, 0, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok();
        if cleared {
            if let Ok(mut meta) = self.active_meta.lock() {
                if meta.as_ref().is_some_and(|m| m.request_id == request_id) {
                    *meta = None;
                }
            }
            self.idle_cv.notify_all();
        }
    }

    /// Precondition: `transition_gate` held.
    fn clear_catalog_locked(&self) {
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        state.current_catalog_id = None;
    }

    /// Drop wait-side ownership only if this request still owns the slots.
    /// Prefer `finalize_after_wait` for production completion paths.
    #[cfg(test)]
    fn release_wait_ownership(&self, request_id: u64, our_child: &Arc<Mutex<Child>>) {
        let _gate = self
            .transition_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        self.clear_wait_slots_if_owner(request_id, our_child);
    }

    /// Clear catalog only when this request is still the latest-started owner
    /// and no wait slots are held. Retained for Escape-without-successor paths
    /// exercised by unit tests; production finalize uses `clear_catalog_locked`.
    #[cfg(test)]
    fn clear_catalog_if_no_successor(&self, request_id: u64) {
        let _gate = self
            .transition_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if self.latest_started_request_id.load(Ordering::SeqCst) != request_id {
            return;
        }
        let active = self.active_request_id.load(Ordering::SeqCst);
        if active != 0 && active != request_id {
            return;
        }
        if let Ok(slot) = self.kill_target.lock() {
            if slot.is_some() {
                return;
            }
        }
        self.clear_catalog_locked();
    }

    /// Test helper: publish wait ownership under the transition gate using the
    /// same cancel_locked + publish path as production start.
    #[cfg(test)]
    fn start_test_wait(&self, child: &Arc<Mutex<Child>>) -> u64 {
        let _gate = self
            .transition_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if self.active_request_id.load(Ordering::SeqCst) != 0 {
            let invalidate_through = self.intent_sequence.load(Ordering::SeqCst);
            let _ = self.cancel_active_locked(invalidate_through);
        }
        let request_id = {
            let mut state = self
                .inner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let request_id = state.next_request_id;
            state.next_request_id = state.next_request_id.wrapping_add(1).max(1);
            if state.current_catalog_id.is_none() {
                state.current_catalog_id = Some("test-catalog".into());
            }
            // Ensure no parked child from a prior owner leaks across the start.
            // (Production takes the child out before publish; tests only publish
            // the kill_target Arc.)
            request_id
        };
        #[cfg(test)]
        self.wait_test_hook_before_publish();
        self.publish_wait_ownership(request_id, child);
        request_id
    }

    /// Test helper: run the production finalize transition for a successful
    /// response line (or failure) against a locally held `RunningChild`.
    #[cfg(test)]
    fn finalize_test_wait(
        &self,
        request_id: u64,
        epoch_at_start: u64,
        running: RunningChild,
        success_line: Option<String>,
    ) -> Result<ResponseEnvelope, String> {
        #[cfg(test)]
        self.wait_test_hook_before_finalize();
        let classified = match success_line {
            Some(line) => ClassifiedRecv::Line(line),
            None => ClassifiedRecv::Timeout,
        };
        self.finalize_after_wait(request_id, epoch_at_start, running, classified)
    }

    #[cfg(test)]
    fn set_block_before_publish(&self, barrier: Option<std::sync::Arc<std::sync::Barrier>>) {
        *self
            .test_hooks
            .block_before_publish
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = barrier;
    }

    #[cfg(test)]
    fn set_block_before_finalize(&self, barrier: Option<std::sync::Arc<std::sync::Barrier>>) {
        *self
            .test_hooks
            .block_before_finalize
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = barrier;
    }

    #[cfg(test)]
    fn set_coalesce_wait_observer(&self, observer: Option<mpsc::Sender<u64>>) {
        *self
            .test_hooks
            .coalesce_wait_observer
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = observer;
    }

    #[cfg(test)]
    fn notify_test_coalesce_wait(&self, intent_sequence: u64) {
        let observer = self
            .test_hooks
            .coalesce_wait_observer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        if let Some(observer) = observer {
            let _ = observer.send(intent_sequence);
        }
    }

    #[cfg(test)]
    fn set_test_spawner(&self, spawner: Option<Arc<TestSpawner>>) {
        *self
            .test_hooks
            .spawner
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = spawner;
    }

    #[cfg(test)]
    fn wait_test_hook_before_publish(&self) {
        // Double-wait: (1) tell the controller we hold `transition_gate` and
        // are paused before publish; (2) wait until the controller has started
        // Escape/cancel (blocked on the gate) before we proceed.
        let barrier = self
            .test_hooks
            .block_before_publish
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        if let Some(b) = barrier {
            b.wait();
            b.wait();
        }
    }

    #[cfg(test)]
    fn wait_test_hook_before_finalize(&self) {
        // Double-wait: (1) paused after recv, before finalize gate; (2) resume
        // after the controller has let a successor start/supersede.
        let barrier = self
            .test_hooks
            .block_before_finalize
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        if let Some(b) = barrier {
            b.wait();
            b.wait();
        }
    }

    /// Cancel the in-flight OCR request. Takes the transition gate so Escape
    /// cannot race an in-progress ownership publication.
    pub fn cancel_active(&self) -> bool {
        let _gate = self
            .transition_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let invalidate_through = self.intent_sequence.load(Ordering::SeqCst);
        let cancelled = self.cancel_active_locked(invalidate_through);
        // Treat completion of Escape cancellation as the linearization point:
        // requests that arrived while kill/reap was in progress are queued
        // behind this gate and must not start when it opens.
        self.invalidate_intents_through_current();
        cancelled
    }

    /// Precondition: `transition_gate` held. Used by start/supersession and
    /// public Escape/cancel so we never recursively lock the gate.
    fn cancel_active_locked(&self, invalidate_through: u64) -> bool {
        // This transition is also the cancellation boundary for callers that
        // arrived before it and are sleeping in the coalescing condition
        // variable. Do not advance the arrival counter here: a genuinely newer
        // request may already have arrived while this caller held the gate.
        self.cancelled_through_intent
            .fetch_max(invalidate_through, Ordering::SeqCst);
        let active = self.active_request_id.swap(0, Ordering::SeqCst);
        let mut had_kill_target = false;
        if let Ok(mut slot) = self.kill_target.lock() {
            if let Some(child) = slot.take() {
                had_kill_target = true;
                if let Ok(mut guard) = child.lock() {
                    let _ = guard.kill();
                    let _ = guard.wait();
                }
            }
        }
        let mut had_state_child = false;
        {
            let mut state = self
                .inner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if state.child.is_some() {
                had_state_child = true;
                kill_child_in_place(&mut state);
                // Catalog cleared only when we tore down an idle/parked child
                // still held in ManagerState — not while a waiter owns it.
                // Waiters hold the child locally; epoch bump makes them stale.
                state.current_catalog_id = None;
            }
        }
        self.epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut meta) = self.active_meta.lock() {
            *meta = None;
        }
        self.idle_cv.notify_all();
        active != 0 || had_kill_target || had_state_child
    }

    /// Precondition: `transition_gate` held.
    fn invalidate_intents_through_current(&self) {
        let invalidate_through = self.intent_sequence.load(Ordering::SeqCst);
        self.cancelled_through_intent
            .fetch_max(invalidate_through, Ordering::SeqCst);
        self.idle_cv.notify_all();
    }

    pub fn shutdown(&self) {
        let _gate = self
            .transition_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let invalidate_through = self.intent_sequence.load(Ordering::SeqCst);
        let _ = self.cancel_active_locked(invalidate_through);
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        kill_child_in_place(&mut state);
        state.current_catalog_id = None;
        self.active_request_id.store(0, Ordering::SeqCst);
        if let Ok(mut slot) = self.kill_target.lock() {
            *slot = None;
        }
        // Shutdown completes only after all state is cleared. Any request that
        // arrived during teardown was queued behind this gate and belongs to
        // the shutdown generation rather than a future explicit request.
        self.invalidate_intents_through_current();
    }
}

enum ClassifiedRecv {
    Line(String),
    Timeout,
    Disconnected,
}

fn kill_running_child(running: &mut RunningChild) {
    if let Ok(mut guard) = running.child.lock() {
        let _ = guard.kill();
        let _ = guard.wait();
    }
}

fn kill_child_in_place(state: &mut ManagerState) {
    if let Some(mut running) = state.child.take() {
        kill_running_child(&mut running);
    }
}

fn spawn_child(
    catalog_id: &str,
    backend: OcrBackendKind,
    model_root: &Path,
) -> Result<RunningChild, String> {
    let runtime = resolve_ocr_runtime()?;

    let backend_str = match backend {
        OcrBackendKind::TransformersVl => "transformers_vl",
        OcrBackendKind::MlxVl => "mlx_vl",
        OcrBackendKind::PaddleDetRec => "paddle_det_rec",
        OcrBackendKind::PaddleVl => "paddle_vl",
        OcrBackendKind::TessdataPack => "tessdata_pack",
    };

    info!(
        "spawning ocr-runtime: python={} root={} provenance={:?} catalog={} backend={}",
        runtime.python.display(),
        runtime.root.display(),
        runtime.provenance,
        catalog_id,
        backend_str
    );

    let mut envs: HashMap<OsString, OsString> = HashMap::new();
    envs.insert("OCR_RUNTIME_MODEL_ROOT".into(), model_root.into());
    envs.insert("OCR_RUNTIME_CATALOG_ID".into(), catalog_id.into());
    envs.insert("OCR_RUNTIME_BACKEND".into(), backend_str.into());
    envs.insert("PYTHONUNBUFFERED".into(), "1".into());

    let mut child = Command::new(&runtime.python)
        .current_dir(&runtime.root)
        .arg("-m")
        .arg("ocr_runtime")
        .envs(envs)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to spawn ocr-runtime: {err}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "ocr-runtime stdin was not captured".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "ocr-runtime stdout was not captured".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ocr-runtime stderr was not captured".to_string())?;

    // Background reader: forward each stdout line over the channel. Manager
    // takes recv_timeout to bound waits.
    let (tx, rx) = mpsc::channel::<String>();
    let catalog_for_reader = catalog_id.to_string();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    debug!("ocr-runtime stdout read failed for {catalog_for_reader}: {err}");
                    break;
                }
            }
        }
    });

    // Background reader: tail stderr into the app log so we don't lose
    // model-load progress / warnings.
    let catalog_for_stderr = catalog_id.to_string();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            warn!("ocr-runtime[{catalog_for_stderr}]: {}", line.trim());
        }
    });

    Ok(RunningChild {
        child: Arc::new(Mutex::new(child)),
        stdin,
        rx,
    })
}

/// Resolve source and interpreter as one provenance-bound pair. Normal installed
/// execution accepts only the current managed bundle; source-tree and arbitrary
/// Python fallbacks require either an explicit override or an executable that
/// is actually running from this checkout's build target.
fn resolve_ocr_runtime() -> Result<ResolvedOcrRuntime, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mode = std::env::current_exe()
        .ok()
        .map(|executable| runtime_resolution_mode_for_executable(&executable, &manifest_dir))
        .unwrap_or(OcrRuntimeResolutionMode::ProductionInstalled);
    let inputs = OcrRuntimeResolutionInputs {
        mode,
        explicit_root: std::env::var_os("OCR_RUNTIME_ROOT").map(PathBuf::from),
        explicit_python: std::env::var_os("OCR_RUNTIME_PYTHON").map(PathBuf::from),
        managed_candidates: managed_runtime_candidate_roots(),
        development_roots: development_runtime_root_candidates(&manifest_dir),
        development_pythons: development_python_candidates(),
    };
    resolve_ocr_runtime_from_candidates(&inputs, managed_ocr_runtime_definition().as_ref())
}

fn resolve_ocr_runtime_from_candidates(
    inputs: &OcrRuntimeResolutionInputs,
    definition: Option<&ManagedOcrRuntimeDefinition>,
) -> Result<ResolvedOcrRuntime, String> {
    let explicit_override = inputs.explicit_root.is_some() || inputs.explicit_python.is_some();
    if explicit_override {
        if let Some(root) = inputs.explicit_root.as_ref() {
            if !is_runtime_root(root) {
                return Err(format!(
                    "OCR_RUNTIME_ROOT does not contain ocr_runtime/__main__.py: {}",
                    root.display()
                ));
            }
        }
        if let Some(python) = inputs.explicit_python.as_ref() {
            if !python.is_file() {
                return Err(format!(
                    "OCR_RUNTIME_PYTHON is not a file: {}",
                    python.display()
                ));
            }
        }

        let managed =
            definition.and_then(|definition| resolve_current_managed_runtime(inputs, definition));
        let root = inputs
            .explicit_root
            .clone()
            .or_else(|| first_development_runtime_root(&inputs.development_roots))
            .or_else(|| managed.as_ref().map(|runtime| runtime.root.clone()))
            .ok_or_else(|| {
                "An OCR runtime override was requested, but no OCR source root is available. Set OCR_RUNTIME_ROOT."
                    .to_string()
            })?;
        let python = inputs
            .explicit_python
            .clone()
            .or_else(|| runtime_local_python(&root))
            .or_else(|| first_existing_file(&inputs.development_pythons))
            .ok_or_else(|| {
                "An OCR runtime override was requested, but no Python interpreter is available. Set OCR_RUNTIME_PYTHON."
                    .to_string()
            })?;
        return Ok(ResolvedOcrRuntime {
            root,
            python,
            provenance: OcrRuntimeProvenance::ExplicitDeveloperOverride,
        });
    }

    if let Some(definition) = definition {
        if let Some(runtime) = resolve_current_managed_runtime(inputs, definition) {
            return Ok(runtime);
        }
    }

    if inputs.mode == OcrRuntimeResolutionMode::ProductionInstalled {
        return Err(
            "No current compatible managed OCR runtime is installed. Repair the OCR runtime from Model Hub before using neural OCR."
                .to_string(),
        );
    }

    let root = first_development_runtime_root(&inputs.development_roots).ok_or_else(|| {
        "Could not locate the ocr-runtime package in this development checkout. Set OCR_RUNTIME_ROOT."
            .to_string()
    })?;
    let python = runtime_local_python(&root)
        .or_else(|| first_existing_file(&inputs.development_pythons))
        .ok_or_else(|| {
            "Could not locate Python for this development OCR runtime. Set OCR_RUNTIME_PYTHON."
                .to_string()
        })?;
    Ok(ResolvedOcrRuntime {
        root,
        python,
        provenance: OcrRuntimeProvenance::DevelopmentCheckout,
    })
}

fn resolve_current_managed_runtime(
    inputs: &OcrRuntimeResolutionInputs,
    definition: &ManagedOcrRuntimeDefinition,
) -> Option<ResolvedOcrRuntime> {
    for candidate in &inputs.managed_candidates {
        let mut roots = vec![candidate.clone()];
        if let Some(extracted_root) = resolve_extracted_root(candidate) {
            if extracted_root != *candidate {
                roots.push(extracted_root);
            }
        }
        for root in roots {
            if require_managed_runtime_compatible(&root, definition).is_err() {
                continue;
            }
            let python = if definition.manifest_platform == "windows" {
                root.join(".python").join("python.exe")
            } else {
                root.join(".python").join("bin").join("python3")
            };
            return Some(ResolvedOcrRuntime {
                root,
                python,
                provenance: OcrRuntimeProvenance::CurrentManagedRuntime,
            });
        }
    }
    None
}

fn first_development_runtime_root(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|candidate| is_runtime_root(candidate))
        .cloned()
}

fn first_existing_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
}

fn runtime_resolution_mode_for_executable(
    executable: &Path,
    manifest_dir: &Path,
) -> OcrRuntimeResolutionMode {
    // Runtime location is stronger provenance than `debug_assertions`: local
    // release builds under target/ remain developer runs, while any build
    // copied into an installed app location receives production rules.
    let checkout_target = manifest_dir.join("target");
    let executable = executable
        .canonicalize()
        .unwrap_or_else(|_| executable.to_path_buf());
    let checkout_target = checkout_target.canonicalize().unwrap_or(checkout_target);
    if executable.starts_with(checkout_target) {
        OcrRuntimeResolutionMode::DevelopmentCheckout
    } else {
        OcrRuntimeResolutionMode::ProductionInstalled
    }
}

fn development_runtime_root_candidates(manifest_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(parent) = manifest_dir.parent() {
        candidates.push(parent.join("ocr-runtime"));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(executable_dir) = executable.parent() {
            candidates.extend([
                executable_dir.join("../Resources/ocr-runtime"),
                executable_dir.join("../Resources/_up_/ocr-runtime"),
                executable_dir.join("../Resources/resources/ocr-runtime"),
            ]);
        }
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Apps").join("Vox Jot").join("ocr-runtime"));
    }
    candidates
        .into_iter()
        .map(|candidate| candidate.components().collect::<PathBuf>())
        .collect()
}

fn development_python_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.extend([
            home.join("Apps/speech-runtime/.venv/bin/python"),
            home.join(".voxjot/speech-runtime/.venv/bin/python"),
        ]);
    }
    let binary = if cfg!(target_os = "windows") {
        "python.exe"
    } else {
        "python3"
    };
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|directory| directory.join(binary)));
    }
    candidates
}

fn managed_runtime_candidate_roots() -> Vec<PathBuf> {
    let Some(definition) = managed_ocr_runtime_definition() else {
        return Vec::new();
    };

    let relative = PathBuf::from("models")
        .join("ocr-runtime")
        .join(definition.platform_id);
    let mut candidates = Vec::new();

    if let Some(portable_dir) = crate::portable::data_dir() {
        candidates.push(portable_dir.join(&relative));
    }

    if let Some(data_dir) = dirs::data_dir() {
        candidates.push(data_dir.join("com.iriedinamik.voxjot").join(&relative));
    }

    if let Some(home) = dirs::home_dir() {
        #[cfg(target_os = "linux")]
        candidates.push(
            home.join(".config")
                .join("com.iriedinamik.voxjot")
                .join(&relative),
        );
        #[cfg(target_os = "macos")]
        candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("com.iriedinamik.voxjot")
                .join(&relative),
        );
        #[cfg(target_os = "windows")]
        candidates.push(
            home.join("AppData")
                .join("Roaming")
                .join("com.iriedinamik.voxjot")
                .join(&relative),
        );
    }

    candidates
}

fn is_runtime_root(path: &Path) -> bool {
    path.is_dir() && path.join("ocr_runtime").join("__main__.py").is_file()
}
