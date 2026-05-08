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
  generatedAt: "2026-05-08T12:58:31Z",
  suite: "Screen OCR real-world fixture benchmark",
  corpus:
    "Six generated real-world surfaces: settings, browser release note, code review, dense benchmark table, untrusted prompt-looking document, and muted note.",
  limitations:
    "Apple Vision fixture coverage on generated screenshots only. It does not yet cover arbitrary live websites, PDFs, multilingual text, rotated text, handwriting, or low-resolution remote desktops.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Score: required phrase recall across all fixtures.",
    "Pass: cases with every required phrase detected.",
    "Latency: average per fixture; lower is faster.",
    "Confidence is Apple Vision's reported mean confidence.",
  ],
  reportPath:
    "output/screen-ocr-eval/2026-05-08T12-58-31Z/screen-ocr-summary.md",
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
    averageLatencyMs: 94,
    averageConfidence: 1,
    strongestCategory: "settings, code, tables, prompt-looking documents",
    weakestCategory: "not yet tested on live multilingual or rotated text",
    notes:
      "Passed the hard generated fixture run with full required-phrase recall using the same Apple Vision recognition mode as the app runtime.",
  },
  {
    engineId: "tesseract-backup",
    label: "Tesseract Backup",
    status: "blocked",
    notes:
      "Not ranked on this Mac run because no local tesseract binary or bundled tessdata pack was installed.",
  },
  {
    engineId: "neural-ocr-runtime",
    label: "Neural OCR Runtime",
    status: "pending",
    notes:
      "Runtime route exists, but model-specific real-world fixtures still need to be run after selecting installed OCR models.",
  },
];

export function getScreenOcrEvaluationResult(
  engineId: string,
): ScreenOcrEvaluationResult | undefined {
  return SCREEN_OCR_EVALUATION_RESULTS.find(
    (result) => result.engineId === engineId,
  );
}
