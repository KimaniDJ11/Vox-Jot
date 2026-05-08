import type { TFunction } from "i18next";

import type {
  FileAsrEvaluationResult,
  FileAsrEvaluationStatus,
} from "@/lib/fileAsrEvaluationResults";
import type {
  LlmEvaluationResult,
  LlmEvaluationStatus,
} from "@/lib/llmEvaluationResults";
import type {
  SttEvaluationResult,
  SttEvaluationStatus,
} from "@/lib/sttEvaluationResults";
import type {
  SpeakerIsolationEvaluationResult,
  SpeakerIsolationEvaluationStatus,
} from "@/lib/speakerIsolationEvaluationResults";
import type {
  ScreenOcrEvaluationResult,
  ScreenOcrEvaluationStatus,
} from "@/lib/screenOcrEvaluationResults";
import type {
  TtsEvaluationResult,
  TtsEvaluationStatus,
} from "@/lib/ttsEvaluationResults";
import type {
  TtsStyleEvaluationResult,
  TtsStyleEvaluationStatus,
} from "@/lib/ttsStyleEvaluationResults";
import type {
  TtsVoiceCloneEvaluationResult,
  TtsVoiceCloneEvaluationStatus,
} from "@/lib/ttsVoiceCloneEvaluationResults";
import type { LeaderboardRowProps } from "@/components/app-sections/testing/LeaderboardRow";

type EvaluationStatus =
  | FileAsrEvaluationStatus
  | LlmEvaluationStatus
  | SttEvaluationStatus
  | SpeakerIsolationEvaluationStatus
  | ScreenOcrEvaluationStatus
  | TtsEvaluationStatus
  | TtsStyleEvaluationStatus
  | TtsVoiceCloneEvaluationStatus;

export function orderByRank<T extends { rank?: number; label: string }>(
  results: T[],
): T[] {
  return [...results].sort((a, b) => {
    const ar = a.rank ?? Number.MAX_SAFE_INTEGER;
    const br = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return a.label.localeCompare(b.label);
  });
}

export function statusLabel(status: EvaluationStatus, t: TFunction): string {
  const defaults: Record<EvaluationStatus, string> = {
    tested: "tested",
    pending: "pending",
    blocked: "blocked",
    download_required: "download required",
    failed: "failed",
    not_applicable: "off",
    runtime_ready: "runtime ready",
  };

  return t(`testing.status.${status}`, {
    defaultValue: defaults[status],
  });
}

export function formatPercent(value?: number): string {
  if (value === undefined) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMs(value?: number): string {
  if (value === undefined) return "n/a";
  return `${value} ms`;
}

export function formatNumber(value?: number): string {
  if (value === undefined) return "n/a";
  return value.toFixed(2);
}

function categoryFooter(
  strongestCategory: string | undefined,
  weakestCategory: string | undefined,
  t: TFunction,
): string | undefined {
  const segments: string[] = [];

  if (strongestCategory) {
    segments.push(
      `${t("testing.categories.strongest", {
        defaultValue: "Strongest",
      })}: ${strongestCategory}`,
    );
  }

  if (weakestCategory) {
    segments.push(
      `${t("testing.categories.weakest", {
        defaultValue: "Weakest",
      })}: ${weakestCategory}`,
    );
  }

  return segments.length > 0 ? segments.join(" · ") : undefined;
}

export function buildFileAsrRow(
  result: FileAsrEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.wer", { defaultValue: "WER" }),
              value: formatPercent(result.averageWer),
            },
            {
              label: t("testing.metrics.latency", {
                defaultValue: "Latency",
              }),
              value: formatMs(result.latencyMs),
            },
            {
              label: t("testing.metrics.rtf", { defaultValue: "RTF" }),
              value: formatNumber(result.realTimeFactor),
            },
            {
              label: t("testing.metrics.device", {
                defaultValue: "Device",
              }),
              value: result.device ?? "n/a",
            },
          ]
        : [],
  };
}

export function buildLlmRow(
  result: LlmEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.pass", { defaultValue: "Pass" }),
              value:
                result.passed !== undefined && result.totalCases !== undefined
                  ? `${result.passed}/${result.totalCases}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.similarity", {
                defaultValue: "Similarity",
              }),
              value: formatPercent(result.averageSimilarity),
            },
            {
              label: t("testing.metrics.p50", { defaultValue: "p50" }),
              value: formatMs(result.latencyP50Ms),
            },
            {
              label: t("testing.metrics.fallback", {
                defaultValue: "Fallback",
              }),
              value:
                result.blockedCandidates !== undefined &&
                result.driftFallbacks !== undefined &&
                result.totalCases !== undefined
                  ? `${result.blockedCandidates + result.driftFallbacks}/${result.totalCases}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.promptProfile", {
                defaultValue: "Profile",
              }),
              value: result.promptProfile ?? "n/a",
            },
          ]
        : [],
    footer: categoryFooter(result.strongestCategory, result.weakestCategory, t),
  };
}

export function buildSttRow(
  result: SttEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.wer", { defaultValue: "WER" }),
              value: formatPercent(result.averageWer),
            },
            {
              label: t("testing.metrics.match", { defaultValue: "Match" }),
              value:
                result.normalizedMatches !== undefined &&
                result.totalCases !== undefined
                  ? `${result.normalizedMatches}/${result.totalCases}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.p50", { defaultValue: "p50" }),
              value: formatMs(result.latencyP50Ms),
            },
            {
              label: t("testing.metrics.rtf", { defaultValue: "RTF" }),
              value: formatNumber(result.realTimeFactorP50),
            },
          ]
        : [],
    footer: categoryFooter(result.strongestCategory, result.weakestCategory, t),
  };
}

export function buildSpeakerIsolationRow(
  result: SpeakerIsolationEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.der", { defaultValue: "DER" }),
              value: formatPercent(result.diarizationErrorRate),
            },
            {
              label: t("testing.metrics.speakers", {
                defaultValue: "Speakers",
              }),
              value:
                result.detectedSpeakers !== undefined &&
                result.expectedSpeakers !== undefined
                  ? `${result.detectedSpeakers}/${result.expectedSpeakers}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.turns", { defaultValue: "Turns" }),
              value:
                result.detectedTurns !== undefined &&
                result.expectedTurns !== undefined
                  ? `${result.detectedTurns}/${result.expectedTurns}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.latency", {
                defaultValue: "Latency",
              }),
              value: formatMs(result.latencyMs),
            },
          ]
        : [],
    footer:
      result.status === "tested"
        ? `${t("testing.metrics.coverage", {
            defaultValue: "Coverage",
          })}: ${formatPercent(result.coverage)} · ${t(
            "testing.metrics.confusion",
            { defaultValue: "Confusion" },
          )}: ${formatPercent(result.confusionRate)} · ${t(
            "testing.metrics.device",
            { defaultValue: "Device" },
          )}: ${result.device ?? "n/a"}`
        : undefined,
  };
}

export function buildScreenOcrRow(
  result: ScreenOcrEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.score", { defaultValue: "Score" }),
              value:
                result.score !== undefined ? result.score.toFixed(1) : "n/a",
            },
            {
              label: t("testing.metrics.pass", { defaultValue: "Pass" }),
              value:
                result.passedCases !== undefined &&
                result.totalCases !== undefined
                  ? `${result.passedCases}/${result.totalCases}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.phrases", {
                defaultValue: "Phrases",
              }),
              value:
                result.matchedPhrases !== undefined &&
                result.totalPhrases !== undefined
                  ? `${result.matchedPhrases}/${result.totalPhrases}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.latency", {
                defaultValue: "Latency",
              }),
              value: formatMs(result.averageLatencyMs),
            },
            {
              label: t("testing.metrics.confidence", {
                defaultValue: "Confidence",
              }),
              value: formatPercent(result.averageConfidence),
            },
          ]
        : [],
    footer: categoryFooter(result.strongestCategory, result.weakestCategory, t),
  };
}

export function buildTtsRow(
  result: TtsEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.score", { defaultValue: "Score" }),
              value:
                result.score !== undefined ? result.score.toFixed(1) : "n/a",
            },
            {
              label: t("testing.metrics.pass", { defaultValue: "Pass" }),
              value:
                result.passedCases !== undefined &&
                result.sampleCount !== undefined
                  ? `${result.passedCases}/${result.sampleCount}`
                  : "n/a",
            },
            {
              label: t("testing.metrics.asrWer", { defaultValue: "ASR WER" }),
              value: formatPercent(result.asrAverageWer),
            },
            {
              label: t("testing.metrics.p50", { defaultValue: "p50" }),
              value: formatMs(result.latencyP50Ms),
            },
            {
              label: t("testing.metrics.rtf", { defaultValue: "RTF" }),
              value: formatNumber(result.realTimeFactorP50),
            },
          ]
        : [
            {
              label: t("testing.metrics.pass", { defaultValue: "Pass" }),
              value:
                result.passedCases !== undefined &&
                result.sampleCount !== undefined
                  ? `${result.passedCases}/${result.sampleCount}`
                  : "n/a",
            },
          ],
  };
}

function styleCapabilityLabel(
  capability: TtsStyleEvaluationResult["styleCapability"],
): string {
  if (capability === "instruction_prompt") {
    return "Prompt";
  }
  if (capability === "expressiveness_controls") {
    return "Controls";
  }
  if (capability === "text_only") {
    return "Text only";
  }
  return "n/a";
}

export function buildTtsStyleRow(
  result: TtsStyleEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.score", { defaultValue: "Score" }),
              value:
                result.score !== undefined ? result.score.toFixed(1) : "n/a",
            },
            {
              label: t("testing.metrics.style", { defaultValue: "Style" }),
              value: formatPercent(result.styleProxy),
            },
            {
              label: t("testing.metrics.asrWer", { defaultValue: "ASR WER" }),
              value: formatPercent(result.asrAverageWer),
            },
            {
              label: t("testing.metrics.p50", { defaultValue: "p50" }),
              value: formatMs(result.latencyP50Ms),
            },
            {
              label: t("testing.metrics.control", { defaultValue: "Control" }),
              value: styleCapabilityLabel(result.styleCapability),
            },
          ]
        : [],
    footer:
      result.status === "tested"
        ? `${t("testing.metrics.pass", { defaultValue: "Pass" })}: ${
            result.passedCases !== undefined && result.sampleCount !== undefined
              ? `${result.passedCases}/${result.sampleCount}`
              : "n/a"
          } · ${t("testing.metrics.rtf", { defaultValue: "RTF" })}: ${formatNumber(
            result.realTimeFactorP50,
          )} · ${t("testing.metrics.listenerPreference", {
            defaultValue: "Listener preference",
          })}: ${formatPercent(result.listenerPreference)}`
        : undefined,
  };
}

export function buildTtsVoiceCloneRow(
  result: TtsVoiceCloneEvaluationResult,
  t: TFunction,
): LeaderboardRowProps {
  return {
    rank: result.rank,
    label: result.label,
    status: result.status,
    statusLabel: statusLabel(result.status, t),
    notes: result.notes,
    metrics:
      result.status === "tested"
        ? [
            {
              label: t("testing.metrics.score", { defaultValue: "Score" }),
              value:
                result.score !== undefined ? result.score.toFixed(1) : "n/a",
            },
            {
              label: t("testing.metrics.clone", { defaultValue: "Clone" }),
              value: formatPercent(result.cloneSimilarity),
            },
            {
              label: t("testing.metrics.asrWer", { defaultValue: "ASR WER" }),
              value: formatPercent(result.asrAverageWer),
            },
            {
              label: t("testing.metrics.p50", { defaultValue: "p50" }),
              value: formatMs(result.latencyP50Ms),
            },
            {
              label: t("testing.metrics.rtf", { defaultValue: "RTF" }),
              value: formatNumber(result.realTimeFactorP50),
            },
          ]
        : [],
    footer:
      result.status === "tested"
        ? `${t("testing.metrics.pass", { defaultValue: "Pass" })}: ${
            result.passedCases !== undefined && result.sampleCount !== undefined
              ? `${result.passedCases}/${result.sampleCount}`
              : "n/a"
          } · ${t("testing.metrics.listenerPreference", {
            defaultValue: "Listener preference",
          })}: ${formatPercent(result.listenerPreference)}`
        : undefined,
  };
}
