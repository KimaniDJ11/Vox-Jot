"""Per-family OCR loaders."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from .base import OcrLoader
from .generic import PaddleOcrLoader, TransformersVlLoader
from .stub import StubLoader


def resolve(model_root: Path, backend: str, catalog_id: str) -> Optional[OcrLoader]:
    """Return a concrete loader for the given catalog row."""

    if backend == "transformers_vl":
        return TransformersVlLoader(
            model_root=model_root,
            catalog_id=catalog_id,
            backend=backend,
        )
    if backend in {"paddle_det_rec", "paddle_vl"}:
        return PaddleOcrLoader(
            model_root=model_root,
            catalog_id=catalog_id,
            backend=backend,
        )

    return StubLoader(model_root=model_root, catalog_id=catalog_id, backend=backend)
