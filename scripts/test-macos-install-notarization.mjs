// Exercise the real installer function without signing, submitting, or installing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const source = readFileSync(
  new URL("./build-and-install-macos-app.sh", import.meta.url),
  "utf8",
);
const submit = source.match(/^run_notary_submit\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(submit, "Installer submission function must be found");
const cases = [
  {
    name: "failed wait with registered upload polls once and succeeds",
    code: 7,
    id: true,
    status: "Accepted",
    expected: 0,
  },
  {
    name: "successful upload still verifies Apple acceptance",
    code: 0,
    id: true,
    status: "Accepted",
    expected: 0,
  },
  {
    name: "rejected upload fails without resubmission",
    code: 7,
    id: true,
    status: "Invalid",
    expected: 1,
  },
  {
    name: "failed upload preserves the original error status",
    code: 7,
    id: false,
    status: "Accepted",
    expected: 7,
  },
  {
    name: "success without a submission ID fails closed",
    code: 0,
    id: false,
    status: "Accepted",
    expected: 1,
  },
];
for (const test of cases) {
  const script = `${submit}
fake_submit() { echo SUBMIT_CALLED; ${test.id ? 'echo "  id: 11111111-1111-4111-8111-111111111111";' : ""} return ${test.code}; }
notary_submission_info() { echo "  status: ${test.status}"; }
run_notary_submit fixture fake_submit
`;
  const result = spawnSync("/bin/bash", ["-c", script], {
    encoding: "utf8",
    timeout: 4000,
  });
  assert.equal(result.status, test.expected, `${test.name}: ${result.stderr}`);
  assert.equal(
    (result.stdout.match(/SUBMIT_CALLED/g) ?? []).length,
    1,
    "Never duplicate a registered upload",
  );
  console.log(`PASS ${test.name}`);
}
