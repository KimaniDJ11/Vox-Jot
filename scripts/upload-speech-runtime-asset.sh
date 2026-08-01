#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
HF_REPO="${HF_SPEECH_RUNTIME_REPO:-IrieDinamik/vox-jot-models}"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ASSET_NAME="speech-runtime-macos-aarch64.tar.gz" ;;
  x86_64) ASSET_NAME="speech-runtime-macos-x64.tar.gz" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ASSET_PATH="$DIST_DIR/$ASSET_NAME"
if [[ ! -f "$ASSET_PATH" ]]; then
  echo "Missing asset: $ASSET_PATH" >&2
  exit 1
fi

if ! command -v hf >/dev/null 2>&1; then
  echo "Missing Hugging Face CLI: install the 'hf' command and authenticate first." >&2
  exit 1
fi

if ! hf auth whoami >/dev/null 2>&1; then
  echo "Hugging Face CLI is not authenticated. Run: hf auth login" >&2
  exit 1
fi

ARCHIVE_LISTING="$(tar -tzf "$ASSET_PATH")"
if ! grep -q 'THIRD_PARTY_NOTICES.txt' <<<"$ARCHIVE_LISTING"; then
  echo "Runtime archive is missing THIRD_PARTY_NOTICES.txt: $ASSET_PATH" >&2
  exit 1
fi

if grep -Eq '(^|/)(\._|__MACOSX)' <<<"$ARCHIVE_LISTING"; then
  echo "Runtime archive contains macOS metadata: $ASSET_PATH" >&2
  exit 1
fi

REMOTE_PATH="tts/releases/$ASSET_NAME"
hf upload "$HF_REPO" "$ASSET_PATH" "$REMOTE_PATH" \
  --commit-message "Update Vox Jot speech runtime $ASSET_NAME"

VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT
hf download "$HF_REPO" "$REMOTE_PATH" --local-dir "$VERIFY_DIR" --quiet
cmp "$ASSET_PATH" "$VERIFY_DIR/$REMOTE_PATH"

echo "Uploaded and byte-verified https://huggingface.co/$HF_REPO/resolve/main/$REMOTE_PATH"
