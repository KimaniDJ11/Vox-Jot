import { beforeEach, describe, expect, it, vi } from "vitest";

// Matches the real `listen` contract (a promise resolving to an unlisten fn) so
// module-scope listeners — the store's own and i18n's — can attach a `.catch`.
const listenMock = vi.hoisted(() =>
  vi.fn(
    (
      _eventName: string,
      _callback: (event: { payload: unknown }) => void,
    ): Promise<() => void> => Promise.resolve(() => {}),
  ),
);
const commandMocks = vi.hoisted(() => ({
  getAvailableModels: vi.fn(),
  getCurrentModel: vi.fn(),
  hasAnyModelsAvailable: vi.fn(),
  downloadModel: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@/bindings", () => ({
  commands: commandMocks,
}));

import { useModelStore } from "@/stores/modelStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resetStoreState() {
  for (const unlisten of useModelStore.getState().eventUnlisteners) {
    unlisten();
  }

  useModelStore.setState({
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
  });
}

describe("model store", () => {
  beforeEach(() => {
    resetStoreState();
    vi.clearAllMocks();
    listenMock.mockResolvedValue(() => {});
  });

  it("shares one in-flight initialize call and registers listeners once", async () => {
    const modelsDeferred = deferred<{
      status: "ok";
      data: [];
    }>();
    const currentModelDeferred = deferred<{
      status: "ok";
      data: string;
    }>();
    const availabilityDeferred = deferred<{
      status: "ok";
      data: boolean;
    }>();

    commandMocks.getAvailableModels.mockReturnValue(modelsDeferred.promise);
    commandMocks.getCurrentModel.mockReturnValue(currentModelDeferred.promise);
    commandMocks.hasAnyModelsAvailable.mockReturnValue(
      availabilityDeferred.promise,
    );

    const init1 = useModelStore.getState().initialize();
    const init2 = useModelStore.getState().initialize();

    expect(commandMocks.getAvailableModels).toHaveBeenCalledTimes(1);
    expect(commandMocks.getCurrentModel).toHaveBeenCalledTimes(1);
    expect(commandMocks.hasAnyModelsAvailable).toHaveBeenCalledTimes(1);

    modelsDeferred.resolve({ status: "ok", data: [] });
    currentModelDeferred.resolve({ status: "ok", data: "small" });
    availabilityDeferred.resolve({ status: "ok", data: false });

    await Promise.all([init1, init2]);

    expect(listenMock).toHaveBeenCalledTimes(9);
    expect(useModelStore.getState().initialized).toBe(true);
    expect(useModelStore.getState().initializePromise).toBeNull();
    expect(useModelStore.getState().isFirstRun).toBe(true);
  });

  it("keeps a model marked as downloading when progress events arrive", async () => {
    const listeners: Record<string, (event: { payload: unknown }) => void> = {};
    listenMock.mockImplementation(
      async (
        eventName: string,
        callback: (event: { payload: unknown }) => void,
      ) => {
        listeners[eventName] = callback;
        return () => {};
      },
    );
    commandMocks.getAvailableModels.mockResolvedValue({
      status: "ok",
      data: [],
    });
    commandMocks.getCurrentModel.mockResolvedValue({ status: "ok", data: "" });
    commandMocks.hasAnyModelsAvailable.mockResolvedValue({
      status: "ok",
      data: false,
    });

    await useModelStore.getState().initialize();

    listeners["model-download-progress"]?.({
      payload: {
        model_id: "large",
        downloaded: 512,
        total: 1024,
        percentage: 50,
      },
    });

    expect(useModelStore.getState().downloadingModels.large).toBe(true);
    expect(useModelStore.getState().downloadProgress.large?.percentage).toBe(
      50,
    );
  });

  it("recovers download progress from backend partial-file metadata", async () => {
    useModelStore.setState({
      downloadingModels: { medium: true },
      downloadProgress: {
        medium: {
          model_id: "medium",
          downloaded: 0,
          total: 0,
          percentage: 0,
        },
      },
    });
    commandMocks.getAvailableModels.mockResolvedValue({
      status: "ok",
      data: [
        {
          id: "medium",
          partial_size: 50 * 1024 * 1024,
          size_mb: 100,
          is_downloading: true,
          is_downloaded: false,
        },
      ],
    });

    await useModelStore.getState().loadModels();

    expect(useModelStore.getState().downloadingModels.medium).toBe(true);
    expect(useModelStore.getState().downloadProgress.medium?.percentage).toBe(
      50,
    );
  });

  it("does not invoke a duplicate native download while one is already active", async () => {
    const downloadDeferred = deferred<{
      status: "ok";
      data: null;
    }>();
    commandMocks.downloadModel.mockReturnValue(downloadDeferred.promise);
    commandMocks.getAvailableModels.mockResolvedValue({
      status: "ok",
      data: [],
    });

    const firstDownload = useModelStore.getState().downloadModel("small");
    const secondDownload = await useModelStore
      .getState()
      .downloadModel("small");

    expect(secondDownload).toBe(true);
    expect(commandMocks.downloadModel).toHaveBeenCalledTimes(1);
    expect(commandMocks.downloadModel).toHaveBeenCalledWith("small");

    downloadDeferred.resolve({ status: "ok", data: null });
    await firstDownload;
  });
});
