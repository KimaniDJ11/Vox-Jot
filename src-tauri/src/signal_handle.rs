use crate::TranscriptionCoordinator;
use log::{debug, warn};
use tauri::{AppHandle, Manager};

#[cfg(unix)]
use signal_hook::consts::{SIGUSR1, SIGUSR2};
#[cfg(unix)]
use signal_hook::iterator::{Handle as SignalsHandle, Signals};
#[cfg(unix)]
use std::{sync::Mutex, thread};

#[cfg(unix)]
pub struct SignalHandler {
    handle: SignalsHandle,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

/// Send a transcription input to the coordinator.
/// Used by signal handlers, CLI flags, and any other external trigger.
pub fn send_transcription_input(app: &AppHandle, binding_id: &str, source: &str) {
    if let Some(c) = app.try_state::<TranscriptionCoordinator>() {
        c.send_input(binding_id, source, true, false);
    } else {
        warn!("TranscriptionCoordinator not initialized");
    }
}

#[cfg(unix)]
pub fn setup_signal_handler(app_handle: AppHandle, mut signals: Signals) -> SignalHandler {
    debug!("Signal handlers registered (SIGUSR1, SIGUSR2)");
    let handle = signals.handle();
    let worker = thread::spawn(move || {
        for sig in signals.forever() {
            let (binding_id, signal_name) = match sig {
                SIGUSR1 => ("transcribe_with_post_process", "SIGUSR1"),
                SIGUSR2 => ("transcribe", "SIGUSR2"),
                _ => continue,
            };
            debug!("Received {signal_name}");
            send_transcription_input(&app_handle, binding_id, signal_name);
        }
    });

    SignalHandler {
        handle,
        worker: Mutex::new(Some(worker)),
    }
}

#[cfg(unix)]
impl Drop for SignalHandler {
    fn drop(&mut self) {
        self.handle.close();

        if let Ok(mut worker) = self.worker.lock() {
            if let Some(join_handle) = worker.take() {
                if join_handle.join().is_err() {
                    warn!("Signal handler thread panicked during shutdown");
                }
            }
        }
    }
}
