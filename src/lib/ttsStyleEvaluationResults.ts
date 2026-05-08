export type TtsStyleEvaluationStatus = "tested" | "failed" | "blocked";

export interface TtsStyleEvaluationResult {
  modelId: string;
  label: string;
  status: TtsStyleEvaluationStatus;
  rank?: number;
  sampleCount?: number;
  passedCases?: number;
  score?: number;
  styleProxy?: number;
  asrAverageWer?: number;
  latencyP50Ms?: number;
  realTimeFactorP50?: number;
  styleCapability?:
    | "instruction_prompt"
    | "expressiveness_controls"
    | "text_only";
  listenerPreference?: number;
  notes: string;
}

export const TTS_STYLE_EVALUATION_RUN = {
  generatedAt: "2026-05-08T06:47:16Z",
  suite: "TTS style and emotion proxy benchmark",
  corpus:
    "Six style-specific readback prompts covering neutral, warm, excited, calm, urgent, and empathetic delivery. The automatic score is a proxy until blind listener ratings are collected.",
  limitations:
    "Style and emotion quality is subjective. These scores combine prosody-range fit, ASR round-trip WER, audio health, success, and real-time factor; listener preference ratings are scaffolded but not yet collected.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Score and style proxy: higher is better.",
    "ASR WER: lower is better.",
    "p50 latency and RTF: lower is faster.",
    "Control shows how directly the model accepts style instructions.",
  ],
  reportPath: "output/tts-style-eval/tts-style-eval-summary.json",
};

export const TTS_STYLE_EVALUATION_RESULTS: TtsStyleEvaluationResult[] = [
  {
    modelId: "qwen3-tts-1.7b",
    label: "MLX Qwen3 TTS 1.7B VoiceDesign",
    status: "tested",
    rank: 1,
    sampleCount: 6,
    passedCases: 6,
    score: 96.2,
    styleProxy: 0.9185,
    asrAverageWer: 0.0,
    latencyP50Ms: 5496,
    realTimeFactorP50: 1.13,
    styleCapability: "instruction_prompt",
    notes:
      "Best initial style-control result; direct instruction prompts stayed intelligible across all six styles.",
  },
  {
    modelId: "qwen3-tts-0.6b-4bit",
    label: "MLX Qwen3 TTS 0.6B 4-bit",
    status: "tested",
    rank: 2,
    sampleCount: 6,
    passedCases: 6,
    score: 94.9,
    styleProxy: 0.8766,
    asrAverageWer: 0.0104,
    latencyP50Ms: 3978,
    realTimeFactorP50: 0.82,
    styleCapability: "instruction_prompt",
    notes:
      "Strongest speed/control balance in the initial style pass, with direct prompt support and low WER.",
  },
  {
    modelId: "tts-sherpa-en-us-lessac-medium",
    label: "Sherpa Lessac Medium",
    status: "tested",
    rank: 3,
    sampleCount: 6,
    passedCases: 6,
    score: 87.9,
    styleProxy: 0.8042,
    asrAverageWer: 0.0,
    latencyP50Ms: 556,
    realTimeFactorP50: 0.14,
    styleCapability: "text_only",
    notes:
      "Fast and intelligible baseline, but style is inferred from the text only; it has no direct style-control interface.",
  },
  {
    modelId: "chatterbox",
    label: "Chatterbox",
    status: "tested",
    rank: 4,
    sampleCount: 6,
    passedCases: 6,
    score: 84.1,
    styleProxy: 0.7148,
    asrAverageWer: 0.0,
    latencyP50Ms: 19156,
    realTimeFactorP50: 4.07,
    styleCapability: "expressiveness_controls",
    notes:
      "Uses expressiveness controls rather than natural-language style prompts; intelligible but slower in this pass.",
  },
  {
    modelId: "ming-omni-0.5b",
    label: "MLX Ming-omni TTS 0.5B",
    status: "tested",
    rank: 5,
    sampleCount: 6,
    passedCases: 6,
    score: 65.0,
    styleProxy: 0.6892,
    asrAverageWer: 1.1685,
    latencyP50Ms: 5775,
    realTimeFactorP50: 0.53,
    styleCapability: "instruction_prompt",
    notes:
      "Prompt-capable, but ASR round-trip WER was poor enough that listener review is needed before trusting its style score.",
  },
];
