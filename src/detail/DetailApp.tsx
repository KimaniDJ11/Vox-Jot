import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CorrectionsSection,
  DictateHistorySection,
  DictateModelsSection,
  JotPadSection,
  RefineModelsSection,
  RefinePhraseKeysSection,
  RefineProfilesSection,
} from "@/components/AppSections";

/** Map of section IDs to their title + component. */
const SECTION_MAP: Record<string, { title: string; component: React.FC }> = {
  history: {
    title: "History",
    component: () => <DictateHistorySection capped={false} />,
  },
  "phrase-keys": {
    title: "Phrase Keys",
    component: () => <RefinePhraseKeysSection capped={false} />,
  },
  "write-profiles": {
    title: "Write Profiles",
    component: () => <RefineProfilesSection capped={false} />,
  },
  "stt-models": {
    title: "Speech Models",
    component: () => <DictateModelsSection capped={false} />,
  },
  "llm-models": {
    title: "Refine Models",
    component: () => <RefineModelsSection capped={false} />,
  },
  corrections: {
    title: "Learned Corrections",
    component: () => <CorrectionsSection capped={false} />,
  },
  "jot-pad": {
    title: "Jot Pad",
    component: () => <JotPadSection capped={false} />,
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

  useEffect(() => {
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

  const entry = SECTION_MAP[sectionId];

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--muted)]">
        <p>Unknown section: {sectionId}</p>
      </div>
    );
  }

  const SectionComponent = entry.component;

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      {/* Title bar drag region */}
      <div
        className="flex h-12 shrink-0 items-center px-5"
        data-tauri-drag-region=""
      >
        <h1
          className="text-sm font-semibold text-[var(--text)] pl-16"
          data-tauri-drag-region=""
        >
          {entry.title}
        </h1>
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <SectionComponent />
      </div>
    </div>
  );
};

export default DetailApp;
