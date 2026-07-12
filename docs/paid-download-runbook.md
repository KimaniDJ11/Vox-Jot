# Vox Jot paid download runbook

This is the production path for distributing Vox Jot as pay-what-you-want software without mixing App Store and self-hosted rules.

## Recommended setup

Use self-hosted distribution first: a direct checkout link, a signed and notarized DMG, and Cloudflare R2 downloads.

- Price: pay what you want, suggested `27.00 USD`, with `$0` allowed
- Website CTA: `Get Vox Jot - pay what you want, suggested $27`
- Checkout provider: Gumroad for the current launch; Lemon Squeezy remains a later option if license keys or merchant-of-record handling become more important
- File host: Cloudflare R2 through `https://downloads.iriedinamik.org`
- Delivery target: latest signed and notarized Apple Silicon DMG

For the pay-what-you-want desktop beta, do not add license enforcement first. It adds support burden, activation edge cases, offline failure modes, and latency-risking startup checks. Treat the first public build as download access through the checkout page, then add signed license receipts later if abuse becomes real.

## Checkout provider decision

Default to Gumroad for the current self-hosted launch because the product is already live there as a pay-what-you-want download.

Why:

- It already supports the launch model: `$0+` pricing with a clear `$27` suggested anchor.
- It keeps checkout, receipts, creator-style delivery, and customer support in one path.
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

Do not wire more than one provider into the first beta. Pick one checkout path, one receipt email path, one support path, and one download page.

## Distribution tracks

Keep these two tracks separate.

### Track A: Self-hosted website release

This is the current path.

- Sell through Stripe, Lemon Squeezy, Gumroad, or Paddle.
- Host the notarized DMG on R2.
- Link the website purchase button to checkout.
- Link the post-payment success page to the R2 DMG.
- Use the Tauri updater manifest on Hugging Face for installed-app updates.
- Do not use GitHub Releases for Vox Jot app distribution.
- License keys are allowed in this path if we decide to add them later.

Recommended first version:

- No in-app lock.
- No license-key field.
- No startup network call.
- Paid access is controlled by the checkout/download page.

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

## Payment provider requirements

Create one live checkout product:

- Product name: `Vox Jot: Local-First Mac Dictation`
- Price: `$0+` pay what you want
- Suggested price: `$27.00`
- Currency: `USD`
- Type: one-time payment
- Success URL: `https://www.iriedinamik.org/voxjot/download/?paid=1`
- Cancel URL: `https://www.iriedinamik.org/voxjot/`
- Receipt email: enabled

The success URL should land on a page that explains the supported Mac target and links to the R2-hosted DMG. If the checkout provider supports post-payment digital file delivery, use that too, but keep the website download page as the canonical support surface.

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
<a class="btn btn-primary" href="PAYMENT_LINK_URL"
  >Get Vox Jot - pay what you want, suggested $27</a
>
```

Secondary CTA after payment:

```html
<a
  class="btn btn-primary"
  href="https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg"
  >Download for Mac</a
>
```

Short purchase note:

```text
Pay-what-you-want beta download for Apple Silicon Macs. Suggested price: $27. If you need Vox Jot free, enter $0. Vox Jot is signed and notarized for direct macOS distribution. Core dictation stays local by default; optional cleanup only runs when configured.
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
8. Create or update the `$0+` pay-what-you-want checkout link with `$27` suggested.
9. Update `https://www.iriedinamik.org/voxjot/` so the primary CTA points to checkout.
10. Verify purchase success page and public download URL in a browser.
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

Use `--skip-r2`, `--skip-gumroad`, or `--skip-website-check` only for a dry run or a deliberately partial release. A public paid release is not complete until R2, Gumroad, the website path, and the updater feed are all verified.

If the local distributor is blocked by missing notary credentials, Cloudflare R2 auth, updater signing key/password, Hugging Face auth, Gumroad auth, website verification, or public download verification, fix that blocker and rerun the local distributor. Do not use GitHub Releases as a fallback.
