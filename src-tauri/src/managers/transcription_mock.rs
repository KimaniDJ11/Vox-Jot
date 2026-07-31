// CI-only mock TranscriptionManager - avoids whisper/Vulkan dependencies.
// This file is copied over transcription.rs during CI tests.
// Existing tests don't exercise transcription, so this is safe.

use crate::helpers::subtitles::TimedSegment;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::ModelManager;
use crate::settings::AppSettings;
use anyhow::Result;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Clone)]
pub struct TranscriptionManager;

pub struct TranscriptionTiming {
    pub model_id: String,
    pub audio_duration_ms: u64,
    pub model_ready_at_entry: bool,
    pub model_ready_wait_ms: u64,
    pub inference_ms: u64,
    pub total_ms: u64,
}

pub struct TimedTranscription {
    pub text: String,
    pub timing: TranscriptionTiming,
}

impl TranscriptionManager {
    pub fn new(_app_handle: &AppHandle, _model_manager: Arc<ModelManager>) -> Result<Self> {
        Ok(Self)
    }

    pub fn new_background(
        _app_handle: &AppHandle,
        _model_manager: Arc<ModelManager>,
    ) -> Result<Self> {
        Ok(Self)
    }

    pub fn is_model_loaded(&self) -> bool {
        false
    }

    pub fn unload_model(&self) -> Result<()> {
        Ok(())
    }

    pub fn maybe_unload_immediately(&self, _context: &str) {}

    pub fn load_model(&self, _model_id: &str) -> Result<()> {
        Ok(())
    }

    pub fn initiate_model_load(&self) {}

    pub fn initiate_model_load_for_model(&self, _model_id: String) {}

    pub fn begin_processing_run(&self) -> u64 {
        1
    }

    pub fn cancel_active_processing(&self) {}

    pub fn start_partial_provider(
        &self,
        _binding_id: &str,
        _model_id: String,
        _recording_manager: Arc<AudioRecordingManager>,
    ) {
    }

    pub fn finish_partial_provider(
        &self,
        _binding_id: &str,
        _model_id: &str,
        _audio: Arc<Vec<f32>>,
    ) -> Option<(String, u64)> {
        None
    }

    pub fn stop_partial_provider(&self) {}

    pub fn get_current_model(&self) -> Option<String> {
        None
    }

    pub fn last_activity_ms(&self) -> u64 {
        0
    }

    pub fn transcribe(&self, _audio: Arc<Vec<f32>>) -> Result<String> {
        Ok(String::new())
    }

    /// Kept for API parity with the real manager; CI actions use the timed
    /// wrapper directly.
    #[allow(dead_code)]
    pub fn transcribe_with_settings(
        &self,
        _audio: Arc<Vec<f32>>,
        _settings: AppSettings,
    ) -> Result<String> {
        Ok(String::new())
    }

    pub fn transcribe_with_settings_timed(
        &self,
        _audio: Arc<Vec<f32>>,
        settings: AppSettings,
    ) -> Result<TimedTranscription> {
        Ok(TimedTranscription {
            text: String::new(),
            timing: TranscriptionTiming {
                model_id: settings.selected_model,
                audio_duration_ms: 0,
                model_ready_at_entry: false,
                model_ready_wait_ms: 0,
                inference_ms: 0,
                total_ms: 0,
            },
        })
    }

    pub fn finalize_streamed_transcription(
        &self,
        _audio: Arc<Vec<f32>>,
        settings: AppSettings,
        raw_text: String,
        streaming_finalize_ms: u64,
    ) -> TimedTranscription {
        TimedTranscription {
            text: raw_text,
            timing: TranscriptionTiming {
                model_id: settings.selected_model,
                audio_duration_ms: 0,
                model_ready_at_entry: true,
                model_ready_wait_ms: 0,
                inference_ms: streaming_finalize_ms,
                total_ms: streaming_finalize_ms,
            },
        }
    }

    pub fn transcribe_with_segments(
        &self,
        _audio: Arc<Vec<f32>>,
    ) -> Result<(String, Vec<TimedSegment>)> {
        Ok((String::new(), Vec::new()))
    }

    pub fn is_processing_cancelled(&self, _generation: u64) -> bool {
        false
    }

    pub fn shutdown(&self) {}
}
