import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { ConvoShell } from "./ConvoShell";
import { SelectionContextCard } from "./SelectionContextCard";
import { JotpadContextCard } from "./JotpadContextCard";
import { FilesContextCard } from "./FilesContextCard";
import { Button } from "@/components/ui/Button";
import {
  commands,
  type ConvoActionSuggestion,
  type ConvoTurnResponse,
  type Note,
} from "@/bindings";

const ACTIVE_NOTE_KEY = "scratchpad_active_note_id";

interface ConvoTranscriptItem {
  id: string;
  role: string;
  text: string;
  timestamp_ms: number;
  has_audio: boolean;
  suggested_actions?: ConvoActionSuggestion[];
}

interface ConvoModeViewProps {
  mode: "selection" | "jotpad" | "settings_coach" | "files_context";
}

function getPersistedActiveNoteId(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVE_NOTE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export const ConvoModeView: React.FC<ConvoModeViewProps> = ({ mode }) => {
  const { t } = useTranslation();
  const [transcript, setTranscript] = useState<ConvoTranscriptItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(
    null,
  );
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<Note | null>(null);

  const activeNoteId = activeNote?.id ?? null;
  const noteContent = activeNote?.content ?? null;

  const emptyStateKeys: Record<ConvoModeViewProps["mode"], string> = {
    selection: "convo.selection.emptyState",
    jotpad: "convo.jotpad.emptyState",
    settings_coach: "convo.settingsCoach.emptyState",
    files_context: "convo.filesContext.emptyState",
  };

  const getModeContext = useCallback(() => {
    switch (mode) {
      case "selection":
        return selectionText;
      case "jotpad":
        return noteContent;
      default:
        return null;
    }
  }, [mode, noteContent, selectionText]);

  const handleRefreshSelection = useCallback(async () => {
    try {
      const selectionResult = await commands.convoCaptureSelection();
      if (selectionResult.status !== "ok") {
        throw new Error(selectionResult.error);
      }

      let nextText = selectionResult.data;
      if (!nextText) {
        const clipboardResult = await commands.convoGetClipboardText();
        if (clipboardResult.status === "ok") {
          nextText = clipboardResult.data;
        }
      }

      setSelectionText(nextText);
    } catch {
      toast.error(t("convo.selection.refreshFailed"));
    }
  }, [t]);

  const loadActiveNote = useCallback(async (noteId?: number | null) => {
    const resolvedId = noteId ?? getPersistedActiveNoteId();
    if (resolvedId === null) {
      setActiveNote(null);
      return;
    }

    try {
      const result = await commands.convoGetCurrentNote(resolvedId);
      if (result.status === "ok") {
        setActiveNote(result.data);
      }
    } catch (error) {
      console.error("Failed to load active note:", error);
    }
  }, []);

  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const result = await commands.convoCheckAvailability();
        if (result.status === "ok") {
          setIsAvailable(result.data.available);
          setUnavailableReason(result.data.reason ?? null);
        }
      } catch {
        setIsAvailable(false);
        setUnavailableReason(t("convo.common.unavailable"));
      }
    };

    void checkAvailability();
  }, [t]);

  useEffect(() => {
    if (mode === "selection" && isAvailable) {
      void handleRefreshSelection();
    }
  }, [handleRefreshSelection, isAvailable, mode]);

  useEffect(() => {
    if (mode !== "jotpad") {
      return;
    }

    void loadActiveNote();

    const listeners = [
      listen<number>("scratchpad-select-note", (event) => {
        void loadActiveNote(event.payload);
      }),
      listen("notes-updated", () => {
        void loadActiveNote();
      }),
    ];

    return () => {
      listeners.forEach((listener) => {
        void listener.then((unlisten) => unlisten());
      });
    };
  }, [loadActiveNote, mode]);

  const ensureSession = useCallback(
    async (initialContext?: string | null): Promise<string | null> => {
      if (sessionId) {
        return sessionId;
      }

      try {
        const result = await commands.convoPrepareSession(
          mode,
          null,
          initialContext ?? null,
        );
        if (result.status === "ok") {
          setSessionId(result.data.session_id);
          return result.data.session_id;
        }
      } catch (error) {
        console.error("Failed to prepare convo session:", error);
      }

      return null;
    },
    [mode, sessionId],
  );

  useEffect(() => {
    if (isAvailable && !sessionId) {
      void ensureSession(getModeContext());
    }
  }, [ensureSession, getModeContext, isAvailable, sessionId]);

  const handleSendText = useCallback(
    async (text: string) => {
      const sid = await ensureSession(getModeContext());
      if (!sid) {
        return;
      }

      setTranscript((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          text,
          timestamp_ms: Date.now(),
          has_audio: false,
        },
      ]);
      setIsLoading(true);

      try {
        const result = await commands.convoSendTextTurn(
          sid,
          text,
          getModeContext(),
        );
        if (result.status === "ok") {
          setTranscript((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: result.data.assistant_text,
              timestamp_ms: Date.now(),
              has_audio: Boolean(result.data.audio_base64),
              suggested_actions: result.data.suggested_actions ?? [],
            },
          ]);
        }
      } catch (error) {
        console.error("Failed to send convo text turn:", error);
        toast.error(t("convo.common.sendFailed"));
      } finally {
        setIsLoading(false);
      }
    },
    [ensureSession, getModeContext, t],
  );

  const handleReset = useCallback(async () => {
    if (sessionId) {
      try {
        await commands.convoResetSession(sessionId);
      } catch {
        // Ignore reset failures when we are already replacing the local state.
      }
    }

    setTranscript([]);
    setSessionId(null);
    setSelectionText(null);
  }, [sessionId]);

  const handlePasteSelection = useCallback((text: string) => {
    setSelectionText(text);
  }, []);

  const handleCopyLastReply = useCallback(() => {
    const lastAssistant = [...transcript]
      .reverse()
      .find((item) => item.role === "assistant");
    if (!lastAssistant) {
      return;
    }

    void navigator.clipboard.writeText(lastAssistant.text);
    toast.success(t("convo.selection.copiedReply"));
  }, [t, transcript]);

  const handleReplaceDraft = useCallback(
    async (draftContent: string) => {
      if (!activeNoteId) {
        return;
      }

      try {
        await commands.convoApplyNoteEdit(activeNoteId, "replace", draftContent);
        await loadActiveNote(activeNoteId);
        toast.success(t("convo.jotpad.noteReplaced"));
      } catch {
        toast.error(t("convo.jotpad.noteReplaceFailed"));
      }
    },
    [activeNoteId, loadActiveNote, t],
  );

  const handleAppendDraft = useCallback(
    async (draftContent: string) => {
      if (!activeNoteId) {
        return;
      }

      try {
        await commands.convoApplyNoteEdit(activeNoteId, "append", draftContent);
        await loadActiveNote(activeNoteId);
        toast.success(t("convo.jotpad.noteAppended"));
      } catch {
        toast.error(t("convo.jotpad.noteAppendFailed"));
      }
    },
    [activeNoteId, loadActiveNote, t],
  );

  const handleCopyDraft = useCallback(
    (draftContent: string) => {
      void navigator.clipboard.writeText(draftContent);
      toast.success(t("convo.jotpad.draftCopied"));
    },
    [t],
  );

  const handleOpenSetting = useCallback(
    async (section: string) => {
      try {
        await commands.showDetailView(section);
      } catch {
        toast.error(t("convo.settingsCoach.openFailed"));
      }
    },
    [t],
  );

  const handleAudioTurnResponse = useCallback((response: ConvoTurnResponse) => {
    const timestamp = Date.now();
    setTranscript((prev) => {
      const nextItems: ConvoTranscriptItem[] = [];

      if (response.user_text) {
        nextItems.push({
          id: crypto.randomUUID(),
          role: "user",
          text: response.user_text,
          timestamp_ms: timestamp,
          has_audio: true,
        });
      }

      nextItems.push({
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.assistant_text,
        timestamp_ms: timestamp + 1,
        has_audio: Boolean(response.audio_base64),
        suggested_actions: response.suggested_actions ?? [],
      });

      return [...prev, ...nextItems];
    });
  }, []);

  const contextCard = useMemo(() => {
    switch (mode) {
      case "selection":
        return (
          <SelectionContextCard
            text={selectionText}
            onRefresh={() => void handleRefreshSelection()}
            onPaste={handlePasteSelection}
          />
        );
      case "jotpad":
        return (
          <JotpadContextCard
            noteContent={noteContent}
            noteId={activeNoteId}
          />
        );
      case "files_context":
        return <FilesContextCard sessionId={sessionId} />;
      default:
        return null;
    }
  }, [
    activeNoteId,
    handlePasteSelection,
    handleRefreshSelection,
    mode,
    noteContent,
    selectionText,
    sessionId,
  ]);

  const toolbarActions =
    mode === "selection" && transcript.length > 0 ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopyLastReply}
        className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]"
      >
        <Copy className="h-3.5 w-3.5" />
        {t("convo.selection.copyLastReply")}
      </Button>
    ) : null;

  if (isAvailable === null) {
    return null;
  }

  if (isAvailable === false) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <h3 className="mb-2 text-lg font-semibold text-[var(--text)]">
            {t("convo.common.unavailable")}
          </h3>
          {unavailableReason && (
            <p className="text-sm text-[var(--muted)]">{unavailableReason}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <ConvoShell
      mode={mode}
      contextCard={contextCard}
      transcript={transcript}
      isLoading={isLoading}
      speakReplies={speakReplies}
      onSpeakRepliesChange={(enabled) => {
        setSpeakReplies(enabled);
        if (sessionId) {
          void commands.convoUpdateSpeakReplies(sessionId, enabled);
        }
      }}
      onSendText={handleSendText}
      onReset={handleReset}
      emptyStateMessage={t(emptyStateKeys[mode])}
      actions={toolbarActions}
      activeNoteId={activeNoteId}
      sessionId={sessionId}
      context={getModeContext()}
      onReplaceDraft={handleReplaceDraft}
      onAppendDraft={handleAppendDraft}
      onCopyDraft={handleCopyDraft}
      onOpenSetting={handleOpenSetting}
      onSendAudioTurn={handleAudioTurnResponse}
    />
  );
};
