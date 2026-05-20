//! OCR runtime manager.
//!
//! Owns the long-lived Python sidecar process that holds a vision-language
//! model in memory and answers OCR requests over line-delimited JSON. The
//! Rust router calls into [`OcrRuntimeManager::request`] from the screen
//! context worker thread; we serialise calls so a single child handles one
//! frame at a time.
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
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
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

/// Shared singleton — the screen-context worker is the only caller and it
/// runs on a dedicated thread, so a single global handle is fine.
static MANAGER: Lazy<OcrRuntimeManager> = Lazy::new(OcrRuntimeManager::new);
static PREREQUISITE_CACHE: Lazy<Mutex<HashMap<OcrBackendKind, bool>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn shared() -> &'static OcrRuntimeManager {
    &MANAGER
}

#[derive(Debug, Clone)]
pub struct ManagedOcrRuntimeDefinition {
    pub platform_id: &'static str,
    pub archive_name: &'static str,
    pub checksum_name: &'static str,
    pub hf_repo_id: &'static str,
}

pub fn managed_ocr_runtime_definition() -> Option<ManagedOcrRuntimeDefinition> {
    const HF_REPO_ID: &str = "IrieDinamik/vox-jot-ocr-runtime";

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some(ManagedOcrRuntimeDefinition {
            platform_id: "macos-aarch64",
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
            archive_name: "ocr-runtime-linux-x64-all.tar.gz",
            checksum_name: "ocr-runtime-linux-x64-all.tar.gz.sha256",
            hf_repo_id: HF_REPO_ID,
        });
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some(ManagedOcrRuntimeDefinition {
            platform_id: "windows-x64",
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
    let definition = managed_ocr_runtime_definition().ok_or_else(|| {
        "The managed OCR runtime is not available on this platform yet.".to_string()
    })?;
    let install_dir = managed_ocr_runtime_install_dir(app, definition.platform_id)?;

    if let Some(root) = resolve_extracted_root(&install_dir) {
        if managed_ocr_runtime_entrypoint(&root).is_some()
            && managed_ocr_runtime_python(&root).is_some()
        {
            clear_prerequisite_cache();
            return Ok(root);
        }
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

    let root = resolve_extracted_root(&install_dir)
        .ok_or_else(|| "OCR runtime extraction did not produce any files.".to_string())?;
    if managed_ocr_runtime_entrypoint(&root).is_none() {
        return Err(
            "OCR runtime download completed, but the runtime entrypoint is missing.".into(),
        );
    }
    if managed_ocr_runtime_python(&root).is_none() {
        return Err(
            "OCR runtime download completed, but its Python environment is missing.".into(),
        );
    }

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
    let python = locate_python().ok_or_else(|| {
        "Could not locate a Python 3 interpreter for the OCR runtime. Set OCR_RUNTIME_PYTHON or install python3.".to_string()
    })?;
    let runtime_root = locate_runtime_root().ok_or_else(|| {
        "Could not locate the ocr-runtime package. Install the packaged app resources or set OCR_RUNTIME_ROOT.".to_string()
    })?;

    let modules = match backend {
        OcrBackendKind::TransformersVl | OcrBackendKind::PaddleVl => "PIL,torch,transformers",
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

    let status = Command::new(&python)
        .current_dir(runtime_root)
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

fn managed_ocr_runtime_python(runtime_root: &Path) -> Option<PathBuf> {
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

fn managed_ocr_runtime_entrypoint(runtime_root: &Path) -> Option<PathBuf> {
    [
        runtime_root.join("ocr_runtime").join("__main__.py"),
        runtime_root
            .join("ocr-runtime")
            .join("ocr_runtime")
            .join("__main__.py"),
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

    let extract_result = extract_archive(&archive_path, install_dir);
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
    use super::{is_macos_metadata_path, sanitize_archive_path, validate_archive_link_target};
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

#[derive(Debug, Clone)]
#[allow(dead_code)] // fields read by the UI layer once the catalog surfaces probe state
pub struct ProbeResult {
    pub loaded: bool,
    pub detail: Option<String>,
}

pub struct OcrRuntimeManager {
    inner: Mutex<ManagerState>,
}

struct ManagerState {
    child: Option<RunningChild>,
    /// Catalog id of the model currently loaded in the child. We respawn
    /// when this no longer matches the request.
    current_catalog_id: Option<String>,
    next_request_id: u64,
}

struct RunningChild {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<String>,
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
    ) -> Result<ProbeResult, String> {
        let response = self.request_inner(
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
        let detail = response
            .info
            .as_ref()
            .and_then(|info| info.get("detail"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let loaded = response.ok.unwrap_or(false)
            && response
                .info
                .as_ref()
                .and_then(|info| info.get("loaded"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
        Ok(ProbeResult { loaded, detail })
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
        let frame_b64 = BASE64.encode(frame.pixels);
        let pixel_format = match frame.format {
            PixelFormat::Bgra8 => "bgra8",
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
        let response = self.request_inner(catalog_id, backend, model_root, "ocr", body, timeout)?;
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
        catalog_id: &str,
        backend: OcrBackendKind,
        model_root: &Path,
        op: &str,
        body: serde_json::Value,
        timeout: Duration,
    ) -> Result<ResponseEnvelope, String> {
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        // Respawn when the user picked a different model.
        if state.current_catalog_id.as_deref() != Some(catalog_id) {
            kill_child_in_place(&mut state);
            state.current_catalog_id = Some(catalog_id.to_string());
        }

        if state.child.is_none() {
            let running = spawn_child(catalog_id, backend, model_root)?;
            state.child = Some(running);
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

        // Send.
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

        // Receive with deadline.
        let response_line = {
            let running = state
                .child
                .as_mut()
                .expect("send branch above guarantees child");
            match running.rx.recv_timeout(timeout) {
                Ok(line) => line,
                Err(err) => {
                    let message = match err {
                        mpsc::RecvTimeoutError::Timeout => "ocr-runtime timed out".to_string(),
                        mpsc::RecvTimeoutError::Disconnected => {
                            "ocr-runtime stdout closed unexpectedly".to_string()
                        }
                    };
                    kill_child_in_place(&mut state);
                    return Err(message);
                }
            }
        };

        // On any decode failure or mismatched id we tear down so the next
        // request gets a fresh process.
        match serde_json::from_str::<ResponseEnvelope>(&response_line) {
            Ok(resp) if resp.request_id == request_id => Ok(resp),
            Ok(resp) => {
                kill_child_in_place(&mut state);
                Err(format!(
                    "ocr-runtime response id mismatch: expected {}, got {}",
                    request_id, resp.request_id
                ))
            }
            Err(err) => {
                kill_child_in_place(&mut state);
                Err(format!(
                    "ocr-runtime returned malformed JSON: {err} ({})",
                    response_line.trim()
                ))
            }
        }
    }

    /// Kill the currently-running child. Idempotent.
    pub fn shutdown(&self) {
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        kill_child_in_place(&mut state);
        state.current_catalog_id = None;
    }
}

fn kill_child_in_place(state: &mut ManagerState) {
    if let Some(mut running) = state.child.take() {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

fn spawn_child(
    catalog_id: &str,
    backend: OcrBackendKind,
    model_root: &Path,
) -> Result<RunningChild, String> {
    let python = locate_python().ok_or_else(|| {
        "Could not locate a Python 3 interpreter for the OCR runtime. Set OCR_RUNTIME_PYTHON or install python3.".to_string()
    })?;
    let runtime_root = locate_runtime_root().ok_or_else(|| {
        "Could not locate the ocr-runtime package. Run `bun run mac:update-installed-app` from a checkout that includes ocr-runtime/.".to_string()
    })?;

    let backend_str = match backend {
        OcrBackendKind::TransformersVl => "transformers_vl",
        OcrBackendKind::PaddleDetRec => "paddle_det_rec",
        OcrBackendKind::PaddleVl => "paddle_vl",
        OcrBackendKind::TessdataPack => "tessdata_pack",
    };

    info!(
        "spawning ocr-runtime: python={} root={} catalog={} backend={}",
        python.display(),
        runtime_root.display(),
        catalog_id,
        backend_str
    );

    let mut envs: HashMap<OsString, OsString> = HashMap::new();
    envs.insert("OCR_RUNTIME_MODEL_ROOT".into(), model_root.into());
    envs.insert("OCR_RUNTIME_CATALOG_ID".into(), catalog_id.into());
    envs.insert("OCR_RUNTIME_BACKEND".into(), backend_str.into());
    envs.insert("PYTHONUNBUFFERED".into(), "1".into());

    let mut child = Command::new(&python)
        .current_dir(&runtime_root)
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

    Ok(RunningChild { child, stdin, rx })
}

fn locate_python() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("OCR_RUNTIME_PYTHON") {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Some(p);
        }
    }

    // Managed or repo-local ocr-runtime venv.
    if let Some(root) = locate_runtime_root() {
        if let Some(venv_python) = managed_ocr_runtime_python(&root) {
            return Some(venv_python);
        }
    }

    // Reuse the speech-runtime venv if the user has bootstrapped it. This is
    // a development fallback only; managed OCR runtimes win above.
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            home.join("Apps/speech-runtime/.venv/bin/python"),
            home.join(".voxjot/speech-runtime/.venv/bin/python"),
        ];
        for c in candidates {
            if c.is_file() {
                return Some(c);
            }
        }
    }

    // Fallback: any python3 on PATH. Sufficient for the stub server (no
    // third-party deps) and lets dev iteration work without a venv.
    let bin = if cfg!(target_os = "windows") {
        "python.exe"
    } else {
        "python3"
    };
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(bin);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Locate the `ocr-runtime/` package on disk. Mirrors `sidecar.rs`'s
/// runtime resolution: prefer a checkout next to `src-tauri/`, then a
/// managed install under app-data, finally an env override.
fn locate_runtime_root() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("OCR_RUNTIME_ROOT") {
        let p = PathBuf::from(custom);
        if is_runtime_root(&p) {
            return Some(p);
        }
    }

    for candidate in managed_runtime_candidate_roots() {
        if is_runtime_root(&candidate) && managed_ocr_runtime_python(&candidate).is_some() {
            return Some(candidate);
        }
        if let Some(root) = resolve_extracted_root(&candidate) {
            if is_runtime_root(&root) && managed_ocr_runtime_python(&root).is_some() {
                return Some(root);
            }
        }
    }

    // Compile-time CARGO_MANIFEST_DIR points at src-tauri/, so the
    // sibling package is at ../ocr-runtime in dev checkouts.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest_dir.parent() {
        let candidate = parent.join("ocr-runtime");
        if is_runtime_root(&candidate) {
            return Some(candidate);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            let resource_candidates = [
                macos_dir.join("../Resources/ocr-runtime"),
                macos_dir.join("../Resources/_up_/ocr-runtime"),
                macos_dir.join("../Resources/resources/ocr-runtime"),
            ];
            for candidate in resource_candidates {
                let normalized = candidate.components().collect::<PathBuf>();
                if is_runtime_root(&normalized) {
                    return Some(normalized);
                }
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        let candidate = home.join("Apps").join("Vox Jot").join("ocr-runtime");
        if is_runtime_root(&candidate) {
            return Some(candidate);
        }
    }

    None
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
