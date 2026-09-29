import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/bindings";
import { SettingsEdits, SettingsUpdateQueue } from "./SettingsEdits";

const settings = (patch: Partial<AppSettings> = {}) =>
  ({
    app_theme: "dark",
    tts_rate: 1,
    selected_language: "en",
    ...patch,
  }) as AppSettings;

describe("settings synchronization", () => {
  it("keeps newer edits visible while an earlier save completes", () => {
    const edits = new SettingsEdits();
    edits.accept({ revision: 1, settings: settings() });
    const first = edits.begin("app_theme", "light", null);
    const second = edits.begin("app_theme", "ocean", null);
    edits.accept({
      revision: 2,
      settings: settings({ app_theme: "light", selected_language: "fr" }),
    });
    edits.finish(first);
    expect(edits.project()).toMatchObject({
      app_theme: "ocean",
      selected_language: "fr",
    });
    edits.accept({
      revision: 3,
      settings: settings({ app_theme: "ocean", selected_language: "fr" }),
    });
    edits.finish(second);
    expect(edits.project()?.app_theme).toBe("ocean");
  });

  it("rejects stale responses and reflects backend normalization after saving", () => {
    const edits = new SettingsEdits();
    edits.accept({ revision: 1, settings: settings() });
    const edit = edits.begin("tts_rate", 5, null);
    edits.accept({ revision: 3, settings: settings({ tts_rate: 2 }) });
    edits.accept({ revision: 2, settings: settings({ tts_rate: 1.5 }) });
    expect(edits.project()?.tts_rate).toBe(5);
    edits.finish(edit);
    expect(edits.project()?.tts_rate).toBe(2);
  });

  it("restores the committed value after a failed edit without losing other writes", () => {
    const edits = new SettingsEdits();
    edits.accept({ revision: 1, settings: settings() });
    const edit = edits.begin("app_theme", "unknown", null);
    edits.accept({
      revision: 2,
      settings: settings({ selected_language: "de" }),
    });
    edits.finish(edit);
    expect(edits.project()).toMatchObject({
      app_theme: "dark",
      selected_language: "de",
    });
  });

  it("serializes writes to the same setting and remains busy until the last finishes", async () => {
    const busy = vi.fn();
    const queue = new SettingsUpdateQueue(busy);
    let finish!: () => void;
    const first = queue.run(
      "theme",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const next = vi.fn(async () => "saved");
    const second = queue.run("theme", next);
    const independent = queue.run("language", async () => "fr");
    await expect(independent).resolves.toBe("fr");
    expect(next).not.toHaveBeenCalled();
    finish();
    await first;
    await expect(second).resolves.toBe("saved");
    expect(
      busy.mock.calls.filter(([key, value]) => key === "theme" && !value),
    ).toHaveLength(1);
  });

  it("releases failed operations and allows the next write", async () => {
    const busy = vi.fn();
    const queue = new SettingsUpdateQueue(busy);
    await expect(
      queue.run("theme", () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    await expect(queue.run("theme", async () => "saved")).resolves.toBe(
      "saved",
    );
    expect(busy).toHaveBeenLastCalledWith("theme", false);
  });
});
