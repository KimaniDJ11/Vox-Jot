import type { AppSettings, SettingsSnapshot } from "@/bindings";
import type { SettingKey, SettingValue } from "./types";

type Edit = { key: SettingKey; value: SettingValue<SettingKey> };

/** Projects pending edits over the latest authoritative backend snapshot. */
export class SettingsEdits {
  private committed: SettingsSnapshot | null = null;
  private readonly pending = new Set<Edit>();

  accept(snapshot: SettingsSnapshot): void {
    if (!this.committed || snapshot.revision > this.committed.revision) {
      this.committed = snapshot;
    }
  }

  begin<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    current: AppSettings | null,
  ): Edit {
    if (!this.committed && current) {
      this.committed = { revision: -1, settings: current };
    }
    const edit = { key, value };
    this.pending.add(edit);
    return edit;
  }

  finish(edit: Edit): void {
    this.pending.delete(edit);
  }

  project(): AppSettings | null {
    if (!this.committed) return null;
    if (!this.pending.size) return this.committed.settings;
    const settings = { ...this.committed.settings };
    for (const { key, value } of this.pending) {
      Object.assign(settings, { [key]: value });
    }
    return settings;
  }
}

/** Orders writes to each preference and owns its busy indicator. */
export class SettingsUpdateQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(private readonly setBusy: (key: string, busy: boolean) => void) {}

  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    this.setBusy(key, true);
    const previous = this.tails.get(key);
    let task: Promise<T>;
    try {
      task = previous ? previous.then(action, action) : action();
    } catch (error) {
      task = Promise.reject(error);
    }
    this.tails.set(key, task);
    const finish = () => {
      if (this.tails.get(key) === task) {
        this.tails.delete(key);
        this.setBusy(key, false);
      }
    };
    void task.then(finish, finish);
    return task;
  }
}
