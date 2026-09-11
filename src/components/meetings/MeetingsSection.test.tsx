import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MeetingsSection, { formatMeetingDuration } from "./MeetingsSection";
import { MeetingRecordingStatus } from "./MeetingRecordingStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  list: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/bindings", () => ({
  commands: {
    getMeetingCapabilities: mocks.capabilities,
    listMeetings: mocks.list,
    startMeeting: mocks.start,
    stopMeeting: mocks.stop,
    deleteMeeting: mocks.remove,
    readMeeting: mocks.read,
    requestMeetingPermissions: vi.fn(),
    cancelMeetingAnalysis: vi.fn(),
  },
}));
vi.mock("@/hooks/useTauriEvent", () => ({ useTauriEvent: vi.fn() }));
vi.mock("@/components/app-sections/shared", () => ({
  SectionIntro: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const track = { frames: 16000, received_frames: 16000, peak: 0.1 };
const saved = {
  id: "session",
  title: "Planning",
  state: "recorded",
  created_at: 0,
  duration_ms: 1000,
  system_source: "All system audio",
  include_microphone: true,
  system: track,
  microphone: track,
  transcript_ready: false,
  summary_ready: false,
};
let root: Root;
let view: HTMLDivElement;
async function render(element: React.ReactNode) {
  view = document.createElement("div");
  document.body.appendChild(view);
  root = createRoot(view);
  await act(async () => root.render(element));
}
function button(label: string) {
  const value = Array.from(view.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  expect(value, label).toBeDefined();
  return value!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function nextFrame() {
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}
async function title(value: string) {
  const input = view.querySelector<HTMLInputElement>(
    'input[aria-label="Meeting title"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.capabilities.mockResolvedValue({
    status: "ok",
    data: {
      supported: true,
      screen_permission: true,
      microphone_permission: true,
      applications: [],
      microphones: [],
    },
  });
  mocks.list.mockResolvedValue({ status: "ok", data: [] });
  mocks.start.mockResolvedValue({ status: "ok", data: saved });
  mocks.stop.mockResolvedValue({ status: "ok", data: null });
  mocks.remove.mockResolvedValue({ status: "ok", data: null });
  mocks.read.mockResolvedValue({
    status: "ok",
    data: { session: saved, summary: null, segments: [] },
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  view?.remove();
});
describe("Meetings", () => {
  it("requires native support and permission before recording", async () => {
    mocks.capabilities.mockResolvedValue({
      status: "ok",
      data: {
        supported: true,
        screen_permission: false,
        microphone_permission: true,
        applications: [],
        microphones: [],
      },
    });
    await render(<MeetingsSection />);
    expect(button("Start meeting recording").disabled).toBe(true);
    expect(button("Allow access").disabled).toBe(false);
    expect(button("Check again").disabled).toBe(false);
    expect(view.textContent).toContain("System Settings");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("leads with Start Meeting and keeps options collapsed", async () => {
    await render(<MeetingsSection />);
    expect(button("Start meeting recording").textContent).toBe("Start Meeting");
    const options = view.querySelector<HTMLDetailsElement>("details")!;
    expect(options.open).toBe(false);
    expect(options.textContent).toContain("Meeting title");
    expect(options.textContent).toContain("System audio");
    expect(options.textContent).toContain("Microphone");
  });
  it("uses explicit source and microphone choices", async () => {
    await render(<MeetingsSection />);
    await title("Planning");
    await act(async () =>
      view.querySelector<HTMLButtonElement>('button[role="switch"]')!.click(),
    );
    await click("Start meeting recording");
    expect(mocks.start).toHaveBeenCalledWith("Planning", 0, "", false);
  });
  it("shows start errors and preserves the title", async () => {
    mocks.start.mockResolvedValue({
      status: "error",
      error: "Disk space is low",
    });
    await render(<MeetingsSection />);
    await title("Keep me");
    await click("Start meeting recording");
    expect(view.querySelector('[role="alert"]')?.textContent).toContain(
      "Disk space is low",
    );
    expect(
      view.querySelector<HTMLInputElement>('input[aria-label="Meeting title"]')
        ?.value,
    ).toBe("Keep me");
  });
  it("requires inline confirmation before recoverable deletion", async () => {
    mocks.list.mockResolvedValue({ status: "ok", data: [saved] });
    await render(<MeetingsSection />);
    await click("More actions for Planning");
    await click("Delete");
    expect(mocks.remove).not.toHaveBeenCalled();
    await click("Cancel");
    expect(mocks.remove).not.toHaveBeenCalled();
    await click("More actions for Planning");
    await click("Delete");
    await click("Confirm delete");
    expect(mocks.remove).toHaveBeenCalledWith("session", true);
    expect(view.textContent).toContain("Moved to Deleted Meetings.");
  });
  it("keeps keyboard focus inside delete confirmation", async () => {
    mocks.list.mockResolvedValue({ status: "ok", data: [saved] });
    await render(<MeetingsSection />);
    await click("More actions for Planning");
    await click("Delete");
    await nextFrame();
    expect(document.activeElement?.textContent).toBe("Cancel");
    await click("Cancel");
    await nextFrame();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "More actions for Planning",
    );
  });
  it("supports arrow and Escape keys in the actions menu", async () => {
    mocks.list.mockResolvedValue({ status: "ok", data: [saved] });
    await render(<MeetingsSection />);
    await click("More actions for Planning");
    await nextFrame();
    expect(document.activeElement?.textContent).toBe("Reveal files");
    const menu = view.querySelector('[role="menu"]')!;
    await act(async () => {
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(document.activeElement?.textContent).toBe("Delete");
    await act(async () => {
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await nextFrame();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "More actions for Planning",
    );
  });
  it("focuses inline meeting details and returns focus when closed", async () => {
    const ready = { ...saved, state: "ready", transcript_ready: true };
    mocks.list.mockResolvedValue({ status: "ok", data: [ready] });
    mocks.read.mockResolvedValue({
      status: "ok",
      data: { session: ready, summary: null, segments: [] },
    });
    await render(<MeetingsSection />);
    await click("Open");
    await nextFrame();
    expect(document.activeElement?.textContent).toBe("Planning");
    await click("Close");
    await nextFrame();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Open notes and transcript for Planning",
    );
  });
  it("keeps the recording timer outside the live region", async () => {
    mocks.list.mockResolvedValue({
      status: "ok",
      data: [{ ...saved, state: "recording" }],
    });
    await render(<MeetingsSection />);
    const liveStatus = view.querySelector(
      '[role="status"][aria-live="polite"]',
    );
    expect(liveStatus?.textContent).toBe("Recording");
    expect(liveStatus?.textContent).not.toContain("00:00:01");
  });
  it("shows active analysis instead of a stale ready state", async () => {
    mocks.list.mockResolvedValue({
      status: "ok",
      data: [
        {
          ...saved,
          state: "summarizing",
          transcript_ready: true,
          summary_ready: false,
        },
      ],
    });
    await render(<MeetingsSection />);
    expect(view.textContent).toContain("Creating local summary…");
  });
  it("keeps a stop action outside the Meetings page", async () => {
    mocks.list.mockResolvedValue({
      status: "ok",
      data: [{ ...saved, state: "recording" }],
    });
    await render(<MeetingRecordingStatus />);
    await click("Stop meeting");
    expect(mocks.stop).toHaveBeenCalledWith("session");
    expect(button("Saving audio…").disabled).toBe(true);
  });
  it("formats long sessions", () => {
    expect(formatMeetingDuration(3661000)).toBe("01:01:01");
  });
});
