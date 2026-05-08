#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type HardSuite = {
  id: string;
  domain: string;
  objective: string;
  local_commands?: string[];
  datasets: Array<{
    id: string;
    status: string;
    local_path?: string;
    source?: string;
    metrics: string[];
  }>;
  promotion_gate: string[];
};

type HardPlan = {
  metadata: {
    name: string;
    version: number;
    updated_at: string;
    purpose: string;
  };
  suites: HardSuite[];
};

const root = process.cwd();
const manifestPath = resolve(root, "test-data/model-hard-tests/manifest.json");
const raw = readFileSync(manifestPath, "utf-8");
const plan = JSON.parse(raw) as HardPlan;

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error(`FAIL ${message}`);
}

function ok(message: string) {
  console.log(`OK   ${message}`);
}

if (!plan.metadata?.name || !plan.metadata?.version) {
  fail("manifest metadata is incomplete");
} else {
  ok(`${plan.metadata.name} v${plan.metadata.version}`);
}

const suiteIds = new Set<string>();
for (const suite of plan.suites ?? []) {
  if (suiteIds.has(suite.id)) {
    fail(`duplicate suite id: ${suite.id}`);
  }
  suiteIds.add(suite.id);

  if (!suite.objective) {
    fail(`${suite.id} is missing an objective`);
  }
  if (!suite.datasets?.length) {
    fail(`${suite.id} has no datasets`);
  }
  if (!suite.promotion_gate?.length) {
    fail(`${suite.id} has no promotion gate`);
  }

  for (const dataset of suite.datasets ?? []) {
    if (!dataset.metrics?.length) {
      fail(`${suite.id}/${dataset.id} has no metrics`);
    }
    if (dataset.local_path) {
      const localPath = resolve(root, dataset.local_path);
      if (existsSync(localPath)) {
        ok(`${suite.id}/${dataset.id} local asset exists`);
      } else {
        fail(
          `${suite.id}/${dataset.id} missing local asset: ${dataset.local_path}`,
        );
      }
    }
    if (
      dataset.status === "recommended" &&
      (!dataset.source || !/^https?:\/\//.test(dataset.source))
    ) {
      fail(`${suite.id}/${dataset.id} recommended dataset needs a source URL`);
    }
  }
}

const requiredDomains = new Set([
  "stt",
  "llm",
  "file_asr",
  "tts",
  "speaker_isolation",
]);
for (const domain of requiredDomains) {
  if (!plan.suites.some((suite) => suite.domain === domain)) {
    fail(`missing required domain: ${domain}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} hard model plan validation failure(s).`);
  process.exit(1);
}

console.log(`\nValidated ${plan.suites.length} hard model suites.`);
