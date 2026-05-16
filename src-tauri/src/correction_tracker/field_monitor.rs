use anyhow::Result;
use log::{debug, error, info, warn};
use std::sync::Arc;
use std::time::Duration;

use super::app_classifier::{AppFieldBehavior, ClearEventKind, MonitoringParams};
use super::diff::extract_corrections;
use super::recent_input::{RecentInputSignals, RecentInputTracker};
use super::span::InsertedSpan;
use super::store::CorrectionStore;
use tauri::AppHandle;

/// Trait for platform-specific text field reading.
pub trait FieldTextReader: Send + Sync {
    /// Read the current text from the focused text field.
    fn read_focused_field_text(&self) -> Result<Option<String>>;

    /// Check if the same text field is still focused.
    fn is_same_field_focused(&self) -> Result<bool>;
}

/// Monitor a text field for corrections after text was inserted.
///
/// This function uses **snapshot-based tracking** to handle both persistent
/// (notes/editors) and ephemeral (chat/search) text fields:
///
/// 1. Polls at an interval determined by the app classification
/// 2. Keeps track of the **last non-empty snapshot** at each poll
/// 3. When the field clears, classifies the event as instant-clear (sent)
///    vs gradual-clear (user deleting) based on intermediate snapshots
/// 4. Diffs against the last meaningful snapshot, not the final (possibly empty) read
pub async fn monitor_for_corrections(
    reader: Arc<dyn FieldTextReader>,
    span: InsertedSpan,
    store: Arc<CorrectionStore>,
    app_behavior: AppFieldBehavior,
    recent_input: Arc<RecentInputTracker>,
    app_handle: AppHandle,
) {
    let params = app_behavior.monitoring_params();

    info!(
        "Starting correction monitoring for span '{}' (app: {:?}, behavior: {:?}, fast poll: {}ms, steady poll: {}ms, window: {}s)",
        span.id,
        span.app_identifier,
        app_behavior,
        params.fast_poll_interval_ms,
        params.steady_poll_interval_ms,
        params.window_secs
    );

    monitor_for_corrections_with_params(
        reader,
        span,
        store,
        app_behavior,
        params,
        recent_input,
        Some(app_handle),
    )
    .await;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClearHandling {
    UseLastSnapshot,
    Discard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SnapshotOutcome {
    Continue,
    StopAndUseLastSnapshot,
    StopAndDiscard,
}

#[derive(Debug, Default)]
struct ObservationState {
    last_non_empty_snapshot: Option<String>,
    previous_snapshot_len: Option<usize>,
    previous_normalized_snapshot: Option<String>,
    edited_snapshot_count: u32,
    repeated_edited_snapshot_count: u32,
    saw_shrink_before_clear: bool,
    field_cleared: bool,
}

async fn monitor_for_corrections_with_params(
    reader: Arc<dyn FieldTextReader>,
    span: InsertedSpan,
    store: Arc<CorrectionStore>,
    app_behavior: AppFieldBehavior,
    params: MonitoringParams,
    recent_input: Arc<RecentInputTracker>,
    app_handle: Option<AppHandle>,
) {
    let total_delay = Duration::from_secs(params.window_secs as u64);
    let mut elapsed = Duration::ZERO;
    let monitoring_started_at = std::time::Instant::now();
    let signal_window_started_at = monitoring_started_at
        .checked_sub(Duration::from_millis(500))
        .unwrap_or(monitoring_started_at);
    let inserted_trimmed = span.inserted_text.trim();

    let mut state = ObservationState::default();

    match capture_snapshot(
        reader.clone(),
        &span,
        app_behavior,
        inserted_trimmed,
        &mut state,
        recent_input.as_ref(),
        signal_window_started_at,
    )
    .await
    {
        SnapshotOutcome::Continue => {}
        SnapshotOutcome::StopAndUseLastSnapshot => state.field_cleared = true,
        SnapshotOutcome::StopAndDiscard => return,
    }

    while elapsed < total_delay && !state.field_cleared {
        let poll_interval = next_poll_interval(elapsed, params);
        let step = poll_interval.min(total_delay - elapsed);
        tokio::time::sleep(step).await;
        elapsed += step;

        match tokio::task::spawn_blocking({
            let reader = reader.clone();
            move || reader.is_same_field_focused()
        })
        .await
        {
            Ok(Ok(true)) => {
                // Field still focused, continue monitoring
            }
            Ok(Ok(false)) => {
                info!("User switched away from field during monitoring, using last snapshot");
                break;
            }
            Ok(Err(e)) => {
                warn!("Error checking field focus: {}", e);
                break;
            }
            Err(e) => {
                error!("Task join error checking field focus: {}", e);
                break;
            }
        }

        match capture_snapshot(
            reader.clone(),
            &span,
            app_behavior,
            inserted_trimmed,
            &mut state,
            recent_input.as_ref(),
            signal_window_started_at,
        )
        .await
        {
            SnapshotOutcome::Continue => {}
            SnapshotOutcome::StopAndUseLastSnapshot => {
                state.field_cleared = true;
                break;
            }
            SnapshotOutcome::StopAndDiscard => return,
        }
    }

    let diff_text = if state.field_cleared {
        match state.last_non_empty_snapshot {
            Some(text) => text,
            None => {
                debug!("Field cleared but no non-empty snapshot was captured");
                return;
            }
        }
    } else {
        // Monitoring window ended or focus changed — do a final read
        match tokio::task::spawn_blocking({
            let reader = reader.clone();
            move || reader.read_focused_field_text()
        })
        .await
        {
            Ok(Ok(Some(text))) if !text.trim().is_empty() => text,
            Ok(Ok(Some(_))) => match state.last_non_empty_snapshot {
                Some(text) => text,
                None => {
                    debug!("Final read and all snapshots were empty");
                    return;
                }
            },
            _ => match state.last_non_empty_snapshot {
                Some(text) => {
                    debug!("Final read failed, using last non-empty snapshot");
                    text
                }
                None => {
                    info!("Could not read field text after monitoring period");
                    return;
                }
            },
        }
    };

    // Extract corrections by diffing
    let corrections = extract_corrections(
        &span.inserted_text,
        &diff_text,
        span.app_identifier.as_deref(),
    );

    if corrections.is_empty() {
        debug!(
            "No corrections detected for span '{}' after monitoring",
            span.id
        );
        return;
    }

    info!(
        "Detected {} correction(s) for span '{}'",
        corrections.len(),
        span.id
    );

    let mut approved_pairs = Vec::new();
    for pair in &corrections {
        match store.add_observed_user_correction(pair) {
            Ok(Some(confidence)) => approved_pairs.push((pair, confidence)),
            Ok(None) => {
                debug!(
                    "Ignored observed edit '{}' → '{}' because it is not a plausible correction",
                    pair.original, pair.corrected
                );
            }
            Err(e) => {
                error!(
                    "Failed to store correction '{}' → '{}': {}",
                    pair.original, pair.corrected, e
                );
            }
        }
    }

    if let (Some((first_pair, confidence)), Some(app_handle)) =
        (approved_pairs.first(), app_handle.as_ref())
    {
        crate::overlay::show_correction_overlay(
            app_handle,
            &first_pair.original,
            &first_pair.corrected,
            *confidence,
            approved_pairs.len().saturating_sub(1),
        );
    }
}

fn next_poll_interval(elapsed: Duration, params: MonitoringParams) -> Duration {
    let elapsed_ms = elapsed.as_millis() as u64;
    let poll_ms = if elapsed_ms < params.fast_phase_ms {
        params.fast_poll_interval_ms
    } else {
        params.steady_poll_interval_ms
    };

    Duration::from_millis(poll_ms)
}

async fn capture_snapshot(
    reader: Arc<dyn FieldTextReader>,
    span: &InsertedSpan,
    app_behavior: AppFieldBehavior,
    inserted_trimmed: &str,
    state: &mut ObservationState,
    recent_input: &RecentInputTracker,
    monitoring_started_at: std::time::Instant,
) -> SnapshotOutcome {
    let current_text = match tokio::task::spawn_blocking({
        let reader = reader.clone();
        move || reader.read_focused_field_text()
    })
    .await
    {
        Ok(Ok(Some(text))) => text,
        Ok(Ok(None)) => return SnapshotOutcome::Continue,
        Ok(Err(e)) => {
            warn!("Error reading field text: {}", e);
            return SnapshotOutcome::Continue;
        }
        Err(e) => {
            error!("Task join error reading field text: {}", e);
            return SnapshotOutcome::StopAndDiscard;
        }
    };

    let normalized = current_text.trim().to_string();
    let current_len = normalized.len();

    if current_len == 0 {
        let clear_kind = if state.saw_shrink_before_clear {
            ClearEventKind::GradualClear
        } else {
            ClearEventKind::InstantClear
        };
        let recent_input_signals = recent_input.signals_since(monitoring_started_at);

        match classify_clear_handling(app_behavior, clear_kind, state, recent_input_signals) {
            ClearHandling::UseLastSnapshot => {
                info!(
                    "Interpreting empty field as submit for span '{}' using last non-empty snapshot",
                    span.id
                );
                SnapshotOutcome::StopAndUseLastSnapshot
            }
            ClearHandling::Discard => {
                info!(
                    "Discarding empty-field correction candidate for span '{}' (clear_kind: {:?}, app_behavior: {:?})",
                    span.id, clear_kind, app_behavior
                );
                SnapshotOutcome::StopAndDiscard
            }
        }
    } else {
        if let Some(prev_len) = state.previous_snapshot_len {
            if current_len < prev_len {
                state.saw_shrink_before_clear = true;
            }
        }

        if normalized != inserted_trimmed {
            state.edited_snapshot_count += 1;
            if state.previous_normalized_snapshot.as_deref() == Some(normalized.as_str()) {
                state.repeated_edited_snapshot_count += 1;
            }
        }

        state.last_non_empty_snapshot = Some(current_text);
        state.previous_snapshot_len = Some(current_len);
        state.previous_normalized_snapshot = Some(normalized);
        SnapshotOutcome::Continue
    }
}

fn classify_clear_handling(
    app_behavior: AppFieldBehavior,
    clear_kind: ClearEventKind,
    state: &ObservationState,
    recent_input_signals: RecentInputSignals,
) -> ClearHandling {
    if state.edited_snapshot_count == 0 {
        return ClearHandling::Discard;
    }

    if recent_input_signals.destructive_after_submit {
        return ClearHandling::Discard;
    }

    match clear_kind {
        ClearEventKind::GradualClear => ClearHandling::Discard,
        ClearEventKind::InstantClear => match app_behavior {
            AppFieldBehavior::Ephemeral => {
                if recent_input_signals.saw_destructive_edit && !recent_input_signals.saw_submit {
                    ClearHandling::Discard
                } else {
                    ClearHandling::UseLastSnapshot
                }
            }
            AppFieldBehavior::Unknown => {
                if recent_input_signals.saw_submit || state.repeated_edited_snapshot_count > 0 {
                    ClearHandling::UseLastSnapshot
                } else {
                    ClearHandling::Discard
                }
            }
            AppFieldBehavior::Persistent => ClearHandling::Discard,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Mutex;
    use tempfile::TempDir;

    use super::super::span::{InsertedSpan, InsertionMethod};
    use super::super::store::CorrectionStore;

    /// Mock field reader for testing.
    struct MockFieldReader {
        text: Mutex<Option<String>>,
        focused: AtomicBool,
    }

    impl MockFieldReader {
        fn new(text: &str, focused: bool) -> Self {
            Self {
                text: Mutex::new(Some(text.to_string())),
                focused: AtomicBool::new(focused),
            }
        }

        fn new_with_none(focused: bool) -> Self {
            Self {
                text: Mutex::new(None),
                focused: AtomicBool::new(focused),
            }
        }
    }

    impl FieldTextReader for MockFieldReader {
        fn read_focused_field_text(&self) -> Result<Option<String>> {
            Ok(self.text.lock().unwrap_or_else(|e| e.into_inner()).clone())
        }

        fn is_same_field_focused(&self) -> Result<bool> {
            Ok(self.focused.load(Ordering::Relaxed))
        }
    }

    /// Mock reader that returns an error on read.
    struct ErrorFieldReader;

    impl FieldTextReader for ErrorFieldReader {
        fn read_focused_field_text(&self) -> Result<Option<String>> {
            Err(anyhow::anyhow!("Simulated accessibility read error"))
        }

        fn is_same_field_focused(&self) -> Result<bool> {
            Ok(true)
        }
    }

    /// Mock reader that simulates a chat app: returns edited text, then empty after N reads.
    struct ChatAppMockReader {
        read_count: AtomicUsize,
        clears_after: usize,
        edited_text: String,
    }

    impl ChatAppMockReader {
        fn new(edited_text: &str, clears_after: usize) -> Self {
            Self {
                read_count: AtomicUsize::new(0),
                clears_after,
                edited_text: edited_text.to_string(),
            }
        }
    }

    impl FieldTextReader for ChatAppMockReader {
        fn read_focused_field_text(&self) -> Result<Option<String>> {
            let count = self.read_count.fetch_add(1, Ordering::Relaxed);
            if count < self.clears_after {
                Ok(Some(self.edited_text.clone()))
            } else {
                Ok(Some(String::new())) // Field cleared (message sent)
            }
        }

        fn is_same_field_focused(&self) -> Result<bool> {
            Ok(true)
        }
    }

    /// Mock reader that simulates gradual deletion: text shrinks over multiple reads.
    struct GradualDeleteMockReader {
        read_count: AtomicUsize,
        snapshots: Vec<String>,
    }

    impl GradualDeleteMockReader {
        fn new(snapshots: Vec<String>) -> Self {
            Self {
                read_count: AtomicUsize::new(0),
                snapshots,
            }
        }
    }

    impl FieldTextReader for GradualDeleteMockReader {
        fn read_focused_field_text(&self) -> Result<Option<String>> {
            let count = self.read_count.fetch_add(1, Ordering::Relaxed);
            let idx = count.min(self.snapshots.len() - 1);
            Ok(Some(self.snapshots[idx].clone()))
        }

        fn is_same_field_focused(&self) -> Result<bool> {
            Ok(true)
        }
    }

    fn setup_store() -> (Arc<CorrectionStore>, TempDir) {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(CorrectionStore::new(dir.path()).unwrap());
        (store, dir)
    }

    fn make_span(text: &str) -> InsertedSpan {
        InsertedSpan::new(
            text.to_string(),
            Some("com.test.app".to_string()),
            Some("TestApp".to_string()),
            InsertionMethod::Clipboard,
        )
    }

    fn tiny_params() -> MonitoringParams {
        MonitoringParams {
            fast_poll_interval_ms: 1,
            steady_poll_interval_ms: 2,
            fast_phase_ms: 5,
            window_secs: 1,
        }
    }

    fn test_recent_input() -> Arc<RecentInputTracker> {
        Arc::new(RecentInputTracker::new())
    }

    #[tokio::test]
    async fn test_monitor_detects_correction_with_mock_reader() {
        let (store, _dir) = setup_store();

        let span = make_span("teh quick brwn fox");
        let reader: Arc<dyn FieldTextReader> =
            Arc::new(MockFieldReader::new("the quick brown fox", true));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(
            !all.is_empty(),
            "Expected corrections to be stored after user edits"
        );

        let originals: Vec<&str> = all.iter().map(|c| c.original.as_str()).collect();
        let correcteds: Vec<&str> = all.iter().map(|c| c.corrected.as_str()).collect();
        assert!(originals.contains(&"teh"));
        assert!(correcteds.contains(&"the"));
        assert!(originals.contains(&"brwn"));
        assert!(correcteds.contains(&"brown"));
        assert!(
            all.iter().all(|correction| correction.user_approved),
            "Observed destination-field edits should be promoted to approved corrections"
        );
    }

    #[tokio::test]
    async fn test_monitor_no_corrections_when_text_unchanged() {
        let (store, _dir) = setup_store();

        let text = "the quick brown fox";
        let span = make_span(text);
        let reader: Arc<dyn FieldTextReader> = Arc::new(MockFieldReader::new(text, true));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn test_monitor_stops_when_focus_lost() {
        let (store, _dir) = setup_store();

        let span = make_span("teh world");
        let reader: Arc<dyn FieldTextReader> = Arc::new(MockFieldReader::new("the world", false));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(
            !all.is_empty(),
            "Expected corrections to be stored even when focus is lost"
        );
        assert_eq!(all[0].original, "teh");
        assert_eq!(all[0].corrected, "the");
    }

    #[tokio::test]
    async fn test_monitor_handles_reader_error_gracefully() {
        let (store, _dir) = setup_store();

        let span = make_span("some text");
        let reader: Arc<dyn FieldTextReader> = Arc::new(ErrorFieldReader);

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn test_monitor_with_dictionary_applied_text() {
        let (store, _dir) = setup_store();

        let text = "SwiftUI is a framework for building user interfaces";
        let span = make_span(text);
        let reader: Arc<dyn FieldTextReader> = Arc::new(MockFieldReader::new(text, true));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Persistent,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn test_monitor_handles_none_text_gracefully() {
        let (store, _dir) = setup_store();

        let span = make_span("some text");
        let reader: Arc<dyn FieldTextReader> = Arc::new(MockFieldReader::new_with_none(true));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn test_chat_app_instant_clear_captures_corrections() {
        let (store, _dir) = setup_store();

        // Simulates: user edits "VoxChart" → "Vox Jot", then sends (field clears)
        let span = make_span("When VoxChart is checking");
        let reader: Arc<dyn FieldTextReader> = Arc::new(ChatAppMockReader::new(
            "When Vox Jot is checking",
            3, // Returns edited text 3 times, then empty
        ));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Ephemeral,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(
            !all.is_empty(),
            "Expected corrections from chat app even after field cleared"
        );
        assert_eq!(all[0].original, "VoxChart");
        assert_eq!(all[0].corrected, "Vox Jot");
    }

    #[tokio::test]
    async fn test_gradual_delete_discards_corrections() {
        let (store, _dir) = setup_store();

        // Simulates user manually deleting text character by character
        let span = make_span("hello world");
        let reader: Arc<dyn FieldTextReader> = Arc::new(GradualDeleteMockReader::new(vec![
            "hello world".to_string(), // Poll 1: unchanged
            "hello worl".to_string(),  // Poll 2: shrinking
            "hello wor".to_string(),   // Poll 3: still shrinking
            "hello".to_string(),       // Poll 4: still shrinking
            String::new(),             // Poll 5: empty
        ]));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Ephemeral,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(
            all.is_empty(),
            "Expected no corrections when user gradually deleted text"
        );
    }

    #[tokio::test]
    async fn test_fast_send_is_captured_from_immediate_snapshot() {
        let (store, _dir) = setup_store();

        let span = make_span("When VoxChart is checking");
        let reader: Arc<dyn FieldTextReader> = Arc::new(GradualDeleteMockReader::new(vec![
            "When Vox Jot is checking".to_string(),
            String::new(),
        ]));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Ephemeral,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].original, "VoxChart");
        assert_eq!(all[0].corrected, "Vox Jot");
    }

    #[tokio::test]
    async fn test_unknown_instant_clear_requires_stable_edit_snapshot() {
        let (store, _dir) = setup_store();

        let span = make_span("When VoxChart is checking");
        let reader: Arc<dyn FieldTextReader> = Arc::new(GradualDeleteMockReader::new(vec![
            "When Vox Jot is checking".to_string(),
            String::new(),
        ]));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn test_unknown_clear_with_stable_edit_snapshot_is_captured() {
        let (store, _dir) = setup_store();

        let span = make_span("When VoxChart is checking");
        let reader: Arc<dyn FieldTextReader> = Arc::new(GradualDeleteMockReader::new(vec![
            "When Vox Jot is checking".to_string(),
            "When Vox Jot is checking".to_string(),
            String::new(),
        ]));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].original, "VoxChart");
        assert_eq!(all[0].corrected, "Vox Jot");
    }

    #[tokio::test]
    async fn test_persistent_instant_clear_is_discarded() {
        let (store, _dir) = setup_store();

        let span = make_span("When VoxChart is checking");
        let reader: Arc<dyn FieldTextReader> = Arc::new(GradualDeleteMockReader::new(vec![
            "When Vox Jot is checking".to_string(),
            String::new(),
        ]));

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Persistent,
            tiny_params(),
            test_recent_input(),
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn test_destructive_key_discards_ephemeral_instant_clear() {
        let (store, _dir) = setup_store();

        let span = make_span("When VoxChart is checking");
        let reader: Arc<dyn FieldTextReader> = Arc::new(GradualDeleteMockReader::new(vec![
            "When Vox Jot is checking".to_string(),
            String::new(),
        ]));
        let recent_input = test_recent_input();
        recent_input.note_destructive_edit_for_test();

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Ephemeral,
            tiny_params(),
            recent_input,
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn test_submit_key_allows_unknown_instant_clear_capture() {
        let (store, _dir) = setup_store();

        let span = make_span("When VoxChart is checking");
        let reader: Arc<dyn FieldTextReader> = Arc::new(GradualDeleteMockReader::new(vec![
            "When Vox Jot is checking".to_string(),
            String::new(),
        ]));
        let recent_input = test_recent_input();
        recent_input.note_submit_for_test();

        monitor_for_corrections_with_params(
            reader,
            span,
            store.clone(),
            AppFieldBehavior::Unknown,
            tiny_params(),
            recent_input,
            None,
        )
        .await;

        let all = store.list_all().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].original, "VoxChart");
        assert_eq!(all[0].corrected, "Vox Jot");
    }
}
