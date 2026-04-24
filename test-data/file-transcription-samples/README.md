# File transcription samples (Dictate)

Small **spoken-English** clips to drag into **Dictate → File Transcription**.
The generated files are checked into the repo so manual testing works without
re-running the generator.

## Regenerate (macOS)

Requires **ffmpeg** on your `PATH` (Homebrew: `brew install ffmpeg`).

```bash
cd test-data/file-transcription-samples
chmod +x generate.sh
./generate.sh
```

This uses the built-in **`say`** voice synthesizer, then writes:

| File | Purpose |
|------|---------|
| `sample_speech_48k_mono.wav` | WAV path (decode in Rust + resample to 16 kHz) |
| `sample_speech_48k_stereo.wav` | Stereo downmix + resample |
| `sample_speech.mp3` | FFmpeg decode path |
| `sample_speech.m4a` | FFmpeg decode path (AAC) |
| `sample_talk_head.mp4` | FFmpeg decode path (audio inside video) |

The script overwrites the committed copies — re-run it any time you want to
refresh the samples.

## Other sources

For human voices and accents, see `test-data/audio-test-bank/README.md` (LibriSpeech, Common Voice, etc.).
