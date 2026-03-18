use anyhow::Result;
use log::{debug, error, info, warn};
use std::sync::Arc;
use std::time::Duration;

use super::diff::extract_corrections;
use super::span::InsertedSpan;
use super::store::CorrectionStore;

/// Trait for platform-specific text field reading.
pub trait FieldTextReader: Send + Sync {
    /// Read the current text from the focused text field.
    fn read_focused_field_text(&self) -> Result<Option<String>>;

    /// Check if the same text field is still focused.
    fn is_same_field_focused(&self) -> Result<bool>;
}

/// Monitor a text field for corrections after text was inserted.
///
/// This function:
/// 1. Waits for the configured delay to let the user make edits
/// 2. Reads the current field text
/// 3. Diffs it against the originally inserted text
/// 4. Stores any extracted correction pairs
pub async fn monitor_for_corrections(
    reader: Arc<dyn FieldTextReader>,
    span: InsertedSpan,
    store: Arc<CorrectionStore>,
    delay_secs: u32,
) {
    info!(
        "Starting correction monitoring for span '{}' (app: {:?}, delay: {}s)",
        span.id, span.app_identifier, delay_secs
    );

    // Wait the configured delay before reading
    let total_delay = Duration::from_secs(delay_secs as u64);
    let poll_interval = Duration::from_secs(5);
    let mut elapsed = Duration::ZERO;

    while elapsed < total_delay {
        tokio::time::sleep(poll_interval.min(total_delay - elapsed)).await;
        elapsed += poll_interval;

        // Check if the user has switched away from the field
        match tokio::task::spawn_blocking({
            let reader = reader.clone();
            move || reader.is_same_field_focused()
        })
        .await
        {
            Ok(Ok(true)) => {
                debug!("Field still focused after {:?}", elapsed);
            }
            Ok(Ok(false)) => {
                info!("User switched away from field during monitoring, reading final text early");
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
    }

    // Final read of the field text
    let current_text = match tokio::task::spawn_blocking({
        let reader = reader.clone();
        move || reader.read_focused_field_text()
    })
    .await
    {
        Ok(Ok(Some(text))) => text,
        Ok(Ok(None)) => {
            info!("Could not read field text after monitoring period");
            return;
        }
        Ok(Err(e)) => {
            warn!("Error reading field text: {}", e);
            return;
        }
        Err(e) => {
            error!("Task join error reading field text: {}", e);
            return;
        }
    };

    // Extract corrections by diffing
    let corrections = extract_corrections(
        &span.inserted_text,
        &current_text,
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

    // Store each correction
    for pair in &corrections {
        if let Err(e) = store.add_correction(pair) {
            error!(
                "Failed to store correction '{}' → '{}': {}",
                pair.original, pair.corrected, e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
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
            Ok(self.text.lock().unwrap().clone())
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

    #[tokio::test]
    async fn test_monitor_detects_correction_with_mock_reader() {
        let (store, _dir) = setup_store();

        // Inserted text has typos; the mock reader returns corrected text
        let span = make_span("teh quick brwn fox");
        let reader: Arc<dyn FieldTextReader> =
            Arc::new(MockFieldReader::new("the quick brown fox", true));

        monitor_for_corrections(reader, span, store.clone(), 1).await;

        let all = store.list_all().unwrap();
        assert!(
            !all.is_empty(),
            "Expected corrections to be stored after user edits"
        );

        // Verify the specific corrections were found
        let originals: Vec<&str> = all.iter().map(|c| c.original.as_str()).collect();
        let correcteds: Vec<&str> = all.iter().map(|c| c.corrected.as_str()).collect();
        assert!(
            originals.contains(&"teh"),
            "Expected 'teh' in originals, got: {:?}",
            originals
        );
        assert!(
            correcteds.contains(&"the"),
            "Expected 'the' in correcteds, got: {:?}",
            correcteds
        );
        assert!(
            originals.contains(&"brwn"),
            "Expected 'brwn' in originals, got: {:?}",
            originals
        );
        assert!(
            correcteds.contains(&"brown"),
            "Expected 'brown' in correcteds, got: {:?}",
            correcteds
        );
    }

    #[tokio::test]
    async fn test_monitor_no_corrections_when_text_unchanged() {
        let (store, _dir) = setup_store();

        let text = "the quick brown fox";
        let span = make_span(text);
        let reader: Arc<dyn FieldTextReader> = Arc::new(MockFieldReader::new(text, true));

        monitor_for_corrections(reader, span, store.clone(), 1).await;

        let all = store.list_all().unwrap();
        assert!(
            all.is_empty(),
            "Expected no corrections when text is unchanged, got: {:?}",
            all.iter()
                .map(|c| format!("{} -> {}", c.original, c.corrected))
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn test_monitor_stops_when_focus_lost() {
        let (store, _dir) = setup_store();

        // Reader returns corrected text but focus is lost immediately
        let span = make_span("teh world");
        let reader: Arc<dyn FieldTextReader> =
            Arc::new(MockFieldReader::new("the world", false));

        monitor_for_corrections(reader, span, store.clone(), 1).await;

        // Even though focus was lost, the final read should still happen
        // and any corrections should still be extracted and stored
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

        // Should not panic
        monitor_for_corrections(reader, span, store.clone(), 1).await;

        // No corrections should be stored since the read failed
        let all = store.list_all().unwrap();
        assert!(
            all.is_empty(),
            "Expected no corrections when reader returns error"
        );
    }

    #[tokio::test]
    async fn test_monitor_with_dictionary_applied_text() {
        let (store, _dir) = setup_store();

        // Text already has dictionary corrections applied (e.g., "SwiftUI" not "swift ui").
        // The mock reader returns the exact same text -- no user edits.
        let text = "SwiftUI is a framework for building user interfaces";
        let span = make_span(text);
        let reader: Arc<dyn FieldTextReader> = Arc::new(MockFieldReader::new(text, true));

        monitor_for_corrections(reader, span, store.clone(), 1).await;

        let all = store.list_all().unwrap();
        assert!(
            all.is_empty(),
            "Expected no corrections when dictionary-applied text is unchanged"
        );
    }

    #[tokio::test]
    async fn test_monitor_handles_none_text_gracefully() {
        let (store, _dir) = setup_store();

        let span = make_span("some text");
        let reader: Arc<dyn FieldTextReader> =
            Arc::new(MockFieldReader::new_with_none(true));

        // Should not panic; reader returns None for text
        monitor_for_corrections(reader, span, store.clone(), 1).await;

        let all = store.list_all().unwrap();
        assert!(
            all.is_empty(),
            "Expected no corrections when reader returns None"
        );
    }
}
