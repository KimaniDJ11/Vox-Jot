#!/usr/bin/env python3
"""Evaluate an app-sidecar-backed STT model (e.g. Higgs, Gemma) through the
running app's loopback HTTP API.

The offline Rust regression harness (`regression.rs`) deliberately rejects
sidecar-backed engines ("… models are app-sidecar backed."), so models like
`higgs-audio-v3-stt` and `gemma4-e2b-audio-mlx` are scored the same way the
2026-06-07 Gemma row was: by POSTing each clip to `/v1/transcribe` (the live
TranscriptionManager path, raw STT, no post-processing) on the model that is
currently selected in the app.

Scoring mirrors `regression.rs` byte-for-byte so the resulting row is directly
comparable to the offline-harness rows in `src/lib/sttEvaluationResults.ts`:
  - tokenize: keep alphanumeric + apostrophe (lowercased), all else -> space
  - WER: word-level Levenshtein / expected token count
  - normalized match: normalize(hyp) == normalize(ref)
  - exact match: hyp.trim() == ref.trim()
  - percentiles: nearest-rank, idx = round((n-1) * q)
  - rtf: (latency_ms / 1000) / duration_secs

Auth: header `x-vox-jot-api-token`; token via $VOX_JOT_API_TOKEN or the keychain
(service `com.voxjot.post_process_api_keys`, account `http_api:loopback_token`).

Usage:
  VOX_JOT_API_TOKEN=$(security find-generic-password \
      -s com.voxjot.post_process_api_keys -a http_api:loopback_token -w) \
  python3 scripts/run-stt-app-api-eval.py --label "Higgs Audio v3 STT" \
      --model-id higgs-audio-v3-stt
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REFERENCE_REPORT = (
    PROJECT_ROOT
    / "test-data/audio-regression/reports/local-existing-manifest.json"
)
DEFAULT_CLIPS_DIR = PROJECT_ROOT / "test-data/audio-regression/clips"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "output/stt-realworld-app-api-eval"
TOKEN_HEADER = "x-vox-jot-api-token"
KEYCHAIN_SERVICE = "com.voxjot.post_process_api_keys"
KEYCHAIN_ACCOUNT = "http_api:loopback_token"


# ---- scoring (faithful port of src-tauri/src/regression.rs) ----------------

def tokenize_for_compare(text: str) -> list[str]:
    norm = "".join(
        ch.lower() if (ch.isalnum() or ch == "'") else " " for ch in text
    )
    return norm.split()


def normalize_compare_text(text: str) -> str:
    return " ".join(tokenize_for_compare(text))


def levenshtein(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[len(b)]


def word_error_rate(expected: str, actual: str) -> float:
    e = tokenize_for_compare(expected)
    a = tokenize_for_compare(actual)
    if not e:
        return 0.0 if not a else 1.0
    return levenshtein(e, a) / len(e)


def percentile(sorted_vals, q: float):
    if not sorted_vals:
        return 0
    idx = int(math.floor((len(sorted_vals) - 1) * q + 0.5))  # round half up, == Rust f32::round
    return sorted_vals[min(idx, len(sorted_vals) - 1)]


# ---- HTTP -------------------------------------------------------------------

def resolve_token() -> str:
    tok = os.environ.get("VOX_JOT_API_TOKEN")
    if tok:
        return tok.strip()
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE,
             "-a", KEYCHAIN_ACCOUNT, "-w"],
            capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Could not resolve API token (set $VOX_JOT_API_TOKEN): {exc}")


def get_json(base_url: str, path: str, token: str):
    req = urllib.request.Request(base_url + path, headers={TOKEN_HEADER: token})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def transcribe(base_url: str, token: str, wav_path: Path, timeout: float):
    """POST multipart file=@wav to /v1/transcribe. Returns (text, latency_ms)."""
    boundary = f"----voxjot{uuid.uuid4().hex}"
    data = wav_path.read_bytes()
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{wav_path.name}"\r\n'.encode(),
        b"Content-Type: audio/wav\r\n\r\n",
        data,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        base_url + "/v1/transcribe",
        data=body,
        headers={
            TOKEN_HEADER: token,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    latency_ms = (time.perf_counter() - start) * 1000.0
    return payload.get("text", ""), latency_ms


# ---- main -------------------------------------------------------------------

def load_clip_set(reference_report: Path, clips_dir: Path):
    ref = json.loads(reference_report.read_text())
    clips = []
    for e in ref["entries"]:
        wav = clips_dir / f"{e['id']}.wav"
        clips.append({
            "id": e["id"],
            "expected_text": e["expected_text"],
            "duration_secs": e["duration_secs"],
            "audio_path": str(wav),
        })
    return clips


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.environ.get("VOX_JOT_API_URL", "http://127.0.0.1:8978"))
    ap.add_argument("--reference-report", default=str(DEFAULT_REFERENCE_REPORT),
                    help="Reference manifest/report JSON defining the exact clip set (id/expected/duration).")
    ap.add_argument("--clips-dir", default=str(DEFAULT_CLIPS_DIR))
    ap.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    ap.add_argument("--model-id", default="", help="For the report header only (does not change selection).")
    ap.add_argument("--label", default="", help="Human label for the report header.")
    ap.add_argument("--timeout", type=float, default=600.0)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    token = resolve_token()
    base_url = args.base_url.rstrip("/")

    # Record the live selection so the row is honestly attributed.
    try:
        settings = get_json(base_url, "/v1/settings", token)
        provider = settings.get("selected_stt_provider_id")
        model = settings.get("selected_stt_model_id")
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Could not read /v1/settings (is the app running with the API on?): {exc}")
    print(f"Live STT selection: provider={provider} model={model}")
    if args.model_id and model != args.model_id:
        print(f"WARNING: selected model ({model}) != --model-id ({args.model_id}). "
              f"Select it first via /v1/models/stt/select.", file=sys.stderr)

    reference_report = Path(args.reference_report)
    if not reference_report.exists():
        sys.exit(
            f"Reference manifest/report not found: {reference_report}\n"
            "Generate the local audio-regression pack first, or pass "
            "--reference-report to a JSON file with entries[]."
        )

    clips = load_clip_set(reference_report, Path(args.clips_dir))
    if args.limit:
        clips = clips[: args.limit]
    print(f"Clip set: {len(clips)} clips from {reference_report}")

    entries = []
    latencies, rtfs = [], []
    exact, normalized, failed = 0, 0, 0
    wer_total = 0.0
    for i, clip in enumerate(clips, 1):
        wav = Path(clip["audio_path"])
        if not wav.exists():
            print(f"[{i}/{len(clips)}] MISSING {wav}", file=sys.stderr)
            failed += 1
            entries.append({**clip, "raw_transcription": None, "error": "missing audio"})
            continue
        try:
            text, latency_ms = transcribe(base_url, token, wav, args.timeout)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}/{len(clips)}] {clip['id']} FAILED: {exc}", file=sys.stderr)
            failed += 1
            entries.append({**clip, "raw_transcription": None, "error": str(exc)})
            continue

        wer = word_error_rate(clip["expected_text"], text)
        nm = normalize_compare_text(text) == normalize_compare_text(clip["expected_text"])
        em = text.strip() == clip["expected_text"].strip()
        latency_ms_int = int(round(latency_ms))
        rtf = (latency_ms_int / 1000.0) / clip["duration_secs"] if clip["duration_secs"] else 0.0

        wer_total += wer
        if nm:
            normalized += 1
        if em:
            exact += 1
        latencies.append(latency_ms_int)
        rtfs.append(rtf)
        entries.append({
            "id": clip["id"],
            "audio_path": clip["audio_path"],
            "duration_secs": clip["duration_secs"],
            "expected_text": clip["expected_text"],
            "raw_transcription": text,
            "raw_wer": wer,
            "raw_exact_match": em,
            "raw_normalized_match": nm,
            "stt_latency_ms": latency_ms_int,
            "stt_real_time_factor": rtf,
            "error": None,
        })
        flag = "ok " if nm else ("~  " if wer <= 0.25 else "XX ")
        print(f"[{i}/{len(clips)}] {flag} wer={wer:.3f} {latency_ms_int:>5}ms  "
              f"'{text}'  <= '{clip['expected_text']}'")

    processed = len(latencies)
    lat_sorted = sorted(latencies)
    rtf_sorted = sorted(rtfs)
    summary = {
        "total_entries": len(clips),
        "processed_entries": processed,
        "failed_entries": failed,
        "raw_exact_matches": exact,
        "raw_normalized_matches": normalized,
        "average_raw_wer": (wer_total / processed) if processed else 0.0,
        "stt_latency_ms_p50": percentile(lat_sorted, 0.50),
        "stt_latency_ms_p95": percentile(lat_sorted, 0.95),
        "stt_latency_ms_max": lat_sorted[-1] if lat_sorted else 0,
        "stt_rtf_p50": percentile(rtf_sorted, 0.50),
        "stt_rtf_p95": percentile(rtf_sorted, 0.95),
    }

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    out_dir = Path(args.output_dir) / ts
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_id": args.model_id or model,
        "label": args.label or model,
        "live_selection": {"provider_id": provider, "model_id": model},
        "method": "app /v1/transcribe (raw STT, post-processing disabled)",
        "reference_report": str(reference_report),
        "summary": summary,
        "entries": entries,
    }
    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))
    print(f"\nReport: {report_path}")


if __name__ == "__main__":
    main()
