#!/usr/bin/env python3
"""Cached Higgs Audio v3 STT server for Vox Jot live dictation.

Unlike the one-shot file-transcription adapter in ``speech_analysis_sidecar.py``,
this loads the Higgs model once and serves repeated low-latency transcription
requests over HTTP so it can back the live dictation path the same way the
Gemma/MLX audio servers do.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Live dictation favours latency over the model's chain-of-thought pass, so
# thinking is off by default. Override with VOX_JOT_HIGGS_ENABLE_THINKING=1.
ENABLE_THINKING = _env_flag("VOX_JOT_HIGGS_ENABLE_THINKING", False)
MAX_NEW_TOKENS = int(os.environ.get("VOX_JOT_HIGGS_MAX_NEW_TOKENS", "512"))


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        for key in ("text", "content", "answer", "response"):
            if key in value:
                return normalize_text(value[key])
        return " ".join(normalize_text(v) for v in value.values()).strip()
    if isinstance(value, list):
        return " ".join(normalize_text(item) for item in value).strip()
    text = str(value).strip()
    for marker in ("<|channel|>final", "<|channel|>analysis", "<|channel|>thought"):
        if marker in text:
            text = text.split(marker)[-1].strip()
    return text.replace("\n", " ").strip()


def _device_name(torch: Any) -> str:
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def _read_audio(audio_path: str):
    import numpy as np
    import soundfile as sf

    audio, sample_rate = sf.read(audio_path, dtype="float32", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = np.mean(audio, axis=1)
    return np.asarray(audio, dtype=np.float32), int(sample_rate)


class HiggsAudioTranscriber:
    def __init__(self, model_source: str):
        import torch
        from transformers import AutoModel, AutoTokenizer
        from transformers.dynamic_module_utils import get_class_from_dynamic_module

        self.torch = torch
        device = _device_name(torch)
        self.device = device
        dtype = torch.bfloat16 if device in {"cuda", "mps"} else torch.float32

        self.tokenizer = AutoTokenizer.from_pretrained(
            model_source, trust_remote_code=True
        )
        self.model = AutoModel.from_pretrained(
            model_source,
            torch_dtype=dtype,
            trust_remote_code=True,
            attn_implementation="eager",
            low_cpu_mem_usage=True,
        )
        if not hasattr(self.model.generation_config, "generation_kwargs"):
            self.model.generation_config.generation_kwargs = {}
        if device in {"cuda", "mps"}:
            self.model = self.model.to(device)
        self.model.eval()

        # The model ships its own ``transcribe.transcribe`` entry point via
        # trust_remote_code; reuse it instead of reimplementing the pipeline.
        self.transcribe_fn = get_class_from_dynamic_module(
            "transcribe.transcribe", model_source
        )

    def transcribe(self, audio_path: str) -> str:
        audio, sample_rate = _read_audio(audio_path)
        with self.torch.inference_mode():
            text = self.transcribe_fn(
                self.model,
                self.tokenizer,
                audio_np=audio,
                sample_rate=sample_rate,
                enable_thinking=ENABLE_THINKING,
                max_new_tokens=MAX_NEW_TOKENS,
            )
        return normalize_text(text)


class Handler(BaseHTTPRequestHandler):
    transcriber: Any
    model_source: str
    backend: str = "transformers"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._write_json(
                200,
                {"ok": True, "model": self.model_source, "backend": self.backend},
            )
        else:
            self._write_json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/v1/audio/transcriptions":
            self._write_json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            audio = base64.b64decode(payload["audio_base64"])
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio)
                audio_path = tmp.name
            try:
                text = self.transcriber.transcribe(audio_path)
            finally:
                with contextlib.suppress(FileNotFoundError):
                    os.remove(audio_path)
            self._write_json(200, {"text": text})
        except Exception as exc:
            self._write_json(500, {"ok": False, "error": str(exc)})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--port", type=int, default=8038)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    Handler.model_source = args.model
    # transformers/torch chatter must not corrupt the readiness JSON on stdout.
    with contextlib.redirect_stdout(sys.stderr):
        Handler.transcriber = HiggsAudioTranscriber(args.model)
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"ok": True, "port": args.port}), flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
