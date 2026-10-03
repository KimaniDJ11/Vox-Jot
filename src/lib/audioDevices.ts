import type { AudioDevice } from "@/bindings";

/** Device lists begin with this synthetic entry for the system default device. */
const SYSTEM_DEFAULT_DEVICE_INDEX = "default";

/** A device setting stores no name while the system default device is chosen. */
export function deviceSettingForName(
  devices: AudioDevice[],
  name: string,
): string | null {
  const device = devices.find((candidate) => candidate.name === name);
  return !device || device.index === SYSTEM_DEFAULT_DEVICE_INDEX
    ? null
    : device.name;
}

/** The device name to show as selected for a stored device setting. */
export function deviceNameForSetting(
  devices: AudioDevice[],
  setting: string | null | undefined,
): string {
  if (setting) return setting;
  return (
    devices.find((device) => device.index === SYSTEM_DEFAULT_DEVICE_INDEX)
      ?.name ?? ""
  );
}
