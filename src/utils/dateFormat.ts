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
export const formatTime = (timestamp: string, locale: string): string => {
  try {
    const timestampMs = parseInt(timestamp, 10) * 1000;
    const date = new Date(timestampMs);

    if (isNaN(date.getTime())) {
      return timestamp;
    }

    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (error) {
    console.error("Failed to format time:", error);
    return timestamp;
  }
};
