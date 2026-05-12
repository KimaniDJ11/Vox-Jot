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

tar -C "$RUNTIME_SRC" \
  --exclude='./.venv' \
  --exclude='./vendor' \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  -cf - . | tar -C "$BUILD_DIR" -xf -

"$PYTHON_BIN" -m venv "$BUILD_DIR/.venv"

# Resolve the venv python — Windows puts it under Scripts/, Unix under bin/
if [ -f "$BUILD_DIR/.venv/bin/python" ]; then
  VENV_PYTHON="$BUILD_DIR/.venv/bin/python"
elif [ -f "$BUILD_DIR/.venv/Scripts/python.exe" ]; then
  VENV_PYTHON="$BUILD_DIR/.venv/Scripts/python.exe"
else
  echo "Could not locate venv python" >&2
  exit 1
fi

"$VENV_PYTHON" -m pip install --upgrade pip setuptools wheel
"$VENV_PYTHON" -m pip install -r "$BUILD_DIR/requirements.txt"

ARCH="${SPEECH_RUNTIME_ARCH:-}"
[ -z "$ARCH" ] && ARCH="$(uname -m)"
case "$(uname -s)" in
  Darwin)  PLATFORM="macos" ;;
  Linux)   PLATFORM="linux" ;;
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

ASSET_NAME="speech-runtime-${PLATFORM}-${ARCH_ID}.tar.gz"
tar -C "$BUILD_DIR" -czf "$DIST_DIR/$ASSET_NAME" .
echo "Built $DIST_DIR/$ASSET_NAME"
