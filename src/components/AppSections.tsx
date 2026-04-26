import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { ArrowRight, NotebookPen, Pin, Plus } from "lucide-react";
import { ConvoModeView } from "@/components/convo";

import { commands, type Note } from "@/bindings";
import { useSettings, useSettingsSlice } from "@/hooks/useSettings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
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
import { CorrectionTrackingToggle } from "@/components/settings/CorrectionTrackingToggle";
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
import { StylesSettings } from "@/components/settings/styles/StylesSettings";
import { WriteRulesSettings } from "@/components/settings/write-rules/WriteRulesSettings";
import { CorrectionSettings } from "@/components/settings/corrections/CorrectionSettings";
import { CorrectionDictionaryView } from "@/components/settings/corrections/CorrectionDictionaryView";
import { FileTranscriptionPanel } from "@/components/dictate/FileTranscriptionPanel";
import {
  AutoReadbackSection as AutoReadbackPanel,
  MyVoicesSection as MyVoicesPanel,
  EngineLibrarySection as EngineLibraryPanel,
  SpeechPackManagerSection,
  ListenVoiceCloningSection as VoiceCloningPanel,
} from "@/components/settings/general/ListenSections";
import { TranslationSettingsCard } from "@/components/settings/general/TranslationSettingsCard";
import RefineModelsSettings from "@/components/settings/llm/RefineModelsSettings";
import { SnippetSettings } from "@/components/settings/snippets/SnippetSettings";
import { SnippetsEnabledToggle } from "@/components/settings/SnippetsEnabledToggle";
import { AppAwareWriteProfilesToggle } from "@/components/settings/AppAwareWriteProfilesToggle";
import { SpeechOutputToggle } from "@/components/settings/SpeechOutputToggle";
import UpdateChecker from "@/components/update-checker";
import { subtleCardClassName } from "@/components/ui/subtleCard";

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

type WorkflowMode = "dictate" | "refine" | "listen";

type WorkflowSectionProps = {
  onNavigateToSection: (mode: WorkflowMode, sectionId: string) => void;
};

const WorkflowLinkCard: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ eyebrow, title, description, actionLabel, onAction }) => {
  return (
    <div className={subtleCardClassName}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
        {eyebrow}
      </p>
      <p className="mt-2 text-lg font-bold text-[var(--text)]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mt-4 inline-flex items-center gap-2"
        onClick={onAction}
      >
        {actionLabel}
        <ArrowRight className="h-4 w-4" />
      </Button>
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

export const AppMappingsSection: React.FC = () => {
  return (
    <div className="space-y-6">
      <StylesSettings
        showEnabledToggle={false}
        visibleSections="mappings-only"
      />
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
  return <CorrectionSettings showTrackingToggle={false} />;
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

export const ListenEngineLibrarySection: React.FC<WorkflowSectionProps> = ({
  onNavigateToSection,
}) => {
  return (
    <div className="space-y-6">
      <EngineLibraryPanel
        showGroupTitle={false}
        titleActionTargetId="engine-library-section-actions"
      />

      <WorkflowLinkCard
        eyebrow="Need Past Sessions?"
        title="Recording Review Lives in Dictate"
        description="History and recordings now stay with the capture workflow. Use Dictate when you want to replay older sessions or inspect archived output."
        actionLabel="Open Dictate History"
        onAction={() => onNavigateToSection("dictate", "history")}
      />
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
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{preview}</p>
      </div>
      <span className="shrink-0 text-xs text-[var(--muted)]">
        {formattedDate}
      </span>
    </button>
  );
};

export const JotPadSection: React.FC = () => {
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
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-8 text-center shadow-[var(--shadow-sm)]">
          <NotebookPen className="mx-auto h-8 w-8 text-[var(--muted)] opacity-50" />
          <p className="mt-3 text-sm font-medium text-[var(--text)]">
            {jotPadEmptyTitle}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {jotPadEmptyDescription}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-4"
            onClick={() => void createNote()}
          >
            <Plus className="mr-1 h-4 w-4" />
            {createNoteLabel}
          </Button>
        </div>
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
        <LanguageSelector descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title="App">
        <ThemeSelector descriptionMode="tooltip" grouped={true} />
        <StartHidden descriptionMode="tooltip" grouped={true} />
        <AutostartToggle descriptionMode="tooltip" grouped={true} />
        <ShowTrayIcon descriptionMode="tooltip" grouped={true} />
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
        <GlobalLanguageSync descriptionMode="tooltip" grouped={true} />
        <UpdateChecksToggle descriptionMode="tooltip" grouped={true} />
        <ModelUnloadTimeoutSetting descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SpeechPackManagerSection />

      <SettingsGroup title="Feature Toggles">
        <SpeechOutputToggle descriptionMode="tooltip" grouped={true} />
        <SnippetsEnabledToggle descriptionMode="tooltip" grouped={true} />
        <AppAwareWriteProfilesToggle descriptionMode="tooltip" grouped={true} />
        <CorrectionTrackingToggle descriptionMode="tooltip" grouped={true} />
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
        <AlwaysOnMicrophone descriptionMode="tooltip" grouped={true} />
        <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
        <AudioDucking descriptionMode="tooltip" grouped={true} />
        <AudioFeedback descriptionMode="tooltip" grouped={true} />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
        <ShowOverlay descriptionMode="tooltip" grouped={true} />
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
        <PasteMethodSetting descriptionMode="tooltip" grouped={true} />
        <TypingToolSetting descriptionMode="tooltip" grouped={true} />
        <ClipboardHandlingSetting descriptionMode="tooltip" grouped={true} />
        <AutoSubmit descriptionMode="tooltip" grouped={true} />
        <AppendTrailingSpace descriptionMode="tooltip" grouped={true} />
        {debugMode ? (
          <PasteDelay descriptionMode="tooltip" grouped={true} />
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
          descriptionMode="tooltip"
          grouped={true}
        />
        <HistoryLimit descriptionMode="tooltip" grouped={true} />
        <RecordingRetentionPeriodSelector
          descriptionMode="tooltip"
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
          <pre className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 text-xs text-[var(--text)]">
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
      <SettingsGroup>
        <SettingContainer
          title="Version"
          description="Current installed app version."
          grouped={true}
        >
          <span className="font-mono text-sm">{`v${version}`}</span>
        </SettingContainer>
        <SettingContainer
          title="Updates"
          description="Check for a newer version of Vox Jot."
          grouped={true}
        >
          <UpdateChecker />
        </SettingContainer>
      </SettingsGroup>

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
