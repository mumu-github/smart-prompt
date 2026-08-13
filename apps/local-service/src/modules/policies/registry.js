"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createPolicyRollout } = require("./rollout");
const {
  DEFAULT_CANARY_SHARE_BPS,
  REGISTRY_SCHEMA_VERSION,
  clampInteger,
  clone,
  clockTimestamp,
  deepFreeze,
  isPlainObject,
  policyError,
  policyIdentity,
  safeRollbackReason,
  safeToken,
  sameScope,
  validateBenchmark,
  validatePolicy,
  validateRollout
} = require("./shared");

const REGISTRY_FILE_NAME = "generation-policy-registry-v1.json";
const STATE_FIELDS = new Set([
  "schemaVersion",
  "learningPaused",
  "pauseReasonToken",
  "policies",
  "rollouts",
  "transitions",
  "updatedAt"
]);
const TRANSITION_FIELDS = new Set([
  "policyId",
  "policyVersion",
  "fromStatus",
  "toStatus",
  "reasonToken",
  "changedAt"
]);
const STATUS_TRANSITIONS = Object.freeze({
  draft: new Set(["benchmarked", "rolled_back"]),
  benchmarked: new Set(["canary", "rolled_back"]),
  canary: new Set(["stable", "rolled_back"]),
  stable: new Set(["rolled_back"]),
  rolled_back: new Set()
});

function exactFields(value, fields) {
  return isPlainObject(value) && Object.keys(value).every((key) => fields.has(key));
}

function validateTransition(value) {
  if (!exactFields(value, TRANSITION_FIELDS)) return false;
  return Boolean(
    safeToken(value.policyId)
      && Number.isInteger(value.policyVersion)
      && value.policyVersion >= 1
      && safeToken(value.fromStatus)
      && safeToken(value.toStatus)
      && safeToken(value.reasonToken)
      && Number.isFinite(Date.parse(value.changedAt))
      && new Date(value.changedAt).toISOString() === value.changedAt
  );
}

function createGenerationPolicyRegistry(dataDir, options = {}) {
  const root = path.resolve(String(dataDir || ""));
  if (!dataDir || root === path.parse(root).root) {
    throw policyError("invalid_policy_registry_directory", "A non-root registry data directory is required.");
  }
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, REGISTRY_FILE_NAME);
  const clock = typeof options.now === "function" ? options.now : undefined;
  const allowHarnessOnlyBenchmarks = options.allowHarnessOnlyBenchmarks === true;

  function nowIso() {
    return clockTimestamp(clock);
  }

  function defaultState(timestamp = nowIso()) {
    return {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      learningPaused: false,
      pauseReasonToken: "none",
      policies: [],
      rollouts: [],
      transitions: [],
      updatedAt: timestamp
    };
  }

  function validateState(raw) {
    if (!exactFields(raw, STATE_FIELDS)
      || raw.schemaVersion !== REGISTRY_SCHEMA_VERSION
      || typeof raw.learningPaused !== "boolean"
      || !safeToken(raw.pauseReasonToken)
      || !Array.isArray(raw.policies)
      || !Array.isArray(raw.rollouts)
      || !Array.isArray(raw.transitions)
      || !Number.isFinite(Date.parse(raw.updatedAt))) {
      throw policyError("policy_registry_corrupt", "The Generation Policy registry is malformed.");
    }
    let canonicalUpdatedAt;
    try {
      canonicalUpdatedAt = new Date(raw.updatedAt).toISOString();
    } catch {
      throw policyError("policy_registry_corrupt", "The Generation Policy registry timestamp is invalid.");
    }
    if (canonicalUpdatedAt !== raw.updatedAt || !raw.transitions.every(validateTransition)) {
      throw policyError("policy_registry_corrupt", "The Generation Policy registry history is malformed.");
    }
    const policies = raw.policies.map(validatePolicy);
    const identities = new Set();
    for (const policy of policies) {
      const identity = policyIdentity(policy);
      if (identities.has(identity)) {
        throw policyError("policy_registry_corrupt", "The Generation Policy registry contains duplicate versions.");
      }
      identities.add(identity);
    }
    const rollouts = raw.rollouts.map(validateRollout);
    const rolloutIds = new Set();
    for (const rollout of rollouts) {
      if (rolloutIds.has(rollout.rolloutId)) {
        throw policyError("policy_registry_corrupt", "The Generation Policy registry contains duplicate rollouts.");
      }
      rolloutIds.add(rollout.rolloutId);
    }
    return {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      learningPaused: raw.learningPaused,
      pauseReasonToken: raw.pauseReasonToken,
      policies: policies.map(clone),
      rollouts: rollouts.map(clone),
      transitions: raw.transitions.map(clone),
      updatedAt: raw.updatedAt
    };
  }

  function readState() {
    try {
      return validateState(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        const state = defaultState();
        writeState(state, false);
        return state;
      }
      if (error?.code === "policy_registry_corrupt") throw error;
      throw policyError("policy_registry_corrupt", "The Generation Policy registry could not be parsed.");
    }
  }

  function writeState(next, touch = true) {
    const candidate = {
      ...next,
      updatedAt: touch ? nowIso() : next.updatedAt
    };
    const valid = validateState(candidate);
    fs.writeFileSync(file, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
    return valid;
  }

  function findPolicyIndex(state, policyId, version) {
    const id = safeToken(policyId);
    const number = Number(version);
    return state.policies.findIndex((policy) => policy.policyId === id && policy.version === number);
  }

  function getPolicy(policyId, version) {
    const state = readState();
    const index = findPolicyIndex(state, policyId, version);
    return index >= 0 ? deepFreeze(clone(state.policies[index])) : null;
  }

  function recordTransition(state, policy, fromStatus, toStatus, reasonToken, changedAt) {
    state.transitions.push({
      policyId: policy.policyId,
      policyVersion: policy.version,
      fromStatus,
      toStatus,
      reasonToken: safeToken(reasonToken, "manual", 100),
      changedAt
    });
  }

  function transitionInState(state, policyId, version, toStatus, reasonToken) {
    const index = findPolicyIndex(state, policyId, version);
    if (index < 0) throw policyError("generation_policy_not_found", "The requested policy version is not registered.");
    const current = state.policies[index];
    if (current.status === toStatus) return current;
    if (!STATUS_TRANSITIONS[current.status]?.has(toStatus)) {
      throw policyError(
        "invalid_policy_status_transition",
        `Generation Policy cannot transition from ${current.status} to ${toStatus}.`
      );
    }
    const next = validatePolicy({ ...current, status: toStatus });
    state.policies[index] = clone(next);
    recordTransition(state, next, current.status, toStatus, reasonToken, nowIso());
    return next;
  }

  function registerPolicy(input) {
    const policy = validatePolicy(input);
    const state = readState();
    const index = findPolicyIndex(state, policy.policyId, policy.version);
    if (index >= 0) {
      if (JSON.stringify(state.policies[index]) !== JSON.stringify(policy)) {
        throw policyError("generation_policy_version_conflict", "The policy id and version already contain different data.");
      }
      return deepFreeze(clone(state.policies[index]));
    }
    state.policies.push(clone(policy));
    recordTransition(state, policy, "unregistered", policy.status, "registered", nowIso());
    writeState(state);
    return deepFreeze(clone(policy));
  }

  function markBenchmarked(policyId, version, benchmarkResult) {
    const benchmark = validateBenchmark(benchmarkResult);
    if (benchmark.status !== "passed") {
      throw policyError("policy_benchmark_not_passed", "A passing isolated benchmark is required.");
    }
    const productionEvidence = benchmark.executor === "codex"
      && benchmark.initiatedBy === "user"
      && benchmark.authorization.required === true
      && benchmark.authorization.granted === true
      && benchmark.budget.exhausted === false
      && Object.values(benchmark.comparability).every((value) => value === true);
    if (!productionEvidence && !allowHarnessOnlyBenchmarks) {
      throw policyError(
        "policy_benchmark_production_evidence_required",
        "Harness-only or unauthorized benchmark evidence cannot promote a production policy."
      );
    }
    const state = readState();
    const index = findPolicyIndex(state, policyId, version);
    if (index < 0) throw policyError("generation_policy_not_found", "The requested policy version is not registered.");
    const policy = state.policies[index];
    if (benchmark.modelFamilyToken !== policy.scope.modelFamilyToken) {
      throw policyError("policy_benchmark_model_mismatch", "Benchmark and policy model families must match.");
    }
    const next = transitionInState(state, policyId, version, "benchmarked", "benchmark_passed");
    const hasPlan = state.rollouts.some((rollout) => rollout.policyId === next.policyId
      && rollout.policyVersion === next.version
      && ["planned", "canary", "collecting", "paused"].includes(rollout.status));
    const baseline = state.policies.find((item) => item.policyId === next.policyId
      && item.version === next.baselineVersion
      && item.status === "stable"
      && sameScope(item.scope, next.scope));
    if (!hasPlan && baseline && next.riskLevel === "low"
        && next.automaticRolloutEligible === true && next.scope.kind === "project") {
      const verifiedPlan = createPolicyRollout({
        candidatePolicy: next,
        baselinePolicy: baseline,
        benchmarkResult: benchmark,
        canaryShareBps: DEFAULT_CANARY_SHARE_BPS
      }, { now: clock });
      upsertRolloutInState(state, validateRollout({ ...verifiedPlan, status: "planned" }));
    }
    writeState(state);
    return deepFreeze(clone(next));
  }

  function upsertRolloutInState(state, input) {
    const rollout = validateRollout(input);
    const index = state.rollouts.findIndex((item) => item.rolloutId === rollout.rolloutId);
    if (index >= 0) state.rollouts[index] = clone(rollout);
    else state.rollouts.push(clone(rollout));
    return rollout;
  }

  function recordRollout(input) {
    const state = readState();
    const rollout = upsertRolloutInState(state, input);
    writeState(state);
    return deepFreeze(clone(rollout));
  }

  function startCanary(policyId, version, rolloutInput) {
    const rollout = validateRollout(rolloutInput);
    const state = readState();
    const index = findPolicyIndex(state, policyId, version);
    if (index < 0) throw policyError("generation_policy_not_found", "The requested policy version is not registered.");
    const policy = state.policies[index];
    if (policy.status !== "benchmarked") {
      throw policyError("policy_not_benchmarked", "Only a benchmarked policy can enter canary rollout.");
    }
    if (rollout.policyId !== policy.policyId
      || rollout.policyVersion !== policy.version
      || rollout.baselineVersion !== policy.baselineVersion
      || rollout.projectScopeToken !== policy.scope.projectScopeToken
      || rollout.gates.benchmarkPassed !== true
      || !["canary", "collecting"].includes(rollout.status)) {
      throw policyError("policy_rollout_mismatch", "The rollout does not match the benchmarked candidate.");
    }
    const baseline = state.policies.find((item) => item.policyId === policy.policyId
      && item.version === rollout.baselineVersion
      && item.status === "stable"
      && sameScope(item.scope, policy.scope));
    if (!baseline) {
      throw policyError("stable_policy_baseline_missing", "A matching stable baseline is required.");
    }
    const conflictingCanary = state.policies.find((item) => item.status === "canary"
      && sameScope(item.scope, policy.scope)
      && policyIdentity(item) !== policyIdentity(policy));
    if (conflictingCanary) {
      throw policyError("active_policy_canary_conflict", "Only one canary policy may be active for an exact scope.");
    }
    upsertRolloutInState(state, rollout);
    const next = transitionInState(state, policyId, version, "canary", "canary_started");
    writeState(state);
    return deepFreeze(clone(next));
  }

  function startCanaryFromBenchmark(policyId, version, input = {}) {
    const state = readState();
    const index = findPolicyIndex(state, policyId, version);
    if (index < 0) throw policyError("generation_policy_not_found", "The requested policy version is not registered.");
    const policy = state.policies[index];
    if (policy.status !== "benchmarked") {
      throw policyError("policy_not_benchmarked", "Only a benchmarked policy can enter canary rollout.");
    }
    const plan = state.rollouts
      .filter((rollout) => rollout.policyId === policy.policyId
        && rollout.policyVersion === policy.version
        && rollout.status === "planned"
        && rollout.gates.benchmarkPassed === true)
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0]
      || null;
    if (!plan) {
      throw policyError(
        "verified_policy_rollout_plan_missing",
        "A server-recorded benchmark rollout plan is required before canary starts."
      );
    }
    const rollout = validateRollout({
      ...plan,
      status: "canary",
      canaryShareBps: clampInteger(input.canaryShareBps, 1, 10000, plan.canaryShareBps),
      startedAt: nowIso(),
      endedAt: null
    });
    const baseline = state.policies.find((item) => item.policyId === policy.policyId
      && item.version === rollout.baselineVersion
      && item.status === "stable"
      && sameScope(item.scope, policy.scope));
    if (!baseline) {
      throw policyError("stable_policy_baseline_missing", "A matching stable baseline is required.");
    }
    const conflictingCanary = state.policies.find((item) => item.status === "canary"
      && sameScope(item.scope, policy.scope)
      && policyIdentity(item) !== policyIdentity(policy));
    if (conflictingCanary) {
      throw policyError("active_policy_canary_conflict", "Only one canary policy may be active for an exact scope.");
    }
    upsertRolloutInState(state, rollout);
    const next = transitionInState(state, policyId, version, "canary", "canary_started");
    writeState(state);
    return deepFreeze(clone(next));
  }

  function applyRolloutEvaluation(evaluation) {
    if (!isPlainObject(evaluation) || !isPlainObject(evaluation.rollout)) {
      throw policyError("invalid_rollout_evaluation", "A pure rollout evaluation result is required.");
    }
    const rollout = validateRollout(evaluation.rollout);
    const state = readState();
    const index = findPolicyIndex(state, rollout.policyId, rollout.policyVersion);
    if (index < 0) throw policyError("generation_policy_not_found", "The rollout policy is not registered.");
    const policy = state.policies[index];
    upsertRolloutInState(state, rollout);
    let next = policy;
    if (evaluation.action === "promote" && rollout.status === "promoted") {
      next = transitionInState(state, policy.policyId, policy.version, "stable", "rollout_promoted");
    } else if (evaluation.action === "rollback" && rollout.status === "rolled_back") {
      next = transitionInState(
        state,
        policy.policyId,
        policy.version,
        "rolled_back",
        rollout.rollbackReasonToken
      );
    } else if (evaluation.action === "pause" && rollout.status !== "paused") {
      throw policyError("invalid_rollout_evaluation", "A pause decision must persist a paused rollout.");
    } else if (!["continue_canary", "pause"].includes(evaluation.action)) {
      throw policyError("invalid_rollout_evaluation", "The rollout action and status do not agree.");
    }
    writeState(state);
    return deepFreeze(clone(next));
  }

  function rollbackPolicy(policyId, version, reason = "manual") {
    const rollbackReason = safeRollbackReason(reason, "manual");
    if (rollbackReason === "none") {
      throw policyError("policy_rollback_reason_required", "A finite rollback reason is required.");
    }
    const state = readState();
    const index = findPolicyIndex(state, policyId, version);
    if (index < 0) throw policyError("generation_policy_not_found", "The requested policy version is not registered.");
    const policy = state.policies[index];
    if (policy.status === "rolled_back") return deepFreeze(clone(policy));
    const endedAt = nowIso();
    for (let rolloutIndex = 0; rolloutIndex < state.rollouts.length; rolloutIndex += 1) {
      const rollout = state.rollouts[rolloutIndex];
      if (rollout.policyId !== policy.policyId
        || rollout.policyVersion !== policy.version
        || rollout.status === "rolled_back") continue;
      state.rollouts[rolloutIndex] = clone(validateRollout({
        ...rollout,
        status: "rolled_back",
        rollbackReasonToken: rollbackReason,
        endedAt
      }));
    }
    const next = transitionInState(state, policyId, version, "rolled_back", rollbackReason);
    writeState(state);
    return deepFreeze(clone(next));
  }

  function setLearningPaused(paused, reason = "manual") {
    const state = readState();
    const nextPaused = paused === true;
    const reasonToken = nextPaused ? safeToken(reason, "manual", 100) : "none";
    state.learningPaused = nextPaused;
    state.pauseReasonToken = reasonToken;
    state.rollouts = state.rollouts.map((rollout) => {
      if (nextPaused && ["canary", "collecting"].includes(rollout.status)) {
        return clone(validateRollout({ ...rollout, status: "paused" }));
      }
      if (!nextPaused && rollout.status === "paused") {
        return clone(validateRollout({ ...rollout, status: "collecting" }));
      }
      return rollout;
    });
    writeState(state);
    return deepFreeze({ learningPaused: nextPaused, reasonToken });
  }

  function pauseLearning(reason = "manual") {
    return setLearningPaused(true, reason);
  }

  function resumeLearning() {
    return setLearningPaused(false, "none");
  }

  function isLearningPaused() {
    return readState().learningPaused;
  }

  function listPolicies(filter = {}) {
    const source = isPlainObject(filter) ? filter : {};
    const policies = readState().policies.filter((policy) => {
      if (source.status && policy.status !== source.status) return false;
      if (source.policyId && policy.policyId !== source.policyId) return false;
      if (source.projectScopeToken && policy.scope.projectScopeToken !== source.projectScopeToken) return false;
      if (source.taskScenarioToken && policy.scope.taskScenarioToken !== source.taskScenarioToken) return false;
      if (source.modelFamilyToken && policy.scope.modelFamilyToken !== source.modelFamilyToken) return false;
      if (source.target && policy.scope.target !== source.target) return false;
      return true;
    });
    return deepFreeze(policies.map(clone));
  }

  function listRollouts(filter = {}) {
    const source = isPlainObject(filter) ? filter : {};
    const rollouts = readState().rollouts.filter((rollout) => {
      if (source.status && rollout.status !== source.status) return false;
      if (source.policyId && rollout.policyId !== source.policyId) return false;
      if (source.policyVersion && rollout.policyVersion !== Number(source.policyVersion)) return false;
      return true;
    });
    return deepFreeze(rollouts.map(clone));
  }

  function getSnapshot() {
    return deepFreeze(clone(readState()));
  }

  if (!fs.existsSync(file)) writeState(defaultState(), false);
  else readState();

  return {
    file,
    applyRolloutEvaluation,
    getPolicy,
    getSnapshot,
    isLearningPaused,
    listPolicies,
    listRollouts,
    markBenchmarked,
    pauseLearning,
    recordRollout,
    register: registerPolicy,
    registerPolicy,
    resumeLearning,
    rollback: rollbackPolicy,
    rollbackPolicy,
    setLearningPaused,
    startCanary,
    startCanaryFromBenchmark
  };
}

module.exports = {
  REGISTRY_FILE_NAME,
  STATUS_TRANSITIONS,
  createGenerationPolicyRegistry,
  createPolicyRegistry: createGenerationPolicyRegistry
};
