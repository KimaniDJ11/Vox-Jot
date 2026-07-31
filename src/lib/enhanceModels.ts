// Shared catalog + persisted selection for the Enhance Audio (Dictate > Enhance
// Audio) engines. This is intentionally frontend-only: the backend
// `enhance_audio_file` command receives the engine as a per-call argument, so the
// chosen engine is a pure UI preference. It is persisted in localStorage and
// synced across windows (the main panel + the Model Hub detail window) via the
// browser `storage` event - the exact pattern the Model Hub already uses for its
// active tab/scope.

export type EnhanceModelId =
  "rnnoise" | "spectral" | "deepfilternet" | "demucs";

export interface EnhanceModelMeta {
  id: EnhanceModelId;
  /** Passed to ProviderIcon for the leading logo (card + selected chip). */
  providerId: string;
  /** True when the engine ships in the app and needs no download. */
  builtin: boolean;
  /** True when the engine runs through the on-demand Python sidecar runtime. */
  needsRuntime: boolean;
  /** i18n key + English fallback for the display name. */
  nameKey: string;
  nameDefault: string;
  /** i18n key + English fallback for the one-line description. */
  descKey: string;
  descDefault: string;
}

export const ENHANCE_MODELS: EnhanceModelMeta[] = [
  {
    id: "rnnoise",
    providerId: "rnnoise",
    builtin: true,
    needsRuntime: false,
    nameKey: "dictate.enhanceAudio.engine.rnnoise",
    nameDefault: "RNNoise",
    descKey: "dictate.enhanceAudio.engine.rnnoiseHint",
    descDefault:
      "RNNoise — a voice-tuned neural denoiser. Great default for speech.",
  },
  {
    id: "spectral",
    providerId: "spectral",
    builtin: true,
    needsRuntime: false,
    nameKey: "dictate.enhanceAudio.engine.spectral",
    nameDefault: "Spectral",
    descKey: "dictate.enhanceAudio.engine.spectralHint",
    descDefault:
      "Spectral subtraction — adjustable strength, best for steady hiss, hum, and fan noise.",
  },
  {
    id: "deepfilternet",
    providerId: "deepfilternet",
    builtin: false,
    needsRuntime: true,
    nameKey: "dictate.enhanceAudio.engine.deepfilternet",
    nameDefault: "DeepFilterNet",
    descKey: "dictate.enhanceAudio.engine.deepfilternetHint",
    descDefault:
      "DeepFilterNet — state-of-the-art neural denoiser, full-band 48 kHz. First use downloads a one-time runtime.",
  },
  {
    id: "demucs",
    providerId: "demucs",
    builtin: false,
    needsRuntime: true,
    nameKey: "dictate.enhanceAudio.engine.demucs",
    nameDefault: "Demucs (vocal isolation)",
    descKey: "dictate.enhanceAudio.engine.demucsHint",
    descDefault:
      "Demucs (HTDemucs, MLX) — separates speech from music and background, keeping only the vocal stem. Apple Silicon. Downloads a one-time model.",
  },
];

export const DEFAULT_ENHANCE_MODEL: EnhanceModelId = "rnnoise";

/** localStorage key for the selected Enhance Audio engine. */
export const ENHANCE_MODEL_STORAGE_KEY = "voxjot:enhance-audio-model:v1";
/**
 * Same-window notification channel. `storage` events only fire in other windows,
 * so the writer also dispatches this so its own window stays in sync.
 */
export const ENHANCE_MODEL_CHANGED_EVENT = "voxjot:enhance-model-changed";

export function isEnhanceModelId(value: unknown): value is EnhanceModelId {
  return (
    value === "rnnoise" ||
    value === "spectral" ||
    value === "deepfilternet" ||
    value === "demucs"
  );
}

export function getEnhanceModelMeta(id: EnhanceModelId): EnhanceModelMeta {
  return ENHANCE_MODELS.find((model) => model.id === id) ?? ENHANCE_MODELS[0];
}

export function loadEnhanceModel(): EnhanceModelId {
  if (typeof window === "undefined") return DEFAULT_ENHANCE_MODEL;
  try {
    const stored = window.localStorage.getItem(ENHANCE_MODEL_STORAGE_KEY);
    if (isEnhanceModelId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_ENHANCE_MODEL;
}

export function saveEnhanceModel(id: EnhanceModelId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENHANCE_MODEL_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  // Notify the current window; other windows get the native `storage` event.
  try {
    window.dispatchEvent(
      new CustomEvent<EnhanceModelId>(ENHANCE_MODEL_CHANGED_EVENT, {
        detail: id,
      }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to engine-selection changes from either this window (custom event)
 * or another window (storage event). Returns an unsubscribe function.
 */
export function subscribeEnhanceModel(
  onChange: (id: EnhanceModelId) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<EnhanceModelId>).detail;
    if (isEnhanceModelId(detail)) onChange(detail);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== ENHANCE_MODEL_STORAGE_KEY) return;
    if (isEnhanceModelId(event.newValue)) onChange(event.newValue);
  };
  window.addEventListener(ENHANCE_MODEL_CHANGED_EVENT, handleCustom);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(ENHANCE_MODEL_CHANGED_EVENT, handleCustom);
    window.removeEventListener("storage", handleStorage);
  };
}
