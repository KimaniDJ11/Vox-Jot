#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
extern "C" {
    fn active_browser_url_for_bundle_id(
        bundle_id: *const std::ffi::c_char,
    ) -> *mut std::ffi::c_char;
    fn free(ptr: *mut std::ffi::c_void);
}

pub fn active_browser_url(bundle_id: &str) -> Option<String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let cstr = std::ffi::CString::new(bundle_id).ok()?;
        let raw = unsafe { active_browser_url_for_bundle_id(cstr.as_ptr()) };
        if raw.is_null() {
            return None;
        }

        let url = unsafe { std::ffi::CStr::from_ptr(raw) }
            .to_string_lossy()
            .into_owned();
        unsafe { free(raw as *mut _) };

        let trimmed = url.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = bundle_id;
        None
    }
}
