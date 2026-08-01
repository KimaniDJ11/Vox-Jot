# Vox Jot open-source launch runbook

Status: **in preparation — repository remains private**

This runbook is the source of truth for the coordinated public-source and
commercial-support relaunch. A checked preparation item is not proof that the
public launch happened; the verification table at the end controls that claim.

## Launch promise

Lead with one job:

> Press a shortcut, speak naturally, and place locally transcribed text where
> your cursor is already focused.

Advanced model, OCR, Reader, Listen, voice, benchmark, and automation features
are supporting proof, not the first impression.

## Business model

- Public MIT-licensed source
- Free direct download of the official signed and notarized Apple Silicon DMG
- Pay-what-you-want Gumroad support, suggested at $27
- Optional paid setup, workflow design, customization, and organizational support
- Potential team deployment and commercial services only after demand is proven
- No activation, license, payment, or network check on dictation hot paths

## Completed evidence inputs

### Git history

Cursor audited all 1,658 reachable commits on 2026-07-31 with Gitleaks,
TruffleHog, high-confidence token patterns, credential file types, and gated
model-weight extensions. It reported zero live or verified secrets. The 62
unverified TruffleHog URI findings were placeholder URLs inside archived runtime
tests.

Remaining publication work from that report:

- Current Russian regression manifest and testing-document absolute paths were
  converted to repository-relative paths.
- Removed historical screenshots and virtual-environment fragments remain in
  reachable history but were reported as low-risk and contained no secrets.
- Unreachable local Rust build packs are local Git garbage and are not included
  in any ref. Local garbage collection is optional and not a launch gate.

### Copyright and notices

The upstream MIT copyright holders remain in `LICENSE`. The generated notice
pipeline covers npm, Cargo, app-managed Python runtimes, the Polyvoice binary,
and the curated model manifest. Validate it with:

```bash
bun run licenses:check
bun run models:validate-licenses
```

## Public GitHub surface audit

The private repository currently has no issues and 54 pull requests. Pull
request bodies, issue comments, review comments, and review summaries were
exported and scanned before launch; Gitleaks reported zero findings. A token
pattern search found only upstream Playwright documentation using the example
identifier `privateKey`.

GitHub release assets need separate treatment because they are not part of Git
history:

| Release                      | Current state         | Launch action                                                                                                                                                          |
| ---------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1.0.4`                     | Drafted on 2026-07-31 | Keep draft; official app distribution remains R2 + Gumroad + Hugging Face updater                                                                                      |
| `v1.0.6`, `v1.0.2`, `v1.0.0` | Draft app releases    | Keep draft; never use as public distribution fallback                                                                                                                  |
| `v0.3.0-tts-models`          | Drafted on 2026-07-31 | Keep hidden; the rebuilt Apple Silicon speech runtime with complete notices is publicly mirrored on Hugging Face, and model fallbacks use canonical Hugging Face repos |
| `v0.1.0-models`              | Drafted on 2026-07-31 | Keep hidden unless every asset has current redistribution approval and complete packaged notices                                                                       |

All eight legacy release records are now drafts; the GitHub API reports zero
published releases. No visibility change is allowed if a release is republished
before its assets pass the current notice and redistribution gates.

## Repository preparation

- [x] Core-focused README with direct download, support, source-build, privacy,
      official-build, lineage, and license boundaries
- [x] Vox Jot-specific contributing and build guides
- [x] Security, support, roadmap, conduct, trademark, and lineage policies
- [x] Funding links point to Irie Dinamik/Vox Jot rather than the upstream Handy
      project
- [x] Privacy-safe bug and feature issue forms plus a verification-focused PR
      template
- [x] Current machine-specific absolute paths removed
- [ ] Repository description, website, and topics configured on GitHub
- [ ] GitHub Discussions enabled and seeded
- [ ] Private vulnerability reporting enabled
- [ ] Branch protection/ruleset configured for required quality checks
- [x] Release-asset blockers above resolved by reversibly drafting every legacy
      release; no assets were deleted
- [ ] Current source, notices, and launch work committed and pushed

## Website and support path

- [x] Primary CTA directly downloads the R2-hosted signed DMG (prepared locally)
- [x] Secondary CTA opens the `$0+` Gumroad supporter product with $27 suggested
      (prepared locally)
- [x] Source CTA opens the intended GitHub repository (deploy only after public)
- [x] Official-build, system requirement, checksum, privacy, and support language
      matches the repository
- [x] Direct download, checksum, Gumroad, support, privacy, and source links were
      validated locally in desktop and mobile browser layouts
- [x] No checkout is required to get the free build
- [ ] Prepared website changes deployed and reverified on the live domain

## Privacy-respecting measurement

The launch needs funnel evidence without collecting dictated content.

### Pre-launch baseline — 2026-07-31

| Surface                 | Current evidence                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository              | Private; 0 GitHub page views/0 unique viewers in the available 14-day traffic window                                                                       |
| Repository clones       | 61 clone operations/2 unique cloners in the private-repository window; this includes maintainer and automation activity and is not a user-adoption measure |
| Gumroad                 | 4 successful `$0` checkouts, 0 paid purchases, $0 gross revenue                                                                                            |
| Direct R2 downloads     | R2 transfer metrics remain authoritative for completed transfers; first-party download-click measurement is prepared but not yet deployed                  |
| Installs and active use | Not previously measured; the new separate opt-in app metrics are implemented but not yet released                                                          |
| Opt-in app funnel       | Separate off-by-default first-party aggregate gate implemented for app launch and first successful dictation in a session                                  |

### Website events

Record aggregate counts for:

- `page_view`
- `download_click`
- `support_click`
- `source_click`
- `checksum_click`

Do not attach query text, form contents, IP-derived profiles, or cross-site
advertising identifiers.

### App events

App measurement is opt-in, separate from crash reporting, and defaults to off.
The current event schema is intentionally narrow:

- `analytics_enabled`
- `app_launch`
- `first_dictation_success` (once per app process)

Never send audio, transcripts, prompts, clipboard content, file names, local
paths, destination-app document titles, API keys, model tokens, or correction
dictionary content. Telemetry must remain outside recording, transcription,
post-processing, paste, overlay, and startup latency-critical work.

- [x] UX and accessibility review completed for consent and status surfaces
- [x] Event schema and website retention documented (daily aggregates, 400 days)
- [x] Opt-in state and revocation tested in the installed notarized 1.0.18 app;
      the setting began off, emitted only while enabled, and was restored to off
- [x] Events verified against the production aggregate store: rows contain only
      `day`, allowlisted `event`, fixed `channel`, and integer `count`; the QA
      rows were removed after verification
- [ ] Website and app baselines captured immediately before launch

## Demo and launch package

- [ ] 30–60 second privacy-safe demo recorded from the current official app
- [ ] Demo shows shortcut → speech → text in a neutral destination app
- [ ] No private notifications, files, contacts, transcripts, keys, or account
      data are visible
- [x] Captions, text alternative, narration, and shot list prepared
- [ ] One product screenshot, one workflow GIF/video, and one architecture/privacy
      diagram exported for reuse
- [x] Current privacy-safe product screenshot set inventoried
- [x] GitHub launch post prepared
- [x] Product-site announcement prepared
- [x] Community posts adapted to each destination rather than duplicated as spam
- [x] Support response plan ready for the first launch week

## Quality gate

Run and record current results before publication:

```bash
bun run format:check
bun run lint
bun run build
bun run test:unit
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
bun run check:translations
bun run models:validate-licenses
bun run licenses:check
bun run models:validate-public
bun run audit:distribution
git diff --check
```

Also run the available dependency, secret, and leak checks and the notarized
installed-app workflow required by `AGENTS.md`. A missing tool or credential is a
reported blocker, not an implicit pass.

Recorded 2026-07-31 results: frontend build, lint, 253 unit tests, formatting,
translations, strict Rust clippy, and 543 Rust tests passed. Public-model,
model-license, generated-notice, dependency-advisory, tracked-diff secret, and
distribution checks passed; the distribution audit reported only the expected
non-target Windows signing notice and an excluded local developer OCR
environment. The installed 1.0.18 app passed Developer ID signing, Apple
notarization (submission `aa041ace-8ba9-46af-a2a8-78c3893708a2`), stapling, and
Gatekeeper assessment. Nix evaluation remains unverified because Nix is not
installed on this Mac; the public CI workflow is the intended Nix verification
surface after push.

## Publication sequence

1. Capture pre-launch GitHub, website/download, Gumroad, and app-event baselines.
2. Resolve every release-asset and policy blocker.
3. Commit, push, and verify the intended default branch and checks.
4. Configure topics, description, Discussions, vulnerability reporting, and
   repository rules.
5. Change repository visibility to public.
6. Verify anonymous source clone, license, notices, docs, issue forms, funding,
   Discussions, and security routes.
7. Deploy the website direct-download/support/source changes.
8. Verify the public DMG, checksum, notarization, updater manifests, Gumroad, and
   website routes.
9. Publish the demo and coordinated announcements.
10. Capture the post-launch baseline and monitor activation/support failures.

## Completion evidence

| Requirement         | Authoritative proof                                                                     |
| ------------------- | --------------------------------------------------------------------------------------- |
| Public source       | Anonymous repository page and clone succeed; visibility API reports `PUBLIC`            |
| License and notices | Anonymous links resolve; generation and compliance checks pass                          |
| Official download   | Direct anonymous DMG and checksum requests return success and hashes match              |
| Official integrity  | Developer ID signature, notarization, stapling, and Gatekeeper validation pass          |
| Updates             | R2/Hugging Face manifests advertise the installed release and signatures verify         |
| Support path        | Gumroad product is published, `$0+`, linked from website/repository, and checkout opens |
| Community           | Discussions, issue forms, conduct, support, security, funding, and roadmap are public   |
| Measurement         | Pre/post aggregate baselines exist; opt-in app payload contains no sensitive fields     |
| Launch              | Demo and destination-specific announcements are publicly reachable                      |

Until every row is proven, report the launch as prepared, partially published,
or blocked—not complete.
