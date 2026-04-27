import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type ResolvedWriteRule } from "@/bindings";
import { Button } from "@/components/ui/Button";

export const TestRuleButton: React.FC = () => {
  const { t } = useTranslation();
  const [result, setResult] = useState<ResolvedWriteRule | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setMessage(null);
    setResult(null);
    try {
      const appResult = await commands.getFrontmostAppForExclusion();
      const appContext = appResult.status === "ok" ? appResult.data : null;
      const urlResult = await commands.getFrontmostUrlForWriteRules(
        appContext?.bundle_id ?? null,
      );
      const resolved = await commands.testResolveWriteRule(
        appContext?.bundle_id ?? null,
        appContext?.localized_name ?? null,
        urlResult.status === "ok" ? urlResult.data : null,
      );
      if (resolved.status === "ok" && resolved.data) {
        setResult(resolved.data);
      } else {
        setMessage(t("refine.writeRules.test.noMatch"));
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={runTest}
        disabled={testing}
      >
        {t("refine.writeRules.test.button")}
      </Button>
      {result ? (
        <span className="text-sm font-medium text-[var(--accent)]">
          {t("refine.writeRules.test.result", { rule: result.rule_name })}
        </span>
      ) : message ? (
        <span className="text-sm text-[var(--muted)]">{message}</span>
      ) : null}
    </div>
  );
};
