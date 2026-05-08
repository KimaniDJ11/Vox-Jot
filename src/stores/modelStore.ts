import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { produce } from "immer";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands, type ModelInfo } from "@/bindings";

interface DownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

interface DownloadStats {
  startTime: number;
  lastUpdate: number;
  totalDownloaded: number;
  speed: number; // MB/s
}

const BYTES_PER_MIB = 1024 * 1024;

function progressFromModelPartial(
  model: ModelInfo,
  current?: DownloadProgress,
): DownloadProgress | null {
  const downloaded = Number(model.partial_size) || 0;
  if (downloaded <= 0) {
    return null;
  }

  const total =
    current && current.total > 0
      ? current.total
      : Number(model.size_mb) > 0
        ? Number(model.size_mb) * BYTES_PER_MIB
        : 0;

  const percentage =
    total > 0
      ? Math.min(99, (downloaded / total) * 100)
      : (current?.percentage ?? 0);

  return {
    model_id: model.id,
    downloaded: Math.max(downloaded, current?.downloaded ?? 0),
    total,
    percentage: Math.max(percentage, current?.percentage ?? 0),
  };
}

// Using Record instead of Set/Map for Immer compatibility
interface ModelsStore {
  models: ModelInfo[];
  currentModel: string;
  downloadingModels: Record<string, true>;
  extractingModels: Record<string, true>;
  downloadProgress: Record<string, DownloadProgress>;
  downloadStats: Record<string, DownloadStats>;
  loading: boolean;
  error: string | null;
  hasAnyModels: boolean;
  isFirstRun: boolean;
  initialized: boolean;
  initializePromise: Promise<void> | null;
  eventUnlisteners: UnlistenFn[];

  // Actions
  initialize: () => Promise<void>;
  loadModels: () => Promise<void>;
  loadCurrentModel: () => Promise<void>;
  checkFirstRun: () => Promise<boolean>;
  selectModel: (modelId: string) => Promise<boolean>;
  downloadModel: (modelId: string) => Promise<boolean>;
  cancelDownload: (modelId: string) => Promise<boolean>;
  deleteModel: (modelId: string) => Promise<boolean>;
  getModelInfo: (modelId: string) => ModelInfo | undefined;
  isModelDownloading: (modelId: string) => boolean;
  isModelExtracting: (modelId: string) => boolean;
  getDownloadProgress: (modelId: string) => DownloadProgress | undefined;

  // Internal setters
  setModels: (models: ModelInfo[]) => void;
  setCurrentModel: (modelId: string) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useModelStore = create<ModelsStore>()(
  subscribeWithSelector((set, get) => ({
    models: [],
    currentModel: "",
    downloadingModels: {},
    extractingModels: {},
    downloadProgress: {},
    downloadStats: {},
    loading: true,
    error: null,
    hasAnyModels: false,
    isFirstRun: false,
    initialized: false,
    initializePromise: null,
    eventUnlisteners: [],

    // Internal setters
    setModels: (models) => set({ models }),
    setCurrentModel: (currentModel) => set({ currentModel }),
    setError: (error) => set({ error }),
    setLoading: (loading) => set({ loading }),

    loadModels: async () => {
      try {
        const result = await commands.getAvailableModels();
        if (result.status === "ok") {
          set({ models: result.data, error: null });

          // Sync downloading state from backend
          set(
            produce((state) => {
              const backendDownloading: Record<string, true> = {};
              result.data
                .filter((m) => m.is_downloading)
                .forEach((m) => {
                  backendDownloading[m.id] = true;
                });
              const backendModels: Record<string, ModelInfo> =
                Object.fromEntries(
                  result.data.map((model) => [model.id, model]),
                );

              // Merge: keep frontend state if downloading, add backend state.
              // Also recover progress from the partial file size in case a
              // Tauri progress event is missed by the current window.
              for (const model of result.data) {
                if (!backendDownloading[model.id]) continue;
                state.downloadingModels[model.id] = true;

                const polledProgress = progressFromModelPartial(
                  model,
                  state.downloadProgress[model.id],
                );
                if (polledProgress) {
                  state.downloadProgress[model.id] = polledProgress;
                }
              }

              // Remove models that backend says are NOT downloading AND
              // frontend doesn't have progress for (completed/cancelled).
              // If the model is already installed, clear stale optimistic
              // progress even if the completion event was missed.
              Object.keys(state.downloadingModels).forEach((id) => {
                if (
                  !backendDownloading[id] &&
                  (backendModels[id]?.is_downloaded ||
                    !state.downloadProgress[id])
                ) {
                  delete state.downloadingModels[id];
                  delete state.downloadProgress[id];
                  delete state.downloadStats[id];
                }
              });
            }),
          );
        } else {
          set({ error: `Failed to load models: ${result.error}` });
        }
      } catch (err) {
        set({ error: `Failed to load models: ${err}` });
      } finally {
        set({ loading: false });
      }
    },

    loadCurrentModel: async () => {
      try {
        const result = await commands.getCurrentModel();
        if (result.status === "ok") {
          set({ currentModel: result.data });
        }
      } catch (err) {
        console.error("Failed to load current model:", err);
      }
    },

    checkFirstRun: async () => {
      try {
        const result = await commands.hasAnyModelsAvailable();
        if (result.status === "ok") {
          const hasModels = result.data;
          set({ hasAnyModels: hasModels, isFirstRun: !hasModels });
          return !hasModels;
        }
        return false;
      } catch (err) {
        console.error("Failed to check model availability:", err);
        return false;
      }
    },

    selectModel: async (modelId: string) => {
      try {
        set({ error: null });
        const result = await commands.setActiveModel(modelId);
        if (result.status === "ok") {
          set({
            currentModel: modelId,
            isFirstRun: false,
            hasAnyModels: true,
          });
          return true;
        } else {
          set({ error: `Failed to switch to model: ${result.error}` });
          return false;
        }
      } catch (err) {
        set({ error: `Failed to switch to model: ${err}` });
        return false;
      }
    },

    downloadModel: async (modelId: string) => {
      try {
        set({ error: null });
        set(
          produce((state) => {
            state.downloadingModels[modelId] = true;
            state.downloadProgress[modelId] = {
              model_id: modelId,
              downloaded: 0,
              total: 0,
              percentage: 0,
            };
          }),
        );

        let pollId: number | null =
          typeof window === "undefined"
            ? null
            : window.setInterval(() => {
                if (modelId in get().downloadingModels) {
                  void get().loadModels();
                }
              }, 1000);

        const result = await commands.downloadModel(modelId).finally(() => {
          if (pollId !== null) {
            window.clearInterval(pollId);
            pollId = null;
          }
        });
        if (result.status === "ok") {
          set(
            produce((state) => {
              delete state.downloadingModels[modelId];
              delete state.downloadProgress[modelId];
              delete state.downloadStats[modelId];
            }),
          );
          await get().loadModels();
          return true;
        } else {
          set({ error: `Failed to download model: ${result.error}` });
          set(
            produce((state) => {
              delete state.downloadingModels[modelId];
              delete state.downloadProgress[modelId];
              delete state.downloadStats[modelId];
            }),
          );
          return false;
        }
      } catch (err) {
        set({ error: `Failed to download model: ${err}` });
        set(
          produce((state) => {
            delete state.downloadingModels[modelId];
            delete state.downloadProgress[modelId];
            delete state.downloadStats[modelId];
          }),
        );
        return false;
      }
    },

    cancelDownload: async (modelId: string) => {
      try {
        set({ error: null });
        const result = await commands.cancelDownload(modelId);
        if (result.status === "ok") {
          set(
            produce((state) => {
              delete state.downloadingModels[modelId];
              delete state.downloadProgress[modelId];
              delete state.downloadStats[modelId];
            }),
          );

          // Reload models to sync with backend state
          await get().loadModels();
          return true;
        } else {
          set({ error: `Failed to cancel download: ${result.error}` });
          return false;
        }
      } catch (err) {
        set({ error: `Failed to cancel download: ${err}` });
        return false;
      }
    },

    deleteModel: async (modelId: string) => {
      try {
        set({ error: null });
        const result = await commands.deleteModel(modelId);
        if (result.status === "ok") {
          await get().loadModels();
          await get().loadCurrentModel();
          return true;
        } else {
          set({ error: `Failed to delete model: ${result.error}` });
          return false;
        }
      } catch (err) {
        set({ error: `Failed to delete model: ${err}` });
        return false;
      }
    },

    getModelInfo: (modelId: string) => {
      return get().models.find((model) => model.id === modelId);
    },

    isModelDownloading: (modelId: string) => {
      return modelId in get().downloadingModels;
    },

    isModelExtracting: (modelId: string) => {
      return modelId in get().extractingModels;
    },

    getDownloadProgress: (modelId: string) => {
      return get().downloadProgress[modelId];
    },

    initialize: async () => {
      if (get().initialized) return;

      const existingPromise = get().initializePromise;
      if (existingPromise) {
        return existingPromise;
      }

      const { loadModels, loadCurrentModel, checkFirstRun } = get();

      const initializePromise = (async () => {
        // Load initial data
        await Promise.all([loadModels(), loadCurrentModel(), checkFirstRun()]);

        // Set up event listeners after data load. Awaiting registration avoids
        // marking the store initialized before it can receive backend updates.
        const eventUnlisteners = await Promise.all([
          listen<DownloadProgress>("model-download-progress", (event) => {
            const progress = event.payload;
            set(
              produce((state) => {
                state.downloadingModels[progress.model_id] = true;
                state.downloadProgress[progress.model_id] = progress;
              }),
            );

            // Update download stats for speed calculation
            const now = Date.now();
            set(
              produce((state) => {
                const current = state.downloadStats[progress.model_id];

                if (!current) {
                  state.downloadStats[progress.model_id] = {
                    startTime: now,
                    lastUpdate: now,
                    totalDownloaded: progress.downloaded,
                    speed: 0,
                  };
                } else {
                  const timeDiff = (now - current.lastUpdate) / 1000;
                  const bytesDiff =
                    progress.downloaded - current.totalDownloaded;

                  if (timeDiff > 0.5) {
                    const currentSpeed = bytesDiff / (1024 * 1024) / timeDiff;
                    const validCurrentSpeed = Math.max(0, currentSpeed);
                    const smoothedSpeed =
                      current.speed > 0
                        ? current.speed * 0.8 + validCurrentSpeed * 0.2
                        : validCurrentSpeed;

                    state.downloadStats[progress.model_id] = {
                      startTime: current.startTime,
                      lastUpdate: now,
                      totalDownloaded: progress.downloaded,
                      speed: Math.max(0, smoothedSpeed),
                    };
                  }
                }
              }),
            );
          }),

          listen<string>("model-download-complete", (event) => {
            const modelId = event.payload;
            set(
              produce((state) => {
                delete state.downloadingModels[modelId];
                delete state.downloadProgress[modelId];
                delete state.downloadStats[modelId];
              }),
            );
            void get().loadModels();
          }),

          listen<string>("model-extraction-started", (event) => {
            const modelId = event.payload;
            set(
              produce((state) => {
                state.extractingModels[modelId] = true;
              }),
            );
          }),

          listen<string>("model-extraction-completed", (event) => {
            const modelId = event.payload;
            set(
              produce((state) => {
                delete state.extractingModels[modelId];
              }),
            );
            void get().loadModels();
          }),

          listen<{ model_id: string; error: string }>(
            "model-extraction-failed",
            (event) => {
              const modelId = event.payload.model_id;
              set(
                produce((state) => {
                  delete state.extractingModels[modelId];
                  state.error = `Failed to extract model: ${event.payload.error}`;
                }),
              );
            },
          ),

          listen<string>("model-download-cancelled", (event) => {
            const modelId = event.payload;
            set(
              produce((state) => {
                delete state.downloadingModels[modelId];
                delete state.downloadProgress[modelId];
                delete state.downloadStats[modelId];
              }),
            );
          }),

          listen<string>("model-deleted", () => {
            void get().loadModels();
            void get().loadCurrentModel();
          }),

          listen<string>("active-model-changed", (event) => {
            set({
              currentModel: event.payload,
              isFirstRun: false,
              hasAnyModels: true,
            });
          }),

          listen("model-state-changed", () => {
            void get().loadModels();
            void get().loadCurrentModel();
          }),
        ]);

        set({ initialized: true, eventUnlisteners });
      })();

      set({ initializePromise });

      try {
        await initializePromise;
      } finally {
        if (get().initializePromise === initializePromise) {
          set({ initializePromise: null });
        }
      }
    },
  })),
);
