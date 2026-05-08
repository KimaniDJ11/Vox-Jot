import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { useListenSpeechState } from "./listen/useListenSpeechState";
import { SavedVoiceProfilesSection } from "./listen/sections/SavedVoiceProfilesSection";
import { VoiceArchitectSection } from "./listen/sections/VoiceArchitectSection";
import { EngineLibraryPanel } from "./listen/sections/EngineLibraryPanel";
import { SpeechPackManagerCard } from "./listen/sections/SpeechPackManagerCard";
import { VoiceCloningSection } from "./listen/sections/VoiceCloningSection";
import { AutoReadbackPanel } from "./listen/sections/AutoReadbackPanel";
import { VoiceChangerSection } from "./listen/sections/VoiceChangerSection";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export const MyVoicesSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return (
    <SavedVoiceProfilesSection speech={speech} showTitle={showGroupTitle} />
  );
};

export const VoicesSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const { t } = useTranslation();
  const [view, setView] = React.useState<"profiles" | "voice-changer">(
    "profiles",
  );
  const speech = useListenSpeechState();
  const content = (
    <div className="space-y-4">
      <SegmentedControl<"profiles" | "voice-changer">
        value={view}
        onChange={setView}
        layoutId="listen-voices-tool-toggle"
        ariaLabel={t("listen.voices.viewAriaLabel", {
          defaultValue: "Voices view",
        })}
        items={[
          {
            value: "profiles",
            label: t("listen.voices.profiles", { defaultValue: "Profiles" }),
          },
          {
            value: "voice-changer",
            label: t("listen.voiceChanger.title", {
              defaultValue: "Voice Changer",
            }),
          },
        ]}
      />

      {view === "profiles" ? (
        <div className="space-y-4">
          <SavedVoiceProfilesSection speech={speech} showTitle={false} />
        </div>
      ) : (
        <VoiceChangerSection speech={speech} showTitle={false} />
      )}
    </div>
  );

  if (!showGroupTitle) {
    return content;
  }

  return (
    <SettingsGroup
      title={t("appSections.sections.myVoicesTitle", {
        defaultValue: "Voices",
      })}
    >
      {content}
    </SettingsGroup>
  );
};

export const CreateVoicesSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <VoiceArchitectSection speech={speech} showTitle={showGroupTitle} />;
};

export const EngineLibrarySection: React.FC<{
  showGroupTitle?: boolean;
  titleActionTargetId?: string;
  showActiveModelBanner?: boolean;
  hubSearchQuery?: string;
  hubFilterLabels?: boolean;
}> = ({
  showGroupTitle = true,
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery,
  hubFilterLabels,
}) => {
  const speech = useListenSpeechState();
  return (
    <EngineLibraryPanel
      speech={speech}
      showTitle={showGroupTitle}
      titleActionTargetId={titleActionTargetId}
      showActiveModelBanner={showActiveModelBanner}
      hubSearchQuery={hubSearchQuery}
      hubFilterLabels={hubFilterLabels}
    />
  );
};

export const SpeechPackManagerSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  const content = <SpeechPackManagerCard speech={speech} />;

  if (!showGroupTitle) {
    return content;
  }

  return <SettingsGroup title="Speech Packs">{content}</SettingsGroup>;
};

export const ListenVoiceCloningSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <VoiceCloningSection speech={speech} showTitle={showGroupTitle} />;
};

export const AutoReadbackSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <AutoReadbackPanel speech={speech} showTitle={showGroupTitle} />;
};
