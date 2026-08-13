const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createCredentialVault } = require("./credential-vault");
const { createActivationStore } = require("./modules/activation/activation-store");
const { createCodexActivationStore } = require("./modules/activation/codex-activation-store");
const { createPendingOutcomeStore } = require("./modules/outcomes");
const { createLearningArtifactStore } = require("./modules/learning");
const {
  compileGenerationPolicy,
  classifyCodexInsertPolicyIncident,
  createGenerationPolicyRegistry,
  createPolicyRollout,
  estimateRolloutConfidence,
  evaluatePolicyRollout,
  observationTokens,
  selectGenerationPolicyAssignment
} = require("./modules/policies");
const {
  CUSTOM_PROVIDER_PROTOCOLS,
  normalizeCustomProviderName,
  normalizeCustomProviderProtocol,
  normalizeModelId,
  normalizeProviderBaseUrl
} = require("../../../packages/shared/llm-gateway");
const { buildExperimentOutcomeReport, buildStrategyInsights, formatExperimentOutcomeReport, formatStrategyInsights, normalizeFailureReasonToken } = require("../../../packages/shared/prompt-quality");
const { normalizeLearningCandidateSeed } = require("../../../packages/outcome-learning");
const { ensureDir, hashTextSha, readJson, writeJson } = require("../../../packages/shared/utils");

const DEFAULT_PORT = 17371;
const DATA_SCHEMA_VERSION = 1;
const DEFAULT_SETTINGS = Object.freeze({
  provider: "auto",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.35,
  apiKey: "",
  customProvider: {
    name: "",
    protocol: "openai-compatible",
    baseUrl: "",
    model: ""
  },
  providerKeys: {
    agnes: "",
    "openai-compatible": "",
    anthropic: "",
    gemini: "",
    custom: ""
  },
  uploadWholePage: false,
  autoSubmit: false
});

function defaultDataDir() {
  return process.env.SMART_PROMPT_DATA_DIR || path.join(__dirname, "..", ".smart-prompt-data");
}

function createAuthToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashText(value) {
  return hashTextSha(value);
}

function roundMetric(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function sanitizeSite(value) {
  const text = String(value || "").trim().slice(0, 120);
  if (!text) return "";
  try {
    const parsed = new URL(text.includes("://") ? text : `https://${text}`);
    return parsed.hostname.slice(0, 120);
  } catch {
    return text.replace(/[/?#].*$/g, "").slice(0, 120);
  }
}

function clipText(value, length = 80) {
  return String(value || "").slice(0, length);
}

function safeMetricToken(value, length = 80) {
  return clipText(String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:+-]+/g, "-")
    .replace(/^-+|-+$/g, ""), length);
}

function normalizeOutcomeLabel(value) {
  const token = safeMetricToken(value, 80);
  if (["success", "accepted", "completed", "pass", "resolved", "saved", "useful"].includes(token)) return "success";
  if (["needs-work", "needs_work", "needswork", "improve", "revise", "partial", "not-useful"].includes(token)) return "needs-work";
  if (["failed", "failure", "rejected", "bad", "blocked"].includes(token)) return "failed";
  return "";
}

function outcomeScoreForLabel(label) {
  if (label === "success") return 1;
  if (label === "needs-work") return 0.45;
  if (label === "failed") return 0;
  return null;
}

function normalizeStoredFailureReason(value, fallback = "") {
  const raw = String(value || "").trim();
  const token = normalizeFailureReasonToken(raw, fallback);
  if (!raw) return token;
  const safeRaw = safeMetricToken(raw, 120);
  if (!safeRaw) return token;
  const canonicalRaw = safeRaw.replace(/[.+-]+/g, "_");
  const legacyReasonTokens = new Set([
    "after_write_mismatch",
    "no_visible_input_candidate",
    "insert_failed",
    "user_retry_requested"
  ]);
  return legacyReasonTokens.has(canonicalRaw) ? safeRaw : token;
}

function isOutcomeMetricAction(action) {
  return action === "outcome" || action === "task_outcome";
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase();
}

function matchesQuery(parts, query) {
  const needle = normalizeSearchText(query).trim();
  if (!needle) return true;
  return parts.map(normalizeSearchText).join(" ").includes(needle);
}

function normalizeProvider(value, fallback = "auto") {
  return ["auto", "agnes", "openai-compatible", "anthropic", "gemini", "custom"].includes(value) ? value : fallback;
}

function normalizeCustomProvider(current, next, provider) {
  const incoming = next?.customProvider && typeof next.customProvider === "object"
    ? next.customProvider
    : null;
  const candidate = {
    ...DEFAULT_SETTINGS.customProvider,
    ...(current?.customProvider || {}),
    ...(incoming || {})
  };
  if (provider === "custom") {
    if (!Object.prototype.hasOwnProperty.call(incoming || {}, "baseUrl") && Object.prototype.hasOwnProperty.call(next || {}, "baseUrl")) {
      candidate.baseUrl = next.baseUrl;
    }
    if (!Object.prototype.hasOwnProperty.call(incoming || {}, "model") && Object.prototype.hasOwnProperty.call(next || {}, "model")) {
      candidate.model = next.model;
    }
  }
  if (provider === "custom" || incoming) {
    return {
      name: normalizeCustomProviderName(candidate.name),
      protocol: normalizeCustomProviderProtocol(candidate.protocol),
      baseUrl: normalizeProviderBaseUrl(candidate.baseUrl),
      model: normalizeModelId(candidate.model)
    };
  }
  return {
    name: String(candidate.name || "").trim(),
    protocol: CUSTOM_PROVIDER_PROTOCOLS.includes(candidate.protocol)
      ? candidate.protocol
      : DEFAULT_SETTINGS.customProvider.protocol,
    baseUrl: String(candidate.baseUrl || "").trim(),
    model: String(candidate.model || "").trim()
  };
}

function normalizeProviderKeys(current, incoming, provider, legacyApiKey) {
  const merged = {
    ...DEFAULT_SETTINGS.providerKeys,
    ...(current?.providerKeys || {})
  };
  const currentProvider = normalizeProvider(current?.provider, "openai-compatible");
  if (current?.apiKey) {
    const legacyProvider = currentProvider === "auto" ? "openai-compatible" : currentProvider;
    if (!merged[legacyProvider]) merged[legacyProvider] = current.apiKey;
  }
  if (incoming && typeof incoming === "object") {
    for (const key of Object.keys(DEFAULT_SETTINGS.providerKeys)) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        merged[key] = String(incoming[key] || "");
      }
    }
  }
  if (legacyApiKey) {
    const targetProvider = provider === "auto" ? "openai-compatible" : provider;
    merged[targetProvider] = String(legacyApiKey);
  }
  return merged;
}

function hasProviderKeys(settings = {}) {
  return Object.values(settings.providerKeys || {}).some(Boolean) || Boolean(settings.apiKey);
}

function emptyProviderKeys() {
  return { ...DEFAULT_SETTINGS.providerKeys };
}

function finiteTokenMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function sanitizePromptTokenUsage(value = {}) {
  const source = ["provider", "estimated", "unavailable"].includes(value.source)
    ? value.source
    : "unavailable";
  if (source === "unavailable") {
    return {
      source,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      insertedPromptTokenEstimate: null
    };
  }
  return {
    source,
    inputTokens: finiteTokenMetric(value.inputTokens),
    outputTokens: finiteTokenMetric(value.outputTokens),
    cachedTokens: finiteTokenMetric(value.cachedTokens),
    reasoningTokens: finiteTokenMetric(value.reasoningTokens),
    insertedPromptTokenEstimate: finiteTokenMetric(value.insertedPromptTokenEstimate)
  };
}

function requireOpaqueStoreToken(value, field, length = 180) {
  const token = String(value || "").trim();
  if (token.length > length
    || !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(token)
    || /[\\/]/.test(token)
    || /^[a-z]:/i.test(token)
    || /(?:bearer\s+|sk-|api[_-]?key|-----begin)/i.test(token)) {
    const error = new Error(`${field} must be a bounded opaque token.`);
    error.code = "invalid_project_scope_token";
    throw error;
  }
  return token;
}

function normalizeTrustedEditFeatureSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.userEdited !== "boolean"
      || !["none", "small", "medium", "large"].includes(value.lengthDeltaBucket)
      || typeof value.structureChanged !== "boolean") return null;
  return {
    userEdited: value.userEdited,
    lengthDeltaBucket: value.lengthDeltaBucket,
    structureChanged: value.structureChanged
  };
}

function createStore(dataDir = defaultDataDir(), options = {}) {
  ensureDir(dataDir);
  const settingsFile = path.join(dataDir, "settings.json");
  const skillsFile = path.join(dataDir, "skills.json");
  const promptsFile = path.join(dataDir, "prompts.json");
  const historyFile = path.join(dataDir, "prompt-history.json");
  const metricsFile = path.join(dataDir, "metrics.json");
  const metadataFile = path.join(dataDir, "metadata.json");
  const securityFile = path.join(dataDir, "security.json");
  const legacyDataPresent = [
    settingsFile,
    skillsFile,
    promptsFile,
    historyFile,
    metricsFile,
    path.join(dataDir, "provider-keys.json"),
    path.join(dataDir, "key-migration.json")
  ].some((file) => fs.existsSync(file));
  const credentialVault = options.credentialVault || createCredentialVault(dataDir);
  const activationStore = options.activationStore || createActivationStore(dataDir);
  const codexActivationStore = options.codexActivationStore || createCodexActivationStore(dataDir);
  const pendingOutcomeStore = options.pendingOutcomeStore
    || createPendingOutcomeStore(dataDir, options.pendingOutcomeOptions || {});
  const learningArtifactStore = options.learningArtifactStore
    || createLearningArtifactStore(dataDir, options.learningOptions || {});
  const generationPolicyRegistry = options.generationPolicyRegistry
    || createGenerationPolicyRegistry(dataDir, options.policyOptions || {});

  function getMetadata() {
    const metadata = readJson(metadataFile, {});
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      migrated_at: metadata.migrated_at || new Date().toISOString(),
      ...metadata
    };
  }

  function migrateData() {
    const metadata = getMetadata();
    if (metadata.schemaVersion !== DATA_SCHEMA_VERSION) {
      metadata.schemaVersion = DATA_SCHEMA_VERSION;
      metadata.migrated_at = new Date().toISOString();
    }
    writeJson(metadataFile, metadata);
    return metadata;
  }

  function readSettingsFile() {
    const persisted = readJson(settingsFile, {});
    return {
      ...DEFAULT_SETTINGS,
      ...persisted,
      customProvider: {
        ...DEFAULT_SETTINGS.customProvider,
        ...(persisted.customProvider || {})
      }
    };
  }

  function sanitizeSettingsFile(settings) {
    return {
      ...settings,
      apiKey: "",
      providerKeys: emptyProviderKeys(),
      uploadWholePage: false,
      autoSubmit: false
    };
  }

  function migrateProviderKeysIfNeeded(persisted, encryptedProviderKeys) {
    if (!hasProviderKeys(persisted)) return null;
    const provider = normalizeProvider(persisted.provider, "openai-compatible");
    const migrated = normalizeProviderKeys({
      provider: persisted.provider,
      apiKey: persisted.apiKey,
      providerKeys: encryptedProviderKeys
    }, persisted.providerKeys, provider, persisted.apiKey);
    credentialVault.saveProviderKeys(migrated);
    writeJson(settingsFile, sanitizeSettingsFile(persisted));
    writeJson(path.join(dataDir, "key-migration.json"), {
      migrateProviderKeys: true,
      migratedAt: new Date().toISOString(),
      storage: credentialVault.getStorageSummary().storage
    });
    return migrated;
  }

  function getSettings() {
    const persisted = readSettingsFile();
    const encryptedProviderKeys = {
      ...DEFAULT_SETTINGS.providerKeys,
      ...credentialVault.loadProviderKeys()
    };
    const migrated = migrateProviderKeysIfNeeded(persisted, encryptedProviderKeys);
    if (migrated) {
      return {
        ...sanitizeSettingsFile(persisted),
        providerKeys: {
          ...DEFAULT_SETTINGS.providerKeys,
          ...migrated
        },
        credentialStorage: credentialVault.getStorageSummary()
      };
    }
    return {
      ...persisted,
      apiKey: "",
      providerKeys: encryptedProviderKeys,
      uploadWholePage: false,
      autoSubmit: false,
      credentialStorage: credentialVault.getStorageSummary()
    };
  }

  function previewSettings(next) {
    const current = getSettings();
    const provider = normalizeProvider(next?.provider, current.provider);
    let model = normalizeModelId(
      Object.prototype.hasOwnProperty.call(next || {}, "model") ? next.model : current.model
    );
    const customProvider = normalizeCustomProvider(current, next, provider);
    let baseUrl = Object.prototype.hasOwnProperty.call(next || {}, "baseUrl")
      ? String(next.baseUrl || "").trim()
      : String(current.baseUrl || "").trim();
    if (provider === "custom") {
      baseUrl = customProvider.baseUrl;
      model = customProvider.model;
    }
    const providerKeys = normalizeProviderKeys(current, next?.providerKeys, provider, next?.apiKey);
    return {
      ...current,
      ...next,
      provider,
      baseUrl,
      model,
      customProvider,
      apiKey: "",
      providerKeys,
      uploadWholePage: false,
      autoSubmit: false,
      credentialStorage: credentialVault.getStorageSummary()
    };
  }

  function saveSettings(next) {
    const prepared = previewSettings(next);
    const { provider, model, providerKeys } = prepared;
    credentialVault.saveProviderKeys(providerKeys);
    const safe = {
      ...prepared,
      apiKey: "",
      providerKeys: emptyProviderKeys(),
      uploadWholePage: false,
      autoSubmit: false,
      credentialStorage: credentialVault.getStorageSummary()
    };
    writeJson(settingsFile, safe);
    if (activationStore.getStatus().progress === "not_started") {
      activationStore.setProgress("configuring", {
        provider,
        model: safe.model
      });
    }
    if (codexActivationStore.getStatus().progress === "not_started") {
      codexActivationStore.setProgress("configuring", { provider });
    }
    return getSettings();
  }

  function setActivationProgress(progress, metadata = {}) {
    const activation = activationStore.setProgress(progress, metadata);
    if (progress === "configuring" && codexActivationStore.getStatus().progress === "not_started") {
      codexActivationStore.setProgress("configuring", metadata);
    }
    return activation;
  }

  function recordActivationModelReady(metadata = {}) {
    const activation = activationStore.recordModelReady(metadata);
    const codexStatus = codexActivationStore.getStatus();
    if (codexStatus.progress === "not_started") {
      codexActivationStore.setProgress("configuring", metadata);
    }
    codexActivationStore.recordModelReady(metadata);
    return activation;
  }

  function setActivationRuntimeHealth(runtimeHealth, metadata = {}) {
    const activation = activationStore.setRuntimeHealth(runtimeHealth, metadata);
    codexActivationStore.setRuntimeHealth(runtimeHealth, metadata);
    return activation;
  }

  function getSecurity() {
    const envToken = process.env.SMART_PROMPT_AUTH_TOKEN;
    if (envToken) {
      return {
        ...readJson(securityFile, {}),
        authToken: String(envToken)
      };
    }

    const current = readJson(securityFile, {});
    if (current.authToken) return current;

    const next = {
      authToken: createAuthToken(),
      created_at: new Date().toISOString()
    };
    writeJson(securityFile, next);
    return next;
  }

  function getAuthToken() {
    return getSecurity().authToken;
  }

  function getSkills() {
    return readJson(skillsFile, []);
  }

  function saveSkills(skills) {
    writeJson(skillsFile, Array.isArray(skills) ? skills : []);
    return getSkills();
  }

  function addSkills(skills) {
    const merged = [...skills, ...getSkills()].filter((skill, index, all) => {
      return all.findIndex((item) => item.id === skill.id) === index;
    });
    return saveSkills(merged);
  }

  function deleteSkill(id) {
    const before = getSkills();
    const next = before.filter((skill) => skill.id !== id);
    saveSkills(next);
    return before.length !== next.length;
  }

  function getPrompts() {
    return readJson(promptsFile, []);
  }

  function savePrompts(prompts) {
    writeJson(promptsFile, Array.isArray(prompts) ? prompts : []);
    return getPrompts();
  }

  function addPrompt(prompt) {
    const now = new Date().toISOString();
    const body = String(prompt.body || prompt.prompt || "");
    const bodyHash = prompt.bodyHash || hashText(body);
    const existing = getPrompts().find((item) => item.bodyHash === bodyHash);
    const safe = {
      id: prompt.id || existing?.id || `prompt-${Date.now()}`,
      title: String(prompt.title || "Untitled prompt").slice(0, 120),
      body,
      bodyHash,
      mode: prompt.mode || "custom",
      tags: Array.isArray(prompt.tags) ? prompt.tags.slice(0, 12) : [],
      context: prompt.context || {},
      created_at: prompt.created_at || existing?.created_at || now,
      updated_at: now,
      source: prompt.source || "local-service"
    };
    const next = [safe, ...getPrompts().filter((item) => item.id !== safe.id && item.bodyHash !== bodyHash)].slice(0, 200);
    return savePrompts(next);
  }

  function deletePrompt(id) {
    const before = getPrompts();
    const next = before.filter((prompt) => prompt.id !== id);
    savePrompts(next);
    return before.length !== next.length;
  }

  function addPromptHistory(entry) {
    const current = readJson(historyFile, []);
    const next = [{
      id: entry.id || `history-${Date.now()}`,
      created_at: entry.created_at || new Date().toISOString(),
      generationId: String(entry.generationId || "").slice(0, 80),
      strategyId: String(entry.strategyId || "").slice(0, 180),
      mode: entry.mode || "",
      tool: entry.tool || "",
      generatedBy: entry.generatedBy || "",
      qualityScore: Number.isFinite(Number(entry.qualityScore)) ? Number(entry.qualityScore) : null,
      promptLength: Number(entry.promptLength || 0),
      tokenUsage: sanitizePromptTokenUsage(entry.tokenUsage),
      context: entry.context || {}
    }, ...current].slice(0, 100);
    writeJson(historyFile, next);
    return next;
  }

  function getPromptHistory() {
    return readJson(historyFile, []);
  }

  function sanitizeRestoredPromptHistory(entries) {
    return entries.slice(0, 100).map((entry) => {
      const safeEntry = entry && typeof entry === "object" && !Array.isArray(entry)
        ? { ...entry }
        : {};
      const context = safeEntry.context && typeof safeEntry.context === "object"
        && !Array.isArray(safeEntry.context)
        ? { ...safeEntry.context }
        : {};
      context.verifiedInsertEvidence = false;
      delete context.verifiedSessionId;
      delete context.editFeatureSummary;
      delete context.learningCandidateSeed;
      safeEntry.context = context;
      return safeEntry;
    });
  }

  function recordVerifiedGenerationEditSummary(input = {}) {
    const generationId = requireOpaqueStoreToken(input.generationId, "generationId", 160);
    const projectScopeToken = requireOpaqueStoreToken(input.projectScopeToken, "projectScopeToken");
    const sessionId = requireOpaqueStoreToken(input.sessionId, "sessionId", 120);
    const policyId = input.policyId === null || input.policyId === undefined
      ? null
      : requireOpaqueStoreToken(input.policyId, "policyId");
    const policyVersion = input.policyVersion === null || input.policyVersion === undefined
      ? null
      : Number(input.policyVersion);
    if (policyVersion !== null && (!Number.isInteger(policyVersion) || policyVersion < 1)) {
      const error = new Error("policyVersion must be a positive integer or null.");
      error.code = "invalid_generation_policy_version";
      throw error;
    }
    const editFeatureSummary = normalizeTrustedEditFeatureSummary(input.editFeatureSummary);
    if (!editFeatureSummary) {
      const error = new Error("A server-derived edit feature summary is required.");
      error.code = "invalid_edit_feature_summary";
      throw error;
    }
    const history = getPromptHistory();
    const index = history.findIndex((entry) => entry.generationId === generationId
      && entry.context?.projectScopeToken === projectScopeToken);
    if (index < 0) {
      const error = new Error("The generated prompt history binding is unavailable.");
      error.code = "generation_history_binding_missing";
      throw error;
    }
    const storedPolicyId = history[index].context?.generationPolicyId || null;
    const storedPolicyVersion = history[index].context?.generationPolicyVersion ?? null;
    if (storedPolicyId !== policyId || storedPolicyVersion !== policyVersion) {
      const error = new Error("The verified insert policy binding changed after generation.");
      error.code = "generation_policy_binding_conflict";
      throw error;
    }
    history[index] = {
      ...history[index],
      context: {
        ...history[index].context,
        verifiedInsertEvidence: true,
        verifiedSessionId: sessionId,
        editFeatureSummary
      }
    };
    writeJson(historyFile, history);
    return editFeatureSummary;
  }

  function clearProjectPromptHistory(projectScopeToken, archiveDir) {
    const scope = requireOpaqueStoreToken(projectScopeToken, "projectScopeToken");
    const history = getPromptHistory();
    const selected = history.filter((entry) => entry.context?.projectScopeToken === scope);
    const retained = history.filter((entry) => entry.context?.projectScopeToken !== scope);
    if (selected.length) {
      writeJson(path.join(archiveDir, "prompt-history.json"), {
        schemaVersion: "prompt-history-project-archive@1",
        projectScopeToken: scope,
        entries: selected
      });
      writeJson(historyFile, retained);
    }
    return selected.length;
  }

  function ensureBaselineGenerationPolicy(scope = {}) {
    const normalizedScope = {
      kind: "project",
      target: safeMetricToken(scope.target || "codex", 40) || "codex",
      projectScopeToken: requireOpaqueStoreToken(scope.projectScopeToken, "projectScopeToken"),
      taskScenarioToken: safeMetricToken(scope.taskScenarioToken, 120),
      modelFamilyToken: safeMetricToken(scope.modelFamilyToken, 120)
    };
    if (!normalizedScope.projectScopeToken
      || !normalizedScope.taskScenarioToken
      || !normalizedScope.modelFamilyToken) {
      const error = new Error("A complete private Generation Policy scope is required.");
      error.code = "generation_policy_scope_required";
      throw error;
    }
    const matchingPolicies = generationPolicyRegistry.listPolicies({
      projectScopeToken: normalizedScope.projectScopeToken,
      taskScenarioToken: normalizedScope.taskScenarioToken,
      modelFamilyToken: normalizedScope.modelFamilyToken,
      target: normalizedScope.target
    });
    const existing = matchingPolicies.find((policy) => policy.status === "stable");
    if (existing) return existing;
    const scopeDigest = hashText(JSON.stringify(normalizedScope)).slice(0, 20);
    const version = matchingPolicies.reduce((maximum, policy) => Math.max(maximum, Number(policy.version || 0)), 0) + 1;
    const draft = compileGenerationPolicy({
      policyId: `policy_baseline_${scopeDigest}`,
      version,
      baselineVersion: version,
      scope: normalizedScope,
      automaticRolloutEligible: false,
      signals: {}
    }, options.policyCompilerOptions || {});
    return generationPolicyRegistry.registerPolicy({
      ...draft,
      status: "stable",
      automaticRolloutEligible: false
    });
  }

  function selectGenerationPolicy(input = {}) {
    ensureBaselineGenerationPolicy(input);
    return selectGenerationPolicyAssignment({
      ...input,
      registry: generationPolicyRegistry
    });
  }

  function compileAndRegisterGenerationPolicy(input = {}) {
    const policy = compileGenerationPolicy(input, options.policyCompilerOptions || {});
    return generationPolicyRegistry.registerPolicy(policy);
  }

  function recordExternalPendingOutcomeEvent(input) {
    const event = input;
    if (event && typeof event === "object" && !Array.isArray(event)) {
      const hasPolicyId = Object.prototype.hasOwnProperty.call(event, "policyId") && event.policyId !== null;
      const hasPolicyVersion = Object.prototype.hasOwnProperty.call(event, "policyVersion")
        && event.policyVersion !== null;
      if (hasPolicyId || hasPolicyVersion) {
        const error = new Error("Policy attribution is assigned only by the verified Codex transaction path.");
        error.code = "untrusted_policy_attribution";
        throw error;
      }
      if (event.eventType === "verified_insert") {
        const error = new Error("Verified insert outcomes are created only by the server-owned Codex transaction path.");
        error.code = "verified_insert_server_transaction_required";
        throw error;
      }
      if (event.eventType !== "verified_insert" && typeof event.outcomeId === "string") {
        const linkedOutcome = pendingOutcomeStore.getOutcome(event.outcomeId);
        if (linkedOutcome.policyId !== null || linkedOutcome.policyVersion !== null) {
          const error = new Error("Policy rollout signals are recorded only by verified server transactions.");
          error.code = "untrusted_policy_signal";
          throw error;
        }
      }
      return pendingOutcomeStore.recordPromptSessionEvent({
        ...event,
        policyId: null,
        policyVersion: null
      });
    }
    return pendingOutcomeStore.recordPromptSessionEvent(event);
  }

  function recordResolvedOutcomeObservation(outcome) {
    if (!outcome || !["succeeded", "failed"].includes(outcome.status)) return null;
    const history = getPromptHistory().find((entry) => entry.generationId === outcome.generationId
      && entry.context?.projectScopeToken === outcome.projectScopeToken) || null;
    const taskScenarioToken = safeMetricToken(history?.context?.taskScenario, 120) || "unknown_scenario";
    const modeToken = safeMetricToken(history?.mode, 80) || "standard";
    const strategyId = safeMetricToken(history?.strategyId, 180) || "baseline";
    const strategyVersion = safeMetricToken(history?.context?.promptStrategyVersion, 80) || "v1";
    const modelFamilyToken = safeMetricToken(history?.context?.modelFamilyToken, 120) || "unknown_model";
    const tokenUsage = sanitizePromptTokenUsage(history?.tokenUsage || { source: "unavailable" });
    const implicitSignals = pendingOutcomeStore.listImplicitSignals({ outcomeId: outcome.outcomeId });
    const editFeatureSummary = normalizeTrustedEditFeatureSummary(history?.context?.editFeatureSummary);
    const verifiedInsertEvidence = Boolean(history)
      && history.context?.verifiedInsertEvidence === true
      && history.context?.verifiedSessionId === outcome.sessionId
      && editFeatureSummary !== null;
    const learningCandidateSeed = verifiedInsertEvidence
      ? normalizeLearningCandidateSeed(history?.context?.learningCandidateSeed)
      : null;
    const featureTokens = [
      `scenario:${taskScenarioToken}`,
      `mode:${modeToken}`,
      `model:${modelFamilyToken}`,
      "target:codex"
    ];
    if (learningCandidateSeed) featureTokens.push(`learning:${learningCandidateSeed.patternToken}`);
    const trustedPolicyAttribution = verifiedInsertEvidence
      && safeMetricToken(history.context?.generationPolicyId, 180) === outcome.policyId
      && Number(history.context?.generationPolicyVersion) === outcome.policyVersion;
    const baselinePolicy = trustedPolicyAttribution
      ? ensureBaselineGenerationPolicy({
          target: "codex",
          projectScopeToken: outcome.projectScopeToken,
          taskScenarioToken,
          modelFamilyToken
        })
      : null;
    const learning = learningArtifactStore.recordObservation({
      projectScopeToken: outcome.projectScopeToken,
      sessionId: outcome.sessionId,
      outcomeId: outcome.outcomeId,
      featureTokens,
      taskScenarioToken,
      modeToken,
      strategyId,
      strategyVersion,
      modelFamilyToken,
      contextSourceTokens: [],
      editFeatureSummary: editFeatureSummary || {
        userEdited: false,
        lengthDeltaBucket: "none",
        structureChanged: false
      },
      insertVerified: true,
      retryCount: implicitSignals.filter((event) => event.eventType === "retry" || event.eventType === "regenerated").length,
      undoUsed: implicitSignals.some((event) => event.eventType === "undo"),
      outcomeStatus: outcome.status,
      failureReasonTokens: outcome.failureReasonTokens || [],
      explicitNegativeFeedback: outcome.status === "failed",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      cachedTokens: tokenUsage.cachedTokens,
      reasoningTokens: tokenUsage.reasoningTokens,
      insertedPromptTokenEstimate: tokenUsage.insertedPromptTokenEstimate,
      tokenAccountingSource: tokenUsage.source,
      latencyMs: 0,
      rolloutEligible: trustedPolicyAttribution,
      candidate: learningCandidateSeed
        ? {
            artifactType: learningCandidateSeed.artifactType,
            payload: learningCandidateSeed.payload
          }
        : baselinePolicy
          ? {
            artifactType: "generation_policy",
            payload: {
              policyId: baselinePolicy.policyId,
              policyVersion: baselinePolicy.version + 1
            }
          }
          : null
    });
    const policyEvaluation = evaluateActivePolicyRollout(outcome);
    return { ...learning, policyEvaluation };
  }

  function policyRolloutSamples(rollout) {
    const outcomeById = new Map(pendingOutcomeStore.listOutcomes({
      projectScopeToken: rollout.projectScopeToken
    }).map((item) => [item.outcomeId, item]));
    return learningArtifactStore.listObservationRecords({
      projectScopeToken: rollout.projectScopeToken
    }).map((record) => {
      if (record.rolloutEligible !== true) return null;
      const recordedOutcome = outcomeById.get(record.outcomeId);
      if (!recordedOutcome
          || recordedOutcome.policyId !== rollout.policyId
          || ![rollout.baselineVersion, rollout.policyVersion].includes(recordedOutcome.policyVersion)
          || !["succeeded", "failed"].includes(recordedOutcome.status)) return null;
      const observation = record.observation;
      return {
        arm: recordedOutcome.policyVersion === rollout.policyVersion ? "candidate" : "baseline",
        taskOutcomeToken: observation.taskOutcomeToken,
        retryCount: observation.retryCount,
        undoUsed: observation.undoUsed,
        totalTokens: observationTokens(observation),
        tokenAccountingSource: observation.tokenAccountingSource,
        latencyMs: observation.latencyMs,
        reworkCount: observation.retryCount + (observation.editFeatureSummary?.userEdited === true ? 1 : 0)
      };
    }).filter(Boolean);
  }

  function evaluateStoredPolicyRollout(rollout) {
    const observations = policyRolloutSamples(rollout);
    const confidence = estimateRolloutConfidence(observations, rollout.minimums);
    const evaluation = evaluatePolicyRollout(rollout, {
      observations,
      confidence: confidence.confidence
    }, options.policyOptions || {});
    const policy = generationPolicyRegistry.applyRolloutEvaluation(evaluation);
    return { evaluation, policy, confidence };
  }

  function evaluateActivePolicyRollout(outcome) {
    if (!outcome?.policyId || !Number.isInteger(outcome.policyVersion)) return null;
    const rollout = generationPolicyRegistry.listRollouts()
      .filter((item) => ["canary", "collecting"].includes(item.status)
        && item.policyId === outcome.policyId
        && item.projectScopeToken === outcome.projectScopeToken
        && [item.baselineVersion, item.policyVersion].includes(outcome.policyVersion))
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0]
      || null;
    if (!rollout) return null;
    const { evaluation, confidence } = evaluateStoredPolicyRollout(rollout);
    return {
      action: evaluation.action,
      reasonToken: evaluation.reasonToken,
      rolloutId: evaluation.rollout.rolloutId,
      policyStatus: evaluation.policyStatus,
      confidence: confidence.confidence,
      enoughSamples: confidence.enoughSamples
    };
  }

  function evaluateGenerationPolicyRolloutFromStoredResults(rolloutIdInput) {
    const rolloutId = clipText(rolloutIdInput, 180).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/.test(rolloutId)) {
      const error = new Error("A valid rolloutId is required.");
      error.code = "invalid_policy_rollout_id";
      throw error;
    }
    const rollout = generationPolicyRegistry.listRollouts()
      .find((item) => item.rolloutId === rolloutId) || null;
    if (!rollout) {
      const error = new Error("Policy rollout was not found.");
      error.code = "policy_rollout_not_found";
      throw error;
    }
    if (!["canary", "collecting"].includes(rollout.status)) {
      const error = new Error("Only an active canary rollout can be evaluated.");
      error.code = "policy_rollout_not_active";
      throw error;
    }
    return evaluateStoredPolicyRollout(rollout);
  }

  function recordGenerationPolicyIncident(input = {}) {
    const policyId = clipText(input.policyId, 180).trim();
    const policyVersion = Number(input.policyVersion);
    const projectScopeToken = clipText(input.projectScopeToken, 180).trim();
    const incidentType = safeMetricToken(input.incidentType, 100);
    if (!policyId || !Number.isInteger(policyVersion) || policyVersion < 1
        || !projectScopeToken || ![
          "auto_submit_incident",
          "miswrite_incident",
          "privacy_incident",
          "permission_incident",
          "safety_incident"
        ].includes(incidentType)) return null;
    const rollout = generationPolicyRegistry.listRollouts()
      .filter((item) => ["canary", "collecting"].includes(item.status)
        && item.policyId === policyId
        && [item.baselineVersion, item.policyVersion].includes(policyVersion)
        && item.projectScopeToken === projectScopeToken)
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0]
      || null;
    if (!rollout) return null;
    const evaluation = evaluatePolicyRollout(rollout, {
      events: [{ eventType: incidentType }],
      confidence: 0
    }, options.policyOptions || {});
    generationPolicyRegistry.applyRolloutEvaluation(evaluation);
    return {
      action: evaluation.action,
      reasonToken: evaluation.reasonToken,
      rolloutId: evaluation.rollout.rolloutId,
      policyStatus: evaluation.policyStatus
    };
  }

  function recordCodexTargetPolicyIncident(generationBinding = {}, inserted = {}) {
    const incidentType = classifyCodexInsertPolicyIncident(inserted);
    if (!incidentType) return null;
    return recordGenerationPolicyIncident({
      policyId: generationBinding.policyId,
      policyVersion: generationBinding.policyVersion,
      projectScopeToken: generationBinding.projectScopeToken,
      incidentType
    });
  }

  function reviewLearningCandidate(artifactId, decision = {}) {
    const detail = learningArtifactStore.getCandidateDetail(artifactId);
    const artifact = detail.artifact;
    if (artifact.status !== "pending_review") {
      if (artifact.status === "active" && artifact.review?.decision === "accepted") return artifact;
      return learningArtifactStore.reviewCandidate(artifactId, decision);
    }
    if (decision.action !== "accept" || artifact.artifactType !== "generation_policy") {
      return learningArtifactStore.reviewCandidate(artifactId, decision);
    }
    const observations = learningArtifactStore.listObservations({
      projectScopeToken: artifact.scope.projectScopeToken
    });
    const source = [...observations].reverse().find((observation) => {
      const baseline = ensureBaselineGenerationPolicy({
        target: "codex",
        projectScopeToken: artifact.scope.projectScopeToken,
        taskScenarioToken: observation.taskScenarioToken,
        modelFamilyToken: observation.modelFamilyToken
      });
      return baseline.policyId === artifact.payload.policyId;
    });
    if (!source) {
      const error = new Error("The policy candidate has no valid scoped observation evidence.");
      error.code = "generation_policy_candidate_evidence_missing";
      throw error;
    }
    const baseline = ensureBaselineGenerationPolicy({
      target: "codex",
      projectScopeToken: artifact.scope.projectScopeToken,
      taskScenarioToken: source.taskScenarioToken,
      modelFamilyToken: source.modelFamilyToken
    });
    const policy = compileGenerationPolicy({
      policyId: baseline.policyId,
      version: Math.max(artifact.payload.policyVersion, baseline.version + 1),
      baselineVersion: baseline.version,
      scope: baseline.scope,
      automaticRolloutEligible: true,
      selectedStrategy: {
        strategyId: source.strategyId,
        strategyVersion: source.strategyVersion
      },
      evidenceSummary: {
        baselineOutcomes: artifact.evidenceSummary.successfulOutcomeCount,
        candidateOutcomes: 0,
        successfulOutcomes: artifact.evidenceSummary.successfulOutcomeCount,
        failedOutcomes: 0,
        retryCount: observations.reduce((sum, observation) => sum + observation.retryCount, 0),
        undoCount: observations.filter((observation) => observation.undoUsed).length,
        safetyIncidentCount: 0
      }
    }, options.policyCompilerOptions || {});
    generationPolicyRegistry.registerPolicy(policy);
    try {
      return learningArtifactStore.reviewCandidate(artifactId, decision);
    } catch (error) {
      generationPolicyRegistry.rollbackPolicy(policy.policyId, policy.version, "manual");
      throw error;
    }
  }

  function clearProjectLearningData(projectScopeToken) {
    const learning = learningArtifactStore.clearProjectData(projectScopeToken);
    const invalidatedOutcomeIds = pendingOutcomeStore.invalidateProject(projectScopeToken);
    const promptHistory = clearProjectPromptHistory(projectScopeToken, learning.archiveDir);
    const rolledBackPolicies = [];
    for (const policy of generationPolicyRegistry.listPolicies({ projectScopeToken })) {
      if (policy.status === "rolled_back") continue;
      rolledBackPolicies.push(generationPolicyRegistry.rollbackPolicy(
        policy.policyId,
        policy.version,
        "manual"
      ));
    }
    return {
      projectScopeToken,
      archiveToken: learning.archiveToken,
      invalidatedAt: learning.invalidatedAt,
      keyArchived: learning.keyArchived,
      counts: {
        ...learning.counts,
        promptHistory,
        pendingOutcomes: invalidatedOutcomeIds.length,
        policies: rolledBackPolicies.length
      }
    };
  }

  function searchPrompts(query) {
    return getPrompts().filter((prompt) => matchesQuery([
      prompt.title,
      prompt.body,
      prompt.mode,
      prompt.source,
      ...(prompt.tags || [])
    ], query));
  }

  function searchSkills(query) {
    return getSkills().filter((skill) => matchesQuery([
      skill.name,
      skill.description,
      skill.id,
      ...(skill.tags || [])
    ], query));
  }

  function recordMetric(event = {}) {
    const current = readJson(metricsFile, []);
    const clip = (value, length) => String(value || "").slice(0, length);
    const token = (value, length = 80) => clip(String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_.:+-]+/g, "-")
      .replace(/^-+|-+$/g, ""), length);
    const qualityScore = Number(event.qualityScore);
    const outcomeScore = Number(event.outcomeScore ?? event.outcome_score);
    const experimentArm = clip(event.experimentArm || event.experiment_arm, 80);
    const strategyWeightVersion = clip(event.strategyWeightVersion || event.strategy_weight_version, 80);
    const strategyWeightDecision = token(event.strategyWeightDecision || event.strategy_weight_decision, 80);
    const strategyWeightPromoted = clip(event.strategyWeightPromoted || event.strategy_weight_promoted, 180);
    const promptStrategyId = clip(event.promptStrategyId || event.prompt_strategy_id, 80);
    const action = clip(event.action || "unknown", 40);
    const outcomeLabel = token(event.outcomeLabel || event.outcome_label || event.outcome || event.result, 80);
    const rawFailureReason = event.failureReasonToken
      || event.failure_reason_token
      || event.failureReason
      || event.failure_reason
      || event.outcomeReason
      || event.outcome_reason
      || event.outcomeFailureReason
      || event.outcome_failure_reason
      || event.reason
      || "";
    const fallbackFailureReason = action === "insert" && !(event.verified || event.adopted || event.ok)
      ? "insert_failed"
      : (["failed", "failure", "rejected", "needs-work", "bad", "blocked", "not-useful"].includes(outcomeLabel) || action === "retry" || action === "undo")
        ? "low_quality"
        : "";
    const failureReasonToken = normalizeFailureReasonToken(rawFailureReason, fallbackFailureReason);
    const failureReason = normalizeStoredFailureReason(rawFailureReason, failureReasonToken);
    let qualityLiftCohort = token(event.qualityLiftCohort || event.quality_lift_cohort, 80);
    if (!qualityLiftCohort && experimentArm === "baseline_structure") qualityLiftCohort = "baseline_structure";
    if (!qualityLiftCohort && strategyWeightVersion && (strategyWeightDecision === "outcome_weight" || (strategyWeightPromoted && promptStrategyId === "preserve_winning_strategy"))) {
      qualityLiftCohort = "outcome_weighted";
    }
    if (!qualityLiftCohort && experimentArm === "strategy_guided") qualityLiftCohort = "strategy_guided";
    if (!qualityLiftCohort && experimentArm) qualityLiftCohort = token(experimentArm, 80);
    const safe = {
      id: event.id || `metric-${Date.now()}`,
      created_at: event.created_at || new Date().toISOString(),
      action,
      mode: clip(event.mode, 40),
      tool: clip(event.tool, 80),
      adapterId: clip(event.adapterId || event.adapter_id, 80),
      site: sanitizeSite(event.site || event.host),
      taskScenario: token(event.taskScenario || event.task_scenario || event.scenario, 80),
      generatedBy: clip(event.generatedBy, 40),
      generationId: clip(event.generationId || event.generation_id, 80),
      strategyId: clip(event.strategyId || event.strategy_id, 180),
      promptStrategyId,
      promptStrategyVersion: clip(event.promptStrategyVersion || event.prompt_strategy_version, 80),
      experimentVersion: clip(event.experimentVersion || event.experiment_version, 80),
      experimentArm,
      experimentEligible: event.experimentEligible === undefined && event.experiment_eligible === undefined
        ? null
        : Boolean(event.experimentEligible ?? event.experiment_eligible),
      experimentBucket: Number.isFinite(Number(event.experimentBucket ?? event.experiment_bucket))
        ? Number(event.experimentBucket ?? event.experiment_bucket)
        : null,
      experimentComparisonKey: clip(event.experimentComparisonKey || event.experiment_comparison_key, 220),
      strategyInsightsVersion: clip(event.strategyInsightsVersion || event.strategy_insights_version, 80),
      strategyReadiness: clip(event.strategyReadiness || event.strategy_readiness, 40),
      strategyWeightVersion,
      strategyWeightStatus: token(event.strategyWeightStatus || event.strategy_weight_status, 40),
      strategyWeightPromoted,
      strategyWeightSuppressed: clip(event.strategyWeightSuppressed || event.strategy_weight_suppressed, 180),
      strategyWeightDecision,
      qualityLiftCohort,
      qualityScore: Number.isFinite(qualityScore) ? qualityScore : null,
      feedbackConfidence: clip(event.feedbackConfidence || event.feedback_confidence, 24),
      source: clip(event.source, 40),
      insertStrategy: clip(event.insertStrategy || event.strategy, 80),
      kind: clip(event.kind, 40),
      verified: Boolean(event.verified),
      failureReason,
      failureReasonToken,
      outcomeLabel,
      outcomeScore: Number.isFinite(outcomeScore) ? Math.max(0, Math.min(1, outcomeScore)) : null,
      outcomeVerified: Boolean(event.outcomeVerified ?? event.outcome_verified),
      outcomeSource: token(event.outcomeSource || event.outcome_source || event.source, 40),
      ok: Boolean(event.ok),
      adopted: Boolean(event.adopted),
      promptLength: Number(event.promptLength || 0)
    };
    const next = [safe, ...current].slice(0, 500);
    writeJson(metricsFile, next);
    return next;
  }

  function getMetrics() {
    const events = readJson(metricsFile, []);
    const byAction = {};
    const byAdapter = {};
    const byStrategy = {};
    const byExperimentArm = {};
    const byQualityLiftCohort = {};
    const byScenario = {};
    const byScenarioStrategy = {};
    const byScenarioExperimentArm = {};
    const failureReasons = {};
    const failureReasonTokens = {};
    const successfulOutcomeLabels = new Set(["success", "accepted", "completed", "pass", "resolved", "saved", "useful"]);
    const failedOutcomeLabels = new Set(["failed", "failure", "rejected", "needs-work", "bad", "blocked", "not-useful"]);
    const isOutcomeEvent = (event) => event.action === "outcome" || event.action === "task_outcome";
    const isSuccessfulOutcome = (event) => {
      if (!isOutcomeEvent(event)) return false;
      if (failedOutcomeLabels.has(event.outcomeLabel || "")) return false;
      if (successfulOutcomeLabels.has(event.outcomeLabel || "")) return true;
      return Boolean(event.ok || event.adopted || event.outcomeVerified);
    };

    const createAggregate = () => ({
      events: 0,
      cardReady: 0,
      insertAttempts: 0,
      verifiedInserts: 0,
      saves: 0,
      retries: 0,
      undos: 0,
      copies: 0,
      failures: 0,
      outcomes: 0,
      successfulOutcomes: 0,
      failedOutcomes: 0,
      qualityScoreTotal: 0,
      qualityScoreCount: 0,
      outcomeScoreTotal: 0,
      outcomeScoreCount: 0,
      promptLengthTotal: 0,
      promptLengthCount: 0,
      feedbackConfidence: {},
      outcomeLabels: {},
      modes: {},
      tools: {},
      adapters: {},
      sites: {},
      scenarios: {},
      promptStrategyIds: {},
      promptStrategyVersions: {},
      experimentVersions: {},
      experimentArms: {},
      experimentComparisonKeys: {},
      strategyInsightsVersions: {},
      strategyReadiness: {},
      strategyWeightVersions: {},
      strategyWeightStatuses: {},
      strategyWeightPromoted: {},
      strategyWeightSuppressed: {},
      strategyWeightDecisions: {},
      qualityLiftCohorts: {},
      failureReasonTokens: {}
    });
    const bump = (target, key) => {
      if (!key) return;
      target[key] = (target[key] || 0) + 1;
    };
    const hasFiniteNumberValue = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    const updateAggregate = (aggregate, event) => {
      aggregate.events += 1;
      bump(aggregate.modes, event.mode);
      bump(aggregate.tools, event.tool);
      bump(aggregate.adapters, event.adapterId);
      bump(aggregate.sites, event.site);
      bump(aggregate.scenarios, event.taskScenario);
      bump(aggregate.feedbackConfidence, event.feedbackConfidence);
      bump(aggregate.promptStrategyIds, event.promptStrategyId);
      bump(aggregate.promptStrategyVersions, event.promptStrategyVersion);
      bump(aggregate.experimentVersions, event.experimentVersion);
      bump(aggregate.experimentArms, event.experimentArm);
      bump(aggregate.experimentComparisonKeys, event.experimentComparisonKey);
      bump(aggregate.strategyInsightsVersions, event.strategyInsightsVersion);
      bump(aggregate.strategyReadiness, event.strategyReadiness);
      bump(aggregate.strategyWeightVersions, event.strategyWeightVersion);
      bump(aggregate.strategyWeightStatuses, event.strategyWeightStatus);
      bump(aggregate.strategyWeightPromoted, event.strategyWeightPromoted);
      bump(aggregate.strategyWeightSuppressed, event.strategyWeightSuppressed);
      bump(aggregate.strategyWeightDecisions, event.strategyWeightDecision);
      bump(aggregate.qualityLiftCohorts, event.qualityLiftCohort);
      bump(aggregate.failureReasonTokens, event.failureReasonToken);
      bump(aggregate.outcomeLabels, event.outcomeLabel);
      if (event.action === "card_ready") aggregate.cardReady += 1;
      if (event.action === "save") aggregate.saves += 1;
      if (event.action === "retry") aggregate.retries += 1;
      if (event.action === "undo") aggregate.undos += 1;
      if (event.action === "copy") aggregate.copies += 1;
      if (hasFiniteNumberValue(event.qualityScore)) {
        aggregate.qualityScoreTotal += Number(event.qualityScore);
        aggregate.qualityScoreCount += 1;
      }
      if (hasFiniteNumberValue(event.outcomeScore)) {
        aggregate.outcomeScoreTotal += Number(event.outcomeScore);
        aggregate.outcomeScoreCount += 1;
      }
      if (Number.isFinite(Number(event.promptLength)) && Number(event.promptLength) > 0) {
        aggregate.promptLengthTotal += Number(event.promptLength);
        aggregate.promptLengthCount += 1;
      }
      if (isOutcomeEvent(event)) {
        aggregate.outcomes += 1;
        if (isSuccessfulOutcome(event)) {
          aggregate.successfulOutcomes += 1;
        } else if (failedOutcomeLabels.has(event.outcomeLabel || "") || event.ok === false) {
          aggregate.failedOutcomes += 1;
        }
      }
      if (event.action === "insert") {
        aggregate.insertAttempts += 1;
        if (event.verified || event.adopted) {
          aggregate.verifiedInserts += 1;
        } else {
          aggregate.failures += 1;
        }
      }
    };
    const finalizeAggregate = (aggregate) => {
      aggregate.avgQualityScore = aggregate.qualityScoreCount ? roundMetric(aggregate.qualityScoreTotal / aggregate.qualityScoreCount) : null;
      aggregate.avgOutcomeScore = aggregate.outcomeScoreCount ? roundMetric(aggregate.outcomeScoreTotal / aggregate.outcomeScoreCount) : null;
      aggregate.avgPromptLength = aggregate.promptLengthCount ? roundMetric(aggregate.promptLengthTotal / aggregate.promptLengthCount) : 0;
      aggregate.insertSuccessRate = aggregate.insertAttempts ? roundMetric(aggregate.verifiedInserts / aggregate.insertAttempts) : 0;
      aggregate.saveRate = aggregate.cardReady ? roundMetric(aggregate.saves / aggregate.cardReady) : 0;
      aggregate.retryUsageRate = aggregate.cardReady ? roundMetric(aggregate.retries / aggregate.cardReady) : 0;
      aggregate.undoUsageRate = aggregate.insertAttempts ? roundMetric(aggregate.undos / aggregate.insertAttempts) : 0;
      aggregate.outcomeSuccessRate = aggregate.outcomes ? roundMetric(aggregate.successfulOutcomes / aggregate.outcomes) : 0;
      delete aggregate.qualityScoreTotal;
      delete aggregate.qualityScoreCount;
      delete aggregate.outcomeScoreTotal;
      delete aggregate.outcomeScoreCount;
      delete aggregate.promptLengthTotal;
      delete aggregate.promptLengthCount;
    };

    for (const event of events) {
      byAction[event.action] = (byAction[event.action] || 0) + 1;
      const adapterId = event.adapterId || "unknown";
      byAdapter[adapterId] = byAdapter[adapterId] || {
        events: 0,
        insertAttempts: 0,
        verifiedInserts: 0,
        failures: 0
      };
      byAdapter[adapterId].events += 1;
      const strategyId = event.strategyId || "unknown";
      byStrategy[strategyId] = byStrategy[strategyId] || createAggregate();
      updateAggregate(byStrategy[strategyId], event);
      if (event.taskScenario) {
        byScenario[event.taskScenario] = byScenario[event.taskScenario] || createAggregate();
        updateAggregate(byScenario[event.taskScenario], event);

        byScenarioStrategy[event.taskScenario] = byScenarioStrategy[event.taskScenario] || {};
        byScenarioStrategy[event.taskScenario][strategyId] = byScenarioStrategy[event.taskScenario][strategyId] || createAggregate();
        updateAggregate(byScenarioStrategy[event.taskScenario][strategyId], event);

        if (event.experimentArm) {
          byScenarioExperimentArm[event.taskScenario] = byScenarioExperimentArm[event.taskScenario] || {};
          byScenarioExperimentArm[event.taskScenario][event.experimentArm] = byScenarioExperimentArm[event.taskScenario][event.experimentArm] || createAggregate();
          updateAggregate(byScenarioExperimentArm[event.taskScenario][event.experimentArm], event);
        }
      }
      if (event.experimentArm) {
        byExperimentArm[event.experimentArm] = byExperimentArm[event.experimentArm] || createAggregate();
        updateAggregate(byExperimentArm[event.experimentArm], event);
      }
      if (event.qualityLiftCohort) {
        byQualityLiftCohort[event.qualityLiftCohort] = byQualityLiftCohort[event.qualityLiftCohort] || createAggregate();
        updateAggregate(byQualityLiftCohort[event.qualityLiftCohort], event);
      }
      if (event.action === "insert") {
        byAdapter[adapterId].insertAttempts += 1;
        if (event.verified || event.adopted) {
          byAdapter[adapterId].verifiedInserts += 1;
        } else {
          byAdapter[adapterId].failures += 1;
          const reason = event.failureReason || "unknown";
          failureReasons[reason] = (failureReasons[reason] || 0) + 1;
          const reasonToken = event.failureReasonToken || normalizeFailureReasonToken(reason, "insert_failed") || "other";
          failureReasonTokens[reasonToken] = (failureReasonTokens[reasonToken] || 0) + 1;
        }
      }
      if (event.failureReasonToken && event.action !== "insert") {
        failureReasonTokens[event.failureReasonToken] = (failureReasonTokens[event.failureReasonToken] || 0) + 1;
      }
    }
    for (const strategy of Object.values(byStrategy)) finalizeAggregate(strategy);
    for (const experimentArm of Object.values(byExperimentArm)) finalizeAggregate(experimentArm);
    for (const qualityLiftCohort of Object.values(byQualityLiftCohort)) finalizeAggregate(qualityLiftCohort);
    for (const scenario of Object.values(byScenario)) finalizeAggregate(scenario);
    for (const strategies of Object.values(byScenarioStrategy)) {
      for (const strategy of Object.values(strategies)) finalizeAggregate(strategy);
    }
    for (const experimentArms of Object.values(byScenarioExperimentArm)) {
      for (const experimentArm of Object.values(experimentArms)) finalizeAggregate(experimentArm);
    }
    const insertEvents = events.filter((event) => event.action === "insert");
    const adoptedInsertEvents = insertEvents.filter((event) => event.adopted || event.verified);
    const cardReadyEvents = events.filter((event) => event.action === "card_ready");
    const saveEvents = events.filter((event) => event.action === "save");
    const undoEvents = events.filter((event) => event.action === "undo");
    const retryEvents = events.filter((event) => event.action === "retry");
    const outcomeEvents = events.filter(isOutcomeEvent);
    const successfulOutcomeEvents = outcomeEvents.filter(isSuccessfulOutcome);
    const outcomeScoreEvents = outcomeEvents.filter((event) => hasFiniteNumberValue(event.outcomeScore));
    const rate = (numerator, denominator) => denominator ? numerator / denominator : 0;
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      eventCount: events.length,
      byAction,
      byAdapter,
      byStrategy,
      byExperimentArm,
      byQualityLiftCohort,
      byScenario,
      byScenarioStrategy,
      byScenarioExperimentArm,
      failureReasons,
      failureReasonTokens,
      insertSuccessRate: rate(adoptedInsertEvents.length, insertEvents.length),
      saveRate: rate(saveEvents.length, cardReadyEvents.length),
      undoUsageRate: rate(undoEvents.length, insertEvents.length),
      retryUsageRate: rate(retryEvents.length, cardReadyEvents.length),
      adapterFailureRate: rate(insertEvents.length - adoptedInsertEvents.length, insertEvents.length),
      outcomeSuccessRate: rate(successfulOutcomeEvents.length, outcomeEvents.length),
      avgOutcomeScore: outcomeScoreEvents.length
        ? roundMetric(outcomeScoreEvents.reduce((sum, event) => sum + Number(event.outcomeScore), 0) / outcomeScoreEvents.length)
        : null,
      savedPromptCount: getPrompts().length,
      skillCount: getSkills().length,
      promptHistoryCount: getPromptHistory().length,
      events
    };
  }

  function getOutcomeFollowups(options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
    const history = getPromptHistory();
    const events = readJson(metricsFile, []);
    const labeledGenerationIds = new Set(events
      .filter((event) => isOutcomeMetricAction(event.action) && event.generationId && event.outcomeLabel)
      .map((event) => event.generationId));
    const candidates = new Map();
    const mergeCandidate = (generationId, candidate = {}) => {
      const id = clipText(generationId, 80);
      if (!id || labeledGenerationIds.has(id)) return;
      const current = candidates.get(id) || {};
      candidates.set(id, {
        generationId: id,
        created_at: current.created_at || candidate.created_at || new Date().toISOString(),
        source: current.source && candidate.source && current.source !== candidate.source
          ? `${current.source}+${candidate.source}`
          : current.source || candidate.source || "metadata",
        strategyId: current.strategyId || clipText(candidate.strategyId, 180),
        mode: current.mode || clipText(candidate.mode, 40),
        tool: current.tool || clipText(candidate.tool, 80),
        adapterId: current.adapterId || clipText(candidate.adapterId, 80),
        site: current.site || sanitizeSite(candidate.site || candidate.host),
        taskScenario: current.taskScenario || safeMetricToken(candidate.taskScenario || candidate.scenario, 80),
        generatedBy: current.generatedBy || clipText(candidate.generatedBy, 40),
        promptStrategyId: current.promptStrategyId || clipText(candidate.promptStrategyId, 80),
        promptStrategyVersion: current.promptStrategyVersion || clipText(candidate.promptStrategyVersion, 80),
        experimentVersion: current.experimentVersion || clipText(candidate.experimentVersion, 80),
        experimentArm: current.experimentArm || clipText(candidate.experimentArm, 80),
        experimentComparisonKey: current.experimentComparisonKey || clipText(candidate.experimentComparisonKey, 220),
        strategyInsightsVersion: current.strategyInsightsVersion || clipText(candidate.strategyInsightsVersion, 80),
        strategyReadiness: current.strategyReadiness || clipText(candidate.strategyReadiness, 40),
        strategyWeightVersion: current.strategyWeightVersion || clipText(candidate.strategyWeightVersion, 80),
        strategyWeightStatus: current.strategyWeightStatus || safeMetricToken(candidate.strategyWeightStatus, 40),
        strategyWeightPromoted: current.strategyWeightPromoted || clipText(candidate.strategyWeightPromoted, 180),
        strategyWeightSuppressed: current.strategyWeightSuppressed || clipText(candidate.strategyWeightSuppressed, 180),
        strategyWeightDecision: current.strategyWeightDecision || safeMetricToken(candidate.strategyWeightDecision, 80),
        qualityLiftCohort: current.qualityLiftCohort || safeMetricToken(candidate.qualityLiftCohort, 80),
        qualityScore: Number.isFinite(Number(current.qualityScore)) ? current.qualityScore : Number.isFinite(Number(candidate.qualityScore)) ? Number(candidate.qualityScore) : null,
        promptLength: Number(current.promptLength || candidate.promptLength || 0),
        lastAction: candidate.lastAction || candidate.action || current.lastAction || "",
        hasInsert: Boolean(current.hasInsert || candidate.hasInsert || candidate.action === "insert"),
        insertVerified: Boolean(current.insertVerified || candidate.insertVerified || (candidate.action === "insert" && (candidate.verified || candidate.adopted))),
        privacy: {
          metadataOnly: true,
          promptTextNotStored: true,
          inputTextNotStored: true,
          pageBodyNotRequired: true,
          fullUrlNotStored: true
        }
      });
    };

    for (const entry of history) {
      const context = entry.context || {};
      mergeCandidate(entry.generationId || entry.id, {
        source: "prompt_history",
        created_at: entry.created_at,
        strategyId: entry.strategyId,
        mode: entry.mode,
        tool: entry.tool,
        generatedBy: entry.generatedBy,
        qualityScore: entry.qualityScore,
        promptLength: entry.promptLength,
        host: context.host,
        taskScenario: context.taskScenario,
        promptStrategyId: context.promptStrategyId,
        promptStrategyVersion: context.promptStrategyVersion,
        experimentVersion: context.experimentVersion,
        experimentArm: context.experimentArm,
        experimentComparisonKey: context.experimentComparisonKey,
        strategyWeightVersion: context.strategyWeightVersion,
        strategyWeightStatus: context.strategyWeightStatus,
        strategyWeightPromoted: context.strategyWeightPromoted,
        strategyWeightSuppressed: context.strategyWeightSuppressed,
        strategyWeightDecision: context.strategyWeightDecision,
        qualityLiftCohort: context.qualityLiftCohort,
        strategyInsightsVersion: context.strategyInsightsVersion,
        strategyReadiness: context.strategyInsightsReadiness,
        lastAction: "generated"
      });
    }

    for (const event of events) {
      if (!event.generationId || isOutcomeMetricAction(event.action)) continue;
      if (!["card_ready", "insert", "save", "retry", "undo", "copy"].includes(event.action)) continue;
      mergeCandidate(event.generationId, {
        ...event,
        source: "metric",
        lastAction: event.action,
        hasInsert: event.action === "insert",
        insertVerified: event.action === "insert" && (event.verified || event.adopted)
      });
    }

    const pending = [...candidates.values()]
      .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      pendingOutcomeCount: pending.length,
      pendingOutcomes: pending.slice(0, limit),
      privacy: {
        metadataOnly: true,
        promptTextNotStored: true,
        inputTextNotStored: true,
        pageBodyNotRequired: true,
        fullUrlNotStored: true
      }
    };
  }

  function recordOutcomeFollowup({ generationId, outcomeLabel, failureReason, failureReasonToken, outcomeReason } = {}) {
    const normalizedLabel = normalizeOutcomeLabel(outcomeLabel);
    if (!normalizedLabel) {
      const error = new Error("Outcome label must be success, needs-work, or failed.");
      error.code = "invalid_outcome_label";
      throw error;
    }
    const id = clipText(generationId, 80);
    const candidate = getOutcomeFollowups({ limit: 100 }).pendingOutcomes.find((item) => item.generationId === id);
    if (!candidate) {
      const error = new Error("Pending outcome candidate not found.");
      error.code = "outcome_candidate_not_found";
      throw error;
    }
    const metrics = recordMetric({
      action: "outcome",
      mode: candidate.mode,
      tool: candidate.tool,
      adapterId: candidate.adapterId,
      site: candidate.site,
      taskScenario: candidate.taskScenario,
      generatedBy: candidate.generatedBy,
      generationId: candidate.generationId,
      strategyId: candidate.strategyId,
      promptStrategyId: candidate.promptStrategyId,
      promptStrategyVersion: candidate.promptStrategyVersion,
      experimentVersion: candidate.experimentVersion,
      experimentArm: candidate.experimentArm,
      experimentComparisonKey: candidate.experimentComparisonKey,
      strategyInsightsVersion: candidate.strategyInsightsVersion,
      strategyReadiness: candidate.strategyReadiness,
      strategyWeightVersion: candidate.strategyWeightVersion,
      strategyWeightStatus: candidate.strategyWeightStatus,
      strategyWeightPromoted: candidate.strategyWeightPromoted,
      strategyWeightSuppressed: candidate.strategyWeightSuppressed,
      strategyWeightDecision: candidate.strategyWeightDecision,
      qualityLiftCohort: candidate.qualityLiftCohort,
      qualityScore: candidate.qualityScore,
      feedbackConfidence: "",
      source: "manual_followup",
      verified: true,
      ok: normalizedLabel === "success",
      adopted: normalizedLabel === "success",
      promptLength: candidate.promptLength,
      outcomeLabel: normalizedLabel,
      outcomeScore: outcomeScoreForLabel(normalizedLabel),
      outcomeVerified: true,
      outcomeSource: "manual_followup",
      failureReasonToken: normalizedLabel === "success" ? "" : normalizeFailureReasonToken(failureReasonToken || failureReason || outcomeReason, normalizedLabel === "failed" || normalizedLabel === "needs-work" ? "low_quality" : ""),
      failureReason: normalizedLabel === "success" ? "" : (failureReason || outcomeReason || failureReasonToken || normalizedLabel)
    });
    return {
      outcome: metrics[0],
      pending: getOutcomeFollowups({ limit: 100 })
    };
  }

  function exportData() {
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      settings: sanitizeSettingsFile(readSettingsFile()),
      skills: getSkills(),
      prompts: getPrompts(),
      promptHistory: getPromptHistory(),
      metrics: readJson(metricsFile, [])
    };
  }

  function restoreData(bundle = {}) {
    if (Number(bundle.schemaVersion || 0) > DATA_SCHEMA_VERSION) {
      const error = new Error(`Unsupported data schema version: ${bundle.schemaVersion}`);
      error.code = "unsupported_schema_version";
      throw error;
    }
    if (Array.isArray(bundle.skills)) saveSkills(bundle.skills);
    if (Array.isArray(bundle.prompts)) savePrompts(bundle.prompts);
    if (Array.isArray(bundle.promptHistory)) {
      writeJson(historyFile, sanitizeRestoredPromptHistory(bundle.promptHistory));
    }
    if (Array.isArray(bundle.metrics)) writeJson(metricsFile, bundle.metrics.slice(0, 500));
    migrateData();
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      skills: getSkills().length,
      prompts: getPrompts().length,
      promptHistory: getPromptHistory().length,
      metrics: readJson(metricsFile, []).length
    };
  }

  function clearAllLocalData() {
    const recoveryId = `reset-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17)}-${crypto.randomBytes(4).toString("hex")}`;
    const recoveryDirectory = path.join(dataDir, ".recovery", recoveryId);
    ensureDir(recoveryDirectory);
    const moved = [];
    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (entry.name === ".recovery") continue;
      const source = path.join(dataDir, entry.name);
      const destination = path.join(recoveryDirectory, entry.name);
      fs.renameSync(source, destination);
      moved.push(entry.name);
    }
    migrateData();
    getSecurity();
    return {
      clearAllLocalData: true,
      resetMode: "recoverable",
      recoveryId,
      recoveryDirectory,
      moved,
      schemaVersion: DATA_SCHEMA_VERSION
    };
  }

  function migrateActivationFromLegacy() {
    if (!legacyDataPresent || typeof activationStore.migrateFromLegacy !== "function") {
      return activationStore.getStatus();
    }
    const settings = getSettings();
    return activationStore.migrateFromLegacy({
      hasProvider: hasProviderKeys(settings),
      provider: settings.provider,
      model: settings.model,
      historicalEvents: readJson(metricsFile, [])
    });
  }

  function migrateCodexActivationFromPhase3() {
    return codexActivationStore.initializeFromPhase3(activationStore.getStatus());
  }

  function exportDiagnostics() {
    const settings = getSettings();
    const metrics = getMetrics();
    const strategyInsights = buildStrategyInsights(metrics);
    const experimentOutcomeReport = buildExperimentOutcomeReport(metrics);
    return {
      createdAt: new Date().toISOString(),
      diagnostics: true,
      service: "smart-prompt-local-service",
      schemaVersion: DATA_SCHEMA_VERSION,
      dataDir,
      metadata: getMetadata(),
      counts: {
        skills: getSkills().length,
        prompts: getPrompts().length,
        promptHistory: getPromptHistory().length,
        metrics: metrics.eventCount
      },
      metrics,
      strategyInsights,
      strategyInsightsText: formatStrategyInsights(strategyInsights),
      experimentOutcomeReport,
      experimentOutcomeText: formatExperimentOutcomeReport(experimentOutcomeReport),
      credentialStorage: settings.credentialStorage,
      keyMigration: readJson(path.join(dataDir, "key-migration.json"), {
        migrateProviderKeys: false
      }),
      portRecovery: {
        supported: true,
        portRecovery: true
      }
    };
  }

  migrateData();
  migrateActivationFromLegacy();
  migrateCodexActivationFromPhase3();

  return {
    dataDir,
    schemaVersion: DATA_SCHEMA_VERSION,
    getMetadata,
    migrateData,
    getSettings,
    previewSettings,
    saveSettings,
    getAuthToken,
    getSecurity,
    getSkills,
    saveSkills,
    addSkills,
    deleteSkill,
    getPrompts,
    savePrompts,
    addPrompt,
    deletePrompt,
    addPromptHistory,
    getPromptHistory,
    recordVerifiedGenerationEditSummary,
    searchPrompts,
    searchSkills,
    recordMetric,
    getMetrics,
    getOutcomeFollowups,
    recordOutcomeFollowup,
    exportData,
    restoreData,
    clearAllLocalData,
    exportDiagnostics,
    migrateProviderKeysIfNeeded,
    getActivationStatus: activationStore.getStatus,
    setActivationProgress,
    recordActivationModelReady,
    markActivationBrowserSeen: activationStore.markBrowserSeen,
    completeActivation: activationStore.complete,
    setRuntimeHealth: setActivationRuntimeHealth,
    resetActivationProgress: activationStore.resetProgress,
    migrateActivationFromLegacy,
    activationStore,
    getCodexActivationStatus: codexActivationStore.getStatus,
    setCodexActivationProgress: codexActivationStore.setProgress,
    recordCodexActivationModelReady: codexActivationStore.recordModelReady,
    markCodexActivationLoopStarted: codexActivationStore.markCodexLoopStarted,
    completeCodexActivation: codexActivationStore.complete,
    setCodexActivationRuntimeHealth: codexActivationStore.setRuntimeHealth,
    resetCodexActivationProgress: codexActivationStore.resetProgress,
    migrateCodexActivationFromPhase3,
    codexActivationStore,
    recordPendingOutcomeEvent: pendingOutcomeStore.recordPromptSessionEvent,
    recordExternalPendingOutcomeEvent,
    recordVerifiedInsertOutcome: pendingOutcomeStore.recordVerifiedInsert,
    recordOutcomeImplicitSignal: pendingOutcomeStore.recordImplicitSignal,
    claimPendingOutcomeFeedback: pendingOutcomeStore.claimNextFeedback,
    submitPendingOutcomeFeedback: pendingOutcomeStore.submitOutcomeFeedback,
    submitPendingOutcomeFailureReason: pendingOutcomeStore.submitFailureReason,
    expirePendingOutcomes: pendingOutcomeStore.expireDueOutcomes,
    getPendingOutcomeContract: pendingOutcomeStore.getOutcome,
    getPendingOutcomeFeedbackState: pendingOutcomeStore.getFeedbackState,
    listOutcomeContracts: pendingOutcomeStore.listOutcomes,
    listPendingOutcomeContracts: pendingOutcomeStore.listPendingOutcomes,
    listOutcomeImplicitSignals: pendingOutcomeStore.listImplicitSignals,
    pendingOutcomeStore,
    recordLearningObservation: learningArtifactStore.recordObservation,
    recordResolvedOutcomeObservation,
    listLearningObservations: learningArtifactStore.listObservations,
    listLearningArtifacts: learningArtifactStore.listArtifacts,
    getLearningCandidateDetail: learningArtifactStore.getCandidateDetail,
    getLearningCardReminder: learningArtifactStore.getCardReminder,
    ignoreLearningCandidate: learningArtifactStore.ignoreCandidate,
    reviewLearningCandidate,
    setLearningSkillGates: learningArtifactStore.setSkillGates,
    recordLearningPromotionEvidence: learningArtifactStore.recordPromotionEvidence,
    listGlobalLearningProposals: learningArtifactStore.listGlobalProposals,
    confirmGlobalLearningProposal: learningArtifactStore.confirmGlobalProposal,
    clearProjectLearningData,
    getLearningInvalidations: learningArtifactStore.getInvalidations,
    learningArtifactStore,
    compileGenerationPolicy,
    compileAndRegisterGenerationPolicy,
    ensureBaselineGenerationPolicy,
    selectGenerationPolicy,
    createPolicyRollout,
    evaluateGenerationPolicyRolloutFromStoredResults,
    recordGenerationPolicyIncident,
    recordCodexTargetPolicyIncident,
    registerGenerationPolicy: generationPolicyRegistry.registerPolicy,
    markGenerationPolicyBenchmarked: generationPolicyRegistry.markBenchmarked,
    startGenerationPolicyCanary: generationPolicyRegistry.startCanary,
    startGenerationPolicyCanaryFromBenchmark: generationPolicyRegistry.startCanaryFromBenchmark,
    rollbackGenerationPolicy: generationPolicyRegistry.rollbackPolicy,
    pauseGenerationPolicyLearning: generationPolicyRegistry.pauseLearning,
    resumeGenerationPolicyLearning: generationPolicyRegistry.resumeLearning,
    isGenerationPolicyLearningPaused: generationPolicyRegistry.isLearningPaused,
    listGenerationPolicies: generationPolicyRegistry.listPolicies,
    listGenerationPolicyRollouts: generationPolicyRegistry.listRollouts,
    generationPolicyRegistry
  };
}

module.exports = {
  DATA_SCHEMA_VERSION,
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  createAuthToken,
  createStore,
  defaultDataDir
};
