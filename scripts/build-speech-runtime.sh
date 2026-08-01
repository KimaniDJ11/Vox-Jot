#!/usr/bin/env bash
set -euo pipefail

# Build the bundled Speech (TTS/Listen) runtime archive.
#
# The runtime ships a fully relocatable CPython from python-build-standalone
# (the same approach the OCR runtime and `uv` use) under `.python/`, instead of
# a `python -m venv` environment. A venv permanently hard-references the base
# interpreter it was created from (for example a Homebrew or python.org
# framework path), so a venv-based runtime cannot launch on a buyer Mac that
# does not have that exact interpreter installed. A python-build-standalone
# distribution loads libpython relative to the interpreter, so the whole
# `.python/` tree works from wherever the app extracts it.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_SRC="$ROOT_DIR/speech-runtime"
DIST_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/tmp/speech-runtime-build"

PYTHON_BIN="${SPEECH_RUNTIME_PYTHON:-python3.11}"
PYTHON_VERSION="${SPEECH_RUNTIME_PYTHON_VERSION:-3.11}"
# Pin the python-build-standalone release instead of tracking "latest": this
# interpreter ships inside the signed app, so the build must be reproducible and
# the download verified against the release's published SHA256SUMS.
PYTHON_BUILD_RELEASE="${SPEECH_RUNTIME_PYTHON_BUILD_RELEASE:-20260718}"
export PYTHONDONTWRITEBYTECODE=1

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Missing Python interpreter for build host helper: $PYTHON_BIN" >&2
  exit 1
fi

ARCH="${SPEECH_RUNTIME_ARCH:-}"
[ -z "$ARCH" ] && ARCH="$(uname -m)"
case "$(uname -s)" in
  Darwin)
    PLATFORM="macos"
    case "$ARCH" in
      arm64|aarch64) ARCH_ID="aarch64"; PYTHON_TARGET="aarch64-apple-darwin" ;;
      x86_64) ARCH_ID="x64"; PYTHON_TARGET="x86_64-apple-darwin" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    PLATFORM="linux"
    case "$ARCH" in
      x86_64) ARCH_ID="x64"; PYTHON_TARGET="x86_64-unknown-linux-gnu" ;;
      aarch64) ARCH_ID="aarch64"; PYTHON_TARGET="aarch64-unknown-linux-gnu" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    PLATFORM="windows"
    case "$ARCH" in
      x86_64|AMD64) ARCH_ID="x64"; PYTHON_TARGET="x86_64-pc-windows-msvc" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

mkdir -p "$DIST_DIR"
if [[ -d "$BUILD_DIR" ]]; then
  chmod -R u+w "$BUILD_DIR" 2>/dev/null || true
  rm -rf "$BUILD_DIR"
fi
mkdir -p "$BUILD_DIR"

# Stage the runtime source (exclude any local venv / standalone python / caches).
tar -C "$RUNTIME_SRC" \
  --exclude='./.venv' \
  --exclude='./.python' \
  --exclude='./vendor' \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  -cf - . | tar -C "$BUILD_DIR" -xf -

# Fetch a relocatable CPython from python-build-standalone for the target.
PYTHON_ARCHIVE="${SPEECH_RUNTIME_STANDALONE_PYTHON_ARCHIVE:-$ROOT_DIR/tmp/python-build-standalone-${PYTHON_VERSION}-${PYTHON_TARGET}.tar.gz}"
if [[ ! -f "$PYTHON_ARCHIVE" ]]; then
  mkdir -p "$(dirname "$PYTHON_ARCHIVE")"
  "$PYTHON_BIN" - "$PYTHON_VERSION" "$PYTHON_TARGET" "$PYTHON_ARCHIVE" "$PYTHON_BUILD_RELEASE" <<'PY'
import hashlib
import json
import os
import pathlib
import sys
import urllib.request

python_version, target, destination, release_tag = sys.argv[1:5]
api = (
    "https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/"
    f"{release_tag}"
)
headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "vox-jot-speech-runtime-builder",
    "X-GitHub-Api-Version": "2022-11-28",
}
github_token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
if github_token:
    headers["Authorization"] = f"Bearer {github_token}"

with urllib.request.urlopen(urllib.request.Request(api, headers=headers)) as response:
    release = json.load(response)

prefix = f"cpython-{python_version}."
asset = None
for suffix in ("install_only_stripped.tar.gz", "install_only.tar.gz"):
    for candidate in release["assets"]:
        name = candidate["name"]
        if name.startswith(prefix) and target in name and name.endswith(suffix):
            asset = candidate
            break
    if asset is not None:
        break
if asset is None:
    raise SystemExit(
        f"No python-build-standalone asset for Python {python_version} / {target} "
        f"in release {release_tag}"
    )

checksums_asset = next(
    (item for item in release["assets"] if item["name"] == "SHA256SUMS"), None
)
if checksums_asset is None:
    raise SystemExit(f"Release {release_tag} does not publish SHA256SUMS")
with urllib.request.urlopen(checksums_asset["browser_download_url"]) as response:
    checksums = response.read().decode("utf-8")
expected = next(
    (
        line.split()[0]
        for line in checksums.splitlines()
        if line.strip().endswith(f" {asset['name']}")
    ),
    None,
)
if expected is None:
    raise SystemExit(f"No published checksum for {asset['name']}")

url = asset["browser_download_url"]
path = pathlib.Path(destination)
print(f"Downloading {asset['name']} from {url}", flush=True)
digest = hashlib.sha256()
with urllib.request.urlopen(url) as response, path.open("wb") as out:
    while True:
        chunk = response.read(1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
        out.write(chunk)

actual = digest.hexdigest()
if actual != expected:
    path.unlink(missing_ok=True)
    raise SystemExit(
        f"Checksum mismatch for {asset['name']}: expected {expected}, got {actual}"
    )
print(f"Verified {asset['name']} (sha256)", flush=True)
PY
fi

mkdir -p "$BUILD_DIR/.python-extract"
tar -C "$BUILD_DIR/.python-extract" -xzf "$PYTHON_ARCHIVE"

if [[ "$PLATFORM" == "windows" ]]; then
  RUNTIME_PYTHON="$(find "$BUILD_DIR/.python-extract" -type f -name 'python.exe' ! -path '*/Lib/venv/*' | head -n 1)"
else
  RUNTIME_PYTHON="$(find "$BUILD_DIR/.python-extract" -type f -path '*/bin/python3*' ! -name '*-config' | head -n 1)"
fi
if [[ -z "$RUNTIME_PYTHON" || ! -f "$RUNTIME_PYTHON" ]]; then
  echo "Could not locate standalone speech runtime python" >&2
  exit 1
fi
if [[ "$PLATFORM" == "windows" ]]; then
  PYTHON_ROOT="$(cd "$(dirname "$RUNTIME_PYTHON")" && pwd)"
else
  PYTHON_ROOT="$(cd "$(dirname "$RUNTIME_PYTHON")/.." && pwd)"
fi
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
  echo "Standalone speech runtime python disappeared during staging" >&2
  exit 1
fi

"$RUNTIME_PYTHON" -m ensurepip --upgrade || true
"$RUNTIME_PYTHON" -m pip install --upgrade pip setuptools wheel
"$RUNTIME_PYTHON" -m pip install --no-compile -r "$BUILD_DIR/requirements.txt"
"$RUNTIME_PYTHON" "$ROOT_DIR/scripts/collect-python-runtime-notices.py" "$BUILD_DIR"
if [[ ! -s "$BUILD_DIR/THIRD_PARTY_NOTICES.txt" ]]; then
  echo "Speech runtime third-party notices were not generated" >&2
  exit 1
fi

# Strip caches and macOS metadata so the archive is reproducible and
# notarization-safe (no AppleDouble files inside bundled archives).
find "$BUILD_DIR" \
  \( -name '*.pyc' -o -name '__pycache__' -o -name '.DS_Store' -o -name '._*' -o -name '__MACOSX' \) \
  -exec rm -rf {} + 2>/dev/null || true

# The bundled speech runtime is extracted by a path that rejects symlinks (a
# safety property shared with downloaded TTS packs). python-build-standalone
# ships relative convenience symlinks (python3 -> python3.11, etc.); dereference
# them into real copies so the archive stays self-contained and link-free.
# Use the host Python so symlink chains resolve portably on macOS/Linux.
"$PYTHON_BIN" - "$BUILD_DIR" <<'PY'
import os
import shutil
import sys

root = sys.argv[1]
links = []
for dirpath, dirnames, filenames in os.walk(root):
    for name in list(dirnames) + filenames:
        path = os.path.join(dirpath, name)
        if os.path.islink(path):
            links.append(path)

for path in links:
    target = os.path.realpath(path)
    os.unlink(path)
    if not os.path.exists(target):
        # Dangling symlink (e.g. a man page not shipped); drop it.
        continue
    if os.path.isdir(target):
        shutil.copytree(target, path, symlinks=False)
    else:
        shutil.copy2(target, path)
PY

if find "$BUILD_DIR" -type l | grep -q .; then
  echo "Speech runtime build still contains symlinks after dereferencing:" >&2
  find "$BUILD_DIR" -type l -print >&2
  exit 1
fi

cat > "$BUILD_DIR/voxjot-speech-runtime.json" <<EOF
{
  "name": "vox-jot-speech-runtime",
  "platform": "$PLATFORM",
  "arch": "$ARCH_ID",
  "entrypoint": "runtime/app.py",
  "module": "runtime.app",
  "python_root": ".python",
  "python_unix": ".python/bin/python3",
  "python_windows": ".python/python.exe"
}
EOF

ASSET_NAME="speech-runtime-${PLATFORM}-${ARCH_ID}.tar.gz"
COPYFILE_DISABLE=1 tar -C "$BUILD_DIR" -czf "$DIST_DIR/$ASSET_NAME" .
if command -v shasum >/dev/null 2>&1; then
  (cd "$DIST_DIR" && shasum -a 256 "$ASSET_NAME" > "$ASSET_NAME.sha256")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$DIST_DIR" && sha256sum "$ASSET_NAME" > "$ASSET_NAME.sha256")
fi
echo "Built $DIST_DIR/$ASSET_NAME"
