use log::{debug, error};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask, WebviewWindowExt,
};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

pub const SCRATCHPAD_LABEL: &str = "scratchpad";
/// Default Jot Pad window size (logical pixels).
const SCRATCHPAD_WIDTH: f64 = 640.0;
const SCRATCHPAD_HEIGHT: f64 = 720.0;
const SCRATCHPAD_MIN_WIDTH: f64 = 480.0;
const SCRATCHPAD_MIN_HEIGHT: f64 = 560.0;

/// Grace window after the Jot Pad loses focus during which we still treat it
/// as the dictation target. This absorbs transient blurs that can happen as
/// the OS hands a global shortcut to the app or our overlay briefly steals key.
const FOCUS_GRACE: Duration = Duration::from_millis(800);
/// Grace window after a Jot Pad editor had DOM focus. The frontend can receive
/// a blur before the global shortcut callback snapshots the target, so a recent
/// editor focus is still a valid routing signal at recording start.
const EDITOR_ARM_GRACE: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct ScratchpadRoutingState {
    editor_armed: Mutex<bool>,
    last_editor_armed_at: Mutex<Option<Instant>>,
    window_focused: Mutex<bool>,
    last_focused_at: Mutex<Option<Instant>>,
    pending_insert: Mutex<bool>,
    pending_note_target: Mutex<Option<i64>>,
}

impl ScratchpadRoutingState {
    fn set_editor_armed(&self, armed: bool) {
        if let Ok(mut state) = self.editor_armed.lock() {
            *state = armed;
        }
        if armed {
            if let Ok(mut last) = self.last_editor_armed_at.lock() {
                *last = Some(Instant::now());
            }
        }
    }

    fn set_window_focused(&self, focused: bool) {
        if let Ok(mut state) = self.window_focused.lock() {
            *state = focused;
        }
        if focused {
            if let Ok(mut last) = self.last_focused_at.lock() {
                *last = Some(Instant::now());
            }
        }
    }

    fn is_window_focused(&self) -> bool {
        self.window_focused.lock().map(|s| *s).unwrap_or(false)
    }

    fn recently_focused(&self, grace: Duration) -> bool {
        self.last_focused_at
            .lock()
            .ok()
            .and_then(|s| *s)
            .map(|t| t.elapsed() < grace)
            .unwrap_or(false)
    }

    fn recently_editor_armed(&self, grace: Duration) -> bool {
        self.last_editor_armed_at
            .lock()
            .ok()
            .and_then(|s| *s)
            .map(|t| t.elapsed() < grace)
            .unwrap_or(false)
    }

    /// Snapshot which target should receive the dictated text.
    ///
    /// Truthy when any of these hold:
    /// 1. A text input inside the Jot Pad is armed (user clicked into it).
    /// 2. A Jot Pad editor had DOM focus recently, before transient blur.
    /// 3. The scratchpad window is focused right now (key window) per the
    ///    Tauri-tracked state, even if no input has been touched yet.
    /// 4. `is_focused_fallback` from the OS reports focus (covers timing
    ///    where the WindowEvent::Focused has not flowed through yet).
    /// 5. The scratchpad was focused within `FOCUS_GRACE` and the user just
    ///    triggered the shortcut. This absorbs transient blurs from the
    ///    overlay or global-shortcut path.
    fn snapshot_pending_insert(&self, is_focused_fallback: bool, scratchpad_available: bool) {
        let armed = self
            .editor_armed
            .lock()
            .map(|state| *state)
            .unwrap_or(false);
        let recent_editor_focus = self.recently_editor_armed(EDITOR_ARM_GRACE);
        let tracked_focus = self.is_window_focused();
        let recent_focus = self.recently_focused(FOCUS_GRACE);

        let pending = scratchpad_available
            && (armed
                || recent_editor_focus
                || tracked_focus
                || is_focused_fallback
                || recent_focus);

        debug!(
            "Snapshot Jot Pad insert target: available={} armed={} recent_editor_focus={} tracked_focus={} fallback_focus={} recent_focus={} -> pending={}",
            scratchpad_available, armed, recent_editor_focus, tracked_focus, is_focused_fallback, recent_focus, pending
        );

        if let Ok(mut state) = self.pending_insert.lock() {
            *state = pending;
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

    panel_event!(ScratchpadPanelDelegate {
        window_did_become_key(notification: &NSNotification) -> (),
        window_did_resign_key(notification: &NSNotification) -> (),
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
            // Attach the focus delegate BEFORE showing, so the very first
            // windowDidBecomeKey: notification fires through our handler.
            attach_scratchpad_focus_delegate(app, &panel);

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

/// Attach an NSWindowDelegate to the scratchpad panel so we can reliably
/// observe key-window transitions. Tauri's `WindowEvent::Focused` does not
/// fire for `NSPanel`s, but `windowDidBecomeKey:` / `windowDidResignKey:`
/// are part of the NSWindowDelegate protocol and fire for all NSWindows,
/// panels included. See the bug in
/// <https://github.com/tauri-apps/tauri/issues> tracking NSPanel focus.
#[cfg(target_os = "macos")]
fn attach_scratchpad_focus_delegate(
    app: &AppHandle,
    panel: &std::sync::Arc<dyn tauri_nspanel::Panel<tauri::Wry>>,
) {
    let handler = ScratchpadPanelDelegate::new();

    let app_become = app.clone();
    handler.window_did_become_key(move |_notification| {
        notify_scratchpad_focus_change(&app_become, true);
    });

    let app_resign = app.clone();
    handler.window_did_resign_key(move |_notification| {
        notify_scratchpad_focus_change(&app_resign, false);
    });

    panel.set_event_handler(Some(handler.as_ref()));
    // `set_event_handler` retains the delegate, so dropping `handler` here is
    // fine; the panel keeps it alive for its lifetime.
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

/// Notify the routing state that the Jot Pad window gained or lost focus.
/// Called from the Tauri `WindowEvent::Focused` handler. This is more
/// reliable than `window.is_focused()` for `NSPanel` on macOS.
pub fn notify_scratchpad_focus_change(app: &AppHandle, focused: bool) {
    let state = app.state::<ScratchpadRoutingState>();
    state.set_window_focused(focused);
    debug!("Jot Pad window focus changed: focused={}", focused);
}

#[cfg(target_os = "macos")]
pub fn set_scratchpad_titlebar_drag_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) else {
        return Ok(());
    };
    let panel = window
        .to_panel::<ScratchpadPanel>()
        .map_err(|e| format!("Failed to access Jot Pad panel: {}", e))?;
    panel.set_movable_by_window_background(enabled);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_scratchpad_titlebar_drag_enabled(
    _app: &AppHandle,
    _enabled: bool,
) -> Result<(), String> {
    Ok(())
}

/// True if the scratchpad window currently exists, is visible, and not
/// minimized. This is the cheapest "is the user looking at it" check.
fn is_scratchpad_visible(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(SCRATCHPAD_LABEL) else {
        return false;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    visible && !minimized
}

/// On macOS, ask NSWorkspace which app is currently frontmost and compare
/// to Vox Jot's bundle id. This is the canonical signal that "the user is
/// in our app right now"; neither Tauri's `WindowEvent::Focused` nor
/// `window.is_focused()` fire reliably for `NSPanel`s, and DOM focus events
/// don't propagate to the backend in time. The frontmost-app query bypasses
/// all of that.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn is_vox_jot_frontmost(app: &AppHandle) -> bool {
    let Ok(context) = crate::apple_intelligence::get_frontmost_app_context() else {
        return false;
    };
    let our_bundle_id = app.config().identifier.as_str();
    context.bundle_id.eq_ignore_ascii_case(our_bundle_id)
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn is_vox_jot_frontmost(_app: &AppHandle) -> bool {
    // Non-macOS platforms don't have the NSPanel focus problem; the existing
    // signals are sufficient there.
    false
}

pub fn snapshot_pending_insert_target(app: &AppHandle) {
    let state = app.state::<ScratchpadRoutingState>();
    let is_focused_fallback = app
        .get_webview_window(SCRATCHPAD_LABEL)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);

    // Strongest macOS signal: Vox Jot is frontmost AND the Jot Pad is on
    // screen. If both hold, the user is dictating into Vox Jot and the Jot
    // Pad is the writing surface. Route there even when every other focus
    // signal is unreliable.
    let frontmost_with_visible = is_vox_jot_frontmost(app) && is_scratchpad_visible(app);

    state.snapshot_pending_insert(
        is_focused_fallback || frontmost_with_visible,
        is_scratchpad_visible(app),
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

/// True if the Jot Pad is the right target for the dictated text right now.
/// Used by the paste path to recover from a missed snapshot.
///
/// Checks (in priority order):
/// 1. The Jot Pad editor is armed or was armed very recently.
/// 2. The Tauri-tracked focus state (set by `notify_scratchpad_focus_change`).
/// 3. Tauri's `is_focused()` query (unreliable for `NSPanel`).
/// 4. macOS `NSWorkspace.frontmostApplication`: Vox Jot is the frontmost app
///    AND the Jot Pad window is visible. This is the canonical signal and
///    works even when the other two layers silently fail.
pub fn scratchpad_currently_focused(app: &AppHandle) -> bool {
    if !is_scratchpad_visible(app) {
        return false;
    }

    let state = app.state::<ScratchpadRoutingState>();
    if state
        .editor_armed
        .lock()
        .map(|armed| *armed)
        .unwrap_or(false)
        || state.recently_editor_armed(EDITOR_ARM_GRACE)
    {
        return true;
    }
    if state.is_window_focused() {
        return true;
    }
    if app
        .get_webview_window(SCRATCHPAD_LABEL)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
    {
        return true;
    }
    is_vox_jot_frontmost(app) && is_scratchpad_visible(app)
}

#[cfg(test)]
mod tests {
    use super::{ScratchpadRoutingState, EDITOR_ARM_GRACE, FOCUS_GRACE};
    use std::thread::sleep;
    use std::time::Duration;

    #[test]
    fn snapshot_pending_insert_uses_editor_armed_state() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(true);

        state.snapshot_pending_insert(false, true);

        assert!(state.consume_pending_insert());
    }

    #[test]
    fn snapshot_pending_insert_uses_focused_window_as_fallback() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(false);

        state.snapshot_pending_insert(true, true);

        assert!(state.consume_pending_insert());
    }

    #[test]
    fn snapshot_pending_insert_stays_false_without_editor_or_window_focus() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(false);

        state.snapshot_pending_insert(false, true);

        assert!(!state.consume_pending_insert());
    }

    #[test]
    fn snapshot_pending_insert_stays_false_when_window_is_unavailable() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(true);
        state.set_window_focused(true);

        state.snapshot_pending_insert(true, false);

        assert!(!state.consume_pending_insert());
    }

    #[test]
    fn snapshot_uses_recent_editor_focus_after_transient_blur() {
        // The focused textarea/input can blur before the global shortcut start
        // callback snapshots the target. Recent editor focus should still route
        // that dictation into Jot Pad.
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(true);
        state.set_editor_armed(false);

        state.snapshot_pending_insert(false, true);

        assert!(state.consume_pending_insert());
    }

    #[test]
    fn snapshot_skips_editor_focus_when_stale() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(true);
        state.set_editor_armed(false);

        sleep(EDITOR_ARM_GRACE + Duration::from_millis(50));

        state.snapshot_pending_insert(false, true);

        assert!(!state.consume_pending_insert());
    }

    #[test]
    fn snapshot_uses_tracked_window_focus_even_when_fallback_is_false() {
        // Simulates the macOS NSPanel case: WindowEvent::Focused reports
        // focus, but `is_focused()` returns false.
        let state = ScratchpadRoutingState::default();
        state.set_window_focused(true);

        state.snapshot_pending_insert(false, true);

        assert!(state.consume_pending_insert());
    }

    #[test]
    fn snapshot_uses_recent_focus_grace_after_blur() {
        // User had Jot Pad focused, the shortcut press briefly blurred it,
        // and the OS reports unfocused at snapshot time. The grace window
        // should still route to Jot Pad.
        let state = ScratchpadRoutingState::default();
        state.set_window_focused(true);
        state.set_window_focused(false);

        state.snapshot_pending_insert(false, true);

        assert!(state.consume_pending_insert());
    }

    #[test]
    fn snapshot_skips_jot_pad_when_focus_is_stale() {
        // Window was focused long ago; user has clearly moved to another
        // app. We should not steal their dictation.
        let state = ScratchpadRoutingState::default();
        state.set_window_focused(true);
        state.set_window_focused(false);

        // Wait past the grace window.
        sleep(FOCUS_GRACE + Duration::from_millis(50));

        state.snapshot_pending_insert(false, true);

        assert!(!state.consume_pending_insert());
    }

    #[test]
    fn consume_clears_pending_state() {
        let state = ScratchpadRoutingState::default();
        state.set_editor_armed(true);
        state.snapshot_pending_insert(false, true);

        assert!(state.consume_pending_insert());
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
