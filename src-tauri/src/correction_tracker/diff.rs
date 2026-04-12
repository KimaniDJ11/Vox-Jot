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

    // ── Semantic-change filter ──────────────────────────────────────────
    // When the original is a very common English word and the correction is
    // a different word (not sharing a stem/root), the user is almost certainly
    // changing *meaning* rather than fixing a transcription error.
    // Examples blocked:  "skip" → "ran", "called" → "texted", "going" → "running"
    // Examples allowed:  "teh" → "the", "recieve" → "receive", "Cheyene" → "Cheyenne"
    if word_count(original) == 1 && word_count(corrected) == 1 {
        let orig_lower = original.to_lowercase();
        let corr_lower = corrected.to_lowercase();

        if is_common_english_word(&orig_lower) && !shares_stem(&orig_lower, &corr_lower) {
            return None;
        }
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

/// Check whether a word is a common English word unlikely to be a transcription error.
/// This is a compact blocklist of high-frequency words that users are more likely
/// to change for *meaning* than because the STT misspelled them.
fn is_common_english_word(word: &str) -> bool {
    const COMMON_WORDS: &[&str] = &[
        // Verbs commonly swapped for meaning
        "go",
        "going",
        "went",
        "gone",
        "run",
        "running",
        "ran",
        "walk",
        "walked",
        "walking",
        "skip",
        "skipped",
        "skipping",
        "jump",
        "jumped",
        "sit",
        "stand",
        "call",
        "called",
        "calling",
        "text",
        "texted",
        "send",
        "sent",
        "buy",
        "sell",
        "read",
        "write",
        "take",
        "took",
        "taken",
        "make",
        "made",
        "give",
        "gave",
        "get",
        "got",
        "put",
        "say",
        "said",
        "tell",
        "told",
        // Adjectives commonly swapped for meaning
        "good",
        "great",
        "nice",
        "kind",
        "big",
        "large",
        "small",
        "little",
        "fast",
        "slow",
        "happy",
        "glad",
        "sad",
        "bad",
        "old",
        "new",
        "young",
        "long",
        "short",
        "high",
        "low",
        // Nouns commonly swapped for meaning
        "dog",
        "cat",
        "car",
        "bus",
        "day",
        "week",
        "month",
        "year",
        "man",
        "woman",
        "boy",
        "girl",
        "house",
        "home",
        "room",
        // Time/place words
        "today",
        "tomorrow",
        "yesterday",
        "morning",
        "evening",
        "night",
        "here",
        "there",
    ];
    COMMON_WORDS.contains(&word)
}

/// Check whether two words likely share a stem (crude prefix check).
/// This lets through cases like "recieve" → "receive" where the typo
/// preserves most of the word structure.
fn shares_stem(a: &str, b: &str) -> bool {
    if a.len() < 3 || b.len() < 3 {
        return false;
    }
    let min_len = a.len().min(b.len());
    let prefix_len = a
        .chars()
        .zip(b.chars())
        .take_while(|(ca, cb)| ca == cb)
        .count();
    // At least 60% shared prefix means they likely share a root
    prefix_len * 100 / min_len >= 60
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

    // ── Semantic vs. spelling change tests ──────────────────────────────

    #[test]
    fn test_skip_to_ran_is_not_saved() {
        // "i skip down the road" → "i ran down the road"
        // This is a meaning change, not a transcription error.
        let corrections = extract_corrections(
            "I skip down the road yesterday",
            "I ran down the road yesterday",
            None,
        );
        assert!(
            corrections.is_empty(),
            "Expected no corrections for semantic change 'skip' → 'ran', got: {:?}",
            corrections
        );
    }

    #[test]
    fn test_walk_to_run_is_not_saved() {
        let corrections = extract_corrections("I walk to the store", "I run to the store", None);
        assert!(
            corrections.is_empty(),
            "Expected no corrections for semantic change 'walk' → 'run', got: {:?}",
            corrections
        );
    }

    #[test]
    fn test_called_to_texted_is_not_saved() {
        let corrections =
            extract_corrections("I called her yesterday", "I texted her yesterday", None);
        assert!(
            corrections.is_empty(),
            "Expected no corrections for semantic change 'called' → 'texted', got: {:?}",
            corrections
        );
    }

    #[test]
    fn test_going_to_running_is_not_saved() {
        let corrections = extract_corrections(
            "We are going to the park",
            "We are running to the park",
            None,
        );
        assert!(
            corrections.is_empty(),
            "Expected no corrections for semantic change 'going' → 'running', got: {:?}",
            corrections
        );
    }

    #[test]
    fn test_good_to_great_is_not_saved() {
        let corrections =
            extract_corrections("That was a good meeting", "That was a great meeting", None);
        assert!(
            corrections.is_empty(),
            "Expected no corrections for semantic change 'good' → 'great', got: {:?}",
            corrections
        );
    }

    #[test]
    fn test_happy_to_glad_is_not_saved() {
        let corrections = extract_corrections("I'm happy about it", "I'm glad about it", None);
        assert!(
            corrections.is_empty(),
            "Expected no corrections for semantic change 'happy' → 'glad', got: {:?}",
            corrections
        );
    }

    #[test]
    fn test_real_typo_still_saved() {
        // Typos should still get through — high similarity, same root word.
        let corrections =
            extract_corrections("I recieve the package", "I receive the package", None);
        assert_eq!(
            corrections.len(),
            1,
            "Expected typo correction 'recieve' → 'receive' to be saved"
        );
        assert_eq!(corrections[0].original, "recieve");
        assert_eq!(corrections[0].corrected, "receive");
    }

    #[test]
    fn test_name_spelling_still_saved() {
        // Name corrections should still get through.
        let corrections =
            extract_corrections("Ask Cheyene about it", "Ask Cheyenne about it", None);
        assert_eq!(
            corrections.len(),
            1,
            "Expected name correction 'Cheyene' → 'Cheyenne' to be saved"
        );
    }

    // ── Pipeline integration tests ──────────────────────────────────────

    #[test]
    fn test_dictionary_word_survives_no_false_correction() {
        // Dictionary already replaced "cheyene" → "Cheyenne" before paste.
        // Field observation reads back the same text — no correction should appear.
        let pasted = "Cheyenne is great";
        let observed = "Cheyenne is great";
        let corrections = extract_corrections(pasted, observed, None);
        assert!(
            corrections.is_empty(),
            "Expected no corrections when field matches pasted text, got: {:?}",
            corrections
        );
    }

    #[test]
    fn test_dictionary_word_user_overrides() {
        // Dictionary replaced "swift ui" → "SwiftUI" before paste.
        // User changed "SwiftUI" back to "Swift UI".
        let pasted = "SwiftUI works";
        let observed = "Swift UI works";
        let corrections = extract_corrections(pasted, observed, None);
        assert_eq!(corrections.len(), 1);
        assert_eq!(corrections[0].original, "SwiftUI");
        assert_eq!(corrections[0].corrected, "Swift UI");
    }

    #[test]
    fn test_dictionary_and_user_edit_combined() {
        // Dictionary applied "api" → "API" (already in pasted text).
        // User also fixed typo "teh" → "the".
        let pasted = "teh API is ready";
        let observed = "the API is ready";
        let corrections = extract_corrections(pasted, observed, None);
        assert_eq!(corrections.len(), 1);
        assert_eq!(corrections[0].original, "teh");
        assert_eq!(corrections[0].corrected, "the");
    }

    #[test]
    fn test_no_correction_when_field_unchanged() {
        let text = "The quick brown fox jumps over the lazy dog";
        let corrections = extract_corrections(text, text, None);
        assert!(corrections.is_empty());
    }

    #[test]
    fn test_user_adds_text_around_dictionary_word() {
        // Dictionary word "SwiftUI" stays intact. User appended " is awesome" after it.
        // The diff should not produce a correction for "SwiftUI".
        let pasted = "I love SwiftUI";
        let observed = "I love SwiftUI so much";
        let corrections = extract_corrections(pasted, observed, None);
        // No correction should reference SwiftUI since it was not changed
        for c in &corrections {
            assert_ne!(
                c.original, "SwiftUI",
                "SwiftUI should not appear as the original of a correction"
            );
        }
    }
}
