use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use log::{info, warn};
use tauri::{AppHandle, Emitter};

use crate::settings::{default_tts_model_store_dir, get_settings};

const DEFAULT_SPEECH_RUNTIME_PATHS: &[&str] = &[
    "Library/Mobile Documents/com~apple~CloudDocs/Apps/Speech",
    "Apps/Speech",
];
const SIDECAR_PORT: u16 = 8008;
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 3;
const MLX_AUDIO_VENV_DIR: &str = "mlx-audio-venv";
const MLX_AUDIO_VERSION_MARKER: &str = "mlx-audio.version";
const MLX_AUDIO_PACKAGE_SPEC: &str = "mlx-audio==0.4.2";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SidecarBackend {
    LegacyPythonRuntime,
    MlxAudio,
}

pub struct SidecarManager {
    app_handle: AppHandle,
    child: Mutex<Option<std::process::Child>>,
    backend: SidecarBackend,
}

impl SidecarManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            child: Mutex::new(None),
            backend: Self::detect_backend(app_handle),
        }
    }

    pub fn backend(&self) -> SidecarBackend {
        self.backend
    }

    fn supports_mlx_audio_backend() -> bool {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            true
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            false
        }
    }

    fn detect_backend(app_handle: &AppHandle) -> SidecarBackend {
        let default_backend = if Self::supports_mlx_audio_backend() {
            SidecarBackend::MlxAudio
        } else {
            SidecarBackend::LegacyPythonRuntime
        };

        let override_value = get_settings(app_handle)
            .speech_backend_override
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());

        match override_value.as_deref() {
            Some("legacy") => SidecarBackend::LegacyPythonRuntime,
            Some("mlx_audio") => {
                if Self::supports_mlx_audio_backend() {
                    SidecarBackend::MlxAudio
                } else {
                    warn!(
                        "speech_backend_override=mlx_audio is not supported on this platform; falling back to legacy runtime"
                    );
                    default_backend
                }
            }
            Some(other) => {
                warn!(
                    "Ignoring unknown speech_backend_override '{}'; using auto-detected backend",
                    other
                );
                default_backend
            }
            None => default_backend,
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
        match self.backend {
            SidecarBackend::LegacyPythonRuntime => self.resolve_runtime_path().is_some(),
            SidecarBackend::MlxAudio => self.existing_mlx_audio_python_path().is_some(),
        }
    }

    pub fn is_running(&self) -> bool {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(HEALTH_CHECK_TIMEOUT_SECS))
            .build();
        match client {
            Ok(client) => ["/health", "/v1/models"].iter().any(|path| {
                client
                    .get(format!("http://127.0.0.1:{SIDECAR_PORT}{path}"))
                    .send()
                    .map(|resp| resp.status().is_success())
                    .unwrap_or(false)
            }),
            Err(_) => false,
        }
    }

    pub fn ensure_running(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        match self.backend {
            SidecarBackend::LegacyPythonRuntime => self.ensure_legacy_runtime_running(),
            SidecarBackend::MlxAudio => self.ensure_mlx_audio_running(),
        }
    }

    fn ensure_legacy_runtime_running(&self) -> Result<(), String> {
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

        self.wait_for_sidecar_health("Speech runtime", 20)
    }

    fn ensure_mlx_audio_running(&self) -> Result<(), String> {
        let python = self.ensure_mlx_audio_environment()?;
        let venv_dir = python
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| "Failed to resolve mlx-audio virtual environment root.".to_string())?;

        info!("Starting mlx-audio sidecar from {}", venv_dir.display());

        let child = Command::new(&python)
            .args([
                "-m",
                "mlx_audio.server",
                "--port",
                &SIDECAR_PORT.to_string(),
            ])
            .current_dir(venv_dir)
            .env("PYTHONUNBUFFERED", "1")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|err| format!("Failed to start mlx-audio sidecar: {err}"))?;

        {
            let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(child);
        }

        self.wait_for_sidecar_health("mlx-audio sidecar", 60)
    }

    fn wait_for_sidecar_health(&self, runtime_label: &str, attempts: usize) -> Result<(), String> {
        for attempt in 0..attempts {
            std::thread::sleep(Duration::from_millis(500));
            if self.is_running() {
                info!("{runtime_label} is healthy (attempt {})", attempt + 1);
                return Ok(());
            }
        }

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
                            "{runtime_label} exited with {status}. Stderr: {}",
                            stderr.chars().take(500).collect::<String>()
                        ));
                    }
                    _ => {}
                }
            }
        }

        Err(format!(
            "{runtime_label} started but did not become healthy within {} seconds.",
            attempts / 2
        ))
    }

    fn emit_setup_progress(&self, stage: &str, detail: &str) {
        let _ = self.app_handle.emit(
            "speech-backend-setup-progress",
            serde_json::json!({
                "backend": "mlx_audio",
                "stage": stage,
                "detail": detail,
            }),
        );
    }

    fn mlx_audio_venv_dir(&self) -> Result<PathBuf, String> {
        let app_data_dir = crate::portable::app_data_dir(&self.app_handle)
            .map_err(|err| format!("Failed to resolve app data dir for mlx-audio: {err}"))?;
        Ok(app_data_dir.join(MLX_AUDIO_VENV_DIR))
    }

    fn mlx_audio_python_path(venv_dir: &Path) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            return venv_dir.join("Scripts").join("python.exe");
        }
        #[cfg(not(target_os = "windows"))]
        {
            venv_dir.join("bin").join("python")
        }
    }

    fn existing_mlx_audio_python_path(&self) -> Option<PathBuf> {
        let venv_dir = self.mlx_audio_venv_dir().ok()?;
        let python = Self::mlx_audio_python_path(&venv_dir);
        python.exists().then_some(python)
    }

    fn find_bootstrap_python() -> Option<String> {
        if let Ok(value) = std::env::var("VOX_JOT_MLX_AUDIO_PYTHON") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        for candidate in ["python3", "python"] {
            if let Ok(status) = Command::new(candidate).arg("--version").status() {
                if status.success() {
                    return Some(candidate.to_string());
                }
            }
        }

        None
    }

    pub fn ensure_mlx_audio_environment(&self) -> Result<PathBuf, String> {
        let venv_dir = self.mlx_audio_venv_dir()?;
        let python = Self::mlx_audio_python_path(&venv_dir);
        let version_marker = venv_dir.join(MLX_AUDIO_VERSION_MARKER);
        let installed_version = std::fs::read_to_string(&version_marker)
            .ok()
            .map(|value| value.trim().to_string());
        let needs_install =
            !python.exists() || installed_version.as_deref() != Some(MLX_AUDIO_PACKAGE_SPEC);

        if !needs_install {
            return Ok(python);
        }

        std::fs::create_dir_all(&venv_dir)
            .map_err(|err| format!("Failed to create mlx-audio venv dir: {err}"))?;

        if !python.exists() {
            let bootstrap_python = Self::find_bootstrap_python().ok_or_else(|| {
                "mlx-audio requires Python 3 on PATH (or VOX_JOT_MLX_AUDIO_PYTHON set).".to_string()
            })?;

            self.emit_setup_progress("creating_venv", "Preparing mlx-audio Python environment.");
            let venv_status = Command::new(&bootstrap_python)
                .args(["-m", "venv"])
                .arg(&venv_dir)
                .status()
                .map_err(|err| {
                    format!("Failed to create mlx-audio venv with {bootstrap_python}: {err}")
                })?;
            if !venv_status.success() {
                return Err(format!(
                    "Failed to create mlx-audio venv with {} (exit status {}).",
                    bootstrap_python, venv_status
                ));
            }
        }

        self.emit_setup_progress("installing", "Installing pinned mlx-audio runtime.");
        for pip_args in [
            vec!["-m", "pip", "install", "--upgrade", "pip"],
            vec![
                "-m",
                "pip",
                "install",
                "--upgrade",
                "--force-reinstall",
                MLX_AUDIO_PACKAGE_SPEC,
            ],
        ] {
            let status = Command::new(&python)
                .args(&pip_args)
                .status()
                .map_err(|err| {
                    format!(
                        "Failed to run '{}' inside the mlx-audio venv: {err}",
                        pip_args.join(" ")
                    )
                })?;
            if !status.success() {
                return Err(format!(
                    "mlx-audio environment setup failed while running '{}' (exit status {}).",
                    pip_args.join(" "),
                    status
                ));
            }
        }

        std::fs::write(&version_marker, MLX_AUDIO_PACKAGE_SPEC)
            .map_err(|err| format!("Failed to write mlx-audio version marker: {err}"))?;
        self.emit_setup_progress("ready", "mlx-audio is ready.");
        Ok(python)
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
            info!("Stopping {:?} sidecar", self.backend);
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
