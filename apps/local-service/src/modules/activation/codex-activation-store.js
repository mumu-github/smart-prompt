const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CODEX_ACTIVATION_SCHEMA_VERSION = "codex-activation@2";
const PHASE3_ACTIVATION_SCHEMA_VERSION = "phase3-activation@1";
const REQUIRED_NATIVE_BUILD_ID = "phase3-native-sidecar-20260719-r18";
const CODEX_ACTIVATION_PROGRESS = Object.freeze([
  "not_started",
  "configuring",
  "model_ready",
  "awaiting_codex_loop",
  "activated"
]);
const RUNTIME_HEALTH = Object.freeze(["healthy", "repairing", "needs_repair"]);
const PHASE3_PROGRESS = Object.freeze([
  "not_started",
  "configuring",
  "model_ready",
  "awaiting_first_loop",
  "activated"
]);
const PHASE3_COMPLETION_KINDS = Object.freeze(["", "verified_insert", "copy"]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACTIVATION_EVENT_ID_PATTERN = /^activation-verified_insert-\d{10,16}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_.:+-]{0,79}$/i;
const STATE_FIELDS = new Set([
  "schemaVersion",
  "progress",
  "runtimeHealth",
  "provider",
  "modelTestedAt",
  "legacyActivated",
  "legacySummary",
  "codexVerified",
  "completedAt",
  "completionEventId",
  "completionSignature",
  "migrationAppliedAt",
  "migrationSource",
  "updatedAt"
]);

const PROGRESS_TRANSITIONS = Object.freeze({
  not_started: new Set(["configuring"]),
  configuring: new Set(["model_ready"]),
  model_ready: new Set(["awaiting_codex_loop"]),
  awaiting_codex_loop: new Set(),
  activated: new Set()
});

const STATUS_BY_PROGRESS = Object.freeze({
  not_started: Object.freeze({
    reason: "codex_activation_not_started",
    nextAction: "configure_provider"
  }),
  configuring: Object.freeze({
    reason: "provider_configuration_required",
    nextAction: "test_model"
  }),
  model_ready: Object.freeze({
    reason: "model_ready_codex_verification_required",
    nextAction: "start_codex_loop"
  }),
  awaiting_codex_loop: Object.freeze({
    reason: "codex_verification_required",
    nextAction: "complete_codex_loop"
  }),
  activated: Object.freeze({
    reason: "codex_activation_complete",
    nextAction: "open_assistant"
  })
});

const STATUS_BY_RUNTIME_HEALTH = Object.freeze({
  repairing: Object.freeze({
    reason: "runtime_repairing",
    nextAction: "wait_for_runtime"
  }),
  needs_repair: Object.freeze({
    reason: "runtime_needs_repair",
    nextAction: "repair_runtime"
  })
});

const PRIVACY_STATUS = Object.freeze({
  promptTextNotStored: true,
  draftTextNotStored: true,
  targetInputTextNotStored: true,
  clipboardTextNotStored: true,
  projectPathNotStored: true,
  rawTitleNotStored: true,
  apiKeyNotStored: true,
  evidencePayloadNotExposed: true,
  noAutoSubmitRequired: true
});

function nowIso() {
  return new Date().toISOString();
}

function activationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeIsoTimestamp(value, fallback = "") {
  const timestamp = String(value || "").trim();
  if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return fallback;
  return new Date(timestamp).toISOString();
}

function safeProviderToken(value, fallback = "") {
  const token = String(value || "").trim();
  return PROVIDER_TOKEN_PATTERN.test(token) ? token : fallback;
}

function safeActivationEventId(value) {
  const eventId = String(value || "").trim();
  return ACTIVATION_EVENT_ID_PATTERN.test(eventId) ? eventId : "";
}

function eventFollowsModelTest(eventId, modelTestedAt) {
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

function safeLegacySummary(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const progress = PHASE3_PROGRESS.includes(raw.progress) ? raw.progress : "not_started";
  const runtimeHealth = RUNTIME_HEALTH.includes(raw.runtimeHealth) ? raw.runtimeHealth : "healthy";
  const completionKind = PHASE3_COMPLETION_KINDS.includes(raw.completionKind)
    ? raw.completionKind
    : "";
  return {
    schemaVersion: PHASE3_ACTIVATION_SCHEMA_VERSION,
    progress,
    runtimeHealth,
    completionKind,
    completionVerified: completionKind === "verified_insert" && raw.completionVerified === true,
    completedAt: safeIsoTimestamp(raw.completedAt)
  };
}

function legacySummaryFromPhase3(snapshot) {
  return safeLegacySummary({
    progress: snapshot.progress,
    runtimeHealth: snapshot.runtimeHealth,
    completionKind: snapshot.completionKind,
    completionVerified: snapshot.completionVerified,
    completedAt: snapshot.completedAt
  });
}

function createDefaultState(timestamp = nowIso()) {
  const updatedAt = safeIsoTimestamp(timestamp, nowIso());
  return {
    schemaVersion: CODEX_ACTIVATION_SCHEMA_VERSION,
    progress: "not_started",
    runtimeHealth: "healthy",
    provider: "",
    modelTestedAt: "",
    legacyActivated: false,
    legacySummary: null,
    codexVerified: false,
    completedAt: "",
    completionEventId: "",
    completionSignature: "",
    migrationAppliedAt: "",
    migrationSource: "",
    updatedAt
  };
}

function normalizeCodexActivationState(raw, timestamp = nowIso()) {
  const defaults = createDefaultState(timestamp);
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  let progress = CODEX_ACTIVATION_PROGRESS.includes(source.progress)
    ? source.progress
    : defaults.progress;
  const runtimeHealth = RUNTIME_HEALTH.includes(source.runtimeHealth)
    ? source.runtimeHealth
    : defaults.runtimeHealth;
  const provider = safeProviderToken(source.provider);
  const modelTestedAt = safeIsoTimestamp(source.modelTestedAt);
  const legacySummary = safeLegacySummary(source.legacySummary);
  const completionEventId = safeActivationEventId(source.completionEventId);
  const completionSignature = SHA256_PATTERN.test(String(source.completionSignature || ""))
    ? source.completionSignature
    : "";
  const completedAt = safeIsoTimestamp(source.completedAt);
  const hasValidCompletion = progress === "activated"
    && source.codexVerified === true
    && Boolean(completedAt)
    && Boolean(completionSignature)
    && eventFollowsModelTest(completionEventId, modelTestedAt);

  if (progress === "activated" && !hasValidCompletion) {
    progress = modelTestedAt ? "model_ready" : provider ? "configuring" : "not_started";
  }

  return {
    schemaVersion: CODEX_ACTIVATION_SCHEMA_VERSION,
    progress,
    runtimeHealth,
    provider,
    modelTestedAt,
    legacyActivated: legacySummary?.progress === "activated",
    legacySummary,
    codexVerified: hasValidCompletion,
    completedAt: hasValidCompletion ? completedAt : "",
    completionEventId: hasValidCompletion ? completionEventId : "",
    completionSignature: hasValidCompletion ? completionSignature : "",
    migrationAppliedAt: safeIsoTimestamp(source.migrationAppliedAt),
    migrationSource: source.migrationSource === "phase3-public-snapshot"
      ? "phase3-public-snapshot"
      : "",
    updatedAt: safeIsoTimestamp(source.updatedAt, defaults.updatedAt)
  };
}

function publicCodexActivationStatus(state) {
  const statusTokens = STATUS_BY_RUNTIME_HEALTH[state.runtimeHealth]
    || STATUS_BY_PROGRESS[state.progress]
    || STATUS_BY_PROGRESS.not_started;
  return {
    schemaVersion: CODEX_ACTIVATION_SCHEMA_VERSION,
    progress: state.progress,
    runtimeHealth: state.runtimeHealth,
    provider: state.provider,
    modelTestedAt: state.modelTestedAt,
    legacyActivated: state.legacyActivated,
    legacySummary: state.legacySummary ? { ...state.legacySummary } : null,
    codexVerified: state.codexVerified,
    completedAt: state.completedAt,
    reason: statusTokens.reason,
    nextAction: statusTokens.nextAction,
    privacy: { ...PRIVACY_STATUS }
  };
}

function completionEvidence(payload = {}) {
  const target = safeProviderToken(payload.target);
  const site = safeProviderToken(payload.site);
  return {
    eventId: safeActivationEventId(payload.eventId),
    rawEventIdPresent: String(payload.eventId || "").trim().length > 0,
    target: target || site,
    site,
    targetConflict: Boolean(target && site && target !== site),
    completionKind: String(payload.completionKind || "").trim(),
    targetKind: String(payload.targetKind || "").trim(),
    stableReadback: payload.stableReadback === true,
    verified: payload.verified === true,
    noAutoSubmit: payload.noAutoSubmit === true,
    nativeBuildId: String(payload.nativeBuildId || "").trim()
  };
}

function completionSignature(evidence) {
  const canonical = JSON.stringify({
    eventId: evidence.eventId,
    target: evidence.target,
    site: evidence.site,
    targetConflict: evidence.targetConflict,
    completionKind: evidence.completionKind,
    targetKind: evidence.targetKind,
    stableReadback: evidence.stableReadback,
    verified: evidence.verified,
    noAutoSubmit: evidence.noAutoSubmit,
    nativeBuildId: evidence.nativeBuildId
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function validCodexCompletionEvidence(evidence) {
  return evidence.target === "codex"
    && (evidence.site === "" || evidence.site === "codex")
    && evidence.targetConflict === false
    && evidence.completionKind === "verified_insert"
    && evidence.targetKind === "codex-composer"
    && evidence.stableReadback === true
    && evidence.verified === true
    && evidence.noAutoSubmit === true
    && evidence.nativeBuildId === REQUIRED_NATIVE_BUILD_ID;
}

function createCodexActivationStore(dataDir, options = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "activation-v2.json");
  const clock = typeof options.now === "function" ? options.now : nowIso;

  function clockIso() {
    return safeIsoTimestamp(clock(), nowIso());
  }

  function writeRawState(state) {
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  function readState() {
    let raw = null;
    let parsed = false;
    try {
      if (fs.existsSync(file)) {
        raw = JSON.parse(fs.readFileSync(file, "utf8"));
        parsed = true;
      }
    } catch {
      raw = null;
    }
    const state = normalizeCodexActivationState(raw, clockIso());
    const hasOnlyStateFields = parsed
      && raw
      && typeof raw === "object"
      && !Array.isArray(raw)
      && Object.keys(raw).every((key) => STATE_FIELDS.has(key));
    if (!hasOnlyStateFields || JSON.stringify(raw) !== JSON.stringify(state)) {
      writeRawState(state);
    }
    return state;
  }

  function writeState(next) {
    const timestamp = clockIso();
    const state = normalizeCodexActivationState({
      ...next,
      updatedAt: timestamp
    }, timestamp);
    writeRawState(state);
    return publicCodexActivationStatus(state);
  }

  function getStatus() {
    return publicCodexActivationStatus(readState());
  }

  function initializeFromPhase3(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw activationError(
        "invalid_phase3_activation_snapshot",
        "A phase 3 public activation snapshot is required."
      );
    }
    if (snapshot.schemaVersion && snapshot.schemaVersion !== PHASE3_ACTIVATION_SCHEMA_VERSION) {
      throw activationError(
        "invalid_phase3_activation_snapshot",
        "The activation snapshot schema is not supported."
      );
    }

    const state = readState();
    const hasCodexProgress = state.progress !== "not_started"
      || Boolean(state.provider)
      || Boolean(state.modelTestedAt)
      || state.codexVerified;
    if (state.migrationAppliedAt || hasCodexProgress) return publicCodexActivationStatus(state);

    const provider = safeProviderToken(snapshot.provider);
    const modelTestedAt = safeIsoTimestamp(snapshot.modelTestedAt);
    const legacySummary = legacySummaryFromPhase3(snapshot);
    const runtimeHealth = RUNTIME_HEALTH.includes(snapshot.runtimeHealth)
      ? snapshot.runtimeHealth
      : "healthy";
    const progress = modelTestedAt ? "model_ready" : provider ? "configuring" : "not_started";
    const migratedAt = clockIso();
    return writeState({
      ...createDefaultState(migratedAt),
      progress,
      runtimeHealth,
      provider,
      modelTestedAt,
      legacyActivated: legacySummary.progress === "activated",
      legacySummary,
      migrationAppliedAt: migratedAt,
      migrationSource: "phase3-public-snapshot"
    });
  }

  function setProgress(progress, metadata = {}) {
    if (!CODEX_ACTIVATION_PROGRESS.includes(progress)) {
      throw activationError(
        "invalid_codex_activation_progress",
        "The Codex activation progress token is not supported."
      );
    }
    const state = readState();
    if (progress === "activated") {
      if (state.progress === "activated") return publicCodexActivationStatus(state);
      throw activationError(
        "invalid_codex_activation_transition",
        "Codex activation can only complete from verified evidence."
      );
    }
    if (state.progress !== progress && !PROGRESS_TRANSITIONS[state.progress]?.has(progress)) {
      throw activationError(
        "invalid_codex_activation_transition",
        "The requested Codex activation transition is not allowed."
      );
    }

    const provider = metadata.provider === undefined
      ? state.provider
      : safeProviderToken(metadata.provider, state.provider);
    let modelTestedAt = state.modelTestedAt;
    if (progress === "model_ready") {
      modelTestedAt = safeIsoTimestamp(metadata.modelTestedAt || metadata.testedAt, modelTestedAt);
      if (!modelTestedAt) {
        throw activationError(
          "activation_model_test_required",
          "A successful model test timestamp is required before Codex verification."
        );
      }
    }
    if (progress === "awaiting_codex_loop" && !modelTestedAt) {
      throw activationError(
        "activation_model_test_required",
        "A successful model test is required before the Codex loop."
      );
    }
    return writeState({
      ...state,
      progress,
      provider,
      modelTestedAt
    });
  }

  function recordModelReady({ provider, testedAt } = {}) {
    const state = readState();
    if (state.progress === "activated") return publicCodexActivationStatus(state);
    if (!["configuring", "model_ready", "awaiting_codex_loop"].includes(state.progress)) {
      throw activationError(
        "activation_not_ready_for_model_test",
        "Codex activation is not ready for a model test."
      );
    }
    const modelTestedAt = safeIsoTimestamp(testedAt || clockIso());
    if (!modelTestedAt) {
      throw activationError(
        "invalid_activation_timestamp",
        "The model test timestamp is invalid."
      );
    }
    return writeState({
      ...state,
      progress: "model_ready",
      provider: provider === undefined ? state.provider : safeProviderToken(provider, state.provider),
      modelTestedAt
    });
  }

  function markCodexLoopStarted() {
    const state = readState();
    if (state.progress === "activated") return publicCodexActivationStatus(state);
    if (!["model_ready", "awaiting_codex_loop"].includes(state.progress) || !state.modelTestedAt) {
      throw activationError(
        "activation_not_ready_for_codex_loop",
        "Codex activation requires a successful model test first."
      );
    }
    if (state.progress === "awaiting_codex_loop") return publicCodexActivationStatus(state);
    return writeState({
      ...state,
      progress: "awaiting_codex_loop"
    });
  }

  function complete(payload = {}) {
    const state = readState();
    const evidence = completionEvidence(payload);
    const signature = completionSignature(evidence);

    if (state.progress === "activated" && state.codexVerified) {
      if (state.completionEventId === evidence.eventId && state.completionSignature === signature) {
        return publicCodexActivationStatus(state);
      }
      throw activationError(
        "activation_completion_conflict",
        "Codex activation has already completed with different evidence."
      );
    }
    if (state.progress !== "awaiting_codex_loop") {
      throw activationError(
        "activation_not_ready_for_completion",
        "Codex activation is not ready for completion."
      );
    }
    if (!evidence.eventId || !evidence.rawEventIdPresent
      || !eventFollowsModelTest(evidence.eventId, state.modelTestedAt)) {
      throw activationError(
        "invalid_activation_event_id",
        "The Codex activation event id is invalid or stale."
      );
    }
    if (!validCodexCompletionEvidence(evidence)) {
      throw activationError(
        "invalid_codex_activation_evidence",
        "Codex activation requires verified safe insertion evidence."
      );
    }

    return writeState({
      ...state,
      progress: "activated",
      codexVerified: true,
      completedAt: clockIso(),
      completionEventId: evidence.eventId,
      completionSignature: signature
    });
  }

  function setRuntimeHealth(runtimeHealth) {
    if (!RUNTIME_HEALTH.includes(runtimeHealth)) {
      throw activationError(
        "invalid_runtime_health",
        "The runtime health token is not supported."
      );
    }
    const state = readState();
    return writeState({
      ...state,
      runtimeHealth
    });
  }

  function resetProgress() {
    const state = readState();
    return writeState({
      ...createDefaultState(clockIso()),
      runtimeHealth: state.runtimeHealth,
      provider: state.provider,
      legacyActivated: state.legacyActivated,
      legacySummary: state.legacySummary,
      migrationAppliedAt: state.migrationAppliedAt,
      migrationSource: state.migrationSource
    });
  }

  if (!fs.existsSync(file)) {
    writeRawState(createDefaultState(clockIso()));
  } else {
    readState();
  }
  if (Object.hasOwn(options, "phase3Snapshot") && options.phase3Snapshot !== undefined) {
    initializeFromPhase3(options.phase3Snapshot);
  }

  return {
    file,
    getStatus,
    setProgress,
    recordModelReady,
    markCodexLoopStarted,
    beginCodexLoop: markCodexLoopStarted,
    complete,
    completeCodexActivation: complete,
    setRuntimeHealth,
    resetProgress,
    reset: resetProgress,
    initializeFromPhase3,
    migrateFromPhase3: initializeFromPhase3
  };
}

module.exports = {
  ACTIVATION_PROGRESS: CODEX_ACTIVATION_PROGRESS,
  ACTIVATION_SCHEMA_VERSION: CODEX_ACTIVATION_SCHEMA_VERSION,
  CODEX_ACTIVATION_PROGRESS,
  CODEX_ACTIVATION_SCHEMA_VERSION,
  PHASE3_ACTIVATION_SCHEMA_VERSION,
  REQUIRED_NATIVE_BUILD_ID,
  RUNTIME_HEALTH,
  createCodexActivationStore,
  normalizeCodexActivationState,
  publicCodexActivationStatus
};
