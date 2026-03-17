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
