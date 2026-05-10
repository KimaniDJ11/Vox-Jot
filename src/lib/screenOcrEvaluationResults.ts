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
  generatedAt: "2026-05-08T19:24:09Z",
  suite: "Screen OCR real-world fixture benchmark",
  corpus:
    "Six generated real-world surfaces: settings, browser release note, code review, dense benchmark table, untrusted prompt-looking document, and muted note.",
  limitations:
    "Generated screenshot fixtures only. This run enumerates the real app OCR model directory. Blocked rows are installed or cataloged engines whose local model package is incompatible with the current macOS OCR runtime loader.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Score: required phrase recall across all fixtures.",
    "Pass: cases with every required phrase detected.",
    "Latency: average per fixture; lower is faster.",
    "Confidence is the engine-reported mean confidence when available.",
  ],
  reportPath:
    "output/screen-ocr-eval/2026-05-08T19-24-09Z/screen-ocr-summary.md",
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
    averageLatencyMs: 89,
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
    averageLatencyMs: 1537,
    averageConfidence: 0.9848472038904825,
    notes:
      "PaddleOCR detector/recognizer route using the installed PP-OCRv5 pack.",
  },
  {
    engineId: "paddleocr-vl-1.5",
    label: "PaddleOCR-VL 1.5",
    status: "blocked",
    totalCases: 6,
    totalPhrases: 29,
    notes:
      "Installed, but the local Transformers package cannot instantiate this mirror because the model config is missing the expected text_config.",
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
    averageLatencyMs: 6751,
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
    averageLatencyMs: 55933,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers VL route using the installed local weights.",
  },
  {
    engineId: "dots-ocr",
    label: "Dots.OCR",
    status: "blocked",
    totalCases: 6,
    totalPhrases: 29,
    notes:
      "Installed and dependencies are present, but the current Transformers 5 generation path fails inside the Dots.OCR remote code on macOS.",
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
    averageLatencyMs: 20507,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers VL route using the installed local weights.",
  },
  {
    engineId: "deepseek-ocr-2",
    label: "DeepSeek-OCR 2",
    status: "blocked",
    totalCases: 6,
    totalPhrases: 29,
    notes:
      "Installed, but the DeepSeek-OCR 2 remote code targets a Transformers API path that is not available in the current shared Transformers 5 runtime.",
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
    averageLatencyMs: 7127,
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
    averageLatencyMs: 11083,
    averageConfidence: 0.6499999761581421,
    notes: "Transformers VL route using the installed local weights.",
  },
  {
    engineId: "nemotron-ocr-v2",
    label: "Nemotron OCR v2",
    status: "blocked",
    totalCases: 6,
    totalPhrases: 29,
    notes:
      "Installed, but this package is not a Transformers OCR model; it ships a custom Nemotron OCR runtime with native extensions that is not wired into the macOS OCR sidecar.",
  },
];

export function getScreenOcrEvaluationResult(
  engineId: string,
): ScreenOcrEvaluationResult | undefined {
  return SCREEN_OCR_EVALUATION_RESULTS.find(
    (result) => result.engineId === engineId,
  );
}
