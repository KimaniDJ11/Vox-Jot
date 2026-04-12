#!/usr/bin/env bun
/**
 * Post-processing evaluation script for Vox Jot dictation corpus.
 *
 * This script evaluates the LLM post-processing pipeline by sending raw STT
 * text through an OpenAI-compatible API and comparing the output against
 * expected results.
 *
 * Usage:
 *   bun run scripts/eval-post-process.ts
 *   bun run scripts/eval-post-process.ts --provider openai --model gpt-4o-mini
 *   bun run scripts/eval-post-process.ts --provider ollama --base-url http://localhost:11434/v1
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
  similarity: number;
  notes?: string;
  error?: string;
}

interface EvalSummary {
  provider: string;
  model: string;
  mode: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  pass_rate: number;
  avg_similarity: number;
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
  const lower = trimmed.toLowerCase();
  const cues = [" and", " or", " to", " for", " with", " because", " but"];
  return cues.some((cue) => lower.endsWith(cue));
}

function extractRouteFeatures(text: string): RouteFeatures {
  const trimmed = text.trim();
  const listCues = [
    "grocery list",
    "shopping list",
    "packing list",
    "required verification",
    "required verifications",
    "verification request",
    "verification requests",
    "first",
    "second",
    "third",
    "next",
    "then",
    "one",
    "two",
    "three",
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
    word_count: trimmed.split(/\s+/).length,
    has_correction_cue: hasSpokeNCorrectionRestart(trimmed),
    has_list_cue:
      containsAnyCi(trimmed, listCues) || hasIntroShortItems(trimmed),
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
  if (!trimmed) return "pass1";
  const features = extractRouteFeatures(trimmed);
  if (features.has_transform_cue) return "command";
  if (features.looks_incomplete) return "pass1";

  // Skip LLM entirely for short, clean utterances with no processing cues.
  // Mirrors Rust choose_post_process_pass() threshold.
  const hasAnyCue =
    features.has_correction_cue ||
    features.has_list_cue ||
    features.has_paragraph_cue;
  if (features.word_count <= 10 && !hasAnyCue && !features.has_technical_tokens)
    return "skip";

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
  neutral:
    "Keep the tone neutral and close to the speaker's original wording.",
  casual:
    "Use a casual, conversational tone suitable for quick chat messages while preserving meaning.",
  professional:
    "Use a polished, professional tone suitable for email or documents while preserving meaning.",
  coding:
    "Format the text as precise technical writing suited for code editors and terminals. " +
    "Use exact technical terms, preserve variable and function names verbatim, " +
    "format code snippets with proper syntax, and keep comments concise. " +
    'Convert spoken code descriptions into valid code when the intent is clear ' +
    '(e.g., "define a function called foo that takes a string" → "fn foo(s: &str)"). ' +
    "Prefer lowercase and avoid unnecessary punctuation.",
};

function buildSystemPrompt(
  mode: "literal" | "intent",
  rewriteStrength: number,
  tone: string = "neutral",
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

  return `You are a local dictation post-processor.

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
- Example: "I want to pick up a few things from the store. Bread, potato chips, ice cream." -> "I want to pick up a few things from the store:\\n* Bread\\n* Potato chips\\n* Ice cream"
- Example: "Required verifications Request Government Issue ID conduct in person meeting employment verification income documentation personal reference previous reference I meant previous landlord reference and credit check also social security verification" -> "Required Verification Request:\\n* Government-issued ID\\n* Conduct in-person meeting\\n* Employment verification\\n* Income documentation\\n* Personal references\\n* Previous landlord reference\\n* Credit check\\n* Social security verification"
- If sequence words or ordered cues appear, such as "one", "two", "three", "first", "second", "next", or "finally", prefer a numbered list when the content is clearly step-like or ordered.
- If the user clearly dictated separate thoughts, insert paragraph breaks.
- If the user says "new line", "new paragraph", "skip a line", or equivalent phrasing, reflect that structure in the final text when it fits naturally.
- If punctuation words are spoken explicitly, such as "period", "comma", "question mark", "exclamation point", or "colon", respect them when they appear intentional.
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
- Example: "Hi Greg, let's connect soon. Are you available Friday at three o'clock? No, I'm at four o'clock." -> "Hi Greg, let's connect soon. Are you available Friday at four o'clock?"
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
}

function buildUserContent(
  mode: "literal" | "intent",
  text: string,
  rewriteStrength: number,
): string {
  return `Mode: ${mode}
Rewrite strength: ${rewriteStrength}
Utterance boundary confidence: sufficient for normal formatting rules.

Special handling:
- If the transcript corrects itself with a later "no", "sorry", "actually", or similar restart, keep only the corrected wording.
- If the transcript has an intro sentence followed by short list items, keep the intro sentence and format the items as \`* \` bullets.
- If a correction happens inside a list of short items, replace only the corrected item and keep the items after it.
- You may infer list boundaries from repeated short phrases even when commas are missing, especially for request, checklist, or verification-style content.

Personal dictionary:
- (none)

Transcript:
${text}`;
}

// ---------------------------------------------------------------------------
// LLM client
// ---------------------------------------------------------------------------

interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function callLLM(
  config: LLMConfig,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
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
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM API error ${response.status}: ${errorText.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return content.trim();
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
  console.log(`Dry run:  ${config.dryRun}`);
  console.log();

  const llmConfig: LLMConfig = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
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
        similarity: 0,
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
        const systemPrompt = buildSystemPrompt(
          config.mode,
          route.rewrite_strength,
          tc.tone || "neutral",
        );
        const userContent = buildUserContent(
          config.mode,
          tc.raw_stt,
          route.rewrite_strength,
        );

        let actual: string | null = null;
        let error: string | undefined;

        try {
          actual = await callLLM(llmConfig, systemPrompt, userContent);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }

        const sim =
          actual !== null ? similarity(actual, tc.expected_output) : 0;
        const isMatch = sim >= 0.85;

        completed++;
        const statusIcon = error ? "ERR" : isMatch ? "OK " : "LOW";
        console.log(
          `[${completed}/${cases.length}] ${statusIcon} ${tc.id} (${tc.category}) sim=${sim.toFixed(2)} route=${route.route}`,
        );
        if (actual !== null && !isMatch && !error) {
          console.log(`  expected: ${tc.expected_output.slice(0, 80)}`);
          console.log(`  actual:   ${actual.slice(0, 80)}`);
        }
        if (error) {
          console.log(`  error: ${error.slice(0, 120)}`);
        }

        return {
          id: tc.id,
          category: tc.category,
          raw_stt: tc.raw_stt,
          expected_output: tc.expected_output,
          actual_output: actual,
          route,
          match: isMatch,
          similarity: sim,
          notes: tc.notes,
          error,
        } satisfies EvalResult;
      },
    );

    results.push(...evalResults);
  }

  // Build summary
  const passed = results.filter((r) => r.match).length;
  const errors = results.filter((r) => r.error).length;
  const skipped = config.dryRun ? results.length : 0;
  const evaluated = results.filter((r) => !r.error && r.actual_output !== null);
  const avgSim =
    evaluated.length > 0
      ? evaluated.reduce((sum, r) => sum + r.similarity, 0) / evaluated.length
      : 0;

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
    timestamp: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed - errors - skipped,
    errors,
    skipped,
    pass_rate: results.length > 0 ? passed / results.length : 0,
    avg_similarity: avgSim,
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
    console.log(`Avg similarity: ${(avgSim * 100).toFixed(1)}%`);
    console.log(`Passed: ${passed} / ${results.length - errors}`);
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
  lines.push(`| Timestamp | ${summary.timestamp} |`);
  lines.push(`| Total cases | ${summary.total} |`);

  if (!dryRun) {
    lines.push(`| Passed | ${summary.passed} |`);
    lines.push(`| Failed | ${summary.failed} |`);
    lines.push(`| Errors | ${summary.errors} |`);
    lines.push(`| Pass rate | ${(summary.pass_rate * 100).toFixed(1)}% |`);
    lines.push(
      `| Avg similarity | ${(summary.avg_similarity * 100).toFixed(1)}% |`,
    );
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
        `**Actual** (similarity: ${(r.similarity * 100).toFixed(1)}%):`,
      );
      lines.push("```");
      lines.push(r.actual_output);
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
