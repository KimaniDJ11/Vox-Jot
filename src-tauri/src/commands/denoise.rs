//! Neural denoiser runtime (DeepFilterNet) — the SOTA, full-band 48 kHz engine
//! for Enhance Audio. DeepFilterNet's only practical distribution is PyTorch, so
//! this runs it through a Python sidecar using the same on-demand runtime
//! bootstrap as the Reader extractor (Homebrew-first interpreter + a managed
//! `venv` created with `--clear`). The runtime is installed lazily the first time
//! the user selects this engine; RNNoise and spectral subtraction stay native and
//! need none of this.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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

fn run_python_module(python: &Path, module: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(python)
        .arg("-m")
        .arg(module)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("Failed to run '{} -m {module}': {err}", python.display()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_stderr_or_status(
            &format!("Denoise runtime '{module}' step failed"),
            &output,
        ))
    }
}

fn run_python_code(python: &Path, label: &str, code: &str) -> Result<(), String> {
    let output = Command::new(python)
        .arg("-c")
        .arg(code)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("Failed to run '{} -c <{label}>': {err}", python.display()))?;
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

    // Always recreate with --clear so a partial/broken venv is recovered instead
    // of pip-installing into a dead interpreter.
    let output = Command::new(&bootstrap_python)
        .arg("-m")
        .arg("venv")
        .arg("--clear")
        .arg(&venv_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| {
            format!(
                "Failed to create denoise runtime with '{}': {err}",
                bootstrap_python.display()
            )
        })?;
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
    )?;
    let mut torch_install_args = vec!["install", "--disable-pip-version-check", "--no-input"];
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    torch_install_args.extend([
        "-f",
        "https://download.pytorch.org/whl/cpu/torch_stable.html",
    ]);
    torch_install_args.extend(DENOISE_TORCH_PACKAGES.iter().copied());
    run_python_module(&python, "pip", &torch_install_args)?;

    let mut install_args = vec!["install", "--disable-pip-version-check", "--no-input"];
    install_args.extend(DENOISE_RUNTIME_PACKAGES.iter().copied());
    run_python_module(&python, "pip", &install_args)?;
    run_python_code(
        &python,
        "DeepFilterNet model warmup failed",
        DENOISE_MODEL_WARMUP,
    )?;

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
    tokio::task::spawn_blocking(move || ensure_denoise_python(&app).map(|_| ()))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}
