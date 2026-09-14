import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  FileCheck,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { commands, type MarkdownExportContentSource } from "@/bindings";
import { useSetting } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { Button, ToggleSwitch } from "@/components/ui";

interface MarkdownExportSettingsProps {
  grouped?: boolean;
}

export const MarkdownExportSettings: React.FC<MarkdownExportSettingsProps> = ({
  grouped = false,
}) => {
  const { t } = useTranslation();
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const refreshSettings = useSettingsStore((state) => state.refreshSettings);
  const isUpdating = useSettingsStore((state) => state.isUpdatingKey);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isTestingWrite, setIsTestingWrite] = useState(false);

  const enabled =
    (useSetting("markdown_export_enabled") as boolean | undefined) ?? false;
  const exportDir =
    (useSetting("markdown_export_dir") as string | null | undefined) ?? null;
  const minWords =
    (useSetting("markdown_export_min_words") as number | undefined) ?? 3;
  const contentSource =
    (useSetting("markdown_export_content_source") as
      MarkdownExportContentSource | undefined) ?? "final";
  const frontmatter =
    (useSetting("markdown_export_frontmatter") as boolean | undefined) ?? true;
  const includeSelectionRewrites =
    (useSetting("markdown_export_include_rewrite_selection") as
      boolean | undefined) ?? false;
  const includeUndelivered =
    (useSetting("markdown_export_include_failed_paste") as
      boolean | undefined) ?? false;

  const handlePickDirectory = async () => {
    setFolderError(null);
    setTestResult(null);
    setIsChoosingFolder(true);
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      const result = await commands.changeMarkdownExportDirSetting(picked);
      if (result.status === "error") {
        setFolderError(result.error);
        return;
      }
      await refreshSettings();
    } catch (error) {
      setFolderError(
        error instanceof Error
          ? error.message
          : t("settings.privacy.markdownExport.folderError", {
              defaultValue: "The export folder could not be saved.",
            }),
      );
    } finally {
      setIsChoosingFolder(false);
    }
  };

  const handleTestWrite = async () => {
    setFolderError(null);
    setTestResult(null);
    setIsTestingWrite(true);
    try {
      const result = await commands.testMarkdownExportWrite();
      if (result.status === "ok") {
        setTestResult({ success: true, message: result.data });
      } else {
        setTestResult({ success: false, message: result.error });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Test write failed",
      });
    } finally {
      setIsTestingWrite(false);
    }
  };

  return (
    <div className={`space-y-4 ${grouped ? "p-4" : ""}`}>
      <ToggleSwitch
        checked={enabled}
        onChange={(checked) =>
          void updateSetting("markdown_export_enabled", checked)
        }
        disabled={!exportDir}
        isUpdating={isUpdating("markdown_export_enabled")}
        label={t("settings.privacy.markdownExport.enableLabel", {
          defaultValue: "Auto-export transcriptions to Markdown",
        })}
        description={
          exportDir
            ? t("settings.privacy.markdownExport.enableDescription", {
                defaultValue:
                  "Save eligible future dictations as Markdown files in your Obsidian vault or selected folder.",
              })
            : t("settings.privacy.markdownExport.chooseFirstDescription", {
                defaultValue:
                  "Choose an export folder (e.g. your Obsidian vault) before turning this on.",
              })
        }
        descriptionMode="inline"
        grouped={grouped}
      />

      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">
            {t("settings.privacy.markdownExport.folderLabel", {
              defaultValue: "Obsidian-friendly folder",
            })}
          </p>
          <p className="break-all text-xs text-[var(--muted)]">
            {exportDir ??
              t("settings.privacy.markdownExport.noFolderChosen", {
                defaultValue:
                  "No folder selected (e.g. ~/Documents/Obsidian/Inbox)",
              })}
          </p>
          {folderError && (
            <p className="mt-1 text-xs text-[var(--danger)]" role="alert">
              {folderError}
            </p>
          )}
          {testResult && (
            <p
              className={`mt-1 flex items-center gap-1.5 text-xs ${
                testResult.success
                  ? "text-[var(--success,#4ade80)]"
                  : "text-[var(--danger)]"
              }`}
              role="status"
            >
              {testResult.success && (
                <CheckCircle2 className="h-3 w-3 shrink-0" />
              )}
              {testResult.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exportDir && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleTestWrite()}
              disabled={isTestingWrite}
              className="gap-1.5"
            >
              {isTestingWrite ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FileCheck className="h-3.5 w-3.5" aria-hidden />
              )}
              {isTestingWrite
                ? t("settings.privacy.markdownExport.testingWrite", {
                    defaultValue: "Testing…",
                  })
                : t("settings.privacy.markdownExport.testWrite", {
                    defaultValue: "Test write",
                  })}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handlePickDirectory()}
            disabled={isChoosingFolder}
            className="gap-1.5"
          >
            {exportDir ? (
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Folder className="h-3.5 w-3.5" aria-hidden />
            )}
            {isChoosingFolder
              ? t("settings.privacy.markdownExport.choosingFolder", {
                  defaultValue: "Choosing…",
                })
              : exportDir
                ? t("settings.privacy.markdownExport.changeFolder", {
                    defaultValue: "Change folder",
                  })
                : t("settings.privacy.markdownExport.chooseFolder", {
                    defaultValue: "Choose folder",
                  })}
          </Button>
        </div>
      </div>

      {exportDir && (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-[var(--text)]">
                {t("settings.privacy.markdownExport.contentLabel", {
                  defaultValue: "File content",
                })}
              </span>
              <span className="block text-xs text-[var(--muted)]">
                {t("settings.privacy.markdownExport.contentDescription", {
                  defaultValue:
                    "Choose the delivered/refined text or the raw speech transcript.",
                })}
              </span>
            </span>
            <select
              value={contentSource}
              onChange={(event) =>
                void updateSetting(
                  "markdown_export_content_source",
                  event.target.value as MarkdownExportContentSource,
                )
              }
              disabled={isUpdating("markdown_export_content_source")}
              className="min-h-9 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="final">
                {t("settings.privacy.markdownExport.contentFinal", {
                  defaultValue: "Final text",
                })}
              </option>
              <option value="raw">
                {t("settings.privacy.markdownExport.contentRaw", {
                  defaultValue: "Raw transcript",
                })}
              </option>
            </select>
          </label>

          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-[var(--text)]">
                {t("settings.privacy.markdownExport.minWordsLabel", {
                  defaultValue: "Minimum word count",
                })}
              </span>
              <span className="block text-xs text-[var(--muted)]">
                {t("settings.privacy.markdownExport.minWordsDescription", {
                  defaultValue:
                    "Shorter entries are recorded in History but not exported.",
                })}
              </span>
            </span>
            <input
              type="number"
              min={1}
              max={1000}
              value={minWords}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(value)) {
                  void updateSetting(
                    "markdown_export_min_words",
                    Math.min(1000, Math.max(1, value)),
                  );
                }
              }}
              className="min-h-9 w-20 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 text-center text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </label>

          <ToggleSwitch
            checked={frontmatter}
            onChange={(checked) =>
              void updateSetting("markdown_export_frontmatter", checked)
            }
            isUpdating={isUpdating("markdown_export_frontmatter")}
            label={t("settings.privacy.markdownExport.frontmatterLabel", {
              defaultValue: "Include YAML frontmatter",
            })}
            description={t(
              "settings.privacy.markdownExport.frontmatterDescription",
              {
                defaultValue:
                  "Add date, duration, word count, and the Vox Jot history ID.",
              },
            )}
            descriptionMode="inline"
            grouped={grouped}
          />

          <ToggleSwitch
            checked={includeSelectionRewrites}
            onChange={(checked) =>
              void updateSetting(
                "markdown_export_include_rewrite_selection",
                checked,
              )
            }
            isUpdating={isUpdating("markdown_export_include_rewrite_selection")}
            label={t("settings.privacy.markdownExport.rewritesLabel", {
              defaultValue: "Include selection rewrites",
            })}
            description={t(
              "settings.privacy.markdownExport.rewritesDescription",
              {
                defaultValue:
                  "Also export entries created by editing selected text.",
              },
            )}
            descriptionMode="inline"
            grouped={grouped}
          />

          <ToggleSwitch
            checked={includeUndelivered}
            onChange={(checked) =>
              void updateSetting(
                "markdown_export_include_failed_paste",
                checked,
              )
            }
            isUpdating={isUpdating("markdown_export_include_failed_paste")}
            label={t("settings.privacy.markdownExport.failedPasteLabel", {
              defaultValue: "Include text that was not delivered",
            })}
            description={t(
              "settings.privacy.markdownExport.failedPasteDescription",
              {
                defaultValue:
                  "Export recoverable History entries even when paste was skipped or failed.",
              },
            )}
            descriptionMode="inline"
            grouped={grouped}
          />

          <p className="text-xs leading-relaxed text-[var(--muted)]">
            {t("settings.privacy.markdownExport.snapshotNote", {
              defaultValue:
                "Export settings are captured with each new History entry. Retrying a failed export uses that saved folder, filename, and format.",
            })}
          </p>
        </div>
      )}
    </div>
  );
};
