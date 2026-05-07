//! Active app context capture and write-rule resolution.
//!
//! Detects the frontmost application (Apple Intelligence APIs on macOS,
//! Win32 on Windows, fallback elsewhere) and resolves it against the user's
//! configured write profiles to derive runtime overrides.

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::post_processing::ActiveAppContext;
use crate::settings::AppSettings;
use crate::write_rules::RuleResolver;
use log::debug;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Default)]
pub(super) struct PreparedActiveAppContext {
    pub(super) active_app_context: Option<ActiveAppContext>,
    pub(super) active_url: Option<String>,
}

pub(super) static PREPARED_ACTIVE_APP_CONTEXTS: Lazy<
    Mutex<HashMap<String, PreparedActiveAppContext>>,
> = Lazy::new(|| Mutex::new(HashMap::new()));

pub(super) const VOX_JOT_BUNDLE_ID: &str = "com.iriedinamik.voxjot";
pub(super) const VOX_JOT_APP_NAME: &str = "Vox Jot";
pub(super) const RECORDING_OVERLAY_WINDOW_LABEL: &str = "recording_overlay";

pub(super) fn remember_prepared_active_app_context(
    binding_id: &str,
    prepared_context: PreparedActiveAppContext,
) {
    let mut prepared = PREPARED_ACTIVE_APP_CONTEXTS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    prepared.insert(binding_id.to_string(), prepared_context);
}

pub(super) fn take_prepared_active_app_context(binding_id: &str) -> PreparedActiveAppContext {
    PREPARED_ACTIVE_APP_CONTEXTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(binding_id)
        .unwrap_or_default()
}

pub(super) fn clear_prepared_active_app_context(binding_id: &str) {
    PREPARED_ACTIVE_APP_CONTEXTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(binding_id);
}

pub(super) fn vox_jot_app_context() -> ActiveAppContext {
    ActiveAppContext {
        bundle_id: VOX_JOT_BUNDLE_ID.to_string(),
        localized_name: VOX_JOT_APP_NAME.to_string(),
    }
}

pub(super) fn focused_vox_jot_window(app: &AppHandle) -> bool {
    app.webview_windows()
        .iter()
        .filter(|(label, _)| label.as_str() != RECORDING_OVERLAY_WINDOW_LABEL)
        .any(|(_, window)| window.is_focused().unwrap_or(false))
}

pub(super) fn capture_vox_jot_context_if_focused(app: &AppHandle) -> Option<ActiveAppContext> {
    focused_vox_jot_window(app).then(vox_jot_app_context)
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub(super) fn capture_active_app_context(
    app: &AppHandle,
    _settings: &AppSettings,
) -> Option<ActiveAppContext> {
    // Always attempt to capture the frontmost app context.
    // This is needed for correction tracking and field snapshots,
    // not just app-aware tone post-processing.
    match apple_intelligence::get_frontmost_app_context() {
        Ok(context) => Some(context),
        Err(err) => {
            debug!("Could not detect frontmost app: {}", err);
            capture_vox_jot_context_if_focused(app)
        }
    }
}

#[cfg(all(
    target_os = "windows",
    not(all(target_os = "macos", target_arch = "aarch64"))
))]
pub(super) fn capture_active_app_context(
    app: &AppHandle,
    _settings: &AppSettings,
) -> Option<ActiveAppContext> {
    // Windows path: use the Win32 API to find the foreground window's
    // owning process, then read the executable's product name from
    // its version info. This gives us a friendly localized_name plus
    // a stable bundle_id (we use the executable path, since Windows
    // doesn't have a true bundle id) so Write Profile rules can match
    // by app on Windows the same way they do on macOS.
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return capture_vox_jot_context_if_focused(app);
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return capture_vox_jot_context_if_focused(app);
        }

        let process: HANDLE = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => handle,
            Err(err) => {
                debug!("Failed to OpenProcess for pid {}: {}", pid, err);
                return capture_vox_jot_context_if_focused(app);
            }
        };

        // Read full process image path (e.g. C:\Program Files\Slack\Slack.exe).
        let mut buffer = [0u16; MAX_PATH as usize];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);

        if result.is_err() || size == 0 {
            return capture_vox_jot_context_if_focused(app);
        }

        let path = OsString::from_wide(&buffer[..size as usize])
            .to_string_lossy()
            .into_owned();
        if path.is_empty() {
            return capture_vox_jot_context_if_focused(app);
        }

        // Friendly name: take the file stem ("Slack.exe" → "Slack").
        let localized_name = std::path::Path::new(&path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(&path)
            .to_string();

        // Bundle id: lowercase full path. Stable across launches and
        // matches what users would see if they Tab + Get Info on the
        // running EXE. Cross-platform rules can switch on it if they
        // include both ".../Slack.exe" and "com.tinyspeck.slackmacgap".
        let bundle_id = path.to_lowercase();

        Some(ActiveAppContext {
            bundle_id,
            localized_name,
        })
    }
}

#[cfg(not(any(
    all(target_os = "macos", target_arch = "aarch64"),
    target_os = "windows"
)))]
pub(super) fn capture_active_app_context(
    app: &AppHandle,
    _settings: &AppSettings,
) -> Option<ActiveAppContext> {
    // Linux + Intel macOS + everything else — no frontmost-app
    // detection yet. Returning None means write profiles can still
    // match purely on URL patterns (when the user enables URL capture)
    // but app-only rules effectively never fire on these platforms.
    capture_vox_jot_context_if_focused(app)
}

pub(super) fn capture_active_browser_url(
    settings: &AppSettings,
    active_app_context: Option<&ActiveAppContext>,
) -> Option<String> {
    if !settings.write_rules_url_capture_enabled {
        return None;
    }

    let bundle_id = active_app_context?.bundle_id.trim();
    if bundle_id.is_empty() {
        return None;
    }

    crate::browser_url::active_browser_url(bundle_id)
}

pub(super) fn capture_prepared_write_context(
    app: &AppHandle,
    settings: &AppSettings,
) -> PreparedActiveAppContext {
    let active_app_context = capture_active_app_context(app, settings);
    let active_url = capture_active_browser_url(settings, active_app_context.as_ref());
    PreparedActiveAppContext {
        active_app_context,
        active_url,
    }
}

pub(super) fn resolve_active_write_rule(
    settings: &AppSettings,
    prepared: &PreparedActiveAppContext,
) -> Option<crate::post_processing::ResolvedWriteRule> {
    // Write profiles get their own master toggle (`write_rules_enabled`)
    // so users can keep app-aware tone mappings off while still using
    // rule-based engine/language/output overrides — the two features
    // ship together but conceptually do different things.
    if !settings.write_rules_enabled() {
        return None;
    }

    RuleResolver::resolve(
        &settings.write_rules,
        prepared.active_app_context.as_ref(),
        prepared.active_url.as_deref(),
    )
}

pub(super) fn emit_write_rule_resolution(
    app: &AppHandle,
    resolved: Option<&crate::post_processing::ResolvedWriteRule>,
) {
    if let Some(resolved) = resolved {
        let _ = app.emit("write-rule-matched", resolved);
    } else {
        let _ = app.emit("write-rule-cleared", ());
    }
}

pub(super) fn preview_app_context_from_override(
    settings: &AppSettings,
    app_bundle_id_override: Option<&str>,
) -> Option<ActiveAppContext> {
    let bundle_id = app_bundle_id_override?.trim();
    if bundle_id.is_empty() {
        return None;
    }

    let app_name = settings
        .write_rules
        .iter()
        .find(|rule| {
            rule.matchers
                .bundle_ids
                .iter()
                .any(|b| b.eq_ignore_ascii_case(bundle_id))
        })
        .map(|rule| rule.name.clone())
        .unwrap_or_default();

    Some(ActiveAppContext {
        bundle_id: bundle_id.to_string(),
        localized_name: app_name,
    })
}
