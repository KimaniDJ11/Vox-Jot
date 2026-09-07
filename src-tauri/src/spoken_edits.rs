//! Conservative, deterministic spoken retractions.
//!
//! This pass intentionally supports only the unmistakable `scratch that`
//! command. When it cannot identify a safe edit boundary, it aborts delivery
//! instead of guessing and deleting unrelated words.

use crate::helpers::subtitles::TimedSegment;
use once_cell::sync::Lazy;
use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetractionResult {
    Unchanged(String),
    Edited {
        text: String,
        removed_span: String,
        cue_count: usize,
    },
    AbortPaste {
        reason: String,
        raw_transcript: String,
        cue_count: usize,
    },
}

static SCRATCH_THAT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bscratch\s+that(?:\s+please)?\b").unwrap());

static LITERAL_FOLLOWING_NOUNS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^\s*(?:itch|car|surface|screen|paint|glass|skin|furniture|metal|finish|head|record|disk|lens|door|phrase|command|words?|expression|behavior|means?)\b",
    )
    .unwrap()
});

static LITERAL_PRECEDING_PATTERNS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:don't|do not|never|to|can|will|cannot|could|would|please don't|words?|phrase|command|term|expression|literal|saying|say)\s*$",
    )
    .unwrap()
});

fn is_quote(ch: char) -> bool {
    matches!(ch, '"' | '\'' | '‘' | '’' | '“' | '”')
}

fn is_literal_usage(full_text: &str, match_start: usize, match_end: usize) -> bool {
    let preceding = &full_text[..match_start];
    let following = &full_text[match_end..];
    if LITERAL_PRECEDING_PATTERNS.is_match(preceding) || LITERAL_FOLLOWING_NOUNS.is_match(following)
    {
        return true;
    }

    let quoted_before = preceding
        .trim_end_matches(char::is_whitespace)
        .chars()
        .next_back()
        .is_some_and(is_quote);
    let quoted_after = following
        .trim_start_matches(char::is_whitespace)
        .chars()
        .next()
        .is_some_and(is_quote);
    quoted_before && quoted_after
}

pub fn has_retraction_command(text: &str) -> bool {
    SCRATCH_THAT_RE
        .find_iter(text)
        .any(|capture| !is_literal_usage(text, capture.start(), capture.end()))
}

fn capitalize_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn trim_separator_edges(text: &str) -> &str {
    text.trim_start_matches(|ch: char| {
        ch.is_whitespace() || matches!(ch, '.' | '!' | '?' | ',' | '—' | '–' | '-' | ';' | ':')
    })
    .trim_end_matches(|ch: char| {
        ch.is_whitespace() || matches!(ch, ',' | '—' | '–' | '-' | ';' | ':')
    })
}

fn trim_terminal_punctuation(text: &str) -> &str {
    text.trim_end_matches(|ch: char| {
        matches!(ch, '.' | '!' | '?' | ',' | ';' | ':' | '—' | '–' | '-')
    })
}

fn preceding_delimiter(text: &str, cue_start: usize) -> Option<char> {
    text[..cue_start]
        .trim_end_matches(char::is_whitespace)
        .chars()
        .next_back()
}

/// Locate the start of the segment immediately before a cue that begins its
/// own ASR segment. Segment text is matched conservatively against the final
/// transcript; if dictionary cleanup changed it too much, this returns None.
fn prior_timed_segment_start(
    text: &str,
    cue_start: usize,
    segments: &[TimedSegment],
) -> Option<usize> {
    if segments.len() < 2 {
        return None;
    }

    let mut cursor = 0usize;
    let mut located = Vec::new();
    for segment in segments {
        let segment_text = segment.text.trim();
        if segment_text.is_empty() {
            continue;
        }
        let remaining = text.get(cursor..)?;
        // Unicode lowercasing can change byte lengths (for example, Turkish İ).
        // Keep offsets in the original string; only ASCII has a byte-stable
        // case-insensitive fallback. A non-ASCII mismatch fails closed.
        let relative = remaining.find(segment_text).or_else(|| {
            segment_text
                .is_ascii()
                .then(|| {
                    remaining
                        .as_bytes()
                        .windows(segment_text.len())
                        .position(|candidate| {
                            candidate.eq_ignore_ascii_case(segment_text.as_bytes())
                        })
                })
                .flatten()
        })?;
        let start = cursor + relative;
        let end = start + segment_text.len();
        located.push((start, end));
        cursor = end;
    }

    let cue_segment_index = located
        .iter()
        .position(|(start, end)| cue_start >= *start && cue_start < *end)?;
    if cue_segment_index == 0 {
        return None;
    }
    let cue_segment = located[cue_segment_index];
    let cue_prefix = text
        .get(cue_segment.0..cue_start)?
        .trim_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, ',' | ';' | ':' | '—' | '–' | '-')
        });
    if !cue_prefix.is_empty() {
        return None;
    }

    Some(located[cue_segment_index - 1].0)
}

fn abort(text: &str, cue_count: usize, detail: &str) -> RetractionResult {
    RetractionResult::AbortPaste {
        reason: format!("Spoken cancellation was detected, but {detail}; nothing was pasted."),
        raw_transcript: text.to_string(),
        cue_count,
    }
}

fn apply_single_retraction(text: &str, segments: &[TimedSegment]) -> RetractionResult {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return RetractionResult::Unchanged(text.to_string());
    }

    let matches = SCRATCH_THAT_RE
        .find_iter(trimmed)
        .filter(|capture| !is_literal_usage(trimmed, capture.start(), capture.end()))
        .map(|capture| (capture.start(), capture.end()))
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return RetractionResult::Unchanged(text.to_string());
    }

    let (cue_start, cue_end) = matches[0];
    let preceding = trimmed[..cue_start].trim_end();
    let (following, tail) = if matches.len() > 1 {
        let next_start = matches[1].0;
        (&trimmed[cue_end..next_start], &trimmed[next_start..])
    } else {
        (&trimmed[cue_end..], "")
    };
    let preceding_clean = preceding.trim_end_matches(|ch: char| {
        ch.is_whitespace() || matches!(ch, '—' | '–' | '-' | ',' | ';' | ':')
    });
    let replacement = trim_separator_edges(following);
    let replacement_meaningful = replacement.chars().any(char::is_alphanumeric);

    if !replacement_meaningful && tail.is_empty() {
        if preceding_clean.is_empty() {
            return abort(text, 1, "the command cancelled the entire utterance");
        }

        let preceding_no_punct = trim_terminal_punctuation(preceding_clean);
        if let Some(delimiter_index) = preceding_no_punct.rfind(['.', '!', '?', ';']) {
            let remaining = preceding_no_punct[..=delimiter_index].trim();
            let removed = preceding_no_punct[delimiter_index + 1..].trim();
            if remaining.is_empty() || removed.is_empty() {
                return abort(text, 1, "no safe earlier edit boundary was available");
            }
            return RetractionResult::Edited {
                text: remaining.to_string(),
                removed_span: removed.to_string(),
                cue_count: 1,
            };
        }

        if let Some(unit_start) = prior_timed_segment_start(trimmed, cue_start, segments) {
            let remaining = trimmed[..unit_start].trim();
            let removed = trim_terminal_punctuation(trimmed[unit_start..cue_start].trim());
            if !remaining.is_empty() && !removed.is_empty() {
                return RetractionResult::Edited {
                    text: remaining.to_string(),
                    removed_span: removed.to_string(),
                    cue_count: 1,
                };
            }
        }

        return abort(text, 1, "the command cancelled the entire utterance");
    }

    if !replacement_meaningful {
        return abort(text, 1, "the replacement was empty or unclear");
    }

    if preceding_clean.is_empty() {
        let mut output = capitalize_first(replacement);
        if !tail.is_empty() {
            output.push(' ');
            output.push_str(tail.trim_start());
        }
        return RetractionResult::Edited {
            text: output,
            removed_span: String::new(),
            cue_count: 1,
        };
    }

    let replacement_words = replacement.split_whitespace().collect::<Vec<_>>();
    let preceding_words = preceding_clean.split_whitespace().collect::<Vec<_>>();
    let first_replacement = replacement_words
        .first()
        .map(|word| {
            word.trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_ascii_lowercase()
        })
        .unwrap_or_default();
    let starts_with_action = [
        "call", "send", "email", "make", "let", "lets", "meet", "go", "write", "say", "tell",
        "bring", "buy", "take", "give", "open", "close", "change",
    ]
    .contains(&first_replacement.as_str());
    let cue_is_delimited = preceding_delimiter(trimmed, cue_start)
        .is_some_and(|ch| matches!(ch, ',' | ';' | ':' | '—' | '–' | '-'));

    if cue_is_delimited
        && replacement_words.len() <= 3
        && !starts_with_action
        && preceding_words.len() > 1
    {
        let last_word = *preceding_words.last().unwrap_or(&"");
        let target = trim_terminal_punctuation(last_word);
        let base_len = preceding_clean.len().saturating_sub(last_word.len());
        let base = preceding_clean[..base_len].trim_end();
        let mut output = format!("{base} {replacement}");
        if !tail.is_empty() {
            if !output.ends_with([',', ';', ':', '—', '–', '-']) {
                output.push(',');
            }
            output.push(' ');
            output.push_str(tail.trim_start());
        } else if trimmed.ends_with('.') && !output.ends_with(['.', '!', '?']) {
            output.push('.');
        }
        return RetractionResult::Edited {
            text: output,
            removed_span: target.to_string(),
            cue_count: 1,
        };
    }

    let sentence_ended =
        preceding_delimiter(trimmed, cue_start).is_some_and(|ch| matches!(ch, '.' | '!' | '?'));
    let preceding_without_terminal = trim_terminal_punctuation(preceding_clean);
    let boundary = preceding_without_terminal
        .rfind([';', '.', '!', '?', '—', '–'])
        .map(|index| {
            index
                + preceding_without_terminal[index..]
                    .chars()
                    .next()
                    .unwrap()
                    .len_utf8()
        })
        .or_else(|| prior_timed_segment_start(trimmed, cue_start, segments))
        .or_else(|| ((cue_is_delimited && starts_with_action) || sentence_ended).then_some(0));
    let Some(unit_start) = boundary else {
        return abort(text, 1, "the preceding edit boundary was ambiguous");
    };

    let prefix = preceding_clean[..unit_start].trim();
    let removed = preceding_clean[unit_start..].trim();
    if removed.is_empty() {
        return abort(text, 1, "the preceding edit unit was empty");
    }
    let mut output = if prefix.is_empty() {
        capitalize_first(replacement)
    } else {
        format!("{prefix} {}", capitalize_first(replacement))
    };
    if !tail.is_empty() {
        if !output.ends_with([',', ';', ':', '—', '–', '-']) {
            output.push(',');
        }
        output.push(' ');
        output.push_str(tail.trim_start());
    } else if trimmed.ends_with('.') && !output.ends_with(['.', '!', '?']) {
        output.push('.');
    }

    RetractionResult::Edited {
        text: output,
        removed_span: removed.to_string(),
        cue_count: 1,
    }
}

pub fn apply_spoken_retraction(text: &str, segments: &[TimedSegment]) -> RetractionResult {
    let mut current = text.to_string();
    let mut removed = Vec::new();
    let mut cue_count = 0usize;

    for _ in 0..8 {
        match apply_single_retraction(&current, segments) {
            RetractionResult::Unchanged(_) => break,
            RetractionResult::AbortPaste { reason, .. } => {
                return RetractionResult::AbortPaste {
                    reason,
                    raw_transcript: text.to_string(),
                    cue_count: cue_count + 1,
                };
            }
            RetractionResult::Edited {
                text: next,
                removed_span,
                cue_count: count,
            } => {
                cue_count += count;
                if !removed_span.is_empty() {
                    removed.push(removed_span);
                }
                current = next;
            }
        }
    }

    if has_retraction_command(&current) {
        return abort(
            text,
            cue_count,
            "too many cancellation commands remained to edit safely",
        );
    }

    if cue_count == 0 {
        RetractionResult::Unchanged(text.to_string())
    } else {
        RetractionResult::Edited {
            text: current,
            removed_span: removed.join("; "),
            cue_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(text: &str) -> RetractionResult {
        apply_spoken_retraction(text, &[])
    }

    #[test]
    fn action_replacement() {
        assert!(matches!(
            apply("Call Greg—scratch that—call Sarah."),
            RetractionResult::Edited { text, .. } if text == "Call Sarah."
        ));
        assert!(matches!(
            apply("Call Greg. Scratch that. Call Sarah."),
            RetractionResult::Edited { text, .. } if text == "Call Sarah."
        ));
        assert!(matches!(
            apply("Keep this. Call Greg. Scratch that, call Sarah."),
            RetractionResult::Edited { text, .. } if text == "Keep this. Call Sarah."
        ));
    }

    #[test]
    fn value_replacement() {
        assert!(matches!(
            apply("The meeting is at three; scratch that, four."),
            RetractionResult::Edited { text, removed_span, .. }
                if text == "The meeting is at four." && removed_span == "three"
        ));
    }

    #[test]
    fn terminal_single_thought_aborts() {
        assert!(matches!(
            apply("Never mind, scratch that."),
            RetractionResult::AbortPaste { .. }
        ));
    }

    #[test]
    fn terminal_command_retracts_only_last_sentence() {
        assert!(matches!(
            apply("We will release on Friday. Send the email now. Scratch that."),
            RetractionResult::Edited { text, .. } if text == "We will release on Friday."
        ));
    }

    #[test]
    fn multiple_cues() {
        assert!(matches!(
            apply("Let's meet at two, scratch that, three, scratch that, four."),
            RetractionResult::Edited { text, cue_count: 2, .. } if text == "Let's meet at four."
        ));
    }

    #[test]
    fn literal_and_quoted_uses_are_unchanged() {
        for text in [
            "Be careful not to scratch that surface.",
            "Please don't scratch that car.",
            "He said the words scratch that yesterday.",
            "The command scratch that means remove the previous phrase.",
            "She literally said \"scratch that\" in the recording.",
        ] {
            assert_eq!(apply(text), RetractionResult::Unchanged(text.to_string()));
        }
    }

    #[test]
    fn ambiguous_boundary_aborts_instead_of_guessing() {
        assert!(matches!(
            apply("Review the deployment scratch that use the staging deployment"),
            RetractionResult::AbortPaste { .. }
        ));
    }

    #[test]
    fn timed_segment_boundary_can_make_retraction_safe() {
        let segments = vec![
            TimedSegment::from_seconds(0.0, 0.8, "Keep this sentence".to_string()),
            TimedSegment::from_seconds(1.1, 1.8, "replace this part".to_string()),
            TimedSegment::from_seconds(2.1, 2.8, "scratch that send the update".to_string()),
        ];
        assert!(matches!(
            apply_spoken_retraction(
                "Keep this sentence replace this part scratch that send the update",
                &segments,
            ),
            RetractionResult::Edited { text, .. } if text == "Keep this sentence Send the update"
        ));
    }

    #[test]
    fn timed_segment_offsets_remain_valid_for_unicode() {
        let segments = vec![
            TimedSegment::from_seconds(0.0, 0.8, "İstanbul plan".to_string()),
            TimedSegment::from_seconds(1.1, 1.8, "replace this part".to_string()),
            TimedSegment::from_seconds(2.1, 2.8, "scratch that send the update".to_string()),
        ];
        assert!(matches!(
            apply_spoken_retraction("İstanbul plan replace this part scratch that send the update", &segments),
            RetractionResult::Edited { text, .. } if text == "İstanbul plan Send the update"
        ));
    }

    #[test]
    fn excessive_commands_abort_instead_of_pasting_an_unhandled_cue() {
        let text = format!("Meet at one, {}ten.", "scratch that, two, ".repeat(9));
        assert!(matches!(apply(&text), RetractionResult::AbortPaste { .. }));
    }
}
