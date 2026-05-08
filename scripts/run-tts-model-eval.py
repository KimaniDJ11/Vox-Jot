#!/usr/bin/env python3
"""Run real-world TTS hard tests against every Vox Jot TTS model family.

The runner stays outside the dictation hot path. It calls the same local
runtime entrypoints used by the app where practical, writes WAV artifacts, and
grades the output with deterministic audio-health and latency metrics.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_SUPPORT = Path.home() / "Library/Application Support/com.iriedinamik.voxjot"
TTS_ROOT = APP_SUPPORT / "models/tts"
TTS_STORE = TTS_ROOT / "store"
TTS_PACKS = TTS_ROOT / "packs"
TTS_RUNTIME = TTS_ROOT / "runtime"
SPEECH_RUNTIME_STATE = APP_SUPPORT / "speech-runtime"
SPEECH_PROFILES = APP_SUPPORT / "tts/profiles"
MLX_AUDIO_PYTHON = APP_SUPPORT / "mlx-audio-venv/bin/python"
MLX_AUDIO_BRIDGE = PROJECT_ROOT / "src-tauri/resources/python/mlx_audio_generate.py"
MANAGED_RUNTIME = PROJECT_ROOT / "speech-runtime"
MANAGED_WORKER = MANAGED_RUNTIME / "runtime/engine_worker.py"
LEGACY_QWEN_RUNTIME = APP_SUPPORT / "tts-runtime/qwen3-macos-aarch64/qwen3-tts-macos-aarch64"
DEFAULT_ASR_JUDGE_MODEL = APP_SUPPORT / "models/speech-analysis/whisper-diarization"

BaselineCases = dict[tuple[str, str], dict[str, Any]]

STYLE_RUBRIC = {
    "automatic_proxy": {
        "style_alignment": "Heuristic prosody fit to the requested style using speech rate, RMS energy, and pause/silence ratio.",
        "intelligibility": "ASR round-trip WER against the source text.",
        "audio_health": "Generated WAV duration, RMS, silence, and clipping checks.",
        "latency": "Real-time factor; lower is better.",
    },
    "listener_preference": {
        "status": "manual_ratings_not_collected",
        "scale": "1-5 per dimension, blind to model id when collected.",
        "dimensions": [
            "style_match",
            "naturalness",
            "intelligibility",
            "listening_fatigue",
            "overall_preference",
        ],
    },
}

SHERPA_PACKS: dict[str, dict[str, Any]] = {
    "tts-sherpa-en-us-lessac-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2",
        "label": "English (US) - Lessac",
        "locale": "en-US",
        "model_file": "en_US-lessac-medium.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": "espeak-ng-data",
        "lexicon_file": None,
        "rule_fsts": [],
    },
    "tts-sherpa-zh-cn-melo": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2",
        "label": "Chinese/English - Melo",
        "locale": "zh-CN",
        "model_file": "model.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": None,
        "lexicon_file": "lexicon.txt",
        "rule_fsts": ["date.fst", "number.fst", "phone.fst", "new_heteronym.fst"],
    },
}


CASES = [
    {
        "id": "casual_short",
        "label": "Casual Short Take",
        "text": "Yeah, that sounds good. Let's do it after lunch.",
        "locale": "en-US",
    },
    {
        "id": "meeting_room",
        "label": "Long Meeting Room Talk",
        "text": (
            "For today's meeting, please summarize the roadmap, blockers, owners, "
            "and follow-up dates. Then call out any decision that needs approval "
            "before Friday afternoon."
        ),
        "locale": "en-US",
    },
    {
        "id": "code_dictation",
        "label": "Code And Symbols",
        "text": (
            "Read this exactly: import React from 'react'; const API_URL equals "
            "'https://api.example.com/v2/users'; then return status code two hundred."
        ),
        "locale": "en-US",
    },
    {
        "id": "numbers_dates",
        "label": "Numbers And Dates",
        "text": (
            "The build is due on March twenty third, twenty twenty six, at two thirty PM. "
            "The invoice total is one thousand two hundred forty nine dollars and ninety cents."
        ),
        "locale": "en-US",
    },
    {
        "id": "multilingual_short",
        "label": "Multilingual Short",
        "text": "Hola, gracias por revisar la nota. Por favor confirma la reunion manana.",
        "locale": "es",
    },
]


STYLE_CASES = [
    {
        "id": "neutral_status",
        "label": "Neutral Status",
        "text": "The deployment finished at four fifteen PM. Two follow-up items remain open.",
        "locale": "en-US",
        "target_style": "neutral",
        "instruction_prompt": "Read in a neutral, clear product status voice. Keep pacing steady and avoid extra emotion.",
        "style_targets": {
            "words_per_second": [2.0, 3.3],
            "rms": [0.018, 0.12],
            "silence_ratio": [0.08, 0.55],
        },
    },
    {
        "id": "warm_welcome",
        "label": "Warm Helpful",
        "text": "Welcome back. I saved your notes, and everything is ready when you are.",
        "locale": "en-US",
        "target_style": "warm",
        "instruction_prompt": "Read warmly and helpfully, like a calm assistant welcoming someone back.",
        "style_targets": {
            "words_per_second": [1.7, 2.9],
            "rms": [0.016, 0.11],
            "silence_ratio": [0.12, 0.62],
        },
        "controls": {"exaggeration": 0.6, "temperature": 0.75},
    },
    {
        "id": "excited_launch",
        "label": "Excited Launch",
        "text": "Great news, the prototype passed the final test and the team can start the launch review.",
        "locale": "en-US",
        "target_style": "excited",
        "instruction_prompt": "Read with upbeat excitement and positive energy, while staying intelligible.",
        "style_targets": {
            "words_per_second": [2.6, 4.2],
            "rms": [0.025, 0.18],
            "silence_ratio": [0.03, 0.42],
        },
        "controls": {"exaggeration": 0.75, "temperature": 0.85},
    },
    {
        "id": "calm_guidance",
        "label": "Calm Guidance",
        "text": "Take a breath. We can go one step at a time and review the details together.",
        "locale": "en-US",
        "target_style": "calm",
        "instruction_prompt": "Read slowly and calmly with reassuring pauses. Keep the delivery grounded.",
        "style_targets": {
            "words_per_second": [1.35, 2.45],
            "rms": [0.012, 0.09],
            "silence_ratio": [0.16, 0.72],
        },
        "controls": {"exaggeration": 0.35, "temperature": 0.6},
    },
    {
        "id": "urgent_alert",
        "label": "Urgent Alert",
        "text": "Please stop the upload now and confirm the backup completed before continuing.",
        "locale": "en-US",
        "target_style": "urgent",
        "instruction_prompt": "Read urgently and clearly, like a time-sensitive operational alert. Do not sound panicked.",
        "style_targets": {
            "words_per_second": [2.9, 4.7],
            "rms": [0.026, 0.2],
            "silence_ratio": [0.02, 0.35],
        },
        "controls": {"exaggeration": 0.7, "temperature": 0.75},
    },
    {
        "id": "empathetic_support",
        "label": "Empathetic Support",
        "text": "I am sorry that was frustrating. I will slow down and help you sort it out.",
        "locale": "en-US",
        "target_style": "empathetic",
        "instruction_prompt": "Read with gentle empathy and patience. Keep the tone supportive, not dramatic.",
        "style_targets": {
            "words_per_second": [1.45, 2.65],
            "rms": [0.012, 0.095],
            "silence_ratio": [0.14, 0.68],
        },
        "controls": {"exaggeration": 0.45, "temperature": 0.65},
    },
]


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    family: str
    provider: str
    candidate_dirs: tuple[str, ...] = ()
    hf_repo: str | None = None
    voice: str | None = None
    unavailable_reason: str | None = None
    supports_instruction_prompt: bool = False
    notes: str = ""


MODELS: tuple[ModelSpec, ...] = (
    ModelSpec("openvoice", "OpenVoice", "managed", "openvoice", ("OpenVoice", "openvoice"), voice="default"),
    ModelSpec("chatterbox", "Chatterbox", "managed", "chatterbox", ("chatterbox", "Chatterbox"), hf_repo="ResembleAI/chatterbox"),
    ModelSpec(
        "chatterbox-turbo",
        "Chatterbox Turbo",
        "managed",
        "chatterbox",
        ("chatterbox-turbo/chatterbox-turbo", "chatterbox-turbo", "Chatterbox-Turbo"),
        hf_repo="ResembleAI/chatterbox-turbo",
    ),
    ModelSpec(
        "chatterbox-multilingual",
        "Chatterbox Multilingual",
        "managed",
        "chatterbox",
        ("chatterbox-multilingual/chatterbox", "chatterbox-multilingual", "chatterbox", "Chatterbox"),
        hf_repo="ResembleAI/chatterbox",
    ),
    ModelSpec("kokoro-82m-v1.0", "Kokoro 82M", "managed", "kokoro", ("Kokoro", "kokoro"), voice="af_heart"),
    ModelSpec("xtts-v2", "XTTS v2", "managed", "xtts", ("Coqui/XTTS", "coqui-tts", "XTTS"), hf_repo="coqui/XTTS-v2"),
    ModelSpec("tts-sherpa-en-us-lessac-medium", "Sherpa Lessac Medium", "sherpa", "sherpa", ("tts-sherpa-en-us-lessac-medium",)),
    ModelSpec("tts-sherpa-zh-cn-melo", "Sherpa Melo Chinese/English", "sherpa", "sherpa", ("tts-sherpa-zh-cn-melo",)),
    ModelSpec("qwen3-0.6b-base", "Qwen3 Native 0.6B Base", "qwen3", "qwen3_native", ("qwen3/qwen3-0.6b-base", "qwen3-0.6b-base"), hf_repo="Qwen/Qwen3-TTS-12Hz-0.6B-Base"),
    ModelSpec("qwen3-0.6b-customvoice", "Qwen3 Native 0.6B CustomVoice", "qwen3", "qwen3_native", ("qwen3/qwen3-0.6b-customvoice", "qwen3-0.6b-customvoice"), hf_repo="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"),
    ModelSpec("qwen3-1.7b-customvoice", "Qwen3 Native 1.7B CustomVoice", "qwen3", "qwen3_native", ("qwen3/qwen3-1.7b-customvoice", "qwen3-1.7b-customvoice"), hf_repo="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"),
    ModelSpec("lfm2-5-audio-1-5b-q4-0", "LFM2.5 Audio 1.5B GGUF Q4_0", "lfm_gguf", "lfm_audio_gguf", ("lfm-audio-gguf",)),
    ModelSpec("vibevoice-realtime-0-5b", "VibeVoice Realtime 0.5B", "vibevoice", "vibevoice", ("vibevoice",)),
    ModelSpec("kokoro-82m", "MLX Kokoro 82M", "mlx", "mlx_kokoro", ("MLX/Kokoro-82M-bf16", "MLX/mlx-community/Kokoro-82M-bf16", "Kokoro-82M-bf16"), "mlx-community/Kokoro-82M-bf16"),
    ModelSpec("chatterbox-mlx", "MLX Chatterbox", "mlx", "mlx_chatterbox", ("MLX/Chatterbox-fp16", "MLX/mlx-community/chatterbox-fp16", "Chatterbox-fp16"), "mlx-community/chatterbox-fp16"),
    ModelSpec("qwen3-tts-0.6b", "MLX Qwen3 TTS 0.6B", "mlx", "mlx_qwen3tts", ("MLX/Qwen3-TTS-0.6B-Base-bf16", "MLX/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"), "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16", supports_instruction_prompt=True),
    ModelSpec("qwen3-tts-0.6b-4bit", "MLX Qwen3 TTS 0.6B 4-bit", "mlx", "mlx_qwen3tts", ("MLX/Qwen3-TTS-12Hz-0.6B-Base-4bit", "MLX/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"), "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit", supports_instruction_prompt=True),
    ModelSpec("qwen3-tts-1.7b", "MLX Qwen3 TTS 1.7B VoiceDesign", "mlx", "mlx_qwen3tts", ("MLX/Qwen3-TTS-1.7B-VoiceDesign-bf16", "MLX/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"), "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16", supports_instruction_prompt=True),
    ModelSpec("qwen3-tts-1.7b-base", "MLX Qwen3 TTS 1.7B Base", "mlx", "mlx_qwen3tts", ("MLX/Qwen3-TTS-12Hz-1.7B-Base-bf16", "MLX/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"), "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16", supports_instruction_prompt=True),
    ModelSpec("dia-1.6b", "MLX Dia 1.6B", "mlx", "mlx_dia", ("MLX/Dia-1.6B-fp16", "MLX/mlx-community/Dia-1.6B-fp16"), "mlx-community/Dia-1.6B-fp16"),
    ModelSpec("csm-1b", "MLX CSM 1B", "mlx", "mlx_csm", ("MLX/CSM-1B", "MLX/mlx-community/csm-1b"), "mlx-community/csm-1b"),
    ModelSpec("spark-tts-0.5b", "MLX Spark TTS 0.5B", "mlx", "mlx_spark", ("MLX/Spark-TTS-0.5B-bf16", "MLX/mlx-community/Spark-TTS-0.5B-bf16"), "mlx-community/Spark-TTS-0.5B-bf16"),
    ModelSpec("outetts-0.6b", "MLX OuteTTS 0.6B", "mlx", "mlx_oute", ("MLX/OuteTTS-1.0-0.6B-fp16", "MLX/mlx-community/OuteTTS-1.0-0.6B-fp16"), "mlx-community/OuteTTS-1.0-0.6B-fp16", unavailable_reason="Disabled in app catalog: current mlx-audio runtime does not generate usable audio for this checkpoint."),
    ModelSpec("ming-omni-0.5b", "MLX Ming-omni TTS 0.5B", "mlx", "mlx_ming", ("MLX/Ming-omni-tts-0.5B-4bit", "MLX/mlx-community/Ming-omni-tts-0.5B-4bit"), "mlx-community/Ming-omni-tts-0.5B-4bit", supports_instruction_prompt=True),
    ModelSpec("kugel-audio-7b", "MLX KugelAudio 7B", "mlx", "mlx_kugel", ("MLX/kugelaudio-0-open", "MLX/mlx-community/kugelaudio-0-open"), "kugelaudio/kugelaudio-0-open"),
    ModelSpec("bark-small", "MLX Bark Small", "mlx", "mlx_bark", ("MLX/bark-small", "MLX/mlx-community/bark-small", "MLX/mlx_bark"), "mlx-community/bark-small"),
    ModelSpec("fish-audio-s2-pro", "MLX Fish Audio S2 Pro", "mlx", "mlx_fish", ("MLX/fish-audio-s2-pro-bf16", "MLX/mlx-community/fish-audio-s2-pro-bf16"), "mlx-community/fish-audio-s2-pro-bf16"),
    ModelSpec("lfm2-5-audio-1-5b", "MLX LFM2.5 Audio 1.5B", "mlx", "mlx_lfm", ("MLX/LFM2.5-Audio-1.5B-bf16", "MLX/mlx-community/LFM2.5-Audio-1.5B-bf16"), "mlx-community/LFM2.5-Audio-1.5B-bf16", supports_instruction_prompt=True),
    ModelSpec("pocket-tts", "MLX Pocket TTS", "mlx", "mlx_pocket", ("MLX/pocket-tts", "MLX/mlx-community/pocket-tts"), "mlx-community/pocket-tts"),
    ModelSpec("voxcpm2-4bit", "MLX VoxCPM2 4-bit", "mlx", "mlx_voxcpm2", ("MLX/VoxCPM2-4bit", "MLX/mlx-community/VoxCPM2-4bit"), "mlx-community/VoxCPM2-4bit", supports_instruction_prompt=True),
    ModelSpec("pocket-tts-4bit", "MLX Pocket TTS 4-bit", "mlx", "mlx_pocket", ("MLX/pocket-tts-4bit", "MLX/mlx-community/pocket-tts-4bit"), "mlx-community/pocket-tts-4bit"),
    ModelSpec("pocket-tts-8bit", "MLX Pocket TTS 8-bit", "mlx", "mlx_pocket", ("MLX/pocket-tts-8bit", "MLX/mlx-community/pocket-tts-8bit"), "mlx-community/pocket-tts-8bit"),
    ModelSpec("voxtral-tts-4b", "MLX Voxtral TTS 4B", "mlx", "mlx_voxtral", ("MLX/Voxtral-TTS-4B-MLX-6bit", "MLX/Voxtral-4B-TTS-2603-mlx-bf16", "Voxtral-TTS-4B-MLX-6bit"), "mlx-community/Voxtral-4B-TTS-2603-mlx-bf16"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--suite",
        choices=("hard", "style"),
        default="hard",
        help="Run the baseline hard TTS benchmark or the style/emotion benchmark",
    )
    parser.add_argument("--models", default="", help="Comma-separated model ids to run")
    parser.add_argument("--case-limit", type=int, default=0, help="Limit cases per model; 0 runs all")
    parser.add_argument("--timeout", type=int, default=240, help="Per-case synthesis timeout in seconds")
    parser.add_argument("--output-dir", default="", help="Defaults to output/tts-model-eval or output/tts-style-eval by suite")
    parser.add_argument("--download-missing", action="store_true", help="Download missing Hugging Face snapshots where known")
    parser.add_argument("--include-disabled", action="store_true", help="Attempt catalog-disabled models")
    parser.add_argument("--no-asr-roundtrip", action="store_true", help="Skip ASR round-trip WER scoring")
    parser.add_argument(
        "--asr-model",
        default=str(DEFAULT_ASR_JUDGE_MODEL),
        help="faster-whisper model path or id used as the ASR judge",
    )
    parser.add_argument(
        "--reuse-audio",
        action="store_true",
        help="Reuse existing WAVs in --output-dir/audio instead of synthesizing again and preserve prior synthesis metrics when available",
    )
    parser.add_argument("--list", action="store_true", help="Print model inventory and exit")
    return parser.parse_args()


def selected_models(raw: str, include_disabled: bool) -> list[ModelSpec]:
    requested = {item.strip() for item in raw.split(",") if item.strip()}
    models = [model for model in MODELS if not model.unavailable_reason or include_disabled]
    if requested:
        models = [model for model in models if model.id in requested]
    return models


def resolve_model_root(model: ModelSpec) -> Path | None:
    bases = [TTS_STORE, TTS_PACKS]
    for rel in model.candidate_dirs:
        for base in bases:
            candidate = base / rel
            root = resolve_extracted_root(candidate)
            if root and model_root_is_ready(model, root):
                return root
    return None


def model_root_is_ready(model: ModelSpec, root: Path) -> bool:
    if model.family == "qwen3":
        return (
            (root / "config.json").exists()
            and (root / "speech_tokenizer").is_dir()
            and ((root / "tokenizer.json").exists() or (root / "vocab.json").exists())
        )
    return True


def resolve_extracted_root(path: Path) -> Path | None:
    if not path.exists():
        return None
    if path.is_file():
        return None
    if looks_like_model_root(path):
        return path
    try:
        dirs = [entry for entry in path.iterdir() if entry.is_dir() and not entry.name.startswith(".")]
    except OSError:
        return path
    if len(dirs) == 1 and looks_like_model_root(dirs[0]):
        return dirs[0]
    return path


def looks_like_model_root(path: Path) -> bool:
    markers = (
        "config.json",
        "model.safetensors",
        "vox_jot_tts_manifest.json",
        "checkpoints",
        "runner",
        "LFM2.5-Audio-1.5B-Q4_0.gguf",
    )
    return any((path / marker).exists() for marker in markers)


def hf_download(model: ModelSpec, target: Path) -> str | None:
    if not model.hf_repo:
        return "no Hugging Face repo is configured for this model"
    target.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-c",
        (
            "from huggingface_hub import snapshot_download; "
            "import sys; "
            "snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2], "
            "local_dir_use_symlinks=False, resume_download=True)"
        ),
        model.hf_repo,
        str(target),
    ]
    result = subprocess.run(command, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode == 0:
        return None
    if "No module named" in result.stderr:
        hf_cli = shutil.which("hf") or shutil.which("huggingface-cli")
        if hf_cli:
            cli = [hf_cli, "download", model.hf_repo, "--local-dir", str(target)]
            cli_result = subprocess.run(cli, cwd=PROJECT_ROOT, text=True, capture_output=True)
            if cli_result.returncode == 0:
                return None
            return cli_result.stderr.strip() or cli_result.stdout.strip()
    return result.stderr.strip() or result.stdout.strip()


def maybe_download(model: ModelSpec) -> str | None:
    if resolve_model_root(model):
        return None
    if model.family == "sherpa" and model.id in SHERPA_PACKS:
        return download_sherpa_pack(model)
    if model.family == "mlx" and model.hf_repo:
        first_dir = model.candidate_dirs[0]
        return hf_download(model, TTS_STORE / first_dir)
    if model.family == "managed" and model.hf_repo:
        return hf_download(model, TTS_STORE / model.candidate_dirs[0])
    if model.family == "qwen3" and model.hf_repo:
        return hf_download(model, TTS_STORE / model.candidate_dirs[0])
    return "not installed and this runner does not know a safe direct download for it"


def download_sherpa_pack(model: ModelSpec) -> str | None:
    spec = SHERPA_PACKS[model.id]
    install_dir = TTS_PACKS / model.id
    archive_dir = TTS_ROOT / "downloads"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / f"{model.id}.tar.bz2"
    if not archive_path.exists():
        result = subprocess.run(
            ["curl", "-L", "--fail", "-o", str(archive_path), spec["source_url"]],
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            return result.stderr.strip() or result.stdout.strip() or "curl failed"
    install_dir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["tar", "-xjf", str(archive_path), "-C", str(install_dir)],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        return result.stderr.strip() or result.stdout.strip() or "tar extraction failed"
    root = resolve_extracted_root(install_dir)
    if not root:
        return "Sherpa pack extraction did not produce a model directory"
    manifest = {
        "id": model.id,
        "label": spec["label"],
        "locale": spec["locale"],
        "source_url": spec["source_url"],
        "source_name": "k2-fsa sherpa-onnx tts-models",
        "model_family": "vits",
        "model_file": spec["model_file"],
        "tokens_file": spec["tokens_file"],
        "data_dir": spec["data_dir"],
        "lexicon_file": spec["lexicon_file"],
        "rule_fsts": spec["rule_fsts"],
    }
    (root / "vox_jot_tts_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return None


def write_json_line(proc: subprocess.Popen[str], payload: dict[str, Any]) -> None:
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(payload) + "\n")
    proc.stdin.flush()


def read_json_line(proc: subprocess.Popen[str], timeout: int) -> dict[str, Any]:
    assert proc.stdout is not None
    deadline = time.monotonic() + timeout
    line = ""
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if line:
            stripped = line.strip()
            if not stripped.startswith("{"):
                continue
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                continue
        if proc.poll() is not None:
            break
    raise TimeoutError("worker did not emit a JSON response")


def run_command(command: list[str], timeout: int, env: dict[str, str] | None = None, cwd: Path | None = None) -> tuple[int, str, str, float]:
    started = time.perf_counter()
    try:
        result = subprocess.run(
            command,
            cwd=cwd or PROJECT_ROOT,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
        )
        elapsed = time.perf_counter() - started
        return result.returncode, result.stdout, result.stderr, elapsed
    except subprocess.TimeoutExpired as exc:
        elapsed = time.perf_counter() - started
        return 124, exc.stdout or "", exc.stderr or f"timed out after {timeout}s", elapsed


def synthesize_managed(model: ModelSpec, model_root: Path, case: dict[str, Any], timeout: int) -> tuple[Path | None, str | None, float]:
    python = SPEECH_RUNTIME_STATE / f"envs/{model.provider}/bin/python"
    if not python.exists():
        python = MANAGED_RUNTIME / ".venv/bin/python"
    if not python.exists() or not MANAGED_WORKER.exists():
        return None, "managed speech runtime or provider environment is missing", 0.0

    started = time.perf_counter()
    proc = subprocess.Popen(
        [
            str(python),
            str(MANAGED_WORKER),
            "--provider-id",
            model.provider,
            "--model-id",
            model.id,
            "--model-dir",
            str(model_root),
            "--state-dir",
            str(SPEECH_RUNTIME_STATE),
            "--profiles-dir",
            str(SPEECH_PROFILES),
        ],
        cwd=MANAGED_RUNTIME,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        payload = {
            "text": case["text"],
            "voice": model.voice,
            "locale": case["locale"],
            "speed": 1.0,
            "controls": case.get("controls", {}),
            "normalized_controls": {},
        }
        write_json_line(proc, {"action": "synthesize", "payload": payload})
        response = read_json_line(proc, timeout)
        elapsed = time.perf_counter() - started
        if not response.get("ok"):
            return None, response.get("error") or "managed worker failed", elapsed
        return Path(response["output_path"]), None, elapsed
    except Exception as exc:
        return None, str(exc), time.perf_counter() - started
    finally:
        proc.kill()


def synthesize_mlx(model: ModelSpec, model_root: Path, case: dict[str, Any], output_path: Path, timeout: int) -> tuple[Path | None, str | None, float]:
    if not MLX_AUDIO_PYTHON.exists() or not MLX_AUDIO_BRIDGE.exists():
        return None, "MLX audio Python environment or bridge script is missing", 0.0
    command = [
        str(MLX_AUDIO_PYTHON),
        "-W",
        "ignore",
        str(MLX_AUDIO_BRIDGE),
        "--model",
        str(model_root),
        "--text",
        case["text"],
        "--output",
        str(output_path),
        "--lang-code",
        locale_to_lang(case["locale"]),
        "--speed",
        "1",
        "--temperature",
        "0.7",
        "--repetition-penalty",
        "1.1",
    ]
    instruction_prompt = case.get("instruction_prompt") if model.supports_instruction_prompt else None
    if model.supports_instruction_prompt:
        command.extend(["--instruct", instruction_prompt or "A clear natural voice with neutral pacing for practical app readback."])
    code, stdout, stderr, elapsed = run_command(command, timeout, env={**os.environ, "PYTHONUNBUFFERED": "1"})
    if code != 0:
        return None, (stderr.strip() or stdout.strip() or f"exit code {code}")[-1200:], elapsed
    return output_path, None, elapsed


def synthesize_sherpa(model_root: Path, case: dict[str, Any], output_path: Path, timeout: int) -> tuple[Path | None, str | None, float]:
    runtime_root = resolve_sherpa_runtime_root()
    if not runtime_root:
        return None, "Sherpa runtime is missing", 0.0
    binary = runtime_root / "bin/sherpa-onnx-offline-tts"
    manifest = find_first(model_root, "vox_jot_tts_manifest.json")
    if not binary.exists() or not manifest:
        return None, "Sherpa binary or pack manifest is missing", 0.0
    data = json.loads(manifest.read_text())
    pack_root = manifest.parent
    if not (pack_root / data["model_file"]).exists():
        children = [entry for entry in pack_root.iterdir() if entry.is_dir() and not entry.name.startswith(".")]
        if len(children) == 1:
            pack_root = children[0]
            nested_manifest = pack_root / "vox_jot_tts_manifest.json"
            if nested_manifest.exists():
                data = json.loads(nested_manifest.read_text())
    command = [
        str(binary),
        f"--output-filename={output_path}",
        "--num-threads=2",
        f"--vits-model={pack_root / data['model_file']}",
        f"--vits-tokens={pack_root / data['tokens_file']}",
        "--vits-length-scale=1.000",
    ]
    if data.get("data_dir") and (pack_root / data["data_dir"]).exists():
        command.append(f"--vits-data-dir={pack_root / data['data_dir']}")
    if data.get("lexicon_file"):
        command.append(f"--vits-lexicon={pack_root / data['lexicon_file']}")
    if data.get("rule_fsts"):
        joined = ",".join(str(pack_root / item) for item in data["rule_fsts"])
        command.append(f"--tts-rule-fsts={joined}")
    command.append(case["text"])
    env = {**os.environ, "DYLD_LIBRARY_PATH": str(runtime_root / "lib")}
    code, stdout, stderr, elapsed = run_command(command, timeout, env=env)
    if code != 0:
        return None, stderr.strip() or stdout.strip() or f"exit code {code}", elapsed
    return output_path, None, elapsed


def resolve_sherpa_runtime_root() -> Path | None:
    root = TTS_RUNTIME / "macos-universal2"
    if (root / "bin/sherpa-onnx-offline-tts").exists():
        return root
    if not root.exists():
        return None
    for candidate in root.rglob("sherpa-onnx-offline-tts"):
        if candidate.parent.name == "bin":
            return candidate.parent.parent
    return None


def synthesize_qwen(model_root: Path, case: dict[str, Any], output_path: Path, timeout: int) -> tuple[Path | None, str | None, float]:
    runtime_root = resolve_qwen_runtime_root() or LEGACY_QWEN_RUNTIME
    binary = runtime_root / "tts"
    if not binary.exists():
        return None, "Qwen3 native runtime binary is missing", 0.0
    temp_dir = output_path.parent / f"qwen-{output_path.stem}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    code, stdout, stderr, elapsed = run_command(
        [str(binary), str(model_root), case["text"]],
        timeout,
        cwd=temp_dir,
    )
    produced = temp_dir / "output.wav"
    if code != 0:
        return None, stderr.strip() or stdout.strip() or f"exit code {code}", elapsed
    if not produced.exists():
        return None, "Qwen3 completed without output.wav", elapsed
    shutil.copyfile(produced, output_path)
    shutil.rmtree(temp_dir, ignore_errors=True)
    return output_path, None, elapsed


def resolve_qwen_runtime_root() -> Path | None:
    root = TTS_RUNTIME / "qwen3-macos-aarch64"
    if (root / "tts").exists():
        return root
    if not root.exists():
        return None
    for candidate in root.rglob("tts"):
        if candidate.is_file():
            return candidate.parent
    return None


def synthesize_lfm(model_root: Path, case: dict[str, Any], output_path: Path, timeout: int) -> tuple[Path | None, str | None, float]:
    binary = model_root / "runner/llama-liquid-audio-cli"
    if not binary.exists():
        return None, "LFM Audio GGUF runner binary is missing", 0.0
    command = [
        str(binary),
        "-m",
        str(model_root / "LFM2.5-Audio-1.5B-Q4_0.gguf"),
        "--mmproj",
        str(model_root / "mmproj-LFM2.5-Audio-1.5B-Q4_0.gguf"),
        "-mv",
        str(model_root / "vocoder-LFM2.5-Audio-1.5B-Q4_0.gguf"),
        "--tts-speaker-file",
        str(model_root / "tokenizer-LFM2.5-Audio-1.5B-Q4_0.gguf"),
        "-sys",
        case.get("instruction_prompt") or "Perform TTS. Use the US female voice.",
        "-p",
        case["text"],
        "-o",
        str(output_path),
    ]
    code, stdout, stderr, elapsed = run_command(command, timeout)
    if code != 0:
        return None, (stderr.strip() or stdout.strip() or f"exit code {code}")[-1200:], elapsed
    return output_path, None, elapsed


def synthesize_vibevoice(model_root: Path, case: dict[str, Any], output_path: Path, timeout: int) -> tuple[Path | None, str | None, float]:
    runtime_root = PROJECT_ROOT / "speech-runtime"
    python = runtime_root / ".venv/bin/python"
    bridge = runtime_root / "vibevoice_bridge.py"
    voices_dir = runtime_root / "vendor/VibeVoice/demo/voices/streaming_model"
    if not python.exists() or not bridge.exists() or not voices_dir.exists():
        return None, "VibeVoice bridge, repo venv, or vendor voices are missing", 0.0
    command = [
        str(python),
        str(bridge),
        "--model-path",
        str(model_root),
        "--voices-dir",
        str(voices_dir),
        "--text",
        case["text"],
        "--output",
        str(output_path),
        "--speaker",
        "en-Carter_man",
    ]
    env = {**os.environ, "PYTORCH_MPS_HIGH_WATERMARK_RATIO": "0.0", "PYTHONUNBUFFERED": "1"}
    code, stdout, stderr, elapsed = run_command(command, timeout, env=env, cwd=runtime_root)
    if code != 0:
        return None, (stderr.strip() or stdout.strip() or f"exit code {code}")[-1200:], elapsed
    return output_path, None, elapsed


def synthesize(model: ModelSpec, model_root: Path, case: dict[str, Any], output_path: Path, timeout: int) -> tuple[Path | None, str | None, float]:
    if model.family == "managed":
        return synthesize_managed(model, model_root, case, timeout)
    if model.family == "mlx":
        return synthesize_mlx(model, model_root, case, output_path, timeout)
    if model.family == "sherpa":
        return synthesize_sherpa(model_root, case, output_path, timeout)
    if model.family == "qwen3":
        return synthesize_qwen(model_root, case, output_path, timeout)
    if model.family == "lfm_gguf":
        return synthesize_lfm(model_root, case, output_path, timeout)
    if model.family == "vibevoice":
        return synthesize_vibevoice(model_root, case, output_path, timeout)
    return None, f"unsupported model family {model.family}", 0.0


def analyze_wav(path: Path) -> dict[str, Any]:
    try:
        return analyze_pcm_wav(path)
    except wave.Error:
        converted = path.with_suffix(".pcm16.wav")
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(converted),
            ],
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            return {"error": result.stderr.strip() or "ffmpeg could not decode WAV"}
        metrics = analyze_pcm_wav(converted)
        metrics["decoded_from"] = "non_pcm16_wav"
        return metrics


def analyze_pcm_wav(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frames = wav.getnframes()
        raw = wav.readframes(frames)
    if sample_width != 2:
        return {
            "sample_rate": sample_rate,
            "channels": channels,
            "duration_s": frames / sample_rate if sample_rate else 0,
            "error": f"unsupported sample width {sample_width}",
        }
    import array

    samples = array.array("h")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        return {"sample_rate": sample_rate, "channels": channels, "duration_s": 0, "rms": 0}
    values = [sample / 32768.0 for sample in samples]
    abs_values = [abs(value) for value in values]
    rms = math.sqrt(sum(value * value for value in values) / len(values))
    silence = sum(1 for value in abs_values if value < 0.005) / len(abs_values)
    clipped = sum(1 for value in abs_values if value > 0.98) / len(abs_values)
    peak = max(abs_values)
    return {
        "sample_rate": sample_rate,
        "channels": channels,
        "duration_s": round(frames / sample_rate, 3) if sample_rate else 0,
        "rms": round(rms, 5),
        "peak": round(peak, 5),
        "silence_ratio": round(silence, 4),
        "clipped_ratio": round(clipped, 6),
        "bytes": path.stat().st_size,
    }


def normalize_for_wer(text: str) -> list[str]:
    text = normalize_numeric_transcript(text)
    normalized = unicodedata.normalize("NFKD", text.lower())
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = normalized.replace("api_url", "api url")
    normalized = normalized.replace("p.m.", "pm").replace("a.m.", "am")
    normalized = normalized.replace("slash", " ")
    normalized = normalized.replace("colon", " ")
    normalized = re.sub(r"https?://", " ", normalized)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return normalized.split()


def normalize_numeric_transcript(text: str) -> str:
    text = re.sub(r"\$([0-9][0-9,]*)(?:\.([0-9]{1,2}))?", replace_money, text)
    text = re.sub(r"\b(\d{1,2})[:.](\d{2})\s*([ap])\.?m\.?\b", replace_clock, text, flags=re.IGNORECASE)
    text = re.sub(r"\b(20\d{2}|19\d{2})\b", replace_year, text)
    text = re.sub(r"\b\d+\b", replace_number, text)
    return text


def replace_money(match: re.Match[str]) -> str:
    dollars = int(match.group(1).replace(",", ""))
    cents = int((match.group(2) or "0").ljust(2, "0")[:2])
    parts = [number_to_words(dollars), "dollars"]
    if cents:
        parts.extend(["and", number_to_words(cents), "cents"])
    return " ".join(parts)


def replace_clock(match: re.Match[str]) -> str:
    hour = int(match.group(1))
    minute = int(match.group(2))
    suffix = "pm" if match.group(3).lower() == "p" else "am"
    if minute == 0:
        return f"{number_to_words(hour)} {suffix}"
    return f"{number_to_words(hour)} {number_to_words(minute)} {suffix}"


def replace_year(match: re.Match[str]) -> str:
    value = int(match.group(0))
    if 2000 <= value <= 2099:
        tail = value - 2000
        if tail == 0:
            return "two thousand"
        if tail < 10:
            return f"two thousand {number_to_words(tail)}"
        return f"twenty {number_to_words(tail)}"
    return number_to_words(value)


def replace_number(match: re.Match[str]) -> str:
    return number_to_words(int(match.group(0)))


def number_to_words(value: int) -> str:
    if value < 0:
        return f"minus {number_to_words(abs(value))}"
    small = [
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
    ]
    tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    if value < 20:
        return small[value]
    if value < 100:
        ten, rest = divmod(value, 10)
        return tens[ten] if rest == 0 else f"{tens[ten]} {small[rest]}"
    if value < 1000:
        hundred, rest = divmod(value, 100)
        return f"{small[hundred]} hundred" if rest == 0 else f"{small[hundred]} hundred {number_to_words(rest)}"
    if value < 1_000_000:
        thousands, rest = divmod(value, 1000)
        return f"{number_to_words(thousands)} thousand" if rest == 0 else f"{number_to_words(thousands)} thousand {number_to_words(rest)}"
    return str(value)


def edit_distance(left: list[str], right: list[str]) -> int:
    previous = list(range(len(right) + 1))
    current = [0] * (len(right) + 1)
    for i, left_token in enumerate(left, start=1):
        current[0] = i
        for j, right_token in enumerate(right, start=1):
            cost = 0 if left_token == right_token else 1
            current[j] = min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost,
            )
        previous, current = current, previous
    return previous[-1]


def word_error_rate(reference: str, hypothesis: str) -> float:
    reference_words = normalize_for_wer(reference)
    hypothesis_words = normalize_for_wer(hypothesis)
    if not reference_words:
        return 0.0 if not hypothesis_words else 1.0
    return edit_distance(reference_words, hypothesis_words) / len(reference_words)


class AsrRoundTripJudge:
    def __init__(self, model_name: str):
        from faster_whisper import WhisperModel

        self.model_name = model_name
        self.model = WhisperModel(model_name, device="cpu", compute_type="int8")

    def transcribe(self, audio_path: Path, locale: str) -> dict[str, Any]:
        started = time.perf_counter()
        language = locale_to_lang(locale)
        segments, info = self.model.transcribe(
            str(audio_path),
            language=language if language != "auto" else None,
            beam_size=1,
            best_of=1,
            vad_filter=False,
            condition_on_previous_text=False,
            temperature=0.0,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        elapsed = time.perf_counter() - started
        return {
            "text": text,
            "latency_ms": round(elapsed * 1000),
            "language": getattr(info, "language", language),
            "language_probability": round(float(getattr(info, "language_probability", 0.0)), 4),
        }


def audio_health_component(cases: list[dict[str, Any]]) -> float:
    if not cases:
        return 0.0
    audio_penalty = 0.0
    for case in cases:
        metrics = case["audio"]
        if metrics.get("duration_s", 0) < 0.4:
            audio_penalty += 0.25
        if metrics.get("rms", 0) < 0.003:
            audio_penalty += 0.25
        if metrics.get("silence_ratio", 1) > 0.85:
            audio_penalty += 0.15
        if metrics.get("clipped_ratio", 0) > 0.01:
            audio_penalty += 0.15
    return max(0.0, 1.0 - (audio_penalty / len(cases)))


def range_fit(value: float | None, low: float, high: float) -> float:
    if value is None:
        return 0.0
    if low <= value <= high:
        return 1.0
    width = max(high - low, 0.001)
    distance = low - value if value < low else value - high
    return max(0.0, 1.0 - distance / width)


def evaluate_style_alignment(case: dict[str, Any], metrics: dict[str, Any]) -> dict[str, Any] | None:
    targets = case.get("style_targets")
    if not isinstance(targets, dict):
        return None
    duration = metrics.get("duration_s") or 0
    word_count = len(normalize_for_wer(case["text"]))
    words_per_second = word_count / duration if duration else None
    features = {
        "words_per_second": round(words_per_second, 3) if words_per_second is not None else None,
        "rms": metrics.get("rms"),
        "silence_ratio": metrics.get("silence_ratio"),
    }
    component_scores = []
    for key, weight in (("words_per_second", 0.45), ("rms", 0.3), ("silence_ratio", 0.25)):
        bounds = targets.get(key)
        if not isinstance(bounds, list) or len(bounds) != 2:
            continue
        component_scores.append(
            range_fit(features.get(key), float(bounds[0]), float(bounds[1])) * weight
        )
    weight_sum = 1.0 if component_scores else 0.0
    score = sum(component_scores) / weight_sum if weight_sum else 0.0
    return {
        "target_style": case.get("target_style"),
        "score": round(max(0.0, min(1.0, score)), 4),
        "features": features,
        "targets": targets,
        "method": "prosody_proxy_v1",
    }


def summarize_style_alignment(cases: list[dict[str, Any]]) -> dict[str, Any] | None:
    values = [
        case["style_alignment"]["score"]
        for case in cases
        if isinstance(case.get("style_alignment"), dict)
        and isinstance(case["style_alignment"].get("score"), (int, float))
    ]
    if not values:
        return None
    return {
        "average_proxy": round(sum(values) / len(values), 4),
        "case_count": len(values),
        "method": "prosody_proxy_v1",
    }


def style_capability(model: ModelSpec) -> str:
    if model.supports_instruction_prompt:
        return "instruction_prompt"
    if model.provider == "chatterbox":
        return "expressiveness_controls"
    return "text_only"


def style_capability_weight(capability: str) -> float:
    if capability == "instruction_prompt":
        return 1.0
    if capability == "expressiveness_controls":
        return 0.9
    return 0.75


def score_cases(cases: list[dict[str, Any]], suite: str = "hard", capability: str = "text_only") -> float | None:
    tested = [case for case in cases if case["status"] == "tested"]
    if not tested:
        return None
    success = len(tested) / len(cases)
    rtf_values = [case.get("real_time_factor", 10.0) for case in tested]
    avg_rtf = sum(rtf_values) / len(rtf_values)
    wer_values = [
        case["asr_roundtrip"]["wer"]
        for case in tested
        if isinstance(case.get("asr_roundtrip"), dict)
        and isinstance(case["asr_roundtrip"].get("wer"), (int, float))
    ]
    asr_component = 1.0 - min(sum(wer_values) / len(wer_values), 1.0) if wer_values else 0.0
    latency_component = max(0.0, 1.0 - min(avg_rtf, 8.0) / 8.0)
    audio_component = audio_health_component(tested)
    if suite == "style":
        style_values = [
            case["style_alignment"]["score"]
            for case in tested
            if isinstance(case.get("style_alignment"), dict)
            and isinstance(case["style_alignment"].get("score"), (int, float))
        ]
        style_component = sum(style_values) / len(style_values) if style_values else 0.0
        style_component *= style_capability_weight(capability)
        score = 100.0 * (
            0.30 * style_component
            + 0.25 * asr_component
            + 0.20 * audio_component
            + 0.15 * success
            + 0.10 * latency_component
        )
    else:
        score = 100.0 * (
            0.40 * success
            + 0.30 * asr_component
            + 0.20 * latency_component
            + 0.10 * audio_component
        )
    return round(max(0.0, min(100.0, score)), 1)


def locale_to_lang(locale: str) -> str:
    return locale.split("-")[0].lower() if locale else "en"


def find_first(root: Path, name: str) -> Path | None:
    for candidate in root.rglob(name):
        return candidate
    return None


def run_model(
    model: ModelSpec,
    cases: list[dict[str, Any]],
    output_dir: Path,
    timeout: int,
    download_missing: bool,
    asr_judge: AsrRoundTripJudge | None,
    reuse_audio: bool,
    baseline_cases: BaselineCases,
    suite: str,
) -> dict[str, Any]:
    if model.unavailable_reason:
        return {
            "model_id": model.id,
            "label": model.label,
            "family": model.family,
            "status": "blocked",
            "notes": model.unavailable_reason,
            "cases": [],
        }

    model_root = resolve_model_root(model)
    download_error = None
    if not model_root and download_missing:
        download_error = maybe_download(model)
        model_root = resolve_model_root(model)
    if not model_root:
        return {
            "model_id": model.id,
            "label": model.label,
            "family": model.family,
            "status": "download_required",
            "notes": download_error or "model assets are not installed in the app TTS store",
            "cases": [],
        }

    model_dir = output_dir / "audio" / model.id
    model_dir.mkdir(parents=True, exist_ok=True)
    case_results: list[dict[str, Any]] = []
    for case in cases:
        output_path = model_dir / f"{case['id']}.wav"
        baseline_case = baseline_cases.get((model.id, case["id"]))
        baseline_output_path = resolve_baseline_output_path(baseline_case)
        if reuse_audio and (output_path.exists() or baseline_output_path):
            if not output_path.exists() and baseline_output_path:
                shutil.copyfile(baseline_output_path, output_path)
            wav_path, error = output_path, None
            elapsed = (baseline_case.get("latency_ms", 0) / 1000) if baseline_case else 0.0
        elif reuse_audio and baseline_case and baseline_case.get("status") != "tested":
            preserved = dict(baseline_case)
            preserved.setdefault("reference_text", case["text"])
            preserved["asr_roundtrip"] = None
            case_results.append(preserved)
            continue
        else:
            wav_path, error, elapsed = synthesize(model, model_root, case, output_path, timeout)
        if error or not wav_path or not wav_path.exists():
            case_results.append(
                {
                    "case_id": case["id"],
                    "label": case["label"],
                    "status": "failed",
                    "latency_ms": round(elapsed * 1000),
                    "error": error or "no output wav was produced",
                }
            )
            continue
        final_path = output_path
        if wav_path != output_path:
            shutil.copyfile(wav_path, output_path)
            final_path = output_path
        metrics = analyze_wav(final_path)
        duration = metrics.get("duration_s") or 0
        latency_ms = baseline_case.get("latency_ms") if reuse_audio and baseline_case else round(elapsed * 1000)
        real_time_factor = (
            baseline_case.get("real_time_factor") if reuse_audio and baseline_case else round(elapsed / duration, 3) if duration else None
        )
        style_alignment = evaluate_style_alignment(case, metrics) if suite == "style" else None
        asr_roundtrip = None
        if asr_judge is not None:
            try:
                asr_roundtrip = asr_judge.transcribe(final_path, case["locale"])
                asr_roundtrip["wer"] = round(
                    word_error_rate(case["text"], asr_roundtrip["text"]),
                    4,
                )
            except Exception as exc:
                asr_roundtrip = {"error": str(exc)}
        case_results.append(
            {
                "case_id": case["id"],
                "label": case["label"],
                "reference_text": case["text"],
                "status": "tested",
                "latency_ms": latency_ms,
                "real_time_factor": real_time_factor,
                "audio": metrics,
                "style_alignment": style_alignment,
                "target_style": case.get("target_style"),
                "instruction_prompt": case.get("instruction_prompt"),
                "asr_roundtrip": asr_roundtrip,
                "output_path": str(final_path.relative_to(PROJECT_ROOT)),
            }
        )
    capability = style_capability(model)
    score = score_cases(case_results, suite=suite, capability=capability)
    status = "tested" if any(case["status"] == "tested" for case in case_results) else "failed"
    return {
        "model_id": model.id,
        "label": model.label,
        "family": model.family,
        "provider": model.provider,
        "status": status,
        "score": score,
        "model_root": str(model_root),
        "style_capability": capability,
        "style_capability_weight": style_capability_weight(capability),
        "style_alignment": summarize_style_alignment(case_results),
        "asr_roundtrip": summarize_asr_roundtrip(case_results),
        "cases": case_results,
    }


def summarize_asr_roundtrip(cases: list[dict[str, Any]]) -> dict[str, Any] | None:
    values = [
        case["asr_roundtrip"]["wer"]
        for case in cases
        if isinstance(case.get("asr_roundtrip"), dict)
        and isinstance(case["asr_roundtrip"].get("wer"), (int, float))
    ]
    if not values:
        return None
    sorted_values = sorted(values)
    middle = len(sorted_values) // 2
    if len(sorted_values) % 2:
        median = sorted_values[middle]
    else:
        median = (sorted_values[middle - 1] + sorted_values[middle]) / 2
    return {
        "average_wer": round(sum(values) / len(values), 4),
        "median_wer": round(median, 4),
        "case_count": len(values),
    }


def load_baseline_cases(output_dir: Path, summary_name: str) -> BaselineCases:
    summary_path = output_dir / summary_name
    if not summary_path.exists():
        return {}
    try:
        summary = json.loads(summary_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    baseline: BaselineCases = {}
    for result in summary.get("results", []):
        model_id = result.get("model_id")
        if not isinstance(model_id, str):
            continue
        for case in result.get("cases", []):
            case_id = case.get("case_id")
            if isinstance(case_id, str):
                baseline[(model_id, case_id)] = case
    return baseline


def resolve_baseline_output_path(case: dict[str, Any] | None) -> Path | None:
    if not case:
        return None
    raw_path = case.get("output_path")
    if not isinstance(raw_path, str) or not raw_path:
        return None
    path = Path(raw_path)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path if path.exists() else None


def suite_defaults(suite: str) -> tuple[list[dict[str, Any]], Path, str, str, str]:
    if suite == "style":
        return (
            STYLE_CASES,
            PROJECT_ROOT / "output/tts-style-eval",
            "tts-style-eval-summary.json",
            "tts_style_emotion_preference_proxy",
            "30% style proxy, 25% ASR round-trip WER, 20% audio health, 15% synthesis success, 10% real-time factor.",
        )
    return (
        CASES,
        PROJECT_ROOT / "output/tts-model-eval",
        "tts-eval-summary.json",
        "tts_real_world_hard",
        "40% synthesis success, 30% ASR round-trip WER, 20% real-time factor, 10% audio health.",
    )


def write_listener_rating_template(output_dir: Path, results: list[dict[str, Any]]) -> None:
    template_path = output_dir / "listener-rating-template.csv"
    with template_path.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "model_id",
                "case_id",
                "target_style",
                "audio_path",
                "style_match_1_to_5",
                "naturalness_1_to_5",
                "intelligibility_1_to_5",
                "listening_fatigue_1_to_5",
                "overall_preference_1_to_5",
                "listener_notes",
            ],
        )
        writer.writeheader()
        for result in results:
            for case in result.get("cases", []):
                if case.get("status") != "tested":
                    continue
                writer.writerow(
                    {
                        "model_id": result.get("model_id"),
                        "case_id": case.get("case_id"),
                        "target_style": case.get("target_style"),
                        "audio_path": case.get("output_path"),
                        "style_match_1_to_5": "",
                        "naturalness_1_to_5": "",
                        "intelligibility_1_to_5": "",
                        "listening_fatigue_1_to_5": "",
                        "overall_preference_1_to_5": "",
                        "listener_notes": "",
                    }
                )


def print_inventory(models: list[ModelSpec]) -> None:
    for model in models:
        root = resolve_model_root(model)
        status = "disabled" if model.unavailable_reason else ("installed" if root else "missing")
        print(f"{model.id:32} {status:10} {model.family:10} {root or ''}")


def main() -> int:
    args = parse_args()
    models = selected_models(args.models, args.include_disabled)
    if args.list:
        print_inventory(models)
        return 0

    default_cases, default_output_dir, summary_name, suite_name, score_formula = suite_defaults(args.suite)
    output_dir = Path(args.output_dir).resolve() if args.output_dir else default_output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    baseline_cases = load_baseline_cases(output_dir, summary_name) if args.reuse_audio else {}
    cases = default_cases[: args.case_limit] if args.case_limit > 0 else default_cases
    asr_judge = None
    if not args.no_asr_roundtrip:
        print(f"Loading ASR round-trip judge: {args.asr_model}", flush=True)
        asr_judge = AsrRoundTripJudge(args.asr_model)

    results = []
    for model in models:
        print(f"Testing {model.id} ({model.label})...", flush=True)
        results.append(
            run_model(
                model,
                cases,
                output_dir,
                args.timeout,
                args.download_missing,
                asr_judge,
                args.reuse_audio,
                baseline_cases,
                args.suite,
            )
        )

    ranked = sorted(
        [result for result in results if result.get("score") is not None],
        key=lambda result: result["score"],
        reverse=True,
    )
    for index, result in enumerate(ranked, start=1):
        result["rank"] = index

    summary = {
        "run": {
            "suite": suite_name,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "host": platform.platform(),
            "cases": [case["id"] for case in cases],
            "asr_roundtrip": None
            if args.no_asr_roundtrip
            else {
                "judge": args.asr_model,
                "metric": "WER against normalized source prompt",
            },
            "style_rubric": STYLE_RUBRIC if args.suite == "style" else None,
            "score_formula": score_formula,
            "notes": (
                "Generated audio is stored under output/tts-style-eval/audio. Scoring combines a heuristic style-alignment proxy, ASR round-trip WER, audio health, success, and real-time factor. Human listener preference ratings are not collected by this automatic runner."
                if args.suite == "style"
                else "Generated audio is stored under output/tts-model-eval/audio. Scoring combines synthesis success, ASR round-trip WER, real-time factor, and WAV health checks. Reused-audio runs preserve prior synthesis latency when a baseline summary exists."
            ),
        },
        "results": results,
    }
    (output_dir / summary_name).write_text(json.dumps(summary, indent=2) + "\n")
    if args.suite == "style":
        write_listener_rating_template(output_dir, results)
    print(f"Wrote {output_dir / summary_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
