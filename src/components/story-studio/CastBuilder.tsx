import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import type { StoryCastMemberDraft } from "./storyScript";

interface CastBuilderProps {
  cast: StoryCastMemberDraft[];
  presets: TtsVoicePreset[];
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<StoryCastMemberDraft>) => void;
}

export const CastBuilder: React.FC<CastBuilderProps> = ({
  cast,
  presets,
  disabled = false,
  onAdd,
  onRemove,
  onUpdate,
}) => {
  const { t } = useTranslation();

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
          variant="secondary"
          size="sm"
          onClick={onAdd}
          disabled={disabled || presets.length === 0}
        >
          <Plus className="h-4 w-4" />
          {t("storyStudio.cast.addCharacter")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
        <div className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_3rem] gap-2 border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
          <span>{t("storyStudio.cast.character")}</span>
          <span>{t("storyStudio.cast.voicePreset")}</span>
          <span className="sr-only">{t("storyStudio.cast.action")}</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {cast.map((member) => (
            <div
              key={member.id}
              className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_3rem] items-center gap-2 px-3 py-2"
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
              <select
                value={member.presetId}
                onChange={(event) =>
                  onUpdate(member.id, { presetId: event.target.value })
                }
                disabled={disabled || presets.length === 0}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-sm font-medium text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value="">{t("storyStudio.cast.chooseVoice")}</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="danger-ghost"
                size="icon-sm"
                onClick={() => {
                  if (
                    confirmDestructiveAction(
                      t("storyStudio.cast.removeConfirm", {
                        name: member.characterName,
                      }),
                    )
                  ) {
                    onRemove(member.id);
                  }
                }}
                disabled={disabled || cast.length <= 1}
                title={t("storyStudio.cast.removeCharacter")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
