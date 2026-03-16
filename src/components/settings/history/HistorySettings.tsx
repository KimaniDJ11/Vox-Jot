import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { Copy, Star, Check, Trash2, FolderOpen } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import { commands, type HistoryEntry } from "@/bindings";
import { formatDateTime } from "@/utils/dateFormat";
import { useOsType } from "@/hooks/useOsType";

type HistoryTab = "recordings" | "jots";

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <Button
    onClick={onClick}
    variant="secondary"
    size="sm"
    className="flex items-center gap-2"
    title={label}
  >
    <FolderOpen className="w-4 h-4" />
    <span>{label}</span>
  </Button>
);

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<HistoryTab>("recordings");
  const [loading, setLoading] = useState(true);

  const loadHistoryEntries = useCallback(async () => {
    try {
      const result = await commands.getHistoryEntries();
      if (result.status === "ok") {
        setHistoryEntries(result.data);
      }
    } catch (error) {
      console.error("Failed to load history entries:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistoryEntries();

    // Listen for history update events
    const setupListener = async () => {
      const unlisten = await listen("history-updated", () => {
        console.log("History updated, reloading entries...");
        loadHistoryEntries();
      });

      // Return cleanup function
      return unlisten;
    };

    let unlistenPromise = setupListener();

    return () => {
      unlistenPromise.then((unlisten) => {
        if (unlisten) {
          unlisten();
        }
      });
    };
  }, [loadHistoryEntries]);

  const toggleSaved = async (id: number) => {
    try {
      await commands.toggleHistoryEntrySaved(id);
      // No need to reload here - the event listener will handle it
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const getAudioUrl = useCallback(
    async (fileName: string) => {
      try {
        const result = await commands.getAudioFilePath(fileName);
        if (result.status === "ok") {
          if (osType === "linux") {
            const fileData = await readFile(result.data);
            const blob = new Blob([fileData], { type: "audio/wav" });

            return URL.createObjectURL(blob);
          }

          return convertFileSrc(result.data, "asset");
        }
        return null;
      } catch (error) {
        console.error("Failed to get audio file path:", error);
        return null;
      }
    },
    [osType],
  );

  const deleteAudioEntry = async (id: number) => {
    try {
      await commands.deleteHistoryEntry(id);
    } catch (error) {
      console.error("Failed to delete audio entry:", error);
      throw error;
    }
  };

  const openRecordingsFolder = async () => {
    try {
      await commands.openRecordingsFolder();
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  const recordingsEntries = historyEntries;
  const jotsEntries = historyEntries.filter((entry) =>
    Boolean(entry.post_processed_text?.trim()),
  );

  const renderEntries = (
    entries: HistoryEntry[],
    viewMode: HistoryTab,
    emptyMessage: string,
  ) => {
    if (entries.length === 0) {
      return (
        <div className="px-4 py-3 text-center text-text/60">{emptyMessage}</div>
      );
    }

    return (
      <div className="divide-y divide-mid-gray/20">
        {entries.map((entry) => {
          const fallbackText = entry.transcription_text;
          const jotText = entry.post_processed_text?.trim();
          const displayText =
            viewMode === "jots" && jotText ? jotText : fallbackText;

          return (
            <HistoryEntryComponent
              key={entry.id}
              entry={entry}
              displayMode={viewMode}
              displayText={displayText}
              onToggleSaved={() => toggleSaved(entry.id)}
              onCopyText={() => copyToClipboard(displayText)}
              getAudioUrl={getAudioUrl}
              deleteAudio={deleteAudioEntry}
            />
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="max-w-3xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <div className="px-4 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
                {t("settings.history.title")}
              </h2>
            </div>
            <OpenRecordingsButton
              onClick={openRecordingsFolder}
              label={t("settings.history.openFolder")}
            />
          </div>
          <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
            <div className="px-4 py-3 text-center text-text/60">
              {t("settings.history.loading")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="space-y-2">
        <div className="px-4 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
              {t("settings.history.title")}
            </h2>
          </div>
          <OpenRecordingsButton
            onClick={openRecordingsFolder}
            label={t("settings.history.openFolder")}
          />
        </div>
        <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
          <div className="border-b border-mid-gray/20 px-3 py-2 flex gap-4">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "recordings"}
              onClick={() => setActiveTab("recordings")}
              className={`pb-2 -mb-[9px] text-sm font-medium transition-colors border-b-2 cursor-pointer ${
                activeTab === "recordings"
                  ? "border-logo-primary text-logo-primary"
                  : "border-transparent text-text/70 hover:text-text hover:border-text/30"
              }`}
            >
              {t("settings.history.tabs.recordings", {
                defaultValue: "Recordings",
              })}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "jots"}
              onClick={() => setActiveTab("jots")}
              className={`pb-2 -mb-[9px] text-sm font-medium transition-colors border-b-2 cursor-pointer ${
                activeTab === "jots"
                  ? "border-logo-primary text-logo-primary"
                  : "border-transparent text-text/70 hover:text-text hover:border-text/30"
              }`}
            >
              {t("settings.history.tabs.jots", { defaultValue: "Jots" })}
            </button>
          </div>
          {activeTab === "recordings"
            ? renderEntries(
                recordingsEntries,
                "recordings",
                t("settings.history.empty"),
              )
            : renderEntries(
                jotsEntries,
                "jots",
                t("settings.history.emptyJots", {
                  defaultValue:
                    "No jots yet. Enable post-processing to see completed results.",
                }),
              )}
        </div>
      </div>
    </div>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  displayMode: HistoryTab;
  displayText: string;
  onToggleSaved: () => void;
  onCopyText: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
}

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  displayMode,
  displayText,
  onToggleSaved,
  onCopyText,
  getAudioUrl,
  deleteAudio,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);

  const handleLoadAudio = useCallback(
    () => getAudioUrl(entry.file_name),
    [getAudioUrl, entry.file_name],
  );

  const handleCopyText = () => {
    onCopyText();
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleDeleteEntry = async () => {
    try {
      await deleteAudio(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      alert("Failed to delete entry. Please try again.");
    }
  };

  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);

  return (
    <div className="px-4 py-2 pb-5 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <p className="text-sm font-medium">{formattedDate}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyText}
            className="text-text/50 hover:text-logo-primary  hover:border-logo-primary transition-colors cursor-pointer"
            title={t("settings.history.copyToClipboard")}
          >
            {showCopied ? (
              <Check width={16} height={16} />
            ) : (
              <Copy width={16} height={16} />
            )}
          </button>
          <button
            onClick={onToggleSaved}
            className={`p-2 rounded-md transition-colors cursor-pointer ${
              entry.saved
                ? "text-logo-primary hover:text-logo-primary/80"
                : "text-text/50 hover:text-logo-primary"
            }`}
            title={
              entry.saved
                ? t("settings.history.unsave")
                : t("settings.history.save")
            }
          >
            <Star
              width={16}
              height={16}
              fill={entry.saved ? "currentColor" : "none"}
            />
          </button>
          <button
            onClick={handleDeleteEntry}
            className="text-text/50 hover:text-logo-primary transition-colors cursor-pointer"
            title={t("settings.history.delete")}
          >
            <Trash2 width={16} height={16} />
          </button>
        </div>
      </div>
      <p
        className={`text-sm pb-2 select-text cursor-text ${
          displayMode === "jots"
            ? "text-text/95 rounded-md border border-logo-primary/20 bg-[color-mix(in_srgb,var(--color-logo-primary),transparent_95%)] px-3 py-2 not-italic"
            : "italic text-text/90"
        }`}
      >
        {displayText}
      </p>
      {displayMode === "jots" && entry.post_process_prompt && (
        <div className="rounded-md border border-logo-primary/25 bg-[color-mix(in_srgb,var(--color-logo-primary),transparent_95%)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-logo-primary/90 pb-1">
            {t("settings.history.promptUsed", { defaultValue: "Prompt used" })}
          </p>
          <p className="text-xs text-text/80 select-text cursor-text">
            {entry.post_process_prompt}
          </p>
        </div>
      )}
      <AudioPlayer onLoadRequest={handleLoadAudio} className="w-full" />
    </div>
  );
};
