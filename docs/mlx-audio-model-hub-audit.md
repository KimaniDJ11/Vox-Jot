# MLX-Audio Model Hub Audit

Audit date: 2026-05-11

Scope: [`Blaizzy/mlx-audio`](https://github.com/Blaizzy/mlx-audio), excluding the Speech-to-Speech section and STS-only models. This covers TTS, STT, VAD, turn detection, and diarization models that could appear in Vox Jot's model hub.

Primary sources:

- [`Blaizzy/mlx-audio` README](https://github.com/Blaizzy/mlx-audio)
- [`mlx-audio` `pyproject.toml`](https://github.com/Blaizzy/mlx-audio/blob/main/pyproject.toml)
- MLX-Audio model READMEs under `mlx_audio/tts/models`, `mlx_audio/stt/models`, and `mlx_audio/vad/models`
- Hugging Face model metadata for the model repos linked below

## Current Vox Jot Coverage

Vox Jot already exposes these MLX-Audio TTS families in `src-tauri/src/tts/catalog.rs`: Kokoro, Chatterbox, Qwen3 TTS base/voice design variants, Dia, CSM, Spark, OuteTTS, Ming Omni Dense 0.5B, KugelAudio, Bark, Fish Audio S2, LFM Audio, Pocket TTS, VoxCPM2, and Voxtral TTS.

Vox Jot already exposes these MLX-Audio STT models in `src-tauri/src/managers/model.rs`: MLX Whisper Large V3 Turbo, Distil-Whisper Large V3, Qwen3 ASR 1.7B, Parakeet v3, Voxtral Mini 3B, and Voxtral Mini 4B Realtime.

Vox Jot also has non-MLX or file-analysis coverage for several adjacent models: native/ONNX Whisper, Parakeet, Moonshine, SenseVoice, GigaAM, plus speech-analysis adapters for Granite, Cohere Transcribe, pyannote, DiariZen, Sortformer v1, Reverb, WhisperX, and Polyvoice.

Important runtime gap: Vox Jot pins the managed MLX-Audio sidecar to `mlx-audio==0.4.2`, while the audited upstream checkout is `0.4.3`. Many newly listed upstream models should be treated as requiring a runtime bump and smoke test before being shown as downloadable.

## Shared Access Requirements

All first-class MLX-Audio model hub entries should use the same access pattern:

- Download public Hugging Face repos by snapshot into Vox Jot's MLX model store.
- Preserve existing local path convention: `MLX/<namespace>/<repo>`.
- Store the canonical HF repo ID in the catalog, not a release asset URL, unless Vox Jot mirrors a converted model.
- Check `config.json` plus at least one `.safetensors` file after download.
- For gated repos, open the model card, require the user to accept terms in Hugging Face, then use Vox Jot's saved HF read token.
- For converted-only models, Vox Jot needs a public mirror repo before the hub entry can be one-click downloadable.

Runtime requirements from MLX-Audio upstream:

- Apple Silicon Mac.
- Python 3.10+.
- `mlx>=0.31.1`, `mlx-lm>=0.31.1`, `huggingface_hub>=1.0`, `transformers>=5.5.0`, `numpy`, `scipy`, `miniaudio`, `sounddevice`, `tqdm`.
- STT/TTS extras need `sentencepiece`; TTS models such as Voxtral need `mistral-common[audio]`.
- `ffmpeg` is only required for MP3/FLAC/OGG/Opus/Vorbis output. WAV output works without it.

## Highest Priority Missing Models

These are the best candidates for model hub work because they are public or clearly documented, fill product gaps, and have a plausible local MLX path.

| Priority | Model                     | Domain                 | Repo                                                                                                                                                                       | Why It Matters                                                                                                                     | Access / Requirements                                                                                                                                                          | Vox Jot Work                                                                                                                                      |
| -------- | ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | LongCat-AudioDiT 1B       | TTS                    | [`mlx-community/LongCat-AudioDiT-1B-4bit`](https://hf.co/mlx-community/LongCat-AudioDiT-1B-4bit), plus bf16/5/6/8-bit variants                                             | Strong EN/ZH diffusion TTS with zero-shot voice cloning. Good missing voice-cloning option.                                        | Public. MIT upstream per MLX-Audio README. Full hard-suite testing keeps 1B 4-bit as the best balance; 3.5B 4-bit improves WER but is slower; 1B bf16 is slower than 1B 4-bit. | `mlx_longcat_audiodit` is implemented. Keep 1B 4-bit as the default-facing LongCat choice unless a newer full suite changes the result.           |
| P0       | Soprano 80M / 1.1 80M     | TTS                    | [`mlx-community/Soprano-80M-4bit`](https://hf.co/mlx-community/Soprano-80M-4bit), [`mlx-community/Soprano-1.1-80M-bf16`](https://hf.co/mlx-community/Soprano-1.1-80M-bf16) | Very small TTS model. Good fast/offline baseline and low disk footprint.                                                           | Public. Apache-2.0 for 80M; 1.1 repo metadata did not expose license in the HF response, so verify before shipping.                                                            | Add `mlx_soprano` provider and simple English model entry. Low-risk TTS path through existing `mlx_audio_generate.py`.                            |
| P0       | MeloTTS English MLX       | TTS                    | [`mlx-community/MeloTTS-English-MLX`](https://hf.co/mlx-community/MeloTTS-English-MLX)                                                                                     | Lightweight MIT English TTS with streaming in upstream README.                                                                     | Public. MIT. English only.                                                                                                                                                     | Add `mlx_melotts` provider. Existing MyShell icon can be reused. Expose speed and basic voice controls only after smoke test.                     |
| P0       | Qwen3 ASR 0.6B            | STT                    | [`mlx-community/Qwen3-ASR-0.6B-8bit`](https://hf.co/mlx-community/Qwen3-ASR-0.6B-8bit)                                                                                     | Smaller Qwen3 ASR option than current 1.7B. Better fit for lower-memory Macs.                                                      | Public. Apache-2.0. Same languages as current Qwen3 ASR family.                                                                                                                | Add `ModelInfo` row and `mlx_audio_stt_model_ref` mapping. Use lower size/speed scores than Parakeet but higher speed than Qwen3 1.7B.            |
| P0       | Qwen3 ForcedAligner       | Alignment / subtitles  | [`mlx-community/Qwen3-ForcedAligner-0.6B-8bit`](https://hf.co/mlx-community/Qwen3-ForcedAligner-0.6B-8bit)                                                                 | Word-level alignment for subtitles and transcript repair. Vox Jot does not currently expose this as a selectable alignment engine. | Public. Apache-2.0. Requires audio plus known text, not normal ASR input.                                                                                                      | Do not add as a live dictation STT model. Add to analysis/export tools as an alignment model with a custom command path.                          |
| P0       | FireRedASR2-AED MLX       | STT                    | [`mlx-community/FireRedASR2-AED-mlx`](https://hf.co/mlx-community/FireRedASR2-AED-mlx)                                                                                     | Mandarin/English ASR and dialect coverage.                                                                                         | Public. HF metadata lacks license, so verify upstream Xiaohongshu license before shipping.                                                                                     | Add as Labs/experimental unless license is confirmed. Requires new STT mapping and benchmark on dictation corpus.                                 |
| P1       | Higgs Audio v2 3B         | TTS                    | [`mlx-community/higgs-audio-v2-3B-mlx-q6`](https://hf.co/mlx-community/higgs-audio-v2-3B-mlx-q6), [`q8`](https://hf.co/mlx-community/higgs-audio-v2-3B-mlx-q8)             | Real-time voice cloning across EN/ZH/KO/DE/ES. Strong Listen feature candidate.                                                    | Public. Apache-2.0. Needs Higgs tokenizer assets; verify `mlx-community/higgs-audio-v2-tokenizer`. Full hard-suite testing showed q8 is substantially better than q6.          | `mlx_higgs_audio` is implemented. Prefer q8. Keep q6 low-priority/manual because ASR round-trip WER was poor, especially on multilingual prompts. |
| P1       | MOSS-TTS Nano 100M        | TTS                    | [`mlx-community/MOSS-TTS-Nano-100M`](https://hf.co/mlx-community/MOSS-TTS-Nano-100M)                                                                                       | Tiny multilingual voice-cloning TTS across 20 languages.                                                                           | Public. Apache-2.0. Needs MOSS audio tokenizer assets.                                                                                                                         | Add `mlx_moss_tts` provider. Start with Nano only. Add tokenizer download preflight.                                                              |
| P1       | Irodori TTS 500M v2       | TTS                    | [`mlx-community/Irodori-TTS-500M-v2-4bit`](https://hf.co/mlx-community/Irodori-TTS-500M-v2-4bit), 8bit/fp16 variants                                                       | Japanese TTS/voice cloning, a language gap in Vox Jot's TTS choices.                                                               | Public. MIT. Japanese.                                                                                                                                                         | Add `mlx_irodori_tts` provider and Aratako/Irodori icon monogram.                                                                                 |
| P1       | IndexTTS 1.5              | TTS                    | [`mlx-community/IndexTTS-1.5`](https://hf.co/mlx-community/IndexTTS-1.5)                                                                                                   | Apache voice-cloning TTS family with modest size.                                                                                  | Public. Apache-2.0.                                                                                                                                                            | Add `mlx_indextts` provider after confirming bridge accepts its generate signature.                                                               |
| P1       | VibeVoice-ASR             | File ASR / diarization | [`mlx-community/VibeVoice-ASR-bf16`](https://hf.co/mlx-community/VibeVoice-ASR-bf16)                                                                                       | Long-form ASR with timestamps and speaker labels. Better fit for file transcription than live dictation.                           | Public. MIT. Heavy 8.3B model. Outputs structured JSON.                                                                                                                        | Add to file transcription / speech analysis, not hot dictation. Parse `segments` into Vox Jot timed segments and speaker turns.                   |
| P1       | Sortformer v2.1 Streaming | Diarization            | [`mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16`](https://hf.co/mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16)                                           | Streaming speaker diarization. Vox Jot currently has Sortformer v1 through NeMo/Python-sidecar, not the MLX streaming v2.1 path.   | Public MLX conversion exists. Upstream README recommends 5-10 second chunks; memory rises quickly with long chunks.                                                            | Add `nemo-sortformer-4spk-v2-1-mlx` analysis engine. Needs MLX VAD/diarization adapter, chunk sizing, and output conversion.                      |

## Useful But Heavier Or More Specialized

| Model                                 | Domain                    | Repo                                                                                                                                                                   | Status                                   | Requirements / Notes                                                                                                                                                                                         |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ming Omni TTS 16.8B A3B               | TTS                       | [`mlx-community/Ming-omni-tts-16.8B-A3B-bf16`](https://hf.co/mlx-community/Ming-omni-tts-16.8B-A3B-bf16)                                                               | Labs only                                | Public Apache-2.0 but huge. Requires high-memory Apple Silicon. Keep hidden unless device memory check passes. Vox Jot already exposes smaller Ming Omni 0.5B.                                               |
| MOSS-TTS / MOSS-TTS Local Transformer | TTS                       | [`OpenMOSS-Team/MOSS-TTS`](https://hf.co/OpenMOSS-Team/MOSS-TTS), [`OpenMOSS-Team/MOSS-TTS-Local-Transformer`](https://hf.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer) | Blocked                                  | Public Apache-2.0, 8.5B / 3.1B parameter class. Both downloaded, but both failed the hard suite because mlx-audio could not determine the model type. Keep disabled until bridge support exists.             |
| VibeVoice Realtime 0.5B MLX           | TTS                       | [`mlx-community/VibeVoice-Realtime-0.5B-4bit`](https://hf.co/mlx-community/VibeVoice-Realtime-0.5B-4bit)                                                               | Candidate, compare with existing runtime | Public MIT. Vox Jot already has a separate VibeVoice speech runtime; the MLX variant may simplify Apple Silicon setup but should be benchmarked before duplicating the hub entry.                            |
| OmniVoice                             | TTS                       | [`k2-fsa/OmniVoice`](https://hf.co/k2-fsa/OmniVoice)                                                                                                                   | Tested                                   | Public Apache-2.0, 646+ language tags and voice cloning. The `mlx-community/OmniVoice-bf16` mirror produced silent WAVs because its audio tokenizer lacked semantic encoder weights; the upstream `k2-fsa/OmniVoice` snapshot emits non-silent audio and passed full hard/clone suites. |
| Qwen2-Audio 7B Instruct 4bit          | Audio understanding / STT | [`mlx-community/Qwen2-Audio-7B-Instruct-4bit`](https://hf.co/mlx-community/Qwen2-Audio-7B-Instruct-4bit)                                                               | Prototype                                | Public Apache-2.0, about 4.2 GB. Supports transcription, translation, emotion, captioning, and audio QA. Needs prompt-aware UI/API; not a plain live dictation model.                                        |
| Granite Speech 4.0 1B                 | STT / translation         | [`ibm-granite/granite-4.0-1b-speech`](https://hf.co/ibm-granite/granite-4.0-1b-speech)                                                                                 | Candidate, but overlap                   | Public Apache-2.0. MLX-Audio supports it directly; Vox Jot already has Granite 4.1 2B via Transformers speech analysis. Add only if MLX path is faster or more reliable.                                     |
| Cohere Transcribe 03-2026             | STT                       | [`CohereLabs/cohere-transcribe-03-2026`](https://hf.co/CohereLabs/cohere-transcribe-03-2026)                                                                           | Partial existing access                  | Apache-2.0 but gated. Vox Jot already exposes it in speech analysis, not live STT. Requires accepted HF terms and saved read token.                                                                          |
| Canary 1B v2                          | STT / translation         | [`nvidia/canary-1b-v2`](https://hf.co/nvidia/canary-1b-v2)                                                                                                             | Needs conversion/mirror                  | Public CC-BY-4.0. MLX-Audio README says weights must be converted from `.nemo`; no `mlx-community` converted repo was found during this audit. Need create/publish mirror or run conversion at install time. |
| MMS 1B all / fl102                    | STT                       | [`facebook/mms-1b-all`](https://hf.co/facebook/mms-1b-all), [`facebook/mms-1b-fl102`](https://hf.co/facebook/mms-1b-fl102)                                             | Skip or research-only                    | CC-BY-NC-4.0. Useful for 1000+ languages, but non-commercial license and adapter complexity make it a poor default hub entry.                                                                                |
| Smart Turn v3                         | Turn detection            | [`mlx-community/smart-turn-v3`](https://hf.co/mlx-community/smart-turn-v3)                                                                                             | Future UX feature                        | BSD-2-Clause. Endpoint/turn-completion detector, not STT/TTS. It belongs in always-on conversation controls, not model selection for dictation.                                                              |
| MLX Silero VAD                        | VAD                       | [`mlx-community/silero-vad`](https://hf.co/mlx-community/silero-vad)                                                                                                   | Low priority                             | Vox Jot already bundles Silero VAD ONNX. Only add if the MLX runtime gives measurable latency or packaging benefits.                                                                                         |

## Existing Families With Missing Variants

These do not require new provider families, but Vox Jot does not expose all useful MLX-Audio variants yet.

| Family        | Missing Useful Variants                                                                                       | Why Add                                                                                                                        | Requirements                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Qwen3 TTS     | None for now. Keep the reduced active set only: 0.6B Base, 0.6B 4-bit, 1.7B VoiceDesign, and 1.7B Base 8-bit. | The duplicate CustomVoice/Base rows created catalog clutter and duplicate disk downloads.                                      | Do not re-add removed Qwen duplicate rows or folders unless a full benchmark proves a distinct capability. |
| Dia           | 3/4/6-bit variants                                                                                            | Lower-memory Dia.                                                                                                              | Same provider; test quality before exposing.                                                               |
| CSM           | `csm-1b-fp16`, `csm-1b-8bit`                                                                                  | Quantized voice-cloning choice.                                                                                                | Same provider; validate default prompt/reference flow.                                                     |
| Spark         | `Spark-TTS-0.5B-4-6bit`                                                                                       | Smaller Spark option.                                                                                                          | License is CC-BY-NC-SA-4.0, so mark clearly.                                                               |
| VoxCPM2       | 8-bit and bf16 are implemented.                                                                               | Full hard-suite testing shows 8-bit outscored both older 4-bit and bf16 rows.                                                  | Prefer 8-bit. Keep bf16 as high-memory/manual, not as the default.                                         |
| Voxtral TTS   | 4-bit and 6-bit                                                                                               | Current catalog points to bf16 and local-dir fallback includes 6-bit, but 4-bit should be selectable if license policy allows. | CC-BY-NC-4.0; add non-commercial warning.                                                                  |
| Fish Audio S2 | 8-bit                                                                                                         | Lower-memory Fish Audio.                                                                                                       | License metadata is `other`; verify before broad shipping.                                                 |

## Models To Avoid For Now

| Model                                           | Reason                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Echo TTS                                        | [`mlx-community/echo-tts-base`](https://hf.co/mlx-community/echo-tts-base) is CC-BY-NC-SA-4.0. Not suitable for a general commercial app hub without a clear non-commercial gate.  |
| TADA 1B                                         | [`HumeAI/mlx-tada-1b`](https://hf.co/HumeAI/mlx-tada-1b) uses Llama 3.2 Community License. Keep Labs-only until legal/product policy is explicit.                                  |
| Kitten TTS                                      | MLX-Audio has code, but no stable `mlx-community` converted repo was found. Needs conversion and a mirror before one-click download.                                               |
| Chatterbox Turbo                                | Upstream `ResembleAI/chatterbox-turbo` is MIT, but no ready MLX repo was found. MLX-Audio has conversion code; create a converted mirror first.                                    |
| GLM-ASR / LASR CTC / generic wav2vec code paths | Implemented in code or referenced internally, but no stable README + model repo path was found in the audited upstream tree. Treat as code support, not hub-ready catalog entries. |

## Model Hub Data Needed Per Entry

For each new model, add or derive:

- `id`: stable Vox Jot ID such as `mlx-longcat-audiodit-1b-4bit`.
- `provider_id`: family provider, not just `stt_mlx_audio`.
- `hf_model_id`: canonical Hugging Face repo.
- `local_dir_names`: repo folder names and known legacy aliases.
- `label`, `description`, `license_label`, `supported_languages`.
- `size_mb`: from HF repo file sizes or dry-run download.
- `capabilities`: streaming, cloning, instruction prompt, inline tags, translation, timestamps, diarization.
- `readiness_issues`: gated, non-commercial, high-memory, custom adapter, conversion required.
- `icon`: ProviderIcon provider mapping and display name.

Icon/provider additions recommended:

- `mlx_longcat_audiodit` -> LongCat/Meituan letter mark.
- `mlx_higgs_audio` -> BosonAI/Higgs letter mark.
- `mlx_moss_tts` -> OpenMOSS letter mark.
- `mlx_soprano` -> Soprano letter mark.
- `mlx_melotts` -> reuse MyShell.
- `mlx_irodori_tts` -> Irodori/Aratako letter mark.
- `mlx_indextts` -> IndexTeam letter mark.
- `mlx_omnivoice` -> k2-fsa or OmniVoice letter mark.
- `stt_cohere` -> Cohere letter mark if Cohere is ever shown outside analysis.
- `stt_granite` -> IBM/Granite letter mark if Granite gets a live MLX entry.

Do not bundle external brand logos unless their license permits it. Vox Jot's existing `ProviderIcon` pattern works well with custom SVG marks or high-contrast letter marks.

## Implementation Plan

1. Runtime first:
   - Bump managed MLX-Audio sidecar from `0.4.2` to `0.4.3` or a pinned commit after model smoke tests.
   - Keep the setup marker strict so users get a clean venv rebuild.
   - Add optional extras needed for the chosen first wave: `sentencepiece`, `mistral-common[audio]`, and any model-specific tokenizer deps.

2. Catalog first wave:
   - Add P0 TTS: LongCat 1B 4-bit, Soprano 80M 4-bit, MeloTTS English.
   - Add P0 STT: Qwen3 ASR 0.6B and FireRedASR2 if license clears.
   - Add analysis-only: Qwen3 ForcedAligner and Sortformer v2.1.

3. Adapter work:
   - Plain TTS models can use `src-tauri/resources/python/mlx_audio_generate.py` if their `generate()` signature accepts Vox Jot's existing kwargs.
   - Models with custom APIs need explicit branches in the bridge rather than generic kwargs.
   - Alignment, VibeVoice-ASR, Qwen2-Audio, Smart Turn, and Sortformer v2.1 need dedicated commands or speech-analysis adapters.

4. UI work:
   - Add provider icons/display names before adding catalog rows so hub cards do not collapse to generic branding.
   - Show warnings for gated, non-commercial, high-memory, and Labs-only entries.
   - Keep filtering by language/provider compatible with existing `ModelHubSection` behavior.

5. Validation:
   - For live dictation STT, benchmark cold-load, warm transcription, stop-to-transcript latency, and WER on the spelling corpus.
   - For TTS, run the complete `scripts/run-tts-model-eval.py` hard suite with ASR round-trip scoring before ranking a model. Smoke tests are only for readiness checks.
   - For file-analysis models, test on `test-data/file-transcription-samples`.
   - Do not put heavy file-analysis models on the live dictation hot path.

## Latency Notes

Adding catalog metadata is not a hot-path change. Loading or selecting a new MLX model can be hot-path if it is used for live dictation. For live dictation, default to small/quantized models and keep heavyweight models such as VibeVoice-ASR, Ming Omni 16.8B, MOSS 8B, Qwen2-Audio, and Canary translation out of the recording-to-paste path unless the user explicitly selects an experimental model and accepts the latency tradeoff.

The highest-latency risks are model cold start, large HF downloads, tokenizer side downloads, file-analysis chunking, and generic bridge retries. These should be cached, preflighted, and kept outside recording start/stop handling.
