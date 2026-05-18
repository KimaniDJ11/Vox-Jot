//! Loopback HTTP API for Vox Jot.
//!
//! ## What it is, in plain terms
//!
//! When the user flips **Settings → Diagnostics → Enable local API** on,
//! we start a tiny `axum` web server bound to `127.0.0.1:<port>` (default
//! `8978`). Anything that wants to drive Vox Jot programmatically — the
//! `vox-jot transcribe` CLI, a shell script, a Raycast extension — POSTs
//! audio here and gets JSON back, instead of having to fake keystrokes
//! against the GUI.
//!
//! ## Lifecycle
//!
//! - `HttpApiManager::new()` returns a handle but does NOT start a server.
//! - `start()` spawns one Tokio task that owns the listener. If the
//!   server is already running on the same port we no-op.
//! - `stop()` aborts that task. The server's resources are dropped
//!   immediately.
//! - The `lib.rs` settings-change listener calls `start()`/`stop()` based
//!   on `http_api_enabled`, so the user toggle in the UI is the single
//!   source of truth.
//!
//! ## Latency note
//!
//! App startup is unaffected because we never start the server unless
//! the setting is on. While running, every request runs on its own
//! Tokio task — they cannot block the dictation engine because they go
//! through the same `TranscriptionManager.transcribe_with_segments`
//! method the GUI uses, which already serializes via `transcribe_lock`.

use crate::helpers::subtitles::TimedSegment;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, get_settings_without_secrets, write_settings};
use crate::tts::{SpeakRequest, TtsManager, VoiceInfo};
use crate::tts_profiles::{list_voice_profiles, TtsVoiceProfileDescriptor};
use axum::{
    extract::{DefaultBodyLimit, Multipart, State as AxumState},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const MAX_TRANSCRIBE_UPLOAD_BYTES: usize = 128 * 1024 * 1024;
const API_TOKEN_HEADER: &str = "x-vox-jot-api-token";

#[derive(Clone)]
struct ApiState {
    app: AppHandle,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct TranscribeResponse {
    text: String,
    segments: Vec<TimedSegment>,
}

#[derive(Serialize)]
struct ModelsResponse {
    current: Option<String>,
    available: Vec<String>,
}

#[derive(Serialize)]
struct ReadinessGateResponse {
    id: &'static str,
    state: &'static str,
    detail: String,
}

#[derive(Serialize)]
struct ReadinessResponse {
    overall: &'static str,
    gates: Vec<ReadinessGateResponse>,
    updated_at_ms: u128,
}

#[derive(Deserialize)]
struct SpeakApiRequest {
    text: String,
    locale: Option<String>,
    preferred_voice_id: Option<String>,
    preset_id: Option<String>,
    remember_last_output: Option<bool>,
}

#[derive(Serialize)]
struct SpeakApiResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

pub struct HttpApiManager {
    app: AppHandle,
    /// `Some(handle)` while the server is running. We `abort()` it on
    /// stop and replace with `None`.
    task: Mutex<Option<RunningServer>>,
}

struct RunningServer {
    port: u16,
    handle: JoinHandle<()>,
}

impl HttpApiManager {
    pub fn new(app: &AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app: app.clone(),
            task: Mutex::new(None),
        })
    }

    /// Start (or restart, if the port changed) the loopback server.
    /// Idempotent: a no-op if the server is already running on the
    /// requested port.
    pub async fn start(self: &Arc<Self>, port: u16) {
        let mut guard = self.task.lock().await;
        if let Some(running) = guard.as_ref() {
            if running.port == port {
                return;
            }
            // Port changed; tear down before re-binding.
            running.handle.abort();
            *guard = None;
        }

        let state = ApiState {
            app: self.app.clone(),
        };

        let router = Router::new()
            .route("/v1/health", get(handle_health))
            .route("/v1/readiness", get(handle_readiness))
            .route("/v1/models", get(handle_models))
            .route("/v1/voices", get(handle_voices))
            .route("/v1/speak", post(handle_speak))
            .route("/v1/tts/profiles", get(handle_tts_profiles))
            .route("/v1/transcribe", post(handle_transcribe))
            .layer(DefaultBodyLimit::max(MAX_TRANSCRIBE_UPLOAD_BYTES))
            .with_state(state);

        let bind_addr = format!("127.0.0.1:{}", port);
        let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
            Ok(l) => l,
            Err(err) => {
                warn!("http_api: failed to bind {}: {}", bind_addr, err);
                let _ = self.app.emit(
                    "http-api-status",
                    ApiStatusEvent::failed(port, err.to_string()),
                );
                return;
            }
        };

        info!("http_api: listening on {}", bind_addr);
        let _ = self
            .app
            .emit("http-api-status", ApiStatusEvent::running(port));

        let app_for_event = self.app.clone();
        let handle = tokio::spawn(async move {
            if let Err(err) = axum::serve(listener, router).await {
                warn!("http_api: server task exited: {}", err);
                let _ = app_for_event.emit(
                    "http-api-status",
                    ApiStatusEvent::failed(port, err.to_string()),
                );
            }
        });

        *guard = Some(RunningServer { port, handle });
    }

    pub async fn stop(self: &Arc<Self>) {
        let mut guard = self.task.lock().await;
        if let Some(running) = guard.take() {
            running.handle.abort();
            info!("http_api: stopped (was on port {})", running.port);
            let _ = self.app.emit("http-api-status", ApiStatusEvent::stopped());
        }
    }
}

#[derive(Serialize, Clone)]
pub struct ApiStatusEvent {
    pub running: bool,
    pub port: Option<u16>,
    pub error: Option<String>,
}

impl ApiStatusEvent {
    fn running(port: u16) -> Self {
        Self {
            running: true,
            port: Some(port),
            error: None,
        }
    }
    fn stopped() -> Self {
        Self {
            running: false,
            port: None,
            error: None,
        }
    }
    fn failed(port: u16, msg: String) -> Self {
        Self {
            running: false,
            port: Some(port),
            error: Some(msg),
        }
    }
}

// ─────────────────────────── Route handlers ───────────────────────────

async fn handle_health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn handle_models(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }
    handle_models_authorized(state).await
}

async fn handle_models_authorized(state: ApiState) -> axum::response::Response {
    let manager = match state.app.try_state::<Arc<TranscriptionManager>>() {
        Some(m) => m.inner().clone(),
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "TranscriptionManager not ready".into(),
                }),
            )
                .into_response();
        }
    };
    let model_manager = match state
        .app
        .try_state::<Arc<crate::managers::model::ModelManager>>()
    {
        Some(m) => m.inner().clone(),
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "ModelManager not ready".into(),
                }),
            )
                .into_response();
        }
    };
    let available = model_manager
        .get_available_models()
        .iter()
        .filter(|info| crate::managers::model::model_is_available(info))
        .map(|info| info.id.clone())
        .collect();
    Json(ModelsResponse {
        current: manager.get_current_model(),
        available,
    })
    .into_response()
}

async fn handle_readiness(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }

    let settings = get_settings_without_secrets(&state.app);
    let loaded_model = state
        .app
        .try_state::<Arc<TranscriptionManager>>()
        .and_then(|manager| manager.get_current_model());
    let selected_model = settings.selected_model.clone();
    let gates = vec![
        ReadinessGateResponse {
            id: "stt_model",
            state: if selected_model.trim().is_empty() {
                "blocked"
            } else if loaded_model.as_deref() == Some(selected_model.as_str()) {
                "ready"
            } else {
                "warning"
            },
            detail: if selected_model.trim().is_empty() {
                "No speech model is selected.".to_string()
            } else if loaded_model.as_deref() == Some(selected_model.as_str()) {
                format!("{selected_model} is loaded.")
            } else {
                format!("{selected_model} is selected but not loaded.")
            },
        },
        ReadinessGateResponse {
            id: "paste_method",
            state: if matches!(settings.paste_method, crate::settings::PasteMethod::None) {
                "warning"
            } else {
                "ready"
            },
            detail: format!("Paste method: {:?}", settings.paste_method),
        },
        ReadinessGateResponse {
            id: "post_processing",
            state: if settings.post_process_enabled {
                "warning"
            } else {
                "ready"
            },
            detail: if settings.post_process_enabled {
                "Refine is enabled and may add post-processing latency.".to_string()
            } else {
                "Refine is disabled for the lowest-latency path.".to_string()
            },
        },
        ReadinessGateResponse {
            id: "screen_context",
            state: "ready",
            detail: if settings.screen_context_enabled {
                "Screen context is enabled.".to_string()
            } else {
                "Screen context is disabled.".to_string()
            },
        },
    ];
    let overall = if gates.iter().any(|gate| gate.state == "blocked") {
        "blocked"
    } else if gates.iter().any(|gate| gate.state == "warning") {
        "warning"
    } else {
        "ready"
    };

    Json(ReadinessResponse {
        overall,
        gates,
        updated_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    })
    .into_response()
}

async fn handle_voices(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }
    let Some(manager) = state.app.try_state::<Arc<TtsManager>>() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "TTS manager is unavailable.".to_string(),
            }),
        )
            .into_response();
    };
    let manager = manager.inner().clone();
    match tokio::task::spawn_blocking(move || manager.get_available_voices()).await {
        Ok(Ok(voices)) => Json::<Vec<VoiceInfo>>(voices).into_response(),
        Ok(Err(error)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("task join: {error}"),
            }),
        )
            .into_response(),
    }
}

async fn handle_tts_profiles(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }
    match list_voice_profiles(&state.app) {
        Ok(profiles) => Json::<Vec<TtsVoiceProfileDescriptor>>(profiles).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
            .into_response(),
    }
}

async fn handle_speak(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<SpeakApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }
    let text = request.text.trim();
    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Text is required.".to_string(),
            }),
        )
            .into_response();
    }
    if text.chars().count() > 20_000 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(ErrorResponse {
                error: "Text is too large for /v1/speak.".to_string(),
            }),
        )
            .into_response();
    }
    let Some(manager) = state.app.try_state::<Arc<TtsManager>>() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "TTS manager is unavailable.".to_string(),
            }),
        )
            .into_response();
    };
    let manager = manager.inner().clone();
    match manager
        .speak(SpeakRequest {
            text: text.to_string(),
            locale: request.locale,
            preferred_voice_id: request.preferred_voice_id,
            preset_id: request.preset_id,
            inline_preset: None,
            trigger: Some("local_api".to_string()),
            remember_last_output: request.remember_last_output.unwrap_or(false),
        })
        .await
    {
        Ok(()) => Json(SpeakApiResponse { status: "ok" }).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
            .into_response(),
    }
}

async fn handle_transcribe(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }

    // Pull the first file field — `file=@audio.wav` matches the way
    // the CLI and most clients (curl, Raycast, Python requests) post
    // audio.
    let mut audio_bytes: Option<Vec<u8>> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: format!("invalid multipart upload: {}", err),
                    }),
                )
                    .into_response();
            }
        };

        if field.name() != Some("file") {
            continue;
        }

        match field.bytes().await {
            Ok(bytes) => {
                audio_bytes = Some(bytes.to_vec());
                break;
            }
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: format!("failed to read file field: {}", err),
                    }),
                )
                    .into_response();
            }
        }
    }

    let Some(bytes) = audio_bytes else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "missing 'file' multipart field".into(),
            }),
        )
            .into_response();
    };

    // Decode WAV → 16 kHz mono f32. We currently only accept WAV uploads
    // here to keep the route ffmpeg-free; clients that want to send mp3
    // can transcode locally first. We can extend later if needed.
    let samples = match decode_wav_bytes(&bytes) {
        Ok(s) => s,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("could not decode WAV upload: {}", err),
                }),
            )
                .into_response();
        }
    };

    let manager = match state.app.try_state::<Arc<TranscriptionManager>>() {
        Some(m) => m.inner().clone(),
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "TranscriptionManager not ready".into(),
                }),
            )
                .into_response();
        }
    };

    let result =
        tokio::task::spawn_blocking(move || manager.transcribe_with_segments(Arc::new(samples)))
            .await;

    match result {
        Ok(Ok((text, segments))) => Json(TranscribeResponse { text, segments }).into_response(),
        Ok(Err(err)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: err.to_string(),
            }),
        )
            .into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("task join: {}", err),
            }),
        )
            .into_response(),
    }
}

fn require_api_token(
    app: &AppHandle,
    headers: &HeaderMap,
) -> Result<(), Box<axum::response::Response>> {
    let mut settings = get_settings(app);
    let expected =
        match crate::secret_store::get_or_create_http_api_token(Some(&settings.http_api_token)) {
            Ok(token) => token,
            Err(err) => {
                warn!("Local API token unavailable: {err}");
                String::new()
            }
        };
    if !settings.http_api_token.trim().is_empty() {
        settings.http_api_token.clear();
        write_settings(app, settings);
    }
    let expected = expected.trim();
    let provided = headers
        .get(API_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .or_else(|| {
            headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(str::trim)
        });

    if !expected.is_empty() && provided == Some(expected) {
        return Ok(());
    }

    Err(Box::new(
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: format!("missing or invalid {API_TOKEN_HEADER}"),
            }),
        )
            .into_response(),
    ))
}

fn decode_wav_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let cursor = Cursor::new(bytes);
    let mut reader = hound::WavReader::new(cursor).map_err(|e| format!("WavReader: {}", e))?;
    let spec = reader.spec();
    if spec.channels == 0 {
        return Err("WAV file has no channels".to_string());
    }
    if spec.sample_rate == 0 {
        return Err("WAV file has no sample rate".to_string());
    }
    if matches!(spec.sample_format, hound::SampleFormat::Int) && spec.bits_per_sample == 0 {
        return Err("WAV integer sample width must be greater than zero".to_string());
    }

    let channels = spec.channels as usize;
    let mut mono: Vec<f32> = Vec::new();
    match spec.sample_format {
        hound::SampleFormat::Float => {
            let all: Vec<f32> = reader
                .samples::<f32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("read float samples: {}", e))?;
            for frame in all.chunks(channels) {
                let sum: f32 = frame.iter().copied().sum();
                mono.push(sum / frame.len() as f32);
            }
        }
        hound::SampleFormat::Int => {
            let all: Vec<i32> = reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("read int samples: {}", e))?;
            let scale = 2f32.powi((spec.bits_per_sample as i32) - 1);
            for frame in all.chunks(channels) {
                let sum: f32 = frame.iter().map(|s| (*s as f32) / scale).sum();
                mono.push(sum / frame.len() as f32);
            }
        }
    }
    if spec.sample_rate == 16_000 {
        return Ok(mono);
    }
    Ok(crate::commands::transcription::resample_linear(
        &mono,
        spec.sample_rate,
        16_000,
    ))
}
