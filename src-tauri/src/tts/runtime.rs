use crate::audio_playback;
use crate::portable;
use crate::settings::{TtsStyleControlValue, TtsVoiceTuningSettings, TTS_PROVIDER_QWEN3_NATIVE_ID};
use crate::tts_profiles::ResolvedTtsVoiceProfile;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use uuid::Uuid;

use super::catalog::{SherpaModelFamily, SherpaPackManifest};
use super::chunking::locale_language;
#[cfg(target_os = "windows")]
use super::voices::rate_to_windows_rate;
#[cfg(target_os = "macos")]
use super::voices::rate_to_words_per_minute;
use super::VoiceInfo;

#[derive(Debug, Clone)]
pub struct SherpaRuntimeDefinition {
    pub platform_id: &'static str,
    pub archive_name: &'static str,
    pub source_url: &'static str,
}

#[derive(Debug, Clone)]
pub struct SherpaContext {
    pub runtime_root: PathBuf,
    pub pack_root: PathBuf,
    pub manifest: SherpaPackManifest,
}

#[derive(Debug, Clone)]
pub struct ManagedSpeechRuntimeDefinition {
    pub platform_id: &'static str,
    pub archive_name: &'static str,
}

pub struct Qwen3Context {
    pub runtime_root: PathBuf,
    pub model_root: PathBuf,
    pub clone_profile: Option<Qwen3CloneProfile>,
    pub language: String,
    pub supports_instruction_prompt: bool,
}

pub struct MlxAudioContext {
    pub provider_id: String,
    pub model_id: String,
    pub model_label: String,
    pub python_path: PathBuf,
    pub bridge_script_path: PathBuf,
    pub model_source: String,
    pub clone_profile: Option<MlxAudioCloneProfile>,
    pub language: String,
    pub supports_instruction_prompt: bool,
}

#[derive(Debug, Clone)]
pub struct Qwen3CloneProfile {
    pub reference_audio_path: PathBuf,
    pub transcript: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MlxAudioCloneProfile {
    pub reference_audio_path: PathBuf,
    pub transcript: Option<String>,
}

pub fn sherpa_runtime_definition() -> Option<SherpaRuntimeDefinition> {
    #[cfg(target_os = "macos")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "macos-universal2",
            archive_name: "tts-sherpa-runtime-macos-universal2.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-osx-universal2-shared.tar.bz2",
        });
    }
    #[cfg(target_os = "linux")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "linux-x64",
            archive_name: "tts-sherpa-runtime-linux-x64.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-linux-x64-shared.tar.bz2",
        });
    }
    #[cfg(target_os = "windows")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "windows-x64",
            archive_name: "tts-sherpa-runtime-win-x64.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-win-x64-shared.tar.bz2",
        });
    }
    #[allow(unreachable_code)]
    None
}

pub fn sherpa_runtime_binary_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return runtime_root.join("bin").join("sherpa-onnx-offline-tts.exe");
    }
    #[cfg(not(target_os = "windows"))]
    {
        runtime_root.join("bin").join("sherpa-onnx-offline-tts")
    }
}

pub fn current_runtime_platform_id() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "darwin"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        "unknown"
    }
}

pub fn managed_speech_runtime_definition() -> Option<ManagedSpeechRuntimeDefinition> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "macos-aarch64",
            archive_name: "speech-runtime-macos-aarch64.tar.gz",
        });
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "macos-x64",
            archive_name: "speech-runtime-macos-x64.tar.gz",
        });
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "linux-x64",
            archive_name: "speech-runtime-linux-x64.tar.gz",
        });
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "windows-x64",
            archive_name: "speech-runtime-windows-x64.tar.gz",
        });
    }
    #[allow(unreachable_code)]
    None
}

pub fn managed_speech_runtime_entrypoint(runtime_root: &Path) -> Option<PathBuf> {
    [
        runtime_root.join("runtime").join("app.py"),
        runtime_root.join("app.py"),
    ]
    .into_iter()
    .find(|candidate| candidate.exists())
}

pub fn qwen3_runtime_definition() -> Option<(&'static str, &'static str, &'static str)> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some((
            "macos-aarch64",
            "qwen3-tts-macos-aarch64.zip",
            "https://github.com/second-state/qwen3_tts_rs/releases/download/v0.1.5/qwen3-tts-macos-aarch64.zip",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        return Some((
            "linux-x64",
            "qwen3-tts-linux-x86_64.zip",
            "https://github.com/second-state/qwen3_tts_rs/releases/download/v0.1.5/qwen3-tts-linux-x86_64.zip",
        ));
    }
    #[cfg(target_os = "windows")]
    {
        return Some((
            "windows-x64",
            "qwen3-tts-windows-x86_64.zip",
            "https://github.com/second-state/qwen3_tts_rs/releases/download/v0.1.5/qwen3-tts-windows-x86_64.zip",
        ));
    }
    #[allow(unreachable_code)]
    None
}

pub fn qwen3_runtime_binary_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        runtime_root.join("tts.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        runtime_root.join("tts")
    }
}

pub fn qwen3_voice_clone_binary_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        runtime_root.join("voice_clone.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        runtime_root.join("voice_clone")
    }
}

pub fn qwen3_language_for_locale(locale: Option<&str>) -> String {
    match locale.map(locale_language).as_deref() {
        Some("zh") => "chinese".to_string(),
        _ => "english".to_string(),
    }
}

pub fn mlx_audio_language_for_locale(locale: Option<&str>) -> String {
    locale
        .map(locale_language)
        .filter(|language| !language.trim().is_empty())
        .unwrap_or_else(|| "en".to_string())
}

pub fn ensure_profile_supports_qwen3_base(profile: &ResolvedTtsVoiceProfile) -> Result<(), String> {
    if !profile
        .compatible_provider_ids
        .iter()
        .any(|provider_id| provider_id == TTS_PROVIDER_QWEN3_NATIVE_ID)
    {
        return Err(format!(
            "Voice profile '{}' is not marked as compatible with Qwen3 Native.",
            profile.label
        ));
    }

    if !profile
        .compatible_model_ids
        .iter()
        .any(|model_id| model_id == "qwen3-0.6b-base")
    {
        return Err(format!(
            "Voice profile '{}' is not marked as compatible with Qwen3 0.6B Base.",
            profile.label
        ));
    }

    Ok(())
}

pub fn resolve_extracted_root(base_dir: &Path) -> Option<PathBuf> {
    if !base_dir.exists() {
        return None;
    }

    let mut current = base_dir.to_path_buf();
    loop {
        let entries = fs::read_dir(&current).ok()?;
        let mut child_dirs = Vec::new();
        let mut saw_file = false;

        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }

            if entry.file_type().ok()?.is_dir() {
                child_dirs.push(path);
            } else {
                saw_file = true;
            }
        }

        if !saw_file && child_dirs.len() == 1 {
            current = child_dirs.pop().unwrap();
            continue;
        }

        return Some(current);
    }
}

pub fn copy_directory_recursive(source_dir: &Path, destination_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination_dir)?;

    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination_dir.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
        } else {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

pub fn extract_archive(archive_path: &Path, install_dir: &Path) -> Result<(), String> {
    if install_dir.exists() {
        fs::remove_dir_all(install_dir)
            .map_err(|err| format!("Failed to clear archive destination: {err}"))?;
    }
    fs::create_dir_all(install_dir)
        .map_err(|err| format!("Failed to create archive destination: {err}"))?;

    let file = File::open(archive_path)
        .map_err(|err| format!("Failed to open archive {:?}: {err}", archive_path))?;
    let archive_name = archive_path.to_string_lossy();

    if archive_name.ends_with(".tar.gz") {
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(install_dir)
            .map_err(|err| format!("Failed to extract tar.gz archive: {err}"))?;
    } else if archive_name.ends_with(".tar.bz2") {
        let decoder = bzip2::read::BzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(install_dir)
            .map_err(|err| format!("Failed to extract tar.bz2 archive: {err}"))?;
    } else if archive_name.ends_with(".zip") {
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|err| format!("Failed to read zip archive: {err}"))?;
        archive
            .extract(install_dir)
            .map_err(|err| format!("Failed to extract zip archive: {err}"))?;
    } else {
        return Err(format!(
            "Unsupported TTS archive format: {}",
            archive_path.display()
        ));
    }

    Ok(())
}

/// Repair a WAV file whose RIFF header size doesn't match the actual file size.
/// mlx-audio can produce files where the RIFF size field is short by a few bytes,
/// causing symphonia/rodio to truncate or silently skip audio data.
pub fn repair_wav_riff_header(path: &Path) {
    use std::io::{Read, Seek, SeekFrom, Write};
    let Ok(mut file) = fs::OpenOptions::new().read(true).write(true).open(path) else {
        return;
    };
    let Ok(file_size) = file.seek(SeekFrom::End(0)) else {
        return;
    };
    if file_size < 8 {
        return;
    }
    let mut header = [0u8; 4];
    let _ = file.seek(SeekFrom::Start(0));
    if file.read_exact(&mut header).is_err() || &header != b"RIFF" {
        return;
    }
    let mut size_buf = [0u8; 4];
    if file.read_exact(&mut size_buf).is_err() {
        return;
    }
    let declared = u32::from_le_bytes(size_buf);
    let expected = (file_size - 8) as u32;
    if declared != expected {
        let _ = file.seek(SeekFrom::Start(4));
        let _ = file.write_all(&expected.to_le_bytes());
    }
}

pub fn tuning_number_override(tuning: &TtsVoiceTuningSettings, key: &str) -> Option<f32> {
    match tuning.advanced_overrides.get(key) {
        Some(TtsStyleControlValue::Number(value)) => Some(*value),
        _ => None,
    }
}

pub fn tts_temp_file(app_handle: &AppHandle, extension: &str) -> Result<PathBuf, String> {
    let base_dir = portable::app_data_dir(app_handle)
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;
    let tts_dir = base_dir.join("tts-cache");
    fs::create_dir_all(&tts_dir).map_err(|err| format!("Failed to create TTS cache dir: {err}"))?;
    Ok(tts_dir.join(format!("{}.{}", Uuid::new_v4(), extension)))
}

pub fn synthesize_sherpa_chunk(
    text: &str,
    context: &SherpaContext,
    rate: f32,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Err("Story rendering was cancelled.".to_string());
    }

    let temp_file = std::env::temp_dir().join(format!("vox-jot-sherpa-{}.wav", Uuid::new_v4()));
    let binary_path = sherpa_runtime_binary_path(&context.runtime_root);
    let lib_dir = context.runtime_root.join("lib");
    let mut command = Command::new(&binary_path);
    command
        .arg(format!("--output-filename={}", temp_file.display()))
        .arg("--num-threads=2");

    match context.manifest.model_family {
        SherpaModelFamily::Vits => {
            command
                .arg(format!(
                    "--vits-model={}",
                    context
                        .pack_root
                        .join(&context.manifest.model_file)
                        .display()
                ))
                .arg(format!(
                    "--vits-tokens={}",
                    context
                        .pack_root
                        .join(&context.manifest.tokens_file)
                        .display()
                ))
                .arg(format!(
                    "--vits-length-scale={:.3}",
                    (1.0 / rate.clamp(0.5, 2.0)).clamp(0.5, 2.0)
                ));

            if let Some(data_dir) = context.manifest.data_dir.as_deref() {
                command.arg(format!(
                    "--vits-data-dir={}",
                    context.pack_root.join(data_dir).display()
                ));
            }
            if let Some(lexicon_file) = context.manifest.lexicon_file.as_deref() {
                command.arg(format!(
                    "--vits-lexicon={}",
                    context.pack_root.join(lexicon_file).display()
                ));
            }
        }
    }

    if !context.manifest.rule_fsts.is_empty() {
        let joined = context
            .manifest
            .rule_fsts
            .iter()
            .map(|file| context.pack_root.join(file).display().to_string())
            .collect::<Vec<_>>()
            .join(",");
        command.arg(format!("--tts-rule-fsts={}", joined));
    }

    #[cfg(target_os = "macos")]
    command.env("DYLD_LIBRARY_PATH", &lib_dir);
    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", &lib_dir);
    #[cfg(target_os = "windows")]
    {
        let existing_path = std::env::var_os("PATH").unwrap_or_default();
        let mut runtime_path = std::ffi::OsString::from(lib_dir.as_os_str());
        runtime_path.push(";");
        runtime_path.push(context.runtime_root.join("bin"));
        runtime_path.push(";");
        runtime_path.push(existing_path);
        command.env("PATH", runtime_path);
    }

    let output = command
        .arg(text)
        .output()
        .map_err(|err| format!("Failed to run Sherpa-ONNX TTS: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            format!("Sherpa-ONNX TTS failed: {stderr}")
        } else if !stdout.is_empty() {
            format!("Sherpa-ONNX TTS failed: {stdout}")
        } else {
            "Sherpa-ONNX TTS failed without a detailed error.".to_string()
        });
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_file);
        return Err("Story rendering was cancelled.".to_string());
    }

    Ok(temp_file)
}

pub fn speak_sherpa_chunk(
    text: &str,
    context: &SherpaContext,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let temp_file = synthesize_sherpa_chunk(text, context, rate, stop_flag)?;
    let play_result =
        audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play Sherpa-ONNX speech audio: {err}"));
    let _ = fs::remove_file(&temp_file);
    play_result
}

pub fn synthesize_lfm_audio_gguf_chunk(
    text: &str,
    context: &crate::lfm_audio_gguf::LfmAudioGgufContext,
    preferred_voice_id: Option<&str>,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Err("Story rendering was cancelled.".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let file_uuid = Uuid::new_v4().to_string();
    let temp_cwd = temp_dir.join(format!("lfm-audio-gguf-{}", file_uuid));
    std::fs::create_dir_all(&temp_cwd)
        .map_err(|err| format!("Failed to create temp LFM Audio dir: {err}"))?;
    let out_wav = temp_cwd.join("output.wav");

    let voice = crate::lfm_audio_gguf::LfmAudioVoice::from_voice_id(preferred_voice_id);
    let synth_result = context.synthesize_with_voice(text, &out_wav, voice);
    if let Err(err) = synth_result {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err(err);
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err("Story rendering was cancelled.".to_string());
    }

    repair_wav_riff_header(&out_wav);
    let temp_file = std::env::temp_dir().join(format!("vox-jot-lfm-audio-{}.wav", Uuid::new_v4()));
    std::fs::copy(&out_wav, &temp_file)
        .map_err(|err| format!("Failed to preserve LFM Audio output: {err}"))?;
    let _ = std::fs::remove_dir_all(&temp_cwd);
    Ok(temp_file)
}

pub fn speak_lfm_audio_gguf_chunk(
    text: &str,
    context: &crate::lfm_audio_gguf::LfmAudioGgufContext,
    preferred_voice_id: Option<&str>,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let out_wav = synthesize_lfm_audio_gguf_chunk(text, context, preferred_voice_id, stop_flag)?;

    let play_result =
        audio_playback::play_audio_file_with_stop(&out_wav, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play LFM Audio speech: {err}"));

    let _ = std::fs::remove_file(&out_wav);
    play_result
}

pub fn synthesize_vibevoice_chunk(
    text: &str,
    context: &crate::vibevoice::VibeVoiceContext,
    preferred_voice_id: Option<&str>,
    tuning: &TtsVoiceTuningSettings,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Err("Story rendering was cancelled.".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let file_uuid = Uuid::new_v4().to_string();
    let temp_cwd = temp_dir.join(format!("vibevoice-{}", file_uuid));
    std::fs::create_dir_all(&temp_cwd)
        .map_err(|err| format!("Failed to create temp VibeVoice dir: {err}"))?;
    let out_wav = temp_cwd.join("output.wav");

    let cfg_scale = tuning_number_override(tuning, "cfg_weight");
    let synth_result = context.synthesize(text, &out_wav, preferred_voice_id, cfg_scale);
    if let Err(err) = synth_result {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err(err);
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err("Story rendering was cancelled.".to_string());
    }

    let temp_file = std::env::temp_dir().join(format!("vox-jot-vibevoice-{}.wav", Uuid::new_v4()));
    std::fs::copy(&out_wav, &temp_file)
        .map_err(|err| format!("Failed to preserve VibeVoice output: {err}"))?;
    let _ = std::fs::remove_dir_all(&temp_cwd);
    Ok(temp_file)
}

pub fn speak_vibevoice_chunk(
    text: &str,
    context: &crate::vibevoice::VibeVoiceContext,
    preferred_voice_id: Option<&str>,
    tuning: &TtsVoiceTuningSettings,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let out_wav = synthesize_vibevoice_chunk(text, context, preferred_voice_id, tuning, stop_flag)?;

    let play_result =
        audio_playback::play_audio_file_with_stop(&out_wav, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play VibeVoice speech: {err}"));

    let _ = std::fs::remove_file(&out_wav);
    play_result
}

pub fn synthesize_qwen3_chunk(
    text: &str,
    context: &Qwen3Context,
    tuning: &TtsVoiceTuningSettings,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Err("Story rendering was cancelled.".to_string());
    }

    let binary_path = if context.clone_profile.is_some() {
        qwen3_voice_clone_binary_path(&context.runtime_root)
    } else {
        qwen3_runtime_binary_path(&context.runtime_root)
    };
    if !binary_path.exists() {
        return Err(format!(
            "Qwen3 runtime binary is missing: {}",
            binary_path.display()
        ));
    }

    let temp_dir = std::env::temp_dir();
    let file_uuid = Uuid::new_v4().to_string();
    let temp_cwd = temp_dir.join(format!("qwen3-{}", file_uuid));
    std::fs::create_dir_all(&temp_cwd)
        .map_err(|e| format!("Failed to create temp qwen3 dir: {}", e))?;

    let mut command = Command::new(&binary_path);
    command.current_dir(&temp_cwd);
    command.arg(&context.model_root);
    if let Some(profile) = context.clone_profile.as_ref() {
        command.arg(&profile.reference_audio_path);
        command.arg(text);
        command.arg(&context.language);
        if let Some(transcript) = profile.transcript.as_deref() {
            command.arg(transcript);
        }
    } else {
        command.arg(text);
        if let Some(instruct) = tuning
            .style_instructions
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && context.supports_instruction_prompt)
        {
            command.arg("Vivian");
            command.arg(&context.language);
            command.arg(instruct);
        }
    }

    let output = command
        .output()
        .map_err(|err| format!("Failed to run Qwen3 TTS: {err}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            format!(
                "Qwen3 {} failed: {stderr}",
                if context.clone_profile.is_some() {
                    "voice cloning"
                } else {
                    "TTS"
                }
            )
        } else if !stdout.is_empty() {
            format!(
                "Qwen3 {} failed: {stdout}",
                if context.clone_profile.is_some() {
                    "voice cloning"
                } else {
                    "TTS"
                }
            )
        } else {
            format!(
                "Qwen3 {} failed without a detailed error.",
                if context.clone_profile.is_some() {
                    "voice cloning"
                } else {
                    "TTS"
                }
            )
        });
    }

    let out_wav = temp_cwd.join("output_voice_clone.wav");
    let out_wav_standard = temp_cwd.join("output.wav");
    let actual_out_wav = if out_wav.exists() {
        out_wav
    } else {
        out_wav_standard
    };

    if !actual_out_wav.exists() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err("Qwen3 TTS succeeded but no output wav file was found.".to_string());
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err("Story rendering was cancelled.".to_string());
    }

    let temp_file = std::env::temp_dir().join(format!("vox-jot-qwen3-{}.wav", Uuid::new_v4()));
    std::fs::copy(&actual_out_wav, &temp_file)
        .map_err(|err| format!("Failed to preserve Qwen3 output: {err}"))?;
    let _ = std::fs::remove_dir_all(&temp_cwd);
    Ok(temp_file)
}

pub fn speak_qwen3_chunk(
    text: &str,
    context: &Qwen3Context,
    tuning: &TtsVoiceTuningSettings,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let output_path = synthesize_qwen3_chunk(text, context, tuning, stop_flag)?;
    let play_result =
        audio_playback::play_audio_file_with_stop(&output_path, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play Qwen3 speech audio: {err}"));
    let _ = std::fs::remove_file(&output_path);
    play_result
}

pub fn synthesize_mlx_audio_chunk(
    text: &str,
    context: &MlxAudioContext,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Err("Story rendering was cancelled.".to_string());
    }

    let mlx_target = format!(
        "MLX speech provider '{}' model '{}' ({})",
        context.provider_id, context.model_id, context.model_label
    );

    let temp_dir = std::env::temp_dir();
    let file_uuid = Uuid::new_v4().to_string();
    let temp_cwd = temp_dir.join(format!("mlx-audio-{}", file_uuid));
    std::fs::create_dir_all(&temp_cwd)
        .map_err(|err| format!("Failed to create temp MLX audio dir: {err}"))?;
    let output_path =
        std::env::temp_dir().join(format!("vox-jot-mlx-audio-{}.wav", Uuid::new_v4()));

    let mut command = Command::new(&context.python_path);
    command
        .arg("-W")
        .arg("ignore")
        .arg(&context.bridge_script_path)
        .arg("--model")
        .arg(&context.model_source)
        .arg("--text")
        .arg(text)
        .arg("--output")
        .arg(&output_path)
        .arg("--lang-code")
        .arg(&context.language)
        .arg("--speed")
        .arg(tuning.tempo_rate.clamp(0.5, 2.0).to_string())
        .arg("--temperature")
        .arg(tuning.randomness.clamp(0.0, 2.0).to_string())
        .arg("--repetition-penalty")
        .arg(tuning.repetition_penalty.max(1.0).to_string())
        .current_dir(&temp_cwd)
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(top_p) = tuning_number_override(tuning, "top_p") {
        command
            .arg("--top-p")
            .arg(top_p.clamp(0.0, 1.0).to_string());
    }
    if let Some(top_k) = tuning_number_override(tuning, "top_k") {
        command
            .arg("--top-k")
            .arg(top_k.clamp(1.0, 500.0).round().to_string());
    }
    if let Some(min_p) = tuning_number_override(tuning, "min_p") {
        command
            .arg("--min-p")
            .arg(min_p.clamp(0.0, 1.0).to_string());
    }
    if let Some(cfg_weight) = tuning_number_override(tuning, "cfg_weight") {
        command
            .arg("--cfg-weight")
            .arg(cfg_weight.clamp(0.0, 5.0).to_string());
    }
    if let Some(exaggeration) = tuning_number_override(tuning, "exaggeration") {
        command
            .arg("--exaggeration")
            .arg(exaggeration.clamp(0.0, 2.0).to_string());
    }

    if let Some(voice_id) = preferred_voice_id
        .map(str::trim)
        .filter(|voice_id| !voice_id.is_empty())
        .or_else(|| {
            voice
                .map(|voice| voice.id.as_str())
                .filter(|voice_id| !voice_id.trim().is_empty())
        })
    {
        command.arg("--voice").arg(voice_id);
    }

    if let Some(instruct) = tuning
        .style_instructions
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && context.supports_instruction_prompt)
    {
        command.arg("--instruct").arg(instruct);
    }

    if let Some(profile) = context.clone_profile.as_ref() {
        command
            .arg("--ref-audio")
            .arg(&profile.reference_audio_path);
        if let Some(transcript) = profile
            .transcript
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command.arg("--ref-text").arg(transcript);
        }
    }

    let output = command
        .output()
        .map_err(|err| format!("Failed to run MLX speech generation: {err}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            format!("{mlx_target} failed: {stderr}")
        } else if !stdout.is_empty() {
            format!("{mlx_target} failed: {stdout}")
        } else {
            format!("{mlx_target} failed without a detailed error.")
        });
    }

    if !output_path.exists() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err(format!(
            "{mlx_target} completed without producing an audio file."
        ));
    }

    // mlx-audio can produce WAV files with an incorrect RIFF size header.
    // Fix it in place so rodio/symphonia decodes the full audio.
    repair_wav_riff_header(&output_path);

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        let _ = std::fs::remove_file(&output_path);
        return Err("Story rendering was cancelled.".to_string());
    }

    let _ = std::fs::remove_dir_all(&temp_cwd);
    Ok(output_path)
}

pub fn speak_mlx_audio_chunk(
    text: &str,
    context: &MlxAudioContext,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let output_path =
        synthesize_mlx_audio_chunk(text, context, preferred_voice_id, voice, tuning, stop_flag)?;
    let play_result =
        audio_playback::play_audio_file_with_stop(&output_path, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play MLX speech audio: {err}"));
    let _ = std::fs::remove_file(&output_path);
    play_result
}

pub fn synthesize_system_chunk(
    app_handle: &AppHandle,
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    rate: f32,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = locale;
        synthesize_system_chunk_macos(app_handle, text, voice, rate, stop_flag)
    }
    #[cfg(target_os = "windows")]
    {
        synthesize_system_chunk_windows(app_handle, text, locale, voice, rate, stop_flag)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app_handle, text, locale, voice, rate, stop_flag);
        Err("System TTS is not supported on this platform.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn synthesize_system_chunk_macos(
    app_handle: &AppHandle,
    text: &str,
    voice: Option<&VoiceInfo>,
    rate: f32,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    // `say` on this macOS stack will happily synthesize AIFF, while our playback
    // path is happiest with PCM WAV. Generate AIFF first, then normalize with
    // `afconvert` before playback.
    let synthesized_file = tts_temp_file(app_handle, "aiff")?;
    let playback_file = tts_temp_file(app_handle, "wav")?;
    let rate_wpm = (rate_to_words_per_minute(rate)).to_string();
    let mut command = Command::new("/usr/bin/say");
    if let Some(voice) = voice {
        command.args(["-v", &voice.id]);
    }
    command
        .arg("-r")
        .arg(rate_wpm)
        .arg("-o")
        .arg(&synthesized_file)
        .arg(text)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start macOS speech synthesis: {err}"))?;

    while !stop_flag.load(Ordering::Relaxed) {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let output = child.wait_with_output().map_err(|err| {
                        format!("Failed to read macOS speech synthesis error: {err}")
                    })?;
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(if stderr.is_empty() {
                        "macOS speech synthesis failed.".to_string()
                    } else {
                        format!("macOS speech synthesis failed: {stderr}")
                    });
                }
                break;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(err) => return Err(format!("Failed to monitor speech synthesis: {err}")),
        }
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(&synthesized_file);
        let _ = fs::remove_file(&playback_file);
        return Err("Story rendering was cancelled.".to_string());
    }

    if !synthesized_file.exists() {
        return Err("macOS speech synthesis did not create an audio file.".to_string());
    }

    let afconvert_output = Command::new("/usr/bin/afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@22050"])
        .arg(&synthesized_file)
        .arg(&playback_file)
        .output()
        .map_err(|err| format!("Failed to start macOS audio conversion: {err}"))?;
    if !afconvert_output.status.success() {
        let stderr = String::from_utf8_lossy(&afconvert_output.stderr)
            .trim()
            .to_string();
        let _ = fs::remove_file(&synthesized_file);
        let _ = fs::remove_file(&playback_file);
        return Err(if stderr.is_empty() {
            "macOS audio conversion failed.".to_string()
        } else {
            format!("macOS audio conversion failed: {stderr}")
        });
    }

    let _ = fs::remove_file(&synthesized_file);
    Ok(playback_file)
}

#[cfg(target_os = "windows")]
fn synthesize_system_chunk_windows(
    app_handle: &AppHandle,
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    rate: f32,
    stop_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    let temp_file = tts_temp_file(app_handle, "wav")?;
    let mut script = String::from(
        "Add-Type -AssemblyName System.Speech\n$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer\n",
    );
    if let Some(voice) = voice {
        script.push_str(&format!(
            "$synth.SelectVoice('{}')\n",
            voice.id.replace('\'', "''")
        ));
    } else if let Some(locale) = locale {
        script.push_str(
            "$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq '",
        );
        script.push_str(&locale.replace('\'', "''"));
        script.push_str("' } | Select-Object -First 1\nif ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }\n");
    }
    script.push_str(&format!(
        "$synth.Rate = {}\n$synth.SetOutputToWaveFile('{}')\n$synth.Speak('{}')\n$synth.Dispose()\n",
        rate_to_windows_rate(rate),
        temp_file.display().to_string().replace('\'', "''"),
        text.replace('\'', "''")
    ));

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|err| format!("Failed to run Windows speech synthesis: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_file);
        return Err("Story rendering was cancelled.".to_string());
    }

    Ok(temp_file)
}

pub fn speak_system_chunk(
    app_handle: &AppHandle,
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let temp_file = synthesize_system_chunk(app_handle, text, locale, voice, rate, stop_flag)?;
    let play_result =
        audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play speech audio: {err}"));
    let _ = fs::remove_file(&temp_file);
    play_result
}
