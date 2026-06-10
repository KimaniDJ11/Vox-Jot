import React from "react";
import { MessageSquareText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { VoiceCapabilityFlags } from "./voiceCapabilities";
import { hasVoiceCapability } from "./voiceCapabilities";

export const VoiceCapabilityChips: React.FC<{
  capabilities: VoiceCapabilityFlags;
  className?: string;
}> = ({ capabilities, className = "" }) => {
  const { t } = useTranslation();
  if (!hasVoiceCapability(capabilities)) return null;

  const chipClassName =
    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4";

  return (
    <span
      className={`inline-flex min-w-0 flex-wrap items-center gap-1 ${className}`}
    >
      {capabilities.supportsExpressions ? (
        <span
          className={`${chipClassName} border-[color-mix(in_srgb,var(--accent),transparent_62%)] bg-[var(--accent-soft)] text-[var(--accent)]`}
          title={t("listen.voiceCapabilities.expressionsDetail", {
            defaultValue:
              "Supports expressive delivery controls or inline expression cues",
          })}
        >
          <Sparkles className="h-3 w-3" aria-hidden />
          {t("listen.voiceCapabilities.expressions", {
            defaultValue: "Expressions",
          })}
        </span>
      ) : null}
      {capabilities.supportsPrompts ? (
        <span
          className={`${chipClassName} border-[color-mix(in_srgb,var(--success),transparent_58%)] bg-[var(--success-soft)] text-[var(--success)]`}
          title={t("listen.voiceCapabilities.promptsDetail", {
            defaultValue: "Supports text prompts or speaking instructions",
          })}
        >
          <MessageSquareText className="h-3 w-3" aria-hidden />
          {t("listen.voiceCapabilities.prompts", {
            defaultValue: "Prompts",
          })}
        </span>
      ) : null}
    </span>
  );
};
