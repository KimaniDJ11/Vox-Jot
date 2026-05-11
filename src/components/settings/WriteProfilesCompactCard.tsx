// Compact inline card for write-profiles controls: enable toggle,
// URL capture toggle, and test button — all in a single row.

import React from "react";
import { useTranslation } from "react-i18next";
import { useSetting } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { TestRuleButton } from "@/components/settings/write-rules/TestRuleButton";

export const WriteProfilesCompactCard: React.FC = () => {
  const { t } = useTranslation();
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const appAwareToneEnabled = useSetting("app_aware_tone_enabled") ?? true;
  const urlCaptureEnabled =
    useSetting("write_rules_url_capture_enabled") ?? true;

  return (
    <div className="space-y-3 px-4 py-3">
      <p className="text-sm leading-6 text-[var(--muted)]">
        {t("settings.styles.description")}
      </p>
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-2 text-[13px] font-medium leading-tight text-[var(--text)]">
          <SwitchControl
            checked={appAwareToneEnabled}
            onChange={(v) => void updateSetting("app_aware_tone_enabled", v)}
            ariaLabel={t("settings.styles.toggle.label")}
          />
          {t("settings.styles.toggle.label")}
        </div>

        <span className="h-3.5 w-px bg-[var(--border)]" aria-hidden />

        <div className="flex items-center gap-2 text-[13px] font-medium leading-tight text-[var(--text)]">
          <SwitchControl
            checked={urlCaptureEnabled}
            onChange={(v) =>
              void updateSetting("write_rules_url_capture_enabled", v)
            }
            ariaLabel={t("refine.writeRules.urlCaptureLabel")}
          />
          {t("refine.writeRules.urlCaptureLabel")}
        </div>

        <div className="ml-auto">
          <TestRuleButton />
        </div>
      </div>
    </div>
  );
};
