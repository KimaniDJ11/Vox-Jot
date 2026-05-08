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
  generatedAt: "2026-05-07T14:07:00-04:00",
  suite: "LLM post-process sanity",
  corpus:
    "46 real-world dictation cleanup cases from the Vox Jot audio test bank",
  limitations:
    "Pass counts include production safety fallbacks. The fallback metric shows how often output was blocked or reverted for drift, which is separate from direct model quality.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Pass and similarity: higher is better.",
    "p50 latency: lower is faster.",
    "Fallback: lower is better.",
    "Profile is informational.",
  ],
  reportPath: "output/llm-model-eval-rerun-2026-05-07",
  timeoutMs: 10000,
};

export const LLM_EVALUATION_RESULTS: LlmEvaluationResult[] = [
  {
    modelIds: ["smollm2:1.7b"],
    label: "SmolLM2 1.7B",
    status: "tested",
    rank: 1,
    passed: 24,
    totalCases: 46,
    passRate: 0.5217391304347826,
    averageSimilarity: 0.7543422083079205,
    latencyP50Ms: 432,
    latencyP95Ms: 2593,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 5,
    strongestCategory: "tone-professional and names",
    weakestCategory: "code-ish formatting",
    notes:
      "Best measured local Ollama result on the harder 46-case bank. Still weak on spoken URLs, paths, and code dictation.",
  },
  {
    modelIds: ["smollm2:360m"],
    label: "SmolLM2 360M",
    status: "tested",
    rank: 2,
    passed: 23,
    totalCases: 46,
    passRate: 0.5,
    averageSimilarity: 0.7118460404578563,
    latencyP50Ms: 250,
    latencyP95Ms: 1940,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 2,
    driftFallbacks: 3,
    strongestCategory: "names and neutral tone",
    weakestCategory: "numbers and code-ish formatting",
    notes:
      "Fastest useful local cleanup option in the full rerun, but numbers and technical dictation still need deterministic handling.",
  },
  {
    modelIds: ["phi4-mini", "phi4-mini:latest", "phi-4-mini-instruct-q4_k_m"],
    label: "Phi-4 Mini Instruct",
    status: "tested",
    rank: 3,
    passed: 22,
    totalCases: 46,
    passRate: 0.4782608695652174,
    averageSimilarity: 0.7322175916733713,
    latencyP50Ms: 851,
    latencyP95Ms: 4391,
    promptProfile: "strict_literal",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 6,
    strongestCategory: "names",
    weakestCategory: "non-speech resilience",
    notes:
      "Strict literal prompting still helps this model, but the expanded suite shows weaker latency and fewer passes than SmolLM2.",
  },
  {
    modelIds: ["qwen2.5:0.5b", "qwen2.5-0.5b-instruct-q4_k_m"],
    label: "Qwen 2.5 0.5B",
    status: "tested",
    rank: 4,
    passed: 21,
    totalCases: 46,
    passRate: 0.45652173913043476,
    averageSimilarity: 0.7187139639070924,
    latencyP50Ms: 215,
    latencyP95Ms: 1060,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 1,
    driftFallbacks: 1,
    strongestCategory: "names and tone-casual",
    weakestCategory: "disfluency and code-ish formatting",
    notes:
      "Fastest Qwen result and a good latency fallback, but it does not clean disfluencies or technical dictation reliably.",
  },
  {
    modelIds: ["tencent_hunyuan-1.8b-instruct-gguf-q4_k_m:latest"],
    label: "Hunyuan 1.8B Instruct Q4_K_M",
    status: "tested",
    rank: 5,
    passed: 21,
    totalCases: 46,
    passRate: 0.45652173913043476,
    averageSimilarity: 0.6546244469445783,
    latencyP50Ms: 2397,
    latencyP95Ms: 9066,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 14,
    strongestCategory: "names and professional tone",
    weakestCategory: "disfluency and code-ish formatting",
    notes:
      "Many passes are fallback-preserved; direct output often repeats tokens, so this is not recommended for the hot path.",
  },
  {
    modelIds: ["tinyllama:1.1b"],
    label: "TinyLlama 1.1B",
    status: "tested",
    rank: 6,
    passed: 21,
    totalCases: 46,
    passRate: 0.45652173913043476,
    averageSimilarity: 0.7075378279739167,
    latencyP50Ms: 2037,
    latencyP95Ms: 3518,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 17,
    driftFallbacks: 2,
    strongestCategory: "names and professional tone",
    weakestCategory: "numbers and direct model reliability",
    notes:
      "The guardrails save many cases, but direct model output still leaks prompt text too often.",
  },
  {
    modelIds: ["qwen2.5:1.5b", "qwen2.5-1.5b-instruct-q4_k_m"],
    label: "Qwen 2.5 1.5B",
    status: "tested",
    rank: 7,
    passed: 20,
    totalCases: 46,
    passRate: 0.43478260869565216,
    averageSimilarity: 0.7188196817297181,
    latencyP50Ms: 423,
    latencyP95Ms: 1921,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 4,
    strongestCategory: "names",
    weakestCategory: "code-ish formatting",
    notes:
      "Still usable, but the expanded bank moved it behind the smaller Qwen and both SmolLM2 models.",
  },
  {
    modelIds: ["orca-mini:3b"],
    label: "Orca Mini 3B",
    status: "tested",
    rank: 8,
    passed: 19,
    totalCases: 46,
    passRate: 0.41304347826086957,
    averageSimilarity: 0.7024868043392846,
    latencyP50Ms: 3288,
    latencyP95Ms: 8816,
    promptProfile: "standard",
    errors: 2,
    blockedCandidates: 3,
    driftFallbacks: 2,
    strongestCategory: "names",
    weakestCategory: "numbers and timeouts",
    notes:
      "Too inconsistent for latency-sensitive cleanup: two timeouts and slow p95 latency on the expanded suite.",
  },
  {
    modelIds: ["nemotron-3-nano-4b-q4_k_m:latest"],
    label: "Nemotron 3 Nano 4B Q4_K_M",
    status: "tested",
    rank: 9,
    passed: 19,
    totalCases: 46,
    passRate: 0.41304347826086957,
    averageSimilarity: 0.6770446484855689,
    latencyP50Ms: 1226,
    latencyP95Ms: 2318,
    promptProfile: "strict_literal",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 15,
    strongestCategory: "names and fallback-preserved tone",
    weakestCategory: "disfluency and fallback rate",
    notes:
      "Strict literal prompting avoids blocked outputs, but too many cases fall back to the original transcript.",
  },
  {
    modelIds: ["deepseek-coder:1.3b"],
    label: "DeepSeek Coder 1.3B",
    status: "tested",
    rank: 10,
    passed: 19,
    totalCases: 46,
    passRate: 0.41304347826086957,
    averageSimilarity: 0.654693865305129,
    latencyP50Ms: 1429,
    latencyP95Ms: 3485,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 6,
    driftFallbacks: 9,
    strongestCategory: "names",
    weakestCategory: "natural dictation cleanup",
    notes:
      "Code-tuned behavior still does not transfer well; it often explains or refuses instead of returning paste text.",
  },
  {
    modelIds: ["gemma3:1b"],
    label: "Gemma 3 1B",
    status: "tested",
    rank: 11,
    passed: 18,
    totalCases: 46,
    passRate: 0.391304347826087,
    averageSimilarity: 0.6876689442328752,
    latencyP50Ms: 829,
    latencyP95Ms: 1630,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 0,
    driftFallbacks: 3,
    strongestCategory: "names",
    weakestCategory: "numbers",
    notes:
      "Predictable latency and few fallback events, but quality is below the best SmolLM2 and Qwen options.",
  },
  {
    modelIds: ["stable-code:3b"],
    label: "Stable Code 3B",
    status: "tested",
    rank: 12,
    passed: 17,
    totalCases: 46,
    passRate: 0.3695652173913043,
    averageSimilarity: 0.5998232253920807,
    latencyP50Ms: 6551,
    latencyP95Ms: 8607,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 10,
    driftFallbacks: 2,
    strongestCategory: "names",
    weakestCategory: "prompt leakage and latency",
    notes:
      "Not recommended for dictation refinement; prompt leakage and latency are both poor.",
  },
  {
    modelIds: ["qwen_qwen3-4b-instruct-2507-gguf-q4_k_m:latest"],
    label: "Qwen3 4B Instruct Q4_K_M",
    status: "tested",
    rank: 13,
    passed: 15,
    totalCases: 46,
    passRate: 0.32608695652173914,
    averageSimilarity: 0.5245870464060113,
    latencyP50Ms: 4484,
    latencyP95Ms: 5927,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 3,
    driftFallbacks: 3,
    strongestCategory: "names",
    weakestCategory: "numbers and prompt leakage",
    notes:
      "New installed model was tested, but it leaked prompt structure and underperformed smaller local models.",
  },
  {
    modelIds: ["llama3.2:1b", "llama-3.2-1b-instruct-q4_k_m"],
    label: "Llama 3.2 1B",
    status: "tested",
    rank: 14,
    passed: 14,
    totalCases: 46,
    passRate: 0.30434782608695654,
    averageSimilarity: 0.5936666477409004,
    latencyP50Ms: 1037,
    latencyP95Ms: 2158,
    promptProfile: "standard",
    errors: 0,
    blockedCandidates: 1,
    driftFallbacks: 1,
    strongestCategory: "names",
    weakestCategory: "disfluency and list-template drift",
    notes:
      "Repeated list-template drift makes this a poor fit for current post-processing prompts.",
  },
  {
    modelIds: ["microsoft_phi-4-mini-instruct-gguf-q4_k_m:latest"],
    label: "Microsoft Phi-4 Mini Q4_K_M",
    status: "tested",
    rank: 15,
    passed: 14,
    totalCases: 46,
    passRate: 0.30434782608695654,
    averageSimilarity: 0.5587036234642582,
    latencyP50Ms: 2253,
    latencyP95Ms: 6563,
    promptProfile: "strict_literal",
    errors: 0,
    blockedCandidates: 1,
    driftFallbacks: 7,
    strongestCategory: "names",
    weakestCategory: "professional tone and prompt leakage",
    notes:
      "The GGUF install behaved much worse than the phi4-mini alias in this run, so it is tracked separately.",
  },
  {
    modelIds: ["smollm2:135m"],
    label: "SmolLM2 135M",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["llama3.2:3b", "llama-3.2-3b-instruct-q4_k_m"],
    label: "Llama 3.2 3B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["falcon3:1b"],
    label: "Falcon 3 1B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["granite3.1-dense:2b"],
    label: "Granite 3.1 Dense 2B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["granite3.1-moe:1b"],
    label: "Granite 3.1 MoE 1B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["gemma2:2b"],
    label: "Gemma 2 2B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["qwen2.5-coder:1.5b"],
    label: "Qwen 2.5 Coder 1.5B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["codegemma:2b"],
    label: "CodeGemma 2B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["phi3:mini"],
    label: "Phi-3 Mini",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["dolphin3:1b"],
    label: "Dolphin 3 1B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["mistral-small:3b"],
    label: "Mistral Small 3B",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
  },
  {
    modelIds: ["lfm2-1.2b-tool-q4_k_m"],
    label: "LFM2 1.2B Tool Q4_K_M",
    status: "pending",
    notes:
      "Listed in the app catalog but not included in the completed local benchmark batch yet.",
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
