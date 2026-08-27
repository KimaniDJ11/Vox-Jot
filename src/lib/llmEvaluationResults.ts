export type LlmEvaluationStatus = "tested" | "pending";

export interface LlmEvaluationResult {
  modelIds: string[];
  label: string;
  status: LlmEvaluationStatus;
  rank?: number;
  passed?: number;
  totalCases?: number;
  passRate?: number;
  averageSimilarity?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  promptProfile?: string;
  errors?: number;
  blockedCandidates?: number;
  driftFallbacks?: number;
  strongestCategory?: string;
  weakestCategory?: string;
  notes?: string;
}

export const LLM_EVALUATION_RUN = {
  methodologyVersion: "2.0.0",
  evidenceTier: "ranked" as const,
  generatedAt: "2026-08-27T16:00:00Z",
  suite: "Vox Jot Refine SLM Post-Processing Benchmark v2",
  corpus:
    "46 real-world dictation cleanup cases evaluated across 8 domains (corrections, disfluency, formatting, lists, numbers/names, code/symbols, passthrough, adversarial non-speech) at temperature 0 with strict Zero-Drift reporting.",
  limitations:
    "Direct model accuracy and drift rate are measured separately from safety fallbacks. Evaluated on Apple Silicon M4 Pro.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Pass and similarity: higher is better.",
    "p50 latency: lower is faster.",
    "Fallback: lower is better.",
    "Zero-Drift: higher purity means zero hallucinated content.",
  ],
  reportPath: "output/benchmark-v2-full-run/methodology_v2_comprehensive_report.json",
  timeoutMs: 10000,
};

export const LLM_EVALUATION_RESULTS: LlmEvaluationResult[] = [
  {
    modelIds: ["qwen3.5:4b", "qwen3.5-4b-q4km"],
    label: "Qwen3.5 4B (Q4_K_M)",
    status: "tested",
    rank: 1,
    passed: 46,
    totalCases: 46,
    passRate: 1.0,
    averageSimilarity: 0.96,
    latencyP50Ms: 135,
    latencyP95Ms: 182,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 0,
    strongestCategory: "complex code formatting, nested lists, names",
    weakestCategory: "none (100% pass rate)",
    notes:
      "Flawless 100% pass rate on all 46 dictation test cases with 99.8% zero-drift purity.",
  },
  {
    modelIds: ["qwen3.5:2b", "qwen3.5-2b-q4km"],
    label: "Qwen3.5 2B (Q4_K_M)",
    status: "tested",
    rank: 2,
    passed: 44,
    totalCases: 46,
    passRate: 0.9565,
    averageSimilarity: 0.92,
    latencyP50Ms: 68,
    latencyP95Ms: 92,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 1,
    strongestCategory: "disfluency removal, formatting",
    weakestCategory: "adversarial edge cases",
    notes:
      "Sweet-spot for dictation post-processing: 142 tokens/sec throughput with 95.7% accuracy and 68ms P50 latency.",
  },
  {
    modelIds: ["deepseek-r1-distill-qwen:1.5b", "deepseek-r1-distill-qwen-1.5b"],
    label: "DeepSeek-R1-Distill-Qwen 1.5B",
    status: "tested",
    rank: 3,
    passed: 44,
    totalCases: 46,
    passRate: 0.9565,
    averageSimilarity: 0.92,
    latencyP50Ms: 58,
    latencyP95Ms: 78,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 1,
    strongestCategory: "technical reasoning, code cleanup",
    weakestCategory: "casual conversational filler",
    notes:
      "Reasoning-distilled 1.5B model delivering 165 tokens/sec and 58ms latency.",
  },
  {
    modelIds: ["granite-4.0-micro:3b", "granite-4.0-micro-3b"],
    label: "IBM Granite 4.0 Micro 3B",
    status: "tested",
    rank: 4,
    passed: 44,
    totalCases: 46,
    passRate: 0.9565,
    averageSimilarity: 0.90,
    latencyP50Ms: 105,
    latencyP95Ms: 142,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 0,
    strongestCategory: "enterprise formatting, strict adherence",
    weakestCategory: "creative rephrasing",
    notes:
      "Enterprise-grade stability with 99.5% zero-drift purity and zero hallucinations.",
  },
  {
    modelIds: ["smollm3:3b", "smollm3-3b-q4km"],
    label: "SmolLM3 3B Instruct",
    status: "tested",
    rank: 5,
    passed: 44,
    totalCases: 46,
    passRate: 0.9565,
    averageSimilarity: 0.91,
    latencyP50Ms: 112,
    latencyP95Ms: 151,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 1,
    strongestCategory: "long-context post-processing, lists",
    weakestCategory: "nested code blocks",
    notes:
      "128k context support with dual-mode thinking; strong instruction following across all domains.",
  },
  {
    modelIds: ["qwen3.5:0.8b", "qwen3.5-0.8b-q4km"],
    label: "Qwen3.5 0.8B (Q4_K_M)",
    status: "tested",
    rank: 6,
    passed: 41,
    totalCases: 46,
    passRate: 0.8913,
    averageSimilarity: 0.85,
    latencyP50Ms: 45,
    latencyP95Ms: 61,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 2,
    strongestCategory: "instant disfluency cleanup",
    weakestCategory: "complex nested markdown tables",
    notes:
      "Ultra-fast 215 tokens/sec processing with 45ms P50 latency and tiny 508 MB footprint.",
  },
  {
    modelIds: ["lfm2.5:2.6b", "lfm2.5-2.6b-q4km"],
    label: "Liquid AI LFM2.5 2.6B",
    status: "tested",
    rank: 7,
    passed: 41,
    totalCases: 46,
    passRate: 0.8913,
    averageSimilarity: 0.86,
    latencyP50Ms: 82,
    latencyP95Ms: 110,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 3,
    strongestCategory: "edge tool routing, state cleanup",
    weakestCategory: "adversarial non-speech",
    notes:
      "Liquid Neural Network architecture offering efficient 115 tokens/sec inference.",
  },
  {
    modelIds: ["phi4-mini"],
    label: "Phi-4 Mini Instruct (3.8B)",
    status: "tested",
    rank: 8,
    passed: 44,
    totalCases: 46,
    passRate: 0.9565,
    averageSimilarity: 0.91,
    latencyP50Ms: 142,
    latencyP95Ms: 192,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 1,
    strongestCategory: "instruction following, structured output",
    weakestCategory: "latency overhead",
    notes:
      "Microsoft 3.8B model with strong formatting precision.",
  },
  {
    modelIds: ["smollm2:1.7b"],
    label: "SmolLM2 1.7B",
    status: "tested",
    rank: 9,
    passed: 39,
    totalCases: 46,
    passRate: 0.8478,
    averageSimilarity: 0.78,
    latencyP50Ms: 72,
    latencyP95Ms: 98,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 4,
    strongestCategory: "tone-professional and names",
    weakestCategory: "code-ish formatting",
    notes:
      "Compact 1.7B model with good general cleanup.",
  },
];

export function getLlmEvaluationResult(
  modelId: string,
): LlmEvaluationResult | undefined {
  const normalizedModelId = modelId.trim().replace(/:latest$/, "");
  return LLM_EVALUATION_RESULTS.find((result) =>
    result.modelIds.some((id) => {
      const normalizedId = id.trim().replace(/:latest$/, "");
      return normalizedId === normalizedModelId;
    }),
  );
}
