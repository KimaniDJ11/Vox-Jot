import { useEffect, useState, useRef } from "react";
import { toast, Toaster } from "sonner";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { ModelStateEvent } from "./lib/types/events";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import Footer from "./components/footer";
import { OnboardingWizard } from "./components/onboarding";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { Button } from "./components/ui/Button";
import { Textarea } from "./components/ui/Textarea";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";

type OnboardingStep = "onboarding" | "done";
type PostProcessPreviewRequest = {
  request_id: string;
  source_text: string;
  preview_text: string;
};

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;
  return <ActiveComponent />;
};

function App() {
  const { t, i18n } = useTranslation();
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  // Track if this is a returning user who just needs to grant permissions
  // (vs a new user who needs full onboarding including model selection)
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("general");
  const [pendingPreview, setPendingPreview] =
    useState<PostProcessPreviewRequest | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const { settings, updateSetting } = useSettings();
  const direction = getLanguageDirection(i18n.language);
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const hasCompletedPostOnboardingInit = useRef(false);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // Initialize RTL direction when language changes
  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

  // Keep UI in light mode by default to avoid high-contrast dark surfaces.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  // Initialize Enigo, shortcuts, and refresh audio devices when main app loads
  useEffect(() => {
    if (onboardingStep === "done" && !hasCompletedPostOnboardingInit.current) {
      hasCompletedPostOnboardingInit.current = true;
      Promise.all([
        commands.initializeEnigo(),
        commands.initializeShortcuts(),
      ]).catch((e) => {
        console.warn("Failed to initialize:", e);
      });
      refreshAudioDevices();
      refreshOutputDevices();
    }
  }, [onboardingStep, refreshAudioDevices, refreshOutputDevices]);

  // Handle keyboard shortcuts for debug mode toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+Shift+D (Windows/Linux) or Cmd+Shift+D (macOS)
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        updateSetting("debug_mode", !currentDebugMode);
      }
    };

    // Add event listener when component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

  // Listen for recording errors from the backend and show a toast
  useEffect(() => {
    const unlisten = listen<string>("recording-error", (event) => {
      toast.error(t("errors.recordingFailed", { error: event.payload }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for model loading failures and show a toast
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

  const revealMainWindowForPermissions = async () => {
    try {
      await commands.showMainWindowCommand();
    } catch (e) {
      console.warn("Failed to show main window for permission onboarding:", e);
    }
  };

  const checkOnboardingStatus = async () => {
    try {
      // Check if they have any models available
      const result = await commands.hasAnyModelsAvailable();
      const hasModels = result.status === "ok" && result.data;
      const currentPlatform = platform();

      if (hasModels) {
        // Returning user - check if they need to grant permissions first
        setIsReturningUser(true);

        if (currentPlatform === "macos") {
          try {
            const [hasAccessibility, hasMicrophone] = await Promise.all([
              checkAccessibilityPermission(),
              checkMicrophonePermission(),
            ]);
            if (!hasAccessibility || !hasMicrophone) {
              await revealMainWindowForPermissions();
              setOnboardingStep("onboarding");
              return;
            }
          } catch (e) {
            console.warn("Failed to check macOS permissions:", e);
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
          } catch (e) {
            console.warn("Failed to check Windows microphone permissions:", e);
          }
        }

        setOnboardingStep("done");
      } else {
        // New user - start full onboarding wizard
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

  // Still checking onboarding status
  if (onboardingStep === null) {
    return null;
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
      dir="ltr"
      className="shell relative select-none cursor-default overflow-hidden font-[var(--font-body)] text-[var(--text)] bg-[var(--bg)] transition-colors duration-200"
    >
      <Toaster
        theme="light"
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
      {/* Invisible draggable titlebar for macOS traffic lights overlay */}
      <div data-tauri-drag-region className="app-titlebar" />

      {/* Main content grid area */}
      <Sidebar
        activeSection={currentSection}
        onSectionChange={setCurrentSection}
      />
      {/* Scrollable content area */}
      <main className="main-content relative flex flex-col min-w-0 overflow-hidden bg-[var(--bg)]">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl p-6 md:p-8">
            <AccessibilityPermissions />
            {renderSettingsContent(currentSection)}
          </div>
        </div>

        {/* Fixed footer sticks to bottom of main-content */}
        <div className="mt-auto shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-2 py-3 md:px-6">
          <Footer />
        </div>
      </main>

      {pendingPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-bg,rgba(4,10,20,0.85))] p-4">
          <div className="flat-card w-full max-w-3xl rounded-2xl">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--color-text),transparent_86%)] px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {t("settings.postProcessing.preview.modal.title")}
                </h2>
                <p className="text-sm text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
                  {t("settings.postProcessing.preview.modal.description")}
                </p>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="space-y-1">
                <div className="text-xs font-medium text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
                  {t("settings.postProcessing.preview.modal.originalLabel")}
                </div>
                <Textarea value={pendingPreview.source_text} readOnly />
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
                  {t("settings.postProcessing.preview.modal.editedLabel")}
                </div>
                <Textarea
                  value={previewDraft}
                  onChange={(event) => setPreviewDraft(event.target.value)}
                />
              </div>
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
