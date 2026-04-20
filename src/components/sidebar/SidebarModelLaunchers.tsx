import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Mic, Sparkles, Volume2 } from "lucide-react";
import { commands } from "@/bindings";
import { useModelStore } from "@/stores/modelStore";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";

export const MODEL_HUB_TAB_STORAGE_KEY = "vox-jot-model-hub-tab";
export const MODEL_HUB_SECTION_ID = "model-hub";

type HubTab = "stt" | "llm" | "tts";

async function openModelHub(tab: HubTab) {
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
  onClick: () => void;
}

const LauncherRow: React.FC<LauncherRowProps> = ({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  ariaLabel,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel ?? `${label}: ${value}`}
    title={value}
    className={`flat-card group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] ${interactiveFocusRingClass} ${minTapTargetHeightClass}`}
  >
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: iconBg, color: iconColor }}
      aria-hidden
    >
      {icon}
    </span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
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
  </button>
);

const SidebarModelLaunchers: React.FC = () => {
  const { t } = useTranslation();
  const { models, currentModel } = useModelStore();
  const { getSetting } = useSettings();
  const ttsSettings = useSettingsStore((state) => state.settings);

  const sttLabel = useMemo(() => {
    const match = models.find((m) => m.id === currentModel);
    return (
      match?.name ||
      currentModel ||
      t("footer.modelNotSet", { defaultValue: "Not set" })
    );
  }, [models, currentModel, t]);

  const llmLabel = useMemo(() => {
    const providerId = getSetting("post_process_provider_id") || "";
    const providers = getSetting("post_process_providers") ?? [];
    const provider = providers.find((p) => p.id === providerId) || null;
    const models = getSetting("post_process_models") ?? {};
    const selectedModel = models[providerId] || "";

    if (!provider) {
      return t("footer.llmNotSet", { defaultValue: "Not set" });
    }
    if (provider.id === "apple_intelligence") {
      return "Apple Intelligence";
    }
    return (
      selectedModel || t("footer.modelNotSet", { defaultValue: "Not set" })
    );
  }, [getSetting, t]);

  const ttsLabel = useMemo(() => {
    const modelId =
      ttsSettings?.selected_tts_model_id ??
      ttsSettings?.selected_tts_provider_id ??
      null;
    if (!modelId) {
      return t("footer.ttsModelNotSet", { defaultValue: "Not set" });
    }
    return modelId;
  }, [ttsSettings, t]);

  return (
    <div className="flex flex-col gap-2">
      <LauncherRow
        icon={<Mic className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--accent) 16%, transparent)"
        iconColor="var(--accent)"
        label={t("sidebar.launchers.stt", { defaultValue: "Speech model" })}
        value={sttLabel}
        onClick={() => void openModelHub("stt")}
      />
      <LauncherRow
        icon={<Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--voice) 16%, transparent)"
        iconColor="var(--voice)"
        label={t("sidebar.launchers.llm", { defaultValue: "LLM" })}
        value={llmLabel}
        onClick={() => void openModelHub("llm")}
      />
      <LauncherRow
        icon={<Volume2 className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--success, #22c55e) 16%, transparent)"
        iconColor="var(--success, #22c55e)"
        label={t("sidebar.launchers.tts", { defaultValue: "TTS" })}
        value={ttsLabel}
        onClick={() => void openModelHub("tts")}
      />
    </div>
  );
};

export default SidebarModelLaunchers;
