import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type { StoryCastMemberDraft } from "./storyScript";

const castTitle = "Cast";
const castDescription = "Assign saved Listen voices to script characters.";
const addCharacterLabel = "Add Character";
const characterLabel = "Character";
const voicePresetLabel = "Voice Preset";
const actionLabel = "Action";
const chooseVoiceLabel = "Choose voice";

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
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {castTitle}
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">{castDescription}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAdd}
          disabled={disabled || presets.length === 0}
        >
          <Plus className="h-4 w-4" />
          {addCharacterLabel}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <div className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_3rem] gap-2 border-b border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
          <span>{characterLabel}</span>
          <span>{voicePresetLabel}</span>
          <span className="sr-only">{actionLabel}</span>
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
                placeholder="Narrator"
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
                <option value="">{chooseVoiceLabel}</option>
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
                onClick={() => onRemove(member.id)}
                disabled={disabled || cast.length <= 1}
                title="Remove character"
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
