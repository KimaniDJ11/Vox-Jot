/**
 * Trigger a browser download of in-memory JSON text with the given filename.
 */
export function downloadJsonFile(filename: string, data: string): void {
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface PickJsonFileOptions {
  /** Reject files larger than this many bytes before reading. */
  maxBytes?: number;
}

/**
 * Prompt the user to select a .json file from disk and resolve with its text
 * contents. Resolves `null` if the user cancels or the file fails the size/
 * read checks.
 */
export function pickJsonFileText(
  options: PickJsonFileOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (options.maxBytes && file.size > options.maxBytes) {
        console.error(
          `Import file too large (${file.size} bytes, max ${options.maxBytes})`,
        );
        resolve(null);
        return;
      }
      try {
        resolve(await file.text());
      } catch (error) {
        console.error("Failed to read file:", error);
        resolve(null);
      }
    };
    input.click();
  });
}
