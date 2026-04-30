#!/usr/bin/env python3
"""
Mirror OCR weights from public upstreams into your Hugging Face namespace so
Vox Jot can download them anonymously.

  pip install 'huggingface_hub>=0.25'
  huggingface-cli login
  # or: export HF_TOKEN=hf_...

Staging is deleted after each successful upload so one large model does not
accumulate beside the next (avoids filling small temp volumes). Optionally set:

  export VOXJOT_OCR_MIRROR_TMP=/Volumes/Big/external-temp

to put each job staging on a roomy disk.

Examples:
  python3 scripts/upload_ocr_mirrors_to_hf.py --dry-run
  python3 scripts/upload_ocr_mirrors_to_hf.py --only qwen2.5-vl-3b
  python3 scripts/upload_ocr_mirrors_to_hf.py --private   # not recommended for app users

This does NOT run in CI — large downloads and uploads happen on your machine.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

try:
    from huggingface_hub import HfApi, snapshot_download
    from huggingface_hub.utils import HfHubHTTPError
except ImportError:
    print("Install huggingface_hub: pip install 'huggingface_hub>=0.25'", file=sys.stderr)
    raise SystemExit(1)

TARGET_NAMESPACE = os.environ.get("VOXJOT_OCR_MIRROR_NAMESPACE", "IrieDinamik")

# --- Default repo: f"{TARGET_NAMESPACE}/ocr-{slug(catalog_id)}".
#     Six mirrors use `ocr-mirror-*` + five extras use plain `ocr-*` — paired with
#     scripts/create_ocr_collection.py (eleven repos on the OCR Verified collection). ---


@dataclass(frozen=True)
class OcrMirrorJob:
    catalog_id: str
    notes: str
    kind: Literal["hf_repo", "hf_multi_repo", "git_shallow"]
    dest_repo_slug: str | None = None
    """If set, upload to f"{TARGET_NAMESPACE}/{dest_repo_slug}" instead of ocr-<catalog>."""
    upstream_hf: str | None = None
    """Single HF repo id for hf_repo."""
    subrepos: Sequence[tuple[str, str]] | None = None
    """For hf_multi_repo: list of (hf_repo_id, dest_subdir)."""
    git_url: str | None = None
    """Shallow clone source for tessdata_best."""


# Upstream repos are public community models — verify licenses before redistribution.
JOBS: tuple[OcrMirrorJob, ...] = (
    OcrMirrorJob(
        catalog_id="pp-ocrv5",
        kind="hf_multi_repo",
        notes="Mobile det+rec safetensors (Transformers). Add server variants if you need them.",
        dest_repo_slug="ocr-mirror-ppocrv5",
        subrepos=(
            ("PaddlePaddle/PP-OCRv5_mobile_det_safetensors", "PP-OCRv5_mobile_det_safetensors"),
            ("PaddlePaddle/PP-OCRv5_mobile_rec_safetensors", "PP-OCRv5_mobile_rec_safetensors"),
        ),
    ),
    OcrMirrorJob(
        catalog_id="paddleocr-vl-1.5",
        kind="hf_repo",
        upstream_hf="PaddlePaddle/PaddleOCR-VL-1.5",
        notes="PaddleOCR-VL 1.5 (0.9B VLM).",
        dest_repo_slug="ocr-mirror-paddleocr-vl-1.5",
    ),
    OcrMirrorJob(
        catalog_id="lighton-ocr-2-1b",
        kind="hf_repo",
        upstream_hf="lightonai/LightOnOCR-2-1B",
        notes="Default OCR-oriented LightOnOCR-2 checkpoint.",
        dest_repo_slug="ocr-mirror-lightonocr-2-1b",
    ),
    OcrMirrorJob(
        catalog_id="chandra-ocr-2",
        kind="hf_repo",
        upstream_hf="datalab-to/chandra-ocr-2",
        notes="Chandra OCR 2.",
        dest_repo_slug="ocr-mirror-chandra-ocr-2",
    ),
    OcrMirrorJob(
        catalog_id="dots-ocr",
        kind="hf_repo",
        upstream_hf="rednote-hilab/dots.ocr",
        notes="May require accepting license on HF in browser before download works.",
        dest_repo_slug="ocr-mirror-dots-ocr",
    ),
    OcrMirrorJob(
        catalog_id="olmocr-2-7b",
        kind="hf_repo",
        upstream_hf="allenai/olmOCR-2-7B-1025",
        notes="olmOCR 2 7B (matches app conventional_subdir olmOCR-2-7B-1025).",
        dest_repo_slug="ocr-mirror-olmocr-2-7b-1025",
    ),
    OcrMirrorJob(
        catalog_id="deepseek-ocr-2",
        kind="hf_repo",
        upstream_hf="deepseek-ai/DeepSeek-OCR-2",
        notes="DeepSeek-OCR 2.",
    ),
    OcrMirrorJob(
        catalog_id="glm-ocr",
        kind="hf_repo",
        upstream_hf="zai-org/GLM-OCR",
        notes="Zhipu GLM-OCR.",
    ),
    OcrMirrorJob(
        catalog_id="qwen2.5-vl-3b",
        kind="hf_repo",
        upstream_hf="Qwen/Qwen2.5-VL-3B-Instruct",
        notes="General VL; used as OCR-capable fallback in catalog.",
    ),
    OcrMirrorJob(
        catalog_id="nemotron-ocr-v2",
        kind="hf_repo",
        upstream_hf="nvidia/nemotron-ocr-v2",
        notes="Includes v2_english and v2_multilingual subfolders.",
    ),
    OcrMirrorJob(
        catalog_id="tessdata-best",
        kind="git_shallow",
        git_url="https://github.com/tesseract-ocr/tessdata_best.git",
        notes="Tesseract traineddata pack (many .traineddata files).",
    ),
)


def target_repo_id(job: OcrMirrorJob, namespace: str = TARGET_NAMESPACE) -> str:
    if job.dest_repo_slug:
        return f"{namespace}/{job.dest_repo_slug}"
    safe = job.catalog_id.replace(".", "-").strip()
    return f"{namespace}/ocr-{safe}"


def download_single_hf(upstream: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=upstream,
        local_dir=str(dest),
        local_dir_use_symlinks=False,
    )


def run_job(
    job: OcrMirrorJob,
    *,
    work: Path,
    dry_run: bool,
    private: bool,
) -> None:
    repo_id = target_repo_id(job)
    staging = work / job.catalog_id
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    print(f"\n=== {job.catalog_id} -> {repo_id} ===")
    print(job.notes)

    if job.kind == "hf_repo":
        assert job.upstream_hf
        print(f"  snapshot_download {job.upstream_hf} -> {staging}")
        if not dry_run:
            download_single_hf(job.upstream_hf, staging)

    elif job.kind == "hf_multi_repo":
        assert job.subrepos
        for hf_id, sub in job.subrepos:
            sub_path = staging / sub
            print(f"  snapshot_download {hf_id} -> {sub_path}")
            if not dry_run:
                download_single_hf(hf_id, sub_path)

    elif job.kind == "git_shallow":
        assert job.git_url
        print(f"  git clone --depth 1 {job.git_url} -> {staging}")
        if not dry_run:
            subprocess.run(
                [
                    "git",
                    "clone",
                    "--depth",
                    "1",
                    job.git_url,
                    str(staging),
                ],
                check=True,
            )
            git_dir = staging / ".git"
            if git_dir.exists():
                shutil.rmtree(git_dir)

    if dry_run:
        print("  (dry-run: skipping create_repo / upload_folder)")
        return

    api = HfApi()
    api.create_repo(repo_id=repo_id, repo_type="model", private=private, exist_ok=True)
    print(f"  uploading {staging} -> {repo_id} ...")
    api.upload_folder(
        folder_path=str(staging),
        repo_id=repo_id,
        repo_type="model",
        commit_message=f"Mirror OCR bundle for Vox Jot catalog ({job.catalog_id})",
    )
    print("  done.")
    if not dry_run and staging.exists():
        shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions only; do not download or upload.",
    )
    parser.add_argument(
        "--private",
        action="store_true",
        help="Create private repos (end users cannot download without a token).",
    )
    parser.add_argument(
        "--only",
        dest="only_id",
        metavar="CATALOG_ID",
        help="Run a single catalog id (e.g. lighton-ocr-2-1b).",
    )
    args = parser.parse_args()

    jobs = JOBS
    if args.only_id:
        jobs = tuple(j for j in JOBS if j.catalog_id == args.only_id)
        if not jobs:
            print(f"Unknown catalog id {args.only_id!r}. Valid: {', '.join(j.catalog_id for j in JOBS)}")
            raise SystemExit(2)

    if not args.dry_run and not os.environ.get("HF_TOKEN") and not Path.home().joinpath(".cache/huggingface/token").exists():
        # huggingface-cli stores token after login — soft check only
        print(
            "Hint: run `huggingface-cli login` or set HF_TOKEN=... before uploading.",
            file=sys.stderr,
        )

    tmp_base = os.environ.get("VOXJOT_OCR_MIRROR_TMP")
    tmp_kwargs: dict[str, str] = {}
    if tmp_base:
        tp = Path(tmp_base).expanduser()
        tp.mkdir(parents=True, exist_ok=True)
        tmp_kwargs["dir"] = str(tp)
    tmp_root = tempfile.mkdtemp(prefix="voxjot-ocr-mirror-", **tmp_kwargs)
    work = Path(tmp_root)
    try:
        for job in jobs:
            try:
                run_job(job, work=work, dry_run=args.dry_run, private=args.private)
            except HfHubHTTPError as e:
                print(f"  FAILED: {e}", file=sys.stderr)
                print(
                    "  (If gated, open the upstream model card in a browser and accept terms, "
                    "then retry with same HF account.)",
                    file=sys.stderr,
                )
            except Exception as e:
                print(f"  FAILED: {e}", file=sys.stderr)
    finally:
        if not args.dry_run:
            shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
