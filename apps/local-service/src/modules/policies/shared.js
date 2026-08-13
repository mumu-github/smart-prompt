"use strict";

const crypto = require("node:crypto");
const contracts = require("../../../../../packages/outcome-learning");

const REGISTRY_SCHEMA_VERSION = "generation-policy-registry@1";
const DEFAULT_CANARY_SHARE_BPS = 1000;
const DEFAULT_MINIMUMS = Object.freeze({
  perArmAttributableOutcomes: 10,
  tokenImprovementRatio: 0.05,
  minimumEffectRatio: 0.03,
  confidenceThreshold: 0.9
});
const CONTEXT_BUDGET_LIMITS = Object.freeze({
  minInputTokens: 256,
  maxInputTokens: 4096,
  maxContextSourceTokens: 1024
});
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/;
const CREDENTIAL_PATTERN = /(?:^|[._:@-])(?:secret|credential|api[_-]?key|private[_-]?key|password)(?:$|[._:@-])|^sk-[A-Za-z0-9_-]{12,}$|^AKIA[A-Z0-9]{12,}$|^gh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}$|^github_pat_[A-Za-z0-9_]{20,}$|^xox[a-z]-[A-Za-z0-9-]{12,}$|^AIza[A-Za-z0-9_-]{20,}$|^ya29\.[A-Za-z0-9_-]{20,}$/i;
const POLICY_STATUS_SET = new Set(contracts.ENUMS.generationPolicyStatus);
const ROLLOUT_STATUS_SET = new Set(contracts.ENUMS.policyRolloutStatus);
const ROLLBACK_REASON_SET = new Set(contracts.ENUMS.rollbackReason);

class GenerationPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GenerationPolicyError";
    this.code = code;
  }
}

function policyError(code, message) {
  return new GenerationPolicyError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeToken(value, fallback = "", maxLength = 180) {
  const token = String(value ?? "").trim().slice(0, Math.min(maxLength, 180));
  if (!TOKEN_PATTERN.test(token) || CREDENTIAL_PATTERN.test(token)) return fallback;
  return token;
}

function requireToken(value, field) {
  const token = safeToken(value);
  if (!token) throw policyError("invalid_policy_token", `${field} must be a bounded opaque token.`);
  return token;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

function clampInteger(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.trunc(clamp(fallback, min, max));
  return Math.trunc(clamp(number, min, max));
}

function canonicalTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw policyError("invalid_policy_timestamp", "The injected clock must return a valid timestamp.");
  }
  return date.toISOString();
}

function clockTimestamp(clock) {
  const now = typeof clock === "function" ? clock() : new Date();
  return canonicalTimestamp(now);
}

function hashToken(prefix, value, length = 20) {
  const digest = crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
  return `${prefix}_${digest.slice(0, length)}`;
}

function normalizeScope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const kind = safeToken(source.kind || "project", "project", 40);
  const target = safeToken(source.target || "codex", "codex", 40);
  if (kind !== "project" || target !== "codex") {
    throw policyError(
      "automatic_policy_scope_forbidden",
      "Generation Policy v1 is limited to project-scoped Codex policies."
    );
  }
  return deepFreeze({
    kind,
    target,
    projectScopeToken: requireToken(source.projectScopeToken, "scope.projectScopeToken"),
    taskScenarioToken: requireToken(
      source.taskScenarioToken || source.taskScenario,
      "scope.taskScenarioToken"
    ),
    modelFamilyToken: requireToken(
      source.modelFamilyToken || source.modelFamily,
      "scope.modelFamilyToken"
    )
  });
}

function scopeKey(scope = {}) {
  return [
    safeToken(scope.kind),
    safeToken(scope.target),
    safeToken(scope.projectScopeToken),
    safeToken(scope.taskScenarioToken),
    safeToken(scope.modelFamilyToken)
  ].join("|");
}

function sameScope(left = {}, right = {}) {
  return scopeKey(left) === scopeKey(right) && !scopeKey(left).includes("||");
}

function policyIdentity(policy = {}) {
  return `${safeToken(policy.policyId)}@${clampInteger(policy.version, 0, Number.MAX_SAFE_INTEGER, 0)}`;
}

function validatePolicy(policy) {
  try {
    const value = contracts.assertValidContract(contracts.CONTRACTS.GENERATION_POLICY, policy);
    const tokens = [
      value.policyId,
      value.scope.kind,
      value.scope.target,
      value.scope.projectScopeToken,
      value.scope.taskScenarioToken,
      value.scope.modelFamilyToken,
      value.selectedStrategy.strategyId,
      value.selectedStrategy.strategyVersion,
      ...value.directives.flatMap((directive) => [
        directive.directiveId,
        directive.kind,
        directive.valueToken
      ])
    ];
    if (tokens.some((token) => safeToken(token) !== token)) {
      throw policyError("unsafe_generation_policy_token", "Generation Policy tokens must not contain credential-shaped values.");
    }
    return value;
  } catch (error) {
    if (error instanceof contracts.ContractValidationError) {
      const wrapped = policyError("invalid_generation_policy", error.message);
      wrapped.validationErrors = error.errors;
      throw wrapped;
    }
    throw error;
  }
}

function validateRollout(rollout) {
  try {
    const value = contracts.assertValidContract(contracts.CONTRACTS.POLICY_ROLLOUT, rollout);
    const tokens = [
      value.rolloutId,
      value.policyId,
      value.projectScopeToken,
      value.status,
      value.rollbackReasonToken
    ];
    if (tokens.some((token) => safeToken(token) !== token)) {
      throw policyError("unsafe_policy_rollout_token", "Policy rollout tokens must not contain credential-shaped values.");
    }
    return value;
  } catch (error) {
    if (error instanceof contracts.ContractValidationError) {
      const wrapped = policyError("invalid_policy_rollout", error.message);
      wrapped.validationErrors = error.errors;
      throw wrapped;
    }
    throw error;
  }
}

function validateBenchmark(benchmark) {
  try {
    const value = contracts.assertValidContract(contracts.CONTRACTS.BENCHMARK_RESULT, benchmark);
    const tokens = [
      value.benchmarkId,
      value.modelFamilyToken,
      value.fixtureSetToken,
      value.status,
      value.executor,
      value.initiatedBy,
      value.publicReason
    ];
    if (tokens.some((token) => safeToken(token) !== token)) {
      throw policyError("unsafe_policy_benchmark_token", "Benchmark tokens must not contain credential-shaped values.");
    }
    return value;
  } catch (error) {
    if (error instanceof contracts.ContractValidationError) {
      const wrapped = policyError("invalid_policy_benchmark", error.message);
      wrapped.validationErrors = error.errors;
      throw wrapped;
    }
    throw error;
  }
}

function safeStatus(value, fallback = "draft") {
  return POLICY_STATUS_SET.has(value) ? value : fallback;
}

function safeRolloutStatus(value, fallback = "planned") {
  return ROLLOUT_STATUS_SET.has(value) ? value : fallback;
}

function safeRollbackReason(value, fallback = "none") {
  return ROLLBACK_REASON_SET.has(value) ? value : fallback;
}

module.exports = {
  CONTEXT_BUDGET_LIMITS,
  DEFAULT_CANARY_SHARE_BPS,
  DEFAULT_MINIMUMS,
  GenerationPolicyError,
  REGISTRY_SCHEMA_VERSION,
  canonicalTimestamp,
  clamp,
  clampInteger,
  clockTimestamp,
  clone,
  contracts,
  deepFreeze,
  finiteNumber,
  hashToken,
  isPlainObject,
  normalizeScope,
  policyError,
  policyIdentity,
  requireToken,
  safeRollbackReason,
  safeRolloutStatus,
  safeStatus,
  safeToken,
  sameScope,
  scopeKey,
  validateBenchmark,
  validatePolicy,
  validateRollout
};
