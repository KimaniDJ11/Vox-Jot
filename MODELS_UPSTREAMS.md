# STT Model Upstreams

This document tracks all upstream Speech-to-Text (STT) model providers for Vox Jot, where to monitor for updates, and why users would choose each model family.

## Purpose

- **Watch List**: Know which upstream providers to monitor for new model releases.
- **Mirror Strategy**: Decide when to pull updates into your pinned model release.
- **User Value**: Understand what each model family offers to Vox Jot users.

## Current Model Families

These are the model families Vox Jot already supports, mirrored in your `v0.1.0-models` release.

| Model Family | Provider | Watch URL | Packaging Feed | Format | License | Why Users Pick This |
|---|---|---|---|---|---|---|
| **Whisper / Wispr** | OpenAI + ggerganov | [OpenAI Whisper](https://github.com/openai/whisper) | [ggerganov/whisper.cpp on HF](https://huggingface.co/ggerganov/whisper.cpp) | GGML `.bin` | MIT | General baseline — multilingual, robust, widely tested |
| **Parakeet V2 & V3** | NVIDIA | [NVIDIA Parakeet on HF](https://huggingface.co/collections/nvidia/parakeet-65f9f0f6c3bde3e0b3a8e10f) | [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | ONNX `.tar.gz` | CC-BY-4.0 | Fast English — optimized for dictation, low latency |
| **Moonshine** | Useful Sensors | [UsefulSensors/moonshine-base](https://huggingface.co/UsefulSensors/moonshine-base) | [UsefulSensors org](https://huggingface.co/UsefulSensors) | ONNX `.tar.gz` | Apache 2.0 | Lightweight on-device — runs fast on edge hardware |
| **SenseVoice** | FunAudioLLM | [FunAudioLLM/SenseVoiceSmall](https://huggingface.co/FunAudioLLM/SenseVoiceSmall) | [FunAudioLLM org](https://huggingface.co/FunAudioLLM) | ONNX `.tar.gz` | MIT | Multilingual + emotion — ASR plus sound event detection |
| **Breeze ASR** | MediaTek Research | [MediaTek-Research/Breeze-ASR-25](https://huggingface.co/MediaTek-Research/Breeze-ASR-25) | [MediaTek org](https://huggingface.co/MediaTek-Research) | GGML `.bin` | CC-BY-NC-4.0 | Mandarin + code-switching — strong for Taiwanese Mandarin |
| **GigaAM V3** | ai-sage | [ai-sage/GigaAM-v3](https://huggingface.co/ai-sage/GigaAM-v3) | [ai-sage org](https://huggingface.co/ai-sage) | ONNX `.tar.gz` | Apache 2.0 | Russian specialist — trained on 700k hours of Russian |

## Expansion Candidates

These providers are worth monitoring for future model additions because they bring new capabilities or user value.

| Provider | Models to Watch | Watch URL | Why Add This | Priority |
|---|---|---|---|---|
| **Mistral AI** | Voxtral (multilingual realtime) | [mistralai/Voxtral-Mini-4B-Realtime-2602](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602) | Next-gen realtime multilingual speech model | 🟢 High |
| **k2-fsa / sherpa-onnx** | Ecosystem of streaming ASR models | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Full local speech stack: VAD, diarization, punctuation | 🟡 Medium |
| **SYSTRAN / faster-whisper** | Optimized Whisper runtime + conversions | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Alternate Whisper backend for speed/memory gains | 🟡 Medium |
| **NVIDIA (more Parakeet)** | Parakeet TDT 110M, 1.1B variants | [NVIDIA Parakeet collection](https://huggingface.co/collections/nvidia/parakeet-65f9f0f6c3bde3e0b3a8e10f) | More size/speed options in family you already support | 🟢 High |
| **Useful Sensors (streaming)** | Moonshine Streaming variants | [UsefulSensors org](https://huggingface.co/UsefulSensors) | Real-time streaming Moonshine for live transcription | 🟢 High |

## Update Policy

### When a Provider Updates a Current Model

1. **Download** the updated asset to a local staging folder.
2. **Record** upstream URL, version/date, file size, and SHA-256 hash.
3. **Test** the model locally with real audio before publishing.
4. **Publish** to a **new pinned model release tag** (e.g., `v0.1.1-models`, `models-2026-03`).
5. **Update** `model.rs` or env base URL only after validation.
6. **Never replace** files in place on existing releases — this breaks reproducibility.

### When a Provider Releases a New Model Version

Treat it as a **new selectable model** in the app, not a silent replacement:

- Keep `Parakeet V3`, add `Parakeet V4`.
- Keep `Moonshine V2 Tiny`, add `Moonshine V3 Tiny`.
- Keep `Wispr Turbo`, add newer Whisper-based option with its own filename and label.

This gives users stability and choice, and prevents workflows from breaking when model behavior changes.

### Release Discipline

- **Stable channel**: `v0.1.0-models` → production users download only from your pinned release.
- **Beta channel**: `models-beta-YYYY-MM` → test fresh upstream changes before promoting.
- **Never use `/releases/latest/download`** for models — always use a fixed tag.
- **App releases use separate tags** — they should not displace model asset URLs.

## Monthly Check Procedure

1. Visit each provider's watch URL (bookmarked or tracked via RSS).
2. Check for new releases, model variants, or updated weights.
3. For any candidate updates:
   - Download to staging.
   - Compute SHA-256.
   - Test in Vox Jot with sample audio.
   - Document changes in behavior or quality.
4. If validated, publish to a new model release tag.
5. Update `MODELS_UPSTREAMS.md` with new provider info if expanding.

## User-Facing Model Categories

When presenting model options to users, group by use case:

- **General baseline**: Whisper/Wispr (multilingual, robust)
- **Fast English**: Parakeet (dictation-optimized)
- **Lightweight on-device**: Moonshine (edge hardware)
- **Multilingual**: SenseVoice, Whisper Large
- **Mandarin + code-switching**: Breeze ASR
- **Russian specialist**: GigaAM
- **Next-gen realtime**: Voxtral (future)

## Mirror Manifest

Keep a `models.lock.json` (future) with:

```json
{
  "parakeet-v3-int8.tar.gz": {
    "source": "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3",
    "mirrored_release": "v0.1.0-models",
    "sha256": "d5c1089f9f73666adfea5d62e15d4e078b911cc9cb1db557c3637fd4b80218cb",
    "upstream_version": "v3.0",
    "status": "stable"
  }
}
```

## Key Principle

**Providers are your source, but your release is the runtime contract.**

Your `v0.1.0-models` release is the stable, curated mirror that users depend on. Upstream providers can change, remove files, or ship broken versions — your job is to test and promote only the good ones into your pinned release.

---

**Last Updated**: March 17, 2026  
**Maintained By**: KimaniDJ11
