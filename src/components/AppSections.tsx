import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Cpu,
  Info,
  Mic,
  NotebookPen,
  Pin,
  Plus,
  Shield,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react";
import { ConvoModeView } from "@/components/convo";

import { commands, type Note } from "@/bindings";
import { useSettings, useSettingsSlice } from "@/hooks/useSettings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Dropdown,
  SettingContainer,
  Slider,
  SettingsGroup,
  Textarea,
  ToggleSwitch,
} from "@/components/ui";
import { MicrophoneSelector } from "@/components/settings/MicrophoneSelector";
import { ClamshellMicrophoneSelector } from "@/components/settings/ClamshellMicrophoneSelector";
import { OutputDeviceSelector } from "@/components/settings/OutputDeviceSelector";
import { AlwaysOnMicrophone } from "@/components/settings/AlwaysOnMicrophone";
import { PushToTalk } from "@/components/settings/PushToTalk";
import { AudioEnhancement } from "@/components/settings/AudioEnhancement";
import { AudioFeedback } from "@/components/settings/AudioFeedback";
import { VolumeSlider } from "@/components/settings/VolumeSlider";
import { ShowOverlay } from "@/components/settings/ShowOverlay";
import { ShortcutInput } from "@/components/settings/ShortcutInput";
import { PostProcessingSettings } from "@/components/settings/post-processing/PostProcessingSettings";
import { ModelUnloadTimeoutSetting } from "@/components/settings/ModelUnloadTimeout";
import { StartHidden } from "@/components/settings/StartHidden";
import { AutostartToggle } from "@/components/settings/AutostartToggle";
import { ShowTrayIcon } from "@/components/settings/ShowTrayIcon";
import { PasteMethodSetting } from "@/components/settings/PasteMethod";
import { TypingToolSetting } from "@/components/settings/TypingTool";
import { ClipboardHandlingSetting } from "@/components/settings/ClipboardHandling";
import { AutoSubmit } from "@/components/settings/AutoSubmit";
import { AppendTrailingSpace } from "@/components/settings/AppendTrailingSpace";
import { HistoryLimit } from "@/components/settings/HistoryLimit";
import { RecordingRetentionPeriodSelector } from "@/components/settings/RecordingRetentionPeriod";
import { UpdateChecksToggle } from "@/components/settings/UpdateChecksToggle";
import { AppLanguageSelector } from "@/components/settings/AppLanguageSelector";
import { GlobalLanguageSync } from "@/components/settings/GlobalLanguageSync";
import { ExperimentalToggle } from "@/components/settings/ExperimentalToggle";
import { LocalApiToggle } from "@/components/settings/LocalApiToggle";
import { KeyboardImplementationSelector } from "@/components/settings/debug/KeyboardImplementationSelector";
import { LogLevelSelector } from "@/components/settings/debug/LogLevelSelector";
import { LogDirectory } from "@/components/settings/debug/LogDirectory";
import { PasteDelay } from "@/components/settings/debug/PasteDelay";
import { WordCorrectionThreshold } from "@/components/settings/debug/WordCorrectionThreshold";
import { SoundPicker } from "@/components/settings/SoundPicker";
import { MuteWhileRecording } from "@/components/settings/MuteWhileRecording";
import { AudioDucking } from "@/components/settings/AudioDucking";
import { AppDataDirectory } from "@/components/settings/AppDataDirectory";
import { LanguageSelector } from "@/components/settings/LanguageSelector";
import { ThemeSelector } from "@/components/settings/ThemeSelector";
import { ModelsSettings } from "@/components/settings/models/ModelsSettings";
import { HistorySettings } from "@/components/settings/history/HistorySettings";
import { WriteRulesSettings } from "@/components/settings/write-rules/WriteRulesSettings";
import { CorrectionSettings } from "@/components/settings/corrections/CorrectionSettings";
import { CorrectionDictionaryView } from "@/components/settings/corrections/CorrectionDictionaryView";
import { FileTranscriptionPanel } from "@/components/dictate/FileTranscriptionPanel";
import {
  AutoReadbackSection as AutoReadbackPanel,
  MyVoicesSection as MyVoicesPanel,
  SpeechPackManagerSection,
  ListenVoiceCloningSection as VoiceCloningPanel,
} from "@/components/settings/general/ListenSections";
import { TranslationSettingsCard } from "@/components/settings/general/TranslationSettingsCard";
import RefineModelsSettings from "@/components/settings/llm/RefineModelsSettings";
import { SnippetSettings } from "@/components/settings/snippets/SnippetSettings";
import { SnippetsEnabledToggle } from "@/components/settings/SnippetsEnabledToggle";
import { WriteProfilesCompactCard } from "@/components/settings/WriteProfilesCompactCard";
import { SpeechOutputToggle } from "@/components/settings/SpeechOutputToggle";
import UpdateChecker from "@/components/update-checker";
import { subtleCardClassName } from "@/components/ui/subtleCard";
import VoxJotTextLogo from "@/components/icons/VoxJotTextLogo";

export { subtleCardClassName };
const jotPadEmptyTitle = "Start your first note";
const jotPadEmptyDescription =
  "Dictate or type into the Jot Pad to keep thoughts handy.";
const createNoteLabel = "Create note";
const saveLabel = "Save";
const useDefaultsLabel = "Use Defaults";
const appleIntelligenceModelNotice =
  "Apple Intelligence does not need a separate model override here.";
const saveModelLabel = "Save Model";
const localPrivacyModeNotice =
  "Local Privacy Mode is active. Vox Jot will prefer local cleanup and translation providers.";
const debugRevealNotice =
  "Press Cmd/Ctrl + Shift + D to reveal the deeper debug tools when you need them.";
const routeDebuggerEmptyInput = "Enter some text to inspect.";
const routeDebuggerFailed = "Analysis failed.";
const analyzeRouteLabel = "Analyze Route";
const analyzingRouteLabel = "Analyzing...";
const aboutSummaryPrimary =
  "Vox Jot is built around local speech recognition, translation, and playback tooling including Whisper-family models, TTS engines, and system typing integrations.";
const aboutSummarySecondary =
  "The app combines local audio capture, AI cleanup, history, and Jot Pad into one desktop workflow.";
const smartCorrectionsDemoTitle = "Smart corrections demo";
const smartCorrectionsDemoDescription =
  "Shows how learned fixes become visible without relying on color alone.";
const rawLabel = "Raw";
const fixedLabel = "Fixed";
const correctionDemoPrefix = "I am going";
const correctionDemoWrongWord = "two";
const correctionDemoFixedWord = "to";
const correctionDemoSuffix = "the store";
const processingRoutePreviewTitle = "Processing route preview";
const processingRoutePreviewDescription =
  "Dictation starts on-device; optional cleanup follows the selected refine provider.";
const recordingRetentionPreviewTitle = "Recording retention";
const day1Label = "Day 1";
const day7Label = "Day 7";
const day30Label = "Day 30";
const routeMonitorLabel = "Route monitor";

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

const CorrectionsDemoCard: React.FC = () => (
  <div className={subtleCardClassName}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-[var(--text)]">
          {smartCorrectionsDemoTitle}
        </p>
        <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
          {smartCorrectionsDemoDescription}
        </p>
      </div>
      <MiniStatusPill
        icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
        label="Correction applied"
        tone="success"
      />
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle,var(--muted))]">
          {rawLabel}
        </p>
        <p className="mt-2 text-sm text-[var(--text)]">
          {correctionDemoPrefix}{" "}
          <span className="underline decoration-[var(--warning)] decoration-2">
            {correctionDemoWrongWord}
          </span>{" "}
          {correctionDemoSuffix}
        </p>
      </div>
      <ArrowRight className="hidden h-4 w-4 text-[var(--muted)] md:block" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle,var(--muted))]">
          {fixedLabel}
        </p>
        <p className="mt-2 text-sm text-[var(--text)]">
          {correctionDemoPrefix}{" "}
          <span className="rounded bg-[var(--accent-gold-soft)] px-1 font-bold underline decoration-[var(--accent-gold)] decoration-2">
            {correctionDemoFixedWord}
          </span>{" "}
          {correctionDemoSuffix}
        </p>
      </div>
    </div>
  </div>
);

const AIProcessingRoutePreview: React.FC = () => {
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
    <div className={subtleCardClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">
            {processingRoutePreviewTitle}
          </p>
          <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
            {processingRoutePreviewDescription}
          </p>
        </div>
        <MiniStatusPill
          icon={
            localProvider ? (
              <Shield className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Wifi className="h-3.5 w-3.5" aria-hidden />
            )
          }
          label={localProvider ? "Local route" : "Cloud route"}
          tone={localProvider ? "success" : "info"}
        />
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <RouteCard
          selected={localProvider}
          icon={<Cpu className="h-5 w-5" aria-hidden />}
          title="Local AI"
          detail="Mic -> device model -> paste"
          badge="Offline capable"
        />
        <RouteCard
          selected={!localProvider}
          icon={<Cloud className="h-5 w-5" aria-hidden />}
          title="Cloud AI"
          detail="Mic -> network -> provider"
          badge="Uses internet"
        />
      </div>
    </div>
  );
};

const RouteCard: React.FC<{
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  badge: string;
}> = ({ selected, icon, title, detail, badge }) => (
  <div
    className={`rounded-lg border p-3 ${
      selected
        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
        : "border-[var(--border)] bg-[var(--panel-bg)]"
    }`}
  >
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[var(--text)]">
        <span className="text-[var(--accent)]">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {selected ? (
        <CheckCircle2 className="h-4 w-4 text-[var(--accent)]" />
      ) : null}
    </div>
    <p className="mt-3 text-xs font-medium text-[var(--text)]">{detail}</p>
    <p className="mt-1 text-xs text-[var(--muted)]">{badge}</p>
  </div>
);

const RetentionTimelinePreview: React.FC = () => {
  const { getSetting } = useSettings();
  const retention = getSetting("recording_retention_period") ?? "never";
  const labels: Record<string, string> = {
    never: "Keep until removed",
    preserve_limit: "Keep saved history limit",
    days3: "Delete after 3 days",
    weeks2: "Delete after 2 weeks",
    months3: "Delete after 3 months",
  };

  return (
    <div className="px-4 py-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            {recordingRetentionPreviewTitle}
          </p>
          <MiniStatusPill
            icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
            label={labels[retention] ?? labels.never}
            tone={retention === "never" ? "success" : "warning"}
          />
        </div>
        <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-2 text-xs font-semibold text-[var(--text)]">
          <span>{day1Label}</span>
          <span className="h-px bg-[var(--border)]" aria-hidden />
          <span>{day7Label}</span>
          <span className="h-px bg-[var(--border)]" aria-hidden />
          <span>{day30Label}</span>
          <span className="h-px bg-[var(--border)]" aria-hidden />
          <Trash2
            className="h-4 w-4 text-[var(--warning)]"
            aria-label="Auto-delete"
          />
        </div>
      </div>
    </div>
  );
};

export const DictateModelsSection: React.FC<{
  titleActionTargetId?: string;
  showActiveModelBanner?: boolean;
  hubSearchQuery?: string;
  hubFilterLabels?: boolean;
}> = ({
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery,
  hubFilterLabels,
}) => {
  return (
    <div className="space-y-6">
      <ModelsSettings
        titleActionTargetId={titleActionTargetId}
        showActiveModelBanner={showActiveModelBanner}
        hubSearchQuery={hubSearchQuery}
        hubFilterLabels={hubFilterLabels}
      />
    </div>
  );
};

export const DictateHistorySection: React.FC = () => {
  return (
    <div className="space-y-6">
      <HistorySettings />
    </div>
  );
};

export const FileTranscriptionSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <FileTranscriptionPanel />
    </div>
  );
};

export const RefineTranslationSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <SettingsGroup title="Translation">
        <TranslationSettingsCard />
      </SettingsGroup>
    </div>
  );
};

export const RefinePhraseKeysSection: React.FC = () => {
  return (
    <SnippetSettings
      showEnabledToggle={false}
      titleActionTargetId="phrase-keys-section-actions"
    />
  );
};

export const RefineProfilesSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <WriteRulesSettings />
    </div>
  );
};

export const RefineModelsSection: React.FC<{
  titleActionTargetId?: string;
  hubSearchQuery?: string;
  onHubSearchQueryChange?: (value: string) => void;
  hubFilterLabels?: boolean;
}> = ({
  titleActionTargetId,
  hubSearchQuery,
  onHubSearchQueryChange,
  hubFilterLabels,
}) => {
  return (
    <div className="space-y-6">
      <RefineModelsSettings
        titleActionTargetId={titleActionTargetId}
        hubSearchQuery={hubSearchQuery}
        onHubSearchQueryChange={onHubSearchQueryChange}
        hubFilterLabels={hubFilterLabels}
      />
    </div>
  );
};

export const CorrectionsSection: React.FC = () => {
  return (
    <LearnedCorrectionsSection titleActionTargetId="corrections-section-actions" />
  );
};

/** Full dictionary & correction controls (info, toggles, boosts). Shown in Settings. */
export const CorrectionsSettingsSection: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className={subtleCardClassName}>
        <p className="text-base font-semibold text-[var(--text)]">
          {t("settings.corrections.title")}
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {t("settings.corrections.description")}
        </p>
      </div>
      <CorrectionsDemoCard />
      <CorrectionSettings />
    </div>
  );
};

export const LearnedCorrectionsSection: React.FC<{
  titleActionTargetId?: string;
}> = ({ titleActionTargetId }) => {
  return (
    <div className="space-y-6">
      <CorrectionDictionaryView
        sectionTitle="Learned Corrections"
        showHeaderTitle={false}
        titleActionTargetId={titleActionTargetId}
      />
    </div>
  );
};

export const ListenMyVoicesSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <MyVoicesPanel showGroupTitle={false} />
    </div>
  );
};

export const ListenVoiceCloningSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <VoiceCloningPanel showGroupTitle={false} />
    </div>
  );
};

export const ListenAutoReadbackSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <AutoReadbackPanel showGroupTitle={false} />
    </div>
  );
};

const NoteRow: React.FC<{ note: Note; onOpen: () => void }> = ({
  note,
  onOpen,
}) => {
  const title =
    note.title.trim() ||
    note.content.trim().split("\n")[0].slice(0, 60) ||
    "Untitled";
  const preview = note.content.trim()
    ? note.content.trim().split("\n").slice(0, 2).join(" ").slice(0, 100)
    : "Empty note";
  const date = new Date(note.updated_at * 1000);
  const formattedDate = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text),transparent_94%)]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--text)]">
            {title}
          </span>
          {note.is_pinned && (
            <Pin className="h-3 w-3 shrink-0 rotate-45 text-[var(--accent)]" />
          )}
        </div>
        <p className="mt-0.5 truncate text-xs font-normal leading-snug text-[var(--text)]">
          {preview}
        </p>
      </div>
      <span className="shrink-0 text-xs text-[var(--muted)]">
        {formattedDate}
      </span>
    </button>
  );
};

export const JotPadSection: React.FC = () => {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotes = useCallback(() => {
    commands
      .getNotes()
      .then((result) => {
        if (result.status === "ok") {
          setNotes(result.data);
        }
      })
      .catch(() => {
        setNotes([]);
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    const unlisten = listen("notes-updated", () => {
      loadNotes();
    });

    return () => {
      unlisten.then((cleanup) => cleanup());
    };
  }, [loadNotes]);

  const openNoteInJotPad = useCallback(async (noteId?: number) => {
    if (noteId !== undefined) {
      await commands.showScratchpadForNote(noteId);
      return;
    }

    await commands.showScratchpad();
  }, []);

  const createNote = useCallback(async () => {
    const result = await commands.createNote("", "");
    if (result.status === "ok") {
      loadNotes();
      void openNoteInJotPad(result.data.id);
    }
  }, [loadNotes, openNoteInJotPad]);

  // Sort: pinned first, then by updated_at desc
  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return b.updated_at - a.updated_at;
    });
  }, [notes]);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-8 text-center text-sm text-[var(--muted)] shadow-[var(--shadow-sm)]">
          Loading notes...
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="h-5 w-5" aria-hidden />}
          title={t("jotPad.empty", { defaultValue: jotPadEmptyTitle })}
          description={t("jotPad.emptyDescription", {
            defaultValue: jotPadEmptyDescription,
          })}
          example={t("jotPad.emptyExample", {
            defaultValue:
              "For example, dictate meeting notes here, then ask Convo to turn them into a clean summary.",
          })}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void createNote()}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("jotPad.createFirst", { defaultValue: createNoteLabel })}
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
          {sortedNotes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onOpen={() => void openNoteInJotPad(note.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const GeneralAppSettingsSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <SettingsGroup title="Dictation">
        <LanguageSelector descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title="App">
        <ThemeSelector descriptionMode="tooltip" grouped={true} />
        <StartHidden descriptionMode="tooltip" grouped={true} />
        <AutostartToggle descriptionMode="tooltip" grouped={true} />
        <ShowTrayIcon descriptionMode="tooltip" grouped={true} />
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
        <GlobalLanguageSync descriptionMode="tooltip" grouped={true} />
        <UpdateChecksToggle descriptionMode="tooltip" grouped={true} />
        <ModelUnloadTimeoutSetting descriptionMode="inline" grouped={true} />
      </SettingsGroup>

      <SpeechPackManagerSection />

      <SettingsGroup title="Write Profiles">
        <WriteProfilesCompactCard />
      </SettingsGroup>

      <SettingsGroup title="Feature Toggles">
        <SpeechOutputToggle descriptionMode="tooltip" grouped={true} />
        <SnippetsEnabledToggle descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
    </div>
  );
};

export const ShortcutsSettingsSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <SettingsGroup title="Dictation Shortcuts">
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <ShortcutInput
          shortcutId="transcribe_with_post_process"
          grouped={true}
        />
        <ShortcutInput shortcutId="toggle_command_menu" grouped={true} />
        <PushToTalk descriptionMode="tooltip" grouped={true} />
        <ShortcutInput shortcutId="cancel" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title="Text Action Shortcuts">
        <ShortcutInput shortcutId="rewrite_selection" grouped={true} />
        <ShortcutInput shortcutId="translate_selection" grouped={true} />
        <ShortcutInput shortcutId="speak_selection" grouped={true} />
        <ShortcutInput shortcutId="speak_last_output" grouped={true} />
        <ShortcutInput shortcutId="stop_speaking" grouped={true} />
      </SettingsGroup>
    </div>
  );
};

const CustomFillerWordsSetting: React.FC = () => {
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
      title="Custom Filler Words"
      description="Add one filler word per line to override the default speech cleanup list. Leave this blank to use Vox Jot's defaults."
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="space-y-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={"um\nuh\nlike"}
          className="min-h-[120px]"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => void saveDraft()}
            disabled={isUpdating("custom_filler_words")}
          >
            {saveLabel}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void updateSetting("custom_filler_words", null)}
            disabled={isUpdating("custom_filler_words")}
          >
            {useDefaultsLabel}
          </Button>
        </div>
      </div>
    </SettingContainer>
  );
};

export const RecordingDevicesSettingsSection: React.FC = () => {
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
      <SettingsGroup>
        <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <ClamshellMicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <AlwaysOnMicrophone descriptionMode="inline" grouped={true} />
        <MuteWhileRecording descriptionMode="inline" grouped={true} />
        <AudioDucking descriptionMode="inline" grouped={true} />
        <AudioFeedback descriptionMode="tooltip" grouped={true} />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
        <ShowOverlay descriptionMode="inline" grouped={true} />
        <SoundPicker
          label="Sound Theme"
          description="Choose the start and stop cue sounds Vox Jot plays around recording."
        />
      </SettingsGroup>

      <SettingsGroup title="Speech Output Device">
        <OutputDeviceSelector
          descriptionMode="tooltip"
          grouped={true}
          disabled={!((audioFeedbackEnabled ?? false) || (ttsEnabled ?? false))}
        />
        <div className="border-t border-[var(--border)]">
          <Slider
            value={ttsVolume ?? 1}
            onChange={(value) => void updateSetting("tts_volume", value)}
            min={0}
            max={1}
            step={0.05}
            label="Speech Volume"
            description="Global playback volume for spoken output on the selected output device."
            descriptionMode="tooltip"
            grouped={true}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            disabled={!ttsEnabled}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Speech Cleanup">
        <AudioEnhancement descriptionMode="tooltip" grouped={true} />
        <CustomFillerWordsSetting />
      </SettingsGroup>
    </div>
  );
};

export const OutputPasteSettingsSection: React.FC = () => {
  const { getSetting } = useSettings();
  const debugMode = getSetting("debug_mode") ?? false;

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <PasteMethodSetting descriptionMode="inline" grouped={true} />
        <TypingToolSetting descriptionMode="inline" grouped={true} />
        <ClipboardHandlingSetting descriptionMode="inline" grouped={true} />
        <AutoSubmit descriptionMode="inline" grouped={true} />
        <AppendTrailingSpace descriptionMode="inline" grouped={true} />
        {debugMode ? (
          <PasteDelay descriptionMode="inline" grouped={true} />
        ) : null}
      </SettingsGroup>
    </div>
  );
};

const TranslationProviderSettingsCard: React.FC = () => {
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
    <div className="space-y-6">
      <SettingsGroup title="Translation Provider Overrides">
        <SettingContainer
          title="Translation Provider"
          description="Choose which provider handles translation when Vox Jot uses AI-assisted translation routes."
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
            placeholder="Choose a provider"
          />
        </SettingContainer>

        <SettingContainer
          title="Translation Model"
          description="Pick a provider-specific translation model. This uses the same provider catalog as cleanup and rewrite setup."
          descriptionMode="tooltip"
          grouped={true}
          layout="stacked"
          disabled={!providerId || providerId === "apple_intelligence"}
        >
          {providerId === "apple_intelligence" ? (
            <p className="text-sm text-[var(--muted)]">
              {appleIntelligenceModelNotice}
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
                  placeholder="Choose or type a model"
                />
              )}
              <div className="flex flex-col gap-3 md:flex-row">
                <Input
                  value={modelDraft}
                  onChange={(event) => setModelDraft(event.target.value)}
                  placeholder="Type a custom translation model id"
                  className="flex-1 min-h-[44px]"
                />
                <Button size="sm" onClick={() => void saveModel()}>
                  {saveModelLabel}
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
          label="Translate Phrase Keys"
          description="Apply translation rules to phrase-key expansions when they are inserted into translated output."
          descriptionMode="tooltip"
          grouped={true}
        />
      </SettingsGroup>
    </div>
  );
};

const FileTranscriptionHint: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className={`${subtleCardClassName} text-sm text-[var(--muted)]`}>
      {t("settings.general.fileTranscription.movedHint", {
        defaultValue:
          "File transcription moved to Dictate → File Transcription. Drag in an audio or video file to transcribe it.",
      })}
    </div>
  );
};

export const AISetupSettingsSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <AIProcessingRoutePreview />
      <RefineModelsSettings />
      <PostProcessingSettings omitLocalPrivacy />
      <TranslationProviderSettingsCard />
      <FileTranscriptionHint />
    </div>
  );
};

export const PrivacyStorageSettingsSection: React.FC = () => {
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const localPrivacyMode = getSetting("local_privacy_mode") ?? false;
  const debugMode = getSetting("debug_mode") ?? false;

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <ToggleSwitch
          checked={localPrivacyMode}
          onChange={(enabled) =>
            void updateSetting("local_privacy_mode", enabled)
          }
          isUpdating={isUpdating("local_privacy_mode")}
          label="Local Privacy Mode"
          description="Keep cleanup and translation on local routes when possible and disable cloud-only behavior when no local route is available."
          descriptionMode="inline"
          grouped={true}
        />
        <HistoryLimit descriptionMode="inline" grouped={true} />
        <RetentionTimelinePreview />
        <RecordingRetentionPeriodSelector
          descriptionMode="inline"
          grouped={true}
        />
        <AppDataDirectory descriptionMode="tooltip" grouped={true} />
        {debugMode ? <LogDirectory grouped={true} /> : null}
      </SettingsGroup>

      {localPrivacyMode && (
        <Alert variant="info">{localPrivacyModeNotice}</Alert>
      )}
    </div>
  );
};

export const DiagnosticsSettingsSection: React.FC = () => {
  const { getSetting } = useSettings();
  const debugMode = getSetting("debug_mode") ?? false;

  return (
    <div className="space-y-6">
      <SettingsGroup title="Labs">
        <ExperimentalToggle descriptionMode="tooltip" grouped={true} />
        {debugMode ? (
          <KeyboardImplementationSelector
            descriptionMode="tooltip"
            grouped={true}
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Local API">
        <LocalApiToggle grouped={true} />
      </SettingsGroup>

      {debugMode ? (
        <>
          <SettingsGroup>
            <LogLevelSelector grouped={true} />
            <WordCorrectionThreshold descriptionMode="tooltip" grouped={true} />
          </SettingsGroup>
          <DebugDiagnosticsPanel />
        </>
      ) : (
        <Alert variant="info">{debugRevealNotice}</Alert>
      )}
    </div>
  );
};

const DebugDiagnosticsPanel: React.FC = () => {
  const [routeInput, setRouteInput] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<Record<
    string,
    unknown
  > | null>(null);

  const analyzeRoute = async () => {
    if (!routeInput.trim()) {
      setRouteError(routeDebuggerEmptyInput);
      setRouteResult(null);
      return;
    }

    setRouteLoading(true);
    setRouteError(null);

    try {
      const result = await commands.debugAnalyzePostProcessRoute(routeInput);
      if (result.status === "ok") {
        setRouteResult(result.data as unknown as Record<string, unknown>);
      } else {
        setRouteError(result.error);
      }
    } catch (error) {
      setRouteError(
        error instanceof Error ? error.message : routeDebuggerFailed,
      );
    } finally {
      setRouteLoading(false);
    }
  };

  return (
    <SettingsGroup title="Route Debugger">
      <div className="space-y-3 px-5 py-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
              <Cpu className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              {routeMonitorLabel}
            </div>
            <MiniStatusPill
              icon={
                routeError ? (
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                ) : routeResult ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Info className="h-3.5 w-3.5" aria-hidden />
                )
              }
              label={
                routeError ? "Error" : routeResult ? "Analyzed" : "Waiting"
              }
              tone={
                routeError ? "warning" : routeResult ? "success" : "default"
              }
            />
          </div>
          <div className="space-y-2 font-mono text-xs leading-5 text-[var(--text)]">
            <p>
              <span className="text-[var(--muted)]">&gt;</span>{" "}
              {routeInput.trim()
                ? "Input staged for route analysis"
                : "Waiting for dictation input..."}
            </p>
            <p>
              <span className="text-[var(--muted)]">&gt;</span>{" "}
              {routeLoading
                ? "Analyzing route..."
                : routeResult
                  ? "Route analysis complete"
                  : "Analyze Route ready"}
            </p>
          </div>
        </div>
        <Textarea
          value={routeInput}
          onChange={(event) => setRouteInput(event.target.value)}
          placeholder="Paste some dictated text to inspect the cleanup route."
          className="min-h-[120px]"
        />
        <div className="flex gap-2">
          <Button onClick={() => void analyzeRoute()} disabled={routeLoading}>
            {routeLoading ? analyzingRouteLabel : analyzeRouteLabel}
          </Button>
        </div>
        {routeError && <Alert variant="error">{routeError}</Alert>}
        {routeResult && (
          <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-4 text-xs text-[var(--text)]">
            {JSON.stringify(routeResult, null, 2)}
          </pre>
        )}
      </div>
    </SettingsGroup>
  );
};

export const AboutSection: React.FC = () => {
  const [version, setVersion] = useState("...");

  useEffect(() => {
    getVersion()
      .then((value) => setVersion(value))
      .catch(() => setVersion("unknown"));
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-5 py-6 text-center shadow-[var(--shadow-sm)]">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[22px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-md)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-[var(--accent)] text-[var(--accent)]">
            <Mic className="h-6 w-6" aria-hidden />
          </div>
        </div>
        <VoxJotTextLogo className="mx-auto mt-4 h-10 w-auto max-w-[220px]" />
        <p className="mt-1 font-mono text-sm text-[var(--muted)]">{`Version ${version}`}</p>
        <div className="mt-5 flex justify-center">
          <UpdateChecker />
        </div>
      </div>

      <SettingsGroup title="Acknowledgments">
        <div className="space-y-3 px-5 py-4 text-sm leading-6 text-[var(--muted)]">
          <p>{aboutSummaryPrimary}</p>
          <p>{aboutSummarySecondary}</p>
        </div>
      </SettingsGroup>
    </div>
  );
};

export const ConvoSelectionSection: React.FC = () => {
  return (
    <div className="-mx-6 -mt-5 md:-mx-8 flex h-[calc(100vh-14rem)] flex-col">
      <ConvoModeView mode="selection" />
    </div>
  );
};

export const ConvoJotpadSection: React.FC = () => {
  return (
    <div className="-mx-6 -mt-5 md:-mx-8 flex h-[calc(100vh-14rem)] flex-col">
      <ConvoModeView mode="jotpad" />
    </div>
  );
};

export const ConvoSettingsCoachSection: React.FC = () => {
  return (
    <div className="-mx-6 -mt-5 md:-mx-8 flex h-[calc(100vh-14rem)] flex-col">
      <ConvoModeView mode="settings_coach" />
    </div>
  );
};

export const ConvoFilesContextSection: React.FC = () => {
  return (
    <div className="-mx-6 -mt-5 md:-mx-8 flex h-[calc(100vh-14rem)] flex-col">
      <ConvoModeView mode="files_context" />
    </div>
  );
};
