import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import { TTS_MODEL_SIZE_HINTS, ttsStorageSizeLabel } from "./utils";

const t = ((_key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? "") as Parameters<typeof ttsStorageSizeLabel>[1];

const model = (
  patch: Partial<CatalogModelDescriptor>,
): CatalogModelDescriptor => ({
  id: "test-model",
  provider_id: "test-provider",
  domain: "tts",
  source_kind: "runtime",
  label: "Test Model",
  description: "",
  installed: true,
  selected: false,
  active: false,
  runnable: true,
  downloadable: true,
  source_label: "Test",
  runtime: {
    id: "test-provider",
    label: "Test Provider",
    engine_family: "test-provider",
    auto_routed: true,
  },
  license_label: null,
  locale: "en",
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
    coming_soon: false,
  },
  delivery_support: {
    expressiveness_mode: "unsupported",
    advanced_controls: [],
  },
  ...patch,
});

describe("ttsStorageSizeLabel", () => {
  it("shows the verified Supertonic 3 model size", () => {
    expect(
      ttsStorageSizeLabel(
        model({
          id: "supertonic-3",
          provider_id: "supertonic",
          label: "Supertonic 3",
        }),
        t,
      ),
    ).toBe("~385 MB");
  });

  it("labels non-downloadable local TTS models as internal", () => {
    expect(
      ttsStorageSizeLabel(
        model({
          id: "system-default",
          provider_id: "system_builtin",
          label: "System Voices",
          downloadable: false,
          capabilities: {
            ...model({}).capabilities,
            downloadable: false,
            local_only: true,
          },
        }),
        t,
      ),
    ).toBe("Internal");
  });

  it("covers every known TTS catalog model and Hugging Face alias", () => {
    const catalog = readFileSync(
      resolve(process.cwd(), "src-tauri/src/tts/catalog.rs"),
      "utf8",
    );
    const modelIds = [
      ...catalog.matchAll(/^\s*model_id:\s*"([^"]+)",/gm),
    ].map((match) => match[1]);
    const hfAliases = [
      ...catalog.matchAll(
        /^\s*hf_(?:model|repo)_id:\s*(?:Some\()?"([^"]+)"/gm,
      ),
    ].map((match) => match[1].toLowerCase());
    const missing = [...new Set([...modelIds, ...hfAliases])].filter(
      (id) => !TTS_MODEL_SIZE_HINTS[id],
    );

    expect(missing).toEqual([]);
  });
});
