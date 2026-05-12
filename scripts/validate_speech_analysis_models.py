#!/usr/bin/env python3
"""Validate Vox Jot speech-analysis model adapters.

This script owns the model bring-up loop policy: each model gets at most
11 full attempts before the runner records it as blocked and moves on.

The runner validates concrete adapter readiness and writes a stable report
schema for local and CI checks.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

MAX_ATTEMPTS = 11


@dataclass(frozen=True)
class ModelCheck:
    model_id: str
    task: str
    engine: str
    required_modules: tuple[str, ...]
    requires_hf_token: bool = False
    cloud_gpu_preferred: bool = False


@dataclass
class AttemptResult:
    attempt: int
    ok: bool
    message: str
    elapsed_ms: int


@dataclass
class ModelReport:
    model_id: str
    task: str
    engine: str
    status: str
    attempts: list[AttemptResult] = field(default_factory=list)


MODEL_CHECKS: tuple[ModelCheck, ...] = (
    ModelCheck("granite-speech-4-1-2b", "asr", "transformers", ("torch", "transformers", "librosa"), cloud_gpu_preferred=True),
    ModelCheck("cohere-transcribe-03-2026", "asr", "transformers", ("torch", "transformers", "librosa"), requires_hf_token=True, cloud_gpu_preferred=True),
    ModelCheck("mlx-qwen3-asr-0.6b", "asr", "mlx_audio", ("mlx_audio",)),
    ModelCheck("mlx-qwen3-asr", "asr", "mlx_audio", ("mlx_audio",)),
    ModelCheck("mlx-fireredasr2-aed", "asr", "mlx_audio", ("mlx_audio",)),
    ModelCheck("mlx-vibevoice-asr-bf16", "asr", "mlx_audio", ("mlx_audio",)),
    ModelCheck("pyannote-community-1", "diarization", "pyannote", ("torch", "pyannote.audio"), requires_hf_token=True, cloud_gpu_preferred=True),
    ModelCheck("pyannote-3-1", "diarization", "pyannote", ("torch", "pyannote.audio"), requires_hf_token=True, cloud_gpu_preferred=True),
    ModelCheck("nemo-sortformer-4spk-v1", "diarization", "nemo", ("torch", "nemo.collections.asr"), cloud_gpu_preferred=True),
    ModelCheck("mlx-sortformer-4spk-v1", "diarization", "mlx_audio", ("mlx_audio",)),
    ModelCheck("mlx-sortformer-4spk-v2-1", "diarization", "mlx_audio", ("mlx_audio",)),
    ModelCheck("reverb-diarization-v2", "diarization", "reverb", ("torch", "pyannote.audio"), requires_hf_token=True, cloud_gpu_preferred=True),
    ModelCheck("whisper-diarization", "asr_diarization", "whisper_diarization", ("torch", "whisperx"), cloud_gpu_preferred=True),
    ModelCheck("onnx-polyvoice-diarization", "diarization", "onnx_runtime", ()),
)


def module_exists(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except ModuleNotFoundError:
        return False


def torch_device_summary() -> str:
    if module_exists("torch"):
        import torch

        if torch.cuda.is_available():
            return f"cuda:{torch.cuda.get_device_name(0)}"
        if platform.system() == "Darwin" and torch.backends.mps.is_available():
            return "mps"
    if module_exists("mlx_audio"):
        return "mlx"
    return "cpu"


def hf_authenticated() -> bool:
    try:
        result = subprocess.run(
            ["hf", "auth", "whoami", "--format", "json"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.SubprocessError):
        return False


def polyvoice_ready() -> tuple[bool, str]:
    binary = (
        Path.home() / ".cargo" / "bin" / "polyvoice"
        if (Path.home() / ".cargo" / "bin" / "polyvoice").exists()
        else shutil.which("polyvoice")
    )
    if not binary:
        return False, "polyvoice CLI is required for ONNX diarization"

    model_dir = Path.cwd() / "src-tauri" / "resources" / "models" / "polyvoice"
    missing = [
        name
        for name in ("wespeaker_resnet34.onnx", "silero_vad.onnx")
        if not (model_dir / name).exists()
    ]
    if missing:
        return False, f"missing polyvoice model files: {', '.join(missing)}"
    return True, f"polyvoice ready at {binary}"


def speech_analysis_model_root() -> Path:
    if root := os.environ.get("VOX_JOT_SPEECH_ANALYSIS_MODEL_ROOT"):
        return Path(root).expanduser()
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "com.iriedinamik.voxjot" / "models" / "speech-analysis"
    return Path.home() / ".local" / "share" / "com.iriedinamik.voxjot" / "models" / "speech-analysis"


def stt_model_root() -> Path:
    if root := os.environ.get("VOX_JOT_STT_MODEL_ROOT"):
        return Path(root).expanduser()
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "com.iriedinamik.voxjot" / "models" / "stt"
    return Path.home() / ".local" / "share" / "com.iriedinamik.voxjot" / "models" / "stt"


def downloaded_model_ready(model_id: str) -> tuple[bool, str]:
    model_dir = speech_analysis_model_root() / model_id
    model_dir = stt_model_root() / model_id if model_id.startswith("mlx-") and "asr" in model_id else model_dir
    required_files = {
        "granite-speech-4-1-2b": ("config.json", "model.safetensors.index.json"),
        "cohere-transcribe-03-2026": ("config.json", "model.safetensors"),
        "mlx-qwen3-asr-0.6b": ("config.json", "model.safetensors"),
        "mlx-qwen3-asr": ("config.json", "model.safetensors"),
        "mlx-fireredasr2-aed": ("config.json", "model.safetensors"),
        "mlx-vibevoice-asr-bf16": ("config.json", "model.safetensors"),
        "pyannote-community-1": (
            "config.yaml",
            "segmentation/pytorch_model.bin",
            "embedding/pytorch_model.bin",
            "plda/plda.npz",
            "plda/xvec_transform.npz",
        ),
        "pyannote-3-1": (
            "config.yaml",
            "segmentation/config.yaml",
            "segmentation/pytorch_model.bin",
            "embedding/config.yaml",
            "embedding/pytorch_model.bin",
        ),
        "nemo-sortformer-4spk-v1": ("diar_sortformer_4spk-v1.nemo",),
        "mlx-sortformer-4spk-v1": ("config.json", "model.safetensors"),
        "mlx-sortformer-4spk-v2-1": ("config.json", "model.safetensors"),
        "reverb-diarization-v2": ("config.yaml", "pytorch_model.bin"),
        "whisper-diarization": ("model.bin", "config.json"),
    }
    required = required_files.get(model_id)
    if required and all((model_dir / file_name).exists() for file_name in required):
        return True, f"model weights downloaded at {model_dir}"
    if model_dir.exists() and any(model_dir.iterdir()):
        missing = [
            file_name
            for file_name in required or ()
            if not (model_dir / file_name).exists()
        ]
        detail = f"; missing required files: {', '.join(missing)}" if missing else ""
        return False, f"download_required: incomplete model directory at {model_dir}{detail}"
    return False, f"download_required: runtime ready, but model weights are not downloaded at {model_dir}"


def readiness_check(check: ModelCheck) -> tuple[bool, str]:
    missing = [module for module in check.required_modules if not module_exists(module)]
    if missing:
        return False, f"missing Python modules: {', '.join(missing)}"

    if check.requires_hf_token and not hf_authenticated():
        return False, "Hugging Face authentication is required"

    if check.model_id == "onnx-polyvoice-diarization":
        return polyvoice_ready()

    downloaded, message = downloaded_model_ready(check.model_id)
    if not downloaded:
        return False, message

    return True, f"environment ready on {torch_device_summary()}"


AdapterCheck = Callable[[ModelCheck], tuple[bool, str]]


def validate_model(check: ModelCheck, adapter_check: AdapterCheck) -> ModelReport:
    attempts: list[AttemptResult] = []
    status = "blocked_after_11_attempts"

    for attempt in range(1, MAX_ATTEMPTS + 1):
        started = time.monotonic()
        ok, message = adapter_check(check)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        attempts.append(AttemptResult(attempt, ok, message, elapsed_ms))

        if ok:
            status = "ready"
            break
        if message.startswith("download_required:"):
            status = "download_required"
            break

    return ModelReport(
        model_id=check.model_id,
        task=check.task,
        engine=check.engine,
        status=status,
        attempts=attempts,
    )


def encode_report(reports: list[ModelReport]) -> dict:
    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "max_attempts": MAX_ATTEMPTS,
        "python": sys.version,
        "platform": platform.platform(),
        "device": torch_device_summary(),
        "models": [
            {
                "model_id": report.model_id,
                "task": report.task,
                "engine": report.engine,
                "status": report.status,
                "attempts": [
                    {
                        "attempt": attempt.attempt,
                        "ok": attempt.ok,
                        "message": attempt.message,
                        "elapsed_ms": attempt.elapsed_ms,
                    }
                    for attempt in report.attempts
                ],
            }
            for report in reports
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        action="append",
        dest="models",
        help="Model id to validate. Repeat to validate multiple models. Defaults to all.",
    )
    parser.add_argument(
        "--output",
        default="reports/speech-analysis-validation.json",
        help="Path for the JSON validation report.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    selected = set(args.models or [])
    checks = [check for check in MODEL_CHECKS if not selected or check.model_id in selected]
    missing_requested = selected.difference({check.model_id for check in MODEL_CHECKS})
    if missing_requested:
        print(f"Unknown model id(s): {', '.join(sorted(missing_requested))}", file=sys.stderr)
        return 2

    reports = [validate_model(check, readiness_check) for check in checks]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(encode_report(reports), indent=2), encoding="utf-8")

    blocked = [report.model_id for report in reports if report.status not in {"ready", "download_required"}]
    pending_download = [report.model_id for report in reports if report.status == "download_required"]
    print(f"Wrote validation report to {output}")
    if pending_download:
        print(f"Download required: {', '.join(pending_download)}")
    if blocked:
        print(f"Blocked models: {', '.join(blocked)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
