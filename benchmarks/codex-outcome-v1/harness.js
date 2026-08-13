"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const contracts = require("../../packages/outcome-learning");

const PREVIEW_VERSION = "codex-outcome-benchmark-preview@1";
const FIXTURE_SET_PATH = path.join(__dirname, "fixtures.json");
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/;
const ARM_NAMES = Object.freeze(["baseline", "candidate"]);
const DEFAULT_BUDGET = Object.freeze({
  tokenLimit: 120000,
  maxAgentTurns: 6,
  maxRetries: 2,
  estimatedCostMicros: 0
});
const PREVIEW_FIELDS = Object.freeze([
  "previewVersion",
  "benchmarkId",
  "executor",
  "modelFamilyToken",
  "fixtureSetToken",
  "taskCount",
  "requestCount",
  "tokenLimit",
  "maxAgentTurns",
  "maxRetries",
  "estimatedCostMicros",
  "executionMode",
  "backgroundStartAllowed",
  "harnessNetworkAccess",
  "realExecutorRequirements",
  "previewToken"
]);

class BenchmarkGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BenchmarkGateError";
    this.code = code;
  }
}

class FixtureValidationError extends Error {
  constructor(errors) {
    super(`Invalid Codex benchmark fixture set: ${errors.join("; ")}`);
    this.name = "FixtureValidationError";
    this.code = "fixture_validation_failed";
    this.errors = Object.freeze([...errors]);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digestToken(prefix, value) {
  const digest = crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `${prefix}_${digest.slice(0, 40)}`;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function scanSyntheticStrings(value, at = "$") {
  const errors = [];
  const windowsAbsolutePath = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\)[^\s"')]+/;
  const userHomePath = /(?:^|[\s"'(])\/(?:Users|home)\/[^\s"')]+/;
  const credentialShape = /(?:\bBearer\s+\S{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{12,})/i;

  function visit(item, itemPath) {
    if (typeof item === "string") {
      if (windowsAbsolutePath.test(item) || userHomePath.test(item)) {
        errors.push(`${itemPath} contains an absolute project-like path`);
      }
      if (credentialShape.test(item)) errors.push(`${itemPath} contains a credential-shaped value`);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${itemPath}[${index}]`));
      return;
    }
    if (isPlainObject(item)) {
      for (const [key, child] of Object.entries(item)) visit(child, `${itemPath}.${key}`);
    }
  }

  visit(value, at);
  return errors;
}

function validateFixtureSet(fixtureSet) {
  const errors = [];
  const categoryCounts = Object.fromEntries(
    contracts.ENUMS.benchmarkCategory.map((category) => [category, 0])
  );

  if (!isPlainObject(fixtureSet)) {
    return deepFreeze({ valid: false, errors: ["fixture set must be an object"], categoryCounts, requestCount: 0 });
  }
  if (fixtureSet.fixtureSetVersion !== "codex-outcome-fixtures@1") {
    errors.push("fixtureSetVersion must be codex-outcome-fixtures@1");
  }
  if (!TOKEN_PATTERN.test(String(fixtureSet.fixtureSetToken || ""))) {
    errors.push("fixtureSetToken must be an opaque token");
  }
  if (fixtureSet.syntheticOnly !== true) errors.push("syntheticOnly must be true");
  if (!Array.isArray(fixtureSet.tasks)) errors.push("tasks must be an array");

  const tasks = Array.isArray(fixtureSet.tasks) ? fixtureSet.tasks : [];
  if (tasks.length !== 12) errors.push("fixture set must contain exactly 12 tasks");
  const seenTaskIds = new Set();

  tasks.forEach((task, index) => {
    const taskPath = `$.tasks[${index}]`;
    if (!isPlainObject(task)) {
      errors.push(`${taskPath} must be an object`);
      return;
    }
    if (!TOKEN_PATTERN.test(String(task.taskId || ""))) errors.push(`${taskPath}.taskId must be an opaque token`);
    if (seenTaskIds.has(task.taskId)) errors.push(`${taskPath}.taskId must be unique`);
    seenTaskIds.add(task.taskId);

    if (!Object.hasOwn(categoryCounts, task.category)) {
      errors.push(`${taskPath}.category is unsupported`);
    } else {
      categoryCounts[task.category] += 1;
    }

    if (task.repository?.kind !== "synthetic") errors.push(`${taskPath}.repository.kind must be synthetic`);
    const startingPointToken = task.repository?.startingPointToken;
    if (!TOKEN_PATTERN.test(String(startingPointToken || ""))) {
      errors.push(`${taskPath}.repository.startingPointToken must be an opaque token`);
    }

    const baselineInput = task.inputs?.baseline;
    const candidateInput = task.inputs?.candidate;
    if (baselineInput?.kind !== "raw-input" || typeof baselineInput?.text !== "string" || !baselineInput.text.trim()) {
      errors.push(`${taskPath}.inputs.baseline must contain a non-empty raw-input`);
    }
    if (candidateInput?.kind !== "optimized-input" || typeof candidateInput?.text !== "string" || !candidateInput.text.trim()) {
      errors.push(`${taskPath}.inputs.candidate must contain a non-empty optimized-input`);
    }
    if (baselineInput?.text === candidateInput?.text) errors.push(`${taskPath} arms must use distinct inputs`);

    const acceptance = task.acceptance;
    if (acceptance?.deterministic !== true) errors.push(`${taskPath}.acceptance must be deterministic`);
    if (acceptance?.manualJudgmentRequired !== false) errors.push(`${taskPath}.acceptance cannot require manual judgment`);
    if (acceptance?.networkAllowed !== false) errors.push(`${taskPath}.acceptance cannot use the network`);
    if (!TOKEN_PATTERN.test(String(acceptance?.definitionToken || ""))) {
      errors.push(`${taskPath}.acceptance.definitionToken must be an opaque token`);
    }
    if (!Array.isArray(acceptance?.runner) || acceptance.runner.length < 2 || acceptance.runner[0] !== "node") {
      errors.push(`${taskPath}.acceptance.runner must be a deterministic local Node command`);
    }
    if (!Array.isArray(acceptance?.assertionTokens) || acceptance.assertionTokens.length === 0) {
      errors.push(`${taskPath}.acceptance.assertionTokens must not be empty`);
    }

    const baselineArm = task.arms?.baseline;
    const candidateArm = task.arms?.candidate;
    if (!isPlainObject(baselineArm) || !isPlainObject(candidateArm)) {
      errors.push(`${taskPath}.arms must contain baseline and candidate`);
      return;
    }
    if (baselineArm.inputKind !== "raw-input" || candidateArm.inputKind !== "optimized-input") {
      errors.push(`${taskPath}.arms input kinds do not match the paired inputs`);
    }
    for (const [armName, arm] of Object.entries({ baseline: baselineArm, candidate: candidateArm })) {
      if (arm.startingPointToken !== startingPointToken) {
        errors.push(`${taskPath}.arms.${armName} has a different starting point`);
      }
      if (arm.acceptanceDefinitionToken !== acceptance?.definitionToken) {
        errors.push(`${taskPath}.arms.${armName} has a different acceptance definition`);
      }
      if (!TOKEN_PATTERN.test(String(arm.modelFamilyToken || ""))) {
        errors.push(`${taskPath}.arms.${armName}.modelFamilyToken must be an opaque token`);
      }
      if (!TOKEN_PATTERN.test(String(arm.permissionProfileToken || ""))) {
        errors.push(`${taskPath}.arms.${armName}.permissionProfileToken must be an opaque token`);
      }
      if (!isPositiveInteger(arm.budget?.tokenLimit)
        || !isPositiveInteger(arm.budget?.maxAgentTurns)
        || !isNonNegativeInteger(arm.budget?.maxRetries)) {
        errors.push(`${taskPath}.arms.${armName}.budget is invalid`);
      }
    }
    if (baselineArm.modelFamilyToken !== candidateArm.modelFamilyToken) {
      errors.push(`${taskPath} arms must use the same model family`);
    }
    if (baselineArm.permissionProfileToken !== candidateArm.permissionProfileToken) {
      errors.push(`${taskPath} arms must use the same permissions`);
    }
    if (!sameValue(baselineArm.budget, candidateArm.budget)) {
      errors.push(`${taskPath} arms must use the same budget`);
    }
  });

  for (const [category, count] of Object.entries(categoryCounts)) {
    if (count !== 2) errors.push(`${category} must contain exactly two tasks`);
  }
  errors.push(...scanSyntheticStrings(fixtureSet));

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    categoryCounts,
    requestCount: tasks.length * ARM_NAMES.length
  });
}

function loadFixtureSet() {
  const parsed = JSON.parse(fs.readFileSync(FIXTURE_SET_PATH, "utf8"));
  const validation = validateFixtureSet(parsed);
  if (!validation.valid) throw new FixtureValidationError(validation.errors);
  return deepFreeze(parsed);
}

const FIXTURE_SET = loadFixtureSet();

function assertToken(value, fieldName) {
  if (!TOKEN_PATTERN.test(String(value || ""))) {
    throw new BenchmarkGateError("preview_invalid", `${fieldName} must be an opaque token.`);
  }
}

function resolveBudget(executor, suppliedBudget) {
  const source = isPlainObject(suppliedBudget) ? suppliedBudget : {};
  const budget = { ...DEFAULT_BUDGET, ...source };
  if (!isPositiveInteger(budget.tokenLimit)) {
    throw new BenchmarkGateError("preview_invalid", "tokenLimit must be a positive integer.");
  }
  if (!isPositiveInteger(budget.maxAgentTurns)) {
    throw new BenchmarkGateError("preview_invalid", "maxAgentTurns must be a positive integer.");
  }
  if (!isNonNegativeInteger(budget.maxRetries)) {
    throw new BenchmarkGateError("preview_invalid", "maxRetries must be a non-negative integer.");
  }
  if (!isNonNegativeInteger(budget.estimatedCostMicros)) {
    throw new BenchmarkGateError("preview_invalid", "estimatedCostMicros must be a non-negative integer.");
  }
  if (executor === "fake" && budget.estimatedCostMicros !== 0) {
    throw new BenchmarkGateError("fake_cost_forbidden", "The fake executor must have zero estimated cost.");
  }
  if (executor === "codex" && !Object.hasOwn(source, "estimatedCostMicros")) {
    throw new BenchmarkGateError("estimated_cost_required", "A real Codex preview requires an explicit cost estimate.");
  }
  return budget;
}

function previewPayload(preview) {
  return Object.fromEntries(
    PREVIEW_FIELDS
      .filter((field) => field !== "previewToken")
      .map((field) => [field, preview[field]])
  );
}

function createBenchmarkPreview(options = {}) {
  const fixtureValidation = validateFixtureSet(FIXTURE_SET);
  if (!fixtureValidation.valid) throw new FixtureValidationError(fixtureValidation.errors);

  const executor = options.executor || "fake";
  if (!contracts.ENUMS.benchmarkExecutor.includes(executor)) {
    throw new BenchmarkGateError("preview_invalid", "executor must be fake or codex.");
  }
  const benchmarkId = options.benchmarkId || `benchmark_codex_outcome_v1_${executor}`;
  const modelFamilyToken = options.modelFamilyToken || "model_family_codex_fixture";
  assertToken(benchmarkId, "benchmarkId");
  assertToken(modelFamilyToken, "modelFamilyToken");
  const budget = resolveBudget(executor, options.budget);

  const payload = {
    previewVersion: PREVIEW_VERSION,
    benchmarkId,
    executor,
    modelFamilyToken,
    fixtureSetToken: FIXTURE_SET.fixtureSetToken,
    taskCount: FIXTURE_SET.tasks.length,
    requestCount: fixtureValidation.requestCount,
    tokenLimit: budget.tokenLimit,
    maxAgentTurns: budget.maxAgentTurns,
    maxRetries: budget.maxRetries,
    estimatedCostMicros: budget.estimatedCostMicros,
    executionMode: "foreground",
    backgroundStartAllowed: false,
    harnessNetworkAccess: "none",
    realExecutorRequirements: {
      userInitiator: true,
      currentRunAuthorization: true,
      budgetConfirmation: true,
      injectedExecutionFunction: true
    }
  };
  return deepFreeze({ ...payload, previewToken: digestToken("preview", payload) });
}

function assertPreview(preview) {
  if (!isPlainObject(preview)) throw new BenchmarkGateError("preview_required", "Create and review a benchmark preview first.");
  const unknownFields = Object.keys(preview).filter((field) => !PREVIEW_FIELDS.includes(field));
  const missingFields = PREVIEW_FIELDS.filter((field) => !Object.hasOwn(preview, field));
  if (unknownFields.length || missingFields.length) {
    throw new BenchmarkGateError("preview_invalid", "The benchmark preview shape is invalid.");
  }
  if (preview.previewVersion !== PREVIEW_VERSION
    || preview.fixtureSetToken !== FIXTURE_SET.fixtureSetToken
    || preview.taskCount !== FIXTURE_SET.tasks.length
    || preview.requestCount !== FIXTURE_SET.tasks.length * ARM_NAMES.length
    || preview.executionMode !== "foreground"
    || preview.backgroundStartAllowed !== false
    || preview.harnessNetworkAccess !== "none") {
    throw new BenchmarkGateError("preview_invalid", "The benchmark preview does not match this fixture set.");
  }
  const expectedToken = digestToken("preview", previewPayload(preview));
  if (preview.previewToken !== expectedToken) {
    throw new BenchmarkGateError("preview_tampered", "The benchmark preview changed after it was created.");
  }
  resolveBudget(preview.executor, {
    tokenLimit: preview.tokenLimit,
    maxAgentTurns: preview.maxAgentTurns,
    maxRetries: preview.maxRetries,
    estimatedCostMicros: preview.estimatedCostMicros
  });
  assertToken(preview.benchmarkId, "benchmarkId");
  assertToken(preview.modelFamilyToken, "modelFamilyToken");
  return preview;
}

function formatPreview(preview) {
  assertPreview(preview);
  return [
    "Codex outcome benchmark preview",
    `model: ${preview.modelFamilyToken}`,
    `requests: ${preview.requestCount}`,
    `token limit: ${preview.tokenLimit}`,
    `max agent turns per request: ${preview.maxAgentTurns}`,
    `max retries per request: ${preview.maxRetries}`,
    `estimated cost: ${preview.estimatedCostMicros} micros`,
    `executor: ${preview.executor}`,
    "execution: foreground only"
  ].join("\n");
}

function assertRealExecutorGate(options, preview) {
  if (options.initiatedBy !== "user") {
    throw new BenchmarkGateError("user_initiator_required", "The real Codex executor must be started explicitly by the user.");
  }
  if (options.executionMode !== "foreground") {
    throw new BenchmarkGateError("foreground_execution_required", "The real Codex executor cannot start in the background.");
  }
  const authorization = options.authorization;
  if (authorization?.granted !== true
    || authorization?.grantedInCurrentRun !== true
    || authorization?.previewToken !== preview.previewToken) {
    throw new BenchmarkGateError(
      "current_run_authorization_required",
      "The real Codex executor requires authorization granted for this preview in the current run."
    );
  }
  const budgetConfirmation = options.budgetConfirmation;
  if (budgetConfirmation?.confirmed !== true || budgetConfirmation?.previewToken !== preview.previewToken) {
    throw new BenchmarkGateError(
      "budget_confirmation_required",
      "Confirm the displayed request, token, turn, retry, and cost budget for this preview."
    );
  }
  if (typeof options.execute !== "function") {
    throw new BenchmarkGateError(
      "executor_function_required",
      "Pass the foreground Codex execution function explicitly; the harness never starts one itself."
    );
  }
}

function createRequestSequence(preview) {
  return FIXTURE_SET.tasks.flatMap((task, taskIndex) => ARM_NAMES.map((armName) => {
    const arm = task.arms[armName];
    return deepFreeze({
      requestId: `${task.taskId}_${armName}`,
      requestOrdinal: taskIndex * ARM_NAMES.length + ARM_NAMES.indexOf(armName),
      executionMode: "foreground",
      taskIndex,
      taskId: task.taskId,
      category: task.category,
      arm: armName,
      input: task.inputs[armName].text,
      inputKind: task.inputs[armName].kind,
      repository: task.repository,
      acceptance: task.acceptance,
      startingPointToken: arm.startingPointToken,
      modelFamilyToken: preview.modelFamilyToken,
      permissionProfileToken: arm.permissionProfileToken,
      configuredBudget: arm.budget
    });
  }));
}

async function defaultFakeExecutor(request) {
  const desiredTokens = (request.arm === "baseline" ? 1850 : 1620) + request.taskIndex * 17;
  const tokenAllowance = request.limits.tokenLimit;
  const budgetExhausted = desiredTokens > tokenAllowance;
  const retries = request.arm === "baseline" && request.taskIndex % 4 === 0 ? 1 : 0;
  return {
    completed: !budgetExhausted,
    acceptancePassed: !budgetExhausted,
    safety: {
      safeExecution: true,
      noAutoSubmit: true,
      privacy: true,
      permission: true
    },
    usage: {
      tokens: Math.min(desiredTokens, tokenAllowance),
      durationMs: (request.arm === "baseline" ? 1050 : 920) + request.taskIndex * 13,
      retries: Math.min(retries, request.limits.maxRetries),
      toolCalls: request.arm === "baseline" ? 4 : 3,
      agentTurns: Math.min(3, request.limits.maxAgentTurns)
    },
    budgetExhausted
  };
}

function normalizeExecutorResult(value) {
  if (!isPlainObject(value)) {
    throw new BenchmarkGateError("executor_result_invalid", "The executor result must be an object.");
  }
  for (const field of ["completed", "acceptancePassed", "budgetExhausted"]) {
    if (typeof value[field] !== "boolean") {
      throw new BenchmarkGateError("executor_result_invalid", `${field} must be boolean.`);
    }
  }
  if (value.acceptancePassed && !value.completed) {
    throw new BenchmarkGateError("executor_result_invalid", "Acceptance cannot pass for an incomplete task.");
  }
  const safetyFields = ["safeExecution", "noAutoSubmit", "privacy", "permission"];
  if (!isPlainObject(value.safety) || safetyFields.some((field) => typeof value.safety[field] !== "boolean")) {
    throw new BenchmarkGateError("executor_result_invalid", "The executor must return all finite safety booleans.");
  }
  const usageFields = ["tokens", "durationMs", "retries", "toolCalls", "agentTurns"];
  if (!isPlainObject(value.usage) || usageFields.some((field) => !isNonNegativeInteger(value.usage[field]))) {
    throw new BenchmarkGateError("executor_result_invalid", "The executor must return non-negative integer usage metrics.");
  }
  return value;
}

function createEmptyArmMetrics() {
  return {
    completedTasks: 0,
    safetyPassedTasks: 0,
    totalTokens: 0,
    totalDurationMs: 0,
    totalRetries: 0,
    totalToolCalls: 0
  };
}

function addExecutionMetrics(metrics, execution) {
  if (execution.completed && execution.acceptancePassed) metrics.completedTasks += 1;
  if (execution.safety.safeExecution
    && execution.safety.noAutoSubmit
    && execution.safety.privacy
    && execution.safety.permission) {
    metrics.safetyPassedTasks += 1;
  }
  metrics.totalTokens += execution.usage.tokens;
  metrics.totalDurationMs += execution.usage.durationMs;
  metrics.totalRetries += execution.usage.retries;
  metrics.totalToolCalls += execution.usage.toolCalls;
}

function toTimestamp(value, fallback) {
  const timestamp = value || fallback;
  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) {
    throw new BenchmarkGateError("started_at_invalid", "startedAt must be an ISO timestamp.");
  }
  return new Date(timestamp).toISOString();
}

function contractAssert(result) {
  const validation = contracts.validateBenchmarkResult(result);
  if (!validation.valid) {
    const codes = validation.errors.map((error) => error.code).join(",");
    throw new BenchmarkGateError("result_contract_invalid", `benchmark-result@1 validation failed: ${codes}`);
  }
  return result;
}

async function runBenchmark(options = {}) {
  const preview = assertPreview(options.preview);
  const executionMode = options.executionMode || "foreground";
  if (executionMode !== "foreground") {
    throw new BenchmarkGateError("foreground_execution_required", "Benchmark execution is foreground only.");
  }
  if (preview.executor === "codex") assertRealExecutorGate({ ...options, executionMode }, preview);

  const execute = preview.executor === "fake"
    ? (typeof options.execute === "function" ? options.execute : defaultFakeExecutor)
    : options.execute;
  const sequence = createRequestSequence(preview);
  const arms = { baseline: createEmptyArmMetrics(), candidate: createEmptyArmMetrics() };
  const safetyState = {
    safeExecution: true,
    noAutoSubmit: true,
    privacy: true,
    permission: true
  };
  let consumedTokens = 0;
  let processedRequests = 0;
  let budgetExhausted = false;
  let executorFailed = false;
  const startedAt = toTimestamp(
    options.startedAt,
    preview.executor === "fake" ? FIXTURE_SET.deterministicStartedAt : new Date().toISOString()
  );

  for (const request of sequence) {
    const remainingTokens = preview.tokenLimit - consumedTokens;
    if (remainingTokens <= 0) {
      budgetExhausted = true;
      break;
    }
    const limits = deepFreeze({
      tokenLimit: Math.min(request.configuredBudget.tokenLimit, remainingTokens),
      maxAgentTurns: Math.min(request.configuredBudget.maxAgentTurns, preview.maxAgentTurns),
      maxRetries: Math.min(request.configuredBudget.maxRetries, preview.maxRetries)
    });

    let execution;
    try {
      execution = normalizeExecutorResult(await execute(deepFreeze({ ...request, limits })));
    } catch (error) {
      if (error instanceof BenchmarkGateError) throw error;
      executorFailed = true;
      break;
    }

    addExecutionMetrics(arms[request.arm], execution);
    consumedTokens += execution.usage.tokens;
    processedRequests += 1;
    safetyState.safeExecution = safetyState.safeExecution && execution.safety.safeExecution;
    safetyState.noAutoSubmit = safetyState.noAutoSubmit && execution.safety.noAutoSubmit;
    safetyState.privacy = safetyState.privacy && execution.safety.privacy;
    safetyState.permission = safetyState.permission && execution.safety.permission;

    const exceededRequestLimit = execution.usage.tokens > limits.tokenLimit
      || execution.usage.agentTurns > limits.maxAgentTurns
      || execution.usage.retries > limits.maxRetries;
    const globalLimitReachedEarly = consumedTokens >= preview.tokenLimit && processedRequests < sequence.length;
    if (execution.budgetExhausted || exceededRequestLimit || globalLimitReachedEarly) {
      budgetExhausted = true;
      break;
    }
  }

  const allRequestsProcessed = processedRequests === sequence.length;
  const qualityGatePassed = allRequestsProcessed
    && arms.baseline.completedTasks === FIXTURE_SET.tasks.length
    && arms.candidate.completedTasks === FIXTURE_SET.tasks.length
    && arms.candidate.completedTasks >= arms.baseline.completedTasks;
  const noAutoSubmitPassed = safetyState.safeExecution && safetyState.noAutoSubmit;
  const privacyPassed = safetyState.privacy;
  const permissionPassed = safetyState.permission;

  let status = "passed";
  let publicReason = "none";
  if (budgetExhausted) {
    status = "budget_exhausted";
    publicReason = "budget_exhausted";
  } else if (!permissionPassed) {
    status = "failed";
    publicReason = "permission_required";
  } else if (!privacyPassed) {
    status = "failed";
    publicReason = "privacy_blocked";
  } else if (!noAutoSubmitPassed) {
    status = "failed";
    publicReason = "safety_blocked";
  } else if (!qualityGatePassed || executorFailed) {
    status = "failed";
    publicReason = executorFailed ? "model_unavailable" : "benchmark_incomplete";
  }

  const fixtureValidation = validateFixtureSet(FIXTURE_SET);
  const totalDurationMs = arms.baseline.totalDurationMs + arms.candidate.totalDurationMs;
  const finishedAt = new Date(Date.parse(startedAt) + totalDurationMs).toISOString();
  const result = {
    contractVersion: contracts.CONTRACT_VERSIONS.benchmark_result,
    benchmarkId: preview.benchmarkId,
    status,
    executor: preview.executor,
    initiatedBy: preview.executor === "codex" ? "user" : "test",
    authorization: {
      required: preview.executor === "codex",
      granted: preview.executor === "codex"
    },
    modelFamilyToken: preview.modelFamilyToken,
    fixtureSetToken: preview.fixtureSetToken,
    taskCount: FIXTURE_SET.tasks.length,
    categoryCounts: { ...fixtureValidation.categoryCounts },
    comparability: {
      sameModelFamily: true,
      sameStartingPoint: true,
      samePermissions: true,
      sameBudget: true,
      deterministicAcceptance: true
    },
    budget: {
      tokenLimit: preview.tokenLimit,
      maxAgentTurns: preview.maxAgentTurns,
      maxRetries: preview.maxRetries,
      estimatedCostMicros: preview.executor === "fake" ? 0 : preview.estimatedCostMicros,
      consumedTokens,
      exhausted: budgetExhausted
    },
    arms,
    safety: {
      qualityGatePassed,
      noAutoSubmitPassed,
      privacyPassed,
      permissionPassed
    },
    startedAt,
    finishedAt,
    publicReason,
    privacyFlags: { ...contracts.DEFAULT_PRIVACY_FLAGS }
  };

  return deepFreeze(contractAssert(result));
}

function getBenchmarkAssessment(result) {
  contractAssert(result);
  const qualityAndSafetyPassed = result.status === "passed"
    && result.safety.qualityGatePassed
    && result.safety.noAutoSubmitPassed
    && result.safety.privacyPassed
    && result.safety.permissionPassed;
  let efficiency = null;
  if (qualityAndSafetyPassed) {
    const baselineTokens = result.arms.baseline.totalTokens;
    const candidateTokens = result.arms.candidate.totalTokens;
    efficiency = {
      tokenDelta: candidateTokens - baselineTokens,
      tokenDeltaRatio: baselineTokens === 0 ? null : (candidateTokens - baselineTokens) / baselineTokens,
      durationDeltaMs: result.arms.candidate.totalDurationMs - result.arms.baseline.totalDurationMs,
      retryDelta: result.arms.candidate.totalRetries - result.arms.baseline.totalRetries,
      toolCallDelta: result.arms.candidate.totalToolCalls - result.arms.baseline.totalToolCalls
    };
  }
  const fakeEvidence = result.executor === "fake";
  return deepFreeze({
    decisionOrder: ["quality", "safety", "efficiency"],
    qualityAndSafetyPassed,
    efficiencyEvaluated: efficiency !== null,
    efficiency,
    evidenceScope: fakeEvidence ? "harness_only" : "isolated_codex_run",
    productionEvidence: !fakeEvidence && result.status === "passed",
    automaticPromotionEligible: false,
    policyFailureCounted: result.status === "failed" && !fakeEvidence,
    budgetExhaustionIsPolicyFailure: false
  });
}

module.exports = Object.freeze({
  PREVIEW_VERSION,
  DEFAULT_BUDGET,
  FIXTURE_SET,
  BenchmarkGateError,
  FixtureValidationError,
  validateFixtureSet,
  scanSyntheticStrings,
  createBenchmarkPreview,
  formatPreview,
  defaultFakeExecutor,
  runBenchmark,
  getBenchmarkAssessment
});
