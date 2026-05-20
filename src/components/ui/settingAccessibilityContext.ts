import { createContext, useContext } from "react";

interface SettingAccessibilityContextValue {
  label?: string;
}

const SettingAccessibilityContext =
  createContext<SettingAccessibilityContextValue>({});

export const SettingAccessibilityProvider =
  SettingAccessibilityContext.Provider;

export function useSettingAccessibilityContext() {
  return useContext(SettingAccessibilityContext);
}
