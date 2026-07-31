# Vox Jot open-source distribution and support runbook

This is the production path for distributing the official open-source Vox Jot
build while keeping downloads low-friction and support payments separate from
the Mac App Store rules.

## Recommended setup

Use self-hosted distribution first: a direct signed and notarized DMG from
Cloudflare R2 plus a separate pay-what-you-want support path.

- Official download: direct, without account or checkout
- Website primary CTA: `Download the signed Mac build`
- Support CTA: `Support development - pay what you want, suggested $27`
- Support provider: Gumroad for the current launch; Lemon Squeezy remains a
  later option if memberships, license keys, or merchant-of-record handling
  become important
- File host: Cloudflare R2 through `https://downloads.iriedinamik.org`
- Delivery target: latest signed and notarized Apple Silicon DMG

Do not add license enforcement to the open-source launch. It adds support burden,
activation edge cases, offline failure modes, and latency-risking startup checks.
The official build is free to download; Gumroad payments support continued
development, official builds, updates, and support.

## Checkout provider decision

Keep Gumroad as the current support path because the product and receipt flow are
already live there as pay-what-you-want.

Why:

- It already supports `$0+` pricing with a clear `$27` suggested anchor.
- It keeps voluntary payments, receipts, and supporter communication in one path.
- It keeps the app free from payment SDKs and private payment secrets.

Revisit Lemon Squeezy later if Vox Jot needs generated license keys, stronger tax handling, or a less creator-marketplace checkout surface.

Provider tradeoffs:

| Provider             | Best use                                                                     | Vox Jot fit                                                               |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Lemon Squeezy        | Self-hosted software with tax handling, downloads, and optional license keys | Strong later if license keys or merchant-of-record handling become needed |
| Stripe Payment Links | Lowest-friction checkout when taxes/compliance are handled separately        | Good fallback, especially if a Stripe account is already ready            |
| Gumroad              | Fast creator-style digital downloads and pay-what-you-want pricing           | Current launch path for `$0+`, suggested `$27`                            |
| Paddle               | More mature merchant-of-record SaaS billing                                  | Strong later, but more operationally heavy than the current launch needs  |
| Apple StoreKit       | App Store unlocks and trials                                                 | Best only for a Mac App Store build                                       |

Do not wire more than one payment provider into the launch. Keep one support
checkout, one receipt path, one official download URL, and one support page.

## Distribution tracks

Keep these two tracks separate.

### Track A: Official self-hosted release

This is the current path.

- Host the notarized DMG on R2.
- Link the website's primary download button directly to the R2 DMG.
- Link a separate support button to Gumroad.
- Use the Tauri updater manifest on Hugging Face for installed-app updates.
- Do not use GitHub Releases for Vox Jot app distribution.
- Do not require a license key for the open-source core or official launch build.

Recommended first version:

- No in-app lock.
- No license-key field.
- No startup network call.
- Source and official builds remain usable without payment activation.

### Track B: Mac App Store release

Use this only when intentionally shipping through App Store Connect.

- The app can be free with a non-consumable `Full Unlock` in-app purchase.
- A trial can be modeled with Apple's allowed in-app purchase setup, not a custom paste-in code.
- Do not use Lemon Squeezy, Paddle, Stripe, license keys, QR codes, activation codes, or external checkout to unlock features inside the App Store build.
- Enroll in Apple's Small Business Program so eligible paid apps and in-app purchases use the reduced 15% commission rate.

If both tracks exist later, ship separate build configuration and copy:

- Website build: Developer ID signed, notarized, self-hosted, optional external licensing.
- App Store build: sandboxed/App Store signed, StoreKit unlock only, no external unlock links.

## Versioning and updates

Every public app update needs a new version number.

- Patch release, such as `1.0.1`: bug fixes, copy fixes, payment/download polish, small security fixes.
- Minor release, such as `1.1.0`: user-visible features.
- Major release, such as `2.0.0`: major product or compatibility break.

Keep these files in sync for every public release:

```text
package.json
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```

For self-hosted releases, the app update path is not the R2 DMG by itself. Installed apps use the Tauri updater, which reads:

```text
https://huggingface.co/IrieDinamik/vox-jot-releases/resolve/main/latest.json
```

The DMG on R2 is for new installs and manual re-downloads. The Hugging Face `latest.json` manifest and signed updater artifacts are for in-app updates.

## Support provider requirements

Maintain one live supporter product:

- Product name: `Vox Jot: Local-First Mac Dictation`
- Price: `$0+` pay what you want
- Suggested price: `$27.00`
- Currency: `USD`
- Type: one-time payment
- Receipt email: enabled

The receipt and product content should link back to the official product and
support pages. Gumroad may continue delivering the same official DMG for
supporters, but payment is not the only download path.

If using Lemon Squeezy later for license keys:

- Enable generated license keys on the product.
- Set an activation limit, probably `1` or `2`.
- Validate once when the user enters the key.
- Store the activation state in Keychain.
- Cache successful activation locally so dictation startup never waits on the network.
- Revalidate in the background only for license management, not on the recording/transcription hot path.

## Download URLs

Use stable public URLs for the current Apple Silicon installer:

```text
https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg
https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg.sha256
```

Keep versioned copies under:

```text
https://downloads.iriedinamik.org/voxjot/releases/v1.0.0/Vox-Jot_1.0.0_aarch64.dmg
https://downloads.iriedinamik.org/voxjot/releases/v1.0.0/Vox-Jot_1.0.0_aarch64.dmg.sha256
```

The website should point users at `latest/`. Support and rollback workflows should use `releases/vX.Y.Z/`.

## Website copy

Primary CTA:

```html
<a
  class="btn btn-primary"
  href="https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg"
  >Download the signed Mac build</a
>
```

Support CTA:

```html
<a class="btn btn-secondary" href="https://iriedinamik.gumroad.com/l/voxjot"
  >Support development - suggested $27</a
>
```

Short purchase note:

```text
Free official download for Apple Silicon Macs. Vox Jot is signed and notarized
for direct macOS distribution. Core dictation stays local by default; optional
cleanup only runs when configured. If Vox Jot helps you, support continued
development with a pay-what-you-want contribution; the suggested amount is $27.
```

## Security and abuse controls

- Keep `r2.dev` public access disabled.
- Serve downloads through `downloads.iriedinamik.org`.
- Keep checksums public beside each DMG.
- Keep Sentry opt-in only; do not tie crash reporting to payment state.
- Do not store payment secrets in the app bundle.
- Do not put Stripe or checkout API keys in static website HTML.
- If license enforcement is added later, validate signed license files locally and cache the result. Do not block dictation startup on network calls.
- Never put a Lemon Squeezy, Stripe, Paddle, or App Store private API key in the app bundle.
- Do not add payment checks to recording start, recording stop, transcription, paste/output, overlay rendering, or app startup hot paths.

## Release checklist

1. Build with `SENTRY_DSN` present.
2. Developer ID sign the app.
3. Submit to Apple notarization.
4. Staple the notarization ticket.
5. Gatekeeper-validate the installed app and DMG.
6. Upload the DMG and checksum to R2 versioned paths.
7. Copy the same files to `voxjot/latest/`.
8. Create or update the `$0+` supporter link with `$27` suggested.
9. Update `https://www.iriedinamik.org/voxjot/` so the primary CTA points to the
   direct DMG and the support CTA points to Gumroad.
10. Verify the public download and supporter paths in a browser.
11. For updater-capable releases, use the local distributor to create the signed updater archive and upload the updater artifacts plus `latest.json` to Hugging Face.

## Required local release path

Always use the local distributor for public website/Gumroad releases. GitHub Releases and the GitHub `Release` / `Release macOS` workflows are blocked for Vox Jot app distribution.

```sh
VOX_JOT_R2_BUCKET="vox-jot-downloads" \
TAURI_SIGNING_PRIVATE_KEY_PATH="/path/to/tauri-updater-private-key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..." \
bun run release:local-mac -- 1.0.7
```

The script:

- bumps `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`;
- refreshes Rust lockfile state through `cargo check`;
- runs focused updater tests, frontend build, lint, distribution audit, and `git diff --check`;
- runs the local signed/notarized macOS release build;
- stages the DMG/checksum under `release-assets/vX.Y.Z/`;
- creates and signs the Tauri updater archive from the signed app bundle;
- uploads the DMG and checksum to Cloudflare R2 versioned and `latest/` paths;
- uploads updater artifacts and `latest.json` to the current Hugging Face updater repo;
- verifies the public latest DMG/checksum URLs, Gumroad product content, and website-to-Gumroad path.

Use `--skip-hf` only after already-shipped installed apps point at a non-Hugging-Face updater endpoint. Current installed builds still read the Hugging Face updater manifest, so skipping Hugging Face would prevent in-app updates for those users.

Use `--skip-r2`, `--skip-gumroad`, or `--skip-website-check` only for a dry run
or a deliberately partial release. A public official release is not complete
until R2, the direct website download, Gumroad support path, and updater feed are
all verified.

If the local distributor is blocked by missing notary credentials, Cloudflare R2 auth, updater signing key/password, Hugging Face auth, Gumroad auth, website verification, or public download verification, fix that blocker and rerun the local distributor. Do not use GitHub Releases as a fallback.
