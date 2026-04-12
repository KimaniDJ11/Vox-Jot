# Vox Jot Model Scorecard

Scores applied from `docs/model-porting-rubric.md`.
All models listed here are already integrated and shipping.
The rubric surfaces relative strengths, integration lane, and known weaknesses.

**Scoring dimensions (abbreviated column headers below):**

| # | Column | Weight |
|---|--------|--------|
| 1 | Lic — License | ×4 |
| 2 | Mac — Mac runtime lane | ×4 |
| 3 | Dom — Domain fit | ×3 |
| 4 | Res — Resource budget | ×3 |
| 5 | Pkg — Packaging ease | ×2 |
| 6 | Str — Streaming support | ×1 |
| 7 | Lng — Language coverage | ×1 |
| 8 | Com — Community health | ×1 |
| 9 | Clo — Voice cloning (TTS only) | ×1 |

**STT max: 52** (voice cloning N/A = 0 for all STT models)
**TTS max: 60**

Score bands: **45+ Ship · 30–44 Experimental · 18–29 Prototype · <18 Skip**

---

## Speech-to-Text (STT) Models

| Model | Lane | Lic | Mac | Dom | Res | Pkg | Str | Lng | Com | Clo | **Total** | Verdict |
|-------|------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----------|---------|
| Whisper Small | Metal/GGUF | 12 | 12 | 9 | 9 | 6 | 0 | 3 | 3 | — | **54** | Ship |
| Parakeet V3 | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 0 | 3 | 3 | — | **54** | Ship |
| MLX Parakeet V3 | MLX native | 12 | 12 | 9 | 9 | 6 | 0 | 3 | 3 | — | **54** | Ship |
| Moonshine V2 Tiny | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 3 | 0 | 2 | — | **53** | Ship |
| Moonshine V2 Small | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 3 | 0 | 2 | — | **53** | Ship |
| Moonshine V2 Medium | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 3 | 0 | 2 | — | **53** | Ship |
| SenseVoice | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 0 | 2 | 2 | — | **52** | Ship |
| Whisper Medium | Metal/GGUF | 12 | 12 | 9 | 6 | 6 | 0 | 3 | 3 | — | **51** | Ship |
| Whisper Turbo | Metal/GGUF | 12 | 12 | 9 | 6 | 6 | 0 | 3 | 3 | — | **51** | Ship |
| Parakeet V2 | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 0 | 0 | 3 | — | **51** | Ship |
| GigaAM v3 | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 0 | 1 | 2 | — | **51** | Ship |
| MLX Whisper Turbo | MLX native | 12 | 12 | 9 | 6 | 6 | 0 | 3 | 3 | — | **51** | Ship |
| MLX Distil-Whisper | MLX native | 12 | 12 | 9 | 9 | 6 | 0 | 0 | 3 | — | **51** | Ship |
| Moonshine Base | ONNX/Rust | 12 | 12 | 9 | 9 | 6 | 0 | 0 | 2 | — | **50** | Ship |
| MLX Qwen3 ASR | MLX native | 12 | 12 | 9 | 6 | 6 | 0 | 2 | 2 | — | **49** | Ship |
| Whisper Large | Metal/GGUF | 12 | 12 | 9 | 3 | 6 | 0 | 3 | 3 | — | **48** | Ship |
| Breeze ASR | Metal/GGUF | 12 | 12 | 9 | 3 | 6 | 0 | 1 | 2 | — | **45** | Ship |
| Qwen2 Audio 7B | Sidecar (pending) | 12 | 4 | 9 | 0 | 2 | 1 | 1 | 2 | — | **31** | Experimental |

### STT notes

**Top tier (54):** Whisper Small, Parakeet V3, and MLX Parakeet V3 are the three models that score identically — fast enough, well-packaged, broad language coverage. Parakeet V3 is the recommended default for a reason.

**Streaming advantage (+3):** The three Moonshine V2 models are the only STT models with real-time streaming. That single point flips them ahead of Parakeet V2 despite narrower language coverage.

**GigaAM (51):** Sole Russian-specialized model. The language score (1) reflects narrow coverage but it fills a unique gap — don't let the number suggest weakness in its intended use case.

**Qwen2 Audio 7B (31 / Experimental):** 14 GB with no download URL yet. Sits in Experimental correctly — great ceiling, not ready.

**Breeze ASR (45):** Just hits the Ship threshold. Resource score hurts (1.08 GB, slower), and language score (1) reflects its Taiwanese Mandarin specialization. Still ships because it's the only model filling that niche.

---

## Text-to-Speech (TTS) Models

### MLX-native (macOS Apple Silicon — Lane A)

| Model | Lic | Mac | Dom | Res | Pkg | Str | Lng | Com | Clo | **Total** | Verdict |
|-------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----------|---------|
| MLX Qwen3 TTS 0.6B | 12 | 12 | 9 | 9 | 6 | 3 | 2 | 2 | 3 | **58** | Ship |
| MLX Ming Omni 0.5B | 12 | 12 | 9 | 9 | 6 | 3 | 1 | 2 | 3 | **57** | Ship |
| MLX Kokoro 82M | 12 | 12 | 9 | 9 | 6 | 3 | 2 | 3 | 0 | **56** | Ship |
| MLX CSM 1B | 12 | 12 | 9 | 9 | 6 | 3 | 0 | 2 | 3 | **56** | Ship |
| MLX Qwen3 TTS 1.7B | 12 | 12 | 9 | 6 | 6 | 3 | 2 | 2 | 3 | **55** | Ship |
| MLX Spark TTS 0.5B | 12 | 12 | 9 | 9 | 6 | 3 | 1 | 2 | 0 | **54** | Ship |
| MLX Chatterbox | 12 | 12 | 9 | 6 | 6 | 3 | 3 | 2 | 0 | **53** | Ship |
| MLX OuteTTS 0.6B | 12 | 12 | 9 | 9 | 6 | 3 | 0 | 2 | 0 | **53** | Ship |
| MLX Voxtral TTS 4B | 12 | 12 | 9 | 3 | 6 | 3 | 2 | 3 | 0 | **50** | Ship |
| MLX Dia 1.6B | 12 | 12 | 9 | 6 | 6 | 3 | 0 | 2 | 0 | **50** | Ship |
| MLX KugelAudio 7B | 8 | 12 | 9 | 3 | 6 | 3 | 3 | 2 | 0 | **46** | Ship |

### MLX-native notes

**MLX Qwen3 TTS 0.6B (58):** Highest overall score in the entire app. Tiny, fast, streaming, voice cloning, instruction control, multilingual. The only thing holding it from 60 is language coverage (zh/en/ja/ko only).

**MLX Ming Omni 0.5B (57):** Same profile as Qwen3 0.6B but en/zh only — one fewer language point. The style-control + cloning combination makes it the best model for expressive readback.

**MLX KugelAudio 7B (46):** License listed as `None` in source (license_label not set) — scored conservatively at 2. Heaviest MLX model at 7B. Still ships because it's the only model covering 23 European languages for TTS.

**MLX Voxtral TTS 4B (50):** Largest readily-licensed MLX model. Resource score hurts (4B) but Mistral's community backing (com=3) and 9-language coverage keep it in Ship territory.

---

### Managed sidecar (Legacy Python runtime — Lane C)

| Model | Lic | Mac | Dom | Res | Pkg | Str | Lng | Com | Clo | **Total** | Verdict |
|-------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----------|---------|
| Kokoro 82M | 12 | 8 | 9 | 9 | 4 | 0 | 2 | 3 | 0 | **47** | Ship |
| OpenVoice | 12 | 8 | 9 | 6 | 4 | 0 | 2 | 2 | 3 | **46** | Ship |
| Chatterbox | 12 | 8 | 9 | 6 | 4 | 0 | 0 | 2 | 0 | **41** | Ship |
| Fish Speech 1.5 | 4 | 8 | 9 | 6 | 4 | 2 | 3 | 2 | 3 | **41** | Ship |
| XTTS v2 | 4 | 8 | 9 | 6 | 4 | 0 | 3 | 2 | 3 | **39** | Experimental |

### Managed sidecar notes

**Kokoro 82M sidecar (47):** Same model as MLX Kokoro but running in the legacy Python runtime — loses 9 points (Mac lane 2 vs 3, no streaming, packaging 2 vs 3). The MLX variant is strictly better on Apple Silicon.

**XTTS v2 (39):** Coqui Public Model License restricts commercial use — drops the license dimension to 1 (×4 = 4). Still ships experimentally because it's the legacy cloning option for the few users on Intel or who explicitly choose it. On M4 Pro, the MLX cloning options (Qwen3, CSM, Ming Omni) are all better.

**Fish Speech 1.5 (41):** Fish Audio Research License is also commercially restrictive (1×4=4), same licensing hit as XTTS. Partial streaming (2) and broad multilingual support push it above XTTS despite the same license score.

---

### Native / built-in (Lane B and system)

| Model | Lic | Mac | Dom | Res | Pkg | Str | Lng | Com | Clo | **Total** | Verdict |
|-------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----------|---------|
| Sherpa ONNX (zh+en Melo) | 12 | 12 | 9 | 9 | 6 | 0 | 1 | 2 | 0 | **51** | Ship |
| Sherpa ONNX (en-US Lessac) | 12 | 12 | 9 | 9 | 6 | 0 | 0 | 2 | 0 | **50** | Ship |
| macOS System (`say`) | 8 | 12 | 9 | 9 | 6 | 0 | 3 | 3 | 0 | **50** | Ship |
| Qwen3 Native | 12 | 12 | 9 | 6 | 6 | 3 | 3 | 2 | 3 | **56** | Ship |

### Built-in notes

**Qwen3 Native (56):** Scored alongside MLX since it uses the same mlx-audio path — multilingual, streaming, cloning, instruction prompts. Strong second place behind MLX Qwen3 TTS 0.6B.

**macOS System (50):** License scored 2 because it's proprietary (can't redistribute or bundle). Everything else is perfect — zero download, zero VRAM, works on all Macs including Intel.

**Sherpa ONNX models (50–51):** Fastest cold-start of any TTS option. ONNX loaded natively in Rust. The right fallback when no sidecar runtime is available.

---

## Full rankings (all models, highest to lowest)

| Rank | Model | Domain | Score | Verdict |
|------|-------|--------|-------|---------|
| 1 | MLX Qwen3 TTS 0.6B | TTS | 58 | Ship |
| 2 | MLX Ming Omni 0.5B | TTS | 57 | Ship |
| 3 | Qwen3 Native | TTS | 56 | Ship |
| 4 | MLX Kokoro 82M | TTS | 56 | Ship |
| 5 | MLX CSM 1B | TTS | 56 | Ship |
| 6 | MLX Qwen3 TTS 1.7B | TTS | 55 | Ship |
| 7 | Whisper Small | STT | 54 | Ship |
| 8 | Parakeet V3 | STT | 54 | Ship |
| 9 | MLX Parakeet V3 | STT | 54 | Ship |
| 10 | MLX Spark TTS 0.5B | TTS | 54 | Ship |
| 11 | MLX Chatterbox | TTS | 53 | Ship |
| 12 | MLX OuteTTS 0.6B | TTS | 53 | Ship |
| 13 | Moonshine V2 Tiny | STT | 53 | Ship |
| 14 | Moonshine V2 Small | STT | 53 | Ship |
| 15 | Moonshine V2 Medium | STT | 53 | Ship |
| 16 | SenseVoice | STT | 52 | Ship |
| 17 | Sherpa ONNX zh+en | TTS | 51 | Ship |
| 18 | Whisper Medium | STT | 51 | Ship |
| 19 | Whisper Turbo | STT | 51 | Ship |
| 20 | Parakeet V2 | STT | 51 | Ship |
| 21 | GigaAM v3 | STT | 51 | Ship |
| 22 | MLX Whisper Turbo | STT | 51 | Ship |
| 23 | MLX Distil-Whisper | STT | 51 | Ship |
| 24 | MLX Voxtral TTS 4B | TTS | 50 | Ship |
| 25 | MLX Dia 1.6B | TTS | 50 | Ship |
| 26 | Moonshine Base | STT | 50 | Ship |
| 27 | macOS System (`say`) | TTS | 50 | Ship |
| 28 | Sherpa ONNX en-US | TTS | 50 | Ship |
| 29 | MLX Qwen3 ASR | STT | 49 | Ship |
| 30 | Kokoro 82M (sidecar) | TTS | 47 | Ship |
| 31 | MLX KugelAudio 7B | TTS | 46 | Ship |
| 32 | OpenVoice | TTS | 46 | Ship |
| 33 | Whisper Large | STT | 48 | Ship |
| 34 | Chatterbox (sidecar) | TTS | 41 | Ship |
| 35 | Fish Speech 1.5 | TTS | 41 | Ship |
| 36 | XTTS v2 | TTS | 39 | Experimental |
| 37 | Breeze ASR | STT | 45 | Ship |
| 38 | Qwen2 Audio 7B | STT | 31 | Experimental |

---

## Key takeaways

**MLX models sweep the top of TTS.** Every MLX provider scores ≥50 due to
perfect Mac runtime (3×4=12) plus real-time streaming (+3). If a user is on
M-series Apple Silicon, these should always be offered first.

**Licensing is the main differentiator for sidecar models.** XTTS v2 and
Fish Speech both drop from probable 50s to 39–41 purely because their licenses
are non-permissive. Keep them behind a "I accept" gate in the UI.

**STT models are tightly clustered (45–54).** The Moonshine streaming bonus is
the main separator — three models jump from ~49 to 53 purely by supporting
real-time output. Language coverage is the next differentiator.

**Two models to watch:** Qwen2 Audio 7B (31) once it gets a download URL and
resource profile, and VoxCPM2 (36, currently skipped) once a Mac runtime path
appears — both have the domain fit and feature set to reach 50+.
