# Vox Jot

**Local-first Mac dictation for people who write all day.** Press a shortcut,
speak naturally, and place text where your cursor is already focused.

[Download the official signed Mac build](https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg)
· [Support development](https://iriedinamik.gumroad.com/l/voxjot)
· [Product page](https://www.iriedinamik.org/voxjot/)
· [Build from source](BUILD.md)

The official Apple Silicon download is pay-what-you-want: the suggested support
price is **$27**, and **$0 is allowed**. The source code is available under the
[MIT License](LICENSE).

## The core workflow

1. Press a configurable global shortcut.
2. Speak into your selected microphone.
3. Vox Jot transcribes locally by default.
4. The text is placed into the app you were already using.

Core dictation does not require a Vox Jot account. Optional cleanup and rewrite
features use local models, Apple Intelligence, or cloud providers only when you
choose and configure them.

## What is included

- Global shortcut and push-to-talk dictation
- Local Whisper, Parakeet, and other app-managed speech models
- App-aware Dictation Modes and reusable Phrase Keys
- File transcription and a correction-learning dictionary
- Reader, Listen, OCR, speech analysis, and voice tools
- Visible, cancellable model and runtime downloads
- A local API for user-controlled automations

The deeper tools are optional. Vox Jot's first job remains simple: talk once and
get text where your cursor is.

## Install the official Mac build

The current official download targets **Apple Silicon Macs running macOS 13
Ventura or later**.

1. [Download the signed and notarized DMG](https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg).
2. Optionally [verify its SHA-256 checksum](https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg.sha256).
3. Drag Vox Jot into Applications.
4. Grant Microphone access. Global shortcuts and text placement may also need
   Accessibility or Automation permission.
5. Choose a speech model and test a short dictation.

The website provides [install notes](https://www.iriedinamik.org/voxjot/) and
[support](https://www.iriedinamik.org/voxjot/support/).

## Official builds and community builds

Irie Dinamik publishes the official `Vox Jot` Mac build. It is Developer ID
signed, notarized by Apple, stapled, Gatekeeper-validated, and connected to the
official update feed.

The MIT license permits forks and redistribution, but modified distributions
must not imply that they are produced, reviewed, signed, or supported by Irie
Dinamik. Use a distinct name and visual identity for modified distributions.
See [TRADEMARKS.md](TRADEMARKS.md) for the project identity policy.

## Build from source

The short path is:

```bash
git clone https://github.com/KimaniDJ11/Vox-Jot.git
cd Vox-Jot
bun install
bun run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Use `bun run tauri dev` for a local development build. A self-built app is not
an official signed release and may need separate macOS permissions. Platform
prerequisites and validation commands are documented in [BUILD.md](BUILD.md).

## Contributing

Bug reports, documentation, translations, tests, design improvements, and code
contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), review
the [roadmap](ROADMAP.md), and search existing issues and discussions before
opening new work.

- [Report a bug](https://github.com/KimaniDJ11/Vox-Jot/issues/new/choose)
- [Join a discussion](https://github.com/KimaniDJ11/Vox-Jot/discussions)
- [Get support](SUPPORT.md)
- [Report a security issue privately](SECURITY.md)

## Privacy and model licenses

Vox Jot is local-first, not "every feature is always offline." Core recording
and transcription stay on the Mac by default. Optional provider-backed features
are explicitly configured by the user. Read the
[privacy policy](https://www.iriedinamik.org/voxjot/privacy/) for the supported
distribution.

Models and runtimes retain their own upstream terms. The app and repository
publish a generated dependency notice bundle plus the curated
[model and runtime notices](src-tauri/resources/THIRD_PARTY_MODEL_NOTICES.md).
Some optional assets require acknowledgement, have non-commercial terms, or are
not redistributed by Vox Jot.

## Project lineage

Vox Jot builds on the open-source work of CJ Pais and the Handy project. The
original copyright and MIT license notices are preserved in [LICENSE](LICENSE)
and [NOTICE.md](NOTICE.md). Related upstream projects include
[Handy](https://github.com/cjpais/Handy) and
[handy-cli](https://github.com/cjpais/handy-cli).

## License

Source code is licensed under the [MIT License](LICENSE). Third-party models,
runtimes, binaries, fonts, sounds, and other assets may use different licenses;
consult the adjacent notices and [NOTICE.md](NOTICE.md).
