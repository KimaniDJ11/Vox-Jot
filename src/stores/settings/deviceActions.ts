import type { AudioDevice } from "@/bindings";
import { commands } from "@/bindings";
import { unwrapCommandResult, type CommandResult } from "@/lib/commandResult";
import type { SettingsActionContext, SettingsStore } from "./types";

/** The only choice left when the device list cannot be read. */
const SYSTEM_DEFAULT_DEVICE: AudioDevice = {
  index: "default",
  name: "Default",
  is_default: true,
};

async function loadDevices(
  query: () => Promise<CommandResult<AudioDevice[]>>,
  label: string,
): Promise<AudioDevice[]> {
  try {
    return await unwrapCommandResult(query());
  } catch (error) {
    console.error(`Failed to load ${label}:`, error);
    return [SYSTEM_DEFAULT_DEVICE];
  }
}

export function createDeviceActions({
  setState: set,
}: SettingsActionContext): Pick<
  SettingsStore,
  | "refreshAudioDevices"
  | "refreshOutputDevices"
  | "playTestSound"
  | "checkCustomSounds"
> {
  return {
    refreshAudioDevices: async () => {
      set({
        audioDevices: await loadDevices(
          commands.getAvailableMicrophones,
          "audio devices",
        ),
      });
    },
    refreshOutputDevices: async () => {
      set({
        outputDevices: await loadDevices(
          commands.getAvailableOutputDevices,
          "output devices",
        ),
      });
    },
    playTestSound: async (soundType) => {
      try {
        await commands.playTestSound(soundType);
      } catch (error) {
        console.error("Failed to play test sound:", { soundType, error });
      }
    },
    checkCustomSounds: async () => {
      try {
        set({ customSounds: await commands.checkCustomSounds() });
      } catch (error) {
        console.error("Failed to check custom sounds:", error);
      }
    },
  };
}
