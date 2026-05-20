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
import { RefineModelsSection } from "@/components/app-sections/refine";
import { EngineLibrarySection } from "@/components/settings/general/ListenSections";
import OcrEnginesSection from "@/components/model-hub/OcrEnginesSection";
import SpeechAnalysisEnginesSection from "@/components/model-hub/SpeechAnalysisEnginesSection";
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

function isModelHubTabId(value: string | null): value is ModelHubTabId {
  return ALL_TABS.some((tab) => tab.id === value);
}

function isModelHubScope(value: string | null): value is ModelHubScope {
  return value === "all" || value === "analysis";
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
  const [controlValuesByScope, setControlValuesByScope] =
    useState<ScopedModelHubControlValues>(() => ({
      stt: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.stt },
      llm: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.llm },
      tts: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.tts },
      ocr: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.ocr },
      analysis: { ...DEFAULT_SCOPED_MODEL_HUB_CONTROL_VALUES.analysis },
    }));
  const searchPortalTarget = usePortalTarget(MODEL_HUB_SEARCH_SLOT_ID);
  const visibleTab = scope === "analysis" ? "analysis" : activeTab;
  const controlScope = getControlScope(visibleTab);

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
      setProviderFilter: (value) =>
        setControlValue(controlScope, "providerFilter", value),
      setLanguageFilter: (value) =>
        setControlValue(controlScope, "languageFilter", value),
      setSortMode: (value: ModelSortMode) =>
        setControlValue(controlScope, "sortMode", value),
    }),
    [controlScope, controlValuesByScope, setControlValue],
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
    scope === "analysis"
      ? ALL_TABS.filter((tab) => tab.id === "analysis")
      : ALL_TABS;

  useEffect(() => {
    if (scope === "analysis" && activeTab !== "analysis") {
      setActiveTab("analysis");
    }
  }, [activeTab, scope]);

  useEffect(() => {
    if (visibleTab !== "analysis") {
      setAnalysisTabLabelOverride(null);
    }
  }, [visibleTab]);

  const searchPlaceholder = t("modelHub.search.globalPlaceholder", {
    defaultValue: "Search models by name, language, or provider…",
  });

  const searchField = (
    <label className="relative flex h-10 w-full min-w-0 items-center rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 shadow-sm focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-soft)]">
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

  const renderTabPanel = (tabId: ModelHubTabId) => {
    const isActive = visibleTab === tabId;
    const titleActionTargetId = isActive
      ? "model-hub-section-actions"
      : undefined;
    const activeModelHubControls = isActive ? modelHubControls : undefined;
    const commonSectionProps = {
      titleActionTargetId,
      hubSearchQuery: query,
      modelHubControls: activeModelHubControls,
      hubFilterLabels: true,
    };

    let content: React.ReactNode = null;
    if (tabId === "analysis") {
      content = (
        <SpeechAnalysisEnginesSection
          titleActionTargetId={titleActionTargetId}
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
    } else if (tabId === "ocr") {
      content = <OcrEnginesSection {...commonSectionProps} />;
    }

    return (
      <div
        key={tabId}
        id={`model-hub-panel-${tabId}`}
        role="tabpanel"
        aria-labelledby={`model-hub-tab-${tabId}`}
        hidden={!isActive}
        className="min-w-0 flex-1 pt-3"
      >
        {content}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 pt-2">
      {searchPortalTarget
        ? createPortal(searchField, searchPortalTarget)
        : null}

      <div className="flex min-h-0 flex-col">
        <div
          data-model-hub-sticky-header=""
          className="sticky top-0 z-20 -mx-5 border-b border-[var(--border)] bg-[var(--bg)] px-5 pb-3 pt-0"
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              {scope === "analysis" ? (
                <h2
                  id="model-hub-tab-analysis"
                  className="text-sm font-semibold text-[var(--text)]"
                >
                  {analysisTabLabelOverride ??
                    t("modelHub.tabs.analysis", {
                      defaultValue: "Speech Analysis",
                    })}
                </h2>
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
                    className="relative inline-flex items-center gap-1 rounded-xl border border-[var(--ring-hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_80%,transparent)] p-0.5"
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
                          className={`relative whitespace-nowrap px-3 py-1.5 text-xs font-semibold focus-visible:z-10 ${interactiveFocusRingClass} ${minTapTargetHeightClass}`}
                          style={{
                            color: isActive
                              ? "var(--accent-foreground)"
                              : "var(--muted)",
                            transition: "color 160ms var(--spring-crisp)",
                          }}
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
                              className="absolute inset-0 rounded-[10px] bg-[var(--accent)]"
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
            {/* STT/TTS: Provider + Language filters (inline with tabs); LLM: empty */}
            <div
              id="model-hub-section-actions"
              className="app-no-drag flex shrink-0 items-center justify-end gap-2"
            />
          </div>
        </div>

        {tabs.map((tab) => renderTabPanel(tab.id))}
      </div>
    </div>
  );
};

export default ModelHubSection;
