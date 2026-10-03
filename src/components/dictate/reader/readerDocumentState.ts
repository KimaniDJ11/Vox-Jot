const readerDocumentStateStorageKey = "voxjot:reader-document-state:v1";

const readerLastDocumentVoiceStorageKey =
  "voxjot:reader-last-document-voice:v1";

type ReaderDocumentProgress = {
  sectionIndex: number;
  unitIndex: number;
  positionMs?: number;
  updatedAt: number;
};

type ReaderDocumentState = {
  sectionVoices?: Record<number, string | null>;
  sectionDisabled?: Record<number, boolean>;
  selectedPresetId?: string | null;
  playbackRate?: number;
  /** Per-document narration/alignment language; "auto" or undefined = detect. */
  language?: string;
  progress?: ReaderDocumentProgress;
  updatedAt?: number;
};

export function loadReaderLastDocumentVoice(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(
      readerLastDocumentVoiceStorageKey,
    );
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function saveReaderLastDocumentVoice(presetId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (presetId && presetId.trim()) {
      window.localStorage.setItem(readerLastDocumentVoiceStorageKey, presetId);
    } else {
      window.localStorage.removeItem(readerLastDocumentVoiceStorageKey);
    }
  } catch {
    // Ignore local preference failures; document state still persists.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function loadAllReaderDocumentStates(): Record<string, ReaderDocumentState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(readerDocumentStateStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return parsed as Record<string, ReaderDocumentState>;
  } catch {
    return {};
  }
}

export function loadReaderDocumentState(
  documentId: string,
): ReaderDocumentState {
  return loadAllReaderDocumentStates()[documentId] ?? {};
}

export function saveReaderDocumentState(
  documentId: string,
  patch: Partial<ReaderDocumentState>,
) {
  if (typeof window === "undefined" || !documentId) return;
  try {
    const states = loadAllReaderDocumentStates();
    states[documentId] = {
      ...(states[documentId] ?? {}),
      ...patch,
      updatedAt: Date.now(),
    };
    const entries = Object.entries(states)
      .sort(
        ([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
      )
      .slice(0, 96);
    window.localStorage.setItem(
      readerDocumentStateStorageKey,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Ignore local persistence failures; the Reader remains usable.
  }
}
