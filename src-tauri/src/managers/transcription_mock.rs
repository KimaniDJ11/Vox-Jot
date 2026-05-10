// CI-only mock TranscriptionManager - avoids whisper/Vulkan dependencies.
// This file is copied over transcription.rs during CI tests.
// Existing tests don't exercise transcription, so this is safe.

use crate::helpers::subtitles::TimedSegment;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::ModelManager;
use crate::settings::AppSettings;
use anyhow::Result;
use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct TranscriptionManager {
    #[allow(dead_code)]
    app_handle: AppHandle,
}

impl TranscriptionManager {
    pub fn new(app_handle: &AppHandle, _model_manager: Arc<ModelManager>) -> Result<Self> {
        Ok(Self {
            app_handle: app_handle.clone(),
        })
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
        _recording_manager: Arc<AudioRecordingManager>,
    ) {
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

    pub fn transcribe_with_settings(
        &self,
        _audio: Arc<Vec<f32>>,
        _settings: AppSettings,
    ) -> Result<String> {
        Ok(String::new())
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

    pub fn maybe_emit_partial_transcription(&self, _generation: u64, _text: &str) {}

    pub fn maybe_emit_partial_error(&self, _generation: u64, _error: &str) {}

    pub fn cancel_partial_provider(&self) {
        self.stop_partial_provider();
    }

    pub fn active_partial_binding_id(&self) -> Option<String> {
        None
    }

    pub fn finish_active_partial_provider(&self) {}

    pub fn set_model_unload_timeout(&self, _timeout: crate::settings::ModelUnloadTimeout) {}

    pub fn schedule_model_unload_if_idle(&self, _context: &str) {}

    pub fn update_model_runtime_settings(&self, _settings: &AppSettings) {}

    pub fn warm_selected_model(&self) -> Result<()> {
        Ok(())
    }

    pub fn shutdown(&self) {}
}
