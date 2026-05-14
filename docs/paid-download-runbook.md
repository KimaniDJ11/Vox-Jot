# Vox Jot paid download runbook

This is the production path for charging a small price for Vox Jot without mixing App Store and self-hosted rules.

## Recommended setup

Use self-hosted distribution first: a direct checkout link, a signed and notarized DMG, and Cloudflare R2 downloads.

- Price: `2.00 USD`
- Website CTA: `Buy Vox Jot for $2`
- Checkout provider: Stripe Payment Link, Lemon Squeezy, Gumroad, or Paddle
- File host: Cloudflare R2 through `https://downloads.iriedinamik.org`
- Delivery target: latest signed and notarized Apple Silicon DMG

For a $2 desktop beta, do not add license enforcement first. It adds support burden, activation edge cases, offline failure modes, and latency-risking startup checks. Treat the first paid build as paid access to the download, then add signed license receipts later if abuse becomes real.

## Distribution tracks

Keep these two tracks separate.

### Track A: Self-hosted website release

This is the current path.

- Sell through Stripe, Lemon Squeezy, Gumroad, or Paddle.
- Host the notarized DMG on R2.
- Link the website purchase button to checkout.
- Link the post-payment success page to the R2 DMG.
- Use the Tauri updater manifest on Hugging Face for installed-app updates.
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

- Product name: `Vox Jot`
- Price: `$2.00`
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
<a class="btn btn-primary" href="PAYMENT_LINK_URL">Buy Vox Jot for $2</a>
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
One-time $2 beta download for Apple Silicon Macs. Vox Jot is signed and notarized for direct macOS distribution. Audio and transcripts stay local by default.
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
8. Create or update the `$2` checkout link.
9. Update `https://www.iriedinamik.org/voxjot/` so the primary CTA points to checkout.
10. Verify purchase success page and public download URL in a browser.
11. For updater-capable releases, run the Release workflow so Hugging Face `latest.json` points at the new signed updater artifacts.
