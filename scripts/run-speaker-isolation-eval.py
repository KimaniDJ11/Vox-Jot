#!/usr/bin/env python3
"""Run the speaker-isolation fixture through speech-analysis diarization adapters."""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from functools import lru_cache
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_MODELS = (
    "pyannote-community-1",
    "pyannote-3-1",
    "mlx-sortformer-4spk-v1",
    "mlx-sortformer-4spk-v2-1",
    "reverb-diarization-v2",
    "whisper-diarization",
    "onnx-polyvoice-diarization",
)


def default_model_root() -> Path:
    if platform.system() == "Darwin":
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "com.iriedinamik.voxjot"
            / "models"
            / "speech-analysis"
        )
    return (
        Path.home()
        / ".local"
        / "share"
        / "com.iriedinamik.voxjot"
        / "models"
        / "speech-analysis"
    )


def interval_overlap(start_a: int, end_a: int, start_b: int, end_b: int) -> int:
    return max(0, min(end_a, end_b) - max(start_a, start_b))


def optimal_cluster_map(
    predicted_speakers: list[str],
    truth_speakers: list[str],
    overlap_by_pair: dict[tuple[str, str], int],
) -> dict[str, str]:
    """Maximize overlap with a one-to-one speaker mapping."""

    @lru_cache(maxsize=None)
    def solve(predicted_index: int, used_truth_mask: int) -> tuple[int, tuple[int, ...]]:
        if predicted_index == len(predicted_speakers):
            return 0, ()
        best_score, best_assignment = solve(predicted_index + 1, used_truth_mask)
        best_assignment = (-1, *best_assignment)
        predicted = predicted_speakers[predicted_index]
        for truth_index, truth in enumerate(truth_speakers):
            bit = 1 << truth_index
            if used_truth_mask & bit:
                continue
            tail_score, tail_assignment = solve(predicted_index + 1, used_truth_mask | bit)
            candidate_score = overlap_by_pair.get((predicted, truth), 0) + tail_score
            candidate_assignment = (truth_index, *tail_assignment)
            if candidate_score > best_score or (
                candidate_score == best_score and candidate_assignment < best_assignment
            ):
                best_score = candidate_score
                best_assignment = candidate_assignment
        return best_score, best_assignment

    if not predicted_speakers or not truth_speakers:
        return {}
    _, assignment = solve(0, 0)
    return {
        predicted: truth_speakers[truth_index]
        for predicted, truth_index in zip(predicted_speakers, assignment)
        if truth_index >= 0
    }


def score_turns(
    predicted_turns: list[dict[str, Any]],
    truth_turns: list[dict[str, Any]],
) -> dict[str, Any]:
    total_truth_ms = sum(int(turn["end_ms"]) - int(turn["start_ms"]) for turn in truth_turns)
    if total_truth_ms <= 0:
        raise ValueError("truth fixture has no speech duration")

    overlap_by_pair: dict[tuple[str, str], int] = {}
    for predicted in predicted_turns:
        predicted_speaker = str(predicted.get("speaker_id", "UNKNOWN"))
        for truth in truth_turns:
            truth_speaker = str(truth["speaker_id"])
            overlap = interval_overlap(
                int(predicted["start_ms"]),
                int(predicted["end_ms"]),
                int(truth["start_ms"]),
                int(truth["end_ms"]),
            )
            if overlap:
                key = (predicted_speaker, truth_speaker)
                overlap_by_pair[key] = overlap_by_pair.get(key, 0) + overlap

    predicted_speakers = sorted({str(turn.get("speaker_id", "UNKNOWN")) for turn in predicted_turns})
    truth_speakers = sorted({str(turn["speaker_id"]) for turn in truth_turns})
    cluster_map = optimal_cluster_map(predicted_speakers, truth_speakers, overlap_by_pair)

    boundaries = sorted(
        {
            int(turn[key])
            for turn in [*truth_turns, *predicted_turns]
            for key in ("start_ms", "end_ms")
        }
    )
    missed_ms = 0
    false_alarm_ms = 0
    confusion_ms = 0
    detected_truth_ms = 0
    speaker_intersection_ms = {speaker: 0 for speaker in truth_speakers}
    speaker_union_ms = {speaker: 0 for speaker in truth_speakers}
    inverse_map = {truth: predicted for predicted, truth in cluster_map.items()}
    for start, end in zip(boundaries, boundaries[1:]):
        duration = end - start
        if duration <= 0:
            continue
        truth_active = {
            str(turn["speaker_id"])
            for turn in truth_turns
            if int(turn["start_ms"]) < end and int(turn["end_ms"]) > start
        }
        predicted_active = {
            str(turn.get("speaker_id", "UNKNOWN"))
            for turn in predicted_turns
            if int(turn["start_ms"]) < end and int(turn["end_ms"]) > start
        }
        matched = sum(
            1
            for predicted in predicted_active
            if cluster_map.get(predicted) in truth_active
        )
        reference_count = len(truth_active)
        predicted_count = len(predicted_active)
        detected_truth_ms += min(reference_count, predicted_count) * duration
        missed_ms += max(0, reference_count - predicted_count) * duration
        false_alarm_ms += max(0, predicted_count - reference_count) * duration
        confusion_ms += max(0, min(reference_count, predicted_count) - matched) * duration
        for truth_speaker in truth_speakers:
            reference_present = truth_speaker in truth_active
            predicted_present = inverse_map.get(truth_speaker) in predicted_active
            if reference_present and predicted_present:
                speaker_intersection_ms[truth_speaker] += duration
            if reference_present or predicted_present:
                speaker_union_ms[truth_speaker] += duration

    coverage = detected_truth_ms / total_truth_ms
    missed_rate = missed_ms / total_truth_ms
    confusion_rate = confusion_ms / total_truth_ms
    false_alarm_rate = false_alarm_ms / total_truth_ms
    der = missed_rate + confusion_rate + false_alarm_rate
    speaker_jaccard_errors = {
        speaker: 1.0
        - speaker_intersection_ms[speaker] / max(1, speaker_union_ms[speaker])
        for speaker in truth_speakers
    }
    jer = sum(speaker_jaccard_errors.values()) / max(1, len(speaker_jaccard_errors))

    return {
        "speaker_count": len(predicted_speakers),
        "turn_count": len(predicted_turns),
        "coverage": round(coverage, 3),
        "missed_speech_rate": round(missed_rate, 3),
        "confusion_rate": round(confusion_rate, 3),
        "false_alarm_rate": round(false_alarm_rate, 3),
        "der": round(der, 3),
        "jaccard_error_rate": round(jer, 3),
        "speaker_jaccard_errors": {
            speaker: round(value, 3) for speaker, value in speaker_jaccard_errors.items()
        },
        "cluster_map": cluster_map,
        "speaker_mapping_method": "optimal_speaker_mapping_v2",
        "sample_turns": predicted_turns[:8],
    }


def run_model(model_id: str, audio_path: Path, sidecar_path: Path, env: dict[str, str]) -> dict[str, Any]:
    asr_model = "whisper-diarization" if model_id == "whisper-diarization" else "current_dictation_engine"
    command = [
        sys.executable,
        str(sidecar_path),
        "--audio",
        str(audio_path),
        "--asr-model",
        asr_model,
        "--diarization-model",
        model_id,
    ]
    started = time.monotonic()
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=900,
        env=env,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    base = {
        "model_id": model_id,
        "elapsed_ms": elapsed_ms,
        "returncode": result.returncode,
    }
    if result.returncode != 0:
        return {
            **base,
            "status": "blocked",
            "error": (result.stderr or result.stdout).strip()[-4000:],
        }

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        return {
            **base,
            "status": "blocked",
            "error": f"sidecar returned invalid JSON: {exc}; stderr={result.stderr.strip()[-2000:]}",
        }

    if not payload.get("ok"):
        return {
            **base,
            "status": "blocked",
            "error": str(payload.get("error") or "sidecar returned ok=false"),
        }

    return {
        **base,
        "status": "tested",
        "device": payload.get("device"),
        "speaker_turns": payload.get("speaker_turns") or [],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--truth",
        default="output/speaker-isolation-eval/librispeech-4speaker-turns.truth.json",
    )
    parser.add_argument(
        "--audio",
        default="output/speaker-isolation-eval/librispeech-4speaker-turns.wav",
    )
    parser.add_argument(
        "--output",
        default="output/speaker-isolation-eval/results-latest.json",
    )
    parser.add_argument("--model", action="append", dest="models")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    truth_path = Path(args.truth)
    audio_path = Path(args.audio)
    output_path = Path(args.output)
    sidecar_path = Path("scripts/speech_analysis_sidecar.py")

    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    truth_turns = truth["turns"]

    env = os.environ.copy()
    env.setdefault("VOX_JOT_SPEECH_ANALYSIS_MODEL_ROOT", str(default_model_root()))

    results: list[dict[str, Any]] = []
    for model_id in args.models or DEFAULT_MODELS:
        print(f"Running {model_id}...", file=sys.stderr)
        result = run_model(model_id, audio_path, sidecar_path, env)
        if result["status"] == "tested":
            speaker_turns = result.pop("speaker_turns")
            result.update(score_turns(speaker_turns, truth_turns))
        results.append(result)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "methodology_version": "2.0.0",
        "evidence_tier": "diagnostic",
        "ranking_eligible": False,
        "ranking_blocker": (
            "The current single four-speaker fixture lacks the required two-speaker, "
            "overlap, noise, and far-field v2 domains."
        ),
        "truth": truth,
        "results": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote speaker-isolation report to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
