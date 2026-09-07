/** Mirrors the backend's loopback-only provider privacy check. */
export function isLocalBaseUrl(baseUrl: string | null | undefined): boolean {
  try {
    const url = new URL(baseUrl?.trim() ?? "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return false;
    }
    return (
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
