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
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type InstalledApp,
  type ModelInfo,
  type ResolvedWriteRule,
  type WriteRule,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { AppAwareWriteProfilesToggle } from "@/components/settings/AppAwareWriteProfilesToggle";
import { Button } from "@/components/ui/Button";
import { SettingsGroup, ToggleSwitch } from "@/components/ui";
import { WriteRuleEditor } from "./WriteRuleEditor";
import { WriteRuleRow } from "./WriteRuleRow";
import { TestRuleButton } from "./TestRuleButton";

const urlCaptureLabel = "Capture browser URL for website rules";
const urlCaptureDescription =
  "Off by default. When on, Vox Jot asks Safari, Chrome, Arc, Firefox, Brave, and Edge for the active tab URL so URL patterns can match.";
const emptyTitle = "No write profiles yet";
const emptyBody =
  "Create a profile to switch tone, engine, or output behavior automatically based on the app or website you're dictating into.";
const createFirstLabel = "Create your first profile";

export const WriteRulesSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, refreshSettings, isUpdating } =
    useSettings();

  const [rules, setRules] = useState<WriteRule[]>([]);
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const tones = getSetting("tone_definitions") ?? [];
  const prompts = getSetting("post_process_prompts") ?? [];
  const urlCaptureEnabled =
    getSetting("write_rules_url_capture_enabled") ?? false;

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => right.priority - left.priority),
    [rules],
  );
  const editingRule = editingId
    ? sortedRules.find((rule) => rule.id === editingId)
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
    void commands.listInstalledApps().then((result) => {
      if (result.status === "ok") setApps(result.data);
    });
    void commands.getAvailableModels().then((result) => {
      if (result.status === "ok") setModels(result.data);
    });
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
    const resolved: Awaited<ReturnType<typeof commands.testResolveWriteRule>> =
      await commands.testResolveWriteRule(
        appResult.data.bundle_id,
        appResult.data.localized_name,
        null,
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
    const result = await commands.upsertWriteRule({
      ...rule,
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
    }
  };

  const deleteRule = async (id: string) => {
    const result = await commands.deleteWriteRule(id);
    if (result.status === "ok") {
      await loadRules();
      await refreshSettings();
    }
  };

  const moveRule = async (id: string, direction: -1 | 1) => {
    const next = [...sortedRules];
    const index = next.findIndex((rule) => rule.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setRules(next);
    await commands.reorderWriteRules(next.map((rule) => rule.id));
    await loadRules();
    await refreshSettings();
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
        }}
      />
    );
  }

  // ─── LIST MODE ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <SettingsGroup
        title={t("refine.writeRules.title")}
        description={t("refine.writeRules.description")}
        titleAction={
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
        }
      >
        <div className="space-y-3 px-5 py-4">
          <AppAwareWriteProfilesToggle descriptionMode="tooltip" grouped />
          <ToggleSwitch
            grouped
            label={urlCaptureLabel}
            description={urlCaptureDescription}
            checked={urlCaptureEnabled}
            isUpdating={isUpdating("write_rules_url_capture_enabled")}
            onChange={(enabled) =>
              void updateSetting("write_rules_url_capture_enabled", enabled)
            }
          />
          <TestRuleButton />
        </div>
      </SettingsGroup>

      {sortedRules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--input)]/40 p-8 text-center">
          <p className="text-sm font-semibold text-[var(--text)]">
            {emptyTitle}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--muted)]">
            {emptyBody}
          </p>
          <Button
            type="button"
            size="sm"
            variant="primary-soft"
            className="mt-4"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {createFirstLabel}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedRules.map((rule, index) => (
            <WriteRuleRow
              key={rule.id}
              rule={rule}
              index={index}
              count={sortedRules.length}
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
              onMove={(direction) => void moveRule(rule.id, direction)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
