//! Subtitle export helpers.
//!
//! Pure formatting functions that turn a list of `TimedSegment`s into
//! SubRip (`.srt`) or WebVTT (`.vtt`) text. No audio, no models, no I/O —
//! callers handle disk writes themselves so this module stays trivially
//! testable and never touches the dictation hot path.
//!
//! The shape matches `transcribe_rs::TranscriptionSegment` (start/end in
//! seconds + text) but we keep our own type so downstream code does not
//! have to depend on the engine crate.

use serde::{Deserialize, Serialize};
use specta::Type;

/// One transcribed segment with millisecond-resolution timing.
///
/// `start_ms` and `end_ms` are absolute offsets from the start of the
/// source audio, expressed in milliseconds. `text` is the segment's
/// transcript without leading/trailing whitespace.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TimedSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

impl TimedSegment {
    /// Build a `TimedSegment` from floating-point seconds. Negative
    /// values are clamped to 0 and `end` is forced to be `>= start` so
    /// the resulting timestamps are always well-ordered.
    pub fn from_seconds(start: f32, end: f32, text: impl Into<String>) -> Self {
        let start_ms = (start.max(0.0) * 1000.0).round() as u64;
        let mut end_ms = (end.max(0.0) * 1000.0).round() as u64;
        if end_ms < start_ms {
            end_ms = start_ms;
        }
        Self {
            start_ms,
            end_ms,
            text: text.into().trim().to_string(),
        }
    }
}

/// Format milliseconds as `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT).
fn format_timestamp(ms: u64, separator: char) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1_000;
    let millis = ms % 1_000;
    format!(
        "{:02}:{:02}:{:02}{}{:03}",
        hours, minutes, seconds, separator, millis
    )
}

/// Render a `Vec<TimedSegment>` as SubRip (`.srt`) text.
///
/// Each cue is numbered starting at 1. Empty segments are skipped so
/// engines that emit silence-only chunks do not produce blank cues.
pub fn to_srt(segments: &[TimedSegment]) -> String {
    let mut out = String::new();
    let mut cue_index = 0u32;
    for seg in segments {
        if seg.text.is_empty() {
            continue;
        }
        cue_index += 1;
        out.push_str(&cue_index.to_string());
        out.push('\n');
        out.push_str(&format_timestamp(seg.start_ms, ','));
        out.push_str(" --> ");
        out.push_str(&format_timestamp(seg.end_ms, ','));
        out.push('\n');
        out.push_str(&seg.text);
        out.push_str("\n\n");
    }
    out
}

/// Render a `Vec<TimedSegment>` as WebVTT (`.vtt`) text.
///
/// Adds the required `WEBVTT` header. Empty segments are skipped.
pub fn to_vtt(segments: &[TimedSegment]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for seg in segments {
        if seg.text.is_empty() {
            continue;
        }
        out.push_str(&format_timestamp(seg.start_ms, '.'));
        out.push_str(" --> ");
        out.push_str(&format_timestamp(seg.end_ms, '.'));
        out.push('\n');
        out.push_str(&seg.text);
        out.push_str("\n\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srt_formats_two_cues() {
        let segs = vec![
            TimedSegment::from_seconds(0.0, 1.5, "Hello world"),
            TimedSegment::from_seconds(1.5, 3.0, "Second line"),
        ];
        let out = to_srt(&segs);
        assert!(out.starts_with("1\n00:00:00,000 --> 00:00:01,500\nHello world\n\n"));
        assert!(out.contains("2\n00:00:01,500 --> 00:00:03,000\nSecond line\n\n"));
    }

    #[test]
    fn vtt_starts_with_header() {
        let segs = vec![TimedSegment::from_seconds(0.0, 1.0, "Hi")];
        let out = to_vtt(&segs);
        assert!(out.starts_with("WEBVTT\n\n"));
        assert!(out.contains("00:00:00.000 --> 00:00:01.000\nHi"));
    }

    #[test]
    fn empty_segments_skipped() {
        let segs = vec![
            TimedSegment::from_seconds(0.0, 1.0, "  "),
            TimedSegment::from_seconds(1.0, 2.0, "Real"),
        ];
        let srt = to_srt(&segs);
        assert!(!srt.contains("00:00:00,000"));
        assert!(srt.starts_with("1\n00:00:01,000"));
    }

    #[test]
    fn end_clamped_to_start() {
        let seg = TimedSegment::from_seconds(2.0, 1.0, "x");
        assert_eq!(seg.start_ms, 2000);
        assert_eq!(seg.end_ms, 2000);
    }

    #[test]
    fn negative_seconds_clamped() {
        let seg = TimedSegment::from_seconds(-1.0, -0.5, "x");
        assert_eq!(seg.start_ms, 0);
        assert_eq!(seg.end_ms, 0);
    }

    #[test]
    fn hour_boundary_formatting() {
        let seg = TimedSegment::from_seconds(3661.5, 3662.25, "after one hour");
        let srt = to_srt(&[seg]);
        assert!(srt.contains("01:01:01,500 --> 01:01:02,250"));
    }
}
