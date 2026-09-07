import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type MeetingCapabilities,
  type MeetingDetail,
  type MeetingSession,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { SectionIntro } from "@/components/app-sections/shared";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import { recordingStates } from "./MeetingRecordingStatus";

const fieldClass = `min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] ${interactiveFocusRingClass}`;
const busyStates = new Set([...recordingStates, "transcribing", "summarizing"]);
const labels: Record<string, string> = {
  starting: "Starting recording…",
  recording: "Recording",
  stopping: "Saving audio…",
  recorded: "Audio saved",
  interrupted: "Needs attention",
  transcribing: "Transcribing locally…",
  summarizing: "Creating local summary…",
  ready: "Ready",
};

export function formatMeetingDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export default function MeetingsSection({
  onConfigureModels,
}: {
  onConfigureModels?: () => void;
}) {
  const [capabilities, setCapabilities] = useState<MeetingCapabilities | null>(
    null,
  );
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<MeetingSession[]>([]);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState(0);
  const [mic, setMic] = useState("");
  const [includeMic, setIncludeMic] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [visible, setVisible] = useState(15);
  const refresh = useCallback(async () => {
    const result = await commands.listMeetings();
    if (result.status === "error") throw new Error(result.error);
    setSessions(result.data);
  }, []);
  const refreshCapabilities = useCallback(async () => {
    const result = await commands.getMeetingCapabilities();
    if (result.status === "error") throw new Error(result.error);
    setCapabilities(result.data);
  }, []);
  useEffect(() => {
    void Promise.all([refresh(), refreshCapabilities()]).catch((cause) =>
      setError(String(cause)),
    );
  }, [refresh, refreshCapabilities]);
  useTauriEvent<{ id: string; state: string; session?: MeetingSession }>(
    "meeting-updated",
    ({ payload }) => {
      if (payload.session) {
        const updated = payload.session;
        setSessions((current) =>
          [updated, ...current.filter((s) => s.id !== updated.id)].sort(
            (a, b) => b.created_at - a.created_at,
          ),
        );
      } else {
        void refresh().catch((cause) => setError(String(cause)));
      }
      if (detail?.session.id === payload.id && !busyStates.has(payload.state)) {
        void commands.readMeeting(payload.id).then((result) => {
          if (result.status === "ok") setDetail(result.data);
        });
      }
    },
  );
  const run = async (key: string, work: () => Promise<unknown>) => {
    setPending(key);
    setError(null);
    try {
      const result = (await work()) as
        { status?: string; error?: string } | undefined;
      if (result?.status === "error") throw new Error(result.error);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(null);
    }
  };
  const active = sessions.find((s) => recordingStates.has(s.state));
  const permitted =
    capabilities?.screen_permission &&
    (!includeMic || capabilities.microphone_permission);
  return (
    <SectionIntro
      title="Meetings"
      description="Record system audio and your microphone as separate local tracks, then transcribe and summarize after the meeting."
    >
      <div className="space-y-6 text-[var(--text)]">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-[var(--danger)] p-3 text-sm"
          >
            {error}
          </p>
        )}
        {!capabilities ? (
          <p role="status">
            {t("meetings.checkingRecordingSupport", {
              defaultValue: "Checking recording support…",
            })}
          </p>
        ) : !capabilities.supported ? (
          <p role="status">
            {t("meetings.meetingCaptureRequiresMacos15OrNewer", {
              defaultValue:
                "Meeting capture requires macOS 15 or newer on Apple Silicon. Existing saved meetings remain available below.",
            })}
          </p>
        ) : (
          <section
            aria-label="New meeting"
            className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5"
          >
            <p className="text-sm text-[var(--muted)]">
              {t("meetings.recordOnlyWithTheParticipantsKnowledgeUse", {
                defaultValue:
                  "Record only with the participants’ knowledge. Use headphones to keep system audio from echoing into your microphone. No screen images or video are saved.",
              })}
            </p>
            {!permitted && (
              <div className="space-y-2 text-sm">
                <p>
                  {t("meetings.systemAudio", { defaultValue: "System audio:" })}{" "}
                  {capabilities.screen_permission
                    ? "Allowed"
                    : "Permission needed"}
                  {t("meetings.microphone", { defaultValue: ". Microphone:" })}{" "}
                  {capabilities.microphone_permission
                    ? "Allowed"
                    : "Permission needed when included"}
                  .
                </p>
                <Button
                  variant="secondary"
                  disabled={!!pending}
                  onClick={() =>
                    void run("permissions", async () => {
                      await commands.requestMeetingPermissions();
                    })
                  }
                >
                  {t("meetings.allowRecordingPermissions", {
                    defaultValue: "Allow recording permissions",
                  })}
                </Button>
                <p className="text-[var(--muted)]">
                  {t("meetings.approveAccessInSystemSettingsIfMacos", {
                    defaultValue:
                      "Approve access in System Settings. If macOS requests a restart, quit and reopen Vox Jot, then refresh sources.",
                  })}
                </p>
              </div>
            )}
            <label className="block space-y-1 text-sm font-medium">
              {t("meetings.meetingTitle", { defaultValue: "Meeting title" })}
              <Input
                aria-label="Meeting title"
                className={fieldClass}
                value={title}
                maxLength={120}
                disabled={!!active}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Meeting"
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1 text-sm font-medium">
                {t("meetings.systemAudioSource", {
                  defaultValue: "System audio source",
                })}
                <select
                  aria-label="System audio source"
                  className={fieldClass}
                  value={source}
                  disabled={!!active}
                  onChange={(event) => setSource(Number(event.target.value))}
                >
                  <option value={0}>
                    {t("meetings.allSystemAudioExceptVoxJot", {
                      defaultValue: "All system audio except Vox Jot",
                    })}
                  </option>
                  {capabilities.applications.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-sm font-medium">
                {t("meetings.microphone", { defaultValue: "Microphone" })}
                <select
                  aria-label="Meeting microphone"
                  className={fieldClass}
                  value={mic}
                  disabled={!!active || !includeMic}
                  onChange={(event) => setMic(event.target.value)}
                >
                  <option value="">
                    {t("meetings.systemDefault", {
                      defaultValue: "System default",
                    })}
                  </option>
                  {capabilities.microphones.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={includeMic}
                disabled={!!active}
                onChange={(event) => setIncludeMic(event.target.checked)}
                className={`h-4 w-4 ${interactiveFocusRingClass}`}
              />
              {t("meetings.includeMyMicrophoneAsASeparateTrack", {
                defaultValue: "Include my microphone as a separate track",
              })}
            </label>
            <p className="text-sm text-[var(--muted)]">
              {t("meetings.about", { defaultValue: "About" })}
              {includeMic ? "346" : "230"}
              {t("meetings.mbPerHourIncludingTheMixdownEighthour", {
                defaultValue:
                  "MB per hour including the mixdown. Eight-hour limit. Audio stays in Vox Jot’s Meetings folder; no automatic deletion.",
              })}
            </p>
            <div className="flex flex-wrap gap-3">
              {active ? (
                <Button
                  variant="danger"
                  disabled={!!pending || active.state === "stopping"}
                  onClick={() =>
                    void run(active.id, () => commands.stopMeeting(active.id))
                  }
                >
                  {active.state === "stopping"
                    ? "Saving audio…"
                    : "Stop and save recording"}
                </Button>
              ) : (
                <Button
                  disabled={!!pending || !permitted}
                  onClick={() =>
                    void run("start", async () => {
                      const result = await commands.startMeeting(
                        title,
                        source,
                        mic,
                        includeMic,
                      );
                      if (result.status === "ok") setTitle("");
                      return result;
                    })
                  }
                >
                  {pending === "start"
                    ? "Starting…"
                    : "Start meeting recording"}
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={!!pending || !!active}
                onClick={() => void run("refresh", refreshCapabilities)}
              >
                {t("meetings.refreshSourcesAndPermissions", {
                  defaultValue: "Refresh sources and permissions",
                })}
              </Button>
            </div>
            {active && (
              <div
                role="status"
                aria-live="polite"
                className="space-y-1 text-sm"
              >
                <p className="font-semibold">
                  {t("meetings.activeRecordingStatus", {
                    defaultValue: "● {{state}} · {{elapsed}}",
                    state: labels[active.state],
                    elapsed: formatMeetingDuration(active.duration_ms),
                  })}
                </p>
                <p>
                  {active.system_source}
                  {t("meetings.systemAudio", {
                    defaultValue: "· System audio",
                  })}{" "}
                  {active.system.received_frames > 0 ? "receiving" : "waiting"}
                  {active.include_microphone
                    ? ` · Microphone ${active.microphone.received_frames > 0 ? "receiving" : "waiting"}`
                    : ""}
                </p>
                <p>
                  {t("meetings.stoppingPreservesTheRecordingYouCanDelete", {
                    defaultValue:
                      "Stopping preserves the recording. You can delete it afterward.",
                  })}
                </p>
              </div>
            )}
          </section>
        )}
        <section aria-label="Saved meetings" className="space-y-3">
          <h2 className="text-base font-semibold">
            {t("meetings.savedMeetings", { defaultValue: "Saved meetings" })}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {t("meetings.transcriptionUsesYourFileTranscriptionAsrAnd", {
              defaultValue:
                "Transcription uses your File Transcription ASR and speaker-label settings. Summaries require a local Refine model. Source labels are not verified identities; no recording is sent to a cloud model.",
            })}
          </p>
          {onConfigureModels && (
            <Button size="sm" variant="secondary" onClick={onConfigureModels}>
              {t("meetings.configureTranscriptionAndSpeakerModels", {
                defaultValue: "Configure transcription and speaker models",
              })}
            </Button>
          )}
          {notice && (
            <p role="status" className="text-sm text-[var(--muted)]">
              {notice}
            </p>
          )}
          {!sessions.length && (
            <p className="text-sm text-[var(--muted)]">
              {t("meetings.noMeetingsYetChooseYourSourcesAbove", {
                defaultValue:
                  "No meetings yet. Choose your sources above to record a meeting.",
              })}
            </p>
          )}
          {sessions.slice(0, visible).map((session) => (
            <article
              key={session.id}
              className="space-y-3 rounded-xl border border-[var(--border)] p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{session.title}</h3>
                <p className="text-sm text-[var(--muted)]">
                  {new Date(session.created_at).toLocaleString()} ·{" "}
                  {formatMeetingDuration(session.duration_ms)}
                </p>
              </div>
              <p className="text-sm">
                {labels[session.state] ?? session.state} ·{" "}
                {session.system_source}
                {session.include_microphone ? " + microphone" : ""}
              </p>
              {(session.error || session.analysis_error) && (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {session.analysis_error ?? session.error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {["transcribing", "summarizing"].includes(session.state) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!pending}
                    onClick={() =>
                      void run(session.id, async () => {
                        const result = await commands.cancelMeetingAnalysis(
                          session.id,
                        );
                        if (result.status === "ok")
                          setNotice(
                            "Cancellation requested. The current analysis window will finish, then processing will stop. Original audio is preserved.",
                          );
                        return result;
                      })
                    }
                  >
                    {t("meetings.cancelAnalysis", {
                      defaultValue: "Cancel analysis",
                    })}
                  </Button>
                )}
                {!recordingStates.has(session.state) && (
                  <Button
                    size="sm"
                    disabled={!!pending || busyStates.has(session.state)}
                    onClick={() =>
                      void run(session.id, () =>
                        commands.transcribeMeeting(session.id),
                      )
                    }
                  >
                    {session.transcript_ready
                      ? "Transcribe again"
                      : "Transcribe locally"}
                  </Button>
                )}
                {session.transcript_ready && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!!pending}
                      onClick={() =>
                        void run(session.id, async () => {
                          const result = await commands.readMeeting(session.id);
                          if (result.status === "ok") setDetail(result.data);
                          return result;
                        })
                      }
                    >
                      {t("meetings.viewTranscriptAndNotes", {
                        defaultValue: "View transcript and notes",
                      })}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!!pending || busyStates.has(session.state)}
                      onClick={() =>
                        void run(session.id, () =>
                          commands.summarizeMeeting(session.id),
                        )
                      }
                    >
                      {session.summary_ready
                        ? "Regenerate local summary"
                        : "Create local summary"}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!pending}
                  onClick={() =>
                    void run(session.id, () =>
                      commands.revealMeeting(session.id),
                    )
                  }
                >
                  {t("meetings.revealFiles", { defaultValue: "Reveal files" })}
                </Button>
                {!busyStates.has(session.state) && (
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    disabled={!!pending}
                    onClick={() => setConfirmDelete(session.id)}
                  >
                    {t("meetings.delete", { defaultValue: "Delete" })}
                  </Button>
                )}
              </div>
              {confirmDelete === session.id && (
                <div
                  className="space-y-2 rounded-lg bg-[var(--panel-bg)] p-3"
                  role="group"
                  aria-label={`Confirm deleting ${session.title}`}
                >
                  <p className="text-sm">
                    {t("meetings.removeThisMeetingFromTheListIts", {
                      defaultValue:
                        "Remove this meeting from the list? Its audio and notes will move to the recoverable Deleted Meetings folder.",
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={!!pending}
                      onClick={() =>
                        void run(session.id, async () => {
                          const result = await commands.deleteMeeting(
                            session.id,
                            true,
                          );
                          if (result.status === "ok") {
                            setConfirmDelete(null);
                            setNotice(
                              "Meeting moved to the recoverable meetings/deleted folder inside Vox Jot’s application data. No audio was permanently erased.",
                            );
                            if (detail?.session.id === session.id)
                              setDetail(null);
                          }
                          return result;
                        })
                      }
                    >
                      {t("meetings.confirmDelete", {
                        defaultValue: "Confirm delete",
                      })}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!!pending}
                      onClick={() => setConfirmDelete(null)}
                    >
                      {t("meetings.cancel", { defaultValue: "Cancel" })}
                    </Button>
                  </div>
                </div>
              )}
            </article>
          ))}
          {sessions.length > visible && (
            <Button
              variant="secondary"
              onClick={() => setVisible((n) => n + 15)}
            >
              {t("meetings.showMoreMeetings", {
                defaultValue: "Show more meetings",
              })}
            </Button>
          )}
        </section>
        {detail && (
          <section
            aria-label="Meeting transcript"
            className="space-y-4 rounded-xl border border-[var(--border)] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                {detail.session.title}
              </h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDetail(null)}
              >
                {t("meetings.closeTranscript", {
                  defaultValue: "Close transcript",
                })}
              </Button>
            </div>
            {detail.summary && (
              <div>
                <h3 className="mb-2 font-semibold">
                  {t("meetings.localSummary", {
                    defaultValue: "Local summary",
                  })}
                </h3>
                <p className="whitespace-pre-wrap text-sm">{detail.summary}</p>
              </div>
            )}
            <p className="text-sm text-[var(--muted)]">
              {t(
                "meetings.machineTranscriptAndSpeakerEstimatesverifyImportantStatements",
                {
                  defaultValue:
                    "Machine transcript and speaker estimates—verify important statements against the original recordings.",
                },
              )}
            </p>
            <div
              className="max-h-[32rem] space-y-4 overflow-y-auto"
              tabIndex={0}
              aria-label="Transcript segments"
            >
              {detail.segments.map((segment, index) => (
                <div key={`${segment.start_ms}-${index}`}>
                  <p className="text-sm font-semibold">
                    {formatMeetingDuration(segment.start_ms)} ·{" "}
                    {segment.speaker}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{segment.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </SectionIntro>
  );
}
