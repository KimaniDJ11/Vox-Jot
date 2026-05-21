use crate::audio_playback;
use crate::settings::{
    sanitize_tts_voice_tuning_for_target, TtsVoiceTuningSettings, TTS_PROVIDER_LOCAL_SIDECAR_API_ID,
};
use std::fs;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use uuid::Uuid;

use super::catalog::{mlx_audio_tts_model_definition, provider_is_mlx_audio};
use super::VoiceInfo;

pub const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:8008/v1/audio/speech";
pub const RUNTIME_TTS_REQUEST_TIMEOUT_SECS: u64 = 180;
const SIDECAR_CANCEL_POLL_MS: u64 = 100;

pub fn synthesize_sidecar_chunk(
    text: &str,
    provider_id: &str,
    model_id: Option<&str>,
    profile_id: Option<&str>,
    locale: Option<&str>,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Err("Story rendering was cancelled.".to_string());
    }

    let sidecar_url = std::env::var("VOX_JOT_TTS_SIDECAR_URL")
        .unwrap_or_else(|_| DEFAULT_SIDECAR_URL.to_string());
    let runtime_target = sidecar_runtime_target(provider_id, model_id);

    let payload = build_sidecar_request_payload(
        text,
        provider_id,
        model_id,
        profile_id,
        locale,
        preferred_voice_id,
        voice,
        tuning,
    );

    let http_timeout_secs = RUNTIME_TTS_REQUEST_TIMEOUT_SECS;

    let (bytes, content_type) = run_sidecar_request_blocking(
        sidecar_url,
        runtime_target,
        payload,
        http_timeout_secs,
        stop_flag,
    )?;

    let extension = sidecar_audio_extension(content_type.as_deref(), &bytes);
    let temp_file =
        std::env::temp_dir().join(format!("vox-jot-sidecar-{}.{}", Uuid::new_v4(), extension));
    fs::write(&temp_file, &bytes).map_err(|err| format!("Failed to save sidecar audio: {err}"))?;
    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_file);
        return Err("Story rendering was cancelled.".to_string());
    }
    Ok(temp_file)
}

fn run_sidecar_request_blocking(
    sidecar_url: String,
    runtime_target: String,
    payload: serde_json::Value,
    http_timeout_secs: u64,
    stop_flag: &AtomicBool,
) -> Result<(Vec<u8>, Option<String>), String> {
    let future = fetch_sidecar_audio(
        sidecar_url,
        runtime_target,
        payload,
        http_timeout_secs,
        stop_flag,
    );

    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|err| format!("Failed to start TTS sidecar runtime: {err}"))?
        .block_on(future)
}

async fn fetch_sidecar_audio(
    sidecar_url: String,
    runtime_target: String,
    payload: serde_json::Value,
    http_timeout_secs: u64,
    stop_flag: &AtomicBool,
) -> Result<(Vec<u8>, Option<String>), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(http_timeout_secs))
        .build()
        .map_err(|err| format!("Failed to create TTS sidecar client: {err}"))?;
    let response = await_sidecar_cancelable(
        async {
            client
                .post(&sidecar_url)
                .json(&payload)
                .send()
                .await
                .map_err(|err| {
                    if err.is_timeout() {
                        format!(
                            "{runtime_target} timed out after {}s while waiting for the local speech runtime to return audio.",
                            http_timeout_secs
                        )
                    } else {
                        format!("Failed to call the local speech runtime for {runtime_target}: {err}")
                    }
                })
        },
        stop_flag,
    )
    .await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let detail = sidecar_error_detail(&body);
        return Err(if detail.is_empty() {
            format!("{runtime_target} returned HTTP {status}")
        } else {
            format!("{runtime_target} failed: {detail}")
        });
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let bytes = await_sidecar_cancelable(
        async {
            response
                .bytes()
                .await
                .map(|bytes| bytes.to_vec())
                .map_err(|err| format!("Failed to read audio from {runtime_target}: {err}"))
        },
        stop_flag,
    )
    .await?;
    Ok((bytes, content_type))
}

async fn await_sidecar_cancelable<T, F>(future: F, stop_flag: &AtomicBool) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let mut future = Box::pin(future);
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            return Err("Story rendering was cancelled.".to_string());
        }
        match poll_sidecar_cancelable(&mut future, stop_flag).await {
            Some(result) => return result,
            None => continue,
        }
    }
}

async fn poll_sidecar_cancelable<T, F>(
    future: &mut Pin<Box<F>>,
    stop_flag: &AtomicBool,
) -> Option<Result<T, String>>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::select! {
        result = future.as_mut() => Some(result),
        _ = tokio::time::sleep(Duration::from_millis(SIDECAR_CANCEL_POLL_MS)) => {
            if stop_flag.load(Ordering::Relaxed) {
                Some(Err("Story rendering was cancelled.".to_string()))
            } else {
                None
            }
        }
    }
}

pub fn speak_sidecar_chunk(
    text: &str,
    provider_id: &str,
    model_id: Option<&str>,
    profile_id: Option<&str>,
    locale: Option<&str>,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let temp_file = synthesize_sidecar_chunk(
        text,
        provider_id,
        model_id,
        profile_id,
        locale,
        preferred_voice_id,
        voice,
        tuning,
        stop_flag,
    )?;
    let play_result =
        audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play sidecar speech audio: {err}"));
    let _ = fs::remove_file(&temp_file);
    play_result
}

pub fn sidecar_audio_extension(content_type: Option<&str>, bytes: &[u8]) -> &'static str {
    let normalized = content_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match normalized.as_str() {
        "audio/mp3" | "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" => "ogg",
        _ if bytes.starts_with(b"ID3") => "mp3",
        _ if bytes.starts_with(b"RIFF") => "wav",
        _ if bytes.len() > 8 && &bytes[4..8] == b"ftyp" => "m4a",
        _ => "bin",
    }
}

pub fn sidecar_request_url_from_base(base_url: &str, path: &str) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(base_url).ok()?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    if path.is_empty() || path == "/" {
        return Some(url);
    }
    url.join(path).ok()
}

pub fn sidecar_runtime_target(provider_id: &str, model_id: Option<&str>) -> String {
    match (provider_id.trim(), model_id) {
        ("", Some(model_id)) => format!("Speech model '{model_id}'"),
        ("", None) => "The selected speech runtime".to_string(),
        (provider_id, Some(model_id)) => {
            format!("Speech runtime '{provider_id}' with model '{model_id}'")
        }
        (provider_id, None) => format!("Speech runtime '{provider_id}'"),
    }
}

pub fn sidecar_error_detail(body: &str) -> String {
    fn format_detail_value(value: &serde_json::Value) -> Option<String> {
        match value {
            serde_json::Value::Null => None,
            serde_json::Value::String(text) => {
                Some(text.trim().to_string()).filter(|text| !text.is_empty())
            }
            serde_json::Value::Number(number) => Some(number.to_string()),
            serde_json::Value::Bool(flag) => Some(flag.to_string()),
            serde_json::Value::Array(items) => {
                let parts = items
                    .iter()
                    .filter_map(format_detail_value)
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("; "))
                }
            }
            serde_json::Value::Object(map) => {
                if let Some(detail) = map.get("detail").and_then(format_detail_value) {
                    return Some(detail);
                }

                if let Some(message) = map
                    .get("msg")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    let location = map.get("loc").and_then(|value| match value {
                        serde_json::Value::Array(parts) => {
                            let formatted = parts
                                .iter()
                                .filter_map(|part| match part {
                                    serde_json::Value::String(text) => Some(text.clone()),
                                    serde_json::Value::Number(number) => Some(number.to_string()),
                                    _ => None,
                                })
                                .collect::<Vec<_>>()
                                .join(".");
                            if formatted.is_empty() {
                                None
                            } else {
                                Some(formatted)
                            }
                        }
                        _ => None,
                    });

                    return Some(match location {
                        Some(location) => format!("{location}: {message}"),
                        None => message.to_string(),
                    });
                }

                Some(value.to_string())
            }
        }
    }

    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("detail")
                .and_then(format_detail_value)
                .or_else(|| format_detail_value(&value))
        })
        .unwrap_or_else(|| body.trim().to_string())
}

pub fn build_sidecar_request_payload(
    text: &str,
    provider_id: &str,
    model_id: Option<&str>,
    profile_id: Option<&str>,
    locale: Option<&str>,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
) -> serde_json::Value {
    let effective_model = if provider_is_mlx_audio(provider_id) {
        model_id
            .and_then(mlx_audio_tts_model_definition)
            .map(|definition| definition.hf_model_id)
            .or(model_id)
    } else {
        model_id
    };
    let mut sanitized_tuning = tuning.clone();
    let _ = sanitize_tts_voice_tuning_for_target(
        &mut sanitized_tuning,
        provider_id,
        effective_model.unwrap_or_default(),
    );

    serde_json::json!({
        "input": text,
        "text": text,
        "model": effective_model,
        "voice": preferred_voice_id
            .map(|voice_id| voice_id.to_string())
            .or_else(|| voice.map(|voice| voice.id.clone())),
        "locale": locale,
        "language": locale,
        "format": "wav",
        "speed": sanitized_tuning.tempo_rate.clamp(0.5, 2.0),
        "instructions": sanitized_tuning.style_instructions.clone(),
        "profile_id": profile_id,
        "extra_controls": if provider_id.is_empty() || provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID {
            serde_json::json!({
                "tuning": sanitized_tuning,
            })
        } else {
            serde_json::json!({
                "provider_id": provider_id,
                "model_id": effective_model,
                "tuning": sanitized_tuning,
            })
        }
    })
}
