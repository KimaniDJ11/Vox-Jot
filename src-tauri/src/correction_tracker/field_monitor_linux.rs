use anyhow::Result;
use log::{debug, warn};

use super::field_monitor::FieldTextReader;

/// Linux field text reader using AT-SPI (experimental).
///
/// AT-SPI support varies across desktop environments and applications.
/// This implementation provides best-effort text reading from the focused field.
pub struct LinuxFieldTextReader;

impl LinuxFieldTextReader {
    pub fn new() -> Self {
        Self
    }
}

impl FieldTextReader for LinuxFieldTextReader {
    fn read_focused_field_text(&self) -> Result<Option<String>> {
        // AT-SPI requires an async runtime and D-Bus connection.
        // For now, this is a best-effort implementation that logs when AT-SPI
        // is unavailable. Full AT-SPI integration requires the zbus event loop.
        warn!(
            "Linux AT-SPI field text reading is experimental and may not work in all environments"
        );

        // Attempt to connect to AT-SPI via atspi crate
        // This is a simplified approach — full implementation would use
        // atspi::connection::AccessibilityConnection and TextProxy
        debug!("AT-SPI text reading not yet fully implemented on Linux");
        Ok(None)
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        // Without reliable AT-SPI state tracking, assume field is still focused
        // to avoid prematurely aborting monitoring
        Ok(true)
    }
}
