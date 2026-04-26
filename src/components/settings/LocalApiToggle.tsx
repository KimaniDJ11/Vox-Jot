// Settings UI for the loopback HTTP API.
//
// What the user sees:
//   - A toggle "Enable local API". Off by default.
//   - When on, an inline pill shows the URL (`http://127.0.0.1:8978`)
//     plus a Copy button and a small "running" dot.
//   - A port input that triggers a server restart when the user blurs
//     the field.
//   - A short explainer about what this unlocks (CLI, scripts).
//
// Behind the scenes: each control calls a Tauri command that writes the
// preference and asks `HttpApiManager` to start/stop the server. We
// also subscribe to the `http-api-status` event so the indicator
// reflects the real bind state, not just the persisted toggle.

import React, { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

type StatusEvent = {
  running: boolean;
  port: number | null;
  error: string | null;
};

export const LocalApiToggle: React.FC<{ grouped?: boolean }> = ({
  grouped = true,
}) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState(8978);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Initial state from disk so refreshing the page shows the saved
  // toggle position immediately.
  useEffect(() => {
    void (async () => {
      const r = await commands.getHttpApiStatus();
      if (r.status === "ok") {
        setEnabled(r.data.enabled);
        setPort(r.data.port);
        setRunning(r.data.enabled); // optimistic; live event will correct
      }
    })();
  }, []);

  // Live status: backend emits this on bind success/failure and on stop.
  useEffect(() => {
    const promise = listen<StatusEvent>("http-api-status", (event) => {
      setRunning(event.payload.running);
      setError(event.payload.error);
    });
    return () => {
      void promise.then((fn) => fn());
    };
  }, []);

  const onToggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      setEnabled(next);
      try {
        const r = await commands.setHttpApiEnabled(next);
        if (r.status === "error") {
          setError(r.error);
          setEnabled(!next);
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onPortBlur = useCallback(async () => {
    if (port < 1024 || port > 65535) {
      setError("Port must be between 1024 and 65535.");
      return;
    }
    const r = await commands.setHttpApiPort(port);
    if (r.status === "error") setError(r.error);
  }, [port]);

  const url = `http://127.0.0.1:${port}`;
  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard may be unavailable in some contexts; non-fatal */
    }
  }, [url]);

  return (
    <div className="space-y-2">
      <ToggleSwitch
        checked={enabled}
        onChange={(v) => void onToggle(v)}
        isUpdating={busy}
        label={t("settings.diagnostics.localApi.label", {
          defaultValue: "Enable local API",
        })}
        description={t("settings.diagnostics.localApi.description", {
          defaultValue:
            "Lets the vox-jot CLI and other local tools drive Vox Jot over HTTP. Loopback only — never reachable from the network.",
        })}
        descriptionMode="inline"
        grouped={grouped}
      />

      {enabled && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--input)] p-3 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={
                "inline-block size-2 rounded-full " +
                (running
                  ? "bg-[var(--accent)]"
                  : error
                    ? "bg-[var(--danger)]"
                    : "bg-[var(--muted)]")
              }
              aria-hidden="true"
            />
            <span className="font-mono text-[var(--text)]">{url}</span>
            <Button
              variant="secondary"
              onClick={() => void copyUrl()}
              className="ml-auto"
            >
              <Copy size={12} className="mr-1" />
              {t("settings.diagnostics.localApi.copyUrl", {
                defaultValue: "Copy URL",
              })}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <label
              className="text-[var(--muted)]"
              htmlFor="local-api-port-input"
            >
              {t("settings.diagnostics.localApi.port", {
                defaultValue: "Port",
              })}
            </label>
            <Input
              id="local-api-port-input"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 0)}
              onBlur={onPortBlur}
              className="w-24"
              min={1024}
              max={65535}
            />
            <span className="text-[var(--muted)]">
              {t("settings.diagnostics.localApi.portHint", {
                defaultValue: "Restart applies on blur.",
              })}
            </span>
          </div>

          {error && (
            <div className="text-[var(--danger)]">
              {t("settings.diagnostics.localApi.errorPrefix", {
                defaultValue: "API error:",
              })}{" "}
              {error}
            </div>
          )}

          <div className="text-[var(--muted)]">
            {t("settings.diagnostics.localApi.cliHint", {
              defaultValue:
                "Try it: vox-jot transcribe path/to/file.wav --format srt",
            })}
          </div>
        </div>
      )}
    </div>
  );
};
