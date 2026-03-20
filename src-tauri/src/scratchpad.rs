use log::{debug, error};
use tauri::{AppHandle, Manager, WebviewWindowBuilder};

const SCRATCHPAD_LABEL: &str = "scratchpad";
const SCRATCHPAD_WIDTH: f64 = 480.0;
const SCRATCHPAD_HEIGHT: f64 = 560.0;
const SCRATCHPAD_MIN_WIDTH: f64 = 340.0;
const SCRATCHPAD_MIN_HEIGHT: f64 = 300.0;

/// Show the scratchpad window, creating it if it doesn't exist yet.
pub fn show_scratchpad(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        debug!("Scratchpad window shown");
        return;
    }

    // Create the scratchpad window
    let mut builder = WebviewWindowBuilder::new(
        app,
        SCRATCHPAD_LABEL,
        tauri::WebviewUrl::App("src/scratchpad/index.html".into()),
    )
    .title("Scratchpad")
    .inner_size(SCRATCHPAD_WIDTH, SCRATCHPAD_HEIGHT)
    .min_inner_size(SCRATCHPAD_MIN_WIDTH, SCRATCHPAD_MIN_HEIGHT)
    .resizable(true)
    .maximizable(true)
    .minimizable(true)
    .closable(true)
    .always_on_top(true)
    .focused(true)
    .visible(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    match builder.build() {
        Ok(window) => {
            debug!("Scratchpad window created");

            // Hide on close instead of destroying
            let app_clone = app.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(w) = app_clone.get_webview_window(SCRATCHPAD_LABEL) {
                        let _ = w.hide();
                    }
                }
            });
        }
        Err(e) => {
            error!("Failed to create scratchpad window: {}", e);
        }
    }
}

/// Hide the scratchpad window without destroying it.
#[allow(dead_code)]
pub fn hide_scratchpad(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) {
        let _ = window.hide();
    }
}

/// Toggle scratchpad visibility.
pub fn toggle_scratchpad(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    } else {
        show_scratchpad(app);
    }
}
