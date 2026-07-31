use crate::settings::{
    TTS_PROVIDER_MLX_KOKORO_ID, TTS_PROVIDER_MLX_ORPHEUS_ID, TTS_PROVIDER_MLX_VOXTRAL_TTS_ID,
};
#[cfg(target_os = "macos")]
use regex::Regex;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::Command;

use super::catalog::{is_known_tts_model_id, is_known_tts_provider_id};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use super::TtsEngineKind;
use super::VoiceInfo;

#[cfg(target_os = "macos")]
pub static SAY_VOICE_RE: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| {
    Regex::new(r"^(?P<name>.+?)\s{2,}(?P<locale>[A-Za-z_]+)\s+#").expect("valid say voice regex")
});

pub fn mlx_voice_locale(voice_id: &str) -> Option<&'static str> {
    match voice_id.split('_').next().unwrap_or_default() {
        "af" | "am" => Some("en-US"),
        "bf" | "bm" => Some("en-GB"),
        "ef" | "em" => Some("es"),
        "ff" | "fm" => Some("fr-FR"),
        "hf" | "hm" => Some("hi"),
        "if" | "im" => Some("it"),
        "jf" | "jm" => Some("ja-JP"),
        "pf" | "pm" => Some("pt-BR"),
        "zf" | "zm" => Some("zh-CN"),
        _ => None,
    }
}

pub fn mlx_voice_label(voice_id: &str) -> String {
    voice_id
        .split_once('_')
        .map(|(_, name)| name)
        .unwrap_or(voice_id)
        .split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn mlx_voice_locale_for_provider(provider_id: &str, voice_id: &str) -> Option<String> {
    if provider_id == TTS_PROVIDER_MLX_KOKORO_ID {
        return mlx_voice_locale(voice_id).map(str::to_string);
    }

    if provider_id == TTS_PROVIDER_MLX_VOXTRAL_TTS_ID {
        let prefix = voice_id.split('_').next().unwrap_or_default();
        let locale = match prefix {
            "fr" => Some("fr-FR"),
            "es" => Some("es"),
            "de" => Some("de"),
            "it" => Some("it"),
            "pt" => Some("pt-BR"),
            "nl" => Some("nl"),
            "ar" => Some("ar"),
            "hi" => Some("hi"),
            // Style voices in Voxtral's embedding set are English presets.
            "casual" | "cheerful" | "neutral" => Some("en"),
            _ => None,
        };
        return locale.map(str::to_string);
    }

    if provider_id == TTS_PROVIDER_MLX_ORPHEUS_ID {
        return Some("en-US".to_string());
    }

    None
}

pub fn is_valid_mlx_voice_id(voice_id: &str) -> bool {
    let trimmed = voice_id.trim();
    !(trimmed.is_empty()
        || trimmed == "__auto__"
        || trimmed.eq_ignore_ascii_case("automatic")
        || trimmed.eq_ignore_ascii_case("default")
        || is_known_tts_model_id(trimmed)
        || is_known_tts_provider_id(trimmed))
}

#[cfg(target_os = "macos")]
pub fn rate_to_words_per_minute(rate: f32) -> u32 {
    let normalized = rate.clamp(0.5, 2.0);
    let words_per_minute = 180.0 * normalized;
    words_per_minute.round() as u32
}

#[cfg(target_os = "windows")]
pub fn rate_to_windows_rate(rate: f32) -> i32 {
    let normalized = rate.clamp(0.5, 2.0);
    (((normalized - 1.0) * 10.0).round() as i32).clamp(-10, 10)
}

#[cfg(target_os = "macos")]
pub fn macos_system_voices() -> Result<Vec<VoiceInfo>, String> {
    let output = Command::new("/usr/bin/say")
        .args(["-v", "?"])
        .output()
        .map_err(|err| format!("Failed to enumerate macOS voices: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut voices = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(captures) = SAY_VOICE_RE.captures(trimmed) {
            let name = captures
                .name("name")
                .map(|value| value.as_str().trim().to_string())
                .unwrap_or_default();
            let locale = captures
                .name("locale")
                .map(|value| value.as_str().replace('_', "-"));
            voices.push(VoiceInfo {
                id: name.clone(),
                label: name,
                locale,
                engine: TtsEngineKind::System,
                installed: true,
                available: true,
            });
        }
    }

    Ok(voices)
}

#[cfg(target_os = "windows")]
pub fn windows_system_voices() -> Result<Vec<VoiceInfo>, String> {
    let script = r#"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object {
  $info = $_.VoiceInfo
  [PSCustomObject]@{
    id = $info.Name
    label = $info.Name
    locale = $info.Culture.Name
  }
}
$voices | ConvertTo-Json -Compress
"#;
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .map_err(|err| format!("Failed to enumerate Windows voices: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|err| format!("Failed to parse Windows voices: {err}"))?;
    let entries = match parsed {
        serde_json::Value::Array(values) => values,
        serde_json::Value::Object(_) => vec![parsed],
        _ => Vec::new(),
    };

    let voices = entries
        .into_iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?.to_string();
            let label = entry
                .get("label")
                .and_then(|value| value.as_str())
                .unwrap_or(&id)
                .to_string();
            let locale = entry
                .get("locale")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            Some(VoiceInfo {
                id,
                label,
                locale,
                engine: TtsEngineKind::System,
                installed: true,
                available: true,
            })
        })
        .collect();

    Ok(voices)
}
