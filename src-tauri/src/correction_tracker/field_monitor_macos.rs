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
    /// Bundle identifier of the target application at the time the span was recorded.
    target_app_identifier: Option<String>,
}

impl MacosFieldTextReader {
    pub fn new(target_app_identifier: Option<String>) -> Self {
        Self {
            target_app_identifier,
        }
    }

    /// Ensure the process is trusted for Accessibility, requesting permission if needed.
    fn ensure_accessibility_trusted() -> bool {
        use accessibility_sys::kAXTrustedCheckOptionPrompt;
        use core_foundation::base::TCFType;
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;

        // SAFETY: We are calling a well-known macOS API. The CFDictionary we
        // build lives for the duration of the call.
        unsafe {
            #[allow(improper_ctypes)]
            extern "C" {
                fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
            }

            // Wrap the kAXTrustedCheckOptionPrompt constant and build { prompt: true }
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);

            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _)
        }
    }
}

impl FieldTextReader for MacosFieldTextReader {
    fn read_focused_field_text(&self) -> Result<Option<String>> {
        // Trigger the Accessibility permission prompt on first use if needed.
        if !Self::ensure_accessibility_trusted() {
            warn!("Accessibility permissions not yet granted; unable to read focused field text");
            return Ok(None);
        }

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
            ) -> (i32, Option<CFTypeRef>) {
                let cf_attr = CFString::new(attr);
                let mut out: CFTypeRef = std::ptr::null_mut();
                let err =
                    AXUIElementCopyAttributeValue(element, cf_attr.as_concrete_TypeRef(), &mut out);
                if err == 0 && !out.is_null() {
                    (err, Some(out))
                } else {
                    (err, None)
                }
            }

            // Get the currently focused UI element
            let (focused_err, focused_opt) =
                copy_attribute(system_element, kAXFocusedUIElementAttribute);
            let focused_ref = match focused_opt {
                Some(v) => v,
                None => {
                    warn!(
                        "No focused UI element from accessibility (AXError={})",
                        focused_err
                    );
                    return Ok(None);
                }
            };

            // Try AXValue first – most editable text fields/text views expose this
            let (value_err, value_opt) =
                copy_attribute(focused_ref as AXUIElementRef, kAXValueAttribute);
            if let Some(val_ref) = value_opt {
                let s = CFString::wrap_under_get_rule(val_ref as _).to_string();
                if !s.is_empty() {
                    debug!("Read {} chars from AXValue", s.len());
                    return Ok(Some(s));
                }
            } else {
                debug!("AXValue unavailable (AXError={})", value_err);
            }

            // Fallback: selected text
            let (sel_err, sel_opt) =
                copy_attribute(focused_ref as AXUIElementRef, kAXSelectedTextAttribute);
            if let Some(sel_ref) = sel_opt {
                let s = CFString::wrap_under_get_rule(sel_ref as _).to_string();
                if !s.is_empty() {
                    debug!("Read {} chars from AXSelectedText", s.len());
                    return Ok(Some(s));
                }
            } else {
                debug!("AXSelectedText unavailable (AXError={})", sel_err);
            }

            // Fallback: title (useful for simpler fields/labels)
            let (title_err, title_opt) =
                copy_attribute(focused_ref as AXUIElementRef, kAXTitleAttribute);
            if let Some(title_ref) = title_opt {
                let s = CFString::wrap_under_get_rule(title_ref as _).to_string();
                if !s.is_empty() {
                    debug!("Read {} chars from AXTitle", s.len());
                    return Ok(Some(s));
                }
            } else {
                debug!("AXTitle unavailable (AXError={})", title_err);
            }

            debug!("Could not read text from focused element via AX APIs");
            Ok(None)
        }
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        let Some(target_app_identifier) = self.target_app_identifier.as_ref() else {
            return Ok(true);
        };

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            match crate::apple_intelligence::get_frontmost_app_context() {
                Ok(context) => Ok(context.bundle_id == *target_app_identifier),
                Err(err) => {
                    warn!(
                        "Could not compare frontmost app during field monitoring: {}",
                        err
                    );
                    Ok(false)
                }
            }
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            let _ = target_app_identifier;
            Ok(true)
        }
    }
}
