import React from "react";
import type { SpeechAnalysisModelDescriptor } from "@/bindings";
import { useTranslation } from "react-i18next";
import { voiceAvatarGradient } from "@/components/settings/general/listen/createVoiceVoiceHub";

export const SelectedAsrModelInline: React.FC<{
  model: SpeechAnalysisModelDescriptor | null;
}> = ({ model }) => {
  const { t } = useTranslation();
  if (!model) return null;

  const label = t("dictate.fileTranscription.selectedModelTitle", {
    model: model.label,
    defaultValue: "Selected model: {{model}}",
  });

  return (
    <div
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-[var(--muted)]"
      aria-label={label}
      title={label}
    >
      <span
        className="h-5 w-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--avatar-ring)]"
        style={{
          background: voiceAvatarGradient(`file-transcription::${model.id}`),
        }}
        aria-hidden="true"
      />
      <span className="truncate font-medium">{model.label}</span>
    </div>
  );
};
