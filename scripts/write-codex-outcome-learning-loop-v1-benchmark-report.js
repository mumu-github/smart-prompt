"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createBenchmarkPreview,
  runBenchmark
} = require("../benchmarks/codex-outcome-v1");
const { validateBenchmarkResult } = require("../packages/outcome-learning");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(
  root,
  "research",
  "codex-outcome-learning-loop-v1-benchmark.latest.json"
);

function scanPublicArtifact(value) {
  const findings = [];
  const forbiddenKeys = new Set([
    "apiKey",
    "clipboardText",
    "draftText",
    "generatedPrompt",
    "inputText",
    "promptText",
    "rawInput",
    "rawTitle",
    "rawUia"
  ]);
  const absolutePath = /(?:^|[\s"'])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\/)/;
  const credential = /(?:\bBearer\s+\S{12,}|\bsk-[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{12,})/i;

  function visit(item, at) {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${at}[${index}]`));
      return;
    }
    if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (forbiddenKeys.has(key)) findings.push({ code: "forbidden_key", at: `${at}.${key}` });
        visit(child, `${at}.${key}`);
      }
      return;
    }
    if (typeof item === "string" && absolutePath.test(item)) findings.push({ code: "absolute_path", at });
    if (typeof item === "string" && credential.test(item)) findings.push({ code: "credential_shape", at });
  }

  visit(value, "$");
  return findings;
}

async function main() {
  const preview = createBenchmarkPreview({ executor: "fake" });
  const result = await runBenchmark({ preview, executionMode: "foreground" });
  const validation = validateBenchmarkResult(result);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(result.executor, "fake");
  assert.equal(result.status, "passed");
  assert.equal(result.authorization.required, false);
  assert.equal(result.authorization.granted, false);
  assert.equal(result.taskCount, 12);
  assert.equal(result.safety.noAutoSubmitPassed, true);
  assert.equal(result.safety.privacyPassed, true);
  assert.equal(result.safety.permissionPassed, true);

  const report = {
    schemaVersion: "codex-outcome-learning-loop-v1-benchmark-report@1",
    createdAt: new Date().toISOString(),
    verdict: "pass",
    productionPromotionEligible: false,
    fakeBenchmark: {
      status: "passed",
      evidenceClass: "harness_only",
      zeroPaidRequests: true,
      result
    },
    realBenchmark: {
      status: "not_run",
      reasonToken: "separate_budget_confirmation_not_granted",
      paidRequests: 0
    },
    limitations: [
      "Fake-executor evidence validates harness behavior only.",
      "It cannot benchmark real Codex quality or promote a production policy."
    ]
  };
  const findings = scanPublicArtifact(report);
  assert.deepEqual(findings, []);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ pass: true, output: path.relative(root, outputPath) })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
