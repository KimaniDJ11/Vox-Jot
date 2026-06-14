use crate::helpers::subtitles::TimedSegment;
use crate::http_api::{decode_wav_bytes, require_api_token, ApiState};
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{TtsVoicePreset, TtsVoiceTuningSettings};
use crate::tts::{speak_on_dedicated_thread, SpeakRequest, TtsManager};
use crate::tts_profiles::list_voice_profiles;
use axum::{
    extract::{Json, State as AxumState},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tauri::Manager;

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_MCP_WAV_BYTES: usize = 64 * 1024 * 1024;
const MAX_MCP_SPEAK_CHARS: usize = 20_000;

#[derive(Debug, Deserialize)]
pub(crate) struct JsonRpcRequest {
    #[serde(default)]
    jsonrpc: Option<String>,
    method: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    id: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

#[derive(Debug, Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

#[derive(Debug, Deserialize)]
struct SpeakToolArgs {
    text: String,
    #[serde(default)]
    locale: Option<String>,
    #[serde(default)]
    voice_id: Option<String>,
    #[serde(default)]
    preset_id: Option<String>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    model_id: Option<String>,
    #[serde(default)]
    profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TranscribeWavToolArgs {
    audio_base64: String,
}

pub(crate) async fn handle_mcp(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(request): Json<JsonRpcRequest>,
) -> axum::response::Response {
    handle_mcp_inner(state, headers, request).await
}

fn handle_mcp_inner(
    state: ApiState,
    headers: HeaderMap,
    request: JsonRpcRequest,
) -> Pin<Box<dyn Future<Output = axum::response::Response> + Send>> {
    Box::pin(async move {
        if let Err(response) = validate_origin(&headers) {
            return response.into_response();
        }
        if let Err(response) = require_api_token(&state.app, &headers) {
            return *response;
        }

        if request.jsonrpc.as_deref().unwrap_or("2.0") != "2.0" {
            return Json(rpc_error(
                request.id,
                -32600,
                "JSON-RPC version must be 2.0",
            ))
            .into_response();
        }

        let response = match request.method.as_str() {
            "initialize" => rpc_ok(
                request.id,
                json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "vox-jot",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            ),
            "notifications/initialized" => {
                return StatusCode::ACCEPTED.into_response();
            }
            "tools/list" => rpc_ok(request.id, json!({ "tools": mcp_tools() })),
            "tools/call" => match serde_json::from_value::<ToolCallParams>(request.params) {
                Ok(params) => match call_tool(&state, params).await {
                    Ok(result) => rpc_ok(request.id, result),
                    Err(message) => rpc_ok(
                        request.id,
                        json!({
                            "content": [{ "type": "text", "text": message }],
                            "isError": true
                        }),
                    ),
                },
                Err(err) => rpc_error(
                    request.id,
                    -32602,
                    format!("Invalid tool call params: {err}"),
                ),
            },
            _ => rpc_error(
                request.id,
                -32601,
                format!("Unsupported MCP method '{}'.", request.method),
            ),
        };

        Json(response).into_response()
    })
}

fn validate_origin(headers: &HeaderMap) -> Result<(), (StatusCode, Json<Value>)> {
    let Some(origin) = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };

    let allowed = origin == "null"
        || origin == "tauri://localhost"
        || origin == "https://tauri.localhost"
        || origin
            .parse::<axum::http::Uri>()
            .ok()
            .and_then(|uri| uri.host().map(|host| host.to_ascii_lowercase()))
            .is_some_and(|host| host == "127.0.0.1" || host == "localhost" || host == "::1");

    if allowed {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "MCP requests with a non-loopback Origin are not allowed." })),
        ))
    }
}

fn mcp_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "vox_jot.speak",
            "description": "Speak text locally through Vox Jot's selected TTS engine or an optional voice/model/profile override.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "locale": { "type": "string" },
                    "voice_id": { "type": "string" },
                    "preset_id": { "type": "string" },
                    "provider_id": { "type": "string" },
                    "model_id": { "type": "string" },
                    "profile_id": { "type": "string" }
                },
                "required": ["text"]
            }
        }),
        json!({
            "name": "vox_jot.list_voices",
            "description": "List voices available to the active Vox Jot TTS setup.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "vox_jot.list_voice_profiles",
            "description": "List saved Vox Jot voice-clone profiles.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "vox_jot.transcribe_wav",
            "description": "Transcribe a bounded base64-encoded WAV payload locally. Arbitrary file paths are intentionally not accepted.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "audio_base64": {
                        "type": "string",
                        "description": "Base64-encoded WAV bytes."
                    }
                },
                "required": ["audio_base64"]
            }
        }),
    ]
}

async fn call_tool(state: &ApiState, params: ToolCallParams) -> Result<Value, String> {
    match params.name.as_str() {
        "vox_jot.speak" => call_speak(state, params.arguments).await,
        "vox_jot.list_voices" => call_list_voices(state).await,
        "vox_jot.list_voice_profiles" => call_list_voice_profiles(state),
        "vox_jot.transcribe_wav" => call_transcribe_wav(state, params.arguments).await,
        other => Err(format!("Unknown Vox Jot MCP tool '{other}'.")),
    }
}

async fn call_speak(state: &ApiState, arguments: Value) -> Result<Value, String> {
    let args = serde_json::from_value::<SpeakToolArgs>(arguments)
        .map_err(|err| format!("Invalid vox_jot.speak arguments: {err}"))?;
    let text = args.text.trim();
    if text.is_empty() {
        return Err("text is required.".to_string());
    }
    if text.chars().count() > MAX_MCP_SPEAK_CHARS {
        return Err(format!(
            "text is too large for vox_jot.speak; limit is {MAX_MCP_SPEAK_CHARS} characters."
        ));
    }

    let Some(manager) = state.app.try_state::<Arc<TtsManager>>() else {
        return Err("TTS manager is unavailable.".to_string());
    };
    let manager = manager.inner().clone();
    let inline_preset = match (args.provider_id.clone(), args.model_id.clone()) {
        (Some(provider_id), Some(model_id))
            if !provider_id.trim().is_empty() && !model_id.trim().is_empty() =>
        {
            Some(TtsVoicePreset {
                id: "mcp-inline-voice".to_string(),
                label: "MCP inline voice".to_string(),
                provider_id,
                model_id,
                voice_id: args.voice_id.clone(),
                voice_profile_id: args.profile_id.clone(),
                voice_label_snapshot: args.voice_id.clone(),
                locale_snapshot: args.locale.clone(),
                tuning: default_mcp_tuning(),
            })
        }
        _ => None,
    };

    speak_on_dedicated_thread(
        manager,
        SpeakRequest {
            text: text.to_string(),
            locale: args.locale,
            preferred_voice_id: args.voice_id,
            preset_id: args.preset_id,
            inline_preset,
            trigger: Some("mcp".to_string()),
            remember_last_output: false,
        },
        "mcp-speak",
    )
    .await?;

    Ok(json!({ "content": [{ "type": "text", "text": "Speech queued." }] }))
}

async fn call_list_voices(state: &ApiState) -> Result<Value, String> {
    let Some(manager) = state.app.try_state::<Arc<TtsManager>>() else {
        return Err("TTS manager is unavailable.".to_string());
    };
    let manager = manager.inner().clone();
    let voices = tokio::task::spawn_blocking(move || manager.get_available_voices())
        .await
        .map_err(|err| format!("voice listing task failed: {err}"))??;
    json_text_result(&voices)
}

fn call_list_voice_profiles(state: &ApiState) -> Result<Value, String> {
    let profiles = list_voice_profiles(&state.app)?;
    json_text_result(&profiles)
}

async fn call_transcribe_wav(state: &ApiState, arguments: Value) -> Result<Value, String> {
    let args = serde_json::from_value::<TranscribeWavToolArgs>(arguments)
        .map_err(|err| format!("Invalid vox_jot.transcribe_wav arguments: {err}"))?;
    let bytes = BASE64_STANDARD
        .decode(args.audio_base64.as_bytes())
        .map_err(|err| format!("audio_base64 is not valid base64: {err}"))?;
    if bytes.len() > MAX_MCP_WAV_BYTES {
        return Err(format!(
            "WAV payload is too large for vox_jot.transcribe_wav; limit is {} MB.",
            MAX_MCP_WAV_BYTES / (1024 * 1024)
        ));
    }
    let samples = decode_wav_bytes(&bytes)?;
    let Some(manager) = state.app.try_state::<Arc<TranscriptionManager>>() else {
        return Err("TranscriptionManager is unavailable.".to_string());
    };
    let manager = manager.inner().clone();
    let (text, segments) =
        tokio::task::spawn_blocking(move || manager.transcribe_with_segments(Arc::new(samples)))
            .await
            .map_err(|err| format!("transcription task failed: {err}"))?
            .map_err(|err| err.to_string())?;

    #[derive(Serialize)]
    struct TranscribeResult {
        text: String,
        segments: Vec<TimedSegment>,
    }

    json_text_result(&TranscribeResult { text, segments })
}

fn default_mcp_tuning() -> TtsVoiceTuningSettings {
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

fn json_text_result<T: Serialize>(value: &T) -> Result<Value, String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|err| format!("Failed to serialize MCP response: {err}"))?;
    Ok(json!({ "content": [{ "type": "text", "text": text }] }))
}

fn rpc_ok(id: Option<Value>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn rpc_error(id: Option<Value>, code: i32, message: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn lists_expected_tools() {
        let names = mcp_tools()
            .into_iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>();
        assert!(names.contains(&"vox_jot.speak".to_string()));
        assert!(names.contains(&"vox_jot.transcribe_wav".to_string()));
        assert!(names.contains(&"vox_jot.list_voices".to_string()));
        assert!(names.contains(&"vox_jot.list_voice_profiles".to_string()));
    }

    #[test]
    fn origin_validation_rejects_non_loopback_browser_origins() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::ORIGIN,
            HeaderValue::from_static("https://example.com"),
        );
        assert!(validate_origin(&headers).is_err());
    }

    #[test]
    fn origin_validation_accepts_loopback_origins() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::ORIGIN,
            HeaderValue::from_static("http://127.0.0.1:3000"),
        );
        assert!(validate_origin(&headers).is_ok());
    }
}
