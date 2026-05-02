import { useEffect } from "react";

const MIN_FONT_SCALE = 0.9;
const MAX_FONT_SCALE = 1.3;

function clampFontScale(value: unknown) {
  const scale = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, scale));
}

export function useApplyAppearanceSettings(
  appTheme: string | null | undefined,
  appFontScale: number | null | undefined,
) {
  useEffect(() => {
    const theme = appTheme ?? "system";
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [appTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-font-scale",
      String(clampFontScale(appFontScale)),
    );
  }, [appFontScale]);
}
