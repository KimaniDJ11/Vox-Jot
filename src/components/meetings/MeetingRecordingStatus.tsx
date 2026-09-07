import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { Button } from "@/components/ui/Button";

export const recordingStates = new Set(["starting", "recording", "stopping"]);

/** Remains visible when navigating away from Meetings. Never drives dictation UI. */
export function MeetingRecordingStatus() {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    let alive = true;
    void commands
      .listMeetings()
      .then((result) => {
        if (alive && result.status === "ok") {
          setActiveId(
            result.data.find((s) => recordingStates.has(s.state))?.id ?? null,
          );
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useTauriEvent<{ id: string; state: string }>(
    "meeting-updated",
    ({ payload }) => {
      if (recordingStates.has(payload.state)) {
        setActiveId(payload.id);
        setStopping(payload.state === "stopping");
      } else {
        setActiveId((current) => (current === payload.id ? null : current));
        setStopping(false);
      }
    },
  );
  if (!activeId) return null;
  return (
    <div className="px-2 py-3 text-sm text-[var(--text)]">
      <p role="status" className="font-semibold">
        {t("meetings.meetingRecording", {
          defaultValue: "● Meeting recording",
        })}
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={stopping}
        onClick={async () => {
          setStopping(true);
          try {
            const result = await commands.stopMeeting(activeId);
            if (result.status === "error") throw new Error(result.error);
          } catch (cause) {
            setError(String(cause));
            setStopping(false);
          }
        }}
      >
        {stopping ? "Saving audio…" : "Stop meeting"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
