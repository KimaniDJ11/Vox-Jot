pub mod audio;
pub mod convo;
pub mod corrections;
pub mod history;
pub mod http_api;
pub mod models;
pub mod notes;
pub mod stats;
pub mod transcription;
pub mod tts;
pub mod write_rules;

use crate::actions::PostProcessRouteDebug;
use crate::post_processing::{ActiveAppContext, InstalledApp, PostProcessResult, PreviewManager};
use crate::screen_context::{ContextCaptureManager, ScreenContextDiagnostics};
use crate::settings::{get_settings, write_settings, AppSettings, LogLevel};
use crate::utils::cancel_current_operation;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
#[specta::specta]
pub fn cancel_operation(app: AppHandle) {
    cancel_current_operation(&app);
}

#[tauri::command]
#[specta::specta]
pub fn get_app_dir_path(app: AppHandle) -> Result<String, String> {
    let app_data_dir = crate::portable::app_data_dir(&app)
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(get_settings(&app))
}

#[tauri::command]
#[specta::specta]
pub fn get_default_settings(app: AppHandle) -> Result<AppSettings, String> {
    let mut settings = crate::settings::get_default_settings();
    crate::settings::hydrate_post_process_api_keys(&app, &mut settings);
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
pub fn get_log_dir_path(app: AppHandle) -> Result<String, String> {
    let log_dir = crate::portable::app_log_dir(&app)
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    Ok(log_dir.to_string_lossy().to_string())
}

#[specta::specta]
#[tauri::command]
pub fn set_log_level(app: AppHandle, level: LogLevel) -> Result<(), String> {
    let tauri_log_level: tauri_plugin_log::LogLevel = level.into();
    let log_level: log::Level = tauri_log_level.into();
    // Update the file log level atomic so the filter picks up the new level
    crate::FILE_LOG_LEVEL.store(
        log_level.to_level_filter() as u8,
        std::sync::atomic::Ordering::Relaxed,
    );

    let mut settings = get_settings(&app);
    settings.log_level = level;
    write_settings(&app, settings);

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn open_recordings_folder(app: AppHandle) -> Result<(), String> {
    let app_data_dir = crate::portable::app_data_dir(&app)
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");

    let path = recordings_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open recordings folder: {}", e))?;

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let log_dir = crate::portable::app_log_dir(&app)
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let path = log_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open log directory: {}", e))?;

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn open_app_data_dir(app: AppHandle) -> Result<(), String> {
    let app_data_dir = crate::portable::app_data_dir(&app)
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let path = app_data_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open app data directory: {}", e))?;

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn show_detail_view(app: AppHandle, section: String) -> Result<(), String> {
    crate::detail_view::show_detail_view(&app, &section);
    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn get_detail_target_section(app: AppHandle) -> Result<Option<String>, String> {
    Ok(crate::detail_view::get_detail_target_section(&app))
}

/// Check if Apple Intelligence is available on this device.
/// Called by the frontend when the user selects Apple Intelligence provider.
#[specta::specta]
#[tauri::command]
pub fn check_apple_intelligence_available() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        crate::apple_intelligence::check_apple_intelligence_availability()
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        false
    }
}

#[specta::specta]
#[tauri::command]
pub async fn preview_post_process_text(
    app: AppHandle,
    text: String,
    app_bundle_id_override: Option<String>,
) -> Result<PostProcessResult, String> {
    crate::actions::preview_post_process(&app, &text, app_bundle_id_override.as_deref()).await
}

#[specta::specta]
#[tauri::command]
pub fn resolve_post_process_preview(
    app: AppHandle,
    request_id: String,
    accepted: bool,
    final_text: Option<String>,
) -> Result<(), String> {
    let preview_manager = app.state::<PreviewManager>();
    preview_manager.resolve_request(&request_id, accepted, final_text)
}

#[specta::specta]
#[tauri::command]
pub fn debug_analyze_post_process_route(text: String) -> Result<PostProcessRouteDebug, String> {
    Ok(crate::actions::analyze_post_process_route(&text))
}

#[specta::specta]
#[tauri::command]
pub fn get_screen_context_diagnostics(app: AppHandle) -> Result<ScreenContextDiagnostics, String> {
    let manager = app.state::<Arc<ContextCaptureManager>>();
    Ok(manager.diagnostics())
}

#[specta::specta]
#[tauri::command]
pub fn get_frontmost_app_for_exclusion() -> Result<ActiveAppContext, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        crate::apple_intelligence::get_frontmost_app_context()
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        Err("Frontmost app detection is only available on Apple silicon Macs.".to_string())
    }
}

#[specta::specta]
#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to open Screen Recording settings: {}", err))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Screen Recording permission UI is only available on macOS.".to_string())
    }
}

/// Try to initialize Enigo (keyboard/mouse simulation).
/// On macOS, this will return an error if accessibility permissions are not granted.
#[specta::specta]
#[tauri::command]
pub fn initialize_enigo(app: AppHandle) -> Result<(), String> {
    use crate::input::EnigoState;

    // Check if already initialized
    if app.try_state::<EnigoState>().is_some() {
        log::debug!("Enigo already initialized");
        return Ok(());
    }

    // Try to initialize
    match EnigoState::new() {
        Ok(enigo_state) => {
            app.manage(enigo_state);
            log::info!("Enigo initialized successfully after permission grant");
            Ok(())
        }
        Err(e) => {
            if cfg!(target_os = "macos") {
                log::warn!(
                    "Failed to initialize Enigo: {} (accessibility permissions may not be granted)",
                    e
                );
            } else {
                log::warn!("Failed to initialize Enigo: {}", e);
            }
            Err(format!("Failed to initialize input system: {}", e))
        }
    }
}

/// Marker state to track if shortcuts have been initialized.
pub struct ShortcutsInitialized;

/// Initialize keyboard shortcuts.
/// On macOS, this should be called after accessibility permissions are granted.
/// This is idempotent - calling it multiple times is safe.
#[specta::specta]
#[tauri::command]
pub fn initialize_shortcuts(app: AppHandle) -> Result<(), String> {
    // Check if already initialized
    if app.try_state::<ShortcutsInitialized>().is_some() {
        log::debug!("Shortcuts already initialized");
        return Ok(());
    }

    // Initialize shortcuts
    crate::shortcut::init_shortcuts(&app);

    // Mark as initialized
    app.manage(ShortcutsInitialized);

    log::info!("Shortcuts initialized successfully");
    Ok(())
}

/// List GUI applications installed on the user's system.
///
/// On macOS this uses Spotlight (`mdfind`) to enumerate `.app` bundles and
/// reads each bundle's `CFBundleIdentifier` + `CFBundleName` from its
/// `Info.plist`.  On other platforms an empty list is returned.
#[specta::specta]
#[tauri::command]
pub async fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Ask Spotlight for every .app bundle on the system.
        let output = Command::new("mdfind")
            .arg("kMDItemContentType == 'com.apple.application-bundle'")
            .output()
            .map_err(|e| format!("Failed to run mdfind: {}", e))?;

        if !output.status.success() {
            return Err("mdfind returned a non-zero exit code".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut apps: Vec<InstalledApp> = Vec::new();
        let mut seen_bundle_ids = std::collections::HashSet::new();

        for line in stdout.lines() {
            let app_path = line.trim();
            if app_path.is_empty() {
                continue;
            }

            let plist_path = format!("{}/Contents/Info.plist", app_path);
            let plist_file = std::path::Path::new(&plist_path);
            if !plist_file.exists() {
                continue;
            }

            // Use `defaults read` to pull the two keys — it handles both
            // binary and XML plists transparently.
            let bundle_id = Command::new("defaults")
                .args(["read", &plist_path, "CFBundleIdentifier"])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                    } else {
                        None
                    }
                });

            let bundle_name = Command::new("defaults")
                .args(["read", &plist_path, "CFBundleName"])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                    } else {
                        None
                    }
                });

            if let Some(bid) = bundle_id {
                if bid.is_empty() || !seen_bundle_ids.insert(bid.clone()) {
                    continue;
                }

                let name = bundle_name.filter(|n| !n.is_empty()).unwrap_or_else(|| {
                    // Fall back to the .app directory name
                    std::path::Path::new(app_path)
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default()
                });

                apps.push(InstalledApp {
                    bundle_id: bid,
                    name,
                });
            }
        }

        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(apps)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

/// Resolve a bundle id to a base64-encoded PNG data URL of the app's icon.
///
/// On macOS we look up the `.app` via Spotlight, read `CFBundleIconFile` from
/// `Info.plist`, and convert the `.icns` to a 128×128 PNG using the system
/// `sips` tool. The PNG is cached on disk under
/// `<app_data>/app-icons/<bundle_id>.png` so subsequent calls are a single
/// file read.
///
/// Returns `Ok(None)` for unknown apps, missing icons, or non-macOS targets —
/// the frontend falls back to a letter monogram in that case.
#[specta::specta]
#[tauri::command]
pub async fn get_app_icon(app: AppHandle, bundle_id: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use base64::Engine;
        use std::process::Command;

        if bundle_id.trim().is_empty() {
            return Ok(None);
        }

        let cache_dir = crate::portable::app_data_dir(&app)
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
            .join("app-icons");
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create icon cache dir: {}", e))?;

        // Sanitize bundle id for use as a filename.
        let safe_id: String = bundle_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let png_path = cache_dir.join(format!("{}.png", safe_id));

        if !png_path.exists() {
            // Look up the .app path via Spotlight metadata.
            let mdfind_output = Command::new("mdfind")
                .arg(format!("kMDItemCFBundleIdentifier == \"{}\"", bundle_id))
                .output()
                .map_err(|e| format!("mdfind failed: {}", e))?;
            if !mdfind_output.status.success() {
                return Ok(None);
            }
            let app_path = String::from_utf8_lossy(&mdfind_output.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let Some(app_path) = app_path else {
                return Ok(None);
            };

            let plist_path = format!("{}/Contents/Info.plist", app_path);
            if !std::path::Path::new(&plist_path).exists() {
                return Ok(None);
            }

            let icon_name = Command::new("defaults")
                .args(["read", &plist_path, "CFBundleIconFile"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty());
            let Some(icon_name) = icon_name else {
                return Ok(None);
            };

            let icon_file = if icon_name.ends_with(".icns") {
                icon_name.clone()
            } else {
                format!("{}.icns", icon_name)
            };
            let icns_path = format!("{}/Contents/Resources/{}", app_path, icon_file);
            if !std::path::Path::new(&icns_path).exists() {
                return Ok(None);
            }

            // Convert .icns → PNG, max dimension 128px (retina-friendly chip).
            let status = Command::new("sips")
                .args(["-s", "format", "png", "-Z", "128", &icns_path, "--out"])
                .arg(&png_path)
                .output()
                .map_err(|e| format!("sips failed: {}", e))?;
            if !status.status.success() {
                return Ok(None);
            }
        }

        let bytes = match std::fs::read(&png_path) {
            Ok(b) => b,
            Err(_) => return Ok(None),
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(Some(format!("data:image/png;base64,{}", encoded)))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, bundle_id);
        Ok(None)
    }
}
