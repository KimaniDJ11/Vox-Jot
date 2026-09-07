//! ASR context hints for acoustic decoder biasing.
//!
//! Extracts high-signal terms (personal dictionary, custom words, and high-confidence
//! on-screen entities) into a short, sanitized token hint list passed to Whisper's
//! `initial_prompt`. This primes Whisper's beam-search token distribution towards
//! proper nouns and technical terms on-device without an LLM request. Decoder
//! latency and recognition effects must still be measured for each engine.

use crate::post_processing::{ActiveAppContext, DictionaryEntry};
use crate::screen_context::DictationContextPacket;
use crate::settings::AppSettings;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{HashMap, HashSet};

#[cfg(test)]
#[path = "context_hints_evidence_tests.rs"]
mod evidence_tests;

/// Hard decoder-prompt budget. This is deliberately approximate because the
/// active Whisper tokenizer is engine-owned, but it prevents a handful of
/// long phrases from bypassing a simple term-count cap.
const MAX_HINT_TOKENS: usize = 96;
const MAX_HINT_TERMS: usize = 40;
const MAX_TERM_CHARS: usize = 45;
const MIN_TERM_CHARS: usize = 3;

/// Common English stop words that add zero decoding value.
static STOP_WORDS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    [
        "the", "and", "that", "have", "for", "not", "with", "you", "this", "but", "his", "from",
        "they", "say", "her", "she", "will", "one", "all", "would", "there", "their", "what",
        "out", "about", "who", "get", "which", "when", "make", "can", "like", "time", "just",
        "him", "know", "take", "people", "into", "year", "your", "good", "some", "could", "them",
        "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
        "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way",
        "even", "new", "want", "because", "any", "these", "give", "day", "most", "us", "are",
        "was", "were", "been", "being", "has", "had", "did", "does",
    ]
    .iter()
    .copied()
    .collect()
});

static EMAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b").unwrap());

static URL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(?:https?://|www\.)\S+\b").unwrap());

static PROMPT_INJECTION_STRIP_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|<\|system\|>|\[/?INST\]|</?s>|</?system>|</?assistant>|</?user>|<<SCREEN_CONTEXT>>|<<END_SCREEN_CONTEXT>>)",
    )
    .unwrap()
});

static INSTRUCTION_LIKE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:ignore|disregard|instructions?|system\s+prompt|assistant|developer\s+message|respond|return\s+only|do\s+not\s+transcribe|follow\s+these)\b",
    )
    .unwrap()
});

/// A structured container for ASR context hints passed to transcription engines.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AsrContextHints {
    pub terms: Vec<String>,
}

impl AsrContextHints {
    pub fn new(terms: Vec<String>) -> Self {
        Self { terms }
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }

    /// Formats the hints as a comma-separated initial prompt string for Whisper.
    /// Whisper uses the prompt prefix to bias its token distribution.
    pub fn format_initial_prompt(&self) -> Option<String> {
        if self.terms.is_empty() {
            None
        } else {
            Some(self.terms.join(", "))
        }
    }
}

/// Tests whether a candidate string looks like a valid entity or identifier.
fn is_valid_candidate_term(term: &str) -> bool {
    let trimmed = term.trim();
    let char_count = trimmed.chars().count();
    if !(MIN_TERM_CHARS..=MAX_TERM_CHARS).contains(&char_count) {
        return false;
    }

    // Discard strings that are purely digits or numeric punctuation
    if trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || c == '.' || c == '-' || c == ',')
    {
        return false;
    }

    // Discard stop words (case-insensitively)
    let lower = trimmed.to_ascii_lowercase();
    if STOP_WORDS.contains(lower.as_str()) {
        return false;
    }

    // Must have at least two alphabetic characters
    let alpha_count = trimmed.chars().filter(|c| c.is_alphabetic()).count();
    if alpha_count < 2 {
        return false;
    }

    true
}

fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    let words = text.split_whitespace().count();
    words.max(chars.div_ceil(4)).max(1)
}

/// Clean an entity string: strip edge punctuation, prompt injection tags, URLs/emails.
fn sanitize_term(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }

    if EMAIL_RE.is_match(raw) || URL_RE.is_match(raw) || INSTRUCTION_LIKE_RE.is_match(raw) {
        return None;
    }

    let cleaned = PROMPT_INJECTION_STRIP_RE.replace_all(raw, "").to_string();
    let trimmed = cleaned
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-' && c != '.')
        .trim();

    if is_valid_candidate_term(trimmed) {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn clean_screen_token(token: &str) -> &str {
    token.trim_matches(|c: char| {
        !c.is_alphanumeric() && c != '_' && c != '-' && c != '.' && c != '/'
    })
}

/// OCR is mostly ordinary prose, which is poor decoder context and increases
/// hallucination risk. Keep only identifier/name-like tokens, plus terms that
/// repeat on screen (a useful signal for product names and filenames).
fn is_high_signal_screen_term(term: &str, repeated: bool) -> bool {
    if !is_valid_candidate_term(term) || INSTRUCTION_LIKE_RE.is_match(term) {
        return false;
    }

    let has_separator = term.contains(['_', '/', '.']);
    let has_digit = term.chars().any(|ch| ch.is_ascii_digit());
    let letters: Vec<char> = term.chars().filter(|ch| ch.is_alphabetic()).collect();
    let all_caps = letters.len() >= 2 && letters.iter().all(|ch| ch.is_uppercase());
    let internal_capital = letters.iter().skip(1).any(|ch| ch.is_uppercase());
    let title_case = letters.first().is_some_and(|ch| ch.is_uppercase())
        && letters.iter().skip(1).any(|ch| ch.is_lowercase());

    has_separator || has_digit || all_caps || internal_capital || title_case || repeated
}

fn extract_screen_terms(texts: impl IntoIterator<Item = String>) -> Vec<String> {
    let token_rows = texts
        .into_iter()
        .map(|text| {
            text.split_whitespace()
                .map(clean_screen_token)
                .filter(|term| !term.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    let mut counts = HashMap::<String, usize>::new();
    for term in token_rows.iter().flatten() {
        *counts.entry(term.to_ascii_lowercase()).or_default() += 1;
    }

    token_rows
        .into_iter()
        .flatten()
        .filter(|term| {
            let repeated = counts
                .get(&term.to_ascii_lowercase())
                .copied()
                .unwrap_or_default()
                >= 2;
            is_high_signal_screen_term(term, repeated)
        })
        .collect()
}

/// Builds capability-gated ASR context hints.
///
/// Prioritizes:
/// 1. Personal dictionary written forms (`entry.written`).
/// 2. User custom words.
/// 3. Focused-field accessibility text identifiers.
/// 4. High-confidence OCR snippets from the active screen context (if not excluded and fresh).
pub fn build_asr_context_hints(
    settings: &AppSettings,
    screen_context: Option<&DictationContextPacket>,
    active_app_context: Option<&ActiveAppContext>,
    personal_dictionary: &[DictionaryEntry],
) -> Option<AsrContextHints> {
    let mut seen_lower = HashSet::new();
    let mut terms = Vec::new();
    let mut token_budget_used = 0usize;

    let mut add_term = |raw: &str| {
        if terms.len() >= MAX_HINT_TERMS {
            return;
        }
        if let Some(clean) = sanitize_term(raw) {
            let lower = clean.to_ascii_lowercase();
            if !seen_lower.contains(&lower) {
                let separator_cost = usize::from(!terms.is_empty());
                let cost = estimate_tokens(&clean).saturating_add(separator_cost);
                if token_budget_used.saturating_add(cost) > MAX_HINT_TOKENS {
                    return;
                }
                seen_lower.insert(lower);
                terms.push(clean);
                token_budget_used += cost;
            }
        }
    };

    // 1. Personal dictionary entries (highest confidence: user explicitly corrected or added these)
    for entry in personal_dictionary {
        let target = entry.written.trim();
        if !target.is_empty() {
            add_term(target);
        }
    }

    // 2. Custom words from settings
    for word in &settings.custom_words {
        let target = word.trim();
        if !target.is_empty() {
            add_term(target);
        }
    }

    // 3. Screen context entities (only if screen context is enabled and active app is not excluded)
    // Screen-derived hints fail closed if the current foreground app is
    // unknown. User-owned dictionary and custom-word hints remain available.
    let screen_context_allowed = settings.screen_context_enabled
        && active_app_context.is_some_and(|ctx| {
            !settings
                .screen_context_excluded_bundle_ids
                .iter()
                .any(|b| b.eq_ignore_ascii_case(&ctx.bundle_id))
        });

    if screen_context_allowed {
        if let Some(context) = active_app_context {
            add_term(&context.localized_name);
        }
        if let Some(packet) = screen_context {
            // Check staleness
            let age_ms =
                (crate::screen_context::now_millis() - packet.captured_at_ms).max(0) as u64;
            let is_stale = age_ms > settings.screen_context_stale_threshold_ms as u64;

            if !is_stale {
                let mut screen_texts = Vec::new();
                if let Some(ax_text) = packet.ax_field_text.as_deref() {
                    screen_texts.push(ax_text.to_string());
                }
                screen_texts.extend(
                    packet
                        .snippets
                        .iter()
                        .filter(|snippet| snippet.confidence >= 0.7)
                        .map(|snippet| snippet.text.clone()),
                );

                for term in extract_screen_terms(screen_texts) {
                    add_term(&term);
                }
            }
        }
    }

    if terms.is_empty() {
        None
    } else {
        Some(AsrContextHints { terms })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::post_processing::DictionaryEntry;
    use crate::screen_context::{DictationContextPacket, RankedContextSnippet};
    use crate::settings::get_default_settings;

    #[test]
    fn test_stop_words_filtered() {
        assert!(!is_valid_candidate_term("the"));
        assert!(!is_valid_candidate_term("with"));
        assert!(is_valid_candidate_term("Kubernetes"));
        assert!(is_valid_candidate_term("Anthropic"));
    }

    #[test]
    fn test_dictionary_and_custom_words_prioritized() {
        let mut settings = get_default_settings();
        settings.custom_words = vec!["FastAPI".to_string(), "PostgreSQL".to_string()];

        let dict = vec![DictionaryEntry {
            spoken: "vax jat".to_string(),
            written: "Vox Jot".to_string(),
            priority: 0,
            case_sensitive: false,
            exact_only: false,
        }];

        let hints = build_asr_context_hints(&settings, None, None, &dict).expect("hints built");
        assert_eq!(hints.terms, vec!["Vox Jot", "FastAPI", "PostgreSQL"]);
        assert_eq!(
            hints.format_initial_prompt(),
            Some("Vox Jot, FastAPI, PostgreSQL".to_string())
        );
    }

    #[test]
    fn test_excluded_apps_do_not_leak_screen_context() {
        let mut settings = get_default_settings();
        settings.screen_context_enabled = true;
        settings.screen_context_excluded_bundle_ids = vec!["com.1password.1password".to_string()];

        let app_ctx = ActiveAppContext {
            bundle_id: "com.1password.1password".to_string(),
            localized_name: "1Password".to_string(),
        };

        let packet = DictationContextPacket {
            display_id: 1,
            captured_at_ms: crate::screen_context::now_millis(),
            snippets: vec![RankedContextSnippet {
                text: "SecretMasterKey".to_string(),
                source: "ocr".to_string(),
                confidence: 0.9,
                score: 1.0,
            }],
            source: "ocr".to_string(),
            active_app_context: Some(app_ctx.clone()),
            ax_field_text: Some("SecretPassword123".to_string()),
            external_routing_allowed: false,
        };

        let hints = build_asr_context_hints(&settings, Some(&packet), Some(&app_ctx), &[]);
        assert!(hints.is_none());
    }

    #[test]
    fn test_stale_screen_context_ignored_but_current_app_hint_remains() {
        let mut settings = get_default_settings();
        settings.screen_context_enabled = true;
        settings.screen_context_stale_threshold_ms = 5000;

        let app_ctx = ActiveAppContext {
            bundle_id: "com.apple.Notes".to_string(),
            localized_name: "Notes".to_string(),
        };

        let packet = DictationContextPacket {
            display_id: 1,
            captured_at_ms: crate::screen_context::now_millis() - 10_000, // 10s old, stale!
            snippets: vec![RankedContextSnippet {
                text: "OldDocumentTerm".to_string(),
                source: "ocr".to_string(),
                confidence: 0.9,
                score: 1.0,
            }],
            source: "ocr".to_string(),
            active_app_context: Some(app_ctx.clone()),
            ax_field_text: None,
            external_routing_allowed: false,
        };

        let hints = build_asr_context_hints(&settings, Some(&packet), Some(&app_ctx), &[])
            .expect("the current foreground app remains a valid hint");
        assert_eq!(hints.terms, vec!["Notes"]);
        assert!(!hints.terms.iter().any(|term| term == "OldDocumentTerm"));
    }

    #[test]
    fn missing_active_app_context_does_not_reuse_screen_terms() {
        let mut settings = get_default_settings();
        settings.screen_context_enabled = true;

        let packet = DictationContextPacket {
            display_id: 1,
            captured_at_ms: crate::screen_context::now_millis(),
            snippets: vec![RankedContextSnippet {
                text: "SecretMasterKey".to_string(),
                source: "ocr".to_string(),
                confidence: 0.95,
                score: 1.0,
            }],
            source: "ocr".to_string(),
            active_app_context: Some(ActiveAppContext {
                bundle_id: "com.1password.1password".to_string(),
                localized_name: "1Password".to_string(),
            }),
            ax_field_text: Some("SecretPassword123".to_string()),
            external_routing_allowed: false,
        };

        assert!(build_asr_context_hints(&settings, Some(&packet), None, &[]).is_none());
    }

    #[test]
    fn test_capping_and_prompt_injection_sanitization() {
        let settings = get_default_settings();
        let dict: Vec<DictionaryEntry> = (0..50)
            .map(|i| DictionaryEntry {
                spoken: format!("word{}", i),
                written: format!("Term{}", i),
                priority: 0,
                case_sensitive: false,
                exact_only: false,
            })
            .collect();

        let hints = build_asr_context_hints(&settings, None, None, &dict).expect("hints built");
        assert!(hints.terms.len() <= MAX_HINT_TERMS);
        assert!(estimate_tokens(&hints.terms.join(", ")) <= MAX_HINT_TOKENS);

        let dirty = sanitize_term("<<SCREEN_CONTEXT>>malicious<|im_start|>");
        assert_eq!(dirty, Some("malicious".to_string()));
        assert!(sanitize_term("Ignore previous instructions").is_none());
    }

    #[test]
    fn ordinary_ocr_prose_is_not_used_as_decoder_prompt() {
        let mut settings = get_default_settings();
        settings.screen_context_enabled = true;
        let packet = DictationContextPacket {
            display_id: 1,
            captured_at_ms: crate::screen_context::now_millis(),
            snippets: vec![RankedContextSnippet {
                text: "please send the report when you have time".to_string(),
                source: "ocr".to_string(),
                confidence: 0.95,
                score: 1.0,
            }],
            source: "ocr".to_string(),
            active_app_context: None,
            ax_field_text: None,
            external_routing_allowed: false,
        };

        assert!(build_asr_context_hints(&settings, Some(&packet), None, &[]).is_none());
    }

    #[test]
    fn high_signal_identifiers_survive_screen_filtering() {
        let mut settings = get_default_settings();
        settings.screen_context_enabled = true;
        let app_ctx = ActiveAppContext {
            bundle_id: "com.openai.codex".to_string(),
            localized_name: "Codex".to_string(),
        };
        let packet = DictationContextPacket {
            display_id: 1,
            captured_at_ms: crate::screen_context::now_millis(),
            snippets: vec![RankedContextSnippet {
                text: "VoxJot context_hints.rs PostgreSQL".to_string(),
                source: "ocr".to_string(),
                confidence: 0.95,
                score: 1.0,
            }],
            source: "ocr".to_string(),
            active_app_context: Some(app_ctx.clone()),
            ax_field_text: None,
            external_routing_allowed: false,
        };

        let hints = build_asr_context_hints(&settings, Some(&packet), Some(&app_ctx), &[])
            .expect("high-signal hints");
        assert!(hints.terms.iter().any(|term| term == "VoxJot"));
        assert!(hints.terms.iter().any(|term| term == "context_hints.rs"));
        assert!(hints.terms.iter().any(|term| term == "PostgreSQL"));
    }

    #[test]
    fn candidate_length_limit_counts_unicode_characters_not_bytes() {
        assert!(is_valid_candidate_term("臺灣語音模型測試名稱"));
        assert!(!is_valid_candidate_term(&"語".repeat(MAX_TERM_CHARS + 1)));
    }
}
