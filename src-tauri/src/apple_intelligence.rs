#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use std::ffi::{CStr, CString};
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use std::os::raw::{c_char, c_int};

use crate::helpers::subtitles::TimedSegment;
use crate::post_processing::ActiveAppContext;

// Define the response structure from Swift
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[repr(C)]
pub struct AppleLLMResponse {
    pub response: *mut c_char,
    pub success: c_int,
    pub error_message: *mut c_char,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[repr(C)]
pub struct FrontmostAppResponse {
    pub bundle_id: *mut c_char,
    pub localized_name: *mut c_char,
    pub success: c_int,
    pub error_message: *mut c_char,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[repr(C)]
pub struct AppleSpeechTranscriptionResponse {
    pub json_payload: *mut c_char,
    pub success: c_int,
    pub error_message: *mut c_char,
}

#[derive(Debug, serde::Deserialize)]
pub struct AppleSpeechTranscriptionPayload {
    pub text: String,
    #[serde(default)]
    pub segments: Vec<TimedSegment>,
}

// Link to the Swift functions
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
extern "C" {
    pub fn is_apple_intelligence_available() -> c_int;
    pub fn free_apple_llm_response(response: *mut AppleLLMResponse);
    pub fn get_frontmost_app_context_apple() -> *mut FrontmostAppResponse;
    pub fn free_frontmost_app_response(response: *mut FrontmostAppResponse);
    pub fn is_apple_speech_analyzer_available() -> c_int;
    pub fn is_apple_speech_locale_installed(locale_identifier: *const c_char) -> c_int;
    pub fn transcribe_with_apple_speech(
        samples: *const f32,
        sample_count: c_int,
        sample_rate: c_int,
        locale_identifier: *const c_char,
        progressive: c_int,
    ) -> *mut AppleSpeechTranscriptionResponse;
    pub fn free_apple_speech_transcription_response(
        response: *mut AppleSpeechTranscriptionResponse,
    );
}

// Safe wrapper functions
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub fn check_apple_intelligence_availability() -> bool {
    unsafe { is_apple_intelligence_available() == 1 }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub fn check_apple_intelligence_availability() -> bool {
    false
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub fn check_apple_speech_analyzer_availability() -> bool {
    unsafe { is_apple_speech_analyzer_available() == 1 }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub fn check_apple_speech_analyzer_availability() -> bool {
    false
}

/// Returns true if Apple's on-device speech model for `locale` is
/// already installed. The Swift bridge wraps `AssetInventory` which
/// is the only authoritative source — `SpeechTranscriber.isAvailable`
/// is a global flag and lies for uninstalled locales (the cause of
/// the EXC_BREAKPOINT crash we hit in production).
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub fn is_apple_speech_locale_ready(locale_identifier: Option<&str>) -> bool {
    let cstr = match CString::new(locale_identifier.unwrap_or("")) {
        Ok(s) => s,
        Err(_) => return false,
    };
    unsafe { is_apple_speech_locale_installed(cstr.as_ptr()) == 1 }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub fn is_apple_speech_locale_ready(_locale_identifier: Option<&str>) -> bool {
    false
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub fn transcribe_with_apple_speech_analyzer(
    audio: &[f32],
    sample_rate: u32,
    locale_identifier: Option<&str>,
    progressive: bool,
) -> Result<AppleSpeechTranscriptionPayload, String> {
    if audio.is_empty() {
        return Err("Apple SpeechAnalyzer received empty audio.".to_string());
    }
    let locale = CString::new(locale_identifier.unwrap_or(""))
        .map_err(|err| format!("Invalid Apple Speech locale: {err}"))?;

    // The Swift bridge will lazily install the language pack on the
    // first call, which can take a long time on a slow connection.
    // Log it so the user / debug logs make the wait visible instead of
    // the call appearing to hang.
    if !is_apple_speech_locale_ready(locale_identifier) {
        log::info!(
            "Apple Speech model for locale {:?} is not installed; the first transcription will download it (cap: 5 minutes).",
            locale_identifier.unwrap_or("(default)")
        );
    }

    let response_ptr = unsafe {
        transcribe_with_apple_speech(
            audio.as_ptr(),
            audio.len().min(c_int::MAX as usize) as c_int,
            sample_rate.min(c_int::MAX as u32) as c_int,
            locale.as_ptr(),
            if progressive { 1 } else { 0 },
        )
    };

    if response_ptr.is_null() {
        return Err("Null response from Apple SpeechAnalyzer".to_string());
    }

    let response = unsafe { &*response_ptr };
    let result = if response.success == 1 {
        if response.json_payload.is_null() {
            Err("Apple SpeechAnalyzer returned an empty payload.".to_string())
        } else {
            let json = unsafe { CStr::from_ptr(response.json_payload) }
                .to_string_lossy()
                .into_owned();
            serde_json::from_str::<AppleSpeechTranscriptionPayload>(&json)
                .map_err(|err| format!("Failed to parse Apple Speech payload: {err}"))
        }
    } else {
        let error_msg = if !response.error_message.is_null() {
            unsafe { CStr::from_ptr(response.error_message) }
                .to_string_lossy()
                .into_owned()
        } else {
            "Unknown Apple SpeechAnalyzer error".to_string()
        };
        Err(error_msg)
    };

    unsafe { free_apple_speech_transcription_response(response_ptr) };

    result
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub fn transcribe_with_apple_speech_analyzer(
    _audio: &[f32],
    _sample_rate: u32,
    _locale_identifier: Option<&str>,
    _progressive: bool,
) -> Result<AppleSpeechTranscriptionPayload, String> {
    Err("Apple SpeechAnalyzer is only available on supported Apple Silicon Macs.".to_string())
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub fn get_frontmost_app_context() -> Result<ActiveAppContext, String> {
    let response_ptr = unsafe { get_frontmost_app_context_apple() };

    if response_ptr.is_null() {
        return Err("Null response while looking up frontmost app".to_string());
    }

    let response = unsafe { &*response_ptr };

    let result = if response.success == 1 {
        let bundle_id = if response.bundle_id.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(response.bundle_id) }
                .to_string_lossy()
                .into_owned()
        };
        let localized_name = if response.localized_name.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(response.localized_name) }
                .to_string_lossy()
                .into_owned()
        };

        if bundle_id.trim().is_empty() {
            Err("Frontmost app lookup returned an empty bundle identifier".to_string())
        } else {
            Ok(ActiveAppContext {
                bundle_id,
                localized_name,
            })
        }
    } else {
        let error_msg = if !response.error_message.is_null() {
            unsafe { CStr::from_ptr(response.error_message) }
                .to_string_lossy()
                .into_owned()
        } else {
            "Unknown frontmost app lookup error".to_string()
        };
        Err(error_msg)
    };

    unsafe { free_frontmost_app_response(response_ptr) };

    result
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub fn get_frontmost_app_context() -> Result<ActiveAppContext, String> {
    Err("Frontmost app lookup through Apple APIs is only available on macOS.".to_string())
}

// Link to the Swift function for system prompt support
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
extern "C" {
    pub fn process_text_with_system_prompt_apple(
        system_prompt: *const c_char,
        user_content: *const c_char,
        max_tokens: i32,
    ) -> *mut AppleLLMResponse;
}

/// Process text with Apple Intelligence using separate system prompt and user content
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub fn process_text_with_system_prompt(
    system_prompt: &str,
    user_content: &str,
    max_tokens: i32,
) -> Result<String, String> {
    let system_cstr = CString::new(system_prompt).map_err(|e| e.to_string())?;
    let user_cstr = CString::new(user_content).map_err(|e| e.to_string())?;

    let response_ptr = unsafe {
        process_text_with_system_prompt_apple(system_cstr.as_ptr(), user_cstr.as_ptr(), max_tokens)
    };

    if response_ptr.is_null() {
        return Err("Null response from Apple LLM".to_string());
    }

    let response = unsafe { &*response_ptr };

    let result = if response.success == 1 {
        if response.response.is_null() {
            Ok(String::new())
        } else {
            let c_str = unsafe { CStr::from_ptr(response.response) };
            let rust_str = c_str.to_string_lossy().into_owned();
            Ok(rust_str)
        }
    } else {
        let error_c_str = if !response.error_message.is_null() {
            unsafe { CStr::from_ptr(response.error_message) }
        } else {
            CStr::from_bytes_with_nul(b"Unknown error\0").unwrap()
        };
        let error_msg = error_c_str.to_string_lossy().into_owned();
        Err(error_msg)
    };

    // Clean up the response
    unsafe { free_apple_llm_response(response_ptr) };

    result
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub fn process_text_with_system_prompt(
    _system_prompt: &str,
    _user_content: &str,
    _max_tokens: i32,
) -> Result<String, String> {
    Err("Apple Intelligence is only available on supported Apple Silicon Macs.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_availability() {
        let available = check_apple_intelligence_availability();
        println!("Apple Intelligence available: {}", available);
    }

    #[test]
    fn frontmost_app_lookup_returns_a_result() {
        let lookup = get_frontmost_app_context();
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        assert!(lookup.is_err());
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert!(lookup.is_ok() || lookup.is_err());
    }
}
