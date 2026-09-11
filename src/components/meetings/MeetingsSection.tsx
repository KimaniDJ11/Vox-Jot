import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  commands,
  type MeetingCapabilities,
  type MeetingDetail,
  type MeetingSession,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { SectionIntro } from "@/components/app-sections/shared";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import { recordingStates } from "./MeetingRecordingStatus";

const fieldClass = `min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 ${interactiveFocusRingClass}`;
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

type MeetingAction = {
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  restoreFocus?: boolean;
  onSelect: () => void;
};

function MeetingActionsMenu({
  label,
  actions,
  triggerId,
}: {
  label: string;
  actions: MeetingAction[];
  triggerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    const focusFrame = requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(
          'button[role="menuitem"]:not(:disabled)',
        )
        ?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + direction + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${interactiveFocusRingClass}`}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="absolute bottom-full right-0 z-30 mb-2 min-w-56 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[var(--shadow-lg)]"
          onKeyDown={handleMenuKeyDown}
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  action.danger
                    ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                    : "text-[var(--text)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                } ${interactiveFocusRingClass}`}
                onClick={() => {
                  action.onSelect();
                  setOpen(false);
                  if (action.restoreFocus !== false) {
                    requestAnimationFrame(() => triggerRef.current?.focus());
                  }
                }}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function meetingStatus(session: MeetingSession) {
  if (
    session.error ||
    session.analysis_error ||
    session.state === "interrupted"
  )
    return "Needs attention";
  if (busyStates.has(session.state))
    return labels[session.state] ?? session.state;
  if (session.summary_ready || session.transcript_ready) return "Ready";
  return labels[session.state] ?? session.state;
}

function meetingStatusClass(session: MeetingSession) {
  if (
    session.error ||
    session.analysis_error ||
    session.state === "interrupted"
  )
    return "bg-[var(--danger-soft)] text-[var(--danger)]";
  if (busyStates.has(session.state))
    return "bg-[var(--warning-soft)] text-[var(--warning)]";
  if (session.transcript_ready || session.state === "ready")
    return "bg-[var(--success-soft)] text-[var(--success)]";
  return "bg-[var(--surface-muted)] text-[var(--muted)]";
}

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
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailReturnId = useRef<string | null>(null);
  const deleteFocusFrame = useRef<number | null>(null);
  const detailSessionId = detail?.session.id;
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
  useEffect(() => {
    const recheckPermissions = () => {
      void refreshCapabilities().catch((cause) => setError(String(cause)));
    };
    window.addEventListener("focus", recheckPermissions);
    return () => window.removeEventListener("focus", recheckPermissions);
  }, [refreshCapabilities]);
  useEffect(
    () => () => {
      if (deleteFocusFrame.current !== null)
        cancelAnimationFrame(deleteFocusFrame.current);
    },
    [],
  );
  useEffect(() => {
    if (!detailSessionId) return;
    requestAnimationFrame(() => detailHeadingRef.current?.focus());
  }, [detailSessionId]);
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
  const openDeleteConfirmation = (sessionId: string) => {
    if (deleteFocusFrame.current !== null) {
      cancelAnimationFrame(deleteFocusFrame.current);
      deleteFocusFrame.current = null;
    }
    setConfirmDelete(sessionId);
  };
  const cancelDeleteConfirmation = (sessionId: string) => {
    setConfirmDelete(null);
    if (deleteFocusFrame.current !== null)
      cancelAnimationFrame(deleteFocusFrame.current);
    deleteFocusFrame.current = requestAnimationFrame(() => {
      deleteFocusFrame.current = null;
      document.getElementById(`meeting-actions-${sessionId}`)?.focus();
    });
  };
  const closeDetail = () => {
    const returnId = detailReturnId.current;
    setDetail(null);
    requestAnimationFrame(() => {
      document.getElementById(returnId ?? "")?.focus();
    });
  };
  return (
    <SectionIntro title="Meetings" description="">
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
            className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
          >
            {active ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--accent-soft)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-3 w-3" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--danger)] opacity-50" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--danger)]" />
                    </span>
                    <div>
                      <p
                        className="font-semibold"
                        role="status"
                        aria-live="polite"
                      >
                        {labels[active.state]}
                      </p>
                      <p className="text-sm text-[var(--muted)]">
                        {active.title}
                      </p>
                    </div>
                  </div>
                  <p className="font-mono text-xl font-bold tabular-nums">
                    {formatMeetingDuration(active.duration_ms)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
                  <p className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${active.system.received_frames > 0 ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`}
                      aria-hidden
                    />
                    {active.system.received_frames > 0
                      ? "System audio"
                      : "Waiting for system audio"}
                  </p>
                  {active.include_microphone && (
                    <p className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${active.microphone.received_frames > 0 ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`}
                        aria-hidden
                      />
                      {active.microphone.received_frames > 0
                        ? "Microphone"
                        : "Waiting for microphone"}
                    </p>
                  )}
                </div>
                <Button
                  aria-label="Stop meeting"
                  variant="danger"
                  size="lg"
                  className="w-full"
                  disabled={!!pending || active.state === "stopping"}
                  onClick={() =>
                    void run(active.id, () => commands.stopMeeting(active.id))
                  }
                >
                  {active.state === "stopping" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  {active.state === "stopping" ? "Saving…" : "Stop Meeting"}
                </Button>
              </>
            ) : (
              <>
                {!permitted && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--warning-soft)] p-4 text-sm">
                    <div>
                      <p className="font-semibold">
                        {t("meetings.permissionNeeded", {
                          defaultValue: "Permission needed",
                        })}
                      </p>
                      <p className="text-[var(--muted)]">
                        {t("meetings.allowThenStart", {
                          defaultValue: "Allow access, then check again.",
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={!!pending}
                        onClick={() =>
                          void run("permissions", async () => {
                            await commands.requestMeetingPermissions();
                          })
                        }
                      >
                        {t("meetings.allowAccess", {
                          defaultValue: "Allow access",
                        })}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!!pending}
                        onClick={() =>
                          void run("check-permissions", refreshCapabilities)
                        }
                      >
                        {t("meetings.checkAgain", {
                          defaultValue: "Check again",
                        })}
                      </Button>
                    </div>
                    <p className="w-full text-xs text-[var(--muted)]">
                      {t("meetings.enableDeniedAccess", {
                        defaultValue:
                          "If access was denied, enable it in System Settings.",
                      })}
                    </p>
                  </div>
                )}

                <Button
                  aria-label="Start meeting recording"
                  size="lg"
                  className="w-full"
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
                  {pending === "start" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  {pending === "start" ? "Starting…" : "Start Meeting"}
                </Button>

                <details className="group border-t border-[var(--border)]">
                  <summary
                    className={`flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-1 text-sm font-semibold text-[var(--text)] marker:hidden [&::-webkit-details-marker]:hidden ${interactiveFocusRingClass}`}
                  >
                    {t("meetings.options", { defaultValue: "Options" })}
                    <span
                      className="text-[var(--muted)] transition-transform group-open:rotate-180"
                      aria-hidden
                    >
                      {t("meetings.expandSymbol", { defaultValue: "⌄" })}
                    </span>
                  </summary>
                  <div className="space-y-4 pb-2 pt-3">
                    <label className="block space-y-1 text-sm font-medium">
                      {t("meetings.meetingTitle", {
                        defaultValue: "Meeting title",
                      })}
                      <Input
                        aria-label="Meeting title"
                        className={fieldClass}
                        value={title}
                        maxLength={120}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Meeting"
                      />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block space-y-1 text-sm font-medium">
                        {t("meetings.systemAudioSource", {
                          defaultValue: "System audio",
                        })}
                        <select
                          aria-label="System audio source"
                          className={fieldClass}
                          value={source}
                          onChange={(event) =>
                            setSource(Number(event.target.value))
                          }
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
                      <div className="space-y-1">
                        <div className="flex min-h-6 items-center justify-between gap-3">
                          <p className="text-sm font-medium">
                            {t("meetings.microphone", {
                              defaultValue: "Microphone",
                            })}
                          </p>
                          <SwitchControl
                            checked={includeMic}
                            size="compact"
                            frame="icon"
                            ariaLabel={t(
                              "meetings.includeMyMicrophoneAsASeparateTrack",
                              {
                                defaultValue: "Include microphone",
                              },
                            )}
                            onChange={setIncludeMic}
                          />
                        </div>
                        <select
                          aria-label="Meeting microphone"
                          className={fieldClass}
                          value={mic}
                          disabled={!includeMic}
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
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
                      <p className="flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5" aria-hidden />
                        {t("meetings.compactStorage", {
                          defaultValue:
                            "Audio only · No screen/video · About {{megabytes}} MB/hour · 8-hour limit",
                          megabytes: includeMic ? "346" : "230",
                        })}
                      </p>
                      <button
                        type="button"
                        disabled={!!pending}
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${interactiveFocusRingClass}`}
                        onClick={() => void run("refresh", refreshCapabilities)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        {t("meetings.refresh", { defaultValue: "Refresh" })}
                      </button>
                    </div>
                  </div>
                </details>

                <p className="text-center text-xs text-[var(--muted)]">
                  {t("meetings.shortConsent", {
                    defaultValue: "Tell everyone first · Saved locally",
                  })}
                </p>
              </>
            )}
          </section>
        )}
        <section aria-label="Saved meetings" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              {t("meetings.savedMeetings", {
                defaultValue: "Saved meetings",
              })}
            </h2>
            {onConfigureModels && (
              <Button
                aria-label="Configure transcription and speaker models"
                size="sm"
                variant="ghost"
                onClick={onConfigureModels}
              >
                {t("meetings.models", { defaultValue: "Models" })}
              </Button>
            )}
          </div>
          {notice && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-xl bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {notice}
            </p>
          )}
          {!sessions.length && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
              {t("meetings.noSavedMeetings", {
                defaultValue: "No saved meetings.",
              })}
            </div>
          )}
          {sessions.slice(0, visible).map((session) => {
            const menuActions: MeetingAction[] = [];
            if (session.transcript_ready) {
              menuActions.push({
                label: "Transcribe again",
                icon: RefreshCw,
                disabled: !!pending || busyStates.has(session.state),
                onSelect: () =>
                  void run(session.id, () =>
                    commands.transcribeMeeting(session.id),
                  ),
              });
              menuActions.push({
                label: session.summary_ready
                  ? "Regenerate local summary"
                  : "Create local summary",
                icon: Sparkles,
                disabled: !!pending || busyStates.has(session.state),
                onSelect: () =>
                  void run(session.id, () =>
                    commands.summarizeMeeting(session.id),
                  ),
              });
            }
            menuActions.push({
              label: t("meetings.revealFiles", {
                defaultValue: "Reveal files",
              }),
              icon: FolderOpen,
              disabled: !!pending,
              onSelect: () =>
                void run(session.id, () => commands.revealMeeting(session.id)),
            });
            if (!busyStates.has(session.state)) {
              menuActions.push({
                label: t("meetings.delete", { defaultValue: "Delete" }),
                icon: Trash2,
                danger: true,
                disabled: !!pending,
                restoreFocus: false,
                onSelect: () => openDeleteConfirmation(session.id),
              });
            }

            return (
              <article
                key={session.id}
                className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3
                      className="truncate font-semibold"
                      title={session.title}
                    >
                      {session.title}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {new Date(session.created_at).toLocaleString()} ·{" "}
                      <span className="font-mono tabular-nums">
                        {formatMeetingDuration(session.duration_ms)}
                      </span>
                    </p>
                  </div>
                  {(busyStates.has(session.state) ||
                    session.error ||
                    session.analysis_error ||
                    session.state === "interrupted") && (
                    <span
                      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${meetingStatusClass(session)}`}
                    >
                      {busyStates.has(session.state) ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : null}
                      {meetingStatus(session)}
                    </span>
                  )}
                </div>
                {(session.error || session.analysis_error) && (
                  <p
                    role="alert"
                    className="rounded-xl bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
                  >
                    {session.analysis_error ?? session.error}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {["transcribing", "summarizing"].includes(
                      session.state,
                    ) && (
                      <Button
                        aria-label="Cancel analysis"
                        size="sm"
                        variant="secondary"
                        disabled={!!pending}
                        onClick={() =>
                          void run(session.id, async () => {
                            const result = await commands.cancelMeetingAnalysis(
                              session.id,
                            );
                            if (result.status === "ok")
                              setNotice("Canceling. Audio kept.");
                            return result;
                          })
                        }
                      >
                        {t("meetings.cancel", { defaultValue: "Cancel" })}
                      </Button>
                    )}
                    {!recordingStates.has(session.state) &&
                      !session.transcript_ready && (
                        <Button
                          size="sm"
                          disabled={!!pending || busyStates.has(session.state)}
                          onClick={() =>
                            void run(session.id, () =>
                              commands.transcribeMeeting(session.id),
                            )
                          }
                        >
                          {t("meetings.transcribe", {
                            defaultValue: "Transcribe",
                          })}
                        </Button>
                      )}
                    {session.transcript_ready && (
                      <Button
                        id={`meeting-open-${session.id}`}
                        aria-label={`Open notes and transcript for ${session.title}`}
                        size="sm"
                        disabled={!!pending}
                        onClick={() =>
                          void run(session.id, async () => {
                            detailReturnId.current = `meeting-open-${session.id}`;
                            const result = await commands.readMeeting(
                              session.id,
                            );
                            if (result.status === "ok") setDetail(result.data);
                            return result;
                          })
                        }
                      >
                        <FileText className="h-4 w-4" aria-hidden />
                        {t("meetings.open", { defaultValue: "Open" })}
                      </Button>
                    )}
                  </div>
                  <MeetingActionsMenu
                    triggerId={`meeting-actions-${session.id}`}
                    label={`More actions for ${session.title}`}
                    actions={menuActions}
                  />
                </div>

                {confirmDelete === session.id && (
                  <div
                    className="space-y-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4"
                    role="group"
                    aria-live="polite"
                    aria-label={`Confirm deleting ${session.title}`}
                  >
                    <p className="text-sm">
                      {t("meetings.moveToRecoverableDeleted", {
                        defaultValue: "Move to Deleted Meetings?",
                      })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        autoFocus
                        variant="secondary"
                        size="sm"
                        disabled={!!pending}
                        onClick={() => cancelDeleteConfirmation(session.id)}
                      >
                        {t("meetings.cancel", { defaultValue: "Cancel" })}
                      </Button>
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
                              setNotice("Moved to Deleted Meetings.");
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
                    </div>
                  </div>
                )}

                {detail?.session.id === session.id && (
                  <section
                    aria-label="Meeting transcript"
                    className="space-y-4 border-t border-[var(--border)] pt-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2
                        ref={detailHeadingRef}
                        tabIndex={-1}
                        className={`truncate font-semibold ${interactiveFocusRingClass}`}
                        title={detail.session.title}
                      >
                        {detail.session.title}
                      </h2>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={closeDetail}
                      >
                        {t("meetings.close", { defaultValue: "Close" })}
                      </Button>
                    </div>
                    {detail.summary && (
                      <div className="rounded-xl bg-[var(--panel-bg)] p-4">
                        <h3 className="mb-2 flex items-center gap-2 font-semibold">
                          <Sparkles
                            className="h-4 w-4 text-[var(--accent)]"
                            aria-hidden
                          />
                          {t("meetings.summary", { defaultValue: "Summary" })}
                        </h3>
                        <p className="whitespace-pre-wrap text-sm leading-6">
                          {detail.summary}
                        </p>
                      </div>
                    )}
                    <p className="flex items-start gap-2 text-sm text-[var(--muted)]">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {t("meetings.verifyImportantDetails", {
                        defaultValue:
                          "Verify important details against the recording.",
                      })}
                    </p>
                    <div
                      className="max-h-[32rem] space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3"
                      tabIndex={0}
                      aria-label="Transcript segments"
                    >
                      {detail.segments.map((segment, index) => (
                        <div
                          key={`${segment.start_ms}-${index}`}
                          className="rounded-lg bg-[var(--card)] p-3"
                        >
                          <p className="text-xs font-semibold text-[var(--muted)]">
                            {formatMeetingDuration(segment.start_ms)} ·{" "}
                            {segment.speaker}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                            {segment.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </article>
            );
          })}
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
      </div>
    </SectionIntro>
  );
}
