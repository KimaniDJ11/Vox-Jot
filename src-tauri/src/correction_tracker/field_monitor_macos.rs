use anyhow::{anyhow, Result};
use log::{debug, warn};
use std::sync::Mutex;

use super::field_monitor::FieldTextReader;

/// Identity captured from the destination application and text field.
///
/// Accessibility objects are Core Foundation objects that are not safe to move
/// between the blocking worker threads used by the monitor. Store their stable
/// process/hash identity instead of retaining the object itself.
#[derive(Debug, Default)]
struct TargetFieldIdentity {
    app_pid: Option<i32>,
    field_hash: Option<usize>,
}

impl TargetFieldIdentity {
    fn capture_or_matches(&mut self, app_pid: i32, field_hash: usize) -> bool {
        if self.app_pid.is_some_and(|expected| expected != app_pid)
            || self
                .field_hash
                .is_some_and(|expected| expected != field_hash)
        {
            return false;
        }

        self.app_pid.get_or_insert(app_pid);
        self.field_hash.get_or_insert(field_hash);
        true
    }

    #[cfg(test)]
    fn captured(&self) -> Option<(i32, usize)> {
        Some((self.app_pid?, self.field_hash?))
    }
}

/// macOS field text reader using the native Accessibility APIs.
///
/// The reader resolves the application recorded when dictation was pasted,
/// asks that application's AX element for its focused field, and then locks
/// monitoring to the exact field. This avoids relying solely on the
/// system-wide AX focused-application lookup, which can report
/// `kAXErrorNoValue` in otherwise readable applications.
pub struct MacosFieldTextReader {
    /// Bundle identifier of the target application at the time the span was recorded.
    target_app_identifier: Option<String>,
    /// Destination application and exact text-field identity captured on the first read.
    target_identity: Mutex<TargetFieldIdentity>,
}

impl MacosFieldTextReader {
    pub fn new(target_app_identifier: Option<String>) -> Self {
        Self {
            target_app_identifier,
            target_identity: Mutex::new(TargetFieldIdentity::default()),
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

            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);

            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _)
        }
    }

    fn resolve_target_pid(&self) -> Result<Option<i32>> {
        if let Some(pid) = self
            .target_identity
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .app_pid
        {
            return Ok(Some(pid));
        }

        let pid = match self.target_app_identifier.as_deref() {
            Some(bundle_id) if !bundle_id.trim().is_empty() => {
                application_pid_for_bundle(bundle_id)?
            }
            _ => frontmost_application_pid(),
        };

        if let Some(pid) = pid {
            let mut identity = self
                .target_identity
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            identity.app_pid.get_or_insert(pid);
        }

        Ok(pid)
    }

    fn capture_or_match_field(
        &self,
        app_pid: i32,
        focused_element: accessibility_sys::AXUIElementRef,
    ) -> bool {
        let field_hash = field_element_hash(focused_element);
        self.target_identity
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .capture_or_matches(app_pid, field_hash)
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

fn set_messaging_timeout(element: &core_foundation::base::CFType) {
    use core_foundation::base::TCFType;

    unsafe {
        accessibility_sys::AXUIElementSetMessagingTimeout(
            element.as_CFTypeRef() as accessibility_sys::AXUIElementRef,
            0.25,
        );
    }
}

fn system_wide_element() -> Option<core_foundation::base::CFType> {
    use accessibility_sys::AXUIElementCreateSystemWide;
    use core_foundation::base::{CFType, TCFType};

    let element = unsafe { AXUIElementCreateSystemWide() };
    if element.is_null() {
        return None;
    }

    let element = unsafe { CFType::wrap_under_create_rule(element as _) };
    set_messaging_timeout(&element);
    Some(element)
}

fn application_element(app_pid: i32) -> Option<core_foundation::base::CFType> {
    use accessibility_sys::AXUIElementCreateApplication;
    use core_foundation::base::{CFType, TCFType};

    let element = unsafe { AXUIElementCreateApplication(app_pid) };
    if element.is_null() {
        return None;
    }

    let element = unsafe { CFType::wrap_under_create_rule(element as _) };
    set_messaging_timeout(&element);
    Some(element)
}

fn application_pid_for_bundle(bundle_id: &str) -> Result<Option<i32>> {
    use accessibility_sys::{AXUIElementGetPid, AXUIElementRef};
    use core_foundation::base::TCFType;

    let app = match accessibility::AXUIElement::application_with_bundle(bundle_id) {
        Ok(app) => app,
        Err(error) => {
            debug!(
                "Could not resolve target application bundle '{}': {:?}",
                bundle_id, error
            );
            return Ok(None);
        }
    };

    let mut pid = 0;
    let err = unsafe { AXUIElementGetPid(app.as_CFTypeRef() as AXUIElementRef, &mut pid) };
    if err == 0 && pid > 0 {
        Ok(Some(pid))
    } else {
        Err(anyhow!(
            "AXUIElementGetPid failed for target bundle '{}' (AXError={})",
            bundle_id,
            err
        ))
    }
}

fn frontmost_application_pid() -> Option<i32> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    // SAFETY: NSWorkspace and NSRunningApplication are process-global Cocoa
    // objects. We only read the frontmost application's process identifier.
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let pid = if workspace.is_null() {
            None
        } else {
            let app: *mut Object = msg_send![workspace, frontmostApplication];
            if app.is_null() {
                None
            } else {
                let pid: i32 = msg_send![app, processIdentifier];
                (pid > 0).then_some(pid)
            }
        };
        let _: () = msg_send![pool, drain];
        pid
    }
}

fn focused_element_for_pid(app_pid: i32) -> Result<Option<core_foundation::base::CFType>> {
    use accessibility_sys::{kAXFocusedUIElementAttribute, AXUIElementGetPid, AXUIElementRef};
    use core_foundation::base::TCFType;

    let Some(app_element) = application_element(app_pid) else {
        return Ok(None);
    };
    let app_ref = app_element.as_CFTypeRef() as AXUIElementRef;
    let (direct_err, direct_element) = copy_attribute(app_ref, kAXFocusedUIElementAttribute);

    let focused_element = if direct_element.is_some() {
        direct_element
    } else {
        debug!(
            "Target app focused element unavailable (AXError={}); trying system-wide fallback",
            direct_err
        );
        let Some(system_element) = system_wide_element() else {
            return Ok(None);
        };
        copy_attribute(
            system_element.as_CFTypeRef() as AXUIElementRef,
            kAXFocusedUIElementAttribute,
        )
        .1
    };

    let Some(focused_element) = focused_element else {
        return Ok(None);
    };

    let mut focused_pid = 0;
    let err = unsafe {
        AXUIElementGetPid(
            focused_element.as_CFTypeRef() as AXUIElementRef,
            &mut focused_pid,
        )
    };
    if err != 0 {
        return Err(anyhow!(
            "AXUIElementGetPid failed for focused field (AXError={})",
            err
        ));
    }
    if focused_pid != app_pid {
        debug!(
            "Rejected focused element from pid {}; expected destination pid {}",
            focused_pid, app_pid
        );
        return Ok(None);
    }

    Ok(Some(focused_element))
}

fn field_element_hash(element: accessibility_sys::AXUIElementRef) -> usize {
    use core_foundation::base::CFHash;

    unsafe { CFHash(element as _) }
}

impl FieldTextReader for MacosFieldTextReader {
    fn read_focused_field_text(&self) -> Result<Option<String>> {
        if !Self::ensure_accessibility_trusted() {
            warn!("Accessibility permissions not yet granted; unable to read focused field text");
            return Ok(None);
        }

        use accessibility_sys::{
            kAXSelectedTextAttribute, kAXTitleAttribute, kAXValueAttribute, AXUIElementRef,
        };
        use core_foundation::base::TCFType;

        let Some(target_pid) = self.resolve_target_pid()? else {
            debug!(
                "Could not resolve destination app pid for bundle {:?}",
                self.target_app_identifier
            );
            return Ok(None);
        };

        if frontmost_application_pid() != Some(target_pid) {
            debug!(
                "Destination app pid {} is no longer frontmost; skipping field read",
                target_pid
            );
            return Ok(None);
        }

        let Some(focused_element) = focused_element_for_pid(target_pid)? else {
            debug!(
                "No readable focused UI element for destination pid {}",
                target_pid
            );
            return Ok(None);
        };
        let focused_ref = focused_element.as_CFTypeRef() as AXUIElementRef;

        if !self.capture_or_match_field(target_pid, focused_ref) {
            debug!("Focused text field changed during correction monitoring");
            return Ok(None);
        }

        let (value_err, value_opt) = string_attribute(focused_ref, kAXValueAttribute);
        if let Some(value) = value_opt {
            if !value.is_empty() {
                debug!("Read {} chars from AXValue", value.len());
                return Ok(Some(value));
            }
        } else {
            debug!("AXValue unavailable or non-string (AXError={})", value_err);
        }

        let (selected_err, selected_opt) = string_attribute(focused_ref, kAXSelectedTextAttribute);
        if let Some(value) = selected_opt {
            if !value.is_empty() {
                debug!("Read {} chars from AXSelectedText", value.len());
                return Ok(Some(value));
            }
        } else {
            debug!(
                "AXSelectedText unavailable or non-string (AXError={})",
                selected_err
            );
        }

        let (title_err, title_opt) = string_attribute(focused_ref, kAXTitleAttribute);
        if let Some(value) = title_opt {
            if !value.is_empty() {
                debug!("Read {} chars from AXTitle", value.len());
                return Ok(Some(value));
            }
        } else {
            debug!("AXTitle unavailable or non-string (AXError={})", title_err);
        }

        debug!("Could not read text from destination field via AX APIs");
        Ok(None)
    }

    fn is_same_field_focused(&self) -> Result<bool> {
        let Some(target_pid) = self.resolve_target_pid()? else {
            debug!("Destination application identity was never captured; stopping monitor");
            return Ok(false);
        };

        if frontmost_application_pid() != Some(target_pid) {
            return Ok(false);
        }

        let target_field_hash = self
            .target_identity
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .field_hash;
        let Some(target_field_hash) = target_field_hash else {
            // The destination app is still frontmost, but its field was not
            // readable yet. Keep polling so a field that is still settling
            // after paste gets another chance to expose AXValue.
            return Ok(true);
        };

        let Some(focused_element) = focused_element_for_pid(target_pid)? else {
            return Ok(false);
        };
        use core_foundation::base::TCFType;
        let focused_ref = focused_element.as_CFTypeRef() as accessibility_sys::AXUIElementRef;

        Ok(field_element_hash(focused_ref) == target_field_hash)
    }
}

#[cfg(test)]
mod tests {
    use super::TargetFieldIdentity;

    #[test]
    fn target_field_identity_captures_once_and_matches_exact_field() {
        let mut identity = TargetFieldIdentity::default();

        assert!(identity.capture_or_matches(42, 1001));
        assert!(identity.capture_or_matches(42, 1001));
        assert_eq!(identity.captured(), Some((42, 1001)));
    }

    #[test]
    fn target_field_identity_rejects_other_app_or_field() {
        let mut identity = TargetFieldIdentity::default();
        assert!(identity.capture_or_matches(42, 1001));

        assert!(!identity.capture_or_matches(43, 1001));
        assert!(!identity.capture_or_matches(42, 1002));
        assert_eq!(identity.captured(), Some((42, 1001)));
    }
}
