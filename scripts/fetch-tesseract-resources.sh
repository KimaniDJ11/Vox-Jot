#!/usr/bin/env bash
# Download Tesseract + eng.traineddata into src-tauri/resources/tesseract/
# so the cross-platform OCR engine can run without any user-side install.
#
# Usage:
#   ./scripts/fetch-tesseract-resources.sh           # auto-detect host platform
#   ./scripts/fetch-tesseract-resources.sh --all     # fetch every supported platform
#   ./scripts/fetch-tesseract-resources.sh --platform=windows
#   ./scripts/fetch-tesseract-resources.sh --platform=linux
#   ./scripts/fetch-tesseract-resources.sh --tessdata-only
#
# macOS (Apple Silicon) uses Apple Vision and does not need a bundled tesseract;
# we still download tessdata so the BackupOnly engine setting works for QA.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TESS_DIR="$ROOT_DIR/src-tauri/resources/tesseract"
TESSDATA_DIR="$TESS_DIR/tessdata"
TESSDATA_URL="https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata"
WINDOWS_DIR="$TESS_DIR/windows-x64"
LINUX_DIR="$TESS_DIR/linux-x64"

# UB Mannheim is the canonical pre-built Tesseract distribution for Windows.
# Pin a specific version so reproducible builds aren't broken by upstream
# silently retiring an installer.
WIN_VERSION="5.5.0.20241111"
WIN_INSTALLER_URL="https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-${WIN_VERSION}.exe"

mode_platform=""
fetch_tessdata=1
fetch_all=0

for arg in "$@"; do
  case "$arg" in
    --all) fetch_all=1 ;;
    --platform=*) mode_platform="${arg#--platform=}" ;;
    --tessdata-only) mode_platform="tessdata-only" ;;
    --no-tessdata) fetch_tessdata=0 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$mode_platform" && $fetch_all -eq 0 ]]; then
  case "$(uname -s)" in
    Linux*)  mode_platform="linux" ;;
    Darwin*) mode_platform="tessdata-only" ;;
    MINGW*|MSYS*|CYGWIN*) mode_platform="windows" ;;
    *) mode_platform="tessdata-only" ;;
  esac
fi

mkdir -p "$TESSDATA_DIR" "$WINDOWS_DIR" "$LINUX_DIR"

download() {
  local url="$1"
  local dest="$2"
  echo "→ Downloading $(basename "$dest") ..."
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail --progress-bar -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress -qO "$dest" "$url"
  else
    echo "Neither curl nor wget is installed." >&2
    exit 1
  fi
}

fetch_tessdata_eng() {
  local target="$TESSDATA_DIR/eng.traineddata"
  if [[ -f "$target" ]]; then
    echo "✓ tessdata/eng.traineddata already present (delete to re-download)"
    return
  fi
  download "$TESSDATA_URL" "$target"
}

fetch_windows() {
  if [[ ! -x "$(command -v 7z)" && ! -x "$(command -v 7za)" ]]; then
    cat >&2 <<EOF
The Windows tesseract installer is an NSIS executable; extracting it without
running it requires 7-Zip.

  • macOS:  brew install p7zip
  • Linux:  apt install p7zip-full     (or: dnf install p7zip-plugins)
  • Windows: install via https://www.7-zip.org/

Re-run this script once 7-Zip is on PATH.
EOF
    exit 1
  fi
  local sevenzip
  sevenzip="$(command -v 7z || command -v 7za)"

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  local installer="$tmp/tesseract-installer.exe"
  download "$WIN_INSTALLER_URL" "$installer"

  echo "→ Extracting Windows tesseract..."
  "$sevenzip" x -y -o"$tmp/extracted" "$installer" >/dev/null

  # The NSIS layout puts files under the install root; locate tesseract.exe
  # and copy it + every DLL beside it (leptonica, libgcc, libstdc++, etc.).
  local tess_exe
  tess_exe="$(find "$tmp/extracted" -type f -iname 'tesseract.exe' | head -n 1)"
  if [[ -z "$tess_exe" ]]; then
    echo "Could not locate tesseract.exe after extraction." >&2
    exit 1
  fi
  local src_dir
  src_dir="$(dirname "$tess_exe")"

  rm -f "$WINDOWS_DIR"/*.exe "$WINDOWS_DIR"/*.dll "$WINDOWS_DIR"/*.so 2>/dev/null || true
  cp "$src_dir/tesseract.exe" "$WINDOWS_DIR/"
  # Copy every shared library next to the binary so PATH-less invocation works.
  shopt -s nullglob
  for f in "$src_dir"/*.dll; do
    cp "$f" "$WINDOWS_DIR/"
  done
  shopt -u nullglob

  trap - EXIT
  rm -rf "$tmp"
  echo "✓ Windows tesseract installed at $WINDOWS_DIR"
}

fetch_linux() {
  if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
    cat >&2 <<EOF
Bundling Linux tesseract requires apt-get + dpkg-deb (Debian / Ubuntu hosts).

On other distros, install tesseract via your package manager (e.g.
\`dnf install tesseract\`, \`pacman -S tesseract\`) and Vox Jot will pick the
binary up from PATH at runtime.

You can also drop a portable build into:
  $LINUX_DIR/tesseract
EOF
    return
  fi

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "→ Downloading tesseract-ocr + leptonica .deb packages..."
  (cd "$tmp" && apt-get download \
    tesseract-ocr \
    libtesseract5 \
    liblept5 \
    libgcc-s1 \
    libstdc++6 >/dev/null 2>&1) || {
      echo "apt-get download failed; ensure the apt cache is up to date and the packages are available." >&2
      exit 1
    }

  for deb in "$tmp"/*.deb; do
    dpkg-deb -x "$deb" "$tmp/extracted"
  done

  local tess_bin="$tmp/extracted/usr/bin/tesseract"
  if [[ ! -x "$tess_bin" ]]; then
    echo "Could not locate tesseract binary in extracted .deb files." >&2
    exit 1
  fi

  rm -f "$LINUX_DIR/tesseract" "$LINUX_DIR"/*.so* 2>/dev/null || true
  cp "$tess_bin" "$LINUX_DIR/tesseract"
  # Copy every libtesseract / liblept .so we extracted alongside.
  shopt -s nullglob
  for so in "$tmp/extracted/usr/lib/x86_64-linux-gnu"/lib{tesseract,lept}*.so*; do
    cp -P "$so" "$LINUX_DIR/"
  done
  shopt -u nullglob

  trap - EXIT
  rm -rf "$tmp"
  echo "✓ Linux tesseract installed at $LINUX_DIR"
}

case "$mode_platform" in
  tessdata-only)
    [[ $fetch_tessdata -eq 1 ]] && fetch_tessdata_eng
    ;;
  windows)
    [[ $fetch_tessdata -eq 1 ]] && fetch_tessdata_eng
    fetch_windows
    ;;
  linux)
    [[ $fetch_tessdata -eq 1 ]] && fetch_tessdata_eng
    fetch_linux
    ;;
  "")
    [[ $fetch_tessdata -eq 1 ]] && fetch_tessdata_eng
    if [[ $fetch_all -eq 1 ]]; then
      fetch_windows
      fetch_linux
    fi
    ;;
  *)
    echo "Unknown --platform value: $mode_platform" >&2
    exit 1
    ;;
esac

echo
echo "Done. Bundled assets live under:"
echo "  $TESS_DIR"
