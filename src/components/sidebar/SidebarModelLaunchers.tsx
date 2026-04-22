import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Mic, Sparkles, Volume2 } from "lucide-react";
import { commands } from "@/bindings";
import { useModelStore } from "@/stores/modelStore";
import { useSettingsSlice } from "@/hooks/useSettings";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import {
  MODEL_HUB_TAB_DEFS,
  type ModelHubTabId,
} from "@/components/model-hub/modelHubTabs";

export const MODEL_HUB_TAB_STORAGE_KEY = "vox-jot-model-hub-tab";
export const MODEL_HUB_SECTION_ID = "model-hub";

async function openModelHub(tab: ModelHubTabId) {
  try {
    localStorage.setItem(MODEL_HUB_TAB_STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
  try {
    await commands.showDetailView(MODEL_HUB_SECTION_ID);
  } catch (error) {
    console.warn("Failed to open model hub:", error);
  }
}

interface LauncherRowProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  ariaLabel?: string;
  variant?: "default" | "stats";
  onClick: () => void;
}

const LauncherRow: React.FC<LauncherRowProps> = ({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  ariaLabel,
  variant = "default",
  onClick,
}) => {
  const isStatsVariant = variant === "stats";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? `${label}: ${value}`}
      title={value}
      className={`flat-card group w-full rounded-2xl px-3 py-2.5 text-start transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] ${interactiveFocusRingClass} ${isStatsVariant ? "flex flex-col gap-2" : `flex items-center gap-3 ${minTapTargetHeightClass}`}`}
    >
      {isStatsVariant ? (
        <>
          <span className="flex items-center justify-between gap-2">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: iconBg, color: iconColor }}
              aria-hidden
            >
              {icon}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                {label}
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </span>
          <span className="truncate text-[13px] font-semibold leading-tight text-[var(--text)]">
            {value}
          </span>
        </>
      ) : (
        <>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: iconBg, color: iconColor }}
            aria-hidden
          >
            {icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              {label}
            </span>
            <span className="truncate text-[13px] font-semibold leading-tight text-[var(--text)]">
              {value}
            </span>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </>
      )}
    </button>
  );
};

interface SidebarModelLaunchersProps {
  variant?: "default" | "stats";
}

const SidebarModelLaunchers: React.FC<SidebarModelLaunchersProps> = ({
  variant = "default",
}) => {
  const { t } = useTranslation();
  const { models, currentModel } = useModelStore();
  const {
    post_process_provider_id: llmProviderId,
    post_process_providers: llmProviders,
    post_process_models: llmModels,
    selected_tts_model_id: selectedTtsModelId,
    selected_tts_provider_id: selectedTtsProviderId,
  } = useSettingsSlice([
    "post_process_provider_id",
    "post_process_providers",
    "post_process_models",
    "selected_tts_model_id",
    "selected_tts_provider_id",
  ] as const);

  const sttLabel = useMemo(() => {
    const match = models.find((m) => m.id === currentModel);
    return (
      match?.name ||
      currentModel ||
      t("footer.modelNotSet", { defaultValue: "Not set" })
    );
  }, [models, currentModel, t]);

  const llmLabel = useMemo(() => {
    const providerId = llmProviderId || "";
    const provider =
      llmProviders?.find((candidate) => candidate.id === providerId) || null;
    const selectedModel = llmModels?.[providerId] || "";

    if (!provider) {
      return t("footer.llmNotSet", { defaultValue: "Not set" });
    }
    if (provider.id === "apple_intelligence") {
      return "Apple Intelligence";
    }
    return (
      selectedModel || t("footer.modelNotSet", { defaultValue: "Not set" })
    );
  }, [llmModels, llmProviderId, llmProviders, t]);

  const ttsLabel = useMemo(() => {
    const modelId = selectedTtsModelId ?? selectedTtsProviderId ?? null;
    if (!modelId) {
      return t("footer.ttsModelNotSet", { defaultValue: "Not set" });
    }
    return modelId;
  }, [selectedTtsModelId, selectedTtsProviderId, t]);

  const hubTabLabel = (id: ModelHubTabId) => {
    const def = MODEL_HUB_TAB_DEFS.find((d) => d.id === id)!;
    return t(def.labelKey, { defaultValue: def.defaultLabel });
  };

  return (
    <div className="flex flex-col gap-2">
      <LauncherRow
        icon={<Mic className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--accent) 16%, transparent)"
        iconColor="var(--accent)"
        label={hubTabLabel("stt")}
        value={sttLabel}
        variant={variant}
        onClick={() => void openModelHub("stt")}
      />
      <LauncherRow
        icon={<Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--voice) 16%, transparent)"
        iconColor="var(--voice)"
        label={hubTabLabel("llm")}
        value={llmLabel}
        variant={variant}
        onClick={() => void openModelHub("llm")}
      />
      <LauncherRow
        icon={<Volume2 className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--success, #22c55e) 16%, transparent)"
        iconColor="var(--success, #22c55e)"
        label={hubTabLabel("tts")}
        value={ttsLabel}
        variant={variant}
        onClick={() => void openModelHub("tts")}
      />
    </div>
  );
};

export default SidebarModelLaunchers;
