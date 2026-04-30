#!/usr/bin/env python3
"""
Create or refresh the public Hugging Face collection “Vox Jot – OCR Verified” on
your namespace (default IrieDinamik), optionally publish each mirrored OCR repo,
and attach all eleven curated models for discovery (aligned with
`scripts/upload_ocr_mirrors_to_hf.py`).

  pip install 'huggingface_hub>=0.25'
  export HF_TOKEN=hf_...   # write token
  python3 scripts/create_ocr_collection.py
  python3 scripts/create_ocr_collection.py --make-public

With private models + a public collection: only logged-in collaborators see the
model cards unless you flip repos public (--make-public or MAKE_PUBLIC_DEFAULT).

`HfApi.update_repo_settings(..., private=False)` is the supported hub API as of
huggingface_hub≥0.25 (write token).

This script does not run in CI — it uses your HF account from the shell.
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    from huggingface_hub import HfApi, add_collection_item
except ImportError:
    print("Install huggingface_hub: pip install 'huggingface_hub>=0.25'", file=sys.stderr)
    raise SystemExit(1)

COLLECTION_TITLE = "Vox Jot – OCR Verified"

# Mirror of STT/TTS-style collection blurbs; adjust if your other collections drift.
COLLECTION_DESCRIPTION = (
    "Verified OCR model mirrors used by Vox Jot downloads. "
    "Primary entries are ranked fastest → balanced → best quality (`ocr-mirror-*`), "
    "followed by supplemental catalog mirrors (`ocr-*`) matching `upload_ocr_mirrors_to_hf.py`. "
    "Repos are redistribution-friendly snapshots — see each card for upstream lineage."
)

NAMESPACE = os.environ.get("VOXJOT_OCR_COLLECTION_NAMESPACE", "IrieDinamik")

# Repo slug (no namespace): order is primary ranked mirrors first, then catalog extras — 11 total.
OCR_VERIFIED_ENTRIES: tuple[tuple[str, str], ...] = (
    ("ocr-mirror-lightonocr-2-1b", "Ranked mirrors — Fastest, 1B"),
    ("ocr-mirror-paddleocr-vl-1.5", "Ranked mirrors — Fastest, 1B"),
    ("ocr-mirror-ppocrv5", "Ranked mirrors — Balanced"),
    ("ocr-mirror-dots-ocr", "Ranked mirrors — Balanced, 3B"),
    ("ocr-mirror-chandra-ocr-2", "Ranked mirrors — Best quality, 5B"),
    ("ocr-mirror-olmocr-2-7b-1025", "Ranked mirrors — Best quality, 7B"),
    ("ocr-deepseek-ocr-2", "Additional catalog — DeepSeek-OCR 2 (VL stack)"),
    ("ocr-glm-ocr", "Additional catalog — GLM-OCR"),
    ("ocr-qwen2-5-vl-3b", "Additional catalog — Qwen2.5-VL 3B (OCR-capable VL fallback)"),
    ("ocr-nemotron-ocr-v2", "Additional catalog — NVIDIA Nemotron OCR v2 (English + multilingual)"),
    ("ocr-tessdata-best", "Additional catalog — Tesseract tessdata_best pack (classic engine)"),
)

# Same idea as flipping MAKE_PUBLIC=True in your ad-hoc script: run with --make-public
# or set this to True once you want anonymous Hub users to browse these mirrors.
MAKE_PUBLIC_DEFAULT = False


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--make-public",
        action="store_true",
        help=(
            "After creating the collection, set each of the eleven OCR mirror repos "
            "to private=False on the Hub."
        ),
    )
    ap.add_argument(
        "--namespace",
        default=NAMESPACE,
        help=f"Hugging Face namespace for collection + models (default: {NAMESPACE}).",
    )
    args = ap.parse_args()
    ns = args.namespace.strip()
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        print(
            "Set HF_TOKEN (write) — see https://huggingface.co/settings/tokens",
            file=sys.stderr,
        )
        raise SystemExit(2)

    make_public = MAKE_PUBLIC_DEFAULT or args.make_public
    api = HfApi(token=token)

    if make_public:
        for slug, _ in OCR_VERIFIED_ENTRIES:
            rid = f"{ns}/{slug}"
            print(f"Publishing model repo {rid} …", flush=True)
            api.update_repo_settings(rid, private=False, repo_type="model")

    print(f"Creating collection “{COLLECTION_TITLE}” under {ns} …", flush=True)
    coll = api.create_collection(
        title=COLLECTION_TITLE,
        namespace=ns,
        description=COLLECTION_DESCRIPTION,
        private=False,
        exists_ok=True,
        token=token,
    )

    for slug, note in OCR_VERIFIED_ENTRIES:
        item_id = f"{ns}/{slug}"
        snippet = note if len(note) <= 52 else note[:49] + "…"
        print(f"Adding {item_id} ({snippet}) …", flush=True)
        add_collection_item(
            collection_slug=coll.slug,
            item_id=item_id,
            item_type="model",
            note=note,
            exists_ok=True,
            token=token,
        )

    print("Done.")
    print(f"Collection slug: {coll.slug}")
    print(f"URL: https://huggingface.co/collections/{coll.slug}")


if __name__ == "__main__":
    main()
