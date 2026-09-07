import { describe, expect, it } from "vitest";
import type { VoiceInfo } from "@/bindings";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import {
  buildCreateVoiceHubRows,
  countryFlagFromLocale,
  inferVoiceGender,
  languageDisplayName,
  orderCreateVoiceHubRows,
  splitCompoundLocales,
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
    expect(countryFlagFromLocale("zh-TW")).toBe("🇹🇼");
    expect(countryFlagFromLocale("zh-CN")).toBe("🇨🇳");
    expect(countryFlagFromLocale("mul")).toBe("🌐");
    expect(languageDisplayName("mul")).toBe("Multiple languages");
    expect(countryFlagFromLocale("ru")).toBe("🇷🇺");
    expect(countryFlagFromLocale("pl")).toBe("🇵🇱");
    expect(countryFlagFromLocale("tr")).toBe("🇹🇷");
    expect(countryFlagFromLocale("sv")).toBe("🇸🇪");
    expect(countryFlagFromLocale("vi")).toBe("🇻🇳");
    expect(countryFlagFromLocale("uk")).toBe("🇺🇦");
  });

  it("handles compound locales with flags and formatted language names", () => {
    expect(splitCompoundLocales("en/zh")).toEqual(["en", "zh"]);
    expect(splitCompoundLocales("en/zh-TW")).toEqual(["en", "zh-TW"]);
    expect(splitCompoundLocales("en, zh-TW")).toEqual(["en", "zh-TW"]);

    expect(voiceLanguageFromLocale("en/zh")).toBe("en/zh");
    expect(voiceLanguageFromLocale("en/zh-TW")).toBe("en/zh-tw");

    expect(countryFlagFromLocale("en/zh")).toBe("🇺🇸🇨🇳");
    expect(countryFlagFromLocale("en/zh-TW")).toBe("🇺🇸🇹🇼");
    expect(countryFlagFromLocale("zh-TW/en")).toBe("🇹🇼🇺🇸");

    expect(languageDisplayName("en/zh")).toBe("English & Chinese");
    expect(languageDisplayName("en/zh-TW")).toBe("English & Chinese (Taiwan)");
  });

  it("uses deterministic avatar gradients", () => {
    expect(voiceAvatarGradient("mlx::kokoro::af_heart")).toBe(
      voiceAvatarGradient("mlx::kokoro::af_heart"),
    );
    expect(voiceAvatarGradient("mlx::kokoro::af_heart")).not.toBe(
      voiceAvatarGradient("mlx::kokoro::am_adam"),
    );
  });

  it("infers gender from voice IDs and prefixes", () => {
    expect(inferVoiceGender("af_heart")).toBe("female");
    expect(inferVoiceGender("am_adam")).toBe("male");
    expect(inferVoiceGender("F1")).toBe("female");
    expect(inferVoiceGender("f2")).toBe("female");
    expect(inferVoiceGender("M1")).toBe("male");
    expect(inferVoiceGender("m5")).toBe("male");
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

  it("builds multilingual rows with globe flag and inferring gender for Supertonic voices", () => {
    const supertonicModel = model({
      id: "supertonic-3",
      provider_id: "supertonic",
      label: "Supertonic 3",
      locale: "mul",
      supported_languages: [
        "en",
        "ko",
        "ja",
        "ar",
        "bg",
        "cs",
        "da",
        "de",
        "el",
        "es",
        "et",
        "fi",
        "fr",
        "hi",
        "hr",
        "hu",
        "id",
        "it",
        "lt",
        "lv",
        "nl",
        "pl",
        "pt",
        "ro",
        "ru",
        "sk",
        "sl",
        "sv",
        "tr",
        "uk",
        "vi",
      ],
    });
    const m1Voice = voice({
      id: "M1",
      label: "Male 1",
      locale: "mul",
    });
    const f1Voice = voice({
      id: "F1",
      label: "Female 1",
      locale: "mul",
    });
    const rows = buildCreateVoiceHubRows(
      [supertonicModel],
      new Map([
        [
          `${supertonicModel.provider_id}::${supertonicModel.id}`,
          [m1Voice, f1Voice],
        ],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      modelLabel: "Supertonic 3",
      voiceId: "M1",
      voiceLabel: "Male 1",
      countryFlag: "🌐",
      gender: "male",
      description:
        "male voice preset for Multiple languages, from Supertonic 3.",
    });
    expect(rows[1]).toMatchObject({
      modelLabel: "Supertonic 3",
      voiceId: "F1",
      voiceLabel: "Female 1",
      countryFlag: "🌐",
      gender: "female",
      description:
        "female voice preset for Multiple languages, from Supertonic 3.",
    });
  });

  it("builds bilingual Breeze speaker rows with the Taiwan locale", () => {
    const breezeModel = model({
      id: "breeze-tts-2-4bit",
      provider_id: "mlx_breeze_tts",
      label: "Breeze TTS 2 4-bit",
      locale: "en/zh-TW",
      supported_languages: ["en", "zh-TW"],
    });
    const rows = buildCreateVoiceHubRows(
      [breezeModel],
      new Map([
        [
          `${breezeModel.provider_id}::${breezeModel.id}`,
          [
            voice({
              id: "S0",
              label: "Speaker S0 (Default)",
              locale: "en/zh-TW",
            }),
          ],
        ],
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      modelLabel: "Breeze TTS 2 4-bit",
      voiceId: "S0",
      countryFlag: "🇺🇸🇹🇼",
      description:
        "Voice preset for English & Chinese (Taiwan), from Breeze TTS 2 4-bit.",
    });
  });
});
