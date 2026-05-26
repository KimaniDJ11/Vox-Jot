import { useTranslation } from "react-i18next";

import { useDictationStats, type DictationStats } from "@/hooks/useDictationStats";

const selectDictationEncouragementKey = (
  stats: DictationStats | null,
):
  | "ready"
  | "bigVoiceDay"
  | "streakStrong"
  | "acrossApps"
  | "wordsFlowing"
  | "inYourFlow"
  | "niceMomentum"
  | "welcomeBack" => {
  if (!stats || stats.total_sessions === 0) return "ready";
  if (stats.today_words >= 500) return "bigVoiceDay";
  if (stats.streak_days >= 3) return "streakStrong";
  if (stats.unique_app_count >= 3) return "acrossApps";
  if (stats.total_words >= 5_000) return "wordsFlowing";
  if (stats.total_sessions >= 10) return "inYourFlow";
  if (stats.today_words > 0) return "niceMomentum";
  return "welcomeBack";
};

const encouragementDefaults = {
  ready: "Ready when you are",
  bigVoiceDay: "You are moving fast today",
  streakStrong: "Your streak is holding strong",
  acrossApps: "Vox Jot is working across your apps",
  wordsFlowing: "Your words are really adding up",
  inYourFlow: "Dictation is part of your flow",
  niceMomentum: "You have momentum today",
  welcomeBack: "Pick up where you left off",
} as const;

export function useDictationEncouragementTitle(): string {
  const { t } = useTranslation();
  const { stats } = useDictationStats();
  const titleKey = selectDictationEncouragementKey(stats);

  return t(`appSections.homeHeader.encouragement.${titleKey}`, {
    defaultValue: encouragementDefaults[titleKey],
  });
}
