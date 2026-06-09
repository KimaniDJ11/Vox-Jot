import type { ModelSortMode } from "@/lib/modelListOrdering";

export interface ModelHubControlValues {
  providerFilter: string;
  languageFilter: string;
  sortMode: ModelSortMode;
}

export type ModelHubFilterValues = Omit<ModelHubControlValues, "sortMode">;

export type ModelHubControlScope =
  | "stt"
  | "llm"
  | "tts"
  | "creative_audio"
  | "audio_cleanup"
  | "ocr"
  | "analysis";

export interface ModelHubControlState extends ModelHubControlValues {
  setProviderFilter: (value: string) => void;
  setLanguageFilter: (value: string) => void;
  setSortMode: (value: ModelSortMode) => void;
}

export const DEFAULT_MODEL_HUB_FILTER_VALUES: ModelHubFilterValues = {
  providerFilter: "all",
  languageFilter: "all",
};

export const DEFAULT_MODEL_HUB_CONTROL_VALUES: ModelHubControlValues = {
  ...DEFAULT_MODEL_HUB_FILTER_VALUES,
  sortMode: "best_match",
};

export type ScopedModelHubControlValues = Record<
  ModelHubControlScope,
  ModelHubFilterValues
>;

export const DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES: ScopedModelHubControlValues =
  {
    stt: { ...DEFAULT_MODEL_HUB_FILTER_VALUES },
    llm: { ...DEFAULT_MODEL_HUB_FILTER_VALUES },
    tts: { ...DEFAULT_MODEL_HUB_FILTER_VALUES },
    creative_audio: { ...DEFAULT_MODEL_HUB_FILTER_VALUES },
    audio_cleanup: { ...DEFAULT_MODEL_HUB_FILTER_VALUES },
    ocr: { ...DEFAULT_MODEL_HUB_FILTER_VALUES },
    analysis: { ...DEFAULT_MODEL_HUB_FILTER_VALUES },
  };
