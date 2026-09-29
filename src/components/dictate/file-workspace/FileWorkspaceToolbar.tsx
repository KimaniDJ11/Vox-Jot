import React, { useState, useMemo, useCallback } from "react";
import type {
  FileTranscriptionPanelKind,
  FileTranscriptionView,
  ReaderLibrarySort,
  ReaderSplitView,
} from "./types";
import { useTranslation } from "react-i18next";
import {
  type ModelListControlOption,
  SelectControl,
} from "@/components/model-hub/ModelListControls";
import { addWatchFolder } from "../watch-folders/watchFolderEvents";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui";
import { Wand2, List, SlidersHorizontal, Layers } from "lucide-react";
import { ReaderSearchControl } from "../reader/ReaderSearchControl";
import { openModelHub } from "@/components/model-hub/modelHubTabs";

export const FileWorkspaceToolbar: React.FC<{
  kind: FileTranscriptionPanelKind;
  view: FileTranscriptionView;
  onViewChange: (view: FileTranscriptionView) => void;
  availableViews: FileTranscriptionView[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  readerSort: ReaderLibrarySort;
  onReaderSortChange: (sort: ReaderLibrarySort) => void;
  readerSplitView: ReaderSplitView;
  onReaderSplitViewChange: (view: ReaderSplitView) => void;
  readerSectionsOpen: boolean;
  onReaderSectionsOpenChange: (open: boolean) => void;
  readerTransformOpen: boolean;
  onReaderTransformOpenChange: (open: boolean) => void;
  readerHasDocument: boolean;
  readerViewMode: "text" | "page";
  onReaderViewModeChange: (mode: "text" | "page") => void;
  canUseReaderPageView: boolean;
}> = ({
  kind,
  view,
  onViewChange,
  availableViews,
  searchQuery,
  onSearchQueryChange,
  readerSort,
  onReaderSortChange,
  readerSplitView,
  onReaderSplitViewChange,
  readerSectionsOpen,
  onReaderSectionsOpenChange,
  readerTransformOpen,
  onReaderTransformOpenChange,
  readerHasDocument,
  readerViewMode,
  onReaderViewModeChange,
  canUseReaderPageView,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const segmentedItems = useMemo(
    () =>
      [
        {
          value: "file" as const,
          label: t("dictate.fileTranscription.view.file", {
            defaultValue: "Transcribe",
          }),
        },
        {
          value: "documents" as const,
          label: t("dictate.fileTranscription.view.documents", {
            defaultValue: "Documents",
          }),
        },
        {
          value: "folders" as const,
          label: t("dictate.fileTranscription.view.folders", {
            defaultValue: "Folders",
          }),
        },
      ].filter((item) => availableViews.includes(item.value)),
    [availableViews, t],
  );

  const readerSortOptions = useMemo<ModelListControlOption[]>(
    () => [
      {
        value: "recent",
        label: t("dictate.reader.sort.recent", {
          defaultValue: "Recently added",
        }),
      },
      {
        value: "oldest",
        label: t("dictate.reader.sort.oldest", {
          defaultValue: "Oldest added",
        }),
      },
      {
        value: "name_asc",
        label: t("dictate.reader.sort.nameAsc", {
          defaultValue: "Name (A-Z)",
        }),
      },
      {
        value: "name_desc",
        label: t("dictate.reader.sort.nameDesc", {
          defaultValue: "Name (Z-A)",
        }),
      },
      {
        value: "largest",
        label: t("dictate.reader.sort.largest", { defaultValue: "Largest" }),
      },
      {
        value: "smallest",
        label: t("dictate.reader.sort.smallest", { defaultValue: "Smallest" }),
      },
    ],
    [t],
  );
  const selectedReaderSortLabel =
    readerSortOptions.find((option) => option.value === readerSort)?.label ??
    "";

  const handlePrimaryAction = useCallback(async () => {
    if (view === "documents") {
      window.dispatchEvent(new Event("reader-open-document-picker"));
      return;
    }

    setBusy(true);
    try {
      const folder = await addWatchFolder();
      if (folder) onViewChange("folders");
    } finally {
      setBusy(false);
    }
  }, [onViewChange, view]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handlePrimaryAction}
        disabled={busy}
      >
        <span
          className="inline-flex h-4 w-4 items-center justify-center text-[1.15em] font-bold leading-none text-[var(--accent-hover)]"
          aria-hidden
        >
          +
        </span>
        {view === "documents"
          ? t("dictate.reader.addDocument", { defaultValue: "Add document" })
          : t("dictate.watchFolders.add", { defaultValue: "Add folder" })}
      </Button>
      {kind === "reader" ? (
        <SegmentedControl<ReaderSplitView>
          value={readerSplitView}
          onChange={onReaderSplitViewChange}
          layoutId="reader-split-view-toggle"
          ariaLabel={t("dictate.reader.splitView.ariaLabel", {
            defaultValue: "Reader view",
          })}
          items={[
            {
              value: "library",
              label: t("dictate.reader.splitView.document", {
                defaultValue: "Document",
              }),
            },
            {
              value: "viewer",
              label: t("dictate.reader.splitView.viewer", {
                defaultValue: "Viewer",
              }),
            },
          ]}
        />
      ) : null}
      {segmentedItems.length > 1 ? (
        <SegmentedControl<FileTranscriptionView>
          value={view}
          onChange={onViewChange}
          layoutId={`file-transcription-view-toggle-${kind}`}
          ariaLabel={
            kind === "reader"
              ? t("dictate.reader.viewAriaLabel", {
                  defaultValue: "Reader view",
                })
              : t("dictate.fileTranscription.view.ariaLabel", {
                  defaultValue: "File transcription view",
                })
          }
          items={segmentedItems}
        />
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {kind === "reader" && readerSplitView === "viewer" ? (
          readerHasDocument ? (
            <>
              <Button
                type="button"
                variant="control"
                size="sm"
                aria-pressed={readerTransformOpen}
                onClick={() => {
                  onReaderSectionsOpenChange(false);
                  onReaderTransformOpenChange(!readerTransformOpen);
                }}
              >
                <Wand2 className="h-3.5 w-3.5" />
                {t("dictate.reader.transform.title", {
                  defaultValue: "Transform",
                })}
              </Button>
              <Button
                type="button"
                variant="control"
                size="sm"
                aria-pressed={readerSectionsOpen}
                onClick={() => {
                  onReaderTransformOpenChange(false);
                  onReaderSectionsOpenChange(!readerSectionsOpen);
                }}
              >
                <List className="h-3.5 w-3.5" />
                {t("dictate.reader.sections.title", {
                  defaultValue: "Sections",
                })}
              </Button>
              {canUseReaderPageView ? (
                <SegmentedControl<"text" | "page">
                  value={readerViewMode}
                  onChange={onReaderViewModeChange}
                  layoutId="reader-page-view-toggle"
                  ariaLabel={t("dictate.reader.pageView.ariaLabel", {
                    defaultValue: "Reader layout",
                  })}
                  items={[
                    {
                      value: "text",
                      label: t("dictate.reader.pageView.text", {
                        defaultValue: "Text",
                      }),
                    },
                    {
                      value: "page",
                      label: t("dictate.reader.pageView.page", {
                        defaultValue: "Page",
                      }),
                    },
                  ]}
                />
              ) : null}
            </>
          ) : null
        ) : (
          <>
            {view === "documents" ? (
              <ReaderSearchControl
                query={searchQuery}
                onQueryChange={onSearchQueryChange}
              />
            ) : null}
            {view === "documents" ? (
              <SelectControl
                value={readerSort}
                options={readerSortOptions}
                onChange={(value) =>
                  onReaderSortChange(value as ReaderLibrarySort)
                }
                ariaLabel={t("dictate.reader.sort.ariaLabel", {
                  defaultValue: "Filter documents",
                })}
                title={t("dictate.reader.sort.title", {
                  defaultValue: "Filter",
                })}
                selectedLabel={selectedReaderSortLabel}
                active={readerSort !== "recent"}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </SelectControl>
            ) : null}
            {kind !== "reader" ? (
              <Button
                type="button"
                variant="control"
                size="sm"
                onClick={() => {
                  if (view === "documents") {
                    void openModelHub("tts");
                    return;
                  }
                  void openModelHub("analysis", { scope: "analysis" });
                }}
              >
                <Layers className="h-3.5 w-3.5" />
                {t("listen.createVoices.models", { defaultValue: "Models" })}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};
