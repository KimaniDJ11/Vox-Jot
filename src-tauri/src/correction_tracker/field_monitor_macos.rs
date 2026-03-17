use anyhow::Result;
use log::{debug, warn};
use std::process::Command;

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

    /// Check if Accessibility permissions are granted.
    /// On macOS, we need to check if the current process has permission to use Accessibility APIs.
    fn check_accessibility_permissions() -> bool {
        // Use AXIsProcessTrusted to check permissions
        // This is a macOS Accessibility API function
        unsafe {
            use core_foundation::base::TCFType;
            use core_foundation::boolean::CFBoolean;
            use core_foundation::string::CFString;
            use core_foundation::dictionary::CFDictionary;
            use core_graphics::access::AXIsProcessTrustedWithOptions;
            
            let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
            
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
        }
    }
}

impl FieldTextReader for MacosFieldTextReader {
    fn read_focused_field_text(&self) -> Result<Option<String>> {
        // First check if we have Accessibility permissions
        if !Self::check_accessibility_permissions() {
            warn!("Accessibility permissions not granted. Please grant permissions in System Settings > Privacy & Security > Accessibility");
            return Ok(None);
        }

        use accessibility::AXUIElement;

        let system = AXUIElement::system_wide();
        let focused = match system.focused_uielement() {
            Ok(el) => el,
            Err(e) => {
                debug!("Failed to get focused UI element: {:?}", e);
                return Ok(None);
            }
        };

        // Try to read text from various attributes that might contain text content
        // Different UI elements expose text through different attributes
        
        // First try AXValue (works for text fields, text areas)
        if let Ok(value) = focused.value() {
            if let Ok(text) = value.downcast::<String>() {
                debug!("Read {} chars from focused field via AXValue", text.len());
                return Ok(Some(text));
            }
        }

        // Try AXSelectedText (works for text views, rich text editors)
        if let Ok(selected_text) = focused.attribute("AXSelectedText") {
            if let Ok(text) = selected_text.downcast::<String>() {
                if !text.is_empty() {
                    debug!("Read {} chars from AXSelectedText", text.len());
                    return Ok(Some(text));
                }
            }
        }

        // Try AXTitle (for buttons, menus, etc.)
        if let Ok(title) = focused.attribute("AXTitle") {
            if let Ok(text) = title.downcast::<String>() {
                if !text.is_empty() {
                    debug!("Read {} chars from AXTitle", text.len());
                    return Ok(Some(text));
                }
            }
        }

        // If we couldn't read any text, try to get the entire text content
        // This works for text fields and text areas
        if let Ok(role) = focused.role() {
            debug!("Focused element role: {:?}", role);
            
            // For text fields and text areas, try getting all attributes
            if role.contains("Text") || role.contains("Area") {
                // Try reading via AXValue again with string conversion
                if let Ok(attrs) = focused.attribute_names() {
                    debug!("Available attributes: {:?}", attrs);
                    
                    // Try each text-related attribute
                    for attr in &["AXValue", "AXSelectedText", "AXTextArea", "AXTextField"] {
                        if let Ok(val) = focused.attribute(attr) {
                            // Try to convert to string
                            if let Ok(text) = format!("{:?}", val).parse::<String>() {
                                if !text.is_empty() && text != "<null>" {
                                    debug!("Read {} chars from {} attribute", text.len(), attr);
                                    return Ok(Some(text));
                                }
                            }
                        }
                    }
                }
            }
        }

        debug!("Could not read text from focused element");
        Ok(None)
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
