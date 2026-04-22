import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  convoCheckAvailability: vi.fn(),
  convoPrepareSession: vi.fn(),
  convoSendTextTurn: vi.fn(),
  convoCaptureSelection: vi.fn(),
  convoGetClipboardText: vi.fn(),
  convoGetCurrentNote: vi.fn(),
  convoResetSession: vi.fn(),
  convoUpdateSpeakReplies: vi.fn(),
  showDetailView: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const listenMock = vi.hoisted(() => vi.fn());

let shellProps: Record<string, any> | null = null;

vi.mock("@/bindings", () => ({
  commands: commandMocks,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("./ConvoShell", () => ({
  ConvoShell: (props: Record<string, any>) => {
    shellProps = props;
    return React.createElement("div", null);
  },
}));

vi.mock("./SelectionContextCard", () => ({
  SelectionContextCard: () => null,
}));

vi.mock("./JotpadContextCard", () => ({
  JotpadContextCard: () => null,
}));

vi.mock("./FilesContextCard", () => ({
  FilesContextCard: () => null,
}));

import { ConvoModeView } from "@/components/convo/ConvoModeView";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

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
}

describe("ConvoModeView", () => {
  beforeEach(() => {
    shellProps = null;
    vi.clearAllMocks();
    installLocalStorageMock();
    localStorage.clear();
    listenMock.mockResolvedValue(() => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    commandMocks.convoCheckAvailability.mockResolvedValue({
      status: "ok",
      data: { available: true, reason: null },
    });
    commandMocks.convoSendTextTurn.mockResolvedValue({
      status: "ok",
      data: {
        user_text: "hello",
        assistant_text: "hi",
        audio_base64: null,
        session_id: "session-1",
        suggested_actions: [],
      },
    });
    commandMocks.convoPrepareSession.mockResolvedValue({
      status: "ok",
      data: { session_id: "session-1" },
    });
    commandMocks.convoGetCurrentNote.mockResolvedValue({
      status: "ok",
      data: null,
    });
    commandMocks.convoCaptureSelection.mockResolvedValue({
      status: "ok",
      data: "",
    });
    commandMocks.convoGetClipboardText.mockResolvedValue({
      status: "ok",
      data: "",
    });
    commandMocks.convoResetSession.mockResolvedValue({
      status: "ok",
      data: null,
    });
    commandMocks.convoUpdateSpeakReplies.mockResolvedValue({
      status: "ok",
      data: null,
    });
    commandMocks.showDetailView.mockResolvedValue({
      status: "ok",
      data: null,
    });
  });

  it("reuses a single in-flight session preparation", async () => {
    const prepareDeferred = deferred<{
      status: "ok";
      data: { session_id: string };
    }>();
    commandMocks.convoPrepareSession.mockReturnValue(prepareDeferred.promise);

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<ConvoModeView mode="files_context" />);
    });

    await flushEffects();
    await flushEffects();

    expect(shellProps).not.toBeNull();
    expect(commandMocks.convoPrepareSession).toHaveBeenCalledTimes(1);

    const firstSend = shellProps!.onSendText("first");
    const secondSend = shellProps!.onSendText("second");

    expect(commandMocks.convoPrepareSession).toHaveBeenCalledTimes(1);

    prepareDeferred.resolve({
      status: "ok",
      data: { session_id: "session-1" },
    });

    await Promise.all([firstSend, secondSend]);

    expect(commandMocks.convoSendTextTurn).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores invalid persisted note ids in jotpad mode", async () => {
    localStorage.setItem("scratchpad_active_note_id", "NaN");

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<ConvoModeView mode="jotpad" />);
    });

    await flushEffects();

    expect(commandMocks.convoGetCurrentNote).not.toHaveBeenCalled();
    expect(localStorage.getItem("scratchpad_active_note_id")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows an error toast when copying a draft fails", async () => {
    const clipboardError = new Error("denied");
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(clipboardError);

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<ConvoModeView mode="jotpad" />);
    });

    await flushEffects();

    expect(shellProps).not.toBeNull();

    await act(async () => {
      await shellProps!.onCopyDraft("draft reply");
    });

    expect(toastMocks.error).toHaveBeenCalled();
    expect(toastMocks.success).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
