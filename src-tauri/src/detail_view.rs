use log::{debug, error};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use tauri_nspanel::{CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

const DETAIL_LABEL: &str = "detail-view";
const MODEL_HUB_LABEL: &str = "model-hub-view";
const MODEL_HUB_SECTION: &str = "model-hub";
const DETAIL_PATH: &str = "/src/detail/index.html";
/// Default detail / "show all" window size (logical pixels).
const DETAIL_WIDTH: f64 = 800.0;
const DETAIL_HEIGHT: f64 = 900.0;
const DETAIL_MIN_WIDTH: f64 = 560.0;
const DETAIL_MIN_HEIGHT: f64 = 640.0;
/// Model Hub opens wider than the standard detail view so all seven category
/// tabs fit on one row without horizontal scrolling on first open.
const MODEL_HUB_WIDTH: f64 = 1000.0;

#[derive(Default)]
pub struct DetailViewRoutingState {
    target_section: Mutex<Option<String>>,
    model_hub_native_dialog_active: Mutex<bool>,
}

impl DetailViewRoutingState {
    fn set_target_section(&self, section: &str) {
        if let Ok(mut target) = self.target_section.lock() {
            *target = Some(section.to_string());
        }
    }

    fn get_target_section(&self) -> Option<String> {
        self.target_section
            .lock()
            .ok()
            .and_then(|target| target.clone())
    }

    fn set_model_hub_native_dialog_active(&self, active: bool) {
        if let Ok(mut is_active) = self.model_hub_native_dialog_active.lock() {
            *is_active = active;
        }
    }

    fn is_model_hub_native_dialog_active(&self) -> bool {
        self.model_hub_native_dialog_active
            .lock()
            .map(|is_active| *is_active)
            .unwrap_or(false)
    }
}

#[cfg(target_os = "macos")]
mod detail_panel {
    use tauri::Manager;
    use tauri_nspanel::tauri_panel;
    tauri_panel! {
        panel!(DetailViewPanel {
            config: {
                can_become_key_window: true,
                is_floating_panel: true
            }
        })
    }
}

#[cfg(target_os = "macos")]
use detail_panel::DetailViewPanel;

fn emit_model_hub_visibility(app: &AppHandle, visible: bool) {
    if let Err(e) = app.emit_to("main", "model-hub-visibility", visible) {
        error!("Failed to emit model-hub-visibility: {}", e);
    }
}

fn attach_close_handler(app: &AppHandle, label: &'static str) {
    if let Some(window) = app.get_webview_window(label) {
        let app_clone = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(w) = app_clone.get_webview_window(label) {
                    let _ = w.hide();
                    if label == MODEL_HUB_LABEL {
                        emit_model_hub_visibility(&app_clone, false);
                    }
                }
            }
        });
    }
}

fn attach_blur_hide_handler(app: &AppHandle, label: &'static str) {
    if let Some(window) = app.get_webview_window(label) {
        let app_clone = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if !*focused {
                    if label == MODEL_HUB_LABEL
                        && app_clone
                            .state::<DetailViewRoutingState>()
                            .is_model_hub_native_dialog_active()
                    {
                        return;
                    }
                    if let Some(w) = app_clone.get_webview_window(label) {
                        let _ = w.hide();
                        if label == MODEL_HUB_LABEL {
                            emit_model_hub_visibility(&app_clone, false);
                        }
                    }
                }
            }
        });
    }
}

/// Tell the detail-view frontend to switch sections via an event.
fn emit_section_to(app: &AppHandle, label: &str, section: &str) {
    if let Err(e) = app.emit_to(label, "detail-navigate", section) {
        error!(
            "Failed to emit detail-navigate for section '{}': {}",
            section, e
        );
    }
}

#[cfg(target_os = "macos")]
fn create_detail_window(app: &AppHandle, section: &str) {
    let webview_data_dir = crate::portable::data_dir().map(|dir| dir.join("webview"));
    let section_owned = section.to_string();
    let app_clone = app.clone();

    let builder = PanelBuilder::<_, DetailViewPanel>::new(app, DETAIL_LABEL)
        .url(crate::app_webview_url(DETAIL_PATH))
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
            let w = crate::apply_webview_workarounds(
                w.min_inner_size(DETAIL_MIN_WIDTH, DETAIL_MIN_HEIGHT),
            );
            let w = w
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
                        emit_section_to(window.app_handle(), DETAIL_LABEL, &section_owned);
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
            panel.show();
            debug!("Detail view panel created for section: {}", section);
            attach_close_handler(&app_clone, DETAIL_LABEL);
        }
        Err(e) => {
            error!("Failed to create detail view panel: {}", e);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn create_detail_window(app: &AppHandle, section: &str) {
    let section_owned = section.to_string();

    let mut builder =
        WebviewWindowBuilder::new(app, DETAIL_LABEL, crate::app_webview_url(DETAIL_PATH))
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
                    emit_section_to(window.app_handle(), DETAIL_LABEL, &section_owned);
                }
            });

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    match builder.build() {
        Ok(_window) => {
            debug!("Detail view window created for section: {}", section);
            attach_close_handler(app, DETAIL_LABEL);
        }
        Err(e) => {
            error!("Failed to create detail view window: {}", e);
        }
    }
}

fn create_model_hub_window(app: &AppHandle) {
    let mut builder = crate::apply_webview_workarounds(WebviewWindowBuilder::new(
        app,
        MODEL_HUB_LABEL,
        crate::app_webview_url(DETAIL_PATH),
    ));
    builder = builder
        .title("Vox Jot")
        .inner_size(MODEL_HUB_WIDTH, DETAIL_HEIGHT)
        .min_inner_size(DETAIL_MIN_WIDTH, DETAIL_MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .focused(true)
        .visible(true)
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                emit_section_to(window.app_handle(), MODEL_HUB_LABEL, MODEL_HUB_SECTION);
            }
        });

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    match builder.build() {
        Ok(_window) => {
            debug!("Model hub window created");
            attach_close_handler(app, MODEL_HUB_LABEL);
            attach_blur_hide_handler(app, MODEL_HUB_LABEL);
        }
        Err(e) => {
            error!("Failed to create model hub window: {}", e);
        }
    }
}

/// Show the detail view window for a given section.
/// If the window already exists, it emits an event to switch sections and shows it.
pub fn show_detail_view(app: &AppHandle, section: &str) {
    let state = app.state::<DetailViewRoutingState>();
    state.set_target_section(section);

    if section == MODEL_HUB_SECTION {
        if let Some(window) = app.get_webview_window(MODEL_HUB_LABEL) {
            emit_section_to(app, MODEL_HUB_LABEL, section);
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            emit_model_hub_visibility(app, true);
            debug!("Model hub shown");
            return;
        }

        create_model_hub_window(app);
        emit_model_hub_visibility(app, true);
        return;
    }

    if let Some(window) = app.get_webview_window(DETAIL_LABEL) {
        emit_section_to(app, DETAIL_LABEL, section);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        debug!("Detail view shown for section: {}", section);
        return;
    }

    create_detail_window(app, section);
}

pub fn get_detail_target_section(app: &AppHandle) -> Option<String> {
    let state = app.state::<DetailViewRoutingState>();
    state.get_target_section()
}

pub fn set_model_hub_native_dialog_active(app: &AppHandle, active: bool) {
    let state = app.state::<DetailViewRoutingState>();
    state.set_model_hub_native_dialog_active(active);
}
