use crate::portable;
use crate::settings::{get_settings, write_settings, TTS_PROVIDER_QWEN3_NATIVE_ID};
use crate::tts::supported_voice_profile_compatibility;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

const PROFILE_METADATA_FILE_NAME: &str = "profile.json";
const REFERENCE_AUDIO_FILE_NAME: &str = "reference.wav";
const QWEN3_CLONE_MODEL_ID: &str = "qwen3-0.6b-base";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TtsVoiceProfileDescriptor {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub transcript: Option<String>,
    pub compatible_provider_ids: Vec<String>,
    pub compatible_model_ids: Vec<String>,
    pub has_reference_audio: bool,
    pub reference_audio_path: Option<String>,
    pub sample_rate_hz: Option<u32>,
    pub ready: bool,
    pub continuous_improvement_enabled: bool,
    pub collected_audio_duration_secs: f32,
    pub satisfactory_threshold_secs: f32,
    pub fully_optimized: bool,
}

#[derive(Debug, Clone)]
pub struct ResolvedTtsVoiceProfile {
    pub label: String,
    pub transcript: Option<String>,
    pub compatible_provider_ids: Vec<String>,
    pub compatible_model_ids: Vec<String>,
    pub reference_audio_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTtsVoiceProfile {
    id: String,
    label: String,
    description: Option<String>,
    transcript: Option<String>,
    compatible_provider_ids: Vec<String>,
    compatible_model_ids: Vec<String>,
    reference_audio_file_name: Option<String>,
    sample_rate_hz: Option<u32>,
    #[serde(default)]
    continuous_improvement_enabled: bool,
    #[serde(default)]
    collected_audio_duration_secs: f32,
    #[serde(default = "default_satisfactory_threshold_secs")]
    satisfactory_threshold_secs: f32,
    #[serde(default)]
    fully_optimized: bool,
}

fn default_satisfactory_threshold_secs() -> f32 {
    60.0
}

fn legacy_qwen_only_profile(
    compatible_provider_ids: &[String],
    compatible_model_ids: &[String],
) -> bool {
    compatible_provider_ids.len() == 1
        && compatible_provider_ids[0] == TTS_PROVIDER_QWEN3_NATIVE_ID
        && compatible_model_ids.len() == 1
        && compatible_model_ids[0] == QWEN3_CLONE_MODEL_ID
}

fn normalize_profile_compatibility(
    compatible_provider_ids: Vec<String>,
    compatible_model_ids: Vec<String>,
) -> (Vec<String>, Vec<String>) {
    let mut provider_ids = compatible_provider_ids
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    provider_ids.sort();
    provider_ids.dedup();

    let mut model_ids = compatible_model_ids
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    model_ids.sort();
    model_ids.dedup();

    if provider_ids.is_empty()
        || model_ids.is_empty()
        || legacy_qwen_only_profile(&provider_ids, &model_ids)
    {
        let compatibility = supported_voice_profile_compatibility();
        return (compatibility.provider_ids, compatibility.model_ids);
    }

    (provider_ids, model_ids)
}

impl StoredTtsVoiceProfile {
    fn into_descriptor(self, profile_dir: &Path) -> Result<TtsVoiceProfileDescriptor, String> {
        let (compatible_provider_ids, compatible_model_ids) = normalize_profile_compatibility(
            self.compatible_provider_ids,
            self.compatible_model_ids,
        );
        let reference_audio_path = match self.reference_audio_file_name.as_deref() {
            Some(file_name) => {
                let path = reference_audio_path(profile_dir, file_name)?;
                path.is_file().then_some(path)
            }
            None => None,
        };

        Ok(TtsVoiceProfileDescriptor {
            id: self.id,
            label: self.label,
            description: self.description,
            transcript: self.transcript,
            compatible_provider_ids,
            compatible_model_ids,
            has_reference_audio: reference_audio_path.is_some(),
            reference_audio_path: reference_audio_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            sample_rate_hz: self.sample_rate_hz,
            ready: reference_audio_path.is_some(),
            continuous_improvement_enabled: self.continuous_improvement_enabled,
            collected_audio_duration_secs: self.collected_audio_duration_secs,
            satisfactory_threshold_secs: self.satisfactory_threshold_secs,
            fully_optimized: self.fully_optimized,
        })
    }
}

pub fn list_voice_profiles(
    app_handle: &AppHandle,
) -> Result<Vec<TtsVoiceProfileDescriptor>, String> {
    let root = profiles_root(app_handle)?;
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut profiles = Vec::new();
    let entries = fs::read_dir(&root)
        .map_err(|err| format!("Failed to read TTS profile directory: {err}"))?;
    for entry in entries.flatten() {
        let profile_dir = entry.path();
        if !profile_dir.is_dir() {
            continue;
        }

        match read_profile_metadata(&profile_dir)
            .and_then(|metadata| metadata.into_descriptor(&profile_dir))
        {
            Ok(profile) => profiles.push(profile),
            Err(error) => log::warn!(
                "Skipping invalid TTS voice profile at '{}': {}",
                profile_dir.display(),
                error
            ),
        }
    }

    profiles.sort_by_key(|profile| profile.label.to_lowercase());
    Ok(profiles)
}

pub fn create_voice_profile(
    app_handle: &AppHandle,
    label: String,
    description: Option<String>,
    transcript: Option<String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let trimmed_label = label.trim();
    if trimmed_label.is_empty() {
        return Err("Voice profile name cannot be empty.".to_string());
    }

    let profile_id = Uuid::new_v4().to_string();
    let profile_dir = profile_dir(app_handle, &profile_id)?;
    fs::create_dir_all(&profile_dir)
        .map_err(|err| format!("Failed to create TTS profile directory: {err}"))?;

    let metadata = StoredTtsVoiceProfile {
        id: profile_id,
        label: trimmed_label.to_string(),
        description: clean_optional_text(description),
        transcript: clean_optional_text(transcript),
        compatible_provider_ids: supported_voice_profile_compatibility().provider_ids,
        compatible_model_ids: supported_voice_profile_compatibility().model_ids,
        reference_audio_file_name: None,
        sample_rate_hz: None,
        continuous_improvement_enabled: false,
        collected_audio_duration_secs: 0.0,
        satisfactory_threshold_secs: default_satisfactory_threshold_secs(),
        fully_optimized: false,
    };

    write_profile_metadata(&profile_dir, &metadata)?;
    metadata.into_descriptor(&profile_dir)
}

pub fn import_profile_reference_audio(
    app_handle: &AppHandle,
    profile_id: &str,
    source_path: &str,
    transcript: Option<String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if !profile_dir.exists() {
        return Err("Voice profile not found.".to_string());
    }

    let source_path = PathBuf::from(source_path);
    if !source_path.exists() {
        return Err(format!(
            "Reference audio file not found: {}",
            source_path.display()
        ));
    }

    if source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("wav"))
        != Some(true)
    {
        return Err(
            "Qwen voice cloning currently requires a WAV reference file. Vox Jot will normalize WAV audio to mono 24kHz automatically."
                .to_string(),
        );
    }

    let mut metadata = read_profile_metadata(&profile_dir)?;
    let (mono, sample_rate) = read_wav_as_mono_f32(&source_path)?;
    let normalized = resample_linear(&mono, sample_rate, 24_000);
    if normalized.is_empty() {
        return Err("Reference audio file did not contain any usable samples.".to_string());
    }

    let normalized_path = reference_audio_path(&profile_dir, REFERENCE_AUDIO_FILE_NAME)?;
    write_mono_wav_24k(&normalized_path, &normalized)?;

    if let Some(transcript) = clean_optional_text(transcript) {
        metadata.transcript = Some(transcript);
    }
    metadata.reference_audio_file_name = Some(REFERENCE_AUDIO_FILE_NAME.to_string());
    metadata.sample_rate_hz = Some(24_000);
    write_profile_metadata(&profile_dir, &metadata)?;

    metadata.into_descriptor(&profile_dir)
}

pub fn delete_voice_profile(app_handle: &AppHandle, profile_id: &str) -> Result<(), String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir)
            .map_err(|err| format!("Failed to remove TTS voice profile: {err}"))?;
    }

    let mut settings = get_settings(app_handle);
    let selected_deleted_profile = settings.selected_tts_profile_id.as_deref() == Some(profile_id);
    let removed_presets = settings.delete_tts_presets_for_profile(profile_id);
    if removed_presets > 0 || selected_deleted_profile {
        write_settings(app_handle, settings);
    }

    Ok(())
}

pub fn resolve_voice_profile(
    app_handle: &AppHandle,
    profile_id: &str,
) -> Result<ResolvedTtsVoiceProfile, String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    let metadata = read_profile_metadata(&profile_dir)?;
    let reference_audio_path = metadata
        .reference_audio_file_name
        .as_deref()
        .map(|file_name| reference_audio_path(&profile_dir, file_name))
        .transpose()?
        .filter(|path| path.is_file())
        .ok_or_else(|| {
            format!(
                "Voice profile '{}' does not have reference audio yet.",
                metadata.label
            )
        })?;

    Ok(ResolvedTtsVoiceProfile {
        label: metadata.label,
        transcript: metadata.transcript,
        compatible_provider_ids: metadata.compatible_provider_ids,
        compatible_model_ids: metadata.compatible_model_ids,
        reference_audio_path,
    })
}

pub fn maybe_backfill_profile_transcript(
    app_handle: &AppHandle,
    profile_id: &str,
    mut transcribe_reference: impl FnMut(&Path) -> Result<Option<String>, String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if !profile_dir.exists() {
        return Err("Voice profile not found.".to_string());
    }

    let mut metadata = read_profile_metadata(&profile_dir)?;
    let has_transcript = metadata
        .transcript
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if has_transcript {
        return metadata.into_descriptor(&profile_dir);
    }

    let Some(reference_audio_file_name) = metadata.reference_audio_file_name.clone() else {
        return metadata.into_descriptor(&profile_dir);
    };
    let reference_audio_path = reference_audio_path(&profile_dir, &reference_audio_file_name)?;
    if !reference_audio_path.is_file() {
        return metadata.into_descriptor(&profile_dir);
    }

    if let Some(transcript) = transcribe_reference(&reference_audio_path)? {
        if let Some(cleaned_transcript) = clean_optional_text(Some(transcript)) {
            metadata.transcript = Some(cleaned_transcript);
            write_profile_metadata(&profile_dir, &metadata)?;
        }
    }

    metadata.into_descriptor(&profile_dir)
}

pub fn set_continuous_improvement(
    app_handle: &AppHandle,
    profile_id: &str,
    enabled: bool,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if !profile_dir.exists() {
        return Err("Voice profile not found.".to_string());
    }

    // If enabling, disable on all other profiles first
    if enabled {
        let root = profiles_root(app_handle)?;
        if root.exists() {
            let entries = fs::read_dir(&root)
                .map_err(|err| format!("Failed to read TTS profile directory: {err}"))?;
            for entry in entries.flatten() {
                let other_dir = entry.path();
                if !other_dir.is_dir() || other_dir == profile_dir {
                    continue;
                }
                if let Ok(mut other_meta) = read_profile_metadata(&other_dir) {
                    if other_meta.continuous_improvement_enabled {
                        other_meta.continuous_improvement_enabled = false;
                        let _ = write_profile_metadata(&other_dir, &other_meta);
                    }
                }
            }
        }
    }

    let mut metadata = read_profile_metadata(&profile_dir)?;
    metadata.continuous_improvement_enabled = enabled;
    write_profile_metadata(&profile_dir, &metadata)?;
    metadata.into_descriptor(&profile_dir)
}

pub fn clear_collected_data(
    app_handle: &AppHandle,
    profile_id: &str,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if !profile_dir.exists() {
        return Err("Voice profile not found.".to_string());
    }

    let mut metadata = read_profile_metadata(&profile_dir)?;
    metadata.collected_audio_duration_secs = 0.0;
    metadata.fully_optimized = false;

    // Remove the reference audio file if it exists
    let reference_path = reference_audio_path(&profile_dir, REFERENCE_AUDIO_FILE_NAME)?;
    if let Err(error) = fs::remove_file(&reference_path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(format!(
                "Failed to remove TTS profile reference audio: {error}"
            ));
        }
    }
    metadata.reference_audio_file_name = None;
    metadata.sample_rate_hz = None;

    write_profile_metadata(&profile_dir, &metadata)?;
    metadata.into_descriptor(&profile_dir)
}

pub fn get_profile_progress(
    app_handle: &AppHandle,
    profile_id: &str,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if !profile_dir.exists() {
        return Err("Voice profile not found.".to_string());
    }
    let metadata = read_profile_metadata(&profile_dir)?;
    metadata.into_descriptor(&profile_dir)
}

pub(crate) fn validate_voice_profile_paths_for_use(
    app_handle: &AppHandle,
    profile_id: &str,
) -> Result<(), String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if !profile_dir.is_dir() {
        return Err("Voice profile not found.".to_string());
    }
    profile_metadata_path(&profile_dir)?;
    reference_audio_path(&profile_dir, REFERENCE_AUDIO_FILE_NAME)?;
    Ok(())
}

/// Append audio samples (expected mono 24kHz f32) to the profile's reference WAV.
/// Returns the new total duration in seconds.
#[cfg(not(feature = "ci-mock-transcription"))]
pub fn append_reference_audio(
    app_handle: &AppHandle,
    profile_id: &str,
    new_samples_24k: &[f32],
) -> Result<f32, String> {
    let profile_dir = profile_dir(app_handle, profile_id)?;
    if !profile_dir.exists() {
        return Err("Voice profile not found.".to_string());
    }

    let mut metadata = read_profile_metadata(&profile_dir)?;
    let reference_path = reference_audio_path(&profile_dir, REFERENCE_AUDIO_FILE_NAME)?;

    // Read existing samples if reference exists
    let mut combined = if reference_path.exists() {
        let (existing, _rate) = read_wav_as_mono_f32(&reference_path)?;
        existing
    } else {
        Vec::new()
    };

    combined.extend_from_slice(new_samples_24k);

    // Enforce max duration cap (satisfactory threshold)
    let max_samples = (metadata.satisfactory_threshold_secs * 24_000.0) as usize;
    if combined.len() > max_samples {
        // Keep the most recent samples
        let start = combined.len() - max_samples;
        combined = combined[start..].to_vec();
    }

    write_mono_wav_24k(&reference_path, &combined)?;

    let total_duration = combined.len() as f32 / 24_000.0;
    metadata.collected_audio_duration_secs = total_duration;
    metadata.reference_audio_file_name = Some(REFERENCE_AUDIO_FILE_NAME.to_string());
    metadata.sample_rate_hz = Some(24_000);

    // Check if we've hit the satisfactory threshold
    if total_duration >= metadata.satisfactory_threshold_secs {
        metadata.fully_optimized = true;
        metadata.continuous_improvement_enabled = false;
    }

    write_profile_metadata(&profile_dir, &metadata)?;
    Ok(total_duration)
}

/// Find the profile that currently has continuous improvement enabled, if any.
#[cfg(not(feature = "ci-mock-transcription"))]
pub fn find_active_improvement_profile(app_handle: &AppHandle) -> Result<Option<String>, String> {
    let root = profiles_root(app_handle)?;
    if !root.exists() {
        return Ok(None);
    }

    let entries = fs::read_dir(&root)
        .map_err(|err| format!("Failed to read TTS profile directory: {err}"))?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if let Ok(metadata) = read_profile_metadata(&dir) {
            if metadata.continuous_improvement_enabled {
                return Ok(Some(metadata.id));
            }
        }
    }
    Ok(None)
}

pub(crate) fn profiles_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = portable::app_data_dir(app_handle)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    profiles_root_from_app_data(&app_data_dir)
}

fn profile_dir(app_handle: &AppHandle, profile_id: &str) -> Result<PathBuf, String> {
    let app_data_dir = portable::app_data_dir(app_handle)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    profile_dir_from_app_data(&app_data_dir, profile_id)
}

fn profiles_root_from_app_data(app_data_dir: &Path) -> Result<PathBuf, String> {
    // Treat the resolved app-data directory as the storage boundary (including
    // portable mode), but never follow symlinks in Vox Jot's app-controlled TTS
    // storage components. Missing components are valid and may be created by a
    // subsequent profile-creation operation.
    let tts_root = app_data_dir.join("tts");
    validate_storage_directory(&tts_root, "TTS storage directory")?;

    let profiles_root = tts_root.join("profiles");
    validate_storage_directory(&profiles_root, "TTS profile storage directory")?;
    Ok(profiles_root)
}

fn profile_dir_from_app_data(app_data_dir: &Path, profile_id: &str) -> Result<PathBuf, String> {
    validate_profile_id(profile_id)?;
    let path = profiles_root_from_app_data(app_data_dir)?.join(profile_id);
    validate_profile_directory(&path)?;
    Ok(path)
}

fn validate_storage_directory(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("{label} cannot be a symbolic link."))
        }
        Ok(metadata) if !metadata.is_dir() => Err(format!("{label} is not a directory.")),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect {label}: {error}")),
    }
}

fn read_profile_metadata(profile_dir: &Path) -> Result<StoredTtsVoiceProfile, String> {
    validate_profile_directory(profile_dir)?;
    let metadata_path = profile_metadata_path(profile_dir)?;
    let bytes = fs::read(&metadata_path)
        .map_err(|err| format!("Failed to read TTS profile metadata: {err}"))?;
    let mut metadata = serde_json::from_slice::<StoredTtsVoiceProfile>(&bytes)
        .map_err(|err| format!("Failed to parse TTS profile metadata: {err}"))?;
    let (compatible_provider_ids, compatible_model_ids) = normalize_profile_compatibility(
        metadata.compatible_provider_ids.clone(),
        metadata.compatible_model_ids.clone(),
    );
    metadata.compatible_provider_ids = compatible_provider_ids;
    metadata.compatible_model_ids = compatible_model_ids;
    validate_profile_metadata_location(profile_dir, &metadata)?;
    Ok(metadata)
}

fn write_profile_metadata(
    profile_dir: &Path,
    metadata: &StoredTtsVoiceProfile,
) -> Result<(), String> {
    validate_profile_directory(profile_dir)?;
    validate_profile_metadata_location(profile_dir, metadata)?;
    let metadata_path = profile_metadata_path(profile_dir)?;
    let bytes = serde_json::to_vec_pretty(metadata)
        .map_err(|err| format!("Failed to serialize TTS profile metadata: {err}"))?;
    fs::write(metadata_path, bytes)
        .map_err(|err| format!("Failed to write TTS profile metadata: {err}"))
}

fn validate_profile_id(profile_id: &str) -> Result<(), String> {
    let parsed = Uuid::parse_str(profile_id)
        .map_err(|_| "Voice profile ID must be a canonical UUID.".to_string())?;
    if parsed.hyphenated().to_string() != profile_id {
        return Err("Voice profile ID must be a canonical UUID.".to_string());
    }
    Ok(())
}

fn validate_profile_directory(profile_dir: &Path) -> Result<(), String> {
    match fs::symlink_metadata(profile_dir) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("Voice profile directory cannot be a symbolic link.".to_string())
        }
        Ok(metadata) if !metadata.is_dir() => {
            Err("Voice profile path is not a directory.".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect TTS profile directory: {error}")),
    }
}

fn validate_profile_metadata_location(
    profile_dir: &Path,
    metadata: &StoredTtsVoiceProfile,
) -> Result<(), String> {
    validate_profile_id(&metadata.id)?;
    let directory_id = profile_dir
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Voice profile directory name is invalid.".to_string())?;
    if directory_id != metadata.id {
        return Err("Voice profile metadata ID does not match its directory.".to_string());
    }
    if let Some(file_name) = metadata.reference_audio_file_name.as_deref() {
        reference_audio_path(profile_dir, file_name)?;
    }
    Ok(())
}

fn profile_metadata_path(profile_dir: &Path) -> Result<PathBuf, String> {
    let path = profile_dir.join(PROFILE_METADATA_FILE_NAME);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Voice profile metadata cannot be a symbolic link.".to_string());
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err("Voice profile metadata path is not a file.".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!("Failed to inspect TTS profile metadata: {error}"));
        }
    }
    Ok(path)
}

fn reference_audio_path(profile_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    if file_name != REFERENCE_AUDIO_FILE_NAME {
        return Err("Voice profile reference audio filename is invalid.".to_string());
    }

    let path = profile_dir.join(file_name);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Voice profile reference audio cannot be a symbolic link.".to_string());
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err("Voice profile reference audio path is not a file.".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to inspect TTS profile reference audio: {error}"
            ));
        }
    }
    Ok(path)
}

fn clean_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then_some(trimmed.to_string())
    })
}

pub fn read_wav_as_mono_f32(path: &Path) -> Result<(Vec<f32>, u32), String> {
    crate::audio_toolkit::read_wav_file_as_mono_f32(path)
}

pub fn read_wav_as_mono_16k(path: &Path) -> Result<Vec<f32>, String> {
    let (mono, sample_rate) = read_wav_as_mono_f32(path)?;
    Ok(resample_linear(&mono, sample_rate, 16_000))
}

pub fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let ratio = target_rate as f64 / source_rate as f64;
    let output_len = ((samples.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);

    for index in 0..output_len {
        let source_position = (index as f64) / ratio;
        let left = source_position.floor() as usize;
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let fraction = (source_position - (left as f64)) as f32;

        let sample = if left == right {
            samples[left]
        } else {
            samples[left] * (1.0 - fraction) + samples[right] * fraction
        };
        output.push(sample.clamp(-1.0, 1.0));
    }

    output
}

fn write_mono_wav_24k(path: &Path, samples: &[f32]) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|err| format!("Failed to create normalized reference WAV: {err}"))?;
    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let scaled = (clamped * i16::MAX as f32).round() as i16;
        writer
            .write_sample(scaled)
            .map_err(|err| format!("Failed to write normalized reference WAV: {err}"))?;
    }
    writer
        .finalize()
        .map_err(|err| format!("Failed to finalize normalized reference WAV: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
    const OTHER_PROFILE_ID: &str = "67e55044-10b1-426f-9247-bb680e5fe0c8";

    fn stored_profile() -> StoredTtsVoiceProfile {
        StoredTtsVoiceProfile {
            id: PROFILE_ID.to_string(),
            label: "Test profile".to_string(),
            description: None,
            transcript: None,
            compatible_provider_ids: vec![TTS_PROVIDER_QWEN3_NATIVE_ID.to_string()],
            compatible_model_ids: vec![QWEN3_CLONE_MODEL_ID.to_string()],
            reference_audio_file_name: None,
            sample_rate_hz: None,
            continuous_improvement_enabled: false,
            collected_audio_duration_secs: 0.0,
            satisfactory_threshold_secs: default_satisfactory_threshold_secs(),
            fully_optimized: false,
        }
    }

    #[test]
    fn normal_profile_storage_root_is_accepted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app_data_dir = dir.path().join("app-data");
        let expected_root = app_data_dir.join("tts").join("profiles");
        let expected_profile_dir = expected_root.join(PROFILE_ID);
        fs::create_dir_all(&expected_profile_dir).expect("profile dir");

        assert_eq!(
            profiles_root_from_app_data(&app_data_dir).expect("valid profile root"),
            expected_root
        );
        assert_eq!(
            profile_dir_from_app_data(&app_data_dir, PROFILE_ID).expect("valid profile dir"),
            expected_profile_dir
        );
    }

    #[test]
    fn missing_profile_storage_root_can_be_created_normally() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app_data_dir = dir.path().join("app-data");
        let profile_dir =
            profile_dir_from_app_data(&app_data_dir, PROFILE_ID).expect("missing root is valid");

        assert!(!profile_dir.exists());
        fs::create_dir_all(&profile_dir).expect("create missing storage tree");
        assert!(profile_dir.is_dir());
        assert!(profile_dir_from_app_data(&app_data_dir, PROFILE_ID).is_ok());
    }

    #[test]
    fn profile_id_must_be_a_canonical_uuid_component() {
        assert!(validate_profile_id(PROFILE_ID).is_ok());
        for invalid in [
            "../outside",
            "/tmp/outside",
            "550e8400e29b41d4a716446655440000",
            "550E8400-E29B-41D4-A716-446655440000",
            "",
        ] {
            assert!(
                validate_profile_id(invalid).is_err(),
                "unexpectedly accepted {invalid:?}"
            );
        }
    }

    #[test]
    fn reference_audio_path_rejects_noncanonical_file_names() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(reference_audio_path(dir.path(), REFERENCE_AUDIO_FILE_NAME).is_ok());
        assert!(reference_audio_path(dir.path(), "../outside.wav").is_err());
        assert!(reference_audio_path(dir.path(), "/tmp/outside.wav").is_err());
        assert!(reference_audio_path(dir.path(), "other.wav").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn profiles_storage_directory_rejects_symbolic_links() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let app_data_dir = dir.path().join("app-data");
        let outside = dir.path().join("outside");
        fs::create_dir_all(app_data_dir.join("tts")).expect("tts dir");
        fs::create_dir(&outside).expect("outside dir");
        symlink(&outside, app_data_dir.join("tts").join("profiles")).expect("profiles symlink");

        let error = profiles_root_from_app_data(&app_data_dir)
            .expect_err("profiles symlink must be rejected");
        assert!(error.contains("TTS profile storage directory cannot be a symbolic link"));
    }

    #[cfg(unix)]
    #[test]
    fn tts_storage_directory_rejects_symbolic_links() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let app_data_dir = dir.path().join("app-data");
        let outside = dir.path().join("outside");
        fs::create_dir(&app_data_dir).expect("app data dir");
        fs::create_dir(&outside).expect("outside dir");
        symlink(&outside, app_data_dir.join("tts")).expect("tts symlink");

        let error =
            profiles_root_from_app_data(&app_data_dir).expect_err("tts symlink must be rejected");
        assert!(error.contains("TTS storage directory cannot be a symbolic link"));
    }

    #[cfg(unix)]
    #[test]
    fn reference_audio_path_rejects_symbolic_links() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let outside = dir.path().join("outside.wav");
        fs::write(&outside, b"not audio").expect("outside fixture");
        let profile_dir = dir.path().join(PROFILE_ID);
        fs::create_dir(&profile_dir).expect("profile dir");
        symlink(&outside, profile_dir.join(REFERENCE_AUDIO_FILE_NAME)).expect("reference symlink");

        let error = reference_audio_path(&profile_dir, REFERENCE_AUDIO_FILE_NAME)
            .expect_err("symlink must be rejected");
        assert!(error.contains("symbolic link"));
    }

    #[cfg(unix)]
    #[test]
    fn profile_metadata_rejects_symbolic_links_without_overwriting_the_target() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let outside = dir.path().join("outside.json");
        fs::write(&outside, b"metadata sentinel").expect("outside fixture");
        let profile_dir = dir.path().join(PROFILE_ID);
        fs::create_dir(&profile_dir).expect("profile dir");
        symlink(&outside, profile_dir.join(PROFILE_METADATA_FILE_NAME)).expect("metadata symlink");

        let read_error = read_profile_metadata(&profile_dir)
            .expect_err("metadata read must reject symbolic links");
        assert!(read_error.contains("symbolic link"));

        let write_error = write_profile_metadata(&profile_dir, &stored_profile())
            .expect_err("metadata write must reject symbolic links");
        assert!(write_error.contains("symbolic link"));
        assert_eq!(
            fs::read(&outside).expect("outside target remains"),
            b"metadata sentinel"
        );
    }

    #[cfg(unix)]
    #[test]
    fn profile_directory_rejects_symbolic_links() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let outside = dir.path().join("outside");
        fs::create_dir(&outside).expect("outside dir");
        let linked = dir.path().join(PROFILE_ID);
        symlink(&outside, &linked).expect("profile symlink");

        let error = validate_profile_directory(&linked).expect_err("symlink must be rejected");
        assert!(error.contains("symbolic link"));
    }

    #[cfg(unix)]
    #[test]
    fn profile_operations_cannot_escape_through_a_symlinked_storage_ancestor() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let app_data_dir = dir.path().join("app-data");
        let outside = dir.path().join("outside");
        let outside_profile = outside.join(PROFILE_ID);
        let metadata_path = outside_profile.join(PROFILE_METADATA_FILE_NAME);
        let reference_path = outside_profile.join(REFERENCE_AUDIO_FILE_NAME);
        fs::create_dir_all(app_data_dir.join("tts")).expect("tts dir");
        fs::create_dir_all(&outside_profile).expect("outside profile");
        fs::write(&metadata_path, b"metadata sentinel").expect("metadata sentinel");
        fs::write(&reference_path, b"reference sentinel").expect("reference sentinel");
        symlink(&outside, app_data_dir.join("tts").join("profiles")).expect("profiles symlink");

        let create_error = profile_dir_from_app_data(&app_data_dir, OTHER_PROFILE_ID)
            .and_then(|path| {
                fs::create_dir_all(path)
                    .map_err(|error| format!("Failed to create escaped profile: {error}"))
            })
            .expect_err("profile creation must fail closed");
        assert!(create_error.contains("symbolic link"));
        assert!(!outside.join(OTHER_PROFILE_ID).exists());

        let metadata_write_error = profile_dir_from_app_data(&app_data_dir, PROFILE_ID)
            .and_then(|path| {
                fs::write(path.join(PROFILE_METADATA_FILE_NAME), b"changed")
                    .map_err(|error| format!("Failed to write escaped metadata: {error}"))
            })
            .expect_err("metadata write must fail closed");
        assert!(metadata_write_error.contains("symbolic link"));
        assert_eq!(
            fs::read(&metadata_path).expect("metadata sentinel remains"),
            b"metadata sentinel"
        );

        let reference_write_error = profile_dir_from_app_data(&app_data_dir, PROFILE_ID)
            .and_then(|path| {
                fs::write(path.join(REFERENCE_AUDIO_FILE_NAME), b"changed")
                    .map_err(|error| format!("Failed to write escaped reference audio: {error}"))
            })
            .expect_err("reference audio write must fail closed");
        assert!(reference_write_error.contains("symbolic link"));
        assert_eq!(
            fs::read(&reference_path).expect("reference sentinel remains"),
            b"reference sentinel"
        );

        let delete_error = profile_dir_from_app_data(&app_data_dir, PROFILE_ID)
            .and_then(|path| {
                fs::remove_dir_all(path)
                    .map_err(|error| format!("Failed to delete escaped profile: {error}"))
            })
            .expect_err("profile deletion must fail closed");
        assert!(delete_error.contains("symbolic link"));
        assert!(outside_profile.is_dir());
    }
}
