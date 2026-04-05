import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "@/lib/utils/modelTranslation";
import type { ModelInfo } from "@/bindings";

const createModel = (overrides: Partial<ModelInfo> = {}): ModelInfo =>
  ({
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet V3",
    description: "Fast and accurate",
    filename: "parakeet.bin",
    url: null,
    size_mb: 540,
    is_downloaded: false,
    is_downloading: false,
    partial_size: 0,
    is_directory: false,
    engine_type: "Parakeet",
    accuracy_score: 0.85,
    speed_score: 0.92,
    supports_translation: false,
    is_recommended: true,
    supported_languages: ["en"],
    is_custom: false,
    ...overrides,
  }) as ModelInfo;

describe("model translation helpers", () => {
  it("uses translated values when present", () => {
    const t = vi.fn(((key: string) => {
      if (key.endsWith(".name")) return "Localized Name";
      if (key.endsWith(".description")) return "Localized Description";
      return "";
    }) as TFunction);

    const model = createModel();

    expect(getTranslatedModelName(model, t)).toBe("Localized Name");
    expect(getTranslatedModelDescription(model, t)).toBe(
      "Localized Description",
    );
  });

  it("falls back to model values when translations are missing", () => {
    const t = vi.fn(((_key: string, options?: { defaultValue?: string }) => {
      return options?.defaultValue ?? "";
    }) as TFunction);

    const model = createModel();

    expect(getTranslatedModelName(model, t)).toBe("Parakeet V3");
    expect(getTranslatedModelDescription(model, t)).toBe("Fast and accurate");
  });

  it("uses the generic custom model description key", () => {
    const t = vi.fn(((key: string) => {
      if (key === "onboarding.customModelDescription") {
        return "Custom model description";
      }
      return "";
    }) as TFunction);

    const model = createModel({
      id: "custom-model",
      is_custom: true,
      description: "Original description",
    });

    expect(getTranslatedModelDescription(model, t)).toBe(
      "Custom model description",
    );
    expect(t).toHaveBeenCalledWith("onboarding.customModelDescription");
  });
});
