import React from "react";
import { useTranslation } from "react-i18next";
import { Clipboard, Keyboard, Zap } from "lucide-react";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { Input } from "../ui/Input";
import { useSettings } from "../../hooks/useSettings";
import { useOsType } from "../../hooks/useOsType";
import type { ClipboardHandling, PasteMethod } from "@/bindings";
import { isMacAppStoreBuild } from "@/lib/distribution";
import {
  SelectionDot,
  visualizationStateClass,
} from "@/components/settings/VisualizationCard";

interface PasteMethodProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const PasteMethodSetting: React.FC<PasteMethodProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const osType = useOsType();

    const getPasteMethodOptions = (osType: string) => {
      const mod = osType === "macos" ? "Cmd" : "Ctrl";

      if (isMacAppStoreBuild) {
        return [
          {
            value: "none",
            label: t("settings.advanced.pasteMethod.clipboardOnly"),
          },
        ];
      }

      const options = [
        {
          value: "ctrl_v",
          label: t("settings.advanced.pasteMethod.options.clipboard", {
            modifier: mod,
          }),
        },
        {
          value: "direct",
          label: t("settings.advanced.pasteMethod.options.direct"),
        },
        {
          value: "none",
          label: t("settings.advanced.pasteMethod.options.none"),
        },
      ];

      // Add Shift+Insert and Ctrl+Shift+V options for Windows and Linux only
      if (osType === "windows" || osType === "linux") {
        options.push(
          {
            value: "ctrl_shift_v",
            label: t(
              "settings.advanced.pasteMethod.options.clipboardCtrlShiftV",
            ),
          },
          {
            value: "shift_insert",
            label: t(
              "settings.advanced.pasteMethod.options.clipboardShiftInsert",
            ),
          },
        );
      }

      // External script is only available on Linux
      if (osType === "linux") {
        options.push({
          value: "external_script",
          label: t("settings.advanced.pasteMethod.options.externalScript"),
        });
      }

      return options;
    };

    const selectedMethod = (getSetting("paste_method") ||
      "ctrl_v") as PasteMethod;
    const selectedHandling = (getSetting("clipboard_handling") ||
      "dont_modify") as ClipboardHandling;
    const effectiveSelectedMethod = isMacAppStoreBuild
      ? "none"
      : selectedMethod;
    const effectiveSelectedHandling = isMacAppStoreBuild
      ? "copy_to_clipboard"
      : selectedHandling;
    const externalScriptPath = getSetting("external_script_path") || "";

    const pasteMethodOptions = getPasteMethodOptions(osType);
    const advancedMethodSelected = !["direct", "ctrl_v", "none"].includes(
      selectedMethod,
    );

    const selectPasteMethod = async (
      method: PasteMethod,
      clipboardHandling?: ClipboardHandling,
    ) => {
      await updateSetting("paste_method", method);
      if (clipboardHandling) {
        await updateSetting("clipboard_handling", clipboardHandling);
      }
    };

    return (
      <SettingContainer
        title={t("settings.advanced.pasteMethod.title")}
        description={t(
          isMacAppStoreBuild
            ? "settings.advanced.pasteMethod.appStoreDescription"
            : "settings.advanced.pasteMethod.description",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="stacked"
        tooltipPosition="bottom"
      >
        <div className="space-y-3">
          <div
            className={
              isMacAppStoreBuild ? "grid gap-2" : "grid gap-2 lg:grid-cols-3"
            }
          >
            {!isMacAppStoreBuild ? (
              <>
                <PasteMethodCard
                  icon={<Zap className="h-4 w-4" aria-hidden />}
                  title={t("settings.advanced.pasteMethod.options.direct")}
                  description={t(
                    "settings.advanced.pasteMethod.directDescription",
                  )}
                  sample="Hello world"
                  selected={effectiveSelectedMethod === "direct"}
                  disabled={isUpdating("paste_method")}
                  onSelect={() => void selectPasteMethod("direct")}
                />
                <PasteMethodCard
                  icon={<Keyboard className="h-4 w-4" aria-hidden />}
                  title={t("settings.advanced.pasteMethod.options.clipboard", {
                    modifier: osType === "macos" ? "Cmd" : "Ctrl",
                  })}
                  description={t(
                    "settings.advanced.pasteMethod.clipboardDescription",
                  )}
                  sample="Cmd/Ctrl + V"
                  selected={effectiveSelectedMethod === "ctrl_v"}
                  disabled={isUpdating("paste_method")}
                  onSelect={() => void selectPasteMethod("ctrl_v")}
                />
              </>
            ) : null}
            <PasteMethodCard
              icon={<Clipboard className="h-4 w-4" aria-hidden />}
              title={t("settings.advanced.pasteMethod.clipboardOnly")}
              description={t(
                isMacAppStoreBuild
                  ? "settings.advanced.pasteMethod.appStoreClipboardOnlyDescription"
                  : "settings.advanced.pasteMethod.clipboardOnlyDescription",
              )}
              sample="Text -> Clipboard"
              selected={
                effectiveSelectedMethod === "none" &&
                effectiveSelectedHandling === "copy_to_clipboard"
              }
              disabled={
                isUpdating("paste_method") || isUpdating("clipboard_handling")
              }
              onSelect={() =>
                void selectPasteMethod("none", "copy_to_clipboard")
              }
            />
          </div>
          {pasteMethodOptions.length > 3 || advancedMethodSelected ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle,var(--muted))]">
                  {t("settings.advanced.pasteMethod.platformMethods")}
                </p>
                {advancedMethodSelected ? (
                  <span className="text-xs font-medium text-[var(--accent)]">
                    {t("common.active")}
                  </span>
                ) : null}
              </div>
              <Dropdown
                options={pasteMethodOptions}
                selectedValue={selectedMethod}
                onSelect={(value) =>
                  void updateSetting("paste_method", value as PasteMethod)
                }
                disabled={isUpdating("paste_method")}
              />
            </div>
          ) : null}
          {selectedMethod === "external_script" && (
            <Input
              type="text"
              value={externalScriptPath}
              onChange={(e) =>
                updateSetting("external_script_path", e.target.value)
              }
              placeholder={t(
                "settings.advanced.pasteMethod.externalScriptPlaceholder",
              )}
              disabled={isUpdating("external_script_path")}
            />
          )}
        </div>
      </SettingContainer>
    );
  },
);

const PasteMethodCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  sample: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}> = ({ icon, title, description, sample, selected, disabled, onSelect }) => (
  <button
    type="button"
    className={visualizationStateClass(selected, disabled)}
    disabled={disabled}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="mb-3 flex items-center gap-2 text-[var(--accent)]">
        {icon}
        <span className="text-xs font-semibold text-[var(--text)]">
          {sample}
        </span>
      </div>
      <div className="flex gap-1">
        {sample.split(" ").map((word, index) => (
          <span
            key={`${word}-${index}`}
            className="h-1.5 flex-1 rounded-full bg-[var(--accent-soft)]"
            aria-hidden
          />
        ))}
      </div>
    </div>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
        <p className="mt-0.5 text-xs leading-4 text-[var(--muted)]">
          {description}
        </p>
      </div>
      <SelectionDot selected={selected} />
    </div>
  </button>
);
