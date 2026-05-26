# OpenMOSS Model Audit for Vox Jot

Audit date: 2026-05-26

Scope: OpenMOSS-Team Hugging Face collections, plus OpenMOSS-Team model repos that are directly relevant to Vox Jot's STT, TTS, speech analysis, readback, and creative-audio surfaces.

Primary sources:

- https://huggingface.co/OpenMOSS-Team/collections
- `hf collections list --owner OpenMOSS-Team --limit 100 --format json`
- `hf models list --author OpenMOSS-Team --limit 200 --format json`
- Hugging Face model metadata and READMEs for the OpenMOSS speech/audio repos
- Existing Vox Jot catalogs in `src-tauri/src/managers/model.rs`, `src-tauri/src/tts/catalog.rs`, and `src-tauri/src/speech_analysis.rs`
- Existing Vox Jot notes in `docs/mlx-audio-model-hub-audit.md` and `docs/model-evals/moss-audio-4b-instruct.json`

## Executive Verdict

Only one OpenMOSS family is currently safe to treat as app-runnable in Vox Jot: **MOSS-TTS Nano 100M through the existing MLX-Audio catalog entry** (`mlx-community/MOSS-TTS-Nano-100M`, app model id `moss-tts-nano-100m`). It is already implemented, app-path tested, and ranked in the TTS, TTS Style, and Voice Clone views.

The best new OpenMOSS candidates are:

| Priority | Model | Vox Jot surface | Verdict |
| --- | --- | --- | --- |
| P0 | `OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX` | TTS / low-dependency readback | Prototype a native ONNX Runtime path only if it beats or simplifies the existing MLX Nano path. |
| P1 | `OpenMOSS-Team/MOSS-TTS-GGUF` | TTS / readback | Prototype only. It needs a new MOSS-specific llama.cpp plus ONNX-tokenizer runner; Vox Jot's current GGUF runner is LFM-specific. |
| P1 | `OpenMOSS-Team/MOSS-SoundEffect-v2.0` | Studio Sound Design / SFX | Candidate for creative audio, but blocked until an app-managed Apple Silicon runtime validates. Current upstream install is CUDA/Triton-oriented. |
| P2 | `OpenMOSS-Team/MOSS-TTS-Realtime` | Voice-agent readback | Prototype only. Interesting latency claim, but no existing Vox Jot adapter or validated Apple Silicon runtime. |

Do not add MOSS-Audio, full MOSS-TTS 8B/v1.5, MOSS-TTSD, MOSS-Speech, MOSS-Music, MOVA, MOSS-VL, MOSS Video Preview, or OpenMOSS LLM/research rows as usable Vox Jot catalog entries without a working app-managed runtime and app-path validation.

## Current Vox Jot Coverage

| OpenMOSS model | Current Vox Jot state | Evidence |
| --- | --- | --- |
| MOSS-TTS Nano 100M | Implemented through MLX-Audio TTS provider `mlx_moss_tts` and model id `moss-tts-nano-100m`. | `src-tauri/src/tts/catalog.rs` points at `mlx-community/MOSS-TTS-Nano-100M`. |
| MOSS-TTS Nano 100M | Ranked in full TTS hard suite. | `src/lib/ttsEvaluationResults.ts`: rank 11, score 96.7, p50 latency 4573 ms, 5/5 cases. |
| MOSS-TTS Nano 100M | Ranked in style suite. | `src/lib/ttsStyleEvaluationResults.ts`: rank 5, score 91.5, p50 latency 3205 ms, 6/6 cases. |
| MOSS-TTS Nano 100M | Ranked in voice-clone suite. | `src/lib/ttsVoiceCloneEvaluationResults.ts`: rank 2, score 91.5, p50 latency 3552 ms, 4/4 cases. |
| MOSS-Audio 4B Instruct | Previously evaluated and skipped. | `docs/model-evals/moss-audio-4b-instruct.json` marks it CUDA-only with no MLX/Metal/ONNX support. |

Latency impact of this audit: none. This is documentation only. The one existing OpenMOSS runtime path remains outside recording start/stop unless the user selects it for TTS.

## Speech and Audio Families

### MOSS-TTS

| Repo | HF metadata | Size from HF files | Vox Jot fit | Decision |
| --- | --- | ---: | --- | --- |
| `OpenMOSS-Team/MOSS-TTS-Nano-100M` | Apache-2.0, PyTorch/custom code, text-to-speech | ~227 MB | Already runnable via MLX mirror, not direct upstream repo. | Keep shipped through `mlx-community/MOSS-TTS-Nano-100M`. |
| `OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX` | Apache-2.0, ONNX Runtime / ONNX Runtime Web, 48 kHz stereo | ~642 MB | Strong native candidate. Would need a new ONNX inference path and companion tokenizer handling. | Prototype after comparing against MLX Nano. |
| `OpenMOSS-Team/MOSS-TTS-GGUF` | Apache-2.0, llama.cpp backend plus ONNX/TensorRT audio tokenizer | ~65 GB full repo | Plausible but not drop-in. Requires MOSS-specific llama.cpp bridge, audio-tokenizer ONNX assets, and selective quantized downloads. | Prototype only; do not expose yet. |
| `OpenMOSS-Team/MOSS-TTS-Realtime` | Apache-2.0, Transformers/custom code, streaming TTS | ~4.5 GB | Product-relevant for low-latency voice agents, but not supported by Vox Jot's current MLX or native TTS adapters. | Research/prototype. |
| `OpenMOSS-Team/MOSS-TTS` | Apache-2.0, 8B full model, custom PyTorch | ~16.2 GB | Upstream README pins CUDA PyTorch/torchaudio and recommends FlashAttention. Bad fit for Apple Silicon app path. | Blocked unless MLX/ONNX/GGUF runner is validated. |
| `OpenMOSS-Team/MOSS-TTS-v1.5` | Apache-2.0, 31-language full model | ~16.2 GB | Better cloning/multilingual features, but same CUDA-pinned install path as 1.0. | Blocked until a Mac runtime exists. |
| `OpenMOSS-Team/MOSS-TTS-Local-Transformer` | Apache-2.0, custom PyTorch | ~5.9 GB | Existing `docs/mlx-audio-model-hub-audit.md` notes MLX Local Transformer failed due runtime/shape issues. | Do not re-add without a new successful app-path run. |

### MOSS-TTSD and Voice Design

| Repo | HF metadata | Size | Vox Jot fit | Decision |
| --- | --- | ---: | --- | --- |
| `OpenMOSS-Team/MOSS-TTSD-v1.0` | Apache-2.0, text-to-speech/custom code | ~16.0 GB | Voice design / TTS candidate, but heavy and no validated Mac runtime. | Blocked. |
| `OpenMOSS-Team/MOSS-TTSD-v0.7` | Apache-2.0, text-to-speech/custom code | ~3.9 GB | Lighter than v1.0, still custom PyTorch with no app adapter. | Prototype only. |
| `OpenMOSS-Team/MOSS-TTSD-v0.5` | Apache-2.0, text-to-speech/custom code | ~3.9 GB | Historical TTSD row. Existing license notice references it as upstream for Nano, but it is not a current runnable app model. | Keep out of catalog. |
| `OpenMOSS-Team/MOSS-TTSD-v0` | Apache-2.0, text-to-speech | ~3.9 GB | Older baseline. | Skip. |
| `OpenMOSS-Team/MOSS-VoiceGenerator` | Apache-2.0, voice design under MOSS-TTS family | Not collection-listed; HF repo exists | Potential voice-preset generator, not a normal TTS voice. Needs a product surface and runtime. | Research only. |

### MOSS-Audio and Transcription

| Repo / collection item | HF metadata | Size | Vox Jot fit | Decision |
| --- | --- | ---: | --- | --- |
| `OpenMOSS-Team/MOSS-Audio-4B-Instruct` | Apache-2.0, audio-text-to-text, ASR/audio QA/timestamps | ~10.0 GB | Useful for file transcription and audio understanding, not live dictation. Prior manifest marks runtime CUDA-only. | Blocked. |
| `OpenMOSS-Team/MOSS-Audio-4B-Thinking` | Apache-2.0, audio-text-to-text reasoning | ~10.0 GB | Even less appropriate for low-latency dictation; reasoning variant adds latency. | Blocked. |
| `OpenMOSS-Team/MOSS-Audio-8B-Instruct` | Apache-2.0, audio-text-to-text | ~17.3 GB | Too heavy for hot path; no validated Mac runtime. | Blocked. |
| `OpenMOSS-Team/MOSS-Audio-8B-Thinking` | Apache-2.0, audio-text-to-text reasoning | ~17.3 GB | Too heavy and not a dictation model. | Blocked. |
| `OpenMOSS-Team/MOSS-transcribe-diarize` | Space only in collection | N/A | No app-managed model artifact was exposed in the collection. | Cannot integrate as local model. |

MOSS-Audio should not be shown as an STT leaderboard row. It can only be reconsidered for file transcription or audio QA if there is an MLX, ONNX, Metal, or proven MPS sidecar path. It must stay off recording-to-paste hot paths.

### MOSS-Speech

| Repo | HF metadata | Size | Vox Jot fit | Decision |
| --- | --- | ---: | --- | --- |
| `OpenMOSS-Team/MOSS-Speech` | No license in HF metadata, speech-to-speech/custom code | ~17.4 GB | Vox Jot does not currently expose speech-to-speech generation as a production surface. License/runtime unresolved. | Skip. |
| `OpenMOSS-Team/MOSS-Speech-Codec` | No license in HF metadata, ONNX/safetensors/custom code | ~4.8 GB | Codec dependency only, not standalone STT/TTS. | Do not expose directly. |

### Creative Audio and Music

| Repo | HF metadata | Size | Vox Jot fit | Decision |
| --- | --- | ---: | --- | --- |
| `OpenMOSS-Team/MOSS-SoundEffect-v2.0` | Apache-2.0, Diffusers text-to-audio, 48 kHz, up to 30 seconds | ~10.7 GB | Good Studio SFX candidate, but upstream runtime uses CUDA/Triton-oriented install and first-call compilation. | Candidate after app-managed Mac runtime validation. |
| `OpenMOSS-Team/MOSS-SoundEffect` | Apache-2.0, older MOSS-TTS-delay text-to-audio | ~16.0 GB | Superseded by v2.0 and heavier. | Skip in favor of v2.0. |
| `OpenMOSS-Team/MOSS-Music-8B-Instruct` | Apache-2.0, audio-text-to-text/music understanding | ~17.3 GB | Analysis/captioning, not generation. No current Vox Jot music-understanding surface. | Research only. |
| `OpenMOSS-Team/MOSS-Music-8B-Thinking` | Apache-2.0, audio-text-to-text/music reasoning | ~17.3 GB | Reasoning model; latency and runtime are poor fit. | Research only. |
| `OpenMOSS-Team/MOVA-360p` / `MOVA-720p` | Apache-2.0, image/video/audio-video generation | Not measured here | Video generation is outside current Vox Jot model hub surfaces. | Skip for Vox Jot. |

## Non-Speech Collection Families

These collections do not map cleanly to Vox Jot's current runnable surfaces:

| Collection | Items | Vox Jot assessment |
| --- | --- | --- |
| MOSS-VL / MOSS-Video-Preview | Video-text-to-text models | Could only matter for future video/screen analysis. Not STT/TTS/readback. |
| AI Can Learn Scientific Taste | SciJudge models/dataset | Post-processing LLM candidates at best, but domain-specialized and no local app runtime. |
| ABC-Bench | Qwen3-8B/32B ABC coding models | Backend-coding agent models, unrelated to dictation. |
| DiRL | Diffusion language model | Experimental LLM runtime, unrelated to current Vox Jot flows. |
| MOSS / moss-moon | Legacy LLMs, many AGPL | Not appropriate for app-managed local post-processing without conversion and license review. |
| Llama Scope / Lorsa / MHA2MLA | LoRAs/transcoders/attention research | Research artifacts, not standalone user-facing models. |
| Game-RL / RoboOmni / FRoM-W1 / Embodied Planner / FutureOmni | VLM, robotics, forecasting, embodied AI | Outside Vox Jot product surfaces. |

## Recommended Next Steps

1. Keep `moss-tts-nano-100m` as the only production OpenMOSS model in the app until a new candidate passes the app path.
2. Prototype `MOSS-TTS-Nano-100M-ONNX` in a branch only if the goal is to reduce MLX-Audio dependency or improve CPU fallback. Validate voice list/preset/preview through the normal Vox Jot TTS UI before exposing it.
3. Treat `MOSS-TTS-GGUF` as a separate runtime project, not a catalog-only add. It needs selective quantized downloads, companion ONNX tokenizer assets, a MOSS-specific runner, cancellation, progress, and full TTS benchmark coverage.
4. Treat `MOSS-SoundEffect-v2.0` as the only promising OpenMOSS creative-audio candidate. It needs an app-managed Apple Silicon runtime and full `/v1/creative-audio/generate` validation before any Testing rank.
5. Revisit MOSS-Audio only when OpenMOSS or the community publishes an MLX/ONNX/Metal/MPS path. Until then it must not be added as a runnable STT model.

## Validation Notes

Commands run during this audit:

- `hf collections list --owner OpenMOSS-Team --limit 100 --format json`
- `hf models list --author OpenMOSS-Team --limit 200 --format json`
- Hugging Face metadata inspection through `huggingface_hub.HfApi().model_info(..., files_metadata=True)`
- Repo catalog search with `rg` across `src-tauri/src`, `src/lib`, `docs/model-evals`, and model-hub components

No app code, catalog rows, rankings, or model artifacts were changed.
