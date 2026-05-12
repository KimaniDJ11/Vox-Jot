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
        title: "Apple Speech",
        runtimeProviderId: "stt_apple_speech",
        expected: "apple",
      },
      {
        title: "Current Dictation Engine Vox Jot",
        runtimeProviderId: "generic",
        expected: "vox_jot",
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
        title: "Tencent Hunyuan A13B",
        runtimeProviderId: "openrouter",
        expected: "tencent",
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
      "liquid_ai",
      "tencent",
      "system_builtin",
      "sherpa_pack",
      "openvoice",
      "chatterbox",
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
      "mlx_pocket_tts",
      "mlx_voxcpm",
      "mlx_voxtral_tts",
      "lfm_audio_gguf",
      "vibevoice",
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
