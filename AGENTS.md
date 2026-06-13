# AGENTS.md

> **CRITICAL ARCHITECTURE NOTE FOR ALL AGENTS:**
> This application is currently under active, early-stage development and has no active users. **Backward compatibility is NOT required.** Do not worry about preserving old APIs, data structures, or behaviors if a better approach exists. We are pushing forward to build a stronger app. Feel free to make breaking changes, refactor aggressively, and improve the architecture wherever possible.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## External Claude Delegation

Codex may use Claude Code as an external read-only reviewer through `./scripts/ask-claude` when a second model opinion would materially improve the work, such as architecture alternatives, patch critique, debugging hypotheses, edge-case review, or risk analysis.

- Use `./scripts/ask-claude`, not raw `claude`, so local runtime quirks and read-only defaults are handled consistently.
- Default Claude delegation to Opus. `./scripts/ask-claude` already passes `--model opus` unless `ASK_CLAUDE_MODEL` is explicitly set for a cheaper/faster review.
- The installed Claude CLI does not expose a separate thinking-level flag. For high-value Claude reviews, prompt Claude for the deepest practical analysis, but do not claim a hidden thinking budget was set unless the local CLI later exposes that control.
- Opus delegation may consume more Claude plan usage than cheaper models. Use it only when a second model review is genuinely useful, keep prompts scoped, and report quota/rate-limit responses plainly.
- Treat Claude output as unverified advice. Codex must still inspect the code, make final technical decisions, perform edits, and run validation.
- Do not ask Claude to edit files, run commands, approve destructive actions, handle secrets, or make final release/benchmark/catalog decisions.
- Keep prompts scoped and evidence-oriented. Include relevant file paths, diffs, errors, and constraints, but do not pass credentials, tokens, private customer data, or large unrelated logs.
- If `./scripts/ask-claude` fails because Claude is missing, unauthenticated, or blocked by local configuration, report that exact blocker and continue independently unless the user explicitly required a Claude pass.

## No Deferred Placeholder Work Policy

There is no accepted product plan that justifies leaving requested functionality unfinished. Agents must treat every requested task as a request for a fully working implementation unless the user explicitly narrows the scope.

- Do not leave promise-only, empty, placeholder, mock-only, disabled, hidden, or manually wired functionality as the final state of a task.
- If a feature is visible in the app, it must be runnable through the normal app path with required runtime, model, dependency, credential, and error-handling flows implemented or app-managed.
- If implementation is blocked by missing credentials, unavailable artifacts, platform limitations, or an upstream defect, mark the feature honestly as blocked/failed, keep it out of usable surfaces, and report the blocker with the exact validation performed.
- Do not add ranked benchmarks, catalog availability, download buttons, settings controls, menu items, or UI affordances that imply a feature works until the full path has been implemented and verified.
- Existing docs that describe staged plans or incomplete ideas are historical context only. They must not be used to justify partial implementation.
- When completing work, report what was implemented, how it was validated, and whether any visible path remains incomplete.

## Frontend UX Heuristics Policy

For any frontend design or UI change, agents and AI coding tools must use the UX heuristics guardrails before changing code. In Codex, use the `ux-ai-guardrails` / Heuristics skill; in other tools, apply the same Nielsen usability heuristics, WCAG accessibility checks, and project-specific UI constraints from this file.

- Preserve primary flows, visible status, keyboard access, focus visibility, target sizes, and existing component patterns unless explicitly asked to change them.
- Do not add steps, hide information, reorder navigation, reduce contrast, or introduce decorative UI treatment without a functional reason.
- When completing frontend work, mention the heuristic/accessibility check performed and any latency impact.

## Commit and Push Quality Gate

Whenever the user asks an agent or AI coding tool to commit and push, or the agent is about to commit and push on its own, the agent must first run and report a full bug, issue, error, security, and leak check appropriate to the changed scope.

- Run available build, typecheck, lint, test, and Rust checks before committing. For this repo that usually means `bun run build`, `bun run lint`, `cargo check --manifest-path src-tauri/Cargo.toml`, and relevant `cargo test --manifest-path src-tauri/Cargo.toml` coverage unless the user explicitly narrows validation.
- Run dependency/security and secret/leak checks when tooling is available, and report when a tool is missing rather than silently skipping it.
- Inspect `git diff` / `git diff --check` and stage only intentional files. Do not stage unrelated user changes.
- Do not run the macOS installed-app build path (`bun run mac:update-installed-app:notarized` / `bun run mac:update:notarized`) unless explicitly requested.
- Include the validation summary in the final response after commit and push.

## Latency Policy

Vox Jot is a latency-sensitive dictation app. All agents and AI coding tools must treat latency as a hard product constraint.

- Do not make changes that increase recording start latency, stop-to-transcript latency, post-processing latency, paste latency, overlay responsiveness latency, or settings UI responsiveness without explicit approval.
- Before implementing a change on a hot path, identify whether it runs during recording, transcription, post-processing, paste/output, overlay updates, or app startup.
- If a proposed change would add network calls, disk I/O, model loads, database work, blocking locks, extra awaits, heavy serialization, large React re-renders, or expensive computation to a hot path, do not implement it by default. Explain why it would increase latency and propose alternatives that keep the work cached, deferred, incremental, backgrounded, or outside the hot path.
- Prefer deferred/background persistence, cached metadata, precomputed state, and UI-only rendering over synchronous work in the dictation pipeline.
- When completing a change, report whether latency is expected to be unchanged, improved, or at risk, and mention any validation performed.

## Model Benchmark and Testing View Policy

Testing views must use full benchmark suite results for ranked model rows. Smoke tests are allowed only for development readiness checks and must not be presented as ranked leaderboard results.

- Run the full suite for the relevant tab before adding or changing a ranked row in `src/lib/*EvaluationResults.ts`.
- For TTS, run the complete `scripts/run-tts-model-eval.py` suite with all suite cases and ASR round-trip scoring enabled. Do not use `--case-limit` or `--no-asr-roundtrip` for ranked TTS, TTS Style, or Voice Cloning rows.
- For Live STT, run the full STT corpus used by the tab, not a small `--limit` smoke subset, before assigning a rank.
- Smoke tests are temporary readiness checks only. If a model has only been smoke-tested, run the full relevant suite before adding or updating Testing view metrics; do not leave smoke-only rows as final benchmark data.
- If a model has completed the full relevant benchmark suite, it must always receive a numeric rank. This applies to specialized, language-specific, or otherwise caveated models too; put corpus/language caveats in the notes, not by leaving the model unranked.
- When full benchmark results are available, update the Testing view data with the measured score/latency/WER/pass metrics and recompute ranks against the existing full-suite results.
- Preserve built-in Apple/system models in rankings and local storage cleanup. Never delete built-in Apple/system options while pruning downloadable models.

## Model Download and Catalog Operations

Agents that download, benchmark, clean up, or expose models must follow `docs/model-download-benchmark-runbook.md` and keep its lessons reflected in the main app catalog, benchmark views, and scripts.

- Production distribution priority: if a feature is visible as usable, every required model, binary, runtime, dependency pack, and credential flow must be bundled in the app, created/bootstrapped by the app, or downloaded/installed through an app-managed flow. Large app-managed downloads are acceptable when they make the feature work reliably for normal users. Do not hide or remove a working feature solely to keep the download footprint small; instead make the size clear, resumable, cancellable, and stored in the app support model/runtime locations.
- Developer-only paths such as repo-local `.venv` folders, `~/Apps/...` staging directories, manually installed shell tools, or local Python packages must never be the only way a user can run a visible feature. If a runtime is too large for the base installer, publish it as a versioned app-managed artifact and teach the app to install it before marking the feature runnable.
- Use canonical app model IDs from the Rust/TypeScript catalogs. Do not add duplicate rows for equivalent Hugging Face repos, quantizations, aliases, or old local folder names.
- Do not re-add the removed duplicate Qwen TTS CustomVoice/Base folders or duplicate Qwen LLM recommendations. Keep Qwen ASR canonicalized to `mlx-qwen3-asr` for the 1.7B model, with legacy aliases only for old artifacts.
- Keep all runtime and model artifact locations synchronized. When an agent changes, rebuilds, cleans, mirrors, benchmarks, or marks usable any runtime, model, dependency pack, checksum, manifest, or catalog file that is hosted in a Hugging Face repo/collection, the matching Hugging Face artifact must be updated in the same work session. If the same artifact is also stored on the external model drive, update `/Volumes/Models/VoxJot/...` in the same work session too. Verify HF checksums/manifests and verify model-drive size, file count, and absence of macOS metadata files (`._*`, `__MACOSX`) before reporting done.
- Downloads belong in the app support model stores unless a script explicitly documents a temporary cache. Use resumable Hugging Face downloads where possible, record status/log paths, and keep pending downloads moving.
- When a model already exists locally and the task is to place a copy on the external `/Volumes/Models` model drive, prefer direct macOS filesystem copy (`ditto` or Finder/Computer Use) into the matching model-drive path. Do not route local-to-drive copies through Python download scripts or Hugging Face cache machinery; those are for missing remote models and were much slower than direct copy. Keep copies one model/category at a time and verify source/destination size and file count.
- If testing proves a catalog model cannot run, mark it blocked/failed in the Testing view and disable it in the app catalog until the runtime bridge is fixed.
- For TTS downloads, prefer `scripts/download-untested-tts-models.zsh` over ad hoc shell queues so other agents inherit the same paths, duplicate policy, and status logging.
- For TTS models, benchmark success is not enough. Always validate the app path the user actually uses: select the model through Vox Jot's catalog, load the available voice list, create or preview a voice preset, and confirm preview synthesis succeeds with the canonical app provider/model IDs rather than a raw Hugging Face repo alias.

## Gumroad Operations

Use the `gumroad` CLI for Gumroad product, sales, file, license, and content inspection before falling back to browser automation. This repo is configured with the `gumroad` CLI and agent skill; see `docs/gumroad-cli-agent-runbook.md`.

- Default to `gumroad ... --json --no-input --quiet` for agent commands.
- Do not commit or print Gumroad access tokens. Use the stored local auth, `GUMROAD_ACCESS_TOKEN`, or `gumroad auth login --with-token` on fresh machines.
- Vox Jot Gumroad product ID: `8UhuqxxzvPRLgPfGc37FFw==`; permalink: `voxjot`.
- Use `--dry-run` before mutating product metadata, custom pages, attachments, refunds, offer codes, or customer-visible content.
- Browser testing is still required for checkout, receipt, CAPTCHA/payment behavior, and full download/install flow validation.

## Text color visibility (contrast)

Body copy and interactive labels must remain readable on real surfaces (`--panel-bg`, `--card`, `--bg`, overlays). Targets follow **WCAG 2.x**: **≥ 4.5:1** contrast for normal-sized text, **≥ 3:1** for large or bold UI text. Semi-transparent shells and backdrop blur effectively lighten or darken backgrounds; avoid stacking extra faintness.

**Prefer**

- **`--text`** for primary readable content.
- **`--muted`** for secondary/helper copy (token is tuned toward ≥ 4.5:1 on panel-like surfaces across themes).

**Avoid or constrain**

- **`--text-subtle`** as the only cue for critical copy — keep it for **compact meta labels**; **`--muted` / `--text`** are calibrated in `src/App.css` per theme so secondary sentences stay readable (~AA on `--panel-bg`).
- **`color-mix(..., var(--text), transparent N)` on copy** — do not use heavy transparency to dim body text (e.g. 35%+ transparent). Prefer **`text-[var(--muted)]`** or **`text-[var(--text)]`**.
- **Opacity on text/icons** (`opacity-40`–`50`, **`placeholder:text-[var(--muted)]/40**`) for anything user must read—reserve for optional affordances only.
- **Undefined CSS vars** — e.g. `var(--color-text)` is invalid; primary text is **`var(--text)`** (see `@theme` / `:root` in `src/App.css`).

Adjust tokens in **`src/App.css`** if a theme’s **`--muted`** / **`--text-subtle`** still fails against that theme’s surfaces.

## macOS Installed-App Workflow

On macOS, the standard validation path for any solid app change is to update the already-installed `/Applications/Vox Jot.app` in place instead of relying on a fresh `tauri dev` app instance.

- App Store review branch note: if a new work branch changes App Store metadata, bundle IDs, signing, entitlements, version numbers, or release workflow files, keep those changes deliberate so they do not accidentally affect the reviewed `1.0` path.
- Use `bun run mac:update-installed-app:notarized` whenever a macOS change is ready for real app testing. Short alias: `bun run mac:update:notarized`. These are the only correct paths for syncing the running installed macOS app to the latest build.
- Plain macOS update aliases are intentionally blocked for all agents: `bun run mac:update`, `bun run mac:update-installed-app`, `bun run mac:build-install`, and `bun run mac:dev-installed-app`. Do not re-enable, bypass, or document them as working installed-app update commands.
- The installed-app workflow must be Developer ID signed, submitted to Apple notarization, stapled, and Gatekeeper-validated every time. It should fail instead of silently falling back to Apple Development signing, ad-hoc signing, or skipped notarization.
- Do not use direct Keychain probing such as `security find-generic-password -s voxjot-notary` to decide whether notarization credentials exist. The required preflight is `xcrun notarytool history --keychain-profile voxjot-notary`, or simply running `bun run mac:update-installed-app:notarized`, which performs the same notarytool credential validation.
- If the first installed-app attempt reports missing notarization credentials, verify with `xcrun notarytool history --keychain-profile voxjot-notary` before declaring the workflow blocked. A direct `security` lookup can report a false negative for a valid notarytool profile.
- Use `bun run mac:open-installed-app` (alias: `bun run mac:open-dev-app`) to launch the already-installed dev app without rebuilding. This preserves the same `/Applications/Vox Jot.app` path, bundle identity, and macOS permissions.
- This rebuilds the signed app bundle and replaces the contents of `/Applications/Vox Jot.app`, which preserves the existing system approval path so Accessibility and related permissions do not need to be re-granted for each solid change.
- Do not use `bun run tauri dev`, `bun run tauri build`, `open`, or a manually copied `.app` as the final answer for "sync the mac app", "run latest build", "installed app", or real macOS validation. `bun run tauri dev` is only for explicitly requested quick iteration when notarization and installed-app permissions are irrelevant.
- Keep this workflow as the default in future sessions and for any other agent working in this repo.

## Development Commands

**Prerequisites:**

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) package manager

**Core Development:**

```bash
# Install dependencies
bun install

# Standard macOS validation flow for solid changes
bun run mac:update-installed-app:notarized

# Run in development mode for quick iteration only
bun run tauri dev
# If cmake error on macOS:
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev

# Build for production
bun run tauri build

# Frontend only development
bun run dev        # Start Vite dev server
bun run build      # Build frontend (TypeScript + Vite)
bun run preview    # Preview built frontend
```

**Model Setup (Required for Development):**

```bash
# Create models directory
mkdir -p src-tauri/resources/models

# Download required VAD model
curl -L -o src-tauri/resources/models/silero_vad_v4.onnx https://github.com/cjpais/Vox-Jot/releases/latest/download/silero_vad_v4.onnx
```

## Architecture Overview

Vox Jot is a cross-platform desktop speech-to-text application built with Tauri (Rust backend + React/TypeScript frontend).

### Core Components

**Backend (Rust - src-tauri/src/):**

- `lib.rs` - Main application entry point with Tauri setup, tray menu, and managers
- `managers/` - Core business logic managers:
  - `audio.rs` - Audio recording and device management
  - `model.rs` - Whisper model downloading and management
  - `transcription.rs` - Speech-to-text processing pipeline
- `audio_toolkit/` - Low-level audio processing:
  - `audio/` - Device enumeration, recording, resampling
  - `vad/` - Voice Activity Detection using Silero VAD
- `commands/` - Tauri command handlers for frontend communication
- `shortcut.rs` - Global keyboard shortcut handling
- `settings.rs` - Application settings management

**Frontend (React/TypeScript - src/):**

- `App.tsx` - Main application component with onboarding flow
- `components/settings/` - Settings UI components
- `components/model-selector/` - Model management interface
- `hooks/` - React hooks for settings and model management
- `lib/types.ts` - Shared TypeScript type definitions

### Key Architecture Patterns

**Manager Pattern:** Core functionality is organized into managers (Audio, Model, Transcription) that are initialized at startup and managed by Tauri's state system.

**Command-Event Architecture:** Frontend communicates with backend via Tauri commands, backend sends updates via events.

**Pipeline Processing:** Audio → VAD → Whisper → Text output with configurable components at each stage.

### Technology Stack

**Core Libraries:**

- `whisper-rs` - Local Whisper inference with GPU acceleration
- `cpal` - Cross-platform audio I/O
- `vad-rs` - Voice Activity Detection
- `rdev` - Global keyboard shortcuts
- `rubato` - Audio resampling
- `rodio` - Audio playback for feedback sounds

**Platform-Specific Features:**

- macOS: Metal acceleration for Whisper, accessibility permissions
- Windows: Vulkan acceleration, code signing
- Linux: OpenBLAS + Vulkan acceleration

### Application Flow

1. **Initialization:** App starts minimized to tray, loads settings, initializes managers
2. **Model Setup:** First-run downloads preferred Whisper model (Small/Medium/Turbo/Large)
3. **Recording:** Global shortcut triggers audio recording with VAD filtering
4. **Processing:** Audio sent to Whisper model for transcription
5. **Output:** Text pasted to active application via system clipboard

### Settings System

Settings are stored using Tauri's store plugin with reactive updates:

- Keyboard shortcuts (configurable, supports push-to-talk)
- Audio devices (microphone/output selection)
- Model preferences (Small/Medium/Turbo/Large Whisper variants)
- Audio feedback and translation options

### Single Instance Architecture

The app enforces single instance behavior - launching when already running brings the settings window to front rather than creating a new process.

## Gemini 3.5 Agent Optimization & Exhaustive Task Audit Rule

This section governs how Gemini 3.5 and all 3.5 agent variants (including Antigravity and Claude Code) must parse, expand, and execute every user request in this repository, regardless of how simple or brief the user's initial prompt is.

### 1. Auto-Expansion of Inbound Prompts

When a user submits a prompt, the agent must not execute it blindly or partially. The agent must automatically expand the request into an internal multi-step strategy:

- **Exhaustive Code Search:** Instead of doing one or two quick searches, search across the entire project for all related keywords, file names, states, or custom UI patterns.
- **Trace to Definition:** For every matching UI element or handler, trace its control flow all the way to its state hook, backend command, or library definition. Never assume a function or helper is working without checking its source code.
- **Identify Environment Quirks:** Specifically analyze if a standard web API or pattern is being utilized (e.g., standard dialogs, native clipboard, file access, local storage, window events) and verify whether it runs correctly inside the Tauri and WebKit (macOS) production/sandbox container.

### 2. Zero-Miss Audit Protocol for Deletion and Actions

- **Explicit Confirmation Checks:** Every deletion, reset, or destructive action must have an active, visible confirmation dialog or inline UX state before executing.
- **Inline Confirmation Over Native Popups:** Standard browser dialogs (`window.confirm`, `window.alert`) are blocked or automatically bypassed in Tauri webviews. Therefore, agents must reject standard `window.confirm` calls and either use Tauri's native dialog plugin or implement custom React inline confirmation states (e.g., swapping a trash icon with a "Confirm Delete" checkmark and "Cancel" cross).
- **Audit Table Output:** For any audit or feature review, the agent must output a detailed file-by-file audit table detailing what was found, what triggers the action, how it is confirmed, and whether it has been verified to work under the Tauri runtime.

### 3. Exhaustive Verification Gate

Before declaring any task completed:

- Verify that no visible flow, button, or menu item was left non-functional or half-implemented.
- Run typecheck, linting, and build validation (e.g., `bun run build` / `bun run lint`) to guarantee no compilation errors are introduced.
- Summarize findings honestly, listing any potential side effects or runtime limitations explicitly.
