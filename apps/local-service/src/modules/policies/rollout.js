"use strict";

const {
  DEFAULT_CANARY_SHARE_BPS,
  DEFAULT_MINIMUMS,
  clamp,
  clampInteger,
  clockTimestamp,
  contracts,
  deepFreeze,
  finiteNumber,
  hashToken,
  isPlainObject,
  policyError,
  safeToken,
  sameScope,
  scopeKey,
  validateBenchmark,
  validatePolicy,
  validateRollout
} = require("./shared");

const INCIDENT_FIELDS = Object.freeze([
  "safetyIncidentCount",
  "privacyIncidentCount",
  "permissionIncidentCount",
  "autoSubmitIncidentCount",
  "miswriteIncidentCount"
]);

function emptyRolloutArm() {
  return {
    attributableOutcomes: 0,
    successRate: 0,
    retryRate: 0,
    undoRate: 0,
    averageTokens: 0,
    averageLatencyMs: 0,
    averageReworkCount: 0
  };
}

function nonNegative(value) {
  return Math.max(0, finiteNumber(value, 0));
}

function average(values) {
  const finite = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function outcomeToken(result = {}) {
  return safeToken(
    result.taskOutcomeToken || result.outcomeStatus || result.status || result.outcome,
    "",
    60
  ).toLowerCase();
}

function isAttributable(result = {}) {
  if (result.attributable === false || result.attributed === false) return false;
  if (result.attributable === true || result.attributed === true) return true;
  return [
    "completed",
    "succeeded",
    "success",
    "not_completed",
    "failed",
    "failure"
  ].includes(outcomeToken(result));
}

function isSuccessful(result = {}) {
  return ["completed", "succeeded", "success"].includes(outcomeToken(result));
}

function observationTokens(result = {}) {
  if (result.tokenAccountingSource === "unavailable" || result.tokenAccounting?.source === "unavailable") {
    return null;
  }
  const directValue = result.totalTokens ?? result.tokens;
  const direct = directValue === null || directValue === undefined || directValue === ""
    ? Number.NaN
    : Number(directValue);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const fields = [
    "inputTokens",
    "outputTokens",
    "insertedPromptTokenEstimate",
    "retryTokens",
    "reworkTokens"
  ];
  const values = fields
    .map((field) => Number(result[field] ?? result.tokenAccounting?.[field]))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function summarizeRolloutArm(results = []) {
  const attributable = (Array.isArray(results) ? results : [])
    .filter((result) => isPlainObject(result) && isAttributable(result));
  if (!attributable.length) return deepFreeze(emptyRolloutArm());
  const retries = attributable.map((result) => nonNegative(result.retryCount));
  const rework = attributable.map((result) => nonNegative(
    result.reworkCount ?? result.retryCount
  ));
  return deepFreeze({
    attributableOutcomes: attributable.length,
    successRate: attributable.filter(isSuccessful).length / attributable.length,
    retryRate: retries.filter((count) => count > 0).length / attributable.length,
    undoRate: attributable.filter((result) => result.undoUsed === true).length / attributable.length,
    averageTokens: average(attributable.map(observationTokens)),
    averageLatencyMs: average(attributable.map((result) => result.latencyMs ?? result.durationMs)),
    averageReworkCount: average(rework)
  });
}

function normalizeRolloutArm(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    attributableOutcomes: clampInteger(source.attributableOutcomes, 0, Number.MAX_SAFE_INTEGER, 0),
    successRate: clamp(source.successRate, 0, 1),
    retryRate: clamp(source.retryRate, 0, 1),
    undoRate: clamp(source.undoRate, 0, 1),
    averageTokens: nonNegative(source.averageTokens),
    averageLatencyMs: nonNegative(source.averageLatencyMs),
    averageReworkCount: nonNegative(source.averageReworkCount)
  };
}

function rolloutArms(input = {}, fallbackArms = null) {
  if (isPlainObject(input.arms)) {
    return {
      baseline: normalizeRolloutArm(input.arms.baseline),
      candidate: normalizeRolloutArm(input.arms.candidate)
    };
  }
  const observations = Array.isArray(input.observations) ? input.observations : [];
  if (!observations.length && isPlainObject(fallbackArms)) {
    return {
      baseline: normalizeRolloutArm(fallbackArms.baseline),
      candidate: normalizeRolloutArm(fallbackArms.candidate)
    };
  }
  return {
    baseline: summarizeRolloutArm(observations.filter((item) => item?.arm === "baseline")),
    candidate: summarizeRolloutArm(observations.filter((item) => item?.arm === "candidate"))
  };
}

function normalizeMinimums(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    perArmAttributableOutcomes: clampInteger(
      source.perArmAttributableOutcomes,
      10,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_MINIMUMS.perArmAttributableOutcomes
    ),
    tokenImprovementRatio: clamp(
      source.tokenImprovementRatio ?? DEFAULT_MINIMUMS.tokenImprovementRatio,
      0.05,
      1
    ),
    minimumEffectRatio: clamp(
      source.minimumEffectRatio ?? DEFAULT_MINIMUMS.minimumEffectRatio,
      0,
      1
    ),
    confidenceThreshold: clamp(
      source.confidenceThreshold ?? DEFAULT_MINIMUMS.confidenceThreshold,
      0,
      1
    )
  };
}

function benchmarkPasses(benchmark, candidatePolicy) {
  if (!benchmark) return false;
  const value = validateBenchmark(benchmark);
  return value.status === "passed"
    && value.modelFamilyToken === candidatePolicy.scope.modelFamilyToken
    && value.safety.qualityGatePassed === true
    && value.safety.noAutoSubmitPassed === true
    && value.safety.privacyPassed === true
    && value.safety.permissionPassed === true;
}

function createPolicyRollout(input = {}, options = {}) {
  const candidatePolicy = validatePolicy(input.candidatePolicy || input.policy);
  const baselinePolicy = validatePolicy(input.baselinePolicy);
  if (!sameScope(candidatePolicy.scope, baselinePolicy.scope)) {
    throw policyError("policy_rollout_scope_mismatch", "Baseline and candidate policies must use the same exact scope.");
  }
  if (candidatePolicy.baselineVersion !== baselinePolicy.version) {
    throw policyError("policy_rollout_baseline_mismatch", "The candidate baselineVersion must match the stable baseline.");
  }
  if (baselinePolicy.status !== "stable") {
    throw policyError("policy_rollout_baseline_not_stable", "A stable baseline is required before canary rollout.");
  }
  if (candidatePolicy.riskLevel !== "low"
    || candidatePolicy.automaticRolloutEligible !== true
    || candidatePolicy.scope.kind !== "project") {
    throw policyError("policy_rollout_not_eligible", "Only low-risk project policies can enter automatic rollout.");
  }
  const benchmarkPassed = input.benchmarkResult
    ? benchmarkPasses(input.benchmarkResult, candidatePolicy)
    : false;
  const startedAt = input.startedAt
    ? clockTimestamp(() => input.startedAt)
    : clockTimestamp(options.now);
  const rolloutId = safeToken(input.rolloutId)
    || hashToken(
      "rollout",
      `${scopeKey(candidatePolicy.scope)}|${candidatePolicy.policyId}|${candidatePolicy.version}|${startedAt}`
    );
  const rollout = {
    contractVersion: contracts.CONTRACT_VERSIONS[contracts.CONTRACTS.POLICY_ROLLOUT],
    rolloutId,
    policyId: candidatePolicy.policyId,
    policyVersion: candidatePolicy.version,
    baselineVersion: baselinePolicy.version,
    projectScopeToken: candidatePolicy.scope.projectScopeToken,
    status: benchmarkPassed ? "canary" : "planned",
    canaryShareBps: clampInteger(
      input.canaryShareBps,
      1,
      10000,
      DEFAULT_CANARY_SHARE_BPS
    ),
    minimums: normalizeMinimums(input.minimums),
    arms: rolloutArms(input),
    gates: {
      benchmarkPassed,
      taskQualityNotDegraded: false,
      retryUndoNotDegraded: false,
      efficiencyImproved: false,
      statisticalRequirementMet: false,
      safetyIncidentCount: 0,
      privacyIncidentCount: 0,
      permissionIncidentCount: 0,
      autoSubmitIncidentCount: 0,
      miswriteIncidentCount: 0
    },
    rollbackReasonToken: "none",
    startedAt,
    endedAt: null,
    privacyFlags: { ...contracts.DEFAULT_PRIVACY_FLAGS }
  };
  return deepFreeze(validateRollout(rollout));
}

function collectIncidentCounts(input = {}) {
  const counts = Object.fromEntries(INCIDENT_FIELDS.map((field) => [field, 0]));
  const add = (field, value = 0) => {
    counts[field] += clampInteger(value, 0, Number.MAX_SAFE_INTEGER, 0);
  };
  const source = isPlainObject(input.incidents) ? input.incidents : input;
  for (const field of INCIDENT_FIELDS) add(field, source[field]);
  add("autoSubmitIncidentCount", source.noAutoSubmitIncidentCount);
  const events = Array.isArray(input.events) ? input.events : [];
  for (const event of events) {
    if (!isPlainObject(event)) continue;
    const type = safeToken(event.type || event.eventType || event.reasonToken, "", 100).toLowerCase();
    if (event.safetyIncident === true || type === "safety_incident") add("safetyIncidentCount", 1);
    if (event.privacyIncident === true || type === "privacy_incident") add("privacyIncidentCount", 1);
    if (event.permissionIncident === true || type === "permission_incident") add("permissionIncidentCount", 1);
    if (event.miswriteIncident === true || type === "miswrite_incident") add("miswriteIncidentCount", 1);
    if (event.noAutoSubmit === false
      || event.autoSubmitTriggered === true
      || type === "auto_submit_incident"
      || type === "no_auto_submit_incident") {
      add("autoSubmitIncidentCount", 1);
    }
  }
  return counts;
}

function rollbackReasonForIncidents(counts) {
  if (counts.autoSubmitIncidentCount > 0) return "auto_submit_incident";
  if (counts.miswriteIncidentCount > 0) return "miswrite_incident";
  if (counts.privacyIncidentCount > 0) return "privacy_incident";
  if (counts.permissionIncidentCount > 0) return "permission_incident";
  if (counts.safetyIncidentCount > 0) return "safety_incident";
  return "none";
}

function lowerIsBetterImprovement(baseline, candidate, options = {}) {
  const base = nonNegative(baseline);
  const next = nonNegative(candidate);
  if (base === 0 || (options.zeroCandidateIsUnavailable === true && next === 0)) return 0;
  return (base - next) / base;
}

function evaluatePolicyRollout(rolloutInput, input = {}, options = {}) {
  const rollout = validateRollout(rolloutInput);
  const now = input.observedAt
    ? clockTimestamp(() => input.observedAt)
    : clockTimestamp(options.now || input.now);
  const arms = rolloutArms(input, rollout.arms);
  const minimums = normalizeMinimums({ ...rollout.minimums, ...input.minimums });
  const incidentDelta = collectIncidentCounts(input);
  const incidents = Object.fromEntries(INCIDENT_FIELDS.map((field) => [
    field,
    clampInteger(
      Number(rollout.gates[field] || 0) + Number(incidentDelta[field] || 0),
      0,
      Number.MAX_SAFE_INTEGER,
      0
    )
  ]));
  const incidentReason = rollbackReasonForIncidents(incidents);
  const enoughSamples = arms.baseline.attributableOutcomes >= minimums.perArmAttributableOutcomes
    && arms.candidate.attributableOutcomes >= minimums.perArmAttributableOutcomes;
  const taskQualityNotDegraded = arms.candidate.successRate >= arms.baseline.successRate;
  const retryUndoNotDegraded = arms.candidate.retryRate <= arms.baseline.retryRate
    && arms.candidate.undoRate <= arms.baseline.undoRate;
  const tokenImprovementRatio = lowerIsBetterImprovement(
    arms.baseline.averageTokens,
    arms.candidate.averageTokens,
    { zeroCandidateIsUnavailable: true }
  );
  const latencyImprovementRatio = lowerIsBetterImprovement(
    arms.baseline.averageLatencyMs,
    arms.candidate.averageLatencyMs,
    { zeroCandidateIsUnavailable: true }
  );
  const reworkImprovementRatio = lowerIsBetterImprovement(
    arms.baseline.averageReworkCount,
    arms.candidate.averageReworkCount
  );
  const tokenImproved = tokenImprovementRatio >= Math.max(
    minimums.tokenImprovementRatio,
    minimums.minimumEffectRatio
  );
  const latencyImproved = latencyImprovementRatio >= minimums.minimumEffectRatio
    && latencyImprovementRatio > 0;
  const reworkImproved = reworkImprovementRatio >= minimums.minimumEffectRatio
    && reworkImprovementRatio > 0;
  const efficiencyImproved = tokenImproved || latencyImproved || reworkImproved;
  const bestEffectRatio = Math.max(
    tokenImproved ? tokenImprovementRatio : 0,
    latencyImproved ? latencyImprovementRatio : 0,
    reworkImproved ? reworkImprovementRatio : 0
  );
  const declaredConfidence = Number(input.confidence ?? input.declaredConfidence);
  const confidenceMet = Number.isFinite(declaredConfidence)
    ? declaredConfidence >= minimums.confidenceThreshold
    : rollout.gates.statisticalRequirementMet === true;
  const statisticalRequirementMet = confidenceMet
    && bestEffectRatio >= minimums.minimumEffectRatio;
  const benchmarkPassed = rollout.gates.benchmarkPassed === true
    && input.benchmarkPassed !== false;
  const successDrop = arms.baseline.successRate - arms.candidate.successRate;
  const retryIncrease = arms.candidate.retryRate - arms.baseline.retryRate;
  const undoIncrease = arms.candidate.undoRate - arms.baseline.undoRate;
  const significantQualityRegression = enoughSamples
    && confidenceMet
    && Math.max(successDrop, retryIncrease, undoIncrease) >= minimums.minimumEffectRatio
    && Math.max(successDrop, retryIncrease, undoIncrease) > 0;
  let action = "continue_canary";
  let reasonToken = "insufficient_evidence";
  let status = rollout.status === "planned" ? "planned" : "collecting";
  let rollbackReasonToken = "none";
  let endedAt = null;

  if (incidentReason !== "none") {
    action = "rollback";
    reasonToken = incidentReason;
    status = "rolled_back";
    rollbackReasonToken = incidentReason;
    endedAt = now;
  } else if (input.learningPaused === true) {
    action = "pause";
    reasonToken = "manual_pause";
    status = "paused";
  } else if (significantQualityRegression) {
    action = "rollback";
    reasonToken = "quality_regression";
    status = "rolled_back";
    rollbackReasonToken = "quality_regression";
    endedAt = now;
  } else if (enoughSamples
    && benchmarkPassed
    && taskQualityNotDegraded
    && retryUndoNotDegraded
    && efficiencyImproved
    && statisticalRequirementMet) {
    action = "promote";
    reasonToken = "promotion_gates_passed";
    status = "promoted";
    endedAt = now;
  } else if (rollout.status !== "planned" || benchmarkPassed) {
    status = "collecting";
  }

  const evaluated = {
    ...rollout,
    status,
    minimums,
    arms,
    gates: {
      benchmarkPassed,
      taskQualityNotDegraded,
      retryUndoNotDegraded,
      efficiencyImproved,
      statisticalRequirementMet,
      ...incidents
    },
    rollbackReasonToken,
    endedAt
  };
  const validRollout = validateRollout(evaluated);
  return deepFreeze({
    action,
    reasonToken,
    policyStatus: action === "promote" ? "stable" : action === "rollback" ? "rolled_back" : "canary",
    rollout: validRollout,
    evidence: {
      enoughSamples,
      declaredConfidence: Number.isFinite(declaredConfidence) ? clamp(declaredConfidence, 0, 1) : null,
      confidenceMet,
      bestEffectRatio,
      tokenImprovementRatio,
      latencyImprovementRatio,
      reworkImprovementRatio,
      tokenTargetRatio: minimums.tokenImprovementRatio
    }
  });
}

module.exports = {
  INCIDENT_FIELDS,
  collectIncidentCounts,
  createPolicyRollout,
  emptyRolloutArm,
  evaluatePolicyRollout,
  observationTokens,
  summarizePolicyRolloutArm: summarizeRolloutArm,
  summarizeRolloutArm
};
