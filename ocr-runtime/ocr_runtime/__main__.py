"""Entry point: ``python -m ocr_runtime``.

Reads ``OCR_RUNTIME_MODEL_ROOT`` from the environment and runs the
``server.run`` loop on stdin/stdout. The Rust manager spawns one process
per active model and tears it down on selection change.
"""

from __future__ import annotations

import os
import sys

from . import server


def main() -> int:
    model_root = os.environ.get("OCR_RUNTIME_MODEL_ROOT", "")
    backend = os.environ.get("OCR_RUNTIME_BACKEND", "transformers_vl")
    catalog_id = os.environ.get("OCR_RUNTIME_CATALOG_ID", "")
    return server.run(
        model_root=model_root,
        backend=backend,
        catalog_id=catalog_id,
        stdin=sys.stdin,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


if __name__ == "__main__":
    raise SystemExit(main())
