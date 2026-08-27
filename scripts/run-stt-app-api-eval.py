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
import hashlib
import json
import math
import os
import platform
import plistlib
import subprocess
import sys
import threading
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
METHODOLOGY_VERSION = "2.0.0"
REQUIRED_RANKED_DOMAINS = {
    "clean-read-speech",
    "casual-dictation",
    "noise-and-far-field",
    "numbers-names-and-technical",
    "accent-and-language",
}


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


def word_error_counts(expected: str, actual: str) -> tuple[int, int]:
    expected_tokens = tokenize_for_compare(expected)
    actual_tokens = tokenize_for_compare(actual)
    return levenshtein(expected_tokens, actual_tokens), len(expected_tokens)


def percentile(sorted_vals, q: float):
    if not sorted_vals:
        return 0
    idx = int(math.floor((len(sorted_vals) - 1) * q + 0.5))  # round half up, == Rust f32::round
    return sorted_vals[min(idx, len(sorted_vals) - 1)]


def speed_factor(real_time_factor: float) -> float | None:
    return 1.0 / real_time_factor if real_time_factor > 0 else None


def run_text(command: list[str]) -> str | None:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    value = result.stdout.strip()
    return value or None


def installed_app_version() -> str | None:
    info_path = Path("/Applications/Vox Jot.app/Contents/Info.plist")
    try:
        with info_path.open("rb") as handle:
            info = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException):
        return None
    value = info.get("CFBundleShortVersionString")
    return str(value) if value else None


def physical_memory_bytes() -> int | None:
    value = run_text(["sysctl", "-n", "hw.memsize"])
    try:
        return int(value) if value else None
    except ValueError:
        return None


def power_source() -> str | None:
    value = run_text(["pmset", "-g", "batt"])
    if not value:
        return None
    if "AC Power" in value:
        return "ac"
    if "Battery Power" in value:
        return "battery"
    return "unknown"


def resolve_app_pid(explicit_pid: int) -> int | None:
    if explicit_pid > 0:
        return explicit_pid
    value = run_text(["pgrep", "-x", "Vox Jot"])
    if not value:
        return None
    try:
        return min(int(line) for line in value.splitlines() if line.strip())
    except ValueError:
        return None


def process_tree_pids(root_pid: int) -> set[int]:
    discovered = {root_pid}
    pending = [root_pid]
    while pending:
        parent = pending.pop()
        value = run_text(["pgrep", "-P", str(parent)])
        if not value:
            continue
        for line in value.splitlines():
            try:
                child = int(line)
            except ValueError:
                continue
            if child not in discovered:
                discovered.add(child)
                pending.append(child)
    return discovered


def process_tree_rss_bytes(root_pid: int | None) -> int | None:
    if root_pid is None:
        return None
    pids = sorted(process_tree_pids(root_pid))
    if not pids:
        return None
    value = run_text(["ps", "-o", "rss=", "-p", ",".join(map(str, pids))])
    if not value:
        return None
    try:
        return sum(int(line.strip()) for line in value.splitlines() if line.strip()) * 1024
    except ValueError:
        return None


def measure_peak_rss(root_pid: int | None, fn):
    if root_pid is None:
        return fn(), None
    stop = threading.Event()
    samples: list[int] = []

    def sample() -> None:
        while not stop.is_set():
            value = process_tree_rss_bytes(root_pid)
            if value is not None:
                samples.append(value)
            stop.wait(0.10)

    thread = threading.Thread(target=sample, daemon=True)
    thread.start()
    try:
        result = fn()
    finally:
        stop.set()
        thread.join(timeout=1)
    final = process_tree_rss_bytes(root_pid)
    if final is not None:
        samples.append(final)
    return result, max(samples) if samples else None


def system_profile(args, app_pid: int | None) -> dict:
    return {
        "git_commit": run_text(["git", "rev-parse", "HEAD"]),
        "app_version": installed_app_version(),
        "os_version": platform.platform(),
        "machine_model": run_text(["sysctl", "-n", "hw.model"]),
        "chip": run_text(["sysctl", "-n", "machdep.cpu.brand_string"]),
        "memory_bytes": physical_memory_bytes(),
        "power_source": power_source(),
        "thermal_state": run_text(["pmset", "-g", "therm"]),
        "runtime_revision": args.runtime_revision or None,
        "model_revision": args.model_revision or None,
        "model_precision": args.precision or None,
        "hardware_path": args.hardware_path,
        "app_pid": app_pid,
    }


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
        raw_path = e.get("audio_path")
        wav = Path(raw_path) if raw_path else clips_dir / f"{e['id']}.wav"
        if not wav.is_absolute():
            wav = PROJECT_ROOT / wav
        clips.append({
            "id": e["id"],
            "expected_text": e["expected_text"],
            "duration_secs": e["duration_secs"],
            "audio_path": str(wav),
            "domain": e.get("domain", "clean-read-speech"),
        })
    return ref.get("metadata", {}), clips


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
    ap.add_argument("--warmup-runs", type=int, default=1)
    ap.add_argument("--measured-runs", type=int, default=3)
    ap.add_argument("--ranked", action="store_true")
    ap.add_argument("--app-pid", type=int, default=0)
    ap.add_argument("--model-revision", default="")
    ap.add_argument("--runtime-revision", default="")
    ap.add_argument("--precision", default="")
    ap.add_argument(
        "--hardware-path",
        choices=("ane", "metal-gpu", "cpu", "mixed", "unknown"),
        default="unknown",
    )
    args = ap.parse_args()

    if args.warmup_runs < 1 or args.measured_runs < 3:
        sys.exit("Benchmark v2 requires at least 1 warm-up and 3 measured runs.")
    if args.ranked and args.limit:
        sys.exit("A ranked v2 run cannot use --limit.")

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
        message = (
            f"selected model ({model}) != --model-id ({args.model_id}). "
            "Select it first via /v1/models/stt/select."
        )
        if args.ranked:
            sys.exit(f"Ranked v2 gate failed: {message}")
        print(f"WARNING: {message}", file=sys.stderr)

    reference_report = Path(args.reference_report)
    if not reference_report.exists():
        sys.exit(
            f"Reference manifest/report not found: {reference_report}\n"
            "Generate the local audio-regression pack first, or pass "
            "--reference-report to a JSON file with entries[]."
        )

    manifest_metadata, clips = load_clip_set(reference_report, Path(args.clips_dir))
    if args.limit:
        clips = clips[: args.limit]
    domains = {clip["domain"] for clip in clips}
    missing_domains = sorted(REQUIRED_RANKED_DOMAINS - domains)
    if args.ranked and missing_domains:
        sys.exit(
            "Ranked v2 gate failed; reference manifest is missing domains: "
            + ", ".join(missing_domains)
        )
    if args.ranked:
        missing_provenance = [
            name
            for name, value in (
                ("--model-revision", args.model_revision),
                ("--runtime-revision", args.runtime_revision),
                ("--precision", args.precision),
            )
            if not value.strip()
        ]
        if args.hardware_path == "unknown":
            missing_provenance.append("--hardware-path")
        if missing_provenance:
            sys.exit(
                "Ranked v2 gate failed; missing provenance: "
                + ", ".join(missing_provenance)
            )
    print(f"Clip set: {len(clips)} clips from {reference_report}")

    app_pid = resolve_app_pid(args.app_pid)
    rss_baseline = process_tree_rss_bytes(app_pid)
    if args.ranked and app_pid is None:
        sys.exit("Ranked v2 gate failed: could not identify the installed Vox Jot process PID.")
    run_system_profile = system_profile(args, app_pid)
    if args.ranked:
        missing_system_fields = [
            field
            for field in (
                "git_commit",
                "app_version",
                "os_version",
                "machine_model",
                "chip",
                "memory_bytes",
                "power_source",
                "thermal_state",
            )
            if run_system_profile.get(field) in (None, "")
        ]
        if missing_system_fields:
            sys.exit(
                "Ranked v2 gate failed; system profile is missing: "
                + ", ".join(missing_system_fields)
            )

    warmup_clip = next((clip for clip in clips if Path(clip["audio_path"]).exists()), None)
    if warmup_clip is None:
        sys.exit("No benchmark audio files are available for warm-up.")
    print(f"Warm-up: {args.warmup_runs} run(s) using {warmup_clip['id']}")
    for warmup_index in range(args.warmup_runs):
        try:
            transcribe(
                base_url,
                token,
                Path(warmup_clip["audio_path"]),
                args.timeout,
            )
        except Exception as exc:  # noqa: BLE001
            sys.exit(f"Warm-up {warmup_index + 1} failed: {exc}")

    entries = []
    latencies, rtfs = [], []
    exact, normalized, failed = 0, 0, 0
    wer_total = 0.0
    word_edits_total = 0
    reference_words_total = 0
    duration_weighted_wer_total = 0.0
    duration_total = 0.0
    nondeterministic_outputs = 0
    peak_process_tree_rss_bytes = rss_baseline
    domain_accumulators: dict[str, dict] = {}
    for i, clip in enumerate(clips, 1):
        wav = Path(clip["audio_path"])
        if not wav.exists():
            print(f"[{i}/{len(clips)}] MISSING {wav}", file=sys.stderr)
            failed += 1
            entries.append({**clip, "raw_transcription": None, "error": "missing audio"})
            continue
        measured_runs = []
        run_error = None
        for run_index in range(args.measured_runs):
            try:
                (text, latency_ms), peak_rss = measure_peak_rss(
                    app_pid,
                    lambda: transcribe(base_url, token, wav, args.timeout),
                )
                measured_runs.append(
                    {
                        "run": run_index + 1,
                        "transcription": text,
                        "latency_ms": int(round(latency_ms)),
                    }
                )
                if peak_rss is not None:
                    peak_process_tree_rss_bytes = max(
                        peak_process_tree_rss_bytes or 0,
                        peak_rss,
                    )
            except Exception as exc:  # noqa: BLE001
                run_error = f"measured run {run_index + 1}: {exc}"
                break
        if run_error or len(measured_runs) != args.measured_runs:
            print(f"[{i}/{len(clips)}] {clip['id']} FAILED: {run_error}", file=sys.stderr)
            failed += 1
            entries.append(
                {
                    **clip,
                    "raw_transcription": None,
                    "performance_runs": measured_runs,
                    "error": run_error or "incomplete measured runs",
                }
            )
            continue

        text = measured_runs[0]["transcription"]
        distinct_outputs = sorted({run["transcription"] for run in measured_runs})
        if len(distinct_outputs) > 1:
            nondeterministic_outputs += 1
        wer = word_error_rate(clip["expected_text"], text)
        word_edits, reference_words = word_error_counts(clip["expected_text"], text)
        nm = normalize_compare_text(text) == normalize_compare_text(clip["expected_text"])
        em = text.strip() == clip["expected_text"].strip()
        case_latencies = sorted(run["latency_ms"] for run in measured_runs)
        latency_ms_int = percentile(case_latencies, 0.50)
        rtf = (latency_ms_int / 1000.0) / clip["duration_secs"] if clip["duration_secs"] else 0.0

        wer_total += wer
        word_edits_total += word_edits
        reference_words_total += reference_words
        duration_weighted_wer_total += wer * clip["duration_secs"]
        duration_total += clip["duration_secs"]
        if nm:
            normalized += 1
        if em:
            exact += 1
        for run in measured_runs:
            run_rtf = (
                (run["latency_ms"] / 1000.0) / clip["duration_secs"]
                if clip["duration_secs"]
                else 0.0
            )
            run["real_time_factor"] = run_rtf
            run["speed_factor"] = speed_factor(run_rtf)
            latencies.append(run["latency_ms"])
            rtfs.append(run_rtf)

        domain = clip["domain"]
        domain_stats = domain_accumulators.setdefault(
            domain,
            {
                "entries": 0,
                "word_edits": 0,
                "reference_words": 0,
                "wer_duration_total": 0.0,
                "duration_secs": 0.0,
                "normalized_matches": 0,
                "latencies": [],
                "rtfs": [],
            },
        )
        domain_stats["entries"] += 1
        domain_stats["word_edits"] += word_edits
        domain_stats["reference_words"] += reference_words
        domain_stats["wer_duration_total"] += wer * clip["duration_secs"]
        domain_stats["duration_secs"] += clip["duration_secs"]
        domain_stats["normalized_matches"] += int(nm)
        domain_stats["latencies"].extend(case_latencies)
        domain_stats["rtfs"].extend(run["real_time_factor"] for run in measured_runs)
        entries.append({
            "id": clip["id"],
            "domain": domain,
            "audio_path": clip["audio_path"],
            "duration_secs": clip["duration_secs"],
            "expected_text": clip["expected_text"],
            "raw_transcription": text,
            "raw_wer": wer,
            "raw_exact_match": em,
            "raw_normalized_match": nm,
            "stt_latency_ms": latency_ms_int,
            "stt_real_time_factor": rtf,
            "stt_speed_factor": speed_factor(rtf),
            "performance_runs": measured_runs,
            "output_variants": distinct_outputs,
            "error": None,
        })
        flag = "ok " if nm else ("~  " if wer <= 0.25 else "XX ")
        print(f"[{i}/{len(clips)}] {flag} wer={wer:.3f} {latency_ms_int:>5}ms  "
              f"'{text}'  <= '{clip['expected_text']}'")

    processed = len(entries) - failed
    lat_sorted = sorted(latencies)
    rtf_sorted = sorted(rtfs)
    domain_summary = {}
    for domain, stats in sorted(domain_accumulators.items()):
        domain_rtfs = sorted(stats["rtfs"])
        domain_latencies = sorted(stats["latencies"])
        domain_summary[domain] = {
            "entries": stats["entries"],
            "micro_wer": stats["word_edits"] / stats["reference_words"]
            if stats["reference_words"]
            else 0.0,
            "duration_weighted_wer": stats["wer_duration_total"]
            / stats["duration_secs"]
            if stats["duration_secs"]
            else 0.0,
            "normalized_match_rate": stats["normalized_matches"] / stats["entries"]
            if stats["entries"]
            else 0.0,
            "latency_p50_ms": percentile(domain_latencies, 0.50),
            "latency_p95_ms": percentile(domain_latencies, 0.95),
            "real_time_factor_p50": percentile(domain_rtfs, 0.50),
            "speed_factor_p50": speed_factor(percentile(domain_rtfs, 0.50)),
        }

    declared_weights = manifest_metadata.get("domain_weights", {})
    raw_weights = {
        domain: float(declared_weights.get(domain, 1.0))
        for domain in domain_summary
    }
    weight_total = sum(raw_weights.values())
    domain_weights = {
        domain: weight / weight_total if weight_total else 0.0
        for domain, weight in raw_weights.items()
    }
    weighted_wer = sum(
        domain_summary[domain]["micro_wer"] * weight
        for domain, weight in domain_weights.items()
    )
    rtf_p50 = percentile(rtf_sorted, 0.50)
    rtf_p95 = percentile(rtf_sorted, 0.95)
    summary = {
        "total_entries": len(clips),
        "processed_entries": processed,
        "failed_entries": failed,
        "raw_exact_matches": exact,
        "raw_normalized_matches": normalized,
        "average_raw_wer": (wer_total / processed) if processed else 0.0,
        "micro_wer": word_edits_total / reference_words_total
        if reference_words_total
        else 0.0,
        "duration_weighted_wer": duration_weighted_wer_total / duration_total
        if duration_total
        else 0.0,
        "weighted_wer": weighted_wer,
        "domain_weights": domain_weights,
        "domains": domain_summary,
        "normalized_match_rate": normalized / processed if processed else 0.0,
        "nondeterministic_output_entries": nondeterministic_outputs,
        "stt_latency_ms_p50": percentile(lat_sorted, 0.50),
        "stt_latency_ms_p95": percentile(lat_sorted, 0.95),
        "stt_latency_ms_max": lat_sorted[-1] if lat_sorted else 0,
        "stt_rtf_p50": rtf_p50,
        "stt_rtf_p95": rtf_p95,
        "speed_factor_p50": speed_factor(rtf_p50),
        "speed_factor_p95_latency": speed_factor(rtf_p95),
        "rss_baseline_bytes": rss_baseline,
        "peak_process_tree_rss_bytes": peak_process_tree_rss_bytes,
    }

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    out_dir = Path(args.output_dir) / ts
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "methodology_version": METHODOLOGY_VERSION,
        "evidence_tier": "ranked"
        if args.ranked and failed == 0 and nondeterministic_outputs == 0
        else "diagnostic",
        "model_id": args.model_id or model,
        "label": args.label or model,
        "live_selection": {"provider_id": provider, "model_id": model},
        "method": "app /v1/transcribe (raw STT, post-processing disabled)",
        "reference_report": str(reference_report),
        "reference_sha256": hashlib.sha256(reference_report.read_bytes()).hexdigest(),
        "reference_metadata": manifest_metadata,
        "performance_protocol": {
            "warmup_runs": args.warmup_runs,
            "measured_runs": args.measured_runs,
            "accuracy_output": "first measured deterministic output",
        },
        "system_profile": run_system_profile,
        "summary": summary,
        "entries": entries,
    }
    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))
    print(f"\nReport: {report_path}")
    if args.ranked and failed:
        sys.exit(
            f"Ranked v2 gate failed after writing the diagnostic report: {failed} case(s) failed."
        )
    if args.ranked and nondeterministic_outputs:
        sys.exit(
            "Ranked v2 gate failed after writing the diagnostic report: "
            f"{nondeterministic_outputs} case(s) produced nondeterministic transcripts."
        )


if __name__ == "__main__":
    main()
