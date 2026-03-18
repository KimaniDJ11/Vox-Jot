import path from "node:path";

const ROOT = process.cwd();
const manifestPath = path.join(ROOT, "test-data", "audio-regression", "manifest.json");
const outputPath = path.join(
  ROOT,
  "test-data",
  "audio-regression",
  "reports",
  "latest-report.json",
);

const forwardedArgs = process.argv.slice(2);
const args = [
  "run",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--",
  "--regression-manifest",
  manifestPath,
  "--regression-output",
  outputPath,
  ...forwardedArgs,
];

const result = Bun.spawnSync(["cargo", ...args], {
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});

if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}

console.log(`Regression report: ${outputPath}`);
