use crate::post_processing::ActiveAppContext;
use crate::settings::{get_settings, AppSettings, ContextCaptureMode, OcrQualityMode};
use log::{debug, warn};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, VecDeque};
use std::ffi::{CStr, CString};
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use std::os::raw::{c_char, c_int};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
use crate::correction_tracker::field_monitor::FieldTextReader;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum ContextCaptureStatus {
    Ready,
    Pending,
    Stale,
    PermissionDenied,
    #[default]
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RankedContextSnippet {
    pub text: String,
    pub source: String,
    pub confidence: f32,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DictationContextPacket {
    pub display_id: u32,
    pub captured_at_ms: i64,
    pub snippets: Vec<RankedContextSnippet>,
    pub source: String,
    pub active_app_context: Option<ActiveAppContext>,
    pub ax_field_text: Option<String>,
    pub external_routing_allowed: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ContextImpactMetadata {
    pub dictionary_context_hits: Vec<String>,
    pub snippet_context_hits: Vec<String>,
    pub context_changed_output: bool,
    pub context_sent_externally: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ScreenContextDiagnostics {
    pub status: ContextCaptureStatus,
    pub has_screen_permission: bool,
    pub cache_size: usize,
    pub latest_capture_at_ms: Option<i64>,
    pub latest_context_age_ms: Option<u64>,
    pub latest_display_id: Option<u32>,
    pub latest_source: Option<String>,
    pub last_error: Option<String>,
}

impl Default for ScreenContextDiagnostics {
    fn default() -> Self {
        Self {
            status: ContextCaptureStatus::Failed,
            has_screen_permission: false,
            cache_size: 0,
            latest_capture_at_ms: None,
            latest_context_age_ms: None,
            latest_display_id: None,
            latest_source: None,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone)]
struct ManagerState {
    status: ContextCaptureStatus,
    has_permission: bool,
    last_error: Option<String>,
    cache: VecDeque<DictationContextPacket>,
    immediate_requested: bool,
    consecutive_failures: u32,
    next_capture_allowed_at_ms: i64,
}

impl Default for ManagerState {
    fn default() -> Self {
        Self {
            status: ContextCaptureStatus::Failed,
            has_permission: false,
            last_error: None,
            cache: VecDeque::new(),
            immediate_requested: false,
            consecutive_failures: 0,
            next_capture_allowed_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct NativeScreenContextPayload {
    display_id: u32,
    captured_at_ms: i64,
    snippets: Vec<NativeScreenContextSnippet>,
}

#[derive(Debug, Clone, Deserialize)]
struct NativeScreenContextSnippet {
    text: String,
    confidence: f32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

static EMAIL_REDACTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b").expect("valid email regex")
});
static URL_REDACTION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(?:https?://|www\.)\S+\b").expect("valid url regex"));
static LONG_NUMBER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b\d{6,}\b").expect("valid long number regex"));

#[derive(Clone)]
pub struct ContextCaptureManager {
    app_handle: AppHandle,
    state: Arc<Mutex<ManagerState>>,
}

impl ContextCaptureManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        let manager = Self {
            app_handle: app_handle.clone(),
            state: Arc::new(Mutex::new(ManagerState::default())),
        };
        manager.spawn_background_worker();
        manager
    }

    pub fn request_immediate_capture(&self, reason: &str) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.immediate_requested = true;
        if state.status != ContextCaptureStatus::PermissionDenied {
            state.status = ContextCaptureStatus::Pending;
        }
        debug!("Requested immediate screen context capture: {}", reason);
    }

    pub fn diagnostics(&self) -> ScreenContextDiagnostics {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let latest = state.cache.back();
        ScreenContextDiagnostics {
            status: state.status,
            has_screen_permission: state.has_permission,
            cache_size: state.cache.len(),
            latest_capture_at_ms: latest.map(|packet| packet.captured_at_ms),
            latest_context_age_ms: latest
                .map(|packet| now_millis().saturating_sub(packet.captured_at_ms).max(0) as u64),
            latest_display_id: latest.map(|packet| packet.display_id),
            latest_source: latest.map(|packet| packet.source.clone()),
            last_error: state.last_error.clone(),
        }
    }

    pub fn resolve_context_for_dictation(
        &self,
        settings: &AppSettings,
        active_app_context: Option<ActiveAppContext>,
    ) -> Option<DictationContextPacket> {
        let desired_app_context = active_app_context.or_else(current_frontmost_app_context);
        let current_field_text = read_ax_field_text(desired_app_context.as_ref());
        let now_ms = now_millis();
        let stale_threshold_ms = settings.screen_context_stale_threshold_ms as u64;
        let fresh_relevant_packet = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            select_best_cached_packet(
                &state.cache,
                desired_app_context.as_ref(),
                stale_threshold_ms,
                now_ms,
            )
        };

        if let Some(packet) = fresh_relevant_packet {
            if should_prefer_ax_only_context(&packet, current_field_text.as_deref()) {
                self.request_immediate_capture("dictation_stop_refresh");
                return build_ax_only_packet(
                    desired_app_context,
                    current_field_text,
                    now_ms,
                    !settings.local_privacy_mode,
                );
            }

            return Some(enrich_packet(
                packet,
                desired_app_context,
                current_field_text,
            ));
        }

        // Keep dictation stop fast: if our cache is stale or belongs to another
        // app, request a refresh in the background rather than blocking output.
        self.request_immediate_capture("dictation_stop_refresh");

        build_ax_only_packet(
            desired_app_context,
            current_field_text,
            now_ms,
            !settings.local_privacy_mode,
        )
    }

    pub fn context_sent_externally(
        &self,
        settings: &AppSettings,
        packet: Option<&DictationContextPacket>,
        provider_is_local: bool,
    ) -> bool {
        packet.is_some_and(|packet| packet.external_routing_allowed)
            && !settings.local_privacy_mode
            && !provider_is_local
    }

    fn spawn_background_worker(&self) {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            let manager = self.clone();
            thread::spawn(move || {
                let mut last_tick = Instant::now() - Duration::from_secs(60);
                let mut last_frontmost_app: Option<String> = None;

                loop {
                    let settings = get_settings(&manager.app_handle);
                    let interval = capture_interval(settings.context_capture_mode);
                    let frontmost_app = current_frontmost_bundle();
                    let now_ms = now_millis();

                    let should_capture = {
                        let mut state = manager.state.lock().unwrap_or_else(|e| e.into_inner());
                        let due = last_tick.elapsed() >= interval;
                        let app_changed = settings.context_capture_mode
                            == ContextCaptureMode::AdaptiveCache
                            && frontmost_app != last_frontmost_app;
                        let requested = state.immediate_requested;
                        let backoff_active = now_ms < state.next_capture_allowed_at_ms;
                        if backoff_active {
                            false
                        } else {
                            if requested {
                                state.immediate_requested = false;
                            }
                            requested || due || app_changed
                        }
                    };

                    if should_capture {
                        let reason = if last_tick.elapsed() >= interval {
                            "periodic"
                        } else if frontmost_app != last_frontmost_app {
                            "adaptive_app_change"
                        } else {
                            "immediate"
                        };
                        let _ = manager.capture_now(&settings, reason);
                        last_tick = Instant::now();
                        last_frontmost_app = frontmost_app;
                    }

                    thread::sleep(Duration::from_millis(250));
                }
            });
        }
    }

    fn capture_now(&self, settings: &AppSettings, source: &str) -> Option<DictationContextPacket> {
        {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.status = ContextCaptureStatus::Pending;
        }

        match native_capture_screen_context(
            settings.screen_context_ocr_quality,
            settings.screen_context_token_budget as usize,
            settings.screen_context_ocr_timeout_ms,
        ) {
            Ok(native_payload) => {
                let packet = rank_context_packet(native_payload, settings, source.to_string());
                let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                state.has_permission = true;
                state.last_error = None;
                state.status = ContextCaptureStatus::Ready;
                state.consecutive_failures = 0;
                state.next_capture_allowed_at_ms = 0;
                state.cache.push_back(packet.clone());
                while state.cache.len() > 3 {
                    state.cache.pop_front();
                }
                Some(packet)
            }
            Err(err) => {
                let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                state.has_permission = !err.contains("permission");
                state.last_error = Some(err.clone());
                state.status = if err.contains("permission") {
                    ContextCaptureStatus::PermissionDenied
                } else {
                    ContextCaptureStatus::Failed
                };
                state.consecutive_failures = state.consecutive_failures.saturating_add(1);
                state.next_capture_allowed_at_ms =
                    now_millis() + failure_backoff_ms(&err, state.consecutive_failures);
                warn!("Screen context capture failed: {}", err);
                None
            }
        }
    }
}

fn bundle_ids_match(left: Option<&ActiveAppContext>, right: Option<&ActiveAppContext>) -> bool {
    match (left, right) {
        (_, None) => true,
        (Some(left), Some(right)) => left.bundle_id.eq_ignore_ascii_case(&right.bundle_id),
        (None, Some(_)) => false,
    }
}

fn select_best_cached_packet(
    cache: &VecDeque<DictationContextPacket>,
    desired_app_context: Option<&ActiveAppContext>,
    stale_threshold_ms: u64,
    now_ms: i64,
) -> Option<DictationContextPacket> {
    cache
        .iter()
        .rev()
        .find(|packet| {
            packet_age_ms_at(packet, now_ms) <= stale_threshold_ms
                && bundle_ids_match(packet.active_app_context.as_ref(), desired_app_context)
        })
        .cloned()
}

fn build_ax_only_packet(
    active_app_context: Option<ActiveAppContext>,
    current_field_text: Option<String>,
    now_ms: i64,
    external_routing_allowed: bool,
) -> Option<DictationContextPacket> {
    let field_text = current_field_text
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())?;

    Some(DictationContextPacket {
        display_id: 0,
        captured_at_ms: now_ms,
        snippets: vec![RankedContextSnippet {
            text: field_text.clone(),
            source: "ax".to_string(),
            confidence: 1.0,
            score: 10_000.0,
        }],
        source: "ax_only".to_string(),
        active_app_context,
        ax_field_text: Some(field_text),
        external_routing_allowed,
    })
}

fn should_prefer_ax_only_context(
    packet: &DictationContextPacket,
    current_field_text: Option<&str>,
) -> bool {
    let Some(field_text) = current_field_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
    else {
        return false;
    };

    !packet_supports_field_text(packet, field_text)
}

fn packet_supports_field_text(packet: &DictationContextPacket, field_text: &str) -> bool {
    let normalized_field = normalize_context_text(field_text);
    if normalized_field.is_empty() {
        return false;
    }

    if packet
        .snippets
        .iter()
        .map(|snippet| normalize_context_text(&snippet.text))
        .any(|normalized| {
            !normalized.is_empty()
                && (normalized.contains(&normalized_field)
                    || normalized_field.contains(&normalized))
        })
    {
        return true;
    }

    let field_keywords = context_keywords(field_text);
    if field_keywords.is_empty() {
        return false;
    }

    let packet_keywords = packet
        .snippets
        .iter()
        .flat_map(|snippet| context_keywords(&snippet.text))
        .collect::<std::collections::HashSet<_>>();
    let overlap = field_keywords
        .iter()
        .filter(|keyword| packet_keywords.contains(*keyword))
        .count();
    let required_overlap = if field_keywords.len() <= 2 { 1 } else { 2 };

    overlap >= required_overlap
}

fn failure_backoff_ms(error: &str, consecutive_failures: u32) -> i64 {
    if error.contains("permission") {
        return 30_000;
    }

    let capped_failures = consecutive_failures.min(5);
    let base_ms = if error.contains("Active display was unavailable") {
        3_000
    } else {
        2_000
    };

    let multiplier = 1_i64 << capped_failures.saturating_sub(1);
    (base_ms * multiplier).min(20_000)
}

fn packet_age_ms_at(packet: &DictationContextPacket, now_ms: i64) -> u64 {
    now_ms.saturating_sub(packet.captured_at_ms).max(0) as u64
}

fn normalize_context_text(text: &str) -> String {
    text.chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn context_keywords(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric())
        .filter_map(|token| {
            let trimmed = token.trim();
            if trimmed.len() < 4 {
                return None;
            }
            Some(trimmed.to_ascii_lowercase())
        })
        .collect()
}

pub fn summarize_packet_for_prompt(
    packet: &DictationContextPacket,
    redact_for_external: bool,
) -> String {
    const MAX_PROMPT_SNIPPETS: usize = 2;
    const MAX_PROMPT_CHARS: usize = 800;

    let mut remaining_chars = MAX_PROMPT_CHARS;
    let mut summary = Vec::new();

    for snippet in packet.snippets.iter().take(MAX_PROMPT_SNIPPETS) {
        let text = if redact_for_external {
            redact_external_text(&snippet.text)
        } else {
            snippet.text.clone()
        };
        let trimmed = text.trim();
        if trimmed.is_empty() || remaining_chars == 0 {
            continue;
        }

        let snippet_chars = trimmed.chars().count();
        if snippet_chars <= remaining_chars {
            summary.push(trimmed.to_string());
            remaining_chars = remaining_chars.saturating_sub(snippet_chars);
            continue;
        }

        let truncated: String = trimmed.chars().take(remaining_chars).collect();
        if !truncated.trim().is_empty() {
            summary.push(format!("{}...", truncated.trim_end()));
        }
        break;
    }

    summary.join("\n")
}

pub fn packet_age_ms(packet: &DictationContextPacket) -> u64 {
    packet_age_ms_at(packet, now_millis())
}

fn enrich_packet(
    mut packet: DictationContextPacket,
    active_app_context: Option<ActiveAppContext>,
    current_field_text: Option<String>,
) -> DictationContextPacket {
    packet.active_app_context = active_app_context.or(packet.active_app_context.clone());
    packet.ax_field_text = current_field_text;

    if let Some(field_text) = packet.ax_field_text.clone() {
        let already_present = packet
            .snippets
            .iter()
            .any(|snippet| snippet.source == "ax" && snippet.text == field_text);
        if !already_present && !field_text.trim().is_empty() {
            packet.snippets.insert(
                0,
                RankedContextSnippet {
                    text: field_text,
                    source: "ax".to_string(),
                    confidence: 1.0,
                    score: 10_000.0,
                },
            );
        }
    }

    packet
}

fn rank_context_packet(
    payload: NativeScreenContextPayload,
    settings: &AppSettings,
    source: String,
) -> DictationContextPacket {
    let repeated_token_counts = repeated_token_counts(&payload.snippets);
    let mut snippets = payload
        .snippets
        .into_iter()
        .filter_map(|snippet| {
            let text = snippet.text.trim();
            if text.is_empty() {
                return None;
            }

            let repetition_bonus = repeated_bonus(text, &repeated_token_counts);
            let center_bonus = 1.0 - (((snippet.x + snippet.width / 2.0) - 0.5).abs() as f32);
            let top_bonus = (snippet.y + snippet.height / 2.0) as f32;
            let score = snippet.confidence * 100.0
                + repetition_bonus
                + center_bonus * 8.0
                + top_bonus * 5.0;

            Some(RankedContextSnippet {
                text: text.to_string(),
                source: "ocr".to_string(),
                confidence: snippet.confidence,
                score,
            })
        })
        .collect::<Vec<_>>();

    snippets.sort_by(|lhs, rhs| rhs.score.total_cmp(&lhs.score));
    snippets = dedupe_snippets(snippets);
    snippets = clip_snippets_to_budget(snippets, settings.screen_context_token_budget as usize);

    DictationContextPacket {
        display_id: payload.display_id,
        captured_at_ms: payload.captured_at_ms,
        snippets,
        source,
        active_app_context: current_frontmost_app_context(),
        ax_field_text: None,
        external_routing_allowed: !settings.local_privacy_mode,
    }
}

fn dedupe_snippets(snippets: Vec<RankedContextSnippet>) -> Vec<RankedContextSnippet> {
    let mut seen = std::collections::HashSet::new();
    snippets
        .into_iter()
        .filter(|snippet| seen.insert(snippet.text.to_ascii_lowercase()))
        .collect()
}

fn clip_snippets_to_budget(
    snippets: Vec<RankedContextSnippet>,
    token_budget: usize,
) -> Vec<RankedContextSnippet> {
    let mut remaining = token_budget.max(1);
    let mut clipped = Vec::new();

    for snippet in snippets {
        let words = snippet.text.split_whitespace().count();
        if words == 0 {
            continue;
        }
        if words <= remaining {
            remaining = remaining.saturating_sub(words);
            clipped.push(snippet);
            continue;
        }

        let truncated = snippet
            .text
            .split_whitespace()
            .take(remaining)
            .collect::<Vec<_>>()
            .join(" ");
        if !truncated.is_empty() {
            clipped.push(RankedContextSnippet {
                text: truncated,
                ..snippet
            });
        }
        break;
    }

    clipped
}

fn repeated_token_counts(snippets: &[NativeScreenContextSnippet]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for snippet in snippets {
        for token in snippet
            .text
            .split(|ch: char| !ch.is_alphanumeric())
            .filter(|token| token.len() >= 4)
        {
            *counts.entry(token.to_ascii_lowercase()).or_insert(0) += 1;
        }
    }
    counts
}

fn repeated_bonus(text: &str, counts: &HashMap<String, usize>) -> f32 {
    text.split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| token.len() >= 4)
        .map(|token| {
            counts
                .get(&token.to_ascii_lowercase())
                .copied()
                .unwrap_or(1)
        })
        .filter(|count| *count > 1)
        .map(|count| (count as f32) * 1.5)
        .sum()
}

fn redact_external_text(text: &str) -> String {
    let without_urls = URL_REDACTION_RE.replace_all(text, "[redacted-url]");
    let without_emails = EMAIL_REDACTION_RE.replace_all(&without_urls, "[redacted-email]");
    LONG_NUMBER_RE
        .replace_all(&without_emails, "[redacted-number]")
        .to_string()
}

fn capture_interval(mode: ContextCaptureMode) -> Duration {
    match mode {
        ContextCaptureMode::AlwaysFrequent => Duration::from_millis(1_500),
        ContextCaptureMode::AdaptiveCache => Duration::from_secs(4),
        ContextCaptureMode::MostlyOnDemand => Duration::from_secs(12),
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[repr(C)]
struct ScreenContextCaptureResponse {
    json_payload: *mut c_char,
    success: c_int,
    error_message: *mut c_char,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
extern "C" {
    fn check_screen_recording_permission_apple() -> c_int;
    fn capture_screen_context_apple(
        quality_mode: *const c_char,
        max_words: c_int,
        timeout_ms: c_int,
    ) -> *mut ScreenContextCaptureResponse;
    fn free_screen_context_capture_response(response: *mut ScreenContextCaptureResponse);
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn native_capture_screen_context(
    quality: OcrQualityMode,
    max_words: usize,
    timeout_ms: u32,
) -> Result<NativeScreenContextPayload, String> {
    unsafe {
        if check_screen_recording_permission_apple() != 1 {
            return Err("Screen Recording permission is not granted.".to_string());
        }
    }

    let quality_mode = match quality {
        OcrQualityMode::Fast => "fast",
        OcrQualityMode::Balanced => "balanced",
        OcrQualityMode::Accurate => "accurate",
    };
    let quality_cstr = CString::new(quality_mode).map_err(|err| err.to_string())?;

    let response_ptr = unsafe {
        capture_screen_context_apple(
            quality_cstr.as_ptr(),
            max_words.min(i32::MAX as usize) as c_int,
            timeout_ms.min(i32::MAX as u32) as c_int,
        )
    };

    if response_ptr.is_null() {
        return Err("Native screen context capture returned a null response.".to_string());
    }

    let response = unsafe { &*response_ptr };
    let result = if response.success == 1 {
        let payload = if response.json_payload.is_null() {
            String::from(r#"{"display_id":0,"captured_at_ms":0,"snippets":[]}"#)
        } else {
            unsafe { CStr::from_ptr(response.json_payload) }
                .to_string_lossy()
                .into_owned()
        };

        serde_json::from_str::<NativeScreenContextPayload>(&payload)
            .map_err(|err| format!("Failed to decode screen context payload: {}", err))
    } else {
        let message = if response.error_message.is_null() {
            "Unknown native screen context capture error.".to_string()
        } else {
            unsafe { CStr::from_ptr(response.error_message) }
                .to_string_lossy()
                .into_owned()
        };
        Err(message)
    };

    unsafe { free_screen_context_capture_response(response_ptr) };
    result
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn native_capture_screen_context(
    _quality: OcrQualityMode,
    _max_words: usize,
    _timeout_ms: u32,
) -> Result<NativeScreenContextPayload, String> {
    Err("Screen context capture is only available on Apple silicon Macs.".to_string())
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn current_frontmost_app_context() -> Option<ActiveAppContext> {
    crate::apple_intelligence::get_frontmost_app_context().ok()
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn current_frontmost_app_context() -> Option<ActiveAppContext> {
    None
}

fn current_frontmost_bundle() -> Option<String> {
    current_frontmost_app_context().map(|context| context.bundle_id)
}

#[cfg(target_os = "macos")]
fn read_ax_field_text(active_app_context: Option<&ActiveAppContext>) -> Option<String> {
    let reader = crate::correction_tracker::field_monitor_macos::MacosFieldTextReader::new(
        active_app_context.map(|context| context.bundle_id.clone()),
    );
    reader.read_focused_field_text().ok().flatten()
}

#[cfg(not(target_os = "macos"))]
fn read_ax_field_text(_active_app_context: Option<&ActiveAppContext>) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippet(text: &str, score: f32) -> RankedContextSnippet {
        RankedContextSnippet {
            text: text.to_string(),
            source: "ocr".to_string(),
            confidence: 0.9,
            score,
        }
    }

    fn app(bundle_id: &str) -> ActiveAppContext {
        ActiveAppContext {
            bundle_id: bundle_id.to_string(),
            localized_name: bundle_id.to_string(),
        }
    }

    fn packet_for_test(
        bundle_id: Option<&str>,
        captured_at_ms: i64,
        source: &str,
        snippets: Vec<RankedContextSnippet>,
    ) -> DictationContextPacket {
        DictationContextPacket {
            display_id: 1,
            captured_at_ms,
            snippets,
            source: source.to_string(),
            active_app_context: bundle_id.map(app),
            ax_field_text: None,
            external_routing_allowed: true,
        }
    }

    #[test]
    fn clip_snippets_to_budget_truncates_last_snippet() {
        let clipped = clip_snippets_to_budget(
            vec![
                snippet("alpha beta", 10.0),
                snippet("gamma delta epsilon", 9.0),
            ],
            4,
        );

        assert_eq!(clipped.len(), 2);
        assert_eq!(clipped[0].text, "alpha beta");
        assert_eq!(clipped[1].text, "gamma delta");
    }

    #[test]
    fn repeated_bonus_prefers_repeated_entities() {
        let counts = repeated_token_counts(&[
            NativeScreenContextSnippet {
                text: "Project Atlas roadmap".to_string(),
                x: 0.5,
                y: 0.5,
                width: 0.2,
                height: 0.1,
                confidence: 0.8,
            },
            NativeScreenContextSnippet {
                text: "Atlas launch notes".to_string(),
                x: 0.4,
                y: 0.4,
                width: 0.2,
                height: 0.1,
                confidence: 0.8,
            },
        ]);

        assert!(repeated_bonus("Atlas", &counts) > 0.0);
        assert_eq!(repeated_bonus("unique", &counts), 0.0);
    }

    #[test]
    fn summarize_packet_for_prompt_redacts_sensitive_patterns() {
        let packet = DictationContextPacket {
            display_id: 1,
            captured_at_ms: 1,
            snippets: vec![snippet(
                "Email me at jane@example.com about https://example.com ref 123456789",
                10.0,
            )],
            source: "periodic".to_string(),
            active_app_context: None,
            ax_field_text: None,
            external_routing_allowed: true,
        };

        let summary = summarize_packet_for_prompt(&packet, true);

        assert!(summary.contains("[redacted-email]"));
        assert!(summary.contains("[redacted-url]"));
        assert!(summary.contains("[redacted-number]"));
    }

    #[test]
    fn summarize_packet_for_prompt_limits_snippet_count() {
        let packet = DictationContextPacket {
            display_id: 1,
            captured_at_ms: 1,
            snippets: vec![
                snippet("first snippet", 10.0),
                snippet("second snippet", 9.0),
                snippet("third snippet", 8.0),
            ],
            source: "periodic".to_string(),
            active_app_context: None,
            ax_field_text: None,
            external_routing_allowed: true,
        };

        let summary = summarize_packet_for_prompt(&packet, false);

        assert!(summary.contains("first snippet"));
        assert!(summary.contains("second snippet"));
        assert!(!summary.contains("third snippet"));
    }

    #[test]
    fn select_best_cached_packet_prefers_matching_app_context() {
        let now_ms = 5_000;
        let desired = app("com.apple.Notes");
        let cache = VecDeque::from(vec![
            packet_for_test(
                Some("com.openai.codex"),
                4_900,
                "periodic",
                vec![snippet("codex audit text", 10.0)],
            ),
            packet_for_test(
                Some("com.apple.Notes"),
                4_800,
                "periodic",
                vec![snippet("notes context", 9.0)],
            ),
        ]);

        let selected = select_best_cached_packet(&cache, Some(&desired), 1_000, now_ms)
            .expect("expected a matching packet");

        assert_eq!(
            selected
                .active_app_context
                .as_ref()
                .map(|context| context.bundle_id.as_str()),
            Some("com.apple.Notes")
        );
        assert_eq!(selected.snippets[0].text, "notes context");
    }

    #[test]
    fn select_best_cached_packet_rejects_stale_matching_context() {
        let now_ms = 10_000;
        let desired = app("com.apple.Notes");
        let cache = VecDeque::from(vec![packet_for_test(
            Some("com.apple.Notes"),
            6_500,
            "periodic",
            vec![snippet("old notes context", 9.0)],
        )]);

        assert!(select_best_cached_packet(&cache, Some(&desired), 2_000, now_ms).is_none());
    }

    #[test]
    fn build_ax_only_packet_uses_focused_field_text() {
        let desired = app("com.apple.Notes");
        let packet = build_ax_only_packet(
            Some(desired.clone()),
            Some("Focused field text".to_string()),
            1_234,
            true,
        )
        .expect("expected ax-only fallback packet");

        assert_eq!(packet.source, "ax_only");
        assert_eq!(packet.captured_at_ms, 1_234);
        assert_eq!(packet.ax_field_text.as_deref(), Some("Focused field text"));
        assert_eq!(packet.snippets[0].source, "ax");
        assert_eq!(packet.snippets[0].text, "Focused field text");
        assert_eq!(
            packet
                .active_app_context
                .as_ref()
                .map(|context| context.bundle_id.as_str()),
            Some(desired.bundle_id.as_str())
        );
    }

    #[test]
    fn failure_backoff_grows_for_repeated_timeouts() {
        let first = failure_backoff_ms("Timed out while capturing screen context.", 1);
        let third = failure_backoff_ms("Timed out while capturing screen context.", 3);
        let sixth = failure_backoff_ms("Timed out while capturing screen context.", 6);

        assert!(third > first);
        assert!(sixth >= third);
        assert!(sixth <= 20_000);
    }

    #[test]
    fn should_prefer_ax_only_context_for_unrelated_ocr_packet() {
        let packet = packet_for_test(
            Some("com.apple.Notes"),
            4_900,
            "periodic",
            vec![snippet("Nobody is Using Mega Glimmora Like This", 10.0)],
        );

        assert!(should_prefer_ax_only_context(&packet, Some("Very nice.")));
    }

    #[test]
    fn keeps_ocr_packet_when_it_supports_current_field_text() {
        let packet = packet_for_test(
            Some("com.apple.Notes"),
            4_900,
            "periodic",
            vec![snippet("Very nice. Draft reply", 10.0)],
        );

        assert!(!should_prefer_ax_only_context(&packet, Some("Very nice.")));
    }
}
