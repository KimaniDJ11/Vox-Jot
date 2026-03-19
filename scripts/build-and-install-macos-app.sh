#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
APP_PATH="/Applications/${APP_NAME}.app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILT_APP_PATH="${REPO_ROOT}/src-tauri/target/release/bundle/macos/${APP_NAME}.app"

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
  echo "Vox Jot is still running. Close it fully, then run this script again." >&2
  exit 1
fi

echo "Building fresh macOS bundle..."
cd "${REPO_ROOT}"
bun run tauri build

if [[ ! -d "${BUILT_APP_PATH}" ]]; then
  echo "Built app bundle not found at ${BUILT_APP_PATH}" >&2
  exit 1
fi

echo "Removing old installed app and leftover backups..."
/bin/rm -rf "${APP_PATH}"
/usr/bin/find /Applications -maxdepth 1 -name "${APP_NAME}.app.previous-*" -prune -exec /bin/rm -rf {} +

echo "Installing fresh app bundle..."
/usr/bin/ditto "${BUILT_APP_PATH}" "${APP_PATH}"
/usr/bin/xattr -cr "${APP_PATH}"
/usr/bin/codesign --verify --deep "${APP_PATH}"

VERSION="$(/usr/bin/defaults read "${APP_PATH}/Contents/Info.plist" CFBundleShortVersionString)"

cat <<EOF
Installed ${APP_NAME} ${VERSION} at:
${APP_PATH}

macOS permissions note:
- Accessibility and Input Monitoring still require user approval.
- If System Settings shows an older Vox Jot entry, remove it and enable /Applications/Vox Jot.app.
- Input Monitoring lives in System Settings > Privacy & Security > Input Monitoring.
- Accessibility lives in System Settings > Privacy & Security > Accessibility.
EOF
