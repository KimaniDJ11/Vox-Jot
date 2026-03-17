use anyhow::Result;
use log::{debug, warn};

use super::field_monitor::FieldTextReader;

/// Windows field text reader using UI Automation.
pub struct WindowsFieldTextReader {
    /// HWND of the target window at span recording time.
    target_hwnd: Option<isize>,
}

impl WindowsFieldTextReader {
    pub fn new(target_hwnd: Option<isize>) -> Self {
        Self { target_hwnd }
    }
}

impl FieldTextReader for WindowsFieldTextReader {
    fn read_focused_field_text(&self) -> Result<Option<String>> {
        use uiautomation::UIAutomation;

        let automation = UIAutomation::new()
            .map_err(|e| anyhow::anyhow!("Failed to create UIAutomation: {:?}", e))?;

        let focused = match automation.get_focused_element() {
            Ok(el) => el,
            Err(e) => {
                warn!("Failed to get focused element via UIA: {:?}", e);
                return Ok(None);
            }
        };

        // Try ValuePattern first
        match focused.get_property_value(uiautomation::types::UIProperty::ValueValue) {
            Ok(val) => {
                let text = val.get_string().unwrap_or_default();
                if !text.is_empty() {
                    debug!(
                        "Read {} chars from focused field via UIA ValuePattern",
                        text.len()
                    );
                    return Ok(Some(text));
                }
            }
            Err(_) => {}
        }

        // Fallback: try to get the element name
        match focused.get_name() {
            Ok(name) if !name.is_empty() => {
                debug!("Read {} chars from element name via UIA", name.len());
                Ok(Some(name))
            }
            _ => {
                debug!("Could not read text from focused element via UIA");
                Ok(None)
            }
        }
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        if let Some(target_hwnd) = self.target_hwnd {
            // Check if the foreground window matches
            use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

            let current_hwnd = unsafe { GetForegroundWindow() };
            Ok(current_hwnd.0 as isize == target_hwnd)
        } else {
            Ok(true)
        }
    }
}
