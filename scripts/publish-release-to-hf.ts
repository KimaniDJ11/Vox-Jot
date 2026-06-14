#!/usr/bin/env bun
/*
 * BLOCKED: GitHub Releases are not used for Vox Jot app distribution.
 *
 * This script used to mirror a GitHub Release's signed updater artifacts and
 * installers to the public Hugging Face `vox-jot-releases` repo. The
 * GitHub-release distribution path is now intentionally disabled (see CLAUDE.md
 * / AGENTS.md "Production Distribution Policy"). The previous implementation is
 * preserved in git history.
 *
 * Use the local distributor instead. It signs/notarizes locally and uploads the
 * DMG to Cloudflare R2 and the updater archive + latest.json to Hugging Face
 * directly, without ever creating a GitHub Release:
 *
 *   bun run release:local-mac -- <version>
 */

console.error(
  [
    "Blocked: publish-release-to-hf.ts is part of the disabled GitHub Releases path.",
    "",
    "GitHub Releases are blocked for Vox Jot app distribution.",
    "Use the local Cloudflare R2 + Gumroad + updater-feed distributor instead:",
    "  bun run release:local-mac -- <version>",
    "",
    'See CLAUDE.md / AGENTS.md "Production Distribution Policy".',
  ].join("\n"),
);
process.exit(1);
