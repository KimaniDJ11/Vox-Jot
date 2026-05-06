// Footer hint that shows whether the in-progress profile would fire on
// the user's current frontmost app. This was the single most-asked
// question while iterating on the old editor — "did I configure the
// matchers correctly?" — and a static "Test against current app"
// button only answered it on demand. By polling the frontmost app on a
// slow timer we make the answer always-visible without thrashing the
// system.

import React, { useEffect, useState } from "react";
import { CheckCircle2, Globe, XCircle } from "lucide-react";
import type { WriteRuleMatchers } from "@/bindings";
import { commands } from "@/bindings";
import { evaluateDraftMatch, type DraftMatchInput } from "../lib/draftMatch";

interface LiveMatchHintProps {
  matchers: WriteRuleMatchers;
}

const POLL_INTERVAL_MS = 4000;
const fallbackAppName = "this app";
const matchesEverythingText = "Will run in any app — add a filter to scope it.";
const noFrontmostText = "Bring an app forward to preview the match.";
const matchesText = (appName: string | null) =>
  `Will run in ${appName ?? fallbackAppName} right now.`;
const noMatchText = (appName: string | null) =>
  `Won't run in ${appName ?? fallbackAppName} — adjust the apps or URLs to include it.`;

export const LiveMatchHint: React.FC<LiveMatchHintProps> = ({ matchers }) => {
  const [input, setInput] = useState<DraftMatchInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const appResult = await commands.getFrontmostAppForExclusion();
      if (cancelled) return;
      if (appResult.status !== "ok") {
        setInput({ bundleId: null, appName: null, url: null });
        return;
      }
      const urlResult = await commands.getFrontmostUrlForWriteRules(
        appResult.data.bundle_id,
      );
      if (cancelled) return;
      setInput({
        bundleId: appResult.data.bundle_id,
        appName: appResult.data.localized_name,
        url: urlResult.status === "ok" ? urlResult.data : null,
      });
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!input) return null;

  const result = evaluateDraftMatch(matchers, input);
  switch (result.kind) {
    case "matchesEverything":
      return (
        <Hint icon={<Globe className="h-3.5 w-3.5" aria-hidden />} tone="muted">
          {matchesEverythingText}
        </Hint>
      );
    case "noFrontmost":
      return (
        <Hint icon={<Globe className="h-3.5 w-3.5" aria-hidden />} tone="muted">
          {noFrontmostText}
        </Hint>
      );
    case "matches":
      return (
        <Hint
          icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
          tone="success"
        >
          {matchesText(result.appName)}
        </Hint>
      );
    case "noMatch":
      return (
        <Hint
          icon={<XCircle className="h-3.5 w-3.5" aria-hidden />}
          tone="muted"
        >
          {noMatchText(result.appName)}
        </Hint>
      );
  }
};

const Hint: React.FC<{
  icon: React.ReactNode;
  tone: "muted" | "success";
  children: React.ReactNode;
}> = ({ icon, tone, children }) => (
  <div
    className={[
      "inline-flex items-center gap-1.5 text-xs",
      tone === "success" ? "text-[var(--accent)]" : "text-[var(--muted)]",
    ].join(" ")}
  >
    {icon}
    <span>{children}</span>
  </div>
);
