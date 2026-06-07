import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  Code2,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  commands,
  type InstalledApp,
  type WriteRule,
  type WriteRuleOverrides,
} from "@/bindings";
import {
  readCachedInstalledApps,
  refreshInstalledApps,
  subscribeInstalledApps,
} from "@/lib/installedApps";
import { useRefreshSettings } from "@/hooks/useSettings";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import OnboardingLayout from "./OnboardingLayout";

interface DictationModesStepProps {
  onComplete: () => void;
  onBack?: () => void;
}

interface ModeBlueprint {
  id: string;
  title: string;
  description: string;
  toneLabel: string;
  icon: LucideIcon;
  bundleIds?: string[];
  bundlePrefixes?: string[];
  nameIncludes?: string[];
  overrides: WriteRuleOverrides;
}

interface ModeSuggestion {
  blueprint: ModeBlueprint;
  apps: InstalledApp[];
}

const STARTER_MODE_BLUEPRINTS: ModeBlueprint[] = [
  {
    id: "email",
    title: "Email",
    description: "Polished wording, punctuation cleanup, no auto-submit.",
    toneLabel: "Professional",
    icon: Mail,
    bundleIds: ["com.apple.mail", "com.microsoft.Outlook"],
    nameIncludes: ["mail", "outlook"],
    overrides: {
      cleanup_level: "medium",
      tone_id: "professional",
      auto_submit: false,
      append_trailing_space: true,
    },
  },
  {
    id: "chat",
    title: "Chat",
    description: "Casual tone for quick messages with send-ready output.",
    toneLabel: "Casual",
    icon: MessageSquare,
    bundleIds: [
      "com.apple.MobileSMS",
      "com.apple.iChat",
      "com.tinyspeck.slackmacgap",
      "com.hnc.Discord",
      "com.microsoft.teams",
      "com.microsoft.teams2",
    ],
    nameIncludes: ["messages", "slack", "discord", "teams"],
    overrides: {
      cleanup_level: "medium",
      tone_id: "casual",
      auto_submit: true,
      append_trailing_space: false,
    },
  },
  {
    id: "notes",
    title: "Notes",
    description: "Cleaner paragraphs for notes and writing apps.",
    toneLabel: "Neutral",
    icon: FileText,
    bundleIds: [
      "com.apple.Notes",
      "md.obsidian",
      "notion.id",
      "com.evernote.Evernote",
      "com.craftdocs.Craft",
      "net.shinyfrog.bear",
      "com.apple.iWork.Pages",
    ],
    nameIncludes: [
      "notes",
      "obsidian",
      "notion",
      "evernote",
      "craft",
      "bear",
      "pages",
    ],
    overrides: {
      cleanup_level: "medium",
      tone_id: "neutral",
      auto_submit: false,
      append_trailing_space: true,
    },
  },
  {
    id: "coding",
    title: "Coding",
    description: "Technical language, exact names, clipboard paste.",
    toneLabel: "Coding",
    icon: Code2,
    bundleIds: [
      "com.microsoft.VSCode",
      "com.microsoft.VSCodeInsiders",
      "com.apple.dt.Xcode",
      "dev.zed.Zed",
      "com.sublimetext.4",
      "com.googlecode.iterm2",
      "com.apple.Terminal",
      "dev.warp.Warp-Stable",
      "com.todesktop.230313mzl4w4u92",
    ],
    bundlePrefixes: ["com.jetbrains."],
    nameIncludes: [
      "code",
      "cursor",
      "zed",
      "xcode",
      "terminal",
      "iterm",
      "warp",
      "jetbrains",
    ],
    overrides: {
      stt_language: "en",
      tone_id: "coding",
      paste_method: "ctrl_v",
      auto_submit: false,
      append_trailing_space: false,
    },
  },
];

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function matchesBlueprint(
  app: InstalledApp,
  blueprint: ModeBlueprint,
): boolean {
  const bundleId = normalized(app.bundle_id);
  const appName = normalized(app.name);
  return Boolean(
    blueprint.bundleIds?.some(
      (candidate) => normalized(candidate) === bundleId,
    ) ||
    blueprint.bundlePrefixes?.some((prefix) =>
      bundleId.startsWith(normalized(prefix)),
    ) ||
    blueprint.nameIncludes?.some((needle) =>
      appName.includes(normalized(needle)),
    ),
  );
}

function uniqueApps(apps: InstalledApp[]): InstalledApp[] {
  const seen = new Set<string>();
  return apps.filter((app) => {
    const key = normalized(app.bundle_id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createRuleId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `onboarding-mode-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const DictationModesStep: React.FC<DictationModesStepProps> = ({
  onComplete,
  onBack,
}) => {
  const { t } = useTranslation();
  const refreshSettings = useRefreshSettings();
  const [apps, setApps] = useState<InstalledApp[]>(
    () => readCachedInstalledApps() ?? [],
  );
  const [rules, setRules] = useState<WriteRule[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const hasInitializedSelection = useRef(false);

  const suggestions = useMemo<ModeSuggestion[]>(() => {
    const coveredBundleIds = new Set(
      rules.flatMap((rule) => rule.matchers.bundle_ids ?? []).map(normalized),
    );

    return STARTER_MODE_BLUEPRINTS.map((blueprint) => {
      const matchingApps = uniqueApps(
        apps.filter((app) => matchesBlueprint(app, blueprint)),
      ).filter((app) => !coveredBundleIds.has(normalized(app.bundle_id)));
      return { blueprint, apps: matchingApps };
    }).filter((suggestion) => suggestion.apps.length > 0);
  }, [apps, rules]);

  useEffect(() => {
    setSelectedIds((current) => {
      const availableIds = new Set(
        suggestions.map((suggestion) => suggestion.blueprint.id),
      );
      if (!hasInitializedSelection.current) {
        if (availableIds.size === 0) return current;
        hasInitializedSelection.current = true;
        return availableIds;
      }
      const next = new Set<string>();
      for (const id of availableIds) {
        if (current.has(id)) next.add(id);
      }
      return next;
    });
  }, [suggestions]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeInstalledApps((nextApps) => {
      if (!cancelled) setApps(nextApps);
    });

    const load = async () => {
      setLoading(true);
      try {
        const [rulesResult, refreshedApps] = await Promise.all([
          commands.listWriteRules(),
          refreshInstalledApps(),
        ]);
        if (cancelled) return;
        if (rulesResult.status === "ok") setRules(rulesResult.data);
        setApps(refreshedApps);
      } catch (error) {
        console.error("Failed to prepare onboarding dictation modes:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const selectedSuggestions = suggestions.filter((suggestion) =>
    selectedIds.has(suggestion.blueprint.id),
  );

  const toggleSuggestion = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleRefreshApps = async () => {
    setRefreshing(true);
    try {
      setApps(await refreshInstalledApps());
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateModes = async () => {
    if (selectedSuggestions.length === 0) {
      onComplete();
      return;
    }

    setSaving(true);
    try {
      for (const [index, suggestion] of selectedSuggestions.entries()) {
        const rule: WriteRule = {
          id: createRuleId(),
          name: suggestion.blueprint.title,
          enabled: true,
          priority: 100 - index * 10,
          matchers: {
            bundle_ids: suggestion.apps.map((app) => app.bundle_id),
            url_patterns: [],
          },
          overrides: suggestion.blueprint.overrides,
        };
        const result = await commands.upsertWriteRule(rule);
        if (result.status === "error") throw new Error(result.error);
      }

      const rulesEnabled = await commands.changeWriteRulesEnabledSetting(true);
      if (rulesEnabled.status === "error") throw new Error(rulesEnabled.error);
      const appAwareTone =
        await commands.changeAppAwareToneEnabledSetting(true);
      if (appAwareTone.status === "error") throw new Error(appAwareTone.error);

      await refreshSettings();
      onComplete();
    } catch (error) {
      console.error("Failed to create onboarding dictation modes:", error);
      toast.error(
        t("onboarding.modes.errors.saveFailed", {
          defaultValue:
            "Could not create Dictation Modes. Try again or skip for now.",
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const rightContent = (
    <div className="ob-visual-card ob-modes-preview">
      <div className="ob-card-row ob-modes-preview-header">
        <div className="ob-card-icon">
          <Check size={18} aria-hidden />
        </div>
        <div>
          <h2 className="ob-card-title">
            {t("onboarding.modes.cardTitle", {
              defaultValue: "Starter modes",
            })}
          </h2>
          <p className="ob-card-copy">
            {t("onboarding.modes.cardDescription", {
              defaultValue:
                "Modes match the app in front and apply saved output choices.",
            })}
          </p>
        </div>
      </div>

      <div className="ob-modes-preview-list">
        {(suggestions.length > 0
          ? suggestions
          : STARTER_MODE_BLUEPRINTS.slice(0, 3)
        ).map((item) => {
          const blueprint = "blueprint" in item ? item.blueprint : item;
          const appsForPreview = "apps" in item ? item.apps : [];
          const Icon = blueprint.icon;
          return (
            <div key={blueprint.id} className="ob-mode-mini-card">
              <div className="ob-mode-mini-icon" aria-hidden>
                <Icon size={16} />
              </div>
              <div>
                <p>{blueprint.title}</p>
                <span>
                  {appsForPreview.length > 0
                    ? appsForPreview
                        .slice(0, 2)
                        .map((app) => app.name)
                        .join(", ")
                    : blueprint.toneLabel}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <OnboardingLayout
      currentStep="modes"
      onBack={saving ? undefined : onBack}
      footerActions={
        <>
          <button
            type="button"
            className={`ob-btn-secondary ${interactiveFocusRingClass}`}
            onClick={onComplete}
            disabled={saving}
          >
            {t("onboarding.modes.skipCta", { defaultValue: "Skip" })}
          </button>
          <button
            type="button"
            className="ob-btn-primary"
            onClick={handleCreateModes}
            disabled={saving || loading}
          >
            {saving ? (
              <Loader2 size={18} className="ob-spinner" aria-hidden />
            ) : (
              <ArrowRight size={18} aria-hidden />
            )}
            {suggestions.length === 0 || selectedSuggestions.length === 0
              ? t("onboarding.modes.continueCta", { defaultValue: "Continue" })
              : t("onboarding.modes.createCta", {
                  defaultValue: "Create selected modes",
                })}
          </button>
        </>
      }
      leftContent={
        <>
          <p className="ob-eyebrow">
            {t("onboarding.modes.eyebrow", {
              defaultValue: "Optional app tuning",
            })}
          </p>
          <h1 className="ob-heading">
            {t("onboarding.modes.title", {
              defaultValue: "Create Dictation Modes from your apps",
            })}
          </h1>
          <p className="ob-subtext">
            {t("onboarding.modes.description", {
              defaultValue:
                "Vox Jot can set up starter modes for apps already on this Mac. Each mode can be edited or deleted later in Settings.",
            })}
          </p>

          <div className="ob-modes-toolbar">
            <span role="status" aria-live="polite">
              {loading
                ? t("onboarding.modes.scanning", {
                    defaultValue: "Scanning installed apps...",
                  })
                : t("onboarding.modes.detected", {
                    defaultValue: "{{count}} starter modes found",
                    count: suggestions.length,
                  })}
            </span>
            <button
              type="button"
              className={`ob-mode-refresh ${interactiveFocusRingClass}`}
              onClick={handleRefreshApps}
              disabled={loading || refreshing || saving}
              aria-label={t("onboarding.modes.refreshApps", {
                defaultValue: "Refresh installed apps",
              })}
            >
              <RefreshCw
                size={14}
                className={refreshing ? "ob-spinner" : undefined}
                aria-hidden
              />
            </button>
          </div>

          {loading ? (
            <div className="ob-modes-loading" role="status" aria-live="polite">
              <Loader2 size={18} className="ob-spinner" aria-hidden />
              <span>
                {t("onboarding.modes.loading", {
                  defaultValue:
                    "Looking for apps that match common writing workflows.",
                })}
              </span>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="ob-modes-list">
              {suggestions.map((suggestion) => {
                const { blueprint } = suggestion;
                const Icon = blueprint.icon;
                const selected = selectedIds.has(blueprint.id);
                return (
                  <button
                    key={blueprint.id}
                    type="button"
                    className={`ob-mode-option ${selected ? "ob-mode-option-selected" : ""} ${interactiveFocusRingClass}`}
                    aria-pressed={selected}
                    onClick={() => toggleSuggestion(blueprint.id)}
                  >
                    <span className="ob-mode-option-icon" aria-hidden>
                      <Icon size={18} />
                    </span>
                    <span className="ob-mode-option-body">
                      <span className="ob-mode-option-title">
                        {blueprint.title}
                      </span>
                      <span className="ob-mode-option-description">
                        {blueprint.description}
                      </span>
                      <span className="ob-mode-app-row">
                        {suggestion.apps.slice(0, 3).map((app) => (
                          <span key={app.bundle_id}>{app.name}</span>
                        ))}
                        {suggestion.apps.length > 3 ? (
                          <span>+{suggestion.apps.length - 3}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="ob-mode-tone">{blueprint.toneLabel}</span>
                    <span
                      className={`ob-mode-check ${selected ? "ob-mode-check-selected" : ""}`}
                      aria-hidden
                    >
                      <Check size={14} />
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="ob-modes-empty">
              <p>
                {t("onboarding.modes.emptyTitle", {
                  defaultValue: "No starter app matches found",
                })}
              </p>
              <span>
                {t("onboarding.modes.emptyDescription", {
                  defaultValue:
                    "You can continue now and create custom Dictation Modes later from Settings.",
                })}
              </span>
            </div>
          )}
        </>
      }
      rightContent={rightContent}
    />
  );
};

export default DictationModesStep;
