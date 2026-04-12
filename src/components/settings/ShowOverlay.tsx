import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import type { OverlayPosition, RecordingOverlayStyle } from "@/bindings";

interface ShowOverlayProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ShowOverlay: React.FC<ShowOverlayProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const overlayOptions = [
      { value: "none", label: t("settings.advanced.overlay.options.none") },
      { value: "bottom", label: t("settings.advanced.overlay.options.bottom") },
      { value: "top", label: t("settings.advanced.overlay.options.top") },
    ];

    const styleOptions = [
      {
        value: "compact",
        label: t("settings.advanced.overlay.style.compact"),
      },
      {
        value: "detailed",
        label: t("settings.advanced.overlay.style.detailed"),
      },
    ];

    const selectedPosition = (getSetting("overlay_position") ||
      "bottom") as OverlayPosition;

    const selectedStyle = (getSetting("recording_overlay_style") ||
      "compact") as RecordingOverlayStyle;

    const isHidden = selectedPosition === "none";

    return (
      <>
        <SettingContainer
          title={t("settings.advanced.overlay.title")}
          description={t("settings.advanced.overlay.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <Dropdown
            options={overlayOptions}
            selectedValue={selectedPosition}
            onSelect={(value) =>
              updateSetting("overlay_position", value as OverlayPosition)
            }
            disabled={isUpdating("overlay_position")}
          />
        </SettingContainer>
        {!isHidden && (
          <SettingContainer
            title={t("settings.advanced.overlay.style.title")}
            description={t("settings.advanced.overlay.style.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Dropdown
              options={styleOptions}
              selectedValue={selectedStyle}
              onSelect={(value) =>
                updateSetting(
                  "recording_overlay_style",
                  value as RecordingOverlayStyle,
                )
              }
              disabled={isUpdating("recording_overlay_style")}
            />
          </SettingContainer>
        )}
      </>
    );
  },
);
