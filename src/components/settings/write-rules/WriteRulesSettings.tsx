import React, { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { commands, type WriteRule } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { AppAwareWriteProfilesToggle } from "@/components/settings/AppAwareWriteProfilesToggle";
import { Button } from "@/components/ui/Button";
import { SettingsGroup, ToggleSwitch } from "@/components/ui";
import { WriteRuleEditor } from "./WriteRuleEditor";
import { WriteRuleRow } from "./WriteRuleRow";
import { TestRuleButton } from "./TestRuleButton";

const urlCaptureLabel = "Capture browser URL for website rules";
const urlCaptureDescription =
  "Off by default. When enabled, Vox Jot asks known browsers for the active tab URL so website rules can match.";
const emptyStateLabel = "No write profiles yet.";

export const WriteRulesSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, refreshSettings, isUpdating } =
    useSettings();
  const [rules, setRules] = useState<WriteRule[]>([]);
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

  const loadRules = async () => {
    const result = await commands.listWriteRules();
    if (result.status === "ok") {
      setRules(result.data);
    }
  };

  useEffect(() => {
    void loadRules();
  }, []);

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
    [next[index], next[target]] = [next[target], next[index]];
    setRules(next);
    await commands.reorderWriteRules(next.map((rule) => rule.id));
    await loadRules();
    await refreshSettings();
  };

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
        <div className="space-y-4 px-5 py-4">
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

      <div className="space-y-3">
        {sortedRules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
            {emptyStateLabel}
          </div>
        ) : (
          sortedRules.map((rule, index) => (
            <WriteRuleRow
              key={rule.id}
              rule={rule}
              index={index}
              count={sortedRules.length}
              onEdit={() => {
                setAdding(false);
                setEditingId(rule.id);
              }}
              onDelete={() => void deleteRule(rule.id)}
              onMove={(direction) => void moveRule(rule.id, direction)}
            />
          ))
        )}
      </div>

      {(adding || editingRule) && (
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
      )}
    </div>
  );
};
