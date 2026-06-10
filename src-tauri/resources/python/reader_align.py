#!/usr/bin/env python3
"""Vox Jot Reader word aligner.

Produces precise per-word timings ("Whisper alignment") for synthesized reading
units so the reader can highlight each word as it is spoken.

Input: --manifest /abs/manifest.json

  {
    "language": "en" | null,
    "model": "base" | null,
    "items": [
      {"wav": "/abs/unit.wav", "text": "The spoken text.", "out": "/abs/unit.words.json"}
    ]
  }

For each item it writes `out` as a JSON array with one record per whitespace
token of `text` (index-aligned with the on-screen word spans):

  [{"text": "The", "start_ms": 0, "end_ms": 180}, ...]

The model is loaded once for the whole batch. If faster-whisper or the model is
unavailable, the process exits non-zero and the caller falls back to
deterministic proportional timings — word highlighting still works.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import wave
from pathlib import Path
from typing import Any


def wav_duration_ms(path: str) -> int:
    try:
        with wave.open(path, "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 1
            return int(round(frames * 1000 / rate))
    except Exception:
        return 0


_WORD_NORMALIZE_RE = re.compile(r"[^0-9a-zÀ-￿]+")


def normalize_word(value: str) -> str:
    """Lowercase, strip punctuation/spacing for char-rate alignment."""
    return _WORD_NORMALIZE_RE.sub("", value.lower())


def proportional_timings(tokens: list[str], duration_ms: int) -> list[dict[str, Any]]:
    if not tokens:
        return []
    weights: list[float] = []
    for token in tokens:
        chars = max(1, len(token))
        if token.endswith((".", "!", "?", "…", "。", "！", "？")):
            pause = 4.0
        elif token.endswith((",", ";", ":", "—", "–", "、", "，")):
            pause = 2.0
        else:
            pause = 0.0
        weights.append(chars + pause + 1.0)
    total = sum(weights) or 1.0
    duration = max(1, duration_ms)
    out: list[dict[str, Any]] = []
    acc = 0.0
    for index, token in enumerate(tokens):
        start = acc / total * duration
        acc += weights[index]
        end = acc / total * duration
        out.append({"text": token, "start_ms": int(round(start)), "end_ms": int(round(end))})
    if out:
        out[-1]["end_ms"] = duration_ms
    return out


def build_char_timeline(words: list[tuple[str, float, float]]) -> tuple[list[dict[str, float]], float]:
    """Cumulative normalized-char ranges mapped to time (ms) for whisper words."""
    timeline: list[dict[str, float]] = []
    cursor = 0.0
    for raw_text, start_s, end_s in words:
        chars = max(1, len(normalize_word(raw_text)))
        start_ms = max(0.0, start_s * 1000.0)
        end_ms = max(start_ms, end_s * 1000.0)
        timeline.append(
            {"c0": cursor, "c1": cursor + chars, "t0": start_ms, "t1": end_ms}
        )
        cursor += chars
    return timeline, cursor


def time_at_char(char_pos: float, timeline: list[dict[str, float]]) -> float:
    if not timeline:
        return 0.0
    if char_pos <= timeline[0]["c0"]:
        return timeline[0]["t0"]
    for segment in timeline:
        if char_pos <= segment["c1"]:
            span = segment["c1"] - segment["c0"]
            frac = (char_pos - segment["c0"]) / span if span > 0 else 0.0
            return segment["t0"] + frac * (segment["t1"] - segment["t0"])
    return timeline[-1]["t1"]


def align_item(
    model: Any,
    wav_path: str,
    text: str,
    language: str | None,
) -> list[dict[str, Any]]:
    tokens = text.split()
    if not tokens:
        return []
    duration_ms = wav_duration_ms(wav_path)

    words: list[tuple[str, float, float]] = []
    try:
        segments, _info = model.transcribe(
            wav_path,
            language=language,
            word_timestamps=True,
            beam_size=1,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        for segment in segments:
            for word in getattr(segment, "words", None) or []:
                if word.word and word.word.strip():
                    words.append((word.word, float(word.start), float(word.end)))
    except Exception:
        words = []

    timeline, total_chars = build_char_timeline(words)
    if total_chars <= 0 or duration_ms <= 0:
        return []

    # Map each known token's char fraction through whisper's char-rate-over-time
    # curve. Robust to tokenization differences while staying word-precise.
    known_lengths = [max(1, len(normalize_word(token))) for token in tokens]
    total_known = float(sum(known_lengths)) or 1.0
    out: list[dict[str, Any]] = []
    known_cursor = 0.0
    last_end = 0.0
    for index, token in enumerate(tokens):
        start_frac = known_cursor / total_known
        known_cursor += known_lengths[index]
        end_frac = known_cursor / total_known
        start_ms = time_at_char(start_frac * total_chars, timeline)
        end_ms = time_at_char(end_frac * total_chars, timeline)
        start_ms = max(start_ms, last_end)
        end_ms = max(end_ms, start_ms)
        last_end = end_ms
        out.append(
            {"text": token, "start_ms": int(round(start_ms)), "end_ms": int(round(end_ms))}
        )
    if out:
        out[-1]["end_ms"] = max(out[-1]["end_ms"], duration_ms)
    return out


def load_model(model_size: str) -> Any:
    from faster_whisper import WhisperModel  # type: ignore

    return WhisperModel(model_size, device="cpu", compute_type="int8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Align Reader unit audio to text.")
    parser.add_argument("--manifest", required=True, help="Alignment manifest JSON path")
    args = parser.parse_args()

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Failed to read alignment manifest: {exc}", file=sys.stderr)
        return 2

    items = manifest.get("items") or []
    if not items:
        return 0
    language = manifest.get("language") or None
    model_size = (
        manifest.get("model")
        or os.environ.get("VOX_JOT_READER_ALIGN_MODEL")
        or "base"
    )

    try:
        model = load_model(model_size)
    except Exception as exc:
        print(f"Reader aligner could not load model '{model_size}': {exc}", file=sys.stderr)
        return 3

    written = 0
    for item in items:
        wav_path = item.get("wav")
        out_path = item.get("out")
        text = item.get("text") or ""
        if not wav_path or not out_path or not text.strip():
            continue
        try:
            timings = align_item(model, wav_path, text, language)
            if not timings:
                continue
            tmp_path = f"{out_path}.tmp"
            Path(tmp_path).write_text(
                json.dumps(timings, ensure_ascii=False), encoding="utf-8"
            )
            os.replace(tmp_path, out_path)
            written += 1
        except Exception as exc:  # pragma: no cover - per-item robustness
            print(f"Reader alignment failed for {wav_path}: {exc}", file=sys.stderr)
            continue

    print(json.dumps({"aligned": written, "total": len(items)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
