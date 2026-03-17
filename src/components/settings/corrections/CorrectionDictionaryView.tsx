import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type { StoredCorrection } from "@/bindings";
import { Button } from "../../ui/Button";

export const CorrectionDictionaryView: React.FC = () => {
  const { t } = useTranslation();
  const [corrections, setCorrections] = useState<StoredCorrection[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCorrections = useCallback(async () => {
    try {
      const result = await commands.getCorrections();
      if (result.status === "ok") {
        setCorrections(result.data);
      }
    } catch (error) {
      console.error("Failed to load corrections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCorrections();
  }, [loadCorrections]);

  const handleDelete = async (id: number) => {
    try {
      const result = await commands.deleteCorrection(id);
      if (result.status === "ok") {
        setCorrections((prev) => prev.filter((c) => c.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete correction:", error);
    }
  };

  const handleToggle = async (id: number, currentActive: boolean) => {
    try {
      const result = await commands.toggleCorrection(id, !currentActive);
      if (result.status === "ok") {
        setCorrections((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, is_active: !currentActive } : c,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to toggle correction:", error);
    }
  };

  const handleClearAll = async () => {
    try {
      const result = await commands.clearAllCorrections();
      if (result.status === "ok") {
        setCorrections([]);
      }
    } catch (error) {
      console.error("Failed to clear corrections:", error);
    }
  };

  const handleExport = async () => {
    try {
      const result = await commands.exportCorrections();
      if (result.status === "ok") {
        const blob = new Blob([result.data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "vox-jot-corrections.json";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Failed to export corrections:", error);
    }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      try {
        const result = await commands.importCorrections(text);
        if (result.status === "ok") {
          loadCorrections();
        }
      } catch (error) {
        console.error("Failed to import corrections:", error);
      }
    };
    input.click();
  };

  if (loading) {
    return (
      <div className="px-5 py-4 text-sm text-[var(--muted)]">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-5">
        <span className="text-sm text-[var(--muted)]">
          {corrections.length === 0
            ? t("settings.corrections.dictionary.empty")
            : t("settings.corrections.dictionary.count", {
                count: corrections.length,
              })}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleImport}>
            {t("settings.corrections.dictionary.import")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExport}
            disabled={corrections.length === 0}
          >
            {t("settings.corrections.dictionary.export")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={handleClearAll}
            disabled={corrections.length === 0}
          >
            {t("settings.corrections.dictionary.clearAll")}
          </Button>
        </div>
      </div>

      {corrections.length > 0 && (
        <div className="flat-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-2.5">
                  {t("settings.corrections.dictionary.columns.original")}
                </th>
                <th className="px-4 py-2.5">
                  {t("settings.corrections.dictionary.columns.corrected")}
                </th>
                <th className="px-4 py-2.5 text-center">
                  {t("settings.corrections.dictionary.columns.frequency")}
                </th>
                <th className="px-4 py-2.5 text-center">
                  {t("settings.corrections.dictionary.columns.confidence")}
                </th>
                <th className="px-4 py-2.5">
                  {t("settings.corrections.dictionary.columns.source")}
                </th>
                <th className="px-4 py-2.5 text-center">
                  {t("settings.corrections.dictionary.columns.active")}
                </th>
                <th className="px-4 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {corrections.map((c) => (
                <tr
                  key={c.id}
                  className={`${!c.is_active ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-2.5 font-mono text-[var(--text)]">
                    {c.original}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[var(--text)]">
                    {c.corrected}
                  </td>
                  <td className="px-4 py-2.5 text-center text-[var(--muted)]">
                    {c.frequency}
                  </td>
                  <td className="px-4 py-2.5 text-center text-[var(--muted)]">
                    {(c.confidence * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-2.5 text-[var(--muted)] truncate max-w-[140px]">
                    {c.source_app || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      type="button"
                      className={`inline-block w-8 h-4 rounded-full transition-colors ${
                        c.is_active
                          ? "bg-[var(--accent)]"
                          : "bg-[var(--border)]"
                      }`}
                      onClick={() => handleToggle(c.id, c.is_active)}
                    >
                      <span
                        className={`block w-3 h-3 rounded-full bg-white shadow transition-transform ${
                          c.is_active ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      className="text-red-500 hover:text-red-700 text-xs"
                      onClick={() => handleDelete(c.id)}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
