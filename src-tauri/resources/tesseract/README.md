# Bundled Tesseract OCR

Vox Jot ships a portable Tesseract binary + the English language pack on
**Windows** and **Linux** so the cross-platform OCR engine works out of the box
without users having to `apt install` / `brew install` anything. macOS uses the
native Apple Vision pipeline and never reaches this directory.

## Layout

```
resources/tesseract/
├── windows-x64/          # tesseract.exe + leptonica DLLs (UB Mannheim build)
├── linux-x64/            # tesseract + bundled .so dependencies
└── tessdata/             # eng.traineddata (shared across both platforms)
```

The binaries are **fetched on demand** by
[`scripts/fetch-tesseract-resources.sh`](../../../scripts/fetch-tesseract-resources.sh)
(macOS / Linux dev hosts) or
[`scripts/fetch-tesseract-resources.ps1`](../../../scripts/fetch-tesseract-resources.ps1)
(Windows dev hosts). They are intentionally **gitignored** to keep the repo
small and to avoid checking in third-party binaries.

## Refreshing the bundled assets

Run the fetcher whenever a new Tesseract release lands or you start from a
fresh checkout:

```bash
# macOS / Linux dev host (downloads Linux tesseract + tessdata)
./scripts/fetch-tesseract-resources.sh

# Windows dev host (downloads Windows tesseract + tessdata)
pwsh ./scripts/fetch-tesseract-resources.ps1
```

The scripts only download the artifacts needed for the host platform — building
a Windows installer on macOS therefore requires running the bash fetcher with
the `--all` flag:

```bash
./scripts/fetch-tesseract-resources.sh --all
```

## Runtime resolution

At app startup, [`screen_context.rs`](../../src/screen_context.rs) registers
the bundled paths via
[`screen_context_ocr_backup::set_bundled_paths`](../../src/screen_context_ocr_backup.rs).
Lookup order at OCR time:

1. Bundled binary in this directory (preferred — zero-config).
2. `VOX_JOT_TESSERACT` environment variable (used by tests / power users).
3. `tesseract` on `PATH` (system install, e.g. Homebrew on macOS).

The binary is invoked with `TESSDATA_PREFIX` pointing at this directory, so
the bundled `eng.traineddata` is always picked over any system tessdata that
might be installed alongside.

## Adding more languages

Drop additional `*.traineddata` files into `tessdata/`. Vox Jot does not yet
expose a language picker for the backup OCR engine, but Tesseract will load
the requested language automatically when configured (see Tesseract docs). For
the MVP, `eng.traineddata` is the only language we bundle.
