#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
APP_PATH="/Applications/${APP_NAME}.app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${VOX_JOT_CARGO_TARGET_DIR:-/tmp/vox-jot-release}"
BUILT_APP_PATH="${TARGET_DIR}/release/bundle/macos/${APP_NAME}.app"
SIGNING_IDENTITY="Apple Development: Kimani James (6B77K7V4Z9)"
TAURI_CONFIG_OVERRIDE='{"build":{"beforeBuildCommand":"echo frontend-build-ready"},"bundle":{"createUpdaterArtifacts":false}}'

echo "Closing running ${APP_NAME} instances..."
/usr/bin/osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
/usr/bin/pkill -x "vox_jot" >/dev/null 2>&1 || true

for _ in {1..20}; do
  if ! /usr/bin/pgrep -x "vox_jot" >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 1
done

if /usr/bin/pgrep -x "vox_jot" >/dev/null 2>&1; then
  echo "${APP_NAME} is still running. Close it fully, then run this script again." >&2
  exit 1
fi

echo "Building frontend..."
cd "${REPO_ROOT}"
bun run build

echo "Cleaning stale whisper-rs-sys build artifacts..."
find "${TARGET_DIR}" \
  -type d \
  -path '*/whisper-rs-sys-*/out/whisper.cpp' \
  ! -exec test -f "{}/CMakeLists.txt" \; \
  -print0 2>/dev/null | while IFS= read -r -d '' stale_dir; do
  build_dir="$(dirname "$(dirname "${stale_dir}")")"
  echo "Removing stale build dir: ${build_dir}"
  rm -rf "${build_dir}"
done

echo "Building signed macOS bundle..."
export CARGO_TARGET_DIR="${TARGET_DIR}"
export CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}"
bun run tauri build --config "${TAURI_CONFIG_OVERRIDE}"

if [[ ! -d "${BUILT_APP_PATH}" ]]; then
  echo "Built app bundle not found at ${BUILT_APP_PATH}" >&2
  exit 1
fi

echo "Verifying built bundle signature..."
/usr/bin/codesign --verify --deep --strict "${BUILT_APP_PATH}"

if [[ -d "${APP_PATH}" ]]; then
  echo "Updating installed app in place..."
  /usr/bin/rsync -a --delete "${BUILT_APP_PATH}/" "${APP_PATH}/"
else
  echo "Installing app bundle..."
  /usr/bin/ditto "${BUILT_APP_PATH}" "${APP_PATH}"
fi

/usr/bin/xattr -cr "${APP_PATH}"
/usr/bin/codesign --verify --deep --strict "${APP_PATH}"

VERSION="$(/usr/bin/defaults read "${APP_PATH}/Contents/Info.plist" CFBundleShortVersionString)"
SIGNING_INFO="$(/usr/bin/codesign -dv --verbose=4 "${APP_PATH}" 2>&1)"

if ! /usr/bin/grep -Fq "${SIGNING_IDENTITY}" <<<"${SIGNING_INFO}"; then
  echo "Installed app is not signed with the expected Apple Development identity." >&2
  echo "${SIGNING_INFO}" >&2
  exit 1
fi

echo "Installed ${APP_NAME} ${VERSION} at ${APP_PATH}"
echo "Signing identity verified: ${SIGNING_IDENTITY}"

echo "Opening installed app..."
/usr/bin/open -a "${APP_PATH}"
