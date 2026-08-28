import { expect, test, type Page } from "@playwright/test";

const pageErrors = new WeakMap<Page, string[]>();
const consoleErrors = new WeakMap<Page, string[]>();
const consoleWarnings = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  pageErrors.set(page, []);
  consoleErrors.set(page, []);
  consoleWarnings.set(page, []);
  page.on("pageerror", (error) => pageErrors.get(page)?.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.get(page)?.push(message.text());
    } else if (message.type() === "warning") {
      consoleWarnings.get(page)?.push(message.text());
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? [], "uncaught browser errors").toEqual([]);
  expect(consoleErrors.get(page) ?? [], "browser console errors").toEqual([]);
  expect(consoleWarnings.get(page) ?? [], "browser console warnings").toEqual(
    [],
  );
});

type Scenario = {
  appleAvailable: boolean;
  hasAnyModels: boolean;
  historyEntries: Array<Record<string, unknown>>;
  permissions: {
    accessibility: boolean;
    inputMonitoring: boolean;
    microphone: boolean;
    screenRecording: boolean;
  };
  postOnboardingPermissions?: {
    accessibility?: boolean;
    inputMonitoring?: boolean;
    microphone?: boolean;
    screenRecording?: boolean;
  };
  platform: "macos" | "windows" | "linux";
  settings: Record<string, unknown>;
  models: Array<Record<string, unknown>>;
  corrections?: Array<Record<string, unknown>>;
  watchFolders?: Array<Record<string, unknown>>;
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

const largeAvailableModel = {
  ...availableModel,
  id: "large-v3",
  name: "Large V3",
  filename: "large-v3.bin",
  size_mb: 1536,
  is_recommended: false,
};

const moonshineAvailableModel = {
  ...availableModel,
  id: "moonshine-base",
  name: "Moonshine Base",
  filename: "moonshine-base.bin",
  size_mb: 280,
  is_recommended: false,
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
  experimental_enabled: true,
  external_script_path: null,
  fallback_to_raw_on_failure: true,
  history_limit: 100,
  keyboard_implementation: "tauri",
  log_level: "info",
  max_rewrite_strength: 1,
  model_unload_timeout: "never",
  mute_while_recording: false,
  onboarding_completed: true,
  overlay_position: "bottom",
  recording_overlay_style: "compact",
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
  file_transcription_apply_dictionary: true,
};

const baseScenario: Scenario = {
  appleAvailable: true,
  hasAnyModels: true,
  historyEntries: [],
  models: [downloadedModel],
  permissions: {
    accessibility: true,
    inputMonitoring: true,
    microphone: true,
    screenRecording: true,
  },
  platform: "macos",
  settings: baseSettings,
  watchFolders: [],
};

const dictionaryCorrection = {
  id: 1,
  original: "FoxJot",
  corrected: "Vox Jot",
  frequency: 2,
  confidence: 1,
  exact_only: false,
  source_app: null,
  source_kind: "manual",
  first_seen: 1_700_000_000,
  last_seen: 1_700_000_100,
  is_active: true,
  user_approved: true,
  auto_apply: "always",
};

const makeHistoryEntry = (
  overrides: Partial<Record<string, unknown>>,
): Record<string, unknown> => ({
  id: 1,
  file_name: "entry.wav",
  timestamp: 1_774_000_000,
  saved: false,
  title: "Dictation",
  transcription_text: "",
  post_processed_text: null,
  post_process_prompt: null,
  dictionary_hits: [],
  pasted_text: null,
  field_snapshot_text: null,
  field_snapshot_at: null,
  field_snapshot_status: "not_requested",
  field_snapshot_error: null,
  source_language_detected: null,
  translation_target_language: null,
  translated_text: null,
  translation_route: null,
  translation_provider_id: null,
  translation_model_id: null,
  translation_origin: null,
  translation_destination: null,
  tts_requested: null,
  tts_engine: null,
  tts_voice_id: null,
  tts_locale: null,
  tts_trigger: null,
  tts_status: null,
  screen_context_metadata: null,
  duration_ms: null,
  ...overrides,
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

const bootApp = async (page: Page, overrides: Partial<Scenario> = {}) => {
  const scenario = mergeDeep(
    clone(baseScenario),
    overrides as Record<string, unknown>,
  );

  await page.addInitScript((activeScenario: Scenario) => {
    window.localStorage.removeItem("vox-jot-sidebar-collapsed");

    const callbacks: Record<number, (...args: unknown[]) => void> = {};
    let callbackId = 0;
    let eventListenerId = 0;
    let accessibilityChecks = 0;
    let inputMonitoringChecks = 0;
    let microphoneChecks = 0;
    let screenRecordingChecks = 0;

    const state = {
      models: activeScenario.models,
      settings: activeScenario.settings,
      watchFolders: activeScenario.watchFolders ?? [],
    };

    const getModelById = (modelId: string) =>
      state.models.find((model) => model.id === modelId);

    (
      window as Window & {
        __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener: () => void };
        __TAURI_INTERNALS__?: Record<string, unknown>;
        __TAURI_OS_PLUGIN_INTERNALS__?: Record<string, unknown>;
        __voxJotCommandCalls?: Array<{
          args: Record<string, unknown>;
          cmd: string;
        }>;
      }
    ).__voxJotCommandCalls = [];

    (
      window as Window & {
        __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener: () => void };
      }
    ).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    (
      window as Window & {
        __TAURI_OS_PLUGIN_INTERNALS__?: Record<string, unknown>;
      }
    ).__TAURI_OS_PLUGIN_INTERNALS__ = {
      arch: activeScenario.platform === "macos" ? "aarch64" : "x86_64",
      eol: "\\n",
      exe_extension: activeScenario.platform === "windows" ? "exe" : "",
      family: activeScenario.platform === "windows" ? "windows" : "unix",
      os_type: activeScenario.platform,
      platform: activeScenario.platform,
      version: "15.0",
    };

    (
      window as Window & {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      }
    ).__TAURI_INTERNALS__ = {
      callbacks,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        (
          window as Window & {
            __voxJotCommandCalls?: Array<{
              args: Record<string, unknown>;
              cmd: string;
            }>;
          }
        ).__voxJotCommandCalls?.push({ cmd, args });

        switch (cmd) {
          case "plugin:event|listen":
            eventListenerId += 1;
            return eventListenerId;
          case "plugin:event|unlisten":
            return null;
          case "plugin:app|version":
            return "1.0.0";
          case "plugin:updater|check":
            return null;
          case "plugin:os|locale":
            return "en-US";
          case "plugin:macos-permissions|check_accessibility_permission": {
            accessibilityChecks += 1;
            return accessibilityChecks > 2 &&
              activeScenario.postOnboardingPermissions?.accessibility !==
                undefined
              ? activeScenario.postOnboardingPermissions.accessibility
              : activeScenario.permissions.accessibility;
          }
          case "plugin:macos-permissions|check_input_monitoring_permission": {
            inputMonitoringChecks += 1;
            return inputMonitoringChecks > 2 &&
              activeScenario.postOnboardingPermissions?.inputMonitoring !==
                undefined
              ? activeScenario.postOnboardingPermissions.inputMonitoring
              : activeScenario.permissions.inputMonitoring;
          }
          case "plugin:macos-permissions|check_microphone_permission": {
            microphoneChecks += 1;
            return microphoneChecks > 2 &&
              activeScenario.postOnboardingPermissions?.microphone !== undefined
              ? activeScenario.postOnboardingPermissions.microphone
              : activeScenario.permissions.microphone;
          }
          case "plugin:macos-permissions|check_screen_recording_permission": {
            screenRecordingChecks += 1;
            return screenRecordingChecks > 2 &&
              activeScenario.postOnboardingPermissions?.screenRecording !==
                undefined
              ? activeScenario.postOnboardingPermissions.screenRecording
              : activeScenario.permissions.screenRecording;
          }
          case "plugin:macos-permissions|request_accessibility_permission":
          case "plugin:macos-permissions|request_input_monitoring_permission":
          case "plugin:macos-permissions|request_microphone_permission":
          case "plugin:macos-permissions|request_screen_recording_permission":
          case "show_main_window_command":
          case "show_detail_view":
          case "initialize_enigo":
          case "initialize_shortcuts":
          case "start_microphone_level_preview":
          case "stop_microphone_level_preview":
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
          case "get_runtime_memory_status":
            return {
              app_rss_mb: 128,
              sidecar_rss_mb: null,
              sidecar_running: false,
            };
          case "get_available_microphones":
            return [];
          case "get_available_output_devices":
            return [];
          case "is_laptop":
            return false;
          case "get_transcription_model_status":
            return (state.settings.selected_model as string) || null;
          case "get_model_platform_overview":
            return {
              stt: { providers: [], models: [] },
              llm: { providers: [], models: [] },
              tts: { providers: [], models: [] },
              selection: {},
            };
          case "get_model_platform_overview_json":
            return JSON.stringify({
              stt: { providers: [], models: [] },
              llm: { providers: [], models: [] },
              tts: { providers: [], models: [] },
              selection: {},
            });
          case "get_refine_model_catalog":
            return { providers: [], models: [] };
          case "get_active_refine_installs":
            return [];
          case "get_ocr_model_catalog":
            return { install_root: "/tmp/vox-jot-test-ocr", models: [] };
          case "get_creative_audio_model_catalog":
            return { install_root: "/tmp/vox-jot-test-audio", models: [] };
          case "get_screen_context_diagnostics":
            return {
              status: "disabled",
              has_screen_permission: true,
              cache_size: 0,
              latest_capture_at_ms: null,
              latest_context_age_ms: null,
              latest_display_id: null,
              latest_source: null,
              latest_preview_text: null,
              last_error: null,
            };
          case "get_frontmost_app_for_exclusion":
            return {
              bundle_id: "com.tinyspeck.slackmacgap",
              localized_name: "Slack",
            };
          case "get_frontmost_url_for_write_rules":
          case "test_resolve_write_rule":
            return null;
          case "get_app_dir_path":
            return "/tmp/vox-jot-app";
          case "get_log_dir_path":
            return "/tmp/vox-jot-logs";
          case "get_http_api_status":
            return {
              enabled: false,
              port: 8978,
              token: "",
              token_available: true,
            };
          case "list_story_audio":
          case "list_story_render_jobs":
            return [];
          case "denoise_runtime_status":
            return { installed: false };
          case "get_available_tts_voices":
          case "refresh_tts_voices":
          case "get_available_tts_packs":
          case "list_tts_voice_presets":
          case "list_tts_voice_profiles":
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
              word_count: String(args.text || "")
                .trim()
                .split(/\s+/).length,
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
          case "get_latest_history_entry":
            return activeScenario.historyEntries.at(0) ?? null;
          case "get_dictation_stats":
            return {
              total_words: 0,
              today_words: 0,
              streak_days: 0,
              unique_app_count: 0,
              total_sessions: activeScenario.historyEntries.length,
              top_app_name: null,
              top_app_bundle_id: null,
            };
          case "list_watch_folders":
            return state.watchFolders;
          case "add_watch_folder": {
            const folder = {
              id: `watch-${state.watchFolders.length + 1}`,
              path: args.path,
              output_format: args.outputFormat,
              delete_after: args.deleteAfter,
              enabled: true,
            };
            state.watchFolders.push(folder);
            return folder;
          }
          case "remove_watch_folder":
            state.watchFolders = state.watchFolders.filter(
              (folder) => folder.id !== args.id,
            );
            return null;
          case "update_watch_folder_format":
            state.watchFolders = state.watchFolders.map((folder) =>
              folder.id === args.id
                ? { ...folder, output_format: args.outputFormat }
                : folder,
            );
            return null;
          case "list_reader_documents":
            return [];
          case "remove_reader_document":
            return null;
          case "get_file_icon":
            return null;
          case "get_speech_analysis_catalog":
            return {
              models: [
                {
                  id: "fireredasr2-aed-mlx",
                  label: "FireRedASR2 AED (MLX)",
                  provider: "FireRed",
                  repo_id: null,
                  source_kind: "runtime_managed",
                  source_url: null,
                  license_label: null,
                  gated: false,
                  downloadable: false,
                  installed: true,
                  local_path: null,
                  size_hint_label: null,
                  task: "asr",
                  engine: "mlx",
                  runtime: "mlx_native",
                  description: "Local file transcription model.",
                  readiness: "ready",
                  supported_languages: ["en"],
                  output_contract: ["text"],
                  capabilities: {
                    file_transcription: true,
                    live_dictation: false,
                    speaker_labels: false,
                    timestamps: false,
                    word_timestamps: false,
                    requires_hf_token: false,
                    requires_trust_remote_code: false,
                    requires_cloud_gpu_validation: false,
                    supports_onnx: false,
                    supports_coreml: false,
                    supports_mlx: true,
                  },
                },
              ],
              selection: {
                asr_model_id: "fireredasr2-aed-mlx",
                diarization_model_id: "",
              },
            };
          case "get_corrections":
            return activeScenario.corrections ?? [];
          case "list_write_rules":
            return state.settings.write_rules ?? [];
          case "list_installed_apps":
            return [
              { name: "Slack", bundle_id: "com.tinyspeck.slackmacgap" },
              { name: "Mail", bundle_id: "com.apple.mail" },
            ];
          case "get_history_entries_page": {
            const offset = Number(args.offset ?? 0);
            const limit = Number(args.limit ?? 50);
            const entries = activeScenario.historyEntries.slice(
              offset,
              offset + limit,
            );
            return {
              entries,
              has_more: offset + limit < activeScenario.historyEntries.length,
              total: activeScenario.historyEntries.length,
            };
          }
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
            activeScenario.historyEntries =
              activeScenario.historyEntries.filter(
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
            throw new Error(`Unhandled Tauri command mock: ${cmd}`);
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
  test("renders every left sidebar section and the model hub launcher", async ({
    page,
  }) => {
    await bootApp(page, {
      settings: {
        debug_mode: true,
        experimental_enabled: true,
      },
    });

    const main = page.locator("main");
    const sidebar = page.getByRole("navigation", {
      name: "Section navigation",
    });
    const modelHubCommandCount = () =>
      page.evaluate(
        () =>
          (
            (
              window as Window & {
                __voxJotCommandCalls?: Array<{
                  args: Record<string, unknown>;
                  cmd: string;
                }>;
              }
            ).__voxJotCommandCalls ?? []
          ).filter(
            (call) =>
              call.cmd === "show_detail_view" &&
              call.args.section === "model-hub",
          ).length,
      );
    const sectionGroups = [
      {
        root: "Dictate",
        rootRole: "tab" as const,
        sections: [
          { label: "Home", evidence: "Words" },
          { label: "Dictionary", evidence: "No dictionary entries yet." },
          {
            label: "File Transcription",
            evidence: "Drop audio or video to transcribe",
          },
          { label: "Reader", evidence: "No documents yet." },
          {
            label: "Enhance Audio",
            evidence: "Drop audio or video to remove background noise",
          },
        ],
      },
      {
        root: "Refine",
        rootRole: "tab" as const,
        sections: [
          { label: "Dictation Modes", evidence: "New mode" },
          { label: "Phrase Keys", evidence: "No phrase keys yet." },
          { label: "Translation", evidence: "Target Language" },
        ],
      },
      {
        root: "Listen",
        rootRole: "tab" as const,
        sections: [
          { label: "Studio", evidence: "Save a voice before building a story" },
          { label: "Voice Design", evidence: "Open Voice Models" },
          { label: "Voice Cloning", evidence: "Choose a clone-capable model" },
          { label: "Voice Changer", evidence: "Choose WAV" },
          { label: "Generated Audio", evidence: "Generated Audio" },
        ],
      },
      {
        root: "Settings",
        rootRole: "button" as const,
        sections: [
          { label: "App & Dictation", evidence: "Settings Coach" },
          { label: "Shortcuts", evidence: "Quick keys" },
          { label: "Recording & Devices", evidence: "Microphone input" },
          { label: "Output & Paste", evidence: "Dictation readiness" },
          { label: "Corrections", evidence: "Apply dictionary" },
          { label: "Models & AI", evidence: "Provider routing" },
          { label: "Testing", evidence: "Live STT" },
          { label: "Screen Context", evidence: "Capture mode" },
          { label: "Privacy & Storage", evidence: "Assistive access" },
          { label: "Legal & Model Terms", evidence: "Use terms checklist" },
          { label: "Automation & Agents", evidence: "Local API" },
          { label: "Diagnostics", evidence: "Feature health" },
          { label: "About Vox Jot", evidence: "Vox Jot vs. cloud dictation" },
        ],
      },
    ];

    for (const group of sectionGroups) {
      await page
        .getByRole(group.rootRole, { name: group.root, exact: true })
        .click();

      for (const section of group.sections) {
        const navButton = sidebar.getByRole("button", {
          name: section.label,
          exact: true,
        });
        await expect(navButton).toBeVisible();
        await navButton.click();
        await expect(navButton).toHaveAttribute("aria-current", "page");
        await expect(main).not.toContainText("could not load");
        await expect(main).toContainText(section.evidence);

        if (section.label === "Voice Design") {
          const beforeVoiceModelsClick = await modelHubCommandCount();
          await main
            .getByRole("button", { name: "Open Voice Models", exact: true })
            .click();
          await expect
            .poll(modelHubCommandCount)
            .toBeGreaterThan(beforeVoiceModelsClick);
          await expect
            .poll(() =>
              page.evaluate(() =>
                window.localStorage.getItem("vox-jot-model-hub-tab"),
              ),
            )
            .toBe("tts");
        }
      }
    }

    await page.getByRole("tab", { name: "Dictate", exact: true }).click();
    const beforeFooterModelHubClick = await modelHubCommandCount();
    await page.getByRole("button", { name: "Model Hub", exact: true }).click();

    await expect
      .poll(modelHubCommandCount)
      .toBeGreaterThan(beforeFooterModelHubClick);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("vox-jot-model-hub-tab"),
        ),
      )
      .toBe(null);
  });

  test("shows the lean onboarding steps and transitions into model setup", async ({
    page,
  }) => {
    await bootApp(page, {
      hasAnyModels: false,
      models: [availableModel],
      settings: {
        onboarding_completed: false,
      },
    });

    await expect(
      page.getByRole("heading", {
        name: /Talk once\. Text appears where your cursor is\./i,
      }),
    ).toBeVisible();
    await expect(
      page.locator(".ob-progress-step", { hasText: "Overview" }),
    ).toBeVisible();
    await expect(
      page.locator(".ob-progress-step", { hasText: "Permissions" }),
    ).toBeVisible();
    await expect(
      page.locator(".ob-progress-step", { hasText: "Model" }),
    ).toBeVisible();
    await expect(
      page.locator(".ob-progress-step", { hasText: "Refine" }),
    ).toBeVisible();
    await expect(
      page.locator(".ob-progress-step", { hasText: "First Dictation" }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Set up dictation/i }).click();
    await page.getByRole("button", { name: /^Continue$/i }).click();
    await page.getByRole("button", { name: /Continue setup/i }).click();

    await expect(
      page.getByRole("heading", {
        name: /Pick the model that turns speech into text/i,
      }),
    ).toBeVisible();
  });

  test("reveals advanced model options on demand during onboarding", async ({
    page,
  }) => {
    await bootApp(page, {
      hasAnyModels: false,
      models: [availableModel, largeAvailableModel, moonshineAvailableModel],
      settings: {
        onboarding_completed: false,
      },
    });

    await page.getByRole("button", { name: /Set up dictation/i }).click();
    await page.getByRole("button", { name: /^Continue$/i }).click();
    await page.getByRole("button", { name: /Continue setup/i }).click();

    await expect(page.getByText("Parakeet V3")).toBeVisible();
    await expect(page.getByText("Large V3")).toHaveCount(0);
    await expect(page.getByText("Moonshine Base")).toHaveCount(0);

    await page
      .getByRole("button", { name: /Show more model options/i })
      .click();

    await expect(page.getByText("Large V3")).toBeVisible();
    await expect(page.getByText("Moonshine Base")).toBeVisible();
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
        name: /Microphone Access/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Talk once\. Text appears where your cursor is\./i,
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

    await expect(
      page.getByRole("heading", {
        name: /Microphone Access/i,
      }),
    ).toBeVisible();

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

  test("shows macOS permission attention in the title bar instead of the view body", async ({
    page,
  }) => {
    await bootApp(page, {
      postOnboardingPermissions: {
        accessibility: false,
        inputMonitoring: false,
      },
    });

    const titleBarNotice = page.getByRole("button", {
      name: /macOS permissions need attention/i,
    });
    const permissionDialog = page.getByRole("dialog", {
      name: /macOS permissions need attention/i,
    });

    await expect(titleBarNotice).toBeVisible();
    await expect(
      page.getByText(
        /Grant the permissions below to enable dictation, shortcuts, and Screen Context/i,
      ),
    ).toHaveCount(0);

    await titleBarNotice.click();

    await expect(
      permissionDialog.getByText(
        /Grant the permissions below to enable dictation, shortcuts, and Screen Context/i,
      ),
    ).toBeVisible();
    await expect(
      permissionDialog.getByText(/Accessibility Access/i),
    ).toBeVisible();
    await expect(permissionDialog.getByText(/Input Monitoring/i)).toBeVisible();
  });

  test("keeps Post Process visible in the sidebar even when it is off", async ({
    page,
  }) => {
    await bootApp(page, {
      settings: {
        post_process_enabled: false,
      },
    });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Models & AI" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Models & AI" }).click();

    await expect(
      page.getByRole("heading", { name: /^Models & AI$/i }).first(),
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

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Models & AI" }).click();

    await expect(page.getByText("Apple Cleanup")).toBeVisible();
    await expect(page.getByText("Apple Personalization")).toHaveCount(0);
    await expect(page.getByText("Prompting")).toHaveCount(0);
  });

  test("shows styles as a dedicated section with starter presets and app mappings", async ({
    page,
  }) => {
    await bootApp(page, {
      settings: {
        app_aware_tone_enabled: true,
        post_process_enabled: true,
        post_process_provider_id: "openai",
        write_rules: [
          {
            id: "slack-casual",
            name: "Slack casual",
            enabled: true,
            priority: 10,
            matchers: {
              bundle_ids: ["com.tinyspeck.slackmacgap"],
              url_patterns: [],
            },
            overrides: {
              tone_id: "casual",
            },
          },
          {
            id: "mail-professional",
            name: "Mail professional",
            enabled: true,
            priority: 20,
            matchers: {
              bundle_ids: ["com.apple.mail"],
              url_patterns: [],
            },
            overrides: {
              tone_id: "professional",
            },
          },
        ],
        tone_definitions: [
          {
            id: "neutral",
            instruction:
              "Keep the tone neutral and close to the speaker's original wording.",
            label: "Neutral",
          },
          {
            id: "casual",
            instruction:
              "Use a casual, conversational tone suitable for quick chat messages while preserving meaning.",
            label: "Casual",
          },
          {
            id: "professional",
            instruction:
              "Use a polished, professional tone suitable for email or documents while preserving meaning.",
            label: "Professional",
          },
        ],
      },
    });

    await page.getByRole("tab", { name: "Refine" }).click();
    await expect(page.getByText("Dictation Modes").first()).toBeVisible();
    await page.getByText("Dictation Modes").first().click();

    await expect(page.getByRole("button", { name: "New mode" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Slack casual" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mail professional" }),
    ).toBeVisible();
    await expect(
      page.getByText("Casual, conversational wording for quick chat messages."),
    ).toBeVisible();
    await expect(
      page.getByText("Polished professional wording for email and documents."),
    ).toBeVisible();
  });

  test("renders prompting for non-Apple providers", async ({ page }) => {
    await bootApp(page, {
      settings: {
        post_process_enabled: true,
        post_process_provider_id: "openai",
      },
    });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Models & AI" }).click();

    await expect(page.getByText("Prompting")).toBeVisible();
    await expect(page.getByText("Apple Cleanup")).toHaveCount(0);
  });

  test("renders the testing comparison matrix", async ({ page }) => {
    await bootApp(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Testing", exact: true }).click();

    await expect(page.getByRole("tab", { name: "Live STT" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("multi-domain real speech clips")).toHaveCount(
      0,
    );
    await page.getByRole("tab", { name: "Live STT" }).hover();
    await expect(
      page.getByText("multi-domain real speech clips"),
    ).toBeVisible();

    await expect(page.getByText("Match: higher is better.")).toHaveCount(0);
    await page.getByRole("button", { name: /Match/i }).first().hover();
    await expect(page.getByText("Match: higher is better.")).toBeVisible();

    await page.getByRole("tab", { name: "Screen OCR" }).click();
    await expect
      .poll(async () =>
        page
          .locator("[data-testing-table-viewport]")
          .first()
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      )
      .toBeTruthy();

    await expect(page.getByRole("tab", { name: "File ASR" })).toBeVisible();
    await page.getByRole("tab", { name: "File ASR" }).click();

    await expect(page.getByRole("button", { name: "Cards" })).toHaveCount(0);
    await expect(page.locator("table")).toHaveCount(2);
    await expect(
      page.locator("[data-testing-model-icon]").first(),
    ).toBeVisible();
    await expect
      .poll(async () =>
        page
          .locator("[data-testing-table-viewport]")
          .first()
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      )
      .toBeTruthy();
    await expect(
      page.getByRole("button", { name: /WER/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("1.89× (RTF 0.53)", { exact: true }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /FireRedASR2 AED \(MLX\)/i })
      .click();
    await expect(
      page.getByText(/Best full five-format local File ASR suite result/i),
    ).toBeVisible();
  });

  test("frames the watched-folder empty state like Reader", async ({
    page,
  }) => {
    await bootApp(page, {
      watchFolders: [],
    });

    await page
      .getByRole("button", { name: "File Transcription", exact: true })
      .click();
    await page.getByRole("button", { name: "Folders", exact: true }).click();

    const panel = page.getByTestId("watch-folders-panel");
    const emptySurface = page.getByTestId("watch-folders-empty-surface");

    await expect(panel).toBeVisible();
    await expect(emptySurface).toBeVisible();
    await expect(panel.getByText("Ready")).toBeVisible();
    await expect(
      panel.getByText("No watched folders", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByText("FireRedASR2 AED (MLX)")).toBeVisible();
    await expect(panel.getByText("No watched folders yet.")).toBeVisible();
    await expect(
      panel.getByText(
        "For example, watch an Interviews folder and save each new recording as text, SRT, or VTT.",
      ),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Add folder" }),
    ).toBeVisible();

    await expect(emptySurface).toHaveCSS("border-style", "dashed");
  });

  test("uses inline confirmation before removing a Reader document", async ({
    page,
  }) => {
    await bootApp(page);
    await page.evaluate(() => {
      window.localStorage.setItem(
        "voxjot:reader-document-library:v2",
        JSON.stringify([
          {
            id: "reader-test-document",
            path: "/Users/test/Documents/research.pdf",
            name: "research.pdf",
            kind: "pdf",
            sizeBytes: 128000,
            sourceModifiedMs: Date.now(),
            wordCount: 480,
            pageCount: 2,
            sectionCount: 3,
            extractionEngine: "test-python",
            openedAt: Date.now(),
          },
        ]),
      );
    });

    await page.getByRole("button", { name: "Reader", exact: true }).click();

    await expect(
      page.getByRole("button", { name: /research\.pdf/ }),
    ).toBeVisible();
    const removeButton = page.getByRole("button", {
      name: "Remove document",
      exact: true,
    });
    await removeButton.click();

    await expect(
      page.getByRole("button", { name: /research\.pdf/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Confirm remove document",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel remove document", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /research\.pdf/ }),
    ).toBeVisible();

    await removeButton.click();
    await page
      .getByRole("button", { name: "Confirm remove document", exact: true })
      .click();
    await expect(page.getByText("No documents yet.")).toBeVisible();
  });

  test("uses inline confirmation before removing a watched folder from the trash icon", async ({
    page,
  }) => {
    await bootApp(page, {
      watchFolders: [
        {
          id: "watch-interviews",
          path: "/Users/test/Interviews",
          output_format: "text",
          delete_after: false,
          enabled: true,
        },
      ],
    });

    await page
      .getByRole("button", { name: "File Transcription", exact: true })
      .click();
    await page.getByRole("button", { name: "Folders", exact: true }).click();

    const folderRow = page.locator("li", { hasText: "Interviews" });
    await expect(folderRow).toBeVisible();
    await folderRow.hover();

    const removeButton = folderRow.getByRole("button", {
      name: "Remove folder",
      exact: true,
    });
    await expect(removeButton).toBeVisible();

    await removeButton.click();
    await expect(folderRow).toBeVisible();
    await expect(
      folderRow.getByRole("button", {
        name: "Confirm remove folder",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      folderRow.getByRole("button", {
        name: "Cancel remove folder",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              (
                window as Window & {
                  __voxJotCommandCalls?: Array<{ cmd: string }>;
                }
              ).__voxJotCommandCalls ?? []
            ).filter((call) => call.cmd === "remove_watch_folder").length,
        ),
      )
      .toBe(0);

    await folderRow
      .getByRole("button", {
        name: "Cancel remove folder",
        exact: true,
      })
      .click();
    await expect(
      folderRow.getByRole("button", {
        name: "Confirm remove folder",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(folderRow).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              (
                window as Window & {
                  __voxJotCommandCalls?: Array<{ cmd: string }>;
                }
              ).__voxJotCommandCalls ?? []
            ).filter((call) => call.cmd === "remove_watch_folder").length,
        ),
      )
      .toBe(0);

    await folderRow.hover();
    await folderRow
      .getByRole("button", {
        name: "Remove folder",
        exact: true,
      })
      .click();
    await folderRow
      .getByRole("button", {
        name: "Confirm remove folder",
        exact: true,
      })
      .click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              (
                window as Window & {
                  __voxJotCommandCalls?: Array<{ cmd: string }>;
                }
              ).__voxJotCommandCalls ?? []
            ).filter((call) => call.cmd === "remove_watch_folder").length,
        ),
      )
      .toBe(1);
    await expect(folderRow).toHaveCount(0);
  });

  test("keeps the learned corrections manager out of settings", async ({
    page,
  }) => {
    await bootApp(page, {
      corrections: [dictionaryCorrection],
    });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Corrections" }).click();

    await expect(
      page.getByRole("heading", { name: /^Learned Corrections$/i }),
    ).toHaveCount(0);
    await expect(page.getByPlaceholder("Search dictionary")).toHaveCount(0);
    await expect(
      page.getByText("Apply dictionary & learned corrections"),
    ).toBeVisible();

    await page.getByRole("button", { name: /Open dictionary/i }).click();

    await page
      .getByRole("button", { name: "Search dictionary", exact: true })
      .click();
    await expect(page.getByPlaceholder("Search dictionary")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Corrected" })).toHaveValue(
      "Vox Jot",
    );
  });

  test("shows unified history preferring post-processed text", async ({
    page,
  }) => {
    await bootApp(page, {
      historyEntries: [
        makeHistoryEntry({
          id: 1,
          timestamp: 1_774_000_000,
          title: "Groceries",
          transcription_text: "buy bread and apples",
          file_name: "entry-1.wav",
        }),
        makeHistoryEntry({
          id: 2,
          timestamp: 1_774_000_300,
          title: "Team update",
          transcription_text: "draft status update",
          post_processed_text: "Draft a clear status update for the team",
          post_process_prompt: "Improve structure",
          file_name: "entry-2.wav",
          saved: true,
        }),
      ],
    });

    await expect(page.getByTestId("history-entries")).toBeVisible();
    await expect(page.getByText("buy bread and apples")).toBeVisible();
    await expect(
      page.getByText("Draft a clear status update for the team"),
    ).toBeVisible();
  });

  test("keeps debug section visible and route debugger interactive", async ({
    page,
  }) => {
    await bootApp(page, {
      settings: {
        debug_mode: true,
      },
    });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Diagnostics" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Diagnostics" }).click();

    await page
      .getByPlaceholder(
        "Paste some dictated text to inspect the cleanup route.",
      )
      .fill("rewrite this as bullet points one ship two test");
    await page.getByRole("button", { name: "Analyze Route" }).click();
    await expect(page.getByText(/"route": "command"/)).toBeVisible();
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

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Models & AI" }).click();

    await expect(
      page.getByText(/Apple Intelligence is blocked on this device/i).first(),
    ).toBeVisible();
  });
});
