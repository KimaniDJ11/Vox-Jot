use crate::correction_tracker::store::{CorrectionStore, StoredCorrection};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// Get all stored corrections.
#[tauri::command]
#[specta::specta]
pub fn get_corrections(app: AppHandle) -> Result<Vec<StoredCorrection>, String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.list_all().map_err(|e| e.to_string())
}

/// Delete a correction by ID.
#[tauri::command]
#[specta::specta]
pub fn delete_correction(app: AppHandle, id: i64) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.delete_correction(id).map_err(|e| e.to_string())
}

/// Update the original and corrected text for a learned correction.
#[tauri::command]
#[specta::specta]
pub fn update_correction(
    app: AppHandle,
    id: i64,
    original: String,
    corrected: String,
) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store
        .update_correction(id, &original, &corrected)
        .map_err(|e| e.to_string())
}

/// Toggle the active state of a correction.
#[tauri::command]
#[specta::specta]
pub fn toggle_correction(app: AppHandle, id: i64, active: bool) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.set_active(id, active).map_err(|e| e.to_string())
}

/// Clear all stored corrections.
#[tauri::command]
#[specta::specta]
pub fn clear_all_corrections(app: AppHandle) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.clear_all().map_err(|e| e.to_string())
}

/// Export all corrections as a JSON string.
#[tauri::command]
#[specta::specta]
pub fn export_corrections(app: AppHandle) -> Result<String, String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.export_json().map_err(|e| e.to_string())
}

/// Manually add a new correction pair.
#[tauri::command]
#[specta::specta]
pub fn add_manual_correction(
    app: AppHandle,
    original: String,
    corrected: String,
    exact_only: bool,
) -> Result<(), String> {
    let store = app.state::<Arc<CorrectionStore>>();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    store
        .add_manual_correction(&original, &corrected, exact_only, now)
        .map_err(|e| e.to_string())
}

/// Import corrections from a JSON string.
#[tauri::command]
#[specta::specta]
pub fn import_corrections(app: AppHandle, json: String) -> Result<usize, String> {
    let store = app.state::<Arc<CorrectionStore>>();
    store.import_json(&json).map_err(|e| e.to_string())
}
