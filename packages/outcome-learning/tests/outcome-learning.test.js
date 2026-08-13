"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(packageRoot, "contract-fixtures.json");
const fixtureText = fs.readFileSync(fixturePath, "utf8");
const fixtures = JSON.parse(fixtureText);
const editSummaryFixtures = JSON.parse(fs.readFileSync(
  path.join(packageRoot, "edit-feature-summary-fixtures.json"),
  "utf8"
));
const learningCandidateSeedFixtures = JSON.parse(fs.readFileSync(
  path.join(packageRoot, "learning-candidate-seed-fixtures.json"),
  "utf8"
));
const taskScenarioInferenceFixtures = JSON.parse(fs.readFileSync(
  path.join(packageRoot, "task-scenario-inference-fixtures.json"),
  "utf8"
));
const contracts = require("../index.js");
const { inferTaskScenario } = require("../../shared/prompt-quality");

test("exports the canonical bundle and contract versions", () => {
  assert.equal(contracts.BUNDLE_VERSION, fixtures.bundleVersion);
  assert.equal(contracts.FIXTURE_SET_VERSION, fixtures.fixtureSetVersion);
  assert.deepEqual(contracts.CONTRACT_VERSIONS, fixtures.contractVersions);
  assert.equal(Object.isFrozen(contracts.CONTRACT_VERSIONS), true);
});

test("publishes finite, unique, frozen enums", () => {
  for (const [name, values] of Object.entries(contracts.ENUMS)) {
    assert.ok(values.length > 0, `${name} must not be empty`);
    assert.equal(new Set(values).size, values.length, `${name} must contain unique values`);
    assert.equal(Object.isFrozen(values), true, `${name} must be frozen`);
  }
  assert.deepEqual(contracts.ENUMS.generationPolicyStatus, [
    "draft",
    "benchmarked",
    "canary",
    "stable",
    "rolled_back"
  ]);
  assert.ok(contracts.ENUMS.outcomeFailureReason.includes("insert_failed"));
  assert.deepEqual(contracts.ENUMS.tokenAccountingSource, ["provider", "estimated", "unavailable"]);
});

test("accepts every canonical valid fixture without normalization drift", () => {
  for (const fixture of fixtures.valid) {
    const result = contracts.validateContract(fixture.contract, fixture.value);
    assert.equal(result.valid, true, `${fixture.id}: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(
      contracts.normalizeContract(fixture.contract, fixture.value),
      fixture.value,
      `${fixture.id} must already be canonical`
    );
    assert.deepEqual(
      contracts.assertValidContract(fixture.contract, fixture.value),
      fixture.value,
      `${fixture.id} assertion must return canonical data`
    );
  }
});

test("rejects every canonical invalid fixture with stable error codes", () => {
  for (const fixture of fixtures.invalid) {
    const result = contracts.validateContract(fixture.contract, fixture.value);
    assert.equal(result.valid, false, `${fixture.id} should be rejected`);
    const codes = new Set(result.errors.map((error) => error.code));
    for (const expectedCode of fixture.expectedErrorCodes) {
      assert.equal(codes.has(expectedCode), true, `${fixture.id} missing ${expectedCode}: ${JSON.stringify(result.errors)}`);
    }
    assert.throws(
      () => contracts.assertValidContract(fixture.contract, fixture.value),
      (error) => error instanceof contracts.ContractValidationError && error.errors.length > 0
    );
  }
});

test("validators return structured errors instead of throwing on malformed input", () => {
  for (const contract of Object.keys(contracts.CONTRACT_VERSIONS)) {
    for (const value of [null, {}]) {
      let result;
      assert.doesNotThrow(() => {
        result = contracts.validateContract(contract, value);
      }, `${contract} must handle ${JSON.stringify(value)}`);
      assert.equal(result.valid, false, contract);
      assert.ok(result.errors.length > 0, contract);
    }
  }
});

test("normalizers handle absent records deterministically", () => {
  for (const [contract, version] of Object.entries(contracts.CONTRACT_VERSIONS)) {
    let normalized;
    assert.doesNotThrow(() => {
      normalized = contracts.normalizeContract(contract, null);
    }, contract);
    assert.equal(normalized.contractVersion, version, contract);
    assert.deepEqual(normalized.privacyFlags, contracts.DEFAULT_PRIVACY_FLAGS, contract);
  }
});

test("maps internal failures to finite public reasons without echoing internals", () => {
  const cases = new Map([
    ["inserted", "none"],
    ["foreground_fill_requires_safe_candidate", "safety_blocked"],
    ["after_write_mismatch", "write_not_verified"],
    ["readback_unavailable", "readback_unavailable"],
    ["budget_exhausted", "budget_exhausted"],
    ["credential_invalid", "model_unavailable"],
    ["unrecognized_internal_failure_payload", "unknown"]
  ]);
  for (const [internalReason, expected] of cases) {
    const mapped = contracts.mapPublicReason(internalReason);
    assert.equal(mapped, expected);
    assert.ok(contracts.ENUMS.publicReason.includes(mapped));
    const publicView = contracts.getPublicReason(internalReason, "zh-CN");
    assert.equal(publicView.code, expected);
    assert.deepEqual(Object.keys(publicView), ["code", "title", "message"]);
    if (!contracts.ENUMS.publicReason.includes(internalReason)) {
      assert.equal(JSON.stringify(publicView).includes(internalReason), false);
    }
  }
});

test("adapter normalization derives rather than trusts the public reason", () => {
  const normalized = contracts.normalizeCodexTargetAdapterResult({
    reasonToken: "foreground_fill_requires_safe_candidate",
    publicReason: "none"
  });
  assert.equal(normalized.publicReason, "safety_blocked");
});

test("privacy checks reject forbidden raw fields, unsafe flags, paths, and credential-shaped values", () => {
  const rawPath = { statement: ["C:", "private", "workspace"].join("\\") };
  const credentialLike = { statement: ["Bearer", "synthetic_secret_material_1234567890"].join(" ") };

  for (const field of ["promptText", "path", "title", "key"]) {
    assert.ok(
      contracts.findPrivacyViolations({ observationId: "observation_test", [field]: null })
        .some((item) => item.code === "privacy_forbidden_field"),
      field
    );
  }
  assert.ok(contracts.findPrivacyViolations(rawPath).some((item) => item.code === "privacy_forbidden_value"));
  assert.ok(contracts.findPrivacyViolations(credentialLike).some((item) => item.code === "privacy_forbidden_value"));
  assert.ok(contracts.findPrivacyViolations({ privacyFlags: { rawInputStored: true } }).some((item) => item.code === "privacy_flag"));
});

test("fingerprints default to project-scoped keyed feature hashes", () => {
  const normalized = contracts.normalizeSemanticFingerprint({
    valueToken: "6d".repeat(32)
  });
  assert.equal(normalized.kind, "keyed_feature_hash");
  assert.equal(normalized.projectScoped, true);
  assert.equal(normalized.algorithm, "hmac_sha256");
  assert.equal(normalized.exportable, false);
  assert.equal(normalized.absoluteIrreversibilityClaimed, false);
});

test("derives privacy-safe edit summaries from canonical parity fixtures", () => {
  assert.equal(editSummaryFixtures.schemaVersion, "edit-feature-summary-fixtures@1");
  for (const fixture of editSummaryFixtures.cases) {
    assert.deepEqual(
      contracts.deriveEditFeatureSummary(fixture.generated, fixture.inserted),
      fixture.expected,
      fixture.id
    );
  }
});

test("derives only canonical privacy-safe learning candidate seeds", () => {
  assert.equal(learningCandidateSeedFixtures.schemaVersion, "learning-candidate-seed-fixtures@1");
  for (const fixture of learningCandidateSeedFixtures.cases) {
    const actual = contracts.deriveLearningCandidateSeed(fixture.input, {
      taskScenarioToken: fixture.taskScenarioToken
    });
    assert.deepEqual(actual, fixture.expected, fixture.id);
    if (actual) {
      assert.deepEqual(contracts.normalizeLearningCandidateSeed(actual), actual, fixture.id);
      assert.deepEqual(contracts.findPrivacyViolations(actual), [], fixture.id);
      assert.equal(JSON.stringify(actual).includes(fixture.input), false, fixture.id);
    }
  }
  const canonical = learningCandidateSeedFixtures.cases.find((fixture) => fixture.expected)?.expected;
  assert.equal(contracts.normalizeLearningCandidateSeed({
    ...canonical,
    payload: { ...canonical.payload, statement: "tampered" }
  }), null);
  assert.deepEqual(contracts.normalizeLearningCandidateSeed({
    payload: { statement: canonical.payload.statement, category: canonical.payload.category },
    patternToken: canonical.patternToken,
    artifactType: canonical.artifactType,
    schemaVersion: canonical.schemaVersion
  }), canonical);
  const sensitiveInput = [
    "Do not permanently delete anything from",
    ["C:", "Users", "example", "private-project"].join("\\"),
    "or persist",
    ["sk", "session", "secret", "1234567890"].join("-")
  ].join(" ");
  const safeSeed = contracts.deriveLearningCandidateSeed(sensitiveInput, {
    taskScenarioToken: "release_ops"
  });
  assert.equal(safeSeed.patternToken, "rule_recoverable_removal_only");
  assert.deepEqual(contracts.findPrivacyViolations(safeSeed), []);
  assert.equal(JSON.stringify(safeSeed).includes("private-project"), false);
});

test("infers task scenarios from canonical cross-runtime fixtures", () => {
  assert.equal(taskScenarioInferenceFixtures.schemaVersion, "task-scenario-inference-fixtures@1");
  for (const fixture of taskScenarioInferenceFixtures.cases) {
    assert.equal(inferTaskScenario(fixture.input, {}), fixture.expected, fixture.id);
  }
});

test("encrypted local embeddings remain optional and require explicit residual-risk controls", () => {
  const embedding = {
    kind: "encrypted_local_embedding",
    projectScoped: true,
    algorithm: "local_embedding_aes_256_gcm",
    valueToken: "encrypted_embedding_blob_test",
    encryptedAtRest: true,
    exportable: false,
    absoluteIrreversibilityClaimed: false,
    inversionRiskTested: true,
    membershipInferenceRiskTested: true,
    residualRisk: "accepted"
  };
  assert.equal(contracts.validateSemanticFingerprint(embedding).valid, true);
  assert.equal(
    contracts.validateSemanticFingerprint({ ...embedding, absoluteIrreversibilityClaimed: true }).valid,
    false
  );
  assert.equal(
    contracts.validateSemanticFingerprint({ ...embedding, membershipInferenceRiskTested: false }).valid,
    false
  );
});

test("type-specific validators are wired to the generic contract registry", () => {
  const functionNames = {
    prompt_session_event: "validatePromptSessionEvent",
    codex_target_adapter_result: "validateCodexTargetAdapterResult",
    pending_outcome: "validatePendingOutcome",
    learning_observation: "validateLearningObservation",
    learning_artifact: "validateLearningArtifact",
    generation_policy: "validateGenerationPolicy",
    policy_rollout: "validatePolicyRollout",
    benchmark_result: "validateBenchmarkResult",
    runtime_evidence: "validateRuntimeEvidence",
    context_source: "validateContextSource"
  };
  for (const fixture of fixtures.valid) {
    const functionName = functionNames[fixture.contract];
    assert.equal(typeof contracts[functionName], "function", functionName);
    assert.deepEqual(contracts[functionName](fixture.value), contracts.validateContract(fixture.contract, fixture.value));
  }
});

test("fixtures are portable JSON and contain no raw path, title, prompt, or credential values", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(fixtures)), fixtures);
  assert.equal(/(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/)/.test(fixtureText), false);
  assert.equal(/(?:Bearer\s+\S{12,}|-----BEGIN .*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,})/.test(fixtureText), false);
  for (const fixture of fixtures.valid) {
    assert.deepEqual(contracts.findPrivacyViolations(fixture.value), [], fixture.id);
  }
});
