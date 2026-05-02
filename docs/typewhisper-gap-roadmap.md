# Vox Jot — TypeWhisper feature-gap roadmap (living plan)

> Reference: external app **TypeWhisper**; do **not** copy GPLv3 code—feature parity only.

Last updated: 2026-04-27 (UTC-4) — A5 fully decoupled, **B3 is complete**, and WhisperKit was removed from scope in favor of the existing `whisper.cpp` path.

## At a glance (TypeWhisper parity vs Vox Jot)

- **B3 — Recording overlay / indicator styles: DONE** (all four styles shipped: Compact, Detailed, Minimal, Notch; see `6bc8801`).
- **A5 — Write profiles rule engine: DONE** (including decoupled `write_rules_enabled`, Windows frontmost, `force_post_process`).
- **WhisperKit:** removed from this roadmap and codebase. Vox Jot's Whisper models already use the maintained `whisper.cpp` / GGML path.
- **Still open on this plan:** A6, B4, B6, optional A5 hotkey follow-up, Tier C ecosystem items.

## Tier A — Productivity & platform

| ID  | Item                                                               | Status       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | SRT / WebVTT export from timed segments                            | **Done**     | `helpers/subtitles.rs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A2  | Watch folders (auto-transcribe)                                    | **Done**     | `managers/watch_folders.rs` + Dictate File transcription UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A3  | Local HTTP API (automation)                                        | **Done**     | `http_api/mod.rs` (axum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A4  | CLI as thin client to local API                                    | **Done**     | `cli_client.rs` + `cli.rs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A5  | Write profiles rule engine: per-app + per-URL, priority, overrides | **Done**     | `write_rules.rs`, `post_processing::WriteRule*`, `commands/write_rules`, Refine **Write profiles** UI; `force_post_process` on stop; overlay badge; `**AppSettings::write_rules_enabled()`** with `write_rules_enabled_override: Option<bool>` (falls back to legacy `app_aware_tone_enabled` when unset); Tauri: `change_write_rules_enabled_setting`; **Windows** frontmost via `GetForegroundWindow` + `QueryFullProcessImageNameW` (exe path as bundle id); **Linux** frontmost still `None` (Wayland, deferred). Per-rule **runtime hotkey rebinding\*\* still deferred |
| A6  | Cloud STT (Groq / OpenAI / compatible) + settings                  | **Not done** |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Tier B — macOS / Apple ecosystem

| ID  | Item                                   | Status       | Notes                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Apple SpeechAnalyzer (macOS)           | **Done**     | Swift bridge + `managers/apple_speech.rs`                                                                                                                                                                                                                                                                           |
| B3  | Recording overlay / indicator styles   | **Done**     | Four styles: `Compact`, `Detailed`, `Minimal` (10px breathing dot, no pill chrome), `Notch` (top-center ~190×30; pinned to `monitor_y` so it sits flush with screen top; notch-appropriate on M-series, top pill elsewhere). `overlay_dimensions` in `overlay.rs`; picker in Recording & Devices → **Show overlay** |
| B4  | WidgetKit widgets + app group snapshot | **Not done** |                                                                                                                                                                                                                                                                                                                     |
| B5  | Audio ducking while recording          | **Done**     | `audio_toolkit/ducking.rs` + Recording & Devices                                                                                                                                                                                                                                                                    |
| B6  | Update channels (stable / RC / daily)  | **Not done** |                                                                                                                                                                                                                                                                                                                     |

## Tier C — Ecosystem (not started; unrelated to B3)

| ID  | Item                                                                      | Status                                                                     |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C   | Prompt palette, term packs, webhooks, plugin SDK, memory, dashboard, etc. | **Not in scope of this plan snapshot** — track separately when prioritized |

## Critical files (A5, B3, related)

| Area                                            | Path(s)                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule model + resolver                           | `src-tauri/src/post_processing.rs` (`WriteRule`, `WriteRuleOverrides` incl. `force_post_process`)                                                                                                                                                           |
| Master enable + legacy fallback                 | `src-tauri/src/settings.rs` (`write_rules_enabled_override`, `write_rules_enabled()`) + `src-tauri/src/shortcut/mod.rs` (`change_write_rules_enabled_setting`)                                                                                              |
| URL / priority matching                         | `src-tauri/src/write_rules.rs`                                                                                                                                                                                                                              |
| Dictation path integration                      | `src-tauri/src/actions.rs` (`resolve_active_write_rule` consults `write_rules_enabled()`, `apply_resolved_rule_to_settings`, `force_post_process` on stop); frontmost capture: macOS a64 + Windows Win32 (see `capture_active_app_context` in `actions.rs`) |
| Tauri commands                                  | `src-tauri/src/commands/write_rules.rs`                                                                                                                                                                                                                     |
| Refine — Write profiles UI                      | `src/components/settings/write-rules/*.tsx`                                                                                                                                                                                                                 |
| Overlay window + sizes + `show-overlay` payload | `src-tauri/src/overlay.rs` (`overlay_dimensions`, `RecordingOverlayStyle` incl. `Minimal` / `Notch`)                                                                                                                                                        |
| Overlay chrome + events                         | `src/overlay/RecordingOverlay.tsx` (badge: `write-rule-matched` / `write-rule-cleared`; CSS `--minimal` / `--notch`)                                                                                                                                        |
| Style picker                                    | `src/components/settings/ShowOverlay.tsx`                                                                                                                                                                                                                   |

## Recent commits (A5 / B3 arc)

- `2a5bd9a` — A5: rule engine, app + URL, backend + initial UI
- `9f4e302` — A5: Write profiles UI polish (Nielsen heuristics)
- `d565921` — A5: per-rule **post-processing** override (`force_post_process`); A5 feature-complete for scoped parity
- `6bc8801` — A5 decoupled gating + Windows frontmost; B3 `Minimal` / `Notch` overlay styles + picker + i18n

## Next suggested priorities

1. **A6** — Cloud STT providers + settings, if online fallback matters.
2. **B4 / B6** — Platform widgets and update channels when product scheduling allows.
3. **A5 follow-up (optional)** — Per-rule **runtime** hotkey rebinding (substantial; separate from `force_post_process`).

## Validation snapshot (typical local gate)

`cargo test --lib`, `cargo fmt --check`, `bun run lint`, `tsc --noEmit`, `bun run check:translations` — all green on recent `main` (280+ lib tests as of `6bc8801`).
