export type ModelSortMode =
  | "best_match"
  | "alphabetical"
  | "test_score"
  | "recently_updated";

export type ModelListSection = "downloaded" | "available";

export interface ModelSortOption {
  value: ModelSortMode;
  label: string;
}

export const DEFAULT_MODEL_SORT_OPTIONS: ModelSortOption[] = [
  { value: "best_match", label: "Best Match" },
  { value: "alphabetical", label: "Alphabetical" },
];

export const TEST_SCORE_MODEL_SORT_OPTION: ModelSortOption = {
  value: "test_score",
  label: "Test Score",
};

export const RECENTLY_UPDATED_MODEL_SORT_OPTION: ModelSortOption = {
  value: "recently_updated",
  label: "Recently Updated",
};

interface ModelOrderingAccessors<T> {
  label: (model: T) => string;
  active?: (model: T) => boolean;
  installed?: (model: T) => boolean;
  runnable?: (model: T) => boolean;
  inProgress?: (model: T) => boolean;
  recommended?: (model: T) => boolean;
  gated?: (model: T) => boolean;
  blocked?: (model: T) => boolean;
  rank?: (model: T) => number | undefined;
  latencyMs?: (model: T) => number | undefined;
  sizeMb?: (model: T) => number | undefined;
  providerRank?: (model: T) => number | undefined;
  updatedAt?: (model: T) => string | undefined;
}

const numberOrMax = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.MAX_SAFE_INTEGER;

const comparableTime = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const downloadedBucket = <T>(
  model: T,
  accessors: ModelOrderingAccessors<T>,
): number => {
  if (accessors.active?.(model)) return 0;
  if (accessors.inProgress?.(model)) return 1;
  if (accessors.installed?.(model) && accessors.runnable?.(model) !== false) {
    return 2;
  }
  if (accessors.installed?.(model)) return 3;
  return 4;
};

const availableBucket = <T>(
  model: T,
  accessors: ModelOrderingAccessors<T>,
): number => {
  if (accessors.active?.(model)) return 0;
  if (accessors.inProgress?.(model)) return 1;
  if (accessors.recommended?.(model)) return 2;
  if (accessors.rank?.(model) !== undefined) return 3;
  if (accessors.gated?.(model)) return 5;
  if (accessors.blocked?.(model)) return 6;
  return 4;
};

const compareBySortMode = <T>(
  left: T,
  right: T,
  sortMode: ModelSortMode,
  accessors: ModelOrderingAccessors<T>,
): number => {
  const leftLabel = accessors.label(left).toLocaleLowerCase();
  const rightLabel = accessors.label(right).toLocaleLowerCase();

  if (sortMode === "alphabetical") {
    return leftLabel.localeCompare(rightLabel);
  }

  if (sortMode === "test_score") {
    const rankDelta =
      numberOrMax(accessors.rank?.(left)) -
      numberOrMax(accessors.rank?.(right));
    if (rankDelta !== 0) return rankDelta;
    return leftLabel.localeCompare(rightLabel);
  }

  if (sortMode === "recently_updated") {
    const updateDelta =
      comparableTime(accessors.updatedAt?.(right)) -
      comparableTime(accessors.updatedAt?.(left));
    if (updateDelta !== 0) return updateDelta;
    return leftLabel.localeCompare(rightLabel);
  }

  const recommendedDelta =
    Number(Boolean(accessors.recommended?.(right))) -
    Number(Boolean(accessors.recommended?.(left)));
  if (recommendedDelta !== 0) return recommendedDelta;

  const rankDelta =
    numberOrMax(accessors.rank?.(left)) - numberOrMax(accessors.rank?.(right));
  if (rankDelta !== 0) return rankDelta;

  const latencyDelta =
    numberOrMax(accessors.latencyMs?.(left)) -
    numberOrMax(accessors.latencyMs?.(right));
  if (latencyDelta !== 0) return latencyDelta;

  const sizeDelta =
    numberOrMax(accessors.sizeMb?.(left)) -
    numberOrMax(accessors.sizeMb?.(right));
  if (sizeDelta !== 0) return sizeDelta;

  const providerDelta =
    numberOrMax(accessors.providerRank?.(left)) -
    numberOrMax(accessors.providerRank?.(right));
  if (providerDelta !== 0) return providerDelta;

  return leftLabel.localeCompare(rightLabel);
};

export function orderModelList<T>(
  models: T[],
  section: ModelListSection,
  sortMode: ModelSortMode,
  accessors: ModelOrderingAccessors<T>,
): T[] {
  const bucket =
    section === "downloaded"
      ? (model: T) => downloadedBucket(model, accessors)
      : (model: T) => availableBucket(model, accessors);

  return [...models].sort((left, right) => {
    const activeDelta =
      Number(Boolean(accessors.active?.(right))) -
      Number(Boolean(accessors.active?.(left)));
    if (activeDelta !== 0) return activeDelta;

    if (sortMode !== "best_match") {
      return compareBySortMode(left, right, sortMode, accessors);
    }

    const bucketDelta = bucket(left) - bucket(right);
    if (bucketDelta !== 0) return bucketDelta;

    return compareBySortMode(left, right, sortMode, accessors);
  });
}

export function splitInstalledModels<T>(
  models: T[],
  isDownloaded: (model: T) => boolean,
): { downloadedModels: T[]; availableModels: T[] } {
  const downloadedModels: T[] = [];
  const availableModels: T[] = [];

  for (const model of models) {
    if (isDownloaded(model)) {
      downloadedModels.push(model);
    } else {
      availableModels.push(model);
    }
  }

  return { downloadedModels, availableModels };
}
