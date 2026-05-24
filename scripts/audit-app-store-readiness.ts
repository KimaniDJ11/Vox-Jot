#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type TauriConfig = {
  app?: {
    macOSPrivateApi?: boolean;
  };
  bundle?: {
    category?: string;
    createUpdaterArtifacts?: boolean;
    macOS?: {
      entitlements?: string;
      files?: Record<string, string>;
      hardenedRuntime?: boolean;
      minimumSystemVersion?: string;
      signingIdentity?: string;
    };
  };
};

type Finding = {
  level: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
};

const root = process.cwd();
const configPath = join(root, "src-tauri", "tauri.appstore.conf.json");
const entitlementsPath = join(root, "src-tauri", "Entitlements.appstore.plist");
const infoPath = join(root, "src-tauri", "Info.plist");
const libPath = join(root, "src-tauri", "src", "lib.rs");
const shortcutPath = join(root, "src-tauri", "src", "shortcut", "mod.rs");
const distributionPath = join(root, "src", "lib", "distribution.ts");
const englishLocalePath = join(
  root,
  "src",
  "i18n",
  "locales",
  "en",
  "translation.json",
);
const macAppStoreRunbookPath = join(root, "docs", "mac-app-store-runbook.md");

const findings: Finding[] = [];

function add(level: Finding["level"], message: string, detail?: string) {
  findings.push({ level, message, detail });
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

if (!existsSync(configPath)) {
  add("fail", "App Store Tauri config is missing.");
} else {
  const config = JSON.parse(read(configPath)) as TauriConfig;
  if (config.app?.macOSPrivateApi !== false) {
    add("fail", "App Store config must disable macOS private APIs.");
  }
  if (config.bundle?.createUpdaterArtifacts !== false) {
    add("fail", "App Store config must disable Tauri updater artifacts.");
  }
  if (config.bundle?.category !== "Utility") {
    add("fail", "App Store config must set bundle.category to Utility.");
  }
  if (config.bundle?.macOS?.entitlements !== "./Entitlements.appstore.plist") {
    add("fail", "App Store config must use Entitlements.appstore.plist.");
  }
  if (
    config.bundle?.macOS?.files?.["embedded.provisionprofile"] !==
    "./profiles/VoxJot-AppStore.provisionprofile"
  ) {
    add(
      "fail",
      "App Store config must embed the Mac App Store provisioning profile.",
    );
  }
  if (config.bundle?.macOS?.hardenedRuntime !== false) {
    add(
      "fail",
      "App Store config should disable hardenedRuntime; App Sandbox is the App Store trust boundary.",
    );
  }
  if (config.bundle?.macOS?.minimumSystemVersion !== "12.0") {
    add(
      "warn",
      "Apple Silicon App Store builds should set minimumSystemVersion to 12.0.",
    );
  }
}

if (!existsSync(entitlementsPath)) {
  add("fail", "App Store entitlements file is missing.");
} else {
  const entitlements = read(entitlementsPath);
  for (const required of [
    "com.apple.security.app-sandbox",
    "com.apple.application-identifier",
    "NS5M2UJLKP.com.iriedinamik.voxjot",
    "com.apple.developer.team-identifier",
    "com.apple.security.device.microphone",
    "com.apple.security.network.client",
  ]) {
    if (!entitlements.includes(required)) {
      add("fail", `App Store entitlements missing ${required}.`);
    }
  }
}

if (!existsSync(infoPath)) {
  add("fail", "Info.plist is missing.");
} else {
  const info = read(infoPath);
  if (!info.includes("ITSAppUsesNonExemptEncryption")) {
    add("fail", "Info.plist must declare encryption export status.");
  }
  if (!info.includes("NSMicrophoneUsageDescription")) {
    add("fail", "Info.plist must describe microphone use.");
  }
  if (!info.toLowerCase().includes("assistive")) {
    add(
      "fail",
      "Info.plist permission usage strings must frame protected access as assistive dictation.",
    );
  }
}

const lib = existsSync(libPath) ? read(libPath) : "";
if (!lib.includes("cfg(not(vox_jot_app_store))")) {
  add(
    "fail",
    "Rust runtime must gate self-hosted plugins out of App Store builds.",
  );
}
if (
  lib.includes(".plugin(tauri_plugin_updater::Builder::new().build())") &&
  !lib.includes("vox_jot_app_store")
) {
  add(
    "warn",
    "Updater plugin appears in lib.rs; confirm it is behind not(vox_jot_app_store).",
  );
}

const shortcut = existsSync(shortcutPath) ? read(shortcutPath) : "";
if (!shortcut.includes("cfg(vox_jot_app_store)")) {
  add(
    "fail",
    "Settings commands must force unsupported App Store toggles off.",
  );
}

if (!existsSync(distributionPath)) {
  add("fail", "Frontend distribution helper is missing.");
} else if (!read(distributionPath).includes("VITE_VOX_JOT_DISTRIBUTION")) {
  add(
    "fail",
    "Frontend distribution helper must read VITE_VOX_JOT_DISTRIBUTION.",
  );
}

const appStoreCopySources = [
  existsSync(englishLocalePath) ? read(englishLocalePath) : "",
  existsSync(macAppStoreRunbookPath) ? read(macAppStoreRunbookPath) : "",
].join("\n");

if (!appStoreCopySources.includes("Assistive Voice Dictation")) {
  add(
    "fail",
    "App Store metadata guidance must keep the subtitle as Assistive Voice Dictation.",
  );
}

for (const forbiddenTrademarkPhrase of [
  "Local Mac dictation",
  "Whisper for Mac",
]) {
  if (appStoreCopySources.includes(forbiddenTrademarkPhrase)) {
    add(
      "fail",
      `App Store-facing copy still contains forbidden Apple trademark phrasing: ${forbiddenTrademarkPhrase}.`,
    );
  }
}

for (const falsePrivacyClaim of [
  "does not read document contents",
  "does not read, scrape, or control unrelated app content",
  "does not use Accessibility access to inspect, scrape, or control unrelated app content",
]) {
  if (appStoreCopySources.includes(falsePrivacyClaim)) {
    add(
      "fail",
      `App Store-facing copy contains an inaccurate privacy claim while correction monitoring and Screen Context remain available: ${falsePrivacyClaim}.`,
    );
  }
}

for (const requiredAppStoreDisclosure of [
  "First-run onboarding asks only for Microphone access.",
  "clipboard-only delivery",
  "does not require Accessibility or Input Monitoring",
  "Accessibility-controlled insertion, correction monitoring",
]) {
  if (!appStoreCopySources.includes(requiredAppStoreDisclosure)) {
    add(
      "fail",
      `App Store-facing copy must disclose Mac App Store permission behavior: ${requiredAppStoreDisclosure}.`,
    );
  }
}

const profilePath = join(
  root,
  "src-tauri",
  "profiles",
  "VoxJot-AppStore.provisionprofile",
);
if (!existsSync(profilePath)) {
  add(
    "warn",
    "Mac App Store provisioning profile is not present locally.",
    "Download a Mac App Store Connect profile from Apple Developer and save it as src-tauri/profiles/VoxJot-AppStore.provisionprofile before packaging.",
  );
}

const identities = spawnSync(
  "/usr/bin/security",
  ["find-identity", "-v", "-p", "codesigning"],
  { encoding: "utf8" },
);
const identityOutput = `${identities.stdout}\n${identities.stderr}`;
if (
  !identityOutput.includes("Apple Distribution: Kimani James (NS5M2UJLKP)") &&
  !identityOutput.includes(
    "3rd Party Mac Developer Application: Kimani James (NS5M2UJLKP)",
  )
) {
  add(
    "warn",
    "Mac App Store application signing identity is not installed locally.",
    "Install the Apple Distribution / 3rd Party Mac Developer Application certificate with private key before building the App Store app.",
  );
}

const installerCerts = spawnSync(
  "/usr/bin/security",
  [
    "find-certificate",
    "-a",
    "-c",
    "3rd Party Mac Developer Installer: Kimani James (NS5M2UJLKP)",
  ],
  { encoding: "utf8" },
);
const modernInstallerCerts = spawnSync(
  "/usr/bin/security",
  [
    "find-certificate",
    "-a",
    "-c",
    "Mac Installer Distribution: Kimani James (NS5M2UJLKP)",
  ],
  { encoding: "utf8" },
);

if (installerCerts.status !== 0 && modernInstallerCerts.status !== 0) {
  add(
    "warn",
    "Mac App Store installer signing identity is not installed locally.",
    "Install the 3rd Party Mac Developer Installer / Mac Installer Distribution certificate before creating the upload PKG.",
  );
}

for (const finding of findings) {
  const prefix =
    finding.level === "pass"
      ? "PASS"
      : finding.level === "warn"
        ? "WARN"
        : "FAIL";
  console.log(`${prefix}: ${finding.message}`);
  if (finding.detail) {
    console.log(`  ${finding.detail}`);
  }
}

const failures = findings.filter((finding) => finding.level === "fail");
if (failures.length > 0) {
  process.exit(1);
}

if (findings.length === 0) {
  console.log("PASS: App Store readiness checks passed.");
}
