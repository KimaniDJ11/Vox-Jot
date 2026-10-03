# Pinned destinations: implementation and acceptance

## Product contract

Pinned destinations are an opt-in macOS desktop feature. Settings → Output &
Paste → Pinned destination enables the two configurable shortcuts: Pin text
field (Option–Command–P) and Clear pinned field (Option–Command–U). A pin belongs
to the next dictation or meeting. Clearing, disabling or replacing it cancels
that destination; an in-flight recording never switches to a new target.

Ordinary dictation, explicit selection rewriting and selection translation keep
their existing output paths. A pinned run uses the pinned application's context,
disables unrelated screen capture and never automatically submits a message.
The global no-paste setting still prevents automatic insertion. Clipboard-only
output remains recoverable through Copy.

The native backend is excluded from App Store and non-macOS builds. Their public
commands report unavailable, and their shortcuts and controls stay unavailable.
The shared settings update rejects enabling an unsupported build. This is an
additive API change: existing commands, routes and request formats are preserved.

## Responsibilities and source audit

The table records source and automated verification. Installed-app results belong
to the integration PR's validation report; browser mocks do not establish native
Accessibility behavior.

| Owner                                                                                                         | Trigger and responsibility                                                                                                         | Recovery / confirmation                                                                                                                               | Verification                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src-tauri/src/pinned_target/mod.rs`                                                                          | Pin, bind one recording, clear, deliver and recover. Publishes revisioned state; serializes requests to one AX worker.             | A generation change cancels old destinations. Successful delivery clears the pin.                                                                     | Generation cancellation and retry eligibility tests.                                              |
| `pinned_target/macos.rs`                                                                                      | Captures the original process, window and field; retains AX handles on the worker.                                                 | Requires Accessibility permission, supported nonsecure text attributes and exact identity. Ambiguous or stale targets fail closed.                    | Native code compiles; installed cross-app acceptance remains an independent gate.                 |
| `pinned_target/resolve.rs`                                                                                    | Resolves a rebuilt field only by a unique stable identifier within the original window.                                            | Complete search required; 500 nodes, depth 12, 1.5-second deadline and 150-ms AX messaging limits.                                                    | Unique, duplicate and truncated-tree tests.                                                       |
| `pinned_target/write.rs`                                                                                      | Appends in Unicode-safe chunks with an empty selection at the current UTF-16 end.                                                  | Persists a checkpoint before each possible write, then rechecks value and selection. Reads back each chunk. Partial or uncertain writes cannot retry. | Unicode, separators, concurrent edits, checkpoint failure, cancellation and partial-write tests.  |
| `managers/history/delivery.rs`                                                                                | Stores exact output, claims attempts in a database transaction and records verified progress.                                      | Restart never replays a possible write. Database triggers protect active delivery and remove delivery text with deleted history.                      | Claim exclusion, restart recovery and deletion tests.                                             |
| `actions/mod.rs`, `actions/history_save.rs`                                                                   | Binds a pin at dictation start; persists final text and audio before delivery. Ordinary output uses a one-shot history save guard. | Save failure retains an in-memory Copy result and suppresses insertion. Rejected, cancelled or dropped ordinary output still saves history once.      | Existing action suite plus four history recovery tests.                                           |
| `meeting_capture/mod.rs`                                                                                      | A pinned meeting stop finalizes audio, transcribes, saves transcript files, then queues delivery.                                  | Holds the meeting job through delivery; cancellation/deletion cannot race that job. Re-transcription never automatically inserts again.               | Existing meeting lifecycle tests; native capture remains a separate acceptance case.              |
| `clipboard.rs`                                                                                                | Explicit “Bring app forward and paste” recovery uses the existing clipboard path.                                                  | Focus is checked again after clipboard preparation and the configured delay. Auto-submit and duplicate trailing spaces are suppressed.                | Compiled with both desktop and excluded configurations; native focus-race acceptance is required. |
| `commands/pinned_target.rs`, `permissions/app-commands.toml`                                                  | Typed native command boundary; main window owns recovery. Overlay reads pin and settings snapshots.                                | Errors are returned explicitly; capability tests verify every generated native command is permitted.                                                  | Command permission coverage and generated-binding checks.                                         |
| `settings/update.rs`, `settings_runtime.rs`, `shortcut/{mod,handy_keys}.rs`                                   | Shared setting toggles both shortcut implementations and cancels a disabled pin.                                                   | Availability enforced in Rust, including startup normalization.                                                                                       | Default and App Store compilation; existing settings/shortcut tests.                              |
| `components/settings/PinnedPasteSettings.tsx`                                                                 | User enables the feature and configures shortcuts in Output & Paste.                                                               | Existing labelled switches and shortcut editors; no new navigation or browser dialogs.                                                                | Build, lint and browser navigation.                                                               |
| `hooks/usePinState.ts`                                                                                        | Subscribes before loading a snapshot; accepts only current revisions.                                                              | Disposes late listeners after unmount and reports subscription failures.                                                                              | Stale-snapshot and late-unmount tests.                                                            |
| `components/pinned-target/PinnedDelivery.tsx`                                                                 | Shows pinned status and saved delivery controls in notifications, History and Meetings.                                            | Partial/uncertain or unsaved results offer Copy only; duplicate retry clicks are suppressed. Load failures are visible.                               | Three control tests; native delivery remains a separate gate.                                     |
| `App.tsx`, `RecordingOverlay.tsx`, `HistorySettings.tsx`, `MeetingsSection.tsx`, `CommandMenu.tsx`, `tray.rs` | Displays destination/status and exposes saved text through existing recovery surfaces.                                             | Clear is reversible. Existing saved-content deletion confirmations remain in place.                                                                   | Frontend tests and browser suite.                                                                 |
| `src/i18n/locales/*/translation.json`                                                                         | Settings, shortcuts, status and recovery labels in all 17 supported locales.                                                       | Retains interpolation tokens and readable status/error colors.                                                                                        | Translation structure, placeholder and untranslated-text checks.                                  |

## Delivery and safety limits

The database owns the delivery state. Only pending/deferred records with zero
confirmed output and no possible write may be claimed. A failed final status save
publishes an uncertain recovery result; the durable pre-write checkpoint still
blocks replay after restart. Unresolved records are excluded from automatic
history retention. Explicit history deletion removes the associated delivery
record as well.

Background delivery never raises the target app or sends keyboard input. The
explicit foreground recovery action is distinct and guarded. All AX resolution,
verification and delivery persistence run outside the ordinary recording/output
path. No network call, model load or extra mutex was added to ordinary dictation.
Pinned output intentionally waits for durable saving before insertion.

Accessibility cannot provide an atomic compare-and-insert transaction across
applications. The implementation minimizes the interval between its final checks
and insertion, then verifies the result. It reports uncertainty rather than
claiming success when the application ignores a write or verification fails.
Unsupported controls remain recoverable through Copy. Browser/Electron identity,
rich-text behavior and application-specific AX support must be measured; support
for every text editor is not implied.

## Verification record

Source checks cover production build, lint, TypeScript contracts, frontend tests,
Playwright, default/mock Rust tests, Clippy, App Store exclusion, Python worker
tests, translation integrity, model licenses, dependency advisories and source
secret scanning. Current integration logs are in
`/tmp/vox-jot-main-sync-2026-10-02-gy20hro6/`.

The integration PR records the final counts, required CI results, notarized app
identity and native acceptance results. Native acceptance must check a disposable
TextEdit document, background append without foreground activation, closed/changed
target recovery, pin/clear shortcuts, Copy and the normal installed-app suite.
Long meeting capture and every third-party editor are separate coverage limits
and must be reported explicitly if not exercised.

The UI review preserves visible status, keyboard access, focus styling and
existing control sizes. Text uses `--text`, `--muted` and `--danger`; no additional
faintness or decorative navigation was introduced. No installed-app result is
inferred from a frontend build or mocked browser scenario.
