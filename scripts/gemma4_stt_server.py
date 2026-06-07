#!/usr/bin/env python3
"""Cached Gemma 4 audio transcription server for Vox Jot live STT."""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any


ASR_PROMPT = (
    "Transcribe the following speech segment in its original language. "
    "Only output the transcription, with no newlines. "
    "When transcribing numbers, write digits where appropriate."
)


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


class TransformersGemma4Transcriber:
    def __init__(self, model_source: str):
        import torch
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(model_source)
        self.model = AutoModelForMultimodalLM.from_pretrained(
            model_source,
            dtype="auto",
            device_map="auto",
        )

    def transcribe(self, audio_path: str) -> str:
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": ASR_PROMPT},
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
            inputs = self.processor.apply_chat_template(
                messages,
                enable_thinking=False,
                **template_kwargs,
            )
        except TypeError:
            inputs = self.processor.apply_chat_template(messages, **template_kwargs)

        target_device = getattr(self.model, "device", None)
        if target_device is not None:
            inputs = inputs.to(target_device)
        input_len = inputs["input_ids"].shape[-1]
        with self.torch.inference_mode():
            outputs = self.model.generate(**inputs, max_new_tokens=512, do_sample=False)
        response = self.processor.decode(outputs[0][input_len:], skip_special_tokens=False)
        parsed = self.processor.parse_response(response)
        return normalize_text(parsed if parsed else response)


class MlxVlmGemma4Transcriber:
    def __init__(self, model_source: str):
        from mlx_vlm.generate import generate
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load

        self.apply_chat_template = apply_chat_template
        self.generate = generate
        self.model, self.processor = load(model_source)

    def transcribe(self, audio_path: str) -> str:
        prompt = self.apply_chat_template(
            self.processor,
            self.model.config,
            ASR_PROMPT,
            num_audios=1,
            enable_thinking=False,
        )
        result = self.generate(
            self.model,
            self.processor,
            prompt,
            audio=audio_path,
            max_tokens=512,
            temperature=0.0,
            enable_thinking=False,
            verbose=False,
        )
        return normalize_text(getattr(result, "text", result))


class Handler(BaseHTTPRequestHandler):
    transcriber: Any
    model_source: str
    backend: str

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
    parser.add_argument(
        "--backend",
        choices=("transformers", "mlx-vlm"),
        default="transformers",
    )
    parser.add_argument("--port", type=int, default=8028)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    Handler.model_source = args.model
    Handler.backend = args.backend
    with contextlib.redirect_stdout(sys.stderr):
        if args.backend == "mlx-vlm":
            Handler.transcriber = MlxVlmGemma4Transcriber(args.model)
        else:
            Handler.transcriber = TransformersGemma4Transcriber(args.model)
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"ok": True, "port": args.port}), flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
