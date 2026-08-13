"use strict";

const BUNDLE_VERSION = "outcome-learning@1";
const FIXTURE_SET_VERSION = "outcome-learning-contract-fixtures@1";
const LEARNING_CANDIDATE_SEED_VERSION = "learning-candidate-seed@1";

const CONTRACTS = Object.freeze({
  PROMPT_SESSION_EVENT: "prompt_session_event",
  CODEX_TARGET_ADAPTER_RESULT: "codex_target_adapter_result",
  PENDING_OUTCOME: "pending_outcome",
  LEARNING_OBSERVATION: "learning_observation",
  LEARNING_ARTIFACT: "learning_artifact",
  GENERATION_POLICY: "generation_policy",
  POLICY_ROLLOUT: "policy_rollout",
  BENCHMARK_RESULT: "benchmark_result",
  RUNTIME_EVIDENCE: "runtime_evidence",
  CONTEXT_SOURCE: "context_source"
});

const CONTRACT_VERSIONS = Object.freeze({
  [CONTRACTS.PROMPT_SESSION_EVENT]: "prompt-session@2",
  [CONTRACTS.CODEX_TARGET_ADAPTER_RESULT]: "codex-target-adapter-result@1",
  [CONTRACTS.PENDING_OUTCOME]: "pending-outcome@1",
  [CONTRACTS.LEARNING_OBSERVATION]: "learning-observation@1",
  [CONTRACTS.LEARNING_ARTIFACT]: "learning-artifact@1",
  [CONTRACTS.GENERATION_POLICY]: "generation-policy@1",
  [CONTRACTS.POLICY_ROLLOUT]: "policy-rollout@1",
  [CONTRACTS.BENCHMARK_RESULT]: "benchmark-result@1",
  [CONTRACTS.RUNTIME_EVIDENCE]: "runtime-evidence@1",
  [CONTRACTS.CONTEXT_SOURCE]: "context-source@1"
});

function finiteEnum(values) {
  return Object.freeze([...values]);
}

const ENUMS = Object.freeze({
  promptSessionEventType: finiteEnum([
    "verified_insert",
    "insert_failed",
    "retry",
    "undo",
    "regenerated",
    "outcome_feedback",
    "outcome_expired",
    "policy_selected"
  ]),
  target: finiteEnum(["codex"]),
  adapterOperation: finiteEnum(["inspect", "read", "insert", "undo"]),
  adapterStatus: finiteEnum(["ready", "blocked", "copy_only", "failed"]),
  verification: finiteEnum(["none", "machine"]),
  writeMethod: finiteEnum(["none", "direct", "controlled_clipboard"]),
  publicReason: finiteEnum([
    "none",
    "target_unavailable",
    "target_not_ready",
    "target_changed",
    "readback_unavailable",
    "write_not_verified",
    "safety_blocked",
    "model_unavailable",
    "budget_exhausted",
    "privacy_blocked",
    "permission_required",
    "benchmark_incomplete",
    "unknown"
  ]),
  pendingOutcomeStatus: finiteEnum([
    "unknown",
    "succeeded",
    "failed",
    "expired_unknown",
    "invalidated"
  ]),
  taskOutcome: finiteEnum(["unknown", "completed", "not_completed", "expired_unknown", "invalidated"]),
  outcomeFailureReason: finiteEnum([
    "missing_context",
    "wrong_format",
    "not_actionable",
    "too_long",
    "token_waste",
    "tool_mismatch",
    "low_quality",
    "insert_failed"
  ]),
  tokenAccountingSource: finiteEnum(["provider", "estimated", "unavailable"]),
  fingerprintKind: finiteEnum(["keyed_feature_hash", "encrypted_local_embedding"]),
  fingerprintResidualRisk: finiteEnum(["unknown", "low", "accepted", "rejected"]),
  editLengthDeltaBucket: finiteEnum(["none", "small", "medium", "large"]),
  artifactType: finiteEnum(["memory", "rule", "skill", "generation_policy"]),
  artifactStatus: finiteEnum(["pending_review", "active", "rejected", "rolled_back", "archived"]),
  artifactScope: finiteEnum(["project", "global_proposal", "global"]),
  reviewDecision: finiteEnum(["pending", "accepted", "rejected"]),
  executionPermission: finiteEnum(["none", "review_required"]),
  scopeExpansionPermission: finiteEnum(["project_only", "user_confirmation_required"]),
  generationPolicyStatus: finiteEnum(["draft", "benchmarked", "canary", "stable", "rolled_back"]),
  policyRiskLevel: finiteEnum(["low", "high"]),
  policyDirectiveKind: finiteEnum([
    "structure_order",
    "detail_level",
    "deduplicate",
    "strategy_selection",
    "context_budget"
  ]),
  policyRolloutStatus: finiteEnum(["planned", "canary", "collecting", "promoted", "rolled_back", "paused"]),
  rollbackReason: finiteEnum([
    "none",
    "safety_incident",
    "auto_submit_incident",
    "miswrite_incident",
    "privacy_incident",
    "permission_incident",
    "quality_regression",
    "manual"
  ]),
  benchmarkStatus: finiteEnum(["not_run", "passed", "failed", "budget_exhausted"]),
  benchmarkExecutor: finiteEnum(["fake", "codex"]),
  benchmarkInitiator: finiteEnum(["test", "user"]),
  benchmarkCategory: finiteEnum([
    "feature_development",
    "bug_fix",
    "refactor",
    "test_completion",
    "code_review",
    "documentation"
  ]),
  runtimeEvidenceKind: finiteEnum([
    "contract_test",
    "node_runtime",
    "rust_runtime",
    "installed_runtime",
    "verified_insert",
    "privacy_scan",
    "benchmark"
  ]),
  runtimeConsumer: finiteEnum(["node", "rust", "desktop", "installed_app", "test"]),
  runtimeEvidenceStatus: finiteEnum(["pass", "fail", "blocked", "not_run"]),
  contextSourceType: finiteEnum(["chat_history", "current_screen", "project_files", "clipboard", "attachment"]),
  contextTrustLevel: finiteEnum(["untrusted"]),
  contextPermissionStatus: finiteEnum(["not_granted", "granted", "revoked"]),
  contextPreviewStatus: finiteEnum(["not_available", "available", "reviewed", "removed"]),
  contextCollectStatus: finiteEnum(["not_requested", "not_implemented", "collected", "blocked", "removed"]),
  promptInjectionRisk: finiteEnum(["unknown", "low", "medium", "high", "blocked"])
});

const ENUM_SETS = Object.freeze(Object.fromEntries(
  Object.entries(ENUMS).map(([name, values]) => [name, new Set(values)])
));

const PRIVACY_FLAG_NAMES = finiteEnum([
  "rawInputStored",
  "generatedPromptStored",
  "chatContentStored",
  "clipboardContentStored",
  "windowTitleStored",
  "absoluteProjectPathStored",
  "credentialStored",
  "rawEvidenceStored"
]);

const DEFAULT_PRIVACY_FLAGS = Object.freeze(Object.fromEntries(
  PRIVACY_FLAG_NAMES.map((name) => [name, false])
));

const FORBIDDEN_RAW_FIELDS = new Set([
  "prompt",
  "prompttext",
  "rawprompt",
  "path",
  "title",
  "key",
  "rawinput",
  "inputtext",
  "draft",
  "chatcontent",
  "chattext",
  "clipboardcontent",
  "clipboardtext",
  "windowtitle",
  "rawtitle",
  "projectpath",
  "absolutepath",
  "apikey",
  "api_key",
  "keymaterial",
  "secret",
  "credential",
  "rawevidence",
  "evidencetext",
  "rawuia",
  "rawdom",
  "embeddingvector",
  "vector"
]);

const PUBLIC_REASON_COPY = Object.freeze({
  none: Object.freeze({ title: "", message: "" }),
  target_unavailable: Object.freeze({ title: "Target unavailable", message: "Select the Codex input and try again." }),
  target_not_ready: Object.freeze({ title: "Target not ready", message: "Keep Codex visible and focused, then retry." }),
  target_changed: Object.freeze({ title: "Target changed", message: "Review the current target before retrying." }),
  readback_unavailable: Object.freeze({ title: "Readback unavailable", message: "The insert was not counted as verified." }),
  write_not_verified: Object.freeze({ title: "Insert not verified", message: "Nothing was counted as successfully inserted." }),
  safety_blocked: Object.freeze({ title: "Paused for safety", message: "The target could not be confirmed safely." }),
  model_unavailable: Object.freeze({ title: "Model unavailable", message: "Review model settings and try again." }),
  budget_exhausted: Object.freeze({ title: "Budget exhausted", message: "The benchmark stopped at its configured budget." }),
  privacy_blocked: Object.freeze({ title: "Blocked by privacy checks", message: "Sensitive data was not accepted." }),
  permission_required: Object.freeze({ title: "Permission required", message: "Review and grant the required permission first." }),
  benchmark_incomplete: Object.freeze({ title: "Benchmark incomplete", message: "More comparable evidence is required." }),
  unknown: Object.freeze({ title: "Action incomplete", message: "Retry or open diagnostics for more detail." })
});

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_PATH_PATTERN = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\)[^\s"')]+/;
const POSIX_HOME_PATH_PATTERN = /(?:^|[\s"'(])\/(?:Users|home)\/[^\s"')]+/;
const CREDENTIAL_VALUE_PATTERN = /(?:\bBearer\s+\S{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{12,})/i;
const MIN_FEEDBACK_DELAY_MS = 60 * 1000;
const OUTCOME_TTL_MS = 24 * 60 * 60 * 1000;

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

function normalizeReasonToken(value) {
  if (value && typeof value === "object") {
    return [value.code, value.reason, value.name, value.message]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
  }
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function mapPublicReason(value) {
  const token = normalizeReasonToken(value);
  if (!token || /^(none|ok|pass|passed|ready|inserted|succeeded|success)$/.test(token)) return "none";
  if (ENUM_SETS.publicReason.has(token)) return token;
  if (/(budget.*exhaust|exhaust.*budget)/.test(token)) return "budget_exhausted";
  if (/(privacy|secret|credential_leak|raw_content|sensitive)/.test(token)) return "privacy_blocked";
  if (/(permission|authorization|authorisation|consent|not_authorized|not_authorised)/.test(token)) return "permission_required";
  if (/(readback|read_back|machine_read|unreadable)/.test(token)) return "readback_unavailable";
  if (/(after_write_mismatch|write_mismatch|insert_failed|write_failed|paste_failed|not_verified)/.test(token)) return "write_not_verified";
  if (/(safe_candidate|unsafe|auto_submit|payload_guard|wrong_target|safety)/.test(token)) return "safety_blocked";
  if (/(target_changed|draft_changed|stale_payload|focus_changed|window_changed)/.test(token)) return "target_changed";
  if (/(not_foreground|not_focused|focus_required|target_not_ready)/.test(token)) return "target_not_ready";
  if (/(target_missing|not_found|hidden|minimized|cloaked|unsupported_target)/.test(token)) return "target_unavailable";
  if (/(model|provider|network|api_key|authentication|credential_invalid)/.test(token)) return "model_unavailable";
  if (/(benchmark|insufficient_evidence|not_run)/.test(token)) return "benchmark_incomplete";
  return "unknown";
}

function getPublicReason(value) {
  const code = mapPublicReason(value);
  return deepFreeze({ code, ...PUBLIC_REASON_COPY[code] });
}

function pathFor(parent, key) {
  return /^\d+$/.test(String(key)) ? `${parent}[${key}]` : `${parent}.${key}`;
}

function findPrivacyViolations(value) {
  const violations = [];
  const seen = new Set();

  function add(code, path, message) {
    const identity = `${code}:${path}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    violations.push({ code, path, message });
  }

  function visit(current, path, parentKey = "") {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, pathFor(path, index), parentKey));
      return;
    }
    if (isPlainObject(current)) {
      for (const [key, item] of Object.entries(current)) {
        const childPath = pathFor(path, key);
        const compactKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (FORBIDDEN_RAW_FIELDS.has(compactKey)) {
          add("privacy_forbidden_field", childPath, "Raw or sensitive fields are forbidden in persisted contracts.");
        }
        if (PRIVACY_FLAG_NAMES.includes(key) && item !== false) {
          add("privacy_flag", childPath, "Persisted privacy flags must remain false.");
        }
        visit(item, childPath, key);
      }
      return;
    }
    if (typeof current !== "string") return;
    if (WINDOWS_PATH_PATTERN.test(current) || POSIX_HOME_PATH_PATTERN.test(current)) {
      add("privacy_forbidden_value", path, "Absolute project or user paths are forbidden.");
    }
    if (CREDENTIAL_VALUE_PATTERN.test(current)) {
      add("privacy_forbidden_value", path, "Credential-shaped values are forbidden.");
    }
    if (/title|path|key|secret|credential/i.test(parentKey) && current.length > 180) {
      add("privacy_forbidden_value", path, "Sensitive metadata must be represented by a bounded token.");
    }
  }

  visit(value, "$");
  return violations;
}

class ContractValidationError extends Error {
  constructor(contract, errors) {
    super(`Invalid ${contract} contract: ${errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.errors = deepFreeze(errors.map((error) => ({ ...error })));
  }
}

function createContext(contract, value, allowedKeys, requiredKeys = allowedKeys) {
  const errors = [];
  const seenErrors = new Set();
  const add = (code, path, message) => {
    const identity = `${code}:${path}`;
    if (seenErrors.has(identity)) return;
    seenErrors.add(identity);
    errors.push({ code, path, message });
  };
  const ctx = { contract, value, errors, add, rootIsObject: isPlainObject(value) };
  if (!ctx.rootIsObject) {
    add("type", "$", "Expected an object.");
    return ctx;
  }
  checkObject(ctx, value, "$", requiredKeys, allowedKeys);
  if (value.contractVersion !== CONTRACT_VERSIONS[contract]) {
    add("contract_version", "$.contractVersion", `Expected ${CONTRACT_VERSIONS[contract]}.`);
  }
  for (const violation of findPrivacyViolations(value)) add(violation.code, violation.path, violation.message);
  validatePrivacyFlagsInto(ctx, value.privacyFlags, "$.privacyFlags");
  return ctx;
}

function finish(ctx) {
  return deepFreeze({
    valid: ctx.errors.length === 0,
    contract: ctx.contract,
    contractVersion: CONTRACT_VERSIONS[ctx.contract] || null,
    errors: ctx.errors.map((error) => ({ ...error }))
  });
}

function checkObject(ctx, value, path, requiredKeys = [], allowedKeys = requiredKeys) {
  if (!isPlainObject(value)) {
    ctx.add("type", path, "Expected an object.");
    return false;
  }
  const allowed = new Set(allowedKeys);
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) ctx.add("required", pathFor(path, key), "Required field is missing.");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) ctx.add("unknown_field", pathFor(path, key), "Field is not part of this contract version.");
  }
  return true;
}

function checkString(ctx, value, path, options = {}) {
  const { allowEmpty = false, maxLength = 600 } = options;
  if (typeof value !== "string") {
    ctx.add("type", path, "Expected a string.");
    return false;
  }
  if (!allowEmpty && value.length === 0) ctx.add("required", path, "String must not be empty.");
  if (value.length > maxLength) ctx.add("range", path, `String must be at most ${maxLength} characters.`);
  return true;
}

function checkToken(ctx, value, path, options = {}) {
  const { nullable = false } = options;
  if (value === null && nullable) return true;
  if (!checkString(ctx, value, path, { maxLength: 180 })) return false;
  if (!TOKEN_PATTERN.test(value)) {
    ctx.add("token_format", path, "Expected a bounded opaque token without whitespace or path separators.");
    return false;
  }
  return true;
}

function checkEnum(ctx, value, path, enumName) {
  if (!ENUM_SETS[enumName].has(value)) {
    ctx.add("enum", path, `Expected one of: ${ENUMS[enumName].join(", ")}.`);
    return false;
  }
  return true;
}

function checkBoolean(ctx, value, path, options = {}) {
  if (value === null && options.nullable) return true;
  if (typeof value !== "boolean") {
    ctx.add("type", path, "Expected a boolean.");
    return false;
  }
  return true;
}

function checkNumber(ctx, value, path, options = {}) {
  const {
    nullable = false,
    integer = false,
    min = -Infinity,
    max = Infinity
  } = options;
  if (value === null && nullable) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    ctx.add("type", path, "Expected a finite number.");
    return false;
  }
  if (integer && !Number.isInteger(value)) ctx.add("type", path, "Expected an integer.");
  if (value < min || value > max) ctx.add("range", path, `Expected a value between ${min} and ${max}.`);
  return true;
}

function checkTimestamp(ctx, value, path, options = {}) {
  if (value === null && options.nullable) return true;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    ctx.add("timestamp", path, "Expected an ISO-8601 timestamp.");
    return false;
  }
  try {
    if (new Date(value).toISOString() !== value) ctx.add("timestamp", path, "Timestamp must use canonical UTC ISO-8601 form.");
  } catch {
    ctx.add("timestamp", path, "Expected an ISO-8601 timestamp.");
    return false;
  }
  return true;
}

function checkTokenArray(ctx, value, path, options = {}) {
  const { minLength = 0, maxLength = 64, enumName = "" } = options;
  if (!Array.isArray(value)) {
    ctx.add("type", path, "Expected an array.");
    return false;
  }
  if (value.length < minLength || value.length > maxLength) ctx.add("range", path, `Expected ${minLength}-${maxLength} items.`);
  value.forEach((item, index) => {
    if (enumName) checkEnum(ctx, item, pathFor(path, index), enumName);
    else checkToken(ctx, item, pathFor(path, index));
  });
  if (new Set(value).size !== value.length) ctx.add("duplicate", path, "Array items must be unique.");
  return true;
}

function validatePrivacyFlagsInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, PRIVACY_FLAG_NAMES, PRIVACY_FLAG_NAMES)) return;
  for (const name of PRIVACY_FLAG_NAMES) {
    checkBoolean(ctx, value[name], pathFor(path, name));
    if (value[name] !== false) ctx.add("privacy_flag", pathFor(path, name), "Persisted privacy flags must be false.");
  }
}

function mergeResultErrors(ctx, result, prefix) {
  for (const error of result.errors) {
    const suffix = error.path === "$" ? "" : error.path.slice(1);
    ctx.add(error.code, `${prefix}${suffix}`, error.message);
  }
}

function normalizePrivacyFlags(value = {}) {
  return deepFreeze({ ...DEFAULT_PRIVACY_FLAGS, ...(isPlainObject(value) ? clone(value) : {}) });
}

function ensurePrivacySafeForNormalization(value, contract) {
  const errors = findPrivacyViolations(value);
  if (errors.length) throw new ContractValidationError(contract, errors);
}

function isoFromOffset(value, offsetMs) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + offsetMs).toISOString() : null;
}

function normalizedRecord(contract, input, defaults = {}, nested = {}) {
  const source = isPlainObject(input) ? input : {};
  ensurePrivacySafeForNormalization(source, contract);
  const result = { ...clone(defaults), ...clone(source), contractVersion: source.contractVersion || CONTRACT_VERSIONS[contract] };
  for (const [key, defaultValue] of Object.entries(nested)) {
    result[key] = { ...clone(defaultValue), ...(isPlainObject(source[key]) ? clone(source[key]) : {}) };
  }
  result.privacyFlags = normalizePrivacyFlags(source.privacyFlags);
  return deepFreeze(result);
}

function normalizeSemanticFingerprint(input = {}) {
  const source = isPlainObject(input) ? input : {};
  ensurePrivacySafeForNormalization(source, "semantic_fingerprint");
  const kind = source.kind || "keyed_feature_hash";
  return deepFreeze({
    kind,
    projectScoped: source.projectScoped !== false,
    algorithm: source.algorithm || (kind === "encrypted_local_embedding" ? "local_embedding_aes_256_gcm" : "hmac_sha256"),
    valueToken: source.valueToken || "",
    encryptedAtRest: source.encryptedAtRest === true,
    exportable: false,
    absoluteIrreversibilityClaimed: false,
    inversionRiskTested: source.inversionRiskTested === true,
    membershipInferenceRiskTested: source.membershipInferenceRiskTested === true,
    residualRisk: source.residualRisk || "unknown"
  });
}

function normalizePromptSessionEvent(input = {}) {
  return normalizedRecord(CONTRACTS.PROMPT_SESSION_EVENT, input, {
    target: "codex",
    outcomeId: null,
    policyId: null,
    policyVersion: null,
    taskOutcomeToken: "unknown",
    insertVerified: false,
    noAutoSubmit: true,
    failureReasonTokens: []
  });
}

function normalizeCodexTargetAdapterResult(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const reasonToken = source.reasonToken || "unknown";
  const result = normalizedRecord(CONTRACTS.CODEX_TARGET_ADAPTER_RESULT, source, {
    target: "codex",
    attempted: false,
    verified: false,
    verification: "none",
    writeMethod: "none",
    reasonToken,
    publicReason: mapPublicReason(reasonToken),
    foregroundVerified: false,
    targetIdentityVerified: false,
    focusVerified: false,
    draftUnchanged: false,
    payloadFresh: false,
    readbackMatched: false,
    clipboardRestored: null,
    noAutoSubmit: true
  });
  return deepFreeze({ ...result, publicReason: mapPublicReason(result.reasonToken) });
}

function normalizePendingOutcome(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const createdAt = source.createdAt || null;
  return normalizedRecord(CONTRACTS.PENDING_OUTCOME, source, {
    target: "codex",
    createdAt,
    eligibleAt: isoFromOffset(createdAt, MIN_FEEDBACK_DELAY_MS),
    expiresAt: isoFromOffset(createdAt, OUTCOME_TTL_MS),
    status: "unknown",
    insertVerified: true,
    policyId: null,
    policyVersion: null,
    feedbackPromptedAt: null,
    failureReasonTokens: []
  });
}

function normalizeLearningObservation(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const result = normalizedRecord(CONTRACTS.LEARNING_OBSERVATION, source, {
    contextSourceTokens: [],
    insertVerified: false,
    retryCount: 0,
    undoUsed: false,
    taskOutcomeToken: "unknown",
    failureReasonTokens: [],
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    reasoningTokens: null,
    insertedPromptTokenEstimate: null,
    latencyMs: 0,
    tokenAccountingSource: "unavailable"
  }, {
    editFeatureSummary: { userEdited: false, lengthDeltaBucket: "none", structureChanged: false }
  });
  return deepFreeze({ ...result, semanticFingerprint: normalizeSemanticFingerprint(source.semanticFingerprint || {}) });
}

function normalizeLearningArtifact(input = {}) {
  return normalizedRecord(CONTRACTS.LEARNING_ARTIFACT, input, {
    status: "pending_review",
    autoCreated: false,
    effective: false
  }, {
    scope: { kind: "project", projectScopeToken: "" },
    evidenceSummary: {
      sessionCount: 0,
      successfulOutcomeCount: 0,
      explicitNegativeFeedbackCount: 0,
      evidenceTokenCount: 0
    },
    permissions: { execution: "none", scopeExpansion: "user_confirmation_required" },
    review: { required: true, decision: "pending", ignoredCount: 0 }
  });
}

function normalizeGenerationPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const result = normalizedRecord(CONTRACTS.GENERATION_POLICY, source, {
    version: 1,
    directives: [],
    baselineVersion: 1,
    status: "draft",
    riskLevel: "low",
    automaticRolloutEligible: false
  }, {
    scope: { kind: "project", target: "codex", projectScopeToken: "", taskScenarioToken: "", modelFamilyToken: "" },
    selectedStrategy: { strategyId: "", strategyVersion: "" },
    contextBudget: { maxInputTokens: 0, maxContextSourceTokens: 0 },
    evidenceSummary: {
      attributableOutcomeCount: 0,
      successfulOutcomeCount: 0,
      negativeOutcomeCount: 0,
      retryRate: 0,
      undoRate: 0,
      tokenDeltaRatio: 0,
      evidenceTokenCount: 0
    }
  });
  return deepFreeze({ ...result, directives: Array.isArray(source.directives) ? clone(source.directives) : [] });
}

function normalizePolicyRollout(input = {}) {
  return normalizedRecord(CONTRACTS.POLICY_ROLLOUT, input, {
    status: "planned",
    canaryShareBps: 1000,
    rollbackReasonToken: "none",
    endedAt: null
  }, {
    minimums: {
      perArmAttributableOutcomes: 10,
      tokenImprovementRatio: 0.05,
      minimumEffectRatio: 0.03,
      confidenceThreshold: 0.9
    },
    gates: {
      benchmarkPassed: false,
      taskQualityNotDegraded: false,
      retryUndoNotDegraded: false,
      efficiencyImproved: false,
      statisticalRequirementMet: false,
      safetyIncidentCount: 0,
      privacyIncidentCount: 0,
      permissionIncidentCount: 0,
      autoSubmitIncidentCount: 0,
      miswriteIncidentCount: 0
    }
  });
}

function normalizeBenchmarkResult(input = {}) {
  const categoryCounts = Object.fromEntries(ENUMS.benchmarkCategory.map((category) => [category, 0]));
  return normalizedRecord(CONTRACTS.BENCHMARK_RESULT, input, {
    status: "not_run",
    executor: "fake",
    initiatedBy: "test",
    taskCount: 0,
    publicReason: "benchmark_incomplete",
    startedAt: null,
    finishedAt: null
  }, {
    authorization: { required: false, granted: false },
    categoryCounts,
    comparability: {
      sameModelFamily: false,
      sameStartingPoint: false,
      samePermissions: false,
      sameBudget: false,
      deterministicAcceptance: false
    },
    budget: {
      tokenLimit: 0,
      maxAgentTurns: 0,
      maxRetries: 0,
      estimatedCostMicros: 0,
      consumedTokens: 0,
      exhausted: false
    },
    safety: {
      qualityGatePassed: false,
      noAutoSubmitPassed: false,
      privacyPassed: false,
      permissionPassed: false
    }
  });
}

function normalizeRuntimeEvidence(input = {}) {
  return normalizedRecord(CONTRACTS.RUNTIME_EVIDENCE, input, {
    status: "not_run",
    contractVersions: CONTRACT_VERSIONS,
    checkTokens: [],
    publicReason: "benchmark_incomplete"
  }, {
    checks: {
      contractParsed: false,
      fixturesPassed: false,
      machineReadbackVerified: false,
      noAutoSubmitVerified: false,
      privacyScanPassed: false
    }
  });
}

function normalizeContextSource(input = {}) {
  return normalizedRecord(CONTRACTS.CONTEXT_SOURCE, input, {
    enabled: false,
    permissionStatus: "not_granted",
    trustLevel: "untrusted",
    independentAuthorizationRequired: true,
    tokenBudget: 0,
    executionPermissionsExpanded: false
  }, {
    preview: { status: "not_available", itemCount: 0, tokenEstimate: 0, removable: true, reviewed: false },
    collectResult: {
      status: "not_requested",
      itemCount: 0,
      tokenCount: 0,
      contentHandleToken: null,
      promptInjectionRisk: "unknown"
    }
  });
}

function validateSemanticFingerprint(value) {
  const ctx = {
    contract: "semantic_fingerprint",
    errors: [],
    add(code, path, message) {
      if (!this.errors.some((error) => error.code === code && error.path === path)) this.errors.push({ code, path, message });
    }
  };
  const fields = [
    "kind",
    "projectScoped",
    "algorithm",
    "valueToken",
    "encryptedAtRest",
    "exportable",
    "absoluteIrreversibilityClaimed",
    "inversionRiskTested",
    "membershipInferenceRiskTested",
    "residualRisk"
  ];
  if (!checkObject(ctx, value, "$", fields, fields)) return deepFreeze({ valid: false, errors: ctx.errors });
  checkEnum(ctx, value.kind, "$.kind", "fingerprintKind");
  checkBoolean(ctx, value.projectScoped, "$.projectScoped");
  checkToken(ctx, value.algorithm, "$.algorithm");
  checkToken(ctx, value.valueToken, "$.valueToken");
  checkBoolean(ctx, value.encryptedAtRest, "$.encryptedAtRest");
  checkBoolean(ctx, value.exportable, "$.exportable");
  checkBoolean(ctx, value.absoluteIrreversibilityClaimed, "$.absoluteIrreversibilityClaimed");
  checkBoolean(ctx, value.inversionRiskTested, "$.inversionRiskTested");
  checkBoolean(ctx, value.membershipInferenceRiskTested, "$.membershipInferenceRiskTested");
  checkEnum(ctx, value.residualRisk, "$.residualRisk", "fingerprintResidualRisk");
  if (value.projectScoped !== true || value.exportable !== false) {
    ctx.add("fingerprint_policy", "$", "Fingerprints must remain project-scoped and non-exportable.");
  }
  if (value.absoluteIrreversibilityClaimed !== false) {
    ctx.add("fingerprint_policy", "$.absoluteIrreversibilityClaimed", "Absolute irreversibility claims are forbidden.");
  }
  if (value.kind === "keyed_feature_hash") {
    if (value.algorithm !== "hmac_sha256" || !HEX_64_PATTERN.test(value.valueToken || "") || value.encryptedAtRest !== false) {
      ctx.add("fingerprint_policy", "$", "Keyed feature hashes require a project HMAC-SHA256 digest.");
    }
  }
  if (value.kind === "encrypted_local_embedding") {
    if (
      value.algorithm !== "local_embedding_aes_256_gcm"
      || value.encryptedAtRest !== true
      || value.inversionRiskTested !== true
      || value.membershipInferenceRiskTested !== true
      || !["low", "accepted"].includes(value.residualRisk)
    ) {
      ctx.add("fingerprint_policy", "$", "Encrypted local embeddings require encryption and both residual-risk tests.");
    }
  }
  for (const violation of findPrivacyViolations(value)) ctx.add(violation.code, violation.path, violation.message);
  return deepFreeze({ valid: ctx.errors.length === 0, errors: ctx.errors });
}

function validatePromptSessionEvent(value) {
  const fields = [
    "contractVersion",
    "eventId",
    "eventType",
    "occurredAt",
    "sessionId",
    "generationId",
    "target",
    "projectScopeToken",
    "strategyId",
    "strategyVersion",
    "modelFamilyToken",
    "outcomeId",
    "policyId",
    "policyVersion",
    "taskOutcomeToken",
    "insertVerified",
    "noAutoSubmit",
    "failureReasonTokens",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.PROMPT_SESSION_EVENT, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  checkToken(ctx, value.eventId, "$.eventId");
  checkEnum(ctx, value.eventType, "$.eventType", "promptSessionEventType");
  checkTimestamp(ctx, value.occurredAt, "$.occurredAt");
  for (const key of ["sessionId", "generationId", "projectScopeToken", "strategyId", "strategyVersion", "modelFamilyToken"]) {
    checkToken(ctx, value[key], `$.${key}`);
  }
  checkEnum(ctx, value.target, "$.target", "target");
  checkToken(ctx, value.outcomeId, "$.outcomeId", { nullable: true });
  checkToken(ctx, value.policyId, "$.policyId", { nullable: true });
  checkNumber(ctx, value.policyVersion, "$.policyVersion", { nullable: true, integer: true, min: 1 });
  checkEnum(ctx, value.taskOutcomeToken, "$.taskOutcomeToken", "taskOutcome");
  checkBoolean(ctx, value.insertVerified, "$.insertVerified");
  checkBoolean(ctx, value.noAutoSubmit, "$.noAutoSubmit");
  checkTokenArray(ctx, value.failureReasonTokens, "$.failureReasonTokens", { enumName: "outcomeFailureReason", maxLength: 8 });
  if (value.noAutoSubmit !== true) ctx.add("safety_invariant", "$.noAutoSubmit", "Prompt Session events must preserve no-auto-submit.");
  if (value.eventType === "verified_insert" && (value.insertVerified !== true || value.outcomeId === null)) {
    ctx.add("verification_invariant", "$", "verified_insert requires verified insertion and an idempotent outcome id.");
  }
  if (value.eventType === "insert_failed" && value.insertVerified !== false) {
    ctx.add("verification_invariant", "$.insertVerified", "insert_failed cannot be verified.");
  }
  if (["outcome_feedback", "outcome_expired"].includes(value.eventType) && value.outcomeId === null) {
    ctx.add("outcome_invariant", "$.outcomeId", "Outcome events require an outcome id.");
  }
  if (value.eventType === "outcome_expired" && value.taskOutcomeToken !== "expired_unknown") {
    ctx.add("outcome_invariant", "$.taskOutcomeToken", "Expired outcomes must remain expired_unknown.");
  }
  return finish(ctx);
}

function validateCodexTargetAdapterResult(value) {
  const fields = [
    "contractVersion",
    "adapterResultId",
    "operation",
    "status",
    "target",
    "attempted",
    "verified",
    "verification",
    "writeMethod",
    "reasonToken",
    "publicReason",
    "foregroundVerified",
    "targetIdentityVerified",
    "focusVerified",
    "draftUnchanged",
    "payloadFresh",
    "readbackMatched",
    "clipboardRestored",
    "noAutoSubmit",
    "occurredAt",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.CODEX_TARGET_ADAPTER_RESULT, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  checkToken(ctx, value.adapterResultId, "$.adapterResultId");
  checkEnum(ctx, value.operation, "$.operation", "adapterOperation");
  checkEnum(ctx, value.status, "$.status", "adapterStatus");
  checkEnum(ctx, value.target, "$.target", "target");
  for (const key of [
    "attempted",
    "verified",
    "foregroundVerified",
    "targetIdentityVerified",
    "focusVerified",
    "draftUnchanged",
    "payloadFresh",
    "readbackMatched",
    "noAutoSubmit"
  ]) checkBoolean(ctx, value[key], `$.${key}`);
  checkBoolean(ctx, value.clipboardRestored, "$.clipboardRestored", { nullable: true });
  checkEnum(ctx, value.verification, "$.verification", "verification");
  checkEnum(ctx, value.writeMethod, "$.writeMethod", "writeMethod");
  checkToken(ctx, value.reasonToken, "$.reasonToken");
  checkEnum(ctx, value.publicReason, "$.publicReason", "publicReason");
  checkTimestamp(ctx, value.occurredAt, "$.occurredAt");
  if (mapPublicReason(value.reasonToken) !== value.publicReason) {
    ctx.add("public_reason_mismatch", "$.publicReason", "Public reason must be derived from the internal reason token.");
  }
  if (value.noAutoSubmit !== true) ctx.add("safety_invariant", "$.noAutoSubmit", "Adapters must never permit automatic submission.");
  if (value.verified === true) {
    const verified = value.operation === "insert"
      && value.status === "ready"
      && value.attempted === true
      && value.verification === "machine"
      && ["direct", "controlled_clipboard"].includes(value.writeMethod)
      && value.foregroundVerified === true
      && value.targetIdentityVerified === true
      && value.focusVerified === true
      && value.draftUnchanged === true
      && value.payloadFresh === true
      && value.readbackMatched === true
      && value.noAutoSubmit === true;
    if (!verified) ctx.add("verification_invariant", "$", "Verified insert requires all foreground, identity, freshness, and machine-readback guards.");
  }
  if (value.writeMethod === "controlled_clipboard" && value.clipboardRestored !== true) {
    ctx.add("clipboard_invariant", "$.clipboardRestored", "Controlled clipboard writes require verified restoration.");
  }
  return finish(ctx);
}

function validatePendingOutcome(value) {
  const fields = [
    "contractVersion",
    "outcomeId",
    "generationId",
    "sessionId",
    "strategyId",
    "strategyVersion",
    "target",
    "projectScopeToken",
    "modelFamilyToken",
    "createdAt",
    "eligibleAt",
    "expiresAt",
    "status",
    "insertVerified",
    "policyId",
    "policyVersion",
    "feedbackPromptedAt",
    "failureReasonTokens",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.PENDING_OUTCOME, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  for (const key of ["outcomeId", "generationId", "sessionId", "strategyId", "strategyVersion", "projectScopeToken", "modelFamilyToken"]) {
    checkToken(ctx, value[key], `$.${key}`);
  }
  checkEnum(ctx, value.target, "$.target", "target");
  checkTimestamp(ctx, value.createdAt, "$.createdAt");
  checkTimestamp(ctx, value.eligibleAt, "$.eligibleAt");
  checkTimestamp(ctx, value.expiresAt, "$.expiresAt");
  checkTimestamp(ctx, value.feedbackPromptedAt, "$.feedbackPromptedAt", { nullable: true });
  checkEnum(ctx, value.status, "$.status", "pendingOutcomeStatus");
  checkBoolean(ctx, value.insertVerified, "$.insertVerified");
  checkToken(ctx, value.policyId, "$.policyId", { nullable: true });
  checkNumber(ctx, value.policyVersion, "$.policyVersion", { nullable: true, integer: true, min: 1 });
  if ((value.policyId === null) !== (value.policyVersion === null)) {
    ctx.add("policy_attribution_invariant", "$", "Policy attribution requires both policyId and policyVersion.");
  }
  checkTokenArray(ctx, value.failureReasonTokens, "$.failureReasonTokens", { enumName: "outcomeFailureReason", maxLength: 8 });
  const createdAt = Date.parse(value.createdAt);
  const eligibleAt = Date.parse(value.eligibleAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (Number.isFinite(createdAt) && Number.isFinite(eligibleAt) && eligibleAt - createdAt < MIN_FEEDBACK_DELAY_MS) {
    ctx.add("time_window", "$.eligibleAt", "Feedback cannot become eligible before 60 seconds.");
  }
  if (Number.isFinite(createdAt) && Number.isFinite(expiresAt) && expiresAt - createdAt !== OUTCOME_TTL_MS) {
    ctx.add("time_window", "$.expiresAt", "Pending outcomes expire exactly 24 hours after creation.");
  }
  if (value.feedbackPromptedAt !== null) {
    const promptedAt = Date.parse(value.feedbackPromptedAt);
    if (Number.isFinite(promptedAt) && (promptedAt < eligibleAt || promptedAt >= expiresAt)) {
      ctx.add("time_window", "$.feedbackPromptedAt", "Feedback must be prompted after eligibility and before expiry.");
    }
  }
  if (value.insertVerified !== true) ctx.add("verification_invariant", "$.insertVerified", "Only verified inserts create pending outcomes.");
  const failureReasonCount = Array.isArray(value.failureReasonTokens) ? value.failureReasonTokens.length : 0;
  if (value.status === "failed" && failureReasonCount === 0) {
    ctx.add("outcome_invariant", "$.failureReasonTokens", "Failed outcomes require a finite user reason.");
  }
  if (value.status !== "failed" && failureReasonCount > 0) {
    ctx.add("outcome_invariant", "$.failureReasonTokens", "Failure reasons are only valid for failed outcomes.");
  }
  return finish(ctx);
}

function validateLearningObservation(value) {
  const fields = [
    "contractVersion",
    "observationId",
    "projectScopeToken",
    "taskScenarioToken",
    "modeToken",
    "strategyId",
    "strategyVersion",
    "modelFamilyToken",
    "contextSourceTokens",
    "editFeatureSummary",
    "insertVerified",
    "retryCount",
    "undoUsed",
    "taskOutcomeToken",
    "failureReasonTokens",
    "inputTokens",
    "outputTokens",
    "cachedTokens",
    "reasoningTokens",
    "insertedPromptTokenEstimate",
    "latencyMs",
    "tokenAccountingSource",
    "semanticFingerprint",
    "privacyFlags",
    "createdAt"
  ];
  const ctx = createContext(CONTRACTS.LEARNING_OBSERVATION, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  for (const key of ["observationId", "projectScopeToken", "taskScenarioToken", "modeToken", "strategyId", "strategyVersion", "modelFamilyToken"]) {
    checkToken(ctx, value[key], `$.${key}`);
  }
  checkTokenArray(ctx, value.contextSourceTokens, "$.contextSourceTokens", { maxLength: 16 });
  if (checkObject(
    ctx,
    value.editFeatureSummary,
    "$.editFeatureSummary",
    ["userEdited", "lengthDeltaBucket", "structureChanged"],
    ["userEdited", "lengthDeltaBucket", "structureChanged"]
  )) {
    checkBoolean(ctx, value.editFeatureSummary.userEdited, "$.editFeatureSummary.userEdited");
    checkEnum(ctx, value.editFeatureSummary.lengthDeltaBucket, "$.editFeatureSummary.lengthDeltaBucket", "editLengthDeltaBucket");
    checkBoolean(ctx, value.editFeatureSummary.structureChanged, "$.editFeatureSummary.structureChanged");
  }
  checkBoolean(ctx, value.insertVerified, "$.insertVerified");
  checkNumber(ctx, value.retryCount, "$.retryCount", { integer: true, min: 0 });
  checkBoolean(ctx, value.undoUsed, "$.undoUsed");
  checkEnum(ctx, value.taskOutcomeToken, "$.taskOutcomeToken", "taskOutcome");
  checkTokenArray(ctx, value.failureReasonTokens, "$.failureReasonTokens", { enumName: "outcomeFailureReason", maxLength: 8 });
  const tokenFields = ["inputTokens", "outputTokens", "cachedTokens", "reasoningTokens", "insertedPromptTokenEstimate"];
  for (const key of tokenFields) checkNumber(ctx, value[key], `$.${key}`, { nullable: true, integer: true, min: 0 });
  checkNumber(ctx, value.latencyMs, "$.latencyMs", { integer: true, min: 0 });
  checkEnum(ctx, value.tokenAccountingSource, "$.tokenAccountingSource", "tokenAccountingSource");
  checkTimestamp(ctx, value.createdAt, "$.createdAt");
  mergeResultErrors(ctx, validateSemanticFingerprint(value.semanticFingerprint), "$.semanticFingerprint");
  if (value.tokenAccountingSource === "unavailable" && tokenFields.some((key) => value[key] !== null)) {
    ctx.add("token_accounting", "$", "Unavailable token accounting cannot contain numeric token claims.");
  }
  if (value.tokenAccountingSource !== "unavailable" && value.inputTokens === null && value.outputTokens === null) {
    ctx.add("token_accounting", "$", "Provider or estimated accounting requires at least input or output tokens.");
  }
  if (value.taskOutcomeToken === "completed" && Array.isArray(value.failureReasonTokens) && value.failureReasonTokens.length > 0) {
    ctx.add("outcome_invariant", "$.failureReasonTokens", "Completed outcomes cannot carry failure reasons.");
  }
  return finish(ctx);
}

function validateArtifactPayload(ctx, artifactType, payload) {
  if (!isPlainObject(payload)) {
    ctx.add("type", "$.payload", "Expected an object.");
    return;
  }
  if (artifactType === "memory") {
    if (checkObject(ctx, payload, "$.payload", ["category", "statement"], ["category", "statement"])) {
      checkToken(ctx, payload.category, "$.payload.category");
      checkString(ctx, payload.statement, "$.payload.statement", { maxLength: 600 });
    }
  } else if (artifactType === "rule") {
    if (checkObject(ctx, payload, "$.payload", ["directive", "taskScenarioTokens"], ["directive", "taskScenarioTokens"])) {
      checkString(ctx, payload.directive, "$.payload.directive", { maxLength: 600 });
      checkTokenArray(ctx, payload.taskScenarioTokens, "$.payload.taskScenarioTokens", { minLength: 1, maxLength: 16 });
    }
  } else if (artifactType === "skill") {
    const fields = [
      "triggerConditionTokens",
      "stepTokens",
      "verificationTokens",
      "resourceTokens",
      "permissionTokens",
      "failureRecoveryTokens",
      "scriptsExecutable",
      "permissionCheckPassed",
      "isolationTestPassed",
      "adversarialReviewPassed"
    ];
    if (checkObject(ctx, payload, "$.payload", fields, fields)) {
      for (const key of fields.slice(0, 6)) checkTokenArray(ctx, payload[key], `$.payload.${key}`, { minLength: 1, maxLength: 32 });
      for (const key of fields.slice(6)) checkBoolean(ctx, payload[key], `$.payload.${key}`);
      if (payload.scriptsExecutable !== false) {
        ctx.add("skill_execution_policy", "$.payload.scriptsExecutable", "Generated skill scripts are not executable by default.");
      }
    }
  } else if (artifactType === "generation_policy") {
    if (checkObject(ctx, payload, "$.payload", ["policyId", "policyVersion"], ["policyId", "policyVersion"])) {
      checkToken(ctx, payload.policyId, "$.payload.policyId");
      checkNumber(ctx, payload.policyVersion, "$.payload.policyVersion", { integer: true, min: 1 });
    }
  }
}

function validateLearningArtifact(value) {
  const fields = [
    "contractVersion",
    "artifactId",
    "artifactType",
    "status",
    "scope",
    "payload",
    "evidenceSummary",
    "permissions",
    "review",
    "autoCreated",
    "effective",
    "createdAt",
    "updatedAt",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.LEARNING_ARTIFACT, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  checkToken(ctx, value.artifactId, "$.artifactId");
  checkEnum(ctx, value.artifactType, "$.artifactType", "artifactType");
  checkEnum(ctx, value.status, "$.status", "artifactStatus");
  if (checkObject(ctx, value.scope, "$.scope", ["kind", "projectScopeToken"], ["kind", "projectScopeToken"])) {
    checkEnum(ctx, value.scope.kind, "$.scope.kind", "artifactScope");
    checkToken(ctx, value.scope.projectScopeToken, "$.scope.projectScopeToken", { nullable: value.scope.kind === "global" });
  }
  validateArtifactPayload(ctx, value.artifactType, value.payload);
  if (checkObject(
    ctx,
    value.evidenceSummary,
    "$.evidenceSummary",
    ["sessionCount", "successfulOutcomeCount", "explicitNegativeFeedbackCount", "evidenceTokenCount"],
    ["sessionCount", "successfulOutcomeCount", "explicitNegativeFeedbackCount", "evidenceTokenCount"]
  )) {
    for (const key of Object.keys(value.evidenceSummary)) {
      checkNumber(ctx, value.evidenceSummary[key], `$.evidenceSummary.${key}`, { integer: true, min: 0 });
    }
  }
  if (checkObject(ctx, value.permissions, "$.permissions", ["execution", "scopeExpansion"], ["execution", "scopeExpansion"])) {
    checkEnum(ctx, value.permissions.execution, "$.permissions.execution", "executionPermission");
    checkEnum(ctx, value.permissions.scopeExpansion, "$.permissions.scopeExpansion", "scopeExpansionPermission");
  }
  if (checkObject(ctx, value.review, "$.review", ["required", "decision", "ignoredCount"], ["required", "decision", "ignoredCount"])) {
    checkBoolean(ctx, value.review.required, "$.review.required");
    checkEnum(ctx, value.review.decision, "$.review.decision", "reviewDecision");
    checkNumber(ctx, value.review.ignoredCount, "$.review.ignoredCount", { integer: true, min: 0, max: 3 });
  }
  checkBoolean(ctx, value.autoCreated, "$.autoCreated");
  checkBoolean(ctx, value.effective, "$.effective");
  checkTimestamp(ctx, value.createdAt, "$.createdAt");
  checkTimestamp(ctx, value.updatedAt, "$.updatedAt");
  if (value.autoCreated === true) {
    const evidence = value.evidenceSummary || {};
    if (
      evidence.sessionCount < 2
      || evidence.successfulOutcomeCount < 3
      || evidence.explicitNegativeFeedbackCount !== 0
      || value.scope?.kind !== "project"
    ) {
      ctx.add("candidate_threshold", "$.evidenceSummary", "Auto-created project candidates require 2 sessions, 3 successes, and no explicit negative feedback.");
    }
    if (value.status !== "pending_review" || value.effective !== false) {
      ctx.add("candidate_activation", "$", "Auto-created candidates must remain pending and ineffective until review.");
    }
  }
  if (value.effective === true && (value.status !== "active" || value.review?.decision !== "accepted")) {
    ctx.add("candidate_activation", "$.effective", "Only accepted active artifacts may be effective.");
  }
  return finish(ctx);
}

function validateGenerationPolicy(value) {
  const fields = [
    "contractVersion",
    "policyId",
    "version",
    "scope",
    "selectedStrategy",
    "directives",
    "contextBudget",
    "evidenceSummary",
    "baselineVersion",
    "status",
    "riskLevel",
    "automaticRolloutEligible",
    "createdAt",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.GENERATION_POLICY, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  checkToken(ctx, value.policyId, "$.policyId");
  checkNumber(ctx, value.version, "$.version", { integer: true, min: 1 });
  if (checkObject(
    ctx,
    value.scope,
    "$.scope",
    ["kind", "target", "projectScopeToken", "taskScenarioToken", "modelFamilyToken"],
    ["kind", "target", "projectScopeToken", "taskScenarioToken", "modelFamilyToken"]
  )) {
    checkEnum(ctx, value.scope.kind, "$.scope.kind", "artifactScope");
    checkEnum(ctx, value.scope.target, "$.scope.target", "target");
    for (const key of ["projectScopeToken", "taskScenarioToken", "modelFamilyToken"]) checkToken(ctx, value.scope[key], `$.scope.${key}`);
  }
  if (checkObject(ctx, value.selectedStrategy, "$.selectedStrategy", ["strategyId", "strategyVersion"], ["strategyId", "strategyVersion"])) {
    checkToken(ctx, value.selectedStrategy.strategyId, "$.selectedStrategy.strategyId");
    checkToken(ctx, value.selectedStrategy.strategyVersion, "$.selectedStrategy.strategyVersion");
  }
  if (!Array.isArray(value.directives)) {
    ctx.add("type", "$.directives", "Expected an array.");
  } else {
    if (value.directives.length > 8) ctx.add("range", "$.directives", "Policies may contain at most 8 compact directives.");
    value.directives.forEach((directive, index) => {
      const path = `$.directives[${index}]`;
      if (checkObject(ctx, directive, path, ["directiveId", "kind", "valueToken", "priority"], ["directiveId", "kind", "valueToken", "priority"])) {
        checkToken(ctx, directive.directiveId, `${path}.directiveId`);
        checkEnum(ctx, directive.kind, `${path}.kind`, "policyDirectiveKind");
        checkToken(ctx, directive.valueToken, `${path}.valueToken`);
        checkNumber(ctx, directive.priority, `${path}.priority`, { integer: true, min: 1, max: 8 });
      }
    });
  }
  if (checkObject(ctx, value.contextBudget, "$.contextBudget", ["maxInputTokens", "maxContextSourceTokens"], ["maxInputTokens", "maxContextSourceTokens"])) {
    checkNumber(ctx, value.contextBudget.maxInputTokens, "$.contextBudget.maxInputTokens", { integer: true, min: 0 });
    checkNumber(ctx, value.contextBudget.maxContextSourceTokens, "$.contextBudget.maxContextSourceTokens", { integer: true, min: 0 });
    if (value.contextBudget.maxContextSourceTokens > value.contextBudget.maxInputTokens) {
      ctx.add("budget_invariant", "$.contextBudget", "Context-source budget cannot exceed the total input budget.");
    }
  }
  const evidenceFields = [
    "attributableOutcomeCount",
    "successfulOutcomeCount",
    "negativeOutcomeCount",
    "retryRate",
    "undoRate",
    "tokenDeltaRatio",
    "evidenceTokenCount"
  ];
  if (checkObject(ctx, value.evidenceSummary, "$.evidenceSummary", evidenceFields, evidenceFields)) {
    for (const key of ["attributableOutcomeCount", "successfulOutcomeCount", "negativeOutcomeCount", "evidenceTokenCount"]) {
      checkNumber(ctx, value.evidenceSummary[key], `$.evidenceSummary.${key}`, { integer: true, min: 0 });
    }
    for (const key of ["retryRate", "undoRate"]) checkNumber(ctx, value.evidenceSummary[key], `$.evidenceSummary.${key}`, { min: 0, max: 1 });
    checkNumber(ctx, value.evidenceSummary.tokenDeltaRatio, "$.evidenceSummary.tokenDeltaRatio", { min: -1, max: 10 });
  }
  checkNumber(ctx, value.baselineVersion, "$.baselineVersion", { integer: true, min: 1 });
  checkEnum(ctx, value.status, "$.status", "generationPolicyStatus");
  checkEnum(ctx, value.riskLevel, "$.riskLevel", "policyRiskLevel");
  checkBoolean(ctx, value.automaticRolloutEligible, "$.automaticRolloutEligible");
  checkTimestamp(ctx, value.createdAt, "$.createdAt");
  if (value.automaticRolloutEligible === true && (value.riskLevel !== "low" || value.scope?.kind !== "project")) {
    ctx.add("rollout_eligibility", "$.automaticRolloutEligible", "Only low-risk project policies are eligible for automatic rollout.");
  }
  return finish(ctx);
}

function validateRolloutArm(ctx, value, path) {
  const fields = [
    "attributableOutcomes",
    "successRate",
    "retryRate",
    "undoRate",
    "averageTokens",
    "averageLatencyMs",
    "averageReworkCount"
  ];
  if (!checkObject(ctx, value, path, fields, fields)) return;
  checkNumber(ctx, value.attributableOutcomes, `${path}.attributableOutcomes`, { integer: true, min: 0 });
  for (const key of ["successRate", "retryRate", "undoRate"]) checkNumber(ctx, value[key], `${path}.${key}`, { min: 0, max: 1 });
  for (const key of ["averageTokens", "averageLatencyMs", "averageReworkCount"]) checkNumber(ctx, value[key], `${path}.${key}`, { min: 0 });
}

function validatePolicyRollout(value) {
  const fields = [
    "contractVersion",
    "rolloutId",
    "policyId",
    "policyVersion",
    "baselineVersion",
    "projectScopeToken",
    "status",
    "canaryShareBps",
    "minimums",
    "arms",
    "gates",
    "rollbackReasonToken",
    "startedAt",
    "endedAt",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.POLICY_ROLLOUT, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  for (const key of ["rolloutId", "policyId", "projectScopeToken"]) checkToken(ctx, value[key], `$.${key}`);
  for (const key of ["policyVersion", "baselineVersion"]) checkNumber(ctx, value[key], `$.${key}`, { integer: true, min: 1 });
  checkEnum(ctx, value.status, "$.status", "policyRolloutStatus");
  checkNumber(ctx, value.canaryShareBps, "$.canaryShareBps", { integer: true, min: 1, max: 10000 });
  const minimumFields = ["perArmAttributableOutcomes", "tokenImprovementRatio", "minimumEffectRatio", "confidenceThreshold"];
  if (checkObject(ctx, value.minimums, "$.minimums", minimumFields, minimumFields)) {
    checkNumber(ctx, value.minimums.perArmAttributableOutcomes, "$.minimums.perArmAttributableOutcomes", { integer: true, min: 10 });
    checkNumber(ctx, value.minimums.tokenImprovementRatio, "$.minimums.tokenImprovementRatio", { min: 0.05, max: 1 });
    checkNumber(ctx, value.minimums.minimumEffectRatio, "$.minimums.minimumEffectRatio", { min: 0, max: 1 });
    checkNumber(ctx, value.minimums.confidenceThreshold, "$.minimums.confidenceThreshold", { min: 0, max: 1 });
  }
  if (checkObject(ctx, value.arms, "$.arms", ["baseline", "candidate"], ["baseline", "candidate"])) {
    validateRolloutArm(ctx, value.arms.baseline, "$.arms.baseline");
    validateRolloutArm(ctx, value.arms.candidate, "$.arms.candidate");
  }
  const gateFields = [
    "benchmarkPassed",
    "taskQualityNotDegraded",
    "retryUndoNotDegraded",
    "efficiencyImproved",
    "statisticalRequirementMet",
    "safetyIncidentCount",
    "privacyIncidentCount",
    "permissionIncidentCount",
    "autoSubmitIncidentCount",
    "miswriteIncidentCount"
  ];
  if (checkObject(ctx, value.gates, "$.gates", gateFields, gateFields)) {
    for (const key of gateFields.slice(0, 5)) checkBoolean(ctx, value.gates[key], `$.gates.${key}`);
    for (const key of gateFields.slice(5)) checkNumber(ctx, value.gates[key], `$.gates.${key}`, { integer: true, min: 0 });
  }
  checkEnum(ctx, value.rollbackReasonToken, "$.rollbackReasonToken", "rollbackReason");
  checkTimestamp(ctx, value.startedAt, "$.startedAt");
  checkTimestamp(ctx, value.endedAt, "$.endedAt", { nullable: true });
  const incidentCount = gateFields.slice(5).reduce((sum, key) => sum + Number(value.gates?.[key] || 0), 0);
  if (incidentCount > 0 && value.status !== "rolled_back") {
    ctx.add("rollback_gate", "$.status", "Safety, privacy, permission, auto-submit, or miswrite incidents require rollback.");
  }
  if (value.status === "rolled_back" && value.rollbackReasonToken === "none") {
    ctx.add("rollback_gate", "$.rollbackReasonToken", "Rolled-back policies require a finite rollback reason.");
  }
  if (value.status === "promoted") {
    const minimum = Number(value.minimums?.perArmAttributableOutcomes || 10);
    const enoughSamples = Number(value.arms?.baseline?.attributableOutcomes || 0) >= minimum
      && Number(value.arms?.candidate?.attributableOutcomes || 0) >= minimum;
    const passedGates = value.gates?.benchmarkPassed === true
      && value.gates?.taskQualityNotDegraded === true
      && value.gates?.retryUndoNotDegraded === true
      && value.gates?.efficiencyImproved === true
      && value.gates?.statisticalRequirementMet === true
      && incidentCount === 0;
    if (!enoughSamples || !passedGates) {
      ctx.add("rollout_gate", "$.status", "Promotion requires per-arm samples, quality and safety gates, an efficiency improvement, and declared statistical confidence.");
    }
  }
  return finish(ctx);
}

function validateBenchmarkArm(ctx, value, path) {
  const fields = ["completedTasks", "safetyPassedTasks", "totalTokens", "totalDurationMs", "totalRetries", "totalToolCalls"];
  if (!checkObject(ctx, value, path, fields, fields)) return;
  for (const key of fields) checkNumber(ctx, value[key], `${path}.${key}`, { integer: true, min: 0 });
}

function validateBenchmarkResult(value) {
  const fields = [
    "contractVersion",
    "benchmarkId",
    "status",
    "executor",
    "initiatedBy",
    "authorization",
    "modelFamilyToken",
    "fixtureSetToken",
    "taskCount",
    "categoryCounts",
    "comparability",
    "budget",
    "arms",
    "safety",
    "startedAt",
    "finishedAt",
    "publicReason",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.BENCHMARK_RESULT, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  checkToken(ctx, value.benchmarkId, "$.benchmarkId");
  checkEnum(ctx, value.status, "$.status", "benchmarkStatus");
  checkEnum(ctx, value.executor, "$.executor", "benchmarkExecutor");
  checkEnum(ctx, value.initiatedBy, "$.initiatedBy", "benchmarkInitiator");
  if (checkObject(ctx, value.authorization, "$.authorization", ["required", "granted"], ["required", "granted"])) {
    checkBoolean(ctx, value.authorization.required, "$.authorization.required");
    checkBoolean(ctx, value.authorization.granted, "$.authorization.granted");
  }
  checkToken(ctx, value.modelFamilyToken, "$.modelFamilyToken");
  checkToken(ctx, value.fixtureSetToken, "$.fixtureSetToken");
  checkNumber(ctx, value.taskCount, "$.taskCount", { integer: true, min: 0 });
  if (checkObject(ctx, value.categoryCounts, "$.categoryCounts", ENUMS.benchmarkCategory, ENUMS.benchmarkCategory)) {
    for (const category of ENUMS.benchmarkCategory) {
      checkNumber(ctx, value.categoryCounts[category], `$.categoryCounts.${category}`, { integer: true, min: 0 });
    }
  }
  const comparabilityFields = ["sameModelFamily", "sameStartingPoint", "samePermissions", "sameBudget", "deterministicAcceptance"];
  if (checkObject(ctx, value.comparability, "$.comparability", comparabilityFields, comparabilityFields)) {
    for (const key of comparabilityFields) checkBoolean(ctx, value.comparability[key], `$.comparability.${key}`);
  }
  const budgetFields = ["tokenLimit", "maxAgentTurns", "maxRetries", "estimatedCostMicros", "consumedTokens", "exhausted"];
  if (checkObject(ctx, value.budget, "$.budget", budgetFields, budgetFields)) {
    for (const key of budgetFields.slice(0, 5)) checkNumber(ctx, value.budget[key], `$.budget.${key}`, { integer: true, min: 0 });
    checkBoolean(ctx, value.budget.exhausted, "$.budget.exhausted");
    if (value.budget.consumedTokens > value.budget.tokenLimit && value.budget.exhausted !== true) {
      ctx.add("budget_invariant", "$.budget", "Token consumption above the hard limit must be marked exhausted.");
    }
  }
  if (checkObject(ctx, value.arms, "$.arms", ["baseline", "candidate"], ["baseline", "candidate"])) {
    validateBenchmarkArm(ctx, value.arms.baseline, "$.arms.baseline");
    validateBenchmarkArm(ctx, value.arms.candidate, "$.arms.candidate");
  }
  const safetyFields = ["qualityGatePassed", "noAutoSubmitPassed", "privacyPassed", "permissionPassed"];
  if (checkObject(ctx, value.safety, "$.safety", safetyFields, safetyFields)) {
    for (const key of safetyFields) checkBoolean(ctx, value.safety[key], `$.safety.${key}`);
  }
  checkTimestamp(ctx, value.startedAt, "$.startedAt", { nullable: true });
  checkTimestamp(ctx, value.finishedAt, "$.finishedAt", { nullable: true });
  checkEnum(ctx, value.publicReason, "$.publicReason", "publicReason");
  if (value.executor === "codex" && (value.authorization?.required !== true || value.authorization?.granted !== true || value.initiatedBy !== "user")) {
    ctx.add("authorization_gate", "$.authorization", "The real Codex executor requires explicit user authorization for this run.");
  }
  if (value.executor === "fake" && value.budget?.estimatedCostMicros !== 0) {
    ctx.add("budget_invariant", "$.budget.estimatedCostMicros", "Fake executor fixtures cannot claim model cost.");
  }
  if (value.status === "passed") {
    const categoryTotal = ENUMS.benchmarkCategory.reduce((sum, category) => sum + Number(value.categoryCounts?.[category] || 0), 0);
    const categoryCoverage = ENUMS.benchmarkCategory.every((category) => Number(value.categoryCounts?.[category] || 0) >= 2);
    const comparable = comparabilityFields.every((key) => value.comparability?.[key] === true);
    const safe = safetyFields.every((key) => value.safety?.[key] === true);
    if (value.taskCount < 12 || categoryTotal !== value.taskCount || !categoryCoverage || !comparable || !safe || value.finishedAt === null) {
      ctx.add("benchmark_gate", "$.status", "Passing requires 12 tasks, two per category, comparable arms, deterministic acceptance, and all safety gates.");
    }
    if (value.publicReason !== "none") ctx.add("public_reason_mismatch", "$.publicReason", "Passing benchmark results use public reason none.");
  }
  if (value.status === "budget_exhausted" && (value.budget?.exhausted !== true || value.publicReason !== "budget_exhausted")) {
    ctx.add("budget_invariant", "$.status", "Budget exhaustion must be represented explicitly and not as policy failure.");
  }
  return finish(ctx);
}

function validateRuntimeEvidence(value) {
  const fields = [
    "contractVersion",
    "evidenceId",
    "kind",
    "consumer",
    "status",
    "buildId",
    "observedAt",
    "contractVersions",
    "checkTokens",
    "checks",
    "evidenceDigest",
    "publicReason",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.RUNTIME_EVIDENCE, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  for (const key of ["evidenceId", "buildId"]) checkToken(ctx, value[key], `$.${key}`);
  checkEnum(ctx, value.kind, "$.kind", "runtimeEvidenceKind");
  checkEnum(ctx, value.consumer, "$.consumer", "runtimeConsumer");
  checkEnum(ctx, value.status, "$.status", "runtimeEvidenceStatus");
  checkTimestamp(ctx, value.observedAt, "$.observedAt");
  const versionKeys = Object.keys(CONTRACT_VERSIONS);
  if (checkObject(ctx, value.contractVersions, "$.contractVersions", versionKeys, versionKeys)) {
    for (const [key, expected] of Object.entries(CONTRACT_VERSIONS)) {
      if (value.contractVersions[key] !== expected) ctx.add("contract_version", `$.contractVersions.${key}`, `Expected ${expected}.`);
    }
  }
  checkTokenArray(ctx, value.checkTokens, "$.checkTokens", { minLength: 1, maxLength: 32 });
  const checkFields = ["contractParsed", "fixturesPassed", "machineReadbackVerified", "noAutoSubmitVerified", "privacyScanPassed"];
  if (checkObject(ctx, value.checks, "$.checks", checkFields, checkFields)) {
    for (const key of checkFields) checkBoolean(ctx, value.checks[key], `$.checks.${key}`);
  }
  checkString(ctx, value.evidenceDigest, "$.evidenceDigest", { maxLength: 64 });
  if (!HEX_64_PATTERN.test(value.evidenceDigest || "")) ctx.add("digest_format", "$.evidenceDigest", "Evidence digest must be a lowercase SHA-256 token.");
  checkEnum(ctx, value.publicReason, "$.publicReason", "publicReason");
  if (value.status === "pass" && value.publicReason !== "none") {
    ctx.add("public_reason_mismatch", "$.publicReason", "Passing runtime evidence uses public reason none.");
  }
  if (value.status === "pass" && (value.checks?.contractParsed !== true || value.checks?.privacyScanPassed !== true)) {
    ctx.add("runtime_evidence_gate", "$.checks", "Passing runtime evidence requires parsed contracts and a privacy scan.");
  }
  return finish(ctx);
}

function validateContextSource(value) {
  const fields = [
    "contractVersion",
    "contextSourceId",
    "sourceType",
    "enabled",
    "permissionStatus",
    "trustLevel",
    "independentAuthorizationRequired",
    "preview",
    "tokenBudget",
    "collectResult",
    "executionPermissionsExpanded",
    "createdAt",
    "privacyFlags"
  ];
  const ctx = createContext(CONTRACTS.CONTEXT_SOURCE, value, fields);
  if (!ctx.rootIsObject) return finish(ctx);
  checkToken(ctx, value.contextSourceId, "$.contextSourceId");
  checkEnum(ctx, value.sourceType, "$.sourceType", "contextSourceType");
  checkBoolean(ctx, value.enabled, "$.enabled");
  checkEnum(ctx, value.permissionStatus, "$.permissionStatus", "contextPermissionStatus");
  checkEnum(ctx, value.trustLevel, "$.trustLevel", "contextTrustLevel");
  checkBoolean(ctx, value.independentAuthorizationRequired, "$.independentAuthorizationRequired");
  if (checkObject(ctx, value.preview, "$.preview", ["status", "itemCount", "tokenEstimate", "removable", "reviewed"], ["status", "itemCount", "tokenEstimate", "removable", "reviewed"])) {
    checkEnum(ctx, value.preview.status, "$.preview.status", "contextPreviewStatus");
    checkNumber(ctx, value.preview.itemCount, "$.preview.itemCount", { integer: true, min: 0 });
    checkNumber(ctx, value.preview.tokenEstimate, "$.preview.tokenEstimate", { integer: true, min: 0 });
    checkBoolean(ctx, value.preview.removable, "$.preview.removable");
    checkBoolean(ctx, value.preview.reviewed, "$.preview.reviewed");
  }
  checkNumber(ctx, value.tokenBudget, "$.tokenBudget", { integer: true, min: 0 });
  const collectFields = ["status", "itemCount", "tokenCount", "contentHandleToken", "promptInjectionRisk"];
  if (checkObject(ctx, value.collectResult, "$.collectResult", collectFields, collectFields)) {
    checkEnum(ctx, value.collectResult.status, "$.collectResult.status", "contextCollectStatus");
    checkNumber(ctx, value.collectResult.itemCount, "$.collectResult.itemCount", { integer: true, min: 0 });
    checkNumber(ctx, value.collectResult.tokenCount, "$.collectResult.tokenCount", { integer: true, min: 0 });
    checkToken(ctx, value.collectResult.contentHandleToken, "$.collectResult.contentHandleToken", { nullable: true });
    checkEnum(ctx, value.collectResult.promptInjectionRisk, "$.collectResult.promptInjectionRisk", "promptInjectionRisk");
  }
  checkBoolean(ctx, value.executionPermissionsExpanded, "$.executionPermissionsExpanded");
  checkTimestamp(ctx, value.createdAt, "$.createdAt");
  if (value.enabled === true && value.permissionStatus !== "granted") {
    ctx.add("permission_gate", "$.permissionStatus", "Every context source requires independent authorization before enablement.");
  }
  if (value.independentAuthorizationRequired !== true) {
    ctx.add("permission_gate", "$.independentAuthorizationRequired", "Independent authorization cannot be bypassed.");
  }
  if (value.trustLevel !== "untrusted") ctx.add("trust_invariant", "$.trustLevel", "Collected context remains untrusted data.");
  if (value.executionPermissionsExpanded !== false) {
    ctx.add("permission_gate", "$.executionPermissionsExpanded", "Context content cannot expand execution permissions.");
  }
  if (value.preview?.removable !== true) ctx.add("preview_invariant", "$.preview.removable", "Context must remain removable before model invocation.");
  if (value.collectResult?.tokenCount > value.tokenBudget) {
    ctx.add("budget_invariant", "$.collectResult.tokenCount", "Collected context cannot exceed its independent token budget.");
  }
  if (value.collectResult?.status === "collected") {
    if (
      value.enabled !== true
      || value.permissionStatus !== "granted"
      || value.preview?.reviewed !== true
      || value.collectResult.contentHandleToken === null
    ) {
      ctx.add("collect_gate", "$.collectResult", "Collection requires enablement, authorization, reviewed preview, and a session-scoped content handle.");
    }
    if (value.collectResult.promptInjectionRisk !== "low") {
      ctx.add("prompt_injection_gate", "$.collectResult.promptInjectionRisk", "Only context assessed as low prompt-injection risk may be collected.");
    }
  }
  return finish(ctx);
}

const VALIDATORS = Object.freeze({
  [CONTRACTS.PROMPT_SESSION_EVENT]: validatePromptSessionEvent,
  [CONTRACTS.CODEX_TARGET_ADAPTER_RESULT]: validateCodexTargetAdapterResult,
  [CONTRACTS.PENDING_OUTCOME]: validatePendingOutcome,
  [CONTRACTS.LEARNING_OBSERVATION]: validateLearningObservation,
  [CONTRACTS.LEARNING_ARTIFACT]: validateLearningArtifact,
  [CONTRACTS.GENERATION_POLICY]: validateGenerationPolicy,
  [CONTRACTS.POLICY_ROLLOUT]: validatePolicyRollout,
  [CONTRACTS.BENCHMARK_RESULT]: validateBenchmarkResult,
  [CONTRACTS.RUNTIME_EVIDENCE]: validateRuntimeEvidence,
  [CONTRACTS.CONTEXT_SOURCE]: validateContextSource
});

const NORMALIZERS = Object.freeze({
  [CONTRACTS.PROMPT_SESSION_EVENT]: normalizePromptSessionEvent,
  [CONTRACTS.CODEX_TARGET_ADAPTER_RESULT]: normalizeCodexTargetAdapterResult,
  [CONTRACTS.PENDING_OUTCOME]: normalizePendingOutcome,
  [CONTRACTS.LEARNING_OBSERVATION]: normalizeLearningObservation,
  [CONTRACTS.LEARNING_ARTIFACT]: normalizeLearningArtifact,
  [CONTRACTS.GENERATION_POLICY]: normalizeGenerationPolicy,
  [CONTRACTS.POLICY_ROLLOUT]: normalizePolicyRollout,
  [CONTRACTS.BENCHMARK_RESULT]: normalizeBenchmarkResult,
  [CONTRACTS.RUNTIME_EVIDENCE]: normalizeRuntimeEvidence,
  [CONTRACTS.CONTEXT_SOURCE]: normalizeContextSource
});

function resolveContract(contract) {
  if (VALIDATORS[contract]) return contract;
  const match = Object.entries(CONTRACT_VERSIONS).find(([, version]) => version === contract);
  if (match) return match[0];
  throw new TypeError(`Unknown outcome-learning contract: ${contract}`);
}

function validateContract(contract, value) {
  const resolved = resolveContract(contract);
  return VALIDATORS[resolved](value);
}

function normalizeContract(contract, value) {
  const resolved = resolveContract(contract);
  return NORMALIZERS[resolved](value);
}

function assertValidContract(contract, value) {
  const resolved = resolveContract(contract);
  const result = VALIDATORS[resolved](value);
  if (!result.valid) throw new ContractValidationError(resolved, result.errors);
  return NORMALIZERS[resolved](value);
}

function editStructureSignature(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "blank";
      if (trimmed.startsWith("```")) return "fence";
      if (/^#{1,6}\s/.test(trimmed)) return "heading";
      if (/^[-*+]\s/.test(trimmed)) return "bullet";
      if (/^\d+[.)]\s/.test(trimmed)) return "number";
      return "text";
    })
    .join("|");
}

function deriveEditFeatureSummary(generatedText, insertedText) {
  const generated = String(generatedText || "");
  const inserted = String(insertedText || "");
  if (generated === inserted) {
    return deepFreeze({ userEdited: false, lengthDeltaBucket: "none", structureChanged: false });
  }
  const generatedBytes = Buffer.byteLength(generated, "utf8");
  const insertedBytes = Buffer.byteLength(inserted, "utf8");
  const ratio = Math.abs(insertedBytes - generatedBytes) / Math.max(generatedBytes, 1);
  const lengthDeltaBucket = ratio <= 0.1 ? "small" : ratio <= 0.3 ? "medium" : "large";
  return deepFreeze({
    userEdited: true,
    lengthDeltaBucket,
    structureChanged: editStructureSignature(generated) !== editStructureSignature(inserted)
  });
}

const LEARNING_RULE_DEFINITIONS = Object.freeze([
  Object.freeze({
    patternToken: "rule_preserve_existing_changes",
    phrases: Object.freeze([
      "do not overwrite existing changes",
      "do not revert existing changes",
      "preserve existing changes",
      "\u4e0d\u8981\u8986\u76d6\u73b0\u6709\u6539\u52a8",
      "\u4e0d\u5f97\u56de\u9000\u73b0\u6709\u6539\u52a8",
      "\u4fdd\u7559\u73b0\u6709\u6539\u52a8"
    ]),
    payload: Object.freeze({
      directive: "Preserve existing user changes while completing scoped work.",
      taskScenarioTokens: Object.freeze(["workspace_change"])
    })
  }),
  Object.freeze({
    patternToken: "rule_recoverable_removal_only",
    phrases: Object.freeze([
      "do not permanently delete",
      "never permanently delete",
      "trash or recycle bin",
      "move to the recycle bin",
      "\u4e0d\u8981\u6c38\u4e45\u5220\u9664",
      "\u4e0d\u5f97\u6c38\u4e45\u5220\u9664",
      "\u79fb\u5165\u56de\u6536\u7ad9"
    ]),
    payload: Object.freeze({
      directive: "Use a recoverable Trash or Recycle Bin operation for removals.",
      taskScenarioTokens: Object.freeze(["workspace_change"])
    })
  }),
  Object.freeze({
    patternToken: "rule_no_auto_submit",
    phrases: Object.freeze([
      "no auto submit",
      "do not auto submit",
      "never send automatically",
      "do not send automatically",
      "\u4e0d\u8981\u81ea\u52a8\u53d1\u9001",
      "\u4e0d\u5f97\u81ea\u52a8\u53d1\u9001",
      "\u7981\u6b62\u81ea\u52a8\u53d1\u9001"
    ]),
    payload: Object.freeze({
      directive: "Keep no-auto-submit enabled for generated input.",
      taskScenarioTokens: Object.freeze(["safe_insert"])
    })
  }),
  Object.freeze({
    patternToken: "rule_verify_changed_behavior",
    phrases: Object.freeze([
      "must run tests",
      "tests must pass",
      "verify the changed behavior",
      "require regression tests",
      "\u5fc5\u987b\u8fd0\u884c\u6d4b\u8bd5",
      "\u5fc5\u987b\u901a\u8fc7\u6d4b\u8bd5",
      "\u9700\u8981\u56de\u5f52\u6d4b\u8bd5",
      "\u9a8c\u8bc1\u6539\u52a8\u884c\u4e3a"
    ]),
    payload: Object.freeze({
      directive: "Verify changed behavior with focused tests before completion.",
      taskScenarioTokens: Object.freeze(["workspace_change"])
    })
  }),
  Object.freeze({
    patternToken: "rule_keep_changes_scoped",
    phrases: Object.freeze([
      "keep changes scoped",
      "minimal scoped change",
      "do not refactor unrelated",
      "avoid unrelated refactors",
      "\u4fdd\u6301\u6700\u5c0f\u6539\u52a8",
      "\u4e0d\u8981\u65e0\u5173\u91cd\u6784",
      "\u4e0d\u5f97\u6269\u5927\u8303\u56f4"
    ]),
    payload: Object.freeze({
      directive: "Keep implementation changes scoped to the requested behavior.",
      taskScenarioTokens: Object.freeze(["workspace_change"])
    })
  })
]);

const LEARNING_ENVIRONMENT_DEFINITIONS = Object.freeze([
  Object.freeze({ token: "tauri", label: "Tauri" }),
  Object.freeze({ token: "electron", label: "Electron" }),
  Object.freeze({ token: "typescript", label: "TypeScript" }),
  Object.freeze({ token: "javascript", label: "JavaScript" }),
  Object.freeze({ token: "react", label: "React" }),
  Object.freeze({ token: "vue", label: "Vue" }),
  Object.freeze({ token: "rust", label: "Rust" }),
  Object.freeze({ token: "node.js", label: "Node.js" }),
  Object.freeze({ token: "nodejs", label: "Node.js" }),
  Object.freeze({ token: "python", label: "Python" }),
  Object.freeze({ token: "vite", label: "Vite" }),
  Object.freeze({ token: "next.js", label: "Next.js" }),
  Object.freeze({ token: "windows", label: "Windows" }),
  Object.freeze({ token: "linux", label: "Linux" })
]);

const LEARNING_ENVIRONMENT_CUES = Object.freeze([
  "project uses",
  "this project uses",
  "project is built with",
  "technology stack includes",
  "runs on",
  "\u9879\u76ee\u4f7f\u7528",
  "\u9879\u76ee\u57fa\u4e8e",
  "\u6280\u672f\u6808\u5305\u542b",
  "\u8fd0\u884c\u5728"
]);

const LEARNING_SKILL_CUES = Object.freeze([
  "reusable workflow",
  "repeatable workflow",
  "standard workflow",
  "standard process",
  "\u53ef\u590d\u7528\u6d41\u7a0b",
  "\u53ef\u91cd\u590d\u6d41\u7a0b",
  "\u6807\u51c6\u6d41\u7a0b",
  "\u56fa\u5b9a\u6d41\u7a0b"
]);

const LEARNING_SKILL_STEPS = Object.freeze({
  bug_fix: Object.freeze(["reproduce_issue", "identify_root_cause", "apply_scoped_fix", "run_regression_tests"]),
  feature_development: Object.freeze(["inspect_existing_contract", "implement_scoped_change", "add_or_update_tests", "verify_acceptance"]),
  refactor: Object.freeze(["lock_behavior_with_tests", "map_dependencies", "refactor_in_small_steps", "run_regression_tests"]),
  test_plan: Object.freeze(["identify_risk_surface", "add_failing_test", "implement_fixture", "run_test_matrix"]),
  code_review: Object.freeze(["inspect_diff", "identify_behavioral_risks", "verify_evidence", "report_findings"]),
  documentation: Object.freeze(["inspect_source_of_truth", "update_scoped_docs", "verify_examples", "check_links"]),
  security_review: Object.freeze(["map_trust_boundaries", "test_abuse_cases", "verify_guards", "report_residual_risk"]),
  ui_ux: Object.freeze(["inspect_existing_design", "implement_interaction", "verify_responsive_states", "review_visual_evidence"]),
  release_ops: Object.freeze(["build_release", "verify_artifacts", "run_packaged_smoke", "record_checksums"]),
  data_analysis: Object.freeze(["validate_inputs", "compute_metrics", "inspect_anomalies", "publish_findings"]),
  prompt_engineering: Object.freeze(["inspect_prompt_contract", "implement_scoped_prompt_change", "run_fixture_tests", "compare_output"]),
  product_idea: Object.freeze(["define_user_outcome", "map_constraints", "prototype_core_flow", "validate_acceptance"]),
  general: Object.freeze(["inspect_context", "execute_scoped_steps", "verify_result", "report_evidence"])
});

function normalizeLearningScenarioToken(value) {
  const token = String(value || "general")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const aliases = {
    feature: "feature_development",
    feature_development: "feature_development",
    bug: "bug_fix",
    bug_fix: "bug_fix",
    test: "test_plan",
    test_plan: "test_plan",
    review: "code_review",
    code_review: "code_review",
    docs: "documentation",
    doc: "documentation",
    documentation: "documentation",
    security: "security_review",
    security_review: "security_review",
    ui: "ui_ux",
    ux: "ui_ux",
    ui_ux: "ui_ux",
    release: "release_ops",
    release_ops: "release_ops",
    analysis: "data_analysis",
    data_analysis: "data_analysis",
    prompt: "prompt_engineering",
    prompt_engineering: "prompt_engineering",
    product: "product_idea",
    product_idea: "product_idea",
    refactor: "refactor"
  };
  return Object.prototype.hasOwnProperty.call(LEARNING_SKILL_STEPS, aliases[token] || token)
    ? (aliases[token] || token)
    : "general";
}

function learningSkillSeed(scenario) {
  const normalizedScenario = normalizeLearningScenarioToken(scenario);
  return {
    schemaVersion: LEARNING_CANDIDATE_SEED_VERSION,
    artifactType: "skill",
    patternToken: `skill_${normalizedScenario}`,
    payload: {
      triggerConditionTokens: [normalizedScenario],
      stepTokens: [...LEARNING_SKILL_STEPS[normalizedScenario]],
      verificationTokens: ["focused_checks_pass", "acceptance_evidence_recorded"],
      resourceTokens: ["project_files", "project_test_runner"],
      permissionTokens: ["workspace_read", "workspace_write_reviewed"],
      failureRecoveryTokens: ["stop_on_guard_failure", "restore_scoped_change"],
      scriptsExecutable: false,
      permissionCheckPassed: false,
      isolationTestPassed: false,
      adversarialReviewPassed: false
    }
  };
}

function learningRuleSeed(definition) {
  return {
    schemaVersion: LEARNING_CANDIDATE_SEED_VERSION,
    artifactType: "rule",
    patternToken: definition.patternToken,
    payload: {
      directive: definition.payload.directive,
      taskScenarioTokens: [...definition.payload.taskScenarioTokens]
    }
  };
}

function learningMemorySeed(definition) {
  return {
    schemaVersion: LEARNING_CANDIDATE_SEED_VERSION,
    artifactType: "memory",
    patternToken: `memory_${definition.token.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
    payload: {
      category: "technology_stack",
      statement: `The project uses ${definition.label}.`
    }
  };
}

function canonicalLearningCandidateSeed(patternToken) {
  const pattern = String(patternToken || "");
  if (pattern.startsWith("skill_")) {
    const scenario = pattern.slice("skill_".length);
    const seed = learningSkillSeed(scenario);
    return seed.patternToken === pattern ? seed : null;
  }
  const rule = LEARNING_RULE_DEFINITIONS.find((definition) => definition.patternToken === pattern);
  if (rule) return learningRuleSeed(rule);
  const memory = LEARNING_ENVIRONMENT_DEFINITIONS.find((definition) => (
    `memory_${definition.token.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}` === pattern
  ));
  return memory ? learningMemorySeed(memory) : null;
}

function deriveLearningCandidateSeed(inputText, options = {}) {
  const lower = String(inputText || "").toLowerCase().slice(0, 20_000);
  if (!lower.trim()) return null;
  if (LEARNING_SKILL_CUES.some((cue) => lower.includes(cue))) {
    return deepFreeze(learningSkillSeed(options.taskScenarioToken || options.taskScenario));
  }
  const rule = LEARNING_RULE_DEFINITIONS.find((definition) => (
    definition.phrases.some((phrase) => lower.includes(phrase))
  ));
  if (rule) return deepFreeze(learningRuleSeed(rule));
  if (LEARNING_ENVIRONMENT_CUES.some((cue) => lower.includes(cue))) {
    const environment = LEARNING_ENVIRONMENT_DEFINITIONS.find((definition) => lower.includes(definition.token));
    if (environment) return deepFreeze(learningMemorySeed(environment));
  }
  return null;
}

function canonicalLearningSeedValue(value) {
  if (Array.isArray(value)) return value.map(canonicalLearningSeedValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    canonicalLearningSeedValue(value[key])
  ]));
}

function normalizeLearningCandidateSeed(value) {
  if (!isPlainObject(value)
      || value.schemaVersion !== LEARNING_CANDIDATE_SEED_VERSION
      || typeof value.patternToken !== "string") return null;
  const expected = canonicalLearningCandidateSeed(value.patternToken);
  if (!expected
      || JSON.stringify(canonicalLearningSeedValue(value))
        !== JSON.stringify(canonicalLearningSeedValue(expected))) return null;
  return deepFreeze(expected);
}

module.exports = deepFreeze({
  BUNDLE_VERSION,
  FIXTURE_SET_VERSION,
  LEARNING_CANDIDATE_SEED_VERSION,
  CONTRACTS,
  CONTRACT_VERSIONS,
  ENUMS,
  PRIVACY_FLAG_NAMES,
  DEFAULT_PRIVACY_FLAGS,
  PUBLIC_REASON_COPY,
  MIN_FEEDBACK_DELAY_MS,
  OUTCOME_TTL_MS,
  ContractValidationError,
  mapPublicReason,
  getPublicReason,
  findPrivacyViolations,
  normalizeSemanticFingerprint,
  validateSemanticFingerprint,
  normalizePromptSessionEvent,
  validatePromptSessionEvent,
  normalizeCodexTargetAdapterResult,
  validateCodexTargetAdapterResult,
  normalizePendingOutcome,
  validatePendingOutcome,
  normalizeLearningObservation,
  validateLearningObservation,
  normalizeLearningArtifact,
  validateLearningArtifact,
  normalizeGenerationPolicy,
  validateGenerationPolicy,
  normalizePolicyRollout,
  validatePolicyRollout,
  normalizeBenchmarkResult,
  validateBenchmarkResult,
  normalizeRuntimeEvidence,
  validateRuntimeEvidence,
  normalizeContextSource,
  validateContextSource,
  deriveEditFeatureSummary,
  deriveLearningCandidateSeed,
  normalizeLearningCandidateSeed,
  validateContract,
  normalizeContract,
  assertValidContract
});
