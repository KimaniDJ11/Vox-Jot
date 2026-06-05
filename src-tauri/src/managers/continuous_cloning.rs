#[cfg(not(feature = "ci-mock-transcription"))]
use crate::settings::get_settings;
#[cfg(not(feature = "ci-mock-transcription"))]
use crate::tts_profiles::{
    append_reference_audio, find_active_improvement_profile, resample_linear,
};
#[cfg(not(feature = "ci-mock-transcription"))]
use log::{debug, info, warn};
use tauri::AppHandle;
#[cfg(not(feature = "ci-mock-transcription"))]
use tauri::Emitter;

#[cfg(not(feature = "ci-mock-transcription"))]
const MIN_AUDIO_DURATION_SECS: f32 = 3.0;
#[cfg(not(feature = "ci-mock-transcription"))]
const STT_SAMPLE_RATE: u32 = 16_000;
#[cfg(not(feature = "ci-mock-transcription"))]
const TTS_SAMPLE_RATE: u32 = 24_000;

/// Filler words that indicate low-quality transcription segments.
#[cfg(not(feature = "ci-mock-transcription"))]
const FILLER_WORDS: &[&str] = &[
    "um", "uh", "hmm", "hm", "ah", "eh", "er", "like", "you know", "so", "well", "okay", "ok",
];

#[derive(Clone)]
pub struct ContinuousCloningManager {
    #[cfg(not(feature = "ci-mock-transcription"))]
    app_handle: AppHandle,
}

impl ContinuousCloningManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        #[cfg(not(feature = "ci-mock-transcription"))]
        {
            Self {
                app_handle: app_handle.clone(),
            }
        }
        #[cfg(feature = "ci-mock-transcription")]
        {
            let _ = app_handle;
            Self {}
        }
    }

    /// Process a successful STT result for continuous voice improvement.
    /// `audio_16k` is the audio buffer at 16kHz (post-STT resample).
    /// `transcript` is the text produced by STT.
    #[cfg(not(feature = "ci-mock-transcription"))]
    pub fn process_stt_result(&self, audio_16k: &[f32], transcript: &str) {
        // Quick check: is there an active improvement profile?
        let active_profile_id = match find_active_improvement_profile(&self.app_handle) {
            Ok(Some(id)) => id,
            Ok(None) => return, // No active profile, nothing to do
            Err(err) => {
                warn!("Failed to find active improvement profile: {err}");
                return;
            }
        };

        // Quality gate: minimum duration
        let duration_secs = audio_16k.len() as f32 / STT_SAMPLE_RATE as f32;
        if duration_secs < MIN_AUDIO_DURATION_SECS {
            debug!(
                "Continuous cloning: skipping segment ({:.1}s < {:.1}s minimum)",
                duration_secs, MIN_AUDIO_DURATION_SECS
            );
            return;
        }

        // Quality gate: reject empty or filler-only transcripts
        if !is_quality_transcript(transcript) {
            debug!("Continuous cloning: skipping filler-only transcript");
            return;
        }

        // Resample 16kHz -> 24kHz (default path) or use raw audio if HQ capture
        let settings = get_settings(&self.app_handle);
        let samples_24k = if settings.continuous_improvement_hq_capture {
            // In HQ mode the caller would pass device-rate audio.
            // For now, we still receive 16kHz and upsample — the HQ path
            // requires audio.rs changes to retain the raw buffer, which
            // will be connected when that setting is enabled.
            resample_linear(audio_16k, STT_SAMPLE_RATE, TTS_SAMPLE_RATE)
        } else {
            resample_linear(audio_16k, STT_SAMPLE_RATE, TTS_SAMPLE_RATE)
        };

        if samples_24k.is_empty() {
            return;
        }

        // Append to the profile's reference audio
        match append_reference_audio(&self.app_handle, &active_profile_id, &samples_24k) {
            Ok(total_duration) => {
                info!(
                    "Continuous cloning: appended {:.1}s to profile '{}' (total: {:.1}s)",
                    duration_secs, active_profile_id, total_duration
                );

                // Emit progress event to frontend
                let _ = self.app_handle.emit(
                    "voice-profile-progress",
                    serde_json::json!({
                        "profile_id": active_profile_id,
                        "collected_duration_secs": total_duration,
                    }),
                );

                // Check if the profile auto-completed (append_reference_audio handles
                // setting fully_optimized and disabling continuous_improvement_enabled)
                // We just need to emit the event
                if is_profile_fully_optimized(&self.app_handle, &active_profile_id) {
                    info!(
                        "Continuous cloning: profile '{}' reached satisfactory threshold!",
                        active_profile_id
                    );
                    let _ = self.app_handle.emit(
                        "voice-profile-optimized",
                        serde_json::json!({
                            "profile_id": active_profile_id,
                        }),
                    );
                }
            }
            Err(err) => {
                warn!(
                    "Continuous cloning: failed to append audio to profile '{}': {err}",
                    active_profile_id
                );
            }
        }
    }
}

/// Returns true if the transcript contains meaningful content beyond filler words.
#[cfg(not(feature = "ci-mock-transcription"))]
fn is_quality_transcript(transcript: &str) -> bool {
    let trimmed = transcript.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Remove punctuation and lowercase
    let cleaned: String = trimmed
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .to_lowercase();

    let words: Vec<&str> = cleaned.split_whitespace().collect();
    if words.is_empty() {
        return false;
    }

    // Count non-filler words
    let meaningful_count = words.iter().filter(|w| !FILLER_WORDS.contains(w)).count();

    // At least 2 meaningful words
    meaningful_count >= 2
}

#[cfg(not(feature = "ci-mock-transcription"))]
fn is_profile_fully_optimized(app_handle: &AppHandle, profile_id: &str) -> bool {
    match crate::tts_profiles::get_profile_progress(app_handle, profile_id) {
        Ok(descriptor) => descriptor.fully_optimized,
        Err(_) => false,
    }
}
