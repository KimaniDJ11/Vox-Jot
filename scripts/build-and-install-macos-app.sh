#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
APP_PATH="/Applications/${APP_NAME}.app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${VOX_JOT_CARGO_TARGET_DIR:-/tmp/vox-jot-release}"
BUILT_APP_PATH="${TARGET_DIR}/release/bundle/macos/${APP_NAME}.app"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
TAURI_CONFIG_OVERRIDE='{"build":{"beforeBuildCommand":"echo frontend-build-ready"},"bundle":{"createUpdaterArtifacts":false}}'

if [[ -z "${SIGNING_IDENTITY}" ]]; then
  SIGNING_IDENTITY="$(
    /usr/bin/security find-identity -v -p codesigning 2>/dev/null \
      | /usr/bin/awk -F '"' '/Apple Development: / { print $2; exit }'
  )"
fi

if [[ -n "${SIGNING_IDENTITY}" ]]; then
  echo "Using Apple signing identity: ${SIGNING_IDENTITY}"
else
  echo "No Apple Development signing identity found. Falling back to ad-hoc signing."
fi

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
done || true

echo "Cleaning stale Tauri permission build artifacts..."
stale_tauri_dirs=()
while IFS= read -r -d '' tauri_output; do
  permission_paths=()
  while IFS= read -r permission_path; do
    permission_paths+=("${permission_path}")
  done < <(
    /usr/bin/awk -F= '/_PERMISSION_FILES_PATH=/{print $2}' "${tauri_output}" 2>/dev/null
  )

  if [[ "${#permission_paths[@]}" -eq 0 ]]; then
    continue
  fi

  missing_permissions=false
  for permission_path in "${permission_paths[@]}"; do
    if [[ ! -f "${permission_path}" ]]; then
      missing_permissions=true
      break
    fi
  done

  if [[ "${missing_permissions}" == true ]]; then
    stale_tauri_dirs+=("$(dirname "${tauri_output}")")
  fi
done < <(
  find "${TARGET_DIR}/release/build" \
    -maxdepth 2 \
    -type f \
    -path '*/tauri-*/output' \
    -print0 2>/dev/null
)

if [[ "${#stale_tauri_dirs[@]}" -gt 0 ]]; then
  for stale_dir in "${stale_tauri_dirs[@]}"; do
    echo "Removing stale Tauri build dir: ${stale_dir}"
    rm -rf "${stale_dir}"
  done

  find "${TARGET_DIR}/release/.fingerprint" \
    -maxdepth 1 \
    -type d \
    -name 'tauri-*' \
    -print0 2>/dev/null | while IFS= read -r -d '' stale_dir; do
    echo "Removing stale Tauri fingerprint dir: ${stale_dir}"
    rm -rf "${stale_dir}"
  done

  find "${TARGET_DIR}/release/deps" \
    -maxdepth 1 \
    -type f \
    \( -name 'libtauri*.rlib' -o -name 'libtauri*.rmeta' -o -name 'tauri-*.d' \) \
    -print0 2>/dev/null | while IFS= read -r -d '' stale_file; do
    echo "Removing stale Tauri dep artifact: ${stale_file}"
    rm -f "${stale_file}"
  done
fi

echo "Building signed macOS bundle..."
export CARGO_TARGET_DIR="${TARGET_DIR}"
export CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}"
bun run tauri build --bundles app --config "${TAURI_CONFIG_OVERRIDE}"

if [[ ! -d "${BUILT_APP_PATH}" ]]; then
  echo "Built app bundle not found at ${BUILT_APP_PATH}" >&2
  exit 1
fi

echo "Signing built bundle..."
if [[ -n "${SIGNING_IDENTITY}" ]]; then
  /usr/bin/codesign \
    --force \
    --deep \
    --sign "${SIGNING_IDENTITY}" \
    --entitlements "${REPO_ROOT}/src-tauri/Entitlements.plist" \
    "${BUILT_APP_PATH}"
else
  /usr/bin/codesign --force --deep --sign - "${BUILT_APP_PATH}"
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

if [[ -n "${SIGNING_IDENTITY}" ]]; then
  if ! /usr/bin/grep -Fq "${SIGNING_IDENTITY}" <<<"${SIGNING_INFO}"; then
    echo "Installed app is not signed with the expected Apple Development identity." >&2
    echo "${SIGNING_INFO}" >&2
    exit 1
  fi
fi

echo "Installed ${APP_NAME} ${VERSION} at ${APP_PATH}"
if [[ -n "${SIGNING_IDENTITY}" ]]; then
  echo "Signing identity verified: ${SIGNING_IDENTITY}"
else
  echo "Installed app uses ad-hoc signing."
fi

echo "Opening installed app..."
/usr/bin/open -a "${APP_PATH}"
