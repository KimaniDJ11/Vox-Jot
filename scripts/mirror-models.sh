#!/usr/bin/env bash
#
# scripts/mirror-models.sh
#
# Mirror Vox Jot model assets from canonical upstream sources into a pinned
# GitHub release owned by this repository.
#
# Default behavior:
# - Verifies Whisper model URLs on Hugging Face
# - Packages all non-Whisper model assets into the exact layout Vox Jot expects
# - Uploads those packaged assets to a pinned GitHub release
#
# Optional behavior:
# - --mirror-whisper downloads Whisper binaries too and uploads them to the
#   same pinned release. The app still defaults to Hugging Face unless you
#   point VOX_JOT_WHISPER_MODELS_BASE_URL at your mirrored location.
#
# Usage:
#   chmod +x scripts/mirror-models.sh
#   ./scripts/mirror-models.sh --dry-run
#   ./scripts/mirror-models.sh
#   ./scripts/mirror-models.sh --mirror-whisper

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/mirror-models.sh [options]

Options:
  --dry-run          Download/package models but skip GitHub release upload
  --mirror-whisper   Mirror Whisper binaries into the release as well
  --outdir PATH      Write finished assets to PATH instead of a temp dir
  --tag TAG          Release tag to create/update (default: v0.1.0-models)
  --repo OWNER/REPO  GitHub repo for the release (default: KimaniDJ11/Vox-Jot)
  --help             Show this help text
EOF
}

DRY_RUN=false
MIRROR_WHISPER=false
RELEASE_TAG="${VOX_JOT_MODELS_RELEASE_TAG:-v0.1.0-models}"
REPO="${VOX_JOT_MODELS_RELEASE_REPO:-KimaniDJ11/Vox-Jot}"
RELEASE_TITLE="STT Model Assets (${RELEASE_TAG})"
OUTDIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --mirror-whisper)
      MIRROR_WHISPER=true
      shift
      ;;
    --outdir)
      OUTDIR="${2:-}"
      if [[ -z "$OUTDIR" ]]; then
        echo "Missing value for --outdir" >&2
        exit 1
      fi
      shift 2
      ;;
    --tag)
      RELEASE_TAG="${2:-}"
      if [[ -z "$RELEASE_TAG" ]]; then
        echo "Missing value for --tag" >&2
        exit 1
      fi
      RELEASE_TITLE="STT Model Assets (${RELEASE_TAG})"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      if [[ -z "$REPO" ]]; then
        echo "Missing value for --repo" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd tar
require_cmd python3

if ! $DRY_RUN; then
  require_cmd gh
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/vox-jot-model-work.XXXXXX")"
if [[ -z "$OUTDIR" ]]; then
  OUTDIR="$(mktemp -d "${TMPDIR:-/tmp}/vox-jot-model-release.XXXXXX")"
else
  mkdir -p "$OUTDIR"
fi

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "Workspace: $WORKDIR"
echo "Release assets: $OUTDIR"
echo

download_file() {
  local url="$1"
  local dest="$2"

  mkdir -p "$(dirname "$dest")"
  echo "  -> $(basename "$dest")"
  curl --fail --location --retry 3 --retry-delay 2 --silent --show-error \
    --output "$dest" \
    "$url"
}

verify_url() {
  local url="$1"
  local code
  code="$(curl --head --location --silent --output /dev/null --write-out '%{http_code}' "$url" || true)"
  if [[ "$code" == "200" || "$code" == "301" || "$code" == "302" ]]; then
    return 0
  fi

  echo "  DEAD ($code): $url" >&2
  return 1
}

hf_resolve_url() {
  local repo="$1"
  local path="$2"
  printf 'https://huggingface.co/%s/resolve/main/%s' "$repo" "$path"
}

create_tarball() {
  local source_dir="$1"
  local archive_path="$2"

  mkdir -p "$(dirname "$archive_path")"
  tar -C "$(dirname "$source_dir")" -czf "$archive_path" "$(basename "$source_dir")"
}

write_tokenizer_bin() {
  local tokenizer_json="$1"
  local tokenizer_bin="$2"

  python3 - "$tokenizer_json" "$tokenizer_bin" <<'PY'
import json
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])

data = json.loads(src.read_text(encoding="utf-8"))
model = data.get("model") or {}
vocab = model.get("vocab")
if not isinstance(vocab, dict):
    raise SystemExit(f"Unsupported tokenizer format in {src}")

entries = [b""] * (max(vocab.values()) + 1)
for token, idx in vocab.items():
    if not isinstance(idx, int) or idx < 0:
        raise SystemExit(f"Invalid token id for {token!r} in {src}")
    entries[idx] = token.encode("utf-8")

with dst.open("wb") as fh:
    for token_bytes in entries:
        length = len(token_bytes)
        if length == 0:
            fh.write(b"\x00")
            continue
        if length < 128:
            fh.write(bytes([length]))
        else:
            fh.write(bytes([128 + (length % 128), length // 128]))
        fh.write(token_bytes)
PY
}

stage_parakeet() {
  local model_id="$1"
  local source_repo="$2"
  local archive_name="$3"
  local root_dir="$WORKDIR/$model_id"

  echo "Packaging $model_id from $source_repo"
  rm -rf "$root_dir"
  mkdir -p "$root_dir"

  download_file "$(hf_resolve_url "$source_repo" "encoder-model.int8.onnx")" \
    "$root_dir/encoder-model.int8.onnx"
  download_file "$(hf_resolve_url "$source_repo" "decoder_joint-model.int8.onnx")" \
    "$root_dir/decoder_joint-model.int8.onnx"
  download_file "$(hf_resolve_url "$source_repo" "nemo128.onnx")" \
    "$root_dir/nemo128.onnx"
  download_file "$(hf_resolve_url "$source_repo" "vocab.txt")" \
    "$root_dir/vocab.txt"

  create_tarball "$root_dir" "$OUTDIR/$archive_name"
}

stage_moonshine_base() {
  local root_dir="$WORKDIR/moonshine-base"
  local repo="UsefulSensors/moonshine"

  echo "Packaging moonshine-base from $repo"
  rm -rf "$root_dir"
  mkdir -p "$root_dir"

  download_file "$(hf_resolve_url "$repo" "onnx/merged/base/quantized/encoder_model.onnx")" \
    "$root_dir/encoder_model.onnx"
  download_file "$(hf_resolve_url "$repo" "onnx/merged/base/quantized/decoder_model_merged.onnx")" \
    "$root_dir/decoder_model_merged.onnx"
  download_file "$(hf_resolve_url "$repo" "onnx/merged/base/float/tokenizer.json")" \
    "$root_dir/tokenizer.json"

  create_tarball "$root_dir" "$OUTDIR/moonshine-base.tar.gz"
}

stage_moonshine_streaming() {
  local size="$1"
  local root_name="$2"
  local root_dir="$WORKDIR/$root_name"
  local repo="UsefulSensors/moonshine-streaming"
  local prefix="onnx/${size}"

  echo "Packaging $root_name from $repo/$prefix"
  rm -rf "$root_dir"
  mkdir -p "$root_dir"

  download_file "$(hf_resolve_url "$repo" "${prefix}/frontend.ort")" \
    "$root_dir/frontend.ort"
  download_file "$(hf_resolve_url "$repo" "${prefix}/encoder.ort")" \
    "$root_dir/encoder.ort"
  download_file "$(hf_resolve_url "$repo" "${prefix}/adapter.ort")" \
    "$root_dir/adapter.ort"
  download_file "$(hf_resolve_url "$repo" "${prefix}/cross_kv.ort")" \
    "$root_dir/cross_kv.ort"
  download_file "$(hf_resolve_url "$repo" "${prefix}/decoder_kv.ort")" \
    "$root_dir/decoder_kv.ort"
  download_file "$(hf_resolve_url "$repo" "${prefix}/streaming_config.json")" \
    "$root_dir/streaming_config.json"
  download_file "$(hf_resolve_url "$repo" "${prefix}/tokenizer.json")" \
    "$root_dir/tokenizer.json"

  write_tokenizer_bin "$root_dir/tokenizer.json" "$root_dir/tokenizer.bin"
  rm -f "$root_dir/tokenizer.json"

  create_tarball "$root_dir" "$OUTDIR/${root_name}.tar.gz"
}

stage_sense_voice() {
  local root_dir="$WORKDIR/sense-voice-int8"
  local repo="twmht/sherpa-onnx-sense-voice-small"

  echo "Packaging sense-voice-int8 from $repo"
  rm -rf "$root_dir"
  mkdir -p "$root_dir"

  download_file "$(hf_resolve_url "$repo" "model.int8.onnx")" \
    "$root_dir/model.int8.onnx"
  download_file "$(hf_resolve_url "$repo" "tokens.txt")" \
    "$root_dir/tokens.txt"

  create_tarball "$root_dir" "$OUTDIR/sense-voice-int8.tar.gz"
}

stage_gigaam() {
  local root_dir="$WORKDIR/giga-am-v3"
  local repo="istupakov/gigaam-v3-onnx"

  echo "Packaging giga-am-v3 from $repo"
  rm -rf "$root_dir"
  mkdir -p "$root_dir"

  download_file "$(hf_resolve_url "$repo" "v3_e2e_ctc.int8.onnx")" \
    "$root_dir/v3_e2e_ctc.int8.onnx"

  create_tarball "$root_dir" "$OUTDIR/giga-am-v3.tar.gz"
}

stage_breeze() {
  local repo="alan314159/Breeze-ASR-25-whispercpp"

  echo "Downloading breeze-asr-q5_k.bin from $repo"
  download_file "$(hf_resolve_url "$repo" "ggml-model-q5_k.bin")" \
    "$OUTDIR/breeze-asr-q5_k.bin"
}

stage_whisper() {
  local repo="ggerganov/whisper.cpp"
  local filename="$1"

  echo "Downloading $filename from $repo"
  download_file "$(hf_resolve_url "$repo" "$filename")" "$OUTDIR/$filename"
}

build_release_notes() {
  local include_whisper="$1"
  local notes_file="$WORKDIR/release-notes.md"

  {
    echo "## Vox Jot STT Model Assets"
    echo
    echo "Pinned model assets for Vox Jot."
    echo
    echo "**Do not delete this release tag.** App releases should use separate tags."
    echo
    echo "### Included assets"
    echo
    shopt -s nullglob
    for asset in "$OUTDIR"/*.bin "$OUTDIR"/*.tar.gz; do
      echo "- \`$(basename "$asset")\`"
    done
    shopt -u nullglob
    echo
    if [[ "$include_whisper" == "true" ]]; then
      echo "Whisper binaries are mirrored in this release."
      echo "Point \`VOX_JOT_WHISPER_MODELS_BASE_URL\` at this release if you want Vox Jot to use them by default."
    else
      echo "Whisper binaries are verified against [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) and are not mirrored by default."
      echo "Use \`--mirror-whisper\` if you want to publish them into this pinned release too."
    fi
  } >"$notes_file"

  printf '%s' "$notes_file"
}

echo "Verifying Whisper URLs"
WHISPER_FILES=(
  "ggml-small.bin"
  "ggml-medium.bin"
  "ggml-large-v3-turbo.bin"
  "ggml-large-v3-q5_0.bin"
)
for file in "${WHISPER_FILES[@]}"; do
  url="$(hf_resolve_url "ggerganov/whisper.cpp" "$file")"
  if verify_url "$url"; then
    echo "  OK: $file"
  else
    echo "Whisper URL verification failed for $file" >&2
    exit 1
  fi
done
echo

stage_parakeet "parakeet-tdt-0.6b-v2-int8" "smcleod/parakeet-tdt-0.6b-v2-int8" "parakeet-v2-int8.tar.gz"
stage_parakeet "parakeet-tdt-0.6b-v3-int8" "smcleod/parakeet-tdt-0.6b-v3-int8" "parakeet-v3-int8.tar.gz"
stage_moonshine_base
stage_moonshine_streaming "tiny" "moonshine-tiny-streaming-en"
stage_moonshine_streaming "small" "moonshine-small-streaming-en"
stage_moonshine_streaming "medium" "moonshine-medium-streaming-en"
stage_sense_voice
stage_gigaam
stage_breeze

if $MIRROR_WHISPER; then
  echo
  for file in "${WHISPER_FILES[@]}"; do
    stage_whisper "$file"
  done
fi

echo
echo "Staged assets:"
ls -lh "$OUTDIR"
echo

shopt -s nullglob
STAGED=("$OUTDIR"/*.bin "$OUTDIR"/*.tar.gz)
shopt -u nullglob
if [[ ${#STAGED[@]} -eq 0 ]]; then
  echo "No assets were staged. Aborting." >&2
  exit 1
fi

if $DRY_RUN; then
  echo "--dry-run enabled, skipping GitHub release upload."
  exit 0
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

NOTES_FILE="$(build_release_notes "$MIRROR_WHISPER")"

if gh release view "$RELEASE_TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Updating existing release $RELEASE_TAG on $REPO"
  gh release edit "$RELEASE_TAG" \
    --repo "$REPO" \
    --title "$RELEASE_TITLE" \
    --notes-file "$NOTES_FILE"
  gh release upload "$RELEASE_TAG" \
    --repo "$REPO" \
    --clobber \
    "${STAGED[@]}"
else
  echo "Creating release $RELEASE_TAG on $REPO"
  gh release create "$RELEASE_TAG" \
    --repo "$REPO" \
    --title "$RELEASE_TITLE" \
    --notes-file "$NOTES_FILE" \
    "${STAGED[@]}"
fi

echo
echo "Done: https://github.com/$REPO/releases/tag/$RELEASE_TAG"
