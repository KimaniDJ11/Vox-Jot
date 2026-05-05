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
    /// Process id of the focused application at the time monitoring started.
    target_app_pid: Option<i32>,
}

impl MacosFieldTextReader {
    pub fn new(target_app_identifier: Option<String>) -> Self {
        Self {
            target_app_identifier,
            target_app_pid: current_focused_app_pid()
                .inspect_err(|err| debug!("Could not capture focused app pid: {}", err))
                .ok()
                .flatten(),
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

fn copy_attribute(
    element: accessibility_sys::AXUIElementRef,
    attr: &str,
) -> (i32, Option<core_foundation::base::CFType>) {
    use accessibility_sys::AXUIElementCopyAttributeValue;
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::string::CFString;

    let cf_attr = CFString::new(attr);
    let mut out: CFTypeRef = std::ptr::null_mut();
    let err =
        unsafe { AXUIElementCopyAttributeValue(element, cf_attr.as_concrete_TypeRef(), &mut out) };

    if err == 0 && !out.is_null() {
        (err, Some(unsafe { CFType::wrap_under_create_rule(out) }))
    } else {
        (err, None)
    }
}

fn copied_string_value(value: core_foundation::base::CFType) -> Option<String> {
    use core_foundation::base::CFType;
    use core_foundation::string::CFString;

    CFType::downcast_into::<CFString>(value).map(|value| value.to_string())
}

fn string_attribute(
    element: accessibility_sys::AXUIElementRef,
    attr: &str,
) -> (i32, Option<String>) {
    let (err, value) = copy_attribute(element, attr);
    let string = value.and_then(copied_string_value);
    (err, string)
}

fn system_wide_element() -> Option<core_foundation::base::CFType> {
    use accessibility_sys::AXUIElementCreateSystemWide;
    use core_foundation::base::{CFType, TCFType};

    let element = unsafe { AXUIElementCreateSystemWide() };
    if element.is_null() {
        return None;
    }

    let element = unsafe { CFType::wrap_under_create_rule(element as _) };
    unsafe {
        accessibility_sys::AXUIElementSetMessagingTimeout(
            element.as_CFTypeRef() as accessibility_sys::AXUIElementRef,
            0.25,
        );
    }
    Some(element)
}

fn current_focused_app_pid() -> Result<Option<i32>> {
    use accessibility_sys::{kAXFocusedApplicationAttribute, AXUIElementGetPid, AXUIElementRef};
    use anyhow::anyhow;
    use core_foundation::base::TCFType;

    let Some(system_element) = system_wide_element() else {
        return Ok(None);
    };
    let system_ref = system_element.as_CFTypeRef() as AXUIElementRef;
    let (err, app) = copy_attribute(system_ref, kAXFocusedApplicationAttribute);
    let Some(app) = app else {
        return if err == 0 {
            Ok(None)
        } else {
            Err(anyhow!(
                "AXFocusedApplication unavailable (AXError={})",
                err
            ))
        };
    };

    let mut pid = 0;
    let err = unsafe { AXUIElementGetPid(app.as_CFTypeRef() as AXUIElementRef, &mut pid) };
    if err == 0 {
        Ok(Some(pid))
    } else {
        Err(anyhow!("AXUIElementGetPid failed (AXError={})", err))
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
            kAXValueAttribute, AXUIElementRef,
        };
        use core_foundation::base::TCFType;

        let Some(system_element) = system_wide_element() else {
            warn!("AXUIElementCreateSystemWide returned null");
            return Ok(None);
        };

        // Get the currently focused UI element
        let (focused_err, focused_opt) = copy_attribute(
            system_element.as_CFTypeRef() as AXUIElementRef,
            kAXFocusedUIElementAttribute,
        );
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
        let focused_ref = focused_ref.as_CFTypeRef() as AXUIElementRef;

        // Try AXValue first - most editable text fields/text views expose this.
        let (value_err, value_opt) = string_attribute(focused_ref, kAXValueAttribute);
        if let Some(s) = value_opt {
            if !s.is_empty() {
                debug!("Read {} chars from AXValue", s.len());
                return Ok(Some(s));
            }
        } else {
            debug!("AXValue unavailable or non-string (AXError={})", value_err);
        }

        // Fallback: selected text
        let (sel_err, sel_opt) = string_attribute(focused_ref, kAXSelectedTextAttribute);
        if let Some(s) = sel_opt {
            if !s.is_empty() {
                debug!("Read {} chars from AXSelectedText", s.len());
                return Ok(Some(s));
            }
        } else {
            debug!(
                "AXSelectedText unavailable or non-string (AXError={})",
                sel_err
            );
        }

        // Fallback: title (useful for simpler fields/labels)
        let (title_err, title_opt) = string_attribute(focused_ref, kAXTitleAttribute);
        if let Some(s) = title_opt {
            if !s.is_empty() {
                debug!("Read {} chars from AXTitle", s.len());
                return Ok(Some(s));
            }
        } else {
            debug!("AXTitle unavailable or non-string (AXError={})", title_err);
        }

        debug!("Could not read text from focused element via AX APIs");
        Ok(None)
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        if self.target_app_identifier.is_none() {
            return Ok(true);
        }

        let Some(target_app_pid) = self.target_app_pid else {
            debug!("No target app pid captured; skipping focused app comparison");
            return Ok(true);
        };

        match current_focused_app_pid() {
            Ok(Some(current_pid)) => Ok(current_pid == target_app_pid),
            Ok(None) => Ok(false),
            Err(err) => {
                warn!(
                    "Could not compare focused app during field monitoring: {}",
                    err
                );
                Ok(false)
            }
        }
    }
}
