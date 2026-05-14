# Vox Jot Production Distribution Readiness

Last updated: 2026-05-13

## Current Priority

Ship direct-download macOS first, with Windows next and Linux as a community
channel. The app already has a strong macOS signing/notarization path; the next
production work is making releases complete, updateable, trustworthy, and easy
to recover if a runtime/model asset breaks.

## Production Feature Rule

If a feature is visible as usable, every required binary, model, runtime, and
credential flow must be either:

- bundled in the app,
- created/bootstrapped by the app,
- downloaded and installed through an app-managed flow, or
- explicitly marked unavailable until the user completes the app-managed setup.

Large app-managed downloads are acceptable. A large footprint is preferable to
shipping a visible feature that only works on the developer's machine. The
requirements are that downloads are explicit, resumable where practical,
cancellable, stored under app support model/runtime directories, and reflected in
the UI with size/status/error information.

Developer-only paths such as repo-local virtualenvs, `~/Apps/...` staging
folders, local shell tools, or manually installed Python packages can help
development, but they must not be the only way an end user can run a visible
feature.

## Implemented In This Pass

- Narrowed packaged OCR resources in `src-tauri/tauri.conf.json` so production
  bundles include the OCR runtime source package, not the local development
  virtualenv under `ocr-runtime/.venv`.
- Gated neural OCR rows so downloaded model weights are not marked runnable
  unless the app can also find the OCR runtime source, Python, and the required
  Python modules for that OCR backend.
- Added OCR runtime packaging/upload scripts:
  `bun run ocr:build-runtime` creates a versioned platform archive from
  `ocr-runtime/`, a standalone platform Python runtime, OCR Python
  dependencies, plus a `.sha256` checksum. `bun run ocr:upload-runtime:hf`
  uploads both files to the public Hugging Face repo configured by
  `HF_OCR_RUNTIME_REPO`
  (`IrieDinamik/vox-jot-ocr-runtime` by default).
- Added an app-side OCR runtime installer. Neural OCR model downloads now also
  install `ocr-runtime-<platform>-<arch>-all.tar.gz` from
  `IrieDinamik/vox-jot-ocr-runtime`, verify its SHA-256 checksum, extract it
  under app support, and prefer that managed runtime before marking neural OCR
  rows runnable.
- Added `bun run audit:distribution` to catch release-readiness regressions such
  as heavyweight OCR resource globs, missing hardened runtime, missing
  entitlements, missing Windows signing, and disabled updater artifacts.

## Distribution Gates

Before a broad beta:

- Enable signed Tauri updater artifacts and publish `latest.json` for stable and
  beta channels.
- Do not treat bundle/download size as the deciding factor. Bundle required
  runtimes when that gives the most reliable first-run experience; otherwise
  download heavy OCR, TTS, speech-analysis, and optional STT assets through
  managed app paths before marking their features runnable.
- Publish the first `IrieDinamik/vox-jot-ocr-runtime` platform archive before
  exposing neural OCR as production-ready. Until then, neural OCR will remain
  unavailable or fail install instead of pretending the developer `.venv` is a
  production runtime.
- Keep notarized macOS DMGs as the primary release artifact. The App Store can
  come later because global shortcuts, paste automation, permissions, and
  sidecars are direct-distribution friendly and store-review sensitive.
- Treat Windows as a signed beta until SmartScreen reputation develops.
- Publish checksums, third-party notices, and a privacy/data-flow page next to
  downloads.

## Market Signals

- Wispr Flow sells cross-platform cloud dictation with a free tier, 14-day Pro
  trial, annual Pro pricing at $12/user/month, monthly Pro pricing at
  $15/user/month, and enterprise controls such as SOC 2, ISO 27001, SSO/SAML,
  HIPAA, and enforced zero-data-retention privacy mode.
- Superwhisper markets local transcription models plus cloud/on-device language
  cleanup. Its model catalog distinguishes on-device transcription, cloud
  language models, and local LLMs, which validates Vox Jot's split between STT,
  post-processing, TTS, and speech-analysis runtimes.
- Voibe is pushing a local-first Mac niche with monthly, annual, and lifetime
  pricing, plus "100% Private (On-device)" as a core differentiator.
- VoiceInk uses a freemium split: offline local Whisper in the free tier, then
  paid cloud live transcription for real-time word streaming.
- MacWhisper is strongest for file/meeting transcription and exports, but also
  advertises system-wide dictation. Vox Jot should avoid looking like a
  file-transcription-only product on the download site.

## Positioning Recommendation

Lead with:

- "Local-first dictation for people who write all day."
- "Fast shortcut-to-text in every app."
- "Private by default; cloud cleanup only when you choose it."
- "Transparent model downloads, ranked benchmarks, and removable assets."

Avoid leading with:

- A giant model catalog.
- Voice cloning.
- OCR/screen context.
- Benchmark tables as the first website impression.

Those are proof points, not the buyer's first problem.

## Website And Hosting

Use Cloudflare Pages for the marketing/download site if the source is separated
or moved into this repository. Connect the GitHub repo to Pages for automatic
deploys, keep preview deployments enabled for branches, and use `_redirects` for
canonical download URLs. Put large release assets on GitHub Releases or R2 with
custom-domain caching only after the app update/download flow is stable.

Use Hugging Face this way:

- OCR model weights stay in their existing public mirror repos, and those repos
  can be grouped in a public Hugging Face Collection for browsing.
- OCR runtime dependencies should live in a separate public repo, recommended:
  `IrieDinamik/vox-jot-ocr-runtime`.
- The app should download from concrete repo IDs and asset filenames, not from
  the Collection itself. Collections are discovery/organization; repo IDs are
  the stable install contract.

Recommended URL shape:

- `/` product narrative and download CTA
- `/download` platform-specific downloads, checksums, release notes
- `/privacy` local/cloud data-flow explanation
- `/models` model/runtime download policy and license notes
- `/docs` setup, permissions, troubleshooting

## Sources

- Wispr Flow pricing: https://wisprflow.ai/pricing
- Wispr Flow plan docs: https://docs.wisprflow.ai/articles/9559327591-flow-plans-and-what-s-included
- Superwhisper model catalog: https://superwhisper.com/models
- Voibe pricing: https://www.getvoibe.com/pricing/
- VoiceInk product/pricing: https://www.voice-ink.com/
- MacWhisper product page: https://www.macwhisper.net/
- Tauri updater docs: https://v2.tauri.app/plugin/updater/
- Tauri resources docs: https://v2.tauri.app/develop/resources/
- Cloudflare Pages Git integration: https://developers.cloudflare.com/pages/configuration/git-integration/
- Cloudflare Pages redirects: https://developers.cloudflare.com/pages/configuration/redirects/
- Cloudflare R2 public buckets/custom domains: https://developers.cloudflare.com/r2/buckets/public-buckets/
