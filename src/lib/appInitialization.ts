import { commands } from "@/bindings";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function initializeInputServices(
  onWarning: (message: string) => void = console.warn,
): Promise<void> {
  const results = await Promise.allSettled([
    commands.initializeEnigo(),
    commands.initializeShortcuts(),
  ]);

  const [enigoResult, shortcutsResult] = results;

  if (enigoResult.status === "rejected") {
    onWarning(`Failed to initialize Enigo: ${formatError(enigoResult.reason)}`);
  } else if (enigoResult.value.status === "error") {
    onWarning(`Failed to initialize Enigo: ${formatError(enigoResult.value.error)}`);
  }

  if (shortcutsResult.status === "rejected") {
    onWarning(
      `Failed to initialize shortcuts: ${formatError(shortcutsResult.reason)}`,
    );
  } else if (shortcutsResult.value.status === "error") {
    onWarning(
      `Failed to initialize shortcuts: ${formatError(shortcutsResult.value.error)}`,
    );
  }
}
