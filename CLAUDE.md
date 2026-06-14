# CLAUDE.md

> **CRITICAL ARCHITECTURE NOTE FOR ALL AGENTS:**
> This application is currently under active, early-stage development and has no active users. **Backward compatibility is NOT required.** Do not worry about preserving old APIs, data structures, or behaviors if a better approach exists. We are pushing forward to build a stronger app. Feel free to make breaking changes, refactor aggressively, and improve the architecture wherever possible.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## macOS Installed-App Workflow

On macOS, the default path for validating any solid app change is to rebuild and update the existing `/Applications/Vox Jot.app` bundle in place.

- Use `bun run mac:update-installed-app:notarized` when a change is ready to test as the real app. Short alias: `bun run mac:update:notarized`. Both run `scripts/build-and-install-macos-app.sh`, which Developer ID signs → Apple-notarizes → staples → Gatekeeper-validates → replaces `/Applications/Vox Jot.app` → opens the installed app. This preserves the app path that already has Accessibility and related approvals, so we do not keep re-authorizing new app instances.
- This requires notary credentials: a stored `voxjot-notary` notarytool keychain profile, or `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`, or `APPLE_API_KEY` + `APPLE_API_ISSUER` + `APPLE_API_KEY_PATH`. Run `bun run mac:setup-notary` once to configure the keychain profile; without valid credentials the command fails during preflight before building.
- Plain update aliases are blocked for all agents: `bun run mac:update`, `bun run mac:update-installed-app`, `bun run mac:build-install`, and `bun run mac:dev-installed-app`. Running any of them executes `scripts/block-plain-macos-update.sh`, which exits 1 and directs you to the notarized flow.
- Use `bun run tauri dev` only for fast iteration when installed-app validation is not required. Dev (debug) builds skip single-instance **and** the release-only macOS startup paths, so any window or startup behavior must be validated with a release build (`mac:update-installed-app:notarized`), not dev.
- Treat this as the standard workflow for all future sessions and agents in this repo.

## Production Distribution Policy

GitHub Releases are blocked for Vox Jot app distribution. Do not create GitHub releases, upload app release assets to GitHub releases, or run the GitHub `Release` / `Release macOS` workflows as a distribution fallback. This block is enforced technically, not just by policy: `.github/workflows/release.yml` and `release-macos.yml` are neutered to fail-fast guard jobs (any dispatch exits 1 with a redirect), `.github/workflows/build.yml` rejects release publishing when `release-id` is passed, and `scripts/publish-release-to-hf.ts` is a block stub. Do not restore their release/`createRelease` logic — it lives in git history only.

Use the local Cloudflare R2 + Gumroad + updater feed distributor for public releases:

```bash
VOX_JOT_R2_BUCKET="vox-jot-downloads" \
TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/voxjot-updater.key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..." \
bun run release:local-mac -- <version>
```

If notarization, R2, updater signing, Hugging Face, Gumroad, website, or public-download verification is blocked, report that exact blocker and stop. Do not use GitHub Releases or GitHub Actions release workflows instead.

## Development Commands

**Prerequisites:** [Rust](https://rustup.rs/) (latest stable), [Bun](https://bun.sh/)

```bash
# Install dependencies
bun install

# Standard macOS validation flow for solid changes
bun run mac:update-installed-app:notarized

# Run in development mode for quick iteration only
bun run tauri dev
# If cmake error on macOS:
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev

# Debug builds skip single-instance and the release-only macOS startup paths, so dev can run
# alongside the installed app — but validate window/startup behavior on a release build, not dev.

# Build for production
bun run tauri build

# Linting and formatting (run before committing)
bun run lint              # ESLint for frontend
bun run lint:fix          # ESLint with auto-fix
bun run format            # Prettier + cargo fmt
bun run format:check      # Check formatting without changes
```

**Model Setup (Required for Development):**

```bash
mkdir -p src-tauri/resources/models
```

`src-tauri/resources/models/silero_vad_v4.onnx` is committed in the repo, so no manual download step is required for normal development.

## Architecture Overview

Vox Jot is a cross-platform desktop speech-to-text app built with Tauri 2.x (Rust backend + React/TypeScript frontend).

### Backend Structure (src-tauri/src/)

- `lib.rs` - Main entry point, Tauri setup, manager initialization
- `managers/` - Core business logic:
  - `audio.rs` - Audio recording and device management
  - `model.rs` - Model downloading and management
  - `transcription.rs` - Speech-to-text processing pipeline
  - `history.rs` - Transcription history storage
- `audio_toolkit/` - Low-level audio processing:
  - `audio/` - Device enumeration, recording, resampling
  - `vad/` - Voice Activity Detection (Silero VAD)
- `commands/` - Tauri command handlers for frontend communication
- `shortcut.rs` - Global keyboard shortcut handling
- `settings.rs` - Application settings management

### Frontend Structure (src/)

- `App.tsx` - Main component with onboarding flow
- `components/settings/` - Settings UI (35+ files)
- `components/model-selector/` - Model management interface
- `components/onboarding/` - First-run experience
- `hooks/useSettings.ts`, `useModels.ts` - State management hooks
- `stores/settingsStore.ts` - Zustand store for settings
- `bindings.ts` - Auto-generated Tauri type bindings (via tauri-specta)
- `overlay/` - Recording overlay window code

### Key Patterns

**Manager Pattern:** Core functionality organized into managers (Audio, Model, Transcription) initialized at startup and managed via Tauri state.

**Command-Event Architecture:** Frontend → Backend via Tauri commands; Backend → Frontend via events.

**Pipeline Processing:** Audio → VAD → Whisper/Parakeet → Text output → Clipboard/Paste

**State Flow:** Zustand → Tauri Command → Rust State → Persistence (tauri-plugin-store)

## Internationalization (i18n)

All user-facing strings must use i18next translations. ESLint enforces this (no hardcoded strings in JSX).

**Adding new text:**

1. Add key to `src/i18n/locales/en/translation.json`
2. Use in component: `const { t } = useTranslation(); t('key.path')`

**Product vocabulary (user-facing):** Use **Phrase keys** (sidebar + settings; not “Snippets”), **Dictation modes** (the Refine sidebar label for the write-rules/app-aware-tone feature; code still calls these write rules/profiles — never “Flow Styles”), **Labs** (experimental settings), **Privacy & data** (data/privacy section). Tray menu labels are generated from `translation.json` at build time (`src-tauri/build.rs`). To re-sync non-English locales after large English copy changes, adjust and run `scripts/sync_differentiated_naming_i18n.py` as a starting point, then run `bun run check:translations`.

**UI navigation structure (verified against the running app 2026-06-12) — section components live in `src/components/app-sections/`:**

| Top Nav      | Sidebar Label                                                                                   | Code Component (`app-sections/`)                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dictate**  | Home, Dictionary, File Transcription, Reader, Enhance Audio                                     | `DictateHistorySection`, `CorrectionsSection`, `FileTranscriptionSection`, `ReaderSection`, `EnhanceAudioSection` (`dictate.tsx`)                           |
| **Refine**   | Dictation Modes, Phrase Keys, Translation                                                       | `RefineProfilesSection`, `RefinePhraseKeysSection`, `RefineTranslationSection` (`refineCore.tsx`)                                                           |
| **Listen**   | Studio, Voice Design, Voice Cloning, Voice Changer, Generated Audio                             | `StoryStudioAppSection`, `ListenVoiceDesignSection`, `ListenVoiceCloningSection`, `ListenVoiceChangerSection`, `StoryAudioHistoryAppSection` (`listen.tsx`) |
| **(bottom)** | Model Hub                                                                                       | Model Hub overlay (`src/components/model-hub/`) — all model categories (STT, Speech Analysis, LLM, TTS, Creative Audio, Audio Cleanup, Screen OCR)          |
| **Settings** | Basics: App & Dictation, Shortcuts, Recording & Devices, Output & Paste                         | `GeneralAppSettingsSection`, `ShortcutsSettingsSection`, `RecordingDevicesSettingsSection`, `OutputPasteSettingsSection` (`settings.tsx`)                   |
| **Settings** | Intelligence: Corrections, Models & AI, Testing, Screen Context                                 | `CorrectionsSettingsSection`, `AISetupSettingsSection`, Testing leaderboard (`app-sections/testing/`), Screen Context                                       |
| **Settings** | System: Privacy & Storage, Legal & Model Terms, Automation & Agents, Diagnostics, About Vox Jot | `PrivacyStorageSettingsSection`, `LegalModelTermsSection`, `AutomationAgentsSettingsSection`, `DiagnosticsSettingsSection`, `AboutSection`                  |

When a label here disagrees with the running app or the exports in `src/components/app-sections/`, trust the code and update this table.

**File structure:**

```
src/i18n/
├── index.ts           # i18n setup
├── languages.ts       # Language metadata
└── locales/
    ├── en/translation.json  # English (source)
    ├── es/translation.json  # Spanish
    ├── fr/translation.json  # French
    └── vi/translation.json  # Vietnamese
```

## Code Style

**Rust:**

- Run `cargo fmt` and `cargo clippy` before committing
- Handle errors explicitly (avoid unwrap in production)
- Use descriptive names, add doc comments for public APIs

**TypeScript/React:**

- Strict TypeScript, avoid `any` types
- Functional components with hooks
- Tailwind CSS for styling
- Path aliases: `@/` → `./src/`

## Commit Guidelines

Use conventional commits:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation
- `refactor:` code refactoring
- `chore:` maintenance

## CLI Parameters

Vox Jot supports command-line parameters on all platforms for integration with scripts, window managers, and autostart configurations.

**Implementation files:**

- `src-tauri/src/cli.rs` - CLI argument definitions (clap derive)
- `src-tauri/src/main.rs` - Argument parsing before Tauri launch
- `src-tauri/src/lib.rs` - Applying CLI overrides (setup closure + single-instance callback)
- `src-tauri/src/signal_handle.rs` - `send_transcription_input()` reusable function

**Available flags:**

| Flag                     | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `--toggle-transcription` | Toggle recording on/off on a running instance (via `tauri_plugin_single_instance`) |
| `--toggle-post-process`  | Toggle recording with post-processing on/off on a running instance                 |
| `--cancel`               | Cancel the current operation on a running instance                                 |
| `--start-hidden`         | Launch without showing the main window (tray icon still visible)                   |
| `--no-tray`              | Launch without the system tray icon (closing window quits the app)                 |
| `--debug`                | Enable debug mode with verbose (Trace) logging                                     |

**Key design decisions:**

- CLI flags are runtime-only overrides — they do NOT modify persisted settings
- Remote control flags (`--toggle-transcription`, `--toggle-post-process`, `--cancel`) work by launching a second instance that sends its args to the running instance via `tauri_plugin_single_instance`, then exits
- `send_transcription_input()` in `signal_handle.rs` is shared between signal handlers and CLI to avoid code duplication
- `CliArgs` is stored in Tauri managed state (`.manage()`) so it's accessible in `on_window_event` and other handlers

## Debug Mode

Access debug features: `Cmd+Shift+D` (macOS) or `Ctrl+Shift+D` (Windows/Linux)

## Platform Notes

- **macOS**: Metal acceleration, accessibility permissions required
- **Windows**: Vulkan acceleration, code signing
- **Linux**: OpenBLAS + Vulkan, limited Wayland support, overlay disabled by default
