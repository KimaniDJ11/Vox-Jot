import type { ModelSortMode } from "@/lib/modelListOrdering";

export interface ModelHubControlValues {
  providerFilter: string;
  languageFilter: string;
  sortMode: ModelSortMode;
}

export type ModelHubControlScope = "stt" | "llm" | "tts" | "ocr" | "analysis";

export interface ModelHubControlState extends ModelHubControlValues {
  setProviderFilter: (value: string) => void;
  setLanguageFilter: (value: string) => void;
  setSortMode: (value: ModelSortMode) => void;
}

export const DEFAULT_MODEL_HUB_CONTROL_VALUES: ModelHubControlValues = {
  providerFilter: "all",
  languageFilter: "all",
  sortMode: "best_match",
};

export type ScopedModelHubControlValues = Record<
  ModelHubControlScope,
  ModelHubControlValues
>;

export const DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES: ScopedModelHubControlValues =
  {
    stt: { ...DEFAULT_MODEL_HUB_CONTROL_VALUES },
    llm: { ...DEFAULT_MODEL_HUB_CONTROL_VALUES },
    tts: { ...DEFAULT_MODEL_HUB_CONTROL_VALUES },
    ocr: { ...DEFAULT_MODEL_HUB_CONTROL_VALUES },
    analysis: { ...DEFAULT_MODEL_HUB_CONTROL_VALUES },
  };
