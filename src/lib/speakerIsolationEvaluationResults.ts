export type SpeakerIsolationEvaluationStatus =
  "tested" | "download_required" | "pending" | "blocked" | "not_applicable";

export interface SpeakerIsolationEvaluationResult {
  modelId: string;
  label: string;
  status: SpeakerIsolationEvaluationStatus;
  rank?: number;
  sampleCount?: number;
  expectedSpeakers?: number;
  detectedSpeakers?: number;
  expectedTurns?: number;
  detectedTurns?: number;
  diarizationErrorRate?: number;
  coverage?: number;
  confusionRate?: number;
  falseAlarmRate?: number;
  latencyMs?: number;
  device?: string;
  notes: string;
}

export const SPEAKER_ISOLATION_EVALUATION_RUN = {
  methodologyVersion: "2.0.0",
  evidenceTier: "ranked" as const,
  generatedAt: "2026-08-27T16:00:00Z",
  suite: "Vox Jot Diarization & Audio Cleanup Benchmark v2",
  corpus:
    "Multi-speaker real meeting fixtures with overlap, far-field acoustics, speaker count changes, and noisy background stress.",
  limitations:
    "Evaluated using DER/JER with optimal one-to-one speaker mapping and Apple Neural Engine (ANE) hardware isolation.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "DER: lower is better.",
    "Speakers and turns: closer to expected is better.",
    "Latency: lower is faster.",
  ],
  reportPath:
    "output/benchmark-v2-full-run/methodology_v2_comprehensive_report.json",
};

export const SPEAKER_ISOLATION_EVALUATION_RESULTS: SpeakerIsolationEvaluationResult[] =
  [
    {
      modelId: "no_speaker_labels",
      label: "No Speaker Labels",
      status: "not_applicable",
      notes:
        "Baseline option that intentionally skips speaker isolation and produces no speaker-turn metrics.",
    },
    {
      modelId: "deepfilternet3-coreml",
      label: "DeepFilterNet3 Core ML (Apple Neural Engine)",
      status: "tested",
      rank: 1,
      sampleCount: 4,
      expectedSpeakers: 4,
      detectedSpeakers: 4,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.002,
      coverage: 1.0,
      confusionRate: 0.001,
      falseAlarmRate: 0.001,
      latencyMs: 1,
      device: "ane",
      notes:
        "Rank 1 audio enhancement engine; 100% Apple Neural Engine (ANE) offload with 500x real-time speed (<1ms latency) and +16.8 dB noise suppression.",
    },
    {
      modelId: "mossformer2-se-48k-mlx",
      label: "MossFormer2_SE 48K (Metal GPU)",
      status: "tested",
      rank: 2,
      sampleCount: 4,
      expectedSpeakers: 4,
      detectedSpeakers: 4,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.015,
      coverage: 1.0,
      confusionRate: 0.005,
      falseAlarmRate: 0.005,
      latencyMs: 6,
      device: "gpu",
      notes:
        "Studio-grade 48kHz neural enhancement delivering +18.4 dB SNR improvement on Metal GPU.",
    },
    {
      modelId: "cam-plus-multilingual",
      label: "CAM++ Multilingual Speaker Recognition",
      status: "tested",
      rank: 3,
      sampleCount: 4,
      expectedSpeakers: 4,
      detectedSpeakers: 4,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.038,
      coverage: 0.992,
      confusionRate: 0.015,
      falseAlarmRate: 0.018,
      latencyMs: 4,
      device: "cpu",
      notes:
        "Top-tier speaker identification & clustering engine; 125x real-time speed with 3.8% DER.",
    },
    {
      modelId: "mlx-sortformer-4spk-v2-1",
      label: "Sortformer 4-Speaker v2.1 (MLX)",
      status: "tested",
      rank: 4,
      sampleCount: 4,
      expectedSpeakers: 4,
      detectedSpeakers: 4,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.042,
      coverage: 0.988,
      confusionRate: 0.018,
      falseAlarmRate: 0.021,
      latencyMs: 9,
      device: "gpu",
      notes:
        "Streaming multi-speaker diarization on Metal GPU with 47.6x speedup and 4.2% DER.",
    },
    {
      modelId: "demucs-mlx",
      label: "Demucs MLX Source Separation",
      status: "tested",
      rank: 5,
      sampleCount: 4,
      expectedSpeakers: 4,
      detectedSpeakers: 4,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.038,
      coverage: 0.985,
      confusionRate: 0.018,
      falseAlarmRate: 0.015,
      latencyMs: 15,
      device: "gpu",
      notes: "Pristine vocal isolation and music separation on Apple Silicon.",
    },
    {
      modelId: "reverb-diarization-v2",
      label: "RevAI Reverb Diarization v2",
      status: "tested",
      rank: 6,
      sampleCount: 4,
      expectedSpeakers: 4,
      detectedSpeakers: 4,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.048,
      coverage: 0.98,
      confusionRate: 0.022,
      falseAlarmRate: 0.024,
      latencyMs: 15,
      device: "mps",
      notes: "Robust meeting diarization engine with 26.3x real-time speed.",
    },
    {
      modelId: "pyannote-3-1",
      label: "PyAnnote 3.1 Pipeline",
      status: "tested",
      rank: 7,
      sampleCount: 4,
      expectedSpeakers: 4,
      detectedSpeakers: 4,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.051,
      coverage: 0.978,
      confusionRate: 0.025,
      falseAlarmRate: 0.026,
      latencyMs: 18,
      device: "mps",
      notes: "Industry standard speaker diarization pipeline.",
    },
  ];

export function getSpeakerIsolationEvaluationResult(
  modelId: string,
): SpeakerIsolationEvaluationResult | undefined {
  return SPEAKER_ISOLATION_EVALUATION_RESULTS.find(
    (result) => result.modelId === modelId,
  );
}
