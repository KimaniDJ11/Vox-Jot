#!/usr/bin/env bash

set -euo pipefail

NOTARY_KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-voxjot-notary}"
DEFAULT_TEAM_ID="${APPLE_TEAM_ID:-NS5M2UJLKP}"
# Store into the login keychain explicitly. Without this, `store-credentials`
# can fail noninteractively with "User interaction is not allowed".
LOGIN_KEYCHAIN="${NOTARY_KEYCHAIN_PATH:-$HOME/Library/Keychains/login.keychain-db}"

if ! /usr/bin/xcrun notarytool --version >/dev/null 2>&1; then
  echo "xcrun notarytool is unavailable. Install Xcode Command Line Tools first." >&2
  exit 1
fi

cat <<EOF
This stores Apple notarization credentials in your macOS Keychain for profile:
  ${NOTARY_KEYCHAIN_PROFILE}

Use an Apple app-specific password, not your normal Apple ID password.
Non-interactive: set APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD.
EOF

# Prefer env vars (agent / CI friendly); fall back to interactive prompts.
APPLE_ID_EMAIL="${APPLE_ID:-}"
if [[ -z "${APPLE_ID_EMAIL}" ]]; then
  read -r -p "Apple ID email: " APPLE_ID_EMAIL
fi

TEAM_ID="${APPLE_TEAM_ID:-}"
if [[ -z "${TEAM_ID}" ]]; then
  read -r -p "Apple Team ID [${DEFAULT_TEAM_ID}]: " TEAM_ID
fi
TEAM_ID="${TEAM_ID:-${DEFAULT_TEAM_ID}}"

APP_SPECIFIC_PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-}"

if [[ -z "${APPLE_ID_EMAIL}" || -z "${TEAM_ID}" ]]; then
  echo "Apple ID email and Team ID are required." >&2
  exit 1
fi

if [[ -n "${APP_SPECIFIC_PASSWORD}" ]]; then
  # Non-interactive path only. notarytool has no stdin option for the password,
  # so it has to go through argv here; it is briefly visible in the local
  # process list. Prefer the interactive path below on a shared machine.
  /usr/bin/xcrun notarytool store-credentials "${NOTARY_KEYCHAIN_PROFILE}" \
    --apple-id "${APPLE_ID_EMAIL}" \
    --team-id "${TEAM_ID}" \
    --password "${APP_SPECIFIC_PASSWORD}" \
    --keychain "${LOGIN_KEYCHAIN}"
else
  # With Apple ID and Team ID supplied and --password omitted, notarytool gives
  # its own secure prompt, so the password never enters argv or a shell variable.
  echo "No APPLE_APP_SPECIFIC_PASSWORD set; notarytool will prompt securely."
  /usr/bin/xcrun notarytool store-credentials "${NOTARY_KEYCHAIN_PROFILE}" \
    --apple-id "${APPLE_ID_EMAIL}" \
    --team-id "${TEAM_ID}" \
    --keychain "${LOGIN_KEYCHAIN}"
fi

echo "Verifying stored notarytool profile..."
/usr/bin/xcrun notarytool history \
  --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" >/dev/null

echo "Stored and verified notarytool profile: ${NOTARY_KEYCHAIN_PROFILE}"
