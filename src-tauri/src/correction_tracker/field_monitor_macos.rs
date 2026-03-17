use anyhow::Result;
use log::{debug, warn};

use super::field_monitor::FieldTextReader;

/// macOS field text reader using the native Accessibility APIs.
///
/// This implementation:
/// - asks macOS to report the currently focused UI element
/// - reads its `AXValue` string when available (text fields / text areas)
/// - falls back to `AXSelectedText` or `AXTitle` when appropriate
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
        use accessibility_sys::{
            kAXFocusedUIElementAttribute, kAXSelectedTextAttribute, kAXTitleAttribute,
            kAXValueAttribute, AXUIElementCopyAttributeValue, AXUIElementCreateSystemWide,
            AXUIElementRef,
        };
        use core_foundation::base::{CFTypeRef, TCFType};
        use core_foundation::string::CFString;

        unsafe {
            let system_element: AXUIElementRef = AXUIElementCreateSystemWide();
            if system_element.is_null() {
                warn!("AXUIElementCreateSystemWide returned null");
                return Ok(None);
            }

            // Helper to copy an attribute value from an AXUIElementRef
            unsafe fn copy_attribute(
                element: AXUIElementRef,
                attr: &str,
            ) -> Option<CFTypeRef> {
                let cf_attr = CFString::new(attr);
                let mut out: CFTypeRef = std::ptr::null_mut();
                let err = AXUIElementCopyAttributeValue(
                    element,
                    cf_attr.as_concrete_TypeRef(),
                    &mut out,
                );
                if err == 0 && !out.is_null() {
                    Some(out)
                } else {
                    None
                }
            }

            // Get the currently focused UI element
            let focused_ref = match copy_attribute(system_element, kAXFocusedUIElementAttribute) {
                Some(v) => v,
                None => {
                    debug!("No focused UI element from accessibility");
                    return Ok(None);
                }
            };

            // Try AXValue first – most editable text fields/text views expose this
            if let Some(val_ref) = copy_attribute(focused_ref as AXUIElementRef, kAXValueAttribute)
            {
                let s = CFString::wrap_under_get_rule(val_ref as _).to_string();
                if !s.is_empty() {
                    if !s.is_empty() {
                        debug!("Read {} chars from AXValue", s.len());
                        return Ok(Some(s));
                    }
                }
            }

            // Fallback: selected text
            if let Some(sel_ref) =
                copy_attribute(focused_ref as AXUIElementRef, kAXSelectedTextAttribute)
            {
                let s = CFString::wrap_under_get_rule(sel_ref as _).to_string();
                if !s.is_empty() {
                    if !s.is_empty() {
                        debug!("Read {} chars from AXSelectedText", s.len());
                        return Ok(Some(s));
                    }
                }
            }

            // Fallback: title (useful for simpler fields/labels)
            if let Some(title_ref) =
                copy_attribute(focused_ref as AXUIElementRef, kAXTitleAttribute)
            {
                let s = CFString::wrap_under_get_rule(title_ref as _).to_string();
                if !s.is_empty() {
                    if !s.is_empty() {
                        debug!("Read {} chars from AXTitle", s.len());
                        return Ok(Some(s));
                    }
                }
            }

            debug!("Could not read text from focused element via AX APIs");
            Ok(None)
        }
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        // For now, only check that some field is focused; PID‑level scoping can
        // be refined later if needed.
        if self.target_pid.is_none() {
            return Ok(true);
        }

        use accessibility_sys::{
            kAXFocusedUIElementAttribute, AXUIElementCopyAttributeValue,
            AXUIElementCreateSystemWide, AXUIElementRef,
        };
        use core_foundation::base::{CFTypeRef, TCFType};
        use core_foundation::string::CFString;

        unsafe {
            let system_element: AXUIElementRef = AXUIElementCreateSystemWide();
            if system_element.is_null() {
                return Ok(false);
            }

            let attr = CFString::new(kAXFocusedUIElementAttribute);
            let mut focused: CFTypeRef = std::ptr::null_mut();
            let err = AXUIElementCopyAttributeValue(
                system_element,
                attr.as_concrete_TypeRef(),
                &mut focused,
            );
            if err != 0 || focused.is_null() {
                return Ok(false);
            }

            Ok(true)
        }
    }
}
