import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const isBuildLikeCommand = args.some((arg) => arg === "build" || arg === "bundle");
const hasSigningKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());
const hasExplicitConfig = args.includes("--config") || args.includes("-c");

const finalArgs = [...args];

if (isBuildLikeCommand && !hasSigningKey && !hasExplicitConfig) {
  // Local builds can still produce the app and dmg without updater artifacts.
  // CI release builds keep updater artifacts enabled via the real signing key.
  finalArgs.push(
    "--config",
    JSON.stringify({
      bundle: {
        createUpdaterArtifacts: false,
      },
    }),
  );
}

const result = spawnSync("tauri", finalArgs, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
