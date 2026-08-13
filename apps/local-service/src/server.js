const http = require("node:http");
const { URL } = require("node:url");
const crypto = require("node:crypto");
const { buildCard, detectMode, rankSkills } = require("../../../packages/shared/smart-prompt-core");
const { estimateTextTokenCount, generateWithConfiguredProvider, getProviderStatuses, redactKey } = require("../../../packages/shared/llm-gateway");
const { buildEvolutionCandidateReport, buildExperimentOutcomeReport, buildFailureReasonPolicy, buildFailureReasonReport, buildFeedbackProfile, buildFeedbackSummary, buildPilotOutcomeReadinessReport, buildPromptQualityLiftReport, buildPromptQualityLiftSegmentsReport, buildPromptStrategyPlan, buildQualityExperiment, buildQualityLiftSegmentPolicy, buildSelfImprovementReport, buildStrategyExperimentAssignment, buildStrategyInsights, buildStrategyWeightPolicy, buildTaskOutcomeReport, formatEvolutionCandidateReport, formatExperimentOutcomeReport, formatFailureReasonPolicy, formatFailureReasonReport, formatFeedbackProfile, formatFeedbackSummary, formatPilotOutcomeReadinessReport, formatPromptQualityLiftReport, formatPromptQualityLiftSegmentsReport, formatPromptStrategyPlan, formatQualityLiftSegmentPolicy, formatSelfImprovementReport, formatStrategyInsights, formatStrategyWeightPolicy, formatTaskOutcomeReport, inferTaskScenario, scorePromptQuality } = require("../../../packages/shared/prompt-quality");
const { createStore, DEFAULT_PORT } = require("./store");
const { importSkillFolder } = require("./skill-library");
const { fillDesktopInput, getDesktopInputSnapshot } = require("./desktop-input-detector");
const {
  CONTRACTS,
  CONTRACT_VERSIONS,
  DEFAULT_PRIVACY_FLAGS,
  assertValidContract,
  deriveEditFeatureSummary,
  deriveLearningCandidateSeed,
  normalizePromptSessionEvent
} = require("../../../packages/outcome-learning");
const { createCodexTargetAdapter } = require("./modules/codex-target-adapter");
const { publicLearningObservation } = require("./modules/learning");
const { REQUIRED_NATIVE_BUILD_ID } = require("./modules/activation/codex-activation-store");

const AUTH_HEADER = "Authorization";
const TOKEN_HEADER = "X-Smart-Prompt-Token";
const ACTIVATION_CONTRACT_VERSION = "phase3-activation@1";
const CODEX_ACTIVATION_CONTRACT_VERSION = "codex-activation@2";
const DEFAULT_EXTENSION_ID = "fnpfpobenlbgdkjadiaeopdpnodeegpj";
const DEFAULT_EXTENSION_ORIGIN = `chrome-extension://${DEFAULT_EXTENSION_ID}`;
const GENERATION_BINDING_TTL_MS = 2 * 60 * 60 * 1000;
const TARGET_ROUTE_LEASE_GRACE_MS = 10 * 1000;

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  DEFAULT_EXTENSION_ORIGIN,
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^http:\/\/localhost(?::\d+)?$/i
]);

const PUBLIC_ROUTES = new Set([
  "GET /health",
  "GET /auth/bootstrap"
]);
const ACTIVATION_EVENT_ROUTES = new Set([
  "POST /activation/browser-seen",
  "POST /activation/complete"
]);

function isTrustedExtensionOrigin(origin) {
  const value = String(origin || "");
  return value.toLowerCase() === DEFAULT_EXTENSION_ORIGIN;
}

function validateActivationContract(body = {}) {
  if (body.contractVersion !== ACTIVATION_CONTRACT_VERSION) {
    const error = new Error("The installed extension activation contract is out of date.");
    error.code = "activation_contract_mismatch";
    throw error;
  }
}

function validateCodexActivationContract(body = {}) {
  if (body.contractVersion !== CODEX_ACTIVATION_CONTRACT_VERSION) {
    const error = new Error("The Codex activation contract is out of date.");
    error.code = "codex_activation_contract_mismatch";
    throw error;
  }
}

function outcomeErrorStatus(error) {
  if (error?.code === "outcome_idempotency_conflict" || error?.code === "outcome_feedback_conflict") return 409;
  if (error?.code === "pending_outcome_not_found") return 404;
  return 400;
}

function publicModuleErrorStatus(error) {
  const code = String(error?.code || "");
  if (code.includes("not_found")) return 404;
  if (code.includes("conflict") || code.includes("_changed") || code.includes("invalidated")
      || code === "verified_transaction_missing"
      || code === "target_transaction_binding_missing") return 409;
  if (code.includes("authorization") || code.includes("permission_required")) return 403;
  if (/^(invalid_|missing_|unexpected_|unsupported_|activation_|target_|transaction_|codex_target_|outcome_|learning_|policy_|generation_policy_|skill_|global_|benchmark_|privacy_)/.test(code)
    || code.includes("_required")
    || code.includes("_gate")
    || code.includes("_threshold")) return 400;
  return 500;
}

function normalizeAllowedOrigins(allowedOrigins = []) {
  return [...DEFAULT_ALLOWED_ORIGINS, ...allowedOrigins];
}

function matchesAllowedOrigin(origin, allowedOrigins = []) {
  return allowedOrigins.some((allowed) => {
    if (typeof allowed === "string") return allowed === origin;
    if (allowed instanceof RegExp) return allowed.test(origin);
    return false;
  });
}

function isTrustedOrigin(origin, allowedOrigins = []) {
  if (!origin) return true;
  return matchesAllowedOrigin(origin, normalizeAllowedOrigins(allowedOrigins));
}

function isBootstrapOriginAllowed(origin, options = {}) {
  if (!origin) return true;
  const privilegedOrigins = [
    DEFAULT_EXTENSION_ORIGIN,
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    ...(options.bootstrapOrigins || options.allowedOrigins || [])
  ];
  return matchesAllowedOrigin(origin, privilegedOrigins);
}

function createCorsHeaders(req, options = {}) {
  const origin = req?.headers?.origin || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": `Content-Type,${AUTH_HEADER},${TOKEN_HEADER}`,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Vary": "Origin"
  };
  if (!options.suppressCorsOrigin && origin && isTrustedOrigin(origin, options.allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function sendJson(req, res, status, value, options = {}) {
  res.writeHead(status, {
    ...createCorsHeaders(req, options)
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicSettings(settings) {
  const providerKeys = {};
  for (const [provider, value] of Object.entries(settings.providerKeys || {})) {
    providerKeys[provider] = value ? redactKey(value) : "";
  }
  return {
    ...settings,
    apiKey: settings.apiKey ? redactKey(settings.apiKey) : "",
    providerKeys,
    uploadWholePage: false,
    autoSubmit: false
  };
}

function applyExperimentGuidance(promptStrategyPlan, strategyInsights, strategyWeightPolicy, qualityLiftSegmentPolicy, failureReasonPolicy, experimentAssignment) {
  if (experimentAssignment?.arm !== "baseline_structure") {
    return {
      promptStrategyPlanForGeneration: promptStrategyPlan,
      promptStrategyText: formatPromptStrategyPlan(promptStrategyPlan),
      strategyInsightsText: formatStrategyInsights(strategyInsights),
      strategyWeightText: formatStrategyWeightPolicy(strategyWeightPolicy),
      qualityLiftSegmentText: formatQualityLiftSegmentPolicy(qualityLiftSegmentPolicy),
      failureReasonText: formatFailureReasonPolicy(failureReasonPolicy)
    };
  }
  const promptStrategyPlanForGeneration = {
    ...promptStrategyPlan,
    selectedStrategy: {
      id: "baseline_structure",
      version: promptStrategyPlan?.selectedStrategy?.version || promptStrategyPlan?.strategyPolicy?.version || "",
      confidence: promptStrategyPlan?.selectedStrategy?.confidence || "baseline",
      reason: "Experiment baseline holdout: use the default structured prompt without applying local strategy insights.",
      decision: "baseline",
      sourceStrategyId: promptStrategyPlan?.selectedStrategy?.id || ""
    },
    directives: (promptStrategyPlan?.directives || []).filter((item) => item.key === "cold_start_structure")
  };
  return {
    promptStrategyPlanForGeneration,
    promptStrategyText: "experiment=baseline_structure; use the default high-quality prompt shape; local strategy guidance is held out for comparison; privacy=aggregate-only",
    strategyInsightsText: "experiment=baseline_structure; local aggregate strategy insights are held out for comparison; privacy=aggregate-only",
    strategyWeightText: "experiment=baseline_structure; local aggregate strategy weights are held out for comparison; privacy=aggregate-only",
    qualityLiftSegmentText: "experiment=baseline_structure; local quality lift segment policy is held out for comparison; privacy=aggregate-only",
    failureReasonText: "experiment=baseline_structure; local failure reason policy is held out for comparison; privacy=aggregate-only raw-reason-not-stored"
  };
}

function contextFromSearchParams(url) {
  return {
    mode: url.searchParams.get("mode") || "",
    tool: url.searchParams.get("tool") || "",
    adapterId: url.searchParams.get("adapterId") || url.searchParams.get("adapter") || "",
    site: url.searchParams.get("site") || url.searchParams.get("host") || "",
    taskScenario: url.searchParams.get("taskScenario") || url.searchParams.get("scenario") || ""
  };
}

function safeContractToken(value, fallback = "", length = 120) {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:+-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, length);
  return token || fallback;
}

function requireOpaqueProjectScopeToken(value) {
  const token = String(value || "").trim();
  const looksLikePathOrUrl = /[\\/]/.test(token) || /^[a-z]:/i.test(token) || /^[a-z]+:\/\//i.test(token);
  const looksLikeCredential = /(?:bearer\s+|sk-|api[_-]?key|-----begin)/i.test(token);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/.test(token)
    || looksLikePathOrUrl
    || looksLikeCredential) {
    const error = new Error("A private opaque project scope token is required.");
    error.code = "invalid_project_scope_token";
    throw error;
  }
  return token;
}

function assertOnlyRequestFields(value, allowedFields, code = "unexpected_request_field") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("A JSON object is required.");
    error.code = "invalid_request_body";
    throw error;
  }
  const unexpected = Object.keys(value).find((key) => !allowedFields.has(key));
  if (unexpected) {
    const error = new Error("The request contains an unsupported field.");
    error.code = code;
    throw error;
  }
}

function targetRouteError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createTargetRouteState() {
  return {
    lastDesktopFill: null,
    lastDesktopPromptState: null,
    targetLeases: new Map(),
    generationBindings: new Map(),
    insertReceipts: new Map(),
    undoBindings: new Map(),
    transactionBindings: new Map()
  };
}

function pruneTargetRouteState(state, nowMs = Date.now()) {
  for (const [leaseId, lease] of state.targetLeases || []) {
    if (lease.expiresAtMs + TARGET_ROUTE_LEASE_GRACE_MS < nowMs) state.targetLeases.delete(leaseId);
  }
  for (const [generationId, binding] of state.generationBindings || []) {
    if (binding.expiresAtMs < nowMs) state.generationBindings.delete(generationId);
  }
  for (const [requestId, receipt] of state.insertReceipts || []) {
    if (receipt.expiresAtMs < nowMs) state.insertReceipts.delete(requestId);
  }
  for (const [transactionId, binding] of state.transactionBindings || []) {
    if (binding.expiresAtMs < nowMs) state.transactionBindings.delete(transactionId);
  }
}

function invalidateTargetRouteProject(state, projectScopeToken) {
  let invalidatedCount = 0;
  const removeMatching = (records, matches) => {
    for (const [key, value] of records || []) {
      if (!matches(value)) continue;
      records.delete(key);
      invalidatedCount += 1;
    }
  };
  removeMatching(state.targetLeases, (value) => value.projectScopeToken === projectScopeToken);
  removeMatching(state.generationBindings, (value) => value.projectScopeToken === projectScopeToken);
  removeMatching(state.insertReceipts, (value) => (
    value.projectScopeToken === projectScopeToken
    || value.response?.transaction?.projectScopeToken === projectScopeToken
  ));
  removeMatching(state.undoBindings, (value) => value.projectScopeToken === projectScopeToken);
  removeMatching(state.transactionBindings, (value) => value.projectScopeToken === projectScopeToken);
  return invalidatedCount;
}

function rememberTargetLease(state, lease) {
  if (!lease?.leaseId) return;
  const expiresAtMs = Date.parse(lease.expiresAt);
  state.targetLeases.set(lease.leaseId, {
    leaseId: lease.leaseId,
    draftHash: lease.draftHash,
    projectScopeToken: lease.projectScopeToken,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now()
  });
}

function registerGenerationBinding(state, body, card, store, nowMs = Date.now()) {
  const target = safeContractToken(body.target || body.context?.target || body.context?.tool, "", 40);
  if (target !== "codex") return null;
  const projectScopeToken = requireOpaqueProjectScopeToken(
    body.projectScopeToken || body.context?.projectScopeToken || ""
  );
  const knownScope = [...state.targetLeases.values()].some(
    (lease) => lease.projectScopeToken === projectScopeToken
  );
  if (!knownScope) {
    throw targetRouteError(
      "target_generation_scope_unverified",
      "The generation scope is not bound to a current Codex target inspection."
    );
  }
  for (const binding of state.undoBindings.values()) {
    if (binding.projectScopeToken === projectScopeToken) binding.invalidated = true;
  }
  const sessionId = safeContractToken(body.sessionId, "", 120)
    || `session-${crypto.randomBytes(12).toString("hex")}`;
  const strategyId = safeContractToken(card.strategyId, "baseline", 120);
  const strategyVersion = safeContractToken(
    card.qualityExperiment?.promptStrategyVersion
      || card.promptStrategyPlan?.selectedStrategy?.version,
    "v1",
    120
  );
  const modelFamilyToken = safeContractToken(store.getSettings().model, "configured-model", 120);
  const binding = {
    generationId: safeContractToken(card.generationId, "", 160),
    sessionId,
    target: "codex",
    projectScopeToken,
    strategyId,
    strategyVersion,
    modelFamilyToken,
    policyId: card.generationPolicy?.policyId || null,
    policyVersion: Number.isInteger(card.generationPolicy?.version)
      ? card.generationPolicy.version
      : null,
    taskScenarioToken: safeContractToken(card.taskScenario, "general", 120),
    generatedPrompt: String(card.prompt || ""),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + GENERATION_BINDING_TTL_MS
  };
  if (!binding.generationId) {
    throw targetRouteError("generation_binding_invalid", "The generated card has no valid generation id.");
  }
  state.generationBindings.set(binding.generationId, binding);
  card.sessionId = sessionId;
  card.strategyVersion = strategyVersion;
  card.modelFamilyToken = modelFamilyToken;
  return binding;
}

function promptSessionEventFromTransaction(binding, claim, transaction) {
  const digest = crypto.createHash("sha256")
    .update(`${binding.generationId}\n${transaction.transactionId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return assertValidContract(CONTRACTS.PROMPT_SESSION_EVENT, normalizePromptSessionEvent({
    contractVersion: CONTRACT_VERSIONS[CONTRACTS.PROMPT_SESSION_EVENT],
    eventId: `verified-insert-${digest}`,
    eventType: "verified_insert",
    occurredAt: transaction.issuedAt,
    sessionId: binding.sessionId,
    generationId: binding.generationId,
    target: "codex",
    projectScopeToken: claim.projectScopeToken,
    strategyId: binding.strategyId,
    strategyVersion: binding.strategyVersion,
    modelFamilyToken: binding.modelFamilyToken,
    outcomeId: `outcome-${digest}`,
    policyId: binding.policyId,
    policyVersion: binding.policyVersion,
    taskOutcomeToken: "unknown",
    insertVerified: true,
    noAutoSubmit: true,
    failureReasonTokens: [],
    privacyFlags: { ...DEFAULT_PRIVACY_FLAGS }
  }));
}

function createDefaultCodexTargetAdapter(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "codexTargetAdapter")) {
    return options.codexTargetAdapter || null;
  }
  if (options.disableAuth === true) return null;
  try {
    const { createPowerShellProbeRunner } = require("./modules/codex-target-adapter/powershell-probe-runner");
    return createCodexTargetAdapter({
      probeRunner: createPowerShellProbeRunner(options.codexTargetAdapterOptions || {})
    });
  } catch {
    return null;
  }
}

const REPORT_ROUTES = Object.freeze([
  {
    method: "GET",
    pathname: "/metrics/strategy-insights",
    build({ metrics, context }) {
      const strategyInsights = buildStrategyInsights(metrics, context);
      return {
        ok: true,
        strategyInsights,
        strategyInsightsText: formatStrategyInsights(strategyInsights)
      };
    }
  },
  {
    method: "GET",
    pathname: "/metrics/experiment-outcomes",
    build({ metrics, context }) {
      const experimentOutcomeReport = buildExperimentOutcomeReport(metrics, context);
      return {
        ok: true,
        experimentOutcomeReport,
        experimentOutcomeText: formatExperimentOutcomeReport(experimentOutcomeReport)
      };
    }
  },
  {
    method: "GET",
    pathname: "/metrics/task-outcomes",
    build({ metrics, context }) {
      const taskOutcomeReport = buildTaskOutcomeReport(metrics, context);
      return {
        ok: true,
        taskOutcomeReport,
        taskOutcomeText: formatTaskOutcomeReport(taskOutcomeReport)
      };
    }
  },
  {
    method: "GET",
    pathname: "/metrics/pilot-outcomes",
    build({ metrics }) {
      const pilotOutcomeReadinessReport = buildPilotOutcomeReadinessReport(metrics);
      return {
        ok: true,
        pilotOutcomeReadinessReport,
        pilotOutcomeReadinessText: formatPilotOutcomeReadinessReport(pilotOutcomeReadinessReport)
      };
    }
  },
  {
    method: "GET",
    pathname: "/metrics/strategy-weights",
    build({ metrics, context }) {
      const pilotOutcomeReadinessReport = buildPilotOutcomeReadinessReport(metrics);
      const strategyWeightPolicy = buildStrategyWeightPolicy(metrics, context, pilotOutcomeReadinessReport);
      return {
        ok: true,
        strategyWeightPolicy,
        strategyWeightText: formatStrategyWeightPolicy(strategyWeightPolicy)
      };
    }
  },
  {
    method: "GET",
    pathname: "/metrics/prompt-quality-lift",
    build({ metrics, context }) {
      const promptQualityLiftReport = buildPromptQualityLiftReport(metrics, context);
      return {
        ok: true,
        promptQualityLiftReport,
        promptQualityLiftText: formatPromptQualityLiftReport(promptQualityLiftReport)
      };
    }
  },
  {
    method: "GET",
    pathname: "/metrics/prompt-quality-lift-segments",
    build({ metrics, context }) {
      const promptQualityLiftSegmentsReport = buildPromptQualityLiftSegmentsReport(metrics, context);
      return {
        ok: true,
        promptQualityLiftSegmentsReport,
        promptQualityLiftSegmentsText: formatPromptQualityLiftSegmentsReport(promptQualityLiftSegmentsReport)
      };
    }
  },
  {
    method: "GET",
    pathname: "/learning/reflections",
    build({ metrics, context }) {
      const selfImprovementReport = buildSelfImprovementReport(metrics, context);
      return {
        ok: true,
        selfImprovementReport,
        selfImprovementText: formatSelfImprovementReport(selfImprovementReport)
      };
    }
  },
  {
    method: "GET",
    pathname: "/learning/evolution-candidates",
    build({ metrics, context }) {
      const selfImprovementReport = buildSelfImprovementReport(metrics, context);
      const evolutionCandidateReport = buildEvolutionCandidateReport(selfImprovementReport, context);
      return {
        ok: true,
        selfImprovementReport,
        selfImprovementText: formatSelfImprovementReport(selfImprovementReport),
        evolutionCandidateReport,
        evolutionCandidateText: formatEvolutionCandidateReport(evolutionCandidateReport)
      };
    }
  }
]);

function findReportRoute(req, url) {
  return REPORT_ROUTES.find((route) => route.method === req.method && route.pathname === url.pathname) || null;
}

function buildReportRoutePayload(route, store, url) {
  return route.build({
    metrics: store.getMetrics(),
    context: contextFromSearchParams(url)
  });
}

function buildGenerationContext(body = {}, metrics = {}) {
  const input = body.input || "";
  const baseContext = {
    ...(body.context || {}),
    mode: body.mode || body.context?.mode || detectMode(input)
  };
  const context = {
    ...baseContext,
    taskScenario: inferTaskScenario(input, baseContext)
  };
  const feedbackSummary = buildFeedbackSummary(metrics, context);
  const feedbackProfile = buildFeedbackProfile(metrics, context);
  const experimentOutcomeReport = buildExperimentOutcomeReport(metrics, context);
  const experimentOutcomeText = formatExperimentOutcomeReport(experimentOutcomeReport);
  const taskOutcomeReport = buildTaskOutcomeReport(metrics, context);
  const taskOutcomeText = formatTaskOutcomeReport(taskOutcomeReport);
  const pilotOutcomeReadinessReport = buildPilotOutcomeReadinessReport(metrics);
  const strategyWeightPolicy = buildStrategyWeightPolicy(metrics, context, pilotOutcomeReadinessReport);
  const strategyWeightText = formatStrategyWeightPolicy(strategyWeightPolicy);
  const promptQualityLiftReport = buildPromptQualityLiftReport(metrics, context);
  const promptQualityLiftText = formatPromptQualityLiftReport(promptQualityLiftReport);
  const promptQualityLiftSegmentsReport = buildPromptQualityLiftSegmentsReport(metrics, context);
  const promptQualityLiftSegmentsText = formatPromptQualityLiftSegmentsReport(promptQualityLiftSegmentsReport);
  const failureReasonReport = buildFailureReasonReport(metrics, context);
  const failureReasonReportText = formatFailureReasonReport(failureReasonReport);
  const promptStrategyPlan = buildPromptStrategyPlan(metrics, context, feedbackProfile, experimentOutcomeReport, taskOutcomeReport, strategyWeightPolicy, promptQualityLiftSegmentsReport, failureReasonReport);
  const qualityLiftSegmentPolicy = promptStrategyPlan.qualityLiftSegmentPolicy || buildQualityLiftSegmentPolicy(promptQualityLiftSegmentsReport, context);
  const failureReasonPolicy = promptStrategyPlan.failureReasonPolicy || buildFailureReasonPolicy(failureReasonReport, context);
  const strategyInsights = buildStrategyInsights(metrics, context);
  const selfImprovementReport = buildSelfImprovementReport(metrics, {
    ...context,
    strategyInsights,
    experimentOutcomeReport,
    taskOutcomeReport,
    pilotOutcomeReadinessReport,
    strategyWeightPolicy,
    promptQualityLiftReport,
    promptQualityLiftSegmentsReport,
    qualityLiftSegmentPolicy,
    failureReasonReport,
    failureReasonPolicy
  });
  const selfImprovementText = formatSelfImprovementReport(selfImprovementReport);
  const evolutionCandidateReport = buildEvolutionCandidateReport(selfImprovementReport, context);
  const evolutionCandidateText = formatEvolutionCandidateReport(evolutionCandidateReport);
  const generationId = `generation-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const experimentAssignment = buildStrategyExperimentAssignment(context, promptStrategyPlan, strategyInsights, {
    generationId
  });
  const {
    promptStrategyPlanForGeneration,
    promptStrategyText,
    strategyInsightsText,
    strategyWeightText: generationStrategyWeightText,
    qualityLiftSegmentText,
    failureReasonText
  } = applyExperimentGuidance(promptStrategyPlan, strategyInsights, strategyWeightPolicy, qualityLiftSegmentPolicy, failureReasonPolicy, experimentAssignment);
  const baselineHoldout = experimentAssignment?.arm === "baseline_structure";
  const selfImprovementTextForGeneration = baselineHoldout
    ? "experiment=baseline_structure; local self-improvement reflection is held out for comparison; privacy=aggregate-only no-automatic-mutation"
    : selfImprovementText;
  const evolutionCandidateTextForGeneration = baselineHoldout
    ? "experiment=baseline_structure; local evolution candidates are held out for comparison; privacy=aggregate-only no-automatic-mutation"
    : evolutionCandidateText;
  const enrichedContext = {
    ...context,
    feedbackSummary,
    feedbackSummaryText: formatFeedbackSummary(feedbackSummary),
    feedbackProfile,
    feedbackProfileText: formatFeedbackProfile(feedbackProfile),
    promptStrategyPlan: promptStrategyPlanForGeneration,
    promptStrategyText,
    strategyInsights,
    strategyInsightsText,
    strategyWeightPolicy,
    strategyWeightText: generationStrategyWeightText || strategyWeightText,
    promptQualityLiftReport,
    promptQualityLiftText,
    promptQualityLiftSegmentsReport,
    promptQualityLiftSegmentsText,
    qualityLiftSegmentPolicy,
    qualityLiftSegmentText,
    failureReasonReport,
    failureReasonReportText,
    failureReasonPolicy,
    failureReasonText,
    selfImprovementReport,
    selfImprovementText: selfImprovementTextForGeneration,
    evolutionCandidateReport,
    evolutionCandidateText: evolutionCandidateTextForGeneration,
    experimentOutcomeReport,
    experimentOutcomeText,
    taskOutcomeReport,
    taskOutcomeText,
    experimentAssignment
  };
  return {
    context,
    enrichedContext,
    feedbackSummary,
    feedbackProfile,
    promptStrategyPlanForGeneration,
    strategyInsights,
    strategyWeightPolicy,
    promptQualityLiftReport,
    promptQualityLiftSegmentsReport,
    qualityLiftSegmentPolicy,
    failureReasonReport,
    failureReasonPolicy,
    selfImprovementReport,
    evolutionCandidateReport,
    experimentOutcomeReport,
    taskOutcomeReport,
    experimentAssignment,
    generationId
  };
}

function routeKey(req, url) {
  return `${req.method} ${url.pathname}`;
}

function createExactRoute(method, pathname, handler) {
  return {
    method,
    pathname,
    match(req, url) {
      return req.method === method && url.pathname === pathname;
    },
    handler
  };
}

function createPrefixRoute(method, prefix, handler) {
  return {
    method,
    prefix,
    match(req, url) {
      return req.method === method && url.pathname.startsWith(prefix);
    },
    handler
  };
}

function createDynamicRoute(name, match, handler) {
  return {
    name,
    match,
    handler
  };
}

function findAppRoute(routes, req, url) {
  return routes.find((route) => route.match(req, url)) || null;
}

function extractAuthToken(req) {
  const explicit = req.headers[TOKEN_HEADER.toLowerCase()];
  if (explicit) return String(explicit);
  const auth = req.headers[AUTH_HEADER.toLowerCase()] || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req, store, options = {}) {
  if (options.disableAuth) return true;
  const expected = store.getAuthToken();
  const actual = extractAuthToken(req);
  return Boolean(expected && actual && secureEqual(actual, expected));
}

function sanitizeDesktopFillEvidence(fill = {}) {
  const summary = fill.summary || {};
  const foreground = fill.foreground || {};
  const target = fill.target || {};
  const targetSignals = target.inputSignals || {};
  return {
    schemaVersion: fill.schemaVersion || "",
    createdAt: fill.createdAt || "",
    pass: Boolean(fill.pass),
    reason: fill.reason || "",
    writeAttempted: Boolean(fill.writeAttempted),
    verified: Boolean(fill.verified),
    strategy: fill.strategy || "",
    selfTest: Boolean(fill.selfTest),
    confirmForeground: Boolean(fill.confirmForeground),
    allowClipboardFallback: Boolean(fill.allowClipboardFallback),
    allowTextPatternVerification: Boolean(fill.allowTextPatternVerification),
    clipboardFallbackTried: Boolean(fill.clipboardFallbackTried),
    clipboardRestored: Boolean(fill.clipboardRestored),
    foreground: {
      detectedToolProfile: foreground.detectedToolProfile || "unknown",
      titleHash: foreground.titleHash || "",
      titleLength: Number(foreground.titleLength || 0),
      expectedTitleHashMatched: Boolean(foreground.expectedTitleHashMatched),
      expectedToolProfileMatched: Boolean(foreground.expectedToolProfileMatched)
    },
    target: {
      index: Number.isFinite(Number(target.index)) ? Number(target.index) : -1,
      controlType: target.controlType || "",
      titleHash: target.titleHash || "",
      titleLength: Number(target.titleLength || 0),
      hasNativeWindowHandle: Boolean(target.hasNativeWindowHandle),
      hasValuePattern: Boolean(target.hasValuePattern),
      hasTextPattern: Boolean(target.hasTextPattern),
      inputSignals: {
        score: Number(targetSignals.score || 0),
        hasKeyboardFocus: Boolean(targetSignals.hasKeyboardFocus),
        focusedElementMatch: Boolean(targetSignals.focusedElementMatch),
        caretWithinBounds: Boolean(targetSignals.caretWithinBounds),
        caretWindowMatch: Boolean(targetSignals.caretWindowMatch),
        cursorWithinBounds: Boolean(targetSignals.cursorWithinBounds),
        nearWindowBottom: Boolean(targetSignals.nearWindowBottom),
        broadDocument: Boolean(targetSignals.broadDocument),
        semanticComposerHint: Boolean(targetSignals.semanticComposerHint),
        profileComposerCandidate: Boolean(targetSignals.profileComposerCandidate)
      }
    },
    summary: {
      candidateCount: Number(summary.candidateCount || 0),
      safeCandidateCount: Number(summary.safeCandidateCount || 0),
      focusedCandidateCount: Number(summary.focusedCandidateCount || 0),
      caretCandidateCount: Number(summary.caretCandidateCount || 0),
      semanticCandidateCount: Number(summary.semanticCandidateCount || 0),
      bestCandidateIndex: Number.isFinite(Number(summary.bestCandidateIndex)) ? Number(summary.bestCandidateIndex) : -1,
      bestCandidateScore: Number(summary.bestCandidateScore || 0),
      requestedTextLength: Number(summary.requestedTextLength || 0),
      requestedTextHash: summary.requestedTextHash || "",
      verifiedTextLength: Number(summary.verifiedTextLength || 0),
      verifiedTextHash: summary.verifiedTextHash || "",
      autoSubmit: Boolean(summary.autoSubmit),
      submitSignalCount: Number(summary.submitSignalCount || 0)
    },
    privacy: {
      titleRedacted: fill.privacy?.titleRedacted !== false,
      elementNamesHashed: fill.privacy?.elementNamesHashed !== false,
      elementValuesNotReadBeforeWrite: fill.privacy?.elementValuesNotReadBeforeWrite !== false,
      writtenTextNotStored: fill.privacy?.writtenTextNotStored !== false,
      clipboardTextNotStored: fill.privacy?.clipboardTextNotStored !== false,
      fallbackRequiresExplicitAllow: fill.privacy?.fallbackRequiresExplicitAllow !== false,
      verificationUsesLengthAndHash: fill.privacy?.verificationUsesLengthAndHash !== false,
      promptTextNotRead: fill.privacy?.promptTextNotRead !== false,
      autoSubmit: Boolean(fill.privacy?.autoSubmit)
    }
  };
}

function hashDesktopPromptText(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function sanitizePromptStateToken(value, fallback = "") {
  const token = String(value || "").toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "");
  return token || fallback;
}

function sanitizeDesktopPromptState(body = {}) {
  const draft = String(body.draft || body.draftText || "");
  const generated = String(body.prompt || body.generatedPrompt || body.text || "");
  const draftText = draft.trim();
  const generatedText = generated.trim();
  const activeText = generatedText || draftText;
  const activeTextKind = generatedText ? "generated" : draftText ? "draft" : "none";
  const readiness = body.readiness || {};
  return {
    schemaVersion: "p25-desktop-prompt-state@1",
    recordedAt: new Date().toISOString(),
    source: sanitizePromptStateToken(body.source, "desktop-shell"),
    prepared: activeText.length > 0,
    activeTextKind,
    generatedBy: sanitizePromptStateToken(body.generatedBy || body.generator || "", "unknown"),
    draftLength: draftText.length,
    draftHash: draftText ? hashDesktopPromptText(draftText) : "",
    generatedLength: generatedText.length,
    generatedHash: generatedText ? hashDesktopPromptText(generatedText) : "",
    activeTextLength: activeText.length,
    activeTextHash: activeText ? hashDesktopPromptText(activeText) : "",
    readiness: {
      profile: sanitizePromptStateToken(readiness.profile || body.profile, "unknown"),
      titleHash: String(readiness.titleHash || body.titleHash || "").slice(0, 64),
      candidateIndex: Number.isFinite(Number(readiness.candidateIndex ?? body.candidateIndex))
        ? Number(readiness.candidateIndex ?? body.candidateIndex)
        : -1,
      ready: Boolean(readiness.ready ?? body.ready),
      overlayReady: Boolean(readiness.overlayReady ?? body.overlayReady),
      readinessReason: sanitizePromptStateToken(readiness.readinessReason || body.readinessReason, "unknown"),
      overlayReadinessReason: sanitizePromptStateToken(readiness.overlayReadinessReason || body.overlayReadinessReason, "unknown"),
      noAutoSubmit: body.noAutoSubmit !== false
    },
    privacy: {
      promptTextNotStored: true,
      draftTextNotStored: true,
      onlyLengthAndHash: true,
      targetTitleRedacted: true,
      targetInputsNotStored: true,
      noAutoSubmitRequired: true
    }
  };
}

function buildDiagnosticsExport(store) {
  const { dataDir, ...diagnostics } = store.exportDiagnostics();
  diagnostics.dataDirConfigured = Boolean(dataDir);
  diagnostics.strategyInsights = diagnostics.strategyInsights || buildStrategyInsights(diagnostics.metrics || {});
  diagnostics.strategyInsightsText = diagnostics.strategyInsightsText || formatStrategyInsights(diagnostics.strategyInsights);
  diagnostics.experimentOutcomeReport = diagnostics.experimentOutcomeReport || buildExperimentOutcomeReport(diagnostics.metrics || {});
  diagnostics.experimentOutcomeText = diagnostics.experimentOutcomeText || formatExperimentOutcomeReport(diagnostics.experimentOutcomeReport);
  diagnostics.taskOutcomeReport = diagnostics.taskOutcomeReport || buildTaskOutcomeReport(diagnostics.metrics || {});
  diagnostics.taskOutcomeText = diagnostics.taskOutcomeText || formatTaskOutcomeReport(diagnostics.taskOutcomeReport);
  diagnostics.pilotOutcomeReadinessReport = diagnostics.pilotOutcomeReadinessReport || buildPilotOutcomeReadinessReport(diagnostics.metrics || {});
  diagnostics.pilotOutcomeReadinessText = diagnostics.pilotOutcomeReadinessText || formatPilotOutcomeReadinessReport(diagnostics.pilotOutcomeReadinessReport);
  diagnostics.strategyWeightPolicy = diagnostics.strategyWeightPolicy || buildStrategyWeightPolicy(diagnostics.metrics || {}, {}, diagnostics.pilotOutcomeReadinessReport);
  diagnostics.strategyWeightText = diagnostics.strategyWeightText || formatStrategyWeightPolicy(diagnostics.strategyWeightPolicy);
  diagnostics.promptQualityLiftReport = diagnostics.promptQualityLiftReport || buildPromptQualityLiftReport(diagnostics.metrics || {});
  diagnostics.promptQualityLiftText = diagnostics.promptQualityLiftText || formatPromptQualityLiftReport(diagnostics.promptQualityLiftReport);
  diagnostics.promptQualityLiftSegmentsReport = diagnostics.promptQualityLiftSegmentsReport || buildPromptQualityLiftSegmentsReport(diagnostics.metrics || {});
  diagnostics.promptQualityLiftSegmentsText = diagnostics.promptQualityLiftSegmentsText || formatPromptQualityLiftSegmentsReport(diagnostics.promptQualityLiftSegmentsReport);
  diagnostics.qualityLiftSegmentPolicy = diagnostics.qualityLiftSegmentPolicy || buildQualityLiftSegmentPolicy(diagnostics.promptQualityLiftSegmentsReport, {});
  diagnostics.qualityLiftSegmentText = diagnostics.qualityLiftSegmentText || formatQualityLiftSegmentPolicy(diagnostics.qualityLiftSegmentPolicy);
  diagnostics.failureReasonReport = diagnostics.failureReasonReport || buildFailureReasonReport(diagnostics.metrics || {});
  diagnostics.failureReasonText = diagnostics.failureReasonText || formatFailureReasonReport(diagnostics.failureReasonReport);
  diagnostics.failureReasonPolicy = diagnostics.failureReasonPolicy || buildFailureReasonPolicy(diagnostics.failureReasonReport, {});
  diagnostics.failureReasonPolicyText = diagnostics.failureReasonPolicyText || formatFailureReasonPolicy(diagnostics.failureReasonPolicy);
  diagnostics.selfImprovementReport = diagnostics.selfImprovementReport || buildSelfImprovementReport(diagnostics.metrics || {}, {
    strategyInsights: diagnostics.strategyInsights,
    experimentOutcomeReport: diagnostics.experimentOutcomeReport,
    taskOutcomeReport: diagnostics.taskOutcomeReport,
    pilotOutcomeReadinessReport: diagnostics.pilotOutcomeReadinessReport,
    strategyWeightPolicy: diagnostics.strategyWeightPolicy,
    promptQualityLiftReport: diagnostics.promptQualityLiftReport,
    promptQualityLiftSegmentsReport: diagnostics.promptQualityLiftSegmentsReport,
    qualityLiftSegmentPolicy: diagnostics.qualityLiftSegmentPolicy,
    failureReasonReport: diagnostics.failureReasonReport,
    failureReasonPolicy: diagnostics.failureReasonPolicy
  });
  diagnostics.selfImprovementText = diagnostics.selfImprovementText || formatSelfImprovementReport(diagnostics.selfImprovementReport);
  diagnostics.evolutionCandidateReport = diagnostics.evolutionCandidateReport || buildEvolutionCandidateReport(diagnostics.selfImprovementReport, {});
  diagnostics.evolutionCandidateText = diagnostics.evolutionCandidateText || formatEvolutionCandidateReport(diagnostics.evolutionCandidateReport);
  return diagnostics;
}

function normalizeProviderError(error = {}) {
  const code = String(error.code || "").toLowerCase();
  const message = String(error.message || "").toLowerCase();
  const body = typeof error.body === "string"
    ? error.body.slice(0, 2000).toLowerCase()
    : "";
  const status = Number(error.status || error.statusCode || 0);
  const signal = `${code} ${message} ${body}`;
  if (status === 401 || status === 403 || /auth|credential|api.?key|unauthori[sz]|permission|invalid.?key/.test(signal)) {
    return {
      code: "credential_invalid",
      message: "Provider credentials were rejected."
    };
  }
  if (/(?:model|deployment).{0,120}(?:not.?found|does not exist|unsupported|unavailable|invalid|missing)|(?:not.?found|unsupported|invalid|missing).{0,120}(?:model|deployment)/.test(signal)) {
    return {
      code: "model_unavailable",
      message: "The selected model is unavailable for this provider."
    };
  }
  if (/network|timeout|timed.?out|econn|enotfound|fetch failed|dns|socket/.test(signal)) {
    return {
      code: "network_unavailable",
      message: "The provider could not be reached."
    };
  }
  return {
    code: "provider_error",
    message: "The provider returned an unexpected error."
  };
}

const SETTINGS_VALIDATION_MESSAGES = Object.freeze({
  model_invalid: "Model ID is invalid.",
  custom_provider_name_invalid: "Custom provider name is invalid.",
  custom_provider_protocol_invalid: "Custom provider protocol is invalid.",
  custom_provider_base_url_invalid: "Custom provider Base URL is invalid."
});

function normalizeSettingsValidationError(error = {}) {
  const code = String(error.code || "");
  return SETTINGS_VALIDATION_MESSAGES[code]
    ? { code, message: SETTINGS_VALIDATION_MESSAGES[code] }
    : null;
}

async function buildLlmTestResponse({ body, store, generateWithLlm }) {
  const context = {
    host: "local",
    tool: "Smart Prompt",
    inputKind: "first-run-provider-test",
    pathKind: "local",
    mode: body.mode || "idea"
  };
  const input = "Generate a short Smart Prompt provider connectivity check.";
  const skills = rankSkills(input, context, store.getSkills(), 3);
  try {
    const candidateSettings = body.settings && typeof body.settings === "object"
      ? body.settings
      : null;
    let settings = candidateSettings && typeof store.previewSettings === "function"
      ? store.previewSettings(candidateSettings)
      : store.getSettings();
    const card = await generateWithLlm({
      input,
      context,
      skills,
      variantIndex: 0,
      settings
    });
    if (candidateSettings && body.persistOnSuccess === true) {
      settings = store.saveSettings(candidateSettings);
    }
    if ((!candidateSettings || body.persistOnSuccess === true)
      && typeof store.recordActivationModelReady === "function") {
      store.recordActivationModelReady({
        provider: card.provider || settings.provider,
        model: card.model || settings.model,
        testedAt: new Date().toISOString()
      });
    }
    return {
      status: 200,
      payload: {
        ok: true,
        provider: card.provider || settings.provider,
        model: card.model || settings.model,
        mode: card.mode || context.mode,
        generatedBy: card.generatedBy || "llm",
        promptLength: String(card.prompt || "").length,
        skillCount: skills.length,
        uploadWholePage: false,
        autoSubmit: false,
        settingsPersisted: Boolean(candidateSettings && body.persistOnSuccess === true),
        testedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const validationError = normalizeSettingsValidationError(error);
    const normalized = validationError || normalizeProviderError(error);
    return {
      status: validationError ? 400 : 502,
      payload: {
        ok: false,
        error: {
          ...normalized,
          operation: "llm_test"
        }
      }
    };
  }
}

async function buildGenerateResponse({ body, store, generateWithLlm }) {
  const generation = buildGenerationContext(body, store.getMetrics());
  const {
    context,
    enrichedContext,
    feedbackSummary,
    feedbackProfile,
    promptStrategyPlanForGeneration,
    strategyInsights,
    strategyWeightPolicy,
    promptQualityLiftReport,
    promptQualityLiftSegmentsReport,
    qualityLiftSegmentPolicy,
    failureReasonReport,
    failureReasonPolicy,
    selfImprovementReport,
    evolutionCandidateReport,
    experimentOutcomeReport,
    taskOutcomeReport,
    experimentAssignment,
    generationId
  } = generation;
  const settings = store.getSettings();
  const suppliedProjectScopeToken = body.projectScopeToken || body.context?.projectScopeToken || "";
  const projectScopeToken = suppliedProjectScopeToken
    ? requireOpaqueProjectScopeToken(suppliedProjectScopeToken)
    : "";
  const target = safeContractToken(body.target || body.context?.target || context.tool, "", 40);
  const taskScenarioToken = safeContractToken(context.taskScenario, "general", 120);
  const modelFamilyToken = safeContractToken(settings.model, "configured_model", 120);
  const learningCandidateSeed = target === "codex"
    ? deriveLearningCandidateSeed(body.input || "", { taskScenarioToken })
    : null;
  const policyAssignment = target === "codex" && projectScopeToken
    ? store.selectGenerationPolicy({
        target: "codex",
        projectScopeToken,
        taskScenarioToken,
        modelFamilyToken,
        generationId
      })
    : null;
  const requestContext = policyAssignment
    ? {
        ...context,
        generationPolicy: policyAssignment.policy,
        generationPolicyAssignment: {
          arm: policyAssignment.arm,
          rolloutId: policyAssignment.rolloutId
        }
      }
    : enrichedContext;
  const skills = rankSkills(body.input || "", requestContext, store.getSkills(), 3);
  let card;
  try {
    card = await generateWithLlm({
      input: body.input || "",
      context: requestContext,
      skills,
      variantIndex: body.variantIndex || 0,
      settings
    });
  } catch (error) {
    if (body.allowTemplateFallback === true) {
      const normalized = normalizeProviderError(error);
      card = {
        ...buildCard(body.input || "", requestContext, skills, body.variantIndex || 0),
        generatedBy: "template-fallback",
        error: {
          ...normalized,
          operation: "generate"
        }
      };
    } else {
      const normalized = normalizeProviderError(error);
      return {
        status: 502,
        payload: {
          ok: false,
          error: {
            ...normalized,
            operation: "generate"
          }
        }
      };
    }
  }
  if (!card.quality) {
    card.quality = scorePromptQuality(card.prompt, {
      mode: card.mode,
      skills,
      context: requestContext
    });
  }
  if (policyAssignment) {
    card.generationPolicy = {
      policyId: policyAssignment.policy.policyId,
      version: policyAssignment.policy.version,
      arm: policyAssignment.arm,
      rolloutId: policyAssignment.rolloutId
    };
  } else {
    card.feedbackSummary = feedbackSummary;
    card.feedbackProfile = feedbackProfile;
    card.promptStrategyPlan = promptStrategyPlanForGeneration;
    card.strategyInsights = strategyInsights;
    card.strategyWeightPolicy = strategyWeightPolicy;
    card.promptQualityLiftReport = promptQualityLiftReport;
    card.promptQualityLiftSegmentsReport = promptQualityLiftSegmentsReport;
    card.qualityLiftSegmentPolicy = qualityLiftSegmentPolicy;
    card.failureReasonReport = failureReasonReport;
    card.failureReasonPolicy = failureReasonPolicy;
    card.selfImprovementReport = selfImprovementReport;
    card.evolutionCandidateReport = evolutionCandidateReport;
    card.experimentOutcomeReport = experimentOutcomeReport;
    card.taskOutcomeReport = taskOutcomeReport;
  }
  card.experimentAssignment = experimentAssignment;
  card.taskScenario = context.taskScenario;
  const qualityExperiment = buildQualityExperiment(card, feedbackProfile, {
    generationId,
    taskScenario: context.taskScenario,
    promptStrategyId: experimentAssignment.assignedStrategyId || promptStrategyPlanForGeneration.selectedStrategy?.id,
    promptStrategyVersion: promptStrategyPlanForGeneration.selectedStrategy?.version,
    experimentAssignment,
    strategyInsightsVersion: strategyInsights.insightVersion,
    strategyReadiness: strategyInsights.readiness?.status,
    strategyWeightPolicy,
    strategyWeightVersion: strategyWeightPolicy.weightPolicyVersion,
    strategyWeightStatus: strategyWeightPolicy.readiness?.status,
    strategyWeightPromoted: strategyWeightPolicy.selectedPromotion?.strategyId,
    strategyWeightSuppressed: strategyWeightPolicy.selectedSuppression?.strategyId,
    strategyWeightDecision: promptStrategyPlanForGeneration.selectedStrategy?.decision
  });
  card.generationId = qualityExperiment.generationId;
  card.strategyId = qualityExperiment.strategyId;
  card.qualityExperiment = qualityExperiment;
  card.modelFamilyToken = modelFamilyToken;
  card.learningPatternToken = learningCandidateSeed?.patternToken || null;

  store.addPromptHistory({
    id: qualityExperiment.generationId,
    created_at: new Date().toISOString(),
    generationId: qualityExperiment.generationId,
    strategyId: qualityExperiment.strategyId,
    mode: card.mode,
    tool: card.tool,
    generatedBy: card.generatedBy,
    qualityScore: card.quality.score,
    promptLength: qualityExperiment.promptLength,
    tokenUsage: card.generatedBy === "llm"
      ? {
          ...(card.tokenUsage || {}),
          insertedPromptTokenEstimate: estimateTextTokenCount(card.prompt)
        }
      : { source: "unavailable" },
    context: {
      host: context.host,
      inputKind: context.inputKind,
      taskScenario: context.taskScenario,
      projectScopeToken,
      modelFamilyToken,
      learningCandidateSeed,
      generationPolicyId: policyAssignment?.policy?.policyId || "",
      generationPolicyVersion: policyAssignment?.policy?.version || null,
      generationPolicyArm: policyAssignment?.arm || "",
      feedbackConfidence: feedbackProfile.confidence,
      promptStrategyId: qualityExperiment.promptStrategyId || "",
      promptStrategyVersion: promptStrategyPlanForGeneration.selectedStrategy?.version || "",
      experimentArm: qualityExperiment.experimentArm || "",
      experimentVersion: qualityExperiment.experimentVersion || "",
      experimentComparisonKey: qualityExperiment.experimentComparisonKey || "",
      experimentOutcomeStatus: promptStrategyPlanForGeneration.outcomePolicy?.status || "",
      experimentOutcomeDecision: promptStrategyPlanForGeneration.outcomePolicy?.decision || "",
      experimentOutcomeRecommendation: promptStrategyPlanForGeneration.outcomePolicy?.recommendationKey || "",
      experimentOutcomeComparable: Boolean(promptStrategyPlanForGeneration.outcomePolicy?.comparable),
      taskOutcomeStatus: promptStrategyPlanForGeneration.taskOutcomePolicy?.status || "",
      taskOutcomeDecision: promptStrategyPlanForGeneration.taskOutcomePolicy?.decision || "",
      taskOutcomeRecommendation: promptStrategyPlanForGeneration.taskOutcomePolicy?.recommendationKey || "",
      taskOutcomeCount: promptStrategyPlanForGeneration.taskOutcomePolicy?.outcomeCount || 0,
      strategyWeightVersion: strategyWeightPolicy.weightPolicyVersion || "",
      strategyWeightStatus: strategyWeightPolicy.readiness?.status || "",
      strategyWeightPromoted: strategyWeightPolicy.selectedPromotion?.strategyId || "",
      strategyWeightSuppressed: strategyWeightPolicy.selectedSuppression?.strategyId || "",
      strategyWeightDecision: promptStrategyPlanForGeneration.selectedStrategy?.decision || "",
      qualityLiftCohort: qualityExperiment.qualityLiftCohort || "",
      promptQualityLiftStatus: promptQualityLiftReport.readiness?.status || "",
      promptQualityLiftDecision: promptQualityLiftReport.readiness?.primaryDecision || "",
      qualityLiftSegmentPolicyVersion: qualityLiftSegmentPolicy.policyVersion || "",
      qualityLiftSegmentDecision: qualityLiftSegmentPolicy.decision || "",
      qualityLiftSegmentRecommendation: qualityLiftSegmentPolicy.recommendationKey || "",
      qualityLiftSegmentStatus: qualityLiftSegmentPolicy.readiness?.status || "",
      failureReasonPolicyVersion: failureReasonPolicy.policyVersion || "",
      failureReasonPolicyDecision: failureReasonPolicy.decision || "",
      failureReasonPolicyRecommendation: failureReasonPolicy.recommendationKey || "",
      failureReasonPolicyStatus: failureReasonPolicy.readiness?.status || "",
      failureReasonEventCount: failureReasonPolicy.readiness?.totalReasonEvents || 0,
      selfImprovementVersion: selfImprovementReport.reportVersion || "",
      selfImprovementReadiness: selfImprovementReport.readiness?.status || "",
      selfImprovementReflectionCount: selfImprovementReport.readiness?.reflectionCount || 0,
      selfImprovementRegressionCount: selfImprovementReport.readiness?.regressionReflectionCount || 0,
      evolutionCandidateVersion: evolutionCandidateReport.candidateVersion || "",
      evolutionCandidateCount: evolutionCandidateReport.readiness?.candidateCount || 0,
      evolutionPromotionMode: evolutionCandidateReport.promotionMode || "",
      evolutionMutationAllowed: Boolean(evolutionCandidateReport.mutationAllowed),
      strategyInsightsVersion: qualityExperiment.strategyInsightsVersion || "",
      strategyInsightsReadiness: strategyInsights.readiness?.status || ""
    }
  });
  return { status: 200, payload: { ok: true, card } };
}

function createAppRoutes({
  store,
  options = {},
  generateWithLlm = generateWithConfiguredProvider,
  desktopInputSnapshot = getDesktopInputSnapshot,
  desktopFill = fillDesktopInput,
  codexTargetAdapter = null,
  state = {}
}) {
  const routeState = state;
  const json = (ctx, status, value) => sendJson(ctx.req, ctx.res, status, value, options);

  return [
    createExactRoute("GET", "/health", (ctx) => {
      json(ctx, 200, {
        ok: true,
        service: "smart-prompt-local-service",
        version: "0.2.0",
        sidecar: "node",
        runtimeContract: "phase3-node-runtime@1",
        authRequired: true,
        activationContract: ACTIVATION_CONTRACT_VERSION,
        activationContracts: {
          legacy: ACTIVATION_CONTRACT_VERSION,
          codex: CODEX_ACTIVATION_CONTRACT_VERSION
        },
        outcomeLearningContract: CONTRACT_VERSIONS[CONTRACTS.PENDING_OUTCOME],
        codexTargetAdapter: {
          available: Boolean(codexTargetAdapter),
          contractVersion: CONTRACT_VERSIONS[CONTRACTS.CODEX_TARGET_ADAPTER_RESULT]
        }
      });
    }),
    createExactRoute("GET", "/auth/bootstrap", (ctx) => {
      json(ctx, 200, {
        ok: true,
        auth: {
          scheme: "Bearer",
          header: AUTH_HEADER,
          tokenHeader: TOKEN_HEADER,
          token: store.getAuthToken()
        }
      });
    }),
    createExactRoute("GET", "/settings", (ctx) => {
      json(ctx, 200, { ok: true, settings: publicSettings(store.getSettings()) });
    }),
    createExactRoute("GET", "/llm/providers", (ctx) => {
      json(ctx, 200, { ok: true, ...getProviderStatuses(store.getSettings()) });
    }),
    createExactRoute("POST", "/llm/test", async (ctx) => {
      const body = await readJson(ctx.req);
      const response = await buildLlmTestResponse({ body, store, generateWithLlm });
      json(ctx, response.status, response.payload);
    }),
    createExactRoute("GET", "/activation/status", (ctx) => {
      json(ctx, 200, { ok: true, activation: store.getActivationStatus() });
    }),
    createExactRoute("POST", "/activation/browser-seen", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        validateActivationContract(body);
        const activation = store.markActivationBrowserSeen({
          site: body.site,
          seenAt: body.seenAt
        });
        json(ctx, 200, { ok: true, activation });
      } catch (error) {
        json(ctx, 400, {
          ok: false,
          error: { code: error.code || "activation_browser_seen_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/activation/complete", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        validateActivationContract(body);
        const activation = store.completeActivation({
          eventId: body.eventId,
          site: body.site,
          completionKind: body.completionKind,
          targetKind: body.targetKind,
          stableReadback: body.stableReadback,
          extensionBuildId: body.extensionBuildId,
          verified: body.verified,
          copied: body.copied
        });
        json(ctx, 200, { ok: true, activation });
      } catch (error) {
        json(ctx, 400, {
          ok: false,
          error: { code: error.code || "activation_complete_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/activation/reset", (ctx) => {
      json(ctx, 200, { ok: true, activation: store.resetActivationProgress() });
    }),
    createExactRoute("POST", "/activation/runtime-health", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        const activation = store.setRuntimeHealth(body.runtimeHealth, {
          errorCode: body.errorCode
        });
        json(ctx, 200, { ok: true, activation });
      } catch (error) {
        json(ctx, 400, {
          ok: false,
          error: { code: error.code || "activation_runtime_health_failed", message: "Runtime health update was rejected." }
        });
      }
    }),
    createExactRoute("GET", "/activation/codex/status", (ctx) => {
      json(ctx, 200, { ok: true, activation: store.getCodexActivationStatus() });
    }),
    createExactRoute("POST", "/activation/codex/loop-start", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        validateCodexActivationContract(body);
        json(ctx, 200, {
          ok: true,
          activation: store.markCodexActivationLoopStarted()
        });
      } catch (error) {
        json(ctx, 400, {
          ok: false,
          error: { code: error.code || "codex_activation_loop_start_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/activation/codex/complete", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        validateCodexActivationContract(body);
        assertOnlyRequestFields(
          body,
          new Set(["contractVersion", "transactionId"]),
          "activation_self_reported_evidence_rejected"
        );
        if (!codexTargetAdapter) {
          throw targetRouteError("codex_target_adapter_unavailable", "Codex target verification is unavailable.");
        }
        pruneTargetRouteState(routeState);
        const transactionBinding = routeState.transactionBindings.get(body.transactionId);
        if (!transactionBinding) {
          throw targetRouteError("verified_transaction_missing", "A verified insert transaction is required.");
        }
        const claim = codexTargetAdapter.claimVerifiedTransaction({
          transactionId: body.transactionId,
          binding: "activation"
        });
        if (claim.status !== "ready" || claim.receipt?.insertVerified !== true
            || claim.receipt?.noAutoSubmit !== true || claim.receipt?.verification !== "machine") {
          throw targetRouteError(claim.reasonToken || "verified_transaction_missing", "Verified insertion evidence is unavailable.");
        }
        if (claim.receipt.projectScopeToken !== transactionBinding.projectScopeToken) {
          throw targetRouteError("transaction_scope_conflict", "The verified transaction scope changed.");
        }
        const eventMs = Date.parse(transactionBinding.transaction.issuedAt);
        if (!Number.isFinite(eventMs)) {
          throw targetRouteError("verified_transaction_invalid", "The verified transaction timestamp is invalid.");
        }
        const eventId = `activation-verified_insert-${Math.trunc(eventMs)}`;
        const activation = store.completeCodexActivation({
          eventId,
          target: "codex",
          site: "codex",
          completionKind: "verified_insert",
          targetKind: "codex-composer",
          stableReadback: true,
          verified: true,
          noAutoSubmit: true,
          nativeBuildId: REQUIRED_NATIVE_BUILD_ID
        });
        json(ctx, 200, { ok: true, activation, claim: claim.receipt });
      } catch (error) {
        json(ctx, publicModuleErrorStatus(error), {
          ok: false,
          error: { code: error.code || "codex_activation_complete_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/activation/codex/reset", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        validateCodexActivationContract(body);
        json(ctx, 200, { ok: true, activation: store.resetCodexActivationProgress() });
      } catch (error) {
        json(ctx, 400, {
          ok: false,
          error: { code: error.code || "codex_activation_reset_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/activation/codex/runtime-health", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        validateCodexActivationContract(body);
        const activation = store.setCodexActivationRuntimeHealth(body.runtimeHealth, {
          errorCode: body.errorCode
        });
        json(ctx, 200, { ok: true, activation });
      } catch (error) {
        json(ctx, 400, {
          ok: false,
          error: { code: error.code || "codex_activation_runtime_health_failed", message: "Runtime health update was rejected." }
        });
      }
    }),
    createExactRoute("GET", "/outcomes/v2", (ctx) => {
      const filters = {};
      for (const key of ["target", "projectScopeToken", "status"]) {
        const value = ctx.url.searchParams.get(key);
        if (value !== null && value !== "") filters[key] = value;
      }
      try {
        json(ctx, 200, { ok: true, outcomes: store.listOutcomeContracts(filters) });
      } catch (error) {
        json(ctx, outcomeErrorStatus(error), {
          ok: false,
          error: { code: error.code || "outcome_list_failed", message: error.message }
        });
      }
    }),
    createExactRoute("GET", "/outcomes/v2/signals", (ctx) => {
      const filters = {};
      for (const key of ["target", "projectScopeToken", "outcomeId"]) {
        const value = ctx.url.searchParams.get(key);
        if (value !== null && value !== "") filters[key] = value;
      }
      try {
        json(ctx, 200, { ok: true, signals: store.listOutcomeImplicitSignals(filters) });
      } catch (error) {
        json(ctx, outcomeErrorStatus(error), {
          ok: false,
          error: { code: error.code || "outcome_signal_list_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/outcomes/v2/events", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        const result = store.recordExternalPendingOutcomeEvent(body.event || body);
        json(ctx, 200, { ok: true, result });
      } catch (error) {
        json(ctx, outcomeErrorStatus(error), {
          ok: false,
          error: { code: error.code || "outcome_event_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/outcomes/v2/claim", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        const result = store.claimPendingOutcomeFeedback(body);
        json(ctx, 200, { ok: true, result });
      } catch (error) {
        json(ctx, outcomeErrorStatus(error), {
          ok: false,
          error: { code: error.code || "outcome_claim_failed", message: error.message }
        });
      }
    }),
    createExactRoute("POST", "/outcomes/v2/feedback", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        const feedbackInput = {};
        for (const key of [
          "feedbackId",
          "requestId",
          "eventId",
          "outcomeId",
          "taskOutcomeToken",
          "outcome",
          "reasonToken",
          "failureReasonToken"
        ]) {
          if (Object.prototype.hasOwnProperty.call(body, key)) feedbackInput[key] = body[key];
        }
        const result = store.submitPendingOutcomeFeedback(feedbackInput);
        const learning = ["succeeded", "failed"].includes(result.outcome?.status)
          ? store.recordResolvedOutcomeObservation(result.outcome)
          : null;
        json(ctx, 200, { ok: true, result, learning });
      } catch (error) {
        json(ctx, outcomeErrorStatus(error), {
          ok: false,
          error: { code: error.code || "outcome_feedback_failed", message: error.message }
        });
      }
    }),
    createExactRoute("GET", "/learning/v1/observations", (ctx) => {
      const projectScopeToken = ctx.url.searchParams.get("projectScopeToken") || "";
      json(ctx, 200, {
        ok: true,
        observations: store.listLearningObservations(projectScopeToken ? { projectScopeToken } : {})
          .map(publicLearningObservation)
      });
    }),
    createExactRoute("GET", "/learning/v1/artifacts", (ctx) => {
      const filter = {};
      for (const key of ["projectScopeToken", "artifactType", "status"]) {
        const value = ctx.url.searchParams.get(key);
        if (value) filter[key] = value;
      }
      json(ctx, 200, { ok: true, artifacts: store.listLearningArtifacts(filter) });
    }),
    createExactRoute("GET", "/learning/v1/candidate", (ctx) => {
      const artifactId = ctx.url.searchParams.get("artifactId") || "";
      const candidate = store.getLearningCandidateDetail(artifactId);
      json(ctx, candidate ? 200 : 404, candidate
        ? { ok: true, candidate }
        : { ok: false, error: { code: "learning_candidate_not_found", message: "Learning candidate was not found." } });
    }),
    createExactRoute("GET", "/learning/v1/reminder", (ctx) => {
      const reminder = store.getLearningCardReminder({
        projectScopeToken: ctx.url.searchParams.get("projectScopeToken") || "",
        featureTokens: ctx.url.searchParams.getAll("featureToken")
      });
      json(ctx, 200, { ok: true, reminder });
    }),
    createExactRoute("POST", "/learning/v1/reminder/resolve", async (ctx) => {
      const body = await readJson(ctx.req);
      assertOnlyRequestFields(body, new Set([
        "projectScopeToken",
        "input",
        "taskScenarioToken",
        "modeToken"
      ]), "unexpected_learning_reminder_field");
      const projectScopeToken = requireOpaqueProjectScopeToken(body.projectScopeToken || "");
      const input = String(body.input || "").slice(0, 20_000);
      const taskScenarioToken = safeContractToken(
        body.taskScenarioToken || inferTaskScenario(input, {}),
        "general",
        120
      );
      const modeToken = safeContractToken(body.modeToken || detectMode(input), "standard", 80);
      const modelFamilyToken = safeContractToken(store.getSettings().model, "configured_model", 120);
      const learningCandidateSeed = deriveLearningCandidateSeed(input, { taskScenarioToken });
      const featureTokens = [
        `scenario:${taskScenarioToken}`,
        `mode:${modeToken}`,
        `model:${modelFamilyToken}`,
        "target:codex"
      ];
      if (learningCandidateSeed) featureTokens.push(`learning:${learningCandidateSeed.patternToken}`);
      const reminder = store.getLearningCardReminder({ projectScopeToken, featureTokens });
      json(ctx, 200, { ok: true, reminder, featureTokens });
    }),
    createExactRoute("POST", "/learning/v1/candidates/ignore", async (ctx) => {
      const body = await readJson(ctx.req);
      json(ctx, 200, { ok: true, candidate: store.ignoreLearningCandidate(body.artifactId) });
    }),
    createExactRoute("POST", "/learning/v1/candidates/review", async (ctx) => {
      const body = await readJson(ctx.req);
      json(ctx, 200, {
        ok: true,
        candidate: store.reviewLearningCandidate(body.artifactId, body.decision || body)
      });
    }),
    createExactRoute("POST", "/learning/v1/candidates/skill-gates", async (ctx) => {
      const body = await readJson(ctx.req);
      json(ctx, 200, {
        ok: true,
        candidate: store.setLearningSkillGates(body.artifactId, body.gates || {})
      });
    }),
    createExactRoute("POST", "/learning/v1/promotion-evidence", async (ctx) => {
      await readJson(ctx.req);
      json(ctx, 400, {
        ok: false,
        error: {
          code: "promotion_evidence_server_derivation_required",
          message: "Global promotion evidence is derived only from verified stored outcomes."
        }
      });
    }),
    createExactRoute("GET", "/learning/v1/global-proposals", (ctx) => {
      json(ctx, 200, { ok: true, proposals: store.listGlobalLearningProposals() });
    }),
    createExactRoute("POST", "/learning/v1/global-proposals/confirm", async (ctx) => {
      const body = await readJson(ctx.req);
      json(ctx, 200, {
        ok: true,
        artifact: store.confirmGlobalLearningProposal(body.proposalId, { confirmed: body.confirmed === true })
      });
    }),
    createExactRoute("POST", "/privacy/v1/projects/clear", async (ctx) => {
      const body = await readJson(ctx.req);
      const result = store.clearProjectLearningData(body.projectScopeToken);
      const targetTransactions = invalidateTargetRouteProject(routeState, body.projectScopeToken);
      codexTargetAdapter?.invalidateUndo?.();
      json(ctx, 200, {
        ok: true,
        result: {
          ...result,
          counts: { ...result.counts, targetTransactions }
        }
      });
    }),
    createExactRoute("GET", "/policies/v1", (ctx) => {
      const filter = {};
      for (const key of ["status", "policyId", "projectScopeToken", "taskScenarioToken", "modelFamilyToken", "target"]) {
        const value = ctx.url.searchParams.get(key);
        if (value) filter[key] = value;
      }
      json(ctx, 200, {
        ok: true,
        learningPaused: store.isGenerationPolicyLearningPaused(),
        policies: store.listGenerationPolicies(filter)
      });
    }),
    createExactRoute("GET", "/policies/v1/rollouts", (ctx) => {
      const filter = {};
      for (const key of ["status", "policyId", "policyVersion"]) {
        const value = ctx.url.searchParams.get(key);
        if (value) filter[key] = value;
      }
      json(ctx, 200, { ok: true, rollouts: store.listGenerationPolicyRollouts(filter) });
    }),
    createExactRoute("POST", "/policies/v1/compile", async (ctx) => {
      const body = await readJson(ctx.req);
      const policy = body.register === false
        ? store.compileGenerationPolicy(body.policy || body)
        : store.compileAndRegisterGenerationPolicy(body.policy || body);
      json(ctx, 200, { ok: true, policy });
    }),
    createExactRoute("POST", "/policies/v1/benchmarked", async (ctx) => {
      await readJson(ctx.req);
      json(ctx, 400, {
        ok: false,
        error: {
          code: "policy_benchmark_server_evidence_required",
          message: "Benchmark evidence must be recorded by the authorized server-side benchmark harness."
        }
      });
    }),
    createExactRoute("POST", "/policies/v1/canary", async (ctx) => {
      const body = await readJson(ctx.req);
      assertOnlyRequestFields(
        body,
        new Set(["policyId", "version", "canaryShareBps"]),
        "unexpected_policy_canary_field"
      );
      json(ctx, 200, {
        ok: true,
        policy: store.startGenerationPolicyCanaryFromBenchmark(body.policyId, body.version, {
          canaryShareBps: body.canaryShareBps
        })
      });
    }),
    createExactRoute("POST", "/policies/v1/evaluate", async (ctx) => {
      const body = await readJson(ctx.req);
      assertOnlyRequestFields(body, new Set(["rolloutId"]), "unexpected_policy_evaluate_field");
      const result = store.evaluateGenerationPolicyRolloutFromStoredResults(body.rolloutId);
      json(ctx, 200, {
        ok: true,
        evaluation: result.evaluation,
        policy: result.policy,
        confidence: result.confidence
      });
    }),
    createExactRoute("POST", "/policies/v1/rollback", async (ctx) => {
      const body = await readJson(ctx.req);
      json(ctx, 200, {
        ok: true,
        policy: store.rollbackGenerationPolicy(body.policyId, body.version, body.reason || "manual")
      });
    }),
    createExactRoute("POST", "/policies/v1/pause", async (ctx) => {
      const body = await readJson(ctx.req);
      json(ctx, 200, { ok: true, state: store.pauseGenerationPolicyLearning(body.reason || "manual") });
    }),
    createExactRoute("POST", "/policies/v1/resume", (ctx) => {
      json(ctx, 200, { ok: true, state: store.resumeGenerationPolicyLearning() });
    }),
    createExactRoute("PUT", "/settings", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        const settings = store.saveSettings(body.settings || body);
        json(ctx, 200, { ok: true, settings: publicSettings(settings) });
      } catch (error) {
        const validationError = normalizeSettingsValidationError(error);
        if (!validationError) throw error;
        json(ctx, 400, {
          ok: false,
          error: validationError
        });
      }
    }),
    createExactRoute("GET", "/skills", (ctx) => {
      json(ctx, 200, { ok: true, skills: store.getSkills() });
    }),
    createExactRoute("GET", "/prompts", (ctx) => {
      json(ctx, 200, { ok: true, prompts: store.getPrompts() });
    }),
    createExactRoute("GET", "/search", (ctx) => {
      const query = ctx.url.searchParams.get("q") || "";
      const kind = ctx.url.searchParams.get("kind") || "all";
      json(ctx, 200, {
        ok: true,
        queryLength: query.length,
        prompts: kind === "skills" ? [] : store.searchPrompts(query),
        skills: kind === "prompts" ? [] : store.searchSkills(query)
      });
    }),
    createExactRoute("POST", "/prompts", async (ctx) => {
      const body = await readJson(ctx.req);
      const promptBody = body.body || body.prompt || "";
      if (!String(promptBody).trim()) {
        json(ctx, 400, { ok: false, error: { code: "empty_prompt", message: "Prompt body is required." } });
        return;
      }
      const prompts = store.addPrompt({ ...body, body: promptBody });
      json(ctx, 200, { ok: true, prompt: prompts[0], prompts });
    }),
    createPrefixRoute("DELETE", "/prompts/", (ctx) => {
      const id = decodeURIComponent(ctx.url.pathname.slice("/prompts/".length));
      const deleted = store.deletePrompt(id);
      json(ctx, deleted ? 200 : 404, deleted
        ? { ok: true, prompts: store.getPrompts() }
        : { ok: false, error: { code: "prompt_not_found", message: "Prompt not found." } });
    }),
    createExactRoute("POST", "/skills/import-folder", async (ctx) => {
      const body = await readJson(ctx.req);
      const imported = importSkillFolder(body.path);
      const skills = store.addSkills(imported);
      json(ctx, 200, { ok: true, imported, skills });
    }),
    createPrefixRoute("DELETE", "/skills/", (ctx) => {
      const id = decodeURIComponent(ctx.url.pathname.slice("/skills/".length));
      const deleted = store.deleteSkill(id);
      json(ctx, deleted ? 200 : 404, deleted
        ? { ok: true, skills: store.getSkills() }
        : { ok: false, error: { code: "skill_not_found", message: "Skill not found." } });
    }),
    createExactRoute("POST", "/skills/recommend", async (ctx) => {
      const body = await readJson(ctx.req);
      const skills = rankSkills(body.input || "", body.context || {}, store.getSkills(), 3);
      json(ctx, 200, { ok: true, skills });
    }),
    createExactRoute("GET", "/data/backup", (ctx) => {
      json(ctx, 200, { ok: true, backup: store.exportData() });
    }),
    createExactRoute("POST", "/data/restore", async (ctx) => {
      const body = await readJson(ctx.req);
      const restored = store.restoreData(body.backup || body);
      json(ctx, 200, { ok: true, restored });
    }),
    createExactRoute("DELETE", "/data/all", (ctx) => {
      const reset = store.clearAllLocalData();
      json(ctx, 200, { ok: true, reset, clearAllLocalData: true });
    }),
    createExactRoute("GET", "/diagnostics/export", (ctx) => {
      json(ctx, 200, { ok: true, diagnostics: buildDiagnosticsExport(store) });
    }),
    createExactRoute("POST", "/target/codex/inspect", async (ctx) => {
      const body = await readJson(ctx.req);
      assertOnlyRequestFields(body, new Set([]), "unexpected_target_inspect_field");
      if (!codexTargetAdapter) {
        json(ctx, 503, {
          ok: false,
          error: { code: "codex_target_adapter_unavailable", message: "Codex target verification is unavailable." }
        });
        return;
      }
      pruneTargetRouteState(routeState);
      const inspected = codexTargetAdapter.inspect();
      if (inspected.lease) rememberTargetLease(routeState, inspected.lease);
      json(ctx, 200, { ok: true, ...inspected });
    }),
    createExactRoute("POST", "/target/codex/read", async (ctx) => {
      const body = await readJson(ctx.req);
      assertOnlyRequestFields(body, new Set(["leaseId"]), "unexpected_target_read_field");
      if (!codexTargetAdapter) {
        json(ctx, 503, {
          ok: false,
          error: { code: "codex_target_adapter_unavailable", message: "Codex target verification is unavailable." }
        });
        return;
      }
      const read = codexTargetAdapter.readDraft({ leaseId: body.leaseId });
      json(ctx, 200, { ok: true, ...read });
    }),
    createExactRoute("POST", "/target/codex/insert", async (ctx) => {
      const body = await readJson(ctx.req);
      assertOnlyRequestFields(body, new Set([
        "leaseId",
        "text",
        "expectedDraftHash",
        "generationId",
        "requestId",
        "allowClipboardFallback"
      ]), "unexpected_target_insert_field");
      if (!codexTargetAdapter) {
        json(ctx, 503, {
          ok: false,
          error: { code: "codex_target_adapter_unavailable", message: "Codex target verification is unavailable." }
        });
        return;
      }
      pruneTargetRouteState(routeState);
      const generationId = safeContractToken(body.generationId, "", 160);
      const requestId = safeContractToken(body.requestId, `insert-${generationId}`, 180);
      const prior = routeState.insertReceipts.get(requestId);
      if (prior) {
        json(ctx, 200, prior.response);
        return;
      }
      const leaseBinding = routeState.targetLeases.get(body.leaseId);
      const generationBinding = routeState.generationBindings.get(generationId);
      if (!leaseBinding || !generationBinding) {
        throw targetRouteError("target_transaction_binding_missing", "A fresh target lease and generated card are required.");
      }
      if (!/^[a-f0-9]{64}$/.test(String(body.expectedDraftHash || ""))
          || leaseBinding.draftHash !== body.expectedDraftHash) {
        throw targetRouteError("draft_changed", "The Codex draft changed after the card was opened.");
      }
      if (leaseBinding.projectScopeToken !== generationBinding.projectScopeToken) {
        throw targetRouteError("transaction_scope_conflict", "The generated prompt belongs to another target scope.");
      }
      const inserted = codexTargetAdapter.insert({
        leaseId: body.leaseId,
        text: body.text,
        expectedDraftHash: body.expectedDraftHash,
        allowClipboardFallback: body.allowClipboardFallback === true
      });
      routeState.targetLeases.delete(body.leaseId);
      const policyEvaluation = store.recordCodexTargetPolicyIncident(generationBinding, inserted);
      if (inserted.result.status !== "ready" || inserted.result.verified !== true
          || inserted.result.verification !== "machine" || inserted.result.noAutoSubmit !== true
          || !inserted.transaction) {
        json(ctx, 200, { ok: true, ...inserted, pendingOutcome: null, policyEvaluation });
        return;
      }
      const editFeatureSummary = deriveEditFeatureSummary(generationBinding.generatedPrompt, body.text);
      let outcomeBinding = generationBinding;
      try {
        store.recordVerifiedGenerationEditSummary({
          generationId: generationBinding.generationId,
          projectScopeToken: generationBinding.projectScopeToken,
          sessionId: generationBinding.sessionId,
          policyId: generationBinding.policyId,
          policyVersion: generationBinding.policyVersion,
          editFeatureSummary
        });
        generationBinding.editFeatureSummary = editFeatureSummary;
      } catch (error) {
        store.recordMetric({
          action: "learning_evidence_unavailable",
          generationId: generationBinding.generationId,
          failureReasonToken: error.code || "unknown",
          ok: false
        });
        outcomeBinding = { ...generationBinding, policyId: null, policyVersion: null };
      }
      const claim = codexTargetAdapter.claimVerifiedTransaction({
        transactionId: inserted.transaction.transactionId,
        binding: "pending_outcome"
      });
      if (claim.status !== "ready" || claim.receipt?.projectScopeToken !== generationBinding.projectScopeToken) {
        throw targetRouteError(claim.reasonToken || "transaction_scope_conflict", "The verified insert cannot be bound to an outcome.");
      }
      const event = promptSessionEventFromTransaction(outcomeBinding, claim.receipt, inserted.transaction);
      const pendingResult = store.recordVerifiedInsertOutcome(event);
      const expiresAtMs = Date.parse(inserted.transaction.expiresAt);
      const response = {
        ok: true,
        ...inserted,
        pendingOutcome: pendingResult.outcome,
        promptSessionEvent: {
          eventId: event.eventId,
          eventType: event.eventType,
          outcomeId: event.outcomeId
        }
      };
      routeState.insertReceipts.set(requestId, {
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 5 * 60 * 1000,
        projectScopeToken: generationBinding.projectScopeToken,
        response
      });
      routeState.undoBindings.set(inserted.undoToken, {
        invalidated: false,
        projectScopeToken: outcomeBinding.projectScopeToken,
        generation: outcomeBinding,
        outcomeId: event.outcomeId
      });
      routeState.transactionBindings.set(inserted.transaction.transactionId, {
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 5 * 60 * 1000,
        projectScopeToken: generationBinding.projectScopeToken,
        transaction: inserted.transaction,
        outcomeId: event.outcomeId,
        generationId
      });
      json(ctx, 200, response);
    }),
    createExactRoute("POST", "/target/codex/undo", async (ctx) => {
      const body = await readJson(ctx.req);
      assertOnlyRequestFields(body, new Set(["undoToken", "allowClipboardFallback"]), "unexpected_target_undo_field");
      if (!codexTargetAdapter) {
        json(ctx, 503, {
          ok: false,
          error: { code: "codex_target_adapter_unavailable", message: "Codex target verification is unavailable." }
        });
        return;
      }
      const binding = routeState.undoBindings.get(body.undoToken);
      if (!binding || binding.invalidated) {
        throw targetRouteError("undo_invalidated", "Undo is no longer available for this insertion.");
      }
      const undone = codexTargetAdapter.undo({
        undoToken: body.undoToken,
        allowClipboardFallback: body.allowClipboardFallback === true
      });
      if (undone.result.status === "ready") {
        binding.invalidated = true;
        const eventId = `undo-${crypto.randomBytes(16).toString("hex")}`;
        store.recordOutcomeImplicitSignal(assertValidContract(
          CONTRACTS.PROMPT_SESSION_EVENT,
          normalizePromptSessionEvent({
            contractVersion: CONTRACT_VERSIONS[CONTRACTS.PROMPT_SESSION_EVENT],
            eventId,
            eventType: "undo",
            occurredAt: new Date().toISOString(),
            sessionId: binding.generation.sessionId,
            generationId: binding.generation.generationId,
            target: "codex",
            projectScopeToken: binding.projectScopeToken,
            strategyId: binding.generation.strategyId,
            strategyVersion: binding.generation.strategyVersion,
            modelFamilyToken: binding.generation.modelFamilyToken,
            outcomeId: binding.outcomeId,
            policyId: binding.generation.policyId,
            policyVersion: binding.generation.policyVersion,
            taskOutcomeToken: "unknown",
            insertVerified: false,
            noAutoSubmit: true,
            failureReasonTokens: [],
            privacyFlags: { ...DEFAULT_PRIVACY_FLAGS }
          })
        ));
      }
      json(ctx, 200, { ok: true, ...undone });
    }),
    createExactRoute("GET", "/desktop/input-snapshot", async (ctx) => {
      const selfTest = ctx.url.searchParams.get("selfTest") === "1";
      const snapshot = await desktopInputSnapshot({ selfTest });
      json(ctx, 200, { ok: true, snapshot });
    }),
    createExactRoute("POST", "/desktop/fill", async (ctx) => {
      const body = await readJson(ctx.req);
      const selfTest = ctx.url.searchParams.get("selfTest") === "1" || body.selfTest === true;
      const confirmForeground = ctx.url.searchParams.get("confirmForeground") === "1" || body.confirmForeground === true;
      const allowClipboardFallback = ctx.url.searchParams.get("allowClipboardFallback") === "1" || body.allowClipboardFallback === true;
      const allowTextPatternVerification = ctx.url.searchParams.get("allowTextPatternVerification") === "1" || body.allowTextPatternVerification === true;
      const fill = await desktopFill({
        selfTest,
        confirmForeground,
        allowClipboardFallback,
        allowTextPatternVerification,
        expectedTitleHash: body.expectedTitleHash || "",
        expectedToolProfile: body.expectedToolProfile || "",
        candidateIndex: Number.isFinite(Number(body.candidateIndex)) ? Number(body.candidateIndex) : 0,
        text: body.text || body.prompt || ""
      });
      routeState.lastDesktopFill = {
        schemaVersion: "m3-desktop-fill-latest@1",
        recordedAt: new Date().toISOString(),
        fill: sanitizeDesktopFillEvidence(fill)
      };
      json(ctx, 200, { ok: true, fill });
    }),
    createExactRoute("GET", "/desktop/fill/latest", (ctx) => {
      json(ctx, 200, { ok: true, desktopFill: routeState.lastDesktopFill || null });
    }),
    createExactRoute("POST", "/desktop/prompt-state", async (ctx) => {
      const body = await readJson(ctx.req);
      routeState.lastDesktopPromptState = sanitizeDesktopPromptState(body);
      json(ctx, 200, { ok: true, desktopPrompt: routeState.lastDesktopPromptState });
    }),
    createExactRoute("GET", "/desktop/prompt-state", (ctx) => {
      json(ctx, 200, { ok: true, desktopPrompt: routeState.lastDesktopPromptState || null });
    }),
    createExactRoute("GET", "/metrics", (ctx) => {
      json(ctx, 200, { ok: true, metrics: store.getMetrics() });
    }),
    createExactRoute("GET", "/outcomes/pending", (ctx) => {
      const pending = store.getOutcomeFollowups({ limit: ctx.url.searchParams.get("limit") || 20 });
      json(ctx, 200, { ok: true, ...pending });
    }),
    createExactRoute("POST", "/outcomes/follow-up", async (ctx) => {
      const body = await readJson(ctx.req);
      try {
        const result = store.recordOutcomeFollowup({
          generationId: body.generationId || body.generation_id,
          outcomeLabel: body.outcomeLabel || body.outcome || body.result,
          failureReason: body.failureReason || body.failure_reason || body.reason,
          failureReasonToken: body.failureReasonToken || body.failure_reason_token,
          outcomeReason: body.outcomeReason || body.outcome_reason
        });
        json(ctx, 200, { ok: true, outcome: result.outcome, ...result.pending });
      } catch (error) {
        const status = error.code === "outcome_candidate_not_found" ? 404 : 400;
        json(ctx, status, {
          ok: false,
          error: {
            code: error.code || "outcome_followup_failed",
            message: error.message
          }
        });
      }
    }),
    createDynamicRoute("report-routes", (req, url) => Boolean(findReportRoute(req, url)), (ctx) => {
      const reportRoute = findReportRoute(ctx.req, ctx.url);
      json(ctx, 200, buildReportRoutePayload(reportRoute, store, ctx.url));
    }),
    createExactRoute("POST", "/metrics", async (ctx) => {
      const body = await readJson(ctx.req);
      const metrics = store.recordMetric(body.event || body);
      json(ctx, 200, { ok: true, metric: metrics[0], metrics: store.getMetrics() });
    }),
    createExactRoute("POST", "/generate", async (ctx) => {
      const body = await readJson(ctx.req);
      pruneTargetRouteState(routeState);
      const response = await buildGenerateResponse({ body, store, generateWithLlm });
      if (codexTargetAdapter && response.status === 200 && response.payload?.card) {
        registerGenerationBinding(routeState, body, response.payload.card, store);
        codexTargetAdapter?.invalidateUndo?.();
      }
      json(ctx, response.status, response.payload);
    })
  ];
}

function createApp(store = createStore(), options = {}) {
  const generateWithLlm = options.generateWithLlm || generateWithConfiguredProvider;
  const desktopInputSnapshot = options.getDesktopInputSnapshot || getDesktopInputSnapshot;
  const desktopFill = options.fillDesktopInput || fillDesktopInput;
  const codexTargetAdapter = createDefaultCodexTargetAdapter(options);
  const routeState = createTargetRouteState();
  const routes = createAppRoutes({
    store,
    options,
    generateWithLlm,
    desktopInputSnapshot,
    desktopFill,
    codexTargetAdapter,
    state: routeState
  });

  return async function app(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");

    if (!isTrustedOrigin(req.headers.origin || "", options.allowedOrigins)) {
      sendJson(req, res, 403, {
        ok: false,
        error: {
          code: "origin_not_allowed",
          message: "Origin is not allowed for Smart Prompt local service."
        }
      }, options);
      return;
    }

    if (url.pathname === "/auth/bootstrap" && !isBootstrapOriginAllowed(req.headers.origin || "", options)) {
      sendJson(req, res, 403, {
        ok: false,
        error: {
          code: "bootstrap_origin_not_allowed",
          message: "This browser origin cannot bootstrap Smart Prompt local service authentication."
        }
      }, { ...options, suppressCorsOrigin: true });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(req, res, 200, { ok: true }, options);
      return;
    }

    try {
      const currentRouteKey = routeKey(req, url);
      if (ACTIVATION_EVENT_ROUTES.has(currentRouteKey) && !isTrustedExtensionOrigin(req.headers.origin || "")) {
        sendJson(req, res, 403, {
          ok: false,
          error: {
            code: "activation_extension_origin_required",
            message: "Activation completion must come from the installed browser extension."
          }
        }, options);
        return;
      }
      if (!PUBLIC_ROUTES.has(currentRouteKey) && !isAuthorized(req, store, options)) {
        sendJson(req, res, 401, {
          ok: false,
          error: {
            code: "auth_required",
            message: "Smart Prompt local service auth token is required."
          }
        }, options);
        return;
      }

      const route = findAppRoute(routes, req, url);
      if (route) {
        await route.handler({ req, res, url });
        return;
      }

      sendJson(req, res, 404, { ok: false, error: { code: "not_found", message: `${req.method} ${url.pathname}` } }, options);
    } catch (error) {
      sendJson(req, res, publicModuleErrorStatus(error), {
        ok: false,
        error: { code: error.code || "server_error", message: error.message }
      }, options);
    }
  };
}

function startServer({
  port = Number(process.env.SMART_PROMPT_PORT || DEFAULT_PORT),
  store = createStore(),
  generateWithLlm,
  getDesktopInputSnapshot: desktopInputSnapshot,
  fillDesktopInput: desktopFill,
  codexTargetAdapter,
  codexTargetAdapterOptions,
  allowedOrigins = [],
  disableAuth = false
} = {}) {
  const server = http.createServer(createApp(store, {
    generateWithLlm,
    getDesktopInputSnapshot: desktopInputSnapshot,
    fillDesktopInput: desktopFill,
    codexTargetAdapter,
    codexTargetAdapterOptions,
    allowedOrigins,
    disableAuth
  }));
  server.listen(port, "127.0.0.1");
  return server;
}

if (require.main === module) {
  const server = startServer();
  server.once("listening", () => {
    const address = server.address();
    console.log(`Smart Prompt local service listening on http://127.0.0.1:${address.port}`);
  });
}

module.exports = {
  AUTH_HEADER,
  ACTIVATION_CONTRACT_VERSION,
  CODEX_ACTIVATION_CONTRACT_VERSION,
  DEFAULT_EXTENSION_ID,
  DEFAULT_EXTENSION_ORIGIN,
  buildGenerationContext,
  buildLlmTestResponse,
  createAppRoutes,
  DEFAULT_ALLOWED_ORIGINS,
  TOKEN_HEADER,
  createApp,
  extractAuthToken,
  findAppRoute,
  findReportRoute,
  isTrustedOrigin,
  isTrustedExtensionOrigin,
  normalizeProviderError,
  normalizeSettingsValidationError,
  readJson,
  sendJson,
  startServer
};
