//! Auto-correction learning system.
//!
//! After Vox Jot pastes a transcript, this module observes the target text field
//! for user edits, extracts correction pairs (e.g. "Cheyene" → "Cheyenne"),
//! and feeds them back into the personal dictionary so future transcriptions
//! improve automatically.
//!
//! The system is app-aware: it classifies the target app as ephemeral (chat/search)
//! or persistent (notes/editors) and adapts its monitoring strategy accordingly.
//! In chat apps, it captures corrections even when the field clears after sending,
//! and distinguishes "message sent" from "user manually deleted everything."

pub mod app_classifier;
pub mod diff;
pub mod field_monitor;
#[cfg(target_os = "linux")]
pub mod field_monitor_linux;
#[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
pub mod field_monitor_macos;
#[cfg(target_os = "windows")]
pub mod field_monitor_windows;
#[cfg(not(vox_jot_app_store))]
pub mod recent_input;
#[cfg(vox_jot_app_store)]
pub mod recent_input {
    use std::time::Instant;

    #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
    pub struct RecentInputSignals {
        pub saw_submit: bool,
        pub saw_destructive_edit: bool,
        pub destructive_after_submit: bool,
    }

    pub struct RecentInputTracker;

    impl Default for RecentInputTracker {
        fn default() -> Self {
            Self::new()
        }
    }

    impl RecentInputTracker {
        pub fn new() -> Self {
            Self
        }

        pub fn start_listener(&self) {}

        pub fn signals_since(&self, _since: Instant) -> RecentInputSignals {
            RecentInputSignals::default()
        }
    }
}
pub mod span;
pub mod store;

use app_classifier::classify_app;
use log::info;
use recent_input::RecentInputTracker;
use span::{InsertedSpan, InsertionMethod};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use store::CorrectionStore;
use tauri::AppHandle;
use tokio::task::JoinHandle;

/// Manages the currently active inserted span and coordinates correction monitoring.
pub struct InsertedSpanTracker {
    active_span: Mutex<Option<InsertedSpan>>,
    monitor_task: Mutex<Option<JoinHandle<()>>>,
}

impl InsertedSpanTracker {
    /// Create a new tracker with no active span.
    pub fn new() -> Self {
        Self {
            active_span: Mutex::new(None),
            monitor_task: Mutex::new(None),
        }
    }

    /// Record a new span and start monitoring for corrections.
    ///
    /// This replaces any previously active span and spawns an async task
    /// to monitor the text field for user edits. The monitoring strategy
    /// (poll interval, window duration, clear-event handling) is automatically
    /// determined by classifying the target app.
    pub fn record_and_start_monitoring(
        &self,
        inserted_text: String,
        app_identifier: Option<String>,
        app_name: Option<String>,
        insertion_method: InsertionMethod,
        store: Arc<CorrectionStore>,
        recent_input: Arc<RecentInputTracker>,
        app_handle: AppHandle,
    ) {
        let span = InsertedSpan::new(
            inserted_text,
            app_identifier.clone(),
            app_name,
            insertion_method,
        );

        // Classify the target app to determine monitoring strategy
        let app_behavior = classify_app(app_identifier.as_deref());
        let params = app_behavior.monitoring_params();

        info!(
            "Recording inserted span '{}' ({} chars, app: {:?}, behavior: {:?}, fast poll: {}ms, steady poll: {}ms, window: {}s)",
            span.id,
            span.inserted_text.len(),
            app_identifier,
            app_behavior,
            params.fast_poll_interval_ms,
            params.steady_poll_interval_ms,
            params.window_secs,
        );

        // Retry listener startup here in case app boot happened before macOS
        // Input Monitoring was granted. In App Store builds this is a no-op.
        recent_input.start_listener();

        // Store the span
        {
            let mut active = self.active_span.lock().unwrap_or_else(|e| e.into_inner());
            *active = Some(span.clone());
        }

        // Create a platform-specific field reader
        let reader = create_platform_reader(app_identifier);

        // Spawn the monitoring task
        let monitor_task = tokio::spawn(async move {
            field_monitor::monitor_for_corrections(
                reader,
                span,
                store,
                app_behavior,
                recent_input,
                app_handle,
            )
            .await;
        });

        let mut active_task = self.monitor_task.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous_task) = active_task.take() {
            previous_task.abort();
        }
        *active_task = Some(monitor_task);
    }

    /// Get a clone of the currently active span, if any.
    #[cfg(test)]
    pub fn get_active_span(&self) -> Option<InsertedSpan> {
        self.active_span
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Clear the active span.
    #[cfg(test)]
    pub fn clear_active_span(&self) {
        let mut active = self.active_span.lock().unwrap_or_else(|e| e.into_inner());
        if active.is_some() {
            log::debug!("Clearing active inserted span");
        }
        *active = None;
    }
}

impl Drop for InsertedSpanTracker {
    fn drop(&mut self) {
        if let Ok(mut task) = self.monitor_task.lock() {
            if let Some(handle) = task.take() {
                handle.abort();
            }
        }
    }
}

#[derive(Debug, Clone)]
pub enum FieldObservationOutcome {
    Captured {
        snapshot_text: String,
    },
    SkippedFocusChanged {
        snapshot_text: Option<String>,
    },
    SkippedUnreadable {
        snapshot_text: Option<String>,
        reason: String,
    },
    Failed {
        error_message: String,
    },
}

/// Observe the focused text field immediately after paste, polling for up to
/// `window_secs` while the same field remains focused.
pub async fn observe_field_snapshot(
    app_identifier: Option<String>,
    window_secs: u64,
    poll_interval: Duration,
) -> FieldObservationOutcome {
    fn failed(error_message: impl Into<String>) -> FieldObservationOutcome {
        FieldObservationOutcome::Failed {
            error_message: error_message.into(),
        }
    }

    let reader = create_platform_reader(app_identifier);

    let initial_text = match tokio::task::spawn_blocking({
        let reader = reader.clone();
        move || reader.read_focused_field_text()
    })
    .await
    {
        Ok(Ok(Some(text))) => text,
        Ok(Ok(None)) => {
            return FieldObservationOutcome::SkippedUnreadable {
                snapshot_text: None,
                reason: "Focused field text was unreadable or unavailable immediately after paste."
                    .to_string(),
            };
        }
        Ok(Err(e)) => {
            log::warn!("initial field snapshot read error: {}", e);
            return failed(e.to_string());
        }
        Err(e) => return failed(format!("Field snapshot task failed: {}", e)),
    };

    let total_window = Duration::from_secs(window_secs);
    let mut elapsed = Duration::ZERO;
    let mut last_observed_text = initial_text;

    while elapsed < total_window {
        let step = poll_interval.min(total_window - elapsed);
        tokio::time::sleep(step).await;
        elapsed += step;

        match tokio::task::spawn_blocking({
            let reader = reader.clone();
            move || reader.is_same_field_focused()
        })
        .await
        {
            Ok(Ok(true)) => {}
            Ok(Ok(false)) => {
                return FieldObservationOutcome::SkippedFocusChanged {
                    snapshot_text: Some(last_observed_text),
                };
            }
            Ok(Err(e)) => {
                log::warn!("field focus check error: {}", e);
                return failed(e.to_string());
            }
            Err(e) => return failed(format!("Field focus check task failed: {}", e)),
        }

        match tokio::task::spawn_blocking({
            let reader = reader.clone();
            move || reader.read_focused_field_text()
        })
        .await
        {
            Ok(Ok(Some(text))) => {
                last_observed_text = text;
            }
            Ok(Ok(None)) => {
                return FieldObservationOutcome::SkippedUnreadable {
                    snapshot_text: Some(last_observed_text),
                    reason: "Focused field text became unreadable during observation.".to_string(),
                };
            }
            Ok(Err(e)) => {
                log::warn!("field snapshot polling read error: {}", e);
                return failed(e.to_string());
            }
            Err(e) => return failed(format!("Field snapshot polling task failed: {}", e)),
        }
    }

    FieldObservationOutcome::Captured {
        snapshot_text: last_observed_text,
    }
}

/// Create a platform-specific field text reader.
fn create_platform_reader(
    _app_identifier: Option<String>,
) -> Arc<dyn field_monitor::FieldTextReader> {
    #[cfg(all(target_os = "macos", not(vox_jot_app_store)))]
    {
        Arc::new(field_monitor_macos::MacosFieldTextReader::new(
            _app_identifier,
        ))
    }

    #[cfg(all(target_os = "macos", vox_jot_app_store))]
    {
        Arc::new(NoopFieldTextReader)
    }

    #[cfg(target_os = "windows")]
    {
        // Get the current foreground window HWND
        let hwnd = {
            use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
            let hwnd = unsafe { GetForegroundWindow() };
            if hwnd.0 as isize != 0 {
                Some(hwnd.0 as isize)
            } else {
                None
            }
        };
        Arc::new(field_monitor_windows::WindowsFieldTextReader::new(hwnd))
    }

    #[cfg(target_os = "linux")]
    {
        Arc::new(field_monitor_linux::LinuxFieldTextReader::new())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        // Fallback: no-op reader
        Arc::new(NoopFieldTextReader)
    }
}

/// No-op field text reader for unsupported platforms.
#[cfg(any(
    all(target_os = "macos", vox_jot_app_store),
    not(any(target_os = "macos", target_os = "windows", target_os = "linux"))
))]
struct NoopFieldTextReader;

#[cfg(any(
    all(target_os = "macos", vox_jot_app_store),
    not(any(target_os = "macos", target_os = "windows", target_os = "linux"))
))]
impl field_monitor::FieldTextReader for NoopFieldTextReader {
    fn read_focused_field_text(&self) -> anyhow::Result<Option<String>> {
        Ok(None)
    }

    fn is_same_field_focused(&self) -> anyhow::Result<bool> {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracker_get_active_span_initially_none() {
        let tracker = InsertedSpanTracker::new();
        assert!(
            tracker.get_active_span().is_none(),
            "Expected no active span on a freshly created tracker"
        );
    }

    #[test]
    fn test_tracker_set_and_get_active_span() {
        let tracker = InsertedSpanTracker::new();

        // Manually set an active span via the mutex
        let span = InsertedSpan::new(
            "hello world".to_string(),
            Some("com.test.app".to_string()),
            Some("TestApp".to_string()),
            InsertionMethod::Clipboard,
        );

        {
            let mut active = tracker
                .active_span
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *active = Some(span.clone());
        }

        let retrieved = tracker.get_active_span();
        assert!(retrieved.is_some(), "Expected active span to be set");
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.inserted_text, "hello world");
        assert_eq!(retrieved.app_identifier.as_deref(), Some("com.test.app"));
    }

    #[test]
    fn test_tracker_clear_removes_span() {
        let tracker = InsertedSpanTracker::new();

        // Set a span
        let span = InsertedSpan::new(
            "some text".to_string(),
            None,
            None,
            InsertionMethod::DirectType,
        );
        {
            let mut active = tracker
                .active_span
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *active = Some(span);
        }

        assert!(
            tracker.get_active_span().is_some(),
            "Span should be set before clearing"
        );

        tracker.clear_active_span();

        assert!(
            tracker.get_active_span().is_none(),
            "Expected active span to be None after clear_active_span()"
        );
    }

    #[test]
    fn test_tracker_clear_on_empty_is_noop() {
        let tracker = InsertedSpanTracker::new();

        // Clearing when already empty should not panic
        tracker.clear_active_span();

        assert!(
            tracker.get_active_span().is_none(),
            "Expected no span after clearing an already-empty tracker"
        );
    }

    #[test]
    fn test_tracker_overwrite_span() {
        let tracker = InsertedSpanTracker::new();

        // Set first span
        let span1 = InsertedSpan::new(
            "first text".to_string(),
            Some("com.app.one".to_string()),
            None,
            InsertionMethod::Clipboard,
        );
        {
            let mut active = tracker
                .active_span
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *active = Some(span1);
        }

        // Overwrite with second span
        let span2 = InsertedSpan::new(
            "second text".to_string(),
            Some("com.app.two".to_string()),
            None,
            InsertionMethod::DirectType,
        );
        {
            let mut active = tracker
                .active_span
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *active = Some(span2);
        }

        let retrieved = tracker.get_active_span().unwrap();
        assert_eq!(
            retrieved.inserted_text, "second text",
            "Expected the second span to overwrite the first"
        );
        assert_eq!(retrieved.app_identifier.as_deref(), Some("com.app.two"));
    }
}
