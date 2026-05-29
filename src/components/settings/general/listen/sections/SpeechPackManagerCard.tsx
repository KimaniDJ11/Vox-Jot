import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/Button";
import type { ListenSpeechState } from "../useListenSpeechState";

export const SpeechPackManagerCard: React.FC<{
  speech: ListenSpeechState;
}> = ({ speech }) => {
  const { t } = useTranslation();
  const [confirmingRemovePackId, setConfirmingRemovePackId] = useState<
    string | null
  >(null);

  const removePack = async (packId: string) => {
    speech.setBusyPackId(packId);
    try {
      const result = await commands.removeTtsPack(packId);
      if (result.status !== "ok") {
        speech.setStatusMessage(result.error);
        toast.error(result.error);
      } else {
        setConfirmingRemovePackId(null);
        await speech.refreshAll();
      }
    } catch (error) {
      console.error("Failed to remove speech pack:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("listen.packManager.removeFailed", {
              defaultValue: "Could not remove speech pack.",
            }),
      );
    } finally {
      speech.setBusyPackId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t("listen.packManager.title")}
          </h3>
          <p className="text-sm text-[var(--muted)]">
            {t("listen.packManager.description")}
          </p>
        </div>
        <div className="space-y-2">
          {speech.packs.map((pack) => (
            <div
              key={pack.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)]">
                  {pack.label}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {pack.archive_name}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {pack.installed ? "Installed" : "Not installed"}
                </span>
                {pack.installed ? (
                  confirmingRemovePackId === pack.id ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-xs font-medium text-[var(--text)]">
                        {t("listen.packManager.removeConfirm", {
                          packLabel: pack.label,
                          defaultValue: 'Remove speech pack "{{packLabel}}"?',
                        })}
                      </span>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={speech.busyPackId === pack.id}
                        onClick={() => void removePack(pack.id)}
                      >
                        {t("common.remove", { defaultValue: "Remove" })}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={speech.busyPackId === pack.id}
                        onClick={() => setConfirmingRemovePackId(null)}
                      >
                        {t("common.cancel", { defaultValue: "Cancel" })}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={speech.busyPackId === pack.id}
                      onClick={() => setConfirmingRemovePackId(pack.id)}
                    >
                      {t("listen.packManager.remove")}
                    </Button>
                  )
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={speech.busyPackId === pack.id}
                    onClick={async () => {
                      speech.setBusyPackId(pack.id);
                      const result = await commands.downloadTtsPack(pack.id);
                      if (result.status !== "ok") {
                        speech.setStatusMessage(result.error);
                      } else {
                        speech.setStatusMessage(
                          t("listen.packManager.downloadStarted", {
                            packName: pack.label,
                            defaultValue:
                              "{{packName}} download started. The pack will appear after it finishes.",
                          }),
                        );
                        void speech.refreshAll();
                      }
                      speech.setBusyPackId(null);
                    }}
                  >
                    {t("listen.packManager.download")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
