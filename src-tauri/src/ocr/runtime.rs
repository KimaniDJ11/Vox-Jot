//! Dedicated Python runtime executor for OCR models.
//!
//! Spawns isolated Python inference processes with external-cache isolation,
//! concurrent pipe draining to prevent deadlocks, timeout guards, and
//! cooperative cancellation support via `OcrTicket`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use log::{info, warn};
use serde::Deserialize;
use tauri::AppHandle;

use crate::ocr::{OcrResult, OcrTicket};
use crate::portable::app_data_dir;

const OCR_PROCESS_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RunnerResponse {
    status: String,
    text: Option<String>,
    device: Option<String>,
    load_duration_ms: Option<u64>,
    inference_duration_ms: Option<u64>,
    peak_rss_mb: Option<f64>,
    mps_allocated_mb: Option<f64>,
    mps_driver_allocated_mb: Option<f64>,
    message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OcrRuntime {
    app: AppHandle,
}

impl OcrRuntime {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    /// Resolves the Python interpreter capable of running torch / vision-language models.
    pub fn resolve_python_path(&self) -> Option<PathBuf> {
        // 1. Explicit override via environment variable
        for env_var in ["OCR_RUNTIME_PYTHON", "VOXJOT_OCR_PYTHON"] {
            if let Ok(custom) = std::env::var(env_var) {
                let p = PathBuf::from(custom.trim());
                if p.is_file() {
                    return Some(p);
                }
            }
        }

        // 2. Vox Jot app-data managed runtimes and venvs
        if let Ok(app_dir) = app_data_dir(&self.app) {
            let app_candidates = [
                // Standalone relocatable ocr-runtime bundle
                app_dir.join("models/ocr-runtime/macos-aarch64/.python/bin/python3"),
                app_dir.join("models/ocr-runtime/macos-aarch64/.python/bin/python"),
                // Speech analysis venv (includes torch + torchvision + transformers)
                app_dir.join("speech-analysis-venv/bin/python3"),
                app_dir.join("speech-analysis-venv/bin/python"),
                // Gemma audio venv (includes torch + torchvision + transformers)
                app_dir.join("gemma-audio-venv/bin/python3"),
                app_dir.join("gemma-audio-venv/bin/python"),
                // MLX audio venv
                app_dir.join("mlx-audio-venv/bin/python3"),
                app_dir.join("mlx-audio-venv/bin/python"),
                // Dedicated ocr-runtime venv
                app_dir.join("runtimes/ocr-runtime/bin/python3"),
            ];

            for candidate in &app_candidates {
                if candidate.is_file() {
                    return Some(candidate.clone());
                }
            }
        }

        // 3. Workspace dev venvs
        let dev_candidates = [
            PathBuf::from("ocr-runtime/.venv/bin/python3"),
            PathBuf::from("../ocr-runtime/.venv/bin/python3"),
            PathBuf::from(".venv/bin/python3"),
        ];

        for path in &dev_candidates {
            if path.is_file() {
                if let Ok(canonical) = fs::canonicalize(path) {
                    return Some(canonical);
                }
                return Some(path.clone());
            }
        }

        // 4. System fallbacks
        for sys_path in [
            PathBuf::from("/opt/homebrew/bin/python3"),
            PathBuf::from("/usr/local/bin/python3"),
            PathBuf::from("/usr/bin/python3"),
        ] {
            if sys_path.is_file() {
                return Some(sys_path);
            }
        }

        if Command::new("python3").arg("--version").output().is_ok() {
            return Some(PathBuf::from("python3"));
        }

        None
    }

    /// Resolves the path to `jina_ocr_runner.py`.
    pub fn resolve_runner_script(&self) -> Option<PathBuf> {
        let candidates = [
            PathBuf::from("resources/python/jina_ocr_runner.py"),
            PathBuf::from("src-tauri/resources/python/jina_ocr_runner.py"),
            PathBuf::from("../src-tauri/resources/python/jina_ocr_runner.py"),
        ];

        for path in &candidates {
            if path.is_file() {
                if let Ok(canonical) = fs::canonicalize(path) {
                    return Some(canonical);
                }
                return Some(path.clone());
            }
        }

        None
    }

    /// Kills a running child process and its process group cleanly.
    fn terminate_child(child: &mut std::process::Child) {
        #[cfg(unix)]
        {
            let pid = child.id();
            let _ = Command::new("kill")
                .arg("-9")
                .arg(format!("-{pid}"))
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Executes Jina OCR inference with cooperative ticket cancellation,
    /// deadlock-free stream draining, and process reaping.
    pub fn execute_jina(
        &self,
        model_dir: &Path,
        image_path: &Path,
        ticket: &OcrTicket,
    ) -> Result<OcrResult, String> {
        if ticket.is_cancelled() {
            return Err("OCR request was cancelled before starting.".to_string());
        }

        if !model_dir.is_dir() {
            return Err("Jina OCR model drive is not available.".to_string());
        }

        let python = self
            .resolve_python_path()
            .ok_or_else(|| "No compatible Python interpreter found for OCR runtime.".to_string())?;
        let runner = self
            .resolve_runner_script()
            .ok_or_else(|| "OCR runner helper script not found.".to_string())?;

        // External cache isolation: parent of model directory contains .hf_home and .hf_cache
        let parent_dir = model_dir.parent().unwrap_or(model_dir);
        let hf_home = parent_dir.join(".hf_home");
        let hf_cache = parent_dir.join(".hf_cache");

        info!(
            "Starting Jina OCR inference: python={}, runner={}, model={}",
            python.display(),
            runner.display(),
            model_dir.display()
        );

        let t_start = Instant::now();

        let mut command = Command::new(&python);
        command
            .arg(&runner)
            .arg("--model-dir")
            .arg(model_dir)
            .arg("--image")
            .arg(image_path)
            .arg("--device")
            .arg("auto")
            .env("HF_HOME", &hf_home)
            .env("HF_HUB_CACHE", &hf_cache)
            .env("TRANSFORMERS_OFFLINE", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        command.process_group(0);

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn OCR runner process: {e}"))?;

        // Pipe deadlock prevention: drain stdout and stderr concurrently in background threads
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture OCR stdout pipe.".to_string())?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture OCR stderr pipe.".to_string())?;

        let (stdout_tx, stdout_rx) = mpsc::channel::<String>();
        let (stderr_tx, stderr_rx) = mpsc::channel::<String>();

        let stdout_thread = thread::spawn(move || {
            let mut out = String::new();
            let _ = stdout.read_to_string(&mut out);
            let _ = stdout_tx.send(out);
        });

        let stderr_thread = thread::spawn(move || {
            let mut err = String::new();
            let _ = stderr.read_to_string(&mut err);
            let _ = stderr_tx.send(err);
        });

        // Polling loop with cooperative cancellation check and timeout
        let status = loop {
            if ticket.is_cancelled() {
                info!(
                    "OCR ticket #{} cancelled. Terminating runner process.",
                    ticket.request_id
                );
                Self::terminate_child(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("OCR request was cancelled by user.".to_string());
            }

            if t_start.elapsed() > OCR_PROCESS_TIMEOUT {
                warn!(
                    "OCR ticket #{} exceeded timeout of {:?}. Terminating.",
                    ticket.request_id, OCR_PROCESS_TIMEOUT
                );
                Self::terminate_child(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("OCR request timed out during inference.".to_string());
            }

            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(err) => {
                    Self::terminate_child(&mut child);
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    return Err(format!("Failed while waiting for OCR process: {err}"));
                }
            }
        };

        // Retrieve full stdout and stderr from draining threads
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        let stdout_str = stdout_rx.recv().unwrap_or_default();
        let stderr_str = stderr_rx.recv().unwrap_or_default();

        if !status.success() {
            warn!(
                "OCR runner process exited with status {}: {}",
                status, stderr_str
            );

            let err_lower = stderr_str.to_ascii_lowercase();
            if err_lower.contains("no such file or directory")
                || err_lower.contains("input/output error")
                || err_lower.contains("model directory not found")
                || !model_dir.exists()
            {
                return Err("Jina OCR model drive is not available.".to_string());
            }

            return Err(if !stderr_str.trim().is_empty() {
                stderr_str
            } else if !stdout_str.trim().is_empty() {
                stdout_str
            } else {
                format!("OCR runner process failed with exit code {}", status)
            });
        }

        // Parse JSON output
        let response: RunnerResponse = serde_json::from_str(stdout_str.trim()).map_err(|e| {
            format!(
                "Failed to parse OCR runner JSON response: {e}\nRaw output: {}",
                stdout_str
            )
        })?;

        if response.status != "success" {
            let msg = response
                .message
                .unwrap_or_else(|| "OCR recognition returned failure status.".to_string());
            if msg.contains("Model directory not found") {
                return Err("Jina OCR model drive is not available.".to_string());
            }
            return Err(msg);
        }

        let recognized_text = response.text.unwrap_or_default();
        let elapsed_ms = t_start.elapsed().as_millis() as u64;
        let device = response.device.unwrap_or_else(|| "unknown".to_string());

        Ok(OcrResult {
            text: recognized_text,
            engine: "jina-ocr-v1".to_string(),
            elapsed_ms,
            device,
            peak_rss_mb: response.peak_rss_mb,
            mps_allocated_mb: response.mps_allocated_mb,
            mps_driver_allocated_mb: response.mps_driver_allocated_mb,
        })
    }
}
