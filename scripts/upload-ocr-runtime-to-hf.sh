#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
REPO_ID="${HF_OCR_RUNTIME_REPO:-IrieDinamik/vox-jot-ocr-runtime}"
PROFILE="${OCR_RUNTIME_PROFILE:-all}"

if ! command -v hf >/dev/null 2>&1; then
  echo "Missing Hugging Face CLI: install the 'hf' command and authenticate first." >&2
  exit 1
fi

ARCH="${OCR_RUNTIME_ARCH:-}"
[ -z "$ARCH" ] && ARCH="$(uname -m)"
case "$(uname -s)" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) PLATFORM="windows" ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac
case "$ARCH" in
  arm64|aarch64) ARCH_ID="aarch64" ;;
  x86_64) ARCH_ID="x64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ASSET_NAME="ocr-runtime-${PLATFORM}-${ARCH_ID}-${PROFILE}.tar.gz"
ASSET_PATH="$DIST_DIR/$ASSET_NAME"
MODEL_CARD_PATH="$ROOT_DIR/docs/hf-ocr-runtime-model-card.md"
if [[ ! -f "$ASSET_PATH" ]]; then
  echo "Missing asset: $ASSET_PATH" >&2
  echo "Run: OCR_RUNTIME_PROFILE=$PROFILE scripts/build-ocr-runtime.sh" >&2
  exit 1
fi
CHECKSUM_PATH="$ASSET_PATH.sha256"
if [[ ! -f "$CHECKSUM_PATH" ]]; then
  echo "Missing checksum: $CHECKSUM_PATH" >&2
  echo "Run: OCR_RUNTIME_PROFILE=$PROFILE scripts/build-ocr-runtime.sh" >&2
  exit 1
fi

hf repos create "$REPO_ID" --type model --exist-ok
if [[ -f "$MODEL_CARD_PATH" ]]; then
  hf upload "$REPO_ID" "$MODEL_CARD_PATH" README.md \
    --type model \
    --commit-message "Document Vox Jot OCR runtime artifacts"
fi
hf upload "$REPO_ID" "$ASSET_PATH" "$ASSET_NAME" \
  --type model \
  --commit-message "Upload Vox Jot OCR runtime $ASSET_NAME"
hf upload "$REPO_ID" "$CHECKSUM_PATH" "$ASSET_NAME.sha256" \
  --type model \
  --commit-message "Upload Vox Jot OCR runtime checksum $ASSET_NAME.sha256"

echo "Uploaded $ASSET_NAME to https://huggingface.co/$REPO_ID"
echo "Uploaded $ASSET_NAME.sha256 to https://huggingface.co/$REPO_ID"
