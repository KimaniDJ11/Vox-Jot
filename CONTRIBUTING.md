# Contributing to Vox Jot

Thank you for helping improve Vox Jot. Contributions are welcome across code,
tests, translations, accessibility, documentation, model-license research, and
user support.

## Before starting

1. Search [issues](https://github.com/KimaniDJ11/Vox-Jot/issues),
   [pull requests](https://github.com/KimaniDJ11/Vox-Jot/pulls), and
   [discussions](https://github.com/KimaniDJ11/Vox-Jot/discussions).
2. Use an issue or discussion to confirm scope before a large feature or
   architecture change.
3. Read [ROADMAP.md](ROADMAP.md) and the repository's `AGENTS.md` product and
   quality constraints.
4. Never include private recordings, transcripts, credentials, model tokens,
   signing material, or customer data in an issue, test fixture, commit, or PR.

Small bug fixes and documentation improvements do not need advance approval.

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/Vox-Jot.git
cd Vox-Jot
git remote add upstream https://github.com/KimaniDJ11/Vox-Jot.git
bun install
```

See [BUILD.md](BUILD.md) for platform prerequisites and build details.

For quick local development:

```bash
bun run tauri dev
```

On macOS, this development build is not the signed official app and may require
separate permissions. Maintainers perform final macOS validation through the
notarized installed-app workflow; outside contributors are not expected to have
Irie Dinamik signing or notarization credentials.

## Branches and commits

- Branch from the latest `main`.
- Keep changes focused and avoid mixing unrelated cleanup.
- Use clear conventional commits such as `fix:`, `feat:`, `docs:`, `test:`, or
  `chore:`.
- Preserve existing copyright, license, attribution, and model-notice files.
- Do not add generated build output, local caches, downloaded model weights, or
  machine-specific absolute paths.

## Product constraints

Vox Jot is latency-sensitive and privacy-focused.

- Do not add network calls, blocking disk work, model loading, heavy
  serialization, or database work to recording, transcription, post-processing,
  paste, overlay, or startup hot paths without explicit measurement and review.
- Visible functionality must work through the normal app path. Do not add
  placeholder, mock-only, disabled, or manually wired product surfaces.
- Keep recording, transcription, and user content local unless the user
  explicitly chooses and configures an external provider.
- Deletions and resets need a visible in-app confirmation. Browser
  `window.confirm` is not reliable inside the Tauri webview.
- Frontend work must preserve keyboard access, visible focus, readable contrast,
  status feedback, and existing interaction patterns.

## Tests and validation

Run the smallest relevant checks while iterating. Before requesting review, run
the full checks that your machine supports:

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

If a platform, credential, model, or hardware requirement prevents a check,
state exactly what was not run and why. Do not describe a smoke test as a full
benchmark or an untested platform as supported.

## Model and runtime contributions

Before adding or changing a model, runtime, mirror, or downloadable artifact:

1. Follow `docs/model-download-benchmark-runbook.md`.
2. Confirm commercial use and redistribution rights.
3. Add required license text, copyright, attribution, source, and modification
   notices.
4. Implement an app-managed install path with progress, cancellation, integrity
   checks, and error handling.
5. Validate the actual Vox Jot app path, not only an upstream script.
6. Run the full relevant benchmark before changing ranked Testing results.

Restricted or unclear assets must remain gated, user-supplied, or absent from
public mirrors.

## Pull requests

A useful PR description includes:

- The user problem and the proposed behavior
- Related issue or discussion
- Files and flows affected
- Tests performed and exact results
- Screenshots or recordings for visible UI changes
- Expected latency impact
- Any incomplete, blocked, or unverified path
- Whether AI assistance was used and how its output was reviewed

By contributing, you agree that your contribution is provided under the
repository's [MIT License](LICENSE), while preserving third-party terms for any
material you are authorized to contribute.

## Community conduct and help

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Use
[GitHub Discussions](https://github.com/KimaniDJ11/Vox-Jot/discussions) for
questions and ideas, [GitHub Issues](https://github.com/KimaniDJ11/Vox-Jot/issues)
for reproducible bugs, and [SUPPORT.md](SUPPORT.md) for user support routes.
