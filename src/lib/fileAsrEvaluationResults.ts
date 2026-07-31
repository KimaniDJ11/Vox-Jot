export type FileAsrEvaluationStatus =
  "tested" | "runtime_ready" | "download_required" | "blocked" | "pending";

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
  generatedAt: "2026-06-16T14:56:32Z",
  suite: "File ASR full local sample benchmark",
  corpus:
    "Five committed file-transcription samples covering mono WAV, stereo WAV, MP3, M4A, and MP4 audio from test-data/file-transcription-samples.",
  limitations:
    "Local format/decode coverage only. It does not yet cover long-form meetings, lectures, accents, subtitle timing, cancellation, or memory pressure decisions. Gemma 4 E2B Audio and Gemma 4 E4B Audio were added from 2026-06-07 full five-format runs via the gemma-audio-venv Transformers path. Higgs Audio v3 STT was added from a 2026-06-16 full five-format run via the speech-analysis-venv Transformers path.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "WER: lower is better.",
    "Latency: lower is faster.",
    "RTF: lower is faster; below 1.00 is faster than real time.",
    "Device is informational.",
  ],
  reportPath:
    "output/file-asr-model-eval-higgs-v3/2026-06-16T14-56-32/file-asr-summary.md",
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
    rank: 9,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.357,
    latencyMs: 5955,
    realTimeFactor: 0.92,
    device: "mps",
    notes:
      "Full five-format local suite completed after weights were present; accuracy trails the smaller MLX ASR models but latency stayed below real time.",
  },
  {
    modelId: "cohere-transcribe-03-2026",
    label: "Cohere Transcribe 03-2026",
    status: "tested",
    rank: 12,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 12.086,
    latencyMs: 23414,
    realTimeFactor: 3.61,
    device: "mps",
    notes:
      "Full five-format local suite completed, but output was catastrophic multilingual token noise on every sample.",
  },
  {
    modelId: "mlx-mega-asr",
    label: "Mega-ASR 8-bit (MLX)",
    status: "tested",
    rank: 5,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.143,
    latencyMs: 2322,
    realTimeFactor: 0.36,
    device: "mps",
    notes:
      "Full five-format local suite rerun after the app-managed mlx-audio 0.4.4 runtime fix; all formats produced transcripts.",
  },
  {
    modelId: "mlx-nemotron-asr-streaming-0.6b",
    label: "Nemotron 3.5 ASR Streaming 0.6B (MLX)",
    status: "tested",
    rank: 4,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.143,
    latencyMs: 1932,
    realTimeFactor: 0.3,
    device: "mps",
    notes:
      "Full five-format local suite rerun after the app-managed mlx-audio 0.4.4 runtime fix; all formats produced transcripts.",
  },
  {
    modelId: "mlx-fireredasr2-aed",
    label: "FireRedASR2 AED (MLX)",
    status: "tested",
    rank: 1,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.071,
    latencyMs: 3463,
    realTimeFactor: 0.53,
    device: "mps",
    notes:
      "Best full five-format local File ASR suite result; consistently heard Vox Jot as Vox Jack.",
  },
  {
    modelId: "mlx-qwen3-asr-0.6b",
    label: "Qwen3 ASR 0.6B (MLX)",
    status: "tested",
    rank: 3,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.086,
    latencyMs: 2902,
    realTimeFactor: 0.45,
    device: "mps",
    notes:
      "Fastest full five-format local suite result; split or merged Vox Jot inconsistently.",
  },
  {
    modelId: "mlx-vibevoice-asr-bf16",
    label: "VibeVoice ASR 9B (MLX)",
    status: "tested",
    rank: 2,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.071,
    latencyMs: 20580,
    realTimeFactor: 3.18,
    device: "mps",
    notes:
      "Full five-format local suite tied FireRedASR2 on WER but is much slower than real time.",
  },
  {
    modelId: "mlx-qwen3-asr",
    label: "Qwen3 ASR 1.7B (MLX)",
    status: "tested",
    rank: 6,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.143,
    latencyMs: 3142,
    realTimeFactor: 0.48,
    device: "mps",
    notes:
      "Full five-format local suite completed consistently, but it heard Vox Jot as VoxChat.",
  },
  {
    modelId: "whisper-diarization",
    label: "Whisper Diarization",
    status: "tested",
    rank: 8,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.214,
    latencyMs: 19485,
    realTimeFactor: 3,
    device: "cpu",
    notes:
      "Full five-format local suite completed through the WhisperX runtime. Runtime now uses whisperx==3.4.2 with patched Transformers 5.3 / Hugging Face Hub 1.4 pins; NeMo is excluded until it can resolve above the Transformers security floor.",
  },
  {
    modelId: "gemma4-e2b-audio",
    label: "Gemma 4 E2B Audio",
    status: "tested",
    rank: 10,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.5,
    latencyMs: 8922,
    realTimeFactor: 1.38,
    device: "mps",
    notes:
      "Full five-format local suite via the gemma-audio-venv Transformers path; Gemma 4 multimodal LLM ASR trails the dedicated ASR models on accuracy and runs slower than real time.",
  },
  {
    modelId: "gemma4-e4b-audio",
    label: "Gemma 4 E4B Audio",
    status: "tested",
    rank: 11,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.5,
    latencyMs: 19445,
    realTimeFactor: 3.0,
    device: "mps",
    notes:
      "Full five-format local suite via the gemma-audio-venv Transformers path; same accuracy as E2B but ~2x slower (16 GB model). Its app download first landed incomplete (weights present, config metadata missing) and was repaired before this run.",
  },
  {
    modelId: "higgs-audio-v3-stt",
    label: "Higgs Audio v3 STT",
    status: "tested",
    rank: 7,
    sampleCount: 5,
    exactMatches: 0,
    averageWer: 0.143,
    latencyMs: 5924,
    realTimeFactor: 0.91,
    device: "mps",
    notes:
      "Full five-format local suite via the speech-analysis-venv Transformers path; consistently heard Vox Jot as voxjet and ran slightly faster than real time.",
  },
];

export function getFileAsrEvaluationResult(
  modelId: string,
): FileAsrEvaluationResult | undefined {
  return FILE_ASR_EVALUATION_RESULTS.find(
    (result) => result.modelId === modelId,
  );
}
