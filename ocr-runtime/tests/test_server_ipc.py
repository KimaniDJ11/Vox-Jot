"""Production IPC distinguishes backend failures from valid empty OCR."""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from unittest.mock import patch

from ocr_runtime import server


class _FailingLoader:
    def info(self) -> dict:
        return {"loaded": True}

    def run(self, **_kwargs):
        raise RuntimeError("inference exploded")


class _EmptyLoader:
    def info(self) -> dict:
        return {"loaded": True}

    def run(self, **_kwargs):
        return ()


def _ocr_request() -> str:
    return json.dumps(
        {
            "request_id": 17,
            "op": "ocr",
            "frame_b64": base64.b64encode(b"\x00\x00\x00\xff").decode("ascii"),
            "width": 1,
            "height": 1,
            "stride": 4,
            "pixel_format": "bgra8",
            "max_words": 32,
        }
    )


def _run_server(tmp_path: Path, loader) -> tuple[int, dict, str]:
    stdin = io.StringIO(_ocr_request() + "\n")
    stdout = io.StringIO()
    stderr = io.StringIO()
    with patch("ocr_runtime.server.loaders.resolve", return_value=loader):
        exit_code = server.run(
            model_root=str(tmp_path),
            backend="transformers_vl",
            catalog_id="jina-ocr-v1",
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
        )
    response = json.loads(stdout.getvalue().strip())
    return exit_code, response, stderr.getvalue()


def test_inference_exception_is_an_ipc_error(tmp_path: Path):
    exit_code, response, stderr = _run_server(tmp_path, _FailingLoader())

    assert exit_code == 0
    assert response["request_id"] == 17
    assert "inference exploded" in response["error"]
    assert "snippets" not in response
    assert "ocr-runtime exception" in stderr


def test_legitimate_empty_recognition_is_successful_empty_snippets(tmp_path: Path):
    exit_code, response, stderr = _run_server(tmp_path, _EmptyLoader())

    assert exit_code == 0
    assert response == {"request_id": 17, "snippets": []}
    assert "ocr-runtime exception" not in stderr
