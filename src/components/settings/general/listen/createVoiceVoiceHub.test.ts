import { describe, expect, it } from "vitest";
import type { VoiceInfo } from "@/bindings";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import {
  buildCreateVoiceHubRows,
  countryFlagFromLocale,
  inferVoiceGender,
  orderCreateVoiceHubRows,
  voiceAccentFromLocale,
  voiceAvatarGradient,
  voiceLanguageFromLocale,
} from "./createVoiceVoiceHub";

const model = (
  patch: Partial<CatalogModelDescriptor> = {},
): CatalogModelDescriptor => ({
  id: "kokoro-82m-v1.0",
  provider_id: "mlx_kokoro",
  domain: "tts",
  source_kind: "runtime",
  label: "Kokoro 82M",
  description: "Test model",
  installed: true,
  selected: false,
  active: false,
  runnable: true,
  downloadable: true,
  source_label: "Test",
  runtime: {
    id: "mlx",
    label: "MLX",
    engine_family: "mlx",
    auto_routed: true,
  },
  license_label: null,
  locale: "en-US",
  supported_languages: ["en"],
  readiness_status: "ready",
  readiness_issues: [],
  capabilities: {
    downloadable: true,
    loadable: true,
    local_only: true,
    supports_translation: false,
    supports_streaming: false,
    supports_voice_cloning: false,
    supports_instruction_prompt: false,
    supports_inline_tags: false,
  },
  delivery_support: {
    expressiveness_mode: "unsupported",
    advanced_controls: [],
  },
  ...patch,
});

const voice = (patch: Partial<VoiceInfo> = {}): VoiceInfo => ({
  id: "af_heart",
  label: "Heart",
  locale: "en-US",
  engine: "mlx_native",
  installed: true,
  available: true,
  ...patch,
});

describe("createVoiceVoiceHub", () => {
  it("derives language, accent, and flag from a locale", () => {
    expect(voiceLanguageFromLocale("en-US")).toBe("en");
    expect(voiceAccentFromLocale("en-US")).toBe("US");
    expect(countryFlagFromLocale("en-US")).toBe("🇺🇸");
    expect(countryFlagFromLocale("en-IN")).toBe("🇺🇸🇮🇳");
    expect(voiceAccentFromLocale("fr-FR")).toBe("French");
  });

  it("uses deterministic avatar gradients", () => {
    expect(voiceAvatarGradient("mlx::kokoro::af_heart")).toBe(
      voiceAvatarGradient("mlx::kokoro::af_heart"),
    );
    expect(voiceAvatarGradient("mlx::kokoro::af_heart")).not.toBe(
      voiceAvatarGradient("mlx::kokoro::am_adam"),
    );
  });

  it("infers gender only from known two-letter voice prefixes", () => {
    expect(inferVoiceGender("af_heart")).toBe("female");
    expect(inferVoiceGender("am_adam")).toBe("male");
    expect(inferVoiceGender("neutral_storyteller")).toBeNull();
    expect(inferVoiceGender("alice")).toBeNull();
  });

  it("builds model-named fallback rows when a model has no preset voices", () => {
    const rows = buildCreateVoiceHubRows([model()], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      modelLabel: "Kokoro 82M",
      voiceId: null,
      voiceLabel: "Kokoro 82M",
      language: "en",
      accent: "US",
      countryFlag: "🇺🇸",
      gender: null,
    });
  });

  it("builds rows from preset voice inventory", () => {
    const sourceModel = model({
      capabilities: {
        ...model().capabilities,
        supports_instruction_prompt: true,
        supports_inline_tags: true,
      },
    });
    const rows = buildCreateVoiceHubRows(
      [sourceModel],
      new Map([[`${sourceModel.provider_id}::${sourceModel.id}`, [voice()]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      voiceId: "af_heart",
      voiceLabel: "Heart",
      gender: "female",
      description: "female voice preset for English (US), from Kokoro 82M.",
      capabilities: {
        supportsExpressions: true,
        supportsPrompts: true,
      },
    });
  });

  it("orders US English voices before other English accents and remaining locales", () => {
    const sourceModel = model();
    const rows = buildCreateVoiceHubRows(
      [sourceModel],
      new Map([
        [
          `${sourceModel.provider_id}::${sourceModel.id}`,
          [
            voice({ id: "zf_xiaobei", label: "Xiaobei", locale: "zh-CN" }),
            voice({ id: "bf_bella", label: "Bella", locale: "en-GB" }),
            voice({ id: "af_heart", label: "Heart", locale: "en-US" }),
            voice({ id: "neutral", label: "Neutral", locale: "en" }),
          ],
        ],
      ]),
    );

    expect(orderCreateVoiceHubRows(rows).map((row) => row.voiceLabel)).toEqual([
      "Heart",
      "Bella",
      "Neutral",
      "Xiaobei",
    ]);
  });
});
