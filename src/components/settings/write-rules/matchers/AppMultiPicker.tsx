import React, { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { commands, type InstalledApp } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";

const anyAppLabel = "Any app";
const chooseAppLabel = "Choose an app";
const addAppLabel = "Add app";
const removeAppLabel = "Remove app";

interface AppMultiPickerProps {
  bundleIds: string[];
  onChange: (bundleIds: string[]) => void;
}

export const AppMultiPicker: React.FC<AppMultiPickerProps> = ({
  bundleIds,
  onChange,
}) => {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void commands.listInstalledApps().then((result) => {
      if (result.status === "ok") {
        setApps(result.data);
      }
    });
  }, []);

  const appsByBundleId = useMemo(
    () => new Map(apps.map((app) => [app.bundle_id, app])),
    [apps],
  );
  const options = apps
    .filter((app) => !bundleIds.includes(app.bundle_id))
    .map((app) => ({ value: app.bundle_id, label: app.name }));

  const addSelected = () => {
    if (!selected || bundleIds.includes(selected)) return;
    onChange([...bundleIds, selected]);
    setSelected(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {bundleIds.length === 0 ? (
          <span className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
            {anyAppLabel}
          </span>
        ) : (
          bundleIds.map((bundleId) => (
            <span
              key={bundleId}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-medium text-[var(--text)]"
            >
              {appsByBundleId.get(bundleId)?.name ?? bundleId}
              <button
                type="button"
                className="text-[var(--muted)] hover:text-[var(--danger)]"
                onClick={() =>
                  onChange(bundleIds.filter((id) => id !== bundleId))
                }
                aria-label={removeAppLabel}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          options={options}
          selectedValue={selected}
          onSelect={setSelected}
          placeholder={chooseAppLabel}
          className="min-w-[240px]"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addSelected}
        >
          <Plus className="h-3.5 w-3.5" />
          {addAppLabel}
        </Button>
      </div>
    </div>
  );
};
