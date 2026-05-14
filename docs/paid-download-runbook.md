# Vox Jot paid download runbook

This is the production path for charging a small direct-download price for Vox Jot.

## Recommended setup

Use a direct checkout link for the first public beta, not in-app purchase logic.

- Price: `2.00 USD`
- Website CTA: `Buy Vox Jot for $2`
- Checkout provider: Stripe Payment Link, Lemon Squeezy, Gumroad, or Paddle
- File host: Cloudflare R2 through `https://downloads.iriedinamik.org`
- Delivery target: latest signed and notarized Apple Silicon DMG

For a $2 desktop beta, do not add license enforcement first. It adds support burden, activation edge cases, offline failure modes, and latency-risking startup checks. Treat the first paid build as paid access to the download, then add signed license receipts later if abuse becomes real.

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
