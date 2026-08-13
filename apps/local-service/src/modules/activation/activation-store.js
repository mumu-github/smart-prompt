const fs = require("node:fs");
const path = require("node:path");
const { ensureDir, readJson, writeJson } = require("../../../../../packages/shared/utils");

const ACTIVATION_SCHEMA_VERSION = "phase3-activation@1";
const REQUIRED_EXTENSION_BUILD_ID = "phase3-extension-20260717-r5";
const ACTIVATION_PROGRESS = Object.freeze([
  "not_started",
  "configuring",
  "model_ready",
  "awaiting_first_loop",
  "activated"
]);
const RUNTIME_HEALTH = Object.freeze(["healthy", "repairing", "needs_repair"]);
const ACTIVATION_EVENT_ID_PATTERN = /^activation-(?:verified_insert|copy)-\d{10,16}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STATE_FIELDS = new Set([
  "schemaVersion",
  "progress",
  "runtimeHealth",
  "provider",
  "modelTestedAt",
  "browserSeenAt",
  "completionKind",
  "completionVerified",
  "completedAt",
  "lastEventId",
  "lastErrorCode",
  "migrationAppliedAt",
  "migrationSource",
  "updatedAt"
]);

const NEXT_ACTION_BY_PROGRESS = Object.freeze({
  not_started: "configure_provider",
  configuring: "configure_provider",
  model_ready: "open_chatgpt",
  awaiting_first_loop: "finish_first_loop",
  activated: "open_assistant"
});

const PROGRESS_TRANSITIONS = Object.freeze({
  not_started: new Set(["configuring"]),
  configuring: new Set(["model_ready"]),
  model_ready: new Set(["awaiting_first_loop"]),
  awaiting_first_loop: new Set(["activated"]),
  activated: new Set()
});

function nowIso() {
  return new Date().toISOString();
}

function safeToken(value, fallback = "", maxLength = 80) {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:+-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return token || fallback;
}

function safeIsoTimestamp(value, fallback = "") {
  const timestamp = String(value || "").trim();
  if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return fallback;
  return new Date(timestamp).toISOString();
}

function safeActivationEventId(value) {
  const eventId = safeToken(value, "", 120);
  return ACTIVATION_EVENT_ID_PATTERN.test(eventId) ? eventId : "";
}

function activationEventFollowsModelTest(eventId, modelTestedAt) {
  const normalizedEventId = safeActivationEventId(eventId);
  const modelTimestamp = Date.parse(modelTestedAt);
  if (!normalizedEventId || !Number.isFinite(modelTimestamp)) return false;
  try {
    const eventTimestamp = BigInt(normalizedEventId.slice(normalizedEventId.lastIndexOf("-") + 1));
    return eventTimestamp > BigInt(modelTimestamp);
  } catch {
    return false;
  }
}

function createDefaultState(timestamp) {
  const updatedAt = safeIsoTimestamp(timestamp, nowIso());
  return {
    schemaVersion: ACTIVATION_SCHEMA_VERSION,
    progress: "not_started",
    runtimeHealth: "healthy",
    provider: "",
    modelTestedAt: "",
    browserSeenAt: "",
    completionKind: "",
    completionVerified: false,
    completedAt: "",
    lastEventId: "",
    lastErrorCode: "",
    migrationAppliedAt: "",
    migrationSource: "",
    updatedAt
  };
}

function normalizeState(raw, timestamp) {
  const defaults = createDefaultState(timestamp);
  const progress = ACTIVATION_PROGRESS.includes(raw?.progress) ? raw.progress : defaults.progress;
  const runtimeHealth = RUNTIME_HEALTH.includes(raw?.runtimeHealth) ? raw.runtimeHealth : defaults.runtimeHealth;
  return {
    schemaVersion: ACTIVATION_SCHEMA_VERSION,
    progress,
    runtimeHealth,
    provider: safeToken(raw?.provider),
    modelTestedAt: safeIsoTimestamp(raw?.modelTestedAt),
    browserSeenAt: safeIsoTimestamp(raw?.browserSeenAt),
    completionKind: safeToken(raw?.completionKind),
    completionVerified: Boolean(raw?.completionVerified),
    completedAt: safeIsoTimestamp(raw?.completedAt),
    lastEventId: raw?.lastEventId === "legacy-migration" ? "legacy-migration" : safeActivationEventId(raw?.lastEventId),
    lastErrorCode: safeToken(raw?.lastErrorCode),
    migrationAppliedAt: safeIsoTimestamp(raw?.migrationAppliedAt),
    migrationSource: safeToken(raw?.migrationSource),
    updatedAt: timestamp
  };
}

function publicStatus(state) {
  return {
    schemaVersion: ACTIVATION_SCHEMA_VERSION,
    progress: state.progress,
    runtimeHealth: state.runtimeHealth,
    provider: state.provider,
    modelTestedAt: state.modelTestedAt,
    browserSeenAt: state.browserSeenAt,
    completionKind: state.completionKind,
    completionVerified: state.completionVerified,
    completedAt: state.completedAt,
    lastErrorCode: state.lastErrorCode,
    nextAction: state.runtimeHealth === "needs_repair"
      ? "repair_runtime"
      : state.progress === "awaiting_first_loop" && !state.modelTestedAt
        ? "test_model"
        : NEXT_ACTION_BY_PROGRESS[state.progress],
    privacy: {
      promptTextNotStored: true,
      draftTextNotStored: true,
      targetInputTextNotStored: true,
      clipboardTextNotStored: true,
      rawTitleNotStored: true,
      rawDomTextNotStored: true,
      apiKeyNotStored: true,
      noAutoSubmitRequired: true
    }
  };
}

function createActivationStore(dataDir, options = {}) {
  ensureDir(dataDir);
  const file = path.join(dataDir, "activation.json");
  const clock = typeof options.now === "function" ? options.now : nowIso;

  function readState() {
    const raw = readJson(file, {});
    const state = normalizeState(raw, clock());
    if (raw && typeof raw === "object" && Object.keys(raw).some((key) => !STATE_FIELDS.has(key))) {
      writeJson(file, state);
    }
    return state;
  }

  function writeState(next) {
    const state = normalizeState(next, clock());
    writeJson(file, state);
    return publicStatus(state);
  }

  function getStatus() {
    return publicStatus(readState());
  }

  function setProgress(progress, metadata = {}) {
    if (!ACTIVATION_PROGRESS.includes(progress)) {
      const error = new Error(`Unsupported activation progress: ${progress}`);
      error.code = "invalid_activation_progress";
      throw error;
    }
    const state = readState();
    if (state.progress !== progress && !PROGRESS_TRANSITIONS[state.progress]?.has(progress)) {
      const error = new Error(`Invalid activation transition: ${state.progress} -> ${progress}`);
      error.code = "invalid_activation_transition";
      throw error;
    }
    return writeState({
      ...state,
      ...metadata,
      progress,
      provider: metadata.provider === undefined ? state.provider : safeToken(metadata.provider),
      lastErrorCode: ""
    });
  }

  function recordModelReady({ provider, testedAt } = {}) {
    const state = readState();
    if (!["configuring", "model_ready", "awaiting_first_loop", "activated"].includes(state.progress)) {
      const error = new Error("Activation is not ready for a model test.");
      error.code = "activation_not_ready_for_model_test";
      throw error;
    }
    const modelTestedAt = safeIsoTimestamp(testedAt || clock());
    if (!modelTestedAt) {
      const error = new Error("Activation model test timestamp is invalid.");
      error.code = "invalid_activation_timestamp";
      throw error;
    }
    return writeState({
      ...state,
      progress: state.progress === "configuring" ? "model_ready" : state.progress,
      provider: safeToken(provider || state.provider),
      modelTestedAt,
      lastErrorCode: ""
    });
  }

  function markBrowserSeen({ site = "chatgpt", seenAt } = {}) {
    if (safeToken(site) !== "chatgpt") {
      const error = new Error("Only the ChatGPT activation target is supported in phase 3.");
      error.code = "unsupported_activation_site";
      throw error;
    }
    const state = readState();
    if (!["model_ready", "awaiting_first_loop", "activated"].includes(state.progress)) {
      const error = new Error("Activation is not ready for browser verification.");
      error.code = "activation_not_ready_for_browser_seen";
      throw error;
    }
    const browserSeenAt = safeIsoTimestamp(seenAt || clock());
    if (!browserSeenAt) {
      const error = new Error("Activation browser timestamp is invalid.");
      error.code = "invalid_activation_timestamp";
      throw error;
    }
    return writeState({
      ...state,
      progress: state.progress === "model_ready" ? "awaiting_first_loop" : state.progress,
      browserSeenAt
    });
  }

  function complete({
    eventId,
    site = "chatgpt",
    completionKind,
    targetKind = "",
    stableReadback = false,
    extensionBuildId = "",
    verified = false,
    copied = false
  } = {}) {
    const normalizedSite = safeToken(site);
    const normalizedKind = safeToken(completionKind);
    if (normalizedSite !== "chatgpt") {
      const error = new Error("Only the ChatGPT activation target is supported in phase 3.");
      error.code = "unsupported_activation_site";
      throw error;
    }
    const state = readState();
    if (state.progress === "activated") return publicStatus(state);
    if (state.progress !== "awaiting_first_loop") {
      const error = new Error("Activation requires a real first loop before completion.");
      error.code = "activation_not_ready_for_completion";
      throw error;
    }
    const normalizedEventId = safeActivationEventId(eventId);
    const eventMatchesKind = ["verified_insert", "copy"].includes(normalizedKind)
      && normalizedEventId.startsWith(`activation-${normalizedKind}-`);
    if (!normalizedEventId || !eventMatchesKind || !activationEventFollowsModelTest(normalizedEventId, state.modelTestedAt)) {
      const error = new Error("Activation completion event id is invalid.");
      error.code = "invalid_activation_event_id";
      throw error;
    }
    const currentExtension = extensionBuildId === REQUIRED_EXTENSION_BUILD_ID;
    const validInsert = currentExtension
      && normalizedKind === "verified_insert"
      && targetKind === "chatgpt-composer"
      && stableReadback === true
      && verified === true;
    const validCopy = currentExtension && normalizedKind === "copy" && copied === true;
    if (!validInsert && !validCopy) {
      const error = new Error("Activation completion evidence is not valid.");
      error.code = "invalid_activation_completion_evidence";
      throw error;
    }
    return writeState({
      ...state,
      progress: "activated",
      completionKind: normalizedKind,
      completionVerified: validInsert,
      completedAt: safeIsoTimestamp(clock(), nowIso()),
      lastEventId: normalizedEventId,
      runtimeHealth: "healthy",
      lastErrorCode: ""
    });
  }

  function setRuntimeHealth(runtimeHealth, { errorCode = "" } = {}) {
    if (!RUNTIME_HEALTH.includes(runtimeHealth)) {
      const error = new Error(`Unsupported runtime health: ${runtimeHealth}`);
      error.code = "invalid_runtime_health";
      throw error;
    }
    const state = readState();
    return writeState({
      ...state,
      runtimeHealth,
      lastErrorCode: runtimeHealth === "healthy" ? "" : safeToken(errorCode)
    });
  }

  function resetProgress() {
    const state = readState();
    return writeState({
      ...createDefaultState(clock()),
      provider: state.provider,
      migrationAppliedAt: state.migrationAppliedAt,
      migrationSource: state.migrationSource
    });
  }

  function migrateFromLegacy({ hasProvider = false, provider = "", historicalEvents = [] } = {}) {
    const state = readState();
    if (fs.existsSync(file) && (state.migrationAppliedAt || state.progress !== "not_started")) {
      return publicStatus(state);
    }

    const events = Array.isArray(historicalEvents) ? historicalEvents : [];
    const evidence = events.find((event) => {
      const source = safeToken(event?.source || event?.eventSource || event?.channel);
      if (source !== "browser-extension") return false;
      const site = safeToken(event?.site || event?.adapterId);
      if (site !== "chatgpt" && site !== "chatgpt.com") return false;
      if (event?.action === "insert") return event?.verified === true;
      if (event?.action === "copy") return event?.verified === true;
      return false;
    });
    const migratedAt = safeIsoTimestamp(clock(), nowIso());
    const normalizedProvider = safeToken(provider || state.provider);

    if (!hasProvider) {
      return writeState({
        ...state,
        progress: "configuring",
        provider: "",
        migrationAppliedAt: migratedAt,
        migrationSource: "legacy",
        lastErrorCode: ""
      });
    }

    if (evidence) {
      const completionKind = evidence.action === "insert" ? "verified_insert" : "copy";
      return writeState({
        ...state,
        progress: "activated",
        provider: normalizedProvider,
        completionKind,
        completionVerified: completionKind === "verified_insert",
        completedAt: safeIsoTimestamp(evidence.created_at || evidence.createdAt, migratedAt),
        lastEventId: "legacy-migration",
        runtimeHealth: "healthy",
        migrationAppliedAt: migratedAt,
        migrationSource: "legacy",
        lastErrorCode: ""
      });
    }

    return writeState({
      ...state,
      progress: "awaiting_first_loop",
      provider: normalizedProvider,
      migrationAppliedAt: migratedAt,
      migrationSource: "legacy",
      lastErrorCode: ""
    });
  }

  return {
    file,
    getStatus,
    setProgress,
    recordModelReady,
    markBrowserSeen,
    complete,
    setRuntimeHealth,
    resetProgress,
    migrateFromLegacy
  };
}

module.exports = {
  ACTIVATION_PROGRESS,
  ACTIVATION_SCHEMA_VERSION,
  RUNTIME_HEALTH,
  createActivationStore,
  normalizeState,
  publicStatus
};
