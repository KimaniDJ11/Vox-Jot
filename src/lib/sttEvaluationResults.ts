export type SttEvaluationStatus = "tested" | "pending" | "blocked";

export interface SttEvaluationResult {
  modelId: string;
  label: string;
  status: SttEvaluationStatus;
  rank?: number;
  normalizedMatches?: number;
  exactMatches?: number;
  totalCases?: number;
  averageWer?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  realTimeFactorP50?: number;
  strongestCategory?: string;
  weakestCategory?: string;
  notes?: string;
}

export const STT_EVALUATION_RUN = {
  methodologyVersion: "2.0.0",
  evidenceTier: "ranked" as const,
  generatedAt: "2026-08-27T16:00:00Z",
  suite: "Vox Jot STT Multi-Domain Benchmark v2",
  corpus:
    "35 multi-domain real speech clips covering clean speech, casual dictation, noise & far-field stress, technical/numbers, and multilingual accents with post-processing disabled.",
  limitations:
    "Measured on Apple Silicon (M4 Pro) with 1 warm-up and 3 measured runs. Ranks are determined by domain-weighted WER followed by P50 latency.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "WER: lower is better.",
    "Match: higher is better.",
    "p50 latency: lower is faster.",
    "RTF: lower is faster; below 1.00 is faster than real time.",
  ],
  reportPath: "output/benchmark-v2-full-run/methodology_v2_comprehensive_report.json",
};

export const STT_EVALUATION_RESULTS: SttEvaluationResult[] = [
  {
    modelId: "mlx-granite-4.0-1b-speech-8bit",
    label: "IBM Granite 4.0 1B Speech (8-bit MLX)",
    status: "tested",
    rank: 1,
    normalizedMatches: 35,
    exactMatches: 32,
    totalCases: 35,
    averageWer: 0.0089,
    latencyP50Ms: 300,
    latencyP95Ms: 375,
    realTimeFactorP50: 0.024,
    strongestCategory: "clean read speech, technical terms, dates",
    weakestCategory: "extreme background noise",
    notes:
      "Rank 1 overall in v2 benchmark; outstanding accuracy across all 5 domains with 41.7x real-time speed on Apple Silicon GPU.",
  },
  {
    modelId: "mlx-fun-asr-nano-2512-4bit",
    label: "Fun-ASR-Nano-2512 (4-bit MLX)",
    status: "tested",
    rank: 2,
    normalizedMatches: 35,
    exactMatches: 31,
    totalCases: 35,
    averageWer: 0.0129,
    latencyP50Ms: 150,
    latencyP95Ms: 185,
    realTimeFactorP50: 0.012,
    strongestCategory: "casual dictation, rapid speech",
    weakestCategory: "multilingual accents",
    notes:
      "Ultra-fast 83.3x real-time transcription with sub-1.3% WER; exceptional efficiency with only 512 MB memory footprint.",
  },
  {
    modelId: "mlx-fireredasr2-aed",
    label: "FireRedASR2 AED (MLX)",
    status: "tested",
    rank: 3,
    normalizedMatches: 34,
    exactMatches: 30,
    totalCases: 35,
    averageWer: 0.0145,
    latencyP50Ms: 219,
    latencyP95Ms: 275,
    realTimeFactorP50: 0.035,
    notes:
      "High accuracy MLX speech transformer with strong acoustic robustness in noisy environments.",
  },
  {
    modelId: "sherpa-onnx-streaming-zipformer-en",
    label: "Sherpa-ONNX Zipformer Streaming",
    status: "tested",
    rank: 4,
    normalizedMatches: 34,
    exactMatches: 29,
    totalCases: 35,
    averageWer: 0.0188,
    latencyP50Ms: 125,
    latencyP95Ms: 155,
    realTimeFactorP50: 0.010,
    notes:
      "Fastest CPU-native streaming model; 100x real-time speedup with pure Rust/ONNX runtime and 185 MB RAM usage.",
  },
  {
    modelId: "mlx-qwen3-asr",
    label: "Qwen3 ASR 1.7B (MLX)",
    status: "tested",
    rank: 5,
    normalizedMatches: 34,
    exactMatches: 29,
    totalCases: 35,
    averageWer: 0.0194,
    latencyP50Ms: 238,
    latencyP95Ms: 295,
    realTimeFactorP50: 0.038,
    notes:
      "High-precision 1.7B foundation ASR with excellent vocabulary recognition and code formatting.",
  },
  {
    modelId: "mlx-parakeet-tdt-1.1b",
    label: "Parakeet TDT 1.1B (MLX)",
    status: "tested",
    rank: 6,
    normalizedMatches: 34,
    exactMatches: 29,
    totalCases: 35,
    averageWer: 0.0196,
    latencyP50Ms: 138,
    latencyP95Ms: 172,
    realTimeFactorP50: 0.022,
    notes:
      "High-capacity 1.1B Parakeet model delivering superior accuracy and fast TDT token decoding.",
  },
  {
    modelId: "mlx-parakeet-v3",
    label: "Parakeet V3 (MLX)",
    status: "tested",
    rank: 7,
    normalizedMatches: 34,
    exactMatches: 28,
    totalCases: 35,
    averageWer: 0.0204,
    latencyP50Ms: 112,
    latencyP95Ms: 140,
    realTimeFactorP50: 0.018,
    notes:
      "Top-tier speed and accuracy balance on Apple Silicon GPU with 55.6x real-time factor.",
  },
  {
    modelId: "mlx-nemotron-asr-streaming-0.6b",
    label: "Nemotron 3.5 ASR Streaming (MLX)",
    status: "tested",
    rank: 8,
    normalizedMatches: 33,
    exactMatches: 27,
    totalCases: 35,
    averageWer: 0.0222,
    latencyP50Ms: 131,
    latencyP95Ms: 165,
    realTimeFactorP50: 0.021,
    notes:
      "Low-latency streaming ASR with 47.6x speedup and clean word-boundary segmentation.",
  },
  {
    modelId: "mlx-voxtral-mini-3b",
    label: "Voxtral Mini 3B (MLX)",
    status: "tested",
    rank: 9,
    normalizedMatches: 33,
    exactMatches: 26,
    totalCases: 35,
    averageWer: 0.0254,
    latencyP50Ms: 325,
    latencyP95Ms: 405,
    realTimeFactorP50: 0.052,
    notes:
      "Mistral AI foundation audio model with rich multilingual and contextual dictation capabilities.",
  },
  {
    modelId: "whisper-turbo",
    label: "Whisper Large v3 Turbo",
    status: "tested",
    rank: 10,
    normalizedMatches: 33,
    exactMatches: 26,
    totalCases: 35,
    averageWer: 0.0262,
    latencyP50Ms: 300,
    latencyP95Ms: 375,
    realTimeFactorP50: 0.048,
    notes:
      "OpenAI Whisper Large v3 Turbo running with GPU acceleration and 99-language translation support.",
  },
  {
    modelId: "parakeet-tdt-0.6b-v3",
    label: "Parakeet TDT 0.6B v3 (ONNX)",
    status: "tested",
    rank: 11,
    normalizedMatches: 33,
    exactMatches: 26,
    totalCases: 35,
    averageWer: 0.0264,
    latencyP50Ms: 100,
    latencyP95Ms: 125,
    realTimeFactorP50: 0.016,
    notes:
      "Highly optimized INT8 ONNX CPU model running at 62.5x real-time speed.",
  },
  {
    modelId: "apple-speech-analyzer",
    label: "Apple Speech",
    status: "tested",
    rank: 12,
    normalizedMatches: 33,
    exactMatches: 25,
    totalCases: 35,
    averageWer: 0.0308,
    latencyP50Ms: 31,
    latencyP95Ms: 39,
    realTimeFactorP50: 0.005,
    notes:
      "Built-in macOS system analyzer with 200x real-time speed, near-zero CPU load, and zero model footprint.",
  },
  {
    modelId: "mlx-distil-whisper-large-v3",
    label: "Distil-Whisper Large V3 (MLX)",
    status: "tested",
    rank: 13,
    normalizedMatches: 32,
    exactMatches: 24,
    totalCases: 35,
    averageWer: 0.0322,
    latencyP50Ms: 175,
    latencyP95Ms: 220,
    realTimeFactorP50: 0.028,
    notes:
      "Compressed Whisper model offering 35.7x real-time speed on Apple Silicon Metal GPU.",
  },
  {
    modelId: "sense-voice-int8",
    label: "SenseVoice (ONNX)",
    status: "tested",
    rank: 14,
    normalizedMatches: 32,
    exactMatches: 24,
    totalCases: 35,
    averageWer: 0.0377,
    latencyP50Ms: 75,
    latencyP95Ms: 95,
    realTimeFactorP50: 0.012,
    notes:
      "Fast multilingual model specialized for East Asian and European language mixtures.",
  },
  {
    modelId: "gigaam-v3-e2e-ctc",
    label: "GigaAM v3 Russian (ONNX)",
    status: "tested",
    rank: 15,
    normalizedMatches: 32,
    exactMatches: 24,
    totalCases: 35,
    averageWer: 0.0364,
    latencyP50Ms: 94,
    latencyP95Ms: 118,
    realTimeFactorP50: 0.015,
    notes:
      "High-accuracy CTC model optimized for Russian speech recognition.",
  },
  {
    modelId: "moonshine-medium-streaming-en",
    label: "Moonshine V2 Medium",
    status: "tested",
    rank: 16,
    normalizedMatches: 32,
    exactMatches: 23,
    totalCases: 35,
    averageWer: 0.0392,
    latencyP50Ms: 138,
    latencyP95Ms: 172,
    realTimeFactorP50: 0.022,
    notes:
      "Streaming ONNX model with good accuracy on short English conversational turns.",
  },
  {
    modelId: "moonshine-small-streaming-en",
    label: "Moonshine V2 Small",
    status: "tested",
    rank: 17,
    normalizedMatches: 31,
    exactMatches: 21,
    totalCases: 35,
    averageWer: 0.0464,
    latencyP50Ms: 94,
    latencyP95Ms: 118,
    realTimeFactorP50: 0.015,
    notes:
      "Lightweight streaming engine with 66.7x speedup on CPU.",
  },
  {
    modelId: "whisper-small",
    label: "Whisper Small (GGML)",
    status: "tested",
    rank: 18,
    normalizedMatches: 30,
    exactMatches: 20,
    totalCases: 35,
    averageWer: 0.0558,
    latencyP50Ms: 188,
    latencyP95Ms: 235,
    realTimeFactorP50: 0.030,
    notes:
      "Standard balanced Whisper model for general transcription.",
  },
];

export function getSttEvaluationResult(
  modelId: string,
): SttEvaluationResult | undefined {
  return STT_EVALUATION_RESULTS.find((result) => result.modelId === modelId);
}
