// Write Profiles top-level settings page (Refine → Write profiles).
//
// This page now keeps the profile list visible while create/edit happens
// in a dialog. That preserves the user's place in the grid and keeps the
// add/edit flow consistent with the rest of the settings windows.
//
// The parent loads `apps` / `models` once and threads them through to
// the list so each row can resolve raw ids (com.openai.codex, "coding")
// to friendly labels ("Codex", "Coding") — this is the biggest single
// scannability win versus the previous list (Nielsen heuristic #2).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
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
import { modal } from "@/motion/springs";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";

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
  const isProfileWindowOpen = adding || !!editingRule;

  const openAddProfileWindow = useCallback(() => {
    setEditingId(null);
    setSaveError(null);
    setAdding(true);
  }, []);

  const openEditProfileWindow = useCallback((rule: WriteRule) => {
    setAdding(false);
    setSaveError(null);
    setEditingId(rule.id);
  }, []);

  const closeProfileWindow = useCallback(() => {
    setAdding(false);
    setEditingId(null);
    setSaveError(null);
  }, []);

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
    if (adding || editingId) return; // pause while user is editing
    void refreshActiveRule();
    const id = window.setInterval(() => {
      void refreshActiveRule();
    }, 4000);
    return () => window.clearInterval(id);
  }, [adding, editingId, refreshActiveRule, rules.length]);

  useEffect(() => {
    if (!isProfileWindowOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeProfileWindow();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeProfileWindow, isProfileWindowOpen]);

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
    const ruleName =
      rules.find((rule) => rule.id === id)?.name ??
      t("refine.writeRules.profileFallback", {
        defaultValue: "this write profile",
      });
    if (
      !confirmDestructiveAction(
        t("refine.writeRules.deleteConfirm", {
          ruleName,
          defaultValue: 'Delete write profile "{{ruleName}}"?',
        }),
      )
    ) {
      return;
    }

    const result = await commands.deleteWriteRule(id);
    if (result.status === "ok") {
      await loadRules();
      await refreshSettings();
    }
  };

  const profileWindow = createPortal(
    <AnimatePresence>
      {isProfileWindowOpen ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={closeProfileWindow}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="write-profile-dialog-title"
            className="relative flex max-h-[min(88vh,920px)] w-full max-w-[840px] flex-col overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <WriteRuleEditor
              rule={editingRule}
              tones={tones}
              prompts={prompts}
              models={models}
              onSave={(rule) => void saveRule(rule)}
              onCancel={closeProfileWindow}
              saveError={saveError}
              presentation="dialog"
              titleId="write-profile-dialog-title"
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  // ─── LIST MODE ────────────────────────────────────────────────────
  return (
    <div className="space-y-7">
      {profileWindow}
      <SettingsGroup
        noCard
        title={t("refine.writeRules.title")}
        description={t("refine.writeRules.description")}
        showTitle={false}
        descriptionOnlyGap="controls"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary-soft"
            onClick={openAddProfileWindow}
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
              onClick={openAddProfileWindow}
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
              onEdit={openEditProfileWindow}
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
              onEdit={() => openEditProfileWindow(rule)}
              onDelete={() => void deleteRule(rule.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
