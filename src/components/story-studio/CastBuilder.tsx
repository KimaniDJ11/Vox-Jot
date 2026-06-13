import React, { useState } from "react";
import { Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type { CreateVoiceHubVoiceRow } from "@/components/settings/general/listen/createVoiceVoiceHub";
import { ReaderVoicePicker } from "@/components/dictate/reader/ReaderVoicePicker";
import type { StoryCastMemberDraft } from "./storyScript";

interface CastBuilderProps {
  cast: StoryCastMemberDraft[];
  presets: TtsVoicePreset[];
  presetVoices: CreateVoiceHubVoiceRow[];
  ttsModels?: CatalogModelDescriptor[];
  isLoadingVoiceChoices?: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<StoryCastMemberDraft>) => void;
  onCreatePresetFromVoice: (voice: CreateVoiceHubVoiceRow) => Promise<string>;
}

export const CastBuilder: React.FC<CastBuilderProps> = ({
  cast,
  presets,
  presetVoices,
  ttsModels = [],
  isLoadingVoiceChoices = false,
  disabled = false,
  onAdd,
  onRemove,
  onUpdate,
  onCreatePresetFromVoice,
}) => {
  const { t } = useTranslation();
  const loadingVoicesLabel = t("storyStudio.cast.loadingVoices");
  const placeholder = t("storyStudio.cast.chooseVoice");
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null,
  );
  const hasVoiceChoices = presets.length > 0 || presetVoices.length > 0;
  const voicePickerDisabled =
    disabled || (!hasVoiceChoices && isLoadingVoiceChoices);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t("storyStudio.cast.title")}
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("storyStudio.cast.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={voicePickerDisabled || !hasVoiceChoices}
        >
          <span
            className="inline-flex h-4 w-4 items-center justify-center text-[1.15em] font-bold leading-none text-[var(--accent-hover)]"
            aria-hidden
          >
            +
          </span>
          {t("storyStudio.cast.addCharacter")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
        <div className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_5.5rem] gap-2 border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
          <span>{t("storyStudio.cast.character")}</span>
          <span>{t("storyStudio.cast.voicePreset")}</span>
          <span className="sr-only">{t("storyStudio.cast.action")}</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {cast.map((member) => (
            <div
              key={member.id}
              className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_5.5rem] items-center gap-2 px-3 py-2"
            >
              <Input
                value={member.characterName}
                onChange={(event) =>
                  onUpdate(member.id, { characterName: event.target.value })
                }
                disabled={disabled}
                placeholder={t("storyStudio.cast.characterPlaceholder")}
                className="w-full rounded-lg border-[var(--border)] bg-[var(--input)] text-[var(--text)]"
              />
              <ReaderVoicePicker
                value={member.presetId || null}
                presets={presets}
                presetVoices={presetVoices}
                ttsModels={ttsModels}
                triggerSize="md"
                allowDefault={false}
                disabled={voicePickerDisabled}
                defaultLabel={placeholder}
                isLoading={isLoadingVoiceChoices && !hasVoiceChoices}
                loadingLabel={loadingVoicesLabel}
                onSelectPreset={(presetId) => onUpdate(member.id, { presetId })}
                onSelectDefault={() => {}}
                onCreatePresetFromVoice={onCreatePresetFromVoice}
              />
              <div className="flex justify-end gap-1">
                {confirmingRemoveId === member.id ? (
                  <>
                    <ActionIconButton
                      tone="confirm"
                      onClick={() => {
                        onRemove(member.id);
                        setConfirmingRemoveId(null);
                      }}
                      disabled={disabled || cast.length <= 1}
                      title={t("storyStudio.cast.removeCharacter")}
                      aria-label={t("storyStudio.cast.removeConfirm", {
                        name: member.characterName,
                      })}
                    >
                      <Trash2 aria-hidden />
                    </ActionIconButton>
                    <ActionIconButton
                      onClick={() => setConfirmingRemoveId(null)}
                      disabled={disabled}
                      title={t("common.cancel", { defaultValue: "Cancel" })}
                      aria-label={t("common.cancel", {
                        defaultValue: "Cancel",
                      })}
                    >
                      <X aria-hidden />
                    </ActionIconButton>
                  </>
                ) : (
                  <ActionIconButton
                    tone="danger"
                    onClick={() => setConfirmingRemoveId(member.id)}
                    disabled={disabled || cast.length <= 1}
                    title={t("storyStudio.cast.removeCharacter")}
                    aria-label={t("storyStudio.cast.removeCharacter")}
                  >
                    <Trash2 aria-hidden />
                  </ActionIconButton>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
