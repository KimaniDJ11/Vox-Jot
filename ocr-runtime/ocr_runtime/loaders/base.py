"""Loader protocol shared by every OCR family."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Protocol, runtime_checkable


@dataclass(frozen=True)
class Snippet:
    """One recognised text region.

    Coordinates are normalised to 0..1 with **top-left** origin. The Rust
    router flips y to bottom-left to match Vision's existing payload
    contract — loaders shouldn't try to do that themselves.
    """

    text: str
    confidence: float
    x: float
    y: float
    width: float
    height: float

    def to_json(self) -> dict:
        return {
            "text": self.text,
            "confidence": float(self.confidence),
            "x": float(self.x),
            "y": float(self.y),
            "width": float(self.width),
            "height": float(self.height),
        }


@runtime_checkable
class OcrLoader(Protocol):
    """Every neural OCR loader follows this shape.

    Implementations load the underlying model in ``__init__`` so the cost
    is paid once per process. ``run`` is hot-path code: keep it
    allocation-light and respect the timeout the manager hands you via
    process-wide thread interrupt or model-specific cancellation hooks.
    """

    catalog_id: str

    def run(
        self,
        bgra: bytes,
        width: int,
        height: int,
        stride: int,
        max_words: int,
        pixel_format: str = "bgra8",
    ) -> Iterable[Snippet]:
        ...

    def info(self) -> dict:
        """Human-readable status surfaced via ``op=probe`` responses."""

        ...


@dataclass(frozen=True)
class LoaderInfo:
    """Returned by ``probe`` so the Rust manager can mark the model
    `runnable` only when the loader actually succeeded in loading.
    """

    catalog_id: str
    backend: str
    loaded: bool
    detail: str = ""
    model_root: str = ""

    def to_json(self) -> dict:
        return {
            "catalog_id": self.catalog_id,
            "backend": self.backend,
            "loaded": self.loaded,
            "detail": self.detail,
            "model_root": self.model_root,
        }


def has_required_files(model_root: Path, names: Iterable[str]) -> bool:
    """Cheap helper for loaders that need a config + weights present."""

    return all((model_root / name).is_file() for name in names)
