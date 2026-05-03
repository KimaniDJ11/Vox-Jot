// Write Profiles top-level settings page (Refine → Write profiles).
//
// This page now operates in two mutually-exclusive modes:
//
//   • LIST MODE   — shows the controls (toggle, URL capture, test) and
//                   the rule list. "Active now" pill marks whichever
//                   rule currently matches the frontmost app.
//   • EDIT MODE   — shows the editor only. List is hidden so the user
//                   has a single place to focus. A sticky header inside
//                   the editor lets them get back without losing work.
//
// The parent loads `apps` / `models` once and threads them through to
// the list so each row can resolve raw ids (com.openai.codex, "coding")
// to friendly labels ("Codex", "Coding") — this is the biggest single
// scannability win versus the previous list (Nielsen heuristic #2).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type InstalledApp,
  type ModelInfo,
  type ResolvedWriteRule,
  type WriteRule,
} from "@/bindings";
import {
  readCachedInstalledApps,
  refreshInstalledApps,
  subscribeInstalledApps,
} from "@/lib/installedApps";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl, SettingsGroup } from "@/components/ui";
import { WriteRuleEditor } from "./WriteRuleEditor";
import {
  groupWriteRules,
  WriteProfileGroupCard,
} from "./WriteProfileGroupCard";
import { WriteRuleRow } from "./WriteRuleRow";

const emptyTitle = "No write profiles yet";
const emptyBody =
  "Create a profile to switch tone, engine, or output behavior automatically based on the app or website you're dictating into.";
const createFirstLabel = "Create your first profile";
type ViewMode = "individual" | "grouped";

export const WriteRulesSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();

  const [rules, setRules] = useState<WriteRule[]>([]);
  const [apps, setApps] = useState<InstalledApp[]>(
    () => readCachedInstalledApps() ?? [],
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("individual");

  const tones = getSetting("tone_definitions") ?? [];
  const prompts = getSetting("post_process_prompts") ?? [];

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => left.name.localeCompare(right.name)),
    [rules],
  );
  const groupedRules = useMemo(() => groupWriteRules(rules), [rules]);
  const editingRule = editingId
    ? rules.find((rule) => rule.id === editingId)
    : undefined;
  const inEditMode = adding || !!editingRule;

  const loadRules = useCallback(async () => {
    const result = await commands.listWriteRules();
    if (result.status === "ok") {
      setRules(result.data);
    }
  }, []);

  // Load lookup tables once. The list children read from these arrays
  // (app names, model names, tone labels) so we don't call the same
  // commands once per row.
  useEffect(() => {
    void loadRules();
    void refreshInstalledApps().then(setApps);
    const unsubscribe = subscribeInstalledApps(setApps);
    void commands.getAvailableModels().then((result) => {
      if (result.status === "ok") setModels(result.data);
    });
    return unsubscribe;
  }, [loadRules]);

  // "Active now" indicator — periodically asks the backend which rule
  // would match the frontmost app right now. Cheap call (just a hash
  // lookup over rules); refresh on a slow timer to stay current
  // without thrashing the system.
  const refreshActiveRule = useCallback(async () => {
    const appResult = await commands.getFrontmostAppForExclusion();
    if (appResult.status !== "ok") {
      setActiveRuleId(null);
      return;
    }
    const urlResult = await commands.getFrontmostUrlForWriteRules(
      appResult.data.bundle_id,
    );
    const resolved: Awaited<ReturnType<typeof commands.testResolveWriteRule>> =
      await commands.testResolveWriteRule(
        appResult.data.bundle_id,
        appResult.data.localized_name,
        urlResult.status === "ok" ? urlResult.data : null,
      );
    if (resolved.status === "ok") {
      const data = resolved.data as ResolvedWriteRule | null;
      setActiveRuleId(data?.rule_id ?? null);
    }
  }, []);

  useEffect(() => {
    if (inEditMode) return; // pause while user is editing
    void refreshActiveRule();
    const id = window.setInterval(() => {
      void refreshActiveRule();
    }, 4000);
    return () => window.clearInterval(id);
  }, [refreshActiveRule, inEditMode, rules.length]);

  const saveRule = async (rule: WriteRule) => {
    setSaveError(null);
    const result = await commands.upsertWriteRule({
      ...rule,
      priority: 0,
      name: rule.name.trim(),
      matchers: {
        bundle_ids: rule.matchers.bundle_ids ?? [],
        url_patterns: rule.matchers.url_patterns ?? [],
      },
    });
    if (result.status === "ok") {
      setAdding(false);
      setEditingId(null);
      await loadRules();
      await refreshSettings();
      await refreshActiveRule();
    } else {
      setSaveError(result.error);
    }
  };

  const deleteRule = async (id: string) => {
    const result = await commands.deleteWriteRule(id);
    if (result.status === "ok") {
      await loadRules();
      await refreshSettings();
    }
  };

  // ─── EDIT MODE ────────────────────────────────────────────────────
  if (inEditMode) {
    return (
      <WriteRuleEditor
        rule={editingRule}
        tones={tones}
        prompts={prompts}
        onSave={(rule) => void saveRule(rule)}
        onCancel={() => {
          setAdding(false);
          setEditingId(null);
          setSaveError(null);
        }}
        saveError={saveError}
      />
    );
  }

  // ─── LIST MODE ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <SettingsGroup
        noCard
        title={t("refine.writeRules.title")}
        description={t("refine.writeRules.description")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary-soft"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("refine.writeRules.newRule")}
          </Button>
          <SegmentedControl<ViewMode>
            value={viewMode}
            onChange={setViewMode}
            layoutId="write-profiles-view-toggle"
            ariaLabel={t("refine.writeRules.view.ariaLabel", {
              defaultValue: "Write profile view",
            })}
            items={[
              {
                value: "individual",
                label: t("refine.writeRules.view.individual"),
              },
              {
                value: "grouped",
                label: t("refine.writeRules.view.grouped"),
              },
            ]}
          />
        </div>
      </SettingsGroup>

      {rules.length === 0 ? (
        <EmptyState
          icon={<WandSparkles className="h-5 w-5" aria-hidden />}
          title={t("settings.styles.empty", { defaultValue: emptyTitle })}
          description={t("settings.styles.emptyDescription", {
            defaultValue: emptyBody,
          })}
          example={t("settings.styles.emptyExample", {
            defaultValue:
              "For example, keep Slack casual while Mail and docs use a cleaner professional style.",
          })}
          action={
            <Button
              type="button"
              size="sm"
              variant="primary-soft"
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("settings.styles.createFirstProfile", {
                defaultValue: createFirstLabel,
              })}
            </Button>
          }
        />
      ) : viewMode === "grouped" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {groupedRules.map((group) => (
            <WriteProfileGroupCard
              key={group.key}
              group={group}
              apps={apps}
              tones={tones}
              prompts={prompts}
              models={models}
              activeRuleId={activeRuleId}
              onEdit={(rule) => {
                setAdding(false);
                setEditingId(rule.id);
              }}
              onDelete={(id) => void deleteRule(id)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {sortedRules.map((rule) => (
            <WriteRuleRow
              key={rule.id}
              rule={rule}
              apps={apps}
              tones={tones}
              prompts={prompts}
              models={models}
              isActive={rule.id === activeRuleId}
              onEdit={() => {
                setAdding(false);
                setEditingId(rule.id);
              }}
              onDelete={() => void deleteRule(rule.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
