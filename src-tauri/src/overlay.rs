use crate::input;
use crate::settings;
use crate::settings::{OverlayPosition, RecordingOverlayStyle};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

#[cfg(not(target_os = "macos"))]
use log::debug;

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel};

#[cfg(target_os = "linux")]
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
#[cfg(target_os = "linux")]
use std::env;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecordingOverlayPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

const OVERLAY_WIDTH_DETAILED: f64 = 220.0;
const OVERLAY_HEIGHT_DETAILED: f64 = 44.0;
const OVERLAY_WIDTH_COMPACT: f64 = 80.0;
const OVERLAY_HEIGHT_COMPACT: f64 = 28.0;
const OVERLAY_WIDTH_MINIMAL: f64 = 18.0;
const OVERLAY_HEIGHT_MINIMAL: f64 = 18.0;
// Notch overlay sits centered above the camera notch on M-series MacBooks.
// Width matches the typical notch (~190 pt), height covers the menu-bar
// region below the notch lip.
const OVERLAY_WIDTH_NOTCH: f64 = 190.0;
const OVERLAY_HEIGHT_NOTCH: f64 = 30.0;

fn overlay_dimensions(style: RecordingOverlayStyle) -> (f64, f64) {
    match style {
        RecordingOverlayStyle::Compact => (OVERLAY_WIDTH_COMPACT, OVERLAY_HEIGHT_COMPACT),
        RecordingOverlayStyle::Detailed => (OVERLAY_WIDTH_DETAILED, OVERLAY_HEIGHT_DETAILED),
        RecordingOverlayStyle::Minimal => (OVERLAY_WIDTH_MINIMAL, OVERLAY_HEIGHT_MINIMAL),
        RecordingOverlayStyle::Notch => (OVERLAY_WIDTH_NOTCH, OVERLAY_HEIGHT_NOTCH),
    }
}

#[cfg(target_os = "macos")]
const OVERLAY_TOP_OFFSET: f64 = 46.0;
#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_TOP_OFFSET: f64 = 4.0;

#[cfg(target_os = "macos")]
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_BOTTOM_OFFSET: f64 = 40.0;

#[cfg(target_os = "linux")]
fn update_gtk_layer_shell_anchors(overlay_window: &tauri::webview::WebviewWindow) {
    let window_clone = overlay_window.clone();
    let _ = overlay_window.run_on_main_thread(move || {
        // Try to get the GTK window from the Tauri webview
        if let Ok(gtk_window) = window_clone.gtk_window() {
            let settings = settings::get_settings(window_clone.app_handle());
            match settings.overlay_position {
                OverlayPosition::Top => {
                    gtk_window.set_anchor(Edge::Top, true);
                    gtk_window.set_anchor(Edge::Bottom, false);
                }
                OverlayPosition::Bottom | OverlayPosition::None => {
                    gtk_window.set_anchor(Edge::Bottom, true);
                    gtk_window.set_anchor(Edge::Top, false);
                }
            }
        }
    });
}

/// Initializes GTK layer shell for Linux overlay window
/// Returns true if layer shell was successfully initialized, false otherwise
#[cfg(target_os = "linux")]
fn init_gtk_layer_shell(overlay_window: &tauri::webview::WebviewWindow) -> bool {
    // On KDE Wayland, layer-shell init has shown protocol instability.
    // Fall back to regular always-on-top overlay behavior (as in v0.7.1).
    let is_wayland = env::var("WAYLAND_DISPLAY").is_ok()
        || env::var("XDG_SESSION_TYPE")
            .map(|v| v.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false);
    let is_kde = env::var("XDG_CURRENT_DESKTOP")
        .map(|v| v.to_uppercase().contains("KDE"))
        .unwrap_or(false)
        || env::var("KDE_SESSION_VERSION").is_ok();
    if is_wayland && is_kde {
        debug!("Skipping GTK layer shell init on KDE Wayland");
        return false;
    }

    if !gtk_layer_shell::is_supported() {
        return false;
    }

    // Try to get the GTK window from the Tauri webview
    if let Ok(gtk_window) = overlay_window.gtk_window() {
        // Initialize layer shell
        gtk_window.init_layer_shell();
        gtk_window.set_layer(Layer::Overlay);
        gtk_window.set_keyboard_mode(KeyboardMode::None);
        gtk_window.set_exclusive_zone(0);

        update_gtk_layer_shell_anchors(overlay_window);

        return true;
    }
    false
}

/// Forces a window to be topmost using Win32 API (Windows only)
/// This is more reliable than Tauri's set_always_on_top which can be overridden
#[cfg(target_os = "windows")]
fn force_overlay_topmost(overlay_window: &tauri::webview::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    // Clone because run_on_main_thread takes 'static
    let overlay_clone = overlay_window.clone();

    // Make sure the Win32 call happens on the UI thread
    let _ = overlay_clone.clone().run_on_main_thread(move || {
        if let Ok(hwnd) = overlay_clone.hwnd() {
            unsafe {
                // Force Z-order: make this window topmost without changing size/pos or stealing focus
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    });
}

fn get_monitor_with_cursor(app_handle: &AppHandle) -> Option<tauri::Monitor> {
    if let Some(mouse_location) = input::get_cursor_position(app_handle) {
        if let Ok(monitors) = app_handle.available_monitors() {
            for monitor in monitors {
                // Tauri's monitor position/size are physical pixels, but enigo
                // may return logical coordinates (confirmed on macOS via
                // NSEvent::mouseLocation; on Windows, GetCursorPos behavior
                // depends on the process DPI-awareness context). Dividing by
                // scale_factor normalizes to logical, which is safe regardless:
                // if enigo returns logical it matches directly, and if it returns
                // physical on a scale=1 monitor the division is a no-op.
                let scale = monitor.scale_factor();
                let pos = PhysicalPosition::new(
                    (monitor.position().x as f64 / scale) as i32,
                    (monitor.position().y as f64 / scale) as i32,
                );
                let size = PhysicalSize::new(
                    (monitor.size().width as f64 / scale) as u32,
                    (monitor.size().height as f64 / scale) as u32,
                );
                if is_mouse_within_monitor(mouse_location, &pos, &size) {
                    return Some(monitor);
                }
            }
        }
    }

    app_handle.primary_monitor().ok().flatten()
}

fn is_mouse_within_monitor(
    mouse_pos: (i32, i32),
    monitor_pos: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> bool {
    let (mouse_x, mouse_y) = mouse_pos;
    let PhysicalPosition {
        x: monitor_x,
        y: monitor_y,
    } = *monitor_pos;
    let PhysicalSize {
        width: monitor_width,
        height: monitor_height,
    } = *monitor_size;

    mouse_x >= monitor_x
        && mouse_x < (monitor_x + monitor_width as i32)
        && mouse_y >= monitor_y
        && mouse_y < (monitor_y + monitor_height as i32)
}

/// Returns overlay position in logical coordinates (points on macOS).
///
/// Uses monitor position/size directly rather than work_area(), which can
/// return incorrect coordinates on macOS for monitors with negative positions.
/// The per-platform OVERLAY_TOP_OFFSET / OVERLAY_BOTTOM_OFFSET constants
/// already account for system chrome (menu bar, taskbar).
///
/// We must use LogicalPosition (not PhysicalPosition) because Tauri/tao
/// converts PhysicalPosition using the scale factor of the monitor the window
/// is *currently* on, which is wrong when moving cross-monitor.
fn calculate_overlay_position(app_handle: &AppHandle) -> Option<(f64, f64)> {
    let monitor = get_monitor_with_cursor(app_handle)?;
    let scale = monitor.scale_factor();
    let monitor_x = monitor.position().x as f64 / scale;
    let monitor_y = monitor.position().y as f64 / scale;
    let monitor_width = monitor.size().width as f64 / scale;
    let monitor_height = monitor.size().height as f64 / scale;

    let settings = settings::get_settings(app_handle);
    let (ov_width, ov_height) = overlay_dimensions(settings.recording_overlay_style);

    let x = monitor_x + (monitor_width - ov_width) / 2.0;
    // The Notch style ignores OverlayPosition and pins to the very
    // top of the screen so it can hug the menu-bar / camera notch
    // area on macOS. On other platforms this just behaves like a
    // top-aligned compact pill.
    let y = if matches!(
        settings.recording_overlay_style,
        RecordingOverlayStyle::Notch
    ) {
        monitor_y
    } else {
        match settings.overlay_position {
            OverlayPosition::Top => monitor_y + OVERLAY_TOP_OFFSET,
            OverlayPosition::Bottom | OverlayPosition::None => {
                monitor_y + monitor_height - ov_height - OVERLAY_BOTTOM_OFFSET
            }
        }
    };

    Some((x, y))
}

/// Creates the recording overlay window and keeps it hidden by default
#[cfg(not(target_os = "macos"))]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    let position = calculate_overlay_position(app_handle);

    // On Linux (Wayland), monitor detection often fails, but we don't need exact coordinates
    // for Layer Shell as we use anchors. On other platforms, we require a monitor.
    #[cfg(not(target_os = "linux"))]
    if position.is_none() {
        debug!("Failed to determine overlay position, not creating overlay window");
        return;
    }

    let settings = settings::get_settings(app_handle);
    let (w, h) = overlay_dimensions(settings.recording_overlay_style);

    // Position starts unset — update_overlay_position() sets the correct
    // LogicalPosition before the overlay is shown.
    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        "recording_overlay",
        tauri::WebviewUrl::App("src/overlay/index.html".into()),
    )
    .title("Recording")
    .resizable(false)
    .inner_size(w, h)
    .shadow(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .accept_first_mouse(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focused(false)
    .visible(false);

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "linux")]
            {
                // Try to initialize GTK layer shell, ignore errors if compositor doesn't support it
                if init_gtk_layer_shell(&window) {
                    debug!("GTK layer shell initialized for overlay window");
                } else {
                    debug!("GTK layer shell not available, falling back to regular window");
                }
            }

            debug!("Recording overlay window created successfully (hidden)");
        }
        Err(e) => {
            debug!("Failed to create recording overlay window: {}", e);
        }
    }
}

/// Creates the recording overlay panel and keeps it hidden by default (macOS)
#[cfg(target_os = "macos")]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    if let Some((x, y)) = calculate_overlay_position(app_handle) {
        let settings = settings::get_settings(app_handle);
        let (w, h) = overlay_dimensions(settings.recording_overlay_style);

        // PanelBuilder creates a Tauri window then converts it to NSPanel.
        // The window remains registered, so get_webview_window() still works.
        match PanelBuilder::<_, RecordingOverlayPanel>::new(app_handle, "recording_overlay")
            .url(WebviewUrl::App("src/overlay/index.html".into()))
            .title("Recording")
            .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .level(PanelLevel::Status)
            .size(tauri::Size::Logical(tauri::LogicalSize {
                width: w,
                height: h,
            }))
            .has_shadow(false)
            .transparent(true)
            .no_activate(true)
            .corner_radius(0.0)
            .with_window(|w| w.decorations(false).transparent(true))
            .collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary(),
            )
            .build()
        {
            Ok(panel) => {
                panel.hide();
            }
            Err(e) => {
                log::error!("Failed to create recording overlay panel: {}", e);
            }
        }
    }
}

fn show_overlay_state(app_handle: &AppHandle, state: &str) {
    // Check if overlay should be shown based on position setting
    let settings = settings::get_settings(app_handle);
    if settings.overlay_position == OverlayPosition::None {
        return;
    }

    apply_recording_overlay_metrics(app_handle);

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.show();

        // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
        #[cfg(target_os = "windows")]
        force_overlay_topmost(&overlay_window);

        let style_str = match settings.recording_overlay_style {
            RecordingOverlayStyle::Compact => "compact",
            RecordingOverlayStyle::Detailed => "detailed",
            RecordingOverlayStyle::Minimal => "minimal",
            RecordingOverlayStyle::Notch => "notch",
        };
        let payload = serde_json::json!({ "state": state, "style": style_str });
        let _ = overlay_window.emit("show-overlay", payload);
    }
}

/// Shows the recording overlay window with fade-in animation
pub fn show_recording_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "recording");
}

/// Shows the transcribing overlay window
pub fn show_transcribing_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "transcribing");
}

/// Shows the processing overlay window
pub fn show_processing_overlay(app_handle: &AppHandle) {
    show_overlay_state(app_handle, "processing");
}

/// Applies current overlay style dimensions and re-centers the window.
pub fn apply_recording_overlay_metrics(app_handle: &AppHandle) {
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let settings = settings::get_settings(app_handle);
        let (w, h) = overlay_dimensions(settings.recording_overlay_style);

        let _ = overlay_window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: w,
            height: h,
        }));

        #[cfg(target_os = "linux")]
        {
            update_gtk_layer_shell_anchors(&overlay_window);
        }

        if let Some((x, y)) = calculate_overlay_position(app_handle) {
            let _ = overlay_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }
    }
}

/// Convenience alias used by `change_overlay_position_setting`.
pub fn update_overlay_position(app_handle: &AppHandle) {
    apply_recording_overlay_metrics(app_handle);
}

/// Hides the recording overlay window with fade-out animation
pub fn hide_recording_overlay(app_handle: &AppHandle) {
    // Always hide the overlay regardless of settings - if setting was changed while recording,
    // we still want to hide it properly
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Emit event to trigger fade-out animation
        let _ = overlay_window.emit("hide-overlay", ());
        // Hide the window after a short delay to allow animation to complete
        let window_clone = overlay_window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let _ = window_clone.hide();
        });
    }
}

const MIC_LEVEL_EMIT_INTERVAL_MS: u128 = 33; // ~30 Hz cap

static LAST_APP_LEVEL_EMIT_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static LAST_OVERLAY_LEVEL_EMIT_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

pub fn emit_levels(app_handle: &AppHandle, levels: &Vec<f32>) {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let app_last = LAST_APP_LEVEL_EMIT_MS.load(std::sync::atomic::Ordering::Relaxed);
    if now_ms.saturating_sub(app_last) >= MIC_LEVEL_EMIT_INTERVAL_MS as u64 {
        LAST_APP_LEVEL_EMIT_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
        let _ = app_handle.emit("mic-level", levels);
    }

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let overlay_last = LAST_OVERLAY_LEVEL_EMIT_MS.load(std::sync::atomic::Ordering::Relaxed);
        if now_ms.saturating_sub(overlay_last) >= MIC_LEVEL_EMIT_INTERVAL_MS as u64 {
            LAST_OVERLAY_LEVEL_EMIT_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
            let _ = overlay_window.emit("mic-level", levels);
        }
    }
}

pub fn emit_partial_transcription(app_handle: &AppHandle, text: &str) {
    let _ = app_handle.emit("partial-transcription", text);

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.emit("partial-transcription", text);
    }
}

/// Emits the accumulated post-process text as it streams in from the LLM.
/// Each event carries the *full* text accumulated so far, so the UI can simply
/// replace its current buffer on each tick.
pub fn emit_post_process_chunk(app_handle: &AppHandle, accumulated: &str) {
    let _ = app_handle.emit("post-process-chunk", accumulated);

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.emit("post-process-chunk", accumulated);
    }
}

/// Emits a coarse post-process lifecycle status so overlays can switch
/// between "thinking", "streaming", and "complete" UI states.
pub fn emit_post_process_status(app_handle: &AppHandle, status: &str) {
    let _ = app_handle.emit("post-process-status", status);

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.emit("post-process-status", status);
    }
}
