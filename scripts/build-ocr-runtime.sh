#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_SRC="$ROOT_DIR/ocr-runtime"
DIST_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/tmp/ocr-runtime-build"

PYTHON_BIN="${OCR_RUNTIME_PYTHON:-python3.11}"
PYTHON_VERSION="${OCR_RUNTIME_PYTHON_VERSION:-3.11}"
PROFILE="${OCR_RUNTIME_PROFILE:-all}"
export PYTHONDONTWRITEBYTECODE=1

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Missing Python interpreter: $PYTHON_BIN" >&2
  exit 1
fi

case "$PROFILE" in
  transformers-vl) EXTRAS="dots-ocr" ;;
  paddle) EXTRAS="paddle" ;;
  all) EXTRAS="dots-ocr,paddle" ;;
  *)
    echo "Unsupported OCR runtime profile: $PROFILE" >&2
    echo "Supported profiles: transformers-vl, paddle, all" >&2
    exit 1
    ;;
esac

ARCH="${OCR_RUNTIME_ARCH:-}"
[ -z "$ARCH" ] && ARCH="$(uname -m)"
case "$(uname -s)" in
  Darwin)
    PLATFORM="macos"
    case "$ARCH" in
      arm64|aarch64) ARCH_ID="aarch64"; PYTHON_TARGET="aarch64-apple-darwin" ;;
      x86_64) ARCH_ID="x64"; PYTHON_TARGET="x86_64-apple-darwin" ;;
      *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    ;;
  Linux)
    PLATFORM="linux"
    case "$ARCH" in
      x86_64) ARCH_ID="x64"; PYTHON_TARGET="x86_64-unknown-linux-gnu" ;;
      aarch64) ARCH_ID="aarch64"; PYTHON_TARGET="aarch64-unknown-linux-gnu" ;;
      *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    PLATFORM="windows"
    case "$ARCH" in
      x86_64|AMD64) ARCH_ID="x64"; PYTHON_TARGET="x86_64-pc-windows-msvc-shared" ;;
      *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

mkdir -p "$DIST_DIR"
if [[ -d "$BUILD_DIR" ]]; then
  chmod -R u+w "$BUILD_DIR" 2>/dev/null || true
  rm -rf "$BUILD_DIR"
fi
mkdir -p "$BUILD_DIR"

tar -C "$RUNTIME_SRC" \
  --exclude='./.venv' \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  -cf - . | tar -C "$BUILD_DIR" -xf -

PYTHON_ARCHIVE="${OCR_RUNTIME_STANDALONE_PYTHON_ARCHIVE:-$ROOT_DIR/tmp/python-build-standalone-${PYTHON_VERSION}-${PYTHON_TARGET}.tar.gz}"
if [[ ! -f "$PYTHON_ARCHIVE" ]]; then
  mkdir -p "$(dirname "$PYTHON_ARCHIVE")"
  "$PYTHON_BIN" - "$PYTHON_VERSION" "$PYTHON_TARGET" "$PYTHON_ARCHIVE" <<'PY'
import json
import pathlib
import sys
import urllib.request

python_version, target, destination = sys.argv[1:4]
api = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
with urllib.request.urlopen(api) as response:
    release = json.load(response)

prefix = f"cpython-{python_version}."
asset = None
for candidate in release["assets"]:
    name = candidate["name"]
    if (
        name.startswith(prefix)
        and target in name
        and name.endswith("install_only_stripped.tar.gz")
    ):
        asset = candidate
        break
if asset is None:
    for candidate in release["assets"]:
        name = candidate["name"]
        if (
            name.startswith(prefix)
            and target in name
            and name.endswith("install_only.tar.gz")
        ):
            asset = candidate
            break
if asset is None:
    raise SystemExit(f"No python-build-standalone asset found for Python {python_version} / {target}")

url = asset["browser_download_url"]
path = pathlib.Path(destination)
print(f"Downloading {asset['name']} from {url}", flush=True)
with urllib.request.urlopen(url) as response, path.open("wb") as out:
    while True:
        chunk = response.read(1024 * 1024)
        if not chunk:
            break
        out.write(chunk)
PY
fi

mkdir -p "$BUILD_DIR/.python-extract"
tar -C "$BUILD_DIR/.python-extract" -xzf "$PYTHON_ARCHIVE"

if [[ "$PLATFORM" == "windows" ]]; then
  RUNTIME_PYTHON="$(
    find "$BUILD_DIR/.python-extract" -type f -name 'python.exe' | head -n 1
  )"
else
  RUNTIME_PYTHON="$(
    find "$BUILD_DIR/.python-extract" -type f -path '*/bin/python3*' ! -name '*-config' | head -n 1
  )"
fi
if [[ -z "$RUNTIME_PYTHON" || ! -f "$RUNTIME_PYTHON" ]]; then
  echo "Could not locate standalone OCR runtime python" >&2
  exit 1
fi
PYTHON_ROOT="$(cd "$(dirname "$RUNTIME_PYTHON")/.." && pwd)"
rm -rf "$BUILD_DIR/.python"
mv "$PYTHON_ROOT" "$BUILD_DIR/.python"
rm -rf "$BUILD_DIR/.python-extract"

if [[ -f "$BUILD_DIR/.python/bin/python3" ]]; then
  RUNTIME_PYTHON="$BUILD_DIR/.python/bin/python3"
elif [[ -f "$BUILD_DIR/.python/bin/python3.11" ]]; then
  RUNTIME_PYTHON="$BUILD_DIR/.python/bin/python3.11"
elif [[ -f "$BUILD_DIR/.python/python.exe" ]]; then
  RUNTIME_PYTHON="$BUILD_DIR/.python/python.exe"
else
  echo "Standalone OCR runtime python disappeared during install staging" >&2
  exit 1
fi

"$RUNTIME_PYTHON" -m ensurepip --upgrade || true
"$RUNTIME_PYTHON" -m pip install --upgrade pip setuptools wheel
"$RUNTIME_PYTHON" -m pip install --no-compile "$BUILD_DIR[$EXTRAS]"

find "$BUILD_DIR" \
  \( -name '*.pyc' -o -name '__pycache__' -o -name '.DS_Store' \) \
  -exec rm -rf {} + 2>/dev/null || true

find "$BUILD_DIR/.python" \
  \( -type d -name '__pycache__' -o -type f -name '*.pyc' \) \
  -exec rm -rf {} + 2>/dev/null || true

rm -rf "$BUILD_DIR/build" "$BUILD_DIR/ocr_runtime.egg-info"

cat > "$BUILD_DIR/voxjot-ocr-runtime.json" <<EOF
{
  "name": "vox-jot-ocr-runtime",
  "version": "2026-05-13",
  "platform": "$PLATFORM",
  "arch": "$ARCH_ID",
  "profile": "$PROFILE",
  "entrypoint": "ocr_runtime/__main__.py",
  "python_root": ".python",
  "python_unix": ".python/bin/python3",
  "python_windows": ".python/python.exe"
}
EOF

ASSET_NAME="ocr-runtime-${PLATFORM}-${ARCH_ID}-${PROFILE}.tar.gz"
tar -C "$BUILD_DIR" -czf "$DIST_DIR/$ASSET_NAME" .
if command -v shasum >/dev/null 2>&1; then
  (cd "$DIST_DIR" && shasum -a 256 "$ASSET_NAME" > "$ASSET_NAME.sha256")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$DIST_DIR" && sha256sum "$ASSET_NAME" > "$ASSET_NAME.sha256")
else
  echo "Missing shasum or sha256sum; cannot write checksum file." >&2
  exit 1
fi
echo "Built $DIST_DIR/$ASSET_NAME"
echo "Built $DIST_DIR/$ASSET_NAME.sha256"
