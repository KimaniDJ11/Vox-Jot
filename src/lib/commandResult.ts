export type CommandResult<T> =
  { status: "ok"; data: T } | { status: "error"; error: string };

/** Translate the generated native result into the application's async error contract. */
export async function unwrapCommandResult<T>(
  promise: Promise<CommandResult<T>>,
): Promise<T> {
  const result = await promise;
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}
