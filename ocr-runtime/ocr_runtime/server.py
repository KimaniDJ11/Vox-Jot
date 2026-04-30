"""Line-delimited JSON request/response loop.

The Rust manager spawns ``python -m ocr_runtime`` with three env vars
set:

* ``OCR_RUNTIME_MODEL_ROOT`` — absolute path to the catalog row's install
  dir (``<app_data>/models/ocr/<catalog_id>/``).
* ``OCR_RUNTIME_BACKEND`` — the ``OcrBackendKind`` snake-cased
  (``transformers_vl`` etc.).
* ``OCR_RUNTIME_CATALOG_ID`` — stable id from ``ocr_models::CATALOG``.

Every line read from stdin is one JSON request; every line written to
stdout is one JSON response. ``stderr`` is reserved for log lines that
the Rust side tails into ``vox_jot.log``.

Supported ops:

* ``probe`` — confirm the loader initialised. Responds with ``ok=true``
  and the loader's ``info`` dict.
* ``ocr`` — run inference over a base64-encoded packed-BGRA frame.
* ``shutdown`` — drain in-flight requests and exit cleanly.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from typing import IO, Any, Optional

from . import loaders


def _log(stderr: IO[str], message: str) -> None:
    stderr.write(message + "\n")
    stderr.flush()


def _emit(stdout: IO[str], obj: dict) -> None:
    stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    stdout.flush()


def _decode_frame(req: dict) -> Optional[bytes]:
    raw = req.get("frame_b64")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return base64.b64decode(raw, validate=True)
    except Exception:
        return None


def run(
    *,
    model_root: str,
    backend: str,
    catalog_id: str,
    stdin: IO[str],
    stdout: IO[str],
    stderr: IO[str],
) -> int:
    if not model_root:
        _emit(
            stdout,
            {
                "request_id": 0,
                "ok": False,
                "error": "OCR_RUNTIME_MODEL_ROOT not set",
            },
        )
        return 2

    root = Path(model_root)
    if not root.is_dir():
        _emit(
            stdout,
            {
                "request_id": 0,
                "ok": False,
                "error": f"model_root '{model_root}' does not exist",
            },
        )
        return 2

    loader = loaders.resolve(root, backend, catalog_id)
    if loader is None:
        _emit(
            stdout,
            {
                "request_id": 0,
                "ok": False,
                "error": f"No loader for catalog_id={catalog_id} backend={backend}",
            },
        )
        return 2

    _log(
        stderr,
        f"ocr-runtime ready: catalog={catalog_id} backend={backend} root={root}",
    )

    while True:
        line = stdin.readline()
        if not line:
            return 0
        line = line.strip()
        if not line:
            continue

        try:
            req: dict[str, Any] = json.loads(line)
        except Exception as exc:  # noqa: BLE001
            _emit(
                stdout,
                {"request_id": 0, "error": f"malformed request JSON: {exc}"},
            )
            continue

        request_id = req.get("request_id", 0)
        op = req.get("op")

        try:
            if op == "probe":
                _emit(
                    stdout,
                    {
                        "request_id": request_id,
                        "ok": True,
                        "info": loader.info(),
                    },
                )
            elif op == "ocr":
                frame = _decode_frame(req)
                if frame is None:
                    _emit(
                        stdout,
                        {
                            "request_id": request_id,
                            "error": "missing or invalid frame_b64",
                        },
                    )
                    continue
                width = int(req.get("width", 0))
                height = int(req.get("height", 0))
                stride = int(req.get("stride", width * 4))
                max_words = int(req.get("max_words", 0))
                pixel_format = str(req.get("pixel_format", "bgra8"))
                if width <= 0 or height <= 0:
                    _emit(
                        stdout,
                        {
                            "request_id": request_id,
                            "error": "width and height must be positive",
                        },
                    )
                    continue
                snippets = list(
                    loader.run(
                        bgra=frame,
                        width=width,
                        height=height,
                        stride=stride,
                        max_words=max_words,
                        pixel_format=pixel_format,
                    )
                )
                _emit(
                    stdout,
                    {
                        "request_id": request_id,
                        "snippets": [s.to_json() for s in snippets],
                    },
                )
            elif op == "shutdown":
                _emit(stdout, {"request_id": request_id, "ok": True})
                return 0
            else:
                _emit(
                    stdout,
                    {
                        "request_id": request_id,
                        "error": f"unknown op: {op!r}",
                    },
                )
        except Exception as exc:  # noqa: BLE001
            _log(stderr, f"ocr-runtime exception: {exc!r}")
            _emit(
                stdout,
                {"request_id": request_id, "error": str(exc)},
            )
