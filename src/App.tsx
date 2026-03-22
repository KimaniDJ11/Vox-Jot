import React, {
  startTransition,
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
  FlaskConical,
  History,
  Info,
  Keyboard,
  Languages,
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
} from "tauri-plugin-macos-permissions-api";
import { ModelStateEvent } from "./lib/types/events";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import Footer from "./components/footer";
import { OnboardingWizard } from "./components/onboarding";
import { Sidebar, type SidebarItem } from "./components/Sidebar";
import { Button } from "./components/ui/Button";
import { Textarea } from "./components/ui/Textarea";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import {
  AboutSection,
  AISetupSettingsSection,
  CorrectionsSection,
  DictateHistorySection,
  DiagnosticsSettingsSection,
  DictateModelsSection,
  GeneralAppSettingsSection,
  JotPadSection,
  ListenAutoReadbackSection,
  ListenPlaybackDeviceSection,
  ListenVoiceEngineSection,
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
type PrimaryMode = "dictate" | "refine" | "listen";
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

const AppContentSection = React.forwardRef<
  HTMLElement,
  {
    id: string;
    title: string;
    children: React.ReactNode;
  }
>(({ id, title, children }, ref) => (
  <section
    id={id}
    ref={ref}
    className="scroll-mt-24 space-y-5 border-b border-[var(--border)]/80 pb-8 last:border-b-0 last:pb-0"
  >
    <div className="px-1">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-extrabold uppercase tracking-[0.18em] text-black dark:text-[var(--text)]">
          {title}
        </h2>
        <div
          id={`${id}-section-actions`}
          className="app-no-drag flex shrink-0 items-center gap-1"
        />
      </div>
    </div>
    {children}
  </section>
));

AppContentSection.displayName = "AppContentSection";

const DeferredSectionBody: React.FC<{
  immediate?: boolean;
  children: React.ReactNode;
}> = ({ immediate = false, children }) => {
  const [ready, setReady] = useState(immediate);

  useEffect(() => {
    if (ready) return;

    if (immediate) {
      setReady(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setReady(true);
    }, 40);

    return () => window.clearTimeout(timer);
  }, [immediate, ready]);

  if (ready) {
    return <>{children}</>;
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-5 py-6 text-sm text-[var(--muted)] shadow-[var(--shadow-sm)]">
      Loading section...
    </div>
  );
};

const PrimaryModeSwitcher: React.FC<{
  activeMode: PrimaryMode;
  onSelect: (mode: PrimaryMode) => void;
}> = ({ activeMode, onSelect }) => {
  const items: Array<{ id: PrimaryMode; label: string }> = [
    { id: "dictate", label: "Dictate" },
    { id: "refine", label: "Refine" },
    { id: "listen", label: "Listen" },
  ];

  return (
    <div className="app-mode-switcher app-no-drag">
      <div className="flex items-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-[var(--shadow-sm)]">
        {items.map((item) => {
          const isActive = activeMode === item.id;
          const activate = () => onSelect(item.id);

          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isActive}
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
              className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-[var(--accent)] text-[var(--inverse-text)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

function App() {
  const { t, i18n } = useTranslation();
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [activeMode, setActiveMode] = useState<PrimaryMode>("dictate");
  const [activeRootView, setActiveRootView] = useState<RootView>("dictate");
  const [activeSectionId, setActiveSectionId] = useState("");
  const [pendingSectionJump, setPendingSectionJump] = useState<string | null>(
    null,
  );
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
  const { settings, updateSetting } = useSettings();
  const direction = getLanguageDirection(i18n.language);
  const modalRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastAlignedRootViewRef = useRef<RootView | null>(null);
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

  const handleSectionJump = useCallback(
    (sectionId: string, behavior: ScrollBehavior = "smooth") => {
      setActiveSectionId(sectionId);
      const container = contentScrollRef.current;
      const node = sectionRefs.current[sectionId];
      if (!container || !node) {
        return;
      }
      const top = Math.max(node.offsetTop - 20, 0);
      container.scrollTo({ top, behavior });
    },
    [],
  );

  const handleWorkflowSectionNavigate = useCallback(
    (mode: PrimaryMode, sectionId: string) => {
      if (activeRootView === mode) {
        handleSectionJump(sectionId);
        return;
      }

      setActiveMode(mode);
      setPendingSectionJump(sectionId);
      startTransition(() => {
        setActiveRootView(mode);
      });
    },
    [activeRootView, handleSectionJump],
  );

  const sectionsByView = useMemo<Record<RootView, ViewSection[]>>(
    () => ({
      dictate: [
        {
          id: "history",
          label: "History",
          icon: History,
          title: "History",
          content: <DictateHistorySection />,
        },
        {
          id: "corrections",
          label: "Dictionary",
          icon: SpellCheck,
          title: "Dictionary",
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
          label: "Models",
          icon: Cpu,
          title: "Models",
          content: <DictateModelsSection titleActionTargetId="models-section-actions" />,
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
          label: "Models",
          icon: Cpu,
          title: "Models",
          content: <RefineModelsSection />,
        },
      ],
      listen: [
        {
          id: "voice-engine",
          label: "Voice & Engine",
          icon: Volume2,
          title: "Voice & Engine",
          content: (
            <ListenVoiceEngineSection
              onNavigateToSection={handleWorkflowSectionNavigate}
            />
          ),
        },
        {
          id: "auto-readback",
          label: "Auto Readback",
          icon: Play,
          title: "Auto Readback",
          content: <ListenAutoReadbackSection />,
        },
        {
          id: "playback-device",
          label: "Playback Device",
          icon: SlidersHorizontal,
          title: "Playback Device",
          content: <ListenPlaybackDeviceSection />,
        },
      ],
      settings: [
        {
          id: "general",
          label: "General",
          icon: AppWindow,
          title: "General",
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
          label: "AI Setup",
          icon: Cpu,
          title: "AI Setup",
          content: <AISetupSettingsSection />,
        },
        {
          id: "corrections",
          label: "Dictionary",
          icon: SpellCheck,
          title: "Dictionary",
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
          label: "About",
          icon: Info,
          title: "About",
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
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  useEffect(() => {
    if (onboardingStep === "done" && !hasCompletedPostOnboardingInit.current) {
      hasCompletedPostOnboardingInit.current = true;
      Promise.all([
        commands.initializeEnigo(),
        commands.initializeShortcuts(),
      ]).catch((error) => {
        console.warn("Failed to initialize:", error);
      });
      refreshAudioDevices();
      refreshOutputDevices();
    }
  }, [onboardingStep, refreshAudioDevices, refreshOutputDevices]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        void updateSetting("debug_mode", !currentDebugMode);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

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

  useEffect(() => {
    const firstSectionId = activeSections[0]?.id || "";
    const hasPendingSectionJump = Boolean(
      pendingSectionJump &&
        activeSections.some((section) => section.id === pendingSectionJump),
    );
    const rootViewChanged = lastAlignedRootViewRef.current !== activeRootView;

    if (!hasPendingSectionJump && !rootViewChanged) {
      return;
    }

    const nextSectionId = hasPendingSectionJump
      ? (pendingSectionJump as string)
      : firstSectionId;

    setActiveSectionId(nextSectionId);

    requestAnimationFrame(() => {
      const container = contentScrollRef.current;
      const node = sectionRefs.current[nextSectionId];
      if (container && node) {
        const top = Math.max(node.offsetTop - 20, 0);
        container.scrollTo({ top, behavior: "auto" });
      } else {
        container?.scrollTo({ top: 0, behavior: "auto" });
      }
    });

    lastAlignedRootViewRef.current = activeRootView;
    if (pendingSectionJump !== null) {
      setPendingSectionJump(null);
    }
  }, [activeRootView, activeSections, pendingSectionJump]);

  useEffect(() => {
    const container = contentScrollRef.current;
    if (!container) {
      return;
    }

    const syncActiveSection = () => {
      const threshold = container.scrollTop + 120;
      let current = activeSections[0]?.id || "";

      for (const section of activeSections) {
        const node = sectionRefs.current[section.id];
        if (node && node.offsetTop <= threshold) {
          current = section.id;
        }
      }

      setActiveSectionId((prev) => (prev === current ? prev : current));
    };

    syncActiveSection();
    container.addEventListener("scroll", syncActiveSection);
    return () => container.removeEventListener("scroll", syncActiveSection);
  }, [activeSections]);

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
      settings?.selected_language && settings.selected_language !== "auto"
        ? settings.selected_language
        : null;

    if (pendingPreview.origin?.startsWith("translation")) {
      return settings?.translation_target_language ?? sourceLocale;
    }

    return sourceLocale;
  }, [
    pendingPreview,
    settings?.selected_language,
    settings?.translation_target_language,
  ]);

  const handlePreviewSpeak = useCallback(async () => {
    if (!previewDraft.trim()) {
      return;
    }

    const result = await commands.ttsSpeak(
      previewDraft,
      previewSpeakLocale,
      settings?.tts_default_voice_id ?? null,
      "preview_modal",
      false,
    );
    if (result.status !== "ok") {
      toast.error(result.error);
    }
  }, [previewDraft, previewSpeakLocale, settings?.tts_default_voice_id]);

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
      console.warn("Failed to show main window for permission onboarding:", error);
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
            const [hasAccessibility, hasMicrophone, hasInputMonitoring] =
              await Promise.all([
                checkAccessibilityPermission(),
                checkMicrophonePermission(),
                checkInputMonitoringPermission(),
              ]);
            if (!hasAccessibility || !hasMicrophone || !hasInputMonitoring) {
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
            console.warn("Failed to check Windows microphone permissions:", error);
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

  const handleModeSelect = useCallback((mode: PrimaryMode) => {
    setActiveMode(mode);
    setPendingSectionJump(null);
    startTransition(() => {
      setActiveRootView(mode);
    });
  }, []);

  const handleSettingsOpen = useCallback(() => {
    setPendingSectionJump(null);
    startTransition(() => {
      setActiveRootView("settings");
    });
  }, []);

  const setSectionRef = useCallback(
    (sectionId: string) => (node: HTMLElement | null) => {
      sectionRefs.current[sectionId] = node;
    },
    [],
  );

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
              "text-[color-mix(in_srgb,var(--color-text),transparent_35%)]",
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
              size="sm"
              className="border-transparent p-1 text-[var(--muted)] hover:text-[var(--accent)]"
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
          <div className="app-macos-titlebar-overlay__trailing app-no-drag flex items-center gap-4" />
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
          <div className="app-no-drag flex items-center gap-4 pe-2" />
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
        <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-8">
            <AccessibilityPermissions />

            {activeSections.map((section, index) => (
              <AppContentSection
                key={section.id}
                id={section.id}
                ref={setSectionRef(section.id)}
                title={section.title}
              >
                <DeferredSectionBody
                  immediate={index === 0 || activeSectionId === section.id}
                >
                  {section.content}
                </DeferredSectionBody>
              </AppContentSection>
            ))}
          </div>
        </div>

        <div className="mt-auto shrink-0 border-t border-[var(--border)] bg-[var(--bg)]">
          <Footer />
        </div>
      </main>

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
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--color-text),transparent_86%)] px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">
                  {pendingPreview.origin?.startsWith("translation")
                    ? "Review Translation"
                    : t("settings.postProcessing.preview.modal.title")}
                </h2>
                <p className="text-sm text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
                  {pendingPreview.origin?.startsWith("translation")
                    ? "Confirm the translated text before Vox Jot pastes or routes it."
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
                  Play
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handlePreviewStop()}
                  className="inline-flex items-center gap-1"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
                  {t("settings.postProcessing.preview.modal.originalLabel")}
                </div>
                <Textarea value={pendingPreview.source_text} readOnly />
              </div>

              {pendingPreview.translated_text && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
                    Translated
                  </div>
                  <Textarea value={pendingPreview.translated_text} readOnly />
                </div>
              )}

              <div className="space-y-1">
                <div className="text-xs font-semibold text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
                  {pendingPreview.origin?.startsWith("translation")
                    ? "Final output"
                    : t("settings.postProcessing.preview.modal.editedLabel")}
                </div>
                <Textarea
                  value={previewDraft}
                  onChange={(event) => setPreviewDraft(event.target.value)}
                />
              </div>

              {pendingPreview.destination_label && (
                <div className="text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--color-text),transparent_45%)]">
                  Destination:{" "}
                  {pendingPreview.destination_label.replace(/_/g, " ")}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse justify-end gap-2 border-t border-[color-mix(in_srgb,var(--color-text),transparent_86%)] px-5 py-4 sm:flex-row">
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
