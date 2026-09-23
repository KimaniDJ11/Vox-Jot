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

    parent = model_root.resolve().parent
    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["HF_HOME"] == str(parent / ".hf_home")
    assert os.environ["HF_HUB_CACHE"] == str(parent / ".hf_cache")


def test_set_offline_hf_env_follows_symlink_to_external_parent(tmp_path: Path, monkeypatch):
    """Managed App Support symlink must not pin HF cache under the internal parent."""
    external_parent = tmp_path / "Volumes" / "AI Storage" / "AI Models"
    external_model = external_parent / "jina-ocr-v1"
    external_model.mkdir(parents=True)

    internal_parent = tmp_path / "Application Support" / "com.iriedinamik.voxjot" / "models" / "ocr"
    internal_parent.mkdir(parents=True)
    internal_link = internal_parent / "jina-ocr-v1"
    internal_link.symlink_to(external_model, target_is_directory=True)

    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "0")
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setenv("HF_HOME", "/tmp/hostile-hf-home")
    monkeypatch.setenv("HF_HUB_CACHE", "/tmp/hostile-hf-cache")

    _set_offline_hf_env(internal_link)

    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["HF_HOME"] == str(external_parent / ".hf_home")
    assert os.environ["HF_HUB_CACHE"] == str(external_parent / ".hf_cache")
    # Must NOT land beside the internal symlink parent.
    assert not os.environ["HF_HOME"].startswith(str(internal_parent))
    assert not os.environ["HF_HUB_CACHE"].startswith(str(internal_parent))
