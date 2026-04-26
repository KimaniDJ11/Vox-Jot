use crate::screen_context::ContextImpactMetadata;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::cmp::Reverse;
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct DictionaryEntry {
    pub spoken: String,
    pub written: String,
    #[serde(default)]
    pub priority: u8,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub exact_only: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum PostProcessMode {
    Literal,
    Intent,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq, Type)]
pub struct PostProcessEdits {
    pub removed_false_starts: bool,
    pub removed_fillers: bool,
    pub added_bullets: bool,
    pub added_paragraphs: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct PostProcessResult {
    pub raw_text: String,
    pub normalized_text: String,
    pub final_text: String,
    pub dictionary_hits: Vec<String>,
    #[serde(default)]
    pub context_impact: Option<ContextImpactMetadata>,
    pub edits: PostProcessEdits,
    pub mode: PostProcessMode,
    pub active_app_context: Option<ActiveAppContext>,
    pub applied_tone_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionaryNormalizationResult {
    pub text: String,
    pub hits: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct ActiveAppContext {
    pub bundle_id: String,
    pub localized_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct ToneDefinition {
    pub id: String,
    pub label: String,
    pub instruction: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
#[deprecated(note = "Use WriteRule for app-aware routing.")]
pub struct AppToneMapping {
    pub bundle_id: String,
    pub app_name: String,
    pub tone_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct WriteRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub priority: i32,
    pub matchers: WriteRuleMatchers,
    pub overrides: WriteRuleOverrides,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type, Default)]
pub struct WriteRuleMatchers {
    /// Empty means the rule can match any app.
    #[serde(default)]
    pub bundle_ids: Vec<String>,
    /// Empty means no URL constraint. Patterns match normalized host+path.
    #[serde(default)]
    pub url_patterns: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type, Default)]
pub struct WriteRuleOverrides {
    #[serde(default)]
    pub stt_model_id: Option<String>,
    #[serde(default)]
    pub stt_language: Option<String>,
    #[serde(default)]
    pub translate_to_english: Option<bool>,
    #[serde(default)]
    pub tone_id: Option<String>,
    #[serde(default)]
    pub post_process_prompt_id: Option<String>,
    #[serde(default)]
    pub auto_submit: Option<bool>,
    #[serde(default)]
    pub paste_method: Option<crate::settings::PasteMethod>,
    #[serde(default)]
    pub append_trailing_space: Option<bool>,
    #[serde(default)]
    pub mute_while_recording: Option<bool>,
}

#[derive(Serialize, Debug, Clone, Type)]
pub struct ResolvedWriteRule {
    pub rule_id: String,
    pub rule_name: String,
    pub matched_bundle_id: Option<String>,
    pub matched_app_name: Option<String>,
    pub matched_url: Option<String>,
    pub matched_url_pattern: Option<String>,
    pub overrides: WriteRuleOverrides,
}

/// An application discovered on the user's system.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct InstalledApp {
    pub bundle_id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct PostProcessPreviewPayload {
    pub request_id: String,
    pub source_text: String,
    pub preview_text: String,
    #[serde(default)]
    pub translated_text: Option<String>,
    #[serde(default)]
    pub destination_label: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
}

#[derive(Debug)]
pub struct PreviewResolution {
    pub accepted: bool,
    pub final_text: Option<String>,
}

#[derive(Default)]
pub struct PreviewManager {
    pending: Mutex<HashMap<String, oneshot::Sender<PreviewResolution>>>,
    counter: AtomicU64,
}

struct PreparedDictionaryEntry<'a> {
    entry: &'a DictionaryEntry,
    spoken_words: usize,
    exact_form: String,
    compact_form: String,
}

impl PreviewManager {
    pub fn create_request(&self) -> (String, oneshot::Receiver<PreviewResolution>) {
        let id = format!("preview-{}", self.counter.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.clone(), tx);
        (id, rx)
    }

    pub fn resolve_request(
        &self,
        request_id: &str,
        accepted: bool,
        final_text: Option<String>,
    ) -> Result<(), String> {
        let sender = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id)
            .ok_or_else(|| format!("Preview request '{}' not found", request_id))?;

        sender
            .send(PreviewResolution {
                accepted,
                final_text,
            })
            .map_err(|_| format!("Preview request '{}' is no longer active", request_id))
    }

    pub fn clear_request(&self, request_id: &str) {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id);
    }
}

pub fn apply_personal_dictionary(
    text: &str,
    entries: &[DictionaryEntry],
) -> DictionaryNormalizationResult {
    if text.trim().is_empty() || entries.is_empty() {
        return DictionaryNormalizationResult {
            text: text.to_string(),
            hits: Vec::new(),
        };
    }

    let prepared = prepare_entries(entries);
    let max_words = prepared
        .iter()
        .map(|entry| entry.spoken_words)
        .max()
        .unwrap_or(1);
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut i = 0;
    let mut output = Vec::new();
    let mut hits = BTreeSet::new();

    while i < words.len() {
        let mut replacement: Option<(usize, &DictionaryEntry)> = None;

        for len in (1..=max_words).rev() {
            if i + len > words.len() {
                continue;
            }

            let phrase_words = &words[i..i + len];
            let phrase = phrase_words.join(" ");
            let exact_phrase = normalize_exact_phrase(&phrase, false);
            let compact_phrase = normalize_compact_phrase(&phrase, false);

            let mut candidates: Vec<&PreparedDictionaryEntry<'_>> = prepared
                .iter()
                .filter(|candidate| candidate.spoken_words == len)
                .filter(|candidate| {
                    candidate_matches(candidate, &phrase, &exact_phrase, &compact_phrase)
                })
                .collect();

            if candidates.is_empty() {
                continue;
            }

            candidates.sort_by_key(|candidate| Reverse(candidate.entry.priority));
            replacement = candidates.first().map(|candidate| (len, candidate.entry));
            break;
        }

        if let Some((len, entry)) = replacement {
            let phrase_words = &words[i..i + len];
            let (prefix, _) = extract_outer_punctuation(phrase_words[0]);
            let (_, suffix) = extract_outer_punctuation(phrase_words[len - 1]);
            output.push(format!("{}{}{}", prefix, entry.written, suffix));
            hits.insert(entry.written.clone());
            i += len;
        } else {
            output.push(words[i].to_string());
            i += 1;
        }
    }

    DictionaryNormalizationResult {
        text: output.join(" "),
        hits: hits.into_iter().collect(),
    }
}

pub fn detect_post_process_edits(
    raw_text: &str,
    normalized_text: &str,
    final_text: &str,
) -> PostProcessEdits {
    let trimmed_raw = raw_text.trim();
    let trimmed_normalized = normalized_text.trim();
    let trimmed_final = final_text.trim();

    PostProcessEdits {
        removed_false_starts: word_count(trimmed_final) < word_count(trimmed_raw),
        removed_fillers: word_count(trimmed_final) < word_count(trimmed_normalized),
        added_bullets: trimmed_final.lines().any(|line| {
            let line = line.trim_start();
            line.starts_with("- ") || line.starts_with("* ")
        }),
        added_paragraphs: trimmed_final.contains("\n\n"),
    }
}

fn prepare_entries(entries: &[DictionaryEntry]) -> Vec<PreparedDictionaryEntry<'_>> {
    entries
        .iter()
        .filter_map(|entry| {
            let exact_form = normalize_exact_phrase(&entry.spoken, entry.case_sensitive);
            let compact_form = normalize_compact_phrase(&entry.spoken, entry.case_sensitive);

            if exact_form.is_empty() || entry.written.trim().is_empty() {
                return None;
            }

            // Count words during normalization instead of re-iterating
            let spoken_words = exact_form.split_whitespace().count();

            Some(PreparedDictionaryEntry {
                entry,
                spoken_words,
                exact_form,
                compact_form,
            })
        })
        .collect()
}

fn candidate_matches(
    candidate: &PreparedDictionaryEntry<'_>,
    phrase: &str,
    exact_phrase: &str,
    compact_phrase: &str,
) -> bool {
    // Avoid allocating when the non-case-sensitive path can just borrow
    if candidate.entry.case_sensitive {
        let candidate_exact = normalize_exact_phrase(phrase, true);
        if candidate_exact == candidate.exact_form {
            return true;
        }
        if candidate.entry.exact_only {
            return false;
        }
        let candidate_compact = normalize_compact_phrase(phrase, true);
        !candidate_compact.is_empty() && candidate_compact == candidate.compact_form
    } else {
        if exact_phrase == candidate.exact_form {
            return true;
        }
        if candidate.entry.exact_only {
            return false;
        }
        !compact_phrase.is_empty() && compact_phrase == candidate.compact_form
    }
}

fn normalize_exact_phrase(value: &str, case_sensitive: bool) -> String {
    let normalized = value
        .split_whitespace()
        .map(clean_token)
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if case_sensitive {
        normalized
    } else {
        normalized.to_uppercase().to_lowercase()
    }
}

fn normalize_compact_phrase(value: &str, case_sensitive: bool) -> String {
    let normalized = value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>();

    if case_sensitive {
        normalized
    } else {
        normalized.to_uppercase().to_lowercase()
    }
}

fn clean_token(token: &str) -> String {
    token
        .trim_matches(|c: char| !c.is_alphanumeric())
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn extract_outer_punctuation(word: &str) -> (&str, &str) {
    let prefix_end: usize = word
        .chars()
        .take_while(|c| !c.is_alphanumeric())
        .map(char::len_utf8)
        .sum();
    let suffix_len: usize = word
        .chars()
        .rev()
        .take_while(|c| !c.is_alphanumeric())
        .map(char::len_utf8)
        .sum();

    // Guard against overlap when the entire word is punctuation.
    let suffix_start = word.len().saturating_sub(suffix_len).max(prefix_end);

    let prefix = &word[..prefix_end];
    let suffix = &word[suffix_start..];

    (prefix, suffix)
}

fn word_count(value: &str) -> usize {
    value.split_whitespace().count()
}

/// Merge manual personal dictionary entries with auto-learned corrections.
///
/// Manual entries take precedence over auto-learned corrections for the same
/// spoken form (manual entries have higher priority by convention).
pub fn get_merged_dictionary(
    manual_entries: &[DictionaryEntry],
    auto_entries: &[DictionaryEntry],
) -> Vec<DictionaryEntry> {
    let mut merged = manual_entries.to_vec();

    // Build a HashSet of normalized manual spoken forms for O(1) lookup
    let manual_spoken: std::collections::HashSet<String> = manual_entries
        .iter()
        .map(|e| e.spoken.to_lowercase())
        .collect();

    for auto_entry in auto_entries {
        if !manual_spoken.contains(&auto_entry.spoken.to_lowercase()) {
            merged.push(auto_entry.clone());
        }
    }

    merged
}

/// Build a correction bias prompt section for LLM providers.
///
/// This generates a concise list of known corrections that can be appended
/// to the system prompt to bias the LLM toward correct spellings.
#[cfg(test)]
pub fn build_correction_bias_prompt(corrections: &[DictionaryEntry]) -> Option<String> {
    if corrections.is_empty() {
        return None;
    }

    let mut lines = Vec::new();
    lines.push("Known corrections (apply these when you see similar words):".to_string());

    // Limit to top 50 corrections to avoid bloating the prompt
    for entry in corrections.iter().take(50) {
        lines.push(format!("- \"{}\" → \"{}\"", entry.spoken, entry.written));
    }

    Some(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(spoken: &str, written: &str) -> DictionaryEntry {
        DictionaryEntry {
            spoken: spoken.to_string(),
            written: written.to_string(),
            priority: 0,
            case_sensitive: false,
            exact_only: false,
        }
    }

    #[test]
    fn applies_dictionary_entries_with_longest_match_first() {
        let result = apply_personal_dictionary(
            "swift ui and ui kit",
            &[entry("ui", "UI"), entry("swift ui", "SwiftUI")],
        );

        assert_eq!(result.text, "SwiftUI and UI kit");
        assert_eq!(result.hits, vec!["SwiftUI".to_string(), "UI".to_string()]);
    }

    #[test]
    fn exact_only_requires_word_boundary_match() {
        let mut strict = entry("api key", "API key");
        strict.exact_only = true;

        let result = apply_personal_dictionary("api-key works", &[strict]);
        assert_eq!(result.text, "api-key works");
        assert!(result.hits.is_empty());
    }

    #[test]
    fn non_exact_entries_match_case_insensitively() {
        let result = apply_personal_dictionary("API key works", &[entry("api key", "API key")]);
        assert_eq!(result.text, "API key works");
        assert_eq!(result.hits, vec!["API key".to_string()]);
    }

    #[test]
    fn case_sensitive_entries_preserve_exact_matching() {
        let mut exact_case = entry("Jon Pais", "Jon Pais");
        exact_case.case_sensitive = true;

        let result = apply_personal_dictionary("Jon Pais spoke", &[exact_case.clone()]);
        assert_eq!(result.text, "Jon Pais spoke");

        let no_match = apply_personal_dictionary("jon pais spoke", &[exact_case]);
        assert_eq!(no_match.text, "jon pais spoke");
        assert!(no_match.hits.is_empty());
    }

    #[test]
    fn keeps_punctuation_around_replaced_phrase() {
        let result =
            apply_personal_dictionary("\"swift ui,\" works", &[entry("swift ui", "SwiftUI")]);
        assert_eq!(result.text, "\"SwiftUI,\" works");
    }

    #[test]
    fn detects_post_process_edits() {
        let edits = detect_post_process_edits(
            "um let's meet at no sorry let's do 6 pm",
            "let's meet at no sorry let's do 6 pm",
            "Let's meet at 6 PM.\n\n- Agenda",
        );

        assert!(edits.removed_false_starts);
        assert!(edits.removed_fillers);
        assert!(edits.added_bullets);
        assert!(edits.added_paragraphs);
    }

    // ── Full pipeline tests ─────────────────────────────────────────────

    #[test]
    fn test_dictionary_then_diff_full_pipeline() {
        use crate::correction_tracker::diff::extract_corrections;

        // Raw STT output
        let raw_stt = "i use swift ui";
        // Dictionary replaces "swift ui" → "SwiftUI"
        let dict = vec![entry("swift ui", "SwiftUI")];
        let result = apply_personal_dictionary(raw_stt, &dict);
        assert_eq!(result.text, "i use SwiftUI");

        // Simulate field observation returning same text (user didn't change it)
        let pasted = &result.text;
        let observed = &result.text;
        let corrections = extract_corrections(pasted, observed, None);
        assert!(
            corrections.is_empty(),
            "No corrections expected when field matches pasted text"
        );
    }

    #[test]
    fn test_dictionary_then_user_correction_pipeline() {
        use crate::correction_tracker::diff::extract_corrections;

        // Raw STT
        let raw_stt = "cheyene went to the store";
        // Dictionary: "cheyene" → "Cheyenne"
        let dict = vec![entry("cheyene", "Cheyenne")];
        let result = apply_personal_dictionary(raw_stt, &dict);
        assert_eq!(result.text, "Cheyenne went to the store");

        // User changes "teh" to "the" (a real correction).
        // Dictionary word "Cheyenne" stays unchanged → no correction for it.
        let pasted = "Cheyenne went to teh store";
        let observed = "Cheyenne went to the store";
        let corrections = extract_corrections(pasted, observed, None);
        assert_eq!(corrections.len(), 1);
        assert_eq!(corrections[0].original, "teh");
        assert_eq!(corrections[0].corrected, "the");
        // Crucially, "Cheyenne" does NOT appear as a correction
        for c in &corrections {
            assert_ne!(c.original, "Cheyenne");
        }
    }

    #[test]
    fn test_merged_dictionary_applies_auto_corrections() {
        let manual = vec![entry("api", "API")];
        let auto = vec![entry("teh", "the"), entry("recieve", "receive")];

        let merged = get_merged_dictionary(&manual, &auto);
        assert_eq!(merged.len(), 3);

        let result = apply_personal_dictionary("teh api will recieve data", &merged);
        assert_eq!(result.text, "the API will receive data");
        assert!(result.hits.contains(&"API".to_string()));
        assert!(result.hits.contains(&"the".to_string()));
        assert!(result.hits.contains(&"receive".to_string()));
    }

    #[test]
    fn test_auto_correction_doesnt_override_manual() {
        // Manual says "api" → "API"
        let manual = vec![entry("api", "API")];
        // Auto-correction says "api" → "Api" (wrong)
        let auto = vec![entry("api", "Api")];

        let merged = get_merged_dictionary(&manual, &auto);
        // Manual should win — auto entry for "api" should be skipped
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].written, "API");

        let result = apply_personal_dictionary("the api is ready", &merged);
        assert_eq!(result.text, "the API is ready");
    }
}
