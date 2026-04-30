"""Fallback loader used when no family loader can be constructed."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from .base import LoaderInfo, OcrLoader, Snippet


class StubLoader(OcrLoader):
    catalog_id: str

    def __init__(self, *, model_root: Path | str, catalog_id: str, backend: str) -> None:
        self.catalog_id = catalog_id
        self._backend = backend
        self._model_root = str(model_root)

    def run(
        self,
        bgra: bytes,
        width: int,
        height: int,
        stride: int,
        max_words: int,
        pixel_format: str = "bgra8",
    ) -> Iterable[Snippet]:
        del bgra, width, height, stride, max_words, pixel_format
        return ()

    def info(self) -> dict:
        return LoaderInfo(
            catalog_id=self.catalog_id,
            backend=self._backend,
            loaded=True,
            detail="fallback loader ready; platform OCR handles misses.",
            model_root=self._model_root,
        ).to_json()
