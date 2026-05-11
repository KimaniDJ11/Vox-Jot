use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

use crate::convo::{
    ConvoAudioCaptureStatus, ConvoAvailability, ConvoContextItem, ConvoMode, ConvoSessionState,
    ConvoTurnResponse, SettingsCatalogEntry,
};
use crate::managers::convo::ConvoController;
use crate::managers::notes::Note;
use crate::managers::notes::NotesManager;

#[tauri::command]
#[specta::specta]
pub fn convo_check_availability(app: AppHandle) -> Result<ConvoAvailability, String> {
    let controller = app.state::<Arc<ConvoController>>();
    Ok(controller.check_availability())
}

#[tauri::command]
#[specta::specta]
pub fn convo_prepare_session(
    app: AppHandle,
    mode: ConvoMode,
    voice_id: Option<String>,
    context: Option<String>,
) -> Result<ConvoSessionState, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.prepare_session(mode, voice_id, context)
}

#[tauri::command]
#[specta::specta]
pub async fn convo_send_text_turn(
    app: AppHandle,
    session_id: String,
    text: String,
    context: Option<String>,
) -> Result<ConvoTurnResponse, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller
        .send_text_turn(&session_id, &text, context.as_deref())
        .await
}

#[tauri::command]
#[specta::specta]
pub fn convo_reset_session(
    app: AppHandle,
    session_id: String,
) -> Result<ConvoSessionState, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.reset_session(&session_id)
}

#[tauri::command]
#[specta::specta]
pub fn convo_get_session(app: AppHandle, session_id: String) -> Result<ConvoSessionState, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.get_session(&session_id)
}

#[tauri::command]
#[specta::specta]
pub fn convo_update_speak_replies(
    app: AppHandle,
    session_id: String,
    enabled: bool,
) -> Result<(), String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.update_speak_replies(&session_id, enabled)
}

#[tauri::command]
#[specta::specta]
pub fn convo_capture_selection(app: AppHandle) -> Result<Option<String>, String> {
    crate::clipboard::capture_selected_text(&app)
}

#[tauri::command]
#[specta::specta]
pub fn convo_get_clipboard_text(app: AppHandle) -> Result<Option<String>, String> {
    app.clipboard()
        .read_text()
        .map(Some)
        .map_err(|e| format!("Failed to read clipboard text: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn convo_add_context_item(
    app: AppHandle,
    session_id: String,
    label: String,
    source_type: String,
    content: String,
) -> Result<ConvoContextItem, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.add_context_item(&session_id, &label, &source_type, &content)
}

#[tauri::command]
#[specta::specta]
pub fn convo_remove_context_item(
    app: AppHandle,
    session_id: String,
    item_id: String,
) -> Result<(), String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.remove_context_item(&session_id, &item_id)
}

#[tauri::command]
#[specta::specta]
pub fn convo_list_context_items(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<ConvoContextItem>, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.list_context_items(&session_id)
}

#[tauri::command]
#[specta::specta]
pub async fn convo_pick_files_context(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<ConvoContextItem>, String> {
    let app_for_dialog = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app_for_dialog
            .dialog()
            .file()
            .set_title("Attach files")
            .blocking_pick_files()
    })
    .await
    .map_err(|e| format!("Failed to open file picker: {}", e))?;

    let Some(paths) = picked else {
        return Ok(Vec::new());
    };

    let controller = app.state::<Arc<ConvoController>>();
    let mut items = Vec::new();
    for path in paths {
        let path = path
            .into_path()
            .map_err(|e| format!("Selected file path is not readable: {}", e))?;
        let path = path.to_string_lossy().to_string();
        items.push(controller.read_file_as_context(&session_id, &path)?);
    }
    Ok(items)
}

#[tauri::command]
#[specta::specta]
pub async fn convo_pick_folder_context(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<ConvoContextItem>, String> {
    let app_for_dialog = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app_for_dialog
            .dialog()
            .file()
            .set_title("Attach folder")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("Failed to open folder picker: {}", e))?;

    let Some(path) = picked else {
        return Ok(Vec::new());
    };

    let path = path
        .into_path()
        .map_err(|e| format!("Selected folder path is not readable: {}", e))?;
    let controller = app.state::<Arc<ConvoController>>();
    controller.read_folder_as_context(&session_id, &path.to_string_lossy())
}

#[tauri::command]
#[specta::specta]
pub fn convo_get_settings_catalog(app: AppHandle) -> Result<Vec<SettingsCatalogEntry>, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.generate_settings_catalog()
}

#[tauri::command]
#[specta::specta]
pub fn convo_get_current_note(app: AppHandle, note_id: i64) -> Result<Option<Note>, String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager.get_note(note_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn convo_apply_note_edit(
    app: AppHandle,
    note_id: i64,
    action: String,
    content: String,
) -> Result<(), String> {
    let manager = app.state::<Arc<NotesManager>>();
    match action.as_str() {
        "replace" => {
            let note = manager
                .get_note(note_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Note {} not found", note_id))?;
            manager
                .update_note(note_id, &note.title, &content)
                .map_err(|e| e.to_string())
        }
        "append" => manager
            .append_to_note(note_id, &content)
            .map_err(|e| e.to_string()),
        other => Err(format!("Unsupported note edit action: {}", other)),
    }
}

// ── Audio turn commands ─────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn convo_start_audio_capture(app: AppHandle) -> Result<ConvoAudioCaptureStatus, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.audio_capture.start()?;
    Ok(ConvoAudioCaptureStatus { capturing: true })
}

#[tauri::command]
#[specta::specta]
pub fn convo_stop_audio_capture(app: AppHandle) -> Result<Vec<u8>, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.audio_capture.stop()
}

#[tauri::command]
#[specta::specta]
pub fn convo_save_audio_capture(file_path: String, wav_bytes: Vec<u8>) -> Result<String, String> {
    if wav_bytes.is_empty() {
        return Err("No microphone audio was captured.".to_string());
    }

    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("Choose where to save the microphone recording.".to_string());
    }

    let path = PathBuf::from(trimmed_path);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("wav"))
        != Some(true)
    {
        return Err("Voice cloning recordings must be saved as WAV files.".to_string());
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create recording folder: {err}"))?;
    }

    std::fs::write(&path, wav_bytes)
        .map_err(|err| format!("Failed to save microphone recording: {err}"))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn convo_send_audio_turn(
    app: AppHandle,
    session_id: String,
    wav_bytes: Vec<u8>,
    context: Option<String>,
) -> Result<ConvoTurnResponse, String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller
        .send_audio_turn(&session_id, wav_bytes, context.as_deref())
        .await
}

#[tauri::command]
#[specta::specta]
pub fn convo_play_audio_reply(app: AppHandle, audio_base64: String) -> Result<(), String> {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = crate::convo::play_audio_base64(&app_handle, &audio_base64) {
            log::error!("Failed to play convo audio reply: {}", e);
        }
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn convo_ensure_helper_running(app: AppHandle) -> Result<(), String> {
    let controller = app.state::<Arc<ConvoController>>();
    controller.helper.ensure_running()
}

#[tauri::command]
#[specta::specta]
pub fn convo_is_audio_capturing(app: AppHandle) -> Result<ConvoAudioCaptureStatus, String> {
    let controller = app.state::<Arc<ConvoController>>();
    Ok(ConvoAudioCaptureStatus {
        capturing: controller.audio_capture.is_capturing(),
    })
}
