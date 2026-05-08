export type SpeakerIsolationEvaluationStatus =
  | "tested"
  | "blocked"
  | "not_applicable";

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
  generatedAt: "2026-05-07T13:55:48Z",
  suite: "Speaker isolation real-speech turn benchmark",
  corpus:
    "Eight Mini LibriSpeech real human speech clips from four speakers, spliced into alternating turns with 300 ms pauses.",
  limitations:
    "Single synthetic turn fixture only. It does not yet cover real meetings, overlapping speech, far-field microphones, similar voices, JER, or speaker-attributed WER.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "DER: lower is better.",
    "Speakers and turns: closer to expected is better.",
    "Coverage: higher is better.",
    "Confusion and latency: lower is better.",
  ],
  reportPath: "output/speaker-isolation-eval/results-latest.json",
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
      modelId: "onnx-polyvoice-diarization",
      label: "Polyvoice ONNX Diarization",
      status: "tested",
      rank: 1,
      sampleCount: 1,
      expectedSpeakers: 4,
      detectedSpeakers: 5,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.382,
      coverage: 0.627,
      confusionRate: 0,
      falseAlarmRate: 0.01,
      latencyMs: 1186,
      device: "mps",
      notes:
        "Best local result in this pass: fastest runtime, correct turn count, and lowest DER despite over-splitting one speaker.",
    },
    {
      modelId: "nemo-sortformer-4spk-v1",
      label: "NVIDIA Sortformer 4spk v1",
      status: "tested",
      rank: 2,
      sampleCount: 1,
      expectedSpeakers: 4,
      detectedSpeakers: 3,
      expectedTurns: 8,
      detectedTurns: 8,
      diarizationErrorRate: 0.464,
      coverage: 0.691,
      confusionRate: 0.155,
      falseAlarmRate: 0,
      latencyMs: 7047,
      device: "mps",
      notes:
        "Recovered the turn structure but merged speakers; useful fallback behind Polyvoice for this fixture.",
    },
    {
      modelId: "pyannote-community-1",
      label: "PyAnnote Community-1",
      status: "tested",
      rank: 3,
      sampleCount: 1,
      expectedSpeakers: 4,
      detectedSpeakers: 1,
      expectedTurns: 8,
      detectedTurns: 10,
      diarizationErrorRate: 0.817,
      coverage: 0.671,
      confusionRate: 0.488,
      falseAlarmRate: 0,
      latencyMs: 10604,
      device: "mps",
      notes:
        "Runnable after downloading missing local assets, but collapsed the four-speaker fixture into one speaker on this pass.",
    },
    {
      modelId: "whisper-diarization",
      label: "Whisper Diarization",
      status: "tested",
      rank: 4,
      sampleCount: 1,
      expectedSpeakers: 4,
      detectedSpeakers: 1,
      expectedTurns: 8,
      detectedTurns: 10,
      diarizationErrorRate: 0.817,
      coverage: 0.671,
      confusionRate: 0.488,
      falseAlarmRate: 0,
      latencyMs: 33613,
      device: "cpu",
      notes:
        "WhisperX ASR ran, but diarization matched the one-speaker pyannote behavior and was the slowest tested option.",
    },
    {
      modelId: "reverb-diarization-v2",
      label: "Revai Reverb Diarization V2",
      status: "tested",
      rank: 5,
      sampleCount: 1,
      expectedSpeakers: 4,
      detectedSpeakers: 1,
      expectedTurns: 8,
      detectedTurns: 1,
      diarizationErrorRate: 0.878,
      coverage: 0.999,
      confusionRate: 0.745,
      falseAlarmRate: 0.132,
      latencyMs: 20424,
      device: "mps",
      notes:
        "Covered the full audio but returned one continuous speaker segment, so it is not recommended from this run.",
    },
    {
      modelId: "pyannote-3-1",
      label: "PyAnnote 3.1",
      status: "blocked",
      latencyMs: 6277,
      notes:
        "Blocked by missing Hugging Face access to the gated pyannote/segmentation-3.0 dependency.",
    },
    {
      modelId: "diarizen-wavlm-large-s80-md",
      label: "DiariZen WavLM Large S80 MD",
      status: "blocked",
      latencyMs: 5773,
      notes:
        "Weights downloaded, but the current Python runtime is incompatible with DiariZen's pyannote pipeline constructor.",
    },
  ];

export function getSpeakerIsolationEvaluationResult(
  modelId: string,
): SpeakerIsolationEvaluationResult | undefined {
  return SPEAKER_ISOLATION_EVALUATION_RESULTS.find(
    (result) => result.modelId === modelId,
  );
}
