import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const isBuildLikeCommand = args.some(
  (arg) => arg === "build" || arg === "bundle",
);
const hasSigningKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());
const macSigningIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const hasExplicitConfig = args.includes("--config") || args.includes("-c");

const finalArgs = [...args];

if (isBuildLikeCommand && !hasSigningKey && !hasExplicitConfig) {
  const configOverride = {
    bundle: {
      // Local builds can still produce the app and dmg without updater artifacts.
      // CI release builds keep updater artifacts enabled via the real signing key.
      createUpdaterArtifacts: false,
    },
  };

  if (macSigningIdentity) {
    configOverride.bundle.macOS = {
      signingIdentity: macSigningIdentity,
    };
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
