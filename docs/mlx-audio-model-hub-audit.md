# MLX-Audio Model Hub Audit

Audit date: 2026-06-07

Scope: [`Blaizzy/mlx-audio`](https://github.com/Blaizzy/mlx-audio) as a source for Vox Jot speech models and audio-processing features. This audit covers current Vox Jot coverage, stale May 2026 roadmap items, and upstream candidates that should not be exposed until they pass Vox Jot's runtime and benchmark gates.

Primary sources:

- [`Blaizzy/mlx-audio` README](https://github.com/Blaizzy/mlx-audio)
- [`mlx-audio` on PyPI](https://pypi.org/project/mlx-audio/)
- [`mlx-audio` `pyproject.toml`](https://github.com/Blaizzy/mlx-audio/blob/main/pyproject.toml)
- Vox Jot catalogs and adapters in `src-tauri/src/tts/catalog.rs`, `src-tauri/src/managers/model.rs`, `src-tauri/src/speech_analysis.rs`, `src-tauri/resources/python/mlx_audio_generate.py`, and `scripts/speech_analysis_sidecar.py`

## Current Runtime State

Vox Jot currently pins the app-managed MLX-Audio sidecar to `mlx-audio==0.4.4` in `src-tauri/src/sidecar.rs`. The generic speech-analysis environment intentionally does not install `mlx-audio`; MLX file-ASR models route through the shared MLX-Audio sidecar, and Gemma audio models route through a separate Gemma venv.

PyPI lists `mlx-audio==0.4.4`, uploaded 2026-06-06. The runtime bump must force a clean venv rebuild and pass the validation checklist below before it is shipped because Vox Jot carries model-specific bridge patches.

## Current Vox Jot Coverage

The May 2026 first-wave roadmap has mostly shipped. Treat the following as implemented unless a new regression is found.

| Area                           | Vox Jot status                    | Evidence / notes                                                                                                                                                                                                           |
| ------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MLX TTS runtime                | Implemented                       | `src-tauri/src/tts/catalog.rs` exposes many `engine_family: "mlx_audio"` models and routes synthesis through `src-tauri/resources/python/mlx_audio_generate.py`.                                                           |
| Core MLX TTS families          | Implemented                       | Kokoro, Chatterbox, Qwen3 TTS, Dia, CSM, Spark, OuteTTS, Ming Omni Dense, KugelAudio, Bark, Fish Audio S2, LFM Audio, Pocket TTS, VoxCPM2, and Voxtral TTS are cataloged.                                                  |
| May P0/P1 TTS additions        | Implemented                       | LongCat, Soprano, MeloTTS, Higgs Audio v2, MOSS-TTS Nano, Irodori, IndexTTS, OmniVoice, VibeVoice Realtime, Dia 4-bit, CSM 8-bit, Spark 4/6-bit, VoxCPM2 8-bit/bf16, Voxtral 4-bit, and Fish Audio S2 8-bit are cataloged. |
| Live MLX STT                   | Implemented                       | `src-tauri/src/managers/model.rs` exposes MLX Whisper Large V3 Turbo, Distil-Whisper Large V3, Qwen3 ASR 1.7B, Qwen3 ASR 0.6B, Parakeet v3, Voxtral Mini 3B, Voxtral Mini 4B Realtime, FireRedASR2, and VibeVoice ASR.     |
| File-analysis MLX ASR          | Implemented                       | `scripts/speech_analysis_sidecar.py` maps Qwen3 ASR 0.6B/1.7B, FireRedASR2, and VibeVoice ASR for file transcription.                                                                                                      |
| MLX Sortformer v2.1            | Implemented and tested            | `src-tauri/src/speech_analysis.rs`, `scripts/speech_analysis_sidecar.py`, validation scripts, model licenses, and `src/lib/speakerIsolationEvaluationResults.ts` include `mlx-sortformer-4spk-v2-1`.                       |
| Qwen3 ForcedAligner            | Not implemented                   | Still analysis/export-only. It needs a dedicated command path that accepts audio plus known text; it must not be added as a normal live STT model.                                                                         |
| TTS streaming                  | Not implemented in the MLX bridge | Upstream supports `--stream`, but Vox Jot's generic bridge passes `stream: False`. This is an optimization project, not a catalog-row change.                                                                              |
| Speech enhancement via MLX STS | Not implemented                   | Vox Jot already has hot-path RNNoise enhancement in Rust. MLX DeepFilterNet or MossFormer2-SE should start as offline/file processing or benchmark-only work, not as an immediate live dictation replacement.              |

## Upstream Candidates Since The May Audit

These are net-new or newly actionable upstream items. Do not add visible model hub rows until each row has license review, app-managed download/install behavior, app-path smoke tests, and the relevant full benchmark suite.

| Priority | Candidate                      | Domain                  | Upstream repo / source                                                       | Why it matters                                                                   | Required Vox Jot work                                                                                                                                                                    |
| -------- | ------------------------------ | ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Nemotron 3.5 ASR streaming     | Live/file STT           | `mlx-community/nemotron-3.5-asr-streaming-0.6b`                              | Lower-latency multilingual streaming ASR across 30+ locales.                     | Added to the STT and File ASR catalogs after `mlx-audio==0.4.4` restored the loader. Full Mini LibriSpeech STT suite passed; file-ASR five-format rerun passed with non-empty output.    |
| P0       | TTS streaming bridge           | Listen/readback latency | Existing MLX-Audio TTS streaming APIs                                        | Can reduce first-audio latency for Auto-Readback without changing model quality. | Add a separate streaming bridge path and measure first-audio latency, full synthesis latency, cancellation, output-device routing, and fallback to current non-streaming path.           |
| P1       | KittenTTS 0.8 nano/micro/mini  | Lightweight TTS         | `mlx-community/kitten-tts-*`                                                 | Small English TTS options for low disk/memory installs.                          | Added to the TTS catalog. One-case bridge synthesis passed after `phonemizer-fork` and the app-managed Kitten sine/F0 length patch; full installed-app TTS hard suite is still required. |
| P1       | Higgs Audio v3                 | TTS / cloning           | `bosonai/higgs-audio-v3-tts-4b`                                              | Newer 4B conversational TTS with broader language coverage than v2.              | Check license/access, runtime support in PyPI package, tokenizer/assets, memory requirement, full TTS/style/clone suites, and whether existing Higgs v2 bridge branches still apply.     |
| P1       | MisoTTS                        | Conversational TTS      | `mlx-community/MisoLabs-MisoTTS-bf16`, `mlx-community/MisoLabs-MisoTTS-8bit` | Sesame-style English conversational speech may overlap with CSM.                 | Added to the TTS catalog. One-case bridge synthesis passed after `mlx-audio==0.4.4` restored Sesame `llama-8B`; full installed-app TTS hard suite is still required.                     |
| P1       | DeepFilterNet / MossFormer2-SE | Speech enhancement      | `mlx-community/DeepFilterNet-mlx`, `starkdmi/MossFormer2_SE_48K_MLX`         | Potential noise suppression beyond RNNoise for recordings or imports.            | Keep off the live dictation hot path initially. Build an offline enhancement/benchmark command, compare WER/latency against current RNNoise, then decide whether live use is justified.  |
| P2       | Mega-ASR                       | Routed STT              | `mlx-community/Mega-ASR-8bit`                                                | Routes Qwen3-ASR between clean/base and degraded/LoRA paths.                     | Added to the STT and File ASR catalogs. Full Mini LibriSpeech STT suite passed; file-ASR five-format rerun passed with non-empty output.                                                 |
| P2       | MedASR                         | Specialized STT         | `mlx-community/medasr`                                                       | Medical dictation specialization.                                                | Only expose as a domain-specific Labs model after license review and a medical-term benchmark; do not make it a default dictation model.                                                 |
| P2       | SAM-Audio                      | Source separation       | `mlx-community/sam-audio-large`                                              | Could isolate speech or remove non-speech sounds in imported files.              | Treat as file-processing tooling, not live dictation. Requires separate UI/API and benchmark fixtures.                                                                                   |

## Shipped May Items That Should Not Be Re-Added

Do not duplicate these rows or provider families. They already exist in the app catalog or analysis path:

- LongCat AudioDiT 1B/3.5B.
- Soprano 80M and 1.1 80M.
- MeloTTS English.
- Qwen3 ASR 0.6B.
- FireRedASR2.
- VibeVoice ASR.
- Sortformer v2.1 MLX.
- Higgs Audio v2 q6/q8.
- MOSS-TTS Nano.
- Irodori TTS.
- IndexTTS 1.5.
- OmniVoice.
- Dia, CSM, Spark, VoxCPM2, Voxtral TTS, and Fish Audio quantized variants already represented in `src-tauri/src/tts/catalog.rs`.

## Known Compatibility Notes

- OuteTTS: keep the Qwen3 `mlx-community/OuteTTS-1.0-0.6B-*` checkpoints out of the catalog until upstream generation emits decodable audio tokens under the app-managed runtime. The catalog uses `mlx-community/Llama-OuteTTS-1.0-1B-4bit`.
- MOSS-TTS 8B / Local Transformer: keep removed from user-facing catalog until the PyPI runtime includes the required loader and a full Vox Jot hard suite passes.
- OmniVoice: keep using `k2-fsa/OmniVoice` unless a full-suite rerun proves the `mlx-community/OmniVoice-bf16` mirror emits non-silent audio with the required tokenizer weights.
- Sortformer v2.1: current benchmark shows faster latency than v1 but more turn over-segmentation on the single committed fixture. Treat it as tested, not fully characterized for real meetings.
- RNNoise: current live audio enhancement is Rust-side RNNoise. Any MLX enhancement would add model load and inference work to a latency-sensitive path unless it is explicitly cached/backgrounded and benchmarked.

## 0.4.4 Runtime Validation Checklist

Before changing `MLX_AUDIO_RUNTIME_MARKER` or `MLX_AUDIO_RUNTIME_PACKAGES` to `mlx-audio==0.4.4`, run this sequence:

1. Package smoke:
   - Install `mlx-audio==0.4.4` into a clean temporary venv.
   - Confirm `import mlx_audio`, `from mlx_audio.tts import load`, `from mlx_audio.stt import load`, and `from mlx_audio.vad import load`.
   - Confirm `python -m pip index versions mlx-audio` still reports `0.4.4` as available.
2. Bridge smoke:
   - Run `src-tauri/resources/python/mlx_audio_generate.py` through at least Kokoro or Soprano, Qwen3 TTS 0.6B, Voxtral TTS 4-bit, LongCat 1B 4-bit, IndexTTS, OmniVoice, and VoxCPM2 if the local model artifacts are installed.
   - Confirm WAV files are non-empty, finite, have sane duration, and play at the expected sample rate.
3. STT smoke:
   - Run the MLX STT path for Qwen3 ASR 0.6B, Qwen3 ASR 1.7B, Parakeet v3, Voxtral Mini 4B Realtime, and VibeVoice ASR where local artifacts exist.
   - Record cold-load time, warm transcription time, text output, and any model-specific warnings.
4. Speech-analysis smoke:
   - Run `scripts/validate_speech_analysis_models.py` readiness checks.
   - Run at least one sample through `mlx-sortformer-4spk-v1` and `mlx-sortformer-4spk-v2-1`.
5. Regression checks:
   - Recheck app-specific patches: `voxtral_eos_v1`, `parakeet_stt_remap_v1`, IndexTTS config patch, VoxCPM2 sample-rate handling, and known OuteTTS/MOSS failure behavior.
   - Confirm a fresh app-managed venv rebuild occurs by changing the strict marker only after the smoke tests pass.
6. Full ranking gates:
   - For any changed ranked TTS rows, run the full `scripts/run-tts-model-eval.py` suite with ASR round-trip scoring.
   - For any changed ranked STT rows, run the full STT corpus, not a smoke subset.
   - For speaker isolation rankings, rerun the committed speaker-isolation benchmark before changing `src/lib/speakerIsolationEvaluationResults.ts`.

## Implementation Rules For Future Work

- Do not add model rows for upstream-new candidates until the full app path works: download, install, load, generate/transcribe/analyze, error handling, and Testing view status.
- Do not put heavy file-analysis models or speech-to-speech enhancement models on the live dictation path by default.
- Do not present smoke-tested models as ranked Testing view results.
- Use canonical app model IDs and existing provider families where possible; do not duplicate Hugging Face aliases or quantization variants that represent the same capability.
- Keep model artifacts, Hugging Face mirrors, external model-drive copies, manifests, and checksums synchronized in the same work session when a visible model/runtime artifact changes.

## Latency Notes

Documentation and catalog metadata are not hot-path changes. Runtime bumps, streaming changes, live STT models, and audio enhancement changes can affect recording start, stop-to-transcript, or readback latency. Keep model loading cached, downloads outside recording, enhancement benchmarked, and file-analysis work outside the live dictation path unless the user explicitly opts into an experimental mode.
