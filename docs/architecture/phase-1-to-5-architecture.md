# Vox Jot Current Architecture Notes

## Latency Guardrails

The dictation path is protected as the primary product flow:

1. recording start
2. stop capture
3. warm transcription
4. paste/output

These stages now have explicit Rust latency budgets and debug/warn logging. The logging is synchronous only to the existing logger and does not add network calls, disk I/O, model loads, or extra awaits.

## Artifact Pipeline

Model and runtime downloads should flow through `artifact_download` instead of feature-specific streaming loops. The shared layer supports:

- Hugging Face repo file discovery
- safe relative paths
- resumable staging directories
- standalone archive downloads
- cancellation checks
- progress events
- optional size and SHA-256 validation

Checksum validation hashes files in chunks so large runtime archives do not need to be loaded fully into memory.

## Runtime Contracts

Runtime providers are described by artifact domain, execution mode, hot-path eligibility, and managed-artifact requirements. This keeps STT, OCR, TTS, and speech-analysis decisions explicit before more engines are added.

## Product Modules

Frontend settings sections now map to product modules:

- core dictation
- refine
- listen
- diagnostics
- lab

This makes navigation filtering deterministic and gives new implementation work a single place to answer whether a section belongs in the default user surface.

## Lab Gating

Experimental features default to off. Lab sections remain reachable when the experimental toggle is enabled, but hidden by default so blocked or unvalidated model testing and automation surfaces do not compete with the dictation workflow.

## Latency Impact

Expected impact is unchanged for the hot path. The added budget checks use already-measured `Instant` durations and log only after existing work completes. Download changes affect background model/runtime installation, not recording or paste.
