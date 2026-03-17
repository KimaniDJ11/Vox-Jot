use anyhow::Result;
use log::{debug, warn};

use super::field_monitor::FieldTextReader;

/// macOS field text reader using the Accessibility API (AXUIElement).
pub struct MacosFieldTextReader {
    /// PID of the target application at the time the span was recorded.
    target_pid: Option<i32>,
}

impl MacosFieldTextReader {
    pub fn new(target_pid: Option<i32>) -> Self {
        Self { target_pid }
    }
}

impl FieldTextReader for MacosFieldTextReader {
    fn read_focused_field_text(&self) -> Result<Option<String>> {
        // Use the accessibility crate to read AXValue from the focused text field.
        // AXUIElement::system_wide() -> copy_focused_element() -> read AXValue attribute.
        use accessibility::AXUIElement;

        let system = AXUIElement::system_wide();
        let focused = match system.focused_uielement() {
            Ok(el) => el,
            Err(e) => {
                warn!("Failed to get focused UI element: {:?}", e);
                return Ok(None);
            }
        };

        // Read AXRole first as a workaround for lazy initialization
        let _ = focused.role();

        match focused.value() {
            Ok(val) => {
                let text = format!("{}", val);
                debug!("Read {} chars from focused field via AX API", text.len());
                Ok(Some(text))
            }
            Err(e) => {
                debug!("Could not read AXValue from focused element: {:?}", e);
                Ok(None)
            }
        }
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        // Check if the frontmost app's PID still matches the target PID
        if let Some(target_pid) = self.target_pid {
            use accessibility::AXUIElement;

            let system = AXUIElement::system_wide();
            match system.focused_uielement() {
                Ok(focused) => {
                    // Try to get the PID of the focused element's application
                    match focused.pid() {
                        Ok(pid) => Ok(pid == target_pid),
                        Err(_) => Ok(false),
                    }
                }
                Err(_) => Ok(false),
            }
        } else {
            // No target PID — assume still focused
            Ok(true)
        }
    }
}
