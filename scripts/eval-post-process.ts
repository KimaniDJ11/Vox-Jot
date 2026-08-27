#!/usr/bin/env bun
/**
 * Post-processing evaluation script for Vox Jot dictation corpus.
 *
 * This script evaluates the LLM post-processing pipeline by sending raw STT
 * text through the same provider shape the app uses and comparing the final
 * paste candidate against expected results.
 *
 * Usage:
 *   bun run scripts/eval-post-process.ts
 *   bun run scripts/eval-post-process.ts --provider openai --model gpt-4o-mini
 *   bun run scripts/eval-post-process.ts --provider ollama --base-url http://localhost:11434/v1
 *   bun run scripts/eval-post-process.ts --force-llm-on-skip  # Model capability mode
 *   bun run scripts/eval-post-process.ts --exact-match         # Strict spelling/eval gates
 *   bun run scripts/eval-post-process.ts --prompt-profile auto # Model-specific prompt profile
 *   bun run scripts/eval-post-process.ts --dry-run          # Route analysis only, no LLM calls
 *   bun run scripts/eval-post-process.ts --cases test-data/dictation-corpus/cases.json
 *
 * Environment variables:
 *   OPENAI_API_KEY     - API key for OpenAI provider (default)
 *   OPENROUTER_API_KEY - API key for OpenRouter
 *   LLM_API_KEY        - Generic API key override
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCase {
  id: string;
  raw_stt: string;
  expected_output: string;
  category: string;
  notes?: string;
  tone?: "neutral" | "casual" | "professional" | "coding";
}

interface CasesFile {
  metadata: Record<string, unknown>;
  cases: TestCase[];
}

interface RouteFeatures {
  word_count: number;
  has_correction_cue: boolean;
  has_list_cue: boolean;
  has_paragraph_cue: boolean;
  has_transform_cue: boolean;
  has_technical_tokens: boolean;
  looks_incomplete: boolean;
}

type PostProcessPass = "skip" | "pass1" | "pass2" | "command";
type PromptProfile =
  "auto" | "standard" | "compact_final_text" | "strict_literal";

interface RouteAnalysis {
  route: PostProcessPass;
  score: number;
  features: RouteFeatures;
  rewrite_strength: number;
}

interface EvalResult {
  id: string;
  category: string;
  raw_stt: string;
  expected_output: string;
  actual_output: string | null;
  route: RouteAnalysis;
  match: boolean;
  exact_match: boolean;
  similarity: number;
  duration_ms?: number;
  completion_tokens?: number;
  output_tokens_per_second?: number;
  raw_model_zero_drift?: boolean;
  unsolicited_tokens?: string[];
  skipped_llm: boolean;
  blocked_candidate?: boolean;
  drift_fallback?: boolean;
  raw_model_output?: string;
  notes?: string;
  error?: string;
}

interface EvalSummary {
  provider: string;
  model: string;
  mode: string;
  force_llm_on_skip: boolean;
  prompt_profile: PromptProfile;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  blocked_candidates: number;
  drift_fallbacks: number;
  exact_matches: number;
  pass_rate: number;
  avg_similarity: number;
  latency_p50_ms?: number;
  latency_p95_ms?: number;
  zero_drift_passes: number;
  zero_drift_evaluated: number;
  zero_drift_purity?: number;
  output_tokens_per_second?: number;
  by_category: Record<
    string,
    { total: number; passed: number; avg_similarity: number }
  >;
  results: EvalResult[];
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  casesPath: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  mode: "literal" | "intent";
  maxRewriteStrength: number;
  dryRun: boolean;
  outputDir: string;
  concurrency: number;
  forceLlmOnSkip: boolean;
  exactMatch: boolean;
  matchThreshold: number;
  timeoutMs: number;
  promptProfile: PromptProfile;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const provider = get("--provider", "openai");
  const model = get("--model", "gpt-4o-mini");
  const baseUrl = get(
    "--base-url",
    provider === "ollama"
      ? "http://localhost:11434/v1"
      : provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : "https://api.openai.com/v1",
  );

  const apiKey =
    get("--api-key", "") ||
    process.env.LLM_API_KEY ||
    (provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY || ""
      : process.env.OPENAI_API_KEY || "");

  return {
    casesPath: get(
      "--cases",
      resolve(__dirname, "../test-data/dictation-corpus/cases.json"),
    ),
    provider,
    model,
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    mode: get("--mode", "intent") as "literal" | "intent",
    maxRewriteStrength: parseInt(get("--strength", "2"), 10),
    dryRun: has("--dry-run"),
    outputDir: get("--output-dir", resolve(__dirname, "../output/eval")),
    concurrency: parseInt(get("--concurrency", "4"), 10),
    forceLlmOnSkip: has("--force-llm-on-skip"),
    exactMatch: has("--exact-match"),
    matchThreshold: parseFloat(get("--match-threshold", "0.85")),
    timeoutMs: parseInt(get("--timeout-ms", "0"), 10),
    promptProfile: get("--prompt-profile", "auto") as PromptProfile,
  };
}

// ---------------------------------------------------------------------------
// Route analysis (mirrors Rust logic from actions.rs)
// ---------------------------------------------------------------------------

function containsAnyCi(text: string, cues: string[]): boolean {
  const lower = text.toLowerCase();
  return cues.some((cue) => lower.includes(cue));
}

function normalizeMatchText(text: string): string {
  return text.split(/\s+/).join(" ").toLowerCase();
}

function hasSpokeNCorrectionRestart(text: string): boolean {
  const normalized = normalizeMatchText(text);
  const directCues = [
    "scratch that",
    "i mean",
    "correction",
    "actually",
    "wait no",
    "no wait",
    "rather",
    "no sorry",
  ];
  if (directCues.some((cue) => normalized.includes(cue))) return true;

  const restartMarkers = [
    ", no, ",
    ". no, ",
    "? no, ",
    "! no, ",
    "; no, ",
    ": no, ",
    ", sorry, ",
    ". sorry, ",
    "? sorry, ",
    "! sorry, ",
    "; sorry, ",
    ": sorry, ",
  ];
  return restartMarkers.some((marker) => normalized.includes(marker));
}

function looksLikeShortItemSeries(text: string): boolean {
  const items = text
    .split(",")
    .map((item) => item.trim().replace(/^[.,:;!?]+|[.,:;!?]+$/g, ""))
    .filter((item) => item.length > 0);
  if (items.length < 3) return false;
  return items.every((item) => {
    const wc = item.split(/\s+/).length;
    return (
      wc > 0 &&
      wc <= 4 &&
      !containsAnyCi(item, [" and ", " or ", " because ", " but ", " if "])
    );
  });
}

function hasIntroShortItems(text: string): boolean {
  const introCues = [
    "list",
    "things",
    "items",
    "store",
    "shopping",
    "grocery",
    "groceries",
    "verification",
    "verifications",
    "request",
    "pick up",
    "buy",
    "bring",
    "pack",
    "ingredients",
    "tasks",
    "to do",
    "todo",
    "goals",
  ];

  for (const sep of [".", ":", "\n"]) {
    const idx = text.indexOf(sep);
    if (idx < 0) continue;
    const intro = text.slice(0, idx).trim();
    const tail = text.slice(idx + 1).trim();
    if (intro.split(/\s+/).length < 4 || tail.length === 0) continue;
    if (containsAnyCi(intro, introCues) && looksLikeShortItemSeries(tail))
      return true;
  }
  return false;
}

function hasTechnicalTokens(text: string): boolean {
  const lower = text.toLowerCase();
  const strong = [
    "http://",
    "https://",
    "www.",
    "@",
    "src/",
    ".tsx",
    ".ts",
    ".rs",
  ];
  if (strong.some((t) => lower.includes(t))) return true;
  return [...text].some((c) =>
    ["/", "\\", "_", "{", "}", "[", "]", "<", ">", "`"].includes(c),
  );
}

function looksIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const last = trimmed[trimmed.length - 1];
  if ([".", "!", "?"].includes(last)) return false;
  if (last === ",") return true;
  const lower = trimmed.toLowerCase();
  const cues = [" and", " or", " to", " for", " with", " because", " but"];
  return cues.some((cue) => lower.endsWith(cue));
}

function hasOrdinalListCues(text: string): boolean {
  const lower = text.toLowerCase();
  const ordinalWords = [
    "first",
    "second",
    "third",
    "next",
    "then",
    "one",
    "two",
    "three",
  ];
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const hitCount = ordinalWords.filter((cue) => words.includes(cue)).length;
  return hitCount >= 2 && lower.split(/\s+/).filter(Boolean).length >= 8;
}

function fillerDensity(text: string): number {
  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return 0;

  const singleWordFillers = new Set(["um", "uh", "erm", "hmm", "like"]);
  let fillerHits = words.filter((word) => singleWordFillers.has(word)).length;
  const normalized = normalizeMatchText(text);
  for (const phrase of ["you know", "i mean", "kind of", "sort of"]) {
    if (normalized.includes(phrase)) {
      fillerHits += phrase.split(/\s+/).length;
    }
  }

  return fillerHits / words.length;
}

function shouldInvokeLlmPostProcess(
  features: RouteFeatures,
  transcription: string,
): boolean {
  return (
    features.has_transform_cue ||
    features.has_correction_cue ||
    features.has_list_cue ||
    features.has_paragraph_cue ||
    features.word_count > 15 ||
    fillerDensity(transcription) >= 0.12
  );
}

function extractRouteFeatures(text: string): RouteFeatures {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const listCues = [
    "grocery list",
    "shopping list",
    "packing list",
    "required verification",
    "required verifications",
    "verification request",
    "verification requests",
  ];
  const paragraphCues = ["new line", "new paragraph", "skip a line"];
  const transformCues = [
    "make this shorter",
    "translate this",
    "turn this into",
    "rewrite this",
    "summarize this",
  ];

  return {
    word_count: words.length,
    has_correction_cue: hasSpokeNCorrectionRestart(trimmed),
    has_list_cue:
      containsAnyCi(trimmed, listCues) ||
      hasOrdinalListCues(trimmed) ||
      hasIntroShortItems(trimmed),
    has_paragraph_cue: containsAnyCi(trimmed, paragraphCues),
    has_transform_cue: containsAnyCi(trimmed, transformCues),
    has_technical_tokens: hasTechnicalTokens(trimmed),
    looks_incomplete: looksIncomplete(trimmed),
  };
}

function routeScore(f: RouteFeatures): number {
  let score = 0;
  if (f.has_correction_cue) score += 3;
  if (f.has_list_cue) score += 3;
  if (f.has_paragraph_cue) score += 2;
  if (f.word_count >= 12) score += 1;
  if (f.has_technical_tokens) score -= 2;
  return score;
}

function choosePass(text: string): PostProcessPass {
  const trimmed = text.trim();
  if (!trimmed) return "skip";
  const features = extractRouteFeatures(trimmed);
  if (features.has_transform_cue) return "command";
  if (features.word_count <= 3) return "skip";
  if (features.looks_incomplete) return "pass1";
  if (!shouldInvokeLlmPostProcess(features, trimmed)) {
    return "skip";
  }

  return routeScore(features) >= 3 ? "pass2" : "pass1";
}

function analyzeRoute(text: string, maxStrength: number): RouteAnalysis {
  const features = extractRouteFeatures(text);
  const route = choosePass(text);
  const score = routeScore(features);

  let rewrite_strength: number;
  if (route === "pass1") {
    rewrite_strength = Math.min(maxStrength, 1);
  } else if (route === "pass2") {
    const prefersStronger =
      features.has_list_cue &&
      (features.has_correction_cue || features.word_count >= 10);
    rewrite_strength = prefersStronger ? Math.max(maxStrength, 2) : maxStrength;
  } else {
    rewrite_strength = 2;
  }

  return { route, score, features, rewrite_strength };
}

// ---------------------------------------------------------------------------
// Tone definitions (mirrors Rust default_tone_definitions from settings.rs)
// ---------------------------------------------------------------------------

const TONE_INSTRUCTIONS: Record<string, string> = {
  neutral: "Keep the tone neutral and close to the speaker's original wording.",
  casual:
    "Use a casual, conversational tone suitable for quick chat messages while preserving meaning.",
  professional:
    "Use a polished, professional tone suitable for email or documents while preserving meaning.",
  coding:
    "Format the text as precise technical writing suited for code editors and terminals. " +
    "Use exact technical terms, preserve variable and function names verbatim, " +
    "format code snippets with proper syntax, and keep comments concise. " +
    "Convert spoken code descriptions into valid code when the intent is clear " +
    '(e.g., "define a function called foo that takes a string" → "fn foo(s: &str)"). ' +
    "Prefer lowercase and avoid unnecessary punctuation.",
};

function promptProfileForModel(
  modelId: string,
): Exclude<PromptProfile, "auto"> {
  const normalized = modelId
    .trim()
    .toLowerCase()
    .replace(/:latest$/, "");
  if (
    normalized.includes("phi4-mini") ||
    normalized.includes("phi-4-mini") ||
    normalized.includes("microsoft_phi-4-mini") ||
    normalized.includes("nemotron")
  ) {
    return "strict_literal";
  }
  return "standard";
}

function resolvePromptProfile(
  requestedProfile: PromptProfile,
  modelId: string,
): Exclude<PromptProfile, "auto"> {
  return requestedProfile === "auto"
    ? promptProfileForModel(modelId)
    : requestedProfile;
}

function buildSystemPrompt(
  mode: "literal" | "intent",
  rewriteStrength: number,
  tone: string = "neutral",
  profile: Exclude<PromptProfile, "auto"> = "standard",
): string {
  const toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.neutral;
  const toneAppName =
    tone === "coding"
      ? "VS Code"
      : tone === "casual"
        ? "Slack"
        : tone === "professional"
          ? "Mail"
          : "Notes";
  const toneRule = `- ${toneAppName} (tone: ${tone}): ${toneInstruction}`;

  if (profile === "compact_final_text") {
    return `You clean dictation text.
Return only the final cleaned transcript text.
Never output labels, explanations, apologies, markdown fences, rule text, or delimiters.
Mode: ${mode}. Rewrite strength: ${rewriteStrength}.
Rules: preserve meaning exactly; make the smallest safe change; remove obvious fillers and false starts; keep only corrected wording after clear restarts; fix obvious capitalization and punctuation; preserve names, URLs, emails, file paths, code terms, numbers, and symbols; convert spoken punctuation like slash, dot, colon, at, dash, period, comma, question mark, and exclamation point only when clearly intentional.
If unsure, copy the transcript exactly.
Tone: ${toneAppName} tone: ${toneInstruction}.`;
  }

  let prompt = `You are a local dictation post-processor.

Task:
Clean speech-to-text output while preserving the speaker's meaning exactly.

Active mode: ${mode}
Rewrite strength: ${rewriteStrength} (0=conservative, 2=aggressive)

Return only the final text.

Rules:
- Preserve meaning and the speaker's intended correction.
- Never invent facts, headings, commentary, explanations, or extra detail.
- Apply personal dictionary spellings exactly when they appear in the transcript.
- Preserve names, acronyms, URLs, emails, filenames, code terms, variable names, product names, unusual proper nouns, and technical jargon unless the speaker clearly corrected them.
- Preserve technical punctuation and symbols when they are likely intentional, including slashes, backslashes, underscores, hyphens, periods, colons, parentheses, brackets, quotes, @ symbols, plus signs, minus signs, and file extensions.
- Do not wrap URLs, file paths, code terms, or corrected punctuation in quotes or backticks unless the transcript explicitly includes them.
- Fix capitalization, punctuation, spacing, paragraph breaks, and formatting only when the intended structure is reasonably clear.
- Interpret spoken correction cues such as "scratch that", "actually", "I mean", "correction", "wait no", "no wait", "rather", "no sorry", and natural restarts, and keep only the corrected intent.
- Remove filler words, false starts, and repeated fragments only when doing so does not change meaning.
- If the transcript is already clear, make the smallest possible changes.
- Use stronger rewrites only when clear structure, correction, or formatting cues are present.
- If multiple interpretations are possible, choose the most conservative one.
- If the utterance seems incomplete, ambiguous, cut off, or mid-thought, avoid heavy rewriting and stay close to the transcript.
- Structure rules:
- Do not force bullets, numbering, or heavy formatting unless structure is clearly implied.
- If the transcript contains an introductory sentence that implies a list, followed by two or more short parallel items, format the items as a bullet list and end the intro sentence with a colon.
- Treat groceries, packing items, tasks, ingredients, feature lists, names, and short noun phrases as strong list candidates when grouped together.
- You may infer list item boundaries from repeated short noun phrases even when the transcript has little or no punctuation.
- Treat joiners such as "and", "also", and "plus" as list separators when the content is clearly list-like.
- When you turn an intro sentence plus short items into an unordered list, keep the intro sentence and use \`* \` bullets for each item.
- If sequence words or ordered cues appear, such as "one", "two", "three", "first", "second", "next", or "finally", prefer a numbered list when the content is clearly step-like or ordered.
- If the user clearly dictated separate thoughts, insert paragraph breaks.
- If the user says "new line", "new paragraph", "skip a line", or equivalent phrasing, reflect that structure in the final text when it fits naturally.
- If punctuation words are spoken explicitly, such as "period", "comma", "question mark", "exclamation point", or "colon", respect them when they appear intentional.
- Convert intentional spoken punctuation and separators such as "slash", "dot", "underscore", "dash", "colon", "at", "period", "comma", "question mark", and "exclamation point" when the transcript is clearly a URL, email, file path, command, variable, or dictated punctuation.
- If the content is ordinary prose, keep it as ordinary prose rather than converting it into a list.
- Mode behavior:
- In literal mode, preserve wording as much as possible.
- In intent mode, lightly clean for readability while preserving tone, specificity, and meaning.
- In intent mode, convert obvious rambling speech into clean written text only when the meaning is unmistakable.
- Do not summarize, shorten, or formalize unless the transcript itself clearly signals that intent.
- Correction behavior:
- When the speaker revises a phrase mid-sentence, keep the final intended wording and remove the abandoned wording.
- When the speaker restates something more clearly, prefer the later phrasing if it is obviously a replacement rather than an addition.
- Treat a later contradiction or restart as a replacement when the intent is clear, including patterns like "...? No, ..." and "..., no, ...".
- When a correction cue appears inside a list or sequence of short items, replace only the item being corrected and keep the surrounding items.
- If a correction is unclear, preserve the original wording instead of guessing.
- Safety behavior:
- Do not guess unknown jargon.
- Do not replace uncommon words with more common words unless the speaker clearly intended that.
- Do not convert uncertain technical text into plain English.
- Do not add markdown headings, explanations, labels, or surrounding quotation marks.

Active app guidance:
- ${toneRule}

- Output:
- Return only the final processed text.
- Do not explain changes.
- Do not mention rules.

CRITICAL OUTPUT CONSTRAINT:
- You must output the corrected transcript text only.
- Never ask for more context.
- Never apologize.
- Never explain what you are doing.
- If the transcript is a single word or fragment, return just that word or fragment.`;

  if (profile === "strict_literal") {
    prompt += `

Model-specific guardrail:
- This model tends to paraphrase. Prefer copying the transcript with only obvious fixes.
- Do not shorten, summarize, formalize, infer missing intent, or replace words with synonyms.
- Preserve question/request shape, times, places, names, and abbreviations exactly unless clearly corrected.
- If the safest cleaned text is the original transcript, return the original transcript.`;
  }

  return prompt;
}

function buildUserContent(
  mode: "literal" | "intent",
  text: string,
  rewriteStrength: number,
  profile: Exclude<PromptProfile, "auto"> = "standard",
): string {
  if (profile === "compact_final_text") {
    return `Dictionary: none
Boundary: normal.
Transcript start
${text}
Transcript end`;
  }

  let content = `Mode: ${mode}
Rewrite strength: ${rewriteStrength}
Utterance boundary confidence: sufficient for normal formatting rules.

Special handling:
- If the transcript corrects itself with a later "no", "sorry", "actually", or similar restart, keep only the corrected wording.
- If the transcript has an intro sentence followed by short list items, keep the intro sentence and format the items as \`* \` bullets.
- If a correction happens inside a list of short items, replace only the corrected item and keep the items after it.
- Convert intentional spoken punctuation and separators such as "slash", "dot", "underscore", "dash", "colon", "at", "period", "comma", "question mark", and "exclamation point" when the transcript is clearly a URL, email, file path, command, variable, or dictated punctuation.
- You may infer list boundaries from repeated short phrases even when commas are missing, especially for request, checklist, or verification-style content.

Personal dictionary:
- (none)

Transcript:
${text}`;

  if (profile === "strict_literal") {
    content +=
      "\n\nModel-specific reminder:\nReturn the final transcript only. Preserve original wording unless a correction or formatting fix is obvious.";
  }

  return content;
}

// ---------------------------------------------------------------------------
// LLM client
// ---------------------------------------------------------------------------

interface LLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

interface LLMCallResult {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  generationDurationMs?: number;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
  return AbortSignal.timeout(timeoutMs);
}

function estimateTextTokens(text: string): number {
  return Math.ceil([...text].length / 4);
}

function estimateMaxOutputTokens(
  userContent: string,
  systemPrompt: string,
): number {
  const estimatedInputTokens =
    estimateTextTokens(userContent) + estimateTextTokens(systemPrompt);
  return Math.min(Math.max(Math.ceil(estimatedInputTokens * 1.3), 64), 256);
}

async function callLLM(
  config: LLMConfig,
  systemPrompt: string,
  userContent: string,
): Promise<LLMCallResult> {
  if (config.provider === "ollama") {
    return callOllama(config, systemPrompt, userContent);
  }

  const url = `${config.baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0,
    max_tokens: estimateMaxOutputTokens(userContent, systemPrompt),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: timeoutSignal(config.timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM API error ${response.status}: ${errorText.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content;
  return {
    content: content?.trim() ?? "",
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

async function callOllama(
  config: LLMConfig,
  systemPrompt: string,
  userContent: string,
): Promise<LLMCallResult> {
  const rootUrl = config.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const url = `${rootUrl}/api/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: timeoutSignal(config.timeoutMs),
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      stream: false,
      keep_alive: "30m",
      options: {
        num_predict: estimateMaxOutputTokens(userContent, systemPrompt),
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Ollama API error ${response.status}: ${errorText.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    error?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    eval_duration?: number;
  };
  if (data.error) throw new Error(`Ollama returned an error: ${data.error}`);
  const content = data.message?.content;
  return {
    content: content?.trim() ?? "",
    promptTokens: data.prompt_eval_count,
    completionTokens: data.eval_count,
    generationDurationMs:
      data.eval_duration === undefined
        ? undefined
        : data.eval_duration / 1_000_000,
  };
}

function normalizedSemanticTokens(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
  );
}

function findUnsolicitedTokens(
  rawStt: string,
  expectedOutput: string,
  candidate: string,
): string[] {
  const tokenCounts = (text: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const token of normalizedSemanticTokens(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
  };
  const rawCounts = tokenCounts(rawStt);
  const expectedCounts = tokenCounts(expectedOutput);
  const allowed = new Map<string, number>();
  for (const token of new Set([
    ...rawCounts.keys(),
    ...expectedCounts.keys(),
  ])) {
    allowed.set(
      token,
      Math.max(rawCounts.get(token) ?? 0, expectedCounts.get(token) ?? 0),
    );
  }
  const unsolicited: string[] = [];
  for (const token of normalizedSemanticTokens(candidate)) {
    const remaining = allowed.get(token) ?? 0;
    if (remaining > 0) {
      allowed.set(token, remaining - 1);
    } else {
      unsolicited.push(token);
    }
  }
  return unsolicited;
}

// ---------------------------------------------------------------------------
// Production-style output guards (mirrors src-tauri/src/actions/sanitize.rs)
// ---------------------------------------------------------------------------

function stripInvisibleChars(text: string): string {
  return text.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
}

function stripCommonOutputLabel(text: string): string | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const first = lines[0].trim().toLowerCase();
  const labeledPrefixes = [
    "here is the cleaned transcript",
    "here's the cleaned transcript",
    "cleaned transcript",
    "corrected transcript",
    "final transcript",
    "final text",
    "rewritten text",
    "transcription",
    "output",
  ];
  if (
    labeledPrefixes.some((prefix) => first === prefix || first === `${prefix}:`)
  ) {
    const rest = lines.slice(1).join("\n").trim();
    return rest || null;
  }
  return null;
}

function stripWrappingQuotes(text: string): string {
  const trimmed = text.trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
  ];
  for (const [left, right] of pairs) {
    if (
      trimmed.startsWith(left) &&
      trimmed.endsWith(right) &&
      trimmed.length >= left.length + right.length
    ) {
      const inner = trimmed
        .slice(left.length, trimmed.length - right.length)
        .trim();
      if (inner && !inner.includes("\n")) return inner;
    }
  }
  return trimmed;
}

function stripSimpleMarkdownWrappers(text: string): string {
  const trimmed = text.trim();
  for (const marker of ["**", "__", "*", "_"]) {
    if (
      trimmed.startsWith(marker) &&
      trimmed.endsWith(marker) &&
      trimmed.length > marker.length * 2
    ) {
      const inner = trimmed
        .slice(marker.length, trimmed.length - marker.length)
        .trim();
      if (inner && !inner.includes("\n")) return inner;
    }
  }
  return trimmed;
}

function looksLikeStructuredBlob(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("```") ||
    trimmed.includes("```") ||
    trimmed.startsWith("<think") ||
    trimmed.startsWith("<analysis") ||
    trimmed.startsWith("---") ||
    trimmed.includes("\n---") ||
    /^\d\d:\d\d:\d\d[,.]\d{3}\s*-->/.test(trimmed) ||
    trimmed.includes("-->")
  );
}

function looksLikePromptArtifact(text: string): boolean {
  const lower = text.trim().toLowerCase();
  const directMarkers = [
    "additional system instruction",
    "strict output now applied",
    "transcript output",
    "no input processed for output",
    "dictate or append exact content",
    "as spoken, no changes",
    "no punctuation added",
    "understand prompt structure",
    "optimize for output quality",
    "format as dictation post-processor",
    "dictation post-processor strictly",
    "adapt tone/mode dynamically",
    "fulfill specific user requests",
    "without alteration or commentary",
    "return only the final text",
    "do not explain changes",
    "do not mention rules",
    "active mode:",
    "rewrite strength:",
    "additional custom instructions:",
    "assistant:",
    "user query:",
    "system:",
    "suggested rewrite:",
  ];
  if (directMarkers.some((marker) => lower.includes(marker))) return true;

  const suspiciousInstructionMarkers = [
    "preserve meaning",
    "handle corrections",
    "prompt structure",
    "output quality",
    "tone/mode",
    "personal dictionary",
    "local dictation post-processor",
  ];
  const hits = suspiciousInstructionMarkers.filter((marker) =>
    lower.includes(marker),
  ).length;

  return (
    hits >= 2 ||
    (lower.includes("no changes") && text.includes("(")) ||
    (text.split(/\r?\n/).length > 5 &&
      (text.includes("**") || text.includes("---") || text.includes("```")))
  );
}

function looksLikeMetaRefusal(text: string): boolean {
  const lower = text.trimStart().toLowerCase();
  return [
    "i'm unable to",
    "i am unable to",
    "i cannot complete",
    "i can't complete",
    "please provide",
    "i need more context",
    "i don't have enough",
    "i do not have enough",
    "i'm sorry, but",
    "i am sorry, but",
  ].some((pattern) => lower.startsWith(pattern));
}

function sanitizePlainModelOutput(content: string): string | null {
  const cleaned = stripInvisibleChars(content).trim();
  if (!cleaned) return null;
  const candidate = stripSimpleMarkdownWrappers(
    stripWrappingQuotes(stripCommonOutputLabel(cleaned) ?? cleaned),
  ).trim();
  if (!candidate) return null;
  if (
    looksLikeMetaRefusal(candidate) ||
    looksLikeStructuredBlob(candidate) ||
    looksLikePromptArtifact(candidate)
  ) {
    return null;
  }
  return candidate;
}

function wordOverlapRatio(a: string, b: string): number {
  const wordsA = a
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  if (wordsA.length === 0) return 0;
  const wordsB = new Set(
    b
      .split(/\s+/)
      .map((word) => word.toLowerCase())
      .filter(Boolean),
  );
  return wordsA.filter((word) => wordsB.has(word)).length / wordsA.length;
}

function countWordSubstitutions(a: string, b: string): number {
  const normalize = (text: string) =>
    text
      .split(/\s+/)
      .map((word) => word.replace(/^[\p{P}]+|[\p{P}]+$/gu, "").toLowerCase())
      .filter(Boolean);
  const wa = normalize(a);
  const wb = normalize(b);
  if (wa.length !== wb.length) return Number.MAX_SAFE_INTEGER;
  return wa.filter((word, index) => word !== wb[index]).length;
}

function shouldFallbackToPlainTextDrift(
  rawText: string,
  candidate: string,
  normalizedText: string,
): boolean {
  const rawWords = rawText.split(/\s+/).filter(Boolean).length;
  const candidateWords = candidate.split(/\s+/).filter(Boolean).length;
  if (rawWords === 0) return false;

  if (rawWords <= 12 && wordOverlapRatio(rawText, candidate) < 0.5) {
    return true;
  }

  if (candidateWords > rawWords * 2 && candidateWords >= rawWords + 10) {
    if (wordOverlapRatio(rawText, candidate) < 0.6) return true;
  }

  if (rawWords > 4 && wordOverlapRatio(rawText, candidate) < 0.35) {
    return true;
  }

  const hasMarkdownFormatting =
    candidate.includes("**") ||
    candidate.includes("##") ||
    candidate.includes("* **") ||
    candidate.includes("- **");
  const rawHadMarkdown = rawText.includes("**") || rawText.includes("##");
  if (hasMarkdownFormatting && !rawHadMarkdown) return true;

  const rawTrimmed = rawText.trim();
  const hasTerminal = /[.!?]$/.test(rawTrimmed);
  if (hasTerminal && rawWords <= 12) {
    const normWords = normalizedText.split(/\s+/).filter(Boolean).length;
    const subs = countWordSubstitutions(normalizedText, candidate);
    if (subs >= 1 && subs <= 2 && candidateWords === normWords) return true;
    if (
      candidateWords !== normWords &&
      !hasSpokeNCorrectionRestart(rawText) &&
      wordOverlapRatio(rawText, candidate) >= 0.5
    ) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

/** Normalized Levenshtein similarity (0.0 to 1.0) */
function similarity(a: string, b: string): number {
  const na = a.trim();
  const nb = b.trim();
  if (na === nb) return 1.0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(na, nb);
  return 1.0 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ---------------------------------------------------------------------------
// Parallel execution with concurrency limit
// ---------------------------------------------------------------------------

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------

async function main() {
  const config = parseArgs();
  const resolvedPromptProfile = resolvePromptProfile(
    config.promptProfile,
    config.model,
  );

  // Load test cases
  const casesRaw = readFileSync(config.casesPath, "utf-8");
  const casesFile: CasesFile = JSON.parse(casesRaw);
  const cases = casesFile.cases;

  console.log(`\nVox Jot Post-Process Evaluation`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Cases:    ${cases.length}`);
  console.log(`Provider: ${config.provider}`);
  console.log(`Model:    ${config.model}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Mode:     ${config.mode}`);
  console.log(`Prompt:   ${resolvedPromptProfile}`);
  console.log(`Dry run:  ${config.dryRun}`);
  console.log(`Force LLM on skip: ${config.forceLlmOnSkip}`);
  console.log(
    `Timeout:  ${config.timeoutMs > 0 ? `${config.timeoutMs} ms` : "none"}`,
  );
  console.log(
    `Match:    ${config.exactMatch ? "exact" : `similarity >= ${config.matchThreshold}`}`,
  );
  console.log();

  const llmConfig: LLMConfig = {
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
  };

  const results: EvalResult[] = [];
  let completed = 0;

  if (config.dryRun) {
    // Dry run: only analyze routing, no LLM calls
    for (const tc of cases) {
      const route = analyzeRoute(tc.raw_stt, config.maxRewriteStrength);
      const result: EvalResult = {
        id: tc.id,
        category: tc.category,
        raw_stt: tc.raw_stt,
        expected_output: tc.expected_output,
        actual_output: null,
        route,
        match: false,
        exact_match: false,
        similarity: 0,
        skipped_llm: route.route === "skip",
        notes: tc.notes,
      };
      results.push(result);
      console.log(
        `[${tc.id}] route=${route.route} score=${route.score} strength=${route.rewrite_strength} ` +
          `corr=${route.features.has_correction_cue} list=${route.features.has_list_cue} ` +
          `para=${route.features.has_paragraph_cue} tech=${route.features.has_technical_tokens}`,
      );
    }
  } else {
    // Full evaluation with LLM calls
    if (!config.apiKey && config.provider !== "ollama") {
      console.error(
        `ERROR: No API key set. Use --api-key, LLM_API_KEY, or ${config.provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} env var.`,
      );
      process.exit(1);
    }

    const evalResults = await mapWithConcurrency(
      cases,
      config.concurrency,
      async (tc, _idx) => {
        const route = analyzeRoute(tc.raw_stt, config.maxRewriteStrength);
        const skippedLlm = route.route === "skip" && !config.forceLlmOnSkip;
        let actual: string | null = skippedLlm ? tc.raw_stt.trim() : null;
        let rawModelOutput: string | undefined;
        let blockedCandidate = false;
        let driftFallback = false;
        let error: string | undefined;
        let durationMs: number | undefined;
        let completionTokens: number | undefined;
        let outputTokensPerSecond: number | undefined;
        let rawModelZeroDrift: boolean | undefined;
        let unsolicitedTokens: string[] | undefined;

        if (!skippedLlm) {
          const systemPrompt = buildSystemPrompt(
            config.mode,
            route.rewrite_strength,
            tc.tone || "neutral",
            resolvedPromptProfile,
          );
          const userContent = buildUserContent(
            config.mode,
            tc.raw_stt,
            route.rewrite_strength,
            resolvedPromptProfile,
          );

          try {
            const startedAt = performance.now();
            const callResult = await callLLM(
              llmConfig,
              systemPrompt,
              userContent,
            );
            durationMs = Math.round(performance.now() - startedAt);
            rawModelOutput = callResult.content;
            completionTokens = callResult.completionTokens;
            const generationDurationMs =
              callResult.generationDurationMs ?? durationMs;
            if (completionTokens !== undefined && generationDurationMs > 0) {
              outputTokensPerSecond =
                completionTokens / (generationDurationMs / 1000);
            }
            const sanitized = sanitizePlainModelOutput(rawModelOutput);
            unsolicitedTokens = findUnsolicitedTokens(
              tc.raw_stt,
              tc.expected_output,
              sanitized ?? rawModelOutput,
            );
            rawModelZeroDrift =
              sanitized !== null && unsolicitedTokens.length === 0;
            if (sanitized === null) {
              blockedCandidate = true;
              actual = tc.raw_stt.trim();
            } else if (
              shouldFallbackToPlainTextDrift(
                tc.raw_stt,
                sanitized,
                tc.raw_stt.trim(),
              )
            ) {
              driftFallback = true;
              actual = tc.raw_stt.trim();
            } else {
              actual = sanitized;
            }
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
        }

        const sim =
          actual !== null ? similarity(actual, tc.expected_output) : 0;
        const exactMatch =
          actual !== null && actual.trim() === tc.expected_output.trim();
        const isMatch = config.exactMatch
          ? exactMatch
          : sim >= config.matchThreshold;

        completed++;
        const statusIcon = error
          ? "ERR"
          : isMatch
            ? "OK "
            : skippedLlm
              ? "SKP"
              : blockedCandidate
                ? "BLK"
                : driftFallback
                  ? "DRF"
                  : "LOW";
        console.log(
          `[${completed}/${cases.length}] ${statusIcon} ${tc.id} (${tc.category}) sim=${sim.toFixed(2)} route=${route.route}${durationMs !== undefined ? ` ${durationMs}ms` : ""}`,
        );
        if (actual !== null && !isMatch && !error) {
          console.log(`  expected: ${tc.expected_output.slice(0, 80)}`);
          console.log(`  actual:   ${actual.slice(0, 80)}`);
        }
        if (error) {
          console.log(`  error: ${error.slice(0, 120)}`);
        }
        if ((blockedCandidate || driftFallback) && rawModelOutput) {
          console.log(`  model:   ${rawModelOutput.slice(0, 80)}`);
        }

        return {
          id: tc.id,
          category: tc.category,
          raw_stt: tc.raw_stt,
          expected_output: tc.expected_output,
          actual_output: actual,
          route,
          match: isMatch,
          exact_match: exactMatch,
          similarity: sim,
          duration_ms: durationMs,
          completion_tokens: completionTokens,
          output_tokens_per_second: outputTokensPerSecond,
          raw_model_zero_drift: rawModelZeroDrift,
          unsolicited_tokens:
            unsolicitedTokens && unsolicitedTokens.length > 0
              ? unsolicitedTokens
              : undefined,
          skipped_llm: skippedLlm,
          blocked_candidate: blockedCandidate || undefined,
          drift_fallback: driftFallback || undefined,
          raw_model_output: rawModelOutput,
          notes: tc.notes,
          error,
        } satisfies EvalResult;
      },
    );

    results.push(...evalResults);
  }

  // Build summary
  const passed = results.filter((r) => r.match).length;
  const exactMatches = results.filter((r) => r.exact_match).length;
  const errors = results.filter((r) => r.error).length;
  const skipped = config.dryRun
    ? results.length
    : results.filter((r) => r.skipped_llm).length;
  const blockedCandidates = results.filter((r) => r.blocked_candidate).length;
  const driftFallbacks = results.filter((r) => r.drift_fallback).length;
  const evaluated = results.filter((r) => !r.error && r.actual_output !== null);
  const avgSim =
    evaluated.length > 0
      ? evaluated.reduce((sum, r) => sum + r.similarity, 0) / evaluated.length
      : 0;
  const durations = results
    .map((r) => r.duration_ms)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const percentile = (values: number[], p: number): number | undefined => {
    if (values.length === 0) return undefined;
    const index = Math.min(
      values.length - 1,
      Math.max(0, Math.ceil((p / 100) * values.length) - 1),
    );
    return values[index];
  };
  const zeroDriftResults = results.filter(
    (result) => result.raw_model_zero_drift !== undefined,
  );
  const zeroDriftPasses = zeroDriftResults.filter(
    (result) => result.raw_model_zero_drift,
  ).length;
  const tokenRates = results
    .map((result) => result.output_tokens_per_second)
    .filter((value): value is number => value !== undefined);

  const byCategory: Record<
    string,
    { total: number; passed: number; avg_similarity: number }
  > = {};
  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, passed: 0, avg_similarity: 0 };
    }
    byCategory[r.category].total++;
    if (r.match) byCategory[r.category].passed++;
  }
  for (const cat of Object.keys(byCategory)) {
    const catResults = results.filter(
      (r) => r.category === cat && r.actual_output !== null && !r.error,
    );
    byCategory[cat].avg_similarity =
      catResults.length > 0
        ? catResults.reduce((s, r) => s + r.similarity, 0) / catResults.length
        : 0;
  }

  const summary: EvalSummary = {
    provider: config.provider,
    model: config.model,
    mode: config.mode,
    force_llm_on_skip: config.forceLlmOnSkip,
    prompt_profile: resolvedPromptProfile,
    timestamp: new Date().toISOString(),
    total: results.length,
    passed,
    failed: config.dryRun ? 0 : results.length - passed - errors,
    errors,
    skipped,
    blocked_candidates: blockedCandidates,
    drift_fallbacks: driftFallbacks,
    exact_matches: exactMatches,
    pass_rate: results.length > 0 ? passed / results.length : 0,
    avg_similarity: avgSim,
    latency_p50_ms: percentile(durations, 50),
    latency_p95_ms: percentile(durations, 95),
    zero_drift_passes: zeroDriftPasses,
    zero_drift_evaluated: zeroDriftResults.length,
    zero_drift_purity:
      zeroDriftResults.length > 0
        ? zeroDriftPasses / zeroDriftResults.length
        : undefined,
    output_tokens_per_second:
      tokenRates.length > 0
        ? tokenRates.reduce((sum, value) => sum + value, 0) / tokenRates.length
        : undefined,
    by_category: byCategory,
    results,
  };

  // Write outputs
  mkdirSync(config.outputDir, { recursive: true });

  const jsonPath = resolve(config.outputDir, "eval-results.json");
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const mdPath = resolve(config.outputDir, "eval-results.md");
  writeFileSync(mdPath, buildMarkdownReport(summary, config.dryRun));

  console.log(`\n${"=".repeat(50)}`);
  if (!config.dryRun) {
    console.log(`Pass rate: ${(summary.pass_rate * 100).toFixed(1)}%`);
    console.log(`Exact matches: ${exactMatches} / ${evaluated.length}`);
    console.log(`Avg similarity: ${(avgSim * 100).toFixed(1)}%`);
    if (summary.latency_p50_ms !== undefined) {
      console.log(`Latency p50: ${summary.latency_p50_ms} ms`);
    }
    if (summary.latency_p95_ms !== undefined) {
      console.log(`Latency p95: ${summary.latency_p95_ms} ms`);
    }
    if (summary.zero_drift_purity !== undefined) {
      console.log(
        `Zero-drift purity: ${(summary.zero_drift_purity * 100).toFixed(1)}% (${summary.zero_drift_passes}/${summary.zero_drift_evaluated})`,
      );
    }
    if (summary.output_tokens_per_second !== undefined) {
      console.log(
        `Output speed: ${summary.output_tokens_per_second.toFixed(1)} tokens/s`,
      );
    }
    console.log(`Passed: ${passed} / ${evaluated.length}`);
    if (skipped > 0) console.log(`Skipped LLM: ${skipped}`);
    if (blockedCandidates > 0) {
      console.log(`Blocked candidates: ${blockedCandidates}`);
    }
    if (driftFallbacks > 0) console.log(`Drift fallbacks: ${driftFallbacks}`);
    if (errors > 0) console.log(`Errors: ${errors}`);
  } else {
    console.log(`Dry run complete. Route analysis only.`);
  }
  console.log(`\nResults written to:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  MD:   ${mdPath}`);
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function buildMarkdownReport(summary: EvalSummary, dryRun: boolean): string {
  const lines: string[] = [];
  lines.push(`# Post-Process Evaluation Results`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Provider | ${summary.provider} |`);
  lines.push(`| Model | ${summary.model} |`);
  lines.push(`| Mode | ${summary.mode} |`);
  lines.push(`| Force LLM on skip | ${summary.force_llm_on_skip} |`);
  lines.push(`| Prompt profile | ${summary.prompt_profile} |`);
  lines.push(`| Timestamp | ${summary.timestamp} |`);
  lines.push(`| Total cases | ${summary.total} |`);

  if (!dryRun) {
    lines.push(`| Passed | ${summary.passed} |`);
    lines.push(`| Failed | ${summary.failed} |`);
    lines.push(`| Errors | ${summary.errors} |`);
    lines.push(`| Skipped LLM | ${summary.skipped} |`);
    lines.push(`| Blocked candidates | ${summary.blocked_candidates} |`);
    lines.push(`| Drift fallbacks | ${summary.drift_fallbacks} |`);
    lines.push(`| Exact matches | ${summary.exact_matches} |`);
    lines.push(`| Pass rate | ${(summary.pass_rate * 100).toFixed(1)}% |`);
    lines.push(
      `| Avg similarity | ${(summary.avg_similarity * 100).toFixed(1)}% |`,
    );
    if (summary.latency_p50_ms !== undefined) {
      lines.push(`| Latency p50 | ${summary.latency_p50_ms} ms |`);
    }
    if (summary.latency_p95_ms !== undefined) {
      lines.push(`| Latency p95 | ${summary.latency_p95_ms} ms |`);
    }
    if (summary.zero_drift_purity !== undefined) {
      lines.push(
        `| Zero-drift purity | ${(summary.zero_drift_purity * 100).toFixed(1)}% (${summary.zero_drift_passes}/${summary.zero_drift_evaluated}) |`,
      );
    }
    if (summary.output_tokens_per_second !== undefined) {
      lines.push(
        `| Output speed | ${summary.output_tokens_per_second.toFixed(1)} tokens/s |`,
      );
    }
  }

  lines.push(``);
  lines.push(`## Results by Category`);
  lines.push(``);
  lines.push(`| Category | Total | Passed | Avg Similarity |`);
  lines.push(`|----------|-------|--------|----------------|`);
  for (const [cat, stats] of Object.entries(summary.by_category)) {
    lines.push(
      `| ${cat} | ${stats.total} | ${stats.passed} | ${(stats.avg_similarity * 100).toFixed(1)}% |`,
    );
  }

  lines.push(``);
  lines.push(`## Detailed Results`);
  lines.push(``);

  for (const r of summary.results) {
    const status = r.error ? "ERROR" : r.match ? "PASS" : "FAIL";
    lines.push(`### ${r.id} [${status}] (${r.category})`);
    lines.push(``);
    lines.push(
      `**Route:** ${r.route.route} | **Score:** ${r.route.score} | **Strength:** ${r.route.rewrite_strength}`,
    );
    const guards = [
      r.skipped_llm ? "skipped LLM" : null,
      r.blocked_candidate ? "blocked candidate" : null,
      r.drift_fallback ? "drift fallback" : null,
    ].filter(Boolean);
    if (guards.length > 0) {
      lines.push(``);
      lines.push(`**Guards:** ${guards.join(", ")}`);
    }
    lines.push(``);
    lines.push(`**Raw STT:**`);
    lines.push(`> ${r.raw_stt}`);
    lines.push(``);
    lines.push(`**Expected:**`);
    lines.push("```");
    lines.push(r.expected_output);
    lines.push("```");

    if (r.actual_output !== null) {
      lines.push(``);
      lines.push(
        `**Actual** (similarity: ${(r.similarity * 100).toFixed(1)}%, exact: ${r.exact_match}${r.duration_ms !== undefined ? `, latency: ${r.duration_ms} ms` : ""}):`,
      );
      lines.push("```");
      lines.push(r.actual_output);
      lines.push("```");
    }

    if (r.raw_model_zero_drift !== undefined) {
      lines.push(``);
      lines.push(
        `**Raw-model zero drift:** ${r.raw_model_zero_drift ? "pass" : "fail"}${r.unsolicited_tokens?.length ? ` (unsolicited tokens: ${r.unsolicited_tokens.join(", ")})` : ""}`,
      );
      if (r.output_tokens_per_second !== undefined) {
        lines.push(
          `**Output speed:** ${r.output_tokens_per_second.toFixed(1)} tokens/s${r.completion_tokens !== undefined ? ` (${r.completion_tokens} tokens)` : ""}`,
        );
      }
    }

    if (r.raw_model_output && r.raw_model_output !== r.actual_output) {
      lines.push(``);
      lines.push(`**Raw model output:**`);
      lines.push("```");
      lines.push(r.raw_model_output);
      lines.push("```");
    }

    if (r.error) {
      lines.push(``);
      lines.push(`**Error:** ${r.error}`);
    }

    if (r.notes) {
      lines.push(``);
      lines.push(`*${r.notes}*`);
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
