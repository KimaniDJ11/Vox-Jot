import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";

export type LicenseGateKind =
  | "non_commercial"
  | "custom_review"
  | "commercial_license_required";

export interface LicenseAcknowledgementGate {
  kind: LicenseGateKind;
  licenseLabel: string;
  termsUrl: string;
  publisherName?: string;
  requiresVoiceConsent?: boolean;
  note?: string;
}

interface LicenseAcknowledgementDialogProps {
  open: boolean;
  modelName: string;
  acknowledgementId: string;
  gate: LicenseAcknowledgementGate | null;
  busy?: boolean;
  onOpenTerms: () => void | Promise<void>;
  onCancel: () => void;
  onConfirm: () => void;
}

const LicenseAcknowledgementDialog: React.FC<
  LicenseAcknowledgementDialogProps
> = ({
  open,
  modelName,
  acknowledgementId,
  gate,
  busy = false,
  onOpenTerms,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [usageAck, setUsageAck] = useState(false);
  const [voiceAck, setVoiceAck] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsageAck(false);
    setVoiceAck(false);
  }, [modelName, open]);

  useDialogFocusTrap({
    enabled: open && Boolean(gate),
    containerRef: dialogRef,
    initialFocusSelector: "button, input",
  });

  if (!open || !gate) return null;

  const requiresVoiceConsent = Boolean(gate.requiresVoiceConsent);
  const canConfirm = usageAck && (!requiresVoiceConsent || voiceAck);
  const isCustomReview = gate.kind === "custom_review";
  const isCommercialLicenseRequired =
    gate.kind === "commercial_license_required";
  const publisherName =
    gate.publisherName ??
    t("modelHub.licenseGate.publisherFallback", {
      defaultValue: "the model publisher",
    });
  const handleBackdropCancel = () => {
    if (!busy) onCancel();
  };
  const confirmAndRecord = () => {
    try {
      window.localStorage.setItem(
        `voxjot.modelLicenseAcknowledgement.${acknowledgementId}`,
        JSON.stringify({
          schemaVersion: 2,
          acknowledgementId,
          gateKind: gate.kind,
          modelName,
          licenseLabel: gate.licenseLabel,
          termsUrl: gate.termsUrl,
          publisherName: gate.publisherName ?? null,
          requiresVoiceConsent,
          usageAcknowledged: true,
          voiceConsentAcknowledged: requiresVoiceConsent ? voiceAck : null,
          acknowledgedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // Local acknowledgement persistence is best-effort; download gating still
      // depends on the explicit in-session confirmation above.
    }
    onConfirm();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
      role="presentation"
      onClick={handleBackdropCancel}
    >
      <div
        className="absolute inset-0 bg-[var(--scrim-bg)] backdrop-blur-[2px]"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 shadow-[var(--modal-shadow)]"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) =>
          handleDialogKeyDown(event, dialogRef.current, onCancel, {
            escapeDisabled: busy,
          })
        }
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold text-[var(--text)]"
            >
              {isCommercialLicenseRequired
                ? t("modelHub.licenseGate.commercialTitle", {
                    defaultValue: "Commercial license required",
                  })
                : t("modelHub.licenseGate.title", {
                    defaultValue: "License acknowledgement required",
                  })}
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-sm leading-5 text-[var(--muted)]"
            >
              {isCommercialLicenseRequired
                ? t("modelHub.licenseGate.commercialDescription", {
                    defaultValue:
                      "{{modelName}} requires a separate commercial license or written agreement from {{publisherName}} before download or use in Vox Jot.",
                    modelName,
                    publisherName,
                  })
                : t("modelHub.licenseGate.description", {
                    defaultValue:
                      "{{modelName}} is distributed under {{licenseLabel}}. Review the publisher terms before downloading.",
                    modelName,
                    licenseLabel: gate.licenseLabel,
                  })}
            </p>
          </div>
          <ActionIconButton
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label={t("common.close", { defaultValue: "Close" })}
            title={t("common.close", { defaultValue: "Close" })}
          >
            <X aria-hidden />
          </ActionIconButton>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--accent),transparent_50%)] bg-[var(--accent-soft)] p-3">
            <div className="flex items-start gap-2 text-sm leading-5">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              <p className="text-[var(--text)]">
                {isCommercialLicenseRequired
                  ? t("modelHub.licenseGate.commercialCopy", {
                      defaultValue:
                        "Vox Jot does not grant this license. Continue only if you already have a commercial license or written permission that allows this model to be downloaded and used through Vox Jot on this device.",
                    })
                  : isCustomReview
                    ? t("modelHub.licenseGate.customCopy", {
                        defaultValue:
                          "This model uses a custom or gated license. Download only if your intended use is allowed by the publisher terms, or you have obtained separate written permission.",
                      })
                    : t("modelHub.licenseGate.nonCommercialCopy", {
                        defaultValue:
                          "This model appears restricted to permitted non-commercial, research, or personal use. For business, paid, workplace, client, or redistributed use, obtain a separate license from the model publisher before using it.",
                      })}
              </p>
            </div>
          </div>

          {gate.note ? (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm leading-5 text-[var(--muted)]">
              {gate.note}
            </p>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenTerms}
            disabled={busy}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {t("modelHub.licenseGate.openTerms", {
              defaultValue: "Open model terms",
            })}
          </Button>

          <label className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm leading-5 text-[var(--text)]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              checked={usageAck}
              disabled={busy}
              onChange={(event) => setUsageAck(event.target.checked)}
            />
            <span>
              {isCommercialLicenseRequired
                ? t("modelHub.licenseGate.commercialAck", {
                    defaultValue:
                      "I confirm I have the required commercial license or written permission from {{publisherName}} for my intended use of this model.",
                    publisherName,
                  })
                : isCustomReview
                  ? t("modelHub.licenseGate.customAck", {
                      defaultValue:
                        "I confirm my intended use is allowed by the publisher terms, or I have obtained any required separate permission.",
                    })
                  : t("modelHub.licenseGate.nonCommercialAck", {
                      defaultValue:
                        "I understand this model is restricted to permitted non-commercial, research, or personal use unless I obtain separate rights from the publisher.",
                    })}
            </span>
          </label>

          {requiresVoiceConsent ? (
            <label className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm leading-5 text-[var(--text)]">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={voiceAck}
                disabled={busy}
                onChange={(event) => setVoiceAck(event.target.checked)}
              />
              <span>
                {t("modelHub.licenseGate.voiceAck", {
                  defaultValue:
                    "I confirm I own or have permission to use any reference voice audio I provide.",
                })}
              </span>
            </label>
          ) : null}

          <div className="flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p>
              {t("modelHub.licenseGate.localOnly", {
                defaultValue:
                  "Vox Jot stores this acknowledgement locally. It does not verify, upload, or manage license documents, and it does not grant rights from the publisher.",
              })}
            </p>
          </div>
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
            onClick={confirmAndRecord}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("modelHub.licenseGate.download", {
              defaultValue: "Download",
            })}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LicenseAcknowledgementDialog;
