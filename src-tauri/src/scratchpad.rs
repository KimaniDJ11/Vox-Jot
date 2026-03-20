use log::{debug, error};
use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

const SCRATCHPAD_LABEL: &str = "scratchpad";
const SCRATCHPAD_WIDTH: f64 = 480.0;
const SCRATCHPAD_HEIGHT: f64 = 560.0;
const SCRATCHPAD_MIN_WIDTH: f64 = 340.0;
const SCRATCHPAD_MIN_HEIGHT: f64 = 300.0;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(ScratchpadPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

fn attach_scratchpad_close_handler(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) {
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
}

#[cfg(target_os = "macos")]
fn create_scratchpad_window(app: &AppHandle) {
    let webview_data_dir = crate::portable::data_dir().map(|dir| dir.join("webview"));
    let builder = PanelBuilder::<_, ScratchpadPanel>::new(app, SCRATCHPAD_LABEL)
        .url(tauri::WebviewUrl::App("src/scratchpad/index.html".into()))
        .title("Scratchpad")
        .size(tauri::Size::Logical(tauri::LogicalSize {
            width: SCRATCHPAD_WIDTH,
            height: SCRATCHPAD_HEIGHT,
        }))
        .content_size(tauri::Size::Logical(tauri::LogicalSize {
            width: SCRATCHPAD_WIDTH,
            height: SCRATCHPAD_HEIGHT,
        }))
        .level(PanelLevel::Floating)
        .floating(true)
        .hides_on_deactivate(false)
        .collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary(),
        )
        .style_mask(
            StyleMask::empty()
                .titled()
                .closable()
                .miniaturizable()
                .resizable()
                .full_size_content_view()
                .nonactivating_panel(),
        )
        .with_window(move |w| {
            let w = w
                .min_inner_size(SCRATCHPAD_MIN_WIDTH, SCRATCHPAD_MIN_HEIGHT)
                .resizable(true)
                .maximizable(false)
                .minimizable(true)
                .closable(true)
                .always_on_top(true)
                .focused(true)
                .visible(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);

            if let Some(data_dir) = webview_data_dir.clone() {
                w.data_directory(data_dir)
            } else {
                w
            }
        });

    match builder.build() {
        Ok(panel) => {
            let _ = panel.show();
            debug!("Scratchpad panel created");
            attach_scratchpad_close_handler(app);
        }
        Err(e) => {
            error!("Failed to create scratchpad panel: {}", e);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn create_scratchpad_window(app: &AppHandle) {
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

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    match builder.build() {
        Ok(_window) => {
            debug!("Scratchpad window created");
            attach_scratchpad_close_handler(app);
        }
        Err(e) => {
            error!("Failed to create scratchpad window: {}", e);
        }
    }
}

/// Show the scratchpad window, creating it if it doesn't exist yet.
pub fn show_scratchpad(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        debug!("Scratchpad window shown");
        return;
    }

    create_scratchpad_window(app);
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
