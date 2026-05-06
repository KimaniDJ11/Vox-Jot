import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  Check,
  Download,
  FolderOpen,
  Globe,
  HardDrive,
  Loader2,
  Monitor,
  ScanSearch,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import {
  commands,
  type OcrModelCatalog,
  type OcrModelDescriptor,
  type ScreenContextOcrEngine,
} from "@/bindings";
import HubModelCard, {
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import { Button } from "@/components/ui/Button";
import { useSettingsSlice, useUpdateSetting } from "@/hooks/useSettings";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";

type OcrProviderFilterValue = "all" | "system" | "neural" | "tesseract";

interface OcrDownloadProgressPayload {
  catalog_id: string;
  stage: string;
  downloaded: number;
  total: number;
  percentage: number;
  file?: string | null;
  error?: string | null;
}

interface SystemPolicyOption {
  value: ScreenContextOcrEngine;
  titleKey: string;
  defaultTitle: string;
  descriptionKey: string;
  defaultDescription: string;
}

const SYSTEM_POLICY_OPTIONS: SystemPolicyOption[] = [
  {
    value: "native_then_backup",
    titleKey: "modelHub.ocr.options.nativeThenBackup.title",
    defaultTitle: "Smart (default)",
    descriptionKey: "modelHub.ocr.options.nativeThenBackup.description",
    defaultDescription:
      "Use the OS-native OCR first, fall back to Tesseract on failure or empty results.",
  },
  {
    value: "native_only",
    titleKey: "modelHub.ocr.options.nativeOnly.title",
    defaultTitle: "System OCR only",
    descriptionKey: "modelHub.ocr.options.nativeOnly.description",
    defaultDescription:
      "Use the operating system's built-in OCR only — Apple Vision on macOS, Windows.Media.Ocr on Windows.",
  },
  {
    value: "backup_only",
    titleKey: "modelHub.ocr.options.backupOnly.title",
    defaultTitle: "Tesseract only",
    descriptionKey: "modelHub.ocr.options.backupOnly.description",
    defaultDescription:
      "Always use the bundled Tesseract engine. Useful for parity testing or when system OCR underperforms.",
  },
  {
    value: "auto",
    titleKey: "modelHub.ocr.options.auto.title",
    defaultTitle: "Auto",
    descriptionKey: "modelHub.ocr.options.auto.description",
    defaultDescription:
      "Let Vox Jot pick the best engine for your platform and current language coverage.",
  },
];

interface OcrEnginesSectionProps {
  titleActionTargetId?: string;
  hubSearchQuery?: string;
  hubFilterLabels?: boolean;
}

function detectPlatform(): "mac" | "windows" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

function systemVendorLabel(
  platform: ReturnType<typeof detectPlatform>,
  translate: TFunction,
): string {
  if (platform === "mac") {
    return translate("modelHub.ocr.vendor.appleVision", {
      defaultValue: "Apple Vision + Tesseract",
    });
  }
  if (platform === "windows") {
    return translate("modelHub.ocr.vendor.windowsMediaOcr", {
      defaultValue: "Windows.Media.Ocr + Tesseract",
    });
  }
  return translate("modelHub.ocr.vendor.linuxSystem", {
    defaultValue: "Tesseract (system)",
  });
}

function ocrBackendLabel(model: OcrModelDescriptor, translate: TFunction) {
  switch (model.backend) {
    case "paddle_det_rec":
      return translate("modelHub.ocr.backends.paddleDetRec", {
        defaultValue: "Detector + recognizer",
      });
    case "paddle_vl":
      return translate("modelHub.ocr.backends.paddleVl", {
        defaultValue: "Vision-language",
      });
    case "transformers_vl":
      return translate("modelHub.ocr.backends.transformersVl", {
        defaultValue: "VL transformer",
      });
    case "tessdata_pack":
      return translate("modelHub.ocr.backends.tessdata", {
        defaultValue: "Tessdata pack",
      });
    default:
      return translate("modelHub.ocr.backends.ocrRuntime", {
        defaultValue: "OCR runtime",
      });
  }
}

const OcrEnginesSection: React.FC<OcrEnginesSectionProps> = ({
  titleActionTargetId,
  hubSearchQuery,
  hubFilterLabels = false,
}) => {
  const { t } = useTranslation();
  const updateSetting = useUpdateSetting();
  const {
    screen_context_ocr_engine: engineValue,
    screen_context_ocr_neural_model_id: neuralModelId,
  } = useSettingsSlice([
    "screen_context_ocr_engine",
    "screen_context_ocr_neural_model_id",
  ] as const);
  const currentEngine: ScreenContextOcrEngine =
    (engineValue as ScreenContextOcrEngine | undefined) ?? "native_then_backup";
  const currentNeural = (neuralModelId as string | undefined | null) ?? null;

  const [providerFilter, setProviderFilter] =
    useState<OcrProviderFilterValue>("all");
  const [catalog, setCatalog] = useState<OcrModelCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] = useState<
    Record<
      string,
      Pick<
        OcrDownloadProgressPayload,
        "stage" | "percentage" | "file" | "error"
      >
    >
  >({});

  const headerActionPortal = usePortalTarget(titleActionTargetId ?? null);
  const platform = useMemo(() => detectPlatform(), []);

  const refreshCatalog = useCallback(async () => {
    const result = await commands.getOcrModelCatalog();
    if (result.status === "ok") {
      setCatalog(result.data);
      setCatalogError(null);
    } else {
      setCatalogError(result.error);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<OcrDownloadProgressPayload>(
        "ocr-download-progress",
        (event) => {
          const payload = event.payload;
          const id = payload.catalog_id;
          if (!id) return;
          setDownloadProgress((prev) => ({
            ...prev,
            [id]: {
              stage: payload.stage,
              percentage: payload.percentage,
              file: payload.file ?? undefined,
              error: payload.error ?? undefined,
            },
          }));
          if (
            payload.stage === "failed" ||
            payload.stage === "complete" ||
            payload.error
          ) {
            void refreshCatalog();
          }
        },
      );
    })();
    return () => unlisten?.();
  }, [refreshCatalog]);

  const onSelectSystemPolicy = async (engine: ScreenContextOcrEngine) => {
    if (currentNeural) {
      await updateSetting("screen_context_ocr_neural_model_id", null as never);
      await refreshCatalog();
    }
    if (engine !== currentEngine) {
      await updateSetting("screen_context_ocr_engine", engine as never);
    }
  };

  const onSelectNeural = async (model: OcrModelDescriptor) => {
    if (!model.installed) return;
    setBusyId(model.id);
    try {
      await updateSetting(
        "screen_context_ocr_neural_model_id",
        model.id as never,
      );
      setCatalogError(null);
      await refreshCatalog();
    } finally {
      setBusyId(null);
    }
  };

  const onDownloadNeuralHf = async (model: OcrModelDescriptor) => {
    setBusyId(model.id);
    try {
      const res = await commands.downloadOcrModel(model.id);
      if (res.status === "error") {
        setCatalogError(res.error);
        return;
      }
      setCatalogError(null);
      await refreshCatalog();
    } finally {
      setBusyId(null);
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    }
  };

  const onImportNeural = async (model: OcrModelDescriptor) => {
    let picked: string | null = null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: t("modelHub.ocr.actions.pickFolderTitle", {
          modelName: model.title,
          defaultValue: `Pick the folder that contains ${model.title}`,
        }),
      });
      picked = typeof result === "string" ? result : null;
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!picked) return;

    setBusyId(model.id);
    try {
      const res = await commands.importOcrModelFromDisk(model.id, picked);
      if (res.status === "error") {
        setCatalogError(res.error);
        return;
      }
      await refreshCatalog();
    } finally {
      setBusyId(null);
    }
  };

  const onDeleteNeural = async (model: OcrModelDescriptor) => {
    setBusyId(model.id);
    try {
      const res = await commands.deleteOcrModel(model.id);
      if (res.status === "error") {
        setCatalogError(res.error);
        return;
      }
      setConfirmingDeleteId(null);
      await refreshCatalog();
    } finally {
      setBusyId(null);
    }
  };

  const providerSelectOptions = useMemo(() => {
    const idle = hubFilterLabels
      ? t("modelHub.ocr.filters.providerIdle", { defaultValue: "Provider" })
      : t("modelHub.ocr.filters.allProviders", {
          defaultValue: "All providers",
        });
    return [
      { value: "all" as const, label: idle },
      {
        value: "system" as const,
        label: t("modelHub.ocr.filters.system", { defaultValue: "System OCR" }),
      },
      {
        value: "neural" as const,
        label: t("modelHub.ocr.filters.neural", {
          defaultValue: "Neural OCR",
        }),
      },
      {
        value: "tesseract" as const,
        label: t("modelHub.ocr.filters.tesseract", {
          defaultValue: "Tesseract",
        }),
      },
    ];
  }, [hubFilterLabels, t]);
  const selectedProviderLabel = useMemo(() => {
    const idle = hubFilterLabels
      ? t("modelHub.ocr.filters.providerIdle", { defaultValue: "Provider" })
      : t("modelHub.ocr.filters.allProviders", {
          defaultValue: "All providers",
        });
    if (providerFilter === "all") {
      return idle;
    }
    return (
      providerSelectOptions.find((option) => option.value === providerFilter)
        ?.label ?? idle
    );
  }, [hubFilterLabels, providerFilter, providerSelectOptions, t]);
  const hasActiveProviderFilter = providerFilter !== "all";

  const showSystemCard = useMemo(() => {
    if (providerFilter === "neural" || providerFilter === "tesseract")
      return false;
    const q = (hubSearchQuery ?? "").trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      t("modelHub.ocr.systemCard.title", { defaultValue: "System OCR" }),
      systemVendorLabel(platform, t),
      ...SYSTEM_POLICY_OPTIONS.map((option) =>
        [
          t(option.titleKey, { defaultValue: option.defaultTitle }),
          t(option.descriptionKey, {
            defaultValue: option.defaultDescription,
          }),
        ].join(" "),
      ),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  }, [hubSearchQuery, platform, providerFilter, t]);

  const filteredCatalogModels = useMemo(() => {
    if (!catalog) return [];
    let models = catalog.models;
    if (providerFilter === "neural") {
      models = models.filter((model) => model.backend !== "tessdata_pack");
    } else if (providerFilter === "tesseract") {
      models = models.filter((model) => model.backend === "tessdata_pack");
    } else if (providerFilter === "system") {
      return [];
    }

    const q = (hubSearchQuery ?? "").trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) => {
      const haystack = [
        model.title,
        model.vendor,
        model.description,
        model.languages_label,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [catalog, hubSearchQuery, providerFilter]);

  const installedCatalogModels = useMemo(() => {
    const models = filteredCatalogModels.filter((model) => model.installed);
    const activeIndex = models.findIndex((model) => model.id === currentNeural);
    if (activeIndex <= 0) return models;
    const next = [...models];
    const [activeModel] = next.splice(activeIndex, 1);
    return [activeModel, ...next];
  }, [currentNeural, filteredCatalogModels]);

  const downloadableCatalogModels = useMemo(
    () => filteredCatalogModels.filter((model) => !model.installed),
    [filteredCatalogModels],
  );

  const providerLanguageFilters = hubFilterLabels ? (
    <div className="flex items-center gap-2">
      <div className="relative inline-flex h-10 w-10 shrink-0">
        <select
          value={providerFilter}
          onChange={(event) =>
            setProviderFilter(event.target.value as OcrProviderFilterValue)
          }
          className={`h-full w-full appearance-none rounded-full border px-0 py-1.5 text-xs font-semibold text-transparent shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hasActiveProviderFilter
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--border)] bg-[var(--card)]"
          }`}
          aria-label={t("modelHub.ocr.filters.providerAria", {
            defaultValue: "Filter OCR engines by provider",
          })}
          title={`Provider: ${selectedProviderLabel}`}
        >
          {providerSelectOptions.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              style={{ color: "var(--text)", backgroundColor: "var(--card)" }}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {providerFilter === "all" ? (
            <SlidersHorizontal className="h-4 w-4 text-[var(--text)]" />
          ) : providerFilter === "neural" ? (
            <ScanSearch className="h-4 w-4 text-[var(--text)]" />
          ) : (
            <ProviderIcon providerId={providerFilter} size="sm" />
          )}
        </div>
      </div>
    </div>
  ) : null;

  const headerContent =
    headerActionPortal && providerLanguageFilters
      ? createPortal(providerLanguageFilters, headerActionPortal)
      : null;

  const systemActive = currentNeural === null;
  const systemVendor = systemVendorLabel(platform, t);

  // Top-right reserved for status only — vendor moved to subline.
  const systemHeaderBadges: CompactBadgeItem[] = [
    systemActive
      ? {
          id: "active",
          label: t("modelHub.ocr.badges.active", { defaultValue: "Active" }),
          variant: "primary",
          icon: <Check className="h-3.5 w-3.5" aria-hidden />,
          detail: t("modelHub.ocr.badges.activeDetail", {
            defaultValue: "Currently selected screen OCR engine.",
          }),
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  const systemCardProviderId =
    platform === "mac"
      ? "apple_intelligence"
      : platform === "windows"
        ? "microsoft"
        : "system_builtin";

  const systemCard = (
    <HubModelCard
      key="system-ocr"
      title={t("modelHub.ocr.systemCard.title", { defaultValue: "System OCR" })}
      providerId={systemCardProviderId}
      subline={systemVendor}
      headerBadges={systemHeaderBadges}
      headerBadgesMaxVisible={2}
      description={t("modelHub.ocr.systemCard.description", {
        defaultValue:
          "Built-in routing across Apple Vision / Windows.Media.Ocr and the bundled Tesseract fallback.",
      })}
      capabilityChips={[
        {
          id: "capability-deployment",
          label: t("modelHub.chips.local", { defaultValue: "Local" }),
          variant: "secondary",
          icon: <Monitor className="h-3 w-3" />,
          detail: t("modelHub.chips.localDetail", {
            defaultValue: "Runs on this Mac or through a local runtime.",
          }),
        },
        {
          id: "capability-coverage",
          label: t("modelHub.ocr.meta.osBuiltIn", {
            defaultValue: "OS built-in",
          }),
          variant: "secondary",
          icon: <Globe className="h-3 w-3" />,
          detail: t("modelHub.ocr.languages.nativeOnly", {
            defaultValue:
              "Follows your OS language and regional text recognition settings.",
          }),
        },
        {
          id: "capability-backend",
          label: t("modelHub.ocr.meta.adaptive", { defaultValue: "Adaptive" }),
          variant: "secondary",
          icon: <ScanSearch className="h-3 w-3" />,
          detail: t("modelHub.ocr.options.nativeThenBackup.description", {
            defaultValue:
              "Use the OS-native OCR first, fall back to Tesseract on failure or empty results.",
          }),
        },
      ]}
      footerMetaItems={[
        t("modelHub.ocr.meta.balanced", { defaultValue: "Balanced" }),
        t("modelHub.ocr.meta.fastest", { defaultValue: "Fastest path" }),
        t("modelHub.ocr.meta.osBuiltIn", { defaultValue: "OS built-in" }),
      ]}
      footerMetaIcon={<Globe className="h-3.5 w-3.5" aria-hidden />}
      footerOverflowLabel={t("modelHub.ocr.systemCard.title", {
        defaultValue: "System OCR",
      })}
      active={systemActive}
      footerExtra={
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
            {t("modelHub.ocr.systemCard.routingLabel", {
              defaultValue: "Routing",
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            {SYSTEM_POLICY_OPTIONS.map((option) => {
              const isActive = systemActive && option.value === currentEngine;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onSelectSystemPolicy(option.value);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    isActive
                      ? "border-[var(--accent)] bg-logo-primary text-[var(--inverse-text)]"
                      : "border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:border-[var(--accent)]"
                  }`}
                  title={t(option.descriptionKey, {
                    defaultValue: option.defaultDescription,
                  })}
                >
                  {t(option.titleKey, { defaultValue: option.defaultTitle })}
                </button>
              );
            })}
          </div>
        </div>
      }
    />
  );

  const renderNeuralCard = (model: OcrModelDescriptor) => {
    const isActive = currentNeural === model.id;
    const isBusy = busyId === model.id;
    const isConfirmingDelete = confirmingDeleteId === model.id;

    // Top-right reserved for status only — vendor moves to subline.
    const headerBadges: CompactBadgeItem[] = [
      isActive
        ? {
            id: "active",
            label: t("modelHub.ocr.badges.active", { defaultValue: "Active" }),
            variant: "primary",
            icon: <Check className="h-3.5 w-3.5" aria-hidden />,
            detail: t("modelHub.ocr.badges.activeDetail", {
              defaultValue: "Currently selected screen OCR engine.",
            }),
          }
        : null,
    ].filter(Boolean) as CompactBadgeItem[];

    const backendLabel = ocrBackendLabel(model, t);
    const capabilityChips: CompactBadgeItem[] = [
      {
        id: "capability-deployment",
        label: t("modelHub.chips.local", { defaultValue: "Local" }),
        variant: "secondary",
        icon: <Monitor className="h-3 w-3" />,
        detail: t("modelHub.chips.localDetail", {
          defaultValue: "Runs on this Mac or through a local runtime.",
        }),
      },
      {
        id: "capability-size",
        label: model.size_hint_label,
        variant: "secondary",
        icon: <HardDrive className="h-3 w-3" />,
        detail: t("modelSelector.sizeDetail", {
          defaultValue: "Approximate disk size after download.",
        }),
      },
      {
        id: "capability-languages",
        label: model.languages_label,
        variant: "secondary",
        icon: <Globe className="h-3 w-3" />,
        detail: t("modelHub.ocr.languages.tesseract", {
          defaultValue:
            "Depends on installed tessdata packs (often English-first unless you add more).",
        }),
      },
      {
        id: "capability-backend",
        label: backendLabel,
        variant: "secondary",
        icon: <ScanSearch className="h-3 w-3" />,
        detail: t("modelHub.ocr.badges.vendorDetail", {
          defaultValue: "Screen OCR runtime used for this mode.",
        }),
      },
    ];
    const footerMetaItems = [backendLabel];

    let trailing: HubTrailing = null;
    if (!model.installed) {
      trailing = {
        kind: "custom",
        node: (
          <div
            className="flex shrink-0 items-center gap-1"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Button
              variant="primary"
              size="icon"
              title={t("modelHub.ocr.actions.downloadFromHub", {
                modelName: model.title,
                repoId: model.hf_repo_id,
                defaultValue:
                  "Download {{modelName}} from Hugging Face ({{repoId}})",
              })}
              aria-label={t("modelHub.ocr.actions.downloadFromHub", {
                modelName: model.title,
                repoId: model.hf_repo_id,
                defaultValue:
                  "Download {{modelName}} from Hugging Face ({{repoId}})",
              })}
              disabled={isBusy && busyId === model.id}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onDownloadNeuralHf(model);
              }}
            >
              {isBusy && busyId === model.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={t("modelHub.ocr.actions.importFromDisk", {
                defaultValue: "Import from folder",
              })}
              aria-label={t("modelHub.ocr.actions.importFromDisk", {
                defaultValue: "Import from folder",
              })}
              disabled={Boolean(busyId)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onImportNeural(model);
              }}
              className="text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ),
      };
    } else if (!isConfirmingDelete) {
      trailing = {
        kind: "remove",
        busy: isBusy,
        label: t("modelHub.ocr.actions.remove", {
          modelName: model.title,
          defaultValue: `Remove ${model.title}`,
        }),
        onClick: () => setConfirmingDeleteId(model.id),
      };
    }

    const dl = downloadProgress[model.id];

    const downloadProgressFooter =
      dl && !isConfirmingDelete ? (
        <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
          <div className="mb-2 flex flex-col gap-0.5 text-xs font-medium">
            <span className="text-[var(--text)]">
              {dl.stage === "preparing"
                ? t("modelHub.ocr.download.preparing", {
                    defaultValue: "Preparing download…",
                  })
                : t("modelHub.ocr.download.percent", {
                    value: Math.min(100, Math.round(dl.percentage)),
                    defaultValue: "{{value}}%",
                  })}
            </span>
            {dl.stage === "downloading" && dl.file?.length ? (
              <span className="block truncate font-normal text-[var(--muted)]">
                {dl.file.includes("/")
                  ? dl.file.slice(dl.file.lastIndexOf("/") + 1)
                  : dl.file}
              </span>
            ) : null}
            {dl.error ? (
              <span className="font-normal text-[var(--danger)]">
                {dl.error}
              </span>
            ) : null}
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--input)]"
            role="progressbar"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.min(100, Math.round(dl.percentage))}
          >
            <div
              className="h-2 rounded-full bg-[var(--accent)] transition-[width] duration-200"
              style={{
                width: `${Math.min(100, dl.percentage)}%`,
              }}
            />
          </div>
        </div>
      ) : null;

    const footerExtra =
      downloadProgressFooter ??
      (isConfirmingDelete ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-2 text-sm text-[var(--text)]">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
              aria-hidden
            />
            <p className="min-w-0 flex-1 leading-snug">
              {t("modelHub.ocr.confirmRemove", {
                modelName: model.title,
                defaultValue:
                  "Remove {{modelName}}? Files will be deleted from the app's OCR cache.",
              })}
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setConfirmingDeleteId(null);
              }}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isBusy}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onDeleteNeural(model);
              }}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                t("modelSelector.confirmDelete", { defaultValue: "Delete" })
              )}
            </Button>
          </div>
        </div>
      ) : null);

    const handleClick = () => {
      if (isConfirmingDelete) return;
      if (!model.installed) {
        void onDownloadNeuralHf(model);
        return;
      }
      void onSelectNeural(model);
    };

    return (
      <HubModelCard
        key={model.id}
        title={model.title}
        providerId={resolveModelProviderId(
          `${model.vendor} ${model.title} ${model.id}`,
          model.backend === "tessdata_pack" ? "tesseract" : "generic",
        )}
        subline={model.vendor}
        headerBadges={headerBadges}
        headerBadgesMaxVisible={2}
        description={model.description}
        capabilityChips={capabilityChips}
        footerMetaItems={footerMetaItems}
        footerMetaIcon={<Globe className="h-3.5 w-3.5" aria-hidden />}
        footerMetaMaxVisible={4}
        footerOverflowLabel={`${model.title} details`}
        active={isActive}
        trailing={trailing}
        footerExtra={footerExtra}
        onClick={handleClick}
      />
    );
  };

  const isCatalogEmpty =
    catalog !== null &&
    !showSystemCard &&
    installedCatalogModels.length === 0 &&
    downloadableCatalogModels.length === 0;
  const showCatalogGroups =
    catalog !== null && filteredCatalogModels.length > 0;

  const renderModelGroup = (
    title: string,
    models: OcrModelDescriptor[],
    emptyMessage: string,
    showHeader: boolean,
  ) => (
    <div className="space-y-3">
      {showHeader ? (
        <div className="flex items-center gap-2 px-1">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
            {title}
          </h2>
          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">
            {models.length}
          </span>
        </div>
      ) : null}
      {models.length > 0 ? (
        <div className="flex flex-col gap-3">
          {models.map(renderNeuralCard)}
        </div>
      ) : showHeader ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-5 text-sm text-[var(--muted)]">
          {emptyMessage}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      {headerContent}

      {catalogError ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-sm text-[var(--text)]">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
            aria-hidden
          />
          <p className="min-w-0 flex-1 leading-snug">{catalogError}</p>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCatalogError(null)}
            aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {showSystemCard ? systemCard : null}
        {showCatalogGroups ? (
          <>
            {renderModelGroup(
              t("modelHub.ocr.sections.downloaded", {
                defaultValue: "Downloaded Models",
              }),
              installedCatalogModels,
              t("modelHub.ocr.sections.downloadedEmpty", {
                defaultValue:
                  "No downloaded OCR models match the current filters.",
              }),
              false,
            )}
            <div className="border-t border-[var(--border)] pt-4">
              {renderModelGroup(
                t("modelHub.ocr.sections.available", {
                  defaultValue: "Available to Download",
                }),
                downloadableCatalogModels,
                t("modelHub.ocr.sections.availableEmpty", {
                  defaultValue:
                    "Every matching OCR model is already downloaded.",
                }),
                true,
              )}
            </div>
          </>
        ) : null}
        {isCatalogEmpty ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-5 text-sm text-[var(--muted)]">
            {t("modelHub.ocr.empty", {
              defaultValue: "No OCR engines match the current filters.",
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default OcrEnginesSection;
