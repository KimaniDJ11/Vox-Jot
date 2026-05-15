#!/usr/bin/env bash
#
# scripts/mirror-tts-assets.sh
#
# Mirror Vox Jot TTS runtime and voice-pack assets from the canonical
# sherpa-onnx upstream releases into the pinned GitHub models repository.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/mirror-tts-assets.sh [options]

Options:
  --dry-run          Download/package assets but skip GitHub release upload
  --outdir PATH      Write finished assets to PATH instead of a temp dir
  --tag TAG          Release tag to create/update (default: v0.3.0-tts-models)
  --repo OWNER/REPO  GitHub repo for the release (default: KimaniDJ11/Vox-Jot)
  --help             Show this help text
EOF
}

DRY_RUN=false
RELEASE_TAG="${VOX_JOT_TTS_RELEASE_TAG:-v0.3.0-tts-models}"
REPO="${VOX_JOT_MODELS_RELEASE_REPO:-KimaniDJ11/Vox-Jot}"
RELEASE_TITLE="TTS Assets (${RELEASE_TAG})"
OUTDIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
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
      RELEASE_TITLE="TTS Assets (${RELEASE_TAG})"
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

gh_cmd() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    env -u GITHUB_TOKEN gh "$@"
  else
    gh "$@"
  fi
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/vox-jot-tts-work.XXXXXX")"
if [[ -z "$OUTDIR" ]]; then
  OUTDIR="$(mktemp -d "${TMPDIR:-/tmp}/vox-jot-tts-release.XXXXXX")"
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
  local temp_dest="${dest}.part"

  mkdir -p "$(dirname "$dest")"
  echo "  -> $(basename "$dest")"
  rm -f "$temp_dest"
  curl --fail --location --retry 3 --retry-delay 2 --silent --show-error \
    --output "$temp_dest" \
    "$url"
  mv "$temp_dest" "$dest"
}

download_optional_file() {
  local url="$1"
  local dest="$2"
  local temp_dest="${dest}.part"

  mkdir -p "$(dirname "$dest")"
  rm -f "$temp_dest"
  if curl --fail --location --retry 2 --retry-delay 1 --silent --show-error \
    --output "$temp_dest" \
    "$url"; then
    mv "$temp_dest" "$dest"
    return 0
  fi
  rm -f "$temp_dest"
  return 1
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

extract_tar_bz2() {
  local archive="$1"
  local dest_dir="$2"
  rm -rf "$dest_dir"
  mkdir -p "$dest_dir"
  tar -xjf "$archive" -C "$dest_dir"
}

create_tarball() {
  local source_dir="$1"
  local archive_path="$2"

  mkdir -p "$(dirname "$archive_path")"
  tar -C "$(dirname "$source_dir")" -czf "$archive_path" "$(basename "$source_dir")"
}

write_upstream_notice_manifest() {
  local root_dir="$1"
  local source_name="$2"
  local source_url="$3"
  local source_note="$4"

  python3 - "$root_dir" "$source_name" "$source_url" "$source_note" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
source_name = sys.argv[2]
source_url = sys.argv[3]
source_note = sys.argv[4]
payload = {
    "source_name": source_name,
    "source_url": source_url,
    "source_note": source_note,
    "notice": "Vox Jot mirrors or repackages these files for app-managed installation. Preserve upstream LICENSE, NOTICE, COPYING, and README files when redistributing.",
}
(root / "VOX_JOT_UPSTREAM.json").write_text(
    json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
    encoding="utf-8",
)
PY
}

download_sherpa_notice_metadata() {
  local root_dir="$1"
  local upstream_url="$2"
  local source_note="$3"
  local notice_dir="$root_dir/upstream-notices"

  mkdir -p "$notice_dir"
  local file
  for file in README.md LICENSE NOTICE NOTICE.txt COPYING COPYING.txt; do
    download_optional_file "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/$file" "$notice_dir/$file" || true
  done
  write_upstream_notice_manifest "$root_dir" "k2-fsa/sherpa-onnx" "$upstream_url" "$source_note"
}

find_extracted_root() {
  local dir="$1"
  find "$dir" -mindepth 1 -maxdepth 1 -type d | head -n 1
}

write_pack_manifest() {
  local root_dir="$1"
  local pack_id="$2"
  local label="$3"
  local locale="$4"
  local source_name="$5"
  local source_url="$6"
  local model_family="$7"
  local model_file="$8"
  local tokens_file="$9"
  local data_dir="${10}"
  local lexicon_file="${11}"
  local rule_fsts="${12}"

  python3 - "$root_dir" "$pack_id" "$label" "$locale" "$source_name" "$source_url" "$model_family" "$model_file" "$tokens_file" "$data_dir" "$lexicon_file" "$rule_fsts" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
pack_id = sys.argv[2]
label = sys.argv[3]
locale = sys.argv[4]
source_name = sys.argv[5]
source_url = sys.argv[6]
model_family = sys.argv[7]
model_file = sys.argv[8]
tokens_file = sys.argv[9]
data_dir = sys.argv[10] or None
lexicon_file = sys.argv[11] or None
rule_fsts = [item for item in sys.argv[12].split(",") if item]

manifest = {
    "id": pack_id,
    "label": label,
    "locale": locale,
    "source_name": source_name,
    "source_url": source_url,
    "model_family": model_family,
    "model_file": model_file,
    "tokens_file": tokens_file,
    "data_dir": data_dir,
    "lexicon_file": lexicon_file,
    "rule_fsts": rule_fsts,
}

(root / "vox_jot_tts_manifest.json").write_text(
    json.dumps(manifest, indent=2, ensure_ascii=True) + "\n",
    encoding="utf-8",
)
PY
}

stage_runtime() {
  local asset_name="$1"
  local upstream_url="$2"
  local root_name="$3"
  local work_dir="$WORKDIR/$root_name"
  local download_path="$WORKDIR/${root_name}.tar.bz2"

  if [[ -f "$OUTDIR/$asset_name" ]]; then
    echo "Using existing staged asset: $asset_name"
    return 0
  fi

  echo "Packaging runtime $root_name"
  download_file "$upstream_url" "$download_path"
  extract_tar_bz2 "$download_path" "$WORKDIR/extracted-$root_name"
  rm -rf "$work_dir"
  mv "$(find_extracted_root "$WORKDIR/extracted-$root_name")" "$work_dir"
  download_sherpa_notice_metadata "$work_dir" "$upstream_url" "sherpa-onnx runtime release metadata copied during Vox Jot mirror packaging."
  create_tarball "$work_dir" "$OUTDIR/$asset_name"
}

stage_pack() {
  local asset_name="$1"
  local upstream_url="$2"
  local root_name="$3"
  local pack_id="$4"
  local label="$5"
  local locale="$6"
  local source_name="$7"
  local model_family="$8"
  local model_file="$9"
  local tokens_file="${10}"
  local data_dir="${11}"
  local lexicon_file="${12}"
  local rule_fsts="${13}"
  local work_dir="$WORKDIR/$root_name"
  local download_path="$WORKDIR/${root_name}.tar.bz2"

  if [[ -f "$OUTDIR/$asset_name" ]]; then
    echo "Using existing staged asset: $asset_name"
    return 0
  fi

  echo "Packaging voice pack $pack_id"
  download_file "$upstream_url" "$download_path"
  extract_tar_bz2 "$download_path" "$WORKDIR/extracted-$root_name"
  rm -rf "$work_dir"
  mv "$(find_extracted_root "$WORKDIR/extracted-$root_name")" "$work_dir"
  mv "$work_dir" "$WORKDIR/$pack_id"
  work_dir="$WORKDIR/$pack_id"
  download_sherpa_notice_metadata "$work_dir" "$upstream_url" "sherpa-onnx TTS model release metadata copied during Vox Jot mirror packaging."
  write_pack_manifest \
    "$work_dir" \
    "$pack_id" \
    "$label" \
    "$locale" \
    "$source_name" \
    "$upstream_url" \
    "$model_family" \
    "$model_file" \
    "$tokens_file" \
    "$data_dir" \
    "$lexicon_file" \
    "$rule_fsts"
  create_tarball "$work_dir" "$OUTDIR/$asset_name"
}

build_release_notes() {
  local notes_file="$WORKDIR/release-notes.md"

  {
    echo "## Vox Jot TTS Assets"
    echo
    echo "Pinned offline TTS runtime and voice packs for Vox Jot."
    echo
    echo "**Do not delete this release tag.** App releases should use separate tags."
    echo
    echo "### Included assets"
    echo
    shopt -s nullglob
    for asset in "$OUTDIR"/*.tar.gz; do
      echo "- \`$(basename "$asset")\`"
    done
    shopt -u nullglob
    echo
    echo "### Canonical upstream sources"
    echo
    echo "- Runtime: [k2-fsa/sherpa-onnx v1.12.20](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.20)"
    echo "- English voice: [vits-piper-en_US-lessac-medium.tar.bz2](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2)"
    echo "- Chinese + English voice: [vits-melo-tts-zh_en.tar.bz2](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2)"
    echo
    echo "Each archive includes upstream notice metadata under \`upstream-notices/\` when available and \`VOX_JOT_UPSTREAM.json\` lineage metadata."
    echo
    echo "Point \`VOX_JOT_TTS_MODELS_BASE_URL\` at this release to have Vox Jot download these assets by default."
  } >"$notes_file"

  printf '%s' "$notes_file"
}

RUNTIME_URLS=(
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-osx-universal2-shared.tar.bz2"
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-linux-x64-shared.tar.bz2"
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-win-x64-shared.tar.bz2"
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2"
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2"
)

echo "Verifying sherpa-onnx upstream URLs"
for url in "${RUNTIME_URLS[@]}"; do
  if verify_url "$url"; then
    echo "  OK: $url"
  else
    echo "TTS upstream verification failed for $url" >&2
    exit 1
  fi
done
echo

stage_runtime \
  "tts-sherpa-runtime-macos-universal2.tar.gz" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-osx-universal2-shared.tar.bz2" \
  "tts-sherpa-runtime-macos-universal2"

stage_runtime \
  "tts-sherpa-runtime-linux-x64.tar.gz" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-linux-x64-shared.tar.bz2" \
  "tts-sherpa-runtime-linux-x64"

stage_runtime \
  "tts-sherpa-runtime-win-x64.tar.gz" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-win-x64-shared.tar.bz2" \
  "tts-sherpa-runtime-win-x64"

stage_pack \
  "tts-sherpa-en-us-lessac-medium.tar.gz" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2" \
  "vits-piper-en_US-lessac-medium" \
  "tts-sherpa-en-us-lessac-medium" \
  "English (US) - Lessac" \
  "en-US" \
  "k2-fsa sherpa-onnx tts-models" \
  "vits" \
  "en_US-lessac-medium.onnx" \
  "tokens.txt" \
  "espeak-ng-data" \
  "" \
  ""

stage_pack \
  "tts-sherpa-zh-cn-melo.tar.gz" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2" \
  "vits-melo-tts-zh_en" \
  "tts-sherpa-zh-cn-melo" \
  "Chinese + English - Melo" \
  "zh-CN" \
  "k2-fsa sherpa-onnx tts-models" \
  "vits" \
  "model.onnx" \
  "tokens.txt" \
  "" \
  "lexicon.txt" \
  "date.fst,number.fst,phone.fst,new_heteronym.fst"

echo
echo "Staged assets:"
ls -lh "$OUTDIR"
echo

shopt -s nullglob
STAGED=("$OUTDIR"/*.tar.gz)
shopt -u nullglob
if [[ ${#STAGED[@]} -eq 0 ]]; then
  echo "No assets were staged. Aborting." >&2
  exit 1
fi

if $DRY_RUN; then
  echo "--dry-run enabled, skipping GitHub release upload."
  exit 0
fi

if ! gh_cmd auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

NOTES_FILE="$(build_release_notes)"

if gh_cmd release view "$RELEASE_TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Updating existing release $RELEASE_TAG on $REPO"
  gh_cmd release edit "$RELEASE_TAG" \
    --repo "$REPO" \
    --title "$RELEASE_TITLE" \
    --notes-file "$NOTES_FILE"
  gh_cmd release upload "$RELEASE_TAG" \
    --repo "$REPO" \
    --clobber \
    "${STAGED[@]}"
else
  echo "Creating release $RELEASE_TAG on $REPO"
  gh_cmd release create "$RELEASE_TAG" \
    --repo "$REPO" \
    --title "$RELEASE_TITLE" \
    --notes-file "$NOTES_FILE" \
    "${STAGED[@]}"
fi

echo
echo "Done: https://github.com/$REPO/releases/tag/$RELEASE_TAG"
