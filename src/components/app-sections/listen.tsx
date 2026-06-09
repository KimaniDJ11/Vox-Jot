import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Music2, ScrollText, Users, WandSparkles } from "lucide-react";

import {
  MyVoicesSection as MyVoicesPanel,
  VoiceDesignSection as VoiceDesignPanel,
  ListenVoiceCloningSection as VoiceCloningPanel,
  ListenVoiceChangerSection as VoiceChangerPanel,
} from "@/components/settings/general/ListenSections";
import {
  StoryAudioHistorySection,
  StoryStudioSection,
} from "@/components/story-studio";
import { SettingsGroup } from "@/components/ui";
import {
  SectionFeatureCards,
  SectionIntro,
  type SectionFeatureCard,
} from "@/components/app-sections/shared";

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

export const ListenVoiceDesignSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SettingsGroup
        noCard
        title={t("listen.voiceDesign.title", {
          defaultValue: "Voice Design",
        })}
        description={t("listen.voiceDesign.description", {
          defaultValue:
            "Tune saved voices and browse voice presets without generating speech audio.",
        })}
        showTitle={false}
        descriptionOnlyGap="controls"
      >
        <VoiceDesignPanel showGroupTitle={false} />
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
  const studioFeatureCards = useMemo<SectionFeatureCard[]>(
    () => [
      {
        label: t("storyStudio.featureCards.cast.label"),
        value: t("storyStudio.featureCards.cast.value"),
        detail: t("storyStudio.featureCards.cast.detail"),
        icon: <Users className="h-4.5 w-4.5" strokeWidth={2} />,
        accentColor: "var(--accent)",
      },
      {
        label: t("storyStudio.featureCards.script.label"),
        value: t("storyStudio.featureCards.script.value"),
        detail: t("storyStudio.featureCards.script.detail"),
        icon: <ScrollText className="h-4.5 w-4.5" strokeWidth={2} />,
        accentColor: "var(--voice)",
      },
      {
        label: t("storyStudio.featureCards.sounds.label"),
        value: t("storyStudio.featureCards.sounds.value"),
        detail: t("storyStudio.featureCards.sounds.detail"),
        icon: <Music2 className="h-4.5 w-4.5" strokeWidth={2} />,
        accentColor: "var(--accent-gold)",
      },
      {
        label: t("storyStudio.featureCards.render.label"),
        value: t("storyStudio.featureCards.render.value"),
        detail: t("storyStudio.featureCards.render.detail"),
        icon: <WandSparkles className="h-4.5 w-4.5" strokeWidth={2} />,
        accentColor: "var(--success)",
      },
    ],
    [t],
  );

  return (
    <div className="space-y-7">
      <SectionFeatureCards
        layout="capability"
        columns={4}
        ariaLabel={t("storyStudio.featureCards.ariaLabel")}
        cards={studioFeatureCards}
      />
      <div className="-mx-6 md:-mx-8">
        <StoryStudioSection />
      </div>
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
