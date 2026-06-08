pub mod audio;
pub mod convo;
pub mod corrections;
pub mod history;
pub mod http_api;
pub mod models;
pub mod reader;
pub mod speech_analysis;
pub mod stats;
pub mod story_studio;
pub mod transcription;
pub mod tts;
pub mod write_rules;

use crate::actions::PostProcessRouteDebug;
use crate::post_processing::{ActiveAppContext, InstalledApp, PostProcessResult, PreviewManager};
use crate::screen_context::{ContextCaptureManager, ScreenContextDiagnostics};
use crate::settings::{
    get_settings, get_settings_without_secrets, write_settings, AppSettings, LogLevel,
};
use crate::utils::cancel_current_operation;
use std::path::{Path, PathBuf};
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
    Ok(get_settings_without_secrets(&app))
}

#[tauri::command]
#[specta::specta]
pub fn get_default_settings(_app: AppHandle) -> Result<AppSettings, String> {
    Ok(crate::settings::get_default_settings())
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
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings folder: {}", e))?;

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
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory: {}", e))?;

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
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

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

#[specta::specta]
#[tauri::command]
pub fn set_model_hub_native_dialog_active(app: AppHandle, active: bool) -> Result<(), String> {
    crate::detail_view::set_model_hub_native_dialog_active(&app, active);
    Ok(())
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
    #[cfg(target_os = "windows")]
    {
        crate::screen_context::current_frontmost_app_context_public()
            .ok_or_else(|| "Could not detect the frontmost window.".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        Err("Frontmost app detection is blocked on Linux until the active-window detector is implemented.".to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Frontmost app detection is not supported on this platform.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn app_bundle_path_from_exe_path(exe_path: &Path) -> Option<PathBuf> {
    exe_path
        .ancestors()
        .find(|path| path.extension().and_then(|ext| ext.to_str()) == Some("app"))
        .map(Path::to_path_buf)
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path() -> Result<PathBuf, String> {
    let exe_path =
        std::env::current_exe().map_err(|err| format!("Failed to locate current app: {err}"))?;

    if let Some(bundle_path) = app_bundle_path_from_exe_path(&exe_path) {
        return Ok(bundle_path);
    }

    let installed_app_path = PathBuf::from("/Applications/Vox Jot.app");
    if installed_app_path.exists() {
        return Ok(installed_app_path);
    }

    Ok(exe_path)
}

#[cfg(target_os = "macos")]
fn spawn_permission_relaunch_watcher(app_bundle_path: &Path) -> Result<(), String> {
    let current_pid = std::process::id().to_string();
    let app_bundle_path = app_bundle_path.to_string_lossy().to_string();
    let script = r#"
original_pid="$1"
app_path="$2"
attempts=0

while kill -0 "$original_pid" 2>/dev/null && [ "$attempts" -lt 1200 ]; do
  sleep 0.5
  attempts=$((attempts + 1))
done

if ! kill -0 "$original_pid" 2>/dev/null; then
  sleep 1.5
  /usr/bin/open "$app_path"
fi
"#;

    std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("vox-jot-permission-relaunch")
        .arg(current_pid)
        .arg(app_bundle_path)
        .current_dir("/")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("Failed to prepare app relaunch: {err}"))
}

#[specta::specta]
#[tauri::command]
pub fn prepare_macos_permission_relaunch(reason: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let app_bundle_path = current_app_bundle_path()?;
        spawn_permission_relaunch_watcher(&app_bundle_path)?;
        log::info!(
            "Prepared macOS permission relaunch watcher for {reason} using {}",
            app_bundle_path.display()
        );
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = reason;
        Ok(())
    }
}

#[specta::specta]
#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        prepare_macos_permission_relaunch("screen-context-settings".to_string())?;
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to open Screen Recording settings: {}", err))
    }
    #[cfg(target_os = "windows")]
    {
        // No equivalent screen-recording consent prompt on Windows — open the
        // generic Privacy / Screenshots page instead.
        std::process::Command::new("cmd")
            .args([
                "/C",
                "start",
                "ms-settings:privacy-graphicscaptureprogrammatic",
            ])
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to open privacy settings: {}", err))
    }
    #[cfg(target_os = "linux")]
    {
        Err(
            "Screen capture relies on the `grim` (Wayland) or `import`/`gnome-screenshot` (X11) tools. Install one via your package manager."
                .to_string(),
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Screen capture settings are not available on this platform.".to_string())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod permission_relaunch_tests {
    use super::app_bundle_path_from_exe_path;
    use std::path::Path;

    #[test]
    fn finds_bundle_path_from_installed_app_executable() {
        let path = Path::new("/Applications/Vox Jot.app/Contents/MacOS/vox_jot");
        assert_eq!(
            app_bundle_path_from_exe_path(path).as_deref(),
            Some(Path::new("/Applications/Vox Jot.app"))
        );
    }

    #[test]
    fn returns_none_for_non_bundle_executable() {
        let path = Path::new("/Users/example/Apps/Vox Jot/target/debug/vox_jot");
        assert!(app_bundle_path_from_exe_path(path).is_none());
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

/// Resolve a filesystem item to a base64-encoded PNG data URL of its native icon.
///
/// On macOS this asks `NSWorkspace` for the same icon Finder would show, so
/// custom folder icons and color treatments come through when the OS exposes
/// them. Other platforms return `None` and the frontend uses its folder glyph.
#[specta::specta]
#[tauri::command]
pub async fn get_file_icon(app: AppHandle, path: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        if path.trim().is_empty() || !std::path::Path::new(&path).exists() {
            return Ok(None);
        }

        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(macos_file_icon_data_url(&path));
        })
        .map_err(|err| format!("Failed to schedule icon lookup: {}", err))?;

        rx.recv()
            .map_err(|err| format!("Failed to receive icon lookup result: {}", err))?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, path);
        Ok(None)
    }
}

#[cfg(target_os = "macos")]
fn macos_file_icon_data_url(path: &str) -> Result<Option<String>, String> {
    use base64::Engine;
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    let png_bytes = unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let ns_path: *mut Object = msg_send![class!(NSString), alloc];
        let ns_path: *mut Object = msg_send![
            ns_path,
            initWithBytes:path.as_ptr()
            length:path.len()
            encoding:4usize
        ];
        if ns_path.is_null() {
            let _: () = msg_send![pool, drain];
            return Ok(None);
        }

        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let icon: *mut Object = msg_send![workspace, iconForFile: ns_path];
        let _: () = msg_send![ns_path, release];
        if icon.is_null() {
            let _: () = msg_send![pool, drain];
            return Ok(None);
        }

        let tiff_data: *mut Object = msg_send![icon, TIFFRepresentation];
        if tiff_data.is_null() {
            let _: () = msg_send![pool, drain];
            return Ok(None);
        }

        let bitmap: *mut Object = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff_data];
        if bitmap.is_null() {
            let _: () = msg_send![pool, drain];
            return Ok(None);
        }

        let props: *mut Object = msg_send![class!(NSDictionary), dictionary];
        let png_data: *mut Object =
            msg_send![bitmap, representationUsingType:4usize properties:props];
        if png_data.is_null() {
            let _: () = msg_send![pool, drain];
            return Ok(None);
        }

        let bytes: *const u8 = msg_send![png_data, bytes];
        let len: usize = msg_send![png_data, length];
        if bytes.is_null() || len == 0 {
            let _: () = msg_send![pool, drain];
            return Ok(None);
        }
        let copied = std::slice::from_raw_parts(bytes, len).to_vec();
        let _: () = msg_send![pool, drain];
        copied
    };

    let encoded = base64::engine::general_purpose::STANDARD.encode(png_bytes);
    Ok(Some(format!("data:image/png;base64,{}", encoded)))
}
