#!/usr/bin/env python3
"""Run Vox Jot file-transcription ASR and diarization adapters.

The Rust app invokes this as a one-shot process for file transcription only.
It is deliberately outside the live dictation path because these models can
load slowly and may need Hugging Face authentication.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import soundfile as sf

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


CURRENT_DICTATION_ASR_ID = "current_dictation_engine"
APP_SUPPORT_MODEL_ROOT = (
    Path.home() / "Library/Application Support/com.iriedinamik.voxjot/models"
)


ASR_REPOS = {
    "granite-speech-4-1-2b": "ibm-granite/granite-speech-4.1-2b",
    "cohere-transcribe-03-2026": "CohereLabs/cohere-transcribe-03-2026",
}

HIGGS_AUDIO_V3_STT_REPOS = {
    "higgs-audio-v3-stt": "bosonai/higgs-audio-v3-stt",
}

GEMMA4_AUDIO_REPOS = {
    "gemma4-e2b-audio": "google/gemma-4-E2B-it",
    "gemma4-e4b-audio": "google/gemma-4-E4B-it",
}

GEMMA4_MLX_AUDIO_REPOS = {
    "gemma4-e2b-audio-mlx": "mlx-community/gemma-4-e2b-it-4bit",
}

MLX_ASR_REPOS = {
    "mlx-qwen3-asr-0.6b": "mlx-community/Qwen3-ASR-0.6B-8bit",
    "mlx-qwen3-asr": "mlx-community/Qwen3-ASR-1.7B-8bit",
    "mlx-qwen3-asr-1.7b": "mlx-community/Qwen3-ASR-1.7B-8bit",
    "mlx-fireredasr2-aed": "mlx-community/FireRedASR2-AED-mlx",
    "mlx-vibevoice-asr-bf16": "mlx-community/VibeVoice-ASR-bf16",
    "mlx-nemotron-asr-streaming-0.6b": "mlx-community/nemotron-3.5-asr-streaming-0.6b",
    "mlx-mega-asr": "mlx-community/Mega-ASR-8bit",
}

MLX_DIARIZATION_REPOS = {
    "mlx-sortformer-4spk-v1": "mlx-community/diar_sortformer_4spk-v1-fp16",
    "mlx-sortformer-4spk-v2-1": "mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16",
}

PYANNOTE_REPOS = {
    "pyannote-community-1": "pyannote/speaker-diarization-community-1",
    "pyannote-3-1": "pyannote/speaker-diarization-3.1",
    "reverb-diarization-v2": "Revai/reverb-diarization-v2",
}

DIARIZEN_REPO = "BUT-FIT/diarizen-wavlm-large-s80-md-v2"

NO_EMOTION_ID = "no_emotion"

EMOTION_REPOS = {
    "emotion2vec-plus-large": "emotion2vec/emotion2vec_plus_large",
}


@dataclass
class Segment:
    start_ms: int
    end_ms: int
    text: str


@dataclass
class SpeakerTurn:
    speaker_id: str
    start_ms: int
    end_ms: int
    confidence: float | None
    source_model_id: str


def fail(message: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    raise SystemExit(code)


def disable_torch_jit_script(torch_module: Any) -> None:
    """Disable PyTorch's vulnerable JIT script entrypoint in this sidecar.

    GitHub advisory GHSA-rrmf-rvhw-rf47 / CVE-2025-3000 has no patched
    PyTorch release as of the runtime pin used here. Vox Jot does not use
    torch.jit.script, so fail closed if a dependency tries to enter that path.
    """

    jit_module = getattr(torch_module, "jit", None)
    if jit_module is None or getattr(jit_module, "_vox_jot_script_disabled", False):
        return

    def _blocked_torch_jit_script(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError(
            "torch.jit.script is disabled in Vox Jot's speech-analysis sidecar "
            "because PyTorch has no patched release for CVE-2025-3000."
        )

    setattr(jit_module, "script", _blocked_torch_jit_script)
    setattr(jit_module, "_vox_jot_script_disabled", True)


def import_guarded_torch() -> Any:
    import torch

    disable_torch_jit_script(torch)
    return torch


def device_name() -> str:
    torch = import_guarded_torch()

    if torch.cuda.is_available():
        return "cuda"
    if sys.platform == "darwin" and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def hf_token() -> str | None:
    try:
        from huggingface_hub import get_token

        token = get_token()
        if token:
            return token
    except Exception:
        pass

    env_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    if env_token:
        return env_token

    try:
        result = subprocess.run(
            ["hf", "auth", "token"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        token = result.stdout.strip()
        return token or None
    except Exception:
        return None


def local_model_path(model_id: str, required_files: tuple[str, ...] = ()) -> str | None:
    root = os.environ.get("VOX_JOT_SPEECH_ANALYSIS_MODEL_ROOT")
    if not root:
        return None
    candidate = Path(root) / model_id
    if candidate.exists() and candidate.is_dir():
        if required_files and not all((candidate / file).exists() for file in required_files):
            return None
        return str(candidate)
    return None


def required_mlx_snapshot_files(model_id: str) -> tuple[str, ...]:
    if model_id == "mlx-fireredasr2-aed":
        return (
            "cmvn.json",
            "config.json",
            "dict.txt",
            "model.safetensors",
            "train_bpe1000.model",
        )
    return ("config.json",)


def has_mlx_snapshot_weights(model_id: str, path: Path) -> bool:
    if not path.is_dir():
        return False
    if not all((path / file).exists() for file in required_mlx_snapshot_files(model_id)):
        return False
    if (path / "model.safetensors").exists():
        return True
    if not (path / "model.safetensors.index.json").exists():
        return False
    return any(path.glob("model-*.safetensors"))


def has_higgs_audio_v3_stt_snapshot(path: Path) -> bool:
    if not path.is_dir():
        return False
    required = (
        "config.json",
        "generation_config.json",
        "higgs_audio_collator.py",
        "model.safetensors.index.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "transcribe.py",
    )
    if not all((path / file).exists() for file in required):
        return False
    return (path / "model-00001-of-00002.safetensors").exists() and (
        path / "model-00002-of-00002.safetensors"
    ).exists()


def repo_or_local(model_id: str, repo_id: str) -> str:
    required = {
        "pyannote-community-1": ("config.yaml",),
        "pyannote-3-1": ("config.yaml",),
        "reverb-diarization-v2": ("config.yaml", "pytorch_model.bin"),
    }.get(model_id, ())
    local_path = local_model_path(model_id, required)
    if local_path:
        return local_path

    if model_id in MLX_ASR_REPOS:
        stt_root = Path(
            os.environ.get(
                "VOX_JOT_STT_MODEL_ROOT",
                str(APP_SUPPORT_MODEL_ROOT / "stt"),
            )
        )
        stt_path = stt_root / "MLX" / repo_id
        if has_mlx_snapshot_weights(model_id, stt_path):
            return str(stt_path)

    if model_id in GEMMA4_AUDIO_REPOS:
        stt_root = Path(
            os.environ.get(
                "VOX_JOT_STT_MODEL_ROOT",
                str(APP_SUPPORT_MODEL_ROOT / "stt"),
            )
        )
        stt_path = stt_root / "Gemma" / repo_id
        if (
            stt_path.is_dir()
            and (stt_path / "config.json").exists()
            and (stt_path / "model.safetensors").exists()
            and (stt_path / "processor_config.json").exists()
            and (stt_path / "tokenizer.json").exists()
        ):
            return str(stt_path)

    if model_id in HIGGS_AUDIO_V3_STT_REPOS:
        # Canonical (shared-asset) layout lives under the STT root so the live
        # dictation engine and File ASR reuse a single download.
        shared_path = Path(
            os.environ.get(
                "VOX_JOT_STT_MODEL_ROOT",
                str(APP_SUPPORT_MODEL_ROOT / "stt"),
            )
        ) / "Higgs" / repo_id
        if has_higgs_audio_v3_stt_snapshot(shared_path):
            return str(shared_path)
        # Legacy layout: speech-analysis root keyed by model id.
        legacy_path = Path(
            os.environ.get(
                "VOX_JOT_SPEECH_ANALYSIS_MODEL_ROOT",
                str(APP_SUPPORT_MODEL_ROOT / "speech-analysis"),
            )
        ) / model_id
        if has_higgs_audio_v3_stt_snapshot(legacy_path):
            return str(legacy_path)

    if model_id in GEMMA4_MLX_AUDIO_REPOS:
        stt_root = Path(
            os.environ.get(
                "VOX_JOT_STT_MODEL_ROOT",
                str(APP_SUPPORT_MODEL_ROOT / "stt"),
            )
        )
        stt_path = stt_root / "GemmaMLX" / repo_id
        if has_mlx_snapshot_weights(stt_path):
            return str(stt_path)

    return repo_id


def pyannote_repo_or_local(model_id: str, repo_id: str) -> str:
    local_path = repo_or_local(model_id, repo_id)
    if model_id != "pyannote-3-1" or local_path == repo_id:
        return local_path

    local_dir = Path(local_path)
    segmentation = local_dir / "segmentation"
    embedding = local_dir / "embedding"
    if not (
        (segmentation / "config.yaml").exists()
        and (segmentation / "pytorch_model.bin").exists()
        and (embedding / "config.yaml").exists()
        and (embedding / "pytorch_model.bin").exists()
    ):
        return local_path

    runtime_dir = local_dir / ".vox-jot-runtime"
    runtime_dir.mkdir(exist_ok=True)
    runtime_config = runtime_dir / "config.yaml"
    config = (local_dir / "config.yaml").read_text(encoding="utf-8")
    config = config.replace(
        "segmentation: pyannote/segmentation-3.0",
        f"segmentation: {json.dumps(str(segmentation))}",
    )
    config = config.replace(
        "embedding: pyannote/wespeaker-voxceleb-resnet34-LM",
        f"embedding: {json.dumps(str(embedding))}",
    )
    runtime_config.write_text(config, encoding="utf-8")
    return str(runtime_dir)


def read_audio_16k(audio_path: str) -> tuple[Any, int]:
    data, sample_rate = sf.read(audio_path, always_2d=False)
    if sample_rate != 16000:
        fail(f"Expected a 16 kHz WAV from Vox Jot, got {sample_rate} Hz")
    return data, sample_rate


def pyannote_waveform_input(audio_path: str) -> dict[str, Any]:
    torch = import_guarded_torch()

    data, sample_rate = read_audio_16k(audio_path)
    if getattr(data, "ndim", 1) > 1:
        data = data.mean(axis=1)
    waveform = torch.as_tensor(data, dtype=torch.float32).unsqueeze(0)
    return {
        "waveform": waveform,
        "sample_rate": sample_rate,
        "uri": Path(audio_path).stem,
    }


def diarization_tracks(diarization: Any) -> Any:
    if hasattr(diarization, "itertracks"):
        return diarization.itertracks(yield_label=True)
    speaker_diarization = getattr(diarization, "speaker_diarization", None)
    if speaker_diarization is not None and hasattr(speaker_diarization, "itertracks"):
        return speaker_diarization.itertracks(yield_label=True)
    fail(f"Unsupported diarization output type: {type(diarization).__name__}")


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        for key in ("text", "content", "answer", "response"):
            if key in value:
                return normalize_text(value[key])
        return " ".join(normalize_text(item) for item in value.values()).strip()
    if isinstance(value, list):
        return " ".join(normalize_text(item) for item in value).strip()
    text = str(value).strip()
    for marker in ("<|channel|>final", "<|channel|>analysis", "<|channel|>thought"):
        if marker in text:
            text = text.split(marker)[-1].strip()
    return text.replace("\n", " ").strip()


def coerce_timestamp_ms(timestamp: Any) -> tuple[int, int] | None:
    if not isinstance(timestamp, (list, tuple)) or len(timestamp) != 2:
        return None
    start, end = timestamp
    if start is None or end is None:
        return None
    return max(0, round(float(start) * 1000)), max(0, round(float(end) * 1000))


def transcribe_transformers(audio_path: str, model_id: str) -> tuple[str, list[Segment]]:
    torch = import_guarded_torch()
    import transformers.pipelines.automatic_speech_recognition as asr_pipeline
    from transformers import pipeline

    # The checked-in speech runtime can have torchcodec installed without
    # matching Homebrew FFmpeg dylibs. We pass decoded waveform arrays, so the
    # optional torchcodec decoder path should stay off for file ASR.
    asr_pipeline.is_torchcodec_available = lambda: False
    audio, sample_rate = read_audio_16k(audio_path)
    pipeline_input = {"array": audio, "sampling_rate": sample_rate}
    repo_id = repo_or_local(model_id, ASR_REPOS[model_id])
    device = device_name()
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = pipeline(
        "automatic-speech-recognition",
        model=repo_id,
        dtype=dtype,
        trust_remote_code=True,
        device=device,
    )
    try:
        result = pipe(pipeline_input, return_timestamps=True)
    except ValueError as exc:
        if "CTC" not in str(exc):
            raise
        result = pipe(pipeline_input, return_timestamps="word")
    text = normalize_text(result.get("text"))
    segments: list[Segment] = []
    for chunk in result.get("chunks") or []:
        bounds = coerce_timestamp_ms(chunk.get("timestamp"))
        chunk_text = normalize_text(chunk.get("text"))
        if bounds and chunk_text:
            start_ms, end_ms = bounds
            segments.append(Segment(start_ms=start_ms, end_ms=max(end_ms, start_ms), text=chunk_text))
    return text, segments


def transcribe_gemma4_audio(audio_path: str, model_id: str) -> tuple[str, list[Segment]]:
    torch = import_guarded_torch()
    from transformers import AutoModelForMultimodalLM, AutoProcessor

    model_name = repo_or_local(model_id, GEMMA4_AUDIO_REPOS[model_id])
    processor = AutoProcessor.from_pretrained(model_name)
    model = AutoModelForMultimodalLM.from_pretrained(
        model_name,
        dtype="auto",
        device_map="auto",
    )
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Transcribe the following speech segment in its original language. "
                        "Only output the transcription, with no newlines. "
                        "When transcribing numbers, write digits where appropriate."
                    ),
                },
                {"type": "audio", "audio": audio_path},
            ],
        }
    ]
    template_kwargs = {
        "tokenize": True,
        "return_dict": True,
        "return_tensors": "pt",
        "add_generation_prompt": True,
    }
    try:
        inputs = processor.apply_chat_template(
            messages,
            enable_thinking=False,
            **template_kwargs,
        )
    except TypeError:
        inputs = processor.apply_chat_template(messages, **template_kwargs)
    target_device = getattr(model, "device", None)
    if target_device is not None:
        inputs = inputs.to(target_device)
    input_len = inputs["input_ids"].shape[-1]
    with torch.inference_mode():
        outputs = model.generate(**inputs, max_new_tokens=512, do_sample=False)
    response = processor.decode(outputs[0][input_len:], skip_special_tokens=False)
    parsed = processor.parse_response(response)
    return normalize_text(parsed if parsed else response), []


def transcribe_gemma4_mlx_audio(audio_path: str, model_id: str) -> tuple[str, list[Segment]]:
    from mlx_vlm.generate import generate
    from mlx_vlm.prompt_utils import apply_chat_template
    from mlx_vlm.utils import load

    model, processor = load(repo_or_local(model_id, GEMMA4_MLX_AUDIO_REPOS[model_id]))
    prompt = apply_chat_template(
        processor,
        model.config,
        (
            "Transcribe the following speech segment in its original language. "
            "Only output the transcription, with no newlines. "
            "When transcribing numbers, write digits where appropriate."
        ),
        num_audios=1,
        enable_thinking=False,
    )
    result = generate(
        model,
        processor,
        prompt,
        audio=audio_path,
        max_tokens=512,
        temperature=0.0,
        enable_thinking=False,
        verbose=False,
    )
    return normalize_text(getattr(result, "text", result)), []


def transcribe_higgs_audio_v3_stt(audio_path: str, model_id: str) -> tuple[str, list[Segment]]:
    torch = import_guarded_torch()
    import numpy as np
    from transformers import AutoModel, AutoTokenizer
    from transformers.dynamic_module_utils import get_class_from_dynamic_module

    audio, sample_rate = read_audio_16k(audio_path)
    if getattr(audio, "ndim", 1) > 1:
        audio = np.mean(audio, axis=1)
    audio = np.asarray(audio, dtype=np.float32)

    model_name = repo_or_local(model_id, HIGGS_AUDIO_V3_STT_REPOS[model_id])
    device = device_name()
    dtype = torch.bfloat16 if device in {"cuda", "mps"} else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModel.from_pretrained(
        model_name,
        torch_dtype=dtype,
        trust_remote_code=True,
        attn_implementation="eager",
        low_cpu_mem_usage=True,
    )
    if not hasattr(model.generation_config, "generation_kwargs"):
        model.generation_config.generation_kwargs = {}
    if device in {"cuda", "mps"}:
        model = model.to(device)
    model.eval()

    transcribe_fn = get_class_from_dynamic_module("transcribe.transcribe", model_name)
    text = transcribe_fn(
        model,
        tokenizer,
        audio_np=audio,
        sample_rate=sample_rate,
        enable_thinking=True,
        max_new_tokens=512,
    )
    return normalize_text(text), []


def coerce_segment(segment: Any) -> Segment | None:
    if isinstance(segment, dict):
        start = segment.get("start", segment.get("start_time", 0))
        end = segment.get("end", segment.get("end_time", start))
        text = normalize_text(segment.get("text"))
    else:
        start = getattr(segment, "start", getattr(segment, "start_time", 0))
        end = getattr(segment, "end", getattr(segment, "end_time", start))
        text = normalize_text(getattr(segment, "text", ""))
    if not text:
        return None
    start_ms = max(0, round(float(start) * 1000))
    end_ms = max(start_ms, round(float(end) * 1000))
    return Segment(start_ms=start_ms, end_ms=end_ms, text=text)


def transcribe_mlx_audio(audio_path: str, model_id: str) -> tuple[str, list[Segment]]:
    from mlx_audio.stt import load

    model = load(repo_or_local(model_id, MLX_ASR_REPOS[model_id]))
    result = model.generate(audio_path)
    segments: list[Segment] = []
    for attr in ("segments", "sentences"):
        for segment in getattr(result, attr, []) or []:
            coerced = coerce_segment(segment)
            if coerced:
                segments.append(coerced)
        if segments:
            break

    raw_text = getattr(result, "text", "") or ""
    if segments and raw_text.lstrip().startswith(("[", "{")):
        # VibeVoice-style models return structured JSON in ``result.text``;
        # prefer the already-parsed segment texts so callers receive plain text.
        text = normalize_text(" ".join(segment.text for segment in segments))
    else:
        text = normalize_text(raw_text)
    return text, segments


def transcribe_cohere(audio_path: str) -> tuple[str, list[Segment]]:
    torch = import_guarded_torch()
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    audio, sample_rate = read_audio_16k(audio_path)
    model_name = repo_or_local("cohere-transcribe-03-2026", ASR_REPOS["cohere-transcribe-03-2026"])
    device = device_name()
    dtype = torch.float32
    processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_name,
        dtype=dtype,
        trust_remote_code=True,
    ).to(device)
    prompt = "<|en|><|pnc|><|noitn|><|notimestamp|><|nodiarize|>"
    inputs = processor(
        audio,
        text=prompt,
        sampling_rate=sample_rate,
        return_tensors="pt",
    )
    audio_chunk_index = inputs.get("audio_chunk_index")
    inputs.to(model.device, dtype=model.dtype)
    outputs = model.generate(**inputs, max_new_tokens=256)
    decoded = processor.batch_decode(
        outputs,
        skip_special_tokens=True,
        audio_chunk_index=audio_chunk_index,
    )
    if isinstance(decoded, list):
        text = normalize_text(decoded[0] if decoded else "")
    else:
        text = normalize_text(decoded)
    return text, []


def transcribe_granite(audio_path: str) -> tuple[str, list[Segment]]:
    torch = import_guarded_torch()
    import torchaudio
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    model_name = repo_or_local("granite-speech-4-1-2b", ASR_REPOS["granite-speech-4-1-2b"])
    device = device_name()
    processor = AutoProcessor.from_pretrained(model_name)
    tokenizer = processor.tokenizer
    model = AutoModelForSpeechSeq2Seq.from_pretrained(model_name, torch_dtype=torch.float32)
    model = model.to(device)
    wav, sample_rate = torchaudio.load(audio_path, normalize=True)
    if sample_rate != 16000:
        fail(f"Granite adapter expected 16 kHz audio, got {sample_rate} Hz")
    if wav.shape[0] != 1:
        wav = wav.mean(dim=0, keepdim=True)
    prompt = tokenizer.apply_chat_template(
        [
            {
                "role": "user",
                "content": (
                    "<|audio|>Transcribe the speech verbatim with proper punctuation and capitalization. "
                    "Preserve the product name Vox Jot exactly. If the speaker says one, two, three, four, "
                    "or five, write those words instead of digits."
                ),
            }
        ],
        tokenize=False,
        add_generation_prompt=True,
    )
    model_inputs = processor(prompt, wav, device=device, return_tensors="pt").to(device)
    outputs = model.generate(**model_inputs, max_new_tokens=512, do_sample=False, num_beams=1)
    offset = model_inputs["input_ids"].shape[-1]
    text = tokenizer.batch_decode(
        outputs[0, offset:].unsqueeze(0),
        add_special_tokens=False,
        skip_special_tokens=True,
    )[0]
    return normalize_text(text), []


def diarize_pyannote(audio_path: str, model_id: str) -> list[SpeakerTurn]:
    torch = import_guarded_torch()
    from pyannote.audio import Pipeline

    token = hf_token()
    if not token:
        fail(f"{model_id} requires Hugging Face authentication")

    repo_id = pyannote_repo_or_local(model_id, PYANNOTE_REPOS[model_id])
    try:
        pipeline = Pipeline.from_pretrained(repo_id, token=token)
    except TypeError:
        pipeline = Pipeline.from_pretrained(repo_id, use_auth_token=token)

    device = device_name()
    if device in {"cuda", "mps"}:
        pipeline.to(torch.device(device))

    diarization = pipeline(pyannote_waveform_input(audio_path))
    turns: list[SpeakerTurn] = []
    for turn, _, speaker in diarization_tracks(diarization):
        turns.append(
            SpeakerTurn(
                speaker_id=str(speaker),
                start_ms=max(0, round(float(turn.start) * 1000)),
                end_ms=max(0, round(float(turn.end) * 1000)),
                confidence=None,
                source_model_id=model_id,
            )
        )
    return turns


def coerce_speaker_turn(segment: Any, source_model_id: str) -> SpeakerTurn | None:
    if isinstance(segment, dict):
        speaker = segment.get("speaker", segment.get("speaker_id", "SPEAKER_00"))
        start = segment.get("start", segment.get("start_time", 0))
        end = segment.get("end", segment.get("end_time", start))
        confidence = segment.get("confidence")
    else:
        speaker = getattr(segment, "speaker", getattr(segment, "speaker_id", "SPEAKER_00"))
        start = getattr(segment, "start", getattr(segment, "start_time", 0))
        end = getattr(segment, "end", getattr(segment, "end_time", start))
        confidence = getattr(segment, "confidence", None)
    start_ms = max(0, round(float(start) * 1000))
    end_ms = max(0, round(float(end) * 1000))
    if end_ms <= start_ms:
        return None
    return SpeakerTurn(
        speaker_id=str(speaker),
        start_ms=start_ms,
        end_ms=end_ms,
        confidence=float(confidence) if confidence is not None else None,
        source_model_id=source_model_id,
    )


def diarize_mlx_sortformer(audio_path: str, model_id: str) -> list[SpeakerTurn]:
    from mlx_audio.vad import load

    model = load(repo_or_local(model_id, MLX_DIARIZATION_REPOS[model_id]))
    if hasattr(model, "generate_stream") and model_id.endswith("v2-1"):
        raw_segments: list[Any] = []
        for result in model.generate_stream(audio_path, chunk_duration=5.0, verbose=False):
            raw_segments.extend(getattr(result, "segments", []) or [])
    else:
        result = model.generate(audio_path, threshold=0.5, verbose=False)
        raw_segments = getattr(result, "segments", []) or []
    return [
        turn
        for segment in raw_segments
        if (turn := coerce_speaker_turn(segment, model_id)) is not None
    ]


def diarize_diarizen(audio_path: str) -> list[SpeakerTurn]:
    from diarizen.pipelines.inference import DiariZenPipeline
    from huggingface_hub import hf_hub_download

    model_path = local_model_path(
        "diarizen-wavlm-large-s80-md",
        (
            "config.toml",
            "pytorch_model.bin",
            "plda/plda.npz",
            "plda/xvec_transform.npz",
        ),
    )
    if model_path:
        model_dir = Path(model_path)
        embedding_path = (
            model_dir / "wespeaker-voxceleb-resnet34-LM" / "pytorch_model.bin"
        )
        if not embedding_path.exists():
            embedding_path = Path(
                hf_hub_download(
                    repo_id="pyannote/wespeaker-voxceleb-resnet34-LM",
                    filename="pytorch_model.bin",
                )
            )
        pipeline = DiariZenPipeline(
            diarizen_hub=model_dir,
            embedding_model=str(embedding_path),
        )
    else:
        pipeline = DiariZenPipeline.from_pretrained(DIARIZEN_REPO)
    diarization = pipeline(pyannote_waveform_input(audio_path))
    turns: list[SpeakerTurn] = []
    for turn, _, speaker in diarization_tracks(diarization):
        turns.append(
            SpeakerTurn(
                speaker_id=str(speaker),
                start_ms=max(0, round(float(turn.start) * 1000)),
                end_ms=max(0, round(float(turn.end) * 1000)),
                confidence=None,
                source_model_id="diarizen-wavlm-large-s80-md",
            )
        )
    return turns


def polyvoice_binary() -> str:
    configured = os.environ.get("VOX_JOT_POLYVOICE_BIN")
    if configured:
        return configured
    user_bin = Path.home() / ".cargo" / "bin" / "polyvoice"
    if user_bin.exists():
        return str(user_bin)
    return "polyvoice"


def polyvoice_model_dir() -> str:
    configured = os.environ.get("VOX_JOT_POLYVOICE_MODEL_DIR")
    if configured:
        return configured
    repo_models = Path.cwd() / "src-tauri" / "resources" / "models" / "polyvoice"
    if repo_models.exists():
        return str(repo_models)
    return str(Path.home() / ".cache" / "polyvoice" / "models")


def diarize_polyvoice_onnx(audio_path: str) -> list[SpeakerTurn]:
    command = [
        polyvoice_binary(),
        "diarize",
        audio_path,
        "--model-dir",
        polyvoice_model_dir(),
        "--format",
        "json",
        "--max-speakers",
        "20",
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        fail(f"polyvoice ONNX diarization failed: {detail}")
    try:
        rows = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        fail(f"polyvoice ONNX diarization returned invalid JSON: {exc}")

    turns: list[SpeakerTurn] = []
    for row in rows:
        turns.append(
            SpeakerTurn(
                speaker_id=str(row["speaker"]),
                start_ms=max(0, round(float(row["start"]) * 1000)),
                end_ms=max(0, round(float(row["end"]) * 1000)),
                confidence=None,
                source_model_id="onnx-polyvoice-diarization",
            )
        )
    return turns


def transcribe_whisperx(
    audio_path: str,
    run_diarization: bool,
) -> tuple[str, list[Segment], list[SpeakerTurn]]:
    import whisperx
    from whisperx.diarize import DiarizationPipeline

    runtime_device = device_name()
    device = "cuda" if runtime_device == "cuda" else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    model_name = local_model_path("whisper-diarization", ("model.bin", "config.json")) or "large-v3"
    model = whisperx.load_model(model_name, device, compute_type=compute_type)
    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, batch_size=8)
    text = normalize_text(" ".join(segment.get("text", "") for segment in result.get("segments", [])))
    segments = [
        Segment(
            start_ms=max(0, round(float(segment.get("start", 0)) * 1000)),
            end_ms=max(0, round(float(segment.get("end", 0)) * 1000)),
            text=normalize_text(segment.get("text")),
        )
        for segment in result.get("segments", [])
    ]

    token = hf_token() if run_diarization else None
    if not token:
        return text, segments, []
    diarize_model = DiarizationPipeline(token=token, device=device)
    diarization = diarize_model(audio)
    result = whisperx.assign_word_speakers(diarization, result)
    turns = [
        SpeakerTurn(
            speaker_id=str(row.get("speaker", "SPEAKER_00")),
            start_ms=max(0, round(float(row.get("start", 0)) * 1000)),
            end_ms=max(0, round(float(row.get("end", 0)) * 1000)),
            confidence=None,
            source_model_id="whisper-diarization",
        )
        for _, row in diarization.iterrows()
    ]
    return text, segments, turns


def clean_emotion_label(raw: Any) -> str:
    """emotion2vec labels are ``"中文/english"`` pairs; keep the English side.

    The model also emits a catch-all ``<unk>`` class, which we normalise to
    ``"unknown"`` so the Rust/UI side can drop it from the displayed scores.
    """
    text = str(raw).strip()
    if not text or text == "<unk>":
        return "unknown"
    if "/" in text:
        text = text.split("/")[-1].strip()
    return text or "unknown"


def classify_emotion(audio_path: str, model_id: str) -> dict[str, Any]:
    # emotion2vec runs through FunASR's AutoModel. The plus models output nine
    # softmaxed scores over eight emotions plus a discarded ``<unk>`` slot. We
    # pin CPU because the fairseq-style ops are not all MPS-safe and the model is
    # tiny (RTF ~0.03), so the device choice is not a latency concern.
    from funasr import AutoModel

    model_source = local_model_path(
        model_id, ("model.pt", "config.yaml", "configuration.json")
    )
    auto_kwargs: dict[str, Any] = {"disable_update": True, "device": "cpu"}
    if model_source:
        model = AutoModel(model=model_source, **auto_kwargs)
    else:
        model = AutoModel(model=EMOTION_REPOS[model_id], hub="hf", **auto_kwargs)

    results = model.generate(audio_path, granularity="utterance", extract_embedding=False)
    if not results:
        fail(f"Emotion model '{model_id}' returned no result")

    record = results[0]
    labels = [clean_emotion_label(label) for label in record.get("labels", [])]
    raw_scores = record.get("scores", []) or []
    scores = [
        {"label": label, "score": float(score)}
        for label, score in zip(labels, raw_scores)
        if label != "unknown"
    ]
    if not scores:
        fail(f"Emotion model '{model_id}' produced no usable scores")

    top = max(scores, key=lambda item: item["score"])
    return {
        "source_model_id": model_id,
        "top_label": top["label"],
        "top_score": top["score"],
        "scores": scores,
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    read_audio_16k(args.audio)
    text = ""
    segments: list[Segment] = []
    speaker_turns: list[SpeakerTurn] = []
    emotion: dict[str, Any] | None = None

    if args.asr_model == "whisper-diarization":
        text, segments, speaker_turns = transcribe_whisperx(
            args.audio,
            args.diarization_model != "no_speaker_labels",
        )
    elif args.asr_model == "granite-speech-4-1-2b":
        text, segments = transcribe_granite(args.audio)
    elif args.asr_model == "cohere-transcribe-03-2026":
        text, segments = transcribe_cohere(args.audio)
    elif args.asr_model in GEMMA4_AUDIO_REPOS:
        text, segments = transcribe_gemma4_audio(args.audio, args.asr_model)
    elif args.asr_model in GEMMA4_MLX_AUDIO_REPOS:
        text, segments = transcribe_gemma4_mlx_audio(args.audio, args.asr_model)
    elif args.asr_model in HIGGS_AUDIO_V3_STT_REPOS:
        text, segments = transcribe_higgs_audio_v3_stt(args.audio, args.asr_model)
    elif args.asr_model in MLX_ASR_REPOS:
        text, segments = transcribe_mlx_audio(args.audio, args.asr_model)
    elif args.asr_model in ASR_REPOS:
        text, segments = transcribe_transformers(args.audio, args.asr_model)

    if args.diarization_model in PYANNOTE_REPOS:
        speaker_turns = diarize_pyannote(args.audio, args.diarization_model)
    elif args.diarization_model == "diarizen-wavlm-large-s80-md":
        speaker_turns = diarize_diarizen(args.audio)
    elif args.diarization_model in MLX_DIARIZATION_REPOS:
        speaker_turns = diarize_mlx_sortformer(args.audio, args.diarization_model)
    elif args.diarization_model == "onnx-polyvoice-diarization":
        speaker_turns = diarize_polyvoice_onnx(args.audio)

    emotion_model = getattr(args, "emotion_model", NO_EMOTION_ID)
    if emotion_model and emotion_model != NO_EMOTION_ID:
        if emotion_model in EMOTION_REPOS:
            emotion = classify_emotion(args.audio, emotion_model)
        else:
            fail(f"Unknown emotion model '{emotion_model}'")

    reported_device = (
        "cpu"
        if args.asr_model == "whisper-diarization" and device_name() != "cuda"
        else device_name()
    )
    return {
        "ok": True,
        "text": text,
        "segments": [segment.__dict__ for segment in segments],
        "speaker_turns": [turn.__dict__ for turn in speaker_turns],
        "emotion": emotion,
        "device": reported_device,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, help="16 kHz mono WAV path")
    parser.add_argument("--asr-model", required=True)
    parser.add_argument("--diarization-model", required=True)
    parser.add_argument("--emotion-model", default=NO_EMOTION_ID)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with contextlib.redirect_stdout(sys.stderr):
        payload = run(args)
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
