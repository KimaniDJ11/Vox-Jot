import React from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "./Button";

export interface ListActionLabels {
  add?: string;
  import: string;
  export: string;
  clearAll: string;
}

interface ListActionButtonsProps {
  labels: ListActionLabels;
  onAdd?: () => void;
  onImport: () => void;
  onExport: () => void;
  onClear: () => void;
  /** Disables Export and Clear (no items to act on). */
  bulkDisabled?: boolean;
  /** Disables Import, e.g. while a write is in flight. */
  importDisabled?: boolean;
  addDisabled?: boolean;
}

/**
 * Shared icon-button toolbar for dictionary-style list panels:
 * [Add?] [Import] [Export] [Clear All]
 * Matches the UX used by Corrections and Snippets.
 */
export const ListActionButtons: React.FC<ListActionButtonsProps> = ({
  labels,
  onAdd,
  onImport,
  onExport,
  onClear,
  bulkDisabled = false,
  importDisabled = false,
  addDisabled = false,
}) => {
  return (
    <>
      {onAdd && labels.add ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onAdd}
          disabled={addDisabled}
          title={labels.add}
          aria-label={labels.add}
        >
          <Plus aria-hidden />
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onImport}
        disabled={importDisabled}
        title={labels.import}
        aria-label={labels.import}
      >
        <Upload aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onExport}
        disabled={bulkDisabled}
        title={labels.export}
        aria-label={labels.export}
      >
        <Download aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="danger-ghost"
        onClick={onClear}
        disabled={bulkDisabled}
        title={labels.clearAll}
        aria-label={labels.clearAll}
      >
        <Trash2 aria-hidden />
      </Button>
    </>
  );
};
