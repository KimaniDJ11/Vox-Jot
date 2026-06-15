#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_PATH="${1:-}"
if [[ -z "$ARCHIVE_PATH" || ! -f "$ARCHIVE_PATH" ]]; then
  echo "Usage: $0 <ocr-runtime-archive.tar.gz>" >&2
  exit 1
fi

VERIFY_DIR="${OCR_RUNTIME_VERIFY_DIR:-$(mktemp -d)}"
cleanup() {
  if [[ -z "${OCR_RUNTIME_KEEP_VERIFY_DIR:-}" ]]; then
    chmod -R u+w "$VERIFY_DIR" 2>/dev/null || true
    rm -rf "$VERIFY_DIR"
  fi
}
trap cleanup EXIT

rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"
tar -C "$VERIFY_DIR" -xzf "$ARCHIVE_PATH"

if [[ -f "$VERIFY_DIR/.python/bin/python3" ]]; then
  RUNTIME_PYTHON="$VERIFY_DIR/.python/bin/python3"
elif [[ -f "$VERIFY_DIR/.python/bin/python3.11" ]]; then
  RUNTIME_PYTHON="$VERIFY_DIR/.python/bin/python3.11"
elif [[ -f "$VERIFY_DIR/.python/python.exe" ]]; then
  RUNTIME_PYTHON="$VERIFY_DIR/.python/python.exe"
else
  echo "Archive does not contain a supported standalone Python interpreter." >&2
  exit 1
fi

(cd "$VERIFY_DIR" && "$RUNTIME_PYTHON" - <<'PY'
import importlib.util
import json
import pathlib
import sys

root = pathlib.Path.cwd()
manifest = root / "voxjot-ocr-runtime.json"
entrypoint = root / "ocr_runtime" / "__main__.py"
if not manifest.is_file():
    raise SystemExit("missing voxjot-ocr-runtime.json")
if not entrypoint.is_file():
    raise SystemExit("missing ocr_runtime/__main__.py")

metadata = json.loads(manifest.read_text())
profile = metadata.get("profile")
required = ["PIL"]
if profile in {"all", "transformers-vl"}:
    required.extend(["torch", "transformers"])
if profile in {"all", "paddle"}:
    required.append("paddleocr")
if profile == "mlx-vl" or (
    profile == "all"
    and metadata.get("platform") == "macos"
    and metadata.get("arch") == "aarch64"
):
    required.extend(["mlx", "mlx_vlm"])
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
    raise SystemExit(f"missing modules: {', '.join(missing)}")

print(f"verified {metadata['platform']}-{metadata['arch']} {metadata['profile']} with Python {sys.version.split()[0]}")
PY
)
