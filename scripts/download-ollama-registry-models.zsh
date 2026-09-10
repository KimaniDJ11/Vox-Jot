#!/bin/zsh
set -euo pipefail

EXTERNAL_ROOT="/Volumes/AI Storage/Apps/Models/VoxJot/provider-models/ollama/models"
LOG_DIR="${VOX_JOT_DOWNLOAD_LOG_DIR:-$HOME/Apps/Vox Jot/output/model-downloads}"

if [[ ! -d "$EXTERNAL_ROOT" ]]; then
  echo "Error: External model storage root $EXTERNAL_ROOT not found. Is /Volumes/AI Storage mounted?" >&2
  exit 1
fi

# Ensure ~/.ollama/models points to external drive
CURRENT_LINK="$(readlink "$HOME/.ollama/models" || true)"
if [[ "$CURRENT_LINK" != "$EXTERNAL_ROOT" ]]; then
  echo "Linking ~/.ollama/models -> $EXTERNAL_ROOT"
  if [[ -e "$HOME/.ollama/models" && ! -L "$HOME/.ollama/models" ]]; then
    mv "$HOME/.ollama/models" "$HOME/.ollama/models.bak.$(date +%s)"
  else
    rm -f "$HOME/.ollama/models"
  fi
  ln -s "$EXTERNAL_ROOT" "$HOME/.ollama/models"
fi

# Check if Ollama is running
if ! curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama server not responding on 127.0.0.1:11434. Starting Ollama..."
  open -a Ollama || true
  sleep 4
  if ! curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "Error: Could not connect to Ollama server." >&2
    exit 1
  fi
fi

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ollama-registry-download-$(date +%Y%m%d-%H%M%S).log"
STATUS_FILE="$LOG_DIR/ollama-registry-download-status.tsv"

echo "Log: $LOG_FILE"
echo "Status: $STATUS_FILE"

exec >> "$LOG_FILE" 2>&1

echo "========================================================"
echo "Starting Ollama registry model downloads at $(date)"
echo "Target directory: $EXTERNAL_ROOT"
echo "========================================================"

if [[ ! -f "$STATUS_FILE" ]]; then
  echo "model_id	status	size_hint	timestamp" > "$STATUS_FILE"
fi

pull_model() {
  local model_id="$1"
  local size_hint="$2"

  # Check if already installed
  if ollama list 2>/dev/null | awk '{print $1}' | grep -Fxq "$model_id"; then
    echo "[$(date)] ALREADY INSTALLED: $model_id ($size_hint)"
    echo "$model_id	already_installed	$size_hint	$(date -Iseconds)" >> "$STATUS_FILE"
    return 0
  fi

  echo
  echo "--------------------------------------------------------"
  echo "[$(date)] STARTING PULL: $model_id ($size_hint)"
  echo "--------------------------------------------------------"
  echo "$model_id	started	$size_hint	$(date -Iseconds)" >> "$STATUS_FILE"

  local exit_code=0
  ollama pull "$model_id" || exit_code=$?

  if [[ "$exit_code" -eq 0 ]]; then
    echo "[$(date)] SUCCESS: $model_id"
    echo "$model_id	done	$size_hint	$(date -Iseconds)" >> "$STATUS_FILE"
  else
    echo "[$(date)] FAILED: $model_id (exit code $exit_code)"
    echo "$model_id	failed:$exit_code	$size_hint	$(date -Iseconds)" >> "$STATUS_FILE"
  fi
}

# Queue of models from Ollama registry (ordered from smallest to largest)
pull_model "smollm2:135m" "~0.2 GB"
pull_model "smollm2:360m" "~0.4 GB"
pull_model "qwen2.5:0.5b" "~0.4 GB"
pull_model "tinydolphin:1.1b" "~0.6 GB"
pull_model "falcon3:1b" "~0.7 GB"
pull_model "tinyllama:1.1b" "~0.7 GB"
pull_model "granite3.1-moe:1b" "~0.9 GB"
pull_model "deepseek-coder:1.3b" "~1.0 GB"
pull_model "qwen2.5:1.5b" "~1.0 GB"
pull_model "qwen2.5-coder:1.5b" "~1.0 GB"
pull_model "deepseek-r1:1.5b" "~1.1 GB"
pull_model "smollm2:1.7b" "~1.1 GB"
pull_model "llama3.2:1b" "~1.3 GB"
pull_model "granite3.1-dense:2b" "~1.6 GB"
pull_model "gemma2:2b" "~1.6 GB"
pull_model "openbmb/minicpm5-2b" "~1.6 GB"
pull_model "codegemma:2b" "~1.6 GB"
pull_model "llama3.2:3b" "~2.0 GB"
pull_model "qwen2.5:3b" "~2.0 GB"
pull_model "orca-mini:3b" "~2.0 GB"
pull_model "stable-code:3b" "~2.1 GB"
pull_model "phi3:mini" "~2.2 GB"
pull_model "phi4-mini" "~2.5 GB"
pull_model "mistral:7b-instruct-q2_K" "~2.7 GB"

# Clean up any macOS dot-underscore metadata files on the external drive
find "$EXTERNAL_ROOT" -name "._*" -delete 2>/dev/null || true

echo
echo "========================================================"
echo "Finished Ollama registry model downloads at $(date)"
echo "Current Ollama models on external drive:"
ollama list
echo "========================================================"
