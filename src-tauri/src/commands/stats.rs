use crate::managers::history::HistoryManager;
use chrono::{Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeSet;
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
    /// Number of unique apps where dictation history has app context.
    pub unique_app_count: u64,
    /// Total number of transcriptions (lifetime).
    pub total_sessions: u64,
}

fn count_words(text: &str) -> u64 {
    text.split_whitespace().count() as u64
}

fn normalized_app_key(bundle_id: Option<&str>, app_name: Option<&str>) -> Option<String> {
    let bundle_id = bundle_id.map(str::trim).filter(|value| !value.is_empty());
    if let Some(bundle_id) = bundle_id {
        return Some(format!("bundle:{}", bundle_id.to_ascii_lowercase()));
    }

    app_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|app_name| format!("name:{}", app_name.to_ascii_lowercase()))
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
    let today_start = now_local.date_naive().and_hms_opt(0, 0, 0).unwrap();
    let today_start_utc = Local
        .from_local_datetime(&today_start)
        .earliest()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
        .unwrap_or(0);

    let mut total_words: u64 = 0;
    let mut today_words: u64 = 0;
    let total_sessions = entries.len() as u64;

    // Collect unique days (local time) that have transcriptions for streak calc
    let mut unique_days = BTreeSet::new();
    let mut unique_apps = BTreeSet::new();

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

        if let Some(metadata) = entry.screen_context_metadata.as_ref() {
            if let Some(app_key) = normalized_app_key(
                metadata.active_app_bundle_id.as_deref(),
                metadata.active_app_name.as_deref(),
            ) {
                unique_apps.insert(app_key);
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

    Ok(DictationStats {
        total_words,
        today_words,
        streak_days,
        unique_app_count: unique_apps.len() as u64,
        total_sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::normalized_app_key;

    #[test]
    fn normalized_app_key_prefers_case_insensitive_bundle_id() {
        assert_eq!(
            normalized_app_key(Some("  COM.Apple.Safari  "), Some("Safari")),
            Some("bundle:com.apple.safari".to_string())
        );
    }

    #[test]
    fn normalized_app_key_falls_back_to_app_name() {
        assert_eq!(
            normalized_app_key(None, Some("  TextEdit  ")),
            Some("name:textedit".to_string())
        );
    }

    #[test]
    fn normalized_app_key_ignores_blank_context() {
        assert_eq!(normalized_app_key(Some("  "), Some("")), None);
    }
}
