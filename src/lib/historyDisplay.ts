import type {
  HistoryEntry,
  SpeakerAnalysisStatus,
  SpeakerLabeledSegment,
} from "@/bindings";

const MEANINGFUL_CHAR = /[\p{L}\p{N}]/u;

/** Prefer backend display_title; never return blank/`...` for row identity. */
export function resolveHistoryDisplayTitle(entry: HistoryEntry): string {
  const fromBackend = entry.display_title?.trim();
  if (
    fromBackend &&
    fromBackend !== "..." &&
    MEANINGFUL_CHAR.test(fromBackend)
  ) {
    return fromBackend;
  }

  const candidates = [
    entry.pasted_text,
    entry.post_processed_text,
    entry.transcription_text,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? "";
    if (!trimmed || trimmed === "..." || !MEANINGFUL_CHAR.test(trimmed)) {
      continue;
    }
    const sentence = trimmed.split(/(?<=[.!?])\s+/)[0]?.trim() || trimmed;
    if (sentence.length <= 72) return sentence;
    const sliced = sentence.slice(0, 72);
    const lastSpace = sliced.lastIndexOf(" ");
    return `${(lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trimEnd()}…`;
  }

  if (entry.title?.trim()) {
    return entry.title.trim();
  }

  return "Recording";
}

export function resolveHistorySnippet(entry: HistoryEntry): string {
  const text = resolveHistoryTranscriptText(entry);
  if (!text || text === "...") return "";
  if (text.length <= 140) return text;
  return `${text.slice(0, 140).trimEnd()}…`;
}

/** True when the snippet adds no meaningful context beyond the display title. */
export function isSnippetRedundant(title: string, snippet: string): boolean {
  if (!title || !snippet) return true;
  if (title === snippet) return true;

  // Strip trailing punctuation and ellipsis for a "core content" comparison
  const normalize = (s: string) =>
    s.replace(/[\s.!?,;:…]+$/u, "").toLowerCase();

  const normTitle = normalize(title);
  const normSnippet = normalize(snippet);
  if (!normTitle || !normSnippet) return true;

  // One is a prefix of the other → the snippet is just a longer/shorter
  // version of the title and visually redundant.
  return normSnippet.startsWith(normTitle) || normTitle.startsWith(normSnippet);
}

/** Return the complete user-visible transcript text, without display truncation. */
export function resolveHistoryTranscriptText(entry: HistoryEntry): string {
  return (
    entry.pasted_text?.trim() ||
    entry.post_processed_text?.trim() ||
    entry.transcription_text.trim() ||
    ""
  );
}

export function formatHistoryDuration(
  durationMs: number | null | undefined,
): string | null {
  if (durationMs == null || durationMs <= 0) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function shouldShowHistorySpeakerBadge(entry: HistoryEntry): boolean {
  return (
    entry.speaker_status === "complete" &&
    (entry.speaker_count ?? 0) >= 2 &&
    entry.speaker_labels_visible !== false
  );
}

export function parseSpeakerDisplayNames(
  json: string | null | undefined,
): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function parseSpeakerIdsFromSegments(
  json: string | null | undefined,
): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as Partial<SpeakerLabeledSegment>[];
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    for (const segment of parsed) {
      if (!segment || typeof segment !== "object") continue;
      const id = segment.speaker_id?.trim();
      if (id) ids.add(id);
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

/** Keep saved names and every currently detected speaker available for renaming. */
export function resolveHistorySpeakerIds(
  displayNamesJson: string | null | undefined,
  segmentsJson: string | null | undefined,
  speakerCount: number | null | undefined,
): string[] {
  const ids = new Set<string>([
    ...Object.keys(parseSpeakerDisplayNames(displayNamesJson)),
    ...parseSpeakerIdsFromSegments(segmentsJson),
  ]);

  for (let index = 0; index < Math.max(0, speakerCount ?? 0); index += 1) {
    if (ids.size >= (speakerCount ?? 0)) break;
    ids.add(`SPEAKER_${String(index).padStart(2, "0")}`);
  }

  return Array.from(ids);
}

/** Default label for a raw diarization speaker id (SPEAKER_00 / "0" → Speaker 1). */
export function humanizeSpeakerId(speakerId: string): string {
  const trimmed = speakerId.trim();
  if (!trimmed) return "Speaker";

  const upper = trimmed.toUpperCase();
  const speakerPrefix = upper.match(/^SPEAKER[_-]?(\d+)$/);
  if (speakerPrefix) {
    const index = Number.parseInt(speakerPrefix[1] ?? "", 10);
    if (Number.isFinite(index) && index >= 0) {
      return `Speaker ${index + 1}`;
    }
  }

  if (/^\d+$/.test(trimmed)) {
    const index = Number.parseInt(trimmed, 10);
    if (Number.isFinite(index) && index >= 0) {
      return `Speaker ${index + 1}`;
    }
  }

  return trimmed;
}

export function resolveSpeakerDisplayLabel(
  speakerId: string,
  displayNames: Record<string, string>,
): string {
  const custom = displayNames[speakerId]?.trim();
  if (custom) return custom;
  return humanizeSpeakerId(speakerId);
}

export type SpeakerTranscriptTurn = {
  speakerId: string;
  label: string;
  text: string;
};

/** Merge consecutive same-speaker segments into labeled turns for the transcript UI. */
export function buildSpeakerTranscriptTurns(
  segmentsJson: string | null | undefined,
  displayNamesJson: string | null | undefined,
): SpeakerTranscriptTurn[] {
  if (!segmentsJson) return [];
  try {
    const parsed = JSON.parse(segmentsJson) as Partial<SpeakerLabeledSegment>[];
    if (!Array.isArray(parsed)) return [];
    const displayNames = parseSpeakerDisplayNames(displayNamesJson);
    const turns: SpeakerTranscriptTurn[] = [];

    for (const segment of parsed) {
      if (!segment || typeof segment !== "object") continue;
      const speakerId = segment.speaker_id?.trim() ?? "";
      const text = segment.text?.trim() ?? "";
      if (!speakerId || !text) continue;

      const last = turns[turns.length - 1];
      if (last && last.speakerId === speakerId) {
        last.text = `${last.text} ${text}`;
        continue;
      }

      turns.push({
        speakerId,
        label: resolveSpeakerDisplayLabel(speakerId, displayNames),
        text,
      });
    }

    return turns;
  } catch {
    return [];
  }
}

export type HistoryDetailMode = "transcript" | "speakers" | "summary";

export function speakerStatusMessageKey(status: SpeakerAnalysisStatus): string {
  switch (status) {
    case "running":
      return "settings.history.speakers.status.running";
    case "complete":
      return "settings.history.speakers.status.complete";
    case "failed":
      return "settings.history.speakers.status.failed";
    default:
      return "settings.history.speakers.status.notAnalyzed";
  }
}
