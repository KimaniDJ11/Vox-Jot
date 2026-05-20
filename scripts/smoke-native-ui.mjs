#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const appPath = process.env.VOX_JOT_APP_PATH ?? "/Applications/Vox Jot.app";
const waitMs = Number(process.env.VOX_JOT_SMOKE_WAIT_MS ?? 800);
const clickToolPath =
  [
    process.env.CLICLICK_PATH,
    "/opt/homebrew/bin/cliclick",
    "/usr/local/bin/cliclick",
  ].find((path) => path && existsSync(path)) ?? null;

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function osa(script) {
  return run("/usr/bin/osascript", ["-e", script]);
}

function openApp() {
  run("/usr/bin/open", ["-a", appPath]);
  osa(`tell application "Vox Jot" to activate`);
  osa(`tell application "Vox Jot" to reopen`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function clickAny(labels, requiredName) {
  const quotedLabels = labels
    .map((label) => `"${label.replaceAll('"', '\\"')}"`)
    .join(", ");
  const script = `
set targetLabels to {${quotedLabels}}
tell application "System Events"
  set candidateProcesses to every process whose name is "Vox Jot" or name is "vox_jot"
  if (count of candidateProcesses) is 0 then error "Vox Jot process is not running"
  set appProcess to item 1 of candidateProcesses
  set frontmost of appProcess to true
  repeat 80 times
    if (count of windows of appProcess) > 0 then exit repeat
    delay 0.1
  end repeat
  if (count of windows of appProcess) is 0 then error "Vox Jot has no accessible window"
  set appWindow to window 1 of appProcess
  repeat with targetLabel in targetLabels
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
  end repeat
end tell
error "Missing native UI target for ${requiredName}"
`;
  const clicked = osa(script);
  sleep(waitMs);
  return clicked;
}

function windowFrame() {
  const raw = osa(`
tell application "System Events"
  set candidateProcesses to every process whose name is "Vox Jot" or name is "vox_jot"
  if (count of candidateProcesses) is 0 then error "Vox Jot process is not running"
  set appProcess to item 1 of candidateProcesses
  repeat 80 times
    if (count of windows of appProcess) > 0 then exit repeat
    delay 0.1
  end repeat
  if (count of windows of appProcess) is 0 then error "Vox Jot has no accessible window"
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
    osa(`
tell application "System Events"
  click at {${x}, ${y}}
end tell
`);
  }
  sleep(waitMs);
  return `${name}: point(${x},${y})`;
}

function clickStep(name, labels, coordinateFallback) {
  try {
    return `${name}: ${clickAny(labels, name)}`;
  } catch (error) {
    if (!coordinateFallback) {
      throw error;
    }
    return clickWindowPoint(name, coordinateFallback.x, coordinateFallback.y);
  }
}

function main() {
  openApp();
  sleep(1200);

  const steps = [
    ["Dictate", ["Dictate"], { x: (width) => width / 2 - 92, y: () => 24 }],
    ["History", ["History"], { x: () => 82, y: () => 78 }],
    [
      "Dictionary",
      ["Corrections", "Dictionary"],
      { x: () => 82, y: () => 124 },
    ],
    ["Jot Pad", ["Jot Pad"], { x: () => 82, y: () => 170 }],
    [
      "File Transcription",
      ["File Transcription"],
      { x: () => 82, y: () => 216 },
    ],
    ["Refine", ["Refine"], { x: (width) => width / 2, y: () => 24 }],
    ["Listen", ["Listen"], { x: (width) => width / 2 + 92, y: () => 24 }],
    ["Settings", ["Settings"], { x: () => 82, y: (height) => height - 45 }],
    [
      "Model Hub",
      ["Models", "Model Hub", "Dictation model", "Current model"],
      { x: () => 82, y: (height) => height - 170 },
    ],
  ];

  const clicked = [];
  for (const [name, labels, coordinateFallback] of steps) {
    clicked.push(clickStep(name, labels, coordinateFallback));
  }

  console.log(`Native UI smoke passed for ${appPath}`);
  console.log(clicked.join("\n"));
}

main();
