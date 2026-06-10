import { useCallback, useEffect, useMemo, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import {
  checkAccessibilityPermission,
  checkInputMonitoringPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";

import { commands } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";

const APPLE_INTELLIGENCE_PROVIDER_ID = "apple_intelligence";

function isLocalBaseUrl(baseUrl: string | null | undefined): boolean {
  const lower = baseUrl?.trim().toLowerCase();
  if (!lower) return false;

  return (
    lower.startsWith("http://localhost") ||
    lower.startsWith("https://localhost") ||
    lower.startsWith("http://127.0.0.1") ||
    lower.startsWith("https://127.0.0.1") ||
    lower.startsWith("http://[::1]") ||
    lower.startsWith("https://[::1]")
  );
}

export function postProcessProviderNeedsCredentials(
  providerId: string,
  providers:
    | Array<{
        id: string;
        base_url: string;
      }>
    | null
    | undefined,
): boolean {
  const provider = providers?.find((candidate) => candidate.id === providerId);
  if (!provider) return false;
  if (provider.id === APPLE_INTELLIGENCE_PROVIDER_ID) return false;
  return !isLocalBaseUrl(provider.base_url);
}

export type DictationReadinessGateId =
  | "microphone"
  | "accessibility"
  | "input_monitoring"
  | "stt_model"
  | "paste_method"
  | "post_processing"
  | "screen_context";

export type DictationReadinessState = "ready" | "warning" | "blocked";

export interface DictationReadinessGate {
  id: DictationReadinessGateId;
  label: string;
  detail: string;
  state: DictationReadinessState;
}

export interface DictationReadiness {
  overall: DictationReadinessState;
  blockingReason?: string;
  gates: DictationReadinessGate[];
  updatedAt: number;
}

type PermissionSnapshot = {
  microphone: boolean | null;
  accessibility: boolean | null;
  inputMonitoring: boolean | null;
};

export function useDictationReadiness(): DictationReadiness {
  const { t } = useTranslation();
  const { settings, audioDevices } = useSettings();
  const [permissions, setPermissions] = useState<PermissionSnapshot>({
    microphone: null,
    accessibility: null,
    inputMonitoring: null,
  });
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const os = platform();
    if (os === "macos") {
      const [microphone, accessibility, inputMonitoring] = await Promise.all([
        checkMicrophonePermission().catch(() => false),
        checkAccessibilityPermission().catch(() => false),
        checkInputMonitoringPermission().catch(() => false),
      ]);
      setPermissions({ microphone, accessibility, inputMonitoring });
    } else if (os === "windows") {
      const status = await commands
        .getWindowsMicrophonePermissionStatus()
        .catch(() => null);
      setPermissions({
        microphone: status ? status.overall_access !== "denied" : false,
        accessibility: true,
        inputMonitoring: true,
      });
    } else {
      setPermissions({
        microphone: true,
        accessibility: true,
        inputMonitoring: true,
      });
    }

    const modelStatus = await commands
      .getTranscriptionModelStatus()
      .catch(() => ({ status: "error" as const, error: "model status" }));
    setLoadedModel(modelStatus.status === "ok" ? modelStatus.data : null);
    setCheckedAt(Date.now());
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return useMemo(() => {
    const selectedModel = settings?.selected_model ?? "";
    const pasteMethod = settings?.paste_method ?? "ctrl_v";
    const clipboardHandling = settings?.clipboard_handling ?? "dont_modify";
    const clipboardOnlyEnabled =
      pasteMethod === "none" && clipboardHandling === "copy_to_clipboard";
    const postProcessingEnabled = settings?.post_process_enabled ?? false;
    const cleanupLevel = settings?.post_process_cleanup_level ?? "light";
    const postProvider = settings?.post_process_provider_id ?? "";
    const postNeedsCredentials = postProcessProviderNeedsCredentials(
      postProvider,
      settings?.post_process_providers,
    );
    const postKeyReady =
      !postProvider ||
      !postNeedsCredentials ||
      (settings?.post_process_api_key_status?.[postProvider] ?? false);
    const screenContextEnabled = settings?.screen_context_enabled ?? true;

    const gates: DictationReadinessGate[] = [
      {
        id: "microphone",
        label: t("appSections.readiness.gates.microphone.label"),
        detail:
          permissions.microphone === false
            ? t("appSections.readiness.gates.microphone.permissionBlocked")
            : audioDevices.length === 0
              ? t("appSections.readiness.gates.microphone.noDevice")
              : t("appSections.readiness.gates.microphone.ready"),
        state:
          permissions.microphone === false || audioDevices.length === 0
            ? "blocked"
            : "ready",
      },
      {
        id: "accessibility",
        label: t("appSections.readiness.gates.accessibility.label"),
        detail:
          permissions.accessibility === false
            ? t("appSections.readiness.gates.accessibility.blocked")
            : t("appSections.readiness.gates.accessibility.ready"),
        state:
          permissions.accessibility === false
            ? clipboardOnlyEnabled
              ? "warning"
              : "blocked"
            : "ready",
      },
      {
        id: "input_monitoring",
        label: t("appSections.readiness.gates.inputMonitoring.label"),
        detail:
          permissions.inputMonitoring === false
            ? t("appSections.readiness.gates.inputMonitoring.blocked")
            : t("appSections.readiness.gates.inputMonitoring.ready"),
        state: permissions.inputMonitoring === false ? "blocked" : "ready",
      },
      {
        id: "stt_model",
        label: t("appSections.readiness.gates.sttModel.label"),
        detail:
          selectedModel && loadedModel === selectedModel
            ? t("appSections.readiness.gates.sttModel.loaded", {
                model: selectedModel,
              })
            : selectedModel
              ? t("appSections.readiness.gates.sttModel.pending", {
                  model: selectedModel,
                })
              : t("appSections.readiness.gates.sttModel.missing"),
        state: selectedModel
          ? loadedModel === selectedModel
            ? "ready"
            : "warning"
          : "blocked",
      },
      {
        id: "paste_method",
        label: t("appSections.readiness.gates.pasteMethod.label"),
        detail:
          pasteMethod === "none"
            ? t("appSections.readiness.gates.pasteMethod.disabled")
            : pasteMethod === "direct"
              ? t("appSections.readiness.gates.pasteMethod.direct")
              : t("appSections.readiness.gates.pasteMethod.clipboard"),
        state:
          pasteMethod === "none" && !clipboardOnlyEnabled ? "warning" : "ready",
      },
      {
        id: "post_processing",
        label: t("appSections.readiness.gates.postProcessing.label"),
        detail:
          postProcessingEnabled && cleanupLevel !== "raw"
            ? postKeyReady
              ? t("appSections.readiness.gates.postProcessing.ready")
              : t(
                  "appSections.readiness.gates.postProcessing.missingCredentials",
                )
            : t("appSections.readiness.gates.postProcessing.off"),
        state:
          postProcessingEnabled && cleanupLevel !== "raw" && !postKeyReady
            ? "warning"
            : "ready",
      },
      {
        id: "screen_context",
        label: t("appSections.readiness.gates.screenContext.label"),
        detail: screenContextEnabled
          ? t("appSections.readiness.gates.screenContext.on")
          : t("appSections.readiness.gates.screenContext.off"),
        state: "ready",
      },
    ];

    const blockingGate = gates.find((gate) => gate.state === "blocked");
    const hasWarning = gates.some((gate) => gate.state === "warning");

    return {
      overall: blockingGate ? "blocked" : hasWarning ? "warning" : "ready",
      blockingReason: blockingGate?.detail,
      gates,
      updatedAt: checkedAt,
    };
  }, [audioDevices.length, checkedAt, loadedModel, permissions, settings, t]);
}
