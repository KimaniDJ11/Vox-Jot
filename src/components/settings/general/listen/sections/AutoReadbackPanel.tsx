import React from "react";
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
  const settings = speech.settings;
  if (!settings) return null;

  const content = (
    <div className={whiteFlatSectionSurfaceClassName}>
      <SettingContainer
        title="Auto Readback"
        description="Choose when Vox Jot automatically speaks the final output."
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
            { value: "off", label: "Off" },
            { value: "after_output", label: "After output" },
            {
              value: "after_preview_confirm",
              label: "After preview confirm",
            },
          ]}
        />
      </SettingContainer>

      <div className="border-t border-[var(--border)]">
        <SettingContainer
          title="Readback Scope"
          description="Control whether automatic readback applies only to dictation or also to selection actions."
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
              { value: "dictation_only", label: "Dictation only" },
              {
                value: "dictation_and_selection",
                label: "Dictation and selection",
              },
            ]}
          />
        </SettingContainer>
      </div>

      <div className="border-t border-[var(--border)]">
        <SettingContainer
          title="Readback Text"
          description="Choose whether bilingual output reads the translated block or the full final output."
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
              { value: "final_output", label: "Final output" },
              { value: "translated_block", label: "Translated block" },
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
          label="Stop Speech On Record"
          description="Cancel current speech output as soon as recording starts."
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

  return <SettingsGroup title="Auto-Readback">{content}</SettingsGroup>;
};
