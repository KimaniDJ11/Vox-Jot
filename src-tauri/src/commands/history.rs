use crate::managers::history::{HistoryEntriesPage, HistoryEntry, HistoryManager};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

fn user_facing_speaker_analysis_error(error: &str) -> String {
    let trimmed = error.trim();
    let lower = trimmed.to_lowercase();

    if lower.contains("model required") {
        return "Speaker Isolation model required".to_string();
    }

    if lower.contains("traceback")
        || lower.contains("[broadcast_shapes]")
        || lower.contains("cannot be broadcast")
    {
        return "Speaker analysis failed. Retry Analyze speakers. If this keeps happening, choose a timestamp-capable File ASR model in Model Hub, or switch Speaker Isolation model.".to_string();
    }

    let first_line = trimmed
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Speaker analysis failed.");
    const MAX_ERROR_CHARS: usize = 240;
    if first_line.chars().count() <= MAX_ERROR_CHARS {
        return first_line.to_string();
    }

    let mut shortened: String = first_line.chars().take(MAX_ERROR_CHARS).collect();
    shortened.push('…');
    shortened
}

#[tauri::command]
#[specta::specta]
pub async fn get_history_entries(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Vec<HistoryEntry>, String> {
    history_manager
        .get_history_entries()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_history_entries_page(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    offset: usize,
    limit: usize,
) -> Result<HistoryEntriesPage, String> {
    history_manager
        .get_history_entries_page(offset, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_latest_history_entry(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Option<HistoryEntry>, String> {
    history_manager
        .get_latest_entry()
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_history_entry_saved(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .toggle_saved_status(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_audio_file_path(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    file_name: String,
) -> Result<String, String> {
    let path = history_manager.get_audio_file_path(&file_name);
    path.to_str()
        .ok_or_else(|| "Invalid file path".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn reveal_history_recording_in_folder(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    file_name: String,
) -> Result<(), String> {
    let path = history_manager.get_audio_file_path(&file_name);
    if !path.exists() {
        return Err(format!("Recording file not found: {file_name}"));
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Failed to reveal recording: {e}"))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_history_entry(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .delete_entry(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_limit(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    limit: usize,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.history_limit = limit;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_auto_analyze_speakers_long_recordings_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.history_auto_analyze_speakers_long_recordings_enabled = enabled;
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_auto_analyze_speakers_min_duration_ms(
    app: AppHandle,
    min_duration_ms: u32,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.history_auto_analyze_speakers_min_duration_ms =
        min_duration_ms.clamp(30_000, 7_200_000);
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn update_recording_retention_period(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    period: String,
) -> Result<(), String> {
    use crate::settings::RecordingRetentionPeriod;

    let retention_period = match period.as_str() {
        "never" => RecordingRetentionPeriod::Never,
        "preserve_limit" => RecordingRetentionPeriod::PreserveLimit,
        "days3" => RecordingRetentionPeriod::Days3,
        "weeks2" => RecordingRetentionPeriod::Weeks2,
        "months3" => RecordingRetentionPeriod::Months3,
        _ => return Err(format!("Invalid retention period: {}", period)),
    };

    let mut settings = crate::settings::get_settings(&app);
    settings.recording_retention_period = retention_period;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Called by the frontend (or internally) to store what was observed in the
/// text field ~30 seconds after Vox Jot pasted text into it.
#[tauri::command]
#[specta::specta]
pub async fn update_field_snapshot(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    snapshot_text: String,
) -> Result<(), String> {
    history_manager
        .update_field_snapshot(id, snapshot_text)
        .map_err(|e| e.to_string())
}

/// Overwrite the stored transcription text for a history entry. Used by the
/// Transcript view when the user edits a dictation transcript word-by-word.
#[tauri::command]
#[specta::specta]
pub async fn update_history_entry_transcription(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    text: String,
) -> Result<(), String> {
    history_manager
        .update_transcription_text(id, &text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_entry_display_title(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    title: String,
) -> Result<(), String> {
    history_manager
        .update_display_title(id, title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_entry_speaker_labels_visible(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    visible: bool,
) -> Result<(), String> {
    history_manager
        .update_speaker_labels_visible(id, visible)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_entry_speaker_display_names(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    names: std::collections::HashMap<String, String>,
) -> Result<HistoryEntry, String> {
    let names_json = serde_json::to_string(&names).map_err(|e| e.to_string())?;
    history_manager
        .update_speaker_display_names(id, names_json)
        .map_err(|e| e.to_string())?;
    history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("History entry not found: {id}"))
}

/// Re-run file transcription with the currently selected speaker isolation model
/// and persist labeled speaker segments on the history entry.
#[tauri::command]
#[specta::specta]
pub async fn analyze_history_entry_speakers(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    sidecar_manager: State<'_, Arc<crate::sidecar::SidecarManager>>,
    correction_store: State<'_, Arc<crate::correction_tracker::store::CorrectionStore>>,
    id: i64,
) -> Result<HistoryEntry, String> {
    analyze_history_entry_speakers_impl(
        app,
        Arc::clone(history_manager.inner()),
        Arc::clone(sidecar_manager.inner()),
        Arc::clone(correction_store.inner()),
        id,
    )
    .await
}

pub(crate) async fn analyze_history_entry_speakers_impl(
    app: AppHandle,
    history_manager: Arc<HistoryManager>,
    sidecar_manager: Arc<crate::sidecar::SidecarManager>,
    correction_store: Arc<crate::correction_tracker::store::CorrectionStore>,
    id: i64,
) -> Result<HistoryEntry, String> {
    let entry = history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("History entry not found: {id}"))?;

    let wav_path = history_manager.get_audio_file_path(&entry.file_name);
    if !wav_path.exists() {
        return Err(format!("Recording file not found: {}", entry.file_name));
    }

    let selection = crate::speech_analysis::selection_from_settings(&app);
    if !crate::speech_analysis::should_run_diarization(&selection.diarization_model_id) {
        return Err("Speaker Isolation model required".to_string());
    }

    if !history_manager
        .try_set_speaker_running(id)
        .map_err(|e| e.to_string())?
    {
        return Err("Speaker analysis is already running.".to_string());
    }

    let path_str = wav_path
        .to_str()
        .ok_or_else(|| "Invalid recording path".to_string())?
        .to_string();

    // Prefer a timestamp-capable file ASR when available. Forcing the live
    // dictation engine alone often yields text without timestamps, which used
    // to collapse multi-speaker diarization into one whole-file segment.
    let preferred_asr = crate::speech_analysis::prefer_timestamp_asr_for_speaker_alignment(
        &app,
        &selection.asr_model_id,
    );

    let result = match crate::commands::transcription::transcribe_file_impl_with_models(
        app.clone(),
        Arc::clone(&sidecar_manager),
        Arc::clone(&correction_store),
        path_str.clone(),
        preferred_asr.clone(),
        selection.diarization_model_id.clone(),
        crate::speech_analysis::NO_EMOTION_ID.to_string(),
    )
    .await
    {
        Ok(result) => result,
        Err(error) if preferred_asr != crate::speech_analysis::CURRENT_DICTATION_ASR_ID => {
            log::warn!(
                "Speaker analysis ASR '{}' failed for history entry {} ({}); retrying with current dictation + diarization-turn labeling",
                preferred_asr,
                id,
                error
            );
            match crate::commands::transcription::transcribe_file_impl_with_models(
                app,
                sidecar_manager,
                correction_store,
                path_str,
                crate::speech_analysis::CURRENT_DICTATION_ASR_ID.to_string(),
                selection.diarization_model_id.clone(),
                crate::speech_analysis::NO_EMOTION_ID.to_string(),
            )
            .await
            {
                Ok(result) => result,
                Err(retry_error) => {
                    log::warn!(
                        "Speaker analysis failed for history entry {}: {}",
                        id,
                        retry_error
                    );
                    let user_error = user_facing_speaker_analysis_error(&retry_error);
                    let _ = history_manager.set_speaker_failed(id, user_error.clone());
                    return Err(user_error);
                }
            }
        }
        Err(error) => {
            log::warn!(
                "Speaker analysis failed for history entry {}: {}",
                id,
                error
            );
            let user_error = user_facing_speaker_analysis_error(&error);
            let _ = history_manager.set_speaker_failed(id, user_error.clone());
            return Err(user_error);
        }
    };

    if result.speaker_segments.is_empty() {
        let user_error =
            "Speaker analysis did not find any speech segments. Try a recording with clear speech."
                .to_string();
        let _ = history_manager.set_speaker_failed(id, user_error.clone());
        return Err(user_error);
    }

    if let Err(error) = history_manager.set_speaker_complete(
        id,
        selection.diarization_model_id,
        result.speaker_segments,
        None,
    ) {
        let user_error = user_facing_speaker_analysis_error(&error.to_string());
        let _ = history_manager.set_speaker_failed(id, user_error.clone());
        return Err(user_error);
    }

    history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("History entry not found after speaker analysis: {id}"))
}

/// Queue background speaker analysis when the long-recording auto setting is on.
/// Never blocks the dictation hot path; no-ops when disabled, too short, or no model.
pub(crate) fn maybe_queue_auto_speaker_analysis(
    app: &AppHandle,
    history_id: i64,
    duration_ms: Option<i64>,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let settings = crate::settings::get_settings(&app);
        if !settings.history_auto_analyze_speakers_long_recordings_enabled {
            return;
        }
        let min_ms = i64::from(settings.history_auto_analyze_speakers_min_duration_ms);
        if duration_ms.unwrap_or(0) < min_ms {
            return;
        }
        let selection = crate::speech_analysis::selection_from_settings(&app);
        if !crate::speech_analysis::should_run_diarization(&selection.diarization_model_id) {
            return;
        }

        let Some(history_manager) = app.try_state::<Arc<HistoryManager>>() else {
            return;
        };
        let Some(sidecar_manager) = app.try_state::<Arc<crate::sidecar::SidecarManager>>() else {
            return;
        };
        let Some(correction_store) =
            app.try_state::<Arc<crate::correction_tracker::store::CorrectionStore>>()
        else {
            return;
        };
        let history_manager = Arc::clone(history_manager.inner());
        let sidecar_manager = Arc::clone(sidecar_manager.inner());
        let correction_store = Arc::clone(correction_store.inner());

        if let Err(error) = analyze_history_entry_speakers_impl(
            app,
            history_manager,
            sidecar_manager,
            correction_store,
            history_id,
        )
        .await
        {
            log::warn!(
                "Auto speaker analysis failed for history entry {}: {}",
                history_id,
                error
            );
        }
    });
}
