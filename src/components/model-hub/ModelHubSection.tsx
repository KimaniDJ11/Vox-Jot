import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import {
  DictateModelsSection,
  RefineModelsSection,
} from "@/components/AppSections";
import { EngineLibrarySection } from "@/components/settings/general/ListenSections";
import { press } from "@/motion/springs";
import { MODEL_HUB_TAB_STORAGE_KEY } from "@/components/sidebar/SidebarModelLaunchers";

type HubTab = "stt" | "llm" | "tts";

const TABS: Array<{ id: HubTab; labelKey: string; defaultLabel: string }> = [
  { id: "stt", labelKey: "modelHub.tabs.stt", defaultLabel: "Speech (STT)" },
  { id: "llm", labelKey: "modelHub.tabs.llm", defaultLabel: "Post-process (LLM)" },
  { id: "tts", labelKey: "modelHub.tabs.tts", defaultLabel: "TTS models" },
];

function readInitialTab(): HubTab {
  try {
    const stored = localStorage.getItem(MODEL_HUB_TAB_STORAGE_KEY);
    if (stored === "stt" || stored === "llm" || stored === "tts") {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "stt";
}

const ModelHubSection: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<HubTab>(readInitialTab);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MODEL_HUB_TAB_STORAGE_KEY || !event.newValue) return;
      if (
        event.newValue === "stt" ||
        event.newValue === "llm" ||
        event.newValue === "tts"
      ) {
        setActiveTab(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const placeholder = useMemo(() => {
    switch (activeTab) {
      case "stt":
        return t("modelHub.search.sttPlaceholder", {
          defaultValue: "Search speech models by name or language…",
        });
      case "llm":
        return t("modelHub.search.llmPlaceholder", {
          defaultValue: "Search post-process models by name or provider…",
        });
      case "tts":
        return t("modelHub.search.ttsPlaceholder", {
          defaultValue: "Search TTS models by name or engine…",
        });
    }
  }, [activeTab, t]);

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case "stt":
        return (
          <DictateModelsSection
            titleActionTargetId="model-hub-section-actions"
            showActiveModelBanner={false}
          />
        );
      case "llm":
        return <RefineModelsSection />;
      case "tts":
        return (
          <EngineLibrarySection
            showGroupTitle={false}
            titleActionTargetId="model-hub-section-actions"
            showActiveModelBanner={false}
          />
        );
    }
  }, [activeTab]);

  return (
    <div className="flex flex-col gap-5 pt-2">
      <label
        className="relative flex items-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-sm focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-soft)]"
        aria-label={t("modelHub.search.ariaLabel", {
          defaultValue: "Search models",
        })}
      >
        <Search
          className="me-3 h-5 w-5 shrink-0 text-[var(--muted)]"
          strokeWidth={2}
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-base text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-2">
        <LayoutGroup id="model-hub-tabs">
          <div
            role="tablist"
            className="relative inline-flex items-center gap-1 rounded-2xl border border-[var(--ring-hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_80%,transparent)] p-1"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <motion.button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  whileTap={{ scale: 0.97 }}
                  transition={press}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative px-3.5 py-1.5 text-[13px] font-semibold outline-none focus-visible:z-10"
                  style={{
                    color: isActive ? "var(--inverse-text)" : "var(--muted)",
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
                      className="absolute inset-0 rounded-xl bg-[var(--accent)]"
                      aria-hidden
                    />
                  )}
                  <span className="relative z-10">
                    {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </LayoutGroup>
      </div>

      <div className="min-w-0">{tabContent}</div>
    </div>
  );
};

export default ModelHubSection;
