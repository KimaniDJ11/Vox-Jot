use handy_keys::KeyboardListener;
use log::{debug, warn};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RecentInputSignals {
    pub saw_submit: bool,
    pub saw_destructive_edit: bool,
    pub destructive_after_submit: bool,
}

#[derive(Debug, Default)]
struct RecentInputState {
    last_submit: Mutex<Option<Instant>>,
    last_destructive_edit: Mutex<Option<Instant>>,
}

impl RecentInputState {
    fn note_submit(&self) {
        if let Ok(mut last_submit) = self.last_submit.lock() {
            *last_submit = Some(Instant::now());
        }
    }

    fn note_destructive_edit(&self) {
        if let Ok(mut last_destructive) = self.last_destructive_edit.lock() {
            *last_destructive = Some(Instant::now());
        }
    }

    fn signals_since(&self, since: Instant) -> RecentInputSignals {
        let last_submit = self.last_submit.lock().ok().and_then(|guard| *guard);
        let last_destructive = self
            .last_destructive_edit
            .lock()
            .ok()
            .and_then(|guard| *guard);

        let submit_after = last_submit.filter(|instant| *instant >= since);
        let destructive_after = last_destructive.filter(|instant| *instant >= since);

        RecentInputSignals {
            saw_submit: submit_after.is_some(),
            saw_destructive_edit: destructive_after.is_some(),
            destructive_after_submit: match (submit_after, destructive_after) {
                (_, Some(_)) if submit_after.is_none() => true,
                (Some(submit), Some(destructive)) => destructive >= submit,
                _ => false,
            },
        }
    }
}

pub struct RecentInputTracker {
    state: Arc<RecentInputState>,
    running: Arc<AtomicBool>,
    started: AtomicBool,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
}

impl RecentInputTracker {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RecentInputState::default()),
            running: Arc::new(AtomicBool::new(false)),
            started: AtomicBool::new(false),
            thread_handle: Mutex::new(None),
        }
    }

    pub fn start_listener(&self) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }

        self.running.store(true, Ordering::SeqCst);

        let state = Arc::clone(&self.state);
        let running = Arc::clone(&self.running);

        let handle = thread::spawn(move || {
            let listener = match KeyboardListener::new() {
                Ok(listener) => listener,
                Err(err) => {
                    warn!("Failed to start recent input tracker listener: {}", err);
                    return;
                }
            };

            debug!("Recent input tracker listener started");

            while running.load(Ordering::SeqCst) {
                if let Some(event) = listener.try_recv() {
                    if event.is_key_down {
                        let key_name = event
                            .key
                            .map(|key| key.to_string().to_lowercase())
                            .unwrap_or_default();
                        let modifiers = modifiers_to_strings(event.modifiers);

                        if is_submit_key(&key_name, &modifiers) {
                            state.note_submit();
                        }

                        if is_destructive_key(&key_name, &modifiers) {
                            state.note_destructive_edit();
                        }
                    }
                } else {
                    thread::sleep(Duration::from_millis(10));
                }
            }

            debug!("Recent input tracker listener stopped");
        });

        if let Ok(mut thread_handle) = self.thread_handle.lock() {
            *thread_handle = Some(handle);
        }
    }

    #[cfg(test)]
    pub fn note_submit_for_test(&self) {
        self.state.note_submit();
    }

    #[cfg(test)]
    pub fn note_destructive_edit_for_test(&self) {
        self.state.note_destructive_edit();
    }

    pub fn signals_since(&self, since: Instant) -> RecentInputSignals {
        self.state.signals_since(since)
    }
}

impl Drop for RecentInputTracker {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);

        if let Ok(mut handle) = self.thread_handle.lock() {
            if let Some(join_handle) = handle.take() {
                let _ = join_handle.join();
            }
        }
    }
}

fn modifiers_to_strings(modifiers: handy_keys::Modifiers) -> Vec<String> {
    let mut result = Vec::new();

    if modifiers.contains(handy_keys::Modifiers::CTRL) {
        result.push("ctrl".to_string());
    }
    if modifiers.contains(handy_keys::Modifiers::OPT) {
        #[cfg(target_os = "macos")]
        result.push("option".to_string());
        #[cfg(not(target_os = "macos"))]
        result.push("alt".to_string());
    }
    if modifiers.contains(handy_keys::Modifiers::SHIFT) {
        result.push("shift".to_string());
    }
    if modifiers.contains(handy_keys::Modifiers::CMD) {
        #[cfg(target_os = "macos")]
        result.push("command".to_string());
        #[cfg(not(target_os = "macos"))]
        result.push("super".to_string());
    }

    result
}

fn is_submit_key(key_name: &str, modifiers: &[String]) -> bool {
    let looks_like_enter = key_name.contains("enter") || key_name.contains("return");
    looks_like_enter && !modifiers.iter().any(|modifier| modifier == "shift")
}

fn is_destructive_key(key_name: &str, modifiers: &[String]) -> bool {
    if key_name.contains("backspace") || key_name.contains("delete") {
        return true;
    }

    let has_primary_modifier = modifiers
        .iter()
        .any(|modifier| modifier == "ctrl" || modifier == "command");

    has_primary_modifier && key_name == "x"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn submit_keys_ignore_shift_enter() {
        assert!(is_submit_key("return", &[]));
        assert!(is_submit_key("enter", &["command".to_string()]));
        assert!(!is_submit_key("enter", &["shift".to_string()]));
    }

    #[test]
    fn destructive_keys_detect_delete_and_cut() {
        assert!(is_destructive_key("delete", &[]));
        assert!(is_destructive_key("backspace", &[]));
        assert!(is_destructive_key("x", &["command".to_string()]));
        assert!(!is_destructive_key("x", &[]));
    }

    #[test]
    fn signals_since_reports_event_ordering() {
        let tracker = RecentInputTracker::new();
        let started_at = Instant::now();

        tracker.note_submit_for_test();
        std::thread::sleep(Duration::from_millis(2));
        tracker.note_destructive_edit_for_test();

        let signals = tracker.signals_since(started_at);
        assert!(signals.saw_submit);
        assert!(signals.saw_destructive_edit);
        assert!(signals.destructive_after_submit);
    }
}
