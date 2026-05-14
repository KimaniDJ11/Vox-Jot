# Changelog

## [1.0.0] - 2026-05-13

First production release as **Vox Jot**, the rebranded continuation of the
project formerly known as Handy.

### Added

- **Vox Jot product surface**: rebrand, marketing site at
  `https://www.iriedinamik.org/voxjot/`, dedicated support and privacy pages,
  Hugging Face binary releases repo `IrieDinamik/vox-jot-releases`.
- **Signed auto-updater**: `tauri-plugin-updater` wired to a public Hugging Face
  manifest. Signed update archives are verified with a minisign public key
  baked into the bundle; clients download and install in place and relaunch.
- **OCR runtime distribution**: managed CPU-only Python runtime archives
  published to Hugging Face for macOS, Windows, and Linux. Builds fixed for
  Windows Python target / pip path parsing, Linux CUDA exclusion, and UTF-8
  upload handling.
- **Cross-platform release matrix**: macOS arm64, Linux x86_64 and arm64
  (AppImage/deb/rpm), Windows x86_64 (NSIS/MSI) — all signed.
- **Listen surface**: voice cloning, my-voices library, sound and tuning panel,
  engine library, auto-readback, output routing, Supertonic 3 TTS, OmniVoice,
  OuteTTS, and refreshed MLX benchmark catalog.
- **Refine surface**: Phrase Keys, Write Profiles (app-aware tone),
  Translation, Refine Models, local refine onboarding.
- **Dictate surface**: Recent History, Corrections, Jot Pad, Speech Models.
- **Localization**: 16 locales at 100% key coverage with translation audits.
- **Distribution audit** (`bun run audit:distribution`) wired into the release
  workflow.
- **CLI parameters** for window-manager and autostart integration
  (`--toggle-transcription`, `--toggle-post-process`, `--cancel`,
  `--start-hidden`, `--no-tray`, `--debug`).

### Changed

- Single source of truth for tray menu labels via `translation.json` →
  `src-tauri/build.rs`.
- Migrated `keyring` 3 to `keyring-core` 1 with per-OS store crates.
- Public model assets used for STT to remove auth gating on fresh installs.
- Tap-to-download for TTS models works without GitHub auth.

### Fixed

- Mac speech runtime archive signing.
- Apple Intelligence module caches sandboxed in `OUT_DIR`.
- Duplicate LLM import rows; provider icon and storage labels.
- Security scan findings hardened across the audit suite.

## [0.3.0] - 2025-07-11

### Added

- **Translate to English** setting: Added automatic translation of speech to English
- Settings refactored into React hooks for better state management
- Audio device switching capability
- Hysteresis to VAD (Voice Activity Detection) for more stable recording

### Changed

- Major audio backend refactor for improved performance and reliability
- Moved audio toolkit into src-tauri directory for better permissions handling
- Model files no longer need to be downloaded separately for releases
- Updated settings components and transcription logic

### Fixed

- Audio toolkit permissions issues
- Various stability improvements

## [0.2.3] - 2025-07-03

### Fixed

- Keycode bug that was causing input issues
- Whisper model optimization: switched to unquantized Whisper Turbo, updated Whisper Medium quantization to 4_1

## [0.2.2] - 2025-07-02

### Fixed

- Removed 50ms delay feature flag for Windows (now applies to all platforms for consistency)

## [0.2.1] - 2025-07-01

### Added

- Ctrl+Space key binding for Windows platform

### Fixed

- Windows crash issue
- Model loading on startup when available
- Windows paste functionality bug

## [0.2.0] - 2025-06-30

### Added

- **Microphone activation on demand**: More efficient resource usage
- Less permissive VAD settings for better accuracy

### Changed

- Improved microphone management and activation system

## [0.1.6] - 2025-06-30

### Added

- **Multiple models support**: Users can now select from different transcription models
- Model selection onboarding flow
- Cleanup and refactoring of model management

### Changed

- Enhanced user experience with model selection interface
- Better language and UI tweaks

## [0.1.5] - 2025-06-27

### Added

- **Different start and stop recording sounds**: Enhanced audio feedback
- Recording sound samples for better user experience

## [0.1.4] - 2025-06-27

### Fixed

- Build issues
- Auto-update functionality improvements

## [0.1.3] - 2025-06-26

### Fixed

- Paste functionality using enigo library for better cross-platform compatibility

## [0.1.2] - 2025-06-26

### Added

- **Auto-update functionality**: Application can now automatically update itself
- Footer displaying current version
- Improved menu system

### Changed

- Better user interface for version management
- Enhanced update workflow

## [0.1.1] - 2025-06-25

### Added

- **Comprehensive build system**: Support for Windows, macOS, and Linux
- Windows code signing for trusted installation
- Ubuntu/Linux build support with Vulkan
- Model file download and packaging for releases
- GitHub Actions CI/CD workflow

### Changed

- Improved build process and release workflow
- Better cross-platform compatibility

### Fixed

- Various build-related issues across platforms

## [0.1.0] - 2025-05-16

### Added

- **Initial release** of Handy
- Basic speech-to-text transcription functionality
- Voice Activity Detection (VAD) for automatic recording
- Cross-platform support (macOS, Windows, Linux)
- **Tauri-based desktop application** with React frontend
- **Global keyboard shortcuts** for activation
- **Clipboard integration** for automatic text insertion
- **LLM integration** for enhanced transcription processing
- **Configurable settings** including:
  - Custom key bindings
  - Audio device selection
  - Microphone settings
  - Push-to-talk functionality
- **System tray integration** with recording indicators
- **Accessibility permissions** handling for macOS
- **Settings persistence** with unified settings store
- **Background operation** capability
- **Multiple audio format support** with on-the-fly resampling
- **Whisper model integration** for high-quality transcription
- **MIT License** for open-source distribution

### Technical Implementation

- Built with Tauri (Rust backend) and React (TypeScript frontend)
- Audio processing with cpal and whisper-rs
- Real-time transcription with performance optimizations
- Cross-platform keyboard event handling
- Modular architecture with managers for audio, models, and transcription
