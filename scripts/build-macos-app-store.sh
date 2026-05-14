#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${CARGO_TARGET_DIR:-${REPO_ROOT}/.local-targets/vox-jot-app-store}"
TARGET="${APP_STORE_TARGET:-aarch64-apple-darwin}"
PROFILE_PATH="${APP_STORE_PROVISION_PROFILE_PATH:-${REPO_ROOT}/src-tauri/profiles/VoxJot-AppStore.provisionprofile}"
APP_SIGNING_IDENTITY="${APPLE_APP_STORE_SIGNING_IDENTITY:-Apple Distribution: Kimani James (NS5M2UJLKP)}"
INSTALLER_SIGNING_IDENTITY="${APPLE_INSTALLER_SIGNING_IDENTITY:-}"
API_KEY_ID="${APPLE_API_KEY_ID:-${APPLE_API_KEY:-}}"
API_ISSUER="${APPLE_API_ISSUER:-}"
UPLOAD="${UPLOAD_APP_STORE_PKG:-false}"

case "${TARGET}" in
  universal-apple-darwin)
    BUNDLE_ROOT="${TARGET_ROOT}/universal-apple-darwin/release/bundle"
    ;;
  aarch64-apple-darwin)
    BUNDLE_ROOT="${TARGET_ROOT}/aarch64-apple-darwin/release/bundle"
    ;;
  *)
    BUNDLE_ROOT="${TARGET_ROOT}/release/bundle"
    ;;
esac

APP_PATH="${BUNDLE_ROOT}/macos/${APP_NAME}.app"
PKG_DIR="${BUNDLE_ROOT}/pkg"
PKG_PATH="${PKG_DIR}/${APP_NAME// /-}-AppStore.pkg"

require_file() {
  local path="$1"
  local message="$2"
  if [[ ! -f "${path}" ]]; then
    echo "${message}" >&2
    exit 1
  fi
}

auto_detect_installer_identity() {
  /usr/bin/security find-identity -v -p codesigning |
    /usr/bin/awk -F'"' '
      /3rd Party Mac Developer Installer:/ { print $2; found=1; exit }
      /Mac Installer Distribution:/ { print $2; found=1; exit }
      END { if (!found) exit 1 }
    '
}

require_codesigning_identity() {
  local identity="$1"
  local label="$2"

  if ! /usr/bin/security find-identity -v -p codesigning | /usr/bin/grep -F "\"${identity}\"" >/dev/null; then
    echo "Missing ${label} signing identity: ${identity}" >&2
    exit 1
  fi
}

require_file "${PROFILE_PATH}" "Missing Mac App Store Connect provisioning profile: ${PROFILE_PATH}"
require_codesigning_identity "${APP_SIGNING_IDENTITY}" "App Store app"

if [[ -z "${INSTALLER_SIGNING_IDENTITY}" ]]; then
  if ! INSTALLER_SIGNING_IDENTITY="$(auto_detect_installer_identity)"; then
    cat >&2 <<'EOF'
Missing Mac App Store installer signing identity.

Install a "3rd Party Mac Developer Installer" / "Mac Installer Distribution" certificate,
or set APPLE_INSTALLER_SIGNING_IDENTITY explicitly.
EOF
    exit 1
  fi
fi

echo "Auditing App Store configuration..."
cd "${REPO_ROOT}"
bun scripts/audit-app-store-readiness.ts

export CARGO_TARGET_DIR="${TARGET_ROOT}"
export VOX_JOT_DISTRIBUTION="app-store"
export VITE_VOX_JOT_DISTRIBUTION="app-store"
export APPLE_SIGNING_IDENTITY="${APP_SIGNING_IDENTITY}"

echo "Building App Store binary for ${TARGET}..."
bun run tauri build --no-bundle --target "${TARGET}" --config src-tauri/tauri.appstore.conf.json

echo "Bundling App Store app..."
bun run tauri bundle --bundles app --target "${TARGET}" --config src-tauri/tauri.appstore.conf.json

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Expected App Store app bundle not found at ${APP_PATH}" >&2
  exit 1
fi

/usr/bin/codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
/usr/bin/codesign -d --entitlements :- "${APP_PATH}" >/tmp/vox-jot-app-store-entitlements.plist

if ! /usr/bin/grep -q "com.apple.security.app-sandbox" /tmp/vox-jot-app-store-entitlements.plist; then
  echo "Built app is missing App Sandbox entitlement." >&2
  exit 1
fi

/bin/mkdir -p "${PKG_DIR}"
/bin/rm -f "${PKG_PATH}"

echo "Creating App Store upload package..."
/usr/bin/xcrun productbuild \
  --sign "${INSTALLER_SIGNING_IDENTITY}" \
  --component "${APP_PATH}" \
  /Applications \
  "${PKG_PATH}"

echo "Validating package with App Store Connect tooling..."
if [[ -n "${API_KEY_ID}" && -n "${API_ISSUER}" ]]; then
  /usr/bin/xcrun altool --validate-app --type macos --file "${PKG_PATH}" --apiKey "${API_KEY_ID}" --apiIssuer "${API_ISSUER}"

  if [[ "${UPLOAD}" == "true" ]]; then
    /usr/bin/xcrun altool --upload-app --type macos --file "${PKG_PATH}" --apiKey "${API_KEY_ID}" --apiIssuer "${API_ISSUER}"
  fi
else
  echo "Skipping App Store Connect validation/upload: APPLE_API_KEY_ID and APPLE_API_ISSUER are not both set."
fi

echo
echo "App Store artifacts:"
echo "  App: ${APP_PATH}"
echo "  PKG: ${PKG_PATH}"
