"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const contracts = require("../packages/outcome-learning");
const fixtures = require("../packages/outcome-learning/contract-fixtures.json");
const { createApp } = require("../apps/local-service/src/server");
const { createStore } = require("../apps/local-service/src/store");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "research", "codex-outcome-learning-loop-v1-acceptance.latest.json");
const verificationFlags = new Set(process.argv.slice(2));
const fixedNow = () => "2026-07-19T09:00:00.000Z";
const rawSentinel = "RAW_SESSION_TEXT_MUST_NOT_PERSIST_7f1d";
const credentialSentinel = "sk-session-secret-1234567890";
const pathSentinel = "C:\\Users\\example\\private-project";

function candidatePayload(type) {
  if (type === "memory") return { category: "verified_environment", statement: "Reuse the verified contract before integration." };
  if (type === "rule") return { directive: "Require exact machine readback before success.", taskScenarioTokens: ["verified_insert"] };
  if (type === "skill") {
    return {
      triggerConditionTokens: ["contract_change"],
      stepTokens: ["inspect_contract", "run_fixture_tests"],
      verificationTokens: ["fixtures_pass"],
      resourceTokens: ["node_test_runner"],
      permissionTokens: ["workspace_read", "package_write"],
      failureRecoveryTokens: ["stop_without_integration"],
      scriptsExecutable: false,
      permissionCheckPassed: false,
      isolationTestPassed: false,
      adversarialReviewPassed: false
    };
  }
  return { policyId: "policy_privacy_fixture", policyVersion: 2 };
}

function observationInput(type, index, extra = {}) {
  const sessions = ["session_a", "session_a", "session_b"];
  return {
    projectScopeToken: "project_privacy_fixture",
    sessionId: `${sessions[index]}_${type}`,
    outcomeId: `outcome_${type}_${index + 1}`,
    featureTokens: [`pattern:${type}`, "source:derived_features"],
    taskScenarioToken: "contract_implementation",
    modeToken: "continue",
    strategyId: "baseline",
    strategyVersion: "v1",
    modelFamilyToken: "model_fixture",
    contextSourceTokens: [],
    editFeatureSummary: { userEdited: false, lengthDeltaBucket: "none", structureChanged: false },
    insertVerified: true,
    retryCount: 0,
    undoUsed: false,
    outcomeStatus: "succeeded",
    failureReasonTokens: [],
    tokenAccountingSource: "provider",
    inputTokens: 12,
    outputTokens: 8,
    insertedPromptTokenEstimate: 20,
    latencyMs: 100,
    candidate: { artifactType: type, payload: candidatePayload(type) },
    ...extra
  };
}

function semanticCandidateInput(type) {
  if (type === "memory") return "This project uses Tauri for its desktop shell.";
  if (type === "rule") return "Preserve existing changes while implementing the request.";
  if (type === "skill") return "Create a reusable workflow for recurring bug fixes.";
  return "Fix the deterministic fixture bug.";
}

function recordVerifiedOutcomeLearning(store, type, index) {
  const sessions = ["session_a", "session_a", "session_b"];
  const projectScopeToken = "project_privacy_fixture";
  const sessionId = `${sessions[index]}_${type}`;
  const generationId = `generation_${type}_${index + 1}`;
  const outcomeId = `outcome_${type}_${index + 1}`;
  const taskScenarioToken = `contract_implementation_${type}`;
  const modelFamilyToken = store.getSettings().model;
  const learningCandidateSeed = contracts.deriveLearningCandidateSeed(
    semanticCandidateInput(type),
    { taskScenarioToken }
  );
  const baseline = store.ensureBaselineGenerationPolicy({
    target: "codex",
    projectScopeToken,
    taskScenarioToken,
    modelFamilyToken
  });
  store.addPromptHistory({
    generationId,
    strategyId: "baseline",
    mode: "continue",
    tool: "codex",
    generatedBy: "acceptance-fixture",
    tokenUsage: {
      source: "provider",
      inputTokens: 12,
      outputTokens: 8,
      insertedPromptTokenEstimate: 20
    },
    context: {
      projectScopeToken,
      taskScenario: taskScenarioToken,
      modelFamilyToken,
      generationPolicyId: baseline.policyId,
      generationPolicyVersion: baseline.version,
      learningCandidateSeed
    }
  });
  store.recordVerifiedGenerationEditSummary({
    generationId,
    projectScopeToken,
    sessionId,
    policyId: baseline.policyId,
    policyVersion: baseline.version,
    editFeatureSummary: {
      userEdited: false,
      lengthDeltaBucket: "none",
      structureChanged: false
    }
  });
  store.recordVerifiedInsertOutcome({
    contractVersion: "prompt-session@2",
    eventId: `verified_insert_${type}_${index + 1}`,
    eventType: "verified_insert",
    occurredAt: "2026-07-19T08:58:00.000Z",
    sessionId,
    generationId,
    target: "codex",
    projectScopeToken,
    strategyId: "baseline",
    strategyVersion: "v1",
    modelFamilyToken,
    outcomeId,
    policyId: baseline.policyId,
    policyVersion: baseline.version,
    taskOutcomeToken: "unknown",
    insertVerified: true,
    noAutoSubmit: true,
    failureReasonTokens: [],
    privacyFlags: { ...contracts.DEFAULT_PRIVACY_FLAGS }
  });
  store.claimPendingOutcomeFeedback({
    askId: `ask_${type}_${index + 1}`,
    target: "codex",
    projectScopeToken
  });
  const result = store.submitPendingOutcomeFeedback({
    feedbackId: `feedback_${type}_${index + 1}`,
    outcomeId,
    taskOutcomeToken: "completed"
  });
  return store.recordResolvedOutcomeObservation(result.outcome);
}

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  });
}

function scanText(text) {
  return {
    rawSentinel: text.includes(rawSentinel),
    credentialSentinel: text.includes(credentialSentinel),
    absolutePathSentinel: text.includes(pathSentinel)
  };
}

function scanObject(value) {
  const text = JSON.stringify(value);
  const basic = scanText(text);
  const findings = [];
  const credentialShape = /(?:\bBearer\s+\S{12,}|\bsk-[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{12,})/i;
  const absolutePath = /(?:^|[\s"'])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\/)/;
  if (basic.rawSentinel) findings.push("raw_session_text");
  if (basic.credentialSentinel || credentialShape.test(text)) findings.push("credential_shape");
  if (basic.absolutePathSentinel || absolutePath.test(text)) findings.push("absolute_path");
  return findings;
}

function request(server, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const req = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: pathname,
      method: options.method || "GET",
      headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : undefined
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function externalVerification() {
  const names = ["node", "shared", "desktop", "native", "package", "gui", "adversarial"];
  return Object.fromEntries(names.map((name) => [name, verificationFlags.has(`--${name}-pass`) ? "pass" : "not_run"]));
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-outcome-acceptance-"));
  const store = createStore(dataDir, {
    learningOptions: { now: fixedNow },
    pendingOutcomeOptions: { now: fixedNow },
    policyOptions: { now: fixedNow, allowHarnessOnlyBenchmarks: true },
    policyCompilerOptions: { now: fixedNow }
  });

  const rawRejections = [];
  for (const [field, value] of [
    ["rawInput", rawSentinel],
    ["apiKey", credentialSentinel],
    ["projectPath", pathSentinel]
  ]) {
    try {
      store.recordLearningObservation(observationInput("memory", 0, {
        outcomeId: `rejected_${field}`,
        [field]: value
      }));
    } catch (error) {
      rawRejections.push({ field, code: error.code || error.name });
    }
  }
  assert.equal(rawRejections.length, 3);

  const types = ["memory", "rule", "skill", "generation_policy"];
  for (const type of types) {
    for (let index = 0; index < 3; index += 1) {
      recordVerifiedOutcomeLearning(store, type, index);
    }
  }
  const artifacts = store.listLearningArtifacts({ projectScopeToken: "project_privacy_fixture" });
  assert.deepEqual(artifacts.map((artifact) => artifact.artifactType).sort(), [...types].sort());
  assert.ok(artifacts.every((artifact) => artifact.status === "pending_review" && artifact.effective === false));

  const internalObservations = store.listLearningObservations({ projectScopeToken: "project_privacy_fixture" });
  assert.equal(internalObservations.length, 12);
  assert.ok(internalObservations.every((observation) => (
    observation.semanticFingerprint.kind === "keyed_feature_hash"
      && observation.semanticFingerprint.projectScoped === true
      && observation.semanticFingerprint.exportable === false
      && /^[a-f0-9]{64}$/.test(observation.semanticFingerprint.valueToken)
  )));

  const persistedText = allFiles(dataDir).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.deepEqual(scanText(persistedText), {
    rawSentinel: false,
    credentialSentinel: false,
    absolutePathSentinel: false
  });

  const server = http.createServer(createApp(store, { disableAuth: true, codexTargetAdapter: null }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let observationsResponse;
  let artifactsResponse;
  let diagnosticsResponse;
  let reminderResolveResponse;
  try {
    [observationsResponse, artifactsResponse, diagnosticsResponse, reminderResolveResponse] = await Promise.all([
      request(server, "/learning/v1/observations?projectScopeToken=project_privacy_fixture"),
      request(server, "/learning/v1/artifacts?projectScopeToken=project_privacy_fixture"),
      request(server, "/diagnostics/export"),
      request(server, "/learning/v1/reminder/resolve", {
        method: "POST",
        body: {
          projectScopeToken: "project_privacy_fixture",
          input: semanticCandidateInput("memory"),
          taskScenarioToken: "contract_implementation_memory",
          modeToken: "continue"
        }
      })
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(observationsResponse.status, 200);
  assert.equal(artifactsResponse.status, 200);
  assert.equal(diagnosticsResponse.status, 200);
  assert.equal(reminderResolveResponse.status, 200);
  assert.equal(reminderResolveResponse.body.reminder.artifactType, "memory");
  assert.ok(reminderResolveResponse.body.featureTokens.includes("learning:memory_tauri"));
  assert.ok(observationsResponse.body.observations.every((observation) => (
    observation.semanticFingerprint.exportable === false
      && !Object.hasOwn(observation.semanticFingerprint, "valueToken")
      && !Object.hasOwn(observation.semanticFingerprint, "algorithm")
  )));
  assert.deepEqual(scanObject(observationsResponse.body), []);
  assert.deepEqual(scanObject(artifactsResponse.body), []);
  assert.deepEqual(scanObject(diagnosticsResponse.body), []);

  const validContext = fixtures.valid.find((fixture) => fixture.id === "context-source-disabled-project-files");
  const injectionFixture = fixtures.invalid.find((fixture) => fixture.id === "context-source-high-risk-injection-collected");
  assert.equal(contracts.validateContract(validContext.contract, validContext.value).valid, true);
  const injectionValidation = contracts.validateContract(injectionFixture.contract, injectionFixture.value);
  assert.equal(injectionValidation.valid, false);
  assert.ok(injectionValidation.errors.some((error) => error.code === "prompt_injection_gate"));

  const researchFiles = fs.readdirSync(path.join(root, "research"))
    .filter((name) => name.startsWith("codex-outcome-learning-loop-v1-")
      && name.endsWith(".json")
      && name !== path.basename(outputPath));
  const researchFindings = researchFiles.flatMap((name) => scanObject(
    JSON.parse(fs.readFileSync(path.join(root, "research", name), "utf8"))
  ));
  assert.deepEqual(researchFindings, []);

  const external = externalVerification();
  const externalPass = Object.values(external).every((status) => status === "pass");
  const report = {
    schemaVersion: "codex-outcome-learning-loop-v1-acceptance@1",
    createdAt: new Date().toISOString(),
    verdict: externalPass ? "pass" : "partial",
    scannerPass: true,
    checks: {
      contractFixtures: true,
      contextSourceInjectionGate: true,
      fourCandidateTypes: true,
      fourCandidateTypesFromVerifiedOutcomes: true,
      openCardReminderResolvedWithoutModel: true,
      candidatesInactiveBeforeReview: true,
      rawSessionTextRejected: true,
      credentialsRejected: true,
      absoluteProjectPathsRejected: true,
      persistedRuntimeDataRedacted: true,
      publicApiRedacted: true,
      semanticFingerprintProjectScoped: true,
      semanticFingerprintNotExported: true,
      diagnosticsRedacted: true,
      researchArtifactsRedacted: true
    },
    counts: {
      observations: internalObservations.length,
      candidateTypes: artifacts.length,
      rejectedRawInputs: rawRejections.length,
      researchArtifacts: researchFiles.length
    },
    externalVerification: external,
    realBenchmark: {
      status: "not_run",
      reasonToken: "separate_budget_confirmation_not_granted",
      paidRequests: 0
    }
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ pass: true, verdict: report.verdict, output: path.relative(root, outputPath) })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
