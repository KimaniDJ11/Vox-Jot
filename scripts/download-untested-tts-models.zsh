#!/bin/zsh
set -u

APP_SUPPORT="${APP_SUPPORT:-$HOME/Library/Application Support/com.iriedinamik.voxjot}"
STORE="${VOX_JOT_TTS_MLX_STORE:-$APP_SUPPORT/models/tts/store/MLX}"
LOG_DIR="${VOX_JOT_DOWNLOAD_LOG_DIR:-$HOME/Apps/Vox Jot/output/model-downloads}"
HF="${HF:-$(command -v hf 2>/dev/null || true)}"

if [[ -z "$HF" ]]; then
  echo "hf CLI not found. Install Hugging Face CLI or set HF=/path/to/hf." >&2
  exit 127
fi

mkdir -p "$LOG_DIR" "$STORE"

LOG_FILE="$LOG_DIR/untested-tts-model-download-$(date +%Y%m%d-%H%M%S).log"
STATUS_FILE="$LOG_DIR/untested-tts-model-download-status.tsv"

exec >> "$LOG_FILE" 2>&1

echo "Started untested TTS model download queue at $(date)"
echo "Log: $LOG_FILE"
echo "id	status	repo	local_dir	timestamp" > "$STATUS_FILE"

download_model() {
  local id="$1"
  local repo="$2"
  local local_dir="$3"

  echo
  echo "[$(date)] START $id"
  echo "$id	started	$repo	$local_dir	$(date -Iseconds)" >> "$STATUS_FILE"
  mkdir -p "$local_dir"

  "$HF" download "$repo" --local-dir "$local_dir" --max-workers 4
  local exit_code=$?

  if [[ "$exit_code" -eq 0 ]]; then
    echo "[$(date)] DONE $id"
    echo "$id	done	$repo	$local_dir	$(date -Iseconds)" >> "$STATUS_FILE"
  else
    echo "[$(date)] FAILED $id exit_code=$exit_code"
    echo "$id	failed:$exit_code	$repo	$local_dir	$(date -Iseconds)" >> "$STATUS_FILE"
  fi
}

# Keep this queue aligned with docs/model-download-benchmark-runbook.md.
# Do not add duplicate Qwen CustomVoice/Base rows back here.
# Current backlog is empty as of 2026-05-12. MOSS 8B and OmniVoice are
# already downloaded and blocked by runtime/bridge behavior, not by missing
# weights. Add new download_required TTS models below when the catalog grows.

echo
echo "Finished untested TTS model download queue at $(date)"
