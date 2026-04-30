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
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
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

use crate::ocr_models::OcrBackendKind;
use crate::screen_context::NativeScreenContextSnippet;
use crate::screen_context_ocr_backup::{OcrFrame, PixelFormat};

/// Shared singleton — the screen-context worker is the only caller and it
/// runs on a dedicated thread, so a single global handle is fine.
static MANAGER: Lazy<OcrRuntimeManager> = Lazy::new(OcrRuntimeManager::new);

pub fn shared() -> &'static OcrRuntimeManager {
    &MANAGER
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

    // Reuse the speech-runtime venv if the user has bootstrapped it — it
    // already has torch + transformers ready for VL loaders.
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

    // Repo-local ocr-runtime venv (for devs running from a checkout).
    if let Some(root) = locate_runtime_root() {
        let venv_python = root.join(".venv/bin/python");
        if venv_python.is_file() {
            return Some(venv_python);
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

fn is_runtime_root(path: &Path) -> bool {
    path.is_dir() && path.join("ocr_runtime").join("__main__.py").is_file()
}
