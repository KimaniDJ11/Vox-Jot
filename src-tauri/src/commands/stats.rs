use crate::managers::history::HistoryManager;
use chrono::{Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Aggregated dictation statistics computed from history entries.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DictationStats {
    /// Total words transcribed (lifetime).
    pub total_words: u64,
    /// Words transcribed today (local time).
    pub today_words: u64,
    /// Current daily streak (consecutive days with at least one transcription).
    pub streak_days: u32,
    /// Accuracy percentage (0–100). Based on correction/snapshot data when available.
    pub accuracy_percent: Option<f64>,
    /// Total number of transcriptions (lifetime).
    pub total_sessions: u64,
}

fn count_words(text: &str) -> u64 {
    text.split_whitespace().count() as u64
}

#[tauri::command]
#[specta::specta]
pub async fn get_dictation_stats(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<DictationStats, String> {
    let entries = history_manager
        .get_history_entries()
        .await
        .map_err(|e| e.to_string())?;

    let now_local = Local::now();
    let today_start = now_local
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap();
    let today_start_utc = Local
        .from_local_datetime(&today_start)
        .earliest()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
        .unwrap_or(0);

    let mut total_words: u64 = 0;
    let mut today_words: u64 = 0;
    let total_sessions = entries.len() as u64;

    // Collect unique days (local time) that have transcriptions for streak calc
    let mut unique_days = std::collections::BTreeSet::new();

    // Track accuracy: count entries where field snapshot matches pasted text
    let mut accuracy_total: u64 = 0;
    let mut accuracy_matches: u64 = 0;

    for entry in &entries {
        // Use the best available text for word count
        let text = entry
            .post_processed_text
            .as_deref()
            .unwrap_or(&entry.transcription_text);
        let words = count_words(text);
        total_words += words;

        if entry.timestamp >= today_start_utc {
            today_words += words;
        }

        // Convert timestamp to local date for streak tracking
        if let Some(dt) = chrono::DateTime::from_timestamp(entry.timestamp, 0) {
            let local_date = dt.with_timezone(&Local).date_naive();
            unique_days.insert(local_date);
        }

        // Accuracy: if we have both pasted_text and field_snapshot_text, compare
        if let (Some(pasted), Some(snapshot)) =
            (&entry.pasted_text, &entry.field_snapshot_text)
        {
            accuracy_total += 1;
            // Normalize whitespace for comparison
            let pasted_normalized: String = pasted.split_whitespace().collect::<Vec<_>>().join(" ");
            let snapshot_normalized: String =
                snapshot.split_whitespace().collect::<Vec<_>>().join(" ");
            if pasted_normalized == snapshot_normalized {
                accuracy_matches += 1;
            }
        }
    }

    // Calculate streak: count consecutive days backwards from today
    let today_local = now_local.date_naive();
    let mut streak_days: u32 = 0;
    let mut check_date = today_local;

    loop {
        if unique_days.contains(&check_date) {
            streak_days += 1;
            check_date -= chrono::Duration::days(1);
        } else {
            break;
        }
    }

    let accuracy_percent = if accuracy_total > 0 {
        Some((accuracy_matches as f64 / accuracy_total as f64) * 100.0)
    } else {
        None
    };

    Ok(DictationStats {
        total_words,
        today_words,
        streak_days,
        accuracy_percent,
        total_sessions,
    })
}
