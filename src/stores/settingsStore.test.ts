import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  getDefaultSettings: vi.fn(),
  checkCustomSounds: vi.fn(),
  changeAppThemeSetting: vi.fn(),
  changeCustomFillerWordsSetting: vi.fn(),
  changePostProcessApiKeySetting: vi.fn(),
  changeScreenContextOcrEngineSetting: vi.fn(),
  changeTranslationModelIdsSetting: vi.fn(),
  setModelUnloadTimeout: vi.fn(),
}));

vi.mock("@/bindings", () => ({
  commands: commandMocks,
}));

import { useSettingsStore } from "@/stores/settingsStore";

function resetStoreState() {
  useSettingsStore.setState({
    settings: null,
    defaultSettings: null,
    isLoading: true,
    initializePromise: null,
    isUpdating: {},
    audioDevices: [],
    outputDevices: [],
    customSounds: { start: false, stop: false },
    postProcessModelOptions: {},
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("settings store", () => {
  beforeEach(() => {
    resetStoreState();
    vi.clearAllMocks();
  });

  it("shares a single in-flight initialize call", async () => {
    const settingsDeferred = deferred<{
      status: "ok";
      data: Record<string, unknown>;
    }>();
    const defaultsDeferred = deferred<{
      status: "ok";
      data: Record<string, unknown>;
    }>();
    const soundsDeferred = deferred<{ start: boolean; stop: boolean }>();

    commandMocks.getAppSettings.mockReturnValue(settingsDeferred.promise);
    commandMocks.getDefaultSettings.mockReturnValue(defaultsDeferred.promise);
    commandMocks.checkCustomSounds.mockReturnValue(soundsDeferred.promise);

    const init1 = useSettingsStore.getState().initialize();
    const init2 = useSettingsStore.getState().initialize();

    expect(commandMocks.getAppSettings).toHaveBeenCalledTimes(1);
    expect(commandMocks.getDefaultSettings).toHaveBeenCalledTimes(1);
    expect(commandMocks.checkCustomSounds).toHaveBeenCalledTimes(1);

    settingsDeferred.resolve({
      status: "ok",
      data: {
        app_theme: "dark",
        selected_language: "en",
        audio_feedback: false,
        always_on_microphone: false,
        selected_microphone: "Default",
        clamshell_microphone: "Default",
        selected_output_device: "Default",
      },
    });
    defaultsDeferred.resolve({
      status: "ok",
      data: { app_theme: "system" },
    });
    soundsDeferred.resolve({ start: false, stop: false });

    await Promise.all([init1, init2]);

    expect(useSettingsStore.getState().initializePromise).toBeNull();
    expect(useSettingsStore.getState().settings).not.toBeNull();
    expect(useSettingsStore.getState().defaultSettings).not.toBeNull();
  });

  it("rolls back only the failed key when an update fails", async () => {
    useSettingsStore.setState({
      settings: {
        app_theme: "dark",
        selected_language: "en",
        audio_feedback: false,
      } as never,
      isLoading: false,
    });

    const updateDeferred = deferred<{
      status: "error";
      error: string;
    }>();
    commandMocks.changeAppThemeSetting.mockReturnValue(updateDeferred.promise);

    const updatePromise = useSettingsStore
      .getState()
      .updateSetting("app_theme" as never, "light" as never);

    expect(useSettingsStore.getState().settings?.app_theme).toBe("light");

    useSettingsStore.setState((state) => ({
      settings: state.settings
        ? {
            ...state.settings,
            selected_language: "fr",
          }
        : state.settings,
    }));

    updateDeferred.resolve({ status: "error", error: "boom" });

    await expect(updatePromise).resolves.toBeUndefined();

    const settings = useSettingsStore.getState().settings;
    expect(settings?.app_theme).toBe("dark");
    expect(settings?.selected_language).toBe("fr");
    expect(useSettingsStore.getState().isUpdatingKey("app_theme")).toBe(false);
  });

  it("persists every audited setting through its native command", async () => {
    useSettingsStore.setState({
      settings: {
        custom_filler_words: null,
        model_unload_timeout: "never",
        screen_context_ocr_engine: "native_then_backup",
        translation_model_ids: { openai: "old-model" },
      } as never,
      isLoading: false,
    });

    const success = { status: "ok" as const, data: null };
    commandMocks.changeCustomFillerWordsSetting.mockResolvedValue(success);
    commandMocks.changeScreenContextOcrEngineSetting.mockResolvedValue(success);
    commandMocks.changeTranslationModelIdsSetting.mockResolvedValue(success);
    commandMocks.setModelUnloadTimeout.mockResolvedValue(success);

    await useSettingsStore
      .getState()
      .updateSetting("custom_filler_words", ["well", "you know"]);
    await useSettingsStore
      .getState()
      .updateSetting("screen_context_ocr_engine", "native_only");
    await useSettingsStore
      .getState()
      .updateSetting("translation_model_ids", { openai: "gpt-4.1-mini" });
    await useSettingsStore
      .getState()
      .updateSetting("model_unload_timeout", "min5");

    expect(commandMocks.changeCustomFillerWordsSetting).toHaveBeenCalledWith([
      "well",
      "you know",
    ]);
    expect(
      commandMocks.changeScreenContextOcrEngineSetting,
    ).toHaveBeenCalledWith("native_only");
    expect(commandMocks.changeTranslationModelIdsSetting).toHaveBeenCalledWith({
      openai: "gpt-4.1-mini",
    });
    expect(commandMocks.setModelUnloadTimeout).toHaveBeenCalledWith("min5");
  });

  it("rolls back an optimistically displayed setting without a handler", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    useSettingsStore.setState({
      settings: {
        selected_llm_model_id: "before",
      } as never,
      isLoading: false,
    });

    await expect(
      useSettingsStore
        .getState()
        .updateSetting("selected_llm_model_id", "after"),
    ).resolves.toBeUndefined();

    expect(useSettingsStore.getState().settings?.selected_llm_model_id).toBe(
      "before",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to update setting:",
      expect.objectContaining({ key: "selected_llm_model_id" }),
    );
    consoleError.mockRestore();
  });

  it("preserves secure API key status from backend settings", async () => {
    commandMocks.getAppSettings.mockResolvedValue({
      status: "ok",
      data: {
        app_theme: "dark",
        selected_language: "en",
        audio_feedback: false,
        always_on_microphone: false,
        selected_microphone: "Default",
        clamshell_microphone: "Default",
        selected_output_device: "Default",
        post_process_api_key_status: {
          openai: true,
        },
      },
    });

    await useSettingsStore.getState().refreshSettings();

    expect(
      useSettingsStore.getState().settings?.post_process_api_key_status?.openai,
    ).toBe(true);
  });
});
