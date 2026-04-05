import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Mic,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DraftActions } from "./DraftActions";
import { commands, type ConvoTurnResponse } from "@/bindings";

interface ConvoActionSuggestion {
  action_type: string;
  label: string;
  payload: string;
}

interface ConvoTranscriptItem {
  id: string;
  role: string;
  text: string;
  timestamp_ms: number;
  has_audio: boolean;
  suggested_actions?: ConvoActionSuggestion[];
}

interface ConvoShellProps {
  mode: string;
  contextCard?: React.ReactNode;
  transcript: ConvoTranscriptItem[];
  isLoading: boolean;
  speakReplies: boolean;
  onSpeakRepliesChange: (enabled: boolean) => void;
  onSendText: (text: string) => void;
  onSendAudioTurn?: (response: ConvoTurnResponse) => void;
  onReset: () => void;
  emptyStateMessage: string;
  actions?: React.ReactNode;
  activeNoteId?: number | null;
  sessionId?: string | null;
  context?: string | null;
  onReplaceDraft?: (draftContent: string) => void;
  onAppendDraft?: (draftContent: string) => void;
  onCopyDraft?: (draftContent: string) => void;
  onOpenSetting?: (section: string) => void;
}

export const ConvoShell: React.FC<ConvoShellProps> = ({
  contextCard,
  transcript,
  isLoading,
  speakReplies,
  onSpeakRepliesChange,
  onSendText,
  onSendAudioTurn,
  onReset,
  emptyStateMessage,
  actions,
  activeNoteId,
  sessionId,
  context,
  onReplaceDraft,
  onAppendDraft,
  onCopyDraft,
  onOpenSetting,
}) => {
  const { t } = useTranslation();
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isAudioSubmitting, setIsAudioSubmitting] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const helperStartupRef = useRef<Promise<void> | null>(null);

  const isBusy = isLoading || isAudioSubmitting;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || isBusy || isRecording) {
      return;
    }

    onSendText(trimmed);
    setInputText("");
    inputRef.current?.focus();
  }, [inputText, isBusy, isRecording, onSendText]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleStartRecording = useCallback(async () => {
    if (isRecording || isBusy) {
      return;
    }

    if (!sessionId || !onSendAudioTurn) {
      toast.error(t("convo.common.audioTurnFailed"));
      return;
    }

    try {
      const result = await commands.convoStartAudioCapture();
      if (result.status !== "ok") {
        throw new Error(result.error);
      }

      setIsRecording(true);
      helperStartupRef.current = commands
        .convoEnsureHelperRunning()
        .then((ensureResult) => {
          if (ensureResult.status !== "ok") {
            throw new Error(ensureResult.error);
          }
        })
        .catch((error) => {
          console.error("Failed to start PersonaPlex helper:", error);
          toast.error(t("convo.common.helperStartFailed"));
          throw error;
        });
    } catch (error) {
      console.error("Failed to start convo audio capture:", error);
      setIsRecording(false);
      toast.error(t("convo.common.audioCaptureFailed"));
    }
  }, [isBusy, isRecording, onSendAudioTurn, sessionId, t]);

  const handleStopRecording = useCallback(async () => {
    if (!isRecording) {
      return;
    }

    setIsRecording(false);

    if (!sessionId || !onSendAudioTurn) {
      toast.error(t("convo.common.audioTurnFailed"));
      return;
    }

    setIsAudioSubmitting(true);

    try {
      const stopResult = await commands.convoStopAudioCapture();
      if (stopResult.status !== "ok") {
        throw new Error(stopResult.error);
      }

      if (helperStartupRef.current) {
        await helperStartupRef.current;
      }

      const audioTurnResult = await commands.convoSendAudioTurn(
        sessionId,
        stopResult.data,
        context ?? null,
      );
      if (audioTurnResult.status !== "ok") {
        throw new Error(audioTurnResult.error);
      }

      const response = audioTurnResult.data;
      onSendAudioTurn(response);

      if (speakReplies && response.audio_base64) {
        const playResult = await commands.convoPlayAudioReply(response.audio_base64);
        if (playResult.status !== "ok") {
          console.error("Failed to play convo audio reply:", playResult.error);
        }
      }
    } catch (error) {
      console.error("Failed to complete convo audio turn:", error);
      toast.error(t("convo.common.audioTurnFailed"));
    } finally {
      helperStartupRef.current = null;
      setIsAudioSubmitting(false);
    }
  }, [context, isRecording, onSendAudioTurn, sessionId, speakReplies, t]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const handlePointerRelease = () => {
      void handleStopRecording();
    };

    window.addEventListener("pointerup", handlePointerRelease);
    window.addEventListener("pointercancel", handlePointerRelease);

    return () => {
      window.removeEventListener("pointerup", handlePointerRelease);
      window.removeEventListener("pointercancel", handlePointerRelease);
    };
  }, [handleStopRecording, isRecording]);

  useEffect(() => {
    return () => {
      if (isRecording) {
        void commands.convoStopAudioCapture();
      }
    };
  }, [isRecording]);

  return (
    <div className="flex h-full flex-col">
      {contextCard && (
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
          {contextCard}
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSpeakRepliesChange(!speakReplies)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              speakReplies
                ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {speakReplies ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
            {t("convo.common.speakReplies")}
          </button>
          {actions}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("convo.common.resetConversation")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {transcript.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-sm text-center text-sm text-[var(--muted)]">
              {emptyStateMessage}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {transcript.map((item) => {
              const draftAction = item.suggested_actions?.find(
                (action) => action.action_type === "replace_note",
              );
              const openSettingActions =
                item.suggested_actions?.filter(
                  (action) => action.action_type === "open_setting",
                ) ?? [];

              return (
                <div
                  key={item.id}
                  className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      item.role === "user"
                        ? "bg-[var(--accent)] text-[var(--inverse-text)]"
                        : "border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text)]"
                    }`}
                  >
                    {item.text}
                    {item.role === "assistant" && (
                      <>
                        {draftAction &&
                          onReplaceDraft &&
                          onAppendDraft &&
                          onCopyDraft && (
                            <DraftActions
                              draftContent={draftAction.payload}
                              noteId={activeNoteId ?? null}
                              onReplace={() => onReplaceDraft(draftAction.payload)}
                              onAppend={() => onAppendDraft(draftAction.payload)}
                              onCopy={() => onCopyDraft(draftAction.payload)}
                            />
                          )}
                        {openSettingActions.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {openSettingActions.map((action) => (
                              <Button
                                key={`${item.id}-${action.payload}`}
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => onOpenSetting?.(action.payload)}
                                className="text-xs"
                              >
                                <SlidersHorizontal className="mr-1 h-3 w-3" />
                                {action.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2.5 text-sm text-[var(--muted)]">
                  {t("convo.common.thinking")}
                </div>
              </div>
            )}
            {isRecording && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2.5 text-sm text-[var(--accent)]">
                  {t("convo.common.recording")}
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onPointerDown={(event) => {
              event.preventDefault();
              void handleStartRecording();
            }}
            disabled={isBusy}
            className={`shrink-0 rounded-full p-2 ${
              isRecording
                ? "bg-[var(--accent)] text-[var(--inverse-text)]"
                : "text-[var(--muted)] hover:text-[var(--accent)]"
            }`}
            title={t("convo.common.holdToSpeak")}
          >
            <Mic className="h-5 w-5" />
          </Button>
          <div className="relative min-h-[40px] flex-1">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("convo.common.typeMessage")}
              rows={1}
              disabled={isBusy}
              className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2.5 text-sm text-[var(--text)] placeholder-[var(--muted)] outline-none transition-colors focus:border-[var(--accent)]"
              style={{ maxHeight: "120px", overflow: "auto" }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSend}
            disabled={!inputText.trim() || isBusy || isRecording}
            className="shrink-0 rounded-full p-2 text-[var(--accent)] disabled:opacity-40"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
