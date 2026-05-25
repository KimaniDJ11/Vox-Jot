#!/usr/bin/env python3
import argparse
import os

from huggingface_hub import snapshot_download


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Vox Jot HF creative audio downloader")
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--local-dir", required=True)
    parser.add_argument("--ignore-pattern", action="append", default=[])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or None
    snapshot_download(
        repo_id=args.repo_id,
        local_dir=args.local_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
        token=token,
        ignore_patterns=args.ignore_pattern or None,
    )


if __name__ == "__main__":
    main()
