use crate::managers::notes::{Note, NotesManager};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
#[specta::specta]
pub fn get_notes(app: AppHandle) -> Result<Vec<Note>, String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager.list_notes().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_note(app: AppHandle, id: i64) -> Result<Option<Note>, String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager.get_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_note(app: AppHandle, title: String, content: String) -> Result<Note, String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager
        .create_note(&title, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_note(app: AppHandle, id: i64, title: String, content: String) -> Result<(), String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager
        .update_note(id, &title, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(app: AppHandle, id: i64) -> Result<(), String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager.delete_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn toggle_note_pin(app: AppHandle, id: i64, pinned: bool) -> Result<(), String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager.toggle_pin(id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn export_notes(app: AppHandle) -> Result<String, String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager.export_json().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_all_notes(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<Arc<NotesManager>>();
    manager.delete_all().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn show_scratchpad(app: AppHandle) -> Result<(), String> {
    crate::scratchpad::show_scratchpad(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn show_scratchpad_for_note(app: AppHandle, note_id: i64) -> Result<(), String> {
    crate::scratchpad::set_pending_note_target(&app, note_id);
    crate::scratchpad::show_scratchpad(&app);
    app.emit_to("scratchpad", "scratchpad-select-note", note_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn toggle_scratchpad(app: AppHandle) -> Result<(), String> {
    crate::scratchpad::toggle_scratchpad(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_scratchpad_editor_armed(app: AppHandle, armed: bool) -> Result<(), String> {
    crate::scratchpad::set_scratchpad_editor_armed(&app, armed);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn consume_scratchpad_target_note(app: AppHandle) -> Result<Option<i64>, String> {
    Ok(crate::scratchpad::consume_pending_note_target(&app))
}
