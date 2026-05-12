import React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { HuggingFaceTokenStatus } from "@/bindings";

interface GatedHuggingFaceAccessDialogProps {
  open: boolean;
  modelName: string;
  tokenStatus: HuggingFaceTokenStatus | null;
  tokenDraft: string;
  error: string | null;
  busy: boolean;
  titleId: string;
  onTokenDraftChange: (value: string) => void;
  onOpenAccessPage: () => void | Promise<void>;
  onClearToken: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const GatedHuggingFaceAccessDialog: React.FC<
  GatedHuggingFaceAccessDialogProps
> = ({
  open,
  modelName,
  tokenStatus,
  tokenDraft,
  error,
  busy,
  titleId,
  onTokenDraftChange,
  onOpenAccessPage,
  onClearToken,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  if (!open) return null;

  const canConfirm =
    Boolean(tokenDraft.trim()) || Boolean(tokenStatus?.configured);
  const tokenSource = tokenStatus?.source?.replace(/_/g, " ");

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[680px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold text-[var(--text)]"
            >
              {t("modelHub.analysis.hfAccess.title", {
                defaultValue: "Hugging Face access required",
              })}
            </h2>
            <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
              {t("modelHub.analysis.hfAccess.description", {
                defaultValue:
                  "{{modelName}} is gated by its publisher. Accept the model terms with your Hugging Face account, then save your own read token so Vox Jot can download the weights into its local model store.",
                modelName,
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            disabled={busy}
            aria-label={t("common.close", { defaultValue: "Close" })}
            title={t("common.close", { defaultValue: "Close" })}
          >
            <X />
          </Button>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              <div className="min-w-0 text-sm leading-5">
                <p className="font-medium text-[var(--text)]">
                  {t("modelHub.analysis.hfAccess.termsStep", {
                    defaultValue: "1. Accept the publisher terms",
                  })}
                </p>
                <p className="text-[var(--muted)]">
                  {t("modelHub.analysis.hfAccess.termsDetail", {
                    defaultValue:
                      "Hugging Face only grants gated-model access to the account that accepts the terms.",
                  })}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenAccessPage}
              className="mt-3"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t("modelHub.analysis.hfAccess.openAccessPage", {
                defaultValue: "Open access page",
              })}
            </Button>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex items-start gap-2">
              <KeyRound
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              <div className="min-w-0 text-sm leading-5">
                <p className="font-medium text-[var(--text)]">
                  {t("modelHub.analysis.hfAccess.tokenStep", {
                    defaultValue: "2. Create a token once",
                  })}
                </p>
                <p className="text-[var(--muted)]">
                  {t("modelHub.analysis.hfAccess.tokenSetupDetail", {
                    defaultValue:
                      "On Hugging Face, choose Fine-grained, name it Vox Jot Model Downloads, then check only Read access to contents of all public gated repos you can access. Leave Write, Inference, Billing, Jobs, and Webhooks off.",
                  })}
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  {t("modelHub.analysis.hfAccess.savedReuseDetail", {
                    defaultValue:
                      "After the token is saved here, the next gated model only needs its terms accepted; then return to Vox Jot and click Download with saved token.",
                  })}
                </p>
              </div>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {t("modelHub.analysis.hfAccess.tokenLabel", {
                defaultValue: "3. Paste token in Vox Jot",
              })}
            </span>
            <input
              type="password"
              value={tokenDraft}
              onChange={(event) => onTokenDraftChange(event.target.value)}
              placeholder={t("modelHub.analysis.hfAccess.tokenPlaceholder", {
                defaultValue: tokenStatus?.configured
                  ? "Leave blank to use the saved token"
                  : "Paste hf_... token",
              })}
              disabled={busy}
              className="min-h-11 w-full rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm font-medium text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">
              {tokenStatus?.configured
                ? t("modelHub.analysis.hfAccess.savedToken", {
                    defaultValue: "Saved token: {{source}}",
                    source: tokenSource ?? "configured",
                  })
                : t("modelHub.analysis.hfAccess.noSavedToken", {
                    defaultValue: "No Hugging Face token is saved in Vox Jot.",
                  })}
            </span>
            {tokenStatus?.configured ? (
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                disabled={busy}
                onClick={onClearToken}
              >
                {t("modelHub.analysis.hfAccess.clearToken", {
                  defaultValue: "Clear token",
                })}
              </Button>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_65%)] bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger)]">
              {error}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy || !canConfirm}
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("modelHub.analysis.hfAccess.download", {
              defaultValue: tokenDraft.trim()
                ? "Save token and download"
                : "Download with saved token",
            })}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default GatedHuggingFaceAccessDialog;
