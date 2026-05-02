import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.hoisted(() => vi.fn());
const commandMocks = vi.hoisted(() => ({
  getAvailableModels: vi.fn(),
  getCurrentModel: vi.fn(),
  hasAnyModelsAvailable: vi.fn(),
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
});
