#!/bin/bash
# Wrapper script for `cargo run` that re-signs the debug binary with a stable
# identifier before launching.  This ensures macOS Accessibility (TCC) grants
# persist across rebuilds.
#
# Used via .cargo/config.toml:
#   [target.aarch64-apple-darwin]
#   runner = "scripts/codesign-runner.sh"

BINARY="$1"
shift

codesign --force --sign - --identifier "com.iriedinamik.voxjot" "$BINARY" 2>/dev/null
exec "$BINARY" "$@"
