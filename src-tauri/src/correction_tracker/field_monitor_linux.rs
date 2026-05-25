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
        warn!(
            "Linux AT-SPI field text reading is blocked until the D-Bus text reader is implemented"
        );
        debug!("AT-SPI text reading returned no field text on Linux");
        Ok(None)
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        // Without reliable AT-SPI state tracking, assume field is still focused
        // to avoid prematurely aborting monitoring
        Ok(true)
    }
}
