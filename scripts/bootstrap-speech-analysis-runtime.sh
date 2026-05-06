#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3.11}"

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "${PYTHON_BIN} is required for the speech-analysis runtime." >&2
  exit 1
fi

"${PYTHON_BIN}" -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/python" -m pip install --upgrade pip setuptools wheel
"${VENV_DIR}/bin/python" -m pip install -r "${ROOT_DIR}/speech-analysis-requirements.txt"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to install the ONNX diarization runtime (polyvoice)." >&2
  exit 1
fi

cargo install polyvoice --version 0.5.2 --locked --features cli
"${HOME}/.cargo/bin/polyvoice" download-models \
  --dir "${ROOT_DIR}/src-tauri/resources/models/polyvoice"

"${VENV_DIR}/bin/python" "${ROOT_DIR}/scripts/validate_speech_analysis_models.py" \
  --output "${ROOT_DIR}/reports/speech-analysis-validation.json"
