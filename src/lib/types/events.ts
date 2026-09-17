export interface ModelStateEvent {
  event_type: string;
  model_id?: string;
  model_name?: string;
  error?: string;
}

export type TtsPlaybackPhase =
  | "queued"
  | "preparing"
  | "speaking"
  | "completed"
  | "stopped"
  | "failed";

export interface TtsPlaybackStatusEvent {
  requestId: number;
  phase: TtsPlaybackPhase;
}

export function isActiveTtsPlaybackPhase(
  phase: TtsPlaybackPhase,
): phase is "queued" | "preparing" | "speaking" {
  return phase === "queued" || phase === "preparing" || phase === "speaking";
}
