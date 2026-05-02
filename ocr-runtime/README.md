# Vox Jot OCR runtime

Long-lived Python sidecar that owns the loaded vision-language model for the
**neural Screen OCR** path. The Rust side
(`src-tauri/src/ocr_runtime.rs`) spawns one of these processes per active
neural model and talks to it over **stdin/stdout, line-delimited JSON** —
the same shape as `vibevoice_bridge.py` but always-on so we don't pay
model-load cost (5–30s) per capture.

The router only routes here when:

- a neural OCR model is selected on the OCR card,
- the catalog row's `runnable` flag is `true` (files exist + probe passed),
- the entry's `OcrBackendKind` is `TransformersVl` (Phase 1 scope).

## IPC contract

Every request is one JSON object on its own line. Every response is one
JSON object on its own line. The runtime reads `OCR_RUNTIME_MODEL_ROOT`
from the environment at start-up and keeps the model resident for the
process lifetime.

### Request

```jsonc
{ "request_id": 17, "op": "probe" }
```

```jsonc
{
  "request_id": 18,
  "op": "ocr",
  "frame_b64": "<base64-encoded BGRA bytes>",
  "width": 2560,
  "height": 1440,
  "stride": 10240,
  "max_words": 400,
}
```

### Response

```jsonc
{ "request_id": 17, "ok": true, "loaded": true, "version": "0.1.0" }
```

```jsonc
{
  "request_id": 18,
  "snippets": [
    {
      "text": "Hello world",
      "confidence": 0.92,
      "x": 0.1,
      "y": 0.4,
      "width": 0.3,
      "height": 0.04,
    },
  ],
}
```

Errors come back as:

```jsonc
{ "request_id": 18, "error": "<message>" }
```

Coordinates are normalised to 0..1, top-left origin matches Vision's
`VNRecognizedTextObservation.boundingBox` (we flip y to bottom-left in the
Rust side, just like the Win/Linux Tesseract path).

## Dev bootstrap

For the **stub server** (no inference; returns empty snippets) only the
Python stdlib is required — any system Python 3.10+ works.

```sh
python3 -m ocr_runtime --probe   # reads one probe request from stdin, writes one response
```

For **real model inference** (Phase 1 follow-up work in
`ocr_runtime/loaders/`), bootstrap a uv venv:

```sh
cd ocr-runtime
uv venv
uv pip install -e '.[dots-ocr]'        # adds transformers + torch + pillow
export OCR_RUNTIME_PYTHON="$PWD/.venv/bin/python"
```

The Rust manager picks `OCR_RUNTIME_PYTHON` first, then the speech-runtime
venv, then `python3` from `PATH`.

## Layout

```
ocr-runtime/
├── pyproject.toml
├── README.md
└── ocr_runtime/
    ├── __init__.py
    ├── __main__.py
    ├── server.py              # JSON loop + dispatcher
    └── loaders/
        ├── __init__.py
        ├── base.py            # OcrLoader protocol
        └── stub.py            # returns empty snippets
        # dots_ocr.py, qwen_vl.py, paddle.py … add per-family loaders here
```

Each loader takes `(model_root: Path)` at init and exposes
`run(image: PIL.Image, max_words: int) -> list[Snippet]`.
