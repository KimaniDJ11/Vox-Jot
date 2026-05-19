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
  generatedAt: "2026-05-19T22:03:49Z",
  suite: "Screen OCR real-world fixture benchmark",
  corpus:
    "Six generated real-world surfaces: settings, browser release note, code review, dense benchmark table, untrusted prompt-looking document, and muted note.",
  limitations:
    "Generated screenshot fixtures only. This run used the installed /Applications/Vox Jot.app app support model store and app-managed OCR runtime on macOS. CUDA/Linux-native, Docker-only, or upstream-incompatible OCR packages are excluded from the shippable catalog until they have a local sidecar route.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Score: required phrase recall across all fixtures.",
    "Pass: cases with every required phrase detected.",
    "Latency: average per fixture; lower is faster.",
    "Confidence is the engine-reported mean confidence when available.",
  ],
  reportPath:
    "output/screen-ocr-eval/2026-05-19T22-03-49Z/screen-ocr-summary.md",
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
    averageLatencyMs: 84,
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
    averageLatencyMs: 229,
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
    averageLatencyMs: 1493,
    averageConfidence: 0.9848472038904825,
    notes:
      "PaddleOCR detector/recognizer route using the installed app model pack and managed OCR runtime.",
  },
  {
    engineId: "lighton-ocr-2-1b",
    label: "LightOnOCR-2 1B",
    status: "tested",
    rank: 4,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 7079,
    averageConfidence: 0.6499999761581421,
    notes:
      "Transformers LightOnOCR route using the installed app model pack and managed OCR runtime.",
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
    averageLatencyMs: 56741,
    averageConfidence: 0.6499999761581421,
    notes:
      "Transformers VL route using the installed app model pack and managed OCR runtime.",
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
    averageLatencyMs: 20846,
    averageConfidence: 0.6499999761581421,
    notes:
      "Transformers VL route using the installed app model pack and managed OCR runtime.",
  },
  {
    engineId: "glm-ocr",
    label: "GLM-OCR",
    status: "tested",
    rank: 5,
    score: 100,
    passedCases: 6,
    totalCases: 6,
    matchedPhrases: 29,
    totalPhrases: 29,
    averageLatencyMs: 7180,
    averageConfidence: 0.6499999761581421,
    notes:
      "Transformers VL route using the installed app model pack and managed OCR runtime.",
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
    averageLatencyMs: 11068,
    averageConfidence: 0.6499999761581421,
    notes:
      "Transformers VL route using the installed app model pack and managed OCR runtime.",
  },
];

export function getScreenOcrEvaluationResult(
  engineId: string,
): ScreenOcrEvaluationResult | undefined {
  return SCREEN_OCR_EVALUATION_RESULTS.find(
    (result) => result.engineId === engineId,
  );
}
