use anyhow::Result;

use super::field_monitor::FieldTextReader;

/// macOS field text reader.
///
/// For now this is a conservative implementation that assumes the field stays
/// focused for the monitoring window and does not attempt to read the actual
/// field contents. This keeps the auto‑correction pipeline wired up
/// end‑to‑end while we iterate on a more robust Accessibility API
/// integration that works across macOS versions.
pub struct MacosFieldTextReader {
    /// PID of the target application at the time the span was recorded.
    #[allow(unused)]
    target_pid: Option<i32>,
}

impl MacosFieldTextReader {
    pub fn new(target_pid: Option<i32>) -> Self {
        Self { target_pid }
    }
}

impl FieldTextReader for MacosFieldTextReader {
    fn read_focused_field_text(&self) -> Result<Option<String>> {
        Ok(None)
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        Ok(true)
    }
}
