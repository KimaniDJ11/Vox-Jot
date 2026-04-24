#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-.}"
mkdir -p "$OUT"

PHRASE='This is a file transcription test for Vox Jot. One, two, three, four, five.'

echo "Generating speech with macOS say → AIFF…"
say -o "$OUT/_tmp.aiff" "$PHRASE"

echo "WAV (mono) — exercises in-app WAV decode + resample path"
ffmpeg -y -hide_banner -loglevel error -i "$OUT/_tmp.aiff" -ac 1 -ar 48000 \
  -c:a pcm_s16le "$OUT/sample_speech_48k_mono.wav"

echo "WAV (stereo 48 kHz) — exercises WAV downmix + resample"
ffmpeg -y -hide_banner -loglevel error -i "$OUT/_tmp.aiff" -ac 2 -ar 48000 \
  -c:a pcm_s16le "$OUT/sample_speech_48k_stereo.wav"

echo "MP3 — exercises ffmpeg decode path"
ffmpeg -y -hide_banner -loglevel error -i "$OUT/_tmp.aiff" -codec:a libmp3lame -q:a 6 \
  "$OUT/sample_speech.mp3"

echo "M4A (AAC) — exercises ffmpeg decode path"
ffmpeg -y -hide_banner -loglevel error -i "$OUT/_tmp.aiff" -codec:a aac -b:a 96k \
  "$OUT/sample_speech.m4a"

echo "MP4 (H.264 + AAC) — exercises video container + audio extraction"
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=#1a1a2e:s=640x360:d=12:r=15" \
  -i "$OUT/_tmp.aiff" -shortest \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -crf 28 \
  -c:a aac -b:a 96k \
  "$OUT/sample_talk_head.mp4"

rm -f "$OUT/_tmp.aiff"

echo "Done. Files in $OUT:"
ls -lh "$OUT"/*.{wav,mp3,m4a,mp4} 2>/dev/null || true
