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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type InstalledApp,
  type ModelInfo,
  type PostProcessResult,
  type ResolvedWriteRule,
  type ToneDefinition,
  type WriteRule,
} from "@/bindings";
import {
  readCachedInstalledApps,
  refreshInstalledApps,
  subscribeInstalledApps,
} from "@/lib/installedApps";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl, SettingsGroup, Textarea } from "@/components/ui";
import { WriteRuleEditor } from "./WriteRuleEditor";
import {
  groupWriteRules,
  WriteProfileGroupCard,
} from "./WriteProfileGroupCard";
import { WriteRuleRow } from "./WriteRuleRow";
import { modal } from "@/motion/springs";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";

const emptyTitle = "No Dictation Modes yet";
const emptyBody =
  "Create a mode to switch tone, engine, or output behavior automatically based on the app or website you're dictating into.";
const createFirstLabel = "Create your first mode";
const previewSampleText =
  "rewrite this to be concise: quick note, please follow up with Alex tomorrow about the launch checklist and send me the final blocker list";
type ViewMode = "individual" | "grouped";

export const WriteRulesSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings, updateSetting } = useSettings();

  const [rules, setRules] = useState<WriteRule[]>([]);
  const [apps, setApps] = useState<InstalledApp[]>(
    () => readCachedInstalledApps() ?? [],
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");
  const [previewRule, setPreviewRule] = useState<WriteRule | null>(null);
  const [previewInput, setPreviewInput] = useState(previewSampleText);
  const [previewResult, setPreviewResult] = useState<PostProcessResult | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const profileDialogRef = useRef<HTMLDivElement>(null);
  const previewDialogRef = useRef<HTMLDivElement>(null);

  const tones = getSetting("tone_definitions") ?? [];
  const prompts = getSetting("post_process_prompts") ?? [];

  const createToneDefinition = useCallback(
    async (draft: {
      label: string;
      instruction: string;
    }): Promise<ToneDefinition> => {
      const label = draft.label.trim();
      const instruction = draft.instruction.trim();
      const baseId =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "custom-tone";
      const usedIds = new Set(tones.map((tone) => tone.id));
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      const definition: ToneDefinition = { id, label, instruction };
      await updateSetting("tone_definitions", [...tones, definition]);
      await refreshSettings();
      return definition;
    },
    [refreshSettings, tones, updateSetting],
  );

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => left.name.localeCompare(right.name)),
    [rules],
  );
  const groupedRules = useMemo(() => groupWriteRules(rules), [rules]);
  const editingRule = editingId
    ? rules.find((rule) => rule.id === editingId)
    : undefined;
  const isProfileWindowOpen = adding || !!editingRule;
  const isPreviewWindowOpen = !!previewRule;

  useDialogFocusTrap({
    enabled: isProfileWindowOpen,
    containerRef: profileDialogRef,
    initialFocusSelector: "input, textarea, button",
  });
  useDialogFocusTrap({
    enabled: isPreviewWindowOpen,
    containerRef: previewDialogRef,
    initialFocusSelector: "textarea, button",
  });

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

  const clearSaveError = useCallback(() => {
    setSaveError(null);
  }, []);

  const closePreviewWindow = useCallback(() => {
    setPreviewRule(null);
    setPreviewResult(null);
    setPreviewError(null);
    setIsPreviewing(false);
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

  const openPreviewWindow = (rule: WriteRule) => {
    setPreviewRule(rule);
    setPreviewInput((value) => value || previewSampleText);
    setPreviewResult(null);
    setPreviewError(null);
  };

  const appsByBundleId = useMemo(
    () => new Map(apps.map((app) => [app.bundle_id, app.name])),
    [apps],
  );

  const previewTargetLabel = useMemo(() => {
    if (!previewRule) return "";
    const bundleIds = previewRule.matchers.bundle_ids ?? [];
    const urls = previewRule.matchers.url_patterns ?? [];
    if (urls.length > 0) {
      return urls.length === 1 ? urls[0] : `${urls[0]} +${urls.length - 1}`;
    }
    if (bundleIds.length === 1) {
      return appsByBundleId.get(bundleIds[0]) ?? bundleIds[0];
    }
    if (bundleIds.length > 1) {
      return t("refine.writeRules.preview.multipleApps", {
        defaultValue: "{{count}} apps",
        count: bundleIds.length,
      });
    }
    return t("refine.writeRules.row.anyApp", { defaultValue: "Any app" });
  }, [appsByBundleId, previewRule, t]);

  const previewUsesUrlRule =
    (previewRule?.matchers.url_patterns ?? []).length > 0;
  const previewAppliedToneLabel = useMemo(() => {
    const toneId = previewResult?.applied_tone_id;
    if (!toneId) return null;
    return tones.find((tone) => tone.id === toneId)?.label ?? toneId;
  }, [previewResult?.applied_tone_id, tones]);
  const previewOutputUnchanged =
    !!previewResult &&
    previewResult.final_text.trim() === previewInput.trim() &&
    previewResult.dictionary_hits.length === 0;

  const runModePreview = async () => {
    if (!previewRule || !previewInput.trim()) return;
    setIsPreviewing(true);
    setPreviewError(null);
    try {
      const result = await commands.previewWriteRuleText(
        previewRule.id,
        previewInput,
      );
      if (result.status === "ok") {
        setPreviewResult(result.data);
      } else {
        setPreviewResult(null);
        setPreviewError(result.error);
      }
    } catch (error) {
      setPreviewResult(null);
      setPreviewError(
        error instanceof Error
          ? error.message
          : t("refine.writeRules.preview.error", {
              defaultValue: "Could not preview this mode.",
            }),
      );
    } finally {
      setIsPreviewing(false);
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
            ref={profileDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="write-profile-dialog-title"
            className="relative flex max-h-[min(88vh,920px)] w-full max-w-[840px] flex-col overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) =>
              handleDialogKeyDown(
                event,
                profileDialogRef.current,
                closeProfileWindow,
              )
            }
          >
            <WriteRuleEditor
              rule={editingRule}
              tones={tones}
              prompts={prompts}
              models={models}
              onCreateTone={createToneDefinition}
              onSave={(rule) => void saveRule(rule)}
              onDraftChange={clearSaveError}
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

  const previewWindow = createPortal(
    <AnimatePresence>
      {previewRule ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={closePreviewWindow}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            ref={previewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="write-mode-preview-title"
            className="relative flex max-h-[min(88vh,760px)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) =>
              handleDialogKeyDown(
                event,
                previewDialogRef.current,
                closePreviewWindow,
              )
            }
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h2
                  id="write-mode-preview-title"
                  className="text-lg font-semibold text-[var(--text)]"
                >
                  {t("refine.writeRules.preview.title", {
                    defaultValue: "Preview mode",
                  })}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  {t("refine.writeRules.preview.description", {
                    defaultValue:
                      "This previews text cleanup for {{name}}. Live dictation still applies the mode automatically when {{target}} is focused.",
                    name: previewRule.name,
                    target: previewTargetLabel,
                  })}
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={closePreviewWindow}>
                {t("common.close", { defaultValue: "Close" })}
              </Button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-4">
              {previewUsesUrlRule ? (
                <Alert variant="info">
                  {t("refine.writeRules.preview.urlOnly", {
                    defaultValue:
                      "This preview forces the selected website mode. In live dictation, open {{target}}, focus a text field, then use your dictation shortcut.",
                    target: previewTargetLabel,
                  })}
                </Alert>
              ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="write-mode-preview-input"
                    className="text-xs font-semibold text-[var(--muted)]"
                  >
                    {t("refine.writeRules.preview.inputLabel", {
                      defaultValue: "Sample dictation",
                    })}
                  </label>
                  <Textarea
                    id="write-mode-preview-input"
                    value={previewInput}
                    onChange={(event) => setPreviewInput(event.target.value)}
                    disabled={isPreviewing}
                    className="min-h-[140px]"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-[var(--muted)]">
                    {t("refine.writeRules.preview.outputLabel", {
                      defaultValue: "Mode output",
                    })}
                  </div>
                  <Textarea
                    value={previewResult?.final_text ?? ""}
                    readOnly
                    placeholder={t("refine.writeRules.preview.outputPlaceholder", {
                      defaultValue: "Preview output appears here.",
                    })}
                    className="min-h-[140px]"
                  />
                </div>
              </div>

              {previewError ? <Alert variant="error">{previewError}</Alert> : null}

              {previewOutputUnchanged ? (
                <Alert variant="info">
                  {t("refine.writeRules.preview.unchanged", {
                    defaultValue:
                      "Preview completed with unchanged text. That can happen when the sample is already clean or cleanup is not configured; live dictation still uses this mode's app, model, tone, and output settings.",
                  })}
                </Alert>
              ) : null}

              {previewAppliedToneLabel ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--muted)]">
                  {t("refine.writeRules.preview.appliedTone", {
                    defaultValue: "Applied tone: {{tone}}",
                    tone: previewAppliedToneLabel,
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <Button type="button" variant="ghost" onClick={closePreviewWindow}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button
                type="button"
                onClick={() => void runModePreview()}
                disabled={
                  isPreviewing || !previewInput.trim()
                }
              >
                {isPreviewing
                  ? t("refine.writeRules.preview.running", {
                      defaultValue: "Previewing…",
                    })
                  : t("refine.writeRules.preview.run", {
                      defaultValue: "Run preview",
                    })}
              </Button>
            </div>
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
      {previewWindow}
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
            {t("refine.writeRules.newRule")}
          </Button>
          <SegmentedControl<ViewMode>
            value={viewMode}
            onChange={setViewMode}
            layoutId="write-profiles-view-toggle"
            ariaLabel={t("refine.writeRules.view.ariaLabel", {
              defaultValue: "Dictation Modes view",
            })}
            items={[
              {
                value: "grouped",
                label: t("refine.writeRules.view.grouped"),
              },
              {
                value: "individual",
                label: t("refine.writeRules.view.individual"),
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
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("settings.styles.createFirstProfile", {
                defaultValue: createFirstLabel,
              })}
            </Button>
          }
        />
      ) : viewMode === "grouped" ? (
        <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
              onDelete={(id) => deleteRule(id)}
              onTry={(rule) => openPreviewWindow(rule)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-7">
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
              onDelete={() => deleteRule(rule.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
