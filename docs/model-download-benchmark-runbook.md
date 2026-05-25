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
- Treat Hugging Face repos/collections, app-support stores, and the external model drive as synchronized artifact mirrors. If a runtime, model, dependency pack, checksum, manifest, or benchmark-backed catalog file changes and that artifact is hosted on Hugging Face, update the Hugging Face copy before ending the session. If the artifact is also present on `/Volumes/Models`, update that copy in the same session.
- After updating a Hugging Face runtime/model artifact, verify the uploaded checksum or manifest by reading it back from Hugging Face. For archives, list or extract-check enough of the uploaded/local artifact to confirm macOS metadata files (`._*`, `__MACOSX`) are absent.
- For external model-drive backups, if the model is already present on the Mac, copy it directly to `/Volumes/Models/VoxJot/app-support/models/...` with macOS filesystem copy (`ditto`) or Finder/Computer Use. Do not use Python download/fill scripts or Hugging Face cache paths for local-to-drive transfers. Copy one model/category at a time and verify matching size plus file count after transfer.
- After updating `/Volumes/Models`, verify source and destination size, source and destination file count, and zero `._*` / `__MACOSX` metadata entries at the destination. Do not mark the drive update complete without those checks.
- Never delete built-in Apple/system options while pruning local model files.
- If a model is downloaded but cannot run, mark the benchmark row `blocked` or `failed` and disable the model in the app catalog until the bridge/runtime is fixed.

## Benchmark Rules

- Ranked Testing view rows must come from the full suite for that tab.
- TTS, TTS Style, and Voice Cloning ranked rows require the full `scripts/run-tts-model-eval.py` hard suite with ASR round-trip scoring enabled. Do not use `--case-limit` or `--no-asr-roundtrip` for ranked rows.
- TTS models must also pass the app create-voice path before being considered usable: select the model through the app catalog, load its voice list, create or preview a draft voice preset, and confirm synthesis uses the app's native provider/model IDs rather than a Hugging Face repo alias. A benchmark-only pass is not enough.
- Live STT ranked rows require the full STT corpus, not a smoke subset.
- File ASR ranked rows require the full committed file-transcription sample set, not a single sample. The single-file path is a readiness smoke test only.
- Smoke tests are temporary readiness checks. If a model has only smoke-test coverage, run the full relevant hard suite before adding or updating Testing view metrics.
- A model that completes the full relevant benchmark suite must always be ranked, including specialized or language-specific models. Use notes for corpus/language caveats instead of leaving full-suite results unranked.
- Recompute ranks after inserting full benchmark results. Do not leave notes that contradict the measured score, latency, WER, or pass count.
- The May 20-21, 2026 TTS refresh used the installed macOS app local API endpoint `/v1/tts/synthesize`, which synthesizes inline draft presets through the same canonical provider/model path used by the Listen UI. Use `--use-app-api` with `VOX_JOT_API_TOKEN` in the environment for app-path benchmark updates, with the token copied from the app's Local API settings. Do not pass the token as a command-line argument because it can appear in `ps` output.

## Known Results To Preserve

- LongCat TTS: 1B 4-bit remains the best balance. 3.5B 4-bit improved WER but is slower. 1B bf16 tested slower than 1B 4-bit and should not become the default.
- Higgs Audio: q8 is the preferred Higgs variant after hard-suite testing. q6 generated audio but had poor ASR round-trip WER, especially on multilingual prompts.
- VoxCPM2: 8-bit outscored both the older 4-bit and bf16 rows. bf16 is slower and less accurate than 8-bit.
- OuteTTS: the Qwen3 `mlx-community/OuteTTS-1.0-0.6B-*` checkpoints still fail in mlx-audio 0.4.3 by reaching DAC decode with no audio token arrays (`[concatenate] No arrays provided`). The catalog uses `mlx-community/Llama-OuteTTS-1.0-1B-4bit` instead; keep the Qwen3 0.6B variants out until upstream generation emits decodable `<|c1_*|>/<|c2_*|>` tokens.
- MOSS-TTS Local Transformer: removed from the user-facing app catalog after full-suite failure. The public `mlx-community/MOSS-TTS-Local-Transformer-MLX-8bit` conversion requires a different `mlx-speech` runtime path and fails in Vox Jot's mlx-audio bridge with incompatible tensor shapes.
- MOSS-TTS 8B: removed from the user-facing app catalog after full-suite failure. PyPI `mlx-audio==0.4.3` does not include the required loader for `mlx-community/MOSS-TTS-8B-8bit`; the unreleased upstream loader is not production-ready for Vox Jot yet.
- May 21, 2026 installed-app TTS repairs: Kokoro managed `kokoro-82m-v1.0`, XTTS v2, LFM Audio GGUF, VibeVoice, KugelAudio 7B, Voxtral TTS 4B, and OmniVoice were rerun through the notarized `/Applications/Vox Jot.app` local API with full ASR round-trip suites and now have numeric ranked rows. Hard-suite scores: OmniVoice 95.6, Kokoro managed 95.1, VibeVoice 90.9, Voxtral 88.2, LFM 87.0, KugelAudio 76.5, XTTS 60.5. Style-suite scores: LFM 89.2, Kokoro managed 88.6, VibeVoice 87.4, XTTS 85.2, Voxtral 84.4, KugelAudio 79.6, OmniVoice 64.9. Voice-clone repairs: OmniVoice 83.2, XTTS 78.4.
- KugelAudio 7B needs the `Qwen/Qwen2.5-7B` tokenizer sidecar files (`merges.txt`, `tokenizer.json`, `tokenizer_config.json`, `vocab.json`) in the local checkpoint directory. It can use about 17 GB RSS during installed-app synthesis, so run it sequentially and clear resident managed TTS workers before large MLX runs.
- Voxtral TTS 4B should prefer the runnable `MLX/Voxtral-4B-TTS-2603-mlx-bf16` snapshot. The old `MLX/Voxtral-TTS-4B-MLX-6bit` folder was config-only and must not be the first app-path candidate.
- OmniVoice should use the full upstream `k2-fsa/OmniVoice` snapshot. The older `mlx-community/OmniVoice-bf16` mirror was incomplete for app-path synthesis.
- Supertonic 3: ships through the managed Speech runtime with PyPI `supertonic==1.2.1` and the local snapshot at `models/tts/store/supertonic-3`. Keep `auto_download=False`, expose fixed `M1`-`M5`/`F1`-`F5` voices from `voice_styles`, map unsupported locales such as Chinese to Supertonic's `na` language code, and keep it out of voice-clone rankings because it does not support cloning. The public HF snapshot currently contains 10 preset voice-style files, not the larger custom/Voice Builder voice catalog. May 12, 2026 full hard TTS score 98.6, 5/5 cases, p50 1588 ms, p50 RTF 0.143, average WER 0.032. Full TTS Style score 90.3, 6/6 cases, p50 1066 ms, p50 RTF 0.185, average WER 0.0. App-path validation: `/listen/prepare` for `supertonic/supertonic-3` returned ready, `/listen/voices` returned 10 voices, and a create-voice-style preview synthesis with voice `F2` returned a valid 44.1 kHz mono WAV.
- VibeVoice ASR: full 35-clip Live STT suite completed, but results are too slow and inaccurate for low-latency dictation: 0/35 normalized matches, WER 1.871, p50 11005 ms, p50 RTF 4.74. Keep positioned for file transcription experiments.
- GigaAM v3: Russian-only. Rank it because it completed a full 35-case Russian Live STT suite, and keep the language/corpus caveat in the notes. The May 12, 2026 result is 15/35 normalized matches, WER 0.122, p50 97 ms, p50 RTF 0.03.
- File ASR missing rows were closed on May 12, 2026 with the full five-format suite. Granite Speech 4.1 2B and Whisper Diarization completed successfully in lab testing, but they are no longer user-facing catalog entries because they depend on the legacy checkout-local Python sidecar runtime. Keep those results in reports only until a managed runtime ships.
- FireRedASR2 and Qwen ASR 0.6B are real File ASR/STT candidates; keep their IDs and result notes aligned across scripts, sidecar mappings, and Testing view data.
- Sortformer MLX v1/v2.1 are valid speaker-isolation results and remain the only user-facing downloadable speaker-isolation rows. The app now routes them through the managed `mlx-audio` runtime instead of the repo `.venv`.
- DiariZen is removed from the user-facing app catalog and Testing view. Granite, Cohere Transcribe, PyAnnote, NeMo Sortformer, Reverb, WhisperX, MLX Sortformer, and Polyvoice stay in the user-facing speech-analysis hub and route through the managed speech-analysis runtime group at `IrieDinamik/vox-jot-speech-analysis-runtime`.
- May 25, 2026 Creative Audio installed-app suite: `scripts/run-creative-audio-model-eval.ts` drives `/v1/creative-audio/generate` through the installed local API and writes `src/lib/creativeAudioEvaluationResults.ts`. Current ranked Mac app-path rows: Stable Audio 3 Small Music #1 score 99.8, Stable Audio 3 Small SFX #2 score 99.6, AudioLDM 2 Music #3 score 98.7, AudioLDM 2 #4 score 96.8, MusicGen Small #5 score 91.9. ACE-Step, DiffRhythm, YuE, and FIGARO are removed from the production-facing Creative Audio catalog until their macOS app-managed runtime/checkpoint paths validate.
- Story Studio WAV duration uses `hound::WavReader::duration()` as frame count. Do not divide it by channel count; doing so halves stereo Creative Audio durations and causes false benchmark failures.

## Download Queue Notes

- The TTS backlog queue should avoid duplicate Qwen downloads and should use `exit_code` or another non-reserved shell variable name; `status` is read-only in zsh.
- Record each model start, finish, failure, repo, local directory, and timestamp.
- When a queued download finishes, immediately run the full relevant benchmark, update `src/lib/*EvaluationResults.ts`, and update app catalog availability if the model fails.
- The May 12, 2026 TTS backlog is fully downloaded. Do not rerun the old queue as if MOSS 8B is merely pending; it is downloaded but removed from the app catalog because runtime/bridge behavior is blocked. OmniVoice should use the `k2-fsa/OmniVoice` snapshot, not the incomplete `mlx-community/OmniVoice-bf16` mirror.

## Main App Feedback Loop

After every benchmark/download session, update all applicable places:

- Rust app catalog and availability gates in `src-tauri/src/tts/catalog.rs` or the matching STT/speech-analysis catalog.
- Benchmark runner model specs under `scripts/`.
- Testing view data in `src/lib/*EvaluationResults.ts`.
- Creative Audio benchmark rows in `src/lib/creativeAudioEvaluationResults.ts`.
- Planning docs such as `docs/mlx-audio-model-hub-audit.md`.
- This runbook and `AGENTS.md` when a new rule or failure mode should guide future agents.

Model catalog changes are not on the recording hot path. Selecting, loading, or retrying large models can be hot-path for dictation, so keep heavyweight or experimental models out of live dictation defaults unless the user explicitly accepts the latency tradeoff.
