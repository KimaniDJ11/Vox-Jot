//! Central OCR subsystem manager.
//!
//! Owns the provider registry and handles request-ticket session lifecycle,
//! cancellation invalidation, and non-activating overlay status events.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use log::info;
use tauri::{AppHandle, Emitter};

use crate::ocr::jina::JinaOcrProvider;
use crate::ocr::{OcrPhase, OcrProvider, OcrProviderDescriptor, OcrResult, OcrTicket};
use crate::overlay;

/// Session tracking state for cooperative cancellation.
/// Modeled after Vox Jot's TTS playback tracker.
#[derive(Debug, Default)]
pub struct OcrSessionTracker {
    active: Option<OcrTicket>,
    next_request_id: u64,
}

impl OcrSessionTracker {
    pub fn begin(&mut self) -> OcrTicket {
        if let Some(active) = self.active.as_ref() {
            active.stop_flag.store(true, Ordering::Relaxed);
        }

        self.next_request_id = self.next_request_id.wrapping_add(1);
        if self.next_request_id == 0 {
            self.next_request_id = 1;
        }

        let ticket = OcrTicket {
            request_id: self.next_request_id,
            stop_flag: Arc::new(AtomicBool::new(false)),
        };
        self.active = Some(ticket.clone());
        ticket
    }

    pub fn stop(&mut self) -> Option<OcrTicket> {
        let ticket = self.active.take()?;
        ticket.stop_flag.store(true, Ordering::Relaxed);
        Some(ticket)
    }

    pub fn is_active(&self, ticket: &OcrTicket) -> bool {
        self.active
            .as_ref()
            .is_some_and(|active| active.request_id == ticket.request_id)
            && !ticket.stop_flag.load(Ordering::Relaxed)
    }

    pub fn finish_if_active(&mut self, ticket: &OcrTicket) -> bool {
        if self
            .active
            .as_ref()
            .is_none_or(|active| active.request_id != ticket.request_id)
        {
            return false;
        }
        self.active.take();
        true
    }
}

pub struct OcrManager {
    app: AppHandle,
    tracker: Mutex<OcrSessionTracker>,
    providers: HashMap<String, Box<dyn OcrProvider>>,
}

impl OcrManager {
    pub fn new(app: AppHandle) -> Self {
        let mut providers: HashMap<String, Box<dyn OcrProvider>> = HashMap::new();

        // Register Jina OCR provider
        let jina = JinaOcrProvider::new(app.clone());
        providers.insert(jina.id().to_string(), Box::new(jina));

        Self {
            app,
            tracker: Mutex::new(OcrSessionTracker::default()),
            providers,
        }
    }

    /// Begins a new OCR session, automatically invalidating any previous session.
    pub fn begin_ocr_session(&self) -> OcrTicket {
        let mut tracker = self.tracker.lock().unwrap_or_else(|p| p.into_inner());
        tracker.begin()
    }

    /// Explicitly cancels the currently running OCR session, if any.
    pub fn cancel_active_ocr_session(&self) -> Option<OcrTicket> {
        let stopped = {
            let mut tracker = self.tracker.lock().unwrap_or_else(|p| p.into_inner());
            tracker.stop()
        };

        if let Some(ref ticket) = stopped {
            self.emit_status(ticket, OcrPhase::Stopped, None);
        }
        stopped
    }

    /// Checks whether the provided ticket is still the authoritative active session.
    pub fn is_ticket_active(&self, ticket: &OcrTicket) -> bool {
        let tracker = self.tracker.lock().unwrap_or_else(|p| p.into_inner());
        tracker.is_active(ticket)
    }

    /// Clears the ticket if active and updates overlay/event state.
    pub fn finish_ocr_ticket(&self, ticket: &OcrTicket, phase: OcrPhase) {
        let finished = {
            let mut tracker = self.tracker.lock().unwrap_or_else(|p| p.into_inner());
            tracker.finish_if_active(ticket)
        };

        if finished {
            self.emit_status(ticket, phase, None);
        }
    }

    /// Emits non-activating overlay updates and client window events.
    pub fn emit_status(&self, ticket: &OcrTicket, phase: OcrPhase, error: Option<String>) {
        info!(
            "OCR ticket #{} status -> {:?} (err={:?})",
            ticket.request_id, phase, error
        );

        // Update floating non-activating overlay
        if phase.is_terminal() {
            overlay::hide_ocr_overlay(&self.app, ticket.request_id);
        } else {
            overlay::show_ocr_overlay(&self.app, ticket.request_id, phase.as_str());
        }

        // Emit global Tauri event for UI listeners
        let _ = self.app.emit(
            "ocr-status-change",
            serde_json::json!({
                "requestId": ticket.request_id,
                "phase": phase.as_str(),
                "error": error,
            }),
        );
    }

    /// Surfaced list of all registered OCR provider descriptors.
    pub fn get_providers(&self) -> Vec<OcrProviderDescriptor> {
        self.providers.values().map(|p| p.descriptor()).collect()
    }

    /// Executes OCR using the specified (or default experimental) provider.
    pub fn recognize(
        &self,
        image_path: &Path,
        engine_id: Option<&str>,
    ) -> Result<OcrResult, String> {
        let target_id = engine_id.unwrap_or("jina-ocr-v1");
        let provider = self
            .providers
            .get(target_id)
            .ok_or_else(|| format!("Requested OCR provider '{}' is not registered.", target_id))?;

        if !provider.is_available() {
            let desc = provider.descriptor();
            return Err(desc
                .status_detail
                .unwrap_or_else(|| format!("OCR provider '{}' is not available.", target_id)));
        }

        let ticket = self.begin_ocr_session();
        self.emit_status(&ticket, OcrPhase::Recognizing, None);

        let result = provider.recognize(image_path, &ticket);

        match &result {
            Ok(_) => {
                self.finish_ocr_ticket(&ticket, OcrPhase::Complete);
            }
            Err(err) => {
                if ticket.is_cancelled() {
                    self.finish_ocr_ticket(&ticket, OcrPhase::Stopped);
                } else {
                    self.emit_status(&ticket, OcrPhase::Failed, Some(err.clone()));
                    let mut tracker = self.tracker.lock().unwrap_or_else(|p| p.into_inner());
                    tracker.finish_if_active(&ticket);
                }
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracker_ticket_invalidation() {
        let mut tracker = OcrSessionTracker::default();
        let ticket1 = tracker.begin();
        assert_eq!(ticket1.request_id, 1);
        assert!(!ticket1.is_cancelled());
        assert!(tracker.is_active(&ticket1));

        // Starting a new session must cancel the previous ticket
        let ticket2 = tracker.begin();
        assert_eq!(ticket2.request_id, 2);
        assert!(ticket1.is_cancelled());
        assert!(!ticket2.is_cancelled());
        assert!(!tracker.is_active(&ticket1));
        assert!(tracker.is_active(&ticket2));

        // Stopping the active session
        let stopped = tracker.stop();
        assert!(stopped.is_some());
        assert!(ticket2.is_cancelled());
        assert!(!tracker.is_active(&ticket2));
    }

    #[test]
    fn test_tracker_finish_if_active() {
        let mut tracker = OcrSessionTracker::default();
        let ticket = tracker.begin();
        assert!(tracker.is_active(&ticket));

        // Finishing active ticket returns true
        assert!(tracker.finish_if_active(&ticket));
        assert!(!tracker.is_active(&ticket));

        // Finishing again returns false
        assert!(!tracker.finish_if_active(&ticket));
    }
}
