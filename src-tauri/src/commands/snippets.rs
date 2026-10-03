//! Phrase Key import and export.

use tauri::AppHandle;

use crate::settings;
use crate::snippets::{merge_imported_snippets, parse_snippet_import_json, validate_snippets};

/// Add Phrase Keys from a JSON export, skipping triggers that already exist.
/// Returns how many were added.
#[tauri::command]
#[specta::specta]
pub fn import_snippets(app: AppHandle, json: String) -> Result<usize, String> {
    let imported = parse_snippet_import_json(&json)?;
    let id_prefix = chrono::Utc::now().timestamp_millis().to_string();
    settings::try_update(&app, |settings| {
        let added = merge_imported_snippets(&mut settings.snippets, imported, &id_prefix);
        validate_snippets(&settings.snippets)?;
        Ok(added)
    })
}

#[tauri::command]
#[specta::specta]
pub fn export_snippets(app: AppHandle) -> Result<String, String> {
    serde_json::to_string_pretty(&settings::get_settings(&app).snippets)
        .map_err(|error| format!("Failed to serialize Phrase Keys: {error}"))
}
