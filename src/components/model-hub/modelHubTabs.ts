import { commands } from "@/bindings";

/** Shared Model Hub tab ids + i18n keys (sidebar launchers + hub tab bar). */
export type ModelHubTabId = "stt" | "analysis" | "llm" | "tts" | "ocr";
export type ModelHubScope = "all" | "analysis";

export const MODEL_HUB_TAB_STORAGE_KEY = "vox-jot-model-hub-tab";
export const MODEL_HUB_SCOPE_STORAGE_KEY = "vox-jot-model-hub-scope";
const MODEL_HUB_SECTION_ID = "model-hub";

export const MODEL_HUB_TAB_DEFS: Array<{
  id: ModelHubTabId;
  labelKey: string;
  defaultLabel: string;
}> = [
  { id: "stt", labelKey: "modelHub.tabs.stt", defaultLabel: "Speech (STT)" },
  {
    id: "analysis",
    labelKey: "modelHub.tabs.analysis",
    defaultLabel: "Speech Analysis",
  },
  {
    id: "llm",
    labelKey: "modelHub.tabs.llm",
    defaultLabel: "Post-process (LLM)",
  },
  { id: "tts", labelKey: "modelHub.tabs.tts", defaultLabel: "Voices (TTS)" },
  { id: "ocr", labelKey: "modelHub.tabs.ocr", defaultLabel: "Screen OCR" },
];

export async function openModelHub(
  tab: ModelHubTabId,
  options: { scope?: ModelHubScope } = {},
) {
  try {
    if (options.scope && options.scope !== "all") {
      localStorage.setItem(MODEL_HUB_SCOPE_STORAGE_KEY, options.scope);
    } else {
      localStorage.removeItem(MODEL_HUB_SCOPE_STORAGE_KEY);
    }
    localStorage.setItem(MODEL_HUB_TAB_STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }

  try {
    const result = await commands.showDetailView(MODEL_HUB_SECTION_ID);
    if (result.status === "error") {
      console.warn("Failed to open model hub:", result.error);
    }
  } catch (error) {
    console.warn("Failed to open model hub:", error);
  }
}
