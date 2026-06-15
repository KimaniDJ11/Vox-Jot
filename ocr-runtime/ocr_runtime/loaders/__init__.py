"""Per-family OCR loaders."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from .base import OcrLoader
from .generic import MlxVlLoader, PaddleOcrLoader, TransformersVlLoader


def resolve(model_root: Path, backend: str, catalog_id: str) -> Optional[OcrLoader]:
    """Return a concrete loader for the given catalog row."""

    if backend == "transformers_vl":
        return TransformersVlLoader(
            model_root=model_root,
            catalog_id=catalog_id,
            backend=backend,
        )
    if backend == "mlx_vl":
        return MlxVlLoader(
            model_root=model_root,
            catalog_id=catalog_id,
            backend=backend,
        )
    if backend == "paddle_det_rec":
        return PaddleOcrLoader(
            model_root=model_root,
            catalog_id=catalog_id,
            backend=backend,
        )
    if backend == "paddle_vl":
        return TransformersVlLoader(
            model_root=model_root,
            catalog_id=catalog_id,
            backend=backend,
        )

    return None
