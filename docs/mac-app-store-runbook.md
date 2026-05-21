# Vox Jot Mac App Store runbook

This is the App Store path. Keep it separate from the Developer ID/R2 website build.

## Distribution model

Recommended first App Store release:

- Ship Vox Jot as a paid `$1.99` Mac App Store app.
- Do not add StoreKit unlock code for the first App Store submission.
- Do not include Lemon Squeezy, Stripe, Paddle, Gumroad, license keys, or external checkout links in the App Store build.

If a free trial is required later, add StoreKit intentionally in a separate change. Do not mix external license codes with App Store unlocks.

## Build differences

The App Store build uses:

- `src-tauri/tauri.appstore.conf.json`
- `src-tauri/Entitlements.appstore.plist`
- `src-tauri/profiles/VoxJot-AppStore.provisionprofile`
- `VOX_JOT_DISTRIBUTION=app-store`
- `VITE_VOX_JOT_DISTRIBUTION=app-store`

Those flags disable self-hosted-only behavior:

- Tauri updater plugin is not registered.
- LaunchAgent autostart plugin is not registered.
- Update checking UI is hidden.
- Autostart UI is hidden.
- Tauri updater artifacts are disabled.
- macOS private APIs are disabled in the Tauri App Store config.

## Apple account setup

Create these in Apple Developer / App Store Connect:

1. App ID
   - Bundle ID: `com.iriedinamik.voxjot`
   - Team ID: `NS5M2UJLKP`
   - Capabilities: App Sandbox, Microphone, outgoing network client as needed.
2. Mac App Store Connect provisioning profile
   - Type: Mac App Store Connect
   - App ID: `com.iriedinamik.voxjot`
   - Signing certificate: Apple Distribution / 3rd Party Mac Developer Application certificate
   - Save as `src-tauri/profiles/VoxJot-AppStore.provisionprofile`
3. Certificates
   - Apple Distribution / 3rd Party Mac Developer Application: `Kimani James (NS5M2UJLKP)`
   - Mac Installer Distribution / 3rd Party Mac Developer Installer
4. App Store Connect app record
   - Platform: macOS
   - Bundle ID: `com.iriedinamik.voxjot`
   - Category: Utilities
   - Price: `$1.99`, or free if StoreKit unlock is added later

## App Store metadata

Use metadata that positions Vox Jot as assistive voice text entry and avoids
Apple product trademarks in the subtitle.

- App name: `Vox Jot`
- Subtitle: `Assistive Voice Dictation`
- Do not use `Mac`, `macOS`, `Apple`, `MacBook`, or similar Apple
  product/service terms in the subtitle. Avoid pairing model names with Apple
  platform terms in a way that reads like an Apple product.
- Suggested short description: `Vox Jot helps people who cannot comfortably
type enter text by speaking, with local transcription and user-started
insertion into the active text field.`
- Suggested review-note positioning: Vox Jot is an assistive voice text-entry
  tool for users who cannot comfortably type because of disability, motor
  limitations, repetitive strain, temporary injury, fatigue, or pain.

## Local commands

Audit the repo setup:

```bash
bun run mac:app-store:audit
```

Build a local App Store package:

```bash
bun run mac:app-store:build
```

Upload after App Store Connect API credentials are configured:

```bash
APPLE_API_KEY_ID="..." APPLE_API_ISSUER="..." bun run mac:app-store:upload
```

If certificate names differ locally:

```bash
APPLE_APP_STORE_SIGNING_IDENTITY="3rd Party Mac Developer Application: Kimani James (NS5M2UJLKP)" \
APPLE_INSTALLER_SIGNING_IDENTITY="3rd Party Mac Developer Installer: Kimani James (NS5M2UJLKP)" \
bun run mac:app-store:build
```

## Review risks to verify before submission

- Accessibility permission must be presented as assistive text entry for users
  who cannot comfortably type. The app should describe Accessibility use as
  entering user-dictated text, learning user corrections after insertion, and
  supporting hands-free text entry.
- Do not claim Vox Jot never reads app content while correction monitoring or
  Screen Context are available; review notes must accurately disclose those
  user-enabled assistive features.
- Global shortcut, text insertion, and hands-free submit require clear user
  control and permission prompts.
- Screen context/OCR features must be optional and privacy copy must be accurate.
- Microphone permission text must match local dictation behavior.
- Sentry must remain opt-in and must not send transcripts, audio, prompts, or personal content.
- Model and runtime downloads must work inside the App Sandbox.
- If Apple rejects background/tray behavior, default the App Store build to visible-window-first behavior in a follow-up.

## Review response template

Use this response after removing `Mac` from the App Store Connect subtitle:

> We removed the Apple trademark term from the app subtitle. The subtitle is now
> `Assistive Voice Dictation`.
>
> Vox Jot is intended as assistive voice text entry for users who cannot
> comfortably type because of disability, motor limitations, repetitive strain
> injury, temporary injury, fatigue, pain, or other accessibility needs.
> Accessibility access and related macOS permissions are used for user-enabled
> assistive dictation features: inserting dictated text into the focused field,
> learning user corrections after insertion so repeated fixes do not have to be
> typed again, and supporting hands-free text entry. Screen Context is optional
> and uses separate Screen Recording permission for local OCR context that helps
> with visible names, jargon, and phrase keys. These controls are disclosed in
> onboarding and in Privacy & Storage under Assistive access & privacy.

## Release checklist

1. Bump app version across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run normal validation.
3. Run `bun run mac:app-store:audit`.
4. Place the current provisioning profile at `src-tauri/profiles/VoxJot-AppStore.provisionprofile`.
5. Run `bun run mac:app-store:build`.
6. Validate the generated package with App Store Connect.
7. Upload with `bun run mac:app-store:upload` or Transporter.
8. Complete App Privacy, screenshots, review notes, pricing, and support URL in App Store Connect.
