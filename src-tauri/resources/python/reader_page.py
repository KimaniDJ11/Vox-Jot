#!/usr/bin/env python3
"""Vox Jot Reader page renderer.

Renders one PDF page to a PNG and returns per-word bounding boxes (in PDF
points) so the reader's page view can highlight the spoken word/block on the
rendered page (geometry-based highlighting).

Input:  --path /abs/doc.pdf --page 0 [--scale 2.0]
Output: JSON on stdout:
  {
    "index": 0,
    "width": 612.0,
    "height": 792.0,
    "scale": 2.0,
    "image": {"mime_type": "image/png", "base64": "..."},
    "words": [{"text": "Hello", "x0": 72.0, "y0": 96.0, "x1": 110.0, "y1": 112.0}]
  }
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any

# Cap rendered pixel area so an enormous page (or scale) can't allocate a huge
# pixmap or emit a massive base64 PNG. ~30 MP keeps any page comfortably bounded.
MAX_RENDER_PIXELS = 30_000_000
MAX_RENDER_WORDS = 100_000


def render_page(path: Path, page_index: int, scale: float) -> dict[str, Any]:
    try:
        import fitz  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on packaged runtime
        raise RuntimeError("PyMuPDF is required to render pages.") from exc

    document = fitz.open(path)
    if page_index < 0 or page_index >= len(document):
        raise RuntimeError(f"Page {page_index} is out of range.")
    page = document[page_index]
    rect = page.rect
    scale = max(0.5, min(4.0, scale))
    # Clamp scale down (below 0.5 if necessary) so the rendered pixel area stays
    # within MAX_RENDER_PIXELS for oversized pages.
    if rect.width > 0 and rect.height > 0:
        area = (rect.width * scale) * (rect.height * scale)
        if area > MAX_RENDER_PIXELS:
            scale = min(scale, (MAX_RENDER_PIXELS / (rect.width * rect.height)) ** 0.5)
    matrix = fitz.Matrix(scale, scale)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    image_b64 = base64.b64encode(pixmap.tobytes("png")).decode("ascii")

    words: list[dict[str, Any]] = []
    for raw in page.get_text("words"):
        if len(words) >= MAX_RENDER_WORDS:
            break
        if len(raw) < 5:
            continue
        x0, y0, x1, y1, text = raw[:5]
        text = str(text).strip()
        if not text:
            continue
        words.append(
            {
                "text": text,
                "x0": round(float(x0), 2),
                "y0": round(float(y0), 2),
                "x1": round(float(x1), 2),
                "y1": round(float(y1), 2),
            }
        )

    return {
        "index": page_index,
        "width": round(float(rect.width), 2),
        "height": round(float(rect.height), 2),
        "scale": scale,
        "image": {"mime_type": "image/png", "base64": image_b64},
        "words": words,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a Reader PDF page.")
    parser.add_argument("--path", required=True, help="PDF path")
    parser.add_argument("--page", required=True, type=int, help="0-based page index")
    parser.add_argument("--scale", type=float, default=2.0, help="Render scale")
    args = parser.parse_args()

    try:
        result = render_page(Path(args.path).expanduser().resolve(), args.page, args.scale)
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:
        print(f"Reader page render failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
