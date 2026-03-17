import { expect, test, type Page } from "@playwright/test";

type Scenario = {
  appleAvailable: boolean;
  hasAnyModels: boolean;
  historyEntries: Array<Record<string, unknown>>;
  permissions: {
    accessibility: boolean;
    microphone: boolean;
  };
  platform: "macos" | "windows" | "linux";
  settings: Record<string, unknown>;
  models: Array<Record<string, unknown>>;
};

const baseProviders = [
  {
    id: "apple_intelligence",
    label: "Apple Intelligence",
    base_url: "",
    allow_base_url_edit: false,
    models_endpoint: null,
    supports_structured_output: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    allow_base_url_edit: false,
    models_endpoint: "/models",
    supports_structured_output: true,
  },
  {
    id: "custom",
    label: "Custom",
    base_url: "",
    allow_base_url_edit: true,
    models_endpoint: "/models",
    supports_structured_output: true,
  },
];

const baseBindings = {
  cancel: {
    id: "cancel",
    name: "Cancel Shortcut",
    description: "Cancel the current recording.",
    default_binding: "Escape",
    current_binding: "Escape",
  },
  transcribe: {
    id: "transcribe",
    name: "Transcribe Shortcut",
    description: "Record and transcribe your voice.",
    default_binding: "Option+Space",
    current_binding: "Option+Space",
  },
  transcribe_with_post_process: {
    id: "transcribe_with_post_process",
    name: "Post-Processing Hotkey",
    description: "Always run post-processing before paste.",
    default_binding: "Option+Shift+Space",
    current_binding: "Option+Shift+Space",
  },
};

const downloadedModel = {
  accuracy_score: 0.85,
  description: "Fast and accurate",
  engine_type: "Parakeet",
  filename: "parakeet.bin",
  id: "parakeet-tdt-0.6b-v3",
  is_custom: false,
  is_directory: false,
  is_downloaded: true,
  is_downloading: false,
  is_recommended: true,
  name: "Parakeet V3",
  partial_size: 0,
  size_mb: 540,
  speed_score: 0.92,
  supported_languages: ["en"],
  supports_translation: false,
  url: null,
};

const availableModel = {
  ...downloadedModel,
  is_downloaded: false,
  partial_size: 0,
};

const baseSettings = {
  app_aware_tone_enabled: false,
  app_language: "en",
  audio_feedback: false,
  audio_feedback_volume: 0.75,
  auto_submit: false,
  auto_submit_key: "cmd_enter",
  autostart_enabled: false,
  bindings: baseBindings,
  clipboard_handling: "dont_modify",
  clamshell_microphone: "Default",
  custom_words: [],
  debug_mode: false,
  experimental_enabled: false,
  external_script_path: null,
  fallback_to_raw_on_failure: true,
  history_limit: 100,
  keyboard_implementation: "tauri",
  log_level: "info",
  max_rewrite_strength: 1,
  model_unload_timeout: "never",
  mute_while_recording: false,
  overlay_position: "bottom",
  paste_delay_ms: 0,
  paste_method: "direct",
  personal_dictionary: [],
  post_process_api_keys: {
    apple_intelligence: "",
    custom: "",
    openai: "sk-test",
  },
  post_process_enabled: false,
  post_process_mode: "literal",
  post_process_models: {
    apple_intelligence: "",
    custom: "",
    openai: "gpt-4.1-mini",
  },
  post_process_prompts: [
    {
      id: "clean-up",
      name: "Clean up",
      prompt: "Improve grammar and clarity for the following text: ${output}",
    },
  ],
  post_process_providers: baseProviders,
  post_process_selected_prompt_id: "clean-up",
  post_process_provider_id: "openai",
  push_to_talk: false,
  recording_retention_period: "never",
  selected_language: "auto",
  selected_microphone: "Default",
  selected_model: downloadedModel.id,
  selected_output_device: "Default",
  show_preview_before_paste: false,
  show_tray_icon: true,
  sound_theme: "marimba",
  start_hidden: false,
  tone_definitions: [
    {
      id: "neutral",
      instruction:
        "Keep the tone neutral and close to the speaker's original wording.",
      label: "Neutral",
    },
  ],
  translate_to_english: false,
  typing_tool: "auto",
  update_checks_enabled: true,
  word_correction_threshold: 0.7,
};

const baseScenario: Scenario = {
  appleAvailable: true,
  hasAnyModels: true,
  historyEntries: [],
  models: [downloadedModel],
  permissions: {
    accessibility: true,
    microphone: true,
  },
  platform: "macos",
  settings: baseSettings,
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const mergeDeep = <T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T => {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      mergeDeep(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      target[key] = value as T[keyof T];
    }
  }

  return target;
};

const bootApp = async (
  page: Page,
  overrides: Partial<Scenario> = {},
) => {
  const scenario = mergeDeep(clone(baseScenario), overrides as Record<string, unknown>);

  await page.addInitScript((activeScenario: Scenario) => {
    const callbacks: Record<number, (...args: unknown[]) => void> = {};
    let callbackId = 0;
    let eventListenerId = 0;

    const state = {
      models: activeScenario.models,
      settings: activeScenario.settings,
    };

    const getModelById = (modelId: string) =>
      state.models.find((model) => model.id === modelId);

    (window as Window & {
      __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener: () => void };
      __TAURI_INTERNALS__?: Record<string, unknown>;
      __TAURI_OS_PLUGIN_INTERNALS__?: Record<string, unknown>;
    }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    (window as Window & {
      __TAURI_OS_PLUGIN_INTERNALS__?: Record<string, unknown>;
    }).__TAURI_OS_PLUGIN_INTERNALS__ = {
      arch: activeScenario.platform === "macos" ? "aarch64" : "x86_64",
      eol: "\\n",
      exe_extension: activeScenario.platform === "windows" ? "exe" : "",
      family: activeScenario.platform === "windows" ? "windows" : "unix",
      os_type: activeScenario.platform,
      platform: activeScenario.platform,
      version: "15.0",
    };

    (window as Window & {
      __TAURI_INTERNALS__?: Record<string, unknown>;
    }).__TAURI_INTERNALS__ = {
      callbacks,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        switch (cmd) {
          case "plugin:event|listen":
            eventListenerId += 1;
            return eventListenerId;
          case "plugin:event|unlisten":
            return null;
          case "plugin:os|locale":
            return "en-US";
          case "plugin:macos-permissions|check_accessibility_permission":
            return activeScenario.permissions.accessibility;
          case "plugin:macos-permissions|check_microphone_permission":
            return activeScenario.permissions.microphone;
          case "plugin:macos-permissions|request_accessibility_permission":
          case "plugin:macos-permissions|request_microphone_permission":
          case "show_main_window_command":
          case "initialize_enigo":
          case "initialize_shortcuts":
            return null;
          case "get_windows_microphone_permission_status":
            return {
              app_access: "allowed",
              desktop_app_access: "allowed",
              device_access: "allowed",
              overall_access: activeScenario.permissions.microphone
                ? "allowed"
                : "denied",
              supported: true,
            };
          case "get_default_settings":
          case "get_app_settings":
            return state.settings;
          case "check_custom_sounds":
            return { start: false, stop: false };
          case "get_available_microphones":
          case "get_available_output_devices":
            return [];
          case "get_available_models":
            return state.models;
          case "get_current_model":
            return (state.settings.selected_model as string) || "";
          case "has_any_models_available":
            return activeScenario.hasAnyModels;
          case "set_active_model":
            state.settings.selected_model = args.modelId as string;
            return null;
          case "download_model": {
            const model = getModelById(args.modelId as string);
            if (model) {
              model.is_downloaded = true;
            }
            return null;
          }
          case "check_apple_intelligence_available":
            return activeScenario.appleAvailable;
          case "preview_post_process_text":
            return {
              active_app_context: null,
              applied_tone_id: null,
              dictionary_hits: [],
              edits: {
                added_bullets: false,
                added_paragraphs: false,
                removed_false_starts: true,
                removed_fillers: true,
              },
              final_text: "Cleaned up sample text.",
              mode: state.settings.post_process_mode,
              normalized_text: args.text,
              raw_text: args.text,
            };
          case "debug_analyze_post_process_route":
            return {
              route: "command",
              word_count: String(args.text || "").trim().split(/\s+/).length,
              has_correction_cue: false,
              has_list_cue: true,
              has_paragraph_cue: false,
              has_transform_cue: true,
              has_technical_tokens: false,
              looks_incomplete: false,
              score: 3,
            };
          case "get_history_entries":
            return activeScenario.historyEntries;
          case "toggle_history_entry_saved": {
            const entry = activeScenario.historyEntries.find(
              (item) => item.id === args.id,
            );
            if (entry) {
              entry.saved = !entry.saved;
            }
            return null;
          }
          case "delete_history_entry":
            activeScenario.historyEntries = activeScenario.historyEntries.filter(
              (item) => item.id !== args.id,
            );
            return null;
          case "get_audio_file_path":
            return `/tmp/${String(args.fileName || "audio.wav")}`;
          case "open_recordings_folder":
            return null;
          case "resolve_post_process_preview":
          case "fetch_post_process_models":
            return [];
          default:
            return null;
        }
      },
      metadata: {
        currentWebview: { label: "main" },
        currentWindow: { label: "main" },
      },
      transformCallback: (callback: (...args: unknown[]) => void) => {
        callbackId += 1;
        callbacks[callbackId] = callback;
        return callbackId;
      },
      unregisterCallback: (id: number) => {
        delete callbacks[id];
      },
    };
  }, scenario);

  await page.goto("/");
};

test.describe("Vox Jot app", () => {
  test("shows the lean onboarding steps and transitions into model setup", async ({
    page,
  }) => {
    await bootApp(page, {
      hasAnyModels: false,
      models: [availableModel],
    });

    await expect(
      page.getByRole("heading", {
        name: /Set up private voice dictation that actually fits your workflow/i,
      }),
    ).toBeVisible();
    await expect(page.locator(".ob-progress-step", { hasText: "Overview" })).toBeVisible();
    await expect(page.locator(".ob-progress-step", { hasText: "Permissions" })).toBeVisible();
    await expect(page.locator(".ob-progress-step", { hasText: "Model" })).toBeVisible();
    await expect(
      page.locator(".ob-progress-step", { hasText: "First Dictation" }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Set Up Vox Jot/i }).click();

    await expect(
      page.getByRole("heading", {
        name: /Choose the transcription model you want to start with/i,
      }),
    ).toBeVisible();
  });

  test("skips welcome for returning users who only need permissions", async ({
    page,
  }) => {
    await bootApp(page, {
      permissions: {
        accessibility: false,
        microphone: false,
      },
    });

    await expect(
      page.getByRole("heading", {
        name: /Give Vox Jot the permissions it needs to listen and type for you/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Set up private voice dictation that actually fits your workflow/i,
      }),
    ).toHaveCount(0);
  });

  test("keeps permissions onboarding within viewport without page overflow", async ({
    page,
  }) => {
    await bootApp(page, {
      permissions: {
        accessibility: false,
        microphone: false,
      },
    });

    const viewportOk = await page.evaluate(() => {
      const root = document.querySelector(".ob-root") as HTMLElement | null;
      if (!root) return false;

      const html = document.documentElement;
      const body = document.body;

      const rootBottomWithinViewport =
        root.getBoundingClientRect().bottom <= window.innerHeight + 1;
      const pageDoesNotOverflow =
        html.scrollHeight <= html.clientHeight + 1 &&
        body.scrollHeight <= body.clientHeight + 1;

      return rootBottomWithinViewport && pageDoesNotOverflow;
    });

    expect(viewportOk).toBeTruthy();
  });

  test("keeps Post Process visible in the sidebar even when it is off", async ({
    page,
  }) => {
    await bootApp(page, {
      settings: {
        post_process_enabled: false,
      },
    });

    await expect(page.getByText("Post Process")).toBeVisible();
    await page.getByText("Post Process").click();

    await expect(
      page.getByRole("heading", { name: /^Post Process$/i }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Post Process is off. You can still finish provider setup now/i,
      ),
    ).toBeVisible();
  });

  test("renders the Apple-specific post-process sections when Apple is selected", async ({
    page,
  }) => {
    await bootApp(page, {
      settings: {
        post_process_enabled: true,
        post_process_provider_id: "apple_intelligence",
      },
    });

    await page.getByText("Post Process").click();

    await expect(page.getByText("Apple Cleanup")).toBeVisible();
    await expect(page.getByText("Apple Personalization")).toBeVisible();
    await expect(page.getByText("Prompting")).toHaveCount(0);
  });

  test("renders prompting for non-Apple providers", async ({ page }) => {
    await bootApp(page, {
      settings: {
        post_process_enabled: true,
        post_process_provider_id: "openai",
      },
    });

    await page.getByText("Post Process").click();

    await expect(page.getByText("Prompting")).toBeVisible();
    await expect(page.getByText("Apple Cleanup")).toHaveCount(0);
  });

  test("shows recording and jot tabs with search filtering", async ({ page }) => {
    await bootApp(page, {
      historyEntries: [
        {
          id: 1,
          timestamp: "2026-03-16T11:00:00Z",
          transcription_text: "buy bread and apples",
          post_processed_text: null,
          post_process_prompt: null,
          file_name: "entry-1.wav",
          saved: false,
        },
        {
          id: 2,
          timestamp: "2026-03-16T11:05:00Z",
          transcription_text: "draft status update",
          post_processed_text: "Draft a clear status update for the team",
          post_process_prompt: "Improve structure",
          file_name: "entry-2.wav",
          saved: true,
        },
      ],
    });

    await page.getByText("History").click();

    await expect(page.getByTestId("history-tab-recordings")).toBeVisible();
    await expect(page.getByTestId("history-tab-jots")).toBeVisible();
    await expect(page.getByText("buy bread and apples")).toBeVisible();

    await page.getByRole("searchbox").fill("status");
    await expect(page.getByText("buy bread and apples")).toHaveCount(0);

    await page.getByTestId("history-tab-jots").click();
    await expect(
      page.getByText("Draft a clear status update for the team"),
    ).toBeVisible();
  });

  test("keeps debug section visible and route debugger interactive", async ({ page }) => {
    await bootApp(page);

    await expect(page.getByText("Debug")).toBeVisible();
    await page.getByText("Debug").click();

    await page
      .getByTestId("route-debugger-input")
      .fill("rewrite this as bullet points one ship two test");
    await page.getByTestId("route-debugger-analyze").click();
    await expect(page.getByTestId("route-debugger-result")).toContainText(
      /Route:/,
    );
    await expect(page.getByTestId("route-debugger-metrics")).toBeVisible();
  });

  test("shows the Apple unavailable state when the selected provider cannot run", async ({
    page,
  }) => {
    await bootApp(page, {
      appleAvailable: false,
      settings: {
        post_process_enabled: true,
        post_process_provider_id: "apple_intelligence",
      },
    });

    await page.getByText("Post Process").click();

    await expect(
      page.getByText(
        /Apple Intelligence is selected, but it is not available on this device right now/i,
      ).first(),
    ).toBeVisible();
  });
});
