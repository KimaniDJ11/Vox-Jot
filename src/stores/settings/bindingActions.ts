import { commands } from "@/bindings";
import type { AppSettings, BindingResponse, ShortcutBinding } from "@/bindings";
import { unwrapCommandResult } from "@/lib/commandResult";
import type { SettingsActionContext, SettingsStore } from "./types";

function savedBinding(result: BindingResponse): ShortcutBinding {
  if (!result.success || !result.binding) {
    throw new Error(result.error ?? "The shortcut could not be saved.");
  }
  return result.binding;
}

function withBinding(
  settings: AppSettings | null,
  binding: ShortcutBinding,
): AppSettings | null {
  return settings
    ? {
        ...settings,
        bindings: { ...settings.bindings, [binding.id]: binding },
      }
    : null;
}

export function createBindingActions({
  setState: set,
  getState: get,
  updates,
}: SettingsActionContext): Pick<
  SettingsStore,
  "updateBinding" | "resetBinding"
> {
  return {
    /** Rejects when the shortcut is invalid or cannot be registered. */
    updateBinding: (id, binding) =>
      updates.run(`binding_${id}`, async () => {
        const original = get().settings?.bindings?.[id];
        if (original) {
          set((state) => ({
            settings: withBinding(state.settings, {
              ...original,
              current_binding: binding,
            }),
          }));
        }

        try {
          const saved = savedBinding(
            await unwrapCommandResult(commands.changeBinding(id, binding)),
          );
          set((state) => ({ settings: withBinding(state.settings, saved) }));
        } catch (error) {
          if (original) {
            set((state) => ({
              settings: withBinding(state.settings, original),
            }));
          }
          throw error;
        }
      }),
    /** Rejects when the default shortcut cannot be registered. */
    resetBinding: (id) =>
      updates.run(`binding_${id}`, async () => {
        const saved = savedBinding(
          await unwrapCommandResult(commands.resetBinding(id)),
        );
        set((state) => ({ settings: withBinding(state.settings, saved) }));
      }),
  };
}
