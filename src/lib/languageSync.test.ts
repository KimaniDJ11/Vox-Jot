import { describe, expect, it } from "vitest";
import type { AppSettings as Settings, VoiceInfo } from "@/bindings";
import type {
  CatalogModelDescriptor,
  ModelPlatformOverview,
} from "@/lib/modelPlatform";
import {
  appLanguageToSttLanguage,
  appLanguageToTtsTarget,
  getActiveTtsPreset,
  getCurrentTtsVoiceId,
  modelSupportsLanguage,
  pickTtsModelForLanguage,
  pickTtsVoiceForLanguage,
  voiceMatchesLanguage,
} from "@/lib/languageSync";

const baseRuntime = {
  id: "runtime",
  label: "Runtime",
  engine_family: "local",
  auto_routed: false,
};

const baseCapabilities = {
  downloadable: true,
  loadable: true,
  local_only: true,
  supports_translation: false,
  supports_streaming: false,
  supports_voice_cloning: false,
  supports_instruction_prompt: false,
  supports_inline_tags: false,
  coming_soon: false,
};

const baseDeliverySupport = {
  expressiveness_mode: "unsupported" as const,
  advanced_controls: [],
};

const createModel = (
  overrides: Partial<CatalogModelDescriptor> = {},
): CatalogModelDescriptor => ({
  id: "model",
  provider_id: "kokoro",
  domain: "tts",
  source_kind: "builtin",
  label: "Model",
  description: "Model description",
  installed: true,
  selected: false,
  active: false,
  runnable: true,
  downloadable: true,
  source_label: "Built in",
  runtime: baseRuntime,
  license_label: null,
  locale: null,
  supported_languages: [],
  readiness_status: "ready",
  readiness_issues: [],
  capabilities: baseCapabilities,
  delivery_support: baseDeliverySupport,
  ...overrides,
});

const createOverview = (
  models: CatalogModelDescriptor[],
  currentProviderId: string | null = null,
  currentModelId: string | null = null,
): ModelPlatformOverview => ({
  stt: { providers: [], models: [] },
  llm: { providers: [], models: [] },
  tts: { providers: [], models },
  selection: {
    selected_stt_provider_id: null,
    selected_stt_model_id: null,
    selected_llm_provider_id: null,
    selected_llm_model_id: null,
    selected_tts_provider_id: currentProviderId,
    selected_tts_model_id: currentModelId,
    selected_tts_voice_id: null,
    selected_tts_profile_id: null,
    active_tts_provider_id: null,
    active_tts_model_id: null,
  },
});

const createSettings = (overrides: Partial<Settings> = {}): Settings =>
  ({
    tts_voice_presets: [],
    tts_active_preset_id: null,
    selected_tts_voice_id: null,
    tts_default_voice_id: null,
    ...overrides,
  }) as Settings;

const createVoice = (overrides: Partial<VoiceInfo> = {}): VoiceInfo =>
  ({
    id: "voice",
    label: "Voice",
    locale: "en-US",
    engine: "kokoro",
    installed: true,
    available: true,
    ...overrides,
  }) as VoiceInfo;

describe("languageSync", () => {
  it("normalizes app language into STT and TTS targets", () => {
    expect(appLanguageToSttLanguage(undefined)).toBe("auto");
    expect(appLanguageToSttLanguage(" zh ")).toBe("zh-Hans");
    expect(appLanguageToSttLanguage("zh-TW")).toBe("zh-Hant");
    expect(appLanguageToSttLanguage("EN-us")).toBe("en");

    expect(appLanguageToTtsTarget(undefined)).toBe("en");
    expect(appLanguageToTtsTarget("zh")).toBe("zh");
    expect(appLanguageToTtsTarget("zh-TW")).toBe("zh");
    expect(appLanguageToTtsTarget("FR-ca")).toBe("fr");
  });

  it("selects the active preset and current voice id from settings", () => {
    const settings = createSettings({
      tts_active_preset_id: "preset-b",
      selected_tts_voice_id: "selected-voice",
      tts_default_voice_id: "default-voice",
      tts_voice_presets: [
        {
          id: "preset-a",
          label: "Preset A",
          provider_id: "kokoro",
          model_id: "model-a",
          voice_id: "voice-a",
          tuning: {
            tempo_rate: 1,
            expressiveness: 0.5,
            exaggeration: 0,
            randomness: 0,
            guidance: 0,
            stability: 0,
            repetition_penalty: 0,
          },
        },
        {
          id: "preset-b",
          label: "Preset B",
          provider_id: "kokoro",
          model_id: "model-b",
          voice_id: "voice-b",
          tuning: {
            tempo_rate: 1,
            expressiveness: 0.5,
            exaggeration: 0,
            randomness: 0,
            guidance: 0,
            stability: 0,
            repetition_penalty: 0,
          },
        },
      ],
    });

    expect(getActiveTtsPreset(settings)?.id).toBe("preset-b");
    expect(getCurrentTtsVoiceId(settings)).toBe("voice-b");
    expect(
      getCurrentTtsVoiceId(
        createSettings({ selected_tts_voice_id: "selected" }),
      ),
    ).toBe("selected");
    expect(
      getCurrentTtsVoiceId(createSettings({ tts_default_voice_id: "default" })),
    ).toBe("default");
  });

  it("checks model language support from supported languages or locale", () => {
    expect(
      modelSupportsLanguage(
        createModel({ supported_languages: ["en-US"] }),
        "en",
      ),
    ).toBe(true);
    expect(
      modelSupportsLanguage(
        createModel({ supported_languages: [], locale: "zh-CN" }),
        "zh",
      ),
    ).toBe(true);
    expect(
      modelSupportsLanguage(createModel({ supported_languages: ["fr"] }), "de"),
    ).toBe(false);
    expect(modelSupportsLanguage(null, "en")).toBe(false);
  });

  it("preserves a compatible current TTS model during automatic sync", () => {
    const currentModel = createModel({
      id: "current-model",
      provider_id: "xtts",
      supported_languages: ["fr-FR"],
    });
    const overview = createOverview(
      [currentModel, createModel({ id: "fallback", provider_id: "kokoro" })],
      "xtts",
      "current-model",
    );

    expect(
      pickTtsModelForLanguage(overview, createSettings(), "fr", "auto"),
    ).toBe(currentModel);
  });

  it("prefers higher-ranked runnable models and ignores excluded providers", () => {
    const xttsModel = createModel({
      id: "xtts-fr",
      provider_id: "xtts",
      supported_languages: ["fr"],
    });
    const openvoiceModel = createModel({
      id: "openvoice-fr",
      provider_id: "openvoice",
      supported_languages: ["fr"],
    });
    const excludedModel = createModel({
      id: "fish-fr",
      provider_id: "fish_speech_local",
      supported_languages: ["fr"],
    });
    const localeFallback = createModel({
      id: "kokoro-fr",
      provider_id: "kokoro",
      supported_languages: [],
      locale: "fr-CA",
    });

    const overview = createOverview([
      excludedModel,
      xttsModel,
      openvoiceModel,
      localeFallback,
    ]);

    expect(
      pickTtsModelForLanguage(overview, createSettings(), "fr", "manual"),
    ).toBe(openvoiceModel);
  });

  it("matches voices by language and preserves a compatible current voice", () => {
    const currentVoice = createVoice({ id: "voice-fr", locale: "fr-FR" });
    const otherVoice = createVoice({ id: "voice-en", locale: "en-US" });

    expect(voiceMatchesLanguage(currentVoice, "fr")).toBe(true);
    expect(voiceMatchesLanguage(otherVoice, "fr")).toBe(false);
    expect(
      pickTtsVoiceForLanguage({
        voices: [otherVoice, currentVoice],
        providerId: "kokoro",
        targetLanguage: "fr",
        currentVoiceId: "voice-fr",
        preserveCurrentVoice: true,
      }),
    ).toBe(currentVoice);
  });

  it("prefers provider defaults and fallback samples when choosing voices", () => {
    const kokoroDefault = createVoice({ id: "af_heart", locale: "en-US" });
    const kokoroOther = createVoice({ id: "bf_alice", locale: "en-US" });
    const xttsFallback = createVoice({ id: "sample:zh-cn", locale: null });

    expect(
      pickTtsVoiceForLanguage({
        voices: [kokoroOther, kokoroDefault],
        providerId: "kokoro",
        targetLanguage: "en",
      }),
    ).toBe(kokoroDefault);

    expect(
      pickTtsVoiceForLanguage({
        voices: [xttsFallback],
        providerId: "xtts",
        targetLanguage: "zh",
      }),
    ).toBe(xttsFallback);
  });
});
