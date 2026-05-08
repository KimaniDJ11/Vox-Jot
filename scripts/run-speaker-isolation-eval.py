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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_MODELS = (
    "pyannote-community-1",
    "pyannote-3-1",
    "diarizen-wavlm-large-s80-md",
    "nemo-sortformer-4spk-v1",
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


def overlap_with_truth(turn: dict[str, Any], truth_turns: list[dict[str, Any]]) -> int:
    return sum(
        interval_overlap(
            int(turn["start_ms"]),
            int(turn["end_ms"]),
            int(truth["start_ms"]),
            int(truth["end_ms"]),
        )
        for truth in truth_turns
    )


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
    cluster_map = {
        speaker: max(
            truth_speakers,
            key=lambda truth_speaker: overlap_by_pair.get((speaker, truth_speaker), 0),
        )
        for speaker in predicted_speakers
    } if truth_speakers else {}

    covered_ms = sum(overlap_with_truth(turn, truth_turns) for turn in predicted_turns)
    false_alarm_ms = sum(
        max(0, int(turn["end_ms"]) - int(turn["start_ms"]) - overlap_with_truth(turn, truth_turns))
        for turn in predicted_turns
    )
    confusion_ms = 0
    for predicted in predicted_turns:
        mapped_speaker = cluster_map.get(str(predicted.get("speaker_id", "UNKNOWN")))
        for truth in truth_turns:
            if str(truth["speaker_id"]) == mapped_speaker:
                continue
            confusion_ms += interval_overlap(
                int(predicted["start_ms"]),
                int(predicted["end_ms"]),
                int(truth["start_ms"]),
                int(truth["end_ms"]),
            )

    coverage = covered_ms / total_truth_ms
    confusion_rate = confusion_ms / total_truth_ms
    false_alarm_rate = false_alarm_ms / total_truth_ms
    der = max(0.0, 1.0 - coverage) + confusion_rate + false_alarm_rate

    return {
        "speaker_count": len(predicted_speakers),
        "turn_count": len(predicted_turns),
        "coverage": round(coverage, 3),
        "confusion_rate": round(confusion_rate, 3),
        "false_alarm_rate": round(false_alarm_rate, 3),
        "der": round(der, 3),
        "cluster_map": cluster_map,
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
        "truth": truth,
        "results": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote speaker-isolation report to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
