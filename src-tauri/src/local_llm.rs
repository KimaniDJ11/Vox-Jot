//! Vox Jot-managed GGUF inference through a pinned llama.cpp runtime.
//!
//! Model weights remain in the configured model store (including an external
//! drive). Vox Jot downloads only the small platform runtime, starts a
//! loopback-only server lazily, and keeps at most one refine model loaded.

use crate::external_model_storage::{self, ModelStorageLocation};
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const PROVIDER_ID: &str = crate::settings::VOX_JOT_LOCAL_PROVIDER_ID;
const RUNTIME_VERSION: &str = "b10516";
const RUNTIME_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const SERVER_ALIAS: &str = "vox-jot-local";
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_DISCOVERY_DEPTH: usize = 8;

#[derive(Debug, Clone)]
pub struct LocalGgufModel {
    pub runtime_model_id: String,
    pub title: String,
    pub path: PathBuf,
    pub relative_path: PathBuf,
    pub storage_location: ModelStorageLocation,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct LocalServerEndpoint {
    pub base_url: String,
    pub model_alias: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct RuntimeBundle {
    platform_id: &'static str,
    archive_name: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
    archive_kind: ArchiveKind,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
enum ArchiveKind {
    TarGz,
    Zip,
}

#[derive(Default)]
struct RuntimeProcess {
    child: Option<Child>,
    model_path: Option<PathBuf>,
    port: Option<u16>,
}

static MODEL_PATHS: Lazy<RwLock<HashMap<String, PathBuf>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));
static PROCESS: Lazy<Mutex<RuntimeProcess>> = Lazy::new(|| Mutex::new(RuntimeProcess::default()));
static INSTALL_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
static START_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
static USE_GENERATION: AtomicU64 = AtomicU64::new(0);

fn runtime_bundle() -> Option<RuntimeBundle> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some(RuntimeBundle {
        platform_id: "macos-arm64",
        archive_name: "llama-b10516-bin-macos-arm64.tar.gz",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-macos-arm64.tar.gz",
        sha256: "ee3324327d621026ae80c24031670e65fa62a0b23a3a027dbe2f65f240affd30",
        size: 11_089_823,
        archive_kind: ArchiveKind::TarGz,
    });

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Some(RuntimeBundle {
        platform_id: "macos-x64",
        archive_name: "llama-b10516-bin-macos-x64.tar.gz",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-macos-x64.tar.gz",
        sha256: "b7adecf7bd2cde577ddabee8357a72409165d8104f43b4acee9f1b98cc9c447a",
        size: 11_395_897,
        archive_kind: ArchiveKind::TarGz,
    });

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Some(RuntimeBundle {
        platform_id: "linux-arm64",
        archive_name: "llama-b10516-bin-ubuntu-arm64.tar.gz",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-ubuntu-arm64.tar.gz",
        sha256: "e7491dca79c9799fc3ae169675a79f5777d3027e31ffb08ae679e5e0a7ae3c97",
        size: 13_529_264,
        archive_kind: ArchiveKind::TarGz,
    });

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some(RuntimeBundle {
        platform_id: "linux-x64",
        archive_name: "llama-b10516-bin-ubuntu-x64.tar.gz",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-ubuntu-x64.tar.gz",
        sha256: "f263a91280471b4c33c4999d7c76259c0f3a0a53a0b3e692b2c0b84380137a35",
        size: 16_667_775,
        archive_kind: ArchiveKind::TarGz,
    });

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return Some(RuntimeBundle {
        platform_id: "windows-arm64",
        archive_name: "llama-b10516-bin-win-cpu-arm64.zip",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-win-cpu-arm64.zip",
        sha256: "4b136692ab17009722e350d5bb8e5905f9af6bcd43d2897f0655186a9cc65db6",
        size: 12_256_210,
        archive_kind: ArchiveKind::Zip,
    });

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Some(RuntimeBundle {
        platform_id: "windows-x64",
        archive_name: "llama-b10516-bin-win-cpu-x64.zip",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10516/llama-b10516-bin-win-cpu-x64.zip",
        sha256: "fbbbc55e0eb2e1b07f9dcb9488616c98ed47d9003b90e15e7c8c7812c4307cd3",
        size: 18_506_923,
        archive_kind: ArchiveKind::Zip,
    });

    #[allow(unreachable_code)]
    None
}

fn runtime_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

fn local_llm_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::storage_paths::llm_models_dir(app)
        .map_err(|error| format!("Failed to resolve the local LLM model folder: {error}"))
}

pub fn preferred_llm_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(external) = external_model_storage::cached_external_root() {
        return Ok(external.join("llm"));
    }
    local_llm_root(app)
}

fn model_roots(app: &AppHandle) -> Result<Vec<(PathBuf, ModelStorageLocation)>, String> {
    let mut roots = vec![(local_llm_root(app)?, ModelStorageLocation::Local)];
    if let Some(external) = external_model_storage::cached_external_root() {
        let external = external.join("llm");
        if !roots.iter().any(|(root, _)| root == &external) {
            roots.push((external, ModelStorageLocation::External));
        }
    }
    Ok(roots)
}

fn safe_relative_id(relative_path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in relative_path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| format!("gguf:{}", parts.join("/")))
}

fn relative_path_from_id(model_id: &str) -> Option<PathBuf> {
    let raw = model_id.strip_prefix("gguf:")?;
    let mut relative = PathBuf::new();
    for component in Path::new(raw).components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!relative.as_os_str().is_empty()).then_some(relative)
}

fn title_from_path(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Local GGUF");
    stem.replace(['_', '-'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn collect_gguf_files(root: &Path, path: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_DISCOVERY_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "__MACOSX" || name == "runtime" {
            continue;
        }
        let child = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_gguf_files(root, &child, depth + 1, out);
        } else if file_type.is_file()
            && child
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("gguf"))
            && child.starts_with(root)
        {
            out.push(child);
        }
    }
}

pub fn discover_models(app: &AppHandle) -> Result<Vec<LocalGgufModel>, String> {
    let mut models = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut next_cache = HashMap::new();

    for (root, storage_location) in model_roots(app)? {
        if !root.is_dir() {
            continue;
        }
        let mut files = Vec::new();
        collect_gguf_files(&root, &root, 0, &mut files);
        files.sort();
        for path in files {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            if metadata.len() == 0 {
                continue;
            }
            let Ok(relative_path) = path.strip_prefix(&root).map(Path::to_path_buf) else {
                continue;
            };
            let known_id = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(crate::refine_models::runtime_model_id_for_hf_file_name)
                .map(str::to_string);
            let Some(runtime_model_id) = known_id.or_else(|| safe_relative_id(&relative_path))
            else {
                continue;
            };
            if !seen_ids.insert(runtime_model_id.clone()) {
                continue;
            }
            next_cache.insert(runtime_model_id.clone(), path.clone());
            models.push(LocalGgufModel {
                runtime_model_id,
                title: title_from_path(&path),
                path,
                relative_path,
                storage_location,
                file_size_bytes: metadata.len(),
            });
        }
    }

    *MODEL_PATHS
        .write()
        .unwrap_or_else(|error| error.into_inner()) = next_cache;
    Ok(models)
}

pub fn remember_model_path(model_id: &str, path: PathBuf) {
    MODEL_PATHS
        .write()
        .unwrap_or_else(|error| error.into_inner())
        .insert(model_id.to_string(), path);
}

pub fn runtime_model_id_for_path(app: &AppHandle, path: &Path) -> Result<String, String> {
    if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
        if let Some(known) = crate::refine_models::runtime_model_id_for_hf_file_name(file_name) {
            remember_model_path(known, path.to_path_buf());
            return Ok(known.to_string());
        }
    }
    for (root, _) in model_roots(app)? {
        if let Ok(relative) = path.strip_prefix(&root) {
            if let Some(id) = safe_relative_id(relative) {
                remember_model_path(&id, path.to_path_buf());
                return Ok(id);
            }
        }
    }
    Err("The GGUF model is outside Vox Jot's managed local/external LLM folders.".to_string())
}

pub fn resolve_model_path(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    if let Some(cached) = MODEL_PATHS
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .get(model_id)
        .filter(|path| path.is_file())
        .cloned()
    {
        return Ok(cached);
    }

    if let Some(relative) = relative_path_from_id(model_id) {
        for (root, _) in model_roots(app)? {
            let candidate = root.join(&relative);
            if candidate.is_file() && fs::metadata(&candidate).is_ok_and(|meta| meta.len() > 0) {
                remember_model_path(model_id, candidate.clone());
                return Ok(candidate);
            }
        }
    }

    let models = discover_models(app)?;
    models
        .into_iter()
        .find(|model| model.runtime_model_id == model_id)
        .map(|model| model.path)
        .ok_or_else(|| {
            format!(
                "Local GGUF model '{model_id}' is unavailable. Reconnect its external drive or choose another refine model."
            )
        })
}

fn runtime_base_dir(app: &AppHandle, prefer_external: bool) -> Result<PathBuf, String> {
    let llm_root = if prefer_external {
        preferred_llm_root(app)?
    } else {
        local_llm_root(app)?
    };
    let bundle = runtime_bundle().ok_or_else(|| {
        "Vox Jot Local does not yet have a llama.cpp runtime for this platform.".to_string()
    })?;
    Ok(llm_root
        .join("runtime")
        .join("llama.cpp")
        .join(RUNTIME_VERSION)
        .join(bundle.platform_id))
}

fn find_runtime_executable_in(base: &Path) -> Option<PathBuf> {
    let direct = base.join(runtime_executable_name());
    if direct.is_file() {
        return Some(direct);
    }
    let nested = base.join(format!("llama-{RUNTIME_VERSION}"));
    let nested_binary = nested.join(runtime_executable_name());
    nested_binary.is_file().then_some(nested_binary)
}

pub fn runtime_executable(app: &AppHandle) -> Option<(PathBuf, ModelStorageLocation)> {
    if let Ok(local) = runtime_base_dir(app, false) {
        if let Some(binary) = find_runtime_executable_in(&local) {
            return Some((binary, ModelStorageLocation::Local));
        }
    }
    let external_root = external_model_storage::cached_external_root()?;
    let external_llm = external_root.join("llm");
    let bundle = runtime_bundle()?;
    let base = external_llm
        .join("runtime")
        .join("llama.cpp")
        .join(RUNTIME_VERSION)
        .join(bundle.platform_id);
    find_runtime_executable_in(&base).map(|binary| (binary, ModelStorageLocation::External))
}

pub fn runtime_installed(app: &AppHandle) -> bool {
    runtime_executable(app).is_some()
}

pub fn runtime_running() -> bool {
    let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
    let Some(child) = process.child.as_mut() else {
        return false;
    };
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => {
            process.child = None;
            process.model_path = None;
            process.port = None;
            false
        }
    }
}

fn extract_zip(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path)
        .map_err(|error| format!("Failed to open llama.cpp archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Failed to read llama.cpp archive: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read llama.cpp archive entry: {error}"))?;
        let Some(relative) = entry.enclosed_name() else {
            return Err("The llama.cpp archive contained an unsafe path.".to_string());
        };
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|error| format!("Failed to create runtime directory: {error}"))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create runtime directory: {error}"))?;
        }
        let mut output_file = fs::File::create(&output)
            .map_err(|error| format!("Failed to create runtime file: {error}"))?;
        std::io::copy(&mut entry, &mut output_file)
            .map_err(|error| format!("Failed to extract runtime file: {error}"))?;
    }
    Ok(())
}

fn extract_tar_gz(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path)
        .map_err(|error| format!("Failed to open llama.cpp archive: {error}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(destination)
        .map_err(|error| format!("Failed to extract llama.cpp runtime: {error}"))
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|error| format!("Failed to inspect runtime permissions: {error}"))?
            .permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("Failed to make llama-server executable: {error}"))?;
    }
    Ok(())
}

pub async fn ensure_runtime_installed(
    app: &AppHandle,
    progress_model_id: &str,
    cancel_flag: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    let _install_guard = INSTALL_LOCK.lock().await;
    if let Some((binary, _)) = runtime_executable(app) {
        return Ok(binary);
    }
    let bundle = runtime_bundle().ok_or_else(|| {
        "Vox Jot Local does not yet have a llama.cpp runtime for this platform.".to_string()
    })?;
    let base = runtime_base_dir(app, true)?;
    let downloads = base.join(".downloads");
    tokio::fs::create_dir_all(&downloads)
        .await
        .map_err(|error| format!("Failed to create the local LLM runtime folder: {error}"))?;
    let archive_path = downloads.join(bundle.archive_name);
    let partial_path = downloads.join(format!("{}.partial", bundle.archive_name));
    let progress_app = app.clone();
    let event_model_id = progress_model_id.to_string();
    let progress = Arc::new(
        move |progress: crate::artifact_download::ArtifactProgress| {
            crate::artifact_download::emit_artifact_progress(&progress_app, progress.clone());
            let _ = progress_app.emit(
            "refine-download-progress",
            serde_json::json!({
                "model_id": event_model_id,
                "downloaded": progress.downloaded_bytes,
                "total": progress.total_bytes,
                "percentage": progress.percentage,
                "stage": if progress.phase == "complete" { "installing_runtime" } else { "downloading_runtime" },
            }),
        );
        },
    );
    crate::artifact_download::download_file(crate::artifact_download::FileDownloadOptions {
        domain: "refine-runtime".to_string(),
        artifact_id: format!("llama.cpp-{RUNTIME_VERSION}-{}", bundle.platform_id),
        url: bundle.url.to_string(),
        partial_path,
        final_path: archive_path.clone(),
        expected_sha256: Some(bundle.sha256.to_string()),
        expected_size: Some(bundle.size),
        bearer_token: None,
        cancel_flag: Some(cancel_flag.clone()),
        progress: Some(progress),
    })
    .await?;
    if cancel_flag.load(Ordering::Relaxed) {
        return Err(crate::artifact_download::DOWNLOAD_CANCELLED_MESSAGE.to_string());
    }

    let extraction_root = base.join(format!(".extracting-{}", uuid::Uuid::new_v4()));
    let archive_kind = bundle.archive_kind;
    let archive_for_task = archive_path.clone();
    let extraction_for_task = extraction_root.clone();
    tokio::task::spawn_blocking(move || {
        fs::create_dir_all(&extraction_for_task)
            .map_err(|error| format!("Failed to create runtime extraction folder: {error}"))?;
        match archive_kind {
            ArchiveKind::TarGz => extract_tar_gz(&archive_for_task, &extraction_for_task),
            ArchiveKind::Zip => extract_zip(&archive_for_task, &extraction_for_task),
        }
    })
    .await
    .map_err(|error| format!("llama.cpp extraction task failed: {error}"))??;

    let extracted_binary = find_runtime_executable_in(&extraction_root)
        .ok_or_else(|| "The llama.cpp archive did not contain llama-server.".to_string())?;
    let extracted_root = extracted_binary
        .parent()
        .ok_or_else(|| "The llama.cpp runtime layout is invalid.".to_string())?;
    let final_root = base.join(format!("llama-{RUNTIME_VERSION}"));
    if final_root.exists() {
        fs::remove_dir_all(&final_root)
            .map_err(|error| format!("Failed to replace the incomplete runtime: {error}"))?;
    }
    fs::rename(extracted_root, &final_root)
        .map_err(|error| format!("Failed to finish installing llama.cpp: {error}"))?;
    let _ = fs::remove_dir_all(&extraction_root);
    let _ = fs::remove_file(&archive_path);
    let binary = final_root.join(runtime_executable_name());
    make_executable(&binary)?;
    fs::write(
        final_root.join("vox-jot-runtime.json"),
        format!(
            "{{\"runtime\":\"llama.cpp\",\"version\":\"{RUNTIME_VERSION}\",\"platform\":\"{}\",\"sha256\":\"{}\"}}\n",
            bundle.platform_id, bundle.sha256
        ),
    )
    .map_err(|error| format!("Failed to write the runtime receipt: {error}"))?;
    Ok(binary)
}

fn stop_process_locked(process: &mut RuntimeProcess) {
    if let Some(mut child) = process.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    process.model_path = None;
    process.port = None;
}

fn allocate_loopback_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("Failed to reserve a local LLM port: {error}"))
}

fn spawn_server(binary: &Path, model_path: &Path, port: u16) -> Result<Child, String> {
    let runtime_dir = binary
        .parent()
        .ok_or_else(|| "The llama.cpp runtime folder is invalid.".to_string())?;
    let logs_dir = runtime_dir.join("logs");
    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("Failed to create the local LLM log folder: {error}"))?;
    let log_path = logs_dir.join("llama-server.log");
    let stdout = fs::File::create(&log_path)
        .map_err(|error| format!("Failed to create the llama.cpp log: {error}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("Failed to prepare the llama.cpp log: {error}"))?;

    let mut command = Command::new(binary);
    command
        .current_dir(runtime_dir)
        .arg("--model")
        .arg(model_path)
        .arg("--alias")
        .arg(SERVER_ALIAS)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--cors-origins")
        .arg("localhost")
        .arg("--no-ui")
        .arg("--ctx-size")
        .arg("4096")
        .arg("--parallel")
        .arg("1")
        .arg("--reasoning")
        .arg("off")
        .arg("--jinja")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(target_os = "macos")]
    {
        command.arg("--n-gpu-layers").arg("99");
        command.env("DYLD_LIBRARY_PATH", runtime_dir);
    }
    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", runtime_dir);

    command.spawn().map_err(|error| {
        format!(
            "Failed to start Vox Jot Local from '{}': {error}",
            binary.display()
        )
    })
}

async fn server_healthy(port: u16) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    client
        .get(format!("http://127.0.0.1:{port}/health"))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

fn process_matches_and_running(model_path: &Path) -> Option<u16> {
    let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
    if process.model_path.as_deref() != Some(model_path) {
        return None;
    }
    let running = process
        .child
        .as_mut()
        .is_some_and(|child| child.try_wait().is_ok_and(|status| status.is_none()));
    if running {
        process.port
    } else {
        stop_process_locked(&mut process);
        None
    }
}

fn schedule_idle_shutdown() {
    let generation = USE_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    tokio::spawn(async move {
        tokio::time::sleep(RUNTIME_IDLE_TIMEOUT).await;
        if USE_GENERATION.load(Ordering::Relaxed) == generation {
            let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
            stop_process_locked(&mut process);
            log::info!("Stopped idle Vox Jot Local LLM runtime");
        }
    });
}

pub async fn ensure_server(app: &AppHandle, model_id: &str) -> Result<LocalServerEndpoint, String> {
    let _start_guard = START_LOCK.lock().await;
    let model_path = resolve_model_path(app, model_id)?;
    if let Some(port) = process_matches_and_running(&model_path) {
        if server_healthy(port).await {
            schedule_idle_shutdown();
            return Ok(LocalServerEndpoint {
                base_url: format!("http://127.0.0.1:{port}/v1"),
                model_alias: SERVER_ALIAS,
            });
        }
    }

    let binary = runtime_executable(app)
        .map(|(path, _)| path)
        .ok_or_else(|| "Set up the Vox Jot Local runtime before using this model.".to_string())?;
    let port = allocate_loopback_port()?;
    {
        let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
        stop_process_locked(&mut process);
        process.child = Some(spawn_server(&binary, &model_path, port)?);
        process.model_path = Some(model_path.clone());
        process.port = Some(port);
    }

    let started = std::time::Instant::now();
    loop {
        if server_healthy(port).await {
            log::info!(
                "Vox Jot Local loaded '{}' from {} in {:?}",
                model_id,
                model_path.display(),
                started.elapsed()
            );
            schedule_idle_shutdown();
            return Ok(LocalServerEndpoint {
                base_url: format!("http://127.0.0.1:{port}/v1"),
                model_alias: SERVER_ALIAS,
            });
        }
        {
            let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(child) = process.child.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    let log_path = binary
                        .parent()
                        .map(|parent| parent.join("logs/llama-server.log"));
                    stop_process_locked(&mut process);
                    return Err(format!(
                        "Vox Jot Local stopped while loading the model ({status}). See {}.",
                        log_path
                            .as_deref()
                            .map(|path| path.display().to_string())
                            .unwrap_or_else(|| "the app log".to_string())
                    ));
                }
            }
        }
        if started.elapsed() >= SERVER_START_TIMEOUT {
            let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
            stop_process_locked(&mut process);
            return Err(format!(
                "Vox Jot Local did not finish loading '{}' within {} seconds.",
                model_id,
                SERVER_START_TIMEOUT.as_secs()
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub async fn warm_selected_model(app: &AppHandle) -> Result<(), String> {
    let settings = crate::settings::get_settings(app);
    if !settings.post_process_enabled || settings.post_process_provider_id != PROVIDER_ID {
        return Ok(());
    }
    let Some(model_id) = settings
        .post_process_models
        .get(PROVIDER_ID)
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(());
    };
    ensure_server(app, model_id).await.map(|_| ())
}

pub fn stop_if_external_model() {
    let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
    let is_external = process.model_path.as_deref().is_some_and(|path| {
        path.starts_with("/Volumes") || path.starts_with("/media") || path.starts_with("/mnt")
    });
    if is_external {
        stop_process_locked(&mut process);
        log::info!("Stopped Vox Jot Local because its external model drive disconnected");
    }
}

pub fn shutdown() {
    USE_GENERATION.fetch_add(1, Ordering::Relaxed);
    let mut process = PROCESS.lock().unwrap_or_else(|error| error.into_inner());
    stop_process_locked(&mut process);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_model_ids_reject_path_traversal() {
        assert!(relative_path_from_id("gguf:../secret.gguf").is_none());
        assert!(relative_path_from_id("gguf:/absolute/model.gguf").is_none());
        assert_eq!(
            relative_path_from_id("gguf:qwen/model.gguf"),
            Some(PathBuf::from("qwen/model.gguf"))
        );
    }

    #[test]
    fn discovery_ignores_hidden_cache_and_symlinks() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("model")).unwrap();
        fs::create_dir_all(root.join(".cache")).unwrap();
        fs::write(root.join("model/weights.gguf"), b"weights").unwrap();
        fs::write(root.join(".cache/duplicate.gguf"), b"weights").unwrap();
        let mut files = Vec::new();
        collect_gguf_files(root, root, 0, &mut files);
        assert_eq!(files, vec![root.join("model/weights.gguf")]);
    }

    #[test]
    fn current_platform_runtime_is_checksum_pinned_when_supported() {
        if let Some(bundle) = runtime_bundle() {
            assert_eq!(bundle.sha256.len(), 64);
            assert!(bundle.size > 10_000_000);
            assert!(bundle.url.contains(RUNTIME_VERSION));
        }
    }
}
