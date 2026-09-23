/**
 * Format a date string or timestamp to a localized date string (no time)
 * @param timestamp - Unix timestamp in seconds (as string)
 * @param locale - BCP 47 language tag (e.g., 'en', 'es', 'fr')
 * @returns Formatted date string
 */
const parseUnixTimestamp = (timestamp: string): Date | null => {
  const trimmed = timestamp.trim();
  if (trimmed === "") {
    return null;
  }

  // History timestamps originate as signed integer Unix seconds. Reject
  // alternate JavaScript numeric syntax (for example 1e3, 0x10, or 1.5),
  // which is not part of that persisted/API contract.
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }

  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds)) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDate = (timestamp: string, locale: string): string => {
  try {
    const date = parseUnixTimestamp(timestamp);
    if (!date) {
      return timestamp;
    }

    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  } catch (error) {
    console.error("Failed to format date:", error);
    return timestamp; // Fallback to original timestamp
  }
};

/**
 * Format a date string or timestamp to a localized time string (no date)
 * @param timestamp - Unix timestamp in seconds (as string)
 * @param locale - BCP 47 language tag (e.g., 'en', 'es', 'fr')
 * @returns Formatted time string
 */
const getSystemHour12Preference = (): boolean | undefined => {
  try {
    const options = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
    }).resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & {
      hourCycle?: string;
    };

    if (typeof options.hour12 === "boolean") {
      return options.hour12;
    }

    return options.hourCycle === "h11" || options.hourCycle === "h12";
  } catch {
    return undefined;
  }
};

export const formatTime = (
  timestamp: string,
  locale?: string | string[],
): string => {
  try {
    const date = parseUnixTimestamp(timestamp);
    if (!date) {
      return timestamp;
    }

    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: getSystemHour12Preference(),
    }).format(date);
  } catch (error) {
    console.error("Failed to format time:", error);
    return timestamp;
  }
};
