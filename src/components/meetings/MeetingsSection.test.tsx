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
}));
vi.mock("@/bindings", () => ({
  commands: {
    getMeetingCapabilities: mocks.capabilities,
    listMeetings: mocks.list,
    startMeeting: mocks.start,
    stopMeeting: mocks.stop,
    deleteMeeting: mocks.remove,
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
    (b) => b.textContent?.trim() === label,
  );
  expect(value, label).toBeDefined();
  return value!;
}
async function click(label: string) {
  await act(async () => button(label).click());
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
    expect(button("Allow recording permissions").disabled).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("uses explicit source and microphone choices", async () => {
    await render(<MeetingsSection />);
    await title("Planning");
    await act(async () =>
      view.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
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
    await click("Delete");
    expect(mocks.remove).not.toHaveBeenCalled();
    await click("Cancel");
    expect(mocks.remove).not.toHaveBeenCalled();
    await click("Delete");
    await click("Confirm delete");
    expect(mocks.remove).toHaveBeenCalledWith("session", true);
    expect(view.textContent).toContain("No audio was permanently erased");
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
