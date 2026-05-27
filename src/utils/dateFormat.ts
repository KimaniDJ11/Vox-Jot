/**
 * Format a date string or timestamp to a localized date string (no time)
 * @param timestamp - Unix timestamp in seconds (as string)
 * @param locale - BCP 47 language tag (e.g., 'en', 'es', 'fr')
 * @returns Formatted date string
 */
export const formatDate = (timestamp: string, locale: string): string => {
  try {
    // Convert Unix timestamp (seconds) to milliseconds
    const timestampMs = parseInt(timestamp, 10) * 1000;
    const date = new Date(timestampMs);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return timestamp; // Return original if invalid
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
    const timestampMs = parseInt(timestamp, 10) * 1000;
    const date = new Date(timestampMs);

    if (isNaN(date.getTime())) {
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
