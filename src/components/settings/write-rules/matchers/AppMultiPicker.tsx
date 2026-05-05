// Multi-app picker for the "Match" card.
//
// Old version: a Dropdown + "Add app" button. Picking one app meant
// two clicks AND lost the search affordance because react-select inside
// a popover hides keyboard input until you click. New version: an
// inline input with type-ahead suggestions; pick one to add it as a
// chip. Pressing Enter or clicking a suggestion adds — no "+ Add"
// button needed (Nielsen #7, flexibility & efficiency).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { commands, type InstalledApp } from "@/bindings";
import { Input } from "@/components/ui/Input";
import { AppMonogram } from "../AppMonogram";

const matchAnyChip = "Any app";
const fieldLabel = "Apps";
const helpHint =
  "Leave empty to match any app. Typing a name shows suggestions.";
const removeAppLabel = "Remove app";

interface AppMultiPickerProps {
  bundleIds: string[];
  onChange: (bundleIds: string[]) => void;
  compact?: boolean;
}

export const AppMultiPicker: React.FC<AppMultiPickerProps> = ({
  bundleIds,
  onChange,
  compact = false,
}) => {
  const { t } = useTranslation();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void commands.listInstalledApps().then((result) => {
      if (result.status === "ok") setApps(result.data);
    });
  }, []);

  const appsByBundleId = useMemo(
    () => new Map(apps.map((app) => [app.bundle_id, app])),
    [apps],
  );

  // Type-ahead match. Hide already-added apps so the user can't
  // accidentally add one twice.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return apps
      .filter(
        (app) =>
          !bundleIds.includes(app.bundle_id) &&
          (app.name.toLowerCase().includes(q) ||
            app.bundle_id.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [apps, bundleIds, query]);

  // Click-outside dismiss for the suggestion popover.
  useEffect(() => {
    if (!showSuggestions) return;
    const onDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSuggestions]);

  const addApp = (bundleId: string) => {
    if (bundleIds.includes(bundleId)) return;
    onChange([...bundleIds, bundleId]);
    setQuery("");
    setShowSuggestions(false);
  };

  const shouldShowChips = !compact || bundleIds.length > 0;

  return (
    <div ref={containerRef} className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-[var(--muted)]">
          {fieldLabel}
        </label>
        {compact && bundleIds.length === 0 ? (
          <span className="text-xs italic text-[var(--muted)]">
            {matchAnyChip}
          </span>
        ) : null}
        {!compact ? (
          <span className="text-[11px] text-[var(--muted)]">{helpHint}</span>
        ) : null}
      </div>

      {shouldShowChips ? (
        <div className="flex min-h-[26px] flex-wrap items-center gap-2">
          {bundleIds.length === 0 ? (
            <span className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
              {matchAnyChip}
            </span>
          ) : (
            bundleIds.map((bundleId) => {
              const app = appsByBundleId.get(bundleId);
              return (
                <span
                  key={bundleId}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] py-0.5 pl-1 pr-2 text-xs font-medium text-[var(--text)]"
                  title={bundleId}
                >
                  <AppMonogram bundleId={bundleId} name={app?.name} size="xs" />
                  {app?.name ?? bundleId}
                  <button
                    type="button"
                    className="ml-0.5 text-[var(--muted)] hover:text-[var(--danger)]"
                    onClick={() =>
                      onChange(bundleIds.filter((id) => id !== bundleId))
                    }
                    aria-label={removeAppLabel}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })
          )}
        </div>
      ) : null}

      <div className="relative">
        <Input
          value={query}
          onFocus={() => setShowSuggestions(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && suggestions[0]) {
              event.preventDefault();
              addApp(suggestions[0].bundle_id);
            } else if (event.key === "Escape") {
              setShowSuggestions(false);
            }
          }}
          placeholder={t("refine.writeRules.matchers.searchAppsPlaceholder")}
          className="w-full"
        />
        {showSuggestions && suggestions.length > 0 ? (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--shadow-md)]"
          >
            {suggestions.map((app) => (
              <li key={app.bundle_id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--input)]"
                  onClick={() => addApp(app.bundle_id)}
                >
                  <AppMonogram
                    bundleId={app.bundle_id}
                    name={app.name}
                    size="sm"
                  />
                  <span className="truncate text-[var(--text)]">
                    {app.name}
                  </span>
                  <span className="ml-auto truncate text-[10px] text-[var(--muted)]">
                    {app.bundle_id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};
