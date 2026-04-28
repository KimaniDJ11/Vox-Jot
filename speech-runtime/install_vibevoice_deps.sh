#!/usr/bin/env bash
set -euo pipefail
# Install Python deps needed for ../src-tauri VibeVoice TTS bridge (vibevoice_bridge.py).
# Run once after cloning / from repo root during dev:
#   (cd speech-runtime && ./install_vibevoice_deps.sh)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PY="${ROOT}/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
	echo "speech-runtime/.venv not found — create it first: python3 -m venv .venv" >&2
	exit 1
fi
"$PY" -m pip install -U pip
"$PY" -m pip install -r requirements.txt
"$PY" -m pip install -e "./vendor/VibeVoice[streamingtts]"
echo "VibeVoice deps installed (editable vibevoice + streamingtts transformers pin)."
