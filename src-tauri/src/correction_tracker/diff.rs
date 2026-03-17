use chrono::Utc;
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use specta::Type;

/// A single correction pair extracted from comparing inserted text vs. user-edited text.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CorrectionPair {
    pub original: String,
    pub corrected: String,
    pub confidence: f64,
    pub source_app: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
}

/// Extract correction pairs by word-level diffing between the originally inserted text
/// and the text after the user edited it.
pub fn extract_corrections(
    inserted_text: &str,
    current_text: &str,
    source_app: Option<&str>,
) -> Vec<CorrectionPair> {
    if inserted_text.trim().is_empty() || current_text.trim().is_empty() {
        return Vec::new();
    }

    // If texts are identical, no corrections
    if inserted_text.trim() == current_text.trim() {
        return Vec::new();
    }

    let now = Utc::now().timestamp();
    let mut corrections = Vec::new();

    // Word-level diff
    let diff = TextDiff::configure()
        .timeout(std::time::Duration::from_secs(2))
        .diff_words(inserted_text.trim(), current_text.trim());

    let changes: Vec<_> = diff.iter_all_changes().collect();
    let mut i = 0;

    while i < changes.len() {
        let change = &changes[i];

        match change.tag() {
            ChangeTag::Delete => {
                // Look ahead for an Insert that immediately follows (possibly with Equal in between)
                let deleted_text = change.value().to_string();
                let mut inserted_text_val = String::new();
                let mut j = i + 1;

                // Collect consecutive deletes
                let mut full_deleted = deleted_text.clone();
                while j < changes.len() && changes[j].tag() == ChangeTag::Delete {
                    full_deleted.push_str(changes[j].value());
                    j += 1;
                }

                // Now look for consecutive inserts
                while j < changes.len() && changes[j].tag() == ChangeTag::Insert {
                    inserted_text_val.push_str(changes[j].value());
                    j += 1;
                }

                if !inserted_text_val.is_empty() {
                    let original = full_deleted.trim().to_string();
                    let corrected = inserted_text_val.trim().to_string();

                    if let Some(pair) =
                        build_correction_pair(&original, &corrected, source_app, now)
                    {
                        corrections.push(pair);
                    }
                    i = j;
                    continue;
                }

                i = j;
                continue;
            }
            ChangeTag::Insert => {
                // Standalone insert without preceding delete — not a correction
                i += 1;
            }
            ChangeTag::Equal => {
                i += 1;
            }
        }
    }

    corrections
}

/// Build a correction pair with filtering and confidence scoring.
fn build_correction_pair(
    original: &str,
    corrected: &str,
    source_app: Option<&str>,
    timestamp: i64,
) -> Option<CorrectionPair> {
    // Skip empty
    if original.is_empty() || corrected.is_empty() {
        return None;
    }

    // Skip identical
    if original == corrected {
        return None;
    }

    // Skip punctuation-only changes
    if is_punctuation_only(original) || is_punctuation_only(corrected) {
        return None;
    }

    // Skip phrases > 5 words
    if word_count(original) > 5 || word_count(corrected) > 5 {
        return None;
    }

    // Compute similarity using strsim
    let similarity =
        strsim::normalized_levenshtein(&original.to_lowercase(), &corrected.to_lowercase());

    // Skip low similarity (< 0.3) — these are likely restructuring, not corrections
    if similarity < 0.3 {
        return None;
    }

    // Confidence based on similarity — closer words = higher confidence
    let confidence = similarity;

    Some(CorrectionPair {
        original: original.to_string(),
        corrected: corrected.to_string(),
        confidence,
        source_app: source_app.map(|s| s.to_string()),
        first_seen: timestamp,
        last_seen: timestamp,
    })
}

fn is_punctuation_only(s: &str) -> bool {
    !s.chars().any(|c| c.is_alphanumeric())
}

fn word_count(s: &str) -> usize {
    s.split_whitespace().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_word_correction() {
        let corrections = extract_corrections("Cheyene is great", "Cheyenne is great", None);
        assert_eq!(corrections.len(), 1);
        assert_eq!(corrections[0].original, "Cheyene");
        assert_eq!(corrections[0].corrected, "Cheyenne");
        assert!(corrections[0].confidence > 0.5);
    }

    #[test]
    fn test_no_changes() {
        let corrections = extract_corrections("hello world", "hello world", None);
        assert!(corrections.is_empty());
    }

    #[test]
    fn test_empty_inputs() {
        assert!(extract_corrections("", "hello", None).is_empty());
        assert!(extract_corrections("hello", "", None).is_empty());
        assert!(extract_corrections("", "", None).is_empty());
    }

    #[test]
    fn test_skip_punctuation_only() {
        let corrections = extract_corrections("hello world", "hello, world", None);
        // Punctuation-only changes should be filtered
        for c in &corrections {
            assert!(
                c.original.chars().any(|ch| ch.is_alphanumeric())
                    && c.corrected.chars().any(|ch| ch.is_alphanumeric())
            );
        }
    }

    #[test]
    fn test_skip_long_phrases() {
        let corrections = extract_corrections(
            "one two three four five six seven",
            "alpha beta gamma delta epsilon zeta eta",
            None,
        );
        // Phrases > 5 words should be filtered
        for c in &corrections {
            assert!(c.original.split_whitespace().count() <= 5);
            assert!(c.corrected.split_whitespace().count() <= 5);
        }
    }

    #[test]
    fn test_skip_low_similarity() {
        let corrections = extract_corrections("apple", "zebra", None);
        // Very different words should be filtered (similarity < 0.3)
        assert!(corrections.is_empty());
    }

    #[test]
    fn test_multiple_corrections() {
        let corrections = extract_corrections(
            "the quik brwn fox",
            "the quick brown fox",
            Some("com.example.app"),
        );
        assert_eq!(corrections.len(), 2);
        assert_eq!(
            corrections[0].source_app.as_deref(),
            Some("com.example.app")
        );
    }

    #[test]
    fn test_capitalization_correction() {
        let corrections = extract_corrections("john smith", "John Smith", None);
        assert!(!corrections.is_empty());
        assert_eq!(corrections[0].original, "john");
        assert_eq!(corrections[0].corrected, "John");
    }

    #[test]
    fn test_confidence_scoring() {
        let corrections = extract_corrections("recieve", "receive", None);
        assert_eq!(corrections.len(), 1);
        // Very similar words should have high confidence
        assert!(corrections[0].confidence > 0.7);
    }

    #[test]
    fn test_source_app_propagation() {
        let corrections = extract_corrections("teh world", "the world", Some("com.apple.TextEdit"));
        assert_eq!(corrections.len(), 1);
        assert_eq!(
            corrections[0].source_app.as_deref(),
            Some("com.apple.TextEdit")
        );
    }
}
