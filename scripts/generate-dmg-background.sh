#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SVG="${REPO_ROOT}/src-tauri/dmg/vox-jot-dmg-background.svg"
OUTPUT_PNG="${REPO_ROOT}/src-tauri/dmg/vox-jot-dmg-background.png"

node --input-type=module - "${SOURCE_SVG}" "${OUTPUT_PNG}" <<'NODE'
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const [, , sourceSvg, outputPng] = process.argv;
const svg = await readFile(sourceSvg, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 1 });

await page.setContent(
  `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        html,
        body {
          width: 760px;
          height: 520px;
          margin: 0;
          overflow: hidden;
          background: transparent;
        }
        svg {
          display: block;
          width: 760px;
          height: 520px;
        }
      </style>
    </head>
    <body>${svg}</body>
  </html>`,
  { waitUntil: "load" },
);

await page.screenshot({ path: outputPng, clip: { x: 0, y: 0, width: 760, height: 520 } });
await browser.close();
NODE
echo "Generated ${OUTPUT_PNG}"
