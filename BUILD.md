# Building Vox Jot

This guide covers contributor builds. Official Irie Dinamik releases use a
separate signed, notarized, and verified distribution process.

## Prerequisites

- [Rust stable](https://rustup.rs/)
- [Bun](https://bun.sh/)
- [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)

Platform requirements:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Windows:** Visual Studio Build Tools with Desktop development with C++
- **Ubuntu/Debian:** `build-essential libasound2-dev pkg-config libssl-dev
libvulkan-dev glslc libgtk-3-dev libwebkit2gtk-4.1-dev
libayatana-appindicator3-dev librsvg2-dev libgtk-layer-shell-dev patchelf cmake`

Equivalent GTK, WebKitGTK, ALSA, OpenSSL, Vulkan, layer-shell, and build packages
are required on other Linux distributions.

## Clone and install

```bash
git clone https://github.com/KimaniDJ11/Vox-Jot.git
cd Vox-Jot
bun install
```

The repository includes the required Silero VAD resource. Larger speech, OCR,
TTS, and creative models are installed by the app when selected; do not commit
downloaded weights into the repository.

## Development

```bash
bun run tauri dev
```

Frontend-only work can use:

```bash
bun run dev
```

Development builds are not signed official releases. On macOS they use a
different approval path and may need separate Microphone, Accessibility, or
Automation permissions.

## Build checks

```bash
bun run format:check
bun run lint
bun run build
bun run test:unit
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
bun run check:translations
bun run models:validate-licenses
bun run licenses:check
```

Create a local release bundle with:

```bash
bun run tauri build
```

That build is still a community/self-build unless it has passed Irie Dinamik's
official signing, notarization, and distribution process.

## Maintainer macOS validation

Maintainers with the required Developer ID identity and Apple credentials use:

```bash
bun run mac:update-installed-app:notarized
```

Short alias: `bun run mac:update:notarized`.

This builds the release app, signs it, submits it to Apple notarization, staples
the ticket, validates it with Gatekeeper, replaces `/Applications/Vox Jot.app`,
and launches the installed app. It is intentionally unavailable without valid
maintainer credentials. Contributors should report their local build/test
results instead of attempting to obtain project signing secrets.

## Linux notes

The executable is named `vox_jot`. Prefer installing a generated package so its
Tauri resources are placed correctly. Wayland users may need `wtype` or `dotool`
for text injection; X11 users may use `xdotool`.

If AppImage creation fails on a rolling distribution because the bundled
`linuxdeploy` tooling cannot process newer system libraries, build another
package type, for example:

```bash
bun run tauri build -- --bundles deb
```

## Troubleshooting

- Run `rustup update stable` when the lockfile requires a newer compiler.
- Delete only generated build output when recovering from a corrupt local build;
  do not remove source or model mirrors.
- Include the exact command, platform, tool versions, and first relevant error
  when asking for help.
- See [SUPPORT.md](SUPPORT.md) for support routes.
