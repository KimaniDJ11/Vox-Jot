//! Auto-correction learning system.
//!
//! After Vox Jot pastes a transcript, this module observes the target text field
//! for user edits, extracts correction pairs (e.g. "Cheyene" → "Cheyenne"),
//! and feeds them back into the personal dictionary so future transcriptions
//! improve automatically.

pub mod diff;
pub mod field_monitor;
#[cfg(target_os = "linux")]
pub mod field_monitor_linux;
#[cfg(target_os = "macos")]
pub mod field_monitor_macos;
#[cfg(target_os = "windows")]
pub mod field_monitor_windows;
pub mod span;
pub mod store;

use log::{debug, info, warn};
use span::{InsertedSpan, InsertionMethod};
use std::sync::{Arc, Mutex};
use store::CorrectionStore;

/// Manages the currently active inserted span and coordinates correction monitoring.
pub struct InsertedSpanTracker {
    active_span: Mutex<Option<InsertedSpan>>,
}

impl InsertedSpanTracker {
    /// Create a new tracker with no active span.
    pub fn new() -> Self {
        Self {
            active_span: Mutex::new(None),
        }
    }

    /// Record a new span and start monitoring for corrections.
    ///
    /// This replaces any previously active span and spawns an async task
    /// to monitor the text field for user edits.
    pub fn record_and_start_monitoring(
        &self,
        inserted_text: String,
        app_identifier: Option<String>,
        app_name: Option<String>,
        insertion_method: InsertionMethod,
        store: Arc<CorrectionStore>,
        delay_secs: u32,
    ) {
        let span = InsertedSpan::new(
            inserted_text,
            app_identifier.clone(),
            app_name,
            insertion_method,
        );

        info!(
            "Recording inserted span '{}' ({} chars, app: {:?})",
            span.id,
            span.inserted_text.len(),
            app_identifier
        );

        // Store the span
        {
            let mut active = self.active_span.lock().unwrap();
            *active = Some(span.clone());
        }

        // Create a platform-specific field reader
        let reader = create_platform_reader(app_identifier);

        // Spawn the monitoring task
        tokio::spawn(async move {
            field_monitor::monitor_for_corrections(reader, span, store, delay_secs).await;
        });
    }

    /// Get a clone of the currently active span, if any.
    pub fn get_active_span(&self) -> Option<InsertedSpan> {
        self.active_span.lock().unwrap().clone()
    }

    /// Clear the active span.
    pub fn clear_active_span(&self) {
        let mut active = self.active_span.lock().unwrap();
        if active.is_some() {
            debug!("Clearing active inserted span");
        }
        *active = None;
    }
}

/// Create a platform-specific field text reader.
fn create_platform_reader(
    _app_identifier: Option<String>,
) -> Arc<dyn field_monitor::FieldTextReader> {
    #[cfg(target_os = "macos")]
    {
        // Try to get the PID from the app identifier
        let pid = _app_identifier.as_ref().and_then(|_| {
            // PID lookup would require NSWorkspace — for now pass None
            // The macOS reader will use system-wide focused element
            None
        });
        Arc::new(field_monitor_macos::MacosFieldTextReader::new(pid))
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
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
struct NoopFieldTextReader;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
impl field_monitor::FieldTextReader for NoopFieldTextReader {
    fn read_focused_field_text(&self) -> anyhow::Result<Option<String>> {
        Ok(None)
    }

    fn is_same_field_focused(&self) -> anyhow::Result<bool> {
        Ok(false)
    }
}
