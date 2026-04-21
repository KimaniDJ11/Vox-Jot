import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";
import { useRefreshSettings, useSettingsSlice } from "@/hooks/useSettings";
import {
  AppMappingsSection,
  DictateHistorySection,
  DictateModelsSection,
  JotPadSection,
  LearnedCorrectionsSection,
  RefineModelsSection,
  RefinePhraseKeysSection,
  RefineProfilesSection,
} from "@/components/AppSections";
import ModelHubSection from "@/components/model-hub/ModelHubSection";

/** Map of section IDs to their title + component. */
const SECTION_MAP: Record<string, { title: string; component: React.FC }> = {
  history: {
    title: "History",
    component: DictateHistorySection,
  },
  "phrase-keys": {
    title: "Phrase Keys",
    component: RefinePhraseKeysSection,
  },
  "write-profiles": {
    title: "Write Profiles",
    component: RefineProfilesSection,
  },
  "app-mappings": {
    title: "App Mappings",
    component: AppMappingsSection,
  },
  "stt-models": {
    title: "Speech Models",
    component: () => (
      <DictateModelsSection titleActionTargetId="stt-models-section-actions" />
    ),
  },
  "llm-models": {
    title: "Refine Models",
    component: RefineModelsSection,
  },
  corrections: {
    title: "Learned Corrections",
    component: () => (
      <LearnedCorrectionsSection titleActionTargetId="corrections-section-actions" />
    ),
  },
  "learned-corrections": {
    title: "Learned Corrections",
    component: () => (
      <LearnedCorrectionsSection titleActionTargetId="learned-corrections-section-actions" />
    ),
  },
  "jot-pad": {
    title: "Jot Pad",
    component: JotPadSection,
  },
  "model-hub": {
    title: "",
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
  const [sectionId, setSectionId] = useState(getSectionFromUrl);
  const { app_theme: appTheme } = useSettingsSlice(["app_theme"] as const);
  const refreshSettings = useRefreshSettings();

  useEffect(() => {
    const theme = appTheme ?? "system";
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [appTheme]);

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

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--muted)]">
        <p>{`Unknown section: ${sectionId}`}</p>
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
              entry.title ? "justify-between" : "justify-end"
            }`}
          >
            {entry.title ? (
              <h1
                className="text-sm font-bold text-[var(--text)]"
                data-tauri-drag-region=""
              >
                {entry.title}
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
        <SectionComponent />
      </div>
    </div>
  );
};

export default DetailApp;
