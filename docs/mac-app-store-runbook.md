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

- Global shortcut and paste automation require clear user control and permission prompts.
- Screen context/OCR features must be opt-in and privacy copy must be accurate.
- Microphone permission text must match local dictation behavior.
- Sentry must remain opt-in and must not send transcripts, audio, prompts, or personal content.
- Model and runtime downloads must work inside the App Sandbox.
- If Apple rejects background/tray behavior, default the App Store build to visible-window-first behavior in a follow-up.

## Release checklist

1. Bump app version across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run normal validation.
3. Run `bun run mac:app-store:audit`.
4. Place the current provisioning profile at `src-tauri/profiles/VoxJot-AppStore.provisionprofile`.
5. Run `bun run mac:app-store:build`.
6. Validate the generated package with App Store Connect.
7. Upload with `bun run mac:app-store:upload` or Transporter.
8. Complete App Privacy, screenshots, review notes, pricing, and support URL in App Store Connect.
