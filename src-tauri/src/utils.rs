use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;
use crate::shortcut;
use crate::tts::TtsManager;
use crate::TranscriptionCoordinator;
use log::info;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

// Re-export all utility modules for easy access
// pub use crate::audio_feedback::*;
pub use crate::clipboard::*;
pub use crate::overlay::*;
pub use crate::tray::*;

/// Rolling tail of a child process's stderr, fed by [`drain_child_stderr`].
pub type ChildStderrTail = Arc<std::sync::Mutex<std::collections::VecDeque<String>>>;

const CHILD_STDERR_TAIL_LINES: usize = 80;

/// Continuously drain a child's piped stderr on a background thread.
///
/// A piped stderr that nobody reads is a time bomb for long-running runtime
/// servers: once the child has logged ~64KB (uvicorn access lines, tqdm
/// download bars, framework warnings) the OS pipe buffer fills and the
/// child blocks on `write()`, freezing the server mid-operation. Lines are
/// forwarded to the app log at debug level and the most recent ones are kept
/// in the returned tail buffer for error reporting. The thread exits when the
/// child closes stderr (i.e. on child exit).
pub fn drain_child_stderr(label: &str, stderr: std::process::ChildStderr) -> ChildStderrTail {
    let tail: ChildStderrTail = Arc::default();
    let thread_tail = Arc::clone(&tail);
    let thread_label = label.to_string();
    let spawn_result = std::thread::Builder::new()
        .name(format!("stderr-drain-{label}"))
        .spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                log::debug!("{thread_label}: {}", line.trim_end());
                let mut tail = thread_tail.lock().unwrap_or_else(|e| e.into_inner());
                if tail.len() >= CHILD_STDERR_TAIL_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        });
    if let Err(err) = spawn_result {
        log::warn!("Failed to spawn stderr drain thread for {label}: {err}");
    }
    tail
}

/// Render the most recent stderr lines (up to `max_chars`, keeping the end,
/// where a crashing process puts the useful part of its traceback).
pub fn child_stderr_tail_snapshot(tail: &ChildStderrTail, max_chars: usize) -> String {
    let tail = tail.lock().unwrap_or_else(|e| e.into_inner());
    let joined = tail
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("\n");
    let char_count = joined.chars().count();
    if char_count <= max_chars {
        return joined;
    }
    joined.chars().skip(char_count - max_chars).collect()
}

/// Centralized cancellation function that can be called from anywhere in the app.
/// Handles cancelling both recording and transcription operations and updates UI state.
pub fn cancel_current_operation(app: &AppHandle) {
    info!("Initiating operation cancellation...");

    // Unregister the cancel shortcut asynchronously
    shortcut::unregister_cancel_shortcut(app);

    // Cancel any ongoing recording
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    let recording_was_active = audio_manager.is_recording();
    audio_manager.cancel_recording();

    if let Some(tts_manager) = app.try_state::<Arc<TtsManager>>() {
        tts_manager.stop();
    }

    // Update tray icon and hide overlay
    change_tray_icon(app, crate::tray::TrayIconState::Idle);
    hide_recording_overlay(app);

    // Unload model if immediate unload is enabled
    let tm = app.state::<Arc<TranscriptionManager>>();
    tm.cancel_active_processing();
    tm.maybe_unload_immediately("cancellation");

    // Notify coordinator so it can keep lifecycle state coherent.
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.notify_cancel(recording_was_active);
    }

    info!("Operation cancellation completed - returned to idle state");
}

#[cfg(all(test, unix))]
mod child_stderr_tests {
    use super::*;

    #[test]
    fn drain_child_stderr_prevents_pipe_backpressure_and_keeps_tail() {
        // Write ~300KB to stderr — far past the ~64KB pipe buffer that blocks
        // an undrained child — then a final marker line.
        let mut child = std::process::Command::new("/bin/sh")
            .args([
                "-c",
                "i=0; while [ $i -lt 3000 ]; do echo \"line-$i padding-padding-padding-padding-padding-padding-padding\" 1>&2; i=$((i+1)); done; echo last-line 1>&2",
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn test child");

        let tail = drain_child_stderr("test-child", child.stderr.take().expect("stderr piped"));

        // Without a drain the child blocks on write(2) long before finishing;
        // with the drain it must exit promptly.
        let start = std::time::Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait().expect("try_wait") {
                break status;
            }
            assert!(
                start.elapsed() < std::time::Duration::from_secs(10),
                "child did not finish; stderr pipe is not being drained"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        assert!(status.success());

        // The drain thread may still be consuming the final lines.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let snapshot = child_stderr_tail_snapshot(&tail, 10_000);
            if snapshot.contains("last-line") {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "tail missing final line: {snapshot}"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}

/// Check if using the Wayland display server protocol
#[cfg(target_os = "linux")]
pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
}

/// Check if running on KDE Plasma desktop environment
#[cfg(target_os = "linux")]
pub fn is_kde_plasma() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP")
        .map(|v| v.to_uppercase().contains("KDE"))
        .unwrap_or(false)
        || std::env::var("KDE_SESSION_VERSION").is_ok()
}

/// Check if running on KDE Plasma with Wayland
#[cfg(target_os = "linux")]
pub fn is_kde_wayland() -> bool {
    is_wayland() && is_kde_plasma()
}
