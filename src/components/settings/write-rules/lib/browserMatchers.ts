const SUPPORTED_BROWSER_BUNDLE_IDS = new Set(
  [
    "com.apple.Safari",
    "com.google.Chrome",
    "company.thebrowser.Browser",
    "org.mozilla.firefox",
    "com.brave.Browser",
    "com.microsoft.edgemac",
  ].map((bundleId) => bundleId.toLowerCase()),
);

export const isSupportedBrowserBundleId = (bundleId: string): boolean =>
  SUPPORTED_BROWSER_BUNDLE_IDS.has(bundleId.trim().toLowerCase());

export const hasNonBrowserAppMatcher = (bundleIds: string[]): boolean =>
  bundleIds.some((bundleId) => !isSupportedBrowserBundleId(bundleId));
