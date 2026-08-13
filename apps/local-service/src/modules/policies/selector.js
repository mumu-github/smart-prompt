"use strict";

const crypto = require("node:crypto");
const {
  DEFAULT_CANARY_SHARE_BPS,
  clampInteger,
  deepFreeze,
  isPlainObject,
  safeToken,
  scopeKey,
  validatePolicy,
  validateRollout
} = require("./shared");

function deterministicBucket(value, bucketCount = 10000) {
  const count = clampInteger(bucketCount, 1, Number.MAX_SAFE_INTEGER, 10000);
  const digest = crypto.createHash("sha256").update(String(value || "anonymous"), "utf8").digest();
  return digest.readUInt32BE(0) % count;
}

function normalizedBucket(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number >= 0 && number < 1) return Math.floor(number * 10000);
  return ((Math.trunc(number) % 10000) + 10000) % 10000;
}

function policySort(left, right) {
  return Number(right.version || 0) - Number(left.version || 0)
    || String(left.policyId || "").localeCompare(String(right.policyId || ""));
}

function selectionInputs(input, context) {
  if (Array.isArray(input)) return { ...(isPlainObject(context) ? context : {}), policies: input };
  return isPlainObject(input) ? input : {};
}

function registryValues(source) {
  const registry = source.registry;
  if (!registry || typeof registry !== "object") {
    return {
      policies: Array.isArray(source.policies) ? source.policies : [],
      rollouts: Array.isArray(source.rollouts) ? source.rollouts : [],
      learningPaused: source.learningPaused === true
    };
  }
  const snapshot = typeof registry.getSnapshot === "function" ? registry.getSnapshot() : null;
  return {
    policies: typeof registry.listPolicies === "function"
      ? registry.listPolicies()
      : Array.isArray(snapshot?.policies) ? snapshot.policies : [],
    rollouts: typeof registry.listRollouts === "function"
      ? registry.listRollouts()
      : Array.isArray(snapshot?.rollouts) ? snapshot.rollouts : [],
    learningPaused: typeof registry.isLearningPaused === "function"
      ? registry.isLearningPaused()
      : snapshot?.learningPaused === true
  };
}

function selectionScope(source) {
  return {
    kind: "project",
    target: safeToken(source.target || "codex", "codex", 40),
    projectScopeToken: safeToken(source.projectScopeToken || source.scope?.projectScopeToken),
    taskScenarioToken: safeToken(
      source.taskScenarioToken || source.taskScenario || source.scope?.taskScenarioToken
    ),
    modelFamilyToken: safeToken(
      source.modelFamilyToken || source.modelFamily || source.scope?.modelFamilyToken
    )
  };
}

function rolloutForPolicy(rollouts, policy) {
  return rollouts
    .filter((rollout) => rollout.policyId === policy.policyId
      && rollout.policyVersion === policy.version)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0]
    || null;
}

function selectGenerationPolicyAssignment(input = {}, context = {}) {
  const source = selectionInputs(input, context);
  const values = registryValues(source);
  const expectedScope = selectionScope(source);
  if (expectedScope.target !== "codex"
    || !expectedScope.projectScopeToken
    || !expectedScope.taskScenarioToken
    || !expectedScope.modelFamilyToken) {
    return null;
  }
  const expectedKey = scopeKey(expectedScope);
  const policies = values.policies
    .map((policy) => {
      try {
        return validatePolicy(policy);
      } catch {
        return null;
      }
    })
    .filter((policy) => policy && scopeKey(policy.scope) === expectedKey);
  const stable = policies.filter((policy) => policy.status === "stable").sort(policySort)[0] || null;
  const canary = policies.filter((policy) => policy.status === "canary").sort(policySort)[0] || null;
  if (!canary || source.learningPaused === true || values.learningPaused) {
    return stable ? deepFreeze({ policy: stable, arm: "stable", bucket: null, rolloutId: null }) : null;
  }
  const rollouts = values.rollouts
    .map((rollout) => {
      try {
        return validateRollout(rollout);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const rollout = rolloutForPolicy(rollouts, canary);
  const rolloutStable = rollout
    ? policies.find((policy) => policy.status === "stable"
      && policy.policyId === rollout.policyId
      && policy.version === rollout.baselineVersion) || null
    : null;
  const rolloutTracked = rollout
    && ["canary", "collecting"].includes(rollout.status)
    && rollout.baselineVersion === canary.baselineVersion
    && rolloutStable;
  if (!rolloutTracked) {
    return stable
      ? deepFreeze({ policy: stable, arm: "stable", bucket: null, rolloutId: rollout?.rolloutId || null })
      : null;
  }
  const canaryShareBps = clampInteger(
    source.canaryShareBps ?? rollout?.canaryShareBps,
    0,
    10000,
    DEFAULT_CANARY_SHARE_BPS
  );
  const assignmentToken = safeToken(
    source.assignmentToken
      || source.generationId
      || source.sessionId
      || source.requestId,
    "anonymous"
  );
  const bucketKey = [expectedKey, canary.policyId, canary.version, assignmentToken].join("|");
  const bucketFunction = typeof source.bucket === "function"
    ? source.bucket
    : typeof source.bucketFn === "function"
      ? source.bucketFn
      : deterministicBucket;
  const bucketValue = bucketFunction(bucketKey, 10000);
  const bucket = Number.isFinite(Number(bucketValue))
    ? normalizedBucket(bucketValue)
    : deterministicBucket(bucketKey, 10000);
  if (bucket < canaryShareBps) {
    return deepFreeze({
      policy: canary,
      arm: "canary",
      bucket,
      rolloutId: rollout?.rolloutId || null
    });
  }
  return rolloutStable
    ? deepFreeze({
      policy: rolloutStable,
      arm: "stable",
      bucket,
      rolloutId: rollout?.rolloutId || null
    })
    : null;
}

function selectGenerationPolicy(input = {}, context = {}) {
  return selectGenerationPolicyAssignment(input, context)?.policy || null;
}

module.exports = {
  deterministicBucket,
  selectGenerationPolicy,
  selectGenerationPolicyAssignment,
  selectPolicy: selectGenerationPolicy,
  selectPolicyAssignment: selectGenerationPolicyAssignment
};
