//! Output sanitization, parsing helpers, and text-comparison utilities.
//!
//! Pure-string helpers used across the post-process pipeline: stripping
//! markdown wrappers, parsing structured-output JSON, comparing the LLM
//! candidate against the raw transcription, and detecting suspicious
//! prompt-leak/refusal artifacts.

use crate::settings::AutoSubmitKey;
use log::debug;

use super::route::has_spoken_correction_restart;

/// Field name for structured output JSON schema
pub(super) const TRANSCRIPTION_FIELD: &str = "transcription";

pub(super) fn first_match_index(text: &str, patterns: &[&str]) -> Option<usize> {
    patterns
        .iter()
        .filter_map(|pattern| text.find(pattern))
        .min()
}

pub(super) fn maybe_apply_verification_request_fallback(
    raw_text: &str,
    final_text: &str,
) -> Option<String> {
    let normalized_raw = normalize_match_text(raw_text);
    let normalized_final = normalize_match_text(final_text);
    let starts_like_request = normalized_raw.starts_with("required verification request")
        || normalized_raw.starts_with("required verifications request");
    let likely_unstructured = normalized_final == normalized_raw
        || normalized_final.contains(" i meant ")
        || !final_text
            .lines()
            .any(|line| line.trim_start().starts_with("* "));

    if !starts_like_request || !likely_unstructured {
        return None;
    }

    let mut items: Vec<(usize, &'static str)> = Vec::new();

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &[
            "government-issued id",
            "government issued id",
            "government issue id",
        ],
    ) {
        items.push((pos, "Government-issued ID"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &["conduct in-person meeting", "conduct in person meeting"],
    ) {
        items.push((pos, "Conduct in-person meeting"));
    }

    if let Some(pos) = first_match_index(&normalized_raw, &["employment verification"]) {
        items.push((pos, "Employment verification"));
    }

    if let Some(pos) = first_match_index(&normalized_raw, &["income documentation"]) {
        items.push((pos, "Income documentation"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &["personal references", "personal reference"],
    ) {
        items.push((pos, "Personal references"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &[
            "previous landlord reference",
            "i meant previous landlord reference",
        ],
    ) {
        items.push((pos, "Previous landlord reference"));
    } else if let Some(pos) = first_match_index(&normalized_raw, &["previous reference"]) {
        items.push((pos, "Previous reference"));
    }

    if let Some(pos) = first_match_index(&normalized_raw, &["credit check"]) {
        items.push((pos, "Credit check"));
    }

    if let Some(pos) = first_match_index(
        &normalized_raw,
        &["social security verification", "security verification"],
    ) {
        items.push((pos, "Social security verification"));
    }

    if items.len() < 3 {
        return None;
    }

    items.sort_by_key(|(pos, _)| *pos);
    items.dedup_by(|a, b| a.1 == b.1);

    let bullets = items
        .into_iter()
        .map(|(_, item)| format!("* {}", item))
        .collect::<Vec<_>>()
        .join("\n");

    Some(format!("Required Verification Request:\n{}", bullets))
}

/// Strip invisible Unicode characters that some LLMs may insert
pub(super) fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

pub(super) fn estimate_text_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(4)
}

pub(super) fn unwrap_markdown_code_fence(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return None;
    }

    let closing = trimmed.rfind("```")?;
    if closing <= 3 {
        return None;
    }

    let inner = &trimmed[3..closing];
    let inner = inner.strip_prefix("json").unwrap_or(inner);
    let inner = inner.strip_prefix("JSON").unwrap_or(inner);
    Some(inner.trim().to_string())
}

pub(super) fn looks_like_structured_blob(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    trimmed.starts_with('{')
        || trimmed.starts_with('[')
        || trimmed.starts_with("```")
        || trimmed.contains("```")
        || trimmed.starts_with("<think")
        || trimmed.starts_with("<analysis")
        || trimmed.starts_with("---")
        || trimmed.contains("\n---")
        || trimmed.contains("-->")
}

pub(super) fn looks_like_prompt_artifact(text: &str) -> bool {
    let lower = text.trim().to_ascii_lowercase();
    let direct_markers = [
        "additional system instruction",
        "strict output now applied",
        "transcript output",
        "no input processed for output",
        "dictate or append exact content",
        "as spoken, no changes",
        "no punctuation added",
        "understand prompt structure",
        "optimize for output quality",
        "format as dictation post-processor",
        "dictation post-processor strictly",
        "adapt tone/mode dynamically",
        "fulfill specific user requests",
        "without alteration or commentary",
        "return only the final text",
        "do not explain changes",
        "do not mention rules",
        "active mode:",
        "rewrite strength:",
        "additional custom instructions:",
        "assistant:",
        "user query:",
        "system:",
        "suggested rewrite:",
    ];

    if direct_markers.iter().any(|marker| lower.contains(marker)) {
        return true;
    }

    let suspicious_instruction_markers = [
        "preserve meaning",
        "handle corrections",
        "prompt structure",
        "output quality",
        "tone/mode",
        "personal dictionary",
        "local dictation post-processor",
    ];
    let suspicious_marker_hits = suspicious_instruction_markers
        .iter()
        .filter(|marker| lower.contains(**marker))
        .count();

    suspicious_marker_hits >= 2
        || (lower.contains("no changes") && text.contains('('))
        || (text.lines().count() > 5
            && (text.contains("**") || text.contains("---") || text.contains("```")))
}

pub(super) fn strip_wrapping_quotes(text: &str) -> String {
    let trimmed = text.trim();
    let pairs = [('\"', '\"'), ('\'', '\''), ('“', '”')];

    for (left, right) in pairs {
        if trimmed.starts_with(left) && trimmed.ends_with(right) && trimmed.len() >= 2 {
            let inner = trimmed[left.len_utf8()..trimmed.len() - right.len_utf8()].trim();
            if !inner.is_empty() && !inner.contains('\n') {
                return inner.to_string();
            }
        }
    }

    trimmed.to_string()
}

pub(super) fn strip_simple_markdown_wrappers(text: &str) -> String {
    let trimmed = text.trim();
    for marker in ["**", "__", "*", "_"] {
        if trimmed.starts_with(marker)
            && trimmed.ends_with(marker)
            && trimmed.len() > marker.len() * 2
        {
            let inner = trimmed[marker.len()..trimmed.len() - marker.len()].trim();
            if !inner.is_empty() && !inner.contains('\n') {
                return inner.to_string();
            }
        }
    }

    trimmed.to_string()
}

pub(super) fn compare_tokens(text: &str) -> Vec<String> {
    let mut normalized = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '\'' {
            normalized.push(ch.to_ascii_lowercase());
        } else {
            normalized.push(' ');
        }
    }

    normalized
        .split_whitespace()
        .map(|token| token.to_string())
        .collect()
}

pub(crate) fn should_fallback_to_plain_text_candidate(candidate: &str, fallback: &str) -> bool {
    let candidate_tokens = compare_tokens(candidate);
    let fallback_tokens = compare_tokens(fallback);

    if candidate_tokens.is_empty() || fallback_tokens.is_empty() {
        return false;
    }

    let shared = candidate_tokens
        .iter()
        .filter(|token| fallback_tokens.contains(token))
        .count();
    let overlap = shared as f32 / fallback_tokens.len() as f32;

    let suspicious_expansion = fallback_tokens.len() <= 4
        && candidate_tokens.len() >= fallback_tokens.len() + 3
        && overlap < 0.9;
    let suspicious_truncation = fallback_tokens.len() >= 4
        && candidate_tokens.len() + 2 <= fallback_tokens.len()
        && overlap < 0.9;
    let suspicious_two_word_collapse =
        fallback_tokens.len() == 2 && candidate_tokens.len() == 1 && overlap < 0.99;

    // Dramatic expansion on any length — LLM answered instead of cleaning.
    // Candidate is more than 2x longer with less-than-perfect overlap.
    // When output is dramatically longer, even high overlap is suspicious
    // because common words inflate the ratio.
    let expansion_ratio = candidate_tokens.len() as f32 / fallback_tokens.len().max(1) as f32;
    let overlap_threshold = if expansion_ratio > 4.0 {
        0.95
    } else if expansion_ratio > 3.0 {
        0.85
    } else {
        0.6
    };
    let suspicious_dramatic_expansion = candidate_tokens.len() > fallback_tokens.len() * 2
        && candidate_tokens.len() >= fallback_tokens.len() + 10
        && overlap < overlap_threshold;

    suspicious_expansion
        || suspicious_truncation
        || suspicious_two_word_collapse
        || suspicious_dramatic_expansion
}

pub(super) fn strip_common_output_label(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let lines: Vec<&str> = trimmed.lines().collect();
    if lines.len() < 2 {
        return None;
    }

    let first = lines[0].trim().to_ascii_lowercase();
    let labeled_prefixes = [
        "here is the cleaned transcript",
        "here's the cleaned transcript",
        "cleaned transcript",
        "corrected transcript",
        "final transcript",
        "final text",
        "rewritten text",
        "transcription",
        "output",
    ];

    if labeled_prefixes
        .iter()
        .any(|prefix| first == *prefix || first == format!("{prefix}:"))
    {
        let rest = lines[1..].join("\n").trim().to_string();
        if !rest.is_empty() {
            return Some(rest);
        }
    }

    None
}

pub(super) fn parse_transcription_field_from_json(content: &str) -> Option<String> {
    let raw = content.trim();
    let candidate = if raw.starts_with("```") {
        unwrap_markdown_code_fence(raw)?
    } else {
        raw.to_string()
    };

    let json = serde_json::from_str::<serde_json::Value>(&candidate).ok()?;
    json.get(TRANSCRIPTION_FIELD)
        .and_then(|t| t.as_str())
        .map(|value| strip_invisible_chars(value).trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn sanitize_plain_model_output(content: &str) -> Option<String> {
    let cleaned = strip_invisible_chars(content).trim().to_string();
    if cleaned.is_empty() {
        return None;
    }

    let candidate = strip_common_output_label(&cleaned).unwrap_or(cleaned);
    let candidate = strip_wrapping_quotes(&candidate);
    let candidate = strip_simple_markdown_wrappers(&candidate);
    let candidate = candidate.trim().to_string();
    if candidate.is_empty() {
        return None;
    }

    if looks_like_meta_refusal(&candidate)
        || looks_like_structured_blob(&candidate)
        || looks_like_prompt_artifact(&candidate)
    {
        return None;
    }

    Some(candidate)
}

pub(crate) fn should_block_paste_candidate(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    if looks_like_structured_blob(trimmed) {
        return true;
    }

    if looks_like_prompt_artifact(trimmed) {
        return true;
    }

    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("here is the cleaned transcript")
        || lower.starts_with("here's the cleaned transcript")
        || lower.starts_with("cleaned transcript:")
        || lower.starts_with("corrected transcript:")
        || lower.starts_with("final transcript:")
        || lower.starts_with("final text:")
        || lower.starts_with("rewritten text:")
}

pub(super) fn strip_spoken_suffix(input: &str, suffix: &str) -> Option<String> {
    let candidate = input
        .trim_end()
        .trim_end_matches(['.', ',', '!', '?', ';', ':']);

    if candidate.len() < suffix.len() {
        return None;
    }

    let start = candidate.len() - suffix.len();
    let tail = candidate.get(start..)?;
    if !tail.eq_ignore_ascii_case(suffix) {
        return None;
    }

    let raw_prefix = candidate.get(..start)?;
    if let Some(last) = raw_prefix.chars().last() {
        if !last.is_whitespace() && !matches!(last, ',' | ':' | ';' | '-' | '(' | '[') {
            return None;
        }
    }

    let prefix = raw_prefix.trim_end();
    Some(prefix.trim_end_matches([',', ':', ';']).trim().to_string())
}

/// Heuristic to detect meta/refusal-style LLM responses that should not be pasted
pub(super) fn looks_like_meta_refusal(text: &str) -> bool {
    let lower = text.trim_start().to_ascii_lowercase();
    let refusal_patterns = [
        "i'm unable to",
        "i am unable to",
        "i cannot complete",
        "i can't complete",
        "please provide",
        "i need more context",
        "i don't have enough",
        "i do not have enough",
        "i'm sorry, but",
        "i am sorry, but",
    ];
    refusal_patterns.iter().any(|p| lower.starts_with(p))
}

pub(crate) fn extract_spoken_submit_command(text: &str) -> (String, Option<AutoSubmitKey>) {
    let candidates = [
        ("send with control enter", AutoSubmitKey::CtrlEnter),
        ("send with ctrl enter", AutoSubmitKey::CtrlEnter),
        ("press control enter", AutoSubmitKey::CtrlEnter),
        ("press ctrl enter", AutoSubmitKey::CtrlEnter),
        ("send with command enter", AutoSubmitKey::CmdEnter),
        ("send with cmd enter", AutoSubmitKey::CmdEnter),
        ("press command enter", AutoSubmitKey::CmdEnter),
        ("press cmd enter", AutoSubmitKey::CmdEnter),
        ("press enter", AutoSubmitKey::Enter),
        ("hit enter", AutoSubmitKey::Enter),
        ("send message", AutoSubmitKey::Enter),
        ("and send", AutoSubmitKey::Enter),
        ("and submit", AutoSubmitKey::Enter),
        ("submit", AutoSubmitKey::Enter),
        ("send", AutoSubmitKey::Enter),
    ];

    for (phrase, key) in candidates {
        if let Some(stripped) = strip_spoken_suffix(text, phrase) {
            if !stripped.is_empty() {
                return (stripped, Some(key));
            }
        }
    }

    (text.to_string(), None)
}

/// Compute the fraction of words in `a` that also appear in `b` (case-insensitive).
pub(super) fn word_overlap_ratio(a: &str, b: &str) -> f64 {
    let words_a: Vec<String> = a
        .split_whitespace()
        .map(|w| w.to_ascii_lowercase())
        .collect();
    if words_a.is_empty() {
        return 0.0;
    }
    let words_b: std::collections::HashSet<String> = b
        .split_whitespace()
        .map(|w| w.to_ascii_lowercase())
        .collect();

    let matched = words_a.iter().filter(|w| words_b.contains(*w)).count();
    matched as f64 / words_a.len() as f64
}

/// Count the number of word-level substitutions between two texts
/// (simple positional diff on whitespace-split words, case-insensitive).
pub(super) fn count_word_substitutions(a: &str, b: &str) -> usize {
    let wa: Vec<String> = a
        .split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| c.is_ascii_punctuation())
                .to_ascii_lowercase()
        })
        .collect();
    let wb: Vec<String> = b
        .split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| c.is_ascii_punctuation())
                .to_ascii_lowercase()
        })
        .collect();

    if wa.len() != wb.len() {
        return usize::MAX;
    }

    wa.iter().zip(wb.iter()).filter(|(a, b)| a != b).count()
}

/// Post-LLM drift gate: returns `true` when the LLM candidate has drifted too
/// far from the raw transcription and the plain text should be used instead.
pub(super) fn should_fallback_to_plain_text_drift(
    raw_text: &str,
    candidate: &str,
    normalized_text: &str,
) -> bool {
    let raw_words = raw_text.split_whitespace().count();
    let candidate_words = candidate.split_whitespace().count();

    if raw_words == 0 {
        return false;
    }

    // Gate 1: Very low word-overlap for short texts — likely hallucination.
    if raw_words <= 12 {
        let overlap = word_overlap_ratio(raw_text, candidate);
        if overlap < 0.50 {
            debug!(
                "Drift gate: low overlap ({:.2}) for short utterance ({} words)",
                overlap, raw_words
            );
            return true;
        }
    }

    // Gate 2: LLM answered a question or generated content instead of cleaning.
    // Detect dramatic expansion with low overlap — the hallmark of the LLM
    // treating dictation as a conversational prompt.
    if candidate_words > raw_words * 2 && candidate_words >= raw_words + 10 {
        let overlap = word_overlap_ratio(raw_text, candidate);
        if overlap < 0.60 {
            debug!(
                "Drift gate: dramatic expansion ({} -> {} words, overlap {:.2}) — LLM likely answered instead of cleaning",
                raw_words, candidate_words, overlap
            );
            return true;
        }
    }

    // Gate 3: Low overlap on any length — the LLM produced substantially
    // different content regardless of length change.
    if raw_words > 4 {
        let overlap = word_overlap_ratio(raw_text, candidate);
        if overlap < 0.35 {
            debug!(
                "Drift gate: very low overlap ({:.2}) for {} word utterance — likely hallucination",
                overlap, raw_words
            );
            return true;
        }
    }

    // Gate 4: Response contains markdown formatting (bold, headers, bullets
    // with bold) that wasn't in the original — suggests conversational answer.
    let has_markdown_formatting = candidate.contains("**")
        || candidate.contains("##")
        || candidate.contains("* **")
        || candidate.contains("- **");
    let raw_had_markdown = raw_text.contains("**") || raw_text.contains("##");
    if has_markdown_formatting && !raw_had_markdown {
        debug!("Drift gate: candidate contains markdown formatting not present in raw text");
        return true;
    }

    // Gate 5: Minor edits on short, well-formed text.
    let raw_trimmed = raw_text.trim();
    let has_terminal = raw_trimmed
        .chars()
        .last()
        .map(|c| matches!(c, '.' | '!' | '?'))
        .unwrap_or(false);

    if has_terminal && raw_words <= 12 {
        let norm_words = normalized_text.split_whitespace().count();

        // (a) Same word count but 1-2 substitutions
        let subs = count_word_substitutions(normalized_text, candidate);
        if (1..=2).contains(&subs) && candidate_words == norm_words {
            debug!(
                "Drift gate: {} minor word swap(s) on clean short utterance ({} words)",
                subs, raw_words
            );
            return true;
        }

        // (b) Word count changed on clean text without correction cues
        if candidate_words != norm_words && !has_spoken_correction_restart(raw_text) {
            let overlap = word_overlap_ratio(raw_text, candidate);
            if overlap >= 0.50 {
                debug!(
                    "Drift gate: word count changed ({} -> {}) on clean short utterance",
                    norm_words, candidate_words
                );
                return true;
            }
        }
    }

    false
}

pub(super) fn contains_any_ci(text: &str, cues: &[&str]) -> bool {
    let lower = text.to_ascii_lowercase();
    cues.iter().any(|cue| lower.contains(cue))
}

pub(super) fn normalize_match_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

pub(super) fn has_any_case_insensitive(text: &str, cues: &[&str]) -> bool {
    let lower = text.to_ascii_lowercase();
    cues.iter().any(|cue| lower.contains(cue))
}
