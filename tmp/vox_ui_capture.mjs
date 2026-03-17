import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1518, height: 1212 } });

await page.addInitScript(() => {
  const callbacks = {};
  let callbackId = 0;
  let eventListenerId = 0;

  const settings = {
    app_language: "en",
    post_process_enabled: true,
    post_process_provider_id: "apple_intelligence",
    post_process_providers: [
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
    ],
    post_process_api_keys: { apple_intelligence: "", openai: "" },
    post_process_models: { apple_intelligence: "", openai: "gpt-4.1-mini" },
    post_process_prompts: [{ id: "default", name: "Default", prompt: "x" }],
    post_process_selected_prompt_id: "default",
    debug_mode: true,
    selected_model: "parakeet-tdt-0.6b-v3",
    update_checks_enabled: true,
    push_to_talk: false,
    bindings: {
      transcribe: {
        id: "transcribe",
        default_binding: "Option+Space",
        current_binding: "Option+Space",
        name: "Transcribe",
        description: "",
      },
      transcribe_with_post_process: {
        id: "transcribe_with_post_process",
        default_binding: "Option+Shift+Space",
        current_binding: "Option+Shift+Space",
        name: "Post Process",
        description: "",
      },
      cancel: {
        id: "cancel",
        default_binding: "Escape",
        current_binding: "Escape",
        name: "Cancel",
        description: "",
      },
    },
  };

  const models = [
    {
      id: "parakeet-tdt-0.6b-v3",
      name: "Parakeet V3",
      filename: "parakeet.bin",
      engine_type: "Parakeet",
      description: "Fast and accurate",
      size_mb: 540,
      accuracy_score: 0.85,
      speed_score: 0.92,
      supported_languages: ["en"],
      supports_translation: false,
      is_downloaded: true,
      is_downloading: false,
      is_recommended: true,
      is_custom: false,
      is_directory: false,
      partial_size: 0,
      url: null,
    },
  ];

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_OS_PLUGIN_INTERNALS__ = {
    arch: "aarch64",
    eol: "\n",
    exe_extension: "",
    family: "unix",
    os_type: "macos",
    platform: "macos",
    version: "15.0",
  };

  window.__TAURI_INTERNALS__ = {
    callbacks,
    convertFileSrc: (filePath) => filePath,
    transformCallback: (cb) => {
      callbackId += 1;
      callbacks[callbackId] = cb;
      return callbackId;
    },
    unregisterCallback: (id) => {
      delete callbacks[id];
    },
    metadata: {
      currentWebview: { label: "main" },
      currentWindow: { label: "main" },
    },
    invoke: async (cmd, args = {}) => {
      switch (cmd) {
        case "plugin:event|listen":
          eventListenerId += 1;
          return eventListenerId;
        case "plugin:event|unlisten":
          return null;
        case "plugin:os|locale":
          return "en-US";
        case "plugin:macos-permissions|check_accessibility_permission":
        case "plugin:macos-permissions|check_microphone_permission":
          return true;
        case "plugin:macos-permissions|request_accessibility_permission":
        case "plugin:macos-permissions|request_microphone_permission":
        case "show_main_window_command":
        case "initialize_enigo":
        case "initialize_shortcuts":
          return null;
        case "get_windows_microphone_permission_status":
          return { supported: false };
        case "get_default_settings":
        case "get_app_settings":
          return settings;
        case "check_custom_sounds":
          return { start: false, stop: false };
        case "get_available_microphones":
        case "get_available_output_devices":
          return [];
        case "get_available_models":
          return models;
        case "get_current_model":
          return settings.selected_model;
        case "has_any_models_available":
          return true;
        case "set_active_model":
          settings.selected_model = args.modelId;
          return null;
        case "check_apple_intelligence_available":
          return true;
        case "preview_post_process_text":
          return {
            active_app_context: null,
            applied_tone_id: null,
            dictionary_hits: [],
            edits: {
              added_bullets: false,
              added_paragraphs: false,
              removed_false_starts: false,
              removed_fillers: false,
            },
            final_text: "Sample text",
            mode: "intent",
            normalized_text: args.text,
            raw_text: args.text,
          };
        case "fetch_post_process_models":
          return [];
        case "get_history_entries":
          return [];
        default:
          return null;
      }
    },
  };
});

await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({
  path: "/tmp/vox-ui-after.png",
  fullPage: true,
});
await browser.close();
console.log("/tmp/vox-ui-after.png");
