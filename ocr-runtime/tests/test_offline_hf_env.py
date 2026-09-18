"""Managed OCR runtime must own Hugging Face offline/cache env vars."""

from __future__ import annotations

import os
from pathlib import Path

from ocr_runtime.loaders.generic import _set_offline_hf_env


def test_set_offline_hf_env_overrides_preexisting_host_values(tmp_path: Path, monkeypatch):
    model_root = tmp_path / "models" / "jina-ocr-v1"
    model_root.mkdir(parents=True)

    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "0")
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setenv("HF_HOME", "/tmp/host-hf-home")
    monkeypatch.setenv("HF_HUB_CACHE", "/tmp/host-hf-cache")

    _set_offline_hf_env(model_root)

    parent = model_root.parent
    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["HF_HOME"] == str(parent / ".hf_home")
    assert os.environ["HF_HUB_CACHE"] == str(parent / ".hf_cache")
