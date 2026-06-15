#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${CARGO_TARGET_DIR:-${REPO_ROOT}/.local-targets/vox-jot}"
BUILD_PROFILE="release"
BUNDLE_ROOT="${TARGET_ROOT}/${BUILD_PROFILE}/bundle"
APP_PATH="${BUNDLE_ROOT}/macos/${APP_NAME}.app"
DMG_DIR="${BUNDLE_ROOT}/dmg"
APP_VERSION="$(/usr/bin/awk -F\" '/"version"/ { print $4; exit }' "${REPO_ROOT}/src-tauri/tauri.conf.json")"
TARGET_ARCH="$(/usr/bin/arch)"
if [[ "${TARGET_ARCH}" == "arm64" ]]; then
  TARGET_ARCH="aarch64"
fi
DMG_PATH="${DMG_DIR}/${APP_NAME}_${APP_VERSION}_${TARGET_ARCH}.dmg"
DMG_RW_PATH="${DMG_DIR}/${APP_NAME}_${APP_VERSION}_${TARGET_ARCH}-rw.dmg"
DMG_STAGE_DIR="${DMG_DIR}/${APP_NAME}-dmg-stage"
DMG_BACKGROUND_SOURCE="${REPO_ROOT}/src-tauri/dmg/vox-jot-dmg-background.tiff"
DMG_BACKGROUND_NAME="vox-jot-dmg-background.tiff"
DMG_WINDOW_WIDTH=760
DMG_WINDOW_HEIGHT=520
DMG_APP_ICON_X=217
DMG_APP_ICON_Y=348
DMG_APPLICATIONS_ICON_X=580
DMG_APPLICATIONS_ICON_Y=348
NOTARY_KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-voxjot-notary}"
APPLE_NOTARY_PASSWORD="${APPLE_PASSWORD:-${APPLE_ID_PASSWORD:-}}"
NOTARY_CREDENTIAL_MODE=""
KEYCHAIN_PASSWORD="${KEYCHAIN_PASSWORD:-$(/usr/bin/openssl rand -hex 24)}"
KEYCHAIN_NAME="vox-jot-build.keychain-db"
KEYCHAIN_PATH="${HOME}/Library/Keychains/${KEYCHAIN_NAME}"
CERT_FILE=""
ORIGINAL_DEFAULT_KEYCHAIN="$(
  /usr/bin/security default-keychain -d user | tr -d '"'
)"

cleanup() {
  set +e
  if [[ -n "${ORIGINAL_DEFAULT_KEYCHAIN}" ]]; then
    /usr/bin/security default-keychain -d user -s "${ORIGINAL_DEFAULT_KEYCHAIN}" >/dev/null 2>&1
  fi
  /usr/bin/security delete-keychain "${KEYCHAIN_NAME}" >/dev/null 2>&1 || true
  [[ -n "${CERT_FILE}" && -f "${CERT_FILE}" ]] && /bin/rm -f "${CERT_FILE}"
}
trap cleanup EXIT

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

notary_preflight_failed() {
  local credential_description="$1"
  local detail="${2:-}"

  cat >&2 <<EOF
Notarization credential preflight failed for ${credential_description}.

Fix one of these credential paths before building the macOS app:
  1. Stored notarytool profile named "${NOTARY_KEYCHAIN_PROFILE}"
     xcrun notarytool store-credentials "${NOTARY_KEYCHAIN_PROFILE}" --apple-id ... --team-id ... --password ...
     or run: bun run mac:setup-notary
  2. APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
     APPLE_ID_PASSWORD is also accepted as an APPLE_PASSWORD alias.
  3. APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PATH

APPLE_PASSWORD should be an app-specific password when using the APPLE_ID flow.
EOF

  if [[ -n "${detail}" ]]; then
    echo "${detail}" >&2
  fi

  exit 1
}

verify_keychain_notary_profile() {
  local history_output latest_submission_id info_output

  if ! history_output="$(
    /usr/bin/xcrun notarytool history \
      --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" 2>&1
  )"; then
    notary_preflight_failed \
      "stored notarytool profile \"${NOTARY_KEYCHAIN_PROFILE}\"" \
      "${history_output}"
  fi

  latest_submission_id="$(
    /usr/bin/awk '/^[[:space:]]*id: / { print $2; exit }' <<<"${history_output}"
  )"

  if [[ -n "${latest_submission_id}" ]]; then
    if ! info_output="$(
      /usr/bin/xcrun notarytool info "${latest_submission_id}" \
        --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" 2>&1
    )"; then
      notary_preflight_failed \
        "stored notarytool profile \"${NOTARY_KEYCHAIN_PROFILE}\"" \
        "${info_output}"
    fi
  fi
}

verify_notary_credentials() {
  case "${NOTARY_CREDENTIAL_MODE}" in
  keychain_profile)
    verify_keychain_notary_profile
    ;;
  apple_id)
    if ! /usr/bin/xcrun notarytool history \
      --apple-id "${APPLE_ID}" \
      --team-id "${APPLE_TEAM_ID}" \
      --password "${APPLE_NOTARY_PASSWORD}" >/dev/null 2>&1; then
      notary_preflight_failed "Apple ID environment credentials"
    fi
    ;;
  api_key)
    if ! /usr/bin/xcrun notarytool history \
      --key "${APPLE_API_KEY_PATH}" \
      --key-id "${APPLE_API_KEY}" \
      --issuer "${APPLE_API_ISSUER}" >/dev/null 2>&1; then
      notary_preflight_failed "App Store Connect API environment credentials"
    fi
    ;;
  *)
    notary_preflight_failed "unknown notarization credential mode"
    ;;
  esac
}

ensure_notary_credentials() {
  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_NOTARY_PASSWORD}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    NOTARY_CREDENTIAL_MODE="apple_id"
    echo "Using Apple ID notarization credentials from environment."
    verify_notary_credentials
    return
  fi

  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
    NOTARY_CREDENTIAL_MODE="api_key"
    echo "Using App Store Connect API notarization credentials from environment."
    verify_notary_credentials
    return
  fi

  NOTARY_CREDENTIAL_MODE="keychain_profile"
  verify_notary_credentials
  echo "Using stored notarytool profile: ${NOTARY_KEYCHAIN_PROFILE}"
}

notary_submit_failed() {
  local credential_description="$1"

  cat >&2 <<EOF
Notarization submission failed using ${credential_description}.

Fix one of these credential paths, then rerun this script:
  1. Stored notarytool profile named "${NOTARY_KEYCHAIN_PROFILE}"
     xcrun notarytool store-credentials "${NOTARY_KEYCHAIN_PROFILE}" --apple-id ... --team-id ... --password ...
     or run: bun run mac:setup-notary
  2. APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
     APPLE_ID_PASSWORD is also accepted as an APPLE_PASSWORD alias.
  3. APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PATH
EOF
  exit 1
}

import_certificate() {
  if [[ -n "${APPLE_CERTIFICATE_PATH:-}" ]]; then
    CERT_FILE="${APPLE_CERTIFICATE_PATH}"
  else
    require_env "APPLE_CERTIFICATE"
    CERT_FILE="$(/usr/bin/mktemp -t vox-jot-cert).p12"
    /bin/echo "${APPLE_CERTIFICATE}" | /usr/bin/base64 --decode > "${CERT_FILE}"
  fi

  require_env "APPLE_CERTIFICATE_PASSWORD"

  /usr/bin/security create-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_NAME}"
  /usr/bin/security set-keychain-settings -lut 21600 "${KEYCHAIN_NAME}"
  /usr/bin/security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_NAME}"
  /usr/bin/security import "${CERT_FILE}" \
    -k "${KEYCHAIN_PATH}" \
    -P "${APPLE_CERTIFICATE_PASSWORD}" \
    -T /usr/bin/codesign \
    -T /usr/bin/security
  /usr/bin/security set-key-partition-list \
    -S apple-tool:,apple:,codesign: \
    -s \
    -k "${KEYCHAIN_PASSWORD}" \
    "${KEYCHAIN_NAME}"
  /usr/bin/security list-keychains -d user -s "${KEYCHAIN_PATH}" "${ORIGINAL_DEFAULT_KEYCHAIN}"
  /usr/bin/security default-keychain -d user -s "${KEYCHAIN_PATH}"

  local identity
  identity="$(
    /usr/bin/security find-identity -v -p codesigning "${KEYCHAIN_PATH}" |
      /usr/bin/awk -F'"' '/Developer ID Application:/ { print $2; exit }'
  )"

  if [[ -z "${identity}" ]]; then
    cat >&2 <<'EOF'
No "Developer ID Application" signing identity was found in the imported certificate.

An Apple Development certificate is not enough for notarized distribution.
Export a Developer ID Application certificate as a .p12 and provide it via:
  APPLE_CERTIFICATE_PATH=/path/to/certificate.p12
or
  APPLE_CERTIFICATE=<base64-p12>
EOF
    exit 1
  fi

  export APPLE_SIGNING_IDENTITY="${identity}"
  echo "Using Apple signing identity: ${APPLE_SIGNING_IDENTITY}"
}

resolve_signing_identity() {
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "Using Apple signing identity: ${APPLE_SIGNING_IDENTITY}"
    return
  fi

  if [[ -n "${APPLE_CERTIFICATE_PATH:-}" || -n "${APPLE_CERTIFICATE:-}" ]]; then
    import_certificate
    return
  fi

  local identity
  identity="$(
    /usr/bin/security find-identity -v -p codesigning |
      /usr/bin/awk -F'"' '/Developer ID Application:/ { print $2; exit }'
  )"

  if [[ -z "${identity}" ]]; then
    cat >&2 <<'EOF'
No "Developer ID Application" signing identity was found in the default keychain.

Install a Developer ID Application certificate with its private key, or provide:
  APPLE_CERTIFICATE_PATH=/path/to/certificate.p12
  APPLE_CERTIFICATE_PASSWORD=...
EOF
    exit 1
  fi

  export APPLE_SIGNING_IDENTITY="${identity}"
  echo "Using Apple signing identity: ${APPLE_SIGNING_IDENTITY}"
}

submit_for_notarization() {
  local dmg_path="$1"

  case "${NOTARY_CREDENTIAL_MODE}" in
  keychain_profile)
    /usr/bin/xcrun notarytool submit "${dmg_path}" \
      --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" \
      --wait || notary_submit_failed "stored notarytool profile \"${NOTARY_KEYCHAIN_PROFILE}\""
    return
    ;;
  apple_id)
    /usr/bin/xcrun notarytool submit "${dmg_path}" \
      --apple-id "${APPLE_ID}" \
      --team-id "${APPLE_TEAM_ID}" \
      --password "${APPLE_NOTARY_PASSWORD}" \
      --wait || notary_submit_failed "Apple ID environment credentials"
    return
    ;;
  api_key)
    /usr/bin/xcrun notarytool submit "${dmg_path}" \
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
  local signed_count=0
  local resource_root="${APP_PATH}/Contents/Resources"

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
        --sign "${APPLE_SIGNING_IDENTITY}" \
        "${file_path}"
      signed_count=$((signed_count + 1))
    fi
  done < <(/usr/bin/find "${resource_root}" -type f -print0)

  echo "Signed nested Mach-O files: ${signed_count}"
}

fix_generated_macos_info_plist() {
  local info_plist="${APP_PATH}/Contents/Info.plist"

  if [[ ! -f "${info_plist}" ]]; then
    echo "Info.plist not found at ${info_plist}" >&2
    exit 1
  fi

  if /usr/libexec/PlistBuddy -c "Print :LSRequiresCarbon" "${info_plist}" >/dev/null 2>&1; then
    echo "Removing generated LSRequiresCarbon from ${info_plist}..."
    /usr/libexec/PlistBuddy -c "Delete :LSRequiresCarbon" "${info_plist}"
  fi
}

create_signed_dmg() {
  local mount_output mount_dir

  if [[ ! -f "${DMG_BACKGROUND_SOURCE}" ]]; then
    echo "DMG background missing; generating ${DMG_BACKGROUND_SOURCE}..."
    bash "${REPO_ROOT}/scripts/generate-dmg-background.sh"
  fi

  /bin/rm -rf "${DMG_STAGE_DIR}" "${DMG_PATH}" "${DMG_RW_PATH}"
  /bin/mkdir -p "${DMG_STAGE_DIR}" "${DMG_DIR}"
  /usr/bin/ditto "${APP_PATH}" "${DMG_STAGE_DIR}/${APP_NAME}.app"
  /bin/mkdir -p "${DMG_STAGE_DIR}/.background"
  /usr/bin/ditto "${DMG_BACKGROUND_SOURCE}" "${DMG_STAGE_DIR}/.background/${DMG_BACKGROUND_NAME}"
  /usr/bin/chflags hidden "${DMG_STAGE_DIR}/.background" || true
  /bin/ln -s /Applications "${DMG_STAGE_DIR}/Applications"

  /usr/bin/hdiutil create \
    -volname "${APP_NAME}" \
    -srcfolder "${DMG_STAGE_DIR}" \
    -ov \
    -format UDRW \
    -fs HFS+ \
    "${DMG_RW_PATH}"

  mount_output="$(
    /usr/bin/hdiutil attach \
      -readwrite \
      -noverify \
      -noautoopen \
      "${DMG_RW_PATH}"
  )"
  mount_dir="$(
    /usr/bin/awk -F '\t' '/\/Volumes\// { print $NF; exit }' <<<"${mount_output}"
  )"

  if [[ -z "${mount_dir}" || ! -d "${mount_dir}" ]]; then
    echo "Unable to locate mounted DMG volume for Finder styling." >&2
    echo "${mount_output}" >&2
    exit 1
  fi

  if ! /usr/bin/osascript <<OSA
tell application "Finder"
  tell disk "${APP_NAME}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {120, 90, 120 + ${DMG_WINDOW_WIDTH}, 90 + ${DMG_WINDOW_HEIGHT}}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set text size of viewOptions to 14
    set background picture of viewOptions to file ".background:${DMG_BACKGROUND_NAME}"
    set position of item "${APP_NAME}.app" of container window to {${DMG_APP_ICON_X}, ${DMG_APP_ICON_Y}}
    set position of item "Applications" of container window to {${DMG_APPLICATIONS_ICON_X}, ${DMG_APPLICATIONS_ICON_Y}}
    update without registering applications
    delay 1
    close container window
  end tell
end tell
OSA
  then
    /usr/bin/hdiutil detach "${mount_dir}" -quiet || true
    exit 1
  fi

  /bin/sync
  /usr/bin/hdiutil detach "${mount_dir}" -quiet
  /usr/bin/hdiutil convert "${DMG_RW_PATH}" \
    -format UDZO \
    -imagekey zlib-level=9 \
    -o "${DMG_PATH}"

  /bin/rm -rf "${DMG_STAGE_DIR}" "${DMG_RW_PATH}"

  /usr/bin/codesign \
    --force \
    --timestamp \
    --sign "${APPLE_SIGNING_IDENTITY}" \
    "${DMG_PATH}"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "${DMG_PATH}"
}

ensure_notary_credentials
resolve_signing_identity

export CARGO_TARGET_DIR="${TARGET_ROOT}"

echo "Building notarized macOS release for ${APP_NAME}..."
echo "Using cargo target dir: ${CARGO_TARGET_DIR}"

cd "${REPO_ROOT}"
env \
  -u APPLE_API_KEY \
  -u APPLE_API_KEY_ID \
  -u APPLE_API_ISSUER \
  -u APPLE_API_KEY_PATH \
  -u APPLE_ID \
  -u APPLE_PASSWORD \
  -u APPLE_ID_PASSWORD \
  -u APPLE_TEAM_ID \
  bun run tauri build --bundles app

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Expected app bundle not found at ${APP_PATH}" >&2
  exit 1
fi

fix_generated_macos_info_plist
sign_nested_macho_files
/usr/bin/codesign \
  --force \
  --deep \
  --options runtime \
  --timestamp \
  --sign "${APPLE_SIGNING_IDENTITY}" \
  --entitlements "${REPO_ROOT}/src-tauri/Entitlements.plist" \
  "${APP_PATH}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
create_signed_dmg

echo "Submitting DMG for notarization: ${DMG_PATH}"
submit_for_notarization "${DMG_PATH}"

echo "Stapling notarization ticket..."
/usr/bin/xcrun stapler staple "${DMG_PATH}"
/usr/bin/xcrun stapler validate "${DMG_PATH}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${DMG_PATH}"
/usr/sbin/spctl -a -t open --context context:primary-signature -v "${DMG_PATH}"

echo
echo "Notarized macOS artifacts:"
echo "  App: ${APP_PATH}"
echo "  DMG: ${DMG_PATH}"
