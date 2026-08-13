const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const contracts = require("../../../packages/outcome-learning");
const {
  STORE_SCHEMA_VERSION,
  createLearningArtifactStore
} = require("../src/modules/learning");

function createHarness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-learning-v1-"));
  let nowMs = Date.parse("2026-07-19T04:00:00.000Z");
  let randomCall = 0;
  const store = createLearningArtifactStore(dataDir, {
    now: () => new Date(nowMs).toISOString(),
    randomBytes(size) {
      randomCall += 1;
      return Buffer.alloc(size, randomCall % 251 || 1);
    }
  });
  return {
    dataDir,
    store,
    advance(ms = 1000) {
      nowMs += ms;
    }
  };
}

function memoryPayload(statement = "Reuse the verified package contract before integration.") {
  return { category: "verified_environment", statement };
}

function rulePayload(directive = "Keep machine readback required before counting an insert.") {
  return { directive, taskScenarioTokens: ["verified_insert"] };
}

function skillPayload(overrides = {}) {
  return {
    triggerConditionTokens: ["package_contract_change"],
    stepTokens: ["inspect_contract", "run_fixture_tests"],
    verificationTokens: ["fixtures_pass"],
    resourceTokens: ["node_test_runner"],
    permissionTokens: ["workspace_read", "package_write"],
    failureRecoveryTokens: ["stop_without_integration"],
    scriptsExecutable: false,
    permissionCheckPassed: false,
    isolationTestPassed: false,
    adversarialReviewPassed: false,
    ...overrides
  };
}

function policyPayload(id = "policy_compact_context") {
  return { policyId: id, policyVersion: 1 };
}

function observationInput({
  project = "project_alpha",
  session = "session_1",
  outcome = "outcome_1",
  features = ["scenario:bug_fix", "mode:standard"],
  artifactType,
  payload,
  outcomeStatus = "succeeded",
  failureReasonTokens = [],
  explicitNegativeFeedback = false,
  tokenAccountingSource = "unavailable",
  tokenUsage = {}
} = {}) {
  return {
    projectScopeToken: project,
    sessionId: session,
    outcomeId: outcome,
    featureTokens: features,
    taskScenarioToken: "bug_fix",
    modeToken: "standard",
    strategyId: "baseline",
    strategyVersion: "v1",
    modelFamilyToken: "codex_test",
    contextSourceTokens: [],
    insertVerified: outcomeStatus === "succeeded",
    outcomeStatus,
    failureReasonTokens,
    explicitNegativeFeedback,
    tokenAccountingSource,
    ...tokenUsage,
    candidate: artifactType ? { artifactType, payload } : undefined
  };
}

function createCandidate(store, {
  project,
  feature,
  artifactType,
  payload,
  gates
}) {
  let result = null;
  const sessions = ["session_a", "session_a", "session_b"];
  for (let index = 0; index < 3; index += 1) {
    result = store.recordObservation(observationInput({
      project,
      session: `${sessions[index]}_${feature}`,
      outcome: `outcome_${feature}_${index + 1}`,
      features: [`pattern:${feature}`, "source:derived_features"],
      artifactType,
      payload
    }), gates ? { skillGates: gates } : undefined);
  }
  assert.ok(result.candidate, `${artifactType} candidate should be created at the threshold`);
  return result.candidate;
}

function promotionEvidence({
  promotionKeyToken,
  project,
  outcome,
  artifactType = "memory",
  payload = memoryPayload(),
  succeeded = true,
  explicitNegativeFeedback = false,
  skillGates
}) {
  return {
    promotionKeyToken,
    projectScopeToken: project,
    sessionId: `session_${project}_${outcome}`,
    outcomeId: outcome,
    artifactType,
    payload,
    succeeded,
    explicitNegativeFeedback,
    skillGates
  };
}

function allTextFiles(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...allTextFiles(target));
    else output.push(fs.readFileSync(target, "utf8"));
  }
  return output.join("\n");
}

const harness = createHarness();
const { store, dataDir } = harness;

assert.equal(STORE_SCHEMA_VERSION, "learning-artifacts-store@1");
assert.throws(
  () => store.recordObservation({
    ...observationInput({ outcome: "privacy_rejected" }),
    rawInput: "RAW_INPUT_MUST_NEVER_PERSIST",
    generatedPrompt: "GENERATED_PROMPT_MUST_NEVER_PERSIST",
    chatContent: "CHAT_CONTENT_MUST_NEVER_PERSIST",
    clipboardContent: "CLIPBOARD_CONTENT_MUST_NEVER_PERSIST",
    windowTitle: "WINDOW_TITLE_MUST_NEVER_PERSIST",
    absoluteProjectPath: "C:\\private\\project"
  }),
  (error) => error.code === "privacy_input_rejected"
);

const firstObservation = store.recordObservation(observationInput({
  outcome: "fingerprint_outcome_1",
  features: ["mode:standard", "scenario:bug_fix"],
  tokenAccountingSource: "provider",
  tokenUsage: {
    inputTokens: 120,
    outputTokens: 40,
    cachedTokens: 12,
    reasoningTokens: 20,
    insertedPromptTokenEstimate: 80
  }
})).observation;
const reorderedObservation = store.recordObservation(observationInput({
  session: "session_2",
  outcome: "fingerprint_outcome_2",
  features: ["scenario:bug_fix", "mode:standard"]
})).observation;
const otherProjectObservation = store.recordObservation(observationInput({
  project: "project_beta",
  outcome: "fingerprint_outcome_beta",
  features: ["scenario:bug_fix", "mode:standard"]
})).observation;

assert.equal(contracts.validateLearningObservation(firstObservation).valid, true);
assert.equal(firstObservation.createdAt, "2026-07-19T04:00:00.000Z");
assert.equal(firstObservation.tokenAccountingSource, "provider");
assert.equal(firstObservation.semanticFingerprint.kind, "keyed_feature_hash");
assert.equal(firstObservation.semanticFingerprint.algorithm, "hmac_sha256");
assert.equal(firstObservation.semanticFingerprint.exportable, false);
assert.equal(firstObservation.semanticFingerprint.valueToken.length, 64);
assert.equal(
  firstObservation.semanticFingerprint.valueToken,
  reorderedObservation.semanticFingerprint.valueToken,
  "feature token order must not change the project keyed hash"
);
assert.notEqual(
  firstObservation.semanticFingerprint.valueToken,
  otherProjectObservation.semanticFingerprint.valueToken,
  "different projects must use different HMAC keys"
);

const alphaKeyFile = store.projectKeyFile("project_alpha");
const betaKeyFile = store.projectKeyFile("project_beta");
assert.ok(fs.existsSync(alphaKeyFile));
assert.ok(fs.existsSync(betaKeyFile));
assert.notEqual(alphaKeyFile, betaKeyFile);
const alphaKeyMaterial = fs.readFileSync(alphaKeyFile, "utf8").trim();
assert.equal(Buffer.from(alphaKeyMaterial, "base64").length, 32);
const initialStateText = fs.readFileSync(store.stateFile, "utf8");
assert.equal(JSON.parse(initialStateText).schemaVersion, STORE_SCHEMA_VERSION);
assert.equal(initialStateText.includes(alphaKeyMaterial), false);
assert.equal(initialStateText.includes("scenario:bug_fix"), false);
assert.equal(initialStateText.includes("mode:standard"), false);

const unavailableObservation = store.recordObservation(observationInput({
  outcome: "tokens_unavailable",
  tokenAccountingSource: "unavailable"
})).observation;
assert.equal(unavailableObservation.inputTokens, null);
assert.equal(unavailableObservation.outputTokens, null);
assert.throws(
  () => store.recordObservation(observationInput({
    outcome: "invalid_unavailable_tokens",
    tokenAccountingSource: "unavailable",
    tokenUsage: { inputTokens: 1 }
  })),
  (error) => error.name === "ContractValidationError"
);
const estimatedObservation = store.recordObservation(observationInput({
  outcome: "tokens_estimated",
  tokenAccountingSource: "estimated",
  tokenUsage: { inputTokens: 90, outputTokens: 30, insertedPromptTokenEstimate: 70 }
})).observation;
assert.equal(estimatedObservation.tokenAccountingSource, "estimated");

const thresholdPayload = memoryPayload("Use contract fixtures to verify the local consumer.");
const thresholdBase = {
  project: "project_threshold",
  features: ["pattern:threshold", "source:derived_features"],
  artifactType: "memory",
  payload: thresholdPayload
};
let thresholdResult = store.recordObservation(observationInput({
  ...thresholdBase,
  session: "threshold_session_a",
  outcome: "threshold_outcome_1"
}));
assert.equal(thresholdResult.candidate, null);
const duplicate = store.recordObservation(observationInput({
  ...thresholdBase,
  session: "threshold_session_a",
  outcome: "threshold_outcome_1"
}));
assert.equal(duplicate.duplicate, true);
thresholdResult = store.recordObservation(observationInput({
  ...thresholdBase,
  session: "threshold_session_a",
  outcome: "threshold_outcome_2"
}));
assert.equal(thresholdResult.candidate, null);
thresholdResult = store.recordObservation(observationInput({
  ...thresholdBase,
  session: "threshold_session_b",
  outcome: "threshold_outcome_3"
}));
assert.ok(thresholdResult.candidate);
assert.equal(thresholdResult.cardReminder, null);
assert.equal(thresholdResult.candidate.status, "pending_review");
assert.equal(thresholdResult.candidate.scope.kind, "project");
assert.equal(thresholdResult.candidate.scope.projectScopeToken, "project_threshold");
assert.equal(thresholdResult.candidate.effective, false);
assert.equal(thresholdResult.candidate.evidenceSummary.sessionCount, 2);
assert.equal(thresholdResult.candidate.evidenceSummary.successfulOutcomeCount, 3);
assert.equal(contracts.validateLearningArtifact(thresholdResult.candidate).valid, true);

const lateNegativeCandidate = createCandidate(store, {
  project: "project_late_negative",
  feature: "late_negative",
  artifactType: "memory",
  payload: memoryPayload("Archive this pending candidate if contrary evidence arrives.")
});
store.recordObservation(observationInput({
  project: "project_late_negative",
  session: "late_negative_session_c",
  outcome: "late_negative_outcome_4",
  features: ["pattern:late_negative", "source:derived_features"],
  artifactType: "memory",
  payload: memoryPayload("Archive this pending candidate if contrary evidence arrives."),
  outcomeStatus: "failed",
  explicitNegativeFeedback: true,
  failureReasonTokens: ["low_quality"]
}));
const archivedLateNegative = store.getCandidateDetail(lateNegativeCandidate.artifactId).artifact;
assert.equal(archivedLateNegative.status, "archived");
assert.equal(archivedLateNegative.effective, false);
assert.equal(archivedLateNegative.evidenceSummary.explicitNegativeFeedbackCount, 1);
assert.equal(contracts.validateLearningArtifact(archivedLateNegative).valid, true);
assert.equal(store.getCardReminder({
  projectScopeToken: "project_late_negative",
  featureTokens: ["source:derived_features", "pattern:late_negative"]
}), null);

const blockedPayload = memoryPayload("This candidate must stay blocked by explicit feedback.");
store.recordObservation(observationInput({
  project: "project_negative",
  session: "negative_session",
  outcome: "negative_outcome",
  features: ["pattern:negative"],
  artifactType: "memory",
  payload: memoryPayload("Contrary derived wording for the same semantic pattern."),
  outcomeStatus: "failed",
  explicitNegativeFeedback: true,
  failureReasonTokens: ["low_quality"]
}));
for (let index = 0; index < 3; index += 1) {
  const result = store.recordObservation(observationInput({
    project: "project_negative",
    session: `negative_success_session_${index % 2}`,
    outcome: `negative_success_${index}`,
    features: ["pattern:negative"],
    artifactType: "memory",
    payload: blockedPayload
  }));
  assert.equal(result.candidate, null);
}

const ruleCandidate = createCandidate(store, {
  project: "project_four_types",
  feature: "rule",
  artifactType: "rule",
  payload: rulePayload()
});
const skillCandidate = createCandidate(store, {
  project: "project_four_types",
  feature: "skill",
  artifactType: "skill",
  payload: skillPayload()
});
const policyCandidate = createCandidate(store, {
  project: "project_four_types",
  feature: "policy",
  artifactType: "generation_policy",
  payload: policyPayload()
});
assert.deepEqual(
  new Set([thresholdResult.candidate.artifactType, ruleCandidate.artifactType, skillCandidate.artifactType, policyCandidate.artifactType]),
  new Set(["memory", "rule", "skill", "generation_policy"])
);
assert.equal(skillCandidate.payload.scriptsExecutable, false);
assert.throws(
  () => store.reviewCandidate(skillCandidate.artifactId, { action: "accept" }),
  (error) => error.code === "skill_gates_required"
);
assert.throws(
  () => store.setSkillGates(skillCandidate.artifactId, {
    permission: true,
    isolation: true,
    static: true,
    adversarial: true,
    bypass: true
  }),
  (error) => error.code === "invalid_skill_gates"
);
assert.throws(
  () => store.setSkillGates(skillCandidate.artifactId, {
    permission: true,
    isolation: true,
    static: "yes",
    adversarial: true
  }),
  (error) => error.code === "invalid_skill_gates"
);
const gatedSkill = store.setSkillGates(skillCandidate.artifactId, {
  permission: true,
  isolation: true,
  static: true,
  adversarial: true
});
assert.deepEqual(gatedSkill.skillGates, {
  permission: true,
  isolation: true,
  static: true,
  adversarial: true
});
assert.equal(gatedSkill.artifact.payload.permissionCheckPassed, true);
assert.equal(gatedSkill.artifact.payload.isolationTestPassed, true);
assert.equal(gatedSkill.artifact.payload.adversarialReviewPassed, true);
assert.equal(gatedSkill.artifact.payload.scriptsExecutable, false);
const acceptedSkill = store.reviewCandidate(skillCandidate.artifactId, { action: "accept" });
assert.equal(acceptedSkill.status, "active");
assert.equal(acceptedSkill.effective, true);
assert.equal(acceptedSkill.payload.scriptsExecutable, false);
assert.equal(contracts.validateLearningArtifact(acceptedSkill).valid, true);

const reviewCandidate = createCandidate(store, {
  project: "project_review",
  feature: "review",
  artifactType: "memory",
  payload: memoryPayload("Initial reviewed statement.")
});
let reviewed = store.reviewCandidate(reviewCandidate.artifactId, {
  action: "edit",
  payload: memoryPayload("Edited reviewed statement.")
});
assert.equal(reviewed.status, "pending_review");
assert.equal(reviewed.payload.statement, "Edited reviewed statement.");
reviewed = store.reviewCandidate(reviewCandidate.artifactId, {
  action: "reclassify",
  artifactType: "rule",
  payload: rulePayload("Use the edited result as a scoped rule.")
});
assert.equal(reviewed.artifactType, "rule");
reviewed = store.reviewCandidate(reviewCandidate.artifactId, {
  action: "narrow_scope",
  scopeTokens: ["directory:local_service", "scenario:bug_fix"]
});
assert.equal(reviewed.scope.kind, "project");
assert.deepEqual(
  store.getCandidateDetail(reviewCandidate.artifactId).narrowScopeTokens,
  ["directory:local_service", "scenario:bug_fix"]
);
reviewed = store.reviewCandidate(reviewCandidate.artifactId, { action: "accept" });
assert.equal(reviewed.status, "active");
assert.equal(reviewed.review.decision, "accepted");
assert.equal(reviewed.effective, true);

const rejectedCandidate = createCandidate(store, {
  project: "project_review",
  feature: "reject",
  artifactType: "memory",
  payload: memoryPayload("Reject this derived statement.")
});
const rejected = store.reviewCandidate(rejectedCandidate.artifactId, { action: "reject" });
assert.equal(rejected.status, "rejected");
assert.equal(rejected.review.decision, "rejected");
assert.equal(rejected.effective, false);

const ignoredCandidate = createCandidate(store, {
  project: "project_ignore",
  feature: "ignore",
  artifactType: "memory",
  payload: memoryPayload("Keep this candidate after reminders stop.")
});
const reminderRequest = {
  projectScopeToken: "project_ignore",
  featureTokens: ["source:derived_features", "pattern:ignore"]
};
assert.equal(store.getCardReminder(reminderRequest).artifactId, ignoredCandidate.artifactId);
store.ignoreCandidate(ignoredCandidate.artifactId);
store.ignoreCandidate(ignoredCandidate.artifactId);
store.ignoreCandidate(ignoredCandidate.artifactId);
assert.equal(store.getCardReminder(reminderRequest), null);
assert.equal(store.getCandidateDetail(ignoredCandidate.artifactId).artifact.review.ignoredCount, 3);
assert.ok(store.listArtifacts({ status: "pending_review" }).some((item) => item.artifactId === ignoredCandidate.artifactId));

let memoryProposal = null;
const memoryPromotionInputs = [
  ["promotion_project_a", "promotion_memory_1"],
  ["promotion_project_a", "promotion_memory_2"],
  ["promotion_project_b", "promotion_memory_3"],
  ["promotion_project_b", "promotion_memory_4"],
  ["promotion_project_c", "promotion_memory_5"]
];
for (let index = 0; index < memoryPromotionInputs.length; index += 1) {
  const item = memoryPromotionInputs[index];
  const result = store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:shared_memory",
    project: item[0],
    outcome: item[1]
  }));
  if (index < memoryPromotionInputs.length - 1) assert.equal(result.proposal, null);
  memoryProposal = result.proposal || memoryProposal;
}
assert.ok(memoryProposal);
assert.equal(memoryProposal.status, "pending_final_confirmation");
assert.equal(memoryProposal.finalConfirmationRequired, true);
assert.equal(memoryProposal.artifact.scope.kind, "global_proposal");
assert.equal(memoryProposal.artifact.effective, false);
assert.equal(memoryProposal.projectScopeTokens.length, 3);
assert.equal(memoryProposal.successfulOutcomeCount, 5);
assert.equal(contracts.validateLearningArtifact(memoryProposal.artifact).valid, true);
assert.throws(
  () => store.confirmGlobalProposal(memoryProposal.proposalId, { confirmed: false }),
  (error) => error.code === "final_confirmation_required"
);
const globalMemory = store.confirmGlobalProposal(memoryProposal.proposalId, { confirmed: true });
assert.equal(globalMemory.scope.kind, "global");
assert.equal(globalMemory.scope.projectScopeToken, null);
assert.equal(globalMemory.status, "active");
assert.equal(globalMemory.effective, true);
assert.equal(contracts.validateLearningArtifact(globalMemory).valid, true);
assert.ok(store.listArtifacts().some((item) => item.artifactId === globalMemory.artifactId));

for (let index = 0; index < 6; index += 1) {
  const result = store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:two_projects_only",
    project: index % 2 === 0 ? "two_project_a" : "two_project_b",
    outcome: `two_project_outcome_${index}`
  }));
  assert.equal(result.proposal, null);
}

let ruleProposal = null;
for (const [project, outcome] of [
  ["rule_project_a", "rule_global_1"],
  ["rule_project_a", "rule_global_2"],
  ["rule_project_b", "rule_global_3"],
  ["rule_project_c", "rule_global_4"],
  ["rule_project_c", "rule_global_5"]
]) {
  ruleProposal = store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:shared_rule",
    project,
    outcome,
    artifactType: "rule",
    payload: rulePayload()
  })).proposal || ruleProposal;
}
assert.ok(ruleProposal);

for (const [project, outcome] of [
  ["skill_bad_a", "skill_bad_1"],
  ["skill_bad_b", "skill_bad_2"],
  ["skill_bad_c", "skill_bad_3"]
]) {
  const result = store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:skill_missing_static_gate",
    project,
    outcome,
    artifactType: "skill",
    payload: skillPayload(),
    skillGates: { permission: true, isolation: true, static: project !== "skill_bad_b", adversarial: true }
  }));
  assert.equal(result.proposal, null);
}

let skillProposal = null;
for (const [project, outcome] of [
  ["skill_project_a", "skill_global_1"],
  ["skill_project_b", "skill_global_2"],
  ["skill_project_c", "skill_global_3"]
]) {
  skillProposal = store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:shared_skill",
    project,
    outcome,
    artifactType: "skill",
    payload: skillPayload(),
    skillGates: { permission: true, isolation: true, static: true, adversarial: true }
  })).proposal || skillProposal;
}
assert.ok(skillProposal);
assert.equal(skillProposal.successfulOutcomeCount, 3);
assert.deepEqual(skillProposal.skillGates, {
  permission: true,
  isolation: true,
  static: true,
  adversarial: true
});
assert.equal(skillProposal.artifact.payload.scriptsExecutable, false);
assert.equal(skillProposal.artifact.effective, false);
const globalSkill = store.confirmGlobalProposal(skillProposal.proposalId, { confirmed: true });
assert.equal(globalSkill.scope.kind, "global");
assert.equal(globalSkill.effective, true);
assert.equal(globalSkill.payload.scriptsExecutable, false);

for (const [project, outcome, negative] of [
  ["negative_promotion_a", "negative_promotion_1", true],
  ["negative_promotion_a", "negative_promotion_2", false],
  ["negative_promotion_b", "negative_promotion_3", false],
  ["negative_promotion_b", "negative_promotion_4", false],
  ["negative_promotion_c", "negative_promotion_5", false],
  ["negative_promotion_c", "negative_promotion_6", false]
]) {
  const result = store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:blocked_by_negative",
    project,
    outcome,
    succeeded: !negative,
    explicitNegativeFeedback: negative
  }));
  assert.equal(result.proposal, null);
}
assert.throws(
  () => store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:policy_not_supported",
    project: "policy_project",
    outcome: "policy_promotion_1",
    artifactType: "generation_policy",
    payload: policyPayload("policy_not_global")
  })),
  (error) => error.code === "global_promotion_not_supported"
);

const clearCandidate = createCandidate(store, {
  project: "project_clear",
  feature: "clear",
  artifactType: "memory",
  payload: memoryPayload("Archive this project candidate when project learning is cleared.")
});
const clearObservation = store.listObservations({ projectScopeToken: "project_clear" })[0];
const oldClearDigest = clearObservation.semanticFingerprint.valueToken;
assert.ok(fs.existsSync(store.projectKeyFile("project_clear")));

let clearProposal = null;
for (const [project, outcome] of [
  ["project_clear", "clear_promotion_1"],
  ["project_clear", "clear_promotion_2"],
  ["clear_project_b", "clear_promotion_3"],
  ["clear_project_b", "clear_promotion_4"],
  ["clear_project_c", "clear_promotion_5"]
]) {
  clearProposal = store.recordPromotionEvidence(promotionEvidence({
    promotionKeyToken: "promotion:clear_cascade",
    project,
    outcome,
    payload: memoryPayload("Invalidate this proposal when one project is cleared.")
  })).proposal || clearProposal;
}
assert.ok(clearProposal);

const clearResult = store.clearProjectData("project_clear");
assert.equal(clearResult.projectScopeToken, "project_clear");
assert.ok(fs.existsSync(clearResult.archiveDir));
assert.ok(fs.existsSync(path.join(clearResult.archiveDir, "learning-data.json")));
assert.ok(fs.existsSync(path.join(clearResult.archiveDir, "project-hmac.key")));
assert.equal(fs.existsSync(store.projectKeyFile("project_clear")), false);
assert.equal(store.listObservations({ projectScopeToken: "project_clear" }).length, 0);
assert.equal(store.listArtifacts().some((item) => item.artifactId === clearCandidate.artifactId), false);
const invalidatedProposal = store.listGlobalProposals().find((item) => item.proposalId === clearProposal.proposalId);
assert.equal(invalidatedProposal.status, "invalidated");
assert.equal(invalidatedProposal.artifact.effective, false);
assert.equal(invalidatedProposal.artifact.status, "archived");
const archive = JSON.parse(fs.readFileSync(path.join(clearResult.archiveDir, "learning-data.json"), "utf8"));
assert.ok(archive.observations.length >= 3);
assert.ok(archive.observations.every((entry) => entry.invalidated === true));
assert.ok(archive.observations.every((entry) => entry.observation.taskOutcomeToken === "invalidated"));
assert.ok(archive.observations.every((entry) => contracts.validateLearningObservation(entry.observation).valid === true));
assert.ok(archive.artifacts.every((entry) => entry.invalidated === true && entry.artifact.status === "archived"));
assert.ok(archive.promotionEvidence.every((entry) => entry.invalidated === true));
assert.ok(store.getInvalidations().some((entry) => entry.projectScopeToken === "project_clear"));

const afterClear = store.recordObservation(observationInput({
  project: "project_clear",
  session: "session_after_clear",
  outcome: "outcome_after_clear",
  features: ["source:derived_features", "pattern:clear"]
})).observation;
assert.notEqual(afterClear.semanticFingerprint.valueToken, oldClearDigest);
assert.ok(fs.existsSync(store.projectKeyFile("project_clear")));
assert.ok(fs.existsSync(clearResult.archiveDir), "recoverable archive must be retained by the test");

const persistedText = allTextFiles(dataDir);
for (const forbidden of [
  "RAW_INPUT_MUST_NEVER_PERSIST",
  "GENERATED_PROMPT_MUST_NEVER_PERSIST",
  "CHAT_CONTENT_MUST_NEVER_PERSIST",
  "CLIPBOARD_CONTENT_MUST_NEVER_PERSIST",
  "WINDOW_TITLE_MUST_NEVER_PERSIST",
  "C:\\private\\project",
  dataDir
]) {
  assert.equal(persistedText.includes(forbidden), false, `persisted learning data leaked ${forbidden}`);
}

for (const observation of store.listObservations()) {
  assert.equal(contracts.validateLearningObservation(observation).valid, true);
}
for (const artifact of store.listArtifacts()) {
  assert.equal(contracts.validateLearningArtifact(artifact).valid, true);
}

console.log(`learning artifacts v1 tests passed; retained temp directory: ${dataDir}`);
