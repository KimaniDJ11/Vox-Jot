import { spawnSync } from "node:child_process";

process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= "true";
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= "true";

const args = process.argv.slice(2);
const isBuildLikeCommand = args.some(
  (arg) => arg === "build" || arg === "bundle",
);
const hasSigningKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());
const macSigningIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const hasExplicitConfig = args.includes("--config") || args.includes("-c");

const finalArgs = [...args];

if (isBuildLikeCommand && !hasSigningKey && !hasExplicitConfig) {
  const configOverride = { bundle: { createUpdaterArtifacts: false } };

  // Local builds can still produce the app and dmg without updater artifacts.
  // Signed release builds can provide their own config alongside signing keys.
  if (macSigningIdentity) {
    configOverride.bundle.macOS = { signingIdentity: macSigningIdentity };
  }

  finalArgs.push("--config", JSON.stringify(configOverride));
}

const result = spawnSync("tauri", finalArgs, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
