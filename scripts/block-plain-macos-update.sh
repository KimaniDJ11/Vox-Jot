#!/usr/bin/env bash

set -euo pipefail

ATTEMPTED_COMMAND="${1:-plain macOS update command}"

cat >&2 <<EOF
Blocked: ${ATTEMPTED_COMMAND} is intentionally disabled for all agents.

Use an explicit notarized installed-app update command:
  bun run mac:update-installed-app:notarized
  bun run mac:update:notarized

The notarized update workflow Developer ID signs, submits to Apple notarization,
staples, Gatekeeper-validates, replaces /Applications/Vox Jot.app, and opens the
installed app. Do not re-enable or bypass the plain macOS update aliases.
EOF

exit 1
