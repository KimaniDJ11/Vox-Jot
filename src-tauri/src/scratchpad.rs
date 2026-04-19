use log::{debug, error};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

const SCRATCHPAD_LABEL: &str = "scratchpad";
/// Default Jot Pad window size (logical pixels).
const SCRATCHPAD_WIDTH: f64 = 640.0;
const SCRATCHPAD_HEIGHT: f64 = 720.0;
const SCRATCHPAD_MIN_WIDTH: f64 = 480.0;
const SCRATCHPAD_MIN_HEIGHT: f64 = 560.0;

#[derive(Default)]
pub struct ScratchpadRoutingState {
    editor_armed: Mutex<bool>,
    pending_insert: Mutex<bool>,
    pending_note_target: Mutex<Option<i64>>,
}

impl ScratchpadRoutingState {
    fn set_editor_armed(&self, armed: bool) {
        if let Ok(mut state) = self.editor_armed.lock() {
            *state = armed;
        }
    }

    fn snapshot_pending_insert(&self, scratchpad_window_focused: bool) {
        let armed = self
            .editor_armed
            .lock()
            .map(|state| *state)
            .unwrap_or(false);
        if let Ok(mut pending) = self.pending_insert.lock() {
            *pending = armed || scratchpad_window_focused;
        }
    }

    fn consume_pending_insert(&self) -> bool {
        if let Ok(mut pending) = self.pending_insert.lock() {
            let was_pending = *pending;
            *pending = false;
            return was_pending;
        }

        false
    }

    fn clear_pending_insert(&self) {
        if let Ok(mut pending) = self.pending_insert.lock() {
            *pending = false;
        }
    }

    fn set_pending_note_target(&self, note_id: i64) {
        if let Ok(mut pending) = self.pending_note_target.lock() {
            *pending = Some(note_id);
        }
    }

    fn consume_pending_note_target(&self) -> Option<i64> {
        if let Ok(mut pending) = self.pending_note_target.lock() {
            return pending.take();
        }

        None
    }
}

pub struct PendingScratchpadInsertGuard {
    app: AppHandle,
}

impl PendingScratchpadInsertGuard {
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }
}

impl Drop for PendingScratchpadInsertGuard {
    fn drop(&mut self) {
        clear_pending_insert_target(&self.app);
    }
}

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
        .title("Jot Pad")
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
                .full_size_content_view(),
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
                .visible(false)
                .transparent(true)
                .title_bar_style(tauri::TitleBarStyle::Transparent)
                .hidden_title(true)
                .accept_first_mouse(true);

            if let Some(data_dir) = webview_data_dir.clone() {
                w.data_directory(data_dir)
            } else {
                w
            }
        });

    match builder.build() {
        Ok(panel) => {
            if let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) {
                let _ = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::HudWindow,
                    Some(NSVisualEffectState::FollowsWindowActiveState),
                    Some(22.0),
                );
                let _ = window.show();
            } else {
                panel.show();
            }
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
    .title("Jot Pad")
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

pub fn set_scratchpad_editor_armed(app: &AppHandle, armed: bool) {
    let state = app.state::<ScratchpadRoutingState>();
    state.set_editor_armed(armed);
}

pub fn snapshot_pending_insert_target(app: &AppHandle) {
    let state = app.state::<ScratchpadRoutingState>();
    let scratchpad_window_focused = app
        .get_webview_window(SCRATCHPAD_LABEL)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    state.snapshot_pending_insert(scratchpad_window_focused);
    debug!(
        "Snapshot Jot Pad insert target with window_focused={}",
        scratchpad_window_focused
    );
}

pub fn consume_pending_insert_target(app: &AppHandle) -> bool {
    let state = app.state::<ScratchpadRoutingState>();
    state.consume_pending_insert()
}

pub fn clear_pending_insert_target(app: &AppHandle) {
    let state = app.state::<ScratchpadRoutingState>();
    state.clear_pending_insert();
}

#[cfg(test)]
mod tests {
    use super::ScratchpadRoutingState;

    #[test]
    fn snapshot_pending_insert_uses_editor_armed_state() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(true);

        state.snapshot_pending_insert(false);

        assert!(state.consume_pending_insert());
    }

    #[test]
    fn snapshot_pending_insert_uses_focused_window_as_fallback() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(false);

        state.snapshot_pending_insert(true);

        assert!(state.consume_pending_insert());
    }

    #[test]
    fn snapshot_pending_insert_stays_false_without_editor_or_window_focus() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(false);

        state.snapshot_pending_insert(false);

        assert!(!state.consume_pending_insert());
    }
}

pub fn set_pending_note_target(app: &AppHandle, note_id: i64) {
    let state = app.state::<ScratchpadRoutingState>();
    state.set_pending_note_target(note_id);
}

pub fn consume_pending_note_target(app: &AppHandle) -> Option<i64> {
    let state = app.state::<ScratchpadRoutingState>();
    state.consume_pending_note_target()
}
