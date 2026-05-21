import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import {
  DEFAULT_TTS_PREVIEW_TEXT,
  TTS_MODEL_SIZE_HINTS,
  huggingFaceRepoIdFromSourceUrl,
  ttsPreviewSampleForLocale,
  ttsStorageSizeLabel,
  verifiedTtsHuggingFaceRepoId,
} from "./utils";

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

describe("verifiedTtsHuggingFaceRepoId", () => {
  it("resolves verified collection rows from their source URL when the id is sanitized", () => {
    expect(
      verifiedTtsHuggingFaceRepoId(
        model({
          id: "hf_tts:parler-tts_parler-tts-mini-v1.1",
          provider_id: "local_sidecar_api",
          source_url: "https://huggingface.co/parler-tts/parler-tts-mini-v1.1",
        }),
      ),
    ).toBe("parler-tts/parler-tts-mini-v1.1");
  });

  it("resolves verified collection rows when the source URL includes a route", () => {
    expect(
      verifiedTtsHuggingFaceRepoId(
        model({
          id: "microsoft_speecht5_tts",
          provider_id: "local_sidecar_api",
          source_url:
            "https://huggingface.co/microsoft/speecht5_tts/tree/main",
        }),
      ),
    ).toBe("microsoft/speecht5_tts");
  });

  it("falls back to slash-delimited ids for verified collection rows", () => {
    expect(
      verifiedTtsHuggingFaceRepoId(
        model({
          id: "rhasspy/piper-voices",
          provider_id: "local_sidecar_api",
          source_url: null,
        }),
      ),
    ).toBe("rhasspy/piper-voices");
  });

  it("does not route non-verified models through the generic HF downloader", () => {
    expect(
      verifiedTtsHuggingFaceRepoId(
        model({
          id: "mlx-community/Kokoro-82M-bf16",
          provider_id: "kokoro",
          source_url: "https://huggingface.co/mlx-community/Kokoro-82M-bf16",
        }),
      ),
    ).toBeNull();
  });
});

describe("huggingFaceRepoIdFromSourceUrl", () => {
  it("extracts only the namespace and repo name", () => {
    expect(
      huggingFaceRepoIdFromSourceUrl(
        "https://huggingface.co/rhasspy/piper-voices/tree/main",
      ),
    ).toBe("rhasspy/piper-voices");
  });
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
    const modelIds = [...catalog.matchAll(/^\s*model_id:\s*"([^"]+)",/gm)].map(
      (match) => match[1],
    );
    const hfAliases = [
      ...catalog.matchAll(/^\s*hf_(?:model|repo)_id:\s*(?:Some\()?"([^"]+)"/gm),
    ].map((match) => match[1].toLowerCase());
    const missing = [...new Set([...modelIds, ...hfAliases])].filter(
      (id) => !TTS_MODEL_SIZE_HINTS[id],
    );

    expect(missing).toEqual([]);
  });
});

describe("ttsPreviewSampleForLocale", () => {
  it("uses the shared English preview sample by default", () => {
    expect(ttsPreviewSampleForLocale(null)).toBe(DEFAULT_TTS_PREVIEW_TEXT);
    expect(ttsPreviewSampleForLocale("en-US")).toBe(DEFAULT_TTS_PREVIEW_TEXT);
  });

  it("uses a translated sample for supported voice languages", () => {
    expect(ttsPreviewSampleForLocale("fr-FR")).toContain("Après la pluie");
    expect(ttsPreviewSampleForLocale("zh-CN")).toContain("雨后");
  });

  it("falls back to English for multilingual or unknown locales", () => {
    expect(ttsPreviewSampleForLocale("mul")).toBe(DEFAULT_TTS_PREVIEW_TEXT);
    expect(ttsPreviewSampleForLocale("zz-ZZ")).toBe(DEFAULT_TTS_PREVIEW_TEXT);
  });
});
