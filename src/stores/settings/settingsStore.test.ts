import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
  SettingsSnapshot,
  ShortcutBinding,
} from "@/bindings";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  settingsListeners: [] as Array<(event: { payload: unknown }) => void>,
  toastError: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/lib/tauriEvents", () => ({
  listen: vi.fn(async (event: string, handler: never) => {
    if (event === "settings-snapshot") native.settingsListeners.push(handler);
    return () => {};
  }),
}));
vi.mock("sonner", () => ({ toast: { error: native.toastError } }));
vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, options?: { error?: string }) =>
      options?.error ? `${key}: ${options.error}` : key,
  },
}));

import { useSettingsStore } from "../settingsStore";

const state = () => useSettingsStore.getState();
const nativeCalls = () => native.invoke.mock.calls.map(([command]) => command);
let revision = 0;
const snapshot = (value: AppSettings = settings()): SettingsSnapshot => ({
  revision: ++revision,
  settings: value,
});

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    bindings: {},
    app_theme: "dark",
    audio_feedback: false,
    selected_language: "en",
    ...patch,
  } as AppSettings;
}

function binding(current: string): ShortcutBinding {
  return {
    id: "transcribe",
    name: "Transcribe",
    description: "",
    default_binding: "option+space",
    current_binding: current,
  };
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
    useSettingsStore.setState({
      settings: settings(),
      defaultSettings: settings({ app_theme: "system" }),
      isLoading: false,
      initializePromise: null,
      isUpdating: {},
      audioDevices: [],
      outputDevices: [],
      customSounds: { start: false, stop: false },
      postProcessModelOptions: {},
    });
    native.invoke.mockReset();
    state().acceptSettingsSnapshot(snapshot());
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_settings_snapshot") return snapshot();
      if (command === "update_setting")
        return snapshot(settings({ [args.update.key]: args.update.value }));
      return null;
    });
    native.toastError.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("discards a model list fetched from a replaced provider endpoint", async () => {
    const oldModels = deferred<string[]>();
    native.invoke.mockImplementation(async (command) => {
      if (command === "fetch_post_process_models") return oldModels.promise;
      return null;
    });
    const pending = state().fetchPostProcessModels("custom");
    expect(
      await state().updatePostProcessBaseUrl(
        "custom",
        "http://localhost:4000/v1",
      ),
    ).toBe(true);
    oldModels.resolve(["old-endpoint-model"]);
    expect(await pending).toEqual([]);
    expect(state().postProcessModelOptions.custom).toEqual([]);
    expect(state().isUpdatingKey("post_process_models_fetch:custom")).toBe(
      false,
    );
  });

  it("initializes once without enumerating audio devices", async () => {
    useSettingsStore.setState({ settings: null, isLoading: true });
    native.invoke.mockImplementation(async (command) =>
      command === "check_custom_sounds"
        ? { start: true, stop: false }
        : command === "get_settings_snapshot"
          ? snapshot()
          : settings(),
    );

    await Promise.all([state().initialize(), state().initialize()]);

    expect(nativeCalls().sort()).toEqual([
      "check_custom_sounds",
      "get_default_settings",
      "get_settings_snapshot",
    ]);
    expect(state().settings?.app_theme).toBe("dark");
    expect(state().customSounds.start).toBe(true);
    expect(state().initializePromise).toBeNull();
  });

  it("sends one typed update and shows the new value while it saves", async () => {
    const save = deferred<SettingsSnapshot>();
    native.invoke.mockReturnValue(save.promise);

    const saving = state().updateSetting("app_theme", "light");
    expect(state().settings?.app_theme).toBe("light");
    expect(state().isUpdatingKey("app_theme")).toBe(true);

    save.resolve(snapshot(settings({ app_theme: "light" })));
    await expect(saving).resolves.toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("update_setting", {
      update: { key: "app_theme", value: "light" },
    });
    expect(state().isUpdatingKey("app_theme")).toBe(false);
  });

  it("rolls back only the rejected key and tells the user why", async () => {
    const save = deferred<null>();
    native.invoke.mockReturnValue(save.promise);

    const saving = state().updateSetting("app_theme", "light");
    state().acceptSettingsSnapshot(
      snapshot(settings({ selected_language: "fr" })),
    );
    native.invoke.mockImplementation(async (command) =>
      command === "get_settings_snapshot"
        ? snapshot(settings({ selected_language: "fr" }))
        : save.promise,
    );
    save.reject("Unknown app theme 'light'.");

    await expect(saving).resolves.toBe(false);
    expect(state().settings?.app_theme).toBe("dark");
    expect(state().settings?.selected_language).toBe("fr");
    expect(native.toastError).toHaveBeenCalledWith(
      "settings.errors.saveFailed: Unknown app theme 'light'.",
    );
    expect(state().isUpdatingKey("app_theme")).toBe(false);
  });

  it("adopts every committed snapshot the backend broadcasts", () => {
    const committed = settings({ app_theme: "ocean", audio_feedback: true });
    for (const deliver of native.settingsListeners) {
      deliver({ payload: snapshot(committed) });
    }
    expect(state().settings).toEqual(committed);
  });

  it("resets a setting to its default value", async () => {
    await expect(state().resetSetting("app_theme")).resolves.toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("update_setting", {
      update: { key: "app_theme", value: "system" },
    });
  });

  it("uses the backend device list and falls back to the system default", async () => {
    const devices = [
      { index: "default", name: "Default", is_default: true },
      { index: "0", name: "USB", is_default: false },
    ];
    native.invoke.mockResolvedValue(devices);
    await state().refreshAudioDevices();
    expect(state().audioDevices).toEqual(devices);

    native.invoke.mockRejectedValue("Device unavailable");
    await state().refreshOutputDevices();
    expect(state().outputDevices).toEqual([devices[0]]);
  });

  it("changes the custom endpoint in one native call and drops stale models", async () => {
    state().setPostProcessModelOptions("custom", ["old-model"]);
    await expect(
      state().updatePostProcessBaseUrl("custom", "https://example.test/v1"),
    ).resolves.toBe(true);
    expect(native.invoke.mock.calls).toEqual([
      [
        "set_post_process_base_url",
        { providerId: "custom", baseUrl: "https://example.test/v1" },
      ],
    ]);
    expect(state().postProcessModelOptions.custom).toEqual([]);
  });

  it("keeps cached models when an endpoint change is rejected", async () => {
    state().setPostProcessModelOptions("custom", ["old-model"]);
    native.invoke.mockRejectedValue("Custom provider URL must be local.");
    await expect(
      state().updatePostProcessBaseUrl("custom", "https://example.test/v1"),
    ).resolves.toBe(false);
    expect(state().postProcessModelOptions.custom).toEqual(["old-model"]);
    expect(native.toastError).toHaveBeenCalled();
    expect(state().isUpdatingKey("post_process_base_url:custom")).toBe(false);
  });

  it("selects a provider through the typed update and restores it on rejection", async () => {
    state().acceptSettingsSnapshot(
      snapshot(settings({ post_process_provider_id: "previous" })),
    );
    state().setPostProcessModelOptions("next", ["cached"]);
    native.invoke.mockRejectedValue("Provider 'next' not found.");

    await expect(state().setPostProcessProvider("next")).resolves.toBe(false);
    expect(native.invoke).toHaveBeenCalledWith("update_setting", {
      update: { key: "post_process_provider_id", value: "next" },
    });
    expect(state().settings?.post_process_provider_id).toBe("previous");
    expect(state().postProcessModelOptions.next).toEqual([]);
  });

  it("stores API keys natively without placing them in the snapshot", async () => {
    state().setPostProcessModelOptions("custom", ["cached"]);
    await state().updatePostProcessApiKey("custom", "test-only-key");
    expect(native.invoke).toHaveBeenCalledWith("set_post_process_api_key", {
      providerId: "custom",
      apiKey: "test-only-key",
    });
    expect(JSON.stringify(state().settings)).not.toContain("test-only-key");
    expect(state().postProcessModelOptions.custom).toEqual([]);
  });

  it("reports a failed model listing as a listing error", async () => {
    native.invoke.mockRejectedValue("API key is required for OpenAI.");
    await expect(state().fetchPostProcessModels("openai")).resolves.toEqual([]);
    expect(native.toastError).toHaveBeenCalledWith(
      "settings.errors.modelListFailed: API key is required for OpenAI.",
    );
  });

  it("adopts the saved shortcut and restores the previous one on rejection", async () => {
    useSettingsStore.setState({
      settings: settings({ bindings: { transcribe: binding("option+space") } }),
    });
    native.invoke.mockResolvedValue({
      success: true,
      binding: binding("ctrl+space"),
      error: null,
    });
    await state().updateBinding("transcribe", "ctrl+space");
    expect(state().settings?.bindings.transcribe.current_binding).toBe(
      "ctrl+space",
    );

    native.invoke.mockRejectedValue("Shortcut 'ctrl+k' is already in use");
    await expect(state().updateBinding("transcribe", "ctrl+k")).rejects.toThrow(
      "already in use",
    );
    expect(state().settings?.bindings.transcribe.current_binding).toBe(
      "ctrl+space",
    );
    expect(state().isUpdatingKey("binding_transcribe")).toBe(false);
  });

  it("reconciles a save that committed before its runtime effect failed", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "update_setting")
        throw "Failed to update launch at login";
      return snapshot(settings({ autostart_enabled: true }));
    });
    await expect(
      state().updateSetting("autostart_enabled", true),
    ).resolves.toBe(false);
    expect(state().settings?.autostart_enabled).toBe(true);
    expect(native.toastError).toHaveBeenCalled();
  });

  it("surfaces the public shortcut failure envelope", async () => {
    native.invoke.mockResolvedValue({
      success: false,
      binding: null,
      error: "Shortcut is reserved",
    });
    await expect(state().resetBinding("transcribe")).rejects.toThrow(
      "reserved",
    );
    expect(state().isUpdatingKey("binding_transcribe")).toBe(false);
  });
});
