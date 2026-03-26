#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
REPO="${GITHUB_REPO:-KimaniDJ11/Vox-Jot}"
RELEASE_TAG="${RELEASE_TAG:-v0.3.0-tts-models}"

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

env -u GITHUB_TOKEN gh release upload "$RELEASE_TAG" "$ASSET_PATH" --clobber --repo "$REPO"
echo "Uploaded $ASSET_NAME to $RELEASE_TAG"
