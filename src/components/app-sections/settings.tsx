import React, { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  ArrowRight,
  Bot,
  BookOpen,
  CheckCircle2,
  Cloud,
  Clipboard,
  Cpu,
  ExternalLink,
  FileAudio,
  FileText,
  FlaskConical,
  HardDrive,
  Headphones,
  Info,
  Keyboard,
  Languages,
  Layers,
  Mic,
  Monitor,
  Palette,
  Settings as SettingsIcon,
  Scale,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SpellCheck,
  Type,
  Volume2,
  WandSparkles,
  Waves,
  Wifi,
  XCircle,
} from "lucide-react";

import { commands } from "@/bindings";
import { useDictationReadiness } from "@/hooks/useDictationReadiness";
import { useSettings, useSettingsSlice } from "@/hooks/useSettings";
import { isMacAppStoreBuild } from "@/lib/distribution";
import { openModelHub } from "@/components/model-hub/modelHubTabs";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Dropdown,
  SettingContainer,
  SettingsGroup,
  Slider,
  Textarea,
  ToggleSwitch,
} from "@/components/ui";
import { AlwaysOnMicrophone } from "@/components/settings/AlwaysOnMicrophone";
import { AppendTrailingSpace } from "@/components/settings/AppendTrailingSpace";
import { AppDataDirectory } from "@/components/settings/AppDataDirectory";
import { AppFontScale } from "@/components/settings/AppFontScale";
import { AppLanguageSelector } from "@/components/settings/AppLanguageSelector";
import { AudioDucking } from "@/components/settings/AudioDucking";
import { AudioEnhancement } from "@/components/settings/AudioEnhancement";
import { AudioFeedback } from "@/components/settings/AudioFeedback";
import { AutoSubmit } from "@/components/settings/AutoSubmit";
import { AutostartToggle } from "@/components/settings/AutostartToggle";
import { ClamshellMicrophoneSelector } from "@/components/settings/ClamshellMicrophoneSelector";
import { ClipboardHandlingSetting } from "@/components/settings/ClipboardHandling";
import { CorrectionSettings } from "@/components/settings/corrections/CorrectionSettings";
import { ExperimentalToggle } from "@/components/settings/ExperimentalToggle";
import { FeatureHealthCheckPanel } from "@/components/settings/FeatureHealthCheck";
import { GlobalLanguageSync } from "@/components/settings/GlobalLanguageSync";
import { HistoryLimit } from "@/components/settings/HistoryLimit";
import { LanguageSelector } from "@/components/settings/LanguageSelector";
import { LocalApiToggle } from "@/components/settings/LocalApiToggle";
import { MicrophoneSelector } from "@/components/settings/MicrophoneSelector";
import { ModelUnloadTimeoutSetting } from "@/components/settings/ModelUnloadTimeout";
import { MuteWhileRecording } from "@/components/settings/MuteWhileRecording";
import { OutputDeviceSelector } from "@/components/settings/OutputDeviceSelector";
import { PasteMethodSetting } from "@/components/settings/PasteMethod";
import { PhraseKeysEnabledToggle } from "@/components/settings/PhraseKeysEnabledToggle";
import { PostProcessingSettings } from "@/components/settings/post-processing/PostProcessingSettings";
import { PushToTalk } from "@/components/settings/PushToTalk";
import { RecordingRetentionPeriodSelector } from "@/components/settings/RecordingRetentionPeriod";
import RefineModelsSettings from "@/components/settings/llm/RefineModelsSettings";
import { ShortcutInput } from "@/components/settings/ShortcutInput";
import { ShowOverlay } from "@/components/settings/ShowOverlay";
import { ShowTrayIcon } from "@/components/settings/ShowTrayIcon";
import { SoundPicker } from "@/components/settings/SoundPicker";
import { SpeechOutputToggle } from "@/components/settings/SpeechOutputToggle";
import { StartHidden } from "@/components/settings/StartHidden";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import { TypingToolSetting } from "@/components/settings/TypingTool";
import { UpdateChecksToggle } from "@/components/settings/UpdateChecksToggle";
import { VolumeSlider } from "@/components/settings/VolumeSlider";
import UpdateChecker from "@/components/update-checker";
import VoxJotTextLogo from "@/components/icons/VoxJotTextLogo";
import { subtleCardClassName } from "@/components/app-sections/shared";
import {
  BoardList,
  CrossLinkCard,
  MetricTile,
  PreviewSlate,
  SectionHero,
} from "@/components/app-sections/settings-shared";

/* ─────────────────────────────────────────────────────────────────────────────
 * Shared atoms
 * ─────────────────────────────────────────────────────────────────────────── */

const MiniStatusPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "success" | "warning" | "info";
}> = ({ icon, label, tone = "default" }) => {
  const toneClass =
    tone === "success"
      ? "border-[color-mix(in_srgb,var(--success),transparent_72%)] bg-[var(--success-soft)] text-[var(--success)]"
      : tone === "warning"
        ? "border-[color-mix(in_srgb,var(--warning),transparent_72%)] bg-[var(--warning-soft)] text-[var(--warning)]"
        : tone === "info"
          ? "border-[color-mix(in_srgb,var(--info),transparent_72%)] bg-[var(--info-soft)] text-[var(--info)]"
          : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--muted)]";

  return (
    <span
      className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${toneClass}`}
    >
      {icon}
      {label}
    </span>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: App & Dictation
 * ─────────────────────────────────────────────────────────────────────────── */

const themeLabel = (
  theme: string,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  switch (theme) {
    case "light":
      return t("settings.advanced.theme.options.light");
    case "dark":
      return t("settings.advanced.theme.options.dark");
    case "sepia":
      return t("settings.advanced.theme.options.sepia");
    case "ocean":
      return t("settings.advanced.theme.options.ocean");
    case "forest":
      return t("settings.advanced.theme.options.forest");
    case "rose":
      return t("settings.advanced.theme.options.rose");
    case "slate":
      return t("settings.advanced.theme.options.slate");
    case "solarized":
      return t("settings.advanced.theme.options.solarized");
    case "graphite":
      return t("settings.advanced.theme.options.graphite");
    case "system":
      return t("settings.advanced.theme.options.system");
    default:
      return theme;
  }
};

const GeneralHero: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const theme = (getSetting("app_theme") ?? "system") as string;
  const fontScale = (getSetting("app_font_scale") ?? 1) as number;
  const selectedLanguage = (getSetting("selected_language") ??
    "auto") as string;

  return (
    <SectionHero
      icon={<AppWindow className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.general.eyebrow")}
      title={t("appSections.hero.general.title")}
      description={t("appSections.hero.general.description")}
      tone="accent"
      stats={[
        {
          label: t("appSections.hero.general.themeStat"),
          value: themeLabel(theme, t),
        },
        {
          label: t("appSections.hero.general.fontStat"),
          value: `${Math.round(fontScale * 100)}%`,
        },
        {
          label: t("appSections.hero.general.languageStat"),
          value:
            selectedLanguage === "auto" || !selectedLanguage
              ? t("appSections.hero.general.autoLabel")
              : selectedLanguage.toUpperCase(),
        },
      ]}
      visual={<GeneralHeroVisual />}
    />
  );
};

const GeneralHeroVisual: React.FC = () => {
  const { t } = useTranslation();
  return (
    <PreviewSlate className="w-full">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
          <Palette className="h-3.5 w-3.5" aria-hidden />
          {t("appSections.hero.general.previewLabel")}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-[inset_0_1px_0_var(--edge-highlight)]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
            <span className="h-1.5 flex-1 rounded-full bg-[color-mix(in_srgb,var(--text)_22%,transparent)]" />
            <span className="h-3 w-3 rounded-full bg-[var(--accent-gold)]" />
          </div>
          <div className="mt-2 space-y-1.5">
            <span className="block h-1.5 w-5/6 rounded-full bg-[color-mix(in_srgb,var(--text)_55%,transparent)]" />
            <span className="block h-1.5 w-3/4 rounded-full bg-[color-mix(in_srgb,var(--text)_30%,transparent)]" />
            <span className="block h-1.5 w-2/3 rounded-full bg-[color-mix(in_srgb,var(--text)_20%,transparent)]" />
          </div>
        </div>
      </div>
    </PreviewSlate>
  );
};

export const GeneralAppSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <GeneralHero />

      <SettingsGroup title={t("appSections.groups.dictationLanguage")}>
        <LanguageSelector descriptionMode="inline" grouped={true} />
        <GlobalLanguageSync descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.appearance")}>
        <ThemeSelector descriptionMode="tooltip" grouped={true} />
        <AppFontScale />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.appBehavior")}>
        <StartHidden descriptionMode="tooltip" grouped={true} />
        <AutostartToggle descriptionMode="tooltip" grouped={true} />
        <ShowTrayIcon descriptionMode="tooltip" grouped={true} />
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
        <UpdateChecksToggle descriptionMode="tooltip" grouped={true} />
        <ModelUnloadTimeoutSetting descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.featureToggles")}>
        <SpeechOutputToggle descriptionMode="tooltip" grouped={true} />
        <PhraseKeysEnabledToggle descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <BoardList
        title={t("appSections.groups.manageFromViewsTitle")}
        description={t("appSections.groups.manageFromViewsDescription")}
        columns={2}
      >
        <CrossLinkCard
          icon={<WandSparkles className="h-4 w-4" aria-hidden />}
          title={t("appSections.cross.writeProfiles.title")}
          description={t("appSections.cross.writeProfiles.description")}
          destination={t("appSections.cross.writeProfiles.destination")}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("vox-jot:navigate", {
                detail: { view: "refine", section: "write-profiles" },
              }),
            );
          }}
        />
        <CrossLinkCard
          icon={<Volume2 className="h-4 w-4" aria-hidden />}
          title={t("appSections.cross.voices.title")}
          description={t("appSections.cross.voices.description")}
          destination={t("appSections.cross.voices.destination")}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("vox-jot:navigate", {
                detail: { view: "listen", section: "create-voices" },
              }),
            );
          }}
        />
        <CrossLinkCard
          icon={<Volume2 className="h-4 w-4" aria-hidden />}
          title={t("appSections.cross.ttsModels.title", {
            defaultValue: "Browse voice models",
          })}
          description={t("appSections.cross.ttsModels.description", {
            defaultValue: "TTS engines, voice packs, and clones",
          })}
          destination={t("appSections.cross.voices.destination")}
          onClick={() => {
            void openModelHub("tts");
          }}
        />
      </BoardList>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Shortcuts
 * ─────────────────────────────────────────────────────────────────────────── */

const KeyboardGlyph: React.FC<{
  tone?: "accent" | "neutral";
  label: string;
}> = ({ tone = "neutral", label }) => (
  <span
    className={`inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1.5 font-mono text-[11px] font-semibold tracking-[0.04em] shadow-[inset_0_-1px_0_var(--edge-shadow)] ${
      tone === "accent"
        ? "border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] bg-[var(--accent-soft)] text-[var(--accent)]"
        : "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"
    }`}
  >
    {label}
  </span>
);

const ShortcutsHero: React.FC = () => {
  const { t } = useTranslation();
  return (
    <SectionHero
      icon={<Keyboard className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.shortcuts.eyebrow")}
      title={t("appSections.hero.shortcuts.title")}
      description={t("appSections.hero.shortcuts.description")}
      tone="info"
      visual={
        <PreviewSlate className="w-full">
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              {t("appSections.shortcuts.preview.title")}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <KeyboardGlyph tone="accent" label="⌃" />
              <span className="text-[var(--muted)]">+</span>
              <KeyboardGlyph tone="accent" label="⇧" />
              <span className="text-[var(--muted)]">+</span>
              <KeyboardGlyph tone="accent" label="D" />
            </div>
            <p className="text-[11px] leading-5 text-[var(--muted)]">
              {t("appSections.shortcuts.preview.subtitle")}
            </p>
          </div>
        </PreviewSlate>
      }
    />
  );
};

export const ShortcutsSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <ShortcutsHero />

      <SettingsGroup
        title={t("appSections.shortcuts.groups.dictate.title")}
        description={t("appSections.shortcuts.groups.dictate.description")}
      >
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <ShortcutInput
          shortcutId="transcribe_with_post_process"
          grouped={true}
        />
        <ShortcutInput shortcutId="cancel" grouped={true} />
        <ShortcutInput shortcutId="toggle_command_menu" grouped={true} />
        <PushToTalk descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup
        title={t("appSections.shortcuts.groups.refine.title")}
        description={t("appSections.shortcuts.groups.refine.description")}
      >
        <ShortcutInput shortcutId="rewrite_selection" grouped={true} />
        <ShortcutInput shortcutId="translate_selection" grouped={true} />
      </SettingsGroup>

      <SettingsGroup
        title={t("appSections.shortcuts.groups.listen.title")}
        description={t("appSections.shortcuts.groups.listen.description")}
      >
        <ShortcutInput shortcutId="speak_selection" grouped={true} />
        <ShortcutInput shortcutId="speak_last_output" grouped={true} />
        <ShortcutInput shortcutId="stop_speaking" grouped={true} />
      </SettingsGroup>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Recording & Devices
 * ─────────────────────────────────────────────────────────────────────────── */

const RecordingHero: React.FC = () => {
  const { t } = useTranslation();
  const { audio_feedback: feedbackOn, tts_enabled: ttsEnabled } =
    useSettingsSlice(["audio_feedback", "tts_enabled"] as const);

  return (
    <SectionHero
      icon={<Mic className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.recording.eyebrow")}
      title={t("appSections.hero.recording.title")}
      description={t("appSections.hero.recording.description")}
      tone="accent"
      visual={
        <PreviewSlate className="w-full">
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              {t("appSections.device.previewTitle")}
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text)]">
              <span className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1">
                <Mic className="h-3 w-3 text-[var(--accent)]" />
                {t("appSections.device.stepMic")}
              </span>
              <ArrowRight className="h-3 w-3 text-[var(--muted)]" />
              <span className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1">
                <Waves className="h-3 w-3 text-[var(--accent)]" />
                {t("appSections.device.stepEnhance")}
              </span>
              <ArrowRight className="h-3 w-3 text-[var(--muted)]" />
              <span
                className={`flex items-center gap-1 rounded-md border px-2 py-1 ${
                  feedbackOn
                    ? "border-[color-mix(in_srgb,var(--success)_45%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
                }`}
              >
                <Headphones className="h-3 w-3" />
                {t("appSections.device.stepFeedback")}
              </span>
            </div>
            <p className="text-[11px] leading-5 text-[var(--muted)]">
              {ttsEnabled ? "Speech output enabled" : "Speech output muted"}
            </p>
          </div>
        </PreviewSlate>
      }
    />
  );
};

const CustomFillerWordsSetting: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const fillerWords = getSetting("custom_filler_words");
  const [draft, setDraft] = useState((fillerWords || []).join("\n"));

  useEffect(() => {
    setDraft((fillerWords || []).join("\n"));
  }, [fillerWords]);

  const saveDraft = async () => {
    const parsed = draft
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    await updateSetting(
      "custom_filler_words",
      parsed.length > 0 ? parsed : null,
    );
  };

  return (
    <SettingContainer
      title={t("appSections.fillerWords.title")}
      description={t("appSections.fillerWords.description")}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="space-y-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("settings.speechCleanup.fillerWordsPlaceholder")}
          aria-label={t("appSections.fillerWords.title")}
          className="min-h-[120px]"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => void saveDraft()}
            disabled={isUpdating("custom_filler_words")}
          >
            {t("appSections.common.save")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void updateSetting("custom_filler_words", null)}
            disabled={isUpdating("custom_filler_words")}
          >
            {t("appSections.common.useDefaults")}
          </Button>
        </div>
      </div>
    </SettingContainer>
  );
};

export const RecordingDevicesSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const { updateSetting } = useSettings();
  const {
    audio_feedback: audioFeedbackEnabled,
    tts_enabled: ttsEnabled,
    tts_volume: ttsVolume,
  } = useSettingsSlice([
    "audio_feedback",
    "tts_enabled",
    "tts_volume",
  ] as const);

  return (
    <div className="space-y-6">
      <RecordingHero />

      <SettingsGroup title={t("appSections.groups.microphoneInput")}>
        <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <ClamshellMicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <AlwaysOnMicrophone descriptionMode="inline" grouped={true} />
        <MuteWhileRecording descriptionMode="inline" grouped={true} />
        <AudioDucking descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.cueSoundsOverlay")}>
        <AudioFeedback descriptionMode="tooltip" grouped={true} />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
        <ShowOverlay descriptionMode="inline" grouped={true} />
        <SoundPicker
          label={t("appSections.soundPicker.label")}
          description={t("appSections.soundPicker.description")}
        />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.speechOutputDevice")}>
        <OutputDeviceSelector
          descriptionMode="tooltip"
          grouped={true}
          disabled={!((audioFeedbackEnabled ?? false) || (ttsEnabled ?? false))}
        />
        <Slider
          value={ttsVolume ?? 1}
          onChange={(value) => void updateSetting("tts_volume", value)}
          min={0}
          max={1}
          step={0.05}
          label={t("appSections.speechVolume.label")}
          description={t("appSections.speechVolume.description")}
          descriptionMode="tooltip"
          grouped={true}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          disabled={!ttsEnabled}
        />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.speechCleanup")}>
        <AudioEnhancement descriptionMode="tooltip" grouped={true} />
        <CustomFillerWordsSetting />
      </SettingsGroup>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Output & Paste
 * ─────────────────────────────────────────────────────────────────────────── */

const OutputPasteHero: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const pasteMethod = (getSetting("paste_method") ?? "ctrl_v") as string;

  const methodLabel =
    pasteMethod === "direct"
      ? t("appSections.output.methodType")
      : pasteMethod === "ctrl_v" ||
          pasteMethod === "ctrl_shift_v" ||
          pasteMethod === "shift_insert"
        ? t("appSections.output.methodPaste")
        : pasteMethod === "external_script"
          ? t("appSections.output.methodType")
          : t("appSections.output.methodNone");

  return (
    <SectionHero
      icon={<Clipboard className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.outputPaste.eyebrow")}
      title={t("appSections.hero.outputPaste.title")}
      description={t("appSections.hero.outputPaste.description")}
      tone="info"
      stats={[
        { label: t("appSections.groups.activeLabel"), value: methodLabel },
      ]}
      visual={
        <PreviewSlate className="w-full">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
                <Mic className="h-3 w-3" />
              </span>
              <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                {t("appSections.output.sourceLabel")}
              </span>
            </div>
            <p className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[11px] italic text-[var(--text)]">
              "{t("appSections.output.sampleSource")}"
            </p>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--success-soft)] text-[var(--success)]">
                <Type className="h-3 w-3" />
              </span>
              <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                {t("appSections.output.targetLabel")}
              </span>
            </div>
            <p className="rounded-md border border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_5%,var(--card))] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text)]">
              {t("appSections.output.sampleTarget")}
            </p>
          </div>
        </PreviewSlate>
      }
    />
  );
};

const MethodLegend: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        {
          icon: <Clipboard className="h-3.5 w-3.5" aria-hidden />,
          title: t("appSections.output.methodPaste"),
          detail: t("appSections.output.methodPasteDetail"),
        },
        {
          icon: <Type className="h-3.5 w-3.5" aria-hidden />,
          title: t("appSections.output.methodType"),
          detail: t("appSections.output.methodTypeDetail"),
        },
        {
          icon: <Layers className="h-3.5 w-3.5" aria-hidden />,
          title: t("appSections.output.methodNone"),
          detail: t("appSections.output.methodNoneDetail"),
        },
      ].map((item) => (
        <div
          key={item.title}
          className="rounded-xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-3 py-3"
        >
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text)]">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
              {item.icon}
            </span>
            {item.title}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-5 text-[var(--muted)]">
            {item.detail}
          </p>
        </div>
      ))}
    </div>
  );
};

const DictationReadinessChecklist: React.FC = () => {
  const { t } = useTranslation();
  const readiness = useDictationReadiness();
  const statusLabel =
    readiness.overall === "ready"
      ? t("appSections.readiness.status.ready")
      : readiness.overall === "warning"
        ? t("appSections.readiness.status.warning")
        : t("appSections.readiness.status.blocked");
  const statusClass =
    readiness.overall === "ready"
      ? "text-[var(--success)]"
      : readiness.overall === "warning"
        ? "text-[var(--warning)]"
        : "text-[var(--danger)]";

  return (
    <section className="rounded-xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--text)]">
            {t("appSections.readiness.title")}
          </h3>
          <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">
            {t("appSections.readiness.description")}
          </p>
        </div>
        <span className={`text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {readiness.gates.map((gate) => {
          const Icon = gate.state === "blocked" ? XCircle : CheckCircle2;
          const iconClass =
            gate.state === "blocked"
              ? "text-[var(--danger)]"
              : gate.state === "warning"
                ? "text-[var(--warning)]"
                : "text-[var(--success)]";
          return (
            <div
              key={gate.id}
              className="flex min-w-0 items-start gap-2 rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2"
            >
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClass}`} />
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text)]">
                  {gate.label}
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">
                  {gate.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const OutputPasteSettingsSection: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <OutputPasteHero />
      <DictationReadinessChecklist />

      <section className="space-y-3">
        <header className="px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle,var(--muted))]">
            {t("appSections.output.methodTitle")}
          </h3>
        </header>
        <MethodLegend />
      </section>

      <SettingsGroup title={t("appSections.groups.insertionBehavior")}>
        <PasteMethodSetting descriptionMode="inline" grouped={true} />
        <TypingToolSetting descriptionMode="inline" grouped={true} />
        <ClipboardHandlingSetting descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.textShaping")}>
        <AutoSubmit descriptionMode="inline" grouped={true} />
        <AppendTrailingSpace descriptionMode="inline" grouped={true} />
      </SettingsGroup>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Corrections
 * ─────────────────────────────────────────────────────────────────────────── */

const CorrectionsHero: React.FC = () => {
  const { t } = useTranslation();
  return (
    <SectionHero
      icon={<SpellCheck className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.corrections.eyebrow")}
      title={t("appSections.hero.corrections.title")}
      description={t("appSections.hero.corrections.description")}
      tone="success"
      visual={
        <PreviewSlate className="w-full">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                {t("appSections.corrections.rawLabel")}
              </span>
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
            </div>
            <p className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[11.5px] text-[var(--text)]">
              {t("appSections.corrections.demoPrefix")}{" "}
              <span className="underline decoration-[var(--warning)] decoration-2 underline-offset-2">
                {t("appSections.corrections.demoWrongWord")}
              </span>{" "}
              {t("appSections.corrections.demoSuffix")}
            </p>
            <div className="flex items-center gap-2">
              <ArrowRight className="h-3 w-3 text-[var(--muted)]" />
              <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--success)]">
                {t("appSections.corrections.fixedLabel")}
              </span>
            </div>
            <p className="rounded-md border border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_5%,var(--card))] px-2.5 py-1.5 text-[11.5px] text-[var(--text)]">
              {t("appSections.corrections.demoPrefix")}{" "}
              <span className="rounded bg-[var(--accent-gold-soft)] px-1 font-bold underline decoration-[var(--accent-gold)] decoration-2 underline-offset-2">
                {t("appSections.corrections.demoFixedWord")}
              </span>{" "}
              {t("appSections.corrections.demoSuffix")}
            </p>
          </div>
        </PreviewSlate>
      }
    />
  );
};

const CorrectionsExplainer: React.FC = () => {
  const { t } = useTranslation();
  return (
    <BoardList columns={2}>
      <div className={subtleCardClassName}>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--success-soft)] text-[var(--success)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </span>
          <p className="text-[13px] font-semibold text-[var(--text)]">
            {t("appSections.corrections.automaticTitle")}
          </p>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[var(--muted)]">
          {t("appSections.corrections.automaticDetail")}
        </p>
      </div>
      <div className={subtleCardClassName}>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
          </span>
          <p className="text-[13px] font-semibold text-[var(--text)]">
            {t("appSections.corrections.manualTitle")}
          </p>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[var(--muted)]">
          {t("appSections.corrections.manualDetail")}
        </p>
      </div>
    </BoardList>
  );
};

export const CorrectionsSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <CorrectionsHero />
      <CorrectionsExplainer />
      <Alert variant="info">
        {t("appSections.corrections.assistiveConsentNotice", {
          defaultValue:
            "Correction learning is an assistive feature: after Vox Jot inserts dictated text, it can monitor that inserted text briefly to learn edits you make, so repeated names, jargon, and phrases do not have to be corrected by hand again. Turn it off below anytime.",
        })}
      </Alert>
      <CorrectionSettings />

      <CrossLinkCard
        icon={<BookOpen className="h-4 w-4" aria-hidden />}
        title={t("appSections.cross.dictionary.title")}
        description={t("appSections.cross.dictionary.description")}
        destination={t("appSections.cross.dictionary.destination")}
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("vox-jot:navigate", {
              detail: { view: "dictate", section: "corrections" },
            }),
          );
        }}
      />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Models & AI
 * ─────────────────────────────────────────────────────────────────────────── */

const ModelsHero: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const localPrivacyMode = getSetting("local_privacy_mode") ?? false;
  const providers = getSetting("post_process_providers") ?? [];
  const providerId = getSetting("post_process_provider_id") ?? "";
  const selectedProvider = providers.find(
    (provider) => provider.id === providerId,
  );
  const baseUrl = selectedProvider?.base_url?.toLowerCase() ?? "";
  const localProvider =
    localPrivacyMode ||
    providerId === "apple_intelligence" ||
    providerId === "ollama" ||
    baseUrl.includes("localhost") ||
    baseUrl.includes("127.0.0.1");

  return (
    <SectionHero
      icon={<Bot className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.models.eyebrow")}
      title={t("appSections.hero.models.title")}
      description={t("appSections.hero.models.description")}
      tone="accent"
      stats={[
        {
          label: t("appSections.models.cleanupLabel"),
          value: selectedProvider?.label ?? "—",
        },
        {
          label: t("appSections.models.routeLabel"),
          value: localProvider
            ? t("appSections.models.routeLocal")
            : t("appSections.models.routeCloud"),
        },
      ]}
      visual={
        <PreviewSlate className="w-full">
          <div className="space-y-2">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              {t("appSections.models.routeTitle")}
            </p>
            <div className="grid gap-2">
              <div
                className={`rounded-md border px-2.5 py-2 ${
                  localProvider
                    ? "border-[color-mix(in_srgb,var(--success)_45%,var(--border))] bg-[var(--success-soft)]"
                    : "border-[var(--border)] bg-[var(--card)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Cpu
                    className={`h-3.5 w-3.5 ${
                      localProvider
                        ? "text-[var(--success)]"
                        : "text-[var(--muted)]"
                    }`}
                  />
                  <span className="text-[11px] font-semibold text-[var(--text)]">
                    {t("appSections.models.localRouteHeading")}
                  </span>
                  {localProvider ? (
                    <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-[var(--success)]" />
                  ) : null}
                </div>
              </div>
              <div
                className={`rounded-md border px-2.5 py-2 ${
                  !localProvider
                    ? "border-[color-mix(in_srgb,var(--info)_45%,var(--border))] bg-[var(--info-soft)]"
                    : "border-[var(--border)] bg-[var(--card)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Cloud
                    className={`h-3.5 w-3.5 ${
                      !localProvider
                        ? "text-[var(--info)]"
                        : "text-[var(--muted)]"
                    }`}
                  />
                  <span className="text-[11px] font-semibold text-[var(--text)]">
                    {t("appSections.models.cloudRouteHeading")}
                  </span>
                  {!localProvider ? (
                    <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-[var(--info)]" />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </PreviewSlate>
      }
    />
  );
};

const TranslationProviderSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const {
    getSetting,
    updateSetting,
    fetchPostProcessModels,
    postProcessModelOptions,
  } = useSettings();
  const [modelDraft, setModelDraft] = useState("");

  const providers = getSetting("post_process_providers") || [];
  const providerId = getSetting("translation_provider_id") || "";
  const translationModelIds = getSetting("translation_model_ids") || {};
  const selectedModel = translationModelIds[providerId] || "";
  const cachedOptions = postProcessModelOptions[providerId] || [];
  const modelOptions = selectedModel
    ? Array.from(new Set([...cachedOptions, selectedModel]))
    : cachedOptions;

  useEffect(() => {
    setModelDraft(selectedModel);
  }, [selectedModel]);

  const providerOptions = providers.map((provider) => ({
    value: provider.id,
    label: provider.label,
  }));

  const saveModel = async () => {
    const trimmed = modelDraft.trim();
    await updateSetting("translation_model_ids", {
      ...translationModelIds,
      [providerId]: trimmed,
    });
  };

  return (
    <SettingsGroup title={t("appSections.groups.translationProviderOverride")}>
      <SettingContainer
        title={t("appSections.translationProvider.title")}
        description={t("appSections.translationProvider.description")}
        descriptionMode="tooltip"
        grouped={true}
      >
        <Dropdown
          selectedValue={providerId}
          onSelect={(value) => {
            void updateSetting("translation_provider_id", value);
            void fetchPostProcessModels(value);
          }}
          options={providerOptions}
          placeholder={t("settings.translation.providerPlaceholder")}
        />
      </SettingContainer>

      <SettingContainer
        title={t("appSections.translationProvider.modelTitle")}
        description={t("appSections.translationProvider.modelDescription")}
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
        disabled={!providerId || providerId === "apple_intelligence"}
      >
        {providerId === "apple_intelligence" ? (
          <p className="text-sm text-[var(--muted)]">
            {t("appSections.translationProvider.appleNotice")}
          </p>
        ) : (
          <div className="space-y-3">
            {modelOptions.length > 0 && (
              <Dropdown
                selectedValue={modelDraft || null}
                onSelect={setModelDraft}
                options={modelOptions.map((option) => ({
                  value: option,
                  label: option,
                }))}
                onRefresh={() => {
                  void fetchPostProcessModels(providerId);
                }}
                placeholder={t("settings.translation.modelPlaceholder")}
              />
            )}
            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                placeholder={t("settings.translation.customModelPlaceholder")}
                className="min-h-[44px] flex-1"
              />
              <Button size="sm" onClick={() => void saveModel()}>
                {t("appSections.common.saveModel")}
              </Button>
            </div>
          </div>
        )}
      </SettingContainer>

      <ToggleSwitch
        checked={getSetting("translation_translate_snippets") ?? false}
        onChange={(enabled) =>
          void updateSetting("translation_translate_snippets", enabled)
        }
        label={t("appSections.translationProvider.translatePhraseKeysLabel")}
        description={t(
          "appSections.translationProvider.translatePhraseKeysDescription",
        )}
        descriptionMode="tooltip"
        grouped={true}
      />
    </SettingsGroup>
  );
};

export const AISetupSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <ModelsHero />

      <PostProcessingSettings omitLocalPrivacy />

      <TranslationProviderSettingsCard />

      <BoardList
        title={t("appSections.models.managementTitle")}
        description={t("appSections.models.managementSubtitle")}
        columns={2}
      >
        <CrossLinkCard
          icon={<Mic className="h-4 w-4" aria-hidden />}
          title={t("appSections.cross.speechModels.title")}
          description={t("appSections.cross.speechModels.description")}
          destination={t("appSections.cross.speechModels.destination")}
          onClick={() => {
            void openModelHub("stt");
          }}
        />
        <CrossLinkCard
          icon={<WandSparkles className="h-4 w-4" aria-hidden />}
          title={t("appSections.cross.refineModels.title")}
          description={t("appSections.cross.refineModels.description")}
          destination={t("appSections.cross.refineModels.destination")}
          onClick={() => {
            void openModelHub("llm");
          }}
        />
        <CrossLinkCard
          icon={<Languages className="h-4 w-4" aria-hidden />}
          title={t("appSections.cross.translation.title")}
          description={t("appSections.cross.translation.description")}
          destination={t("appSections.cross.translation.destination")}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("vox-jot:navigate", {
                detail: { view: "refine", section: "translation" },
              }),
            );
          }}
        />
        <CrossLinkCard
          icon={<FileAudio className="h-4 w-4" aria-hidden />}
          title={t("appSections.models.fileTranscriptionTitle")}
          description={t("appSections.models.fileTranscriptionDetail")}
          destination={t("appSections.cross.speechModels.destination")}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("vox-jot:navigate", {
                detail: { view: "dictate", section: "file-transcription" },
              }),
            );
          }}
        />
      </BoardList>

      <details className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-sm)]">
        <summary className="cursor-pointer list-none px-5 py-4 text-[13px] font-semibold text-[var(--text)]">
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[var(--muted)]" />
            {t("appSections.models.advancedEvaluationTitle")}
          </span>
        </summary>
        <div className="border-t border-[var(--border)] p-5">
          <RefineModelsSettings
            showEvaluationPanel={false}
            hubFilterLabels={false}
          />
        </div>
      </details>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Privacy & Storage
 * ─────────────────────────────────────────────────────────────────────────── */

const PrivacyHero: React.FC<{ localPrivacyMode: boolean }> = ({
  localPrivacyMode,
}) => {
  const { t } = useTranslation();
  return (
    <SectionHero
      icon={
        localPrivacyMode ? (
          <ShieldCheck className="h-5 w-5" aria-hidden />
        ) : (
          <Shield className="h-5 w-5" aria-hidden />
        )
      }
      eyebrow={t("appSections.hero.privacy.eyebrow")}
      title={
        localPrivacyMode
          ? t("appSections.privacy.heroOnTitle")
          : t("appSections.privacy.heroOffTitle")
      }
      description={
        localPrivacyMode
          ? t("appSections.privacy.heroOnDetail")
          : t("appSections.privacy.heroOffDetail")
      }
      tone={localPrivacyMode ? "success" : "info"}
      visual={
        <PreviewSlate className="w-full">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                <ShieldCheck className="h-3 w-3" />
                {t("appSections.privacy.previewLocalFirst")}
              </span>
              <MiniStatusPill
                icon={
                  localPrivacyMode ? (
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                  ) : (
                    <Wifi className="h-3 w-3" aria-hidden />
                  )
                }
                label={
                  localPrivacyMode
                    ? t("appSections.privacy.previewEnforced")
                    : t("appSections.privacy.previewAllowed")
                }
                tone={localPrivacyMode ? "success" : "info"}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-2">
                <Mic className="h-3 w-3 text-[var(--accent)]" />
                <span className="text-[11px] font-medium text-[var(--text)]">
                  {t("appSections.privacy.previewAudioCapture")}
                </span>
                <span className="ms-auto text-[10px] text-[var(--success)]">
                  {t("appSections.models.routeLocal")}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-2">
                <SpellCheck className="h-3 w-3 text-[var(--accent)]" />
                <span className="text-[11px] font-medium text-[var(--text)]">
                  {t("appSections.privacy.previewCleanup")}
                </span>
                <span
                  className={`ms-auto text-[10px] ${
                    localPrivacyMode
                      ? "text-[var(--success)]"
                      : "text-[var(--info)]"
                  }`}
                >
                  {localPrivacyMode
                    ? t("appSections.models.routeLocal")
                    : t("appSections.privacy.previewProvider")}
                </span>
              </div>
            </div>
          </div>
        </PreviewSlate>
      }
    />
  );
};

const RetentionTimelinePreview: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const retention = getSetting("recording_retention_period") ?? "never";
  const labels: Record<string, string> = {
    never: t("appSections.retention.never"),
    preserve_limit: t("appSections.retention.preserveLimit"),
    days3: t("appSections.retention.days3"),
    days_3: t("appSections.retention.days3"),
    weeks2: t("appSections.retention.weeks2"),
    weeks_2: t("appSections.retention.weeks2"),
    months3: t("appSections.retention.months3"),
    months_3: t("appSections.retention.months3"),
  };

  return (
    <div className="px-4 py-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            {t("appSections.retention.title")}
          </p>
          <MiniStatusPill
            icon={<HardDrive className="h-3.5 w-3.5" aria-hidden />}
            label={labels[retention] ?? labels.never}
            tone={retention === "never" ? "success" : "warning"}
          />
        </div>
        <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-2 text-xs font-semibold text-[var(--text)]">
          <span>{t("appSections.retention.day1")}</span>
          <span className="h-px bg-[var(--border)]" aria-hidden />
          <span>{t("appSections.retention.day7")}</span>
          <span className="h-px bg-[var(--border)]" aria-hidden />
          <span>{t("appSections.retention.day30")}</span>
          <span className="h-px bg-[var(--border)]" aria-hidden />
          <HardDrive
            className="h-4 w-4 text-[var(--warning)]"
            aria-label={t("appSections.retention.autoDelete")}
          />
        </div>
      </div>
    </div>
  );
};

export const PrivacyStorageSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const localPrivacyMode = getSetting("local_privacy_mode") ?? false;
  const correctionTrackingEnabled =
    getSetting("correction_tracking_enabled") ?? true;
  const screenContextEnabled = getSetting("screen_context_enabled") ?? true;
  const autoSubmitEnabled = getSetting("auto_submit") ?? false;
  const pasteMethod = getSetting("paste_method") ?? "ctrl_v";

  const navigateToSettingsSection = (section: string) => {
    window.dispatchEvent(
      new CustomEvent("vox-jot:navigate", {
        detail: { view: "settings", section },
      }),
    );
  };

  const accessRows = [
    {
      icon: <Keyboard className="h-4 w-4" aria-hidden />,
      label: t("appSections.privacy.assistiveAccess.accessibilityLabel", {
        defaultValue: "Accessibility",
      }),
      detail: t("appSections.privacy.assistiveAccess.accessibilityDetail", {
        defaultValue:
          "Used for user-started assistive insertion so dictated text can land in the focused field.",
      }),
      status:
        pasteMethod === "none"
          ? t("appSections.privacy.assistiveAccess.clipboardOnlyStatus", {
              defaultValue: "Clipboard only",
            })
          : t("appSections.privacy.assistiveAccess.enabledStatus", {
              defaultValue: "Enabled for insertion",
            }),
      active: pasteMethod !== "none",
      destination: "output-paste",
    },
    {
      icon: <SpellCheck className="h-4 w-4" aria-hidden />,
      label: t("appSections.privacy.assistiveAccess.correctionsLabel", {
        defaultValue: "Correction learning",
      }),
      detail: t("appSections.privacy.assistiveAccess.correctionsDetail", {
        defaultValue:
          "Monitors the inserted text after paste to learn user edits and reduce repeated manual fixes.",
      }),
      status: correctionTrackingEnabled
        ? t("appSections.privacy.assistiveAccess.onStatus", {
            defaultValue: "On",
          })
        : t("appSections.privacy.assistiveAccess.offStatus", {
            defaultValue: "Off",
          }),
      active: correctionTrackingEnabled,
      destination: "corrections-settings",
    },
    {
      icon: <Monitor className="h-4 w-4" aria-hidden />,
      label: t("appSections.privacy.assistiveAccess.screenContextLabel", {
        defaultValue: "Screen Context",
      }),
      detail: t("appSections.privacy.assistiveAccess.screenContextDetail", {
        defaultValue:
          "Uses optional Screen Recording permission for local OCR context that helps with visible names, jargon, and phrase keys.",
      }),
      status: screenContextEnabled
        ? t("appSections.privacy.assistiveAccess.onStatus", {
            defaultValue: "On",
          })
        : t("appSections.privacy.assistiveAccess.offStatus", {
            defaultValue: "Off",
          }),
      active: screenContextEnabled,
      destination: "screen-context",
    },
    {
      icon: <ArrowRight className="h-4 w-4" aria-hidden />,
      label: t("appSections.privacy.assistiveAccess.autoSubmitLabel", {
        defaultValue: "Hands-free submit",
      }),
      detail: t("appSections.privacy.assistiveAccess.autoSubmitDetail", {
        defaultValue:
          "Optional Return/Command-Return output for users who cannot comfortably press the submit key.",
      }),
      status: autoSubmitEnabled
        ? t("appSections.privacy.assistiveAccess.onStatus", {
            defaultValue: "On",
          })
        : t("appSections.privacy.assistiveAccess.offStatus", {
            defaultValue: "Off",
          }),
      active: autoSubmitEnabled,
      destination: "output-paste",
    },
  ];

  return (
    <div className="space-y-6">
      <PrivacyHero localPrivacyMode={localPrivacyMode} />

      <SettingsGroup
        title={t("appSections.privacy.assistiveAccess.title", {
          defaultValue: "Assistive access & privacy",
        })}
      >
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm leading-6 text-[var(--muted)]">
            {t("appSections.privacy.assistiveAccess.description", {
              defaultValue:
                "Vox Jot is designed for people who cannot comfortably type because of disability, motor limitations, repetitive strain, temporary injury, fatigue, or pain. These controls show which assistive features can insert text, observe corrections, record screen context, or submit text on your behalf.",
            })}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {accessRows.map((row) => (
              <div
                key={row.label}
                className="rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] p-3"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
                    {row.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--text)]">
                        {row.label}
                      </p>
                      <MiniStatusPill
                        icon={
                          row.active ? (
                            <CheckCircle2 className="h-3 w-3" aria-hidden />
                          ) : (
                            <XCircle className="h-3 w-3" aria-hidden />
                          )
                        }
                        label={row.status}
                        tone={row.active ? "info" : "default"}
                      />
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
                      {row.detail}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3"
                      onClick={() => navigateToSettingsSection(row.destination)}
                    >
                      {t("appSections.privacy.assistiveAccess.manageButton", {
                        defaultValue: "Manage",
                      })}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("appSections.groups.privacyControls")}>
        <ToggleSwitch
          checked={localPrivacyMode}
          onChange={(enabled) =>
            void updateSetting("local_privacy_mode", enabled)
          }
          isUpdating={isUpdating("local_privacy_mode")}
          label={t("appSections.privacy.localPrivacyModeLabel")}
          description={t("appSections.privacy.localPrivacyModeDescription")}
          descriptionMode="inline"
          grouped={true}
        />
        <ToggleSwitch
          checked={getSetting("enable_crash_reporting") ?? false}
          onChange={(enabled) =>
            void updateSetting("enable_crash_reporting", enabled)
          }
          isUpdating={isUpdating("enable_crash_reporting")}
          label={t("appSections.privacy.crashReportingLabel")}
          description={t("appSections.privacy.crashReportingDescription")}
          descriptionMode="inline"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.privacy.historyGroupTitle")}>
        <HistoryLimit descriptionMode="inline" grouped={true} />
        <RetentionTimelinePreview />
        <RecordingRetentionPeriodSelector
          descriptionMode="inline"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup title={t("appSections.privacy.filesGroupTitle")}>
        <AppDataDirectory descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      {localPrivacyMode && (
        <Alert variant="info">
          {t("appSections.privacy.localPrivacyNotice")}
        </Alert>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Legal & Model Terms
 * ─────────────────────────────────────────────────────────────────────────── */

const LEGAL_ACKNOWLEDGEMENT_KEY = "voxjot.legalModelTermsAcknowledged.v1";

const legalNoticeLink =
  "https://www.iriedinamik.org/voxjot/#third-party-notices";

const LegalHero: React.FC<{ acknowledged: boolean }> = ({ acknowledged }) => {
  const { t } = useTranslation();

  return (
    <SectionHero
      icon={<Scale className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.legal.eyebrow")}
      title={t("appSections.hero.legal.title")}
      description={t("appSections.hero.legal.description")}
      tone="warning"
      stats={[
        {
          label: t("appSections.legal.statusLabel"),
          value: acknowledged
            ? t("appSections.legal.statusAcknowledged")
            : t("appSections.legal.statusReview"),
        },
        {
          label: t("appSections.legal.modelCountLabel"),
          value: t("appSections.legal.modelCountValue"),
        },
      ]}
      visual={
        <PreviewSlate className="w-full">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              {t("appSections.legal.previewLabel")}
            </div>
            {[
              t("appSections.legal.previewRecording"),
              t("appSections.legal.previewModels"),
              t("appSections.legal.previewVoice"),
            ].map((label) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-[11.5px] font-semibold text-[var(--text)]"
              >
                <CheckCircle2
                  className="h-3.5 w-3.5 shrink-0 text-[var(--success)]"
                  aria-hidden
                />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </PreviewSlate>
      }
    />
  );
};

const LegalPrincipleGrid: React.FC = () => {
  const { t } = useTranslation();
  const items = [
    {
      icon: <Mic className="h-4 w-4" aria-hidden />,
      label: t("appSections.legal.principles.recording.title"),
      value: t("appSections.legal.principles.recording.value"),
      hint: t("appSections.legal.principles.recording.detail"),
      tone: "warning" as const,
    },
    {
      icon: <FileText className="h-4 w-4" aria-hidden />,
      label: t("appSections.legal.principles.models.title"),
      value: t("appSections.legal.principles.models.value"),
      hint: t("appSections.legal.principles.models.detail"),
      tone: "accent" as const,
    },
    {
      icon: <Headphones className="h-4 w-4" aria-hidden />,
      label: t("appSections.legal.principles.voice.title"),
      value: t("appSections.legal.principles.voice.value"),
      hint: t("appSections.legal.principles.voice.detail"),
      tone: "info" as const,
    },
    {
      icon: <Shield className="h-4 w-4" aria-hidden />,
      label: t("appSections.legal.principles.privacy.title"),
      value: t("appSections.legal.principles.privacy.value"),
      hint: t("appSections.legal.principles.privacy.detail"),
      tone: "success" as const,
    },
  ];

  return (
    <BoardList title={t("appSections.legal.principlesTitle")}>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <MetricTile
            key={item.label}
            icon={item.icon}
            tone={item.tone}
            label={item.label}
            value={item.value}
            hint={item.hint}
          />
        ))}
      </div>
    </BoardList>
  );
};

const LegalTermsList: React.FC = () => {
  const { t } = useTranslation();
  const items = [
    {
      title: t("appSections.legal.terms.recording.title"),
      detail: t("appSections.legal.terms.recording.detail"),
    },
    {
      title: t("appSections.legal.terms.modelLicenses.title"),
      detail: t("appSections.legal.terms.modelLicenses.detail"),
    },
    {
      title: t("appSections.legal.terms.restrictedModels.title"),
      detail: t("appSections.legal.terms.restrictedModels.detail"),
    },
    {
      title: t("appSections.legal.terms.voiceCloning.title"),
      detail: t("appSections.legal.terms.voiceCloning.detail"),
    },
    {
      title: t("appSections.legal.terms.accuracy.title"),
      detail: t("appSections.legal.terms.accuracy.detail"),
    },
  ];

  return (
    <SettingsGroup
      title={t("appSections.legal.termsTitle")}
      description={t("appSections.legal.termsDescription")}
    >
      {items.map((item) => (
        <div key={item.title} className="px-5 py-4">
          <p className="text-sm font-semibold text-[var(--text)]">
            {item.title}
          </p>
          <p className="mt-1 text-[12.5px] leading-5 text-[var(--muted)]">
            {item.detail}
          </p>
        </div>
      ))}
    </SettingsGroup>
  );
};

const LegalActions: React.FC = () => {
  const { t } = useTranslation();

  return (
    <SettingsGroup title={t("appSections.legal.actionsTitle")}>
      <div className="flex flex-wrap gap-2 px-5 py-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void openModelHub("stt")}
        >
          <Cpu className="h-3.5 w-3.5" aria-hidden />
          {t("appSections.legal.openModelHub")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("vox-jot:navigate", {
                detail: { view: "settings", section: "privacy" },
              }),
            );
          }}
        >
          <Shield className="h-3.5 w-3.5" aria-hidden />
          {t("appSections.legal.openPrivacy")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void openUrl(legalNoticeLink)}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {t("appSections.legal.openNotices")}
        </Button>
      </div>
    </SettingsGroup>
  );
};

const LegalAcknowledgement: React.FC<{
  acknowledged: boolean;
  onChange: (acknowledged: boolean) => void;
}> = ({ acknowledged, onChange }) => {
  const { t } = useTranslation();

  return (
    <SettingsGroup title={t("appSections.legal.ackTitle")}>
      <label className="flex cursor-pointer items-start gap-3 px-5 py-4">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
          checked={acknowledged}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--text)]">
            {t("appSections.legal.ackLabel")}
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-[var(--muted)]">
            {t("appSections.legal.ackDescription")}
          </span>
        </span>
      </label>
    </SettingsGroup>
  );
};

export const LegalModelTermsSection: React.FC = () => {
  const [acknowledged, setAcknowledged] = useState(() => {
    try {
      return window.localStorage.getItem(LEGAL_ACKNOWLEDGEMENT_KEY) === "true";
    } catch {
      return false;
    }
  });

  const updateAcknowledgement = (nextValue: boolean) => {
    setAcknowledged(nextValue);
    try {
      window.localStorage.setItem(
        LEGAL_ACKNOWLEDGEMENT_KEY,
        nextValue ? "true" : "false",
      );
    } catch {
      // Local acknowledgement is informational and should not block settings.
    }
  };

  return (
    <div className="space-y-6">
      <LegalHero acknowledged={acknowledged} />
      <LegalPrincipleGrid />
      <LegalTermsList />
      <LegalActions />
      <LegalAcknowledgement
        acknowledged={acknowledged}
        onChange={updateAcknowledgement}
      />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: Diagnostics
 * ─────────────────────────────────────────────────────────────────────────── */

const DiagnosticsHero: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const experimental = getSetting("experimental_enabled") ?? false;

  return (
    <SectionHero
      icon={<FlaskConical className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.diagnostics.eyebrow")}
      title={t("appSections.hero.diagnostics.title")}
      description={t("appSections.hero.diagnostics.description")}
      tone="warning"
      stats={[
        {
          label: t("appSections.diagnostics.statLabs"),
          value: experimental
            ? t("appSections.diagnostics.statOn")
            : t("appSections.diagnostics.statOff"),
        },
      ]}
      visual={
        <PreviewSlate className="w-full">
          <div className="space-y-2 font-mono text-[10.5px] leading-5 text-[var(--muted)]">
            <p>
              <span className="text-[var(--accent)]">{"$ "}</span>
              {t("appSections.diagnostics.terminalCommand")}
            </p>
            <p>
              <span className="text-[var(--success)]">{"✓ "}</span>
              {t("appSections.diagnostics.terminalServicesOnline")}
            </p>
            <p>
              <span className="text-[var(--success)]">{"✓ "}</span>
              {t("appSections.diagnostics.terminalInputReady")}
            </p>
          </div>
        </PreviewSlate>
      }
    />
  );
};

const DiagnosticsRouteDebugger: React.FC = () => {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const analyzeRoute = async () => {
    const trimmed = text.trim();
    if (!trimmed || running) return;

    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await commands.debugAnalyzePostProcessRoute(trimmed);
      if (response.status === "ok") {
        setResult(JSON.stringify(response.data, null, 2));
      } else {
        setError(response.error || "Unable to analyze route.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to analyze route.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 px-5 py-4">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("settings.debug.routeInputPlaceholder")}
        className="min-h-24"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void analyzeRoute()}
          disabled={running || text.trim().length === 0}
        >
          {running ? "Analyzing..." : "Analyze Route"}
        </Button>
        {error ? (
          <p className="text-sm font-medium text-[var(--danger)]">{error}</p>
        ) : null}
      </div>
      {result ? (
        <pre className="max-h-72 overflow-auto rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] p-4 font-mono text-xs leading-5 text-[var(--text)]">
          {result}
        </pre>
      ) : null}
    </div>
  );
};

export const DiagnosticsSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const debugMode = getSetting("debug_mode") ?? false;

  return (
    <div className="space-y-6">
      <DiagnosticsHero />

      <SettingsGroup
        title={t("appSections.diagnostics.labsTitle")}
        description={t("appSections.diagnostics.labsDescription")}
      >
        <ExperimentalToggle descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.diagnostics.featureHealth.groupTitle")}
        description={t("settings.diagnostics.featureHealth.groupDescription")}
      >
        <FeatureHealthCheckPanel />
      </SettingsGroup>

      {debugMode ? (
        <SettingsGroup
          title={t("appSections.diagnostics.developerTitle")}
          description={t("appSections.diagnostics.developerDescription")}
        >
          <DiagnosticsRouteDebugger />
        </SettingsGroup>
      ) : null}
    </div>
  );
};

export const AutomationAgentsSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const routeSnippets = [
    "GET /v1/health",
    "GET /v1/models",
    "POST /v1/transcribe",
  ];

  return (
    <div className="space-y-6">
      <SectionHero
        icon={<Bot className="h-5 w-5" aria-hidden />}
        eyebrow={t("appSections.automationAgents.eyebrow")}
        title={t("appSections.automationAgents.title")}
        description={t("appSections.automationAgents.description")}
        tone="info"
        stats={[
          {
            label: t("appSections.automationAgents.surfaceLabel"),
            value: t("appSections.automationAgents.surfaceValue"),
          },
          {
            label: t("appSections.automationAgents.authLabel"),
            value: t("appSections.automationAgents.authValue"),
          },
        ]}
        visual={
          <PreviewSlate className="w-full">
            <div className="space-y-2 font-mono text-[11px] text-[var(--muted)]">
              {routeSnippets.map((route) => (
                <p key={route}>{route}</p>
              ))}
            </div>
          </PreviewSlate>
        }
      />

      <SettingsGroup
        title={t("appSections.automationAgents.localApiTitle")}
        description={t("appSections.automationAgents.localApiDescription")}
      >
        <LocalApiToggle grouped={true} />
      </SettingsGroup>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Section: About
 * ─────────────────────────────────────────────────────────────────────────── */

export const AboutSection: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("...");

  useEffect(() => {
    getVersion()
      .then((value) => setVersion(value))
      .catch(() => setVersion(t("appSections.about.versionUnknown")));
  }, [t]);

  const highlights = useMemo(
    () => [
      {
        icon: <Mic className="h-4 w-4" aria-hidden />,
        title: t("appSections.about.highlightLocalTitle"),
        detail: t("appSections.about.highlightLocalDetail"),
        tone: "accent" as const,
      },
      {
        icon: <WandSparkles className="h-4 w-4" aria-hidden />,
        title: t("appSections.about.highlightRefineTitle"),
        detail: t("appSections.about.highlightRefineDetail"),
        tone: "info" as const,
      },
      {
        icon: <Volume2 className="h-4 w-4" aria-hidden />,
        title: t("appSections.about.highlightListenTitle"),
        detail: t("appSections.about.highlightListenDetail"),
        tone: "success" as const,
      },
    ],
    [t],
  );

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_18%,var(--card))_0%,color-mix(in_srgb,var(--accent-gold)_8%,var(--card))_55%,var(--panel-bg)_100%)] px-6 py-8 text-center shadow-[inset_0_1px_0_var(--edge-highlight),0_4px_18px_rgba(0,0,0,0.16)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "16px 16px",
            color: "var(--text)",
          }}
          aria-hidden
        />
        <div className="relative">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[22px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-md)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-[var(--accent)] text-[var(--accent)]">
              <Mic className="h-6 w-6" aria-hidden />
            </div>
          </div>
          <VoxJotTextLogo className="mx-auto mt-4 h-10 w-auto max-w-[220px]" />
          <p className="mt-1 font-mono text-sm text-[var(--muted)]">
            {t("appSections.about.version", { version })}
          </p>
          <p className="mx-auto mt-4 max-w-prose text-[13px] leading-6 text-[var(--muted)]">
            {t("appSections.hero.about.description")}
          </p>
          {!isMacAppStoreBuild && (
            <div className="mt-5 flex justify-center">
              <UpdateChecker />
            </div>
          )}
        </div>
      </div>

      <BoardList title={t("appSections.about.highlightsTitle")} columns={1}>
        <div className="grid gap-3 md:grid-cols-3">
          {highlights.map((highlight) => (
            <MetricTile
              key={highlight.title}
              icon={highlight.icon}
              tone={highlight.tone}
              label={highlight.title}
              value=""
              hint={highlight.detail}
            />
          ))}
        </div>
      </BoardList>

      <BoardList title={t("appSections.about.stackTitle")}>
        <div className="flex flex-wrap items-center gap-2">
          {[
            t("appSections.about.stackTauri"),
            t("appSections.about.stackReact"),
            t("appSections.about.stackRust"),
          ].map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-1 text-[11.5px] font-semibold text-[var(--text)]"
            >
              <SettingsIcon className="h-3 w-3 text-[var(--accent)]" />
              {label}
            </span>
          ))}
        </div>
      </BoardList>

      <SettingsGroup title={t("appSections.groups.acknowledgments")}>
        <div className="space-y-3 px-5 py-4 text-sm leading-6 text-[var(--muted)]">
          <p>{t("appSections.about.summaryPrimary")}</p>
          <p>{t("appSections.about.summarySecondary")}</p>
        </div>
      </SettingsGroup>
    </div>
  );
};
