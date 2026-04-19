import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast, Toaster } from "sonner";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import {
  AppWindow,
  Cpu,
  FileText,
  FlaskConical,
  Headphones,
  History,
  Info,
  Keyboard,
  Languages,
  MessageCircle,
  NotebookPen,
  PanelLeft,
  PanelLeftClose,
  Play,
  Shield,
  SlidersHorizontal,
  SpellCheck,
  Square,
  Volume2,
  WandSparkles,
  WholeWord,
} from "lucide-react";
import {
  checkAccessibilityPermission,
  checkInputMonitoringPermission,
  checkMicrophonePermission,
  checkScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import { LayoutGroup, motion } from "framer-motion";
import { press } from "./motion/springs";
import { ModelStateEvent } from "./lib/types/events";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import Footer from "./components/footer";
import { titleBarOverlayButtonFocusClass } from "@/lib/interactiveFocus";
import { CommandMenu } from "./components/CommandMenu";
import { OnboardingWizard } from "./components/onboarding";
import { Sidebar, type SidebarItem } from "./components/Sidebar";
import { Button } from "./components/ui/Button";
import { Textarea } from "./components/ui/Textarea";
import {
  useRefreshSettings,
  useSettingsSlice,
  useUpdateSetting,
} from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { initializeInputServices } from "@/lib/appInitialization";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import {
  AboutSection,
  AISetupSettingsSection,
  ConvoFilesContextSection,
  ConvoJotpadSection,
  ConvoSelectionSection,
  ConvoSettingsCoachSection,
  CorrectionsSection,
  DictateHistorySection,
  DiagnosticsSettingsSection,
  DictateModelsSection,
  GeneralAppSettingsSection,
  JotPadSection,
  ListenAutoReadbackSection,
  ListenEngineLibrarySection,
  ListenMyVoicesSection,
  ListenOutputSection,
  ListenVoiceCloningSection,
  OutputPasteSettingsSection,
  PrivacyStorageSettingsSection,
  RefineProfilesSection,
  RecordingDevicesSettingsSection,
  RefineModelsSection,
  RefinePhraseKeysSection,
  RefineTranslationSection,
  ShortcutsSettingsSection,
} from "@/components/AppSections";

type OnboardingStep = "onboarding" | "done";
type PrimaryMode = "dictate" | "refine" | "listen" | "convo";
type RootView = PrimaryMode | "settings";

type PostProcessPreviewRequest = {
  request_id: string;
  source_text: string;
  preview_text: string;
  translated_text?: string | null;
  destination_label?: string | null;
  origin?: string | null;
};

type ViewSection = SidebarItem & {
  title: string;
  content: React.ReactNode;
};

const SIDEBAR_COLLAPSED_KEY = "vox-jot-sidebar-collapsed";

const SectionHeader: React.FC<{ id: string; title: string }> = ({
  id,
  title,
}) => (
  <div className="px-1">
    <div className="flex items-center justify-between gap-4">
      <h2 className="heading-display text-2xl font-semibold tracking-tight text-[var(--text)]">
        {title}
      </h2>
      <div
        id={`${id}-section-actions`}
        className="app-no-drag flex shrink-0 items-center gap-1"
      />
    </div>
  </div>
);

const PrimaryModeSwitcher: React.FC<{
  activeMode: PrimaryMode;
  onSelect: (mode: PrimaryMode) => void;
}> = ({ activeMode, onSelect }) => {
  const items: Array<{ id: PrimaryMode; label: string }> = [
    { id: "dictate", label: "Dictate" },
    { id: "refine", label: "Refine" },
    { id: "listen", label: "Listen" },
    { id: "convo", label: "Convo" },
  ];

  return (
    <div className="app-mode-switcher app-no-drag">
      <LayoutGroup id="primary-mode-switcher">
        <div
          className="relative flex items-stretch overflow-hidden rounded-xl border border-[var(--ring-hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_80%,transparent)] shadow-[inset_0_1px_0_var(--edge-highlight),0_1px_2px_rgba(0,0,0,0.12)]"
          role="tablist"
        >
          {items.map((item) => {
            const isActive = activeMode === item.id;
            const activate = () => onSelect(item.id);

            return (
              <motion.button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                whileTap={{ scale: 0.97 }}
                transition={press}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  activate();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                  }
                }}
                className="relative px-3.5 py-1.5 text-[13px] font-semibold outline-none focus-visible:z-10"
                style={{
                  color: isActive ? "var(--inverse-text)" : "var(--muted)",
                  transition: "color 160ms var(--spring-crisp)",
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="primary-mode-indicator"
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 32,
                      mass: 0.9,
                    }}
                    className="absolute inset-0 rounded-[10px] bg-[var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                    aria-hidden
                  />
                )}
                <span className="relative z-10">{item.label}</span>
              </motion.button>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
};

function App() {
  const { t, i18n } = useTranslation();
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<PrimaryMode>("dictate");
  const [activeRootView, setActiveRootView] = useState<RootView>("dictate");
  const [activeSectionId, setActiveSectionId] = useState("history");
  const lastSectionByView = useRef<Partial<Record<RootView, string>>>({
    dictate: "history",
  });
  const activeRootViewRef = useRef<RootView>(activeRootView);
  activeRootViewRef.current = activeRootView;
  const activeSectionIdRef = useRef(activeSectionId);
  activeSectionIdRef.current = activeSectionId;
  const [pendingPreview, setPendingPreview] =
    useState<PostProcessPreviewRequest | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    if (!window.matchMedia("(min-width: 769px)").matches) return false;
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const updateSetting = useUpdateSetting();
  const refreshSettings = useRefreshSettings();
  const {
    app_theme: appTheme,
    debug_mode: debugMode,
    post_process_enabled: postProcessEnabled,
    selected_language: selectedLanguage,
    translation_target_language: translationTargetLanguage,
  } = useSettingsSlice([
    "app_theme",
    "debug_mode",
    "post_process_enabled",
    "selected_language",
    "translation_target_language",
  ] as const);
  const direction = getLanguageDirection(i18n.language);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastCommandMenuToggleAtRef = useRef(0);
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const hasCompletedPostOnboardingInit = useRef(false);

  const macTitlebarOverlay = useMemo(() => {
    try {
      return platform() === "macos";
    } catch {
      return false;
    }
  }, []);

  const handleSectionJump = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId);
    lastSectionByView.current[activeRootViewRef.current] = sectionId;
  }, []);

  const handleWorkflowSectionNavigate = useCallback(
    (mode: PrimaryMode, sectionId: string) => {
      lastSectionByView.current[activeRootViewRef.current] =
        activeSectionIdRef.current;
      setActiveMode(mode);
      setActiveRootView(mode);
      setActiveSectionId(sectionId);
      lastSectionByView.current[mode] = sectionId;
    },
    [],
  );

  const sectionsByView = useMemo<Record<RootView, ViewSection[]>>(
    () => ({
      dictate: [
        {
          id: "history",
          label: "Recent History",
          icon: History,
          title: "Recent History",
          content: <DictateHistorySection />,
        },
        {
          id: "corrections",
          label: "Corrections",
          icon: SpellCheck,
          title: "Corrections",
          content: <CorrectionsSection />,
        },
        {
          id: "jot-pad",
          label: "Jot Pad",
          icon: NotebookPen,
          title: "Jot Pad",
          content: <JotPadSection />,
        },
        {
          id: "models",
          label: "Speech Models",
          icon: Cpu,
          title: "Speech Models",
          content: (
            <DictateModelsSection titleActionTargetId="models-section-actions" />
          ),
        },
      ],
      refine: [
        {
          id: "phrase-keys",
          label: "Phrase Keys",
          icon: WholeWord,
          title: "Phrase Keys",
          content: <RefinePhraseKeysSection />,
        },
        {
          id: "write-profiles",
          label: "Write Profiles",
          icon: WandSparkles,
          title: "Write Profiles",
          content: <RefineProfilesSection />,
        },
        {
          id: "translation",
          label: "Translation",
          icon: Languages,
          title: "Translation",
          content: <RefineTranslationSection />,
        },
        {
          id: "models",
          label: "Refine Models",
          icon: Cpu,
          title: "Refine Models",
          content: <RefineModelsSection />,
        },
      ],
      listen: [
        {
          id: "my-voices",
          label: "My Voices",
          icon: Volume2,
          title: "My Voices",
          content: <ListenMyVoicesSection />,
        },
        {
          id: "engine-library",
          label: "Engine Library",
          icon: Cpu,
          title: "Engine Library",
          content: (
            <ListenEngineLibrarySection
              onNavigateToSection={handleWorkflowSectionNavigate}
            />
          ),
        },
        {
          id: "voice-cloning",
          label: "Voice Cloning",
          icon: WandSparkles,
          title: "Voice Cloning",
          content: <ListenVoiceCloningSection />,
        },
        {
          id: "auto-readback",
          label: "Auto-Readback",
          icon: Play,
          title: "Auto-Readback",
          content: <ListenAutoReadbackSection />,
        },
        {
          id: "output",
          label: "Output",
          icon: Headphones,
          title: "Output",
          content: <ListenOutputSection />,
        },
      ],
      convo: [
        {
          id: "selection",
          label: "Selection",
          icon: MessageCircle,
          title: "Selection",
          content: <ConvoSelectionSection />,
        },
        {
          id: "jotpad",
          label: "Jot Pad",
          icon: NotebookPen,
          title: "Jot Pad",
          content: <ConvoJotpadSection />,
        },
        {
          id: "settings-coach",
          label: "Settings Coach",
          icon: Info,
          title: "Settings Coach",
          content: <ConvoSettingsCoachSection />,
        },
        {
          id: "files-context",
          label: "Files & Context",
          icon: FileText,
          title: "Files & Context",
          content: <ConvoFilesContextSection />,
        },
      ],
      settings: [
        {
          id: "general",
          label: "App & Dictation",
          icon: AppWindow,
          title: "App & Dictation",
          content: <GeneralAppSettingsSection />,
        },
        {
          id: "shortcuts",
          label: "Shortcuts",
          icon: Keyboard,
          title: "Shortcuts",
          content: <ShortcutsSettingsSection />,
        },
        {
          id: "recording-devices",
          label: "Recording & Devices",
          icon: Volume2,
          title: "Recording & Devices",
          content: <RecordingDevicesSettingsSection />,
        },
        {
          id: "output-paste",
          label: "Output & Paste",
          icon: SlidersHorizontal,
          title: "Output & Paste",
          content: <OutputPasteSettingsSection />,
        },
        {
          id: "ai-setup",
          label: "Models & AI",
          icon: Cpu,
          title: "Models & AI",
          content: <AISetupSettingsSection />,
        },
        {
          id: "corrections",
          label: "Corrections",
          icon: SpellCheck,
          title: "Corrections",
          content: <CorrectionsSection />,
        },
        {
          id: "privacy",
          label: "Privacy & Storage",
          icon: Shield,
          title: "Privacy & Storage",
          content: <PrivacyStorageSettingsSection />,
        },
        {
          id: "diagnostics",
          label: "Diagnostics",
          icon: FlaskConical,
          title: "Diagnostics",
          content: <DiagnosticsSettingsSection />,
        },
        {
          id: "about",
          label: "About Vox Jot",
          icon: Info,
          title: "About Vox Jot",
          content: <AboutSection />,
        },
      ],
    }),
    [handleWorkflowSectionNavigate],
  );

  const activeSections = sectionsByView[activeRootView];

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  useEffect(() => {
    const toggleCommandMenu = () => {
      const now = Date.now();
      if (now - lastCommandMenuToggleAtRef.current < 150) {
        return;
      }
      lastCommandMenuToggleAtRef.current = now;
      setCommandMenuOpen((prev) => !prev);
    };

    const unlisten = listen("toggle-command-menu", () => {
      toggleCommandMenu();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleCommandMenu();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlisten.then((fn) => fn());
    };
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.code !== "Backslash") {
        return;
      }
      if (event.repeat) return;
      if (!window.matchMedia("(min-width: 769px)").matches) return;
      event.preventDefault();
      toggleSidebarCollapsed();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebarCollapsed]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 769px)");
    const sync = () => {
      if (!mq.matches) {
        setSidebarCollapsed(false);
        try {
          localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
        } catch {
          /* ignore */
        }
      }
    };
    mq.addEventListener("change", sync);
    sync();
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

  useEffect(() => {
    const theme = appTheme ?? "system";
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [appTheme]);

  useEffect(() => {
    if (onboardingStep === "done" && !hasCompletedPostOnboardingInit.current) {
      hasCompletedPostOnboardingInit.current = true;
      void (async () => {
        await initializeInputServices((message) => {
          console.warn(message);
        });
        await refreshSettings();
        await Promise.all([refreshAudioDevices(), refreshOutputDevices()]);
      })();
    }
  }, [
    onboardingStep,
    refreshAudioDevices,
    refreshOutputDevices,
    refreshSettings,
  ]);

  // Use a ref to track debug_mode so the listener doesn't tear down on every toggle
  const debugModeRef = useRef(debugMode ?? false);
  useEffect(() => {
    debugModeRef.current = debugMode ?? false;
  }, [debugMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        void updateSetting("debug_mode", !debugModeRef.current);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [updateSetting]);

  useEffect(() => {
    const unlisten = listen<string>("recording-error", (event) => {
      toast.error(t("errors.recordingFailed", { error: event.payload }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen<string>("translation-error", (event) => {
      toast.error(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("tts-error", (event) => {
      toast.error(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<ModelStateEvent>("model-state-changed", (event) => {
      if (event.payload.event_type === "loading_failed") {
        toast.error(
          t("errors.modelLoadFailed", {
            model:
              event.payload.model_name || t("errors.modelLoadFailedUnknown"),
          }),
          {
            description: event.payload.error,
          },
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen<PostProcessPreviewRequest>(
      "post-process-preview-request",
      (event) => {
        setPendingPreview(event.payload);
        setPreviewDraft(event.payload.preview_text);
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleModalKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      void resolvePreview(false);
      return;
    }
    if (event.key === "Tab" && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (pendingPreview && modalRef.current) {
      const firstFocusable =
        modalRef.current.querySelector<HTMLElement>("textarea, button");
      firstFocusable?.focus();
    }
  }, [pendingPreview]);

  const resolvePreview = async (accepted: boolean) => {
    if (!pendingPreview) {
      return;
    }

    try {
      const result = await commands.resolvePostProcessPreview(
        pendingPreview.request_id,
        accepted,
        accepted ? previewDraft : null,
      );
      if (result.status !== "ok") {
        toast.error(result.error);
        return;
      }
      setPendingPreview(null);
      setPreviewDraft("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.postProcessing.preview.errors.generic"),
      );
    }
  };

  const previewSpeakLocale = useMemo(() => {
    if (!pendingPreview) {
      return null;
    }

    const sourceLocale =
      selectedLanguage && selectedLanguage !== "auto" ? selectedLanguage : null;

    if (pendingPreview.origin?.startsWith("translation")) {
      return translationTargetLanguage ?? sourceLocale;
    }

    return sourceLocale;
  }, [pendingPreview, selectedLanguage, translationTargetLanguage]);

  const handlePreviewSpeak = useCallback(async () => {
    if (!previewDraft.trim()) {
      return;
    }

    const result = await commands.ttsSpeak(
      previewDraft,
      previewSpeakLocale,
      null,
      "preview_modal",
      false,
    );
    if (result.status !== "ok") {
      toast.error(result.error);
    }
  }, [previewDraft, previewSpeakLocale]);

  const handlePreviewStop = useCallback(async () => {
    const result = await commands.ttsStop();
    if (result.status !== "ok") {
      toast.error(result.error);
    }
  }, []);

  const revealMainWindowForPermissions = async () => {
    try {
      await commands.showMainWindowCommand();
    } catch (error) {
      console.warn(
        "Failed to show main window for permission onboarding:",
        error,
      );
    }
  };

  const checkOnboardingStatus = async () => {
    try {
      const result = await commands.hasAnyModelsAvailable();
      const hasModels = result.status === "ok" && result.data;
      const currentPlatform = platform();

      if (hasModels) {
        setIsReturningUser(true);

        if (currentPlatform === "macos") {
          try {
            const [
              hasAccessibility,
              hasMicrophone,
              hasInputMonitoring,
              hasScreenRecording,
            ] = await Promise.all([
              checkAccessibilityPermission(),
              checkMicrophonePermission(),
              checkInputMonitoringPermission(),
              checkScreenRecordingPermission(),
            ]);
            if (
              !hasAccessibility ||
              !hasMicrophone ||
              !hasInputMonitoring ||
              !hasScreenRecording
            ) {
              await revealMainWindowForPermissions();
              setOnboardingStep("onboarding");
              return;
            }
          } catch (error) {
            console.warn("Failed to check macOS permissions:", error);
          }
        }

        if (currentPlatform === "windows") {
          try {
            const microphoneStatus =
              await commands.getWindowsMicrophonePermissionStatus();
            if (
              microphoneStatus.supported &&
              microphoneStatus.overall_access === "denied"
            ) {
              await revealMainWindowForPermissions();
              setOnboardingStep("onboarding");
              return;
            }
          } catch (error) {
            console.warn(
              "Failed to check Windows microphone permissions:",
              error,
            );
          }
        }

        setOnboardingStep("done");
      } else {
        setIsReturningUser(false);
        setOnboardingStep("onboarding");
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      setOnboardingStep("onboarding");
    }
  };

  const handleOnboardingComplete = () => {
    setOnboardingStep("done");
  };

  const sectionsByViewRef = useRef(sectionsByView);
  sectionsByViewRef.current = sectionsByView;

  const handleModeSelect = useCallback((mode: PrimaryMode) => {
    lastSectionByView.current[activeRootViewRef.current] =
      activeSectionIdRef.current;
    setActiveMode(mode);
    setActiveRootView(mode);
    setActiveSectionId(
      lastSectionByView.current[mode] ||
        sectionsByViewRef.current[mode][0]?.id ||
        "",
    );
  }, []);

  const handleSettingsOpen = useCallback(() => {
    lastSectionByView.current[activeRootViewRef.current] =
      activeSectionIdRef.current;
    setActiveRootView("settings");
    setActiveSectionId(
      lastSectionByView.current.settings ||
        sectionsByViewRef.current.settings[0]?.id ||
        "",
    );
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("navigate", (event) => {
      const view = event.payload;

      if (view === "settings") {
        handleSettingsOpen();
        return;
      }

      if (
        view === "dictate" ||
        view === "refine" ||
        view === "listen" ||
        view === "convo"
      ) {
        handleModeSelect(view);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleModeSelect, handleSettingsOpen]);

  // Resolve the currently active section to render
  const activeSection = useMemo(() => {
    const match = activeSections.find((s) => s.id === activeSectionId);
    return match ?? activeSections[0];
  }, [activeSections, activeSectionId]);

  // Keep activeSectionId in sync if it drifts (e.g. section removed)
  useEffect(() => {
    if (activeSection && activeSection.id !== activeSectionId) {
      setActiveSectionId(activeSection.id);
    }
  }, [activeSection, activeSectionId]);

  if (onboardingStep === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3 animate-[fadeIn_300ms_ease-out]">
          <div className="h-8 w-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  if (onboardingStep === "onboarding") {
    return (
      <OnboardingWizard
        onComplete={handleOnboardingComplete}
        skipToPermissions={isReturningUser}
      />
    );
  }

  return (
    <div
      dir={direction}
      className={`shell relative select-none cursor-default overflow-hidden font-[var(--font-body)] text-[var(--text)] bg-[var(--bg)] transition-colors duration-200${sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${macTitlebarOverlay ? " shell--macos-titlebar-overlay" : ""}`}
    >
      <Toaster
        theme="system"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              "flat-card rounded-xl px-4 py-3 flex items-center gap-3 text-sm",
            title: "font-semibold",
            description:
              "text-[color-mix(in_srgb,var(--text),transparent_35%)]",
          },
        }}
      />

      {macTitlebarOverlay ? (
        <header className="app-macos-titlebar-overlay" dir="ltr">
          <div
            className="app-macos-titlebar-overlay__traffic-shim"
            aria-hidden
          />
          <div className="app-macos-titlebar-overlay__leading app-no-drag flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={`border-transparent text-[var(--muted)] hover:text-[var(--accent)] ${titleBarOverlayButtonFocusClass}`}
              onClick={toggleSidebarCollapsed}
              aria-label={
                sidebarCollapsed
                  ? t("sidebar.expandPanel")
                  : t("sidebar.collapsePanel")
              }
              title={
                sidebarCollapsed
                  ? t("sidebar.expandPanel")
                  : t("sidebar.collapsePanel")
              }
            >
              {sidebarCollapsed ? (
                <PanelLeft className="shrink-0" aria-hidden />
              ) : (
                <PanelLeftClose className="shrink-0" aria-hidden />
              )}
            </Button>
          </div>
          <div className="app-macos-titlebar-overlay__center">
            <PrimaryModeSwitcher
              activeMode={activeMode}
              onSelect={handleModeSelect}
            />
          </div>
          <div
            className="app-macos-titlebar-overlay__drag"
            data-tauri-drag-region
            aria-hidden
          />
          <div className="app-macos-titlebar-overlay__trailing app-no-drag flex items-center gap-4">
            <AccessibilityPermissions presentation="titleBar" />
          </div>
        </header>
      ) : (
        <header className="app-window-toolbar" dir="ltr">
          <div className="app-window-toolbar__sidebar-toggle app-no-drag flex items-center ps-1 pe-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="border-transparent p-1.5 text-[var(--muted)] hover:text-[var(--accent)]"
              onClick={toggleSidebarCollapsed}
              aria-label={
                sidebarCollapsed
                  ? t("sidebar.expandPanel")
                  : t("sidebar.collapsePanel")
              }
              title={
                sidebarCollapsed
                  ? t("sidebar.expandPanel")
                  : t("sidebar.collapsePanel")
              }
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-5 w-5 shrink-0" aria-hidden />
              ) : (
                <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden />
              )}
            </Button>
          </div>
          <div className="app-window-toolbar__center app-no-drag">
            <PrimaryModeSwitcher
              activeMode={activeMode}
              onSelect={handleModeSelect}
            />
          </div>
          <div
            className="app-window-toolbar__drag"
            data-tauri-drag-region
            aria-hidden
          />
          <div className="app-no-drag flex items-center gap-4 pe-2">
            <AccessibilityPermissions presentation="titleBar" />
          </div>
        </header>
      )}

      <Sidebar
        activeSectionId={activeSectionId}
        items={activeSections}
        collapsed={sidebarCollapsed}
        settingsActive={activeRootView === "settings"}
        onSectionChange={handleSectionJump}
        onSettingsClick={handleSettingsOpen}
      />

      <main className="main-content relative flex min-w-0 flex-col overflow-hidden bg-[var(--bg)]">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5 md:p-7">
            {activeSection && (
              <section id={activeSection.id} className="space-y-4">
                <SectionHeader
                  id={activeSection.id}
                  title={activeSection.title}
                />
                {activeSection.content}
              </section>
            )}
          </div>
        </div>

        <div className="mt-auto shrink-0 border-t border-[var(--border)] bg-[var(--bg)]">
          <Footer />
        </div>
      </main>

      <CommandMenu
        open={commandMenuOpen}
        onClose={() => setCommandMenuOpen(false)}
        onNavigate={(view) => {
          if (view === "settings") {
            handleSettingsOpen();
          } else {
            handleModeSelect(view);
          }
        }}
        onSelectTheme={(theme) => {
          void updateSetting("app_theme", theme);
        }}
        postProcessEnabled={postProcessEnabled ?? false}
        onTogglePostProcess={() => {
          void updateSetting(
            "post_process_enabled",
            !(postProcessEnabled ?? false),
          );
        }}
        sectionJumps={activeSections.map((s) => ({
          id: s.id,
          label: s.title,
          view: activeRootView,
        }))}
        onJumpToSection={(id) => handleSectionJump(id)}
      />

      {pendingPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-bg,rgba(4,10,20,0.85))] p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("settings.postProcessing.preview.modal.title")}
          onKeyDown={handleModalKeyDown}
          ref={modalRef}
        >
          <div className="flat-card w-full max-w-3xl rounded-2xl">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--text),transparent_86%)] px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">
                  {pendingPreview.origin?.startsWith("translation")
                    ? t(
                        "settings.postProcessing.preview.modal.translationTitle",
                        {
                          defaultValue: "Review Translation",
                        },
                      )
                    : t("settings.postProcessing.preview.modal.title")}
                </h2>
                <p className="text-sm text-[color-mix(in_srgb,var(--text),transparent_35%)]">
                  {pendingPreview.origin?.startsWith("translation")
                    ? t(
                        "settings.postProcessing.preview.modal.translationDescription",
                        {
                          defaultValue:
                            "Confirm the translated text before Vox Jot pastes or routes it.",
                        },
                      )
                    : t("settings.postProcessing.preview.modal.description")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handlePreviewSpeak()}
                  className="inline-flex items-center gap-1"
                >
                  <Play className="h-3.5 w-3.5" />
                  {t("common.play", { defaultValue: "Play" })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handlePreviewStop()}
                  className="inline-flex items-center gap-1"
                >
                  <Square className="h-3.5 w-3.5" />
                  {t("common.stop", { defaultValue: "Stop" })}
                </Button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-[color-mix(in_srgb,var(--text),transparent_35%)]">
                  {t("settings.postProcessing.preview.modal.originalLabel")}
                </div>
                <Textarea value={pendingPreview.source_text} readOnly />
              </div>

              {pendingPreview.translated_text && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-[color-mix(in_srgb,var(--text),transparent_35%)]">
                    {t(
                      "settings.postProcessing.preview.modal.translatedLabel",
                      { defaultValue: "Translated" },
                    )}
                  </div>
                  <Textarea value={pendingPreview.translated_text} readOnly />
                </div>
              )}

              <div className="space-y-1">
                <div className="text-xs font-semibold text-[color-mix(in_srgb,var(--text),transparent_35%)]">
                  {pendingPreview.origin?.startsWith("translation")
                    ? t(
                        "settings.postProcessing.preview.modal.finalOutputLabel",
                        { defaultValue: "Final output" },
                      )
                    : t("settings.postProcessing.preview.modal.editedLabel")}
                </div>
                <Textarea
                  value={previewDraft}
                  onChange={(event) => setPreviewDraft(event.target.value)}
                />
              </div>

              {pendingPreview.destination_label && (
                <div className="text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--text),transparent_45%)]">
                  {`${t(
                    "settings.postProcessing.preview.modal.destinationPrefix",
                    { defaultValue: "Destination" },
                  )}: ${pendingPreview.destination_label.replace(/_/g, " ")}`}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse justify-end gap-2 border-t border-[color-mix(in_srgb,var(--text),transparent_86%)] px-5 py-4 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => void resolvePreview(false)}
              >
                {t("settings.postProcessing.preview.modal.cancel")}
              </Button>
              <Button onClick={() => void resolvePreview(true)}>
                {t("settings.postProcessing.preview.modal.apply")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
