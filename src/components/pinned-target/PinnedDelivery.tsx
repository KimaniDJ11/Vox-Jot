import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands, type DeliveryRecord } from "@/bindings";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { usePinState } from "@/hooks/usePinState";
import { Button } from "@/components/ui/Button";

export function canRetryDelivery(record: DeliveryRecord) {
  return (
    (record.state === "pending" || record.state === "deferred") &&
    !record.may_have_written &&
    record.confirmed_utf16 === 0
  );
}

export const PinnedDeliveryCard: React.FC<{
  record: DeliveryRecord;
  persisted?: boolean;
}> = ({ record: initial, persisted = true }) => {
  const { t } = useTranslation();
  const [record, setRecord] = useState(initial);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pin = usePinState();
  useEffect(() => setRecord(initial), [initial]);
  useTauriEvent<DeliveryRecord>("pin-delivery-updated", ({ payload }) => {
    if (payload.id === initial.id) {
      setRecord(payload);
      setBusy(false);
    }
  });
  const run = async (paste: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await (paste
        ? commands.deliverViaPaste(record.id)
        : commands.retryDelivery(record.id));
      if (result.status === "ok") setRecord(result.data);
      else toast.error(result.error);
    } catch (error) {
      toast.error(String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const retry = persisted && pin?.available && canRetryDelivery(record);
  return (
    <div className="space-y-2 text-sm text-[var(--text)]" aria-live="polite">
      <p className="font-semibold">
        {t(`pinnedTarget.delivery.${record.state}`)}
      </p>
      <p className="text-[var(--muted)] break-words">
        {record.target.app_name} · {record.target.locator.label}
      </p>
      {record.message && (
        <p className="text-[var(--muted)]">{record.message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void commands
              .copyPinnedDelivery(record.id)
              .then((result) =>
                result.status === "ok"
                  ? toast.success(
                      t("pinnedTarget.copied", {
                        defaultValue: "Copied saved text",
                      }),
                    )
                  : toast.error(result.error),
              )
              .catch((e) => toast.error(String(e)))
          }
        >
          {t("pinnedTarget.copy", { defaultValue: "Copy saved text" })}
        </Button>
        {retry && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void run(false)}
            >
              {busy
                ? t("pinnedTarget.working", { defaultValue: "Working…" })
                : t("pinnedTarget.retry", {
                    defaultValue: "Retry background insertion",
                  })}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void run(true)}
            >
              {t("pinnedTarget.paste", {
                defaultValue: "Bring app forward and paste",
              })}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export const MeetingPinnedDelivery: React.FC<{ id?: string | null }> = ({
  id,
}) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<DeliveryRecord | null>(null);
  useEffect(() => {
    let disposed = false;
    setRecord(null);
    setError(null);
    if (id)
      void commands
        .getPinnedDelivery(id)
        .then((result) => {
          if (disposed) return;
          if (result.status === "ok") setRecord(result.data);
          else setError(result.error);
        })
        .catch((error) => {
          if (!disposed) setError(String(error));
        });
    return () => {
      disposed = true;
    };
  }, [id]);
  return error ? (
    <p role="alert" className="text-sm text-[var(--danger)]">
      {t("pinnedTarget.loadError")} {error}
    </p>
  ) : record ? (
    <PinnedDeliveryCard record={record} />
  ) : null;
};

export const PinnedTargetStatus: React.FC = () => {
  const { t } = useTranslation();
  const pin = usePinState();
  useTauriEvent<string>("pin-error", ({ payload }) => toast.error(payload));
  const showResult = (record: DeliveryRecord, persisted = true) => {
    if (record.state === "delivered") {
      toast.success(
        t("pinnedTarget.inserted", { app: record.target.app_name }),
        {
          id: record.id,
        },
      );
      return;
    }
    if (record.state === "pending" || record.state === "delivering") return;
    toast.custom(
      (id) => (
        <div className="flat-card max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-lg">
          <PinnedDeliveryCard record={record} persisted={persisted} />
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onClick={() => toast.dismiss(id)}
          >
            {t("pinnedTarget.dismiss", { defaultValue: "Dismiss" })}
          </Button>
        </div>
      ),
      { id: record.id, duration: Infinity },
    );
  };
  useTauriEvent<DeliveryRecord>("pin-delivery-updated", ({ payload }) =>
    showResult(
      payload,
      payload.reason !== "history_save_failed" &&
        payload.reason !== "status_save_failed",
    ),
  );
  useEffect(() => {
    if (!pin?.available) return;
    void commands
      .getUnsavedPinnedDeliveries()
      .then((records) => records.forEach((record) => showResult(record, false)))
      .catch((error) =>
        toast.error(`${t("pinnedTarget.loadError")} ${String(error)}`),
      );
    void commands
      .getUnresolvedPinnedDeliveries()
      .then((result) => {
        if (result.status === "ok")
          result.data.slice(0, 3).forEach((record) => showResult(record));
        else toast.error(result.error);
      })
      .catch((error) =>
        toast.error(`${t("pinnedTarget.loadError")} ${String(error)}`),
      );
  }, [pin?.available]);
  if (!pin?.available || !pin.target) return null;
  return (
    <aside
      className="fixed bottom-4 right-4 z-40 flex max-w-sm items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text)] shadow-lg"
      aria-label={t("pinnedTarget.settingsTitle")}
    >
      <div role="status" className="min-w-0">
        <p className="font-semibold">
          {t("pinnedTarget.status", {
            defaultValue: "Pinned: {{app}}",
            app: pin.target.app_name,
          })}
        </p>
        <p className="truncate text-[var(--muted)]">
          {pin.target.locator.label}
          {` · ${t(pin.bound ? "pinnedTarget.bound" : "pinnedTarget.next")}`}
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          void commands.clearPin().catch((error) => toast.error(String(error)))
        }
      >
        {t("pinnedTarget.clear", { defaultValue: "Clear" })}
      </Button>
    </aside>
  );
};
