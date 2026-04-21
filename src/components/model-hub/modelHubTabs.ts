/** Shared Model Hub tab ids + i18n keys (sidebar launchers + hub tab bar). */
export type ModelHubTabId = "stt" | "llm" | "tts";

export const MODEL_HUB_TAB_DEFS: Array<{
  id: ModelHubTabId;
  labelKey: string;
  defaultLabel: string;
}> = [
  { id: "stt", labelKey: "modelHub.tabs.stt", defaultLabel: "Speech (STT)" },
  {
    id: "llm",
    labelKey: "modelHub.tabs.llm",
    defaultLabel: "Post-process (LLM)",
  },
  { id: "tts", labelKey: "modelHub.tabs.tts", defaultLabel: "Voices (TTS)" },
];
