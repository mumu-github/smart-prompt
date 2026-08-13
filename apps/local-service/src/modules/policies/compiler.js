"use strict";

const {
  CONTEXT_BUDGET_LIMITS,
  clamp,
  clampInteger,
  clockTimestamp,
  contracts,
  deepFreeze,
  finiteNumber,
  hashToken,
  isPlainObject,
  normalizeScope,
  policyError,
  safeToken,
  scopeKey,
  validatePolicy
} = require("./shared");

const DIRECTIVE_KIND_SET = new Set(contracts.ENUMS.policyDirectiveKind);
const ALLOWED_DIRECTIVE_KINDS = new Set(DIRECTIVE_KIND_SET);
const FAILURE_TOKENS = new Set([
  ...contracts.ENUMS.outcomeFailureReason,
  "too_vague",
  "unsafe_or_privacy",
  "other"
]);
const FORBIDDEN_AUTOMATIC_ARTIFACTS = new Set(["memory", "rule", "skill"]);

function firstObject(...values) {
  return values.find(isPlainObject) || {};
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function materialValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== false && value !== "";
}

function assertAutomaticPolicyBoundary(source, signals) {
  const artifactType = safeToken(
    source.artifactType || source.learningObjectType || signals.artifactType || signals.learningObjectType,
    "",
    40
  ).toLowerCase();
  if (FORBIDDEN_AUTOMATIC_ARTIFACTS.has(artifactType)) {
    throw policyError(
      "automatic_policy_artifact_forbidden",
      "Memory, Rule, and Skill artifacts cannot be compiled into an automatic Generation Policy."
    );
  }
  const forbiddenKeys = [
    "memory",
    "memories",
    "rule",
    "rules",
    "skill",
    "skills",
    "permissions",
    "permissionChange",
    "scopeExpansion",
    "crossProject"
  ];
  if (forbiddenKeys.some((key) => materialValue(signals[key]))) {
    throw policyError(
      "automatic_policy_boundary_forbidden",
      "Knowledge, permission, and cross-project changes require an explicit review path."
    );
  }
}

function readSignalGroups(source) {
  const signals = isPlainObject(source.signals) ? source.signals : source;
  return {
    signals,
    strategy: firstObject(
      signals.strategy,
      signals.strategyPlan,
      signals.promptStrategy,
      signals.promptStrategyPlan,
      signals.strategyInsights
    ),
    quality: firstObject(
      signals.quality,
      signals.qualityLift,
      signals.promptQualityLiftReport,
      signals.qualityReport
    ),
    failure: firstObject(
      signals.failure,
      signals.failureReason,
      signals.failureReasonPolicy,
      signals.failureReasonReport
    ),
    selfImprovement: firstObject(
      signals.selfImprovement,
      signals.selfImprovementReport
    ),
    evolution: firstObject(
      signals.evolution,
      signals.evolutionCandidates,
      signals.evolutionCandidateReport
    )
  };
}

function selectedStrategyFromSignals(groups) {
  const { strategy, selfImprovement, signals } = groups;
  const selected = firstObject(strategy.selectedStrategy, signals.selectedStrategy);
  const weightPolicy = firstObject(
    strategy.strategyWeightPolicy,
    signals.strategyWeightPolicy
  );
  const promotion = firstObject(weightPolicy.selectedPromotion);
  const insightWinner = firstArray(strategy.topStrategies)
    .find((item) => isPlainObject(item) && item.reliable === true)
    || firstArray(strategy.topStrategies)[0]
    || {};
  const promotedSignals = firstArray(
    selfImprovement.learningSignals?.promotedStrategies,
    weightPolicy.promotedStrategies
  );
  const strategyId = safeToken(
    selected.sourceStrategyId
      || selected.strategyId
      || selected.id
      || promotion.strategyId
      || insightWinner.strategyId
      || promotedSignals[0]?.strategyId,
    "cold_start_structure"
  );
  const strategyVersion = safeToken(
    selected.strategyVersion
      || selected.version
      || strategy.strategyPolicy?.version
      || strategy.insightVersion
      || weightPolicy.weightPolicyVersion,
    "v1",
    80
  );
  return { strategyId, strategyVersion };
}

function collectFailureTokens(groups) {
  const { failure, selfImprovement, evolution, signals } = groups;
  const candidates = [];
  const add = (value) => {
    const token = safeToken(value, "", 80).toLowerCase();
    if (FAILURE_TOKENS.has(token) && !candidates.includes(token)) candidates.push(token);
  };
  for (const item of firstArray(failure.topReasons, signals.failureReasons)) {
    add(isPlainObject(item) ? item.reasonToken || item.key : item);
  }
  for (const item of firstArray(failure.directives)) add(item?.reasonToken);
  for (const item of firstArray(selfImprovement.learningSignals?.topFailureReasons)) {
    add(item?.reasonToken);
  }
  for (const item of firstArray(selfImprovement.reflections)) add(item?.reasonToken);
  for (const item of firstArray(evolution.candidates)) add(item?.reasonToken);
  for (const item of firstArray(signals.failureReasonTokens)) add(item);
  return candidates.slice(0, 8);
}

function qualityDecisions(groups) {
  const { quality, strategy, selfImprovement, signals } = groups;
  const qualityReport = firstObject(
    quality.promptQualityLiftReport,
    signals.promptQualityLiftReport,
    quality
  );
  const segmentPolicy = firstObject(
    quality.qualityLiftSegmentPolicy,
    strategy.qualityLiftSegmentPolicy,
    signals.qualityLiftSegmentPolicy
  );
  return new Set([
    qualityReport.readiness?.primaryDecision,
    qualityReport.primaryDecision,
    qualityReport.decision,
    segmentPolicy.decision,
    selfImprovement.learningSignals?.qualityLiftDecision,
    selfImprovement.learningSignals?.qualityLiftSegmentDecision
  ].map((value) => safeToken(value, "", 100)).filter(Boolean));
}

function guardedSelectedStrategy(groups, failureTokens, selectedStrategy) {
  const decisions = qualityDecisions(groups);
  if (decisions.has("quality_lift_regression")
    || decisions.has("segment_regression_guardrail")
    || failureTokens.includes("tool_mismatch")) {
    return {
      strategyId: "baseline_structure",
      strategyVersion: selectedStrategy.strategyVersion
    };
  }
  if (failureTokens.includes("insert_failed")) {
    return {
      strategyId: "insert_safe_compact",
      strategyVersion: selectedStrategy.strategyVersion
    };
  }
  return selectedStrategy;
}

function numericCandidates(...values) {
  return values
    .map((value) => Number(value))
    .filter(Number.isFinite);
}

function maxNumber(fallback, ...values) {
  const candidates = numericCandidates(...values);
  return candidates.length ? Math.max(...candidates) : fallback;
}

function firstFinite(fallback, ...values) {
  const candidates = numericCandidates(...values);
  return candidates.length ? candidates[0] : fallback;
}

function buildEvidenceSummary(source, groups) {
  const explicit = firstObject(source.evidenceSummary, groups.signals.evidenceSummary);
  const taskOutcome = firstObject(
    groups.strategy.taskOutcomeReport,
    groups.signals.taskOutcomeReport
  );
  const taskPolicy = firstObject(
    groups.strategy.taskOutcomePolicy,
    groups.signals.taskOutcomePolicy
  );
  const selectedCandidate = firstArray(groups.strategy.candidateStrategies)
    .find((item) => item?.strategyId === selectedStrategyFromSignals(groups).strategyId)
    || firstArray(groups.strategy.candidateStrategies)[0]
    || {};
  const readiness = firstObject(taskOutcome.readiness, groups.selfImprovement.readiness);
  let attributableOutcomeCount = clampInteger(maxNumber(
    0,
    explicit.attributableOutcomeCount,
    readiness.outcomeCount,
    taskPolicy.outcomeCount,
    selectedCandidate.outcomes
  ), 0, Number.MAX_SAFE_INTEGER, 0);
  let successfulOutcomeCount = clampInteger(maxNumber(
    0,
    explicit.successfulOutcomeCount,
    taskOutcome.readiness?.successfulOutcomeCount,
    selectedCandidate.successfulOutcomes
  ), 0, Number.MAX_SAFE_INTEGER, 0);
  let negativeOutcomeCount = clampInteger(maxNumber(
    0,
    explicit.negativeOutcomeCount,
    attributableOutcomeCount - successfulOutcomeCount
  ), 0, Number.MAX_SAFE_INTEGER, 0);
  attributableOutcomeCount = Math.max(
    attributableOutcomeCount,
    successfulOutcomeCount + negativeOutcomeCount
  );
  successfulOutcomeCount = Math.min(successfulOutcomeCount, attributableOutcomeCount);
  negativeOutcomeCount = Math.min(negativeOutcomeCount, attributableOutcomeCount - successfulOutcomeCount);
  const populatedGroups = [
    groups.strategy,
    groups.quality,
    groups.failure,
    groups.selfImprovement,
    groups.evolution
  ].filter((group) => Object.keys(group).length > 0).length;
  return {
    attributableOutcomeCount,
    successfulOutcomeCount,
    negativeOutcomeCount,
    retryRate: clamp(firstFinite(
      0,
      explicit.retryRate,
      selectedCandidate.retryUsageRate,
      selectedCandidate.retryRate
    ), 0, 1),
    undoRate: clamp(firstFinite(
      0,
      explicit.undoRate,
      selectedCandidate.undoUsageRate
    ), 0, 1),
    tokenDeltaRatio: clamp(firstFinite(0, explicit.tokenDeltaRatio), -1, 10),
    evidenceTokenCount: clampInteger(
      maxNumber(populatedGroups, explicit.evidenceTokenCount),
      0,
      Number.MAX_SAFE_INTEGER,
      populatedGroups
    )
  };
}

function compileDirectives(groups, failureTokens, selectedStrategy, contextBudget) {
  const proposals = new Map();
  const add = (kind, valueToken, score) => {
    if (!DIRECTIVE_KIND_SET.has(kind)) return;
    const safeValue = safeToken(valueToken, "", 100);
    if (!safeValue) return;
    const candidate = { kind, valueToken: safeValue, score: clamp(score, 0, 1) };
    const current = proposals.get(kind);
    if (!current || candidate.score > current.score
      || (candidate.score === current.score && candidate.valueToken.localeCompare(current.valueToken) < 0)) {
      proposals.set(kind, candidate);
    }
  };

  add("structure_order", "goal_context_constraints_acceptance", 0.5);
  add(
    "strategy_selection",
    selectedStrategy.strategyId === "cold_start_structure" ? "use_stable_baseline" : "prefer_selected_strategy",
    0.6
  );
  add("context_budget", "bounded_context", 0.6);

  const strategyKeys = new Set(firstArray(groups.strategy.directives)
    .map((item) => safeToken(item?.key || item?.directiveId, "", 100))
    .filter(Boolean));
  const mappedActions = [
    ...strategyKeys,
    ...firstArray(groups.strategy.recommendations)
      .map((item) => safeToken(item?.key || item?.recommendationKey, "", 100)),
    ...firstArray(groups.strategy.riskSignals)
      .map((item) => safeToken(item?.key, "", 100)),
    ...firstArray(groups.evolution.candidates)
      .filter((item) => item?.mutationAllowed !== true && item?.automaticPromotion !== true)
      .map((item) => safeToken(item?.action, "", 100))
  ];
  for (const action of mappedActions) {
    if (["acceptance_heavy", "make_prompt_actionable", "strengthen_acceptance"].includes(action)) {
      add("structure_order", "action_steps_and_acceptance", 0.82);
      add("detail_level", "balanced", 0.7);
    } else if (["strengthen_output_format", "wrong_format_repair"].includes(action)) {
      add("structure_order", "output_format_before_acceptance", 0.84);
    } else if (["insert_safe_compact", "reduce_insert_fragility"].includes(action)) {
      add("structure_order", "insert_safe_plain_text", 0.9);
      add("detail_level", "concise", 0.82);
    } else if (["shorten_prompt", "reduce_prompt_length"].includes(action)) {
      add("detail_level", "concise", 0.9);
      add("deduplicate", "compress_repetition", 0.86);
    } else if (["prefer_baseline_until_reviewed", "avoid_regressing_segment", "suppress_or_repair_strategy"].includes(action)) {
      add("strategy_selection", "use_stable_baseline", 0.93);
    } else if (["preserve_winning_strategy", "preserve_improving_segment", "prefer_task_outcome_winner"].includes(action)) {
      add("strategy_selection", "prefer_selected_strategy", 0.78);
    } else if (action === "reuse_friendly") {
      add("structure_order", "stable_reusable_sections", 0.7);
    }
  }

  for (const reason of failureTokens) {
    if (reason === "too_long" || reason === "token_waste") {
      add("detail_level", "concise", 0.98);
      add("deduplicate", "compress_repetition", 0.96);
    } else if (reason === "wrong_format") {
      add("structure_order", "output_format_before_acceptance", 0.95);
    } else if (reason === "not_actionable" || reason === "low_quality") {
      add("structure_order", "action_steps_and_acceptance", 0.92);
      add("detail_level", "balanced", 0.76);
    } else if (reason === "missing_context" || reason === "too_vague") {
      add("structure_order", "assumptions_before_execution", 0.9);
    } else if (reason === "insert_failed") {
      add("structure_order", "insert_safe_plain_text", 0.97);
      add("detail_level", "concise", 0.84);
    } else if (reason === "tool_mismatch") {
      add("strategy_selection", "use_stable_baseline", 0.94);
    }
  }

  for (const decision of qualityDecisions(groups)) {
    if (decision === "quality_lift_regression" || decision === "segment_regression_guardrail") {
      add("strategy_selection", "use_stable_baseline", 0.99);
    } else if (decision === "quality_lift_positive" || decision === "preserve_segment_winner") {
      add("strategy_selection", "prefer_selected_strategy", 0.88);
    }
  }

  if (contextBudget.maxInputTokens <= 1024) {
    add("context_budget", "reduced_context", 0.8);
  }

  return [...proposals.values()]
    .sort((left, right) => right.score - left.score
      || left.kind.localeCompare(right.kind)
      || left.valueToken.localeCompare(right.valueToken))
    .slice(0, 5)
    .map((item, index) => ({
      directiveId: `directive_${item.kind}`,
      kind: item.kind,
      valueToken: item.valueToken,
      priority: index + 1
    }));
}

function buildContextBudget(source, failureTokens) {
  const requested = firstObject(source.contextBudget, source.signals?.contextBudget);
  let maxInputTokens = clampInteger(
    requested.maxInputTokens,
    CONTEXT_BUDGET_LIMITS.minInputTokens,
    CONTEXT_BUDGET_LIMITS.maxInputTokens,
    1600
  );
  if (failureTokens.includes("too_long") || failureTokens.includes("token_waste")) {
    maxInputTokens = Math.max(
      CONTEXT_BUDGET_LIMITS.minInputTokens,
      Math.min(maxInputTokens, 1200)
    );
  }
  const maxContextSourceTokens = Math.min(
    maxInputTokens,
    clampInteger(
      requested.maxContextSourceTokens,
      0,
      CONTEXT_BUDGET_LIMITS.maxContextSourceTokens,
      0
    )
  );
  return { maxInputTokens, maxContextSourceTokens };
}

function compileGenerationPolicy(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const groups = readSignalGroups(source);
  assertAutomaticPolicyBoundary(source, groups.signals);
  const scope = normalizeScope(firstObject(source.scope, groups.signals.scope));
  const baselineVersion = clampInteger(source.baselineVersion, 1, Number.MAX_SAFE_INTEGER, 1);
  const version = clampInteger(source.version, 1, Number.MAX_SAFE_INTEGER, baselineVersion);
  const failureTokens = collectFailureTokens(groups);
  const selectedStrategy = guardedSelectedStrategy(
    groups,
    failureTokens,
    selectedStrategyFromSignals(groups)
  );
  const contextBudget = buildContextBudget(source, failureTokens);
  const directives = compileDirectives(groups, failureTokens, selectedStrategy, contextBudget);
  const highRiskSignal = source.riskLevel === "high"
    || failureTokens.includes("unsafe_or_privacy")
    || groups.evolution.mutationAllowed === true
    || groups.evolution.automaticPromotion === true
    || source.permissionChange === true
    || source.crossProject === true;
  const createdAt = source.createdAt
    ? clockTimestamp(() => source.createdAt)
    : clockTimestamp(options.now);
  const policyId = safeToken(source.policyId)
    || hashToken("policy", scopeKey(scope));
  const policy = {
    contractVersion: contracts.CONTRACT_VERSIONS[contracts.CONTRACTS.GENERATION_POLICY],
    policyId,
    version,
    scope,
    selectedStrategy,
    directives,
    contextBudget,
    evidenceSummary: buildEvidenceSummary(source, groups),
    baselineVersion,
    status: "draft",
    riskLevel: highRiskSignal ? "high" : "low",
    automaticRolloutEligible: !highRiskSignal
      && source.learningPaused !== true
      && source.automaticRolloutEligible !== false,
    createdAt,
    privacyFlags: { ...contracts.DEFAULT_PRIVACY_FLAGS }
  };
  return deepFreeze(validatePolicy(policy));
}

module.exports = {
  ALLOWED_DIRECTIVE_KINDS,
  compileGenerationPolicy,
  compilePolicy: compileGenerationPolicy
};
