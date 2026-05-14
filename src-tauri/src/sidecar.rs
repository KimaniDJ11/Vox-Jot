use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use log::{info, warn};
use tauri::{AppHandle, Emitter};

use crate::settings::{default_tts_model_store_dir, get_settings};

const DEFAULT_SPEECH_RUNTIME_PATHS: &[&str] = &[
    "Library/Mobile Documents/com~apple~CloudDocs/Apps/Speech",
    "Apps/Speech",
];
const SPEECH_RUNTIME_PORT: u16 = 8008;
const MLX_AUDIO_PORT: u16 = 8018;
const HEALTH_CHECK_TIMEOUT_MS: u64 = 350;

const HEALTH_UNKNOWN: u8 = 0;
const HEALTH_NONE: u8 = 1;
const HEALTH_LEGACY: u8 = 2;
const HEALTH_MLX: u8 = 3;

fn health_client() -> &'static reqwest::blocking::Client {
    // Reuse a single blocking client: builds TLS/connection pool once so
    // repeated health probes don't pay builder/TCP setup cost each call.
    // Keep health-check timeouts short because these probes run on startup
    // and model-load paths where multi-second waits feel like app freezes.
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_millis(HEALTH_CHECK_TIMEOUT_MS))
            .timeout(Duration::from_millis(HEALTH_CHECK_TIMEOUT_MS))
            .build()
            .expect("failed to build sidecar health reqwest client")
    })
}
const MLX_AUDIO_VENV_DIR: &str = "mlx-audio-venv";
const MLX_AUDIO_VERSION_MARKER: &str = "mlx-audio.version";
const MLX_AUDIO_RUNTIME_MARKER: &str =
    "mlx-audio==0.4.3|torch==2.11.0|g2p_en==2.1.0|patches=voxtral_eos_v1,parakeet_stt_remap_v1";
const MLX_AUDIO_RUNTIME_PACKAGES: &[&str] = &["mlx-audio==0.4.3", "torch==2.11.0", "g2p_en==2.1.0"];
const SPEECH_ANALYSIS_VENV_DIR: &str = "speech-analysis-venv";
const SPEECH_ANALYSIS_VERSION_MARKER: &str = "speech-analysis.version";
const SPEECH_ANALYSIS_RUNTIME_MARKER: &str = "speech-analysis-runtime-2026-05-12-py311-v1";
const SPEECH_ANALYSIS_REQUIREMENTS: &str = include_str!("../../speech-analysis-requirements.txt");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SidecarBackend {
    LegacyPythonRuntime,
    MlxAudio,
}

pub struct SidecarManager {
    app_handle: AppHandle,
    child: Mutex<Option<std::process::Child>>,
    backend: SidecarBackend,
    cached_health: AtomicU8,
    cached_health_checked_at_ms: AtomicU64,
}

impl SidecarManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            child: Mutex::new(None),
            backend: Self::detect_backend(app_handle),
            cached_health: AtomicU8::new(HEALTH_UNKNOWN),
            cached_health_checked_at_ms: AtomicU64::new(0),
        }
    }

    pub fn backend(&self) -> SidecarBackend {
        self.backend
    }

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }

    fn set_cached_health(&self, state: u8) {
        self.cached_health.store(state, Ordering::Relaxed);
        self.cached_health_checked_at_ms
            .store(Self::now_ms(), Ordering::Relaxed);
    }

    fn clear_cached_health(&self) {
        self.cached_health.store(HEALTH_UNKNOWN, Ordering::Relaxed);
        self.cached_health_checked_at_ms.store(0, Ordering::Relaxed);
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

        // `speech-runtime` checkout with vendored `VibeVoice` + bridge (no legacy `runtime/app.py` tree).
        if path.join("vibevoice_bridge.py").exists()
            && path
                .join("vendor")
                .join("VibeVoice")
                .join("demo")
                .join("voices")
                .join("streaming_model")
                .is_dir()
        {
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
        let base_dir = crate::storage_paths::tts_runtime_dir(&self.app_handle).ok()?;
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

    fn repo_runtime_path(&self) -> Option<PathBuf> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir.parent()?;
        Self::normalize_runtime_root(&repo_root.join("speech-runtime"))
    }

    pub fn runtime_python_path(runtime_root: &Path) -> Option<PathBuf> {
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

    pub fn resolve_runtime_path(&self) -> Option<PathBuf> {
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

        // Prefer the repository checkout (next to `src-tauri`) before the managed install so
        // `cargo run` / dev builds pick up local `speech-runtime` changes. Release bundles
        // bake a compile-time path that typically does not exist on end-user machines, so
        // `repo_runtime_path` is None there and the managed runtime is used.
        if let Some(runtime_root) = self.repo_runtime_path() {
            return Some(runtime_root);
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

    pub fn has_speech_runtime_source(&self) -> bool {
        self.resolve_runtime_path().is_some()
    }

    pub fn can_auto_start(&self) -> bool {
        match self.backend {
            SidecarBackend::LegacyPythonRuntime => self.resolve_runtime_path().is_some(),
            SidecarBackend::MlxAudio => self.existing_mlx_audio_python_path().is_some(),
        }
    }

    pub fn is_running(&self) -> bool {
        match self.backend {
            SidecarBackend::LegacyPythonRuntime => self.is_speech_runtime_running(),
            SidecarBackend::MlxAudio => self.is_mlx_audio_running(),
        }
    }

    pub fn is_mlx_audio_running(&self) -> bool {
        health_client()
            .get(format!("http://127.0.0.1:{MLX_AUDIO_PORT}/v1/models"))
            .send()
            .map(|resp| resp.status().is_success())
            .unwrap_or(false)
    }

    /// Check whether the **speech-runtime** (legacy Python runtime) is the
    /// server currently listening on the sidecar port.  The speech-runtime
    /// exposes `/listen/prepare` which `mlx_audio.server` does not.
    pub fn is_speech_runtime_running(&self) -> bool {
        health_client()
            .post(format!(
                "http://127.0.0.1:{SPEECH_RUNTIME_PORT}/listen/prepare"
            ))
            .header("content-type", "application/json")
            .body("{}")
            .send()
            .map(|resp| resp.status().as_u16() != 404)
            .unwrap_or(false)
    }

    /// Ensure the speech-runtime (legacy Python runtime) is running on the
    /// sidecar port.  If a different backend (e.g. `mlx_audio.server`) is
    /// currently occupying the port it will be stopped first.
    pub fn ensure_speech_runtime(&self) -> Result<(), String> {
        if self.is_speech_runtime_running() {
            return Ok(());
        }

        if !self.listener_pids(SPEECH_RUNTIME_PORT).is_empty() {
            info!("Stopping non-speech-runtime listener to make room for the speech-runtime");
            self.reclaim_sidecar_port(SPEECH_RUNTIME_PORT)?;
        }

        self.ensure_legacy_runtime_running()
    }

    pub fn restart_speech_runtime(&self) -> Result<(), String> {
        if !self.listener_pids(SPEECH_RUNTIME_PORT).is_empty() {
            self.reclaim_sidecar_port(SPEECH_RUNTIME_PORT)?;
        }

        self.ensure_legacy_runtime_running()
    }

    pub fn ensure_running(&self) -> Result<(), String> {
        let already_running = self.is_running();
        if already_running {
            return Ok(());
        }

        let port = match self.backend {
            SidecarBackend::LegacyPythonRuntime => SPEECH_RUNTIME_PORT,
            SidecarBackend::MlxAudio => MLX_AUDIO_PORT,
        };
        if !self.listener_pids(port).is_empty() {
            self.reclaim_sidecar_port(port)?;
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
        let fallback_tts_prompt = crate::portable::resolve_resource(
            &self.app_handle,
            "resources/python/mlx_csm_default_prompt.wav",
        )
        .ok()
        .filter(|path| path.exists());

        let mut command = Command::new(&venv_python);
        command
            .args(["-m", "runtime.app"])
            .current_dir(&runtime_path)
            .env("SPEECH_RUNTIME_PORT", SPEECH_RUNTIME_PORT.to_string())
            .env("SPEECH_MODEL_STORE", model_store_path)
            .env("SPEECH_RUNTIME_STATE_DIR", runtime_state_dir)
            .env("SPEECH_VOICE_PROFILES_DIR", voice_profiles_dir);
        if let Some(prompt_path) = fallback_tts_prompt {
            command.env("VOX_JOT_TTS_FALLBACK_PROMPT", prompt_path);
        }

        let child = command
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|err| format!("Failed to start Speech runtime: {err}"))?;

        {
            let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(child);
        }

        self.wait_for_runtime_probe("Speech runtime", HEALTH_LEGACY, 20, |manager| {
            manager.is_speech_runtime_running()
        })
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
                &MLX_AUDIO_PORT.to_string(),
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

        self.wait_for_runtime_probe("mlx-audio sidecar", HEALTH_MLX, 60, |manager| {
            manager.is_mlx_audio_running()
        })
    }

    fn wait_for_runtime_probe<F>(
        &self,
        runtime_label: &str,
        healthy_state: u8,
        attempts: usize,
        probe: F,
    ) -> Result<(), String>
    where
        F: Fn(&Self) -> bool,
    {
        for attempt in 0..attempts {
            std::thread::sleep(Duration::from_millis(500));
            self.clear_cached_health();
            if probe(self) {
                info!("{runtime_label} is healthy (attempt {})", attempt + 1);
                self.set_cached_health(healthy_state);
                return Ok(());
            }
        }

        {
            let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(ref mut child) = *guard {
                if let Ok(Some(status)) = child.try_wait() {
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
            }
        }

        Err(format!(
            "{runtime_label} started but did not become healthy within {} seconds.",
            attempts / 2
        ))
    }

    fn reclaim_sidecar_port(&self, port: u16) -> Result<(), String> {
        self.stop();
        self.terminate_external_listeners(port)?;

        for _ in 0..10 {
            if self.listener_pids(port).is_empty() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(150));
        }

        let remaining = self.listener_pids(port);
        if remaining.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Port {port} is still in use by process(es): {}",
                remaining
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
    }

    fn terminate_external_listeners(&self, port: u16) -> Result<(), String> {
        let tracked_pid = self
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|child| child.id());
        let listener_pids = self.listener_pids(port);
        for pid in listener_pids {
            if Some(pid) == tracked_pid {
                continue;
            }
            info!("Stopping external sidecar listener on port {port} (pid {pid})");
            self.terminate_pid(pid)?;
        }
        Ok(())
    }

    fn listener_pids(&self, port: u16) -> Vec<u32> {
        #[cfg(target_os = "windows")]
        {
            let output = Command::new("netstat").args(["-ano", "-p", "tcp"]).output();
            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout
                    .lines()
                    .filter(|line| line.contains(&format!(":{port}")))
                    .filter(|line| line.contains("LISTENING"))
                    .filter_map(|line| line.split_whitespace().last()?.parse::<u32>().ok())
                    .collect();
            }
            return Vec::new();
        }

        #[cfg(not(target_os = "windows"))]
        {
            let output = Command::new("lsof")
                .args(["-t", "-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
                .output();
            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout
                    .lines()
                    .filter_map(|line| line.trim().parse::<u32>().ok())
                    .collect();
            }
            Vec::new()
        }
    }

    fn terminate_pid(&self, pid: u32) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        let terminate_status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|err| format!("Failed to stop sidecar process {pid}: {err}"))?;

        #[cfg(not(target_os = "windows"))]
        let terminate_status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|err| format!("Failed to stop sidecar process {pid}: {err}"))?;

        if !terminate_status.success() {
            return Err(format!("Failed to stop sidecar process {pid}."));
        }

        for _ in 0..10 {
            if !self.listener_pids(SPEECH_RUNTIME_PORT).contains(&pid)
                && !self.listener_pids(MLX_AUDIO_PORT).contains(&pid)
            {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(150));
        }

        #[cfg(not(target_os = "windows"))]
        {
            let kill_status = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status()
                .map_err(|err| format!("Failed to force-stop sidecar process {pid}: {err}"))?;
            if !kill_status.success() {
                return Err(format!("Failed to force-stop sidecar process {pid}."));
            }
        }

        Ok(())
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

    pub fn mlx_audio_runtime_installed_for_app(app: &tauri::AppHandle) -> bool {
        let Ok(app_data_dir) = crate::portable::app_data_dir(app) else {
            return false;
        };
        let venv_dir = app_data_dir.join(MLX_AUDIO_VENV_DIR);
        let python = Self::mlx_audio_python_path(&venv_dir);
        if !python.exists() {
            return false;
        }
        let marker = venv_dir.join(MLX_AUDIO_VERSION_MARKER);
        std::fs::read_to_string(marker)
            .ok()
            .map(|value| value.trim() == MLX_AUDIO_RUNTIME_MARKER)
            .unwrap_or(false)
    }

    fn speech_analysis_venv_dir(&self) -> Result<PathBuf, String> {
        let app_data_dir = crate::portable::app_data_dir(&self.app_handle)
            .map_err(|err| format!("Failed to resolve app data dir for speech analysis: {err}"))?;
        Ok(app_data_dir.join(SPEECH_ANALYSIS_VENV_DIR))
    }

    fn speech_analysis_python_path(venv_dir: &Path) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            return venv_dir.join("Scripts").join("python.exe");
        }
        #[cfg(not(target_os = "windows"))]
        {
            venv_dir.join("bin").join("python")
        }
    }

    pub fn speech_analysis_runtime_installed_for_app(app: &tauri::AppHandle) -> bool {
        let Ok(app_data_dir) = crate::portable::app_data_dir(app) else {
            return false;
        };
        let venv_dir = app_data_dir.join(SPEECH_ANALYSIS_VENV_DIR);
        let python = Self::speech_analysis_python_path(&venv_dir);
        if !python.exists() {
            return false;
        }
        let marker = venv_dir.join(SPEECH_ANALYSIS_VERSION_MARKER);
        std::fs::read_to_string(marker)
            .ok()
            .map(|value| value.trim() == SPEECH_ANALYSIS_RUNTIME_MARKER)
            .unwrap_or(false)
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
            !python.exists() || installed_version.as_deref() != Some(MLX_AUDIO_RUNTIME_MARKER);

        if !needs_install {
            self.apply_mlx_audio_runtime_patches(&venv_dir)?;
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
        let mut pip_commands = vec![vec!["-m", "pip", "install", "--upgrade", "pip"]];
        for package in MLX_AUDIO_RUNTIME_PACKAGES {
            pip_commands.push(vec![
                "-m",
                "pip",
                "install",
                "--upgrade",
                "--force-reinstall",
                package,
            ]);
        }

        for pip_args in pip_commands {
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

        self.apply_mlx_audio_runtime_patches(&venv_dir)?;

        std::fs::write(&version_marker, MLX_AUDIO_RUNTIME_MARKER)
            .map_err(|err| format!("Failed to write mlx-audio version marker: {err}"))?;
        self.emit_setup_progress("ready", "mlx-audio is ready.");
        Ok(python)
    }

    pub fn ensure_speech_analysis_environment(&self) -> Result<PathBuf, String> {
        if let Ok(path) = std::env::var("VOX_JOT_SPEECH_ANALYSIS_PYTHON") {
            let python = PathBuf::from(path);
            if python.exists() {
                return Ok(python);
            }
        }

        let venv_dir = self.speech_analysis_venv_dir()?;
        let python = Self::speech_analysis_python_path(&venv_dir);
        let version_marker = venv_dir.join(SPEECH_ANALYSIS_VERSION_MARKER);
        let installed_version = std::fs::read_to_string(&version_marker)
            .ok()
            .map(|value| value.trim().to_string());
        let needs_install = !python.exists()
            || installed_version.as_deref() != Some(SPEECH_ANALYSIS_RUNTIME_MARKER);

        if !needs_install {
            return Ok(python);
        }

        std::fs::create_dir_all(&venv_dir)
            .map_err(|err| format!("Failed to create speech-analysis venv dir: {err}"))?;

        if !python.exists() {
            let bootstrap_python = Self::find_bootstrap_python().ok_or_else(|| {
                "Speech analysis requires Python 3 on PATH (or VOX_JOT_SPEECH_ANALYSIS_PYTHON set).".to_string()
            })?;

            self.emit_setup_progress(
                "creating_venv",
                "Preparing speech-analysis Python environment.",
            );
            let venv_status = Command::new(&bootstrap_python)
                .args(["-m", "venv"])
                .arg(&venv_dir)
                .status()
                .map_err(|err| {
                    format!("Failed to create speech-analysis venv with {bootstrap_python}: {err}")
                })?;
            if !venv_status.success() {
                return Err(format!(
                    "Failed to create speech-analysis venv with {} (exit status {}).",
                    bootstrap_python, venv_status
                ));
            }
        }

        let requirements_path = venv_dir.join("requirements.txt");
        std::fs::write(&requirements_path, SPEECH_ANALYSIS_REQUIREMENTS)
            .map_err(|err| format!("Failed to write speech-analysis requirements: {err}"))?;

        self.emit_setup_progress("installing", "Installing pinned speech-analysis runtime.");
        for pip_args in [
            vec![
                "-m",
                "pip",
                "install",
                "--upgrade",
                "pip",
                "setuptools",
                "wheel",
            ],
            vec![
                "-m",
                "pip",
                "install",
                "--upgrade",
                "--force-reinstall",
                "-r",
                requirements_path
                    .to_str()
                    .ok_or_else(|| "Invalid speech-analysis requirements path.".to_string())?,
            ],
        ] {
            let status = Command::new(&python)
                .args(&pip_args)
                .status()
                .map_err(|err| {
                    format!(
                        "Failed to run '{}' inside the speech-analysis venv: {err}",
                        pip_args.join(" ")
                    )
                })?;
            if !status.success() {
                return Err(format!(
                    "Speech-analysis environment setup failed while running '{}' (exit status {}).",
                    pip_args.join(" "),
                    status
                ));
            }
        }

        std::fs::write(&version_marker, SPEECH_ANALYSIS_RUNTIME_MARKER)
            .map_err(|err| format!("Failed to write speech-analysis version marker: {err}"))?;
        self.emit_setup_progress("ready", "Speech analysis runtime is ready.");
        Ok(python)
    }

    fn apply_mlx_audio_runtime_patches(&self, venv_dir: &Path) -> Result<(), String> {
        let site_packages = Self::mlx_audio_site_packages_dir(venv_dir)?;
        let voxtral_model_file = site_packages
            .join("mlx_audio")
            .join("stt")
            .join("models")
            .join("voxtral")
            .join("voxtral.py");

        if !voxtral_model_file.exists() {
            return Ok(());
        }

        let contents = std::fs::read_to_string(&voxtral_model_file)
            .map_err(|err| format!("Failed to read '{}': {err}", voxtral_model_file.display()))?;

        if contents.contains("_vox_jot_eos_token_ids") {
            return Ok(());
        }

        let old_block = r#"        model._processor.tokenizer.eos_token_ids = getattr(
            model._processor.tokenizer, "eos_token_ids", [2, 4, 32000]
        )
"#;
        let new_block = r#"        tokenizer_eos_ids = getattr(model._processor.tokenizer, "eos_token_ids", None)
        if tokenizer_eos_ids is None:
            tokenizer_eos_ids = getattr(model._processor.tokenizer, "eos_token_id", None)
        if tokenizer_eos_ids is None:
            tokenizer_eos_ids = [2, 4, 32000]
        elif isinstance(tokenizer_eos_ids, int):
            tokenizer_eos_ids = [tokenizer_eos_ids]
        else:
            tokenizer_eos_ids = list(tokenizer_eos_ids)
        model._processor._vox_jot_eos_token_ids = tokenizer_eos_ids
"#;

        let mut patched = contents.replace(old_block, new_block);
        patched = patched.replace(
            "self._processor.tokenizer.eos_token_ids",
            "self._processor._vox_jot_eos_token_ids",
        );
        patched = patched.replace(
            "with wired_limit(self, [generation_stream]):",
            "with wired_limit(self):",
        );

        if patched == contents {
            warn!(
                "Skipping mlx-audio Voxtral tokenizer patch because the expected upstream block was not found in '{}'",
                voxtral_model_file.display()
            );
            return Ok(());
        }

        std::fs::write(&voxtral_model_file, patched).map_err(|err| {
            format!(
                "Failed to write patched mlx-audio Voxtral file '{}': {err}",
                voxtral_model_file.display()
            )
        })?;

        let kugel_model_file = site_packages
            .join("mlx_audio")
            .join("tts")
            .join("models")
            .join("kugelaudio")
            .join("kugelaudio.py");

        if kugel_model_file.exists() {
            let kugel_contents = std::fs::read_to_string(&kugel_model_file).unwrap_or_default();
            let kugel_patched = kugel_contents.replace(
                "AutoTokenizer.from_pretrained(\n            qwen_model, trust_remote_code=False\n        )",
                "AutoTokenizer.from_pretrained(\n            str(model_path), trust_remote_code=False\n        )",
            );
            if kugel_patched != kugel_contents {
                let _ = std::fs::write(&kugel_model_file, kugel_patched);
            }
        }

        let stt_utils_file = site_packages.join("mlx_audio").join("stt").join("utils.py");

        if stt_utils_file.exists() {
            let stt_utils_contents = std::fs::read_to_string(&stt_utils_file)
                .map_err(|err| format!("Failed to read '{}': {err}", stt_utils_file.display()))?;
            if !stt_utils_contents.contains("\"parakeet\": \"parakeet\"") {
                let stt_utils_patched = stt_utils_contents.replace(
                    "MODEL_REMAPPING = {\n",
                    "MODEL_REMAPPING = {\n    \"parakeet\": \"parakeet\",\n",
                );
                if stt_utils_patched != stt_utils_contents {
                    std::fs::write(&stt_utils_file, stt_utils_patched).map_err(|err| {
                        format!(
                            "Failed to write patched mlx-audio STT utils file '{}': {err}",
                            stt_utils_file.display()
                        )
                    })?;
                }
            }
        }

        Ok(())
    }

    fn mlx_audio_site_packages_dir(venv_dir: &Path) -> Result<PathBuf, String> {
        #[cfg(target_os = "windows")]
        {
            let path = venv_dir.join("Lib").join("site-packages");
            if path.exists() {
                return Ok(path);
            }
            return Err(format!(
                "mlx-audio site-packages directory not found under '{}'",
                venv_dir.display()
            ));
        }

        #[cfg(not(target_os = "windows"))]
        {
            let lib_dir = venv_dir.join("lib");
            let entries = std::fs::read_dir(&lib_dir)
                .map_err(|err| format!("Failed to read '{}': {err}", lib_dir.display()))?;
            for entry in entries.flatten() {
                let path = entry.path().join("site-packages");
                if path.exists() {
                    return Ok(path);
                }
            }

            Err(format!(
                "mlx-audio site-packages directory not found under '{}'",
                lib_dir.display()
            ))
        }
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
        self.set_cached_health(HEALTH_NONE);
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.stop();
    }
}
