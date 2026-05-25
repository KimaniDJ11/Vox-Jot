import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProviderIcon, resolveModelProviderId } from "./ProviderIcon";

describe("resolveModelProviderId", () => {
  it("uses the model family for STT engines that host third-party weights", () => {
    expect(resolveModelProviderId("Breeze ASR breeze-asr", "stt_whisper")).toBe(
      "mediatek",
    );
    expect(
      resolveModelProviderId("Voxtral Mini 4B Realtime", "stt_mlx_audio"),
    ).toBe("mistral");
    expect(resolveModelProviderId("Parakeet V3 MLX", "stt_mlx_audio")).toBe(
      "stt_parakeet",
    );
  });

  it("keeps family-specific TTS provider ids for company-branded icons", () => {
    expect(resolveModelProviderId("LFM2.5 Audio 1.5B", "mlx_lfm_audio")).toBe(
      "mlx_lfm_audio",
    );
    expect(resolveModelProviderId("VibeVoice Realtime 0.5B", "vibevoice")).toBe(
      "vibevoice",
    );
    expect(resolveModelProviderId("Pocket TTS 4-bit", "mlx_pocket_tts")).toBe(
      "mlx_pocket_tts",
    );
  });

  it("resolves OCR vendors from catalog titles", () => {
    expect(resolveModelProviderId("PaddlePaddle PaddleOCR-VL", "generic")).toBe(
      "paddlepaddle",
    );
    expect(resolveModelProviderId("Allen AI olmOCR-2 7B", "generic")).toBe(
      "ai2",
    );
    expect(resolveModelProviderId("NVIDIA Nemotron OCR v2", "generic")).toBe(
      "nvidia",
    );
  });

  it("resolves the built-in Vox Jot dictation engine to the app mark", () => {
    expect(
      resolveModelProviderId("Vox Jot Current Dictation Engine", "generic"),
    ).toBe("vox_jot");
  });

  it("resolves creative audio model families to branded icons", () => {
    expect(resolveModelProviderId("MusicGen Small", "musicgen")).toBe(
      "musicgen",
    );
    expect(resolveModelProviderId("AudioLDM 2", "audioldm2")).toBe("audioldm2");
    expect(resolveModelProviderId("AudioLDM 2 Music", "audioldm2_music")).toBe(
      "audioldm2_music",
    );
  });

  it("covers every built-in model family with a company/provider icon id", () => {
    const cases: Array<{
      title: string;
      runtimeProviderId: string;
      expected: string;
    }> = [
      // STT
      {
        title: "Whisper Large",
        runtimeProviderId: "stt_whisper",
        expected: "stt_whisper",
      },
      {
        title: "Breeze ASR",
        runtimeProviderId: "stt_whisper",
        expected: "mediatek",
      },
      {
        title: "Parakeet V3",
        runtimeProviderId: "stt_parakeet",
        expected: "stt_parakeet",
      },
      {
        title: "Moonshine V2 Small",
        runtimeProviderId: "stt_moonshine_streaming",
        expected: "stt_moonshine",
      },
      {
        title: "SenseVoice",
        runtimeProviderId: "stt_sensevoice",
        expected: "stt_sensevoice",
      },
      {
        title: "GigaAM v3",
        runtimeProviderId: "stt_gigaam",
        expected: "stt_gigaam",
      },
      {
        title: "Qwen3 ASR MLX",
        runtimeProviderId: "stt_mlx_audio",
        expected: "stt_qwen",
      },
      {
        title: "mlx-community/Qwen3-ASR-1.7B-8bit mlx-qwen3-asr",
        runtimeProviderId: "stt_mlx_audio",
        expected: "stt_qwen",
      },
      {
        title: "Voxtral Mini 3B",
        runtimeProviderId: "stt_mlx_audio",
        expected: "mistral",
      },
      {
        title: "FireRedASR2 AED (MLX)",
        runtimeProviderId: "stt_mlx_audio",
        expected: "firered",
      },
      {
        title: "Apple Speech",
        runtimeProviderId: "stt_apple_speech",
        expected: "apple",
      },
      {
        title: "Current Dictation Engine Vox Jot",
        runtimeProviderId: "generic",
        expected: "vox_jot",
      },
      {
        title: "Polyvoice ONNX Diarization",
        runtimeProviderId: "generic",
        expected: "polyvoice",
      },
      {
        title: "Wespeaker voxceleb ResNet34 embeddings",
        runtimeProviderId: "generic",
        expected: "wespeaker",
      },

      // TTS
      {
        title: "OpenVoice",
        runtimeProviderId: "openvoice",
        expected: "openvoice",
      },
      {
        title: "Chatterbox",
        runtimeProviderId: "chatterbox",
        expected: "chatterbox",
      },
      {
        title: "Supertonic 3",
        runtimeProviderId: "supertonic",
        expected: "supertonic",
      },
      {
        title: "Supertone/supertonic-3",
        runtimeProviderId: "generic",
        expected: "supertonic",
      },
      { title: "Kokoro 82M", runtimeProviderId: "kokoro", expected: "kokoro" },
      { title: "XTTS v2", runtimeProviderId: "xtts", expected: "xtts" },
      {
        title: "Qwen3 0.6B Base",
        runtimeProviderId: "qwen3_native",
        expected: "qwen3_native",
      },
      {
        title: "Qwen3 TTS 1.7B",
        runtimeProviderId: "mlx_qwen3tts",
        expected: "mlx_qwen3tts",
      },
      { title: "Dia 1.6B", runtimeProviderId: "mlx_dia", expected: "mlx_dia" },
      { title: "CSM 1B", runtimeProviderId: "mlx_csm", expected: "mlx_csm" },
      {
        title: "Spark TTS 0.5B",
        runtimeProviderId: "mlx_spark",
        expected: "mlx_spark",
      },
      {
        title: "Llama OuteTTS 1B 4-bit",
        runtimeProviderId: "mlx_oute",
        expected: "mlx_oute",
      },
      {
        title: "Ming Omni 0.5B",
        runtimeProviderId: "mlx_ming_omni",
        expected: "mlx_ming_omni",
      },
      {
        title: "KugelAudio 7B",
        runtimeProviderId: "mlx_kugel",
        expected: "mlx_kugel",
      },
      {
        title: "Bark Small",
        runtimeProviderId: "mlx_bark",
        expected: "mlx_bark",
      },
      {
        title: "Fish Audio S2 Pro",
        runtimeProviderId: "mlx_fish_audio",
        expected: "mlx_fish_audio",
      },
      {
        title: "LFM2.5 Audio 1.5B",
        runtimeProviderId: "mlx_lfm_audio",
        expected: "mlx_lfm_audio",
      },
      {
        title: "LongCat AudioDiT 3.5B 4-bit",
        runtimeProviderId: "mlx_longcat_audiodit",
        expected: "mlx_longcat_audiodit",
      },
      {
        title: "Soprano 80M 4-bit",
        runtimeProviderId: "mlx_soprano",
        expected: "mlx_soprano",
      },
      {
        title: "MeloTTS English",
        runtimeProviderId: "mlx_melotts",
        expected: "mlx_melotts",
      },
      {
        title: "Pocket TTS 4-bit",
        runtimeProviderId: "mlx_pocket_tts",
        expected: "mlx_pocket_tts",
      },
      {
        title: "VoxCPM2 4-bit",
        runtimeProviderId: "mlx_voxcpm",
        expected: "mlx_voxcpm",
      },
      {
        title: "Voxtral TTS 4B",
        runtimeProviderId: "mlx_voxtral_tts",
        expected: "mlx_voxtral_tts",
      },
      {
        title: "VibeVoice Realtime 0.5B",
        runtimeProviderId: "vibevoice",
        expected: "vibevoice",
      },
      {
        title: "MOSS-TTS Nano 100M",
        runtimeProviderId: "mlx_moss_tts",
        expected: "mlx_moss_tts",
      },
      {
        title: "Irodori TTS 500M v2 4-bit",
        runtimeProviderId: "mlx_irodori_tts",
        expected: "mlx_irodori_tts",
      },
      {
        title: "IndexTTS 1.5",
        runtimeProviderId: "mlx_indextts",
        expected: "mlx_indextts",
      },
      {
        title: "System Voices",
        runtimeProviderId: "system_builtin",
        expected: "system_builtin",
      },
      {
        title: "Sherpa Pack",
        runtimeProviderId: "sherpa_pack",
        expected: "sherpa_pack",
      },

      // OCR
      {
        title: "PaddlePaddle PP-OCRv5",
        runtimeProviderId: "generic",
        expected: "paddlepaddle",
      },
      {
        title: "PaddlePaddle PaddleOCR-VL",
        runtimeProviderId: "generic",
        expected: "paddlepaddle",
      },
      {
        title: "LightOn LightOnOCR-2 1B",
        runtimeProviderId: "generic",
        expected: "lighton",
      },
      {
        title: "datalab.to Chandra OCR 2",
        runtimeProviderId: "generic",
        expected: "datalab",
      },
      {
        title: "Dots Dots.OCR",
        runtimeProviderId: "generic",
        expected: "dots",
      },
      {
        title: "Allen AI olmOCR-2 7B",
        runtimeProviderId: "generic",
        expected: "ai2",
      },
      {
        title: "DeepSeek DeepSeek-OCR 2",
        runtimeProviderId: "generic",
        expected: "deepseek",
      },
      { title: "Zhipu GLM-OCR", runtimeProviderId: "generic", expected: "zai" },
      {
        title: "Alibaba Qwen2.5-VL 3B Instruct",
        runtimeProviderId: "generic",
        expected: "qwen",
      },
      {
        title: "NVIDIA Nemotron OCR v2",
        runtimeProviderId: "generic",
        expected: "nvidia",
      },
      {
        title: "Tesseract tessdata_best",
        runtimeProviderId: "tesseract",
        expected: "tesseract",
      },

      // LLM/refine model families
      {
        title: "Llama 3.2 3B Instruct",
        runtimeProviderId: "ollama",
        expected: "meta",
      },
      {
        title: "llama-3.1-8b-instant",
        runtimeProviderId: "groq",
        expected: "meta",
      },
      {
        title: "llama-3.3-70b",
        runtimeProviderId: "cerebras",
        expected: "meta",
      },
      {
        title: "Qwen 2.5 1.5B Instruct",
        runtimeProviderId: "ollama",
        expected: "qwen",
      },
      {
        title: "Phi-4 Mini Instruct",
        runtimeProviderId: "ollama",
        expected: "microsoft",
      },
      {
        title: "Claude Sonnet",
        runtimeProviderId: "openrouter",
        expected: "anthropic",
      },
      {
        title: "GPT-5 mini",
        runtimeProviderId: "openrouter",
        expected: "openai",
      },
      {
        title: "DeepSeek R1",
        runtimeProviderId: "openrouter",
        expected: "deepseek",
      },
      {
        title: "SmolLM2 360M",
        runtimeProviderId: "ollama",
        expected: "huggingface",
      },
      {
        title: "Falcon 3 1B",
        runtimeProviderId: "ollama",
        expected: "falcon",
      },
      {
        title: "Granite 3.1 Dense 2B",
        runtimeProviderId: "ollama",
        expected: "ibm",
      },
      {
        title: "Granite 3.1 MoE 1B",
        runtimeProviderId: "ollama",
        expected: "ibm",
      },
      {
        title: "Tencent Hunyuan A13B",
        runtimeProviderId: "openrouter",
        expected: "tencent",
      },

      // File ASR / Speech Analysis / Speaker Isolation
      {
        title:
          "IBM Granite Granite Speech 4.1 2B ibm-granite/granite-speech-4.1-2b",
        runtimeProviderId: "huggingface",
        expected: "ibm",
      },
      {
        title:
          "CohereLabs Cohere Transcribe 03-2026 CohereLabs/cohere-transcribe-03-2026",
        runtimeProviderId: "huggingface",
        expected: "cohere",
      },
      {
        title:
          "Alibaba Qwen Qwen3 ASR 0.6B (MLX) mlx-community/Qwen3-ASR-0.6B-8bit",
        runtimeProviderId: "huggingface",
        expected: "stt_qwen",
      },
      {
        title:
          "Xiaohongshu FireRedASR2 AED (MLX) mlx-community/FireRedASR2-AED-mlx",
        runtimeProviderId: "huggingface",
        expected: "firered",
      },
      {
        title:
          "Microsoft VibeVoice ASR 9B (MLX) mlx-community/VibeVoice-ASR-bf16",
        runtimeProviderId: "huggingface",
        expected: "microsoft",
      },
      {
        title:
          "pyannote PyAnnote Community-1 pyannote/speaker-diarization-community-1",
        runtimeProviderId: "huggingface",
        expected: "pyannote",
      },
      {
        title: "pyannote PyAnnote 3.1 pyannote/speaker-diarization-3.1",
        runtimeProviderId: "huggingface",
        expected: "pyannote",
      },
      {
        title: "NVIDIA Sortformer 4spk v1 nvidia/diar_sortformer_4spk-v1",
        runtimeProviderId: "huggingface",
        expected: "nvidia",
      },
      {
        title:
          "NVIDIA Sortformer 4spk v1 (MLX) mlx-community/diar_sortformer_4spk-v1-fp16",
        runtimeProviderId: "huggingface",
        expected: "nvidia",
      },
      {
        title:
          "NVIDIA Sortformer 4spk v2.1 (MLX) mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16",
        runtimeProviderId: "huggingface",
        expected: "nvidia",
      },
      {
        title: "Revai Revai Reverb Diarization V2 Revai/reverb-diarization-v2",
        runtimeProviderId: "huggingface",
        expected: "revai",
      },
      {
        title: "WhisperX Whisper Diarization Systran/faster-whisper-large-v3",
        runtimeProviderId: "huggingface",
        expected: "whisperx",
      },
      {
        title:
          "polyvoice Polyvoice ONNX Diarization Wespeaker/wespeaker-voxceleb-resnet34",
        runtimeProviderId: "generic",
        expected: "polyvoice",
      },
      {
        title: "Vox Jot Current Dictation Engine",
        runtimeProviderId: "generic",
        expected: "vox_jot",
      },
      {
        title: "Vox Jot No Speaker Labels",
        runtimeProviderId: "generic",
        expected: "vox_jot",
      },

      // HF TTS Verified collection (sidecar runtime)
      {
        title: "piper-voices rhasspy/piper-voices",
        runtimeProviderId: "local_sidecar_api",
        expected: "piper",
      },
      {
        title: "speecht5 tts microsoft/speecht5_tts",
        runtimeProviderId: "local_sidecar_api",
        expected: "microsoft",
      },
      {
        title: "parler-tts-mini-v1.1 parler-tts/parler-tts-mini-v1.1",
        runtimeProviderId: "local_sidecar_api",
        expected: "parler",
      },
      {
        title:
          "parler-tts-mini-multilingual-v1.1 parler-tts/parler-tts-mini-multilingual-v1.1",
        runtimeProviderId: "local_sidecar_api",
        expected: "parler",
      },
      {
        title: "F5-TTS SWivid/F5-TTS",
        runtimeProviderId: "local_sidecar_api",
        expected: "f5tts",
      },
      {
        title: "outetts-0.3-1b OuteAI/OuteTTS-0.3-1B",
        runtimeProviderId: "local_sidecar_api",
        expected: "mlx_oute",
      },
      {
        title: "tada-1b tada/tada-1b",
        runtimeProviderId: "local_sidecar_api",
        expected: "huggingface",
      },
    ];

    for (const item of cases) {
      expect(
        resolveModelProviderId(item.title, item.runtimeProviderId),
        item.title,
      ).toBe(item.expected);
    }
  });

  it("renders Qwen as a geometric logo, not a plain fallback letter", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProviderIcon, { providerId: "qwen" }),
    );

    expect(markup).toContain("#665CEE");
    expect(markup).not.toContain(">Q</span>");
  });

  it("renders requested model families as marks instead of fallback letters", () => {
    const providerIds = [
      "apple",
      "vox_jot",
      "stt_apple_speech",
      "stt_moonshine",
      "stt_sensevoice",
      "stt_gigaam",
      "musicgen",
      "audioldm2",
      "audioldm2_music",
      "liquid_ai",
      "tencent",
      "falcon",
      "ibm",
      "lighton",
      "datalab",
      "ai2",
      "zai",
      "system_builtin",
      "sherpa_pack",
      "openvoice",
      "chatterbox",
      "supertonic",
      "kokoro",
      "xtts",
      "mlx_kokoro",
      "mlx_chatterbox",
      "mlx_qwen3tts",
      "mlx_dia",
      "mlx_csm",
      "mlx_spark",
      "mlx_oute",
      "mlx_ming_omni",
      "mlx_kugel",
      "mlx_bark",
      "mlx_fish_audio",
      "mlx_lfm_audio",
      "mlx_longcat_audiodit",
      "mlx_soprano",
      "mlx_melotts",
      "mlx_pocket_tts",
      "mlx_voxcpm",
      "mlx_voxtral_tts",
      "mlx_moss_tts",
      "mlx_irodori_tts",
      "mlx_indextts",
      "lfm_audio_gguf",
      "vibevoice",
      "polyvoice",
      "wespeaker",
      "silero",
      // Cloud LLM providers
      "openai",
      "anthropic",
      "google",
      "deepseek",
      "qwen",
      "meta",
      "microsoft",
      "mistral",
      "huggingface",
      "ollama",
      "groq",
      "cerebras",
      "openrouter",
      "lmstudio",
      // OCR providers
      "paddlepaddle",
      "tesseract",
      "dots",
      // File ASR / Speech analysis
      "cohere",
      "pyannote",
      "revai",
      "whisperx",
      "firered",
      "piper",
      "f5tts",
      "parler",
      "boson",
      "k2fsa",
      "mediatek",
      // Misc
      "nvidia",
      "sherpa",
    ];

    for (const providerId of providerIds) {
      const markup = renderToStaticMarkup(
        React.createElement(ProviderIcon, { providerId }),
      );

      expect(markup, providerId).toContain("<svg");
      expect(markup, providerId).not.toContain("<span");
    }
  });
});
