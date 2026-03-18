## Audio Regression Pack

This directory is for a local, repeatable speech-regression corpus used to tune Vox Jot.

The default workflow builds a short-clip English corpus from the official OpenSLR Mini LibriSpeech regression set:

- Dataset: `SLR31 / Mini LibriSpeech`
- Source: `https://www.openslr.org/31/`
- License: `CC BY 4.0`

Generated artifacts are intentionally gitignored because the audio files and reports are local test assets:

- `downloads/`: downloaded archives
- `extracted/`: extracted source corpus
- `clips/`: converted 16 kHz mono WAV clips used by Vox Jot
- `manifest.json`: generated manifest for the selected clips
- `reports/`: regression run outputs

Commands:

```bash
bun run regression:download
bun run regression:run
```

Helpful overrides:

```bash
bun run regression:download --limit 150
bun run regression:run --limit 25
bun run regression:run --skip-post-process
```
