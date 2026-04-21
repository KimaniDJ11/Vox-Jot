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
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
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

describe("ConvoModeView", () => {
  beforeEach(() => {
    shellProps = null;
    vi.clearAllMocks();
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
});
