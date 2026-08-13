"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const contracts = require("../../../packages/outcome-learning");
const {
  ALLOWED_DIRECTIVE_KINDS,
  CONTEXT_BUDGET_LIMITS,
  DEFAULT_CANARY_SHARE_BPS,
  GENERATION_POLICY_COMPILER_VERSION,
  GENERATION_POLICY_REGISTRY_VERSION,
  POLICY_ROLLOUT_ENGINE_VERSION,
  compileGenerationPolicy,
  createGenerationPolicyRegistry,
  createPolicyRollout,
  deterministicBucket,
  estimateRolloutConfidence,
  evaluatePolicyRollout,
  observationTokens,
  selectGenerationPolicy,
  selectGenerationPolicyAssignment,
  summarizeRolloutArm
} = require("../src/modules/policies");

const retainedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-generation-policy-v1-"));
const FIXED_NOW = "2026-07-19T08:00:00.000Z";
const fixedClock = () => FIXED_NOW;

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

function validBenchmark(modelFamilyToken) {
  return {
    contractVersion: "benchmark-result@1",
    benchmarkId: "benchmark_policy_v1",
    status: "passed",
    executor: "fake",
    initiatedBy: "test",
    authorization: { required: false, granted: false },
    modelFamilyToken,
    fixtureSetToken: "codex_policy_fixture_v1",
    taskCount: 12,
    categoryCounts: {
      feature_development: 2,
      bug_fix: 2,
      refactor: 2,
      test_completion: 2,
      code_review: 2,
      documentation: 2
    },
    comparability: {
      sameModelFamily: true,
      sameStartingPoint: true,
      samePermissions: true,
      sameBudget: true,
      deterministicAcceptance: true
    },
    budget: {
      tokenLimit: 120000,
      maxAgentTurns: 6,
      maxRetries: 2,
      estimatedCostMicros: 0,
      consumedTokens: 60000,
      exhausted: false
    },
    arms: {
      baseline: {
        completedTasks: 10,
        safetyPassedTasks: 12,
        totalTokens: 33000,
        totalDurationMs: 64000,
        totalRetries: 4,
        totalToolCalls: 44
      },
      candidate: {
        completedTasks: 10,
        safetyPassedTasks: 12,
        totalTokens: 29000,
        totalDurationMs: 59000,
        totalRetries: 3,
        totalToolCalls: 41
      }
    },
    safety: {
      qualityGatePassed: true,
      noAutoSubmitPassed: true,
      privacyPassed: true,
      permissionPassed: true
    },
    startedAt: "2026-07-19T07:00:00.000Z",
    finishedAt: "2026-07-19T07:10:00.000Z",
    publicReason: "none",
    privacyFlags: { ...contracts.DEFAULT_PRIVACY_FLAGS }
  };
}

function rolloutArms(candidateOverrides = {}, count = 10) {
  return {
    baseline: {
      attributableOutcomes: count,
      successRate: 0.8,
      retryRate: 0.2,
      undoRate: 0.1,
      averageTokens: 1000,
      averageLatencyMs: 1200,
      averageReworkCount: 0.5
    },
    candidate: {
      attributableOutcomes: count,
      successRate: 0.8,
      retryRate: 0.2,
      undoRate: 0.1,
      averageTokens: 940,
      averageLatencyMs: 1200,
      averageReworkCount: 0.5,
      ...candidateOverrides
    }
  };
}

assert.equal(GENERATION_POLICY_COMPILER_VERSION, "generation-policy-compiler@1");
assert.equal(GENERATION_POLICY_REGISTRY_VERSION, "generation-policy-registry@1");
assert.equal(POLICY_ROLLOUT_ENGINE_VERSION, "generation-policy-rollout@1");
assert.equal(DEFAULT_CANARY_SHARE_BPS, 1000);

const scope = {
  kind: "project",
  target: "codex",
  projectScopeToken: "project_scope_policy_v1",
  taskScenarioToken: "contract_implementation",
  modelFamilyToken: "model_family_fast"
};
const secretValues = [
  "SECRET_REPORT_BODY",
  "C:\\Users\\private\\project",
  "sk-1234567890abcdef",
  "SECRET_API_KEY"
];
const compilerInput = {
  scope,
  version: 2,
  baselineVersion: 1,
  contextBudget: {
    maxInputTokens: 999999,
    maxContextSourceTokens: 999999
  },
  evidenceSummary: {
    attributableOutcomeCount: 8,
    successfulOutcomeCount: 7,
    negativeOutcomeCount: 1,
    retryRate: 0.12,
    undoRate: 0,
    tokenDeltaRatio: -0.08,
    evidenceTokenCount: 8
  },
  signals: {
    strategy: {
      selectedStrategy: {
        id: "preserve_winning_strategy",
        sourceStrategyId: "strategy_compact",
        version: "v6-strategy-policy@3"
      },
      directives: [
        { key: "preserve_winning_strategy", directive: secretValues[0] },
        { key: "reuse_friendly", directive: secretValues[1] }
      ],
      candidateStrategies: [{
        strategyId: "strategy_compact",
        outcomes: 8,
        successfulOutcomes: 7,
        retryUsageRate: 0.12,
        undoUsageRate: 0
      }]
    },
    quality: {
      readiness: { primaryDecision: "quality_lift_positive" },
      rawReport: secretValues[0]
    },
    failure: {
      readiness: { status: "ready", totalReasonEvents: 10 },
      topReasons: [{ key: "too_long", value: 6 }],
      directives: [{ reasonToken: "too_long", directive: secretValues[0] }]
    },
    selfImprovement: {
      learningSignals: {
        promotedStrategies: [{ strategyId: "strategy_compact", outcomeCount: 8 }],
        topFailureReasons: [{ reasonToken: "too_long", count: 6 }]
      },
      reflections: [{
        type: "positive",
        strategyId: "strategy_compact",
        nextAction: secretValues[1]
      }]
    },
    evolution: {
      mutationAllowed: false,
      automaticPromotion: false,
      candidates: [{
        action: "shorten_prompt",
        status: "ready_for_review",
        mutationAllowed: false,
        automaticPromotion: false,
        reviewGate: secretValues[2]
      }]
    }
  }
};

const candidateDraft = compileGenerationPolicy(compilerInput, { now: fixedClock });
const repeatedCandidate = compileGenerationPolicy(compilerInput, { now: fixedClock });
assert.deepEqual(candidateDraft, repeatedCandidate, "compiler must be deterministic with injected time");
assert.equal(candidateDraft.contractVersion, "generation-policy@1");
assert.equal(candidateDraft.status, "draft");
assert.equal(candidateDraft.riskLevel, "low");
assert.equal(candidateDraft.automaticRolloutEligible, true);
assert.deepEqual(candidateDraft.selectedStrategy, {
  strategyId: "strategy_compact",
  strategyVersion: "v6-strategy-policy@3"
});
assert.equal(candidateDraft.contextBudget.maxInputTokens, 1200);
assert.equal(
  candidateDraft.contextBudget.maxContextSourceTokens <= CONTEXT_BUDGET_LIMITS.maxContextSourceTokens,
  true
);
assert.equal(candidateDraft.contextBudget.maxContextSourceTokens <= candidateDraft.contextBudget.maxInputTokens, true);
assert.equal(candidateDraft.directives.length <= 5, true);
assert.equal(new Set(candidateDraft.directives.map((item) => item.kind)).size, candidateDraft.directives.length);
for (const directive of candidateDraft.directives) {
  assert.equal(ALLOWED_DIRECTIVE_KINDS.has(directive.kind), true);
}
assert.equal(contracts.validateGenerationPolicy(candidateDraft).valid, true);
assert.equal(JSON.stringify(candidateDraft).length < 3000, true, "compiled policy should stay compact");
const serializedPolicy = JSON.stringify(candidateDraft);
for (const secret of secretValues) {
  assert.equal(serializedPolicy.includes(secret), false, `compiled policy leaked ${secret}`);
}
assert.deepEqual(contracts.findPrivacyViolations(candidateDraft), []);

expectCode(
  () => compileGenerationPolicy({ ...compilerInput, scope: { ...scope, kind: "global" } }, { now: fixedClock }),
  "automatic_policy_scope_forbidden"
);
expectCode(
  () => compileGenerationPolicy({
    ...compilerInput,
    signals: { ...compilerInput.signals, memory: { valueToken: "project_fact" } }
  }, { now: fixedClock }),
  "automatic_policy_boundary_forbidden"
);
expectCode(
  () => compileGenerationPolicy({ ...compilerInput, artifactType: "skill" }, { now: fixedClock }),
  "automatic_policy_artifact_forbidden"
);
const permissionBoundDraft = compileGenerationPolicy({
  scope,
  permissionChange: true,
  signals: {
    failureReasonReport: { topReasons: [{ key: "unsafe_or_privacy", value: 1 }] }
  }
}, { now: fixedClock });
assert.equal(permissionBoundDraft.riskLevel, "high");
assert.equal(permissionBoundDraft.automaticRolloutEligible, false);
const credentialStrategy = compileGenerationPolicy({
  ...compilerInput,
  version: 3,
  signals: {
    strategy: { selectedStrategy: { id: secretValues[2], version: "v1" } }
  }
}, { now: fixedClock });
assert.equal(credentialStrategy.selectedStrategy.strategyId, "cold_start_structure");
assert.equal(JSON.stringify(credentialStrategy).includes(secretValues[2]), false);
const reviewOnlyEvolution = compileGenerationPolicy({
  scope,
  version: 4,
  baselineVersion: 1,
  signals: {
    evolutionCandidateReport: {
      automaticPromotion: false,
      mutationAllowed: false,
      candidates: [{
        action: "promote_prompt_strategy",
        status: "ready_for_review",
        strategyId: "strategy_review_only",
        automaticPromotion: false,
        mutationAllowed: false
      }]
    }
  }
}, { now: fixedClock });
assert.equal(reviewOnlyEvolution.selectedStrategy.strategyId, "cold_start_structure");

const baselineDraft = compileGenerationPolicy({
  ...compilerInput,
  version: 1,
  baselineVersion: 1,
  signals: {
    strategy: { selectedStrategy: { id: "baseline_structure", version: "v1" } }
  }
}, { now: fixedClock });
const baselineStable = contracts.assertValidContract("generation_policy", {
  ...baselineDraft,
  status: "stable"
});
const registryDir = path.join(retainedRoot, "registry");
const lockedRegistry = createGenerationPolicyRegistry(
  path.join(retainedRoot, "production-evidence-gate"),
  { now: fixedClock }
);
expectCode(
  () => lockedRegistry.markBenchmarked("missing_policy", 1, validBenchmark("fixture-model")),
  "policy_benchmark_production_evidence_required"
);

const registry = createGenerationPolicyRegistry(registryDir, {
  now: fixedClock,
  allowHarnessOnlyBenchmarks: true
});
expectCode(
  () => registry.registerPolicy({
    ...baselineStable,
    policyId: "ghp_123456789012345678901234567890"
  }),
  "unsafe_generation_policy_token"
);
registry.registerPolicy(baselineStable);
registry.registerPolicy(candidateDraft);
const benchmark = validBenchmark(scope.modelFamilyToken);
const benchmarked = registry.markBenchmarked(candidateDraft.policyId, candidateDraft.version, benchmark);
assert.equal(benchmarked.status, "benchmarked");
const persistedPlan = registry.listRollouts()[0];
assert.equal(persistedPlan.status, "planned");
assert.equal(persistedPlan.gates.benchmarkPassed, true);

const initialRollout = createPolicyRollout({
  candidatePolicy: benchmarked,
  baselinePolicy: baselineStable,
  benchmarkResult: benchmark,
  rolloutId: "rollout_policy_v1",
  arms: rolloutArms({}, 0)
}, { now: fixedClock });
assert.equal(initialRollout.status, "canary");
assert.equal(initialRollout.canaryShareBps, 1000);
const unverifiedBenchmarkClaim = createPolicyRollout({
  candidatePolicy: benchmarked,
  baselinePolicy: baselineStable,
  benchmarkPassed: true,
  rolloutId: "rollout_unverified_benchmark_claim"
}, { now: fixedClock });
assert.equal(unverifiedBenchmarkClaim.status, "planned");
assert.equal(unverifiedBenchmarkClaim.gates.benchmarkPassed, false);
registry.startCanaryFromBenchmark(candidateDraft.policyId, candidateDraft.version, { canaryShareBps: 1000 });
assert.equal(registry.getPolicy(candidateDraft.policyId, candidateDraft.version).status, "canary");
assert.equal(registry.listRollouts()[0].rolloutId, persistedPlan.rolloutId);

const selectionContext = {
  registry,
  ...scope,
  assignmentToken: "generation_001"
};
const canaryAssignment = selectGenerationPolicyAssignment({
  ...selectionContext,
  bucket: () => 999
});
assert.equal(canaryAssignment.arm, "canary");
assert.equal(canaryAssignment.policy.version, 2);
assert.equal(selectGenerationPolicy({ ...selectionContext, bucket: () => 1000 }).version, 1);
const newerUnrelatedStable = contracts.assertValidContract("generation_policy", {
  ...candidateDraft,
  status: "stable"
});
const canaryAgainstV1 = contracts.assertValidContract("generation_policy", {
  ...compileGenerationPolicy({ ...compilerInput, version: 3, baselineVersion: 1 }, { now: fixedClock }),
  status: "canary"
});
const rolloutAgainstV1 = {
  ...initialRollout,
  rolloutId: "rollout_baseline_binding_v1",
  policyVersion: 3,
  baselineVersion: 1
};
const boundStableAssignment = selectGenerationPolicyAssignment({
  ...scope,
  policies: [baselineStable, newerUnrelatedStable, canaryAgainstV1],
  rollouts: [rolloutAgainstV1],
  assignmentToken: "stable-arm-must-use-recorded-baseline",
  bucket: () => 9999
});
assert.equal(boundStableAssignment.arm, "stable");
assert.equal(boundStableAssignment.policy.version, 1, "the stable arm must use the rollout's recorded baselineVersion");
const untrackedCanaryAssignment = selectGenerationPolicyAssignment({
  ...scope,
  policies: [baselineStable, newerUnrelatedStable, canaryAgainstV1],
  rollouts: [],
  assignmentToken: "missing-rollout-must-not-canary",
  bucket: () => 0
});
assert.equal(untrackedCanaryAssignment.arm, "stable");
assert.equal(untrackedCanaryAssignment.policy.version, 2, "an untracked canary must fall back to the latest stable policy");
assert.equal(selectGenerationPolicy({
  ...selectionContext,
  taskScenarioToken: "different_scenario",
  bucket: () => 0
}), null);
assert.equal(deterministicBucket("stable-assignment"), deterministicBucket("stable-assignment"));

registry.pauseLearning("manual");
assert.equal(registry.isLearningPaused(), true);
assert.equal(selectGenerationPolicy({ ...selectionContext, bucket: () => 0 }).version, 1);
assert.equal(registry.listRollouts()[0].status, "paused");
const pausedRestart = createGenerationPolicyRegistry(registryDir, { now: fixedClock });
assert.equal(pausedRestart.isLearningPaused(), true);
pausedRestart.resumeLearning();
assert.equal(registry.isLearningPaused(), false);
assert.equal(registry.listRollouts()[0].status, "collecting");
assert.equal(selectGenerationPolicy({ ...selectionContext, bucket: () => 0 }).version, 2);

const summarized = summarizeRolloutArm([
  { attributable: true, taskOutcomeToken: "completed", retryCount: 0, undoUsed: false, totalTokens: 100, latencyMs: 10 },
  { attributable: true, taskOutcomeToken: "not_completed", retryCount: 1, undoUsed: true, totalTokens: 200, latencyMs: 20 },
  { attributable: false, taskOutcomeToken: "completed", totalTokens: 1 }
]);
assert.deepEqual(summarized, {
  attributableOutcomes: 2,
  successRate: 0.5,
  retryRate: 0.5,
  undoRate: 0.5,
  averageTokens: 150,
  averageLatencyMs: 15,
  averageReworkCount: 0.5
});
assert.equal(observationTokens({
  tokenAccountingSource: "provider",
  inputTokens: 100,
  outputTokens: 40,
  reasoningTokens: 8,
  insertedPromptTokenEstimate: 10
}), 150, "reasoning tokens are an output breakdown and must not be double counted");
const confidenceSamples = [
  ...Array.from({ length: 10 }, () => ({
    arm: "baseline",
    taskOutcomeToken: "completed",
    retryCount: 0,
    undoUsed: false,
    latencyMs: 1000,
    tokenAccountingSource: "unavailable"
  })),
  ...Array.from({ length: 10 }, () => ({
    arm: "candidate",
    taskOutcomeToken: "completed",
    retryCount: 0,
    undoUsed: false,
    latencyMs: 800,
    tokenAccountingSource: "unavailable"
  }))
];
const confidence = estimateRolloutConfidence(confidenceSamples);
assert.equal(confidence.enoughSamples, true);
assert.equal(confidence.confidence, 1);

const collectingRollout = registry.listRollouts()[0];
const insufficient = evaluatePolicyRollout(collectingRollout, {
  arms: rolloutArms({}, 9),
  confidence: 0.99
}, { now: fixedClock });
assert.equal(insufficient.action, "continue_canary");
assert.equal(insufficient.rollout.status, "collecting");
assert.equal(insufficient.evidence.enoughSamples, false);
registry.applyRolloutEvaluation(insufficient);

const retryWorse = evaluatePolicyRollout(insufficient.rollout, {
  arms: rolloutArms({ retryRate: 0.21 }),
  confidence: 0.99
}, { now: fixedClock });
assert.equal(retryWorse.action, "continue_canary");
assert.equal(retryWorse.rollout.gates.retryUndoNotDegraded, false);

const missingTokenAccounting = evaluatePolicyRollout(insufficient.rollout, {
  arms: rolloutArms({ averageTokens: 0 }),
  confidence: 0.99
}, { now: fixedClock });
assert.equal(missingTokenAccounting.action, "continue_canary");
assert.equal(missingTokenAccounting.rollout.gates.efficiencyImproved, false);

const tokenCannotOverrideQuality = evaluatePolicyRollout(initialRollout, {
  arms: rolloutArms({ successRate: 0.6, averageTokens: 700 }),
  confidence: 0.99
}, { now: fixedClock });
assert.equal(tokenCannotOverrideQuality.action, "rollback");
assert.equal(tokenCannotOverrideQuality.reasonToken, "quality_regression");
assert.equal(tokenCannotOverrideQuality.rollout.gates.taskQualityNotDegraded, false);

const incidentCases = [
  [{ safetyIncident: true }, "safety_incident"],
  [{ miswriteIncident: true }, "miswrite_incident"],
  [{ noAutoSubmit: false }, "auto_submit_incident"],
  [{ privacyIncident: true }, "privacy_incident"],
  [{ permissionIncident: true }, "permission_incident"]
];
for (const [event, reason] of incidentCases) {
  const evaluation = evaluatePolicyRollout(initialRollout, {
    events: [event],
    arms: rolloutArms({}, 0),
    confidence: 0
  }, { now: fixedClock });
  assert.equal(evaluation.action, "rollback");
  assert.equal(evaluation.reasonToken, reason);
  assert.equal(evaluation.rollout.status, "rolled_back");
}

const promotable = evaluatePolicyRollout(insufficient.rollout, {
  arms: rolloutArms(),
  confidence: 0.95
}, { now: fixedClock });
assert.equal(promotable.action, "promote");
assert.equal(promotable.rollout.status, "promoted");
assert.equal(promotable.rollout.gates.benchmarkPassed, true);
assert.equal(promotable.rollout.gates.taskQualityNotDegraded, true);
assert.equal(promotable.rollout.gates.retryUndoNotDegraded, true);
assert.equal(promotable.rollout.gates.efficiencyImproved, true);
assert.equal(promotable.rollout.gates.statisticalRequirementMet, true);
assert.equal(promotable.evidence.tokenImprovementRatio >= 0.05, true);
registry.applyRolloutEvaluation(promotable);
assert.equal(registry.getPolicy(candidateDraft.policyId, candidateDraft.version).status, "stable");
assert.equal(selectGenerationPolicy({ ...selectionContext, bucket: () => 9999 }).version, 2);

registry.rollbackPolicy(candidateDraft.policyId, candidateDraft.version, "manual");
assert.equal(registry.getPolicy(candidateDraft.policyId, candidateDraft.version).status, "rolled_back");
assert.equal(selectGenerationPolicy({ ...selectionContext, bucket: () => 0 }).version, 1);
assert.equal(registry.listRollouts()[0].status, "rolled_back");
assert.equal(registry.listRollouts()[0].rollbackReasonToken, "manual");

const restarted = createGenerationPolicyRegistry(registryDir, { now: fixedClock });
assert.equal(restarted.getPolicy(candidateDraft.policyId, candidateDraft.version).status, "rolled_back");
assert.equal(restarted.getPolicy(baselineStable.policyId, baselineStable.version).status, "stable");
assert.equal(restarted.getSnapshot().learningPaused, false);
const candidateLifecycle = new Set(restarted.getSnapshot().transitions
  .filter((item) => item.policyId === candidateDraft.policyId && item.policyVersion === candidateDraft.version)
  .map((item) => item.toStatus));
assert.deepEqual(candidateLifecycle, new Set([
  "draft",
  "benchmarked",
  "canary",
  "stable",
  "rolled_back"
]));
const persisted = fs.readFileSync(restarted.file, "utf8");
for (const secret of secretValues) {
  assert.equal(persisted.includes(secret), false, `registry leaked ${secret}`);
}
assert.equal(contracts.findPrivacyViolations(JSON.parse(persisted)).length, 0);

console.log(`generation policy v1 tests passed; retained temp root: ${retainedRoot}`);
