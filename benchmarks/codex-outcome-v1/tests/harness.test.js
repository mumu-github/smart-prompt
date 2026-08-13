"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const contracts = require("../../../packages/outcome-learning");
const {
  FIXTURE_SET,
  BenchmarkGateError,
  validateFixtureSet,
  scanSyntheticStrings,
  createBenchmarkPreview,
  formatPreview,
  runBenchmark,
  getBenchmarkAssessment
} = require("..");

function successfulExecution(request, overrides = {}) {
  return {
    completed: overrides.completed ?? true,
    acceptancePassed: overrides.acceptancePassed ?? true,
    budgetExhausted: overrides.budgetExhausted ?? false,
    safety: {
      safeExecution: true,
      noAutoSubmit: true,
      privacy: true,
      permission: true,
      ...(overrides.safety || {})
    },
    usage: {
      tokens: Math.min(100, request.limits.tokenLimit),
      durationMs: 10,
      retries: 0,
      toolCalls: 1,
      agentTurns: 1,
      ...(overrides.usage || {})
    }
  };
}

test("fixture set contains 12 synthetic tasks with two tasks in each category", () => {
  const validation = validateFixtureSet(FIXTURE_SET);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(FIXTURE_SET.tasks.length, 12);
  assert.equal(validation.requestCount, 24);
  assert.deepEqual(validation.categoryCounts, {
    feature_development: 2,
    bug_fix: 2,
    refactor: 2,
    test_completion: 2,
    code_review: 2,
    documentation: 2
  });
  assert.deepEqual(scanSyntheticStrings(FIXTURE_SET), []);
});

test("every task has comparable arms and deterministic offline acceptance", () => {
  for (const task of FIXTURE_SET.tasks) {
    const baseline = task.arms.baseline;
    const candidate = task.arms.candidate;
    assert.equal(task.repository.kind, "synthetic", task.taskId);
    assert.equal(task.inputs.baseline.kind, "raw-input", task.taskId);
    assert.equal(task.inputs.candidate.kind, "optimized-input", task.taskId);
    assert.notEqual(task.inputs.baseline.text, task.inputs.candidate.text, task.taskId);
    assert.equal(baseline.startingPointToken, candidate.startingPointToken, task.taskId);
    assert.equal(baseline.startingPointToken, task.repository.startingPointToken, task.taskId);
    assert.equal(baseline.modelFamilyToken, candidate.modelFamilyToken, task.taskId);
    assert.equal(baseline.permissionProfileToken, candidate.permissionProfileToken, task.taskId);
    assert.deepEqual(baseline.budget, candidate.budget, task.taskId);
    assert.equal(baseline.acceptanceDefinitionToken, candidate.acceptanceDefinitionToken, task.taskId);
    assert.equal(baseline.acceptanceDefinitionToken, task.acceptance.definitionToken, task.taskId);
    assert.equal(task.acceptance.deterministic, true, task.taskId);
    assert.equal(task.acceptance.manualJudgmentRequired, false, task.taskId);
    assert.equal(task.acceptance.networkAllowed, false, task.taskId);
  }
});

test("preview displays the model, 24 requests, hard limits, retries, and estimated cost", () => {
  const preview = createBenchmarkPreview();
  assert.equal(preview.executor, "fake");
  assert.equal(preview.requestCount, 24);
  assert.equal(preview.estimatedCostMicros, 0);
  assert.equal(preview.backgroundStartAllowed, false);
  const rendered = formatPreview(preview);
  assert.match(rendered, /model: model_family_codex_fixture/);
  assert.match(rendered, /requests: 24/);
  assert.match(rendered, /token limit: 120000/);
  assert.match(rendered, /max agent turns per request: 6/);
  assert.match(rendered, /max retries per request: 2/);
  assert.match(rendered, /estimated cost: 0 micros/);
  assert.throws(
    () => createBenchmarkPreview({ budget: { estimatedCostMicros: 1 } }),
    (error) => error instanceof BenchmarkGateError && error.code === "fake_cost_forbidden"
  );
});

test("default fake run is offline, zero-cost, contract-valid, and harness-only evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network access is forbidden in fake tests");
  };
  try {
    const preview = createBenchmarkPreview();
    const result = await runBenchmark({ preview });
    const validation = contracts.validateBenchmarkResult(result);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
    assert.equal(result.status, "passed");
    assert.equal(result.executor, "fake");
    assert.equal(result.budget.estimatedCostMicros, 0);
    assert.equal(result.authorization.required, false);
    assert.equal(result.authorization.granted, false);
    assert.deepEqual(contracts.findPrivacyViolations(result), []);

    const assessment = getBenchmarkAssessment(result);
    assert.deepEqual(assessment.decisionOrder, ["quality", "safety", "efficiency"]);
    assert.equal(assessment.evidenceScope, "harness_only");
    assert.equal(assessment.productionEvidence, false);
    assert.equal(assessment.automaticPromotionEligible, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("real Codex execution refuses missing, stale, budgetless, or background authorization", async () => {
  const preview = createBenchmarkPreview({
    executor: "codex",
    benchmarkId: "benchmark_authorization_gate_001",
    budget: { estimatedCostMicros: 500000 }
  });
  let calls = 0;
  const execute = async (request) => {
    calls += 1;
    return successfulExecution(request);
  };
  const validAuthorization = {
    granted: true,
    grantedInCurrentRun: true,
    previewToken: preview.previewToken
  };
  const validBudgetConfirmation = {
    confirmed: true,
    previewToken: preview.previewToken
  };

  await assert.rejects(
    runBenchmark({ preview, executionMode: "foreground", execute }),
    (error) => error.code === "user_initiator_required"
  );
  await assert.rejects(
    runBenchmark({
      preview,
      initiatedBy: "user",
      executionMode: "foreground",
      authorization: { ...validAuthorization, previewToken: "preview_stale" },
      budgetConfirmation: validBudgetConfirmation,
      execute
    }),
    (error) => error.code === "current_run_authorization_required"
  );
  await assert.rejects(
    runBenchmark({
      preview,
      initiatedBy: "user",
      executionMode: "foreground",
      authorization: validAuthorization,
      execute
    }),
    (error) => error.code === "budget_confirmation_required"
  );
  await assert.rejects(
    runBenchmark({
      preview,
      initiatedBy: "user",
      executionMode: "background",
      authorization: validAuthorization,
      budgetConfirmation: validBudgetConfirmation,
      execute
    }),
    (error) => error.code === "foreground_execution_required"
  );
  await assert.rejects(
    runBenchmark({
      preview,
      initiatedBy: "user",
      executionMode: "foreground",
      authorization: validAuthorization,
      budgetConfirmation: validBudgetConfirmation
    }),
    (error) => error.code === "executor_function_required"
  );
  assert.equal(calls, 0, "the injected executor must not run before every gate passes");
});

test("authorized real executor is caller-injected, foreground, and contract-valid", async () => {
  const preview = createBenchmarkPreview({
    executor: "codex",
    benchmarkId: "benchmark_injected_executor_001",
    budget: { estimatedCostMicros: 500000 }
  });
  const requests = [];
  const result = await runBenchmark({
    preview,
    initiatedBy: "user",
    executionMode: "foreground",
    authorization: {
      granted: true,
      grantedInCurrentRun: true,
      previewToken: preview.previewToken
    },
    budgetConfirmation: {
      confirmed: true,
      previewToken: preview.previewToken
    },
    startedAt: "2026-01-02T00:00:00.000Z",
    execute: async (request) => {
      requests.push(request);
      return successfulExecution(request);
    }
  });

  assert.equal(requests.length, 24);
  assert.ok(requests.every((request) => request.executionMode === "foreground"));
  assert.ok(requests.every((request) => request.limits.tokenLimit <= 5000));
  assert.equal(result.executor, "codex");
  assert.equal(result.initiatedBy, "user");
  assert.deepEqual(result.authorization, { required: true, granted: true });
  assert.equal(contracts.validateBenchmarkResult(result).valid, true);
});

test("hard budget exhaustion is explicit and never counted as a policy failure", async () => {
  const preview = createBenchmarkPreview({
    benchmarkId: "benchmark_budget_exhausted_001",
    budget: { tokenLimit: 100 }
  });
  const result = await runBenchmark({ preview });
  assert.equal(result.status, "budget_exhausted");
  assert.equal(result.publicReason, "budget_exhausted");
  assert.equal(result.budget.exhausted, true);
  assert.equal(result.budget.consumedTokens, 100);
  assert.equal(contracts.validateBenchmarkResult(result).valid, true);

  const assessment = getBenchmarkAssessment(result);
  assert.equal(assessment.policyFailureCounted, false);
  assert.equal(assessment.budgetExhaustionIsPolicyFailure, false);
  assert.equal(assessment.efficiencyEvaluated, false);
});

test("quality and safety gate efficiency evaluation", async () => {
  const preview = createBenchmarkPreview({ benchmarkId: "benchmark_quality_gate_001" });
  const result = await runBenchmark({
    preview,
    execute: async (request) => {
      if (request.arm === "candidate" && request.taskIndex === 0) {
        return successfulExecution(request, { completed: false, acceptancePassed: false });
      }
      return successfulExecution(request);
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.safety.qualityGatePassed, false);
  const assessment = getBenchmarkAssessment(result);
  assert.equal(assessment.efficiencyEvaluated, false);
  assert.equal(assessment.efficiency, null);
});

test("default fake benchmark result is deterministic", async () => {
  const preview = createBenchmarkPreview({ benchmarkId: "benchmark_determinism_001" });
  const first = await runBenchmark({ preview });
  const second = await runBenchmark({ preview });
  assert.deepEqual(second, first);
  assert.equal(contracts.validateBenchmarkResult(first).valid, true);
});
