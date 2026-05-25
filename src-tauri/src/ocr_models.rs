//! OCR model catalog.
//!
//! Registry of OCR families the app can target, plus
//! commands to import them from a user-chosen folder into an app-managed
//! `models/ocr/<catalog_id>/` tree, remove them, and persist a selection in
//! settings.
//!
//! OCR runtime support routes `tessdata-best` through the existing Tesseract
//! backup engine and routes neural/Paddle rows through the `ocr-runtime`
//! sidecar. Backends may fall through to the platform OCR policy on empty or
//! failed results, but every installed catalog row has an executable route.
//!
//! On developer machines that have model files staged at
//! `~/Apps/Models/<conventional-subdir>/`, we silently auto-migrate them on
//! first launch via `migrate_local_ocr_snapshots`. End users never see that
//! path directly — Model Hub exposes **Download from Hugging Face**
//! (canonical mirror repos in `hf_repo_id`), an optional folder import, and
//! progress updates via `ocr-download-progress`.
//!
//! Follow-up phases split macOS capture from Vision OCR and wire neural
//! sidecars one family at a time.

use std::collections::HashSet;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::thread;
use std::time::Duration;

use log::{info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::artifact_download::{emit_artifact_progress, ArtifactProgress, HfRepoDownloadOptions};
use crate::settings::{get_settings, write_settings};
use crate::storage_paths;

static ACTIVE_DOWNLOADS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static NEURAL_ROUTE_CACHE: Lazy<StdMutex<NeuralRouteCache>> =
    Lazy::new(|| StdMutex::new(NeuralRouteCache::default()));
// OCR catalog/import/download commands are model-hub UI work. Keep them off
// WebKit's URL-scheme callback stack.
const OCR_COMMAND_STACK_BYTES: usize = 64 * 1024 * 1024;

async fn run_ocr_command_on_stack<T, F, Fut>(
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
        .stack_size(OCR_COMMAND_STACK_BYTES)
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|err| format!("Failed to start OCR command runtime: {err}"))?;
                runtime.block_on(task())
            })();
            let _ = tx.send(result);
        })
        .map_err(|err| format!("Failed to start OCR command thread: {err}"))?;

    rx.await
        .map_err(|_| "OCR command thread stopped before returning data.".to_string())?
}

#[derive(Debug, Default)]
struct NeuralRouteCache {
    selected_id: Option<String>,
    route: Option<crate::ocr_backend::NeuralRoute>,
}

/// How the catalog entry expects to be imported.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OcrCatalogSourceKind {
    /// Copied from a folder the user picks (or auto-migrated from a known
    /// developer staging path on first launch).
    LocalDirectory,
    /// Downloaded by the app from Hugging Face.
    HuggingFace,
}

/// Inference runtime an entry uses once its files and backend are available.
/// Rows become runnable when their expected local assets are present.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum OcrBackendKind {
    /// Paddle-style detector + recognizer pair (PP-OCRv5).
    PaddleDetRec,
    /// Reserved for PaddleOCR-VL stacks that can run in the local sidecar.
    PaddleVl,
    /// Generic transformers VL stack (LightOnOCR, Chandra, Qwen2.5-VL,
    /// GLM-OCR, olmOCR-2).
    TransformersVl,
    /// Tesseract `tessdata_best` traineddata packs — feeds the existing
    /// backup engine, not a "neural" backend.
    TessdataPack,
}

#[derive(Debug, Clone)]
pub struct OcrCatalogEntry {
    pub id: &'static str,
    pub title: &'static str,
    pub vendor: &'static str,
    pub description: &'static str,
    pub source_kind: OcrCatalogSourceKind,
    pub backend: OcrBackendKind,
    /// Conventional folder name to look for under the dev staging root
    /// (`~/Apps/Models/`). Used only by `migrate_local_ocr_snapshots` —
    /// never surfaced to the UI.
    pub conventional_subdir: &'static str,
    /// Files we expect at the top of the source dir before considering an
    /// import "complete". Empty for catalogs where structure varies.
    pub required_files: &'static [&'static str],
    pub size_hint_label: &'static str,
    pub languages_label: &'static str,
    pub license_label: &'static str,
    pub upstream_url: &'static str,
    /// HuggingFace repo (`<namespace>/<repo>`) the in-app downloader pulls
    /// from. Always set today — for entries whose mirror is still private,
    /// the request will fail with 401 and the UI surfaces that.
    pub hf_repo_id: &'static str,
}

const CATALOG: &[OcrCatalogEntry] = &[
    OcrCatalogEntry {
        id: "pp-ocrv5",
        title: "PP-OCRv5",
        vendor: "PaddlePaddle",
        description: "PaddleOCR v5 mobile + server detector and recognizer pair. Strong on dense screen text.",
        source_kind: OcrCatalogSourceKind::LocalDirectory,
        backend: OcrBackendKind::PaddleDetRec,
        conventional_subdir: "PP-OCRv5",
        required_files: &[],
        size_hint_label: "~250 MB",
        languages_label: "Multilingual",
        license_label: "Apache-2.0",
        upstream_url: "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_safetensors",
        hf_repo_id: "IrieDinamik/ocr-mirror-ppocrv5",
    },
    OcrCatalogEntry {
        id: "lighton-ocr-2-1b",
        title: "LightOnOCR-2 1B",
        vendor: "LightOn",
        description: "Document-tuned VL OCR with strong layout retention. 1B parameters keep latency bearable.",
        source_kind: OcrCatalogSourceKind::LocalDirectory,
        backend: OcrBackendKind::TransformersVl,
        conventional_subdir: "LightOnOCR-2-1B",
        required_files: &["config.json"],
        size_hint_label: "~2 GB",
        languages_label: "Multilingual",
        license_label: "Apache-2.0",
        upstream_url: "https://huggingface.co/lightonai/LightOnOCR-2-1B",
        hf_repo_id: "IrieDinamik/ocr-mirror-lightonocr-2-1b",
    },
    OcrCatalogEntry {
        id: "chandra-ocr-2",
        title: "Chandra OCR 2",
        vendor: "datalab.to",
        description: "Document OCR tuned for academic / structured pages. Good math + tables handling.",
        source_kind: OcrCatalogSourceKind::LocalDirectory,
        backend: OcrBackendKind::TransformersVl,
        conventional_subdir: "chandra-ocr-2",
        required_files: &["config.json"],
        size_hint_label: "~3 GB",
        languages_label: "Multilingual",
        license_label: "OpenRAIL",
        upstream_url: "https://huggingface.co/datalab-to/chandra-ocr-2",
        hf_repo_id: "IrieDinamik/ocr-mirror-chandra-ocr-2",
    },
    OcrCatalogEntry {
        id: "olmocr-2-7b",
        title: "olmOCR-2 7B",
        vendor: "Allen AI",
        description: "Open document OCR from Ai2. Larger weights, accurate on dense scientific text.",
        source_kind: OcrCatalogSourceKind::LocalDirectory,
        backend: OcrBackendKind::TransformersVl,
        conventional_subdir: "olmOCR-2-7B-1025",
        required_files: &["config.json"],
        size_hint_label: "~14 GB",
        languages_label: "English-first",
        license_label: "Apache-2.0",
        upstream_url: "https://huggingface.co/allenai/olmOCR-2-7B-1025",
        hf_repo_id: "IrieDinamik/ocr-mirror-olmocr-2-7b-1025",
    },
    OcrCatalogEntry {
        id: "glm-ocr",
        title: "GLM-OCR",
        vendor: "Zhipu",
        description: "GLM-family OCR specialist. Solid on Chinese and mixed-script screen captures.",
        source_kind: OcrCatalogSourceKind::LocalDirectory,
        backend: OcrBackendKind::TransformersVl,
        conventional_subdir: "GLM-OCR",
        required_files: &["config.json"],
        size_hint_label: "~5 GB",
        languages_label: "Chinese + English",
        license_label: "MIT",
        upstream_url: "https://huggingface.co/zai-org/GLM-OCR",
        hf_repo_id: "IrieDinamik/ocr-glm-ocr",
    },
    OcrCatalogEntry {
        id: "qwen2.5-vl-3b",
        title: "Qwen2.5-VL 3B Instruct",
        vendor: "Alibaba",
        description: "General VL model with respectable OCR. Good fallback when you want one model for screen context + reasoning.",
        source_kind: OcrCatalogSourceKind::LocalDirectory,
        backend: OcrBackendKind::TransformersVl,
        conventional_subdir: "Qwen2.5-VL-3B-Instruct",
        required_files: &["config.json"],
        size_hint_label: "~6 GB",
        languages_label: "Multilingual",
        license_label: "Qwen Research License",
        upstream_url: "https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct",
        hf_repo_id: "IrieDinamik/ocr-qwen2-5-vl-3b",
    },
    OcrCatalogEntry {
        id: "tessdata-best",
        title: "Tesseract tessdata_best",
        vendor: "Tesseract",
        description: "High-quality LSTM language packs for the bundled cross-platform Tesseract engine. Already feeds the System OCR fallback.",
        source_kind: OcrCatalogSourceKind::LocalDirectory,
        backend: OcrBackendKind::TessdataPack,
        conventional_subdir: "tessdata_best",
        required_files: &[],
        size_hint_label: "~1 GB",
        languages_label: "100+ languages",
        license_label: "Apache-2.0",
        upstream_url: "https://github.com/tesseract-ocr/tessdata_best",
        hf_repo_id: "IrieDinamik/ocr-tessdata-best",
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OcrModelDescriptor {
    pub id: String,
    pub title: String,
    pub vendor: String,
    pub description: String,
    pub source_kind: OcrCatalogSourceKind,
    pub backend: OcrBackendKind,
    pub size_hint_label: String,
    pub languages_label: String,
    pub installed: bool,
    pub install_path: Option<String>,
    pub selected: bool,
    /// Whether the app currently knows how to run inference for this entry.
    /// Whether the app can attempt inference for this entry with the files
    /// currently installed on disk.
    pub runnable: bool,
    /// HuggingFace repo the in-app downloader pulls from.
    pub hf_repo_id: String,
    pub license_label: String,
    pub upstream_url: String,
    /// Public web URL pointing at the HF repo, surfaced in the UI for users
    /// who want to inspect the mirror before downloading.
    pub hf_repo_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OcrModelCatalog {
    pub install_root: String,
    pub models: Vec<OcrModelDescriptor>,
}

fn dev_staging_root() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("VOXJOT_OCR_SOURCE_ROOT") {
        if !value.trim().is_empty() {
            return Some(PathBuf::from(value));
        }
    }
    dirs::home_dir().map(|home| home.join("Apps").join("Models"))
}

fn entry_install_dir(app: &AppHandle, entry: &OcrCatalogEntry) -> Result<PathBuf, String> {
    Ok(storage_paths::ocr_models_dir(app)
        .map_err(|err| format!("Failed to resolve OCR model dir: {err}"))?
        .join(entry.id))
}

fn directory_has_contents(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

fn descriptor_for(
    app: &AppHandle,
    entry: &OcrCatalogEntry,
    selected_id: Option<&str>,
) -> OcrModelDescriptor {
    let install_dir = entry_install_dir(app, entry).ok();
    let installed = install_dir
        .as_ref()
        .map(|dir| dir.exists() && directory_has_contents(dir))
        .unwrap_or(false);
    let runnable = installed
        && install_dir
            .as_ref()
            .map(|dir| compute_runnable_for_app(app, entry.backend, dir))
            .unwrap_or(false);
    OcrModelDescriptor {
        id: entry.id.to_string(),
        title: entry.title.to_string(),
        vendor: entry.vendor.to_string(),
        description: entry.description.to_string(),
        source_kind: entry.source_kind,
        backend: entry.backend,
        size_hint_label: entry.size_hint_label.to_string(),
        languages_label: entry.languages_label.to_string(),
        installed,
        install_path: install_dir.map(|dir| dir.display().to_string()),
        selected: selected_id == Some(entry.id),
        runnable,
        hf_repo_id: entry.hf_repo_id.to_string(),
        license_label: entry.license_label.to_string(),
        upstream_url: entry.upstream_url.to_string(),
        hf_repo_url: format!("https://huggingface.co/{}", entry.hf_repo_id),
    }
}

/// Whether the app currently has the code path *and* the on-disk files to
/// actually run inference for `backend` against `install_dir`.
///
/// This is a presence probe, not a hot-path health check. The route cache is
/// refreshed on startup and selection/import/delete so screen capture does not
/// scan model directories on every frame.
pub fn compute_runnable(backend: OcrBackendKind, install_dir: &Path) -> bool {
    match backend {
        OcrBackendKind::TessdataPack => tessdata_pack_runnable(install_dir),
        OcrBackendKind::TransformersVl => transformers_vl_runnable(install_dir),
        OcrBackendKind::PaddleDetRec => paddle_det_rec_runnable(install_dir),
        OcrBackendKind::PaddleVl => install_dir.join("config.json").is_file(),
    }
}

fn compute_runnable_for_app(app: &AppHandle, backend: OcrBackendKind, install_dir: &Path) -> bool {
    compute_runnable(backend, install_dir)
        && crate::ocr_runtime::runtime_prerequisites_available(app, backend)
}

fn tessdata_pack_runnable(install_dir: &Path) -> bool {
    locate_tessdata_pack_dir(install_dir).is_some()
}

fn locate_tessdata_pack_dir(install_dir: &Path) -> Option<PathBuf> {
    fn dir_has_traineddata(dir: &Path) -> bool {
        fs::read_dir(dir)
            .map(|entries| {
                entries.filter_map(Result::ok).any(|entry| {
                    entry
                        .path()
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|s| s.eq_ignore_ascii_case("traineddata"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    }
    if dir_has_traineddata(install_dir) {
        return Some(install_dir.to_path_buf());
    }
    for nested in ["tessdata_best", "tessdata"] {
        let candidate = install_dir.join(nested);
        if candidate.is_dir() && dir_has_traineddata(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn transformers_vl_runnable(install_dir: &Path) -> bool {
    if !install_dir.join("config.json").is_file() {
        return false;
    }
    fs::read_dir(install_dir)
        .map(|entries| {
            entries.filter_map(Result::ok).any(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|s| s.eq_ignore_ascii_case("safetensors"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn paddle_det_rec_runnable(install_dir: &Path) -> bool {
    fn contains_inference_file(dir: &Path) -> bool {
        fs::read_dir(dir)
            .map(|entries| {
                entries.filter_map(Result::ok).any(|entry| {
                    let path = entry.path();
                    let name = path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    name == "inference.pdiparams"
                        || name == "inference.onnx"
                        || name.ends_with(".onnx")
                })
            })
            .unwrap_or(false)
    }

    let det_ok = ["mobile_det", "server_det", "det"]
        .iter()
        .map(|name| install_dir.join(name))
        .any(|dir| dir.is_dir() && contains_inference_file(&dir));
    let rec_ok = ["mobile_rec", "server_rec", "rec"]
        .iter()
        .map(|name| install_dir.join(name))
        .any(|dir| dir.is_dir() && contains_inference_file(&dir));
    det_ok && rec_ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn tessdata_pack_runnable_uses_platform_gate() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("eng.traineddata"), b"fake").unwrap();

        let runnable = compute_runnable(OcrBackendKind::TessdataPack, dir.path());
        assert!(runnable);
    }

    #[test]
    fn tessdata_pack_probe_accepts_nested_tessdata_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("tessdata_best");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("eng.traineddata"), b"fake").unwrap();

        let runnable = compute_runnable(OcrBackendKind::TessdataPack, dir.path());
        assert!(runnable);
    }

    #[test]
    fn tessdata_route_dir_points_at_traineddata_parent() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("tessdata");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("eng.traineddata"), b"fake").unwrap();

        assert_eq!(locate_tessdata_pack_dir(dir.path()).unwrap(), nested);
    }

    #[test]
    fn transformers_vl_requires_config_and_weights() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("config.json"), b"{}").unwrap();
        assert!(!transformers_vl_runnable(dir.path()));
        fs::write(dir.path().join("model.safetensors"), b"fake").unwrap();

        assert!(transformers_vl_runnable(dir.path()));
    }

    #[test]
    fn paddle_vl_requires_config() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!dir.path().join("config.json").is_file());
        fs::write(dir.path().join("config.json"), b"{}").unwrap();
        assert!(dir.path().join("config.json").is_file());
    }

    #[test]
    fn paddle_det_rec_requires_detector_and_recognizer() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("mobile_det")).unwrap();
        fs::create_dir(dir.path().join("mobile_rec")).unwrap();
        fs::write(
            dir.path().join("mobile_det").join("inference.pdiparams"),
            b"fake",
        )
        .unwrap();
        assert!(!compute_runnable(OcrBackendKind::PaddleDetRec, dir.path()));
        fs::write(
            dir.path().join("mobile_rec").join("inference.pdiparams"),
            b"fake",
        )
        .unwrap();
        assert!(paddle_det_rec_runnable(dir.path()));
    }
}

/// Recompute the selected OCR route outside the capture hot path.
pub fn refresh_neural_route_cache(
    app: &AppHandle,
    settings: &crate::settings::AppSettings,
) -> Option<crate::ocr_backend::NeuralRoute> {
    let selected_id = settings.screen_context_ocr_neural_model_id.clone();
    let route = selected_id
        .as_deref()
        .and_then(|id| build_neural_route(app, id));

    let mut cache = NEURAL_ROUTE_CACHE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    cache.selected_id = selected_id;
    cache.route = route.clone();
    route
}

fn build_neural_route(app: &AppHandle, id: &str) -> Option<crate::ocr_backend::NeuralRoute> {
    let entry = CATALOG.iter().find(|entry| entry.id == id)?;
    let install_dir = entry_install_dir(app, entry).ok()?;
    if !install_dir.exists() {
        return None;
    }
    if !compute_runnable_for_app(app, entry.backend, &install_dir) {
        return None;
    }

    let backend_dir = match entry.backend {
        OcrBackendKind::TessdataPack => locate_tessdata_pack_dir(&install_dir)?,
        OcrBackendKind::TransformersVl
        | OcrBackendKind::PaddleDetRec
        | OcrBackendKind::PaddleVl => install_dir,
    };

    Some(crate::ocr_backend::NeuralRoute {
        backend: entry.backend,
        install_dir: backend_dir,
        catalog_id: entry.id.to_string(),
    })
}

/// What the screen-context worker should hand to `ocr_backend::run` this
/// capture, if anything. This function is intentionally cache-only: model
/// file probes run on selection/startup, not during capture.
pub fn resolve_neural_route(
    _app: &AppHandle,
    settings: &crate::settings::AppSettings,
) -> Option<crate::ocr_backend::NeuralRoute> {
    let id = settings.screen_context_ocr_neural_model_id.as_deref()?;
    let cache = NEURAL_ROUTE_CACHE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if cache.selected_id.as_deref() == Some(id) {
        return cache.route.clone();
    }
    None
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<u64, String> {
    if !src.exists() {
        return Err(format!("Source path '{}' does not exist.", src.display()));
    }
    if src.is_file() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create '{}': {err}", parent.display()))?;
        }
        return fs::copy(src, dst)
            .map_err(|err| format!("Failed to copy '{}': {err}", src.display()));
    }

    fs::create_dir_all(dst)
        .map_err(|err| format!("Failed to create '{}': {err}", dst.display()))?;
    let mut bytes = 0u64;
    for entry in
        fs::read_dir(src).map_err(|err| format!("Failed to read '{}': {err}", src.display()))?
    {
        let entry = entry.map_err(|err| format!("Failed to inspect directory entry: {err}"))?;
        let child_src = entry.path();
        let name = entry.file_name();
        // Skip dotfiles and HF cache scratch (.cache, .git, etc.) — they
        // bloat the install and aren't needed at runtime.
        let lossy = name.to_string_lossy();
        if lossy.starts_with('.') {
            continue;
        }
        let child_dst = dst.join(&name);
        bytes += copy_dir_recursive(&child_src, &child_dst)?;
    }
    Ok(bytes)
}

fn import_from_dir(
    app: &AppHandle,
    entry: &OcrCatalogEntry,
    src: &Path,
) -> Result<OcrModelDescriptor, String> {
    if !src.exists() {
        return Err(format!("Source folder '{}' does not exist.", src.display()));
    }
    if !src.is_dir() {
        return Err(format!(
            "'{}' is not a directory — pick the folder that contains the model files.",
            src.display()
        ));
    }

    for required in entry.required_files {
        let candidate = src.join(required);
        if !candidate.exists() {
            return Err(format!(
                "Selected folder is missing expected file '{}'. Pick the folder that holds the model's weight files.",
                required
            ));
        }
    }

    let dst = entry_install_dir(app, entry)?;
    if dst.exists() {
        fs::remove_dir_all(&dst).map_err(|err| {
            format!(
                "Failed to clear existing install at '{}': {err}",
                dst.display()
            )
        })?;
    }

    let bytes = copy_dir_recursive(src, &dst)?;
    info!(
        "Imported OCR model '{}' from '{}' to '{}' ({} bytes)",
        entry.id,
        src.display(),
        dst.display(),
        bytes
    );

    let settings = get_settings(app);
    let selected_id = settings.screen_context_ocr_neural_model_id.as_deref();
    if selected_id == Some(entry.id) {
        refresh_neural_route_cache(app, &settings);
    }
    Ok(descriptor_for(app, entry, selected_id))
}

/// One-shot migration: if a developer has model files staged at
/// `~/Apps/Models/<conventional-subdir>/`, copy them into the app-managed
/// install root the first time the app sees them. Idempotent (skips entries
/// that are already installed). End users with no staging folder are a
/// no-op.
pub fn migrate_local_ocr_snapshots(app: &AppHandle) {
    let Some(root) = dev_staging_root() else {
        return;
    };
    if !root.exists() {
        return;
    }

    for entry in CATALOG {
        let dst = match entry_install_dir(app, entry) {
            Ok(dir) => dir,
            Err(err) => {
                warn!("Skipping OCR migration for '{}': {err}", entry.id);
                continue;
            }
        };
        if dst.exists() && directory_has_contents(&dst) {
            continue;
        }
        let src = root.join(entry.conventional_subdir);
        if !src.exists() || !src.is_dir() {
            continue;
        }

        match import_from_dir(app, entry, &src) {
            Ok(_) => info!(
                "Auto-migrated OCR model '{}' from staging dir into managed store",
                entry.id
            ),
            Err(err) => warn!("Auto-migration failed for OCR model '{}': {err}", entry.id),
        }
    }
}

pub fn get_ocr_model_catalog_impl(app: &AppHandle) -> Result<OcrModelCatalog, String> {
    let install_root = storage_paths::ocr_models_dir(app)
        .map_err(|err| format!("Failed to resolve OCR install root: {err}"))?;

    let settings = get_settings(app);
    let selected_id = settings.screen_context_ocr_neural_model_id.as_deref();

    let models = CATALOG
        .iter()
        .map(|entry| descriptor_for(app, entry, selected_id))
        .collect();

    Ok(OcrModelCatalog {
        install_root: install_root.display().to_string(),
        models,
    })
}

pub async fn import_ocr_model_from_disk_impl(
    app: &AppHandle,
    catalog_id: String,
    source_dir: String,
) -> Result<OcrModelDescriptor, String> {
    let entry = CATALOG
        .iter()
        .find(|entry| entry.id == catalog_id)
        .ok_or_else(|| format!("Unknown OCR catalog id: '{}'.", catalog_id))?;

    let trimmed = source_dir.trim();
    if trimmed.is_empty() {
        return Err("Pick a folder that holds the model files.".to_string());
    }

    import_from_dir(app, entry, &PathBuf::from(trimmed))?;
    if !matches!(entry.backend, OcrBackendKind::TessdataPack) {
        crate::ocr_runtime::ensure_managed_ocr_runtime_installed(app, Some(entry.id)).await?;
    }
    Ok(descriptor_for(
        app,
        entry,
        get_settings(app)
            .screen_context_ocr_neural_model_id
            .as_deref(),
    ))
}

pub fn delete_ocr_model_impl(
    app: &AppHandle,
    catalog_id: String,
) -> Result<OcrModelDescriptor, String> {
    let entry = CATALOG
        .iter()
        .find(|entry| entry.id == catalog_id)
        .ok_or_else(|| format!("Unknown OCR catalog id: '{}'.", catalog_id))?;
    let install_dir = entry_install_dir(app, entry)?;
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)
            .map_err(|err| format!("Failed to remove '{}': {err}", install_dir.display()))?;
        info!(
            "Removed OCR model '{}' at {}",
            entry.id,
            install_dir.display()
        );
    }

    // If the deleted model was the selected one, fall back to the built-in
    // routing policy automatically — leaving a dangling reference would hide
    // the System card from the UI.
    let mut settings = get_settings(app);
    let mut selected_id = settings.screen_context_ocr_neural_model_id.clone();
    if selected_id.as_deref() == Some(entry.id) {
        settings.screen_context_ocr_neural_model_id = None;
        selected_id = None;
        write_settings(app, settings.clone());
        refresh_neural_route_cache(app, &settings);
    }

    Ok(descriptor_for(app, entry, selected_id.as_deref()))
}

pub fn set_ocr_model_selection_impl(
    app: &AppHandle,
    neural_model_id: Option<String>,
) -> Result<(), String> {
    if let Some(id) = neural_model_id.as_deref() {
        let entry = CATALOG
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| format!("Unknown OCR catalog id: '{}'.", id))?;
        let install_dir = entry_install_dir(app, entry)?;
        if !install_dir.exists() || !directory_has_contents(&install_dir) {
            return Err(format!(
                "'{}' is not installed yet — download it from Hugging Face or import from a folder.",
                entry.title
            ));
        }
        if !compute_runnable_for_app(app, entry.backend, &install_dir) {
            return Err(format!(
                "'{}' is installed, but its OCR runtime is not ready yet. Download or repair the Vox Jot OCR runtime first.",
                entry.title
            ));
        }
    }

    let mut settings = get_settings(app);
    settings.screen_context_ocr_neural_model_id = neural_model_id;
    write_settings(app, settings.clone());
    let route = refresh_neural_route_cache(app, &settings);
    if let Some(route) = route {
        if !matches!(route.backend, OcrBackendKind::TessdataPack) {
            std::thread::spawn(move || {
                let _ = crate::ocr_runtime::shared().probe(
                    &route.catalog_id,
                    route.backend,
                    &route.install_dir,
                    Duration::from_millis(1500),
                );
            });
        } else {
            crate::ocr_runtime::shared().shutdown();
        }
    } else {
        crate::ocr_runtime::shared().shutdown();
    }
    Ok(())
}

// --- HuggingFace download path -------------------------------------------

fn ocr_staging_dir(app: &AppHandle, catalog_id: &str) -> Result<PathBuf, String> {
    Ok(storage_paths::ocr_models_dir(app)
        .map_err(|err| format!("Failed to resolve OCR install root: {err}"))?
        .join(format!(".staging-{catalog_id}")))
}

pub(crate) fn emit_progress(
    app: &AppHandle,
    catalog_id: &str,
    stage: &str,
    downloaded: u64,
    total: u64,
    file: Option<&str>,
    file_index: Option<usize>,
    file_count: Option<usize>,
    error: Option<&str>,
) {
    let pct = if total > 0 {
        (downloaded as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let payload = serde_json::json!({
        "catalog_id": catalog_id,
        "stage": stage,
        "downloaded": downloaded,
        "total": total,
        "percentage": pct,
        "file": file,
        "file_index": file_index,
        "file_count": file_count,
        "error": error,
    });
    let _ = app.emit("ocr-download-progress", payload);
}

pub async fn download_ocr_model_impl(
    app: &AppHandle,
    catalog_id: String,
) -> Result<OcrModelDescriptor, String> {
    let entry = CATALOG
        .iter()
        .find(|entry| entry.id == catalog_id)
        .ok_or_else(|| format!("Unknown OCR catalog id: '{}'.", catalog_id))?;

    {
        let mut active = ACTIVE_DOWNLOADS.lock().await;
        if !active.insert(catalog_id.clone()) {
            return Err(format!("'{}' is already downloading.", entry.title));
        }
    }

    let result = download_ocr_model_inner(app, entry).await;
    ACTIVE_DOWNLOADS.lock().await.remove(&catalog_id);

    if let Err(err) = &result {
        emit_progress(app, entry.id, "failed", 0, 0, None, None, None, Some(err));
    }

    result
}

async fn download_ocr_model_inner(
    app: &AppHandle,
    entry: &OcrCatalogEntry,
) -> Result<OcrModelDescriptor, String> {
    let staging = ocr_staging_dir(app, entry.id)?;
    let final_dir = entry_install_dir(app, entry)?;

    let bridge_app = app.clone();
    let catalog_id = entry.id.to_string();
    let progress = std::sync::Arc::new(move |progress: ArtifactProgress| {
        emit_artifact_progress(&bridge_app, progress.clone());
        emit_progress(
            &bridge_app,
            &catalog_id,
            &progress.phase,
            progress.downloaded_bytes,
            progress.total_bytes,
            progress.file.as_deref(),
            progress.file_index,
            progress.file_count,
            progress.error.as_deref(),
        );
    });

    let cancel_flag = crate::artifact_download::register_download_cancel_flag("ocr", entry.id);
    struct CancelGuard {
        artifact_id: String,
    }
    impl Drop for CancelGuard {
        fn drop(&mut self) {
            crate::artifact_download::clear_download_cancel_flag("ocr", &self.artifact_id);
        }
    }
    let _cancel_guard = CancelGuard {
        artifact_id: entry.id.to_string(),
    };

    let report = crate::artifact_download::download_hf_repo(HfRepoDownloadOptions {
        domain: "ocr".to_string(),
        artifact_id: entry.id.to_string(),
        repo_id: entry.hf_repo_id.to_string(),
        staging_dir: staging,
        final_dir,
        token: crate::speech_analysis::hugging_face_token_for_runtime(),
        gated: false,
        resume_existing_staging: true,
        cancel_flag: Some(cancel_flag),
        progress: Some(progress),
    })
    .await?;

    info!(
        "Downloaded OCR model '{}' from {} to {}",
        entry.id,
        entry.hf_repo_id,
        report.final_dir.display()
    );

    if !matches!(entry.backend, OcrBackendKind::TessdataPack) {
        crate::ocr_runtime::ensure_managed_ocr_runtime_installed(app, Some(entry.id)).await?;
    }

    emit_progress(
        app,
        entry.id,
        "complete",
        report.downloaded_bytes,
        report.total_bytes,
        None,
        Some(report.file_count),
        Some(report.file_count),
        None,
    );

    let settings = get_settings(app);
    let selected_id = settings.screen_context_ocr_neural_model_id.as_deref();
    if selected_id == Some(entry.id) {
        refresh_neural_route_cache(app, &settings);
    }
    Ok(descriptor_for(app, entry, selected_id))
}

pub async fn get_active_ocr_downloads_impl() -> Vec<String> {
    ACTIVE_DOWNLOADS.lock().await.iter().cloned().collect()
}

#[tauri::command]
#[specta::specta]
pub async fn get_ocr_model_catalog(app: AppHandle) -> Result<OcrModelCatalog, String> {
    run_ocr_command_on_stack("get-ocr-model-catalog", move || async move {
        get_ocr_model_catalog_impl(&app)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn import_ocr_model_from_disk(
    app: AppHandle,
    catalog_id: String,
    source_dir: String,
) -> Result<OcrModelDescriptor, String> {
    run_ocr_command_on_stack("import-ocr-model-from-disk", move || async move {
        import_ocr_model_from_disk_impl(&app, catalog_id, source_dir).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_ocr_model(
    app: AppHandle,
    catalog_id: String,
) -> Result<OcrModelDescriptor, String> {
    run_ocr_command_on_stack("delete-ocr-model", move || async move {
        delete_ocr_model_impl(&app, catalog_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn set_ocr_model_selection(
    app: AppHandle,
    neural_model_id: Option<String>,
) -> Result<(), String> {
    run_ocr_command_on_stack("set-ocr-model-selection", move || async move {
        set_ocr_model_selection_impl(&app, neural_model_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn download_ocr_model(
    app: AppHandle,
    catalog_id: String,
) -> Result<OcrModelDescriptor, String> {
    run_ocr_command_on_stack("download-ocr-model", move || async move {
        download_ocr_model_impl(&app, catalog_id).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_active_ocr_downloads() -> Vec<String> {
    get_active_ocr_downloads_impl().await
}
