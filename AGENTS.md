# AGENTS.md

> **CRITICAL ARCHITECTURE NOTE FOR ALL AGENTS:**
> This application is currently under active, early-stage development and has no active users. **Backward compatibility is NOT required.** Do not worry about preserving old APIs, data structures, or behaviors if a better approach exists. We are pushing forward to build a stronger app. Feel free to make breaking changes, refactor aggressively, and improve the architecture wherever possible.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Latency Policy

Vox Jot is a latency-sensitive dictation app. All agents and AI coding tools must treat latency as a hard product constraint.

- Do not make changes that increase recording start latency, stop-to-transcript latency, post-processing latency, paste latency, overlay responsiveness latency, or settings UI responsiveness without explicit approval.
- Before implementing a change on a hot path, identify whether it runs during recording, transcription, post-processing, paste/output, overlay updates, or app startup.
- If a proposed change would add network calls, disk I/O, model loads, database work, blocking locks, extra awaits, heavy serialization, large React re-renders, or expensive computation to a hot path, do not implement it by default. Explain why it would increase latency and propose alternatives that keep the work cached, deferred, incremental, backgrounded, or outside the hot path.
- Prefer deferred/background persistence, cached metadata, precomputed state, and UI-only rendering over synchronous work in the dictation pipeline.
- When completing a change, report whether latency is expected to be unchanged, improved, or at risk, and mention any validation performed.

## macOS Installed-App Workflow

On macOS, the standard validation path for any solid app change is to update the already-installed `/Applications/Vox Jot.app` in place instead of relying on a fresh `tauri dev` app instance.

- Use `bun run mac:update-installed-app` (alias: `bun run mac:build-install`) whenever a macOS change is ready for real app testing.
- This rebuilds the signed app bundle and replaces the contents of `/Applications/Vox Jot.app`, which preserves the existing system approval path so Accessibility and related permissions do not need to be re-granted for each solid change.
- Use `bun run tauri dev` only for quick iteration when you explicitly do not need to validate through the installed app bundle.
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
bun run mac:update-installed-app

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
