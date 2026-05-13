import type { ModelSortMode } from "@/lib/modelListOrdering";

export interface ModelHubControlValues {
  providerFilter: string;
  languageFilter: string;
  sortMode: ModelSortMode;
}

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
