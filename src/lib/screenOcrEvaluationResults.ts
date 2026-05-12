export type ScreenOcrEvaluationStatus = "tested" | "blocked" | "pending";

export interface ScreenOcrEvaluationResult {
  engineId: string;
  label: string;
  status: ScreenOcrEvaluationStatus;
  rank?: number;
  score?: number;
  passedCases?: number;
  totalCases?: number;
  matchedPhrases?: number;
  totalPhrases?: number;
  averageLatencyMs?: number;
  averageConfidence?: number;
  strongestCategory?: string;
  weakestCategory?: string;
  notes?: string;
}

export const SCREEN_OCR_EVALUATION_RUN = {
  generatedAt: "2026-05-12T03:24:29Z",
  suite: "Screen OCR real-world fixture benchmark",
  corpus:
    "Six generated real-world surfaces: settings, browser release note, code review, dense benchmark table, untrusted prompt-looking document, and muted note.",
  limitations:
    "Generated screenshot fixtures only. This run enumerates OCR engines that the macOS app can actually execute locally. CUDA/Linux-native, Docker-only, or upstream-incompatible OCR packages are excluded from the shippable catalog until they have a local sidecar route.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Score: required phrase recall across all fixtures.",
    "Pass: cases with every required phrase detected.",
    "Latency: average per fixture; lower is faster.",
    "Confidence is the engine-reported mean confidence when available.",
  ],
  reportPath:
    "output/screen-ocr-eval/2026-05-12T03-24-29Z/screen-ocr-summary.md",
};

export const SCREEN_OCR_EVALUATION_RESULTS: ScreenOcrEvaluationResult[] = [
  {
    engineId: "apple-vision",
    label: "Apple Vision",
    status: "tested",
    rank: 1,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 88,
    averageConfidence: 1,
    strongestCategory: "settings, code, tables, prompt-looking documents",
    weakestCategory: "not yet tested on live multilingual or rotated text",
    notes: "Native macOS Vision OCR in accurate mode with language correction.",
  },
  {
    engineId: "tessdata-best",
    label: "Tesseract tessdata_best",
    status: "tested",
    rank: 2,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 231,
    averageConfidence: 0.9450657784938813,
    notes:
      "Classic Tesseract backup route using the installed tessdata-best pack.",
  },
  {
    engineId: "pp-ocrv5",
    label: "PP-OCRv5",
    status: "tested",
    rank: 3,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 2079,
    averageConfidence: 0.9848472038904825,
    notes:
      "PaddleOCR detector/recognizer route using the installed PP-OCRv5 pack.",
  },
  {
    engineId: "lighton-ocr-2-1b",
    label: "LightOnOCR-2 1B",
    status: "tested",
    rank: 5,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 8418,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers LightOnOCR route using the installed local weights.",
  },
  {
    engineId: "chandra-ocr-2",
    label: "Chandra OCR 2",
    status: "tested",
    rank: 8,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 63431,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers VL route using the installed local weights.",
  },
  {
    engineId: "olmocr-2-7b",
    label: "olmOCR-2 7B",
    status: "tested",
    rank: 7,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 22093,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers VL route using the installed local weights.",
  },
  {
    engineId: "glm-ocr",
    label: "GLM-OCR",
    status: "tested",
    rank: 4,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 8111,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers VL route using the installed local weights.",
  },
  {
    engineId: "qwen2.5-vl-3b",
    label: "Qwen2.5-VL 3B Instruct",
    status: "tested",
    rank: 6,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 11882,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers VL route using the installed local weights.",
  },
];

export function getScreenOcrEvaluationResult(
  engineId: string,
): ScreenOcrEvaluationResult | undefined {
  return SCREEN_OCR_EVALUATION_RESULTS.find(
    (result) => result.engineId === engineId,
  );
}
