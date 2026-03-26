use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use log::{info, warn};
use tauri::AppHandle;

use crate::settings::{default_tts_model_store_dir, get_settings};

const DEFAULT_SPEECH_RUNTIME_PATHS: &[&str] = &[
    "Library/Mobile Documents/com~apple~CloudDocs/Apps/Speech",
    "Apps/Speech",
];
const SIDECAR_PORT: u16 = 8008;
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 3;

pub struct SidecarManager {
    app_handle: AppHandle,
    child: Mutex<Option<std::process::Child>>,
}

impl SidecarManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            child: Mutex::new(None),
        }
    }

    fn normalize_runtime_root(path: &Path) -> Option<PathBuf> {
        if path.join("runtime").join("app.py").exists() {
            return Some(path.to_path_buf());
        }

        if path.join("app.py").exists() && path.file_name().is_some_and(|name| name == "runtime") {
            return path.parent().map(|parent| parent.to_path_buf());
        }

        if let Ok(entries) = path.read_dir() {
            for entry in entries.flatten() {
                let child = entry.path();
                if child.is_dir() && child.join("runtime").join("app.py").exists() {
                    return Some(child);
                }
            }
        }

        None
    }

    fn managed_runtime_path(&self) -> Option<PathBuf> {
        let base_dir = crate::portable::app_data_dir(&self.app_handle)
            .ok()?
            .join("tts-runtime");
        if !base_dir.exists() {
            return None;
        }

        Self::normalize_runtime_root(&base_dir).or_else(|| {
            base_dir
                .read_dir()
                .ok()?
                .filter_map(Result::ok)
                .find_map(|entry| Self::normalize_runtime_root(&entry.path()))
        })
    }

    fn runtime_python_path(runtime_root: &Path) -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        let candidates = [
            runtime_root
                .join("runtime")
                .join(".venv")
                .join("Scripts")
                .join("python.exe"),
            runtime_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe"),
            runtime_root.join("venv").join("Scripts").join("python.exe"),
        ];

        #[cfg(not(target_os = "windows"))]
        let candidates = [
            runtime_root
                .join("runtime")
                .join(".venv")
                .join("bin")
                .join("python"),
            runtime_root.join(".venv").join("bin").join("python"),
            runtime_root.join("venv").join("bin").join("python"),
        ];

        candidates.into_iter().find(|candidate| candidate.exists())
    }

    fn resolve_runtime_path(&self) -> Option<PathBuf> {
        let settings = get_settings(&self.app_handle);
        if let Some(ref custom_path) = settings.speech_runtime_path {
            if !custom_path.trim().is_empty() {
                let path = PathBuf::from(custom_path);
                if let Some(runtime_root) = Self::normalize_runtime_root(&path) {
                    return Some(runtime_root);
                }
                warn!(
                    "Custom speech_runtime_path '{}' does not contain a valid Speech runtime",
                    custom_path
                );
            }
        }

        if let Some(runtime_root) = self.managed_runtime_path() {
            return Some(runtime_root);
        }

        let home = dirs::home_dir()?;
        for relative_path in DEFAULT_SPEECH_RUNTIME_PATHS {
            let candidate = home.join(relative_path);
            if let Some(runtime_root) = Self::normalize_runtime_root(&candidate) {
                return Some(runtime_root);
            }
        }

        None
    }

    pub fn can_auto_start(&self) -> bool {
        self.resolve_runtime_path().is_some()
    }

    pub fn is_running(&self) -> bool {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(HEALTH_CHECK_TIMEOUT_SECS))
            .build();
        match client {
            Ok(client) => client
                .get(format!("http://127.0.0.1:{}/health", SIDECAR_PORT))
                .send()
                .map(|resp| resp.status().is_success())
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    pub fn ensure_running(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        let runtime_path = self
            .resolve_runtime_path()
            .ok_or("Speech runtime is not installed yet.")?;

        let venv_python = Self::runtime_python_path(&runtime_path).ok_or_else(|| {
            format!(
                "Speech runtime Python environment is missing from {}",
                runtime_path.display()
            )
        })?;
        if !venv_python.exists() {
            return Err(format!(
                "Speech runtime venv not found at {}",
                venv_python.display()
            ));
        }

        info!(
            "Starting Speech runtime sidecar from {}",
            runtime_path.display()
        );

        let settings = get_settings(&self.app_handle);
        let model_store_path = settings
            .tts_model_store_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| default_tts_model_store_dir(&self.app_handle));
        let app_data_dir = crate::portable::app_data_dir(&self.app_handle)
            .map_err(|err| format!("Failed to resolve app data dir for Speech runtime: {err}"))?;
        let runtime_state_dir = app_data_dir.join("speech-runtime");
        let voice_profiles_dir = app_data_dir.join("tts").join("profiles");

        let child = Command::new(&venv_python)
            .args(["-m", "runtime.app"])
            .current_dir(&runtime_path)
            .env("SPEECH_RUNTIME_PORT", SIDECAR_PORT.to_string())
            .env("SPEECH_MODEL_STORE", model_store_path)
            .env("SPEECH_RUNTIME_STATE_DIR", runtime_state_dir)
            .env("SPEECH_VOICE_PROFILES_DIR", voice_profiles_dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|err| format!("Failed to start Speech runtime: {err}"))?;

        {
            let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(child);
        }

        // Wait for the server to become healthy
        for attempt in 0..20 {
            std::thread::sleep(Duration::from_millis(500));
            if self.is_running() {
                info!(
                    "Speech runtime sidecar is healthy (attempt {})",
                    attempt + 1
                );
                return Ok(());
            }
        }

        // Check if process died
        {
            let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(ref mut child) = *guard {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let stderr = child
                            .stderr
                            .take()
                            .map(|mut stderr| {
                                use std::io::Read;
                                let mut buf = String::new();
                                let _ = stderr.read_to_string(&mut buf);
                                buf
                            })
                            .unwrap_or_default();
                        *guard = None;
                        return Err(format!(
                            "Speech runtime exited with {status}. Stderr: {}",
                            stderr.chars().take(500).collect::<String>()
                        ));
                    }
                    _ => {}
                }
            }
        }

        Err("Speech runtime started but did not become healthy within 10 seconds.".to_string())
    }

    pub fn ensure_running_if_available(&self) -> Result<bool, String> {
        if self.is_running() {
            return Ok(true);
        }

        if !self.can_auto_start() {
            return Ok(false);
        }

        self.ensure_running()?;
        Ok(true)
    }

    pub fn stop(&self) {
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut child) = guard.take() {
            info!("Stopping Speech runtime sidecar");
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.stop();
    }
}
