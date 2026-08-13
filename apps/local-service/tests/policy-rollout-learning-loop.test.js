"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { DEFAULT_PRIVACY_FLAGS } = require("../../../packages/outcome-learning");
const { createBenchmarkPreview, runBenchmark } = require("../../../benchmarks/codex-outcome-v1");
const { classifyCodexInsertPolicyIncident } = require("../src/modules/policies");
const { createStore } = require("../src/store");
const { createApp } = require("../src/server");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-policy-learning-loop-"));
let nowMs = Date.parse("2026-07-19T12:00:00.000Z");
const now = () => new Date(nowMs).toISOString();
const scope = {
  kind: "project",
  target: "codex",
  projectScopeToken: "project_policy_learning_loop",
  taskScenarioToken: "bug_fix",
  modelFamilyToken: "model_policy_learning_loop"
};

async function main() {
  const store = createStore(dataDir, {
    pendingOutcomeOptions: { now },
    learningOptions: { now },
    policyOptions: { now, allowHarnessOnlyBenchmarks: true },
    policyCompilerOptions: { now }
  });
  const baselineDraft = store.compileGenerationPolicy({
    policyId: "policy_learning_loop",
    version: 1,
    baselineVersion: 1,
    scope,
    automaticRolloutEligible: false,
    selectedStrategy: { strategyId: "baseline", strategyVersion: "v1" }
  });
  store.registerGenerationPolicy({
    ...baselineDraft,
    status: "stable",
    automaticRolloutEligible: false
  });
  const candidate = store.compileAndRegisterGenerationPolicy({
    policyId: "policy_learning_loop",
    version: 2,
    baselineVersion: 1,
    scope,
    automaticRolloutEligible: true,
    selectedStrategy: { strategyId: "compact", strategyVersion: "v2" }
  });
  const benchmark = await runBenchmark({
    preview: createBenchmarkPreview({
      executor: "fake",
      modelFamilyToken: scope.modelFamilyToken
    })
  });
  store.markGenerationPolicyBenchmarked(candidate.policyId, candidate.version, benchmark);
  const planned = store.listGenerationPolicyRollouts()[0];
  assert.equal(planned.status, "planned");
  store.startGenerationPolicyCanaryFromBenchmark(candidate.policyId, candidate.version, {
    canaryShareBps: 1000
  });

  let finalEvaluation = null;
  for (let index = 0; index < 20; index += 1) {
    const baselineArm = index < 10;
    const version = baselineArm ? 1 : 2;
    const outcomeId = `outcome_policy_loop_${index}`;
    const event = {
      contractVersion: "prompt-session@2",
      eventId: `verified_insert_policy_loop_${index}`,
      eventType: "verified_insert",
      occurredAt: now(),
      sessionId: `session_policy_loop_${index}`,
      generationId: `generation_policy_loop_${index}`,
      target: "codex",
      projectScopeToken: scope.projectScopeToken,
      strategyId: baselineArm ? "baseline" : "compact",
      strategyVersion: baselineArm ? "v1" : "v2",
      modelFamilyToken: scope.modelFamilyToken,
      outcomeId,
      policyId: candidate.policyId,
      policyVersion: version,
      taskOutcomeToken: "unknown",
      insertVerified: true,
      noAutoSubmit: true,
      failureReasonTokens: [],
      privacyFlags: { ...DEFAULT_PRIVACY_FLAGS }
    };
    const editFeatureSummary = {
      userEdited: index === 10,
      lengthDeltaBucket: index === 10 ? "large" : "none",
      structureChanged: index === 10
    };
    store.addPromptHistory({
      generationId: event.generationId,
      strategyId: event.strategyId,
      mode: "continue",
      tool: "codex",
      generatedBy: "fixture",
      promptLength: 64,
      tokenUsage: { source: "unavailable" },
      context: {
        projectScopeToken: scope.projectScopeToken,
        taskScenario: scope.taskScenarioToken,
        modelFamilyToken: scope.modelFamilyToken,
        promptStrategyVersion: event.strategyVersion,
        generationPolicyId: event.policyId,
        generationPolicyVersion: event.policyVersion
      }
    });
    store.recordVerifiedGenerationEditSummary({
      generationId: event.generationId,
      projectScopeToken: scope.projectScopeToken,
      sessionId: event.sessionId,
      policyId: event.policyId,
      policyVersion: event.policyVersion,
      editFeatureSummary
    });
    store.recordVerifiedInsertOutcome(event);
    if (baselineArm) {
      store.recordOutcomeImplicitSignal({
        ...event,
        eventId: `retry_policy_loop_${index}`,
        eventType: "retry",
        insertVerified: false
      });
    }
    nowMs += 60_000;
    const claim = store.claimPendingOutcomeFeedback({
      askId: `ask_policy_loop_${index}`,
      target: "codex",
      projectScopeToken: scope.projectScopeToken
    });
    assert.equal(claim.outcome.outcomeId, outcomeId);
    const feedback = store.submitPendingOutcomeFeedback({
      feedbackId: `feedback_policy_loop_${index}`,
      outcomeId,
      taskOutcomeToken: "completed"
    });
    const learning = store.recordResolvedOutcomeObservation(feedback.outcome);
    finalEvaluation = learning.policyEvaluation || finalEvaluation;
  }

  assert.equal(finalEvaluation.action, "promote");
  assert.equal(finalEvaluation.enoughSamples, true);
  assert.equal(finalEvaluation.confidence, 1);
  assert.equal(store.generationPolicyRegistry.getPolicy(candidate.policyId, 2).status, "stable");
  const promoted = store.listGenerationPolicyRollouts()[0];
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.arms.baseline.attributableOutcomes, 10);
  assert.equal(promoted.arms.candidate.attributableOutcomes, 10);
  assert.equal(promoted.arms.baseline.retryRate, 1);
  assert.equal(promoted.arms.candidate.retryRate, 0);
  assert.equal(promoted.arms.baseline.averageReworkCount, 1);
  assert.equal(promoted.arms.candidate.averageReworkCount, 0.1);
  assert.equal(promoted.arms.candidate.averageLatencyMs, 0);
  assert.equal(promoted.gates.taskQualityNotDegraded, true);
  assert.equal(promoted.gates.statisticalRequirementMet, true);

  assert.equal(classifyCodexInsertPolicyIncident({
    result: { reasonToken: "safety_auto_submit_signal", noAutoSubmit: true }
  }), "auto_submit_incident");
  assert.equal(classifyCodexInsertPolicyIncident({
    result: { reasonToken: "after_write_mismatch", noAutoSubmit: true }
  }), "miswrite_incident");
  assert.equal(classifyCodexInsertPolicyIncident({
    result: { reasonToken: "write_failed_clipboard_restore", noAutoSubmit: true }
  }), "privacy_incident");
  assert.equal(classifyCodexInsertPolicyIncident({
    result: { reasonToken: "focus_changed", noAutoSubmit: true }
  }), null);

  const incidentStore = createStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-policy-incident-loop-")),
    {
      pendingOutcomeOptions: { now },
      learningOptions: { now },
      policyOptions: { now, allowHarnessOnlyBenchmarks: true },
      policyCompilerOptions: { now }
    }
  );
  const incidentBaseline = incidentStore.compileGenerationPolicy({
    policyId: "policy_incident_loop",
    version: 1,
    baselineVersion: 1,
    scope,
    automaticRolloutEligible: false,
    selectedStrategy: { strategyId: "baseline", strategyVersion: "v1" }
  });
  incidentStore.registerGenerationPolicy({
    ...incidentBaseline,
    status: "stable",
    automaticRolloutEligible: false
  });
  const incidentCandidate = incidentStore.compileAndRegisterGenerationPolicy({
    policyId: "policy_incident_loop",
    version: 2,
    baselineVersion: 1,
    scope,
    automaticRolloutEligible: true,
    selectedStrategy: { strategyId: "compact", strategyVersion: "v2" }
  });
  incidentStore.markGenerationPolicyBenchmarked(
    incidentCandidate.policyId,
    incidentCandidate.version,
    benchmark
  );
  incidentStore.startGenerationPolicyCanaryFromBenchmark(
    incidentCandidate.policyId,
    incidentCandidate.version,
    { canaryShareBps: 1000 }
  );
  const directBenchmarkCandidate = incidentStore.compileAndRegisterGenerationPolicy({
    policyId: incidentCandidate.policyId,
    version: 3,
    baselineVersion: incidentBaseline.version,
    scope,
    automaticRolloutEligible: true,
    selectedStrategy: { strategyId: "compact-next", strategyVersion: "v3" }
  });
  const routeServer = http.createServer(createApp(incidentStore, { disableAuth: true }));
  await new Promise((resolve) => routeServer.listen(0, "127.0.0.1", resolve));
  try {
    for (const body of [
      { rollout: incidentStore.listGenerationPolicyRollouts()[0], confidence: 1 },
      { rolloutId: incidentStore.listGenerationPolicyRollouts()[0].rolloutId, arms: {}, confidence: 1 }
    ]) {
      const response = await fetch(`http://127.0.0.1:${routeServer.address().port}/policies/v1/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.error.code, "unexpected_policy_evaluate_field");
    }
    const rolloutId = incidentStore.listGenerationPolicyRollouts()[0].rolloutId;
    const response = await fetch(`http://127.0.0.1:${routeServer.address().port}/policies/v1/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rolloutId })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.evaluation.action, "continue_canary");
    assert.equal(payload.confidence.enoughSamples, false);

    const forgedBenchmark = await fetch(`http://127.0.0.1:${routeServer.address().port}/policies/v1/benchmarked`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyId: directBenchmarkCandidate.policyId,
        version: directBenchmarkCandidate.version,
        benchmarkResult: benchmark
      })
    });
    const forgedBenchmarkPayload = await forgedBenchmark.json();
    assert.equal(forgedBenchmark.status, 400);
    assert.equal(forgedBenchmarkPayload.error.code, "policy_benchmark_server_evidence_required");

    for (const extraEvidence of [{ rollout: {} }, { gates: {} }]) {
      const forgedCanary = await fetch(`http://127.0.0.1:${routeServer.address().port}/policies/v1/canary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: directBenchmarkCandidate.policyId,
          version: directBenchmarkCandidate.version,
          ...extraEvidence
        })
      });
      const forgedCanaryPayload = await forgedCanary.json();
      assert.equal(forgedCanary.status, 400);
      assert.equal(forgedCanaryPayload.error.code, "unexpected_policy_canary_field");
    }
  } finally {
    await new Promise((resolve) => routeServer.close(resolve));
  }
  const incidentEvaluation = incidentStore.recordGenerationPolicyIncident({
    policyId: incidentCandidate.policyId,
    policyVersion: incidentCandidate.version,
    projectScopeToken: scope.projectScopeToken,
    incidentType: "miswrite_incident"
  });
  assert.equal(incidentEvaluation.action, "rollback");
  assert.equal(incidentEvaluation.reasonToken, "miswrite_incident");
  assert.equal(incidentStore.generationPolicyRegistry
    .getPolicy(incidentCandidate.policyId, incidentCandidate.version).status, "rolled_back");
  const incidentRollout = incidentStore.listGenerationPolicyRollouts()[0];
  assert.equal(incidentRollout.status, "rolled_back");
  assert.equal(incidentRollout.gates.miswriteIncidentCount, 1);
  console.log("policy rollout learning loop tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
