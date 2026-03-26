#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_SRC="$ROOT_DIR/speech-runtime"
DIST_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/tmp/speech-runtime-build"

PYTHON_BIN="${SPEECH_RUNTIME_PYTHON:-python3.11}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Missing Python interpreter: $PYTHON_BIN" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp -R "$RUNTIME_SRC"/. "$BUILD_DIR"/

"$PYTHON_BIN" -m venv "$BUILD_DIR/.venv"
"$BUILD_DIR/.venv/bin/python" -m pip install --upgrade pip setuptools wheel
"$BUILD_DIR/.venv/bin/python" -m pip install -r "$BUILD_DIR/requirements.txt"

ARCH="$(uname -m)"
PLATFORM="macos"
case "$ARCH" in
  arm64|aarch64) ARCH_ID="aarch64" ;;
  x86_64) ARCH_ID="x64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ASSET_NAME="speech-runtime-${PLATFORM}-${ARCH_ID}.tar.gz"
tar -C "$BUILD_DIR" -czf "$DIST_DIR/$ASSET_NAME" .
echo "Built $DIST_DIR/$ASSET_NAME"
