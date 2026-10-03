//! Reading and changing preferences.

pub mod aliases;
pub mod preferences;

use tauri::AppHandle;

use crate::settings::{self, AppSettings, SettingUpdate, SettingsSnapshot};

#[tauri::command]
#[specta::specta]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(settings::get_settings_without_secrets(&app))
}

#[tauri::command]
#[specta::specta]
pub fn get_default_settings() -> Result<AppSettings, String> {
    Ok(settings::get_default_settings())
}

#[tauri::command]
#[specta::specta]
pub fn get_settings_snapshot(app: AppHandle) -> SettingsSnapshot {
    settings::get_settings_snapshot(&app)
}

/// Validate, persist, and apply one preference change. Return the same
/// revisioned state that other windows receive through `settings-snapshot`.
#[tauri::command]
#[specta::specta]
pub async fn update_setting(
    app: AppHandle,
    update: SettingUpdate,
) -> Result<SettingsSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::settings_runtime::apply_setting_updates(&app, vec![update])?;
        Ok(settings::get_settings_snapshot(&app))
    })
    .await
    .map_err(|error| format!("Settings update did not finish: {error}"))?
}

#[tauri::command]
#[specta::specta]
pub fn get_available_typing_tools() -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        crate::clipboard::get_available_typing_tools()
    }
    #[cfg(not(target_os = "linux"))]
    {
        vec!["auto".to_string()]
    }
}

#[tauri::command]
#[specta::specta]
pub fn test_markdown_export_write(app: AppHandle) -> Result<String, String> {
    crate::markdown_export::test_export_directory_write(&app)
}
