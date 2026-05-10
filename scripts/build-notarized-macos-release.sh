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
DMG_STAGE_DIR="${DMG_DIR}/${APP_NAME}-dmg-stage"
NOTARY_KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-voxjot-notary}"
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

ensure_notary_credentials() {
  local has_keychain_profile="false"
  local has_apple_id_flow="false"
  local has_api_key_flow="false"

  if /usr/bin/xcrun notarytool history \
    --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" >/dev/null 2>&1; then
    has_keychain_profile="true"
  fi

  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    has_apple_id_flow="true"
  fi

  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
    has_api_key_flow="true"
  fi

  if [[ "${has_keychain_profile}" != "true" && "${has_apple_id_flow}" != "true" && "${has_api_key_flow}" != "true" ]]; then
    cat >&2 <<'EOF'
Notarization credentials are missing.

Provide one of these credential sets:
  1. Stored notarytool profile named "voxjot-notary"
     xcrun notarytool store-credentials "voxjot-notary" --apple-id ... --team-id ... --password ...
  2. APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
  3. APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PATH

APPLE_PASSWORD should be a fresh app-specific password when using the APPLE_ID flow.
EOF
    exit 1
  fi
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

  if /usr/bin/xcrun notarytool history \
    --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" >/dev/null 2>&1; then
    /usr/bin/xcrun notarytool submit "${dmg_path}" \
      --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" \
      --wait
    return
  fi

  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    /usr/bin/xcrun notarytool submit "${dmg_path}" \
      --apple-id "${APPLE_ID}" \
      --team-id "${APPLE_TEAM_ID}" \
      --password "${APPLE_PASSWORD}" \
      --wait
    return
  fi

  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
    /usr/bin/xcrun notarytool submit "${dmg_path}" \
      --key "${APPLE_API_KEY_PATH}" \
      --key-id "${APPLE_API_KEY}" \
      --issuer "${APPLE_API_ISSUER}" \
      --wait
    return
  fi

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

create_signed_dmg() {
  /bin/rm -rf "${DMG_STAGE_DIR}" "${DMG_PATH}"
  /bin/mkdir -p "${DMG_STAGE_DIR}" "${DMG_DIR}"
  /usr/bin/ditto "${APP_PATH}" "${DMG_STAGE_DIR}/${APP_NAME}.app"
  /bin/ln -s /Applications "${DMG_STAGE_DIR}/Applications"

  /usr/bin/hdiutil create \
    -volname "${APP_NAME}" \
    -srcfolder "${DMG_STAGE_DIR}" \
    -ov \
    -format UDZO \
    "${DMG_PATH}"

  /bin/rm -rf "${DMG_STAGE_DIR}"

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
bun run tauri build --bundles app

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Expected app bundle not found at ${APP_PATH}" >&2
  exit 1
fi

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
