# Gumroad CLI Agent Runbook

This repo is set up to use the `gumroad` CLI for Gumroad operations instead of browser-driving the Gumroad web editor whenever the API supports the task.

## Local Setup

- CLI: `gumroad` 0.19.0 installed via Homebrew.
- Auth: local seller OAuth is stored in the CLI config for `Irie Dinamik <kimani@iriedinamik.org>`.
- Agent skill:
  - `/Users/dinamikjames/.agents/skills/gumroad/SKILL.md`
  - `/Users/dinamikjames/.claude/skills/gumroad`
  - `/Users/dinamikjames/.codex/skills/gumroad/SKILL.md`

Do not commit Gumroad access tokens. For CI or a fresh machine, use `GUMROAD_ACCESS_TOKEN` or pipe a token into `gumroad auth login --with-token`.

## Vox Jot Product

- Product name: `Vox Jot: Local AI Dictation & Voice Studio for Mac`
- Product ID: `8UhuqxxzvPRLgPfGc37FFw==`
- Custom permalink: `voxjot`
- Public product page: `https://iriedinamik.gumroad.com/l/voxjot`
- Purchased content page used for smoke checks: `https://gumroad.com/d/3d366d9709b6e41a589b27736edb5c16`
- Direct DMG URL: `https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg`
- Checksum URL: `https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg.sha256`
- Paid download help page: `https://www.iriedinamik.org/voxjot/download/?paid=1`

## Required Agent Defaults

Use these flags by default:

```sh
--json --no-input --quiet
```

For destructive or high-impact writes, use a dry run first:

```sh
gumroad products update '8UhuqxxzvPRLgPfGc37FFw==' --custom-summary "..." --dry-run --json --no-input
```

Then run the real command only after the intended diff is clear. Use `--yes` only when the command can prompt and the user has approved the specific mutation.

## Common Read Commands

```sh
gumroad auth status --json --no-input
gumroad user --json --no-input
gumroad products list --json --no-input
gumroad products view '8UhuqxxzvPRLgPfGc37FFw==' --json --no-input
gumroad products view '8UhuqxxzvPRLgPfGc37FFw==' --json --jq '.product.rich_content' --no-input
gumroad products sections list '8UhuqxxzvPRLgPfGc37FFw==' --json --no-input
```

## Product Content and Files

The CLI can inspect rich content and product metadata. Use it before opening Gumroad in a browser.

Current state as of June 5, 2026:

- The Gumroad purchased-content page starts with `DOWNLOAD VOX JOT`.
- The main download link text is `Download Vox Jot for Mac (.dmg, Apple Silicon)`.
- Product `file_info` is empty, so the DMG is linked from Gumroad content but is not currently attached as a native Gumroad file.

To attach a local release artifact as a native Gumroad file in a future release, first verify the artifact path and checksum, then preview the update:

```sh
gumroad products update '8UhuqxxzvPRLgPfGc37FFw==' \
  --file /absolute/path/to/Vox-Jot-latest-aarch64.dmg \
  --file-name "Vox Jot for Mac (.dmg, Apple Silicon)" \
  --dry-run --json --no-input
```

If the dry run matches the intended file, run without `--dry-run`. Do not use `--replace-files` unless the user explicitly wants existing Gumroad-native attachments removed.

## Validation After Gumroad Changes

After content, file, or product-page changes:

1. Read back through the CLI:

```sh
gumroad products view '8UhuqxxzvPRLgPfGc37FFw==' --json --no-input
```

2. Verify the user-facing page in a browser:

```text
https://gumroad.com/d/3d366d9709b6e41a589b27736edb5c16
```

3. Check the direct artifact URL without downloading the full DMG:

```sh
curl -I --location https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg
curl -I --location https://downloads.iriedinamik.org/voxjot/latest/Vox-Jot-latest-aarch64.dmg.sha256
```

4. For a full install-flow test, use the browser/desktop path and stop before payment, CAPTCHA, or checkout steps that require private data unless the user has explicitly approved that specific action.

## Limits

The CLI does not replace checkout QA. Browser testing is still required for Gumroad purchase, receipt, CAPTCHA, payment, and actual download/install flows.

The CLI should reduce brittle web-editor work for product metadata, file uploads, native file attachment, product inspection, sales/license lookups, and repeatable agent workflows.
