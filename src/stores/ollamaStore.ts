import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: string[];
}

export interface OllamaModelInfo {
  id: string;
  label: string;
  description: string;
  is_pulled: boolean;
}

export interface OllamaPullProgress {
  model: string;
  status: string;
  percent: number;
  total: number;
  completed: number;
}

interface OllamaStore {
  // Status
  status: OllamaStatus | null;
  isChecking: boolean;
  isInstalling: boolean;
  installProgress: string;
  installedModels: string[];

  // Recommended models (from Rust)
  recommendedModels: OllamaModelInfo[];

  // Pull progress: model name -> percent
  pullProgress: Record<string, number>;
  pullingModels: Set<string>;

  // Actions
  checkStatus: () => Promise<OllamaStatus>;
  installOllama: () => Promise<boolean>;
  pullModel: (modelName: string) => Promise<boolean>;
  deleteModel: (modelName: string) => Promise<boolean>;
  loadRecommendedModels: () => Promise<void>;
  startServe: () => Promise<boolean>;
}

export const useOllamaStore = create<OllamaStore>((set, get) => ({
  status: null,
  isChecking: false,
  isInstalling: false,
  installProgress: "",
  installedModels: [],
  recommendedModels: [],
  pullProgress: {},
  pullingModels: new Set(),

  checkStatus: async () => {
    set({ isChecking: true });
    try {
      const status = await invoke<OllamaStatus>("check_ollama_status");
      set({
        status,
        installedModels: status.models,
        isChecking: false,
      });
      return status;
    } catch (e) {
      console.error("Failed to check Ollama status:", e);
      const fallback: OllamaStatus = { installed: false, running: false, models: [] };
      set({ status: fallback, isChecking: false });
      return fallback;
    }
  },

  installOllama: async () => {
    set({ isInstalling: true, installProgress: "Starting installation..." });

    // Listen for progress events
    const unlisten = await listen<string>("ollama-install-progress", (event) => {
      set({ installProgress: event.payload });
    });

    const unlistenComplete = await listen<boolean>("ollama-install-complete", () => {
      set({ isInstalling: false, installProgress: "" });
      get().checkStatus();
    });

    try {
      await invoke("install_ollama");
      await get().checkStatus();
      return true;
    } catch (e) {
      console.error("Ollama installation failed:", e);
      set({ isInstalling: false, installProgress: "" });
      return false;
    } finally {
      unlisten();
      unlistenComplete();
    }
  },

  pullModel: async (modelName: string) => {
    const { pullingModels } = get();
    const newPulling = new Set(pullingModels);
    newPulling.add(modelName);
    set({ pullingModels: newPulling });

    // Listen for streaming progress
    const unlisten = await listen<OllamaPullProgress>("ollama-pull-progress", (event) => {
      const p = event.payload;
      if (p.model === modelName) {
        set((state) => ({
          pullProgress: { ...state.pullProgress, [modelName]: p.percent },
        }));
      }
    });

    const unlistenComplete = await listen<string>("ollama-pull-complete", (event) => {
      if (event.payload === modelName) {
        const newPullingSet = new Set(get().pullingModels);
        newPullingSet.delete(modelName);
        set((state) => ({
          pullingModels: newPullingSet,
          pullProgress: { ...state.pullProgress, [modelName]: 100 },
        }));
        // Refresh status to pick up the newly pulled model
        get().checkStatus();
      }
    });

    try {
      await invoke("pull_ollama_model", { modelName });
      return true;
    } catch (e) {
      console.error(`Failed to pull Ollama model ${modelName}:`, e);
      const newPullingSet = new Set(get().pullingModels);
      newPullingSet.delete(modelName);
      set({ pullingModels: newPullingSet });
      return false;
    } finally {
      unlisten();
      unlistenComplete();
    }
  },

  deleteModel: async (modelName: string) => {
    try {
      await invoke("delete_ollama_model", { modelName });
      await get().checkStatus();
      return true;
    } catch (e) {
      console.error(`Failed to delete Ollama model ${modelName}:`, e);
      return false;
    }
  },

  loadRecommendedModels: async () => {
    try {
      const models = await invoke<OllamaModelInfo[]>("get_recommended_ollama_models");
      const status = get().status;
      // Annotate is_pulled based on installed models
      const enriched = models.map((m) => ({
        ...m,
        is_pulled: status?.models.some((installed) =>
          installed.startsWith(m.id.split(":")[0])
        ) ?? false,
      }));
      set({ recommendedModels: enriched });
    } catch (e) {
      console.error("Failed to load recommended Ollama models:", e);
    }
  },

  startServe: async () => {
    try {
      await invoke("start_ollama_serve");
      await get().checkStatus();
      return true;
    } catch (e) {
      console.error("Failed to start Ollama serve:", e);
      return false;
    }
  },
}));
