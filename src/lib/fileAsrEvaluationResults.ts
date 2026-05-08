export type FileAsrEvaluationStatus =
  | "tested"
  | "runtime_ready"
  | "download_required"
  | "blocked"
  | "pending";

export interface FileAsrEvaluationResult {
  modelId: string;
  label: string;
  status: FileAsrEvaluationStatus;
  rank?: number;
  sampleCount?: number;
  exactMatches?: number;
  averageWer?: number;
  latencyMs?: number;
  realTimeFactor?: number;
  device?: string;
  notes: string;
}

export const FILE_ASR_EVALUATION_RUN = {
  generatedAt: "2026-05-07T13:50:46Z",
  suite: "File ASR real-world smoke benchmark",
  corpus:
    "Repository file-transcription sample: macOS-say spoken WAV phrase from test-data/file-transcription-samples.",
  limitations:
    "One-sample smoke coverage only. Use this for adapter/decode sanity, not for long-form meetings, lectures, accents, subtitle timing, cancellation, or memory pressure decisions.",
  reportPath: "output/file-asr-model-eval/2026-05-07T13-50-06/file-asr-summary.md",
};

export const FILE_ASR_EVALUATION_RESULTS: FileAsrEvaluationResult[] = [
  {
    modelId: "current_dictation_engine",
    label: "Current Dictation Engine",
    status: "runtime_ready",
    device: "native",
    notes:
      "Uses the selected live dictation model. Current benchmark baseline is Whisper Turbo from the STT spelling corpus.",
  },
  {
    modelId: "granite-speech-4-1-2b",
    label: "Granite Speech 4.1 2B",
    status: "tested",
    rank: 3,
    sampleCount: 1,
    exactMatches: 0,
    averageWer: 0.357,
    latencyMs: 11136,
    realTimeFactor: 1.7198455598455598,
    device: "mps",
    notes:
      "Fresh rerun preserves Vox Jot but still emits short number words as digits.",
  },
  {
    modelId: "cohere-transcribe-03-2026",
    label: "Cohere Transcribe 03-2026",
    status: "tested",
    rank: 1,
    sampleCount: 1,
    exactMatches: 0,
    averageWer: 0.143,
    latencyMs: 7829,
    realTimeFactor: 1.2091119691119692,
    device: "mps",
    notes:
      "Fastest File ASR sidecar result in the fresh run; it still hears Vox Jot as VoxJet on the sample.",
  },
  {
    modelId: "whisper-diarization",
    label: "Whisper Diarization",
    status: "tested",
    rank: 2,
    sampleCount: 1,
    exactMatches: 0,
    averageWer: 0.143,
    latencyMs: 20896,
    realTimeFactor: 3.227181467181467,
    device: "cpu",
    notes:
      "Downloaded and tested after forcing Faster-Whisper to CPU on macOS. Accuracy ties Cohere on the sample, but latency is much slower.",
  },
];

export function getFileAsrEvaluationResult(
  modelId: string,
): FileAsrEvaluationResult | undefined {
  return FILE_ASR_EVALUATION_RESULTS.find(
    (result) => result.modelId === modelId,
  );
}
