#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
APP_PATH="/Applications/${APP_NAME}.app"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Installed app not found at ${APP_PATH}." >&2
  echo "Run: bun run mac:update-installed-app" >&2
  exit 1
fi

echo "Opening installed ${APP_NAME} app at ${APP_PATH}..."
/usr/bin/open -a "${APP_PATH}"
