# Vox Jot Production Distribution Readiness

Last updated: 2026-05-13

## Current Priority

Ship direct-download macOS first, with Windows next and Linux as a community
channel. The app already has a strong macOS signing/notarization path; the next
production work is making releases small, updateable, trustworthy, and easy to
recover if a runtime/model asset breaks.

## Implemented In This Pass

- Narrowed packaged OCR resources in `src-tauri/tauri.conf.json` so production
  bundles include the OCR runtime source package, not the local development
  virtualenv under `ocr-runtime/.venv`.
- Added `bun run audit:distribution` to catch release-readiness regressions such
  as heavyweight OCR resource globs, missing hardened runtime, missing
  entitlements, missing Windows signing, and disabled updater artifacts.

## Distribution Gates

Before a broad beta:

- Enable signed Tauri updater artifacts and publish `latest.json` for stable and
  beta channels.
- Keep the installer thin. Bundle only core app assets and small required
  runtimes; download heavy OCR, TTS, speech-analysis, and optional STT assets
  through managed app paths.
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
