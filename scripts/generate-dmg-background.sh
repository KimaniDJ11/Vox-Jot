#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SVG="${REPO_ROOT}/src-tauri/dmg/vox-jot-dmg-background.svg"
OUTPUT_DIR="${REPO_ROOT}/src-tauri/dmg"
BASE_PNG="${OUTPUT_DIR}/vox-jot-dmg-background.png"
RETINA_PNG="${OUTPUT_DIR}/vox-jot-dmg-background@2x.png"
OUTPUT_TIFF="${OUTPUT_DIR}/vox-jot-dmg-background.tiff"

# Render the SVG at 2x (1520x1040) with headless Chromium. We render once at the
# higher density and derive the 1x asset by downscaling so both representations
# stay pixel-aligned.
node --input-type=module - "${SOURCE_SVG}" "${RETINA_PNG}" <<'NODE'
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const [, , sourceSvg, outputPng] = process.argv;
const svg = await readFile(sourceSvg, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 2 });

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

# Derive the 1x background (760x520) by downscaling the 2x render.
/bin/cp "${RETINA_PNG}" "${BASE_PNG}"
/usr/bin/sips -z 520 760 "${BASE_PNG}" >/dev/null

# Tag DPI so tiffutil pairs the two PNGs as 1x / 2x HiDPI representations.
/usr/bin/sips -s dpiWidth 72 -s dpiHeight 72 "${BASE_PNG}" >/dev/null
/usr/bin/sips -s dpiWidth 144 -s dpiHeight 144 "${RETINA_PNG}" >/dev/null

# Combine into a multi-representation TIFF. Finder renders the matching rep per
# display density, so Retina screens get the crisp 1520x1040 artwork.
/usr/bin/tiffutil -cathidpicheck "${BASE_PNG}" "${RETINA_PNG}" -out "${OUTPUT_TIFF}"

# The @2x PNG is only an intermediate for the TIFF; the 1x PNG and the TIFF are
# the committed assets.
/bin/rm -f "${RETINA_PNG}"

echo "Generated:"
echo "  ${BASE_PNG} (1x - tauri.conf.json fallback DMG)"
echo "  ${OUTPUT_TIFF} (retina - notarized release DMG)"
