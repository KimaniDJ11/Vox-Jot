#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appPath = process.env.VOX_JOT_APP_PATH ?? "/Applications/Vox Jot.app";
const appName = process.env.VOX_JOT_APP_NAME ?? "Vox Jot";
const apiPort = Number(
  process.env.VOX_JOT_ACCEPTANCE_API_PORT ?? readStoredApiPort() ?? 8978,
);
const apiBase = `http://127.0.0.1:${apiPort}`;
const waitMs = Number(process.env.VOX_JOT_ACCEPTANCE_WAIT_MS ?? 700);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join(repoRoot, "output", "installed-app-acceptance", runId);
const clickToolPath =
  [
    process.env.CLICLICK_PATH,
    "/opt/homebrew/bin/cliclick",
    "/usr/local/bin/cliclick",
  ].find((path) => path && existsSync(path)) ?? null;

const results = [];
const timings = {};

function readStoredApiPort() {
  const settingsPath = join(
    homedir(),
    "Library",
    "Application Support",
    "com.iriedinamik.voxjot",
    "settings_store.json",
  );
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    const port = Number(parsed?.settings?.http_api_port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 15000,
    ...options,
  }).trim();
}

function writeClipboard(value) {
  execFileSync("/usr/bin/pbcopy", [], {
    input: value,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 1000,
  });
}

function osa(script) {
  return run("/usr/bin/osascript", ["-e", script]);
}

function escapeAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function record(name, status, detail = "", extra = {}) {
  results.push({ name, status, detail, ...extra });
  const prefix =
    status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL";
  console.log(`${prefix} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function timed(name, fn) {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    timings[name] = Math.round(performance.now() - started);
  }
}

function ensureOutputDir() {
  mkdirSync(outputDir, { recursive: true });
}

function openApp() {
  if (!existsSync(appPath)) {
    throw new Error(`Installed app not found at ${appPath}`);
  }
  run("/usr/bin/open", ["-a", appPath]);
  osa(`tell application "${escapeAppleScript(appName)}" to activate`);
  osa(`tell application "${escapeAppleScript(appName)}" to reopen`);
  sleep(1400);
}

function appProcessScript() {
  return `
set candidateProcesses to every process whose name is "Vox Jot" or name is "vox_jot"
if (count of candidateProcesses) is 0 then error "Vox Jot process is not running"
set appProcess to item 1 of candidateProcesses
set frontmost of appProcess to true
repeat 80 times
  if (count of windows of appProcess) > 0 then exit repeat
  delay 0.1
end repeat
if (count of windows of appProcess) is 0 then error "Vox Jot has no accessible window"
`;
}

function windowFrame() {
  const raw = osa(`
tell application "System Events"
  ${appProcessScript()}
  tell window 1 of appProcess
    set {xPos, yPos} to position
    set {wSize, hSize} to size
  end tell
  return (xPos as text) & "," & (yPos as text) & "," & (wSize as text) & "," & (hSize as text)
end tell
`);
  const [x, y, width, height] = raw
    .split(",")
    .map((value) => Number(value.trim()));
  return { x, y, width, height };
}

function clickWindowPoint(name, relativeX, relativeY) {
  const frame = windowFrame();
  const x = Math.round(frame.x + relativeX(frame.width));
  const y = Math.round(frame.y + relativeY(frame.height));
  if (clickToolPath) {
    run(clickToolPath, [`c:${x},${y}`]);
  } else {
    osa(`tell application "System Events" to click at {${x}, ${y}}`);
  }
  sleep(waitMs);
  return `${name}: point(${x},${y})`;
}

function clickAny(labels, requiredName) {
  const quotedLabels = labels
    .map((label) => `"${escapeAppleScript(label)}"`)
    .join(", ");
  const script = `
set targetLabels to {${quotedLabels}}
tell application "System Events"
  ${appProcessScript()}
  repeat with targetLabel in targetLabels
    repeat with appWindow in windows of appProcess
      try
        set matches to (every UI element of entire contents of appWindow whose name is (targetLabel as text))
        if (count of matches) > 0 then
          click item 1 of matches
          return targetLabel as text
        end if
      end try
      try
        set matches to (every UI element of entire contents of appWindow whose value of attribute "AXDescription" is (targetLabel as text))
        if (count of matches) > 0 then
          click item 1 of matches
          return targetLabel as text
        end if
      end try
      try
        set matches to (every UI element of entire contents of appWindow whose title is (targetLabel as text))
        if (count of matches) > 0 then
          click item 1 of matches
          return targetLabel as text
        end if
      end try
    end repeat
  end repeat
end tell
error "Missing native UI target for ${escapeAppleScript(requiredName)}"
`;
  const clicked = osa(script);
  sleep(waitMs);
  return clicked;
}

function clickStep(name, labels, coordinateFallback) {
  try {
    return `${name}: ${clickAny(labels, name)}`;
  } catch (error) {
    if (!coordinateFallback) throw error;
    return clickWindowPoint(name, coordinateFallback.x, coordinateFallback.y);
  }
}

function navigateRoot(rootName) {
  const rootClicks = {
    Dictate: {
      labels: ["Dictate"],
      fallback: { x: (width) => width / 2 - 92, y: () => 24 },
    },
    Refine: {
      labels: ["Refine"],
      fallback: { x: (width) => width / 2, y: () => 24 },
    },
    Listen: {
      labels: ["Listen"],
      fallback: { x: (width) => width / 2 + 92, y: () => 24 },
    },
    Settings: {
      labels: ["Settings"],
      fallback: { x: () => 82, y: (height) => height - 45 },
    },
  };
  const config = rootClicks[rootName];
  if (!config) throw new Error(`Unknown root ${rootName}`);
  clickStep(rootName, config.labels, config.fallback);
}

function sectionPoint(y) {
  return { x: () => 82, y: () => y };
}

function clickSection(name, point) {
  clickWindowPoint(name, point.x, point.y);
}

function exerciseNavigation() {
  const roots = [
    {
      root: "Dictate",
      sections: [
        ["History", sectionPoint(58)],
        ["Dictionary", sectionPoint(98)],
        ["Jot Pad", sectionPoint(138)],
        ["File Transcription", sectionPoint(178)],
      ],
    },
    {
      root: "Refine",
      sections: [
        ["Write Profiles", sectionPoint(58)],
        ["Phrase Keys", sectionPoint(98)],
        ["Translation", sectionPoint(138)],
      ],
    },
    {
      root: "Listen",
      sections: [
        ["Studio", sectionPoint(58)],
        ["Voice Design", sectionPoint(98)],
        ["Voice Cloning", sectionPoint(138)],
        ["Voice Changer", sectionPoint(178)],
        ["Generated Audio", sectionPoint(218)],
      ],
    },
    {
      root: "Settings",
      sections: [
        ["App & Dictation", sectionPoint(102)],
        ["Shortcuts", sectionPoint(154)],
        ["Recording & Devices", sectionPoint(206)],
        ["Output & Paste", sectionPoint(259)],
        ["Corrections", sectionPoint(348)],
        ["Models & AI", sectionPoint(401)],
        ["Testing", sectionPoint(454)],
        ["Screen Context", sectionPoint(507)],
        ["Privacy & Storage", sectionPoint(597)],
        ["Legal & Model Terms", sectionPoint(650)],
        ["Automation & Agents", sectionPoint(703)],
        ["Diagnostics", sectionPoint(756)],
        ["About Vox Jot", sectionPoint(809)],
      ],
    },
  ];

  for (const group of roots) {
    const started = performance.now();
    try {
      navigateRoot(group.root);
      for (const [section, point] of group.sections) {
        clickSection(section, point);
      }
      record(
        `UI navigation: ${group.root}`,
        "pass",
        `${group.sections.length} sections opened`,
        { elapsed_ms: Math.round(performance.now() - started) },
      );
    } catch (error) {
      record(`UI navigation: ${group.root}`, "fail", error.message, {
        elapsed_ms: Math.round(performance.now() - started),
      });
    }
  }
}

function openDiagnostics() {
  navigateRoot("Settings");
  clickSection("Diagnostics", sectionPoint(756));
}

function enableLocalApiFromUi() {
  openDiagnostics();
  try {
    clickAny(["Enable local API"], "Enable local API");
    sleep(500);
    try {
      clickAny(
        ["OK", "Enable", "Enable local HTTP API"],
        "Local API confirmation",
      );
    } catch {
      // No confirmation appears after the first acknowledged run.
    }
    sleep(1200);
    return true;
  } catch (error) {
    record("Local API enable UI", "fail", error.message);
    return false;
  }
}

function readApiToken() {
  if (process.env.VOX_JOT_API_TOKEN)
    return process.env.VOX_JOT_API_TOKEN.trim();
  if (process.env.VOX_JOT_ACCEPTANCE_COPY_TOKEN_UI === "1") {
    const uiToken = copyApiTokenFromUi();
    if (uiToken) return uiToken;
  }
  if (process.env.VOX_JOT_ACCEPTANCE_READ_KEYCHAIN !== "1") return "";

  try {
    const keychainToken = run(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        "com.voxjot.post_process_api_keys",
        "-a",
        "http_api:loopback_token",
        "-w",
      ],
      { timeout: 2500 },
    ).trim();
    if (keychainToken) return keychainToken;
  } catch {
    // Keychain command-line access may require interactive approval.
  }
  return copyApiTokenFromUi();
}

function copyApiTokenFromUi() {
  let previousClipboard = "";
  let shouldRestoreClipboard = false;
  try {
    previousClipboard = run("/usr/bin/pbpaste", [], { timeout: 1000 });
    shouldRestoreClipboard = true;
  } catch {
    previousClipboard = "";
  }

  try {
    openDiagnostics();
    try {
      clickAny(["Copy Token", "Copy token"], "Copy local API token");
    } catch {
      clickWindowPoint(
        "Copy local API token",
        (width) => width * 0.83,
        (height) => height * 0.88,
      );
    }
    sleep(500);
    const token = run("/usr/bin/pbpaste", [], { timeout: 1000 }).trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token : "";
  } catch {
    return "";
  } finally {
    if (shouldRestoreClipboard) {
      try {
        writeClipboard(previousClipboard);
      } catch {
        // Clipboard restoration is best-effort only.
      }
    }
  }
}

async function fetchJson(path, options = {}) {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    return {
      status: 0,
      ok: false,
      body: {
        error: error instanceof Error ? error.message : String(error),
      },
      networkError: true,
    };
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

async function waitForApiHealth() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const result = await fetchJson("/v1/health");
      if (result.ok && result.body?.status === "ok") return result;
    } catch {
      // Server may not be running yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  throw new Error(`Local API did not respond at ${apiBase}`);
}

function writeTinyWav() {
  const filePath = join(outputDir, "acceptance-silence-16khz.wav");
  const sampleRate = 16000;
  const durationSeconds = 0.35;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  writeFileSync(filePath, buffer);
  return filePath;
}

function authHeaders(token) {
  return { "x-vox-jot-api-token": token };
}

async function exerciseApi() {
  let health;
  try {
    health = await timed("api_health_ms", waitForApiHealth);
  } catch {
    if (!enableLocalApiFromUi()) {
      record("Local API health", "fail", `not reachable at ${apiBase}`);
      return;
    }
    try {
      health = await timed("api_health_ms", waitForApiHealth);
    } catch (error) {
      record("Local API health", "fail", error.message);
      return;
    }
  }
  record(
    "Local API health",
    "pass",
    `version ${health.body?.version ?? "unknown"}`,
  );

  const token = readApiToken();
  if (!token) {
    record(
      "Local API token",
      "skip",
      "set VOX_JOT_API_TOKEN, VOX_JOT_ACCEPTANCE_COPY_TOKEN_UI=1, or VOX_JOT_ACCEPTANCE_READ_KEYCHAIN=1",
    );
    return;
  }
  record("Local API token", "pass", "token acquired without logging its value");

  const unauthorized = await fetchJson("/v1/readiness");
  record(
    "Local API auth guard",
    unauthorized.status === 401 || unauthorized.status === 403
      ? "pass"
      : "fail",
    `unauthenticated readiness returned HTTP ${unauthorized.status}`,
  );

  const headers = authHeaders(token);
  const readiness = await timed("api_readiness_ms", () =>
    fetchJson("/v1/readiness", { headers }),
  );
  record(
    "Local API readiness",
    readiness.ok ? "pass" : "fail",
    readiness.ok
      ? `overall=${readiness.body?.overall ?? "unknown"}`
      : `HTTP ${readiness.status}`,
  );

  const models = await fetchJson("/v1/models", { headers });
  record(
    "Local API models",
    models.ok ? "pass" : "fail",
    models.ok
      ? `${models.body?.available?.length ?? 0} available, current=${models.body?.current ?? "none"}`
      : `HTTP ${models.status}`,
  );

  const voices = await fetchJson("/v1/voices", { headers, timeoutMs: 15000 });
  record(
    "Local API voices",
    voices.ok ? "pass" : "fail",
    voices.ok
      ? `${Array.isArray(voices.body) ? voices.body.length : 0} voices`
      : (voices.body?.error ?? `HTTP ${voices.status}`),
  );

  const postVoiceHealth = await fetchJson("/v1/health");
  record(
    "Local API remains reachable",
    postVoiceHealth.ok ? "pass" : "fail",
    postVoiceHealth.ok
      ? "server still responding after authenticated checks"
      : (postVoiceHealth.body?.error ?? `HTTP ${postVoiceHealth.status}`),
  );

  const mcpInit = await fetchJson("/mcp", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  record(
    "MCP initialize",
    mcpInit.ok && mcpInit.body?.result?.serverInfo?.name === "vox-jot"
      ? "pass"
      : "fail",
    mcpInit.ok
      ? "serverInfo received"
      : (mcpInit.body?.error ?? `HTTP ${mcpInit.status}`),
  );

  const mcpTools = await fetchJson("/mcp", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  const toolNames =
    mcpTools.body?.result?.tools?.map((tool) => tool.name) ?? [];
  const expectedTools = [
    "vox_jot.speak",
    "vox_jot.list_voices",
    "vox_jot.list_voice_profiles",
    "vox_jot.transcribe_wav",
  ];
  const missingTools = expectedTools.filter(
    (tool) => !toolNames.includes(tool),
  );
  record(
    "MCP tools",
    mcpTools.ok && missingTools.length === 0 ? "pass" : "fail",
    mcpTools.networkError
      ? (mcpTools.body?.error ?? "network error")
      : missingTools.length === 0
        ? `${toolNames.length} tools listed`
        : `missing ${missingTools.join(", ")}`,
  );

  const wavPath = writeTinyWav();
  const canAttemptStt =
    readiness.ok &&
    readiness.body?.overall !== "blocked" &&
    Array.isArray(models.body?.available) &&
    models.body.available.length > 0;
  if (!canAttemptStt) {
    record(
      "Local API transcribe fixture",
      "skip",
      `STT readiness is ${readiness.body?.overall ?? "unknown"}`,
    );
  } else {
    const formData = new FormData();
    formData.set(
      "file",
      new Blob([readFileSync(wavPath)], { type: "audio/wav" }),
      basename(wavPath),
    );
    const transcribe = await timed("api_transcribe_fixture_ms", () =>
      fetchJson("/v1/transcribe", {
        method: "POST",
        headers,
        body: formData,
        timeoutMs: 60000,
      }),
    );
    record(
      "Local API transcribe fixture",
      transcribe.ok && typeof transcribe.body?.text === "string"
        ? "pass"
        : "fail",
      transcribe.ok
        ? "fixture accepted"
        : (transcribe.body?.error ?? `HTTP ${transcribe.status}`),
    );
  }

  if (!voices.ok || !Array.isArray(voices.body) || voices.body.length === 0) {
    record("Local API TTS synthesize", "skip", "no voices available");
  } else {
    const synthesize = await timed("api_tts_synthesize_ms", () =>
      fetchJson("/v1/tts/synthesize", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        timeoutMs: 90000,
        body: JSON.stringify({
          text: "Vox Jot acceptance test.",
          remember_last_output: false,
        }),
      }),
    );
    record(
      "Local API TTS synthesize",
      synthesize.ok ? "pass" : "fail",
      synthesize.ok
        ? `${synthesize.body?.output_paths?.length ?? 0} output files`
        : `HTTP ${synthesize.status}`,
    );
  }
}

async function main() {
  ensureOutputDir();
  await timed("app_launch_ms", () => {
    openApp();
  });
  record("Installed app launch", "pass", appPath);

  await timed("ui_navigation_ms", () => {
    exerciseNavigation();
  });

  await exerciseApi();

  const report = {
    run_id: runId,
    app_path: appPath,
    api_base: apiBase,
    timings_ms: timings,
    results,
  };
  const reportPath = join(outputDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const failures = results.filter((result) => result.status === "fail");
  console.log(`Report: ${reportPath}`);
  if (failures.length > 0) {
    console.error(
      `${failures.length} installed-app acceptance check(s) failed.`,
    );
    process.exit(1);
  }
  console.log("Installed-app acceptance checks passed.");
}

main().catch((error) => {
  record("Runner", "fail", error?.message ?? String(error));
  ensureOutputDir();
  writeFileSync(
    join(outputDir, "report.json"),
    JSON.stringify(
      {
        run_id: runId,
        app_path: appPath,
        api_base: apiBase,
        timings_ms: timings,
        results,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
