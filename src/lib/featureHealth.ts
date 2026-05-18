export type FeatureHealthStatus = "ok" | "warning" | "error";
export type FeatureHealthOverallStatus = "healthy" | "warning" | "error";

export interface FeatureHealthCheck {
  id: string;
  label: string;
  status: FeatureHealthStatus;
  detail: string;
  error?: string;
  elapsedMs: number;
}

export interface FeatureHealthSummary {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  overall: FeatureHealthOverallStatus;
}

export function summarizeFeatureHealth(
  checks: FeatureHealthCheck[],
): FeatureHealthSummary {
  const ok = checks.filter((check) => check.status === "ok").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const errors = checks.filter((check) => check.status === "error").length;
  return {
    total: checks.length,
    ok,
    warnings,
    errors,
    overall: errors > 0 ? "error" : warnings > 0 ? "warning" : "healthy",
  };
}

export function formatFeatureHealthReport(
  checks: FeatureHealthCheck[],
  generatedAt = new Date(),
): string {
  const summary = summarizeFeatureHealth(checks);
  const lines = [
    `Vox Jot feature health report`,
    `Generated: ${generatedAt.toISOString()}`,
    `Overall: ${summary.overall}`,
    `Summary: ${summary.ok} ok, ${summary.warnings} warning, ${summary.errors} error`,
    "",
  ];

  for (const check of checks) {
    lines.push(
      `[${check.status.toUpperCase()}] ${check.label} (${check.elapsedMs} ms)`,
      `  ${check.detail}`,
    );
    if (check.error) {
      lines.push(`  Error: ${check.error}`);
    }
  }

  return lines.join("\n");
}
