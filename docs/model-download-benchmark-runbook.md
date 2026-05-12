# Model Download and Benchmark Runbook

This is the durable handoff for agents working on Vox Jot model downloads, benchmark rows, and app catalog updates. Keep this file current when a test run changes what the app should expose.

## Current Rules

- Use canonical app model IDs from the catalogs and benchmark result files. Do not add duplicate rows for the same model under alias IDs, old folder names, or near-identical Hugging Face repos.
- Keep Qwen reduced. The app should expose only the active Qwen TTS set, should keep Qwen ASR 1.7B canonicalized as `mlx-qwen3-asr`, and should not re-add removed Qwen CustomVoice/Base duplicates or duplicate Qwen LLM recommendations.
- Download model weights into the app support model stores, not random working directories:
  - TTS MLX: `~/Library/Application Support/com.iriedinamik.voxjot/models/tts/store/MLX`
  - STT MLX: `~/Library/Application Support/com.iriedinamik.voxjot/models/stt/store/MLX`
  - Speech analysis: `~/Library/Application Support/com.iriedinamik.voxjot/models/speech-analysis`
- Use resumable Hugging Face downloads with clear logs and status files. Prefer `scripts/download-untested-tts-models.zsh` for TTS backlog downloads.
- Never delete built-in Apple/system options while pruning local model files.
- If a model is downloaded but cannot run, mark the benchmark row `blocked` or `failed` and disable the model in the app catalog until the bridge/runtime is fixed.

## Benchmark Rules

- Ranked Testing view rows must come from the full suite for that tab.
- TTS, TTS Style, and Voice Cloning ranked rows require the full `scripts/run-tts-model-eval.py` hard suite with ASR round-trip scoring enabled. Do not use `--case-limit` or `--no-asr-roundtrip` for ranked rows.
- Live STT ranked rows require the full STT corpus, not a smoke subset.
- File ASR is a one-sample repository smoke suite by design. Keep its notes clear so it is not confused with Live STT full-corpus ranking.
- Recompute ranks after inserting full benchmark results. Do not leave notes that contradict the measured score, latency, WER, or pass count.

## Known Results To Preserve

- LongCat TTS: 1B 4-bit remains the best balance. 3.5B 4-bit improved WER but is slower. 1B bf16 tested slower than 1B 4-bit and should not become the default.
- Higgs Audio: q8 is the preferred Higgs variant after hard-suite testing. q6 generated audio but had poor ASR round-trip WER, especially on multilingual prompts.
- VoxCPM2: 8-bit outscored both the older 4-bit and bf16 rows. bf16 is slower and less accurate than 8-bit.
- OuteTTS 0.6B: downloaded but blocked. The current mlx-audio runtime does not generate usable audio for this checkpoint.
- MOSS-TTS Local Transformer: downloaded and failed the full hard suite because mlx-audio cannot determine the model type. Keep disabled until bridge support is added.
- MOSS-TTS 8B: downloaded and failed the full hard suite because mlx-audio cannot determine the model type. Keep disabled until bridge support is added.
- OmniVoice: downloaded and failed the full hard suite because every generated WAV was silent. The TTS runner now rejects silent audio before scoring; keep disabled until the bridge emits real audio.
- VibeVoice ASR: smoke-tested for File ASR but too slow for Live STT assumptions. Keep Live STT pending until a full corpus run exists.
- FireRedASR2 and Qwen ASR 0.6B are real File ASR/STT candidates; keep their IDs and result notes aligned across scripts, sidecar mappings, and Testing view data.
- Sortformer MLX v1/v2.1 are valid speaker-isolation results and should remain above older pyannote rows unless a newer full run changes the DER ranking.
- DiariZen remains blocked because the checkpoint format needs pyannote.audio metadata/compatibility work; no upstream fix was found at the pinned commit.

## Download Queue Notes

- The TTS backlog queue should avoid duplicate Qwen downloads and should use `exit_code` or another non-reserved shell variable name; `status` is read-only in zsh.
- Record each model start, finish, failure, repo, local directory, and timestamp.
- When a queued download finishes, immediately run the full relevant benchmark, update `src/lib/*EvaluationResults.ts`, and update app catalog availability if the model fails.
- The May 12, 2026 TTS backlog is fully downloaded. Do not rerun the old queue as if MOSS 8B or OmniVoice are merely pending; both are downloaded and blocked by runtime/bridge behavior.

## Main App Feedback Loop

After every benchmark/download session, update all applicable places:

- Rust app catalog and availability gates in `src-tauri/src/tts/catalog.rs` or the matching STT/speech-analysis catalog.
- Benchmark runner model specs under `scripts/`.
- Testing view data in `src/lib/*EvaluationResults.ts`.
- Planning docs such as `docs/mlx-audio-model-hub-audit.md`.
- This runbook and `AGENTS.md` when a new rule or failure mode should guide future agents.

Model catalog changes are not on the recording hot path. Selecting, loading, or retrying large models can be hot-path for dictation, so keep heavyweight or experimental models out of live dictation defaults unless the user explicitly accepts the latency tradeoff.
