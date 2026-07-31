import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let value =
        typeof options?.defaultValue === "string" ? options.defaultValue : key;
      for (const [token, replacement] of Object.entries(options ?? {})) {
        if (token === "defaultValue") continue;
        value = value.split(`{{${token}}}`).join(String(replacement));
      }
      return value;
    },
  }),
}));

import LicenseAcknowledgementDialog from "./LicenseAcknowledgementDialog";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: globalThis.localStorage,
  });
}

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });

  return {
    container,
    async cleanup() {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

describe("LicenseAcknowledgementDialog", () => {
  beforeEach(() => {
    installLocalStorageMock();
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.localStorage.clear();
  });

  it("gates future BYO commercial-license models behind explicit acknowledgement", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onOpenTerms = vi.fn();
    const view = await render(
      <LicenseAcknowledgementDialog
        open
        modelName="Higgs Audio v3"
        acknowledgementId="tts.mlx_higgs_audio.higgs-audio-v3-tts-4b"
        gate={{
          kind: "commercial_license_required",
          licenseLabel:
            "Boson Higgs Audio v3 Research and Non-Commercial License",
          termsUrl: "https://huggingface.co/bosonai/higgs-audio-v3-tts-4b",
          publisherName: "Boson AI",
        }}
        onOpenTerms={onOpenTerms}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Commercial license required");
    expect(dialog?.textContent).toContain(
      "Higgs Audio v3 requires a separate commercial license or written agreement from Boson AI before download or use in Vox Jot.",
    );
    expect(dialog?.textContent).toContain(
      "Vox Jot does not grant this license.",
    );
    expect(dialog?.textContent).toContain(
      "I confirm I have the required commercial license or written permission from Boson AI for my intended use of this model.",
    );
    expect(dialog?.textContent).toContain(
      "It does not verify, upload, or manage license documents",
    );

    const downloadButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Download"),
    ) as HTMLButtonElement | undefined;
    expect(downloadButton).toBeDefined();
    expect(downloadButton?.disabled).toBe(true);

    const checkbox = document.body.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();

    await act(async () => {
      checkbox!.click();
    });
    expect(downloadButton?.disabled).toBe(false);

    await act(async () => {
      downloadButton?.click();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(
      window.localStorage.getItem(
        "voxjot.modelLicenseAcknowledgement.tts.mlx_higgs_audio.higgs-audio-v3-tts-4b",
      ) ?? "null",
    );
    expect(stored).toMatchObject({
      schemaVersion: 2,
      acknowledgementId: "tts.mlx_higgs_audio.higgs-audio-v3-tts-4b",
      gateKind: "commercial_license_required",
      modelName: "Higgs Audio v3",
      licenseLabel: "Boson Higgs Audio v3 Research and Non-Commercial License",
      termsUrl: "https://huggingface.co/bosonai/higgs-audio-v3-tts-4b",
      publisherName: "Boson AI",
      requiresVoiceConsent: false,
      usageAcknowledged: true,
      voiceConsentAcknowledged: null,
    });
    expect(typeof stored.acknowledgedAt).toBe("string");

    await view.cleanup();
  });
});
