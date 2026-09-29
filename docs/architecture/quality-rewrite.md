# Quality rewrite

## Contract

Preserve the product's public commands, component exports, settings shape,
stored Reader data, visible controls, and normal operation. Two intentional
interaction changes were called out before implementation: shared reset controls
now require inline confirmation, and onboarding stays on its current step if a
required settings save fails. No features or navigation were added. Keep
recording, transcription, post-processing, paste, and overlay timing free of
added work.

## Current behavior and ownership map

| Surface                    | Entry and owner before the rewrite                                                                                           | Trigger and behavior to preserve                                                                                                                                          | Verification                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| App startup and navigation | `src/App.tsx`, `src/lib/appInitialization.ts`                                                                                | Onboarding precedes input/audio initialization; existing Dictate, Refine, Listen and Settings navigation                                                                  | Frontend unit and browser suites; installed app remains a separate gate                         |
| Live dictation             | `src-tauri/src/shortcut`, `actions/mod.rs`, `managers/audio.rs`, `managers/transcription.rs`                                 | Shortcut captures audio, transcribes, applies configured processing, saves history and outputs text; cancellation and selection guards remain                             | Existing Rust tests; microphone and cross-app paste require native acceptance                   |
| Settings                   | `src/stores/settingsStore.ts`, `src/hooks/useSettings.ts`, generated `src/bindings.ts`, Rust commands registered in `lib.rs` | Optimistic edits, native persistence, recovery after errors, per-key busy state and backend updates; platform defaults come from Rust                                     | Store, revision-ordering and command/action contract tests                                      |
| Devices and shortcuts      | Same settings store; `commands/audio.rs`, `shortcut`                                                                         | Audio enumeration starts after onboarding; default device normalization; native shortcut success and errors                                                               | Store tests and native command types                                                            |
| Provider setup             | Same settings store; `shortcut` provider commands                                                                            | Provider selection refreshes settings; changing endpoint clears model only after the endpoint saves; API keys remain in native secure storage                             | Store tests; no credentials used by tests                                                       |
| Language and voice sync    | Same settings store; `lib/languageSync.ts`, `lib/modelPlatform.ts`, native TTS commands                                      | Existing model/language eligibility, automatic versus explicit sync, active preset updates, locale labels and messages                                                    | Language and store tests                                                                        |
| Media transcription        | `src/components/dictate/FileTranscriptionPanel.tsx`, `commands/transcription.rs`, `commands/speech_analysis.rs`              | File picker/drop, transcribe or clean/transcribe, copy, timed subtitle export and transcript readback                                                                     | Browser harness and frontend build; native media inference separate                             |
| Reader                     | Same 4,602-line panel; `commands/reader.rs`; existing `dictate/reader` components                                            | Import/list/open documents; section voice and language choices; playback/cache/export; reading progress; inline confirmation before removal                               | Reader unit and browser tests; native synthesis/export separate                                 |
| Watched folders            | Same panel; `commands/transcription.rs`, `managers/watch_folders.rs`                                                         | Add folder, select output format, scan existing files, five-item activity feed; cancel/confirm before removal                                                             | Browser harness and native Rust tests                                                           |
| Speech model assets        | `src-tauri/src/tts.rs`, `tts/runtime.rs`, `artifact_download.rs`                                                             | Pack archive fallback to HF snapshot; pack snapshots nest under repo basename, MLX snapshots use exact destination; authentication, cancellation and progress event shape | New local-HTTP integration tests and full Rust suite                                            |
| Other retained domains     | Meetings, Story Studio, model catalogs, OCR, local HTTP API, Python speech/OCR workers                                       | Existing behavior, command registration and distribution boundaries                                                                                                       | Existing test suites; these domains are not comprehensively rewritten or runtime-certified here |

## Target structure and slices

1. **Settings actions.** Keep the public Zustand store and hook APIs. Give
   command dispatch, device discovery, binding updates, provider setup, and
   language/voice selection their own typed modules. Assemble them once in
   the store. Remove duplicate device-loading and untyped command-result
   casts. Preserve caller-facing error handling.
2. **File workflows.** Keep the two public panel exports. Separate the
   workspace shell/toolbar, media workflow, watched-folder controls, Reader
   document orchestration, Reader display, native commands and persisted
   state. Keep component identity, mount conditions and JSX behavior stable.
   Test storage, command payloads and destructive confirmation flows.
3. **Speech snapshots.** Replace duplicate snapshot algorithms with one
   downloader and a typed layout choice. Keep the original archive-first
   policy, paths, request/event formats and cancellation behavior. Test with
   temporary directories and a local HTTP server; do not download models or
   alter distributed runtime assets.
4. **Native settings ownership.** Use one typed update contract and serialized
   settings writes. Separate validation, persistence, runtime effects, and domain
   commands. Keep published command adapters thin and preserve their payloads,
   responses, default values, and permissions. Give the local HTTP API an explicit
   compatibility boundary that calls these same owners.
5. **Reconciliation and cleanup.** Make committed settings snapshots authoritative
   for the store, app language and overlay. Reject stale asynchronous results,
   retain pending edits, remove duplicate setters and obsolete subscriptions,
   regenerate bindings, and verify the complete inherited draft together.

Each slice must typecheck and pass its focused tests before proceeding.

## Protected UX flows

Apply the UX heuristics guardrails: preserve navigation order,
visible status/errors, labels, focus handling, accessible names, target sizes,
contrast tokens, native file dialogs and existing inline confirmations.
Do not replace confirmation controls with browser dialogs. The implementation
changes ownership rather than visual design. Keep audio work off rendering
and settings initialization paths.

## Implemented ownership and action audit

Paths below are relative to `src/` unless they start with `src-tauri/` or `tests/`.
The browser suite uses a native-command harness. Its confirmation and keyboard
checks verify frontend behavior, not the installed Tauri runtime.

| Owner/files                                                                                                                                                                    | Trigger and responsibility                                                                                                             | Confirmation/error handling                                                                                                                         | Evidence                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stores/settingsStore.ts`, `stores/settings/{SettingsEdits,bindingActions,deviceActions,providerActions,languageActions}.ts`                                                   | Assemble the public store; serialize edits per key; combine committed revisions with pending edits; discard stale provider model lists | Retain busy state until queued work finishes; report failures and reconcile the committed snapshot                                                  | Unit tests cover stale reads/events, queued edits, binding failures, provider races and language sync                                                                            |
| `src-tauri/src/settings/{update.rs}`, `settings_runtime.rs`, `settings.rs`                                                                                                     | Validate typed updates; serialize read/modify/write; own runtime effects and revisioned snapshots                                      | Capture reconfiguration requires idle state and rolls back on failure; public snapshots remove legacy credentials                                   | Native tests, both Clippy configurations; persistence retains the existing store/autosave semantics                                                                              |
| `src-tauri/src/commands/settings.rs`, `commands/settings/{preferences,aliases}.rs`, `commands/{post_process,snippets}.rs`                                                      | Keep native names and wire contracts while delegating to the shared implementations                                                    | Existing result envelopes and endpoint/default-device semantics retained                                                                            | `tests/contracts/native-api.v1.ts` and `lib/commandContracts.test.ts` check all 381 baseline commands, structural types and permissions; generated-binding freshness test passes |
| `src-tauri/src/http_api/{mod,settings_contract}.rs`                                                                                                                            | Preserve settings patch/command routes and microphone, output and clamshell routes                                                     | Preserve protected fields, payload aliases, response metadata and requested keys for no-op patches                                                  | Frozen contract covers 88 route/method entries and 61 patchable fields; Rust tests cover payload/schema/default/provider handling                                                |
| `i18n/{AppLanguageSync,index}.ts`, `lib/settingsEvents.ts`, `overlay/RecordingOverlay.tsx`                                                                                     | Apply initial and event snapshots by revision; load/change only the current language                                                   | Failed locale loads remain retryable; late subscriptions are cleaned up; old snapshots cannot overwrite newer state                                 | Language/event/overlay tests; existing unit-valued `settings-changed` event retained for native listeners                                                                        |
| `components/settings/DeviceSelectorSetting.tsx`, `lib/audioDevices.ts`                                                                                                         | Share microphone, output and clamshell selection; normalize the system-default sentinel                                                | Shared inline reset confirmation; existing device errors remain visible                                                                             | Unit/type checks and full browser suite; physical device switching needs native acceptance                                                                                       |
| `components/ui/ResetButton.tsx`                                                                                                                                                | First activation exposes Reset and Cancel; confirmation invokes the supplied reset                                                     | Cancel, Escape and blur cancel; keyboard focus retained; disabled controls cannot confirm                                                           | Three focused tests; shared focus styles, readable tokens and 44px targets reviewed                                                                                              |
| `components/settings/{GlobalShortcutInput,HandyKeysShortcutInput,LanguageSelector}.tsx`, `components/ui/SelectorSetting.tsx`                                                   | Every remaining shared reset caller uses the same confirmation owner                                                                   | Duplicate shortcut confirmation removed; generic selector reset only appears when requested (current acoustic-profile parent does not request it)   | Every reset parent inspected; component tests and typecheck                                                                                                                      |
| `components/settings/post-processing/PostProcessingSettings.tsx`                                                                                                               | Refresh available models                                                                                                               | Refresh remains a single action and uses `ActionIconButton`, not the reset component                                                                | Caller audit, build and unit suite                                                                                                                                               |
| `App.tsx`, `components/onboarding/{OllamaSetup,RefineStep}.tsx`                                                                                                                | Complete onboarding/provider selection only after required saves succeed                                                               | Existing error toast; failed save keeps the step available for retry                                                                                | Build, store failure tests and browser onboarding scenarios                                                                                                                      |
| `components/dictate/FileTranscriptionPanel.tsx`, `file-workspace/*`                                                                                                            | Preserve both public panel exports; separate shell, toolbar, ASR selection and media transcription                                     | Existing statuses, native picking, drop, copy, subtitle export and readback retained                                                                | Media workflow tests and browser scenarios                                                                                                                                       |
| `components/dictate/reader/{ReaderDocumentsPanel,ReaderSectionView,readerCommands,readerDocumentState,readerLibrary,readerPresentation,useReaderUnitAudio,ReaderAudioCache}.*` | Separate Reader orchestration, rendering, typed commands, stored state and audio ownership                                             | Existing inline removal confirmation; unchanged storage keys and limits; bounded 16-entry blob cache deduplicates loads and revokes URLs on release | Reader storage/command/cache tests, browser removal confirmation                                                                                                                 |
| `components/dictate/watch-folders/*`                                                                                                                                           | Folder controls, output format, existing-file scan and activity presentation                                                           | Existing Cancel/Confirm removal flow retained; native folder dialog retained                                                                        | Browser confirmation scenarios and Rust tests                                                                                                                                    |
| `components/settings/ExternalModelStorage.tsx`                                                                                                                                 | Settings → Privacy & Storage → Storage → “Scan external storage for models”; Browse chooses the library location                       | Existing status/error text and auto-detect behavior retained; switching or clearing a location does not delete models                               | New browser scenario uses keyboard activation, folder selection, clear and status updates; native picker is represented by a command stub                                        |
| `src-tauri/src/tts/downloads.rs`, `tts/downloads/snapshot.rs`                                                                                                                  | One snapshot downloader with explicit repository-subdirectory or exact-directory layout                                                | Authenticate, cancel, report progress; validate paths before clearing a destination                                                                 | Seven local-HTTP tests cover both layouts, unknown size, auth errors, cancellation, traversal and truncated downloads                                                            |

Other domain writers now call the serialized settings owner: model selection,
OCR, Refine, TTS presets/profiles, Story Studio, watched folders and write rules.
Their domain behavior remains in the existing managers. Live transcription,
model inference, post-processing, paste/output, model catalogs, Meetings and
Python workers were retained; this is not a claim that every domain was rewritten.
Reader orchestration remains a larger component with its storage, commands,
display and audio lifecycle extracted.

Removed the old monolithic settings-store implementation/tests, duplicate
preference implementations in shortcut code, duplicated device controls and
snapshot download loops, obsolete settings-event wrapper, dead imports/state,
and draft HTTP replacements that would have broken existing clients. Compatibility
adapters remain intentionally: the native API contract exercises them. TypeScript
now checks unused locals and parameters. Existing compatible dependency updates
were preserved and their lockfiles, Nix metadata and license notices reconciled.

## Verification

Initial baseline recorded before the rewrite: clean `main`; 61 frontend test
files, 302 tests passed; frontend lint passed. The continuation preserved the
inherited draft on `codex/quality-rewrite`, based on
`cadc0a5170ea77314993b4c285f55892a356bca8`. Starting-state backups are under
`/tmp/vox-jot-rewrite-resume/`.

Final source verification on September 29, 2026:

| Check                                                                         | Result                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bun run build` / `bun run lint`                                              | Passed production TypeScript/Vite build and ESLint                                             |
| `bun run test:unit`                                                           | 70 files, 344 tests passed                                                                     |
| `bun run test:playwright`                                                     | 19 Chromium scenarios passed                                                                   |
| `cargo check --manifest-path src-tauri/Cargo.toml`                            | Passed                                                                                         |
| Default `cargo test`                                                          | 753 passed, 1 explicitly ignored real-model evaluation                                         |
| `cargo test --no-default-features --features ci-mock-transcription`           | 742 passed                                                                                     |
| `cargo clippy --all-targets -- -D warnings`, default and mock configurations  | Both passed                                                                                    |
| Speech runtime Python tests                                                   | 49 passed                                                                                      |
| OCR runtime Python tests                                                      | 9 passed                                                                                       |
| Benchmark methodology helper tests                                            | 4 passed; methodology v2 validation also passed                                                |
| Screen-context capture gate, compiled with its Swift support source           | Passed stale-request/capture ownership checks                                                  |
| Translation validation                                                        | All 16 non-English locales complete                                                            |
| Model license validation / generated third-party notices                      | Passed; notices checked after the final build                                                  |
| `bun audit`                                                                   | No vulnerabilities after updating the existing `undici` override from 7.29.0 to patched 7.29.1 |
| `cargo audit` / `cargo deny check advisories`                                 | Passed under existing policy; four acknowledged warnings remain, detailed below                |
| Gitleaks / changed-file formatting / `cargo fmt --check` / `git diff --check` | Passed                                                                                         |
| Bun/Nix dependency metadata                                                   | Regenerated and hash checked; native Nix build unavailable because Nix is not installed        |

Full verification logs are local at `/tmp/vox-jot-final-*.log`. The patched
`undici` version addresses
[GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v)
in the jsdom test dependency chain. No application feature depends on this change.

### Residual risk and acceptance boundaries

- Existing Rust advisories remain: unmaintained `paste` (RUSTSEC-2024-0436),
  `proc-macro-error` (RUSTSEC-2024-0370), `ttf-parser` (RUSTSEC-2026-0192), and
  Linux GTK dependency `glib` iterator unsoundness (RUSTSEC-2024-0429). Their
  upstream dependency chains and the existing advisory policy were not replaced
  or weakened. Passing the audit does not mean these warnings were fixed.
- The ignored Rust evaluation needs `VOX_JOT_CONTEXT_EVAL_MODEL` and
  `VOX_JOT_CONTEXT_EVAL_OUTPUT` and performs 105 real ASR calls. No full model
  benchmark was run and no ranked benchmark data was changed.
- Browser tests exercise frontend behavior with native commands stubbed. Native
  microphone/device switching, global shortcuts, cross-app paste, synthesis,
  export and installed-app startup still require acceptance on a new installed
  build. Windows/Linux native builds were not run here.
- No installed-app build, notarization, installation or distribution was performed
  for this rewrite. The previously installed app is not evidence for these edits.
- Latency is expected to be unchanged: settings transactions and runtime effects
  run on settings edits, downloads stay outside inference, and cached settings
  remain the recording-path read mechanism. Language/overlay consumers avoid
  redundant settings reads. End-to-end recording and stop-to-paste timings were
  not measured in a new installed build.
