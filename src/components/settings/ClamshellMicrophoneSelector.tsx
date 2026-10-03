import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { useSettingsStore } from "@/stores/settingsStore";
import { DeviceSelectorSetting } from "./DeviceSelectorSetting";

interface ClamshellMicrophoneSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/** Microphone used while a laptop's lid is closed; hidden on desktops. */
export const ClamshellMicrophoneSelector: React.FC<ClamshellMicrophoneSelectorProps> =
  React.memo((props) => {
    const { t } = useTranslation();
    const devices = useSettingsStore((s) => s.audioDevices);
    const refresh = useSettingsStore((s) => s.refreshAudioDevices);
    const [isLaptop, setIsLaptop] = useState(false);

    useEffect(() => {
      commands
        .isLaptop()
        .then((result) => setIsLaptop(result.status === "ok" && result.data))
        .catch((error) => {
          console.error("Failed to check if device is laptop:", error);
          setIsLaptop(false);
        });
    }, []);

    if (!isLaptop) return null;

    return (
      <DeviceSelectorSetting
        settingKey="clamshell_microphone"
        devices={devices}
        onRefresh={refresh}
        title={t("settings.debug.clamshellMicrophone.title")}
        description={t("settings.debug.clamshellMicrophone.description")}
        placeholder={t("settings.sound.microphone.placeholder")}
        loadingPlaceholder={t("common.loading")}
        {...props}
      />
    );
  });

ClamshellMicrophoneSelector.displayName = "ClamshellMicrophoneSelector";
