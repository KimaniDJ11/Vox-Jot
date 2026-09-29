import React from "react";
import type {
  WatchFolderConfig,
  SpeechAnalysisModelDescriptor,
} from "@/bindings";
import { useTranslation } from "react-i18next";
import { basename } from "../file-workspace/filePaths";
import { Loader2, AlertCircle } from "lucide-react";
import { SelectedAsrModelInline } from "../file-workspace/SelectedAsrModelInline";

export type WatchProgressPayload = {
  folder_id: string;
  source_path: string;
  stage: "started" | "completed" | "failed" | "missing";
  message: string | null;
};

export const WatchedFoldersStatusHeader: React.FC<{
  folders: WatchFolderConfig[];
  activity: WatchProgressPayload[];
  selectedAsrModel: SpeechAnalysisModelDescriptor | null;
}> = ({ folders, activity, selectedAsrModel }) => {
  const { t } = useTranslation();
  const latest = activity[0];
  const active = latest?.stage === "started" ? latest : undefined;
  const missingCount = folders.filter((folder) => folder.missing).length;
  const needsAttention =
    latest?.stage === "failed" ||
    latest?.stage === "missing" ||
    missingCount > 0;
  const isFolderCountSummary = folders.length > 0 && !active && !needsAttention;
  const status = (() => {
    if (active) {
      return {
        label: t("dictate.watchFolders.status.processing", {
          defaultValue: "Processing",
        }),
        detail: basename(active.source_path),
        icon: <Loader2 size={12} className="animate-spin" aria-hidden="true" />,
      };
    }
    if (latest?.stage === "failed" || latest?.stage === "missing") {
      return {
        label: t("dictate.watchFolders.status.needsAttention", {
          defaultValue: "Needs attention",
        }),
        detail: basename(latest.source_path),
        icon: <AlertCircle size={12} aria-hidden="true" />,
      };
    }
    if (missingCount > 0) {
      return {
        label: t("dictate.watchFolders.status.needsAttention", {
          defaultValue: "Needs attention",
        }),
        detail: t("dictate.watchFolders.status.missingCount", {
          count: missingCount,
          defaultValue:
            missingCount === 1
              ? "1 missing folder"
              : "{{count}} missing folders",
        }),
        icon: <AlertCircle size={12} aria-hidden="true" />,
      };
    }
    if (folders.length > 0) {
      return {
        label: t("dictate.watchFolders.status.countLabel", {
          defaultValue: "WATCHED FOLDERS",
        }),
        detail: String(folders.length),
        icon: null,
      };
    }
    return {
      label: t("dictate.fileTranscription.status.ready", {
        defaultValue: "Ready",
      }),
      detail: t("dictate.watchFolders.status.emptyDetail", {
        defaultValue: "No watched folders",
      }),
      icon: null,
    };
  })();

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div
          className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]"
          role="status"
          aria-live="polite"
          title={active || latest ? status.detail : undefined}
        >
          {status.icon && <span className="shrink-0">{status.icon}</span>}
          <span
            className={[
              "min-w-0 truncate",
              isFolderCountSummary
                ? "text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"
                : "",
            ].join(" ")}
          >
            <span
              className={
                isFolderCountSummary ? "" : "font-medium text-[var(--text)]"
              }
            >
              {status.label}
            </span>
            <span className="mx-1.5 text-[var(--border-strong)]">·</span>
            <span>{status.detail}</span>
          </span>
        </div>
        <SelectedAsrModelInline model={selectedAsrModel} />
      </div>
      <div className="border-t border-[var(--border)]" aria-hidden="true" />
    </div>
  );
};
