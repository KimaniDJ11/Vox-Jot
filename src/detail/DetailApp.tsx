import React, { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { useRefreshSettings, useSettingsSlice } from "@/hooks/useSettings";
import { useApplyAppearanceSettings } from "@/hooks/useApplyAppearanceSettings";
import { SectionLoading } from "@/components/app-sections/shared";
import ModelHubSection from "@/components/model-hub/ModelHubSection";
import { useDictationEncouragementTitle } from "@/hooks/useDictationEncouragementTitle";

const DictateHistorySection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.DictateHistorySection,
  })),
);
const RefinePhraseKeysSection = lazy(() =>
  import("@/components/app-sections/refine").then((module) => ({
    default: module.RefinePhraseKeysSection,
  })),
);
const RefineProfilesSection = lazy(() =>
  import("@/components/app-sections/refine").then((module) => ({
    default: module.RefineProfilesSection,
  })),
);
const DictateModelsSection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.DictateModelsSection,
  })),
);
const RefineModelsSection = lazy(() =>
  import("@/components/app-sections/refine").then((module) => ({
    default: module.RefineModelsSection,
  })),
);
const LearnedCorrectionsSection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.LearnedCorrectionsSection,
  })),
);
const FileTranscriptionSection = lazy(() =>
  import("@/components/app-sections/dictate").then((module) => ({
    default: module.FileTranscriptionSection,
  })),
);

const HistoryEncouragementTitle: React.FC = () => {
  const title = useDictationEncouragementTitle();
  return <span className="font-bold">{title}</span>;
};

/** Map of section IDs to their title + component. */
const SECTION_MAP: Record<
  string,
  { titleKey: string; component: React.ComponentType }
> = {
  history: {
    titleKey: "appSections.nav.dictate.history",
    component: DictateHistorySection,
  },
  "phrase-keys": {
    titleKey: "appSections.nav.refine.phraseKeys",
    component: RefinePhraseKeysSection,
  },
  "write-profiles": {
    titleKey: "appSections.nav.refine.writeProfiles",
    component: RefineProfilesSection,
  },
  "stt-models": {
    titleKey: "appSections.nav.settings.aiSetup",
    component: () => (
      <DictateModelsSection titleActionTargetId="stt-models-section-actions" />
    ),
  },
  "llm-models": {
    titleKey: "appSections.nav.settings.aiSetup",
    component: RefineModelsSection,
  },
  corrections: {
    titleKey: "appSections.nav.dictate.corrections",
    component: () => (
      <LearnedCorrectionsSection titleActionTargetId="corrections-section-actions" />
    ),
  },
  "learned-corrections": {
    titleKey: "appSections.nav.dictate.corrections",
    component: () => (
      <LearnedCorrectionsSection titleActionTargetId="learned-corrections-section-actions" />
    ),
  },
  "file-transcription": {
    titleKey: "appSections.nav.dictate.fileTranscription",
    component: FileTranscriptionSection,
  },
  "model-hub": {
    titleKey: "",
    component: ModelHubSection,
  },
};

function getSectionFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const querySection = params.get("section");
  if (querySection) {
    return querySection;
  }

  const hashSection = window.location.hash.replace(/^#/, "").trim();
  return hashSection || "history";
}

const DetailApp: React.FC = () => {
  const { t } = useTranslation();
  const [sectionId, setSectionId] = useState(getSectionFromUrl);
  const { app_theme: appTheme, app_font_scale: appFontScale } =
    useSettingsSlice(["app_theme", "app_font_scale"] as const);
  const refreshSettings = useRefreshSettings();

  useApplyAppearanceSettings(appTheme, appFontScale);

  /** Detail is a separate WebView; re-fetch when focused so theme matches the main window. */
  useEffect(() => {
    const onFocus = () => {
      void refreshSettings();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshSettings]);

  useEffect(() => {
    void (async () => {
      const result = await commands.getDetailTargetSection();
      if (result.status === "ok" && result.data && SECTION_MAP[result.data]) {
        setSectionId(result.data);
      }
    })();

    // Listen for backend-driven section changes
    const unlisten = listen<string>("detail-navigate", (event) => {
      if (event.payload && SECTION_MAP[event.payload]) {
        setSectionId(event.payload);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    // Listen for backend-driven section changes
    window.history.replaceState(
      null,
      "",
      `?section=${encodeURIComponent(sectionId)}`,
    );
  }, [sectionId]);

  const entry = SECTION_MAP[sectionId];
  const entryTitle = entry?.titleKey ? t(entry.titleKey) : "";

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--muted)]">
        <p>{t("detail.unknownSection", { section: sectionId })}</p>
      </div>
    );
  }

  const SectionComponent = entry.component;

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      {/* Title bar drag region */}
      <div
        className={`flex shrink-0 items-center px-5 ${
          sectionId === "model-hub" ? "min-h-[3.25rem] py-2" : "h-12"
        }`}
        data-tauri-drag-region=""
      >
        {sectionId === "model-hub" ? (
          <div className="flex w-full min-w-0 items-center gap-3">
            <div
              id="model-hub-search-slot"
              className="app-no-drag min-w-0 flex-1"
            />
          </div>
        ) : (
          <div
            className={`flex w-full items-center gap-4 pl-16 ${
              entryTitle ? "justify-between" : "justify-end"
            }`}
          >
            {entryTitle ? (
              <h1
                className="text-sm font-bold text-[var(--text)]"
                data-tauri-drag-region=""
              >
                {sectionId === "history" ? (
                  <HistoryEncouragementTitle />
                ) : (
                  entryTitle
                )}
              </h1>
            ) : null}
            <div
              id={`${sectionId}-section-actions`}
              className="app-no-drag flex shrink-0 items-center gap-1"
            />
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <Suspense fallback={<SectionLoading />}>
          <SectionComponent />
        </Suspense>
      </div>
    </div>
  );
};

export default DetailApp;
