//! Post-process routing and gating decisions.
//!
//! Determines whether a transcription needs LLM cleanup at all and, if so,
//! which "pass" to apply (Pass1, Pass2, Command). Pure heuristics on the
//! transcript text — no I/O, no LLM calls.

use serde::Serialize;
use specta::Type;

use super::sanitize::{contains_any_ci, has_any_case_insensitive, normalize_match_text};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PostProcessPass {
    /// Short, clean utterance — skip LLM entirely and use the plain text.
    Skip,
    Pass1,
    Pass2,
    Command,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct PostProcessRouteDebug {
    pub route: String,
    pub word_count: usize,
    pub has_correction_cue: bool,
    pub has_list_cue: bool,
    pub has_paragraph_cue: bool,
    pub has_transform_cue: bool,
    pub has_technical_tokens: bool,
    pub looks_incomplete: bool,
    pub score: i32,
}

#[derive(Debug, Clone)]
pub(super) struct RouteFeatures {
    pub(super) word_count: usize,
    pub(super) has_correction_cue: bool,
    pub(super) has_list_cue: bool,
    pub(super) has_paragraph_cue: bool,
    pub(super) has_transform_cue: bool,
    pub(super) has_technical_tokens: bool,
    pub(super) looks_incomplete: bool,
}

pub(super) fn filler_density(text: &str) -> f32 {
    let words: Vec<String> = text
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric())
                .to_ascii_lowercase()
        })
        .filter(|word| !word.is_empty())
        .collect();

    if words.is_empty() {
        return 0.0;
    }

    let single_word_fillers = ["um", "uh", "erm", "hmm", "like"];
    let mut filler_hits = words
        .iter()
        .filter(|word| single_word_fillers.contains(&word.as_str()))
        .count();

    let normalized = normalize_match_text(text);
    for phrase in ["you know", "i mean", "kind of", "sort of"] {
        if normalized.contains(phrase) {
            filler_hits += phrase.split_whitespace().count();
        }
    }

    filler_hits as f32 / words.len() as f32
}

pub(super) fn should_invoke_llm_post_process(
    features: &RouteFeatures,
    transcription: &str,
) -> bool {
    features.has_transform_cue
        || features.has_correction_cue
        || features.has_list_cue
        || features.has_paragraph_cue
        || features.word_count > 15
        || filler_density(transcription) >= 0.12
}

pub(super) fn has_spoken_correction_restart(text: &str) -> bool {
    let normalized = normalize_match_text(text);
    let direct_cues = [
        "scratch that",
        "i mean",
        "correction",
        "actually",
        "wait no",
        "no wait",
        "rather",
        "no sorry",
    ];
    if direct_cues.iter().any(|cue| normalized.contains(cue)) {
        return true;
    }

    let restart_markers = [
        ", no, ",
        ". no, ",
        "? no, ",
        "! no, ",
        "; no, ",
        ": no, ",
        ", sorry, ",
        ". sorry, ",
        "? sorry, ",
        "! sorry, ",
        "; sorry, ",
        ": sorry, ",
    ];

    restart_markers
        .iter()
        .any(|marker| normalized.contains(marker))
}

pub(super) fn looks_like_short_item_series(text: &str) -> bool {
    let items: Vec<String> = text
        .split(',')
        .map(|item| {
            item.trim()
                .trim_matches(|c: char| matches!(c, '.' | ',' | ';' | ':' | '!' | '?'))
                .to_string()
        })
        .filter(|item| !item.is_empty())
        .collect();

    if items.len() < 3 {
        return false;
    }

    items.iter().all(|item| {
        let word_count = item.split_whitespace().count();
        word_count > 0
            && word_count <= 4
            && !contains_any_ci(item, &[" and ", " or ", " because ", " but ", " if "])
    })
}

pub(super) fn has_intro_plus_short_items(text: &str) -> bool {
    let intro_cues = [
        "list",
        "things",
        "items",
        "store",
        "shopping",
        "grocery",
        "groceries",
        "verification",
        "verifications",
        "request",
        "pick up",
        "buy",
        "bring",
        "pack",
        "ingredients",
        "tasks",
        "to do",
        "todo",
        "goals",
    ];

    [".", ":", "\n"].iter().any(|separator| {
        let Some((intro, tail)) = text.split_once(separator) else {
            return false;
        };

        let intro = intro.trim();
        let tail = tail.trim();
        if intro.split_whitespace().count() < 4 || tail.is_empty() {
            return false;
        }

        contains_any_ci(intro, &intro_cues) && looks_like_short_item_series(tail)
    })
}

pub(super) fn has_technical_tokens(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let strong_tokens = [
        "http://", "https://", "www.", "@", "src/", ".tsx", ".ts", ".rs",
    ];
    if strong_tokens.iter().any(|token| lower.contains(token)) {
        return true;
    }

    text.chars().any(|c| {
        matches!(
            c,
            '/' | '\\' | '_' | '{' | '}' | '[' | ']' | '<' | '>' | '`'
        )
    })
}

pub(super) fn looks_incomplete_utterance(transcription: &str) -> bool {
    let trimmed = transcription.trim();
    if trimmed.is_empty() {
        return false;
    }

    let last_char = trimmed.chars().last().unwrap_or(' ');

    // Terminal sentence boundaries indicate a complete utterance
    if matches!(last_char, '.' | '!' | '?') {
        return false;
    }

    // A trailing comma is a strong signal of an incomplete clause
    if last_char == ',' {
        return true;
    }

    let lower = trimmed.to_ascii_lowercase();
    let trailing_fragment_cues = [" and", " or", " to", " for", " with", " because", " but"];
    trailing_fragment_cues
        .iter()
        .any(|cue| lower.ends_with(cue))
}

/// Check whether ordinal/number words appear in a genuine list-like context.
/// Single-word cues like "first", "then", "one" are common in everyday speech,
/// so we require at least two distinct ordinal cues AND >= 8 words.
pub(super) fn has_ordinal_list_cues(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let ordinal_words: &[&str] = &[
        "first", "second", "third", "next", "then", "one", "two", "three",
    ];

    let hit_count = ordinal_words
        .iter()
        .filter(|cue| {
            lower
                .split(|c: char| !c.is_alphanumeric())
                .any(|w| w == **cue)
        })
        .count();

    hit_count >= 2 && lower.split_whitespace().count() >= 8
}

pub(super) fn extract_route_features(transcription: &str) -> RouteFeatures {
    let trimmed = transcription.trim();
    let word_count = trimmed.split_whitespace().count();

    let list_cues = [
        "grocery list",
        "shopping list",
        "packing list",
        "required verification",
        "required verifications",
        "verification request",
        "verification requests",
    ];
    let paragraph_cues = ["new line", "new paragraph", "skip a line"];
    let transform_cues = [
        "make this shorter",
        "translate this",
        "turn this into",
        "rewrite this",
        "summarize this",
    ];

    let has_list_cue = contains_any_ci(trimmed, &list_cues)
        || has_ordinal_list_cues(trimmed)
        || has_intro_plus_short_items(trimmed);

    RouteFeatures {
        word_count,
        has_correction_cue: has_spoken_correction_restart(trimmed),
        has_list_cue,
        has_paragraph_cue: contains_any_ci(trimmed, &paragraph_cues),
        has_transform_cue: contains_any_ci(trimmed, &transform_cues),
        has_technical_tokens: has_technical_tokens(trimmed),
        looks_incomplete: looks_incomplete_utterance(trimmed),
    }
}

pub(super) fn route_score(features: &RouteFeatures) -> i32 {
    let mut score = 0;
    if features.has_correction_cue {
        score += 3;
    }
    if features.has_list_cue {
        score += 3;
    }
    if features.has_paragraph_cue {
        score += 2;
    }
    if features.word_count >= 12 {
        score += 1;
    }
    if features.has_technical_tokens {
        score -= 2;
    }
    score
}

pub(super) fn choose_post_process_pass(transcription: &str) -> PostProcessPass {
    let trimmed = transcription.trim();
    if trimmed.is_empty() {
        return PostProcessPass::Skip;
    }

    let features = extract_route_features(trimmed);

    if features.has_transform_cue {
        return PostProcessPass::Command;
    }
    if features.word_count <= 3 {
        return PostProcessPass::Skip;
    }
    if features.looks_incomplete {
        return PostProcessPass::Pass1;
    }
    if !should_invoke_llm_post_process(&features, trimmed) {
        return PostProcessPass::Skip;
    }

    let score = route_score(&features);

    if score >= 3 {
        PostProcessPass::Pass2
    } else {
        PostProcessPass::Pass1
    }
}

pub fn analyze_post_process_route(transcription: &str) -> PostProcessRouteDebug {
    let features = extract_route_features(transcription);
    let route = choose_post_process_pass(transcription);
    let score = route_score(&features);

    let route_label = match route {
        PostProcessPass::Skip => "skip",
        PostProcessPass::Pass1 => "pass1",
        PostProcessPass::Pass2 => "pass2",
        PostProcessPass::Command => "command",
    }
    .to_string();

    PostProcessRouteDebug {
        route: route_label,
        word_count: features.word_count,
        has_correction_cue: features.has_correction_cue,
        has_list_cue: features.has_list_cue,
        has_paragraph_cue: features.has_paragraph_cue,
        has_transform_cue: features.has_transform_cue,
        has_technical_tokens: features.has_technical_tokens,
        looks_incomplete: features.looks_incomplete,
        score,
    }
}

pub(super) fn should_force_conservative_rewrite(transcription: &str) -> bool {
    let trimmed = transcription.trim();
    if trimmed.is_empty() {
        return false;
    }

    let structure_cues = [
        "first", "second", "third", "next", "then", "step", "steps", "bullet", "numbered", "list",
    ];
    if has_spoken_correction_restart(trimmed)
        || has_any_case_insensitive(trimmed, &structure_cues)
        || has_intro_plus_short_items(trimmed)
    {
        return false;
    }

    let word_count = trimmed.split_whitespace().count();
    let has_terminal_boundary = trimmed
        .chars()
        .last()
        .map(|c| matches!(c, '.' | '!' | '?'))
        .unwrap_or(false);
    let has_newline = trimmed.contains('\n');
    let trailing_fragment_cues = [" and", " or", " to", " for", " with", " because"];
    let has_trailing_fragment = trailing_fragment_cues
        .iter()
        .any(|cue| trimmed.to_ascii_lowercase().ends_with(cue));

    if has_terminal_boundary || has_newline {
        return false;
    }

    word_count <= 8 || has_trailing_fragment
}

#[cfg(test)]
pub(super) fn live_partial_config_for_model(model_id: &str) -> (u64, usize, usize) {
    let lower = model_id.to_ascii_lowercase();

    if lower.contains("moonshine") && lower.contains("stream") {
        return (450, 8_000, 2_400);
    }
    if lower.contains("moonshine") {
        return (650, 12_000, 3_200);
    }
    if lower.contains("whisper") {
        return (1_200, 20_000, 6_400);
    }
    if lower.contains("parakeet") {
        return (900, 16_000, 4_800);
    }

    (900, 16_000, 4_800)
}
