# Testing Spec

This repository already had meaningful backend coverage, but its frontend testing story was uneven: one Playwright spec for the main app, Python tests for the speech runtime, and many Rust inline unit tests, with almost no direct TypeScript unit coverage.

This spec keeps the existing strengths and fills the frontend logic gap with fast Vitest coverage.

## Test Commands

- `bun run test:unit`
- `bun run test:playwright`
- `cd src-tauri && cargo test`
- `cd speech-runtime && python3 -m unittest discover -s tests -p 'test_*.py'`
- `cd speech-runtime && python3 -m runtime.app`

## Existing Coverage Already In Repo

### Frontend end-to-end

- [`tests/app.spec.ts`](tests/app.spec.ts)
  Covers onboarding flow, permission gating, post-process UI variants, write profiles, history rendering, debug tools, and Apple Intelligence availability states.

### Python speech runtime

- [`speech-runtime/tests/test_runtime_controls.py`](speech-runtime/tests/test_runtime_controls.py)
  Covers runtime control mapping behavior.
- [`speech-runtime/tests/test_runtime_voice_inventory.py`](speech-runtime/tests/test_runtime_voice_inventory.py)
  Covers runtime voice inventory and selection behavior.

### Rust unit suites

These are embedded inline with `#[test]` blocks and already cover a lot of core backend logic:

- [`src-tauri/src/actions.rs`](src-tauri/src/actions.rs)
- [`src-tauri/src/settings.rs`](src-tauri/src/settings.rs)
- [`src-tauri/src/tts.rs`](src-tauri/src/tts.rs)
- [`src-tauri/src/clipboard.rs`](src-tauri/src/clipboard.rs)
- [`src-tauri/src/managers/model.rs`](src-tauri/src/managers/model.rs)
- [`src-tauri/src/audio_toolkit/text.rs`](src-tauri/src/audio_toolkit/text.rs)
- [`src-tauri/src/correction_tracker/diff.rs`](src-tauri/src/correction_tracker/diff.rs)
- [`src-tauri/src/correction_tracker/app_classifier.rs`](src-tauri/src/correction_tracker/app_classifier.rs)
- [`src-tauri/src/correction_tracker/recent_input.rs`](src-tauri/src/correction_tracker/recent_input.rs)
- [`src-tauri/src/correction_tracker/store.rs`](src-tauri/src/correction_tracker/store.rs)
- [`src-tauri/src/helpers/clamshell.rs`](src-tauri/src/helpers/clamshell.rs)
- [`src-tauri/src/github_release.rs`](src-tauri/src/github_release.rs)
- [`src-tauri/src/tray.rs`](src-tauri/src/tray.rs)
- [`src-tauri/src/regression.rs`](src-tauri/src/regression.rs)
- [`src-tauri/src/apple_intelligence.rs`](src-tauri/src/apple_intelligence.rs)

## New Coverage Added In This Change

### Frontend unit tests

- [`src/lib/languageSync.test.ts`](src/lib/languageSync.test.ts)
  Covers app language normalization, preset selection, model auto-pick rules, provider preference, locale fallback, and TTS voice selection logic.
- [`src/lib/ttsVoicePresets.test.ts`](src/lib/ttsVoicePresets.test.ts)
  Covers Tauri invoke wiring and error normalization for TTS preset commands.
- [`src/lib/utils/keyboard.test.ts`](src/lib/utils/keyboard.test.ts)
  Covers key parsing, modifier naming, display formatting, and left/right normalization.
- [`src/lib/utils/customUpdateChecker.test.ts`](src/lib/utils/customUpdateChecker.test.ts)
  Covers update feed URL selection, semver comparison behavior, error handling, and download URL opening.
- [`src/lib/utils/modelTranslation.test.ts`](src/lib/utils/modelTranslation.test.ts)
  Covers translated-name and translated-description fallback behavior.
- [`src/lib/utils/format.test.ts`](src/lib/utils/format.test.ts)
  Covers model size formatting for invalid, MB, and GB inputs.
- [`src/lib/utils/rtl.test.ts`](src/lib/utils/rtl.test.ts)
  Covers RTL language detection and document direction/language updates.

### Playwright additions

- [`tests/app.spec.ts`](tests/app.spec.ts)
  Added coverage for revealing advanced model options during onboarding.

## Coverage Intent

The goal is a layered test strategy:

- Rust unit tests protect backend state transitions, text processing, clipboard behavior, and TTS/audio internals.
- Python tests protect the speech runtime adapter layer.
- Vitest protects frontend decision logic and utility behavior.
- Playwright protects real app flows and high-value UI regressions.

## Remaining Gaps Worth Adding Later

- Store-level tests around `settingsStore` side effects and command integration.
- Component tests for history actions, model cards, and post-process forms.
- More Playwright coverage for history interactions and multi-platform permission UX.
- Installed-app smoke validation for macOS after major Tauri changes using `bun run mac:update-installed-app:notarized`.
