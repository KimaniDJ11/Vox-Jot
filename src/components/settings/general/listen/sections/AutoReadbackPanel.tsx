import React from "react";
import { useTranslation } from "react-i18next";
import {
  type TtsAutoReadbackMode,
  type TtsAutoReadbackScope,
  type TtsReadbackTextMode,
} from "@/bindings";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { ListenSpeechState } from "../useListenSpeechState";
import { whiteFlatSectionSurfaceClassName } from "../styles";
import { SelectField } from "../sharedComponents";

export const AutoReadbackPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const settings = speech.settings;
  if (!settings) return null;

  const content = (
    <div className={whiteFlatSectionSurfaceClassName}>
      <SettingContainer
        title={t("listen.autoReadback.title")}
        description={t("listen.autoReadback.description")}
        descriptionMode="tooltip"
        grouped={true}
        disabled={!speech.ttsEnabled}
      >
        <SelectField
          value={settings.tts_auto_readback_mode ?? "off"}
          onChange={(value) =>
            void speech.updateSetting(
              "tts_auto_readback_mode",
              value as TtsAutoReadbackMode,
            )
          }
          disabled={
            !speech.ttsEnabled || speech.isUpdating("tts_auto_readback_mode")
          }
          options={[
            { value: "off", label: t("common.off") },
            {
              value: "after_output",
              label: t("listen.autoReadback.modes.afterOutput"),
            },
            {
              value: "after_preview_confirm",
              label: t("listen.autoReadback.modes.afterPreviewConfirm"),
            },
          ]}
        />
      </SettingContainer>

      <div className="border-t border-[var(--border)]">
        <SettingContainer
          title={t("listen.autoReadback.scopeTitle")}
          description={t("listen.autoReadback.scopeDescription")}
          descriptionMode="tooltip"
          grouped={true}
          disabled={!speech.ttsEnabled}
        >
          <SelectField
            value={settings.tts_auto_readback_scope ?? "dictation_only"}
            onChange={(value) =>
              void speech.updateSetting(
                "tts_auto_readback_scope",
                value as TtsAutoReadbackScope,
              )
            }
            disabled={
              !speech.ttsEnabled || speech.isUpdating("tts_auto_readback_scope")
            }
            options={[
              {
                value: "dictation_only",
                label: t("listen.autoReadback.scopes.dictationOnly"),
              },
              {
                value: "dictation_and_selection",
                label: t("listen.autoReadback.scopes.dictationAndSelection"),
              },
            ]}
          />
        </SettingContainer>
      </div>

      <div className="border-t border-[var(--border)]">
        <SettingContainer
          title={t("listen.autoReadback.textTitle")}
          description={t("listen.autoReadback.textDescription")}
          descriptionMode="tooltip"
          grouped={true}
          disabled={!speech.ttsEnabled}
        >
          <SelectField
            value={settings.tts_readback_text_mode ?? "final_output"}
            onChange={(value) =>
              void speech.updateSetting(
                "tts_readback_text_mode",
                value as TtsReadbackTextMode,
              )
            }
            disabled={
              !speech.ttsEnabled || speech.isUpdating("tts_readback_text_mode")
            }
            options={[
              {
                value: "final_output",
                label: t("listen.autoReadback.textModes.finalOutput"),
              },
              {
                value: "translated_block",
                label: t("listen.autoReadback.textModes.translatedBlock"),
              },
            ]}
          />
        </SettingContainer>
      </div>

      <div className="border-t border-[var(--border)]">
        <ToggleSwitch
          checked={settings.tts_stop_on_record ?? true}
          onChange={(enabled) =>
            void speech.updateSetting("tts_stop_on_record", enabled)
          }
          isUpdating={speech.isUpdating("tts_stop_on_record")}
          label={t("listen.autoReadback.stopOnRecord")}
          description={t("listen.autoReadback.stopOnRecordDescription")}
          descriptionMode="tooltip"
          grouped={true}
          disabled={!speech.ttsEnabled}
        />
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return (
    <SettingsGroup title={t("listen.autoReadback.groupTitle")}>
      {content}
    </SettingsGroup>
  );
};
