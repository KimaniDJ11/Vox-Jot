#!/bin/bash
# Wrapper script for `cargo run` that re-signs the debug binary with a stable
# identifier before launching. This keeps macOS Accessibility (TCC) grants and
# Keychain access prompts stable across rebuilds.
#
# Used via .cargo/config.toml:
#   [target.aarch64-apple-darwin]
#   runner = "scripts/codesign-runner.sh"

# `-e` is deliberately omitted: re-signing is best-effort and a codesign failure
# must still let the binary run. Everything else is strict.
set -uo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: codesign-runner.sh <binary> [args...]" >&2
  exit 64
fi

BINARY="$1"
shift

SIGN_IDENTIFIER="${VOX_JOT_CODESIGN_IDENTIFIER:-com.iriedinamik.voxjot}"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTITLEMENTS_PATH="${REPO_ROOT}/src-tauri/Entitlements.plist"

if [[ -z "${SIGNING_IDENTITY}" ]]; then
  SIGNING_IDENTITY="$(
    /usr/bin/security find-identity -v -p codesigning 2>/dev/null \
      | /usr/bin/awk -F '"' '/Apple Development: / { print $2; exit }'
  )"
fi

if [[ -n "${SIGNING_IDENTITY}" ]]; then
  CODESIGN_ARGS=(
    --force
    --sign "${SIGNING_IDENTITY}"
    --identifier "${SIGN_IDENTIFIER}"
  )

  if [[ -f "${ENTITLEMENTS_PATH}" ]]; then
    CODESIGN_ARGS+=(--entitlements "${ENTITLEMENTS_PATH}")
  fi

  /usr/bin/codesign "${CODESIGN_ARGS[@]}" "${BINARY}" 2>/dev/null
else
  /usr/bin/codesign --force --sign - --identifier "${SIGN_IDENTIFIER}" "${BINARY}" 2>/dev/null
fi

exec "$BINARY" "$@"
