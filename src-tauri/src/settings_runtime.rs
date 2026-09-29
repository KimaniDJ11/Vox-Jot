//! Commits preference changes and brings live subsystems in line with them.
//!
//! The settings module owns validation and persistence; this module owns the
//! consequences of a committed change: shortcuts, tray, overlay, logging,
//! login item, microphone, and history retention. Runtime work is derived from
//! the difference between the previous and committed settings, so it runs
//! exactly when the relevant values change, whichever update changed them.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::managers::audio::{AudioRecordingManager, MicrophoneMode};
use crate::managers::history::HistoryManager;
use crate::settings::{self, AppSettings, LogLevel, SettingUpdate};

// Only preference edits enter this gate. Recording and cached settings reads
// never wait on it. Keep commits and their runtime effects in the same order.
static RUNTIME_UPDATE_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Validate, persist, and apply `updates` as one change. Returns the settings
/// fields whose values changed, including fields derived from the updates.
pub fn apply_setting_updates(
    app: &AppHandle,
    updates: Vec<SettingUpdate>,
) -> Result<Vec<String>, String> {
    let _gate = RUNTIME_UPDATE_GATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if updates.is_empty() {
        return Err("At least one setting update is required.".to_string());
    }
    let updates = updates
        .into_iter()
        .map(|update| prepare(app, update))
        .collect::<Result<Vec<_>, _>>()?;

    let (before, after) = if updates.iter().any(SettingUpdate::changes_capture) {
        audio_manager(app)?.reconfigure_capture(|| commit(app, updates))?
    } else {
        commit(app, updates)?
    };

    sync_runtime(app, &before, &after)?;
    changed_keys(&before, &after)
}

/// Set the file logger's threshold.
pub fn set_file_log_level(level: LogLevel) {
    let level: log::Level = tauri_plugin_log::LogLevel::from(level).into();
    crate::FILE_LOG_LEVEL.store(level.to_level_filter() as u8, Ordering::Relaxed);
}

/// Register or remove the login item.
pub fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(not(vox_jot_app_store))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let launcher = app.autolaunch();
        let result = if enabled {
            launcher.enable()
        } else {
            launcher.disable()
        };
        result.map_err(|error| format!("Failed to update launch at login: {error}"))
    }
    #[cfg(vox_jot_app_store)]
    {
        let _ = (app, enabled);
        Ok(())
    }
}

/// Resolve inputs that need the running app before they can be validated.
fn prepare(app: &AppHandle, update: SettingUpdate) -> Result<SettingUpdate, String> {
    Ok(match update {
        SettingUpdate::MarkdownExportDir(dir) => {
            SettingUpdate::MarkdownExportDir(crate::markdown_export::configure_export_directory(
                app,
                dir.map(|dir| dir.to_string_lossy().into_owned()),
            )?)
        }
        update => update,
    })
}

fn commit(
    app: &AppHandle,
    updates: Vec<SettingUpdate>,
) -> Result<(AppSettings, AppSettings), String> {
    settings::try_update(app, |settings| {
        let before = settings.clone();
        settings::apply_updates(settings, updates)?;
        Ok((before, settings.clone()))
    })
}

fn sync_runtime(app: &AppHandle, before: &AppSettings, after: &AppSettings) -> Result<(), String> {
    let mut failures = Vec::new();
    let mut record = |result: Result<(), String>| {
        if let Err(error) = result {
            failures.push(error);
        }
    };

    if before.log_level != after.log_level {
        set_file_log_level(after.log_level);
    }
    if before.enable_crash_reporting != after.enable_crash_reporting {
        crate::telemetry::set_crash_reporting_enabled(after.enable_crash_reporting);
    }
    if before.enable_usage_analytics != after.enable_usage_analytics {
        crate::telemetry::set_usage_analytics_enabled(after.enable_usage_analytics);
        if after.enable_usage_analytics {
            crate::telemetry::track_usage_event("analytics_enabled");
        }
    }
    if before.autostart_enabled != after.autostart_enabled {
        record(apply_autostart(app, after.autostart_enabled));
    }
    if before.show_tray_icon != after.show_tray_icon {
        crate::tray::set_tray_visibility(app, after.show_tray_icon);
    }
    if before.app_language != after.app_language {
        crate::tray::refresh_current_menu_with_locale(app, &after.app_language);
    }
    if before.overlay_position != after.overlay_position {
        crate::overlay::update_overlay_position(app);
    }
    if before.recording_overlay_style != after.recording_overlay_style {
        crate::overlay::apply_recording_overlay_metrics(app);
    }
    if before.post_process_enabled != after.post_process_enabled {
        record(crate::shortcut::set_post_process_shortcuts_registered(
            app,
            after.post_process_enabled,
        ));
    }
    if before.always_on_microphone != after.always_on_microphone {
        let mode = if after.always_on_microphone {
            MicrophoneMode::AlwaysOn
        } else {
            MicrophoneMode::OnDemand
        };
        record(audio_manager(app).and_then(|audio| {
            audio
                .update_mode(mode)
                .map_err(|error| format!("Failed to update microphone mode: {error}"))
        }));
    }
    if before.selected_microphone != after.selected_microphone {
        record(audio_manager(app).and_then(|audio| {
            audio
                .update_selected_device()
                .map_err(|error| format!("Failed to switch microphone: {error}"))
        }));
    }
    if before.history_limit != after.history_limit
        || before.recording_retention_period != after.recording_retention_period
    {
        record(match app.try_state::<Arc<HistoryManager>>() {
            Some(history) => history
                .cleanup_old_entries()
                .map_err(|error| format!("Failed to apply history retention: {error}")),
            None => Err("History is unavailable.".to_string()),
        });
    }
    if before.external_model_storage_enabled != after.external_model_storage_enabled
        || before.external_model_storage_auto_detect != after.external_model_storage_auto_detect
        || before.external_model_storage_path != after.external_model_storage_path
    {
        crate::external_model_storage::refresh_and_notify(app);
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

fn audio_manager(app: &AppHandle) -> Result<Arc<AudioRecordingManager>, String> {
    app.try_state::<Arc<AudioRecordingManager>>()
        .map(|state| Arc::clone(state.inner()))
        .ok_or_else(|| "The audio manager is unavailable.".to_string())
}

fn changed_keys(before: &AppSettings, after: &AppSettings) -> Result<Vec<String>, String> {
    let (serde_json::Value::Object(before), serde_json::Value::Object(after)) = (
        serde_json::to_value(before).map_err(|error| error.to_string())?,
        serde_json::to_value(after).map_err(|error| error.to_string())?,
    ) else {
        return Err("Settings did not serialize to objects.".to_string());
    };
    let mut keys = after
        .iter()
        .filter(|(key, value)| before.get(*key) != Some(value))
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    keys.sort();
    Ok(keys)
}
