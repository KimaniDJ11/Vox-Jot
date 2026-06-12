//! Neural denoiser runtime (DeepFilterNet) — the SOTA, full-band 48 kHz engine
//! for Enhance Audio. DeepFilterNet's only practical distribution is PyTorch, so
//! this runs it through a Python sidecar using the same on-demand runtime
//! bootstrap as the Reader extractor (Homebrew-first interpreter + a managed
//! `venv` created with `--clear`). The runtime is installed lazily the first time
//! the user selects this engine; RNNoise and spectral subtraction stay native and
//! need none of this.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;
use specta::Type;
use tauri::AppHandle;

// Bump the version string to force a clean reinstall when the package set changes.
const DENOISE_RUNTIME_VERSION: &str =
    "denoise-runtime-v2|torch==2.2.2|torchaudio==2.2.2|deepfilternet[soundfile]==0.5.6";
#[cfg(any(target_os = "linux", target_os = "windows"))]
const DENOISE_TORCH_PACKAGES: &[&str] = &["torch==2.2.2+cpu", "torchaudio==2.2.2+cpu"];
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
const DENOISE_TORCH_PACKAGES: &[&str] = &["torch==2.2.2", "torchaudio==2.2.2"];
const DENOISE_RUNTIME_PACKAGES: &[&str] = &["deepfilternet[soundfile]==0.5.6"];
const DENOISE_MODEL_WARMUP: &str =
    "from df.enhance import init_df\ninit_df(log_level='ERROR', log_file=None)\n";
const DENOISE_SETUP_CANCELLED_MESSAGE: &str = "DeepFilterNet setup cancelled.";
static ACTIVE_DENOISE_SETUP: Lazy<Mutex<Option<Arc<AtomicBool>>>> = Lazy::new(|| Mutex::new(None));

#[derive(Serialize, Type)]
pub struct DenoiseRuntimeStatus {
    /// Whether the DeepFilterNet runtime is installed and ready.
    pub installed: bool,
}

fn venv_python_path(venv_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

fn python_from_env(variable: &str) -> Option<PathBuf> {
    let custom = std::env::var(variable).ok()?;
    let path = PathBuf::from(custom);
    path.is_file().then_some(path)
}

fn python_version_supported(path: &Path) -> bool {
    Command::new(path)
        .arg("-c")
        .arg("import sys; raise SystemExit(0 if (3, 8) <= sys.version_info[:2] <= (3, 11) else 1)")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

// Prefer a Homebrew/framework Python. A uv-managed standalone interpreter on PATH
// builds a broken venv (stdlib resolves to a build-time `/install` prefix), so the
// Reader/OCR/denoise sidecars all bootstrap from Homebrew first. (Mirrors
// `locate_reader_python`; see the Reader runtime notes.)
fn locate_bootstrap_python() -> Option<PathBuf> {
    for variable in ["VOX_JOT_DENOISE_PYTHON", "VOX_JOT_READER_PYTHON"] {
        if let Some(path) = python_from_env(variable) {
            if python_version_supported(&path) {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "macos")]
    for candidate in [
        "/opt/homebrew/bin/python3.11",
        "/opt/homebrew/opt/python@3.11/bin/python3.11",
        "/opt/homebrew/bin/python3.10",
        "/opt/homebrew/opt/python@3.10/bin/python3.10",
        "/usr/local/bin/python3.11",
        "/usr/local/bin/python3.10",
    ] {
        let path = PathBuf::from(candidate);
        if path.is_file() && python_version_supported(&path) {
            return Some(path);
        }
    }

    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["python.exe", "python"]
    } else {
        &[
            "python3.11",
            "python3.10",
            "python3.9",
            "python3.8",
            "python3",
            "python",
        ]
    };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for candidate in candidates {
            let exe = dir.join(candidate);
            if exe.is_file() && python_version_supported(&exe) {
                return Some(exe);
            }
        }
    }
    None
}

fn command_stderr_or_status(label: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        format!("{label}: {}", output.status)
    } else {
        format!("{label}: {stderr}")
    }
}

fn ensure_setup_not_cancelled(cancel_flag: Option<&Arc<AtomicBool>>) -> Result<(), String> {
    if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        Err(DENOISE_SETUP_CANCELLED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

fn spawn_pipe_reader<R>(
    reader: Option<R>,
    label: String,
    stream_name: &'static str,
) -> Option<JoinHandle<Result<Vec<u8>, String>>>
where
    R: Read + Send + 'static,
{
    reader.map(|mut reader| {
        thread::spawn(move || {
            let mut buffer = Vec::new();
            reader
                .read_to_end(&mut buffer)
                .map_err(|err| format!("Failed to read {label} {stream_name}: {err}"))?;
            Ok(buffer)
        })
    })
}

fn join_pipe_reader(
    reader: Option<JoinHandle<Result<Vec<u8>, String>>>,
    label: &str,
    stream_name: &'static str,
) -> Result<Vec<u8>, String> {
    match reader {
        Some(handle) => handle
            .join()
            .map_err(|_| format!("{label} {stream_name} reader panicked"))?,
        None => Ok(Vec::new()),
    }
}

fn run_command_output_with_cancel(
    mut command: Command,
    label: &str,
    cancel_flag: Option<&Arc<AtomicBool>>,
) -> Result<std::process::Output, String> {
    ensure_setup_not_cancelled(cancel_flag)?;
    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to run {label}: {err}"))?;
    let mut stdout_reader = spawn_pipe_reader(child.stdout.take(), label.to_string(), "stdout");
    let mut stderr_reader = spawn_pipe_reader(child.stderr.take(), label.to_string(), "stderr");
    loop {
        if let Err(error) = ensure_setup_not_cancelled(cancel_flag) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = join_pipe_reader(stdout_reader.take(), label, "stdout");
            let _ = join_pipe_reader(stderr_reader.take(), label, "stderr");
            return Err(error);
        }
        match child
            .try_wait()
            .map_err(|err| format!("Failed to monitor {label}: {err}"))?
        {
            Some(status) => {
                let stdout_buf = join_pipe_reader(stdout_reader.take(), label, "stdout")?;
                let stderr_buf = join_pipe_reader(stderr_reader.take(), label, "stderr")?;
                return Ok(std::process::Output {
                    status,
                    stdout: stdout_buf,
                    stderr: stderr_buf,
                });
            }
            None => thread::sleep(Duration::from_millis(250)),
        }
    }
}

fn run_python_module(
    python: &Path,
    module: &str,
    args: &[&str],
    cancel_flag: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let mut command = Command::new(python);
    command
        .arg("-m")
        .arg(module)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = run_command_output_with_cancel(
        command,
        &format!("{} -m {module}", python.display()),
        cancel_flag,
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_stderr_or_status(
            &format!("Denoise runtime '{module}' step failed"),
            &output,
        ))
    }
}

fn run_python_code(
    python: &Path,
    label: &str,
    code: &str,
    cancel_flag: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let mut command = Command::new(python);
    command
        .arg("-c")
        .arg(code)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = run_command_output_with_cancel(
        command,
        &format!("{} -c <{label}>", python.display()),
        cancel_flag,
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_stderr_or_status(label, &output))
    }
}

fn runtime_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let runtime_dir = crate::storage_paths::denoise_runtime_dir(app)
        .map_err(|err| format!("Failed to resolve denoise runtime directory: {err}"))?;
    let venv_dir = runtime_dir.join(".venv");
    let marker = runtime_dir.join("denoise-runtime.version");
    Ok((runtime_dir, venv_dir, marker))
}

/// True when the venv interpreter exists and the version marker matches.
pub fn is_runtime_installed(app: &AppHandle) -> bool {
    if python_from_env("VOX_JOT_DENOISE_PYTHON").is_some() {
        return true;
    }
    let Ok((_, venv_dir, marker)) = runtime_paths(app) else {
        return false;
    };
    venv_python_path(&venv_dir).is_file()
        && fs::read_to_string(&marker)
            .map(|value| value.trim() == DENOISE_RUNTIME_VERSION)
            .unwrap_or(false)
}

/// Ensure the DeepFilterNet runtime exists, creating the venv and installing
/// packages on first use. Idempotent and fast once installed.
pub fn ensure_denoise_python(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_denoise_python_with_cancel(app, None)
}

fn ensure_denoise_python_with_cancel(
    app: &AppHandle,
    cancel_flag: Option<&Arc<AtomicBool>>,
) -> Result<PathBuf, String> {
    if let Some(path) = python_from_env("VOX_JOT_DENOISE_PYTHON") {
        return Ok(path);
    }

    let (runtime_dir, venv_dir, marker) = runtime_paths(app)?;
    let python = venv_python_path(&venv_dir);
    if python.is_file()
        && fs::read_to_string(&marker)
            .map(|value| value.trim() == DENOISE_RUNTIME_VERSION)
            .unwrap_or(false)
    {
        return Ok(python);
    }

    fs::create_dir_all(&runtime_dir).map_err(|err| {
        format!(
            "Failed to create denoise runtime directory '{}': {err}",
            runtime_dir.display()
        )
    })?;

    let bootstrap_python = locate_bootstrap_python().ok_or_else(|| {
        "Could not find a supported Python 3.8-3.11 interpreter to set up the DeepFilterNet runtime. Install Python 3.11 (e.g. `brew install python@3.11`) and try again.".to_string()
    })?;

    ensure_setup_not_cancelled(cancel_flag)?;
    // Always recreate with --clear so a partial/broken venv is recovered instead
    // of pip-installing into a dead interpreter.
    let mut venv_command = Command::new(&bootstrap_python);
    venv_command
        .arg("-m")
        .arg("venv")
        .arg("--clear")
        .arg(&venv_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = run_command_output_with_cancel(
        venv_command,
        &format!("{} -m venv", bootstrap_python.display()),
        cancel_flag,
    )?;
    if !output.status.success() {
        return Err(command_stderr_or_status(
            "DeepFilterNet runtime creation failed",
            &output,
        ));
    }

    run_python_module(
        &python,
        "pip",
        &["install", "--disable-pip-version-check", "--upgrade", "pip"],
        cancel_flag,
    )?;
    let mut torch_install_args = vec!["install", "--disable-pip-version-check", "--no-input"];
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    torch_install_args.extend([
        "-f",
        "https://download.pytorch.org/whl/cpu/torch_stable.html",
    ]);
    torch_install_args.extend(DENOISE_TORCH_PACKAGES.iter().copied());
    run_python_module(&python, "pip", &torch_install_args, cancel_flag)?;

    let mut install_args = vec!["install", "--disable-pip-version-check", "--no-input"];
    install_args.extend(DENOISE_RUNTIME_PACKAGES.iter().copied());
    run_python_module(&python, "pip", &install_args, cancel_flag)?;
    run_python_code(
        &python,
        "DeepFilterNet model warmup failed",
        DENOISE_MODEL_WARMUP,
        cancel_flag,
    )?;

    ensure_setup_not_cancelled(cancel_flag)?;
    fs::write(&marker, format!("{DENOISE_RUNTIME_VERSION}\n")).map_err(|err| {
        format!(
            "Failed to write denoise runtime marker '{}': {err}",
            marker.display()
        )
    })?;

    Ok(python)
}

fn resolve_sidecar(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("VOX_JOT_DENOISE_SIDECAR") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
    }
    crate::portable::resolve_resource(app, "resources/python/denoise_sidecar.py")
        .map_err(|err| format!("Failed to resolve DeepFilterNet sidecar: {err}"))
}

/// Run the DeepFilterNet sidecar on `input_wav`, writing the enhanced 48 kHz
/// result to `output_wav`. Installs the runtime first if needed.
pub fn run_deepfilternet(
    app: &AppHandle,
    input_wav: &Path,
    output_wav: &Path,
) -> Result<(), String> {
    let python = ensure_denoise_python(app)?;
    let sidecar = resolve_sidecar(app)?;

    let output = Command::new(&python)
        .arg(&sidecar)
        .arg("--input")
        .arg(input_wav)
        .arg("--output")
        .arg(output_wav)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("Failed to run DeepFilterNet sidecar: {err}"))?;

    if !output.status.success() {
        return Err(command_stderr_or_status(
            "DeepFilterNet enhancement failed",
            &output,
        ));
    }
    if !output_wav.is_file() {
        return Err("DeepFilterNet produced no output file.".to_string());
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn denoise_runtime_status(app: AppHandle) -> Result<DenoiseRuntimeStatus, String> {
    Ok(DenoiseRuntimeStatus {
        installed: is_runtime_installed(&app),
    })
}

/// Install (or repair) the DeepFilterNet runtime. Heavy and network-bound on the
/// first run (downloads PyTorch + the model), so the UI calls this explicitly
/// with a spinner before enabling the engine.
#[tauri::command]
#[specta::specta]
pub async fn prepare_denoise_runtime(app: AppHandle) -> Result<(), String> {
    if is_runtime_installed(&app) {
        return Ok(());
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut active = ACTIVE_DENOISE_SETUP
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if active.is_some() {
            return Err("DeepFilterNet setup is already running.".to_string());
        }
        *active = Some(Arc::clone(&cancel_flag));
    }

    let result = tokio::task::spawn_blocking(move || {
        ensure_denoise_python_with_cancel(&app, Some(&cancel_flag)).map(|_| ())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?;
    {
        let mut active = ACTIVE_DENOISE_SETUP
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        *active = None;
    }
    result
}

#[tauri::command]
#[specta::specta]
pub fn cancel_denoise_runtime_setup() -> Result<(), String> {
    let Some(cancel_flag) = ACTIVE_DENOISE_SETUP
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .as_ref()
        .cloned()
    else {
        return Ok(());
    };
    cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}
