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
  generatedAt: "2026-05-12T05:54:34Z",
  suite: "File ASR real-world smoke benchmark",
  corpus:
    "Repository file-transcription sample: macOS-say spoken WAV phrase from test-data/file-transcription-samples.",
  limitations:
    "One-sample smoke coverage only. Use this for adapter/decode sanity, not for long-form meetings, lectures, accents, subtitle timing, cancellation, or memory pressure decisions.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "WER: lower is better.",
    "Latency: lower is faster.",
    "RTF: lower is faster; below 1.00 is faster than real time.",
    "Device is informational.",
  ],
  reportPath:
    "output/file-asr-model-eval/2026-05-12-mlx-asr/latest/file-asr-summary.md",
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
    rank: 7,
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
    rank: 5,
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
    modelId: "mlx-fireredasr2-aed",
    label: "FireRedASR2 AED (MLX)",
    status: "tested",
    rank: 1,
    sampleCount: 1,
    exactMatches: 0,
    averageWer: 0.071,
    latencyMs: 4322,
    realTimeFactor: 0.6674903474903475,
    device: "mps",
    notes:
      "Best File ASR smoke result after adding the MLX ASR models: low WER and faster than real time, though capitalization/punctuation normalization differs from the reference.",
  },
  {
    modelId: "mlx-qwen3-asr-0.6b",
    label: "Qwen3 ASR 0.6B (MLX)",
    status: "tested",
    rank: 2,
    sampleCount: 1,
    exactMatches: 0,
    averageWer: 0.071,
    latencyMs: 6082,
    realTimeFactor: 0.9393050193050193,
    device: "mps",
    notes:
      "Fast enough for the file-transcription smoke sample and only missed Vox Jot as Vox Jet.",
  },
  {
    modelId: "mlx-vibevoice-asr-bf16",
    label: "VibeVoice ASR 9B (MLX)",
    status: "tested",
    rank: 3,
    sampleCount: 1,
    exactMatches: 0,
    averageWer: 0.071,
    latencyMs: 25763,
    realTimeFactor: 3.978841698841699,
    device: "mps",
    notes:
      "Accurate on the sample but far slower than real time; keep this positioned for file transcription experiments, not live dictation.",
  },
  {
    modelId: "mlx-qwen3-asr",
    label: "Qwen3 ASR 1.7B (MLX)",
    status: "tested",
    rank: 4,
    sampleCount: 1,
    exactMatches: 0,
    averageWer: 0.143,
    latencyMs: 3791,
    realTimeFactor: 0.5854826254826255,
    device: "mps",
    notes:
      "Fastest MLX File ASR smoke result, but it heard Vox Jot as VoxChat.",
  },
  {
    modelId: "whisper-diarization",
    label: "Whisper Diarization",
    status: "tested",
    rank: 6,
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
