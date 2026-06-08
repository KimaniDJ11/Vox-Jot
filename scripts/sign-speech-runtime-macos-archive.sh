#!/usr/bin/env bash
set -euo pipefail

# Re-sign every Mach-O binary inside a bundled macOS speech-runtime archive with
# a Developer ID identity (hardened runtime + secure timestamp) and repack it, so
# the archive survives Apple notarization when shipped inside the Vox Jot app.
#
# Apple's notary service descends into bundled archives. Any Mach-O that is only
# adhoc-signed (for example a freshly built venv's pydantic_core .so or the venv
# python interpreters) causes notarization to fail with:
#   "The binary is not signed with a valid Developer ID certificate."
#   "The signature does not include a secure timestamp."
#
# Usage:
#   scripts/sign-speech-runtime-macos-archive.sh <archive.tar.gz> [<archive.tar.gz> ...]
#
# Identity resolution (first match wins):
#   1. APPLE_SIGNING_IDENTITY environment variable
#   2. First "Developer ID Application" identity in the default keychain

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTITLEMENTS_PATH="${REPO_ROOT}/src-tauri/Entitlements.plist"

if [[ "$#" -lt 1 ]]; then
  echo "Usage: $0 <archive.tar.gz> [<archive.tar.gz> ...]" >&2
  exit 1
fi

resolve_identity() {
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "${APPLE_SIGNING_IDENTITY}"
    return
  fi
  /usr/bin/security find-identity -v -p codesigning |
    /usr/bin/awk -F'"' '/Developer ID Application:/ { print $2; exit }'
}

SIGNING_IDENTITY="$(resolve_identity)"
if [[ -z "${SIGNING_IDENTITY}" ]]; then
  cat >&2 <<'EOF'
No "Developer ID Application" signing identity found.
Set APPLE_SIGNING_IDENTITY or install a Developer ID Application certificate.
EOF
  exit 1
fi
echo "Using signing identity: ${SIGNING_IDENTITY}"

sign_archive() {
  local archive="$1"

  if [[ ! -f "${archive}" ]]; then
    echo "Archive not found: ${archive}" >&2
    exit 1
  fi

  local work
  work="$(/usr/bin/mktemp -d "/tmp/voxjot-sign-runtime.XXXXXX")"
  # shellcheck disable=SC2064
  trap "/bin/rm -rf '${work}'" RETURN

  echo "==> ${archive}"
  /usr/bin/tar -xzf "${archive}" -C "${work}"

  if /usr/bin/find "${work}" -type l | /usr/bin/grep -q .; then
    echo "  archive contains symlinks (notarization-unsafe):" >&2
    /usr/bin/find "${work}" -type l -print >&2
    exit 1
  fi

  local signed=0 checked=0
  while IFS= read -r -d '' file_path; do
    if /usr/bin/file "${file_path}" | /usr/bin/grep -q "Mach-O"; then
      checked=$((checked + 1))
      /usr/bin/codesign \
        --force \
        --options runtime \
        --timestamp \
        --sign "${SIGNING_IDENTITY}" \
        --entitlements "${ENTITLEMENTS_PATH}" \
        "${file_path}"
      /usr/bin/codesign --verify --strict "${file_path}"
      signed=$((signed + 1))
    fi
  done < <(/usr/bin/find "${work}" -type f -print0)

  echo "  signed Mach-O files: ${signed} (scanned ${checked})"

  # Strip macOS metadata, then repack matching build-speech-runtime.sh layout.
  /usr/bin/find "${work}" \( -name '.DS_Store' -o -name '._*' -o -name '__MACOSX' \) -print0 |
    /usr/bin/xargs -0 /bin/rm -rf 2>/dev/null || true

  local tmp_out="${archive}.tmp.$$"
  COPYFILE_DISABLE=1 /usr/bin/tar -C "${work}" -czf "${tmp_out}" .
  /bin/mv "${tmp_out}" "${archive}"
  echo "  repacked: ${archive}"
}

for archive in "$@"; do
  sign_archive "${archive}"
done

echo "Done. Verify with: tar -xzf <archive> and 'codesign -dvv' on the Mach-O files."
