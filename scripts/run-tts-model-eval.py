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
import urllib.error
import urllib.request
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
DEFAULT_ASR_JUDGE_MODEL = "Systran/faster-whisper-small"
DEFAULT_CLONE_REFERENCE_AUDIO = PROJECT_ROOT / "src-tauri/resources/python/mlx_csm_default_prompt.wav"
DEFAULT_CLONE_REFERENCE_TEXT = PROJECT_ROOT / "src-tauri/resources/python/mlx_csm_default_prompt.txt"

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

VOICE_CLONE_RUBRIC = {
    "automatic_proxy": {
        "speaker_similarity": "Deterministic acoustic fingerprint similarity between the reference clip and generated WAV.",
        "intelligibility": "ASR round-trip WER against the source text.",
        "audio_health": "Generated WAV duration, RMS, silence, and clipping checks.",
        "latency": "Real-time factor; lower is better.",
    },
    "listener_preference": {
        "status": "manual_ratings_not_collected",
        "scale": "1-5 per dimension, blind to model id when collected.",
        "dimensions": [
            "speaker_match",
            "naturalness",
            "intelligibility",
            "reference_artifacts",
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
    "tts-sherpa-en-us-amy-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2",
        "label": "English (US) - Amy",
        "locale": "en-US",
        "model_file": "en_US-amy-medium.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": "espeak-ng-data",
        "lexicon_file": None,
        "rule_fsts": [],
    },
    "tts-sherpa-en-gb-alan-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_GB-alan-medium.tar.bz2",
        "label": "English (UK) - Alan",
        "locale": "en-GB",
        "model_file": "en_GB-alan-medium.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": "espeak-ng-data",
        "lexicon_file": None,
        "rule_fsts": [],
    },
    "tts-sherpa-de-de-thorsten-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-de_DE-thorsten-medium.tar.bz2",
        "label": "German - Thorsten",
        "locale": "de-DE",
        "model_file": "de_DE-thorsten-medium.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": "espeak-ng-data",
        "lexicon_file": None,
        "rule_fsts": [],
    },
    "tts-sherpa-es-es-davefx-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-es_ES-davefx-medium.tar.bz2",
        "label": "Spanish (Spain) - DaveFX",
        "locale": "es-ES",
        "model_file": "es_ES-davefx-medium.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": "espeak-ng-data",
        "lexicon_file": None,
        "rule_fsts": [],
    },
    "tts-sherpa-fr-fr-siwis-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fr_FR-siwis-medium.tar.bz2",
        "label": "French - Siwis",
        "locale": "fr-FR",
        "model_file": "fr_FR-siwis-medium.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": "espeak-ng-data",
        "lexicon_file": None,
        "rule_fsts": [],
    },
    "tts-sherpa-it-it-paola-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-it_IT-paola-medium.tar.bz2",
        "label": "Italian - Paola",
        "locale": "it-IT",
        "model_file": "it_IT-paola-medium.onnx",
        "tokens_file": "tokens.txt",
        "data_dir": "espeak-ng-data",
        "lexicon_file": None,
        "rule_fsts": [],
    },
    "tts-sherpa-pt-br-faber-medium": {
        "source_url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-pt_BR-faber-medium.tar.bz2",
        "label": "Portuguese (Brazil) - Faber",
        "locale": "pt-BR",
        "model_file": "pt_BR-faber-medium.onnx",
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
            "For today's meeting, please summarize the launch plan, blockers, owners, "
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


VOICE_CLONE_CASES = [
    {
        "id": "clone_casual_reply",
        "label": "Cloned Casual Reply",
        "text": "Yeah, I can take a look after lunch and send you the cleaned up notes.",
        "locale": "en-US",
        "clone_reference_audio": str(DEFAULT_CLONE_REFERENCE_AUDIO),
        "clone_reference_text": DEFAULT_CLONE_REFERENCE_TEXT.read_text(encoding="utf-8").strip()
        if DEFAULT_CLONE_REFERENCE_TEXT.exists()
        else "",
        "controls": {"temperature": 0.65, "repetition_penalty": 1.2, "tau": 0.35},
    },
    {
        "id": "clone_meeting_room",
        "label": "Cloned Meeting Room Summary",
        "text": (
            "For the meeting recap, highlight the decision, the owner, the due date, "
            "and the one risk that still needs review before Friday."
        ),
        "locale": "en-US",
        "clone_reference_audio": str(DEFAULT_CLONE_REFERENCE_AUDIO),
        "clone_reference_text": DEFAULT_CLONE_REFERENCE_TEXT.read_text(encoding="utf-8").strip()
        if DEFAULT_CLONE_REFERENCE_TEXT.exists()
        else "",
        "controls": {"temperature": 0.62, "repetition_penalty": 1.35, "tau": 0.35},
    },
    {
        "id": "clone_code_review",
        "label": "Cloned Code Review Dictation",
        "text": (
            "In the pull request, check the debounce timer, the async error path, "
            "and the API key redaction before approving the build."
        ),
        "locale": "en-US",
        "clone_reference_audio": str(DEFAULT_CLONE_REFERENCE_AUDIO),
        "clone_reference_text": DEFAULT_CLONE_REFERENCE_TEXT.read_text(encoding="utf-8").strip()
        if DEFAULT_CLONE_REFERENCE_TEXT.exists()
        else "",
        "controls": {"temperature": 0.6, "repetition_penalty": 1.45, "tau": 0.35},
    },
    {
        "id": "clone_noisy_realworld",
        "label": "Cloned Noisy Real-World Text",
        "text": (
            "Sorry, quick correction. The call moved to three twenty five, "
            "and the room changed from Studio B to the north conference room."
        ),
        "locale": "en-US",
        "clone_reference_audio": str(DEFAULT_CLONE_REFERENCE_AUDIO),
        "clone_reference_text": DEFAULT_CLONE_REFERENCE_TEXT.read_text(encoding="utf-8").strip()
        if DEFAULT_CLONE_REFERENCE_TEXT.exists()
        else "",
        "controls": {"temperature": 0.65, "repetition_penalty": 1.3, "tau": 0.4},
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
    supports_voice_cloning: bool = False
    notes: str = ""


@dataclass(frozen=True)
class AppApiConfig:
    base_url: str
    token: str
    timeout: int


MODELS: tuple[ModelSpec, ...] = (
    ModelSpec("system-default", "Apple System Voice", "system", "system_builtin"),
    ModelSpec("openvoice", "OpenVoice", "managed", "openvoice", ("OpenVoice", "openvoice"), voice="default", supports_voice_cloning=True),
    ModelSpec("chatterbox", "Chatterbox", "managed", "chatterbox", ("chatterbox", "Chatterbox"), hf_repo="ResembleAI/chatterbox"),
    ModelSpec(
        "chatterbox-turbo",
        "Chatterbox Turbo",
        "managed",
        "chatterbox",
        ("chatterbox-turbo/chatterbox-turbo", "chatterbox-turbo", "Chatterbox-Turbo"),
        hf_repo="ResembleAI/chatterbox-turbo",
        supports_voice_cloning=True,
    ),
    ModelSpec(
        "chatterbox-multilingual",
        "Chatterbox Multilingual",
        "managed",
        "chatterbox",
        ("chatterbox-multilingual/chatterbox", "chatterbox-multilingual", "chatterbox", "Chatterbox"),
        hf_repo="ResembleAI/chatterbox",
        supports_voice_cloning=True,
    ),
    ModelSpec("kokoro-82m-v1.0", "Kokoro 82M", "managed", "kokoro", ("Kokoro", "kokoro"), voice="af_heart"),
    ModelSpec("xtts-v2", "XTTS v2", "managed", "xtts", ("Coqui/XTTS", "coqui-tts", "XTTS"), hf_repo="coqui/XTTS-v2", supports_voice_cloning=True),
    ModelSpec("supertonic-3", "Supertonic 3", "managed", "supertonic", ("supertonic-3", "Supertone/supertonic-3"), hf_repo="Supertone/supertonic-3", voice="M1"),
    ModelSpec("tts-sherpa-en-us-lessac-medium", "Sherpa Lessac Medium", "sherpa", "sherpa", ("tts-sherpa-en-us-lessac-medium",)),
    ModelSpec("tts-sherpa-en-us-amy-medium", "Sherpa Amy Medium", "sherpa", "sherpa", ("tts-sherpa-en-us-amy-medium",)),
    ModelSpec("tts-sherpa-en-gb-alan-medium", "Sherpa Alan Medium", "sherpa", "sherpa", ("tts-sherpa-en-gb-alan-medium",)),
    ModelSpec("tts-sherpa-de-de-thorsten-medium", "Sherpa Thorsten Medium", "sherpa", "sherpa", ("tts-sherpa-de-de-thorsten-medium",)),
    ModelSpec("tts-sherpa-es-es-davefx-medium", "Sherpa DaveFX Medium", "sherpa", "sherpa", ("tts-sherpa-es-es-davefx-medium",)),
    ModelSpec("tts-sherpa-fr-fr-siwis-medium", "Sherpa Siwis Medium", "sherpa", "sherpa", ("tts-sherpa-fr-fr-siwis-medium",)),
    ModelSpec("tts-sherpa-it-it-paola-medium", "Sherpa Paola Medium", "sherpa", "sherpa", ("tts-sherpa-it-it-paola-medium",)),
    ModelSpec("tts-sherpa-pt-br-faber-medium", "Sherpa Faber Medium", "sherpa", "sherpa", ("tts-sherpa-pt-br-faber-medium",)),
    ModelSpec("tts-sherpa-zh-cn-melo", "Sherpa Melo Chinese/English", "sherpa", "sherpa", ("tts-sherpa-zh-cn-melo",)),
    ModelSpec("qwen3-0.6b-base", "Qwen3 Native 0.6B Base", "qwen3", "qwen3_native", ("qwen3/qwen3-0.6b-base", "qwen3-0.6b-base"), hf_repo="Qwen/Qwen3-TTS-12Hz-0.6B-Base", supports_voice_cloning=True),
    ModelSpec("lfm2-5-audio-1-5b-q4-0", "LFM2.5 Audio 1.5B GGUF Q4_0", "lfm_gguf", "lfm_audio_gguf", ("lfm-audio-gguf",)),
    ModelSpec("vibevoice-realtime-0-5b", "VibeVoice Realtime 0.5B", "vibevoice", "vibevoice", ("vibevoice",)),
    ModelSpec("kokoro-82m", "MLX Kokoro 82M", "mlx", "mlx_kokoro", ("MLX/Kokoro-82M-bf16", "MLX/mlx-community/Kokoro-82M-bf16", "Kokoro-82M-bf16"), "mlx-community/Kokoro-82M-bf16"),
    ModelSpec("chatterbox-mlx", "MLX Chatterbox", "mlx", "mlx_chatterbox", ("MLX/Chatterbox-fp16", "MLX/mlx-community/chatterbox-fp16", "Chatterbox-fp16"), "mlx-community/chatterbox-fp16"),
    ModelSpec("qwen3-tts-0.6b-4bit", "MLX Qwen3 TTS 0.6B 4-bit", "mlx", "mlx_qwen3tts", ("MLX/Qwen3-TTS-12Hz-0.6B-Base-4bit", "MLX/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"), "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("qwen3-tts-1.7b", "MLX Qwen3 TTS 1.7B VoiceDesign", "mlx", "mlx_qwen3tts", ("MLX/Qwen3-TTS-1.7B-VoiceDesign-bf16", "MLX/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"), "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("dia-1.6b", "MLX Dia 1.6B", "mlx", "mlx_dia", ("MLX/Dia-1.6B-fp16", "MLX/mlx-community/Dia-1.6B-fp16"), "mlx-community/Dia-1.6B-fp16"),
    ModelSpec("csm-1b", "MLX CSM 1B", "mlx", "mlx_csm", ("MLX/CSM-1B", "MLX/mlx-community/csm-1b"), "mlx-community/csm-1b", supports_voice_cloning=True),
    ModelSpec("spark-tts-0.5b", "MLX Spark TTS 0.5B", "mlx", "mlx_spark", ("MLX/Spark-TTS-0.5B-bf16", "MLX/mlx-community/Spark-TTS-0.5B-bf16"), "mlx-community/Spark-TTS-0.5B-bf16"),
    ModelSpec("outetts-1b-4bit", "MLX Llama OuteTTS 1B 4-bit", "mlx", "mlx_oute", ("MLX/Llama-OuteTTS-1.0-1B-4bit", "MLX/mlx-community/Llama-OuteTTS-1.0-1B-4bit"), "mlx-community/Llama-OuteTTS-1.0-1B-4bit", supports_voice_cloning=True),
    ModelSpec("ming-omni-0.5b", "MLX Ming-omni TTS 0.5B", "mlx", "mlx_ming", ("MLX/Ming-omni-tts-0.5B-4bit", "MLX/mlx-community/Ming-omni-tts-0.5B-4bit"), "mlx-community/Ming-omni-tts-0.5B-4bit", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("kugel-audio-7b", "MLX KugelAudio 7B", "mlx", "mlx_kugel", ("MLX/kugelaudio-0-open", "MLX/mlx-community/kugelaudio-0-open"), "kugelaudio/kugelaudio-0-open"),
    ModelSpec("bark-small", "MLX Bark Small", "mlx", "mlx_bark", ("MLX/bark-small", "MLX/mlx-community/bark-small", "MLX/mlx_bark"), "mlx-community/bark-small"),
    ModelSpec("fish-audio-s2-pro", "MLX Fish Audio S2 Pro", "mlx", "mlx_fish", ("MLX/fish-audio-s2-pro-bf16", "MLX/mlx-community/fish-audio-s2-pro-bf16"), "mlx-community/fish-audio-s2-pro-bf16", supports_voice_cloning=True),
    ModelSpec("lfm2-5-audio-1-5b", "MLX LFM2.5 Audio 1.5B", "mlx", "mlx_lfm", ("MLX/LFM2.5-Audio-1.5B-bf16", "MLX/mlx-community/LFM2.5-Audio-1.5B-bf16"), "mlx-community/LFM2.5-Audio-1.5B-bf16", supports_instruction_prompt=True),
    ModelSpec("pocket-tts", "MLX Pocket TTS", "mlx", "mlx_pocket", ("MLX/pocket-tts", "MLX/mlx-community/pocket-tts"), "mlx-community/pocket-tts", supports_voice_cloning=True),
    ModelSpec("voxcpm2-4bit", "MLX VoxCPM2 4-bit", "mlx", "mlx_voxcpm2", ("MLX/VoxCPM2-4bit", "MLX/mlx-community/VoxCPM2-4bit"), "mlx-community/VoxCPM2-4bit", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("pocket-tts-4bit", "MLX Pocket TTS 4-bit", "mlx", "mlx_pocket", ("MLX/pocket-tts-4bit", "MLX/mlx-community/pocket-tts-4bit"), "mlx-community/pocket-tts-4bit", supports_voice_cloning=True),
    ModelSpec("pocket-tts-8bit", "MLX Pocket TTS 8-bit", "mlx", "mlx_pocket", ("MLX/pocket-tts-8bit", "MLX/mlx-community/pocket-tts-8bit"), "mlx-community/pocket-tts-8bit", supports_voice_cloning=True),
    ModelSpec("voxtral-tts-4b", "MLX Voxtral TTS 4B", "mlx", "mlx_voxtral", ("MLX/Voxtral-4B-TTS-2603-mlx-bf16", "MLX/Voxtral-TTS-4B-MLX-6bit", "Voxtral-TTS-4B-MLX-6bit"), "mlx-community/Voxtral-4B-TTS-2603-mlx-bf16"),
    ModelSpec("longcat-audiodit-1b-4bit", "MLX LongCat AudioDiT 1B 4-bit", "mlx", "mlx_longcat_audiodit", ("MLX/LongCat-AudioDiT-1B-4bit", "MLX/mlx-community/LongCat-AudioDiT-1B-4bit"), "mlx-community/LongCat-AudioDiT-1B-4bit", supports_voice_cloning=True),
    ModelSpec("longcat-audiodit-1b-bf16", "MLX LongCat AudioDiT 1B bf16", "mlx", "mlx_longcat_audiodit", ("MLX/LongCat-AudioDiT-1B-bf16", "MLX/mlx-community/LongCat-AudioDiT-1B-bf16"), "mlx-community/LongCat-AudioDiT-1B-bf16", supports_voice_cloning=True),
    ModelSpec("longcat-audiodit-3-5b-4bit", "MLX LongCat AudioDiT 3.5B 4-bit", "mlx", "mlx_longcat_audiodit", ("MLX/LongCat-AudioDiT-3.5B-4bit", "MLX/mlx-community/LongCat-AudioDiT-3.5B-4bit"), "mlx-community/LongCat-AudioDiT-3.5B-4bit", supports_voice_cloning=True),
    ModelSpec("soprano-80m-4bit", "MLX Soprano 80M 4-bit", "mlx", "mlx_soprano", ("MLX/Soprano-80M-4bit", "MLX/mlx-community/Soprano-80M-4bit"), "mlx-community/Soprano-80M-4bit"),
    ModelSpec("soprano-1-1-80m-bf16", "MLX Soprano 1.1 80M bf16", "mlx", "mlx_soprano", ("MLX/Soprano-1.1-80M-bf16", "MLX/mlx-community/Soprano-1.1-80M-bf16"), "mlx-community/Soprano-1.1-80M-bf16"),
    ModelSpec("melotts-english", "MLX MeloTTS English", "mlx", "mlx_melotts", ("MLX/MeloTTS-English-MLX", "MLX/mlx-community/MeloTTS-English-MLX"), "mlx-community/MeloTTS-English-MLX"),
    ModelSpec("higgs-audio-v2-3b-q6", "MLX Higgs Audio v2 3B q6", "mlx", "mlx_higgs_audio", ("MLX/higgs-audio-v2-3B-mlx-q6", "MLX/mlx-community/higgs-audio-v2-3B-mlx-q6"), "mlx-community/higgs-audio-v2-3B-mlx-q6", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("higgs-audio-v2-3b-q8", "MLX Higgs Audio v2 3B q8", "mlx", "mlx_higgs_audio", ("MLX/higgs-audio-v2-3B-mlx-q8", "MLX/mlx-community/higgs-audio-v2-3B-mlx-q8"), "mlx-community/higgs-audio-v2-3B-mlx-q8", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("moss-tts-nano-100m", "MLX MOSS-TTS Nano 100M", "mlx", "mlx_moss_tts", ("MLX/MOSS-TTS-Nano-100M", "MLX/mlx-community/MOSS-TTS-Nano-100M"), "mlx-community/MOSS-TTS-Nano-100M", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("irodori-tts-500m-v2-4bit", "MLX Irodori TTS 500M v2 4-bit", "mlx", "mlx_irodori_tts", ("MLX/Irodori-TTS-500M-v2-4bit", "MLX/mlx-community/Irodori-TTS-500M-v2-4bit"), "mlx-community/Irodori-TTS-500M-v2-4bit", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("indextts-1-5", "MLX IndexTTS 1.5", "mlx", "mlx_indextts", ("MLX/IndexTTS-1.5", "MLX/mlx-community/IndexTTS-1.5"), "mlx-community/IndexTTS-1.5", supports_voice_cloning=True),
    ModelSpec("omnivoice", "MLX OmniVoice", "mlx", "mlx_omnivoice", ("MLX/OmniVoice", "MLX/OmniVoice-bf16", "MLX/k2-fsa/OmniVoice", "MLX/mlx-community/OmniVoice-bf16"), "k2-fsa/OmniVoice", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("vibevoice-realtime-0-5b-4bit-mlx", "MLX VibeVoice Realtime 0.5B 4-bit", "mlx", "mlx_vibevoice", ("MLX/VibeVoice-Realtime-0.5B-4bit", "MLX/mlx-community/VibeVoice-Realtime-0.5B-4bit"), "mlx-community/VibeVoice-Realtime-0.5B-4bit", supports_instruction_prompt=True),
    ModelSpec("qwen3-tts-1.7b-base-8bit", "MLX Qwen3 TTS 1.7B Base 8-bit", "mlx", "mlx_qwen3tts", ("MLX/Qwen3-TTS-12Hz-1.7B-Base-8bit", "MLX/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"), "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("dia-1.6b-4bit", "MLX Dia 1.6B 4-bit", "mlx", "mlx_dia", ("MLX/Dia-1.6B-4bit", "MLX/mlx-community/Dia-1.6B-4bit"), "mlx-community/Dia-1.6B-4bit"),
    ModelSpec("csm-1b-8bit", "MLX CSM 1B 8-bit", "mlx", "mlx_csm", ("MLX/csm-1b-8bit", "MLX/mlx-community/csm-1b-8bit"), "mlx-community/csm-1b-8bit", supports_voice_cloning=True),
    ModelSpec("spark-tts-0.5b-4-6bit", "MLX Spark TTS 0.5B 4/6-bit", "mlx", "mlx_spark", ("MLX/Spark-TTS-0.5B-4-6bit", "MLX/mlx-community/Spark-TTS-0.5B-4-6bit"), "mlx-community/Spark-TTS-0.5B-4-6bit"),
    ModelSpec("voxcpm2-8bit", "MLX VoxCPM2 8-bit", "mlx", "mlx_voxcpm2", ("MLX/VoxCPM2-8bit", "MLX/mlx-community/VoxCPM2-8bit"), "mlx-community/VoxCPM2-8bit", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("voxcpm2-bf16", "MLX VoxCPM2 bf16", "mlx", "mlx_voxcpm2", ("MLX/VoxCPM2-bf16", "MLX/mlx-community/VoxCPM2-bf16"), "mlx-community/VoxCPM2-bf16", supports_instruction_prompt=True, supports_voice_cloning=True),
    ModelSpec("voxtral-tts-4b-4bit", "MLX Voxtral TTS 4B 4-bit", "mlx", "mlx_voxtral", ("MLX/Voxtral-4B-TTS-2603-mlx-4bit", "MLX/mlx-community/Voxtral-4B-TTS-2603-mlx-4bit"), "mlx-community/Voxtral-4B-TTS-2603-mlx-4bit"),
    ModelSpec("fish-audio-s2-pro-8bit", "MLX Fish Audio S2 Pro 8-bit", "mlx", "mlx_fish", ("MLX/fish-audio-s2-pro-8bit", "MLX/mlx-community/fish-audio-s2-pro-8bit"), "mlx-community/fish-audio-s2-pro-8bit", supports_voice_cloning=True),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--suite",
        choices=("hard", "style", "voice_clone"),
        default="hard",
        help="Run the baseline hard TTS benchmark, style/emotion benchmark, or voice-clone benchmark",
    )
    parser.add_argument("--models", default="", help="Comma-separated model ids to run")
    parser.add_argument("--case-limit", type=int, default=0, help="Limit cases per model; 0 runs all")
    parser.add_argument("--timeout", type=int, default=240, help="Per-case synthesis timeout in seconds")
    parser.add_argument("--output-dir", default="", help="Defaults to output/tts-model-eval or output/tts-style-eval by suite")
    parser.add_argument("--download-missing", action="store_true", help="Download missing Hugging Face snapshots where known")
    parser.add_argument("--include-disabled", action="store_true", help="Attempt catalog-disabled models")
    parser.add_argument("--no-asr-roundtrip", action="store_true", help="Skip ASR round-trip WER scoring")
    parser.add_argument(
        "--use-app-api",
        action="store_true",
        help="Synthesize through the running Vox Jot local API /v1/tts/synthesize endpoint",
    )
    parser.add_argument(
        "--app-api-url",
        default=os.environ.get("VOX_JOT_API_URL", "http://127.0.0.1:8978"),
        help="Base URL for the running Vox Jot local API",
    )
    parser.add_argument(
        "--app-api-token",
        default=os.environ.get("VOX_JOT_API_TOKEN", ""),
        help="Local API token, or set VOX_JOT_API_TOKEN",
    )
    parser.add_argument(
        "--asr-model",
        default=DEFAULT_ASR_JUDGE_MODEL,
        help="faster-whisper model path or id used as the ASR judge",
    )
    parser.add_argument(
        "--reuse-audio",
        action="store_true",
        help="Reuse existing WAVs in --output-dir/audio instead of synthesizing again and preserve prior synthesis metrics when available",
    )
    parser.add_argument("--list", action="store_true", help="Print model inventory and exit")
    return parser.parse_args()


def json_safe(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def selected_models(raw: str, include_disabled: bool, suite: str = "hard") -> list[ModelSpec]:
    requested = {item.strip() for item in raw.split(",") if item.strip()}
    models = [model for model in MODELS if not model.unavailable_reason or include_disabled]
    if suite == "voice_clone":
        models = [model for model in models if model.supports_voice_cloning]
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
        reference_audio = case.get("clone_reference_audio")
        if reference_audio:
            payload["reference_audio_path"] = reference_audio
        reference_text = case.get("clone_reference_text")
        if reference_text:
            payload["reference_text"] = reference_text
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
        str(case.get("controls", {}).get("temperature", 0.7)),
        "--repetition-penalty",
        str(case.get("controls", {}).get("repetition_penalty", 1.1)),
    ]
    if model.voice:
        command.extend(["--voice", model.voice])
    controls = case.get("controls", {})
    if "top_p" in controls:
        command.extend(["--top-p", str(controls["top_p"])])
    if "top_k" in controls:
        command.extend(["--top-k", str(int(controls["top_k"]))])
    if "min_p" in controls:
        command.extend(["--min-p", str(controls["min_p"])])
    if "cfg_weight" in controls:
        command.extend(["--cfg-weight", str(controls["cfg_weight"])])
    if "exaggeration" in controls:
        command.extend(["--exaggeration", str(controls["exaggeration"])])
    reference_audio = case.get("clone_reference_audio")
    instruction_prompt = case.get("instruction_prompt") if model.supports_instruction_prompt else None
    if model.supports_instruction_prompt and (instruction_prompt or not reference_audio):
        command.extend(["--instruct", instruction_prompt or "A clear natural voice with neutral pacing for practical app readback."])
    if reference_audio:
        command.extend(["--ref-audio", str(reference_audio)])
        reference_text = case.get("clone_reference_text")
        if reference_text:
            command.extend(["--ref-text", str(reference_text)])
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
    reference_audio = case.get("clone_reference_audio")
    binary = runtime_root / "voice_clone" if reference_audio else runtime_root / "tts"
    if not binary.exists():
        return None, "Qwen3 native voice-clone runtime binary is missing" if reference_audio else "Qwen3 native runtime binary is missing", 0.0
    temp_dir = output_path.parent / f"qwen-{output_path.stem}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    command = [str(binary), str(model_root)]
    if reference_audio:
        command.extend(
            [
                str(reference_audio),
                case["text"],
                locale_to_lang(case["locale"]),
            ]
        )
        reference_text = case.get("clone_reference_text")
        if reference_text:
            command.append(str(reference_text))
    else:
        command.append(case["text"])
    code, stdout, stderr, elapsed = run_command(
        command,
        timeout,
        cwd=temp_dir,
    )
    produced = temp_dir / ("output_voice_clone.wav" if reference_audio else "output.wav")
    if not produced.exists() and reference_audio:
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


def read_pcm16_mono(path: Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frames = wav.getnframes()
        raw = wav.readframes(frames)
    if sample_width != 2:
        raise ValueError(f"unsupported sample width {sample_width}")
    import array

    samples = array.array("h")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    if channels > 1:
        mono = []
        for index in range(0, len(samples), channels):
            mono.append(sum(samples[index : index + channels]) / channels / 32768.0)
        return mono, sample_rate
    return [sample / 32768.0 for sample in samples], sample_rate


def acoustic_fingerprint(path: Path) -> dict[str, Any]:
    samples, sample_rate = read_pcm16_mono(path)
    if not samples:
        return {"error": "empty audio"}
    frame_size = max(256, int(sample_rate * 0.04))
    hop = frame_size
    frames = [samples[index : index + frame_size] for index in range(0, len(samples) - frame_size + 1, hop)]
    if not frames:
        frames = [samples]
    rms_values = []
    zcr_values = []
    for frame in frames:
        if not frame:
            continue
        rms_values.append(math.sqrt(sum(value * value for value in frame) / len(frame)))
        crossings = sum(
            1
            for left, right in zip(frame, frame[1:])
            if (left < 0 <= right) or (right < 0 <= left)
        )
        zcr_values.append(crossings / max(1, len(frame) - 1))
    abs_values = [abs(value) for value in samples]
    duration = len(samples) / sample_rate if sample_rate else 0
    mean_abs = sum(abs_values) / len(abs_values)
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    silence_ratio = sum(1 for value in abs_values if value < 0.005) / len(abs_values)
    peak = max(abs_values)
    mean_zcr = sum(zcr_values) / len(zcr_values) if zcr_values else 0.0
    energy_variance = (
        sum((value - (sum(rms_values) / len(rms_values))) ** 2 for value in rms_values)
        / len(rms_values)
        if rms_values
        else 0.0
    )
    return {
        "duration_s": round(duration, 3),
        "rms": round(rms, 5),
        "mean_abs": round(mean_abs, 5),
        "peak": round(peak, 5),
        "silence_ratio": round(silence_ratio, 4),
        "zero_crossing_rate": round(mean_zcr, 5),
        "energy_variance": round(energy_variance, 7),
    }


def similarity_from_features(reference: dict[str, Any], candidate: dict[str, Any]) -> float:
    if reference.get("error") or candidate.get("error"):
        return 0.0
    feature_bounds = {
        "rms": 0.08,
        "mean_abs": 0.05,
        "peak": 0.4,
        "silence_ratio": 0.55,
        "zero_crossing_rate": 0.16,
        "energy_variance": 0.004,
    }
    weighted_scores = []
    for key, bound in feature_bounds.items():
        left = float(reference.get(key, 0.0) or 0.0)
        right = float(candidate.get(key, 0.0) or 0.0)
        weighted_scores.append(max(0.0, 1.0 - abs(left - right) / bound))
    return round(sum(weighted_scores) / len(weighted_scores), 4)


def evaluate_clone_similarity(case: dict[str, Any], output_path: Path) -> dict[str, Any] | None:
    raw_reference = case.get("clone_reference_audio")
    if not raw_reference:
        return None
    reference_path = Path(str(raw_reference))
    if not reference_path.is_absolute():
        reference_path = PROJECT_ROOT / reference_path
    if not reference_path.exists():
        return {"error": f"reference audio not found: {reference_path}"}
    try:
        reference = acoustic_fingerprint(reference_path)
        candidate = acoustic_fingerprint(output_path)
    except Exception as exc:
        return {"error": str(exc)}
    return {
        "score": similarity_from_features(reference, candidate),
        "method": "acoustic_fingerprint_proxy_v1",
        "reference_audio": str(reference_path.relative_to(PROJECT_ROOT))
        if reference_path.is_relative_to(PROJECT_ROOT)
        else str(reference_path),
        "reference_features": reference,
        "candidate_features": candidate,
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


def audio_failure_reason(metrics: dict[str, Any]) -> str | None:
    duration = metrics.get("duration_s") or 0
    rms = metrics.get("rms") or 0
    peak = metrics.get("peak") or 0
    silence_ratio = metrics.get("silence_ratio") or 1
    if duration < 0.4:
        return f"audio too short for benchmark scoring: duration_s={duration}"
    if peak < 0.005 and silence_ratio >= 0.98:
        return f"generated audio is silent: peak={peak}, rms={rms}, silence_ratio={silence_ratio}"
    if rms < 0.001 and silence_ratio >= 0.98:
        return f"generated audio is effectively silent: rms={rms}, silence_ratio={silence_ratio}"
    return None


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


def summarize_clone_similarity(cases: list[dict[str, Any]]) -> dict[str, Any] | None:
    values = [
        case["clone_similarity"]["score"]
        for case in cases
        if isinstance(case.get("clone_similarity"), dict)
        and isinstance(case["clone_similarity"].get("score"), (int, float))
    ]
    if not values:
        return None
    return {
        "average_proxy": round(sum(values) / len(values), 4),
        "case_count": len(values),
        "method": "acoustic_fingerprint_proxy_v1",
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


def clone_capability_weight(model: ModelSpec) -> float:
    if not model.supports_voice_cloning:
        return 0.0
    if model.provider in {"openvoice", "xtts", "chatterbox", "qwen3_native"}:
        return 1.0
    if model.family == "mlx":
        return 0.95
    return 0.9


def score_cases(
    cases: list[dict[str, Any]],
    suite: str = "hard",
    capability: str = "text_only",
    clone_weight: float = 1.0,
) -> float | None:
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
    elif suite == "voice_clone":
        clone_values = [
            case["clone_similarity"]["score"]
            for case in tested
            if isinstance(case.get("clone_similarity"), dict)
            and isinstance(case["clone_similarity"].get("score"), (int, float))
        ]
        clone_component = sum(clone_values) / len(clone_values) if clone_values else 0.0
        clone_component *= clone_weight
        score = 100.0 * (
            0.30 * clone_component
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


def app_provider_id(model: ModelSpec) -> str:
    return {
        "sherpa": "sherpa_pack",
        "mlx_fish": "mlx_fish_audio",
        "mlx_lfm": "mlx_lfm_audio",
        "mlx_ming": "mlx_ming_omni",
        "mlx_pocket": "mlx_pocket_tts",
        "mlx_voxcpm2": "mlx_voxcpm",
        "mlx_voxtral": "mlx_voxtral_tts",
        "lfm_gguf": "lfm_audio_gguf",
    }.get(model.provider, model.provider)


def app_model_id(model: ModelSpec) -> str:
    if model.id == "chatterbox-mlx":
        return "chatterbox"
    return model.id


def default_tuning(case: dict[str, Any], model: ModelSpec) -> dict[str, Any]:
    controls = case.get("controls", {})
    return {
        "tempo_rate": float(controls.get("speed", 1.0)),
        "expressiveness": 0.5,
        "exaggeration": float(controls.get("exaggeration", 0.5)),
        "randomness": float(controls.get("temperature", 0.7)),
        "guidance": float(controls.get("cfg_weight", 0.5)),
        "stability": 0.5,
        "repetition_penalty": float(controls.get("repetition_penalty", 1.2)),
        "style_instructions": case.get("instruction_prompt") if model.supports_instruction_prompt else None,
        "advanced_overrides": {
            key: {"kind": "number", "value": float(value)}
            for key, value in controls.items()
            if isinstance(value, (int, float))
            and key
            not in {
                "speed",
                "exaggeration",
                "temperature",
                "cfg_weight",
                "repetition_penalty",
            }
        },
    }


def synthesize_app_api(
    model: ModelSpec,
    case: dict[str, Any],
    app_api: AppApiConfig,
) -> tuple[Path | None, str | None, float]:
    payload = {
        "text": case["text"],
        "locale": case["locale"],
        "preferred_voice_id": model.voice,
        "inline_preset": {
            "label": model.label,
            "provider_id": app_provider_id(model),
            "model_id": app_model_id(model),
            "voice_id": model.voice,
            "voice_profile_id": None,
            "voice_label_snapshot": model.voice or model.label,
            "locale_snapshot": case["locale"],
            "tuning": default_tuning(case, model),
        },
    }
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        app_api.base_url.rstrip("/") + "/v1/tts/synthesize",
        data=data,
        headers={
            "content-type": "application/json",
            "x-vox-jot-api-token": app_api.token,
        },
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=app_api.timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        elapsed = time.perf_counter() - started
        detail = exc.read().decode("utf-8", errors="replace")
        return None, f"app API HTTP {exc.code}: {detail}", elapsed
    except Exception as exc:
        elapsed = time.perf_counter() - started
        return None, f"app API request failed: {exc}", elapsed
    elapsed = time.perf_counter() - started
    try:
        decoded = json.loads(body)
    except json.JSONDecodeError as exc:
        return None, f"app API returned invalid JSON: {exc}", elapsed
    paths = decoded.get("output_paths") or []
    if not paths:
        return None, "app API completed without output_paths", elapsed
    first = Path(paths[0])
    if not first.exists():
        return None, f"app API output does not exist: {first}", elapsed
    return first, None, elapsed


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
    app_api: AppApiConfig | None,
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

    model_root = None if model.family == "system" else resolve_model_root(model)
    download_error = None
    if not model_root and download_missing:
        download_error = maybe_download(model)
        model_root = resolve_model_root(model)
    if not model_root and not app_api:
        return {
            "model_id": model.id,
            "label": model.label,
            "family": model.family,
            "status": "download_required",
            "notes": download_error or "model assets are not installed in the app TTS store",
            "cases": [],
        }
    model_root_label = str(model_root) if model_root else f"app://{app_provider_id(model)}/{app_model_id(model)}"

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
        elif app_api:
            wav_path, error, elapsed = synthesize_app_api(model, case, app_api)
        else:
            assert model_root is not None
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
        audio_error = audio_failure_reason(metrics)
        duration = metrics.get("duration_s") or 0
        latency_ms = baseline_case.get("latency_ms") if reuse_audio and baseline_case else round(elapsed * 1000)
        real_time_factor = (
            baseline_case.get("real_time_factor") if reuse_audio and baseline_case else round(elapsed / duration, 3) if duration else None
        )
        if audio_error:
            case_results.append(
                {
                    "case_id": case["id"],
                    "label": case["label"],
                    "reference_text": case["text"],
                    "status": "failed",
                    "latency_ms": latency_ms,
                    "real_time_factor": real_time_factor,
                    "audio": metrics,
                    "error": audio_error,
                    "output_path": str(final_path.relative_to(PROJECT_ROOT)),
                }
            )
            continue
        style_alignment = evaluate_style_alignment(case, metrics) if suite == "style" else None
        clone_similarity = evaluate_clone_similarity(case, final_path) if suite == "voice_clone" else None
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
                "clone_similarity": clone_similarity,
                "target_style": case.get("target_style"),
                "instruction_prompt": case.get("instruction_prompt"),
                "clone_reference_audio": case.get("clone_reference_audio"),
                "asr_roundtrip": asr_roundtrip,
                "output_path": str(final_path.relative_to(PROJECT_ROOT)),
            }
        )
    capability = style_capability(model)
    clone_weight = clone_capability_weight(model)
    score = score_cases(
        case_results,
        suite=suite,
        capability=capability,
        clone_weight=clone_weight,
    )
    status = "tested" if any(case["status"] == "tested" for case in case_results) else "failed"
    return {
        "model_id": model.id,
        "label": model.label,
        "family": model.family,
        "provider": model.provider,
        "status": status,
        "score": score,
        "model_root": model_root_label,
        "app_provider_id": app_provider_id(model),
        "app_model_id": app_model_id(model),
        "synthesis_path": "app_local_api" if app_api else "runner_runtime",
        "style_capability": capability,
        "style_capability_weight": style_capability_weight(capability),
        "clone_capability_weight": clone_weight,
        "style_alignment": summarize_style_alignment(case_results),
        "clone_similarity": summarize_clone_similarity(case_results),
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
    if suite == "voice_clone":
        return (
            VOICE_CLONE_CASES,
            PROJECT_ROOT / "output/tts-voice-clone-eval",
            "tts-voice-clone-eval-summary.json",
            "tts_voice_clone_real_world_hard",
            "30% speaker similarity proxy, 25% ASR round-trip WER, 20% audio health, 15% synthesis success, 10% real-time factor.",
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


def write_voice_clone_rating_template(output_dir: Path, results: list[dict[str, Any]]) -> None:
    template_path = output_dir / "listener-rating-template.csv"
    with template_path.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "model_id",
                "case_id",
                "reference_audio_path",
                "audio_path",
                "speaker_match_1_to_5",
                "naturalness_1_to_5",
                "intelligibility_1_to_5",
                "reference_artifacts_1_to_5",
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
                        "reference_audio_path": case.get("clone_reference_audio"),
                        "audio_path": case.get("output_path"),
                        "speaker_match_1_to_5": "",
                        "naturalness_1_to_5": "",
                        "intelligibility_1_to_5": "",
                        "reference_artifacts_1_to_5": "",
                        "overall_preference_1_to_5": "",
                        "listener_notes": "",
                    }
                )


def print_inventory(models: list[ModelSpec]) -> None:
    for model in models:
        root = resolve_model_root(model)
        status = "disabled" if model.unavailable_reason else ("installed" if root else "missing")
        clone = "clone" if model.supports_voice_cloning else ""
        print(f"{model.id:32} {status:10} {model.family:10} {clone:6} {root or ''}")


def main() -> int:
    args = parse_args()
    models = selected_models(args.models, args.include_disabled, args.suite)
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
    app_api = None
    if args.use_app_api:
        if not args.app_api_token.strip():
            raise SystemExit("--use-app-api requires --app-api-token or VOX_JOT_API_TOKEN")
        app_api = AppApiConfig(
            base_url=args.app_api_url,
            token=args.app_api_token.strip(),
            timeout=max(args.timeout, 30),
        )

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
                app_api,
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
            "synthesis_path": "app_local_api" if app_api else "runner_runtime",
            "app_api_url": args.app_api_url if app_api else None,
            "style_rubric": STYLE_RUBRIC if args.suite == "style" else None,
            "voice_clone_rubric": VOICE_CLONE_RUBRIC if args.suite == "voice_clone" else None,
            "score_formula": score_formula,
            "notes": (
                "Generated audio is stored under output/tts-style-eval/audio. Scoring combines a heuristic style-alignment proxy, ASR round-trip WER, audio health, success, and real-time factor. Human listener preference ratings are not collected by this automatic runner."
                if args.suite == "style"
                else "Generated audio is stored under output/tts-voice-clone-eval/audio. Scoring combines a deterministic speaker-similarity proxy against the reference clip, ASR round-trip WER, audio health, success, and real-time factor. Human clone preference ratings are scaffolded but not collected by this automatic runner."
                if args.suite == "voice_clone"
                else "Generated audio is stored under output/tts-model-eval/audio. Scoring combines synthesis success, ASR round-trip WER, real-time factor, and WAV health checks. Reused-audio runs preserve prior synthesis latency when a baseline summary exists."
            ),
        },
        "results": results,
    }
    (output_dir / summary_name).write_text(
        json.dumps(json_safe(summary), indent=2) + "\n"
    )
    if args.suite == "style":
        write_listener_rating_template(output_dir, results)
    if args.suite == "voice_clone":
        write_voice_clone_rating_template(output_dir, results)
    print(f"Wrote {output_dir / summary_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
