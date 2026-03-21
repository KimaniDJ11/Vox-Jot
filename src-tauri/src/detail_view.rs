use log::{debug, error};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

const DETAIL_LABEL: &str = "detail-view";
const DETAIL_PATH: &str = "src/detail/index.html";
const DETAIL_WIDTH: f64 = 560.0;
const DETAIL_HEIGHT: f64 = 640.0;
const DETAIL_MIN_WIDTH: f64 = 400.0;
const DETAIL_MIN_HEIGHT: f64 = 400.0;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(DetailViewPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

fn attach_close_handler(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(DETAIL_LABEL) {
        let app_clone = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(w) = app_clone.get_webview_window(DETAIL_LABEL) {
                    let _ = w.hide();
                }
            }
        });
    }
}

/// Tell the detail-view frontend to switch sections via an event.
fn emit_section(app: &AppHandle, section: &str) {
    if let Err(e) = app.emit_to(DETAIL_LABEL, "detail-navigate", section) {
        error!("Failed to emit detail-navigate for section '{}': {}", section, e);
    }
}

#[cfg(target_os = "macos")]
fn create_detail_window(app: &AppHandle, section: &str) {
    let webview_data_dir = crate::portable::data_dir().map(|dir| dir.join("webview"));
    let section_owned = section.to_string();
    let app_clone = app.clone();

    let builder = PanelBuilder::<_, DetailViewPanel>::new(app, DETAIL_LABEL)
        .url(tauri::WebviewUrl::App(DETAIL_PATH.into()))
        .title("Vox Jot")
        .size(tauri::Size::Logical(tauri::LogicalSize {
            width: DETAIL_WIDTH,
            height: DETAIL_HEIGHT,
        }))
        .content_size(tauri::Size::Logical(tauri::LogicalSize {
            width: DETAIL_WIDTH,
            height: DETAIL_HEIGHT,
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
                .full_size_content_view(),
        )
        .with_window(move |w| {
            let w = w
                .min_inner_size(DETAIL_MIN_WIDTH, DETAIL_MIN_HEIGHT)
                .resizable(true)
                .maximizable(false)
                .minimizable(true)
                .closable(true)
                .always_on_top(true)
                .focused(true)
                .visible(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .on_page_load(move |window, payload| {
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        emit_section(window.app_handle(), &section_owned);
                    }
                });

            if let Some(data_dir) = webview_data_dir.clone() {
                w.data_directory(data_dir)
            } else {
                w
            }
        });

    match builder.build() {
        Ok(panel) => {
            let _ = panel.show();
            debug!("Detail view panel created for section: {}", section);
            attach_close_handler(&app_clone);
        }
        Err(e) => {
            error!("Failed to create detail view panel: {}", e);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn create_detail_window(app: &AppHandle, section: &str) {
    let section_owned = section.to_string();

    let mut builder = WebviewWindowBuilder::new(
        app,
        DETAIL_LABEL,
        tauri::WebviewUrl::App(DETAIL_PATH.into()),
    )
    .title("Vox Jot")
    .inner_size(DETAIL_WIDTH, DETAIL_HEIGHT)
    .min_inner_size(DETAIL_MIN_WIDTH, DETAIL_MIN_HEIGHT)
    .resizable(true)
    .maximizable(true)
    .minimizable(true)
    .closable(true)
    .always_on_top(true)
    .focused(true)
    .visible(true)
    .on_page_load(move |window, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            emit_section(window.app_handle(), &section_owned);
        }
    });

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    match builder.build() {
        Ok(_window) => {
            debug!("Detail view window created for section: {}", section);
            attach_close_handler(app);
        }
        Err(e) => {
            error!("Failed to create detail view window: {}", e);
        }
    }
}

/// Show the detail view window for a given section.
/// If the window already exists, it emits an event to switch sections and shows it.
pub fn show_detail_view(app: &AppHandle, section: &str) {
    if let Some(window) = app.get_webview_window(DETAIL_LABEL) {
        emit_section(app, section);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        debug!("Detail view shown for section: {}", section);
        return;
    }

    create_detail_window(app, section);
}
