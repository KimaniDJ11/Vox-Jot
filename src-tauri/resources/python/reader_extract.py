#!/usr/bin/env python3
"""One-shot Vox Jot Reader document extractor.

Input:  --path /absolute/document.pdf
Output: JSON on stdout:
  {
    "title": "...",
    "kind": "pdf",
    "meta": {"engine": "pymupdf"},
    "text": "...",
    "pages": [
      {
        "index": 0,
        "width": 612.0,
        "height": 792.0,
        "blocks": [
          {
            "index": 0,
            "text": "...",
            "kind": "content",
            "bbox": {"x0": 72.0, "y0": 96.0, "x1": 540.0, "y1": 128.0}
          }
        ]
      }
    ]
  }
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import shutil
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


SUPPORTED_EXTENSIONS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".epub": "epub",
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "text",
    ".text": "text",
}


class ExtractionError(Exception):
    pass


# OCR fallback for scanned / image-only PDF pages (no text layer). PyMuPDF
# shells out to the Tesseract binary and needs TESSDATA_PREFIX pointing at the
# traineddata directory.
OCR_DPI = 200
# Bound worst-case OCR time on very large scans; pages beyond this keep whatever
# native text they have (usually none) so a huge document still imports.
READER_OCR_MAX_PAGES = 200
_TESSERACT_DIRS = ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin")
_TESSDATA_DIRS = (
    "/opt/homebrew/share/tessdata",
    "/usr/local/share/tessdata",
    "/usr/share/tessdata",
    "/opt/local/share/tessdata",
    "/opt/homebrew/share/tesseract-ocr/tessdata",
)


def ensure_reader_ocr() -> bool:
    """Make Tesseract usable for PyMuPDF OCR. Returns True if OCR can run."""
    if shutil.which("tesseract") is None:
        for directory in _TESSERACT_DIRS:
            if os.path.isfile(os.path.join(directory, "tesseract")):
                os.environ["PATH"] = directory + os.pathsep + os.environ.get("PATH", "")
                break
    if shutil.which("tesseract") is None:
        return False
    if not os.environ.get("TESSDATA_PREFIX"):
        for directory in _TESSDATA_DIRS:
            if os.path.isfile(os.path.join(directory, "eng.traineddata")):
                os.environ["TESSDATA_PREFIX"] = directory
                break
    return True


def raw_blocks_have_text(raw_blocks: Any) -> bool:
    for raw in raw_blocks:
        if len(raw) >= 5 and normalize_document_text(str(raw[4])).strip():
            return True
    return False


class HtmlTextCollector(HTMLParser):
    block_tags = {
        "article",
        "blockquote",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "p",
        "section",
        "tr",
    }
    skip_tags = {"head", "metadata", "script", "style", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        tag = tag.lower()
        if tag in self.skip_tags:
            self.skip_depth += 1
        elif self.skip_depth == 0 and tag in self.block_tags:
            self._break()

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.skip_tags and self.skip_depth > 0:
            self.skip_depth -= 1
        elif self.skip_depth == 0 and tag in self.block_tags:
            self._break()

    def handle_data(self, data: str) -> None:
        if self.skip_depth > 0:
            return
        text = normalize_inline(data)
        if not text:
            return
        if self.parts and not self.parts[-1].endswith(("\n", " ")):
            self.parts.append(" ")
        self.parts.append(text)

    def _break(self) -> None:
        while self.parts and self.parts[-1] == " ":
            self.parts.pop()
        if self.parts and self.parts[-1] != "\n\n":
            self.parts.append("\n\n")

    def text(self) -> str:
        return normalize_document_text("".join(self.parts))


def normalize_inline(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def normalize_document_text(value: str) -> str:
    lines: list[str] = []
    blank_pending = False
    for raw_line in value.splitlines():
        line = normalize_inline(raw_line)
        if not line:
            blank_pending = True
            continue
        if blank_pending and lines:
            lines.append("")
        lines.append(line)
        blank_pending = False
    return "\n".join(lines).strip()


def make_block(index: int, text: str, kind: str = "content", bbox: dict[str, float] | None = None) -> dict[str, Any]:
    block: dict[str, Any] = {
        "index": index,
        "text": text,
        "kind": kind,
    }
    if bbox is not None:
        block["bbox"] = bbox
    return block


def text_page(index: int, text: str) -> dict[str, Any]:
    blocks = [
        make_block(block_index, paragraph)
        for block_index, paragraph in enumerate(split_paragraphs(text))
    ]
    return {"index": index, "width": None, "height": None, "blocks": blocks}


def split_paragraphs(text: str) -> list[str]:
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", text) if item.strip()]
    return paragraphs or ([text.strip()] if text.strip() else [])


def extract_pdf(path: Path) -> dict[str, Any]:
    # Enable Tesseract OCR for scanned pages BEFORE importing PyMuPDF — it reads
    # TESSDATA_PREFIX at import time, so setting it afterwards has no effect.
    ocr_available = ensure_reader_ocr()
    try:
        import fitz  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on packaged runtime
        raise ExtractionError("PyMuPDF is required for structured PDF extraction.") from exc

    document = fitz.open(path)
    page_blocks: list[dict[str, Any]] = []
    repeated_candidates: dict[tuple[str, str, int], int] = {}
    ocr_pages_used = 0
    used_ocr = False
    try:
        thumbnail = make_pdf_thumbnail(document, fitz)
    except Exception:
        thumbnail = None

    for page_index, page in enumerate(document):
        rect = page.rect
        width = float(rect.width)
        height = float(rect.height)
        blocks: list[dict[str, Any]] = []
        raw_blocks = page.get_text("blocks", sort=True)
        # Scanned / image-only page (no text layer): OCR the rendered page so it
        # can still be read aloud. OCR'd blocks carry bboxes, so header/footer
        # detection and the rest of the layout pipeline keep working.
        if (
            ocr_available
            and ocr_pages_used < READER_OCR_MAX_PAGES
            and not raw_blocks_have_text(raw_blocks)
        ):
            try:
                ocr_textpage = page.get_textpage_ocr(flags=0, dpi=OCR_DPI, full=True)
                ocr_blocks = page.get_text("blocks", sort=True, textpage=ocr_textpage)
                if raw_blocks_have_text(ocr_blocks):
                    raw_blocks = ocr_blocks
                    ocr_pages_used += 1
                    used_ocr = True
            except Exception:
                pass
        text_block_index = 0
        for raw in raw_blocks:
            if len(raw) < 5:
                continue
            x0, y0, x1, y1, text = raw[:5]
            text = normalize_document_text(str(text))
            if not text:
                continue
            bbox = {
                "x0": round(float(x0), 2),
                "y0": round(float(y0), 2),
                "x1": round(float(x1), 2),
                "y1": round(float(y1), 2),
            }
            kind = classify_vertical_band(bbox, height)
            if kind in {"header", "footer"}:
                normalized = normalize_repeated_text(text)
                y_bucket = int((bbox["y0"] if kind == "header" else bbox["y1"]) / 12)
                repeated_candidates[(kind, normalized, y_bucket)] = (
                    repeated_candidates.get((kind, normalized, y_bucket), 0) + 1
                )
            blocks.append(make_block(text_block_index, text, kind, bbox))
            text_block_index += 1

        page_blocks.append(
            {
                "index": page_index,
                "width": round(width, 2),
                "height": round(height, 2),
                "blocks": blocks,
            }
        )

    repeated = {
        key
        for key, count in repeated_candidates.items()
        if count >= max(2, int(len(page_blocks) * 0.4))
    }
    for page in page_blocks:
        height = page.get("height") or 0
        for block in page["blocks"]:
            bbox = block.get("bbox")
            if not bbox:
                continue
            kind = classify_vertical_band(bbox, float(height))
            normalized = normalize_repeated_text(block["text"])
            y_bucket = int((bbox["y0"] if kind == "header" else bbox["y1"]) / 12)
            if (kind, normalized, y_bucket) in repeated:
                block["kind"] = kind

    text = "\n\n".join(
        block["text"]
        for page in page_blocks
        for block in page["blocks"]
        if block.get("kind") == "content"
    )
    if not text.strip():
        text = "\n\n".join(
            block["text"] for page in page_blocks for block in page["blocks"]
        )

    return {
        "title": document.metadata.get("title") or path.stem,
        "kind": "pdf",
        "meta": {
            "engine": "pymupdf-ocr" if used_ocr else "pymupdf",
            "page_count": len(page_blocks),
        },
        "thumbnail": thumbnail,
        "text": normalize_document_text(text),
        "pages": page_blocks,
    }


def make_pdf_thumbnail(document: Any, fitz_module: Any) -> dict[str, str] | None:
    if len(document) == 0:
        return None
    page = document[0]
    rect = page.rect
    longest = max(float(rect.width), float(rect.height), 1.0)
    scale = min(2.0, max(0.25, 360.0 / longest))
    pixmap = page.get_pixmap(matrix=fitz_module.Matrix(scale, scale), alpha=False)
    return {
        "mime_type": "image/png",
        "base64": base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
    }


def classify_vertical_band(bbox: dict[str, float], height: float) -> str:
    if height <= 0:
        return "content"
    if bbox["y1"] <= height * 0.10:
        return "header"
    if bbox["y0"] >= height * 0.90:
        return "footer"
    return "content"


def normalize_repeated_text(text: str) -> str:
    return re.sub(r"\d+", "#", normalize_inline(text).lower())


def extract_docx(path: Path) -> dict[str, Any]:
    try:
        import docx  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on packaged runtime
        raise ExtractionError("python-docx is required for DOCX extraction.") from exc

    document = docx.Document(path)
    paragraphs = [normalize_document_text(paragraph.text) for paragraph in document.paragraphs]
    text = "\n\n".join(paragraph for paragraph in paragraphs if paragraph)
    return simple_document(path, "docx", "python-docx", text)


def extract_epub(path: Path) -> dict[str, Any]:
    try:
        from ebooklib import epub  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on packaged runtime
        raise ExtractionError("ebooklib is required for EPUB extraction.") from exc

    book = epub.read_epub(str(path))
    parts: list[str] = []
    for item in book.get_items():
        media_type = getattr(item, "media_type", "")
        if media_type not in {"application/xhtml+xml", "text/html"}:
            continue
        collector = HtmlTextCollector()
        collector.feed(item.get_content().decode("utf-8", errors="replace"))
        text = collector.text()
        if text:
            parts.append(text)
    return simple_document(path, "epub", "ebooklib", "\n\n".join(parts))


def extract_plain(path: Path, kind: str) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    return simple_document(path, kind, "python-plain-text", text)


def simple_document(path: Path, kind: str, engine: str, text: str) -> dict[str, Any]:
    normalized = normalize_document_text(text)
    return {
        "title": path.stem,
        "kind": kind,
        "meta": {
            "engine": engine,
            "page_count": 1 if normalized else 0,
        },
        "text": normalized,
        "pages": [text_page(0, normalized)] if normalized else [],
    }


def extract(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ExtractionError(f"{path} is not a readable file.")
    kind = SUPPORTED_EXTENSIONS.get(path.suffix.lower())
    if kind is None:
        raise ExtractionError("Unsupported document type. Use PDF, DOCX, EPUB, TXT, or MD.")
    if kind == "pdf":
        return extract_pdf(path)
    if kind == "docx":
        return extract_docx(path)
    if kind == "epub":
        return extract_epub(path)
    return extract_plain(path, kind)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Reader document text and layout.")
    parser.add_argument("--path", required=True, help="Document path to extract")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = parser.parse_args()

    try:
        result = extract(Path(args.path).expanduser().resolve())
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
        sys.stdout.write("\n")
        return 0
    except ExtractionError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"Reader extraction failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
