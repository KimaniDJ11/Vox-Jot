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

use crate::commands::story_studio::{
    download_creative_audio_model, generate_story_sound, get_creative_audio_model_catalog,
    render_story_audio, render_story_audio_now, CreativeAudioModelCatalog,
    CreativeAudioModelDescriptor, GenerateStorySoundRequest, StoryAudioItem,
    StoryRenderEnqueueResult, StoryRenderRequest, StoryRenderResult, StorySoundMode,
};
use crate::commands::transcription::{
    CleanAudioFileResult, EnhanceAudioFileResult, EnhanceAudioOptions, TranscriptionFileResult,
};
use crate::commands::tts::{
    preset_from_input, ReaderAudioCacheUnit, ReaderAudioUnitRender, ReaderAudiobookChapter,
    VoiceChangerResult,
};
use crate::commands::{self, audio::AudioDevice};
use crate::correction_tracker::store::CorrectionStore;
use crate::helpers::subtitles::TimedSegment;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::{HistoryEntriesPage, HistoryEntry, HistoryManager};
use crate::managers::model::ModelManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{
    build_tts_preset_from_legacy, TtsVoicePreset, TtsVoicePresetInput, TtsVoiceTuningSettings,
};
use crate::settings::{get_settings, get_settings_without_secrets, write_settings};
use crate::sidecar::SidecarManager;
use crate::tts::{
    run_tts_async_on_dedicated_stack, speak_on_dedicated_thread, SpeakRequest, TtsManager,
    VoiceInfo,
};
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
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

const MAX_TRANSCRIBE_UPLOAD_BYTES: usize = 128 * 1024 * 1024;
const API_TOKEN_HEADER: &str = "x-vox-jot-api-token";

#[derive(Clone)]
pub(crate) struct ApiState {
    pub(crate) app: AppHandle,
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

#[derive(Deserialize)]
struct TtsSynthesizeApiRequest {
    text: String,
    locale: Option<String>,
    preferred_voice_id: Option<String>,
    preset_id: Option<String>,
    inline_preset: Option<TtsVoicePresetInput>,
}

#[derive(Deserialize)]
struct CreativeAudioDownloadApiRequest {
    model_id: String,
}

#[derive(Deserialize)]
struct CreativeAudioGenerateApiRequest {
    prompt: String,
    model_id: String,
    mode: StorySoundMode,
    duration_seconds: u32,
    title: Option<String>,
    project_id: Option<String>,
    seed: Option<u32>,
    render_id: Option<String>,
}

#[derive(Deserialize)]
struct AppShowApiRequest {
    section: Option<String>,
}

#[derive(Deserialize)]
struct ShortcutBindingApiRequest {
    id: String,
    binding: Option<String>,
}

#[derive(Deserialize)]
struct SettingsCommandApiRequest {
    key: String,
    value: Value,
}

#[derive(Deserialize)]
struct DictationControlApiRequest {
    binding_id: Option<String>,
}

#[derive(Deserialize)]
struct SttSelectApiRequest {
    model_id: String,
    provider_id: Option<String>,
}

#[derive(Deserialize)]
struct SttDownloadApiRequest {
    model_id: String,
}

#[derive(Deserialize)]
struct TtsSelectApiRequest {
    provider_id: String,
    model_id: Option<String>,
}

#[derive(Deserialize)]
struct TtsDownloadApiRequest {
    model_id: Option<String>,
    repo_id: Option<String>,
}

#[derive(Deserialize)]
struct ArtifactCancelApiRequest {
    domain: String,
    artifact_id: String,
}

#[derive(Deserialize)]
struct OcrModelApiRequest {
    catalog_id: String,
}

#[derive(Deserialize)]
struct OcrSelectApiRequest {
    neural_model_id: Option<String>,
}

#[derive(Deserialize)]
struct AudioDeviceSelectionApiRequest {
    device_name: String,
}

#[derive(Deserialize)]
struct HistoryPageApiQuery {
    offset: Option<usize>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct RefinePreviewApiRequest {
    text: String,
    app_bundle_id_override: Option<String>,
}

#[derive(Deserialize)]
struct AudioFileApiRequest {
    path: String,
    output_path: Option<String>,
}

#[derive(Deserialize)]
struct AudioEnhanceApiRequest {
    path: String,
    output_path: Option<String>,
    options: Option<EnhanceAudioOptions>,
}

#[derive(Deserialize)]
struct ReaderDocumentApiRequest {
    source_path: String,
}

#[derive(Deserialize)]
struct ReaderSectionVoiceApiRequest {
    section_index: usize,
    preset_id: Option<String>,
    enabled: Option<bool>,
}

#[derive(Deserialize)]
struct ReaderExportAudioApiRequest {
    source_path: String,
    output_path: Option<String>,
    format: Option<String>,
    playback_rate: Option<f32>,
    language: Option<String>,
    title: Option<String>,
    author: Option<String>,
    default_preset_id: Option<String>,
    section_voices: Option<Vec<ReaderSectionVoiceApiRequest>>,
    max_units: Option<usize>,
}

#[derive(Serialize)]
struct ReaderExportAudioApiResponse {
    document_id: String,
    document_name: String,
    section_count: usize,
    unit_count: usize,
    output_path: String,
    duration_ms: u32,
    format: String,
}

#[derive(Deserialize)]
struct ReaderSynthesizeUnitApiRequest {
    document_id: String,
    unit: ReaderAudioCacheUnit,
    playback_rate: Option<f32>,
    language: Option<String>,
}

#[derive(Deserialize)]
struct ReaderTransformApiRequest {
    text: String,
    task: String,
}

#[derive(Deserialize)]
struct VoiceProfileCreateApiRequest {
    label: String,
    description: Option<String>,
    transcript: Option<String>,
}

#[derive(Deserialize)]
struct VoiceProfileImportApiRequest {
    profile_id: String,
    source_path: String,
    transcript: Option<String>,
}

#[derive(Deserialize)]
struct TtsPresetActiveApiRequest {
    preset_id: String,
}

#[derive(Deserialize)]
struct VoiceCloneSynthesizeApiRequest {
    text: String,
    profile_id: String,
    provider_id: Option<String>,
    model_id: Option<String>,
    voice_id: Option<String>,
    label: Option<String>,
    locale: Option<String>,
    tuning: Option<TtsVoiceTuningSettings>,
}

#[derive(Deserialize)]
struct VoiceChangerConvertApiRequest {
    source_path: String,
    profile_id: String,
    tau: Option<f32>,
    provider_id: Option<String>,
    model_id: Option<String>,
}

#[derive(Serialize)]
struct SettingFieldDescriptor {
    key: String,
    value_type: &'static str,
    patchable: bool,
    route: Option<&'static str>,
    note: Option<&'static str>,
}

#[derive(Serialize)]
struct SettingsSchemaResponse {
    fields: Vec<SettingFieldDescriptor>,
    protected_fields: Vec<String>,
}

#[derive(Serialize)]
struct SpeakApiResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct TtsSynthesizeApiResponse {
    status: &'static str,
    output_paths: Vec<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct DictationStatusResponse {
    recording: bool,
    current_model: Option<String>,
}

#[derive(Serialize)]
struct DictationControlResponse {
    status: &'static str,
    binding_id: String,
    recording: bool,
}

#[derive(Serialize)]
struct AudioDevicesResponse {
    microphones: Vec<AudioDevice>,
    selected_microphone: String,
    output_devices: Vec<AudioDevice>,
    selected_output_device: String,
    clamshell_microphone: String,
    always_on_microphone: bool,
    recording: bool,
}

#[derive(Serialize)]
struct DownloadResponse {
    status: &'static str,
    path: Option<String>,
}

#[derive(Serialize)]
struct SettingsPatchResponse {
    status: &'static str,
    updated_keys: Vec<String>,
    settings: crate::settings::AppSettings,
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
            .route("/v1/app/settings", get(handle_app_settings))
            .route(
                "/v1/settings",
                get(handle_app_settings).post(handle_settings_patch),
            )
            .route("/v1/settings/schema", get(handle_settings_schema))
            .route("/v1/settings/patch", post(handle_settings_patch))
            .route("/v1/settings/command", post(handle_settings_command))
            .route("/v1/settings/shortcut", post(handle_shortcut_binding))
            .route("/v1/settings/shortcut/reset", post(handle_shortcut_reset))
            .route("/v1/app/show", post(handle_app_show))
            .route("/v1/app/cancel", post(handle_app_cancel))
            .route("/v1/dictation/status", get(handle_dictation_status))
            .route("/v1/dictation/start", post(handle_dictation_start))
            .route("/v1/dictation/stop", post(handle_dictation_stop))
            .route("/v1/dictation/toggle", post(handle_dictation_toggle))
            .route("/v1/model-platform", get(handle_model_platform))
            .route("/v1/models/stt/select", post(handle_stt_select))
            .route("/v1/models/stt/download", post(handle_stt_download))
            .route("/v1/models/tts/select", post(handle_tts_select))
            .route("/v1/models/tts/download", post(handle_tts_download))
            .route("/v1/models/downloads/cancel", post(handle_cancel_download))
            .route("/v1/ocr/models", get(handle_ocr_models))
            .route("/v1/ocr/download", post(handle_ocr_download))
            .route("/v1/ocr/prepare", post(handle_ocr_prepare))
            .route("/v1/ocr/select", post(handle_ocr_select))
            .route("/v1/ocr/downloads", get(handle_ocr_downloads))
            .route("/v1/audio/devices", get(handle_audio_devices))
            .route("/v1/audio/microphone", post(handle_set_microphone))
            .route("/v1/audio/output", post(handle_set_output_device))
            .route("/v1/audio/transcribe-file", post(handle_transcribe_file))
            .route("/v1/audio/clean", post(handle_audio_clean))
            .route("/v1/audio/enhance", post(handle_audio_enhance))
            .route(
                "/v1/audio/clamshell-microphone",
                post(handle_set_clamshell_microphone),
            )
            .route(
                "/v1/history",
                get(handle_history_page_default).post(handle_history_page),
            )
            .route("/v1/history/latest", get(handle_latest_history))
            .route("/v1/stats/dictation", get(handle_dictation_stats))
            .route(
                "/v1/screen-context/diagnostics",
                get(handle_screen_context_diagnostics),
            )
            .route("/v1/refine/preview", post(handle_refine_preview))
            .route("/v1/models", get(handle_models))
            .route("/v1/voices", get(handle_voices))
            .route("/v1/speak", post(handle_speak))
            .route("/v1/tts/synthesize", post(handle_tts_synthesize))
            .route(
                "/v1/tts/presets",
                get(handle_tts_presets).post(handle_tts_preset_create),
            )
            .route("/v1/tts/presets/active", post(handle_tts_preset_active))
            .route(
                "/v1/tts/profiles",
                get(handle_tts_profiles).post(handle_voice_profile_create),
            )
            .route(
                "/v1/tts/profiles/import-sample",
                post(handle_voice_profile_import_sample),
            )
            .route(
                "/v1/voice-clone/profiles",
                get(handle_tts_profiles).post(handle_voice_profile_create),
            )
            .route(
                "/v1/voice-clone/import-sample",
                post(handle_voice_profile_import_sample),
            )
            .route(
                "/v1/voice-clone/synthesize",
                post(handle_voice_clone_synthesize),
            )
            .route(
                "/v1/voice-changer/convert",
                post(handle_voice_changer_convert),
            )
            .route("/v1/reader/documents", get(handle_reader_documents))
            .route("/v1/reader/document", post(handle_reader_document))
            .route("/v1/reader/export-audio", post(handle_reader_export_audio))
            .route(
                "/v1/reader/synthesize-unit",
                post(handle_reader_synthesize_unit),
            )
            .route("/v1/reader/transform", post(handle_reader_transform))
            .route(
                "/v1/creative-audio/models",
                get(handle_creative_audio_models),
            )
            .route(
                "/v1/creative-audio/download",
                post(handle_creative_audio_download),
            )
            .route(
                "/v1/creative-audio/generate",
                post(handle_creative_audio_generate),
            )
            .route("/v1/story/audio", get(handle_story_audio))
            .route("/v1/story/jobs", get(handle_story_jobs))
            .route("/v1/story/render", post(handle_story_render))
            .route("/v1/story/render-sync", post(handle_story_render_sync))
            .route("/v1/transcribe", post(handle_transcribe))
            .route("/mcp", post(crate::mcp::handle_mcp))
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

fn require_authorized(
    app: &AppHandle,
    headers: &HeaderMap,
) -> Result<(), Box<axum::response::Response>> {
    require_api_token(app, headers)
}

fn api_error(status: StatusCode, error: impl Into<String>) -> axum::response::Response {
    (
        status,
        Json(ErrorResponse {
            error: error.into(),
        }),
    )
        .into_response()
}

fn ok_response() -> axum::response::Response {
    Json(StatusResponse { status: "ok" }).into_response()
}

async fn handle_app_settings(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    Json(get_settings_without_secrets(&state.app)).into_response()
}

async fn handle_settings_schema(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match settings_schema_for_app(&state.app) {
        Ok(schema) => Json(schema).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_settings_patch(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let updates = match extract_settings_updates(body) {
        Ok(updates) => updates,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, error),
    };

    match apply_settings_patch(&state.app, updates) {
        Ok((updated_keys, settings)) => Json(SettingsPatchResponse {
            status: "ok",
            updated_keys,
            settings,
        })
        .into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn handle_settings_command(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<SettingsCommandApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match apply_settings_command(&state.app, request.key, request.value) {
        Ok(updated_keys) => Json(SettingsPatchResponse {
            status: "ok",
            updated_keys,
            settings: get_settings_without_secrets(&state.app),
        })
        .into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn handle_shortcut_binding(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ShortcutBindingApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let Some(binding) = request
        .binding
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return api_error(StatusCode::BAD_REQUEST, "binding is required.");
    };

    match crate::shortcut::change_binding(state.app.clone(), request.id, binding.to_string()) {
        Ok(response) => Json(response).into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn handle_shortcut_reset(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ShortcutBindingApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match crate::shortcut::reset_binding(state.app.clone(), request.id) {
        Ok(response) => Json(response).into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

fn protected_settings_route(key: &str) -> Option<(&'static str, &'static str)> {
    match key {
        "http_api_token" => Some(("protected", "Local API token lives in the OS credential store.")),
        "post_process_api_keys" => {
            Some(("protected", "Provider API keys live in the OS credential store."))
        }
        "post_process_api_key_status" => Some((
            "protected",
            "API key status is derived from the credential store; update keys through provider-specific commands.",
        )),
        "bindings" => Some((
            "/v1/settings/shortcut",
            "Shortcut bindings require registration side effects.",
        )),
        "selected_model" | "selected_stt_provider_id" | "selected_stt_model_id" => Some((
            "/v1/models/stt/select",
            "STT selection requires model load side effects.",
        )),
        "selected_tts_provider_id" | "selected_tts_model_id" | "selected_tts_voice_id"
        | "selected_tts_profile_id" => Some((
            "/v1/models/tts/select",
            "TTS selection should stay synchronized with the runtime catalog.",
        )),
        "selected_creative_audio_model_id" => Some((
            "/v1/settings/command",
            "Creative Audio model selection validates install/runtime readiness.",
        )),
        "tts_engine_preference" | "tts_default_voice_id" | "tts_rate" | "tts_volume" => Some((
            "/v1/settings/command",
            "TTS preference settings synchronize related voice/provider fields or clamp values.",
        )),
        "speech_runtime_path" | "tts_model_store_path" => Some((
            "/v1/settings/command",
            "Runtime path settings are trimmed and normalized before saving.",
        )),
        "audio_enhancement_enabled" | "audio_enhancement_model" => Some((
            "/v1/settings/command",
            "Audio enhancement changes refresh the active audio pipeline.",
        )),
        "screen_context_ocr_neural_model_id" => Some((
            "/v1/ocr/select",
            "OCR model selection validates install/runtime readiness.",
        )),
        "autostart_enabled" | "update_checks_enabled" | "enable_crash_reporting"
        | "keyboard_implementation" => Some((
            "/v1/settings/command",
            "This setting applies runtime platform side effects.",
        )),
        "post_process_enabled" | "local_privacy_mode" | "post_process_provider_id"
        | "post_process_models" | "selected_llm_provider_id" | "selected_llm_model_id"
        | "post_process_cleanup_level" | "max_rewrite_strength" | "post_process_providers" => {
            Some((
                "/v1/settings/command",
                "Post-processing settings validate providers and synchronize related LLM fields.",
            ))
        },
        "translate_to_english"
        | "translation_route_preference"
        | "translation_provider_id"
        | "translation_model_ids" => Some((
            "/v1/settings/command",
            "Translation settings validate providers and local privacy constraints.",
        )),
        "overlay_position" | "recording_overlay_style" => Some((
            "/v1/settings/command",
            "Overlay settings apply to live windows immediately.",
        )),
        "debug_mode" | "show_technical_features" | "start_hidden" => Some((
            "/v1/settings/command",
            "This setting emits runtime state updates after saving.",
        )),
        "screen_context_enabled"
        | "screen_context_excluded_bundle_ids"
        | "screen_context_pause_on_idle"
        | "screen_context_idle_threshold_ms"
        | "context_capture_mode"
        | "screen_context_ocr_quality"
        | "screen_context_ocr_engine"
        | "screen_context_ocr_timeout_ms"
        | "screen_context_token_budget"
        | "screen_context_stale_threshold_ms" => Some((
            "/v1/settings/command",
            "Screen-context settings use command validation, clamping, or UI notification side effects.",
        )),
        "app_theme" | "app_font_scale" => Some((
            "/v1/settings/command",
            "Appearance settings are validated or clamped before saving.",
        )),
        "external_script_path" => Some((
            "/v1/settings/command",
            "External paste scripts must be absolute executable paths.",
        )),
        "app_language" => Some((
            "/v1/settings/command",
            "Changing app language refreshes the tray menu.",
        )),
        "selected_microphone" => Some((
            "/v1/audio/microphone",
            "Microphone selection updates the active audio manager.",
        )),
        "selected_output_device" => Some((
            "/v1/audio/output",
            "Output-device selection has a dedicated audio route.",
        )),
        "clamshell_microphone" => Some((
            "/v1/audio/clamshell-microphone",
            "Clamshell microphone selection has a dedicated audio route.",
        )),
        "http_api_enabled" | "http_api_port" => Some((
            "Settings > Diagnostics",
            "Changing the running API server from inside its own request is intentionally blocked.",
        )),
        _ => None,
    }
}

fn is_patchable_setting(key: &str) -> bool {
    protected_settings_route(key).is_none()
}

fn settings_schema_for_app(app: &AppHandle) -> Result<SettingsSchemaResponse, String> {
    let settings = get_settings_without_secrets(app);
    let value = serde_json::to_value(settings)
        .map_err(|err| format!("Failed to serialize settings: {err}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Settings did not serialize to an object.".to_string())?;

    let mut fields = object
        .iter()
        .map(|(key, value)| {
            let route = protected_settings_route(key);
            SettingFieldDescriptor {
                key: key.clone(),
                value_type: json_value_type(value),
                patchable: is_patchable_setting(key),
                route: route.map(|(route, _)| route),
                note: route.map(|(_, note)| note),
            }
        })
        .collect::<Vec<_>>();
    fields.sort_by(|a, b| a.key.cmp(&b.key));

    let protected_fields = fields
        .iter()
        .filter(|field| !field.patchable)
        .map(|field| field.key.clone())
        .collect();

    Ok(SettingsSchemaResponse {
        fields,
        protected_fields,
    })
}

fn json_value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn extract_settings_updates(body: Value) -> Result<Map<String, Value>, String> {
    let object = body
        .as_object()
        .ok_or_else(|| "Expected a JSON object or { \"updates\": { ... } }.".to_string())?;
    if let Some(updates) = object.get("updates") {
        return updates
            .as_object()
            .cloned()
            .ok_or_else(|| "updates must be a JSON object.".to_string());
    }
    Ok(object.clone())
}

fn apply_settings_patch(
    app: &AppHandle,
    updates: Map<String, Value>,
) -> Result<(Vec<String>, crate::settings::AppSettings), String> {
    if updates.is_empty() {
        return Err("At least one setting update is required.".to_string());
    }

    let current = get_settings_without_secrets(app);
    let mut value = serde_json::to_value(current)
        .map_err(|err| format!("Failed to serialize current settings: {err}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Settings did not serialize to an object.".to_string())?;

    let mut updated_keys = Vec::new();
    for (key, next_value) in updates {
        if let Some((route, note)) = protected_settings_route(&key) {
            return Err(format!(
                "'{key}' is not patchable through /v1/settings/patch. Use {route}. {note}"
            ));
        }
        if !object.contains_key(&key) {
            return Err(format!("Unknown setting field: '{key}'."));
        }
        object.insert(key.clone(), next_value);
        updated_keys.push(key);
    }

    let next_settings = serde_json::from_value::<crate::settings::AppSettings>(value)
        .map_err(|err| format!("Invalid settings patch: {err}"))?;
    apply_settings_patch_side_effects(app, &updated_keys, &next_settings)?;
    write_settings(app, next_settings);
    Ok((updated_keys, get_settings_without_secrets(app)))
}

fn apply_settings_command(
    app: &AppHandle,
    key: String,
    value: Value,
) -> Result<Vec<String>, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("key is required.".to_string());
    }

    match key {
        "keyboard_implementation" => crate::shortcut::change_keyboard_implementation_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string(), "bindings".to_string()]),
        "autostart_enabled" => {
            crate::shortcut::change_autostart_setting(app.clone(), setting_bool(&value, key)?)?;
            Ok(vec![key.to_string()])
        }
        "update_checks_enabled" => {
            crate::shortcut::change_update_checks_setting(app.clone(), setting_bool(&value, key)?)?;
            Ok(vec![key.to_string()])
        }
        "enable_crash_reporting" => crate::shortcut::change_crash_reporting_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "audio_enhancement_enabled" => crate::shortcut::change_audio_enhancement_enabled_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "audio_enhancement_model" => crate::shortcut::change_audio_enhancement_model_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "app_theme" => crate::shortcut::change_app_theme_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "app_font_scale" => {
            crate::shortcut::change_app_font_scale_setting(app.clone(), setting_f32(&value, key)?)?;
            Ok(vec![key.to_string()])
        },
        "translate_to_english" => crate::shortcut::change_translate_to_english_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| {
            vec![
                key.to_string(),
                "translation_output_mode".to_string(),
                "translation_target_language".to_string(),
                "translation_route_preference".to_string(),
            ]
        }),
        "translation_route_preference" => crate::shortcut::change_translation_route_preference_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "overlay_position" => crate::shortcut::change_overlay_position_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "recording_overlay_style" => crate::shortcut::change_recording_overlay_style_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "debug_mode" => crate::shortcut::change_debug_mode_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| vec![key.to_string(), "log_level".to_string()]),
        "show_technical_features" => crate::shortcut::change_show_technical_features_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "start_hidden" => crate::shortcut::change_start_hidden_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "screen_context_enabled" => crate::shortcut::change_screen_context_enabled_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "screen_context_excluded_bundle_ids" => {
            crate::shortcut::change_screen_context_excluded_bundle_ids_setting(
                app.clone(),
                setting_string_vec(&value, key)?,
            )?;
            Ok(vec![key.to_string()])
        },
        "screen_context_pause_on_idle" => {
            crate::shortcut::change_screen_context_pause_on_idle_setting(
                app.clone(),
                setting_bool(&value, key)?,
            )?;
            Ok(vec![key.to_string()])
        },
        "screen_context_idle_threshold_ms" => {
            crate::shortcut::change_screen_context_idle_threshold_ms_setting(
                app.clone(),
                setting_u32(&value, key)?,
            )?;
            Ok(vec![key.to_string()])
        },
        "context_capture_mode" => crate::shortcut::change_context_capture_mode_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "screen_context_ocr_quality" => crate::shortcut::change_screen_context_ocr_quality_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "screen_context_ocr_engine" => crate::shortcut::change_screen_context_ocr_engine_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "screen_context_ocr_timeout_ms" => {
            crate::shortcut::change_screen_context_ocr_timeout_ms_setting(
                app.clone(),
                setting_u32(&value, key)?,
            )?;
            Ok(vec![key.to_string()])
        },
        "screen_context_token_budget" => {
            crate::shortcut::change_screen_context_token_budget_setting(
                app.clone(),
                setting_u32(&value, key)?,
            )?;
            Ok(vec![key.to_string()])
        },
        "screen_context_stale_threshold_ms" => {
            crate::shortcut::change_screen_context_stale_threshold_ms_setting(
                app.clone(),
                setting_u32(&value, key)?,
            )?;
            Ok(vec![key.to_string()])
        },
        "speech_runtime_path" => crate::shortcut::change_speech_runtime_path_setting(
            app.clone(),
            setting_optional_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "tts_model_store_path" => crate::shortcut::change_tts_model_store_path_setting(
            app.clone(),
            setting_optional_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "tts_engine_preference" => crate::shortcut::change_tts_engine_preference_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| {
            vec![
                key.to_string(),
                "selected_tts_provider_id".to_string(),
                "selected_tts_model_id".to_string(),
            ]
        }),
        "tts_default_voice_id" => crate::shortcut::change_tts_default_voice_id_setting(
            app.clone(),
            setting_optional_string(&value, key)?,
        )
        .map(|_| {
            vec![
                key.to_string(),
                "selected_tts_voice_id".to_string(),
                "selected_tts_model_id".to_string(),
            ]
        }),
        "tts_rate" => {
            crate::shortcut::change_tts_rate_setting(app.clone(), setting_f32(&value, key)?)?;
            Ok(vec![key.to_string()])
        }
        "tts_volume" => {
            crate::shortcut::change_tts_volume_setting(app.clone(), setting_f32(&value, key)?)?;
            Ok(vec![key.to_string()])
        }
        "selected_creative_audio_model_id" => {
            commands::story_studio::set_creative_audio_model_selection(
                app.clone(),
                setting_string(&value, key)?,
            )?;
            Ok(vec![key.to_string()])
        }
        "post_process_enabled" => crate::shortcut::change_post_process_enabled_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "local_privacy_mode" => crate::shortcut::change_local_privacy_mode_setting(
            app.clone(),
            setting_bool(&value, key)?,
        )
        .map(|_| {
            vec![
                key.to_string(),
                "post_process_provider_id".to_string(),
                "translation_provider_id".to_string(),
            ]
        }),
        "post_process_provider_id" | "selected_llm_provider_id" => {
            crate::shortcut::set_post_process_provider(app.clone(), setting_string(&value, key)?)?;
            Ok(vec![
                "post_process_provider_id".to_string(),
                "selected_llm_provider_id".to_string(),
                "selected_llm_model_id".to_string(),
            ])
        },
        "post_process_models" => {
            let (provider_id, model) = provider_model_from_value(&value, key)?;
            crate::shortcut::change_post_process_model_setting(app.clone(), provider_id, model)?;
            Ok(vec![
                "post_process_models".to_string(),
                "selected_llm_model_id".to_string(),
            ])
        },
        "selected_llm_model_id" => {
            let settings = get_settings_without_secrets(app);
            crate::shortcut::change_post_process_model_setting(
                app.clone(),
                settings.post_process_provider_id,
                setting_string(&value, key)?,
            )?;
            Ok(vec![
                "post_process_models".to_string(),
                "selected_llm_model_id".to_string(),
            ])
        }
        "post_process_cleanup_level" => crate::shortcut::change_post_process_cleanup_level_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| {
            vec![
                key.to_string(),
                "post_process_mode".to_string(),
                "max_rewrite_strength".to_string(),
            ]
        }),
        "max_rewrite_strength" => crate::shortcut::change_max_rewrite_strength_setting(
            app.clone(),
            setting_u8(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "post_process_providers" => {
            let (provider_id, base_url) = provider_base_url_from_value(&value, key)?;
            crate::shortcut::change_post_process_base_url_setting(
                app.clone(),
                provider_id,
                base_url,
            )?;
            Ok(vec![key.to_string()])
        },
        "translation_provider_id" => {
            crate::shortcut::set_translation_provider(app.clone(), setting_string(&value, key)?)?;
            Ok(vec![key.to_string()])
        },
        "translation_model_ids" => {
            let (provider_id, model) = provider_model_from_value(&value, key)?;
            crate::shortcut::change_translation_model_setting(app.clone(), provider_id, model)?;
            Ok(vec![key.to_string()])
        },
        "external_script_path" => crate::shortcut::change_external_script_path_setting(
            app.clone(),
            setting_optional_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        "app_language" => crate::shortcut::change_app_language_setting(
            app.clone(),
            setting_string(&value, key)?,
        )
        .map(|_| vec![key.to_string()]),
        _ => Err(format!(
            "'{key}' is not a command-backed setting. Use /v1/settings/patch for patchable fields or /v1/settings/schema for routing."
        )),
    }
}

fn setting_bool(value: &Value, key: &str) -> Result<bool, String> {
    value
        .as_bool()
        .ok_or_else(|| format!("'{key}' expects a boolean value."))
}

fn setting_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("'{key}' expects a non-empty string value."))
}

fn setting_optional_string(value: &Value, key: &str) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .ok_or_else(|| format!("'{key}' expects a string or null value."))
}

fn setting_f32(value: &Value, key: &str) -> Result<f32, String> {
    value
        .as_f64()
        .map(|value| value as f32)
        .ok_or_else(|| format!("'{key}' expects a numeric value."))
}

fn setting_u8(value: &Value, key: &str) -> Result<u8, String> {
    let number = value
        .as_u64()
        .ok_or_else(|| format!("'{key}' expects an unsigned integer value."))?;
    u8::try_from(number).map_err(|_| format!("'{key}' is too large."))
}

fn setting_u32(value: &Value, key: &str) -> Result<u32, String> {
    let number = value
        .as_u64()
        .ok_or_else(|| format!("'{key}' expects an unsigned integer value."))?;
    u32::try_from(number).map_err(|_| format!("'{key}' is too large."))
}

fn setting_string_vec(value: &Value, key: &str) -> Result<Vec<String>, String> {
    let values = value
        .as_array()
        .ok_or_else(|| format!("'{key}' expects an array of strings."))?;
    values
        .iter()
        .map(|value| setting_string(value, key))
        .collect()
}

fn provider_model_from_value(value: &Value, key: &str) -> Result<(String, String), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("'{key}' expects an object value."))?;

    if let (Some(provider_id), Some(model)) = (object.get("provider_id"), object.get("model")) {
        return Ok((
            setting_string(provider_id, "provider_id")?,
            setting_string(model, "model")?,
        ));
    }

    if object.len() == 1 {
        let (provider_id, model) = object.iter().next().expect("object has one entry");
        return Ok((provider_id.clone(), setting_string(model, provider_id)?));
    }

    Err(format!(
        "'{key}' expects {{ \"provider_id\": string, \"model\": string }} or a one-entry provider map."
    ))
}

fn provider_base_url_from_value(value: &Value, key: &str) -> Result<(String, String), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("'{key}' expects an object value."))?;
    let provider_id = object
        .get("provider_id")
        .ok_or_else(|| format!("'{key}' requires provider_id."))?;
    let base_url = object
        .get("base_url")
        .ok_or_else(|| format!("'{key}' requires base_url."))?;
    Ok((
        setting_string(provider_id, "provider_id")?,
        setting_string(base_url, "base_url")?,
    ))
}

fn apply_settings_patch_side_effects(
    app: &AppHandle,
    updated_keys: &[String],
    settings: &crate::settings::AppSettings,
) -> Result<(), String> {
    if updated_keys.iter().any(|key| key == "always_on_microphone") {
        let Some(audio_manager) = app.try_state::<Arc<AudioRecordingManager>>() else {
            return Err("AudioRecordingManager is unavailable.".to_string());
        };
        let mode = if settings.always_on_microphone {
            crate::managers::audio::MicrophoneMode::AlwaysOn
        } else {
            crate::managers::audio::MicrophoneMode::OnDemand
        };
        audio_manager
            .update_mode(mode)
            .map_err(|err| format!("Failed to update microphone mode: {err}"))?;
    }

    if updated_keys.iter().any(|key| key == "show_tray_icon") {
        crate::tray::set_tray_visibility(app, settings.show_tray_icon);
    }

    if updated_keys.iter().any(|key| key == "log_level") {
        let tauri_log_level: tauri_plugin_log::LogLevel = settings.log_level.into();
        let log_level: log::Level = tauri_log_level.into();
        crate::FILE_LOG_LEVEL.store(
            log_level.to_level_filter() as u8,
            std::sync::atomic::Ordering::Relaxed,
        );
    }

    Ok(())
}

async fn handle_app_show(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AppShowApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    if let Some(section) = request.section.filter(|section| !section.trim().is_empty()) {
        crate::detail_view::show_detail_view(&state.app, section.trim());
    } else {
        crate::show_main_window(&state.app);
    }
    ok_response()
}

async fn handle_app_cancel(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    crate::utils::cancel_current_operation(&state.app);
    ok_response()
}

async fn handle_dictation_status(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let recording = state
        .app
        .try_state::<Arc<AudioRecordingManager>>()
        .is_some_and(|manager| manager.is_recording());
    let current_model = state
        .app
        .try_state::<Arc<TranscriptionManager>>()
        .and_then(|manager| manager.get_current_model());

    Json(DictationStatusResponse {
        recording,
        current_model,
    })
    .into_response()
}

async fn handle_dictation_start(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<DictationControlApiRequest>,
) -> axum::response::Response {
    handle_dictation_control(state, headers, request, DictationControlVerb::Start)
}

async fn handle_dictation_stop(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<DictationControlApiRequest>,
) -> axum::response::Response {
    handle_dictation_control(state, headers, request, DictationControlVerb::Stop)
}

async fn handle_dictation_toggle(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<DictationControlApiRequest>,
) -> axum::response::Response {
    handle_dictation_control(state, headers, request, DictationControlVerb::Toggle)
}

enum DictationControlVerb {
    Start,
    Stop,
    Toggle,
}

fn handle_dictation_control(
    state: ApiState,
    headers: HeaderMap,
    request: DictationControlApiRequest,
    verb: DictationControlVerb,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let binding_id = match normalize_api_binding_id(request.binding_id.as_deref()) {
        Ok(binding_id) => binding_id,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, error),
    };

    let recording = state
        .app
        .try_state::<Arc<AudioRecordingManager>>()
        .is_some_and(|manager| manager.is_recording());

    let Some(coordinator) = state.app.try_state::<crate::TranscriptionCoordinator>() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TranscriptionCoordinator is unavailable.",
        );
    };

    let status = match verb {
        DictationControlVerb::Start if recording => "already_recording",
        DictationControlVerb::Start => {
            coordinator.send_input(&binding_id, "Local API", true, false);
            "started"
        }
        DictationControlVerb::Stop if !recording => "idle",
        DictationControlVerb::Stop => {
            coordinator.send_input(&binding_id, "Local API", true, false);
            "stopping"
        }
        DictationControlVerb::Toggle => {
            coordinator.send_input(&binding_id, "Local API", true, false);
            if recording {
                "stopping"
            } else {
                "started"
            }
        }
    };

    Json(DictationControlResponse {
        status,
        binding_id,
        recording,
    })
    .into_response()
}

fn normalize_api_binding_id(binding_id: Option<&str>) -> Result<String, String> {
    let binding_id = binding_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("transcribe");
    if crate::transcription_coordinator::is_transcribe_binding(binding_id) {
        Ok(binding_id.to_string())
    } else {
        Err(format!(
            "Unsupported dictation binding '{}'. Use transcribe, transcribe_with_post_process, or rewrite_selection.",
            binding_id
        ))
    }
}

async fn handle_model_platform(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::models::get_model_platform_overview(state.app.clone()).await {
        Ok(overview) => Json(overview).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_stt_select(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<SttSelectApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let Some(model_manager) = state.app.try_state::<Arc<ModelManager>>() else {
        return api_error(StatusCode::SERVICE_UNAVAILABLE, "ModelManager not ready.");
    };
    let Some(transcription_manager) = state.app.try_state::<Arc<TranscriptionManager>>() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TranscriptionManager not ready.",
        );
    };

    let model_manager = model_manager.inner().clone();
    let transcription_manager = transcription_manager.inner().clone();
    let result = if let Some(provider_id) = request
        .provider_id
        .as_deref()
        .map(str::trim)
        .filter(|provider_id| !provider_id.is_empty())
    {
        commands::models::set_stt_platform_selection_impl(
            state.app.clone(),
            model_manager,
            transcription_manager,
            provider_id.to_string(),
            request.model_id,
        )
        .await
    } else {
        commands::models::set_active_model_impl(
            state.app.clone(),
            model_manager,
            transcription_manager,
            request.model_id,
        )
        .await
    };

    match result {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_stt_download(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<SttDownloadApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let Some(model_manager) = state.app.try_state::<Arc<ModelManager>>() else {
        return api_error(StatusCode::SERVICE_UNAVAILABLE, "ModelManager not ready.");
    };
    match model_manager
        .inner()
        .clone()
        .download_model(&request.model_id)
        .await
    {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn handle_tts_select(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<TtsSelectApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::models::set_tts_platform_selection(
        state.app.clone(),
        request.provider_id,
        request.model_id,
    )
    .await
    {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_tts_download(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<TtsDownloadApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    if let Some(repo_id) = request
        .repo_id
        .as_deref()
        .map(str::trim)
        .filter(|repo_id| !repo_id.is_empty())
    {
        return match commands::models::download_hf_tts_repo_impl(&state.app, repo_id).await {
            Ok(path) => Json(DownloadResponse {
                status: "ok",
                path: Some(path.display().to_string()),
            })
            .into_response(),
            Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
        };
    }

    let Some(model_id) = request
        .model_id
        .as_deref()
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
    else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Either model_id or repo_id is required.",
        );
    };

    let Some(manager) = state.app.try_state::<Arc<TtsManager>>() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TTS manager is unavailable.",
        );
    };
    match manager.inner().download_pack(model_id, None).await {
        Ok(()) => Json(DownloadResponse {
            status: "ok",
            path: None,
        })
        .into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_cancel_download(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ArtifactCancelApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::models::cancel_artifact_download(request.domain, request.artifact_id) {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::NOT_FOUND, error),
    }
}

async fn handle_ocr_models(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match crate::ocr_models::get_ocr_model_catalog_impl(&state.app) {
        Ok(catalog) => Json(catalog).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_ocr_download(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<OcrModelApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match crate::ocr_models::download_ocr_model_impl(&state.app, request.catalog_id).await {
        Ok(model) => Json(model).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_ocr_prepare(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<OcrModelApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match crate::ocr_models::prepare_ocr_runtime_impl(&state.app, request.catalog_id).await {
        Ok(model) => Json(model).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_ocr_select(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<OcrSelectApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match crate::ocr_models::set_ocr_model_selection_impl(&state.app, request.neural_model_id) {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_ocr_downloads(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    Json(crate::ocr_models::get_active_ocr_downloads_impl().await).into_response()
}

async fn handle_audio_devices(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let microphones = match commands::audio::get_available_microphones() {
        Ok(devices) => devices,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    let output_devices = match commands::audio::get_available_output_devices() {
        Ok(devices) => devices,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    let selected_microphone = match commands::audio::get_selected_microphone(state.app.clone()) {
        Ok(device) => device,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    let selected_output_device =
        match commands::audio::get_selected_output_device(state.app.clone()) {
            Ok(device) => device,
            Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
        };
    let clamshell_microphone = match commands::audio::get_clamshell_microphone(state.app.clone()) {
        Ok(device) => device,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    let always_on_microphone = match commands::audio::get_microphone_mode(state.app.clone()) {
        Ok(mode) => mode,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    let recording = commands::audio::is_recording(state.app.clone());

    Json(AudioDevicesResponse {
        microphones,
        selected_microphone,
        output_devices,
        selected_output_device,
        clamshell_microphone,
        always_on_microphone,
        recording,
    })
    .into_response()
}

async fn handle_transcribe_file(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AudioFileApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let path = request.path.trim();
    if path.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "Audio file path is required.");
    }
    let Some(transcription_manager) = state.app.try_state::<Arc<TranscriptionManager>>() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TranscriptionManager not ready.",
        );
    };
    let Some(sidecar_manager) = state.app.try_state::<Arc<SidecarManager>>() else {
        return api_error(StatusCode::SERVICE_UNAVAILABLE, "SidecarManager not ready.");
    };
    let Some(correction_store) = state.app.try_state::<Arc<CorrectionStore>>() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "CorrectionStore not ready.",
        );
    };
    let app = state.app.clone();
    let transcription_manager = Arc::clone(&*transcription_manager);
    let sidecar_manager = Arc::clone(&*sidecar_manager);
    let correction_store = Arc::clone(&*correction_store);

    match commands::transcription::transcribe_file_impl(
        app,
        transcription_manager,
        sidecar_manager,
        correction_store,
        path.to_string(),
    )
    .await
    {
        Ok(result) => Json::<TranscriptionFileResult>(result).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_audio_clean(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AudioFileApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    let path = request.path.trim();
    if path.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "Audio file path is required.");
    }

    match commands::transcription::clean_audio_file(path.to_string(), request.output_path).await {
        Ok(result) => Json::<CleanAudioFileResult>(result).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_audio_enhance(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AudioEnhanceApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    let path = request.path.trim();
    if path.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "Audio file path is required.");
    }

    match commands::transcription::enhance_audio_file(
        state.app,
        path.to_string(),
        request.output_path,
        request.options,
    )
    .await
    {
        Ok(result) => Json::<EnhanceAudioFileResult>(result).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_set_microphone(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AudioDeviceSelectionApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::audio::set_selected_microphone(state.app.clone(), request.device_name) {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_set_output_device(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AudioDeviceSelectionApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::audio::set_selected_output_device(state.app.clone(), request.device_name) {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_set_clamshell_microphone(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AudioDeviceSelectionApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::audio::set_clamshell_microphone(state.app.clone(), request.device_name) {
        Ok(()) => ok_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_history_page(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(query): Json<HistoryPageApiQuery>,
) -> axum::response::Response {
    history_page_response(state, headers, query.offset, query.limit).await
}

async fn handle_history_page_default(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    history_page_response(state, headers, None, None).await
}

async fn history_page_response(
    state: ApiState,
    headers: HeaderMap,
    offset: Option<usize>,
    limit: Option<usize>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let Some(history_manager) = state.app.try_state::<Arc<HistoryManager>>() else {
        return api_error(StatusCode::SERVICE_UNAVAILABLE, "HistoryManager not ready.");
    };
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(50).clamp(1, 200);
    match history_manager
        .inner()
        .get_history_entries_page(offset, limit)
        .await
    {
        Ok(page) => Json::<HistoryEntriesPage>(page).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn handle_latest_history(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let Some(history_manager) = state.app.try_state::<Arc<HistoryManager>>() else {
        return api_error(StatusCode::SERVICE_UNAVAILABLE, "HistoryManager not ready.");
    };
    match history_manager.inner().get_latest_entry() {
        Ok(entry) => Json::<Option<HistoryEntry>>(entry).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn handle_dictation_stats(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    let Some(history_manager) = state.app.try_state::<Arc<HistoryManager>>() else {
        return api_error(StatusCode::SERVICE_UNAVAILABLE, "HistoryManager not ready.");
    };
    match commands::stats::get_dictation_stats_impl(history_manager.inner().clone()).await {
        Ok(stats) => Json(stats).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_screen_context_diagnostics(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::get_screen_context_diagnostics(state.app.clone()) {
        Ok(diagnostics) => Json(diagnostics).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_refine_preview(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RefinePreviewApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    let text = request.text.trim();
    if text.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "Text is required.");
    }
    if text.chars().count() > 40_000 {
        return api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Text is too large for refine preview.",
        );
    }

    match crate::actions::preview_post_process(
        &state.app,
        text,
        request.app_bundle_id_override.as_deref(),
    )
    .await
    {
        Ok(result) => Json(result).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_reader_documents(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::reader::list_reader_documents(state.app).await {
        Ok(documents) => Json(documents).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_reader_document(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ReaderDocumentApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    let source_path = request.source_path.trim();
    if source_path.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "Reader source_path is required.");
    }

    match commands::reader::read_reader_document(state.app, source_path.to_string()).await {
        Ok(document) => Json(document).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_reader_export_audio(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ReaderExportAudioApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    let source_path = request.source_path.trim();
    if source_path.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "Reader source_path is required.");
    }

    let format = normalize_reader_export_format(request.format.as_deref());
    let output_path = match request
        .output_path
        .clone()
        .filter(|path| !path.trim().is_empty())
    {
        Some(path) => path,
        None => match default_reader_export_path(&state.app, source_path, &format) {
            Ok(path) => path,
            Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
    };

    let document =
        match commands::reader::read_reader_document(state.app.clone(), source_path.to_string())
            .await
        {
            Ok(document) => document,
            Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
        };
    let chapters = match build_reader_api_chapters(&document, &request) {
        Ok(chapters) => chapters,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, error),
    };
    let unit_count = chapters.iter().map(|chapter| chapter.units.len()).sum();
    let title = request
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| Some(strip_file_extension(&document.name)));

    match commands::tts::export_reader_audiobook(
        state.app,
        document.id.clone(),
        chapters,
        output_path,
        format.clone(),
        request.playback_rate,
        request.language,
        title,
        request.author,
        None,
    )
    .await
    {
        Ok(result) => {
            let response = ReaderExportAudioApiResponse {
                document_id: document.id,
                document_name: document.name,
                section_count: document.sections.len(),
                unit_count,
                output_path: result.output_path,
                duration_ms: result.duration_ms,
                format,
            };
            Json(response).into_response()
        }
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_reader_synthesize_unit(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ReaderSynthesizeUnitApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::tts::synthesize_reader_audio_unit(
        state.app,
        request.document_id,
        request.unit,
        request.playback_rate,
        request.language,
    )
    .await
    {
        Ok(result) => Json::<ReaderAudioUnitRender>(result).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_reader_transform(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ReaderTransformApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::reader::reader_transform_text(state.app, request.text, request.task).await {
        Ok(result) => Json(serde_json::json!({ "text": result })).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
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

async fn handle_tts_presets(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }

    match commands::tts::list_tts_voice_presets(state.app) {
        Ok(presets) => Json::<Vec<TtsVoicePreset>>(presets).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_tts_preset_create(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(input): Json<TtsVoicePresetInput>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::tts::create_tts_voice_preset(state.app, input) {
        Ok(preset) => Json::<TtsVoicePreset>(preset).into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn handle_tts_preset_active(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<TtsPresetActiveApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::tts::set_active_tts_voice_preset(state.app, request.preset_id) {
        Ok(preset) => Json::<TtsVoicePreset>(preset).into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn handle_voice_profile_create(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<VoiceProfileCreateApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::tts::create_tts_voice_profile(
        state.app,
        request.label,
        request.description,
        request.transcript,
    ) {
        Ok(profile) => Json::<TtsVoiceProfileDescriptor>(profile).into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn handle_voice_profile_import_sample(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<VoiceProfileImportApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    let Some(transcription_manager) = state.app.try_state::<Arc<TranscriptionManager>>() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TranscriptionManager not ready.",
        );
    };
    let app = state.app.clone();
    let transcription_manager = Arc::clone(&*transcription_manager);

    match commands::tts::import_tts_voice_profile_sample_impl(
        app,
        transcription_manager,
        request.profile_id,
        request.source_path,
        request.transcript,
    ) {
        Ok(profile) => Json::<TtsVoiceProfileDescriptor>(profile).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_voice_clone_synthesize(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<VoiceCloneSynthesizeApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    let text = request.text.trim();
    if text.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "Text is required.");
    }
    if text.chars().count() > 20_000 {
        return api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Text is too large for voice clone synthesis.",
        );
    }
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "profile_id is required.");
    }
    let profile = match list_voice_profiles(&state.app).and_then(|profiles| {
        profiles
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| format!("Unknown voice profile '{profile_id}'."))
    }) {
        Ok(profile) => profile,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, error),
    };
    let Some(manager) = state.app.try_state::<Arc<TtsManager>>() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TTS manager is unavailable.",
        );
    };

    let settings = get_settings(&state.app);
    let mut preset = if request.provider_id.is_some() || request.model_id.is_some() {
        TtsVoicePreset {
            id: format!("local-api-clone-{}", Uuid::new_v4()),
            label: request
                .label
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| profile.label.clone()),
            provider_id: request
                .provider_id
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    non_empty_or_default(&settings.selected_tts_provider_id, "mlx_kitten_tts")
                }),
            model_id: request
                .model_id
                .clone()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| settings.selected_tts_model_id.clone())
                .unwrap_or_else(|| "kitten-tts-nano-0.8".to_string()),
            voice_id: request
                .voice_id
                .clone()
                .filter(|value| !value.trim().is_empty()),
            voice_profile_id: Some(profile.id.clone()),
            voice_label_snapshot: Some(profile.label.clone()),
            locale_snapshot: request
                .locale
                .clone()
                .filter(|value| !value.trim().is_empty()),
            tuning: request.tuning.unwrap_or_else(default_tts_tuning),
        }
    } else {
        let mut preset = settings
            .active_tts_preset()
            .cloned()
            .unwrap_or_else(|| build_tts_preset_from_legacy(&settings, None));
        preset.id = format!("local-api-clone-{}", Uuid::new_v4());
        preset.label = request
            .label
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| profile.label.clone());
        preset.voice_profile_id = Some(profile.id.clone());
        preset.voice_label_snapshot = Some(profile.label.clone());
        if let Some(voice_id) = request
            .voice_id
            .clone()
            .filter(|value| !value.trim().is_empty())
        {
            preset.voice_id = Some(voice_id);
        }
        if let Some(locale) = request
            .locale
            .clone()
            .filter(|value| !value.trim().is_empty())
        {
            preset.locale_snapshot = Some(locale);
        }
        if let Some(tuning) = request.tuning {
            preset.tuning = tuning;
        }
        preset
    };
    sanitize_tts_preset_for_api(&mut preset);

    let render_request = SpeakRequest {
        text: text.to_string(),
        locale: preset.locale_snapshot.clone(),
        preferred_voice_id: preset.voice_id.clone(),
        preset_id: None,
        inline_preset: Some(preset),
        trigger: Some("local_api_voice_clone".to_string()),
        remember_last_output: false,
    };
    let manager = Arc::clone(&*manager);
    match run_tts_async_on_dedicated_stack("http-api-voice-clone-synthesize", move || async move {
        manager
            .synthesize_to_temp_files(render_request, Arc::new(AtomicBool::new(false)))
            .await
    })
    .await
    {
        Ok(paths) => Json(TtsSynthesizeApiResponse {
            status: "ok",
            output_paths: paths
                .into_iter()
                .map(|path| path.display().to_string())
                .collect(),
        })
        .into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_voice_changer_convert(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<VoiceChangerConvertApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }

    match commands::tts::convert_voice_sample(
        state.app,
        request.source_path,
        request.profile_id,
        request.tau,
        request.provider_id,
        request.model_id,
    )
    .await
    {
        Ok(result) => Json::<VoiceChangerResult>(result).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
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
    match speak_on_dedicated_thread(
        manager,
        SpeakRequest {
            text: text.to_string(),
            locale: request.locale,
            preferred_voice_id: request.preferred_voice_id,
            preset_id: request.preset_id,
            inline_preset: None,
            trigger: Some("local_api".to_string()),
            remember_last_output: request.remember_last_output.unwrap_or(false),
        },
        "http-api-speak",
    )
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

async fn handle_tts_synthesize(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<TtsSynthesizeApiRequest>,
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
                error: "Text is too large for /v1/tts/synthesize.".to_string(),
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

    let inline_preset = match request.inline_preset {
        Some(input) => match preset_from_input(input, None) {
            Ok(preset) => Some(preset),
            Err(error) => {
                return (StatusCode::BAD_REQUEST, Json(ErrorResponse { error })).into_response();
            }
        },
        None => None,
    };

    let stop_flag = Arc::new(AtomicBool::new(false));
    let render_request = SpeakRequest {
        text: text.to_string(),
        locale: request.locale,
        preferred_voice_id: request.preferred_voice_id,
        preset_id: request.preset_id,
        inline_preset,
        trigger: Some("local_api_tts_synthesize".to_string()),
        remember_last_output: false,
    };

    let manager = Arc::clone(&*manager);
    match run_tts_async_on_dedicated_stack("http-api-tts-synthesize", move || async move {
        manager
            .synthesize_to_temp_files(render_request, stop_flag)
            .await
    })
    .await
    {
        Ok(paths) => Json(TtsSynthesizeApiResponse {
            status: "ok",
            output_paths: paths
                .into_iter()
                .map(|path| path.display().to_string())
                .collect(),
        })
        .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
            .into_response(),
    }
}

async fn handle_creative_audio_models(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }
    match get_creative_audio_model_catalog(state.app) {
        Ok(catalog) => Json::<CreativeAudioModelCatalog>(catalog).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
            .into_response(),
    }
}

async fn handle_creative_audio_download(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreativeAudioDownloadApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }
    match download_creative_audio_model(state.app, request.model_id).await {
        Ok(model) => Json::<CreativeAudioModelDescriptor>(model).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
            .into_response(),
    }
}

async fn handle_creative_audio_generate(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreativeAudioGenerateApiRequest>,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Prompt is required.".to_string(),
            }),
        )
            .into_response();
    }
    if prompt.chars().count() > 4_000 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(ErrorResponse {
                error: "Prompt is too large for /v1/creative-audio/generate.".to_string(),
            }),
        )
            .into_response();
    }

    let generate_request = GenerateStorySoundRequest {
        render_id: request
            .render_id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        project_id: request.project_id,
        title: request
            .title
            .unwrap_or_else(|| "Creative Audio Benchmark".to_string()),
        prompt: prompt.to_string(),
        model_id: request.model_id,
        mode: request.mode,
        duration_seconds: request.duration_seconds,
        seed: request.seed,
    };

    match generate_story_sound(state.app, generate_request).await {
        Ok(item) => Json::<StoryAudioItem>(item).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
            .into_response(),
    }
}

async fn handle_story_audio(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }

    match commands::story_studio::list_story_audio(state.app) {
        Ok(items) => Json::<Vec<StoryAudioItem>>(items).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_story_jobs(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(response) = require_api_token(&state.app, &headers) {
        return *response;
    }

    match commands::story_studio::list_story_render_jobs() {
        Ok(jobs) => Json(jobs).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn handle_story_render(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(mut request): Json<StoryRenderRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    if request.render_id.trim().is_empty() {
        request.render_id = Uuid::new_v4().to_string();
    }

    match render_story_audio(state.app, request).await {
        Ok(result) => Json::<StoryRenderEnqueueResult>(result).into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn handle_story_render_sync(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(mut request): Json<StoryRenderRequest>,
) -> axum::response::Response {
    if let Err(response) = require_authorized(&state.app, &headers) {
        return *response;
    }
    if request.render_id.trim().is_empty() {
        request.render_id = Uuid::new_v4().to_string();
    }

    match render_story_audio_now(state.app, request).await {
        Ok(result) => Json::<StoryRenderResult>(result).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
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

const READER_API_MAX_UNIT_CHARS: usize = 480;

fn normalize_reader_export_format(format: Option<&str>) -> String {
    match format
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("wav")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "mp3".to_string(),
        "m4b" => "m4b".to_string(),
        _ => "wav".to_string(),
    }
}

fn default_reader_export_path(
    app: &AppHandle,
    source_path: &str,
    format: &str,
) -> Result<String, String> {
    let app_data_dir = crate::portable::app_data_dir(app)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let dir = app_data_dir.join("local-api").join("reader-exports");
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create Reader API export directory: {err}"))?;
    let stem = Path::new(source_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_api_file_stem)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "reader-export".to_string());
    Ok(dir
        .join(format!("{stem}-{}.{}", Uuid::new_v4(), format))
        .to_string_lossy()
        .to_string())
}

fn sanitize_api_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn strip_file_extension(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(name)
        .to_string()
}

fn build_reader_api_chapters(
    document: &commands::reader::ReaderDocument,
    request: &ReaderExportAudioApiRequest,
) -> Result<Vec<ReaderAudiobookChapter>, String> {
    let default_preset_id = normalize_optional_api_string(request.default_preset_id.clone());
    let mut disabled_sections = HashSet::new();
    let mut preset_by_section: HashMap<usize, Option<String>> = HashMap::new();
    for voice in request.section_voices.as_deref().unwrap_or(&[]) {
        if voice.enabled == Some(false) {
            disabled_sections.insert(voice.section_index);
            continue;
        }
        preset_by_section.insert(
            voice.section_index,
            normalize_optional_api_string(voice.preset_id.clone()),
        );
    }

    let mut chapters = Vec::new();
    let max_units = request.max_units.unwrap_or(usize::MAX);
    if max_units == 0 {
        return Err("max_units must be greater than zero.".to_string());
    }
    let mut total_units = 0usize;
    for section in &document.sections {
        if disabled_sections.contains(&section.index) {
            continue;
        }
        let preset_id = preset_by_section
            .get(&section.index)
            .cloned()
            .flatten()
            .or_else(|| default_preset_id.clone());
        let mut units = Vec::new();
        for chunk in reader_section_chunks(&section.text) {
            if total_units >= max_units {
                break;
            }
            units.push(ReaderAudioCacheUnit {
                id: format!(
                    "s{}-p{}-c{}",
                    section.index, chunk.paragraph_index, chunk.chunk_index
                ),
                text: chunk.text,
                preset_id: preset_id.clone(),
            });
            total_units += 1;
        }
        if !units.is_empty() {
            chapters.push(ReaderAudiobookChapter {
                title: if section.title.trim().is_empty() {
                    format!("Section {}", section.index + 1)
                } else {
                    section.title.clone()
                },
                units,
            });
        }
        if total_units >= max_units {
            break;
        }
    }

    if chapters.is_empty() {
        return Err("Reader document produced no speakable sections.".to_string());
    }
    Ok(chapters)
}

struct ReaderApiChunk {
    paragraph_index: usize,
    chunk_index: usize,
    text: String,
}

fn reader_section_chunks(text: &str) -> Vec<ReaderApiChunk> {
    let mut out = Vec::new();
    let mut paragraph_index = 0usize;
    let mut paragraph = String::new();
    let mut flush_paragraph = |paragraph: &mut String, paragraph_index: &mut usize| {
        let chunks = reader_chunk_text(paragraph, READER_API_MAX_UNIT_CHARS);
        if !chunks.is_empty() {
            for (chunk_index, chunk) in chunks.into_iter().enumerate() {
                out.push(ReaderApiChunk {
                    paragraph_index: *paragraph_index,
                    chunk_index,
                    text: chunk,
                });
            }
            *paragraph_index += 1;
        }
        paragraph.clear();
    };

    for line in text.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if line.trim().is_empty() {
            flush_paragraph(&mut paragraph, &mut paragraph_index);
            continue;
        }
        if !paragraph.is_empty() {
            paragraph.push(' ');
        }
        paragraph.push_str(line.trim());
    }
    flush_paragraph(&mut paragraph, &mut paragraph_index);
    out
}

fn reader_chunk_text(text: &str, max_len: usize) -> Vec<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Vec::new();
    }
    if normalized.chars().count() <= max_len {
        return vec![normalized];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for sentence in reader_split_sentences(&normalized) {
        if sentence.chars().count() > max_len {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
            chunks.extend(reader_hard_split(&sentence, max_len));
            continue;
        }
        let next_len = current.chars().count()
            + if current.is_empty() { 0 } else { 1 }
            + sentence.chars().count();
        if !current.is_empty() && next_len > max_len {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(&sentence);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn reader_split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut start = 0usize;
    for (index, ch) in text.char_indices() {
        if matches!(ch, '.' | '!' | '?' | '…') {
            let end = index + ch.len_utf8();
            let sentence = text[start..end].trim();
            if !sentence.is_empty() {
                sentences.push(sentence.to_string());
            }
            start = end;
        }
    }
    let tail = text[start..].trim();
    if !tail.is_empty() {
        sentences.push(tail.to_string());
    }
    if sentences.is_empty() {
        sentences.push(text.trim().to_string());
    }
    sentences
}

fn reader_hard_split(text: &str, max_len: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if word.chars().count() > max_len {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            let chars = word.chars().collect::<Vec<_>>();
            for chunk in chars.chunks(max_len) {
                out.push(chunk.iter().collect());
            }
            continue;
        }
        let next_len =
            current.chars().count() + if current.is_empty() { 0 } else { 1 } + word.chars().count();
        if !current.is_empty() && next_len > max_len {
            out.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn normalize_optional_api_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn non_empty_or_default(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn default_tts_tuning() -> TtsVoiceTuningSettings {
    TtsVoiceTuningSettings {
        tempo_rate: 1.0,
        expressiveness: 0.5,
        exaggeration: 0.5,
        randomness: 0.7,
        guidance: 0.5,
        stability: 0.5,
        repetition_penalty: 1.2,
        style_instructions: None,
        advanced_overrides: HashMap::new(),
    }
}

fn sanitize_tts_preset_for_api(preset: &mut TtsVoicePreset) {
    preset.provider_id = preset.provider_id.trim().to_string();
    preset.model_id = preset.model_id.trim().to_string();
    preset.voice_id = normalize_optional_api_string(preset.voice_id.clone());
    preset.voice_profile_id = normalize_optional_api_string(preset.voice_profile_id.clone());
    preset.voice_label_snapshot =
        normalize_optional_api_string(preset.voice_label_snapshot.clone());
    preset.locale_snapshot = normalize_optional_api_string(preset.locale_snapshot.clone());
    preset.tuning.tempo_rate = preset.tuning.tempo_rate.clamp(0.5, 2.0);
    preset.tuning.expressiveness = preset.tuning.expressiveness.clamp(0.0, 1.0);
    preset.tuning.exaggeration = preset.tuning.exaggeration.clamp(0.0, 2.0);
    preset.tuning.randomness = preset.tuning.randomness.clamp(0.0, 1.0);
    preset.tuning.guidance = preset.tuning.guidance.clamp(0.0, 1.0);
    preset.tuning.stability = preset.tuning.stability.clamp(0.0, 1.0);
    preset.tuning.repetition_penalty = preset.tuning.repetition_penalty.clamp(0.5, 3.0);
    preset.tuning.style_instructions =
        normalize_optional_api_string(preset.tuning.style_instructions.clone());
}

pub(crate) fn require_api_token(
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
    if api_token_authorized(&expected, headers) {
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

fn api_token_authorized(expected: &str, headers: &HeaderMap) -> bool {
    let expected = expected.trim();
    if expected.is_empty() {
        return false;
    }

    provided_api_tokens(headers).any(|provided| provided == expected)
}

fn provided_api_tokens(headers: &HeaderMap) -> impl Iterator<Item = &str> {
    let header_tokens = headers
        .get_all(API_TOKEN_HEADER)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .map(str::trim);

    let bearer_tokens = headers
        .get_all(axum::http::header::AUTHORIZATION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(extract_bearer_token);

    header_tokens.chain(bearer_tokens)
}

fn extract_bearer_token(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    let (scheme, token) = trimmed.split_once(char::is_whitespace)?;
    if scheme.eq_ignore_ascii_case("Bearer") {
        let token = token.trim();
        if !token.is_empty() {
            return Some(token);
        }
    }
    None
}

pub(crate) fn decode_wav_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let (mono, sample_rate) = crate::audio_toolkit::decode_wav_bytes_as_mono_f32(bytes)?;
    if sample_rate == 16_000 {
        return Ok(mono);
    }
    Ok(crate::commands::transcription::resample_linear(
        &mono,
        sample_rate,
        16_000,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(values: &[(&'static str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in values {
            headers.append(*name, HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    #[test]
    fn api_token_rejects_empty_expected_token() {
        let headers = headers(&[(API_TOKEN_HEADER, "secret")]);

        assert!(!api_token_authorized("", &headers));
        assert!(!api_token_authorized("   ", &headers));
    }

    #[test]
    fn api_token_accepts_custom_header_with_trimmed_value() {
        let headers = headers(&[(API_TOKEN_HEADER, "  secret  ")]);

        assert!(api_token_authorized("secret", &headers));
    }

    #[test]
    fn api_token_accepts_authorization_bearer_case_insensitively() {
        let headers = headers(&[(axum::http::header::AUTHORIZATION.as_str(), "bearer secret")]);

        assert!(api_token_authorized("secret", &headers));
    }

    #[test]
    fn api_token_checks_authorization_when_custom_header_is_wrong() {
        let headers = headers(&[
            (API_TOKEN_HEADER, "wrong"),
            (axum::http::header::AUTHORIZATION.as_str(), "Bearer secret"),
        ]);

        assert!(api_token_authorized("secret", &headers));
    }

    #[test]
    fn api_token_rejects_missing_or_wrong_token() {
        assert!(!api_token_authorized("secret", &HeaderMap::new()));
        assert!(!api_token_authorized(
            "secret",
            &headers(&[(API_TOKEN_HEADER, "wrong")])
        ));
        assert!(!api_token_authorized(
            "secret",
            &headers(&[(axum::http::header::AUTHORIZATION.as_str(), "Basic secret")])
        ));
    }

    #[test]
    fn api_dictation_binding_defaults_and_rejects_unknown_values() {
        assert_eq!(
            normalize_api_binding_id(None).unwrap(),
            "transcribe".to_string()
        );
        assert_eq!(
            normalize_api_binding_id(Some(" transcribe_with_post_process ")).unwrap(),
            "transcribe_with_post_process".to_string()
        );
        assert!(normalize_api_binding_id(Some("delete_history")).is_err());
    }

    #[test]
    fn api_settings_patch_accepts_raw_or_wrapped_update_objects() {
        let raw = serde_json::json!({ "app_theme": "dark" });
        assert_eq!(
            extract_settings_updates(raw)
                .unwrap()
                .get("app_theme")
                .and_then(Value::as_str),
            Some("dark")
        );

        let wrapped = serde_json::json!({ "updates": { "debug_mode": true } });
        assert_eq!(
            extract_settings_updates(wrapped)
                .unwrap()
                .get("debug_mode")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn api_settings_patch_marks_side_effect_fields_unpatchable() {
        assert!(is_patchable_setting("audio_feedback"));
        assert!(!is_patchable_setting("bindings"));
        assert!(!is_patchable_setting("app_theme"));
        assert!(!is_patchable_setting("selected_model"));
        assert!(!is_patchable_setting("post_process_provider_id"));
        assert!(!is_patchable_setting("translation_model_ids"));
        assert!(!is_patchable_setting("translate_to_english"));
        assert!(!is_patchable_setting("tts_volume"));
        assert!(!is_patchable_setting("audio_enhancement_enabled"));
        assert!(!is_patchable_setting("overlay_position"));
        assert!(!is_patchable_setting("debug_mode"));
        assert!(!is_patchable_setting("post_process_api_keys"));
    }

    #[test]
    fn api_settings_command_parses_provider_model_shapes() {
        assert_eq!(
            provider_model_from_value(
                &serde_json::json!({ "provider_id": "openai", "model": "gpt-4.1-mini" }),
                "post_process_models",
            )
            .unwrap(),
            ("openai".to_string(), "gpt-4.1-mini".to_string())
        );
        assert_eq!(
            provider_model_from_value(
                &serde_json::json!({ "anthropic": "claude-sonnet-4" }),
                "post_process_models",
            )
            .unwrap(),
            ("anthropic".to_string(), "claude-sonnet-4".to_string())
        );
        assert!(provider_model_from_value(&serde_json::json!({}), "post_process_models").is_err());
    }

    #[test]
    fn reader_api_builds_section_chapters_with_voice_overrides() {
        let document = commands::reader::ReaderDocument {
            id: "doc-1".to_string(),
            path: "/tmp/example.pdf".to_string(),
            name: "example.pdf".to_string(),
            kind: commands::reader::ReaderDocumentKind::Pdf,
            size_bytes: 42,
            source_modified_ms: None,
            word_count: 10,
            page_count: 1,
            extraction_engine: "test".to_string(),
            thumbnail_data_url: None,
            text: String::new(),
            pages: Vec::new(),
            sections: vec![
                commands::reader::ReaderDocumentSection {
                    index: 0,
                    title: "Narrator".to_string(),
                    text: "First sentence. Second sentence.".to_string(),
                },
                commands::reader::ReaderDocumentSection {
                    index: 1,
                    title: "Skipped".to_string(),
                    text: "This should not be included.".to_string(),
                },
            ],
        };
        let request = ReaderExportAudioApiRequest {
            source_path: document.path.clone(),
            output_path: None,
            format: Some("mp3".to_string()),
            playback_rate: None,
            language: None,
            title: None,
            author: None,
            default_preset_id: Some("default-preset".to_string()),
            section_voices: Some(vec![
                ReaderSectionVoiceApiRequest {
                    section_index: 0,
                    preset_id: Some("narrator-preset".to_string()),
                    enabled: None,
                },
                ReaderSectionVoiceApiRequest {
                    section_index: 1,
                    preset_id: None,
                    enabled: Some(false),
                },
            ]),
            max_units: None,
        };

        let chapters = build_reader_api_chapters(&document, &request).unwrap();

        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].title, "Narrator");
        assert_eq!(chapters[0].units.len(), 1);
        assert_eq!(
            chapters[0].units[0].preset_id.as_deref(),
            Some("narrator-preset")
        );
        assert_eq!(chapters[0].units[0].id, "s0-p0-c0");
    }

    #[test]
    fn reader_api_chunks_long_text_to_bounded_units() {
        let text = format!("{}.", "word ".repeat(140));
        let chunks = reader_chunk_text(&text, READER_API_MAX_UNIT_CHARS);

        assert!(chunks.len() > 1);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.chars().count() <= READER_API_MAX_UNIT_CHARS));
    }
}
