import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import { DictateModelsSection } from "@/components/app-sections/dictate";
import { SectionLoading } from "@/components/app-sections/shared";
import { EngineLibrarySection } from "@/components/settings/general/ListenSections";
import OcrEnginesSection from "@/components/model-hub/OcrEnginesSection";
import SpeechAnalysisEnginesSection from "@/components/model-hub/SpeechAnalysisEnginesSection";
import CreativeAudioEnginesSection from "@/components/model-hub/CreativeAudioEnginesSection";
import AudioCleanupEnginesSection from "@/components/model-hub/AudioCleanupEnginesSection";
import { handleHorizontalTabListKeyDown } from "@/lib/ui/tabKeyboard";
import { press } from "@/motion/springs";
import {
  MODEL_HUB_TAB_DEFS,
  MODEL_HUB_SCOPE_STORAGE_KEY,
  MODEL_HUB_TAB_STORAGE_KEY,
  type ModelHubScope,
  type ModelHubTabId,
} from "@/components/model-hub/modelHubTabs";
import {
  DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES,
  type ModelHubControlState,
  type ModelHubControlScope,
  type ScopedModelHubControlValues,
} from "@/components/model-hub/modelHubControls";
import type { ModelSortMode } from "@/lib/modelListOrdering";

const ALL_TABS = MODEL_HUB_TAB_DEFS;
const RefineModelsSection = React.lazy(() =>
  import("@/components/app-sections/refine").then((module) => ({
    default: module.RefineModelsSection,
  })),
);

function isModelHubTabId(value: string | null): value is ModelHubTabId {
  return ALL_TABS.some((tab) => tab.id === value);
}

function isModelHubScope(value: string | null): value is ModelHubScope {
  return (
    value === "all" ||
    value === "analysis" ||
    value === "creative_audio" ||
    value === "audio_cleanup"
  );
}

function readInitialScope(): ModelHubScope {
  try {
    const stored = localStorage.getItem(MODEL_HUB_SCOPE_STORAGE_KEY);
    if (isModelHubScope(stored)) {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "all";
}

function readInitialTab(): ModelHubTabId {
  try {
    const stored = localStorage.getItem(MODEL_HUB_TAB_STORAGE_KEY);
    if (isModelHubTabId(stored)) {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "stt";
}

const MODEL_HUB_SEARCH_SLOT_ID = "model-hub-search-slot";
const MODEL_HUB_ANALYSIS_TITLE_SLOT_ID = "model-hub-analysis-title-slot";

function getControlScope(tab: ModelHubTabId): ModelHubControlScope {
  return tab;
}

type ModelHubControlValueKey =
  keyof ScopedModelHubControlValues[ModelHubControlScope];

const ModelHubSection: React.FC = () => {
  const { t } = useTranslation();
  const [scope, setScope] = useState<ModelHubScope>(readInitialScope);
  const [activeTab, setActiveTab] = useState<ModelHubTabId>(readInitialTab);
  const [query, setQuery] = useState("");
  const [analysisTabLabelOverride, setAnalysisTabLabelOverride] = useState<
    string | null
  >(null);
  const [sortMode, setSortMode] = useState<ModelSortMode>("best_match");
  const [controlValuesByScope, setControlValuesByScope] =
    useState<ScopedModelHubControlValues>(() => ({
      stt: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.stt },
      llm: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.llm },
      tts: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.tts },
      creative_audio: {
        ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.creative_audio,
      },
      audio_cleanup: {
        ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.audio_cleanup,
      },
      ocr: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.ocr },
      analysis: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.analysis },
    }));
  const searchPortalTarget = usePortalTarget(MODEL_HUB_SEARCH_SLOT_ID);
  const visibleTab = scope === "all" ? activeTab : scope;
  const [visitedTabs, setVisitedTabs] = useState<Set<ModelHubTabId>>(
    () => new Set([visibleTab]),
  );
  const controlScope = getControlScope(visibleTab);
  const showCategoryHeader = scope === "all" || scope === "analysis";

  const setControlValue = useCallback(
    <K extends ModelHubControlValueKey>(
      scopeKey: ModelHubControlScope,
      key: K,
      value: ScopedModelHubControlValues[ModelHubControlScope][K],
    ) => {
      setControlValuesByScope((current) => ({
        ...current,
        [scopeKey]: {
          ...current[scopeKey],
          [key]: value,
        },
      }));
    },
    [],
  );

  const modelHubControls: ModelHubControlState = useMemo(
    () => ({
      ...controlValuesByScope[controlScope],
      sortMode,
      setProviderFilter: (value: string) =>
        setControlValue(controlScope, "providerFilter", value),
      setLanguageFilter: (value: string) =>
        setControlValue(controlScope, "languageFilter", value),
      setSortMode,
    }),
    [controlScope, controlValuesByScope, setControlValue, sortMode],
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === MODEL_HUB_SCOPE_STORAGE_KEY) {
        setScope(isModelHubScope(event.newValue) ? event.newValue : "all");
        return;
      }

      if (event.key === MODEL_HUB_TAB_STORAGE_KEY && event.newValue) {
        if (!isModelHubTabId(event.newValue)) return;
        setActiveTab(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const tabs =
    scope === "all" ? ALL_TABS : ALL_TABS.filter((tab) => tab.id === scope);

  useEffect(() => {
    if (scope !== "all" && activeTab !== scope) {
      setActiveTab(scope);
    }
  }, [activeTab, scope]);

  useEffect(() => {
    if (visibleTab !== "analysis") {
      setAnalysisTabLabelOverride(null);
    }
  }, [visibleTab]);

  useEffect(() => {
    setVisitedTabs((current) => {
      if (current.has(visibleTab)) return current;
      const next = new Set(current);
      next.add(visibleTab);
      return next;
    });
  }, [visibleTab]);

  const searchPlaceholder = t("modelHub.search.globalPlaceholder", {
    defaultValue: "Search models by name, language, or provider…",
  });

  const searchField = (
    <label className="relative flex h-10 min-w-[220px] flex-1 items-center rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 shadow-sm focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-soft)]">
      <Search
        className="me-2 h-4 w-4 shrink-0 text-[var(--muted)]"
        strokeWidth={2}
        aria-hidden
      />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchPlaceholder}
        aria-label={t("modelHub.search.ariaLabel", {
          defaultValue: "Search models",
        })}
        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none"
      />
    </label>
  );
  // The `#model-hub-section-actions` portal target lives in the detail-view
  // title bar (DetailApp) so it exists from first paint and is never torn down.
  // Keeping it here would relocate it when this toolbar moves from its inline
  // fallback into the search slot, leaving section filter controls portaled
  // into a detached node until the user switched category tabs.
  const modelHubToolbar = (
    <div className="app-no-drag flex w-full min-w-0 items-center gap-2">
      {searchField}
    </div>
  );

  const renderTabPanel = (tabId: ModelHubTabId) => {
    const isActive = visibleTab === tabId;
    const shouldRenderContent = isActive || visitedTabs.has(tabId);
    const titleActionTargetId = isActive
      ? "model-hub-section-actions"
      : undefined;
    const titleContentTargetId =
      isActive && scope === "analysis" && tabId === "analysis"
        ? MODEL_HUB_ANALYSIS_TITLE_SLOT_ID
        : undefined;
    const activeModelHubControls = isActive ? modelHubControls : undefined;
    const commonSectionProps = {
      titleActionTargetId,
      hubSearchQuery: query,
      modelHubControls: activeModelHubControls,
      hubFilterLabels: true,
    };

    let content: React.ReactNode = null;
    if (!shouldRenderContent) {
      content = null;
    } else if (tabId === "analysis") {
      content = (
        <SpeechAnalysisEnginesSection
          titleActionTargetId={titleActionTargetId}
          titleContentTargetId={titleContentTargetId}
          hubSearchQuery={query}
          modelHubControls={activeModelHubControls}
          onHeaderTitleChange={setAnalysisTabLabelOverride}
        />
      );
    } else if (tabId === "stt") {
      content = (
        <DictateModelsSection
          {...commonSectionProps}
          showActiveModelBanner={false}
        />
      );
    } else if (tabId === "llm") {
      content = (
        <RefineModelsSection
          titleActionTargetId={titleActionTargetId}
          hubSearchQuery={query}
          onHubSearchQueryChange={setQuery}
          modelHubControls={activeModelHubControls}
          hubFilterLabels
          showEvaluationPanel={false}
        />
      );
    } else if (tabId === "tts") {
      content = (
        <EngineLibrarySection
          {...commonSectionProps}
          showGroupTitle={false}
          showActiveModelBanner={false}
        />
      );
    } else if (tabId === "creative_audio") {
      content = <CreativeAudioEnginesSection {...commonSectionProps} />;
    } else if (tabId === "audio_cleanup") {
      content = <AudioCleanupEnginesSection {...commonSectionProps} />;
    } else if (tabId === "ocr") {
      content = <OcrEnginesSection {...commonSectionProps} />;
    }

    return (
      <div
        key={tabId}
        id={`model-hub-panel-${tabId}`}
        role="tabpanel"
        aria-labelledby={
          scope === "all" || scope === "analysis"
            ? `model-hub-tab-${tabId}`
            : undefined
        }
        aria-label={
          scope !== "all" && scope !== "analysis" && tabId === scope
            ? t(
                ALL_TABS.find((tab) => tab.id === tabId)?.labelKey ??
                  "modelHub.tabs.stt",
                {
                  defaultValue:
                    ALL_TABS.find((tab) => tab.id === tabId)?.defaultLabel ??
                    "Model Hub",
                },
              )
            : undefined
        }
        hidden={!isActive}
        className="min-w-0 flex-1 pt-3"
      >
        <React.Suspense fallback={<SectionLoading />}>{content}</React.Suspense>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 pt-2">
      {searchPortalTarget
        ? createPortal(modelHubToolbar, searchPortalTarget)
        : modelHubToolbar}

      <div className="flex min-h-0 flex-col">
        {showCategoryHeader ? (
          <div
            data-model-hub-sticky-header=""
            className="sticky top-0 z-20 -mx-5 px-5 pb-3 pt-0"
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                {scope === "analysis" ? (
                  <div
                    id="model-hub-tab-analysis"
                    aria-label={t("modelHub.tabs.analysis", {
                      defaultValue: "Speech Analysis",
                    })}
                    className="app-no-drag flex min-w-0 items-center"
                  >
                    <div id={MODEL_HUB_ANALYSIS_TITLE_SLOT_ID} />
                  </div>
                ) : (
                  <LayoutGroup id="model-hub-tabs">
                    <div
                      role="tablist"
                      aria-label={t("modelHub.tabs.ariaLabel", {
                        defaultValue: "Model categories",
                      })}
                      onKeyDown={(event) =>
                        handleHorizontalTabListKeyDown(event, {
                          direction: document.dir === "rtl" ? "rtl" : "ltr",
                        })
                      }
                      className="relative inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--accent),transparent_72%)] bg-[var(--panel-bg)] p-0.5 shadow-[var(--segmented-control-shadow)]"
                    >
                      {tabs.map((tab) => {
                        const isActive = visibleTab === tab.id;
                        return (
                          <motion.button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-controls={`model-hub-panel-${tab.id}`}
                            id={`model-hub-tab-${tab.id}`}
                            tabIndex={isActive ? 0 : -1}
                            whileTap={{ scale: 0.97 }}
                            transition={press}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative isolate whitespace-nowrap rounded-full border border-transparent px-3 py-2 text-xs font-bold ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
                              isActive
                                ? "text-[var(--accent-foreground)]"
                                : "text-[var(--text)] hover:text-[var(--accent)]"
                            }`}
                          >
                            {isActive && (
                              <motion.span
                                layoutId="model-hub-tab-indicator"
                                transition={{
                                  type: "spring",
                                  stiffness: 400,
                                  damping: 32,
                                  mass: 0.9,
                                }}
                                className="absolute inset-0 rounded-full bg-[var(--accent)] shadow-[var(--primary-control-highlight)]"
                                aria-hidden
                              />
                            )}
                            <span className="relative z-10">
                              {tab.id === "analysis" &&
                              isActive &&
                              analysisTabLabelOverride
                                ? analysisTabLabelOverride
                                : t(tab.labelKey, {
                                    defaultValue: tab.defaultLabel,
                                  })}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </LayoutGroup>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {tabs.map((tab) => renderTabPanel(tab.id))}
      </div>
    </div>
  );
};

export default ModelHubSection;
