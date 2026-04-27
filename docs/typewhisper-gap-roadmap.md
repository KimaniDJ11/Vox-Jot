# Vox Jot — TypeWhisper feature-gap roadmap (living plan)

> Reference: external app **TypeWhisper**; do **not** copy GPLv3 code—feature parity only.

Last updated: 2026-04-27 (UTC-4) — A5 fully decoupled, B3 indicator styles complete (Compact / Detailed / Minimal / Notch).

## Tier A — Productivity & platform

| ID | Item | Status | Notes |
|----|------|--------|--------|
| A1 | SRT / WebVTT export from timed segments | **Done** | `helpers/subtitles.rs` |
| A2 | Watch folders (auto-transcribe) | **Done** | `managers/watch_folders.rs` + Dictate File transcription UI |
| A3 | Local HTTP API (automation) | **Done** | `http_api/mod.rs` (axum) |
| A4 | CLI as thin client to local API | **Done** | `cli_client.rs` + `cli.rs` |
| A5 | Write profiles rule engine: per-app + per-URL, priority, overrides | **Done** | `write_rules.rs`, `post_processing::WriteRule*`, `commands/write_rules`, Refine **Write profiles** UI; `force_post_process` override closes action-level gap; overlay badge; **decoupled master toggle** `write_rules_enabled_override` (legacy fallback to `app_aware_tone_enabled`); **Windows frontmost-app capture** via Win32 `GetForegroundWindow` + `QueryFullProcessImageNameW`; per-rule **hotkey overrides** still deferred |
| A6 | Cloud STT (Groq / OpenAI / compatible) + settings | **Not done** | |

## Tier B — macOS / Apple ecosystem

| ID | Item | Status | Notes |
|----|------|--------|--------|
| B1 | Apple SpeechAnalyzer (macOS) | **Done** | Swift bridge + `managers/apple_speech.rs` |
| B2 | WhisperKit live streaming | **Partial** | Helper surface in `managers/whisperkit.rs` (file-based shell-out via `VOX_JOT_WHISPERKIT_HELPER`). Real partial-token streaming requires a long-running helper protocol (stdin audio chunks → stdout NDJSON partials) — deferred to a dedicated PR with the helper binary in hand |
| B3 | Recording overlay / indicator styles | **Done** | Four styles: `compact`, `detailed`, `minimal` (single dot), `notch` (top-center pill that hugs M-series MacBook camera notch). Style picker in Recording & Devices → Show overlay |
| B4 | WidgetKit widgets + app group snapshot | **Not done** | |
| B5 | Audio ducking while recording | **Done** | `audio_toolkit/ducking.rs` + Recording & Devices |
| B6 | Update channels (stable / RC / daily) | **Not done** | |

## Tier C — Ecosystem (mostly pending)

| ID | Item | Status |
|----|------|--------|
| C | Prompt palette, term packs, webhooks, plugin SDK, memory, dashboard, etc. | **Not in scope of this plan snapshot** — track separately when prioritized |

## Critical files (A5 + related)

| Area | Path(s) |
|------|--------|
| Rule model + resolver | `src-tauri/src/post_processing.rs` (`WriteRule`, `WriteRuleOverrides` incl. `force_post_process`) |
| URL / priority matching | `src-tauri/src/write_rules.rs` |
| Dictation path integration | `src-tauri/src/actions.rs` (`resolve_active_write_rule`, `apply_resolved_rule_to_settings`, `force_post_process` on stop) |
| Tauri commands | `src-tauri/src/commands/write_rules.rs` |
| Refine — Write profiles UI | `src/components/settings/write-rules/*.tsx` |
| Overlay badge | `src/overlay/RecordingOverlay.tsx` (events `write-rule-matched` / `write-rule-cleared`) |

## Recent commits (A5 / B3 arc)

- `2a5bd9a` — A5: rule engine, app + URL, backend + initial UI
- `9f4e302` — A5: Write profiles UI polish (Nielsen heuristics)
- `d565921` — A5: per-rule **post-processing** override (`force_post_process`); A5 feature-complete for scoped parity
- (this commit) — A5 decoupled gating + Windows frontmost-app capture; B3 indicator styles (Minimal + Notch)

## Next suggested priorities

1. **A6** — Cloud STT providers + settings, if online fallback matters.
2. **B2/B3** — Close remaining streaming + overlay gaps with clear acceptance tests.
3. **B4 / B6** — Platform widgets and update channels when product scheduling allows.
