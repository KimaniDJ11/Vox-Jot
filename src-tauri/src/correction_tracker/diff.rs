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

    let confidence = score_correction_candidate(original, corrected)?;

    Some(CorrectionPair {
        original: original.to_string(),
        corrected: corrected.to_string(),
        confidence,
        source_app: source_app.map(|s| s.to_string()),
        first_seen: timestamp,
        last_seen: timestamp,
    })
}

/// Re-validate a stored auto-learned correction before it can be applied to new text.
///
/// This keeps older/noisier entries from becoming active dictionary rules after the
/// extraction heuristics become stricter. Manual/user-approved corrections bypass
/// this check at the store layer.
pub fn auto_correction_score(original: &str, corrected: &str) -> Option<f64> {
    score_correction_candidate(original, corrected)
}

fn score_correction_candidate(original: &str, corrected: &str) -> Option<f64> {
    let original_profile = CandidateText::new(original)?;
    let corrected_profile = CandidateText::new(corrected)?;

    if original != corrected && original.to_lowercase() == corrected.to_lowercase() {
        return Some(0.92);
    }

    if original_profile.exact == corrected_profile.exact {
        return None;
    }

    if original_profile.compact == corrected_profile.compact {
        return Some(if original == corrected { 0.0 } else { 0.92 });
    }

    if corrected_profile.introduces_digit_without_spoken_number(&original_profile) {
        return None;
    }

    if is_one_sided_substring_rewrite(&original_profile, &corrected_profile) {
        return None;
    }

    if let Some(score) = score_spoken_symbol_correction(&original_profile, &corrected_profile) {
        return Some(score);
    }

    if is_semantic_single_word_rewrite(&original_profile, &corrected_profile) {
        return None;
    }

    let edit_distance =
        strsim::damerau_levenshtein(&original_profile.compact, &corrected_profile.compact);
    let max_len = original_profile
        .compact
        .chars()
        .count()
        .max(corrected_profile.compact.chars().count());
    let min_len = original_profile
        .compact
        .chars()
        .count()
        .min(corrected_profile.compact.chars().count());
    if max_len == 0 {
        return None;
    }

    let damerau_similarity = 1.0 - (edit_distance as f64 / max_len as f64);
    let jaro = strsim::jaro_winkler(&original_profile.compact, &corrected_profile.compact);
    let similarity = damerau_similarity.max(jaro);

    if edit_distance == 1 && min_len >= 3 {
        return Some(0.9_f64.max(similarity));
    }

    if edit_distance == 2 && min_len >= 5 && similarity >= 0.72 {
        return Some(0.82_f64.max(similarity));
    }

    let either_phrase = original_profile.word_count > 1 || corrected_profile.word_count > 1;
    let threshold = if either_phrase { 0.8 } else { 0.74 };
    if similarity >= threshold && min_len >= 5 {
        return Some(similarity);
    }

    None
}

#[derive(Debug)]
struct CandidateText {
    exact: String,
    compact: String,
    words: Vec<String>,
    symbol_form: String,
    word_count: usize,
    has_digit: bool,
}

impl CandidateText {
    fn new(value: &str) -> Option<Self> {
        let words: Vec<String> = value
            .split_whitespace()
            .map(clean_token_for_matching)
            .filter(|token| !token.is_empty())
            .collect();
        let exact = words.join(" ");
        let compact = words.join("");
        let symbol_form: String = value
            .chars()
            .filter(|ch| ch.is_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | '\\' | '@'))
            .flat_map(char::to_lowercase)
            .collect();
        let has_alpha = compact.chars().any(char::is_alphabetic);
        let has_digit = compact.chars().any(|ch| ch.is_ascii_digit());

        if compact.is_empty() || !has_alpha {
            return None;
        }

        Some(Self {
            word_count: words.len(),
            exact,
            compact,
            words,
            symbol_form,
            has_digit,
        })
    }

    fn introduces_digit_without_spoken_number(&self, original: &Self) -> bool {
        self.has_digit
            && !original.has_digit
            && !original.words.iter().any(|word| is_number_word(word))
    }
}

fn clean_token_for_matching(token: &str) -> String {
    token
        .trim_matches(|ch: char| !ch.is_alphanumeric())
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_one_sided_substring_rewrite(original: &CandidateText, corrected: &CandidateText) -> bool {
    if original.compact == corrected.compact {
        return false;
    }

    let original_len = original.compact.chars().count();
    let corrected_len = corrected.compact.chars().count();
    let shorter = original_len.min(corrected_len);
    let longer = original_len.max(corrected_len);

    if shorter < 4 || longer < shorter + 3 {
        return false;
    }

    if original.compact.contains(&corrected.compact)
        || corrected.compact.contains(&original.compact)
    {
        return true;
    }

    false
}

fn score_spoken_symbol_correction(
    original: &CandidateText,
    corrected: &CandidateText,
) -> Option<f64> {
    let mut rendered = String::new();
    let mut used_symbol_word = false;

    for word in &original.words {
        if let Some(symbol) = spoken_symbol(word) {
            rendered.push_str(symbol);
            used_symbol_word = true;
        } else {
            rendered.push_str(word);
        }
    }

    if !used_symbol_word {
        return None;
    }

    if rendered == corrected.symbol_form {
        Some(0.95)
    } else {
        None
    }
}

fn spoken_symbol(word: &str) -> Option<&'static str> {
    match word {
        "underscore" => Some("_"),
        "dash" | "hyphen" => Some("-"),
        "dot" | "period" => Some("."),
        "slash" | "forwardslash" => Some("/"),
        "backslash" => Some("\\"),
        "at" => Some("@"),
        _ => None,
    }
}

fn is_semantic_single_word_rewrite(original: &CandidateText, corrected: &CandidateText) -> bool {
    if original.word_count != 1 || corrected.word_count != 1 {
        return false;
    }

    let original_word = &original.words[0];
    let corrected_word = &corrected.words[0];
    let edit_distance = strsim::damerau_levenshtein(original_word, corrected_word);

    (is_common_english_word(original_word) || is_common_english_word(corrected_word))
        && edit_distance > 2
        && !shares_stem(original_word, corrected_word)
}

fn is_number_word(word: &str) -> bool {
    matches!(
        word,
        "zero"
            | "one"
            | "two"
            | "three"
            | "four"
            | "five"
            | "six"
            | "seven"
            | "eight"
            | "nine"
            | "ten"
            | "eleven"
            | "twelve"
            | "thirteen"
            | "fourteen"
            | "fifteen"
            | "sixteen"
            | "seventeen"
            | "eighteen"
            | "nineteen"
            | "twenty"
    )
}

/// Check whether a word is a common English word unlikely to be a transcription error.
/// This is a compact blocklist of high-frequency words that users are more likely
/// to change for *meaning* than because the STT misspelled them.
fn is_common_english_word(word: &str) -> bool {
    const COMMON_WORDS: &[&str] = &[
        // Verbs commonly swapped for meaning
        "go",
        "use",
        "using",
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
        "record",
        "recording",
        "import",
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
        "box",
        "loan",
        "user",
        "other",
        "phrase",
        "key",
        "keys",
        // Time/place words
        "today",
        "tomorrow",
        "yesterday",
        "morning",
        "evening",
        "night",
        "here",
        "there",
        "or",
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

    #[test]
    fn test_screenshot_noise_is_not_learned() {
        let examples = [
            ("Using", "Recording"),
            ("import", "or"),
            ("other", "user"),
            ("drive.", "drive 2"),
            ("transcription. Section..", "Transcription"),
            ("copylash", "lash"),
            ("box", "Chatterbox"),
            ("Mal X", "MIX"),
        ];

        for (original, corrected) in examples {
            let corrections = extract_corrections(original, corrected, None);
            assert!(
                corrections.is_empty(),
                "Expected noisy candidate '{original}' → '{corrected}' to be rejected, got: {:?}",
                corrections
            );
        }
    }

    #[test]
    fn test_spoken_symbol_correction_is_learned() {
        let corrections = extract_corrections("fish underscore speech", "fish_speech", None);
        assert_eq!(corrections.len(), 1);
        assert_eq!(corrections[0].original, "fish underscore speech");
        assert_eq!(corrections[0].corrected, "fish_speech");
        assert!(corrections[0].confidence > 0.9);
    }

    #[test]
    fn test_short_substring_expansion_is_not_learned() {
        let corrections = extract_corrections("box", "Chatterbox", None);
        assert!(corrections.is_empty());
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
