import React from "react";
import { useTranslation } from "react-i18next";

import {
  CreateVoicesSection as CreateVoicesPanel,
  MyVoicesSection as MyVoicesPanel,
  ListenVoiceCloningSection as VoiceCloningPanel,
  ListenVoiceChangerSection as VoiceChangerPanel,
} from "@/components/settings/general/ListenSections";
import {
  StoryAudioHistorySection,
  StoryStudioSection,
} from "@/components/story-studio";
import { SettingsGroup } from "@/components/ui";
import { SectionIntro } from "@/components/app-sections/shared";

export const ListenMyVoicesSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionIntro
        title={t("appSections.sections.myVoicesTitle")}
        description={t("appSections.sections.myVoicesDescription")}
      >
        <MyVoicesPanel showGroupTitle={false} />
      </SectionIntro>
    </div>
  );
};

export const ListenCreateVoicesSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SettingsGroup
        noCard
        title={t("listen.createVoices.title", {
          defaultValue: "Create Speech",
        })}
        description={t("listen.createVoices.description", {
          defaultValue:
            "Preview models, tune delivery, and save a new voice profile without changing the active voice.",
        })}
        showTitle={false}
        descriptionOnlyGap="controls"
      >
        <CreateVoicesPanel showGroupTitle={false} />
      </SettingsGroup>
    </div>
  );
};

export const ListenVoiceCloningSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionIntro
        title={t("appSections.sections.voiceCloningTitle")}
        description={t("appSections.sections.voiceCloningDescription")}
      >
        <VoiceCloningPanel showGroupTitle={false} />
      </SectionIntro>
    </div>
  );
};

export const ListenVoiceChangerSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionIntro
        title={t("appSections.sections.voiceChangerTitle", {
          defaultValue: "Voice Changer",
        })}
        description={t("appSections.sections.voiceChangerDescription", {
          defaultValue:
            "Convert recorded or imported WAV audio into a ready voice profile while keeping delivery and timing intact.",
        })}
      >
        <VoiceChangerPanel showGroupTitle={false} />
      </SectionIntro>
    </div>
  );
};

export const StoryStudioAppSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SectionIntro
        title={t("appSections.sections.studioTitle")}
        description={t("appSections.sections.studioDescription")}
      >
        <div className="-mx-6 md:-mx-8">
          <StoryStudioSection />
        </div>
      </SectionIntro>
    </div>
  );
};

export const StoryAudioHistoryAppSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionIntro
        title={t("appSections.sections.generatedAudioTitle")}
        description={t("appSections.sections.generatedAudioDescription")}
      >
        <StoryAudioHistorySection />
      </SectionIntro>
    </div>
  );
};
