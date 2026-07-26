import React, {
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { toast, Toaster } from "sonner";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import i18n from "@/i18n";
import {
  AppWindow,
  AudioWaveform,
  BookOpen,
  Bot,
  Cpu,
  Dna,
  FileAudio,
  FlaskConical,
  House,
  Info,
  Keyboard,
  Languages,
  Monitor,
  Paintbrush,
  Play,
  Scale,
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
import { resolveListenSectionId } from "@/lib/sectionNavigation";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import SidebarToggleIcon from "./components/icons/SidebarToggleIcon";
import Footer from "./components/footer";
import AppUpdateButton from "@/components/update-checker/AppUpdateButton";
import { useMacosWindowFullscreen } from "@/hooks/useMacosWindowFullscreen";
import { useMinWidth769 } from "@/hooks/useMinWidth769";
import { useApplyAppearanceSettings } from "@/hooks/useApplyAppearanceSettings";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
  titleBarOverlayButtonFocusClass,
} from "@/lib/interactiveFocus";
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
import { isMacAppStoreBuild } from "@/lib/distribution";
import { isProductSectionVisible } from "@/lib/productArchitecture";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";
import { handleHorizontalTabListKeyDown } from "@/lib/ui/tabKeyboard";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import { SectionLoading } from "@/components/app-sections/shared";
import ScreenContextSettingsSection from "@/components/settings/screen-context/ScreenContextSettingsSection";
import { useDictationEncouragementTitle } from "@/hooks/useDictationEncouragementTitle";
import {
  RefinePhraseKeysSection,
  RefineProfilesSection,
  RefineTranslationSection,
} from "@/components/app-sections/refineCore";

type OnboardingStep = "onboarding" | "done";

const titlebarNoDragSelector = [
  ".app-no-drag",
  ".app-mode-switcher",
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='tab']",
  "[contenteditable='true']",
].join(",");

const shouldStartWindowDrag = (
  event: React.MouseEvent<HTMLElement>,
): boolean => {
  if (event.button !== 0 || event.buttons !== 1) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  return !target.closest(titlebarNoDragSelector);
};

type PrimaryMode = "dictate" | "refine" | "listen";
type RootView = PrimaryMode | "settings";
type NavigateEventPayload =
  | RootView
  | "story_studio"
  | {
      view?: RootView | "story_studio";
      section?: string | null;
    };

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

class SectionErrorBoundary extends React.Component<
  { sectionId: string; title: string; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `Section "${this.props.sectionId}" failed to render:`,
      error,
      info,
    );
  }

  componentDidUpdate(prevProps: { sectionId: string }) {
    if (prevProps.sectionId !== this.props.sectionId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] px-5 py-4 text-sm text-[var(--text)] shadow-[var(--shadow-sm)]"
      >
        <p className="font-semibold">
          {i18n.t("appSections.common.sectionLoadFailedTitle", {
            title: this.props.title,
            defaultValue: "{{title}} could not load.",
          })}
        </p>
        <p className="mt-1 text-[var(--muted)]">
          {i18n.t("appSections.common.sectionLoadFailedDescription", {
            defaultValue:
              "Switch sections and come back, or reload the dev app. The error has been logged to the dev console.",
          })}
        </p>
      </div>
    );
  }
}

const DictateHistorySection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.DictateHistorySection,
  })),
);
const CorrectionsSection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.CorrectionsSection,
  })),
);
const FileTranscriptionSection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.FileTranscriptionSection,
  })),
);
const ReaderSection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.ReaderSection,
  })),
);
const EnhanceAudioSection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.EnhanceAudioSection,
  })),
);
const ListenVoiceDesignSection = lazy(() =>
  import("@/components/app-sections/listen").then((module) => ({
    default: module.ListenVoiceDesignSection,
  })),
);
const ListenVoiceCloningSection = lazy(() =>
  import("@/components/app-sections/listen").then((module) => ({
    default: module.ListenVoiceCloningSection,
  })),
);
const ListenVoiceChangerSection = lazy(() =>
  import("@/components/app-sections/listen").then((module) => ({
    default: module.ListenVoiceChangerSection,
  })),
);
const StoryStudioAppSection = lazy(() =>
  import("@/components/app-sections/listen").then((module) => ({
    default: module.StoryStudioAppSection,
  })),
);
const StoryAudioHistoryAppSection = lazy(() =>
  import("@/components/app-sections/listen").then((module) => ({
    default: module.StoryAudioHistoryAppSection,
  })),
);
const GeneralAppSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.GeneralAppSettingsSection,
  })),
);
const ShortcutsSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.ShortcutsSettingsSection,
  })),
);
const RecordingDevicesSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.RecordingDevicesSettingsSection,
  })),
);
const OutputPasteSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.OutputPasteSettingsSection,
  })),
);
const CorrectionsSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.CorrectionsSettingsSection,
  })),
);
const AISetupSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.AISetupSettingsSection,
  })),
);
const ModelTestingSection = lazy(() =>
  import("@/components/app-sections/testing").then((module) => ({
    default: module.ModelTestingSection,
  })),
);
const PrivacyStorageSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.PrivacyStorageSettingsSection,
  })),
);
const LegalModelTermsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.LegalModelTermsSection,
  })),
);
const DiagnosticsSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.DiagnosticsSettingsSection,
  })),
);
const AutomationAgentsSettingsSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.AutomationAgentsSettingsSection,
  })),
);
const AboutSection = lazy(() =>
  import("@/components/app-sections/settings").then((module) => ({
    default: module.AboutSection,
  })),
);

const SIDEBAR_COLLAPSED_KEY = "vox-jot-sidebar-collapsed";

const HistoryEncouragementTitle: React.FC = () => {
  const title = useDictationEncouragementTitle();
  return <span className="font-bold">{title}</span>;
};

const SectionHeader: React.FC<{
  id: string;
  title: string;
}> = ({ id, title }) => {
  return (
    <div className="px-1">
      <div className="flex items-center justify-between gap-4">
        <h2 className="heading-display text-2xl font-bold tracking-tight text-[var(--text)]">
          {id === "history" ? (
            <HistoryEncouragementTitle />
          ) : (
            <span className="font-bold">{title}</span>
          )}
        </h2>
        <div
          id={`${id}-section-actions`}
          className="app-no-drag flex shrink-0 items-center gap-1"
        />
      </div>
    </div>
  );
};

const PrimaryModeSwitcher: React.FC<{
  activeMode: PrimaryMode;
  onSelect: (mode: PrimaryMode) => void;
}> = ({ activeMode, onSelect }) => {
  const { t } = useTranslation();
  const items: Array<{ id: PrimaryMode; label: string }> = [
    { id: "dictate", label: t("appModes.dictate") },
    { id: "refine", label: t("appModes.refine") },
    { id: "listen", label: t("appModes.listen") },
  ];

  return (
    <div className="app-mode-switcher app-no-drag">
      <LayoutGroup id="primary-mode-switcher">
        <div
          className="relative flex items-stretch overflow-hidden rounded-xl border border-[var(--ring-hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_80%,transparent)] shadow-[var(--segmented-control-shadow)]"
          role="tablist"
          aria-label={t("appModes.switcherLabel", {
            defaultValue: "Primary mode",
          })}
          onKeyDown={(event) =>
            handleHorizontalTabListKeyDown(event, {
              direction: document.dir === "rtl" ? "rtl" : "ltr",
            })
          }
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
                aria-controls={`primary-mode-panel-${item.id}`}
                id={`primary-mode-tab-${item.id}`}
                tabIndex={isActive ? 0 : -1}
                whileTap={{ scale: 0.97 }}
                transition={press}
                onClick={() => {
                  activate();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                  }
                }}
                className={`relative px-3.5 py-1.5 text-[13px] font-semibold focus-visible:z-10 ${interactiveFocusRingClass} ${minTapTargetHeightClass}`}
                style={{
                  color: isActive ? "var(--accent-foreground)" : "var(--muted)",
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
                    className="absolute inset-0 rounded-[10px] bg-[var(--accent)] shadow-[var(--accent-inset-highlight)]"
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
  // Mirrors of the current view/section for the stable nav callbacks below.
  // Written in an effect rather than during render so a re-render that React
  // throws away cannot leave these pointing at state that was never committed.
  const activeRootViewRef = useRef<RootView>(activeRootView);
  const activeSectionIdRef = useRef(activeSectionId);
  useEffect(() => {
    activeRootViewRef.current = activeRootView;
  }, [activeRootView]);
  useEffect(() => {
    activeSectionIdRef.current = activeSectionId;
  }, [activeSectionId]);
  const [pendingPreview, setPendingPreview] =
    useState<PostProcessPreviewRequest | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const [isResolvingPreview, setIsResolvingPreview] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    if (!window.matchMedia("(min-width: 769px)").matches) return false;
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [modelHubVisible, setModelHubVisible] = useState(false);
  useEffect(() => {
    const unlisten = listen<boolean>("model-hub-visibility", (event) => {
      setModelHubVisible(!!event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
  const updateSetting = useUpdateSetting();
  const refreshSettings = useRefreshSettings();
  const {
    app_theme: appTheme,
    app_font_scale: appFontScale,
    experimental_enabled: experimentalEnabled,
    post_process_enabled: postProcessEnabled,
    selected_language: selectedLanguage,
    translation_target_language: translationTargetLanguage,
  } = useSettingsSlice([
    "app_theme",
    "app_font_scale",
    "experimental_enabled",
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

  const macosWindowFullscreen = useMacosWindowFullscreen();
  const isDesktopLayout = useMinWidth769();

  const handleWindowTitlebarMouseDown = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!shouldStartWindowDrag(event)) {
        return;
      }

      event.preventDefault();
      void getCurrentWindow()
        .startDragging()
        .catch((error) => {
          console.warn("Failed to start window drag:", error);
        });
    },
    [],
  );

  const handleSectionJump = useCallback((sectionId: string) => {
    const resolved =
      activeRootViewRef.current === "listen"
        ? resolveListenSectionId(sectionId)
        : sectionId;
    setActiveSectionId(resolved);
    lastSectionByView.current[activeRootViewRef.current] = resolved;
  }, []);

  const sectionsByView = useMemo<Record<RootView, ViewSection[]>>(() => {
    const makeSection = (
      id: string,
      i18nKey: string,
      icon: SidebarItem["icon"],
      content: React.ReactNode,
      iconTone: SidebarItem["iconTone"] = "accent",
      groupLabel?: string,
      defaultLabel?: string,
    ): ViewSection => {
      const label = defaultLabel
        ? t(i18nKey, { defaultValue: defaultLabel })
        : t(i18nKey);
      return { id, label, icon, iconTone, groupLabel, title: label, content };
    };

    const settingsBasics = t("appSections.nav.groups.settingsBasics", {
      defaultValue: "Basics",
    });
    const settingsIntelligence = t(
      "appSections.nav.groups.settingsIntelligence",
      {
        defaultValue: "Intelligence",
      },
    );
    const settingsSystem = t("appSections.nav.groups.settingsSystem", {
      defaultValue: "System",
    });

    const sectionsByRoot = {
      dictate: [
        makeSection(
          "history",
          "appSections.nav.dictate.history",
          House,
          <DictateHistorySection />,
          "blue",
        ),
        makeSection(
          "corrections",
          "appSections.nav.dictate.corrections",
          SpellCheck,
          <CorrectionsSection />,
          "teal",
        ),
        makeSection(
          "file-transcription",
          "appSections.nav.dictate.fileTranscription",
          FileAudio,
          <FileTranscriptionSection />,
          "gold",
        ),
        makeSection(
          "reader",
          "appSections.nav.dictate.reader",
          BookOpen,
          <ReaderSection />,
          "green",
          undefined,
          "Reader",
        ),
        makeSection(
          "enhance-audio",
          "appSections.nav.dictate.enhanceAudio",
          AudioWaveform,
          <EnhanceAudioSection />,
          "violet",
          undefined,
          "Enhance Audio",
        ),
      ],
      refine: [
        makeSection(
          "write-profiles",
          "appSections.nav.refine.writeProfiles",
          WandSparkles,
          <RefineProfilesSection />,
          "gold",
        ),
        makeSection(
          "phrase-keys",
          "appSections.nav.refine.phraseKeys",
          WholeWord,
          <RefinePhraseKeysSection />,
          "teal",
        ),
        makeSection(
          "translation",
          "appSections.nav.refine.translation",
          Languages,
          <RefineTranslationSection />,
          "blue",
        ),
      ],
      listen: [
        makeSection(
          "story-studio",
          "appSections.nav.listen.studio",
          BookOpen,
          <StoryStudioAppSection />,
          "green",
        ),
        makeSection(
          "voice-design",
          "appSections.nav.listen.voiceDesign",
          Paintbrush,
          <ListenVoiceDesignSection />,
          "blue",
          undefined,
          "Voice Design",
        ),
        makeSection(
          "voice-cloning",
          "appSections.nav.listen.voiceCloning",
          Dna,
          <ListenVoiceCloningSection />,
          "teal",
        ),
        makeSection(
          "voice-changer",
          "appSections.nav.listen.voiceChanger",
          SlidersHorizontal,
          <ListenVoiceChangerSection />,
          "violet",
        ),
        makeSection(
          "story-audio-history",
          "appSections.nav.listen.generatedAudio",
          FileAudio,
          <StoryAudioHistoryAppSection />,
          "gold",
        ),
      ],
      settings: [
        makeSection(
          "general",
          "appSections.nav.settings.general",
          AppWindow,
          <GeneralAppSettingsSection />,
          "accent",
          settingsBasics,
        ),
        makeSection(
          "shortcuts",
          "appSections.nav.settings.shortcuts",
          Keyboard,
          <ShortcutsSettingsSection />,
          "violet",
          settingsBasics,
        ),
        makeSection(
          "recording-devices",
          "appSections.nav.settings.recordingDevices",
          Volume2,
          <RecordingDevicesSettingsSection />,
          "blue",
          settingsBasics,
        ),
        makeSection(
          "output-paste",
          "appSections.nav.settings.outputPaste",
          SlidersHorizontal,
          <OutputPasteSettingsSection />,
          "teal",
          settingsBasics,
        ),
        makeSection(
          "corrections-settings",
          "appSections.nav.settings.correctionsSettings",
          SpellCheck,
          <CorrectionsSettingsSection />,
          "green",
          settingsIntelligence,
        ),
        makeSection(
          "ai-setup",
          "appSections.nav.settings.aiSetup",
          Cpu,
          <AISetupSettingsSection />,
          "gold",
          settingsIntelligence,
        ),
        makeSection(
          "model-testing",
          "appSections.nav.settings.modelTesting",
          FlaskConical,
          <ModelTestingSection />,
          "violet",
          settingsIntelligence,
        ),
        makeSection(
          "screen-context",
          "appSections.nav.settings.screenContext",
          Monitor,
          <ScreenContextSettingsSection />,
          "blue",
          settingsIntelligence,
        ),
        makeSection(
          "privacy",
          "appSections.nav.settings.privacy",
          Shield,
          <PrivacyStorageSettingsSection />,
          "green",
          settingsSystem,
        ),
        makeSection(
          "legal-model-terms",
          "appSections.nav.settings.legal",
          Scale,
          <LegalModelTermsSection />,
          "red",
          settingsSystem,
        ),
        makeSection(
          "automation-agents",
          "appSections.nav.settings.automationAgents",
          Bot,
          <AutomationAgentsSettingsSection />,
          "blue",
          settingsSystem,
        ),
        makeSection(
          "diagnostics",
          "appSections.nav.settings.diagnostics",
          FlaskConical,
          <DiagnosticsSettingsSection />,
          "violet",
          settingsSystem,
        ),
        makeSection(
          "about",
          "appSections.nav.settings.about",
          Info,
          <AboutSection />,
          "blue",
          settingsSystem,
        ),
      ],
    };

    return Object.fromEntries(
      Object.entries(sectionsByRoot).map(([view, sections]) => [
        view,
        sections.filter((section) =>
          isProductSectionVisible(section.id, experimentalEnabled ?? false),
        ),
      ]),
    ) as Record<RootView, ViewSection[]>;
  }, [experimentalEnabled, t]);

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

  useApplyAppearanceSettings(appTheme, appFontScale);

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
        return;
      }

      if (event.payload.error) {
        toast.error(event.payload.error);
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
        setIsResolvingPreview(false);
        setPendingPreview(event.payload);
        setPreviewDraft(event.payload.preview_text);
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const resolvePreview = useCallback(
    async (accepted: boolean) => {
      if (!pendingPreview || isResolvingPreview) {
        return;
      }

      setIsResolvingPreview(true);
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
      } finally {
        setIsResolvingPreview(false);
      }
    },
    [isResolvingPreview, pendingPreview, previewDraft, t],
  );

  const handleModalKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      handleDialogKeyDown(
        event,
        modalRef.current,
        () => void resolvePreview(false),
        { escapeDisabled: isResolvingPreview },
      );
    },
    [isResolvingPreview, resolvePreview],
  );

  useDialogFocusTrap({
    enabled: Boolean(pendingPreview),
    containerRef: modalRef,
    initialFocusSelector: "textarea, button",
  });

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
    if (isResolvingPreview) {
      return;
    }
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
  }, [isResolvingPreview, previewDraft, previewSpeakLocale]);

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
      const settingsResult = await commands.getAppSettings();
      const onboardingCompleted =
        settingsResult.status === "ok" &&
        settingsResult.data.onboarding_completed === true;
      const currentPlatform = platform();

      if (onboardingCompleted) {
        setIsReturningUser(true);

        if (currentPlatform === "macos") {
          try {
            if (isMacAppStoreBuild) {
              const hasMicrophone = await checkMicrophonePermission();
              if (!hasMicrophone) {
                await revealMainWindowForPermissions();
                setOnboardingStep("onboarding");
                return;
              }
            } else {
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
              const screenContextEnabled =
                settingsResult.status === "ok"
                  ? (settingsResult.data.screen_context_enabled ?? true)
                  : true;
              if (
                !hasAccessibility ||
                !hasMicrophone ||
                !hasInputMonitoring ||
                (screenContextEnabled && !hasScreenRecording)
              ) {
                await revealMainWindowForPermissions();
                setOnboardingStep("onboarding");
                return;
              }
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

  const handleOnboardingComplete = async () => {
    const result = await commands.setOnboardingCompleted(true);
    if (result.status !== "ok") {
      console.error("Failed to persist onboarding completion:", result.error);
    }
    setOnboardingStep("done");
  };

  const sectionsByViewRef = useRef(sectionsByView);
  useEffect(() => {
    sectionsByViewRef.current = sectionsByView;
  }, [sectionsByView]);

  const handleModeSelect = useCallback((mode: PrimaryMode) => {
    lastSectionByView.current[activeRootViewRef.current] =
      activeSectionIdRef.current;
    setActiveMode(mode);
    setActiveRootView(mode);
    const remembered = lastSectionByView.current[mode] || "";
    const nextSectionId =
      mode === "listen" ? resolveListenSectionId(remembered) : remembered;
    setActiveSectionId(
      nextSectionId || sectionsByViewRef.current[mode][0]?.id || "",
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
    const unlisten = listen<NavigateEventPayload>("navigate", (event) => {
      const payload = event.payload;
      const view = typeof payload === "string" ? payload : payload?.view;
      const section =
        typeof payload === "string" ? undefined : payload?.section || undefined;

      if (view === "settings") {
        handleSettingsOpen();
        if (section) {
          setActiveSectionId(section);
          lastSectionByView.current.settings = section;
        }
        return;
      }

      if (view === "story_studio") {
        handleModeSelect("listen");
        const resolved = section
          ? resolveListenSectionId(section)
          : "story-studio";
        setActiveSectionId(resolved);
        lastSectionByView.current.listen = resolved;
        return;
      }

      if (view === "dictate" || view === "refine" || view === "listen") {
        handleModeSelect(view);
        if (section) {
          const resolved =
            view === "listen" ? resolveListenSectionId(section) : section;
          setActiveSectionId(resolved);
          lastSectionByView.current[view] = resolved;
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleModeSelect, handleSettingsOpen]);

  useEffect(() => {
    const onSettingsNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ view: RootView; section: string }>)
        .detail;
      if (!detail) return;
      const { view, section } = detail;
      if (view === "settings") {
        handleSettingsOpen();
        if (section) {
          setActiveSectionId(section);
          lastSectionByView.current.settings = section;
        }
        return;
      }
      if (view === "dictate" || view === "refine" || view === "listen") {
        handleModeSelect(view);
        if (section) {
          const resolved =
            view === "listen" ? resolveListenSectionId(section) : section;
          setActiveSectionId(resolved);
          lastSectionByView.current[view] = resolved;
        }
      }
    };

    window.addEventListener("vox-jot:navigate", onSettingsNavigate);
    return () =>
      window.removeEventListener("vox-jot:navigate", onSettingsNavigate);
  }, [handleModeSelect, handleSettingsOpen]);

  // Resolve the currently active section to render
  const activeSection = useMemo(() => {
    const match = activeSections.find((s) => s.id === activeSectionId);
    return match ?? activeSections[0];
  }, [activeSections, activeSectionId]);

  // Keep activeSectionId in sync if it drifts behind a gated section.
  useEffect(() => {
    if (activeSection && activeSection.id !== activeSectionId) {
      setActiveSectionId(activeSection.id);
      lastSectionByView.current[activeRootView] = activeSection.id;
    }
  }, [activeRootView, activeSection, activeSectionId]);

  if (onboardingStep === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg)]">
        <div
          className="flex flex-col items-center gap-3 animate-[fadeIn_300ms_ease-out]"
          role="status"
          aria-live="polite"
        >
          <div
            className="h-8 w-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin"
            aria-hidden
          />
          <span className="sr-only">
            {t("common.loading", { defaultValue: "Loading" })}
          </span>
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
      className={`shell relative select-none cursor-default overflow-hidden font-body-token text-[var(--text)] transition-colors duration-200${sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${macTitlebarOverlay ? " shell--macos-titlebar-overlay" : ""}${modelHubVisible ? " shell--dimmed" : ""}`}
    >
      <Toaster
        theme="system"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              "flat-card rounded-xl px-4 py-3 flex items-center gap-3 text-sm",
            title: "font-semibold",
            description: "text-[var(--muted)]",
          },
        }}
      />

      {macTitlebarOverlay ? (
        <header
          className={`app-macos-titlebar-overlay${macosWindowFullscreen ? " app-macos-titlebar-overlay--fullscreen" : ""}`}
          dir="ltr"
          onMouseDown={handleWindowTitlebarMouseDown}
        >
          <div
            className="app-macos-titlebar-overlay__traffic-shim"
            aria-hidden
          />
          <div className="app-macos-titlebar-overlay__leading flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={`app-no-drag sidebar-toggle-button h-8 min-h-8 w-8 border-transparent text-[var(--text)] hover:text-[var(--accent)] ${titleBarOverlayButtonFocusClass}`}
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
              <SidebarToggleIcon
                collapsed={sidebarCollapsed}
                className="shrink-0"
              />
            </Button>
            <AppUpdateButton showLabel={!sidebarCollapsed} />
          </div>
          <div className="app-macos-titlebar-overlay__center">
            <PrimaryModeSwitcher
              activeMode={activeMode}
              onSelect={handleModeSelect}
            />
          </div>
          <div className="app-macos-titlebar-overlay__drag" aria-hidden />
          <div className="app-macos-titlebar-overlay__trailing flex items-center gap-4">
            <AccessibilityPermissions presentation="titleBar" />
          </div>
        </header>
      ) : (
        <header
          className="app-window-toolbar"
          dir="ltr"
          onMouseDown={handleWindowTitlebarMouseDown}
        >
          <div className="app-window-toolbar__sidebar-toggle app-no-drag flex items-center gap-1 ps-1 pe-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="sidebar-toggle-button h-8 min-h-8 w-8 border-transparent text-[var(--text)] hover:text-[var(--accent)]"
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
              <SidebarToggleIcon
                collapsed={sidebarCollapsed}
                className="h-5 w-5 shrink-0"
              />
            </Button>
            <AppUpdateButton showLabel={!sidebarCollapsed} />
          </div>
          <div className="app-window-toolbar__center">
            <PrimaryModeSwitcher
              activeMode={activeMode}
              onSelect={handleModeSelect}
            />
          </div>
          <div className="app-window-toolbar__drag" aria-hidden />
          <div className="flex items-center gap-4 pe-2">
            <AccessibilityPermissions presentation="titleBar" />
          </div>
        </header>
      )}

      <Sidebar
        activeSectionId={activeSectionId}
        items={activeSections}
        collapsed={sidebarCollapsed}
        settingsActive={activeRootView === "settings"}
        showStatusCards={isDesktopLayout && activeRootView !== "settings"}
        onSectionChange={handleSectionJump}
        onSettingsClick={handleSettingsOpen}
      />

      <main className="main-content relative flex min-w-0 flex-col overflow-hidden">
        <div className="app-main-scroll min-h-0 flex-1 overflow-y-scroll">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5 md:p-7">
            {activeSection && (
              <section
                id={
                  activeRootView === activeMode
                    ? `primary-mode-panel-${activeMode}`
                    : activeSection.id
                }
                className="space-y-4"
                role={activeRootView === activeMode ? "tabpanel" : undefined}
                aria-labelledby={
                  activeRootView === activeMode
                    ? `primary-mode-tab-${activeMode}`
                    : undefined
                }
              >
                <SectionHeader
                  id={activeSection.id}
                  title={activeSection.title}
                />
                <SectionErrorBoundary
                  key={activeSection.id}
                  sectionId={activeSection.id}
                  title={activeSection.title}
                >
                  <Suspense fallback={<SectionLoading />}>
                    {activeSection.content}
                  </Suspense>
                </SectionErrorBoundary>
              </section>
            )}
          </div>
        </div>

        {!isDesktopLayout && (
          <div className="mt-auto shrink-0 border-t border-[var(--border)] bg-[var(--bg)]">
            <Footer />
          </div>
        )}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-bg)] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-process-preview-title"
          aria-describedby="post-process-preview-description"
          onKeyDown={handleModalKeyDown}
          ref={modalRef}
        >
          <div className="flat-card w-full max-w-3xl rounded-2xl">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--text),transparent_86%)] px-5 py-4">
              <div>
                <h2
                  id="post-process-preview-title"
                  className="text-lg font-bold"
                >
                  {pendingPreview.origin?.startsWith("translation")
                    ? t(
                        "settings.postProcessing.preview.modal.translationTitle",
                        {
                          defaultValue: "Review Translation",
                        },
                      )
                    : t("settings.postProcessing.preview.modal.title")}
                </h2>
                <p
                  id="post-process-preview-description"
                  className="text-sm text-[var(--muted)]"
                >
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
                  disabled={isResolvingPreview}
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
                  disabled={isResolvingPreview}
                  className="inline-flex items-center gap-1"
                >
                  <Square className="h-3.5 w-3.5" />
                  {t("common.stop", { defaultValue: "Stop" })}
                </Button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="space-y-1">
                <label
                  id="post-process-preview-original-label"
                  className="block text-xs font-semibold text-[var(--text)]"
                >
                  {t("settings.postProcessing.preview.modal.originalLabel")}
                </label>
                <Textarea
                  value={pendingPreview.source_text}
                  readOnly
                  aria-labelledby="post-process-preview-original-label"
                />
              </div>

              {pendingPreview.translated_text && (
                <div className="space-y-1">
                  <label
                    id="post-process-preview-translated-label"
                    className="block text-xs font-semibold text-[var(--text)]"
                  >
                    {t(
                      "settings.postProcessing.preview.modal.translatedLabel",
                      { defaultValue: "Translated" },
                    )}
                  </label>
                  <Textarea
                    value={pendingPreview.translated_text}
                    readOnly
                    aria-labelledby="post-process-preview-translated-label"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label
                  id="post-process-preview-final-label"
                  className="block text-xs font-semibold text-[var(--text)]"
                >
                  {pendingPreview.origin?.startsWith("translation")
                    ? t(
                        "settings.postProcessing.preview.modal.finalOutputLabel",
                        { defaultValue: "Final output" },
                      )
                    : t("settings.postProcessing.preview.modal.editedLabel")}
                </label>
                <Textarea
                  value={previewDraft}
                  onChange={(event) => setPreviewDraft(event.target.value)}
                  aria-labelledby="post-process-preview-final-label"
                  disabled={isResolvingPreview}
                />
              </div>

              {pendingPreview.destination_label && (
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {`${t(
                    "settings.postProcessing.preview.modal.destinationPrefix",
                    { defaultValue: "Destination" },
                  )}: ${pendingPreview.destination_label.replace(/_/g, " ")}`}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse justify-end gap-2 border-t border-[color-mix(in_srgb,var(--text),transparent_86%)] px-5 py-4 sm:flex-row">
              <div
                className="me-auto min-h-6 text-sm font-medium text-[var(--muted)]"
                role="status"
                aria-live="polite"
              >
                {isResolvingPreview
                  ? t("settings.postProcessing.preview.modal.resolving", {
                      defaultValue: "Applying preview…",
                    })
                  : null}
              </div>
              <Button
                variant="secondary"
                onClick={() => void resolvePreview(false)}
                disabled={isResolvingPreview}
              >
                {t("settings.postProcessing.preview.modal.cancel")}
              </Button>
              <Button
                onClick={() => void resolvePreview(true)}
                disabled={isResolvingPreview}
              >
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
