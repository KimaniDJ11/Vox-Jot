#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
APP_PATH="/Applications/${APP_NAME}.app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${VOX_JOT_CARGO_TARGET_DIR:-/tmp/vox-jot-release}"
BUILT_APP_PATH="${TARGET_DIR}/release/bundle/macos/${APP_NAME}.app"
NOTARY_ZIP_PATH="${TARGET_DIR}/release/bundle/macos/${APP_NAME}-notary.zip"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
NOTARY_KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-voxjot-notary}"
APPLE_NOTARY_PASSWORD="${APPLE_PASSWORD:-${APPLE_ID_PASSWORD:-}}"
NOTARY_CREDENTIAL_MODE=""
TAURI_CONFIG_OVERRIDE='{"build":{"beforeBuildCommand":"echo frontend-build-ready"},"bundle":{"createUpdaterArtifacts":false}}'

ensure_notary_credentials() {
  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_NOTARY_PASSWORD}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    NOTARY_CREDENTIAL_MODE="apple_id"
    echo "Using Apple ID notarization credentials from environment."
    return
  fi

  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
    NOTARY_CREDENTIAL_MODE="api_key"
    echo "Using App Store Connect API notarization credentials from environment."
    return
  fi

  NOTARY_CREDENTIAL_MODE="keychain_profile"
  if /usr/bin/xcrun notarytool history \
    --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" >/dev/null 2>&1; then
    echo "Using stored notarytool profile: ${NOTARY_KEYCHAIN_PROFILE}"
    return
  fi

  cat >&2 <<EOF
Stored notarytool profile "${NOTARY_KEYCHAIN_PROFILE}" could not be verified during preflight.
The build will still submit with that profile so notarytool can report the real failure, if any.

Provide one of these credential sets:
  1. Stored notarytool profile named "${NOTARY_KEYCHAIN_PROFILE}"
     xcrun notarytool store-credentials "${NOTARY_KEYCHAIN_PROFILE}" --apple-id ... --team-id ... --password ...
  2. APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
     APPLE_ID_PASSWORD is also accepted as an APPLE_PASSWORD alias.
  3. APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PATH

APPLE_PASSWORD should be an app-specific password when using the APPLE_ID flow.
EOF
}

notary_submit_failed() {
  local credential_description="$1"

  cat >&2 <<EOF
Notarization submission failed using ${credential_description}.

Fix one of these credential paths, then rerun this script:
  1. Stored notarytool profile named "${NOTARY_KEYCHAIN_PROFILE}"
     xcrun notarytool store-credentials "${NOTARY_KEYCHAIN_PROFILE}" --apple-id ... --team-id ... --password ...
  2. APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
     APPLE_ID_PASSWORD is also accepted as an APPLE_PASSWORD alias.
  3. APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PATH
EOF
  exit 1
}

resolve_signing_identity() {
  if [[ -n "${SIGNING_IDENTITY}" ]]; then
    echo "Using Apple signing identity: ${SIGNING_IDENTITY}"
    return
  fi

  SIGNING_IDENTITY="$(
    /usr/bin/security find-identity -v -p codesigning 2>/dev/null \
      | /usr/bin/awk -F '"' '/Developer ID Application: / { print $2; exit }'
  )"

  if [[ -z "${SIGNING_IDENTITY}" ]]; then
    cat >&2 <<'EOF'
No "Developer ID Application" signing identity was found.

Apple Development and ad-hoc signing cannot be notarized. Install a Developer ID
Application certificate with its private key, or set APPLE_SIGNING_IDENTITY.
EOF
    exit 1
  fi

  echo "Using Apple signing identity: ${SIGNING_IDENTITY}"
}

submit_for_notarization() {
  local artifact_path="$1"

  case "${NOTARY_CREDENTIAL_MODE}" in
  keychain_profile)
    /usr/bin/xcrun notarytool submit "${artifact_path}" \
      --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" \
      --wait || notary_submit_failed "stored notarytool profile \"${NOTARY_KEYCHAIN_PROFILE}\""
    return
    ;;
  apple_id)
    /usr/bin/xcrun notarytool submit "${artifact_path}" \
      --apple-id "${APPLE_ID}" \
      --team-id "${APPLE_TEAM_ID}" \
      --password "${APPLE_NOTARY_PASSWORD}" \
      --wait || notary_submit_failed "Apple ID environment credentials"
    return
    ;;
  api_key)
    /usr/bin/xcrun notarytool submit "${artifact_path}" \
      --key "${APPLE_API_KEY_PATH}" \
      --key-id "${APPLE_API_KEY}" \
      --issuer "${APPLE_API_ISSUER}" \
      --wait || notary_submit_failed "App Store Connect API environment credentials"
    return
    ;;
  esac

  echo "Notarization credentials became unavailable before submit." >&2
  exit 1
}

sign_nested_macho_files() {
  local app_bundle_path="$1"
  local resource_root="${app_bundle_path}/Contents/Resources"
  local signed_count=0

  if [[ ! -d "${resource_root}" ]]; then
    return
  fi

  echo "Signing nested Mach-O files..."
  while IFS= read -r -d '' file_path; do
    if /usr/bin/file "${file_path}" | /usr/bin/grep -q "Mach-O"; then
      /usr/bin/codesign \
        --force \
        --options runtime \
        --timestamp \
        --sign "${SIGNING_IDENTITY}" \
        "${file_path}"
      signed_count=$((signed_count + 1))
    fi
  done < <(/usr/bin/find "${resource_root}" -type f -print0)

  echo "Signed nested Mach-O files: ${signed_count}"
}

sign_macho_files_in_tar_gz_archives() {
  local app_bundle_path="$1"
  local resource_root="${app_bundle_path}/Contents/Resources"
  local archive_path temp_dir signed_count archive_count
  signed_count=0
  archive_count=0

  if [[ ! -d "${resource_root}" ]]; then
    return
  fi

  echo "Signing Mach-O files inside bundled tar.gz archives..."
  while IFS= read -r -d '' archive_path; do
    temp_dir="$(/usr/bin/mktemp -d)"
    /usr/bin/tar -xzf "${archive_path}" -C "${temp_dir}"
    /usr/bin/find "${temp_dir}" \
      \( -name '._*' -o -name '__MACOSX' \) \
      -depth \
      -exec /bin/rm -rf {} +

    archive_signed_count=0
    while IFS= read -r -d '' file_path; do
      if /usr/bin/file "${file_path}" | /usr/bin/grep -q "Mach-O"; then
        /usr/bin/codesign \
          --force \
          --options runtime \
          --timestamp \
          --sign "${SIGNING_IDENTITY}" \
          "${file_path}"
        archive_signed_count=$((archive_signed_count + 1))
      fi
    done < <(/usr/bin/find "${temp_dir}" -type f -print0)

    if [[ "${archive_signed_count}" -gt 0 ]]; then
      /usr/bin/tar -czf "${archive_path}" -C "${temp_dir}" .
      archive_count=$((archive_count + 1))
      signed_count=$((signed_count + archive_signed_count))
    fi

    /bin/rm -rf "${temp_dir}"
  done < <(/usr/bin/find "${resource_root}" -type f \( -name '*.tar.gz' -o -name '*.tgz' \) -print0)

  echo "Signed Mach-O files inside archives: ${signed_count} across ${archive_count} archives"
}

notarize_built_app() {
  echo "Creating notarization archive..."
  /bin/rm -f "${NOTARY_ZIP_PATH}"
  /usr/bin/ditto -c -k --keepParent "${BUILT_APP_PATH}" "${NOTARY_ZIP_PATH}"

  echo "Submitting built app for notarization..."
  submit_for_notarization "${NOTARY_ZIP_PATH}"

  echo "Stapling notarization ticket to built app..."
  /usr/bin/xcrun stapler staple "${BUILT_APP_PATH}"
  /usr/bin/xcrun stapler validate "${BUILT_APP_PATH}"
  /usr/sbin/spctl -a -t execute -vv "${BUILT_APP_PATH}"
}

terminate_vox_jot_sidecars() {
  local pids=()
  local pid command cwd

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    command="$(/bin/ps -p "${pid}" -ww -o command= 2>/dev/null || true)"
    cwd="$(/usr/sbin/lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -n 1)"

    case "${command}" in
      *"mlx_audio.server"*|*"-m runtime.app"*|*"runtime/engine_worker.py"*)
        if [[ "${cwd}" == *"/Vox Jot/"* ]] || [[ "${cwd}" == *"/com.iriedinamik.voxjot/"* ]] || [[ "${command}" == *"/com.iriedinamik.voxjot/"* ]]; then
          pids+=("${pid}")
        fi
        ;;
    esac
  done < <(/usr/bin/pgrep -f "mlx_audio.server|-m runtime.app|runtime/engine_worker.py" 2>/dev/null || true)

  if [[ "${#pids[@]}" -eq 0 ]]; then
    return
  fi

  echo "Stopping Vox Jot speech sidecars: ${pids[*]}"
  /bin/kill "${pids[@]}" >/dev/null 2>&1 || true

  for _ in {1..10}; do
    local still_running=()
    for pid in "${pids[@]}"; do
      if /bin/kill -0 "${pid}" >/dev/null 2>&1; then
        still_running+=("${pid}")
      fi
    done
    if [[ "${#still_running[@]}" -eq 0 ]]; then
      return
    fi
    /bin/sleep 1
  done

  /bin/kill -9 "${pids[@]}" >/dev/null 2>&1 || true
}

ensure_notary_credentials
resolve_signing_identity
export APPLE_SIGNING_IDENTITY="${SIGNING_IDENTITY}"

echo "Closing running ${APP_NAME} instances..."
/usr/bin/osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
/usr/bin/pkill -x "vox_jot" >/dev/null 2>&1 || true
terminate_vox_jot_sidecars

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
sign_nested_macho_files "${BUILT_APP_PATH}"
sign_macho_files_in_tar_gz_archives "${BUILT_APP_PATH}"
/usr/bin/codesign \
  --force \
  --deep \
  --options runtime \
  --timestamp \
  --sign "${SIGNING_IDENTITY}" \
  --entitlements "${REPO_ROOT}/src-tauri/Entitlements.plist" \
  "${BUILT_APP_PATH}"

echo "Verifying built bundle signature..."
/usr/bin/codesign --verify --deep --strict "${BUILT_APP_PATH}"
notarize_built_app

if [[ -d "${APP_PATH}" ]]; then
  echo "Updating installed app in place..."
  /usr/bin/rsync -a --delete "${BUILT_APP_PATH}/" "${APP_PATH}/"
else
  echo "Installing app bundle..."
  /usr/bin/ditto "${BUILT_APP_PATH}" "${APP_PATH}"
fi

/usr/bin/xattr -cr "${APP_PATH}"
/usr/bin/codesign --verify --deep --strict "${APP_PATH}"
/usr/bin/xcrun stapler validate "${APP_PATH}"
/usr/sbin/spctl -a -t execute -vv "${APP_PATH}"

VERSION="$(/usr/bin/defaults read "${APP_PATH}/Contents/Info.plist" CFBundleShortVersionString)"
SIGNING_INFO="$(/usr/bin/codesign -dv --verbose=4 "${APP_PATH}" 2>&1)"

if ! /usr/bin/grep -Fq "${SIGNING_IDENTITY}" <<<"${SIGNING_INFO}"; then
  echo "Installed app is not signed with the expected Developer ID identity." >&2
  echo "${SIGNING_INFO}" >&2
  exit 1
fi

echo "Installed ${APP_NAME} ${VERSION} at ${APP_PATH}"
echo "Signing identity verified: ${SIGNING_IDENTITY}"
echo "Notarization verified and stapled."

echo "Opening installed app..."
/usr/bin/open -a "${APP_PATH}"
