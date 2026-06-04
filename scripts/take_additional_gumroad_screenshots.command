#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SCREENSHOT_SKILL_DIR="${CODEX_SCREENSHOT_SKILL_DIR:-${HOME}/.codex/skills/screenshot}"
PERMISSIONS_SCRIPT="${SCREENSHOT_SKILL_DIR}/scripts/ensure_macos_permissions.sh"

cd "${REPO_DIR}"

if [[ -x "${PERMISSIONS_SCRIPT}" ]]; then
  bash "${PERMISSIONS_SCRIPT}" --request || true
fi

python3 "${REPO_DIR}/scripts/take_additional_gumroad_screenshots.py"
open "${REPO_DIR}/output/gumroad-screenshots-additional"
