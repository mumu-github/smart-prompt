"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  CONTRACTS,
  CONTRACT_VERSIONS,
  DEFAULT_PRIVACY_FLAGS,
  ENUMS,
  assertValidContract,
  findPrivacyViolations
} = require("../../../../../packages/outcome-learning");

const STORE_SCHEMA_VERSION = "pending-outcome-store@1";
const FEEDBACK_DELAY_MS = 60 * 1000;
const OUTCOME_TTL_MS = 24 * 60 * 60 * 1000;
const IMPLICIT_SIGNAL_TYPES = Object.freeze(["retry", "undo", "regenerated", "insert_failed"]);
const FAILURE_REASON_TOKENS = Object.freeze([...ENUMS.outcomeFailureReason]);
const FEEDBACK_STATES = Object.freeze(["unasked", "asked", "reason_required", "resolved", "expired", "invalidated"]);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function outcomeError(code, message, details = []) {
  const error = new Error(message);
  error.code = code;
  if (details.length) error.details = clone(details);
  return error;
}

function assertPrivacySafe(value) {
  const violations = findPrivacyViolations(value);
  if (!violations.length) return;
  throw outcomeError(
    "outcome_privacy_violation",
    "Outcome data contains a forbidden raw or sensitive field.",
    violations.map(({ code, path: violationPath }) => ({ code, path: violationPath }))
  );
}

function assertOnlyKeys(value, allowedKeys, code = "invalid_outcome_request") {
  if (!isPlainObject(value)) {
    throw outcomeError(code, "Outcome request must be an object.");
  }
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw outcomeError(code, "Outcome request contains unsupported fields.", unknown.map((key) => ({
      code: "unknown_field",
      path: `$.${key}`
    })));
  }
}

function assertToken(value, field, options = {}) {
  const { nullable = false } = options;
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    throw outcomeError("invalid_outcome_token", `${field} must be a bounded opaque token.`);
  }
  return value;
}

function resolveRequestId(input, names) {
  const supplied = names
    .filter((name) => input[name] !== undefined)
    .map((name) => input[name]);
  if (supplied.length === 0) {
    throw outcomeError("outcome_idempotency_key_required", "An idempotency key is required.");
  }
  const id = assertToken(supplied[0], names[0]);
  if (supplied.some((value) => value !== id)) {
    throw outcomeError("outcome_idempotency_conflict", "Conflicting idempotency keys were provided.");
  }
  return id;
}

function toIso(value, code = "invalid_outcome_clock") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw outcomeError(code, "A valid clock timestamp is required.");
  }
  return date.toISOString();
}

function addMilliseconds(timestamp, milliseconds) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertContract(contract, value, code) {
  assertPrivacySafe(value);
  try {
    return clone(assertValidContract(contract, value));
  } catch (error) {
    const details = Array.isArray(error?.errors)
      ? error.errors.map(({ code: errorCode, path: errorPath }) => ({ code: errorCode, path: errorPath }))
      : [];
    throw outcomeError(code, `Invalid ${contract} contract.`, details);
  }
}

function createPendingOutcome(event) {
  const createdAt = event.occurredAt;
  return assertContract(CONTRACTS.PENDING_OUTCOME, {
    contractVersion: CONTRACT_VERSIONS[CONTRACTS.PENDING_OUTCOME],
    outcomeId: event.outcomeId,
    generationId: event.generationId,
    sessionId: event.sessionId,
    strategyId: event.strategyId,
    strategyVersion: event.strategyVersion,
    target: event.target,
    projectScopeToken: event.projectScopeToken,
    modelFamilyToken: event.modelFamilyToken,
    createdAt,
    eligibleAt: addMilliseconds(createdAt, FEEDBACK_DELAY_MS),
    expiresAt: addMilliseconds(createdAt, OUTCOME_TTL_MS),
    status: "unknown",
    insertVerified: true,
    policyId: event.policyId,
    policyVersion: event.policyVersion,
    feedbackPromptedAt: null,
    failureReasonTokens: [],
    privacyFlags: clone(DEFAULT_PRIVACY_FLAGS)
  }, "invalid_pending_outcome");
}

function defaultState() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    outcomes: [],
    implicitSignals: [],
    eventReceipts: [],
    askReceipts: [],
    feedbackReceipts: []
  };
}

function assertUnique(items, selector, label) {
  const values = items.map(selector);
  if (new Set(values).size !== values.length) {
    throw outcomeError("pending_outcome_store_corrupt", `${label} contains duplicate identifiers.`);
  }
}

function validateOutcomeEntry(entry) {
  assertOnlyKeys(entry, ["outcome", "feedbackState"], "pending_outcome_store_corrupt");
  const outcome = assertContract(
    CONTRACTS.PENDING_OUTCOME,
    entry.outcome,
    "pending_outcome_store_corrupt"
  );
  if (!FEEDBACK_STATES.includes(entry.feedbackState)) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored feedback state is invalid.");
  }
  const prompted = outcome.feedbackPromptedAt !== null;
  const valid = (
    (entry.feedbackState === "unasked" && outcome.status === "unknown" && !prompted)
    || (["asked", "reason_required"].includes(entry.feedbackState) && outcome.status === "unknown" && prompted)
    || (entry.feedbackState === "resolved" && ["succeeded", "failed"].includes(outcome.status) && prompted)
    || (entry.feedbackState === "expired" && outcome.status === "expired_unknown")
    || (entry.feedbackState === "invalidated" && outcome.status === "invalidated")
  );
  if (!valid) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored outcome and feedback states are inconsistent.");
  }
  return { outcome, feedbackState: entry.feedbackState };
}

function validateEventReceipt(receipt) {
  assertOnlyKeys(receipt, ["id", "digest", "kind", "outcomeId"], "pending_outcome_store_corrupt");
  assertToken(receipt.id, "event receipt id");
  if (!DIGEST_PATTERN.test(receipt.digest || "")) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored event digest is invalid.");
  }
  if (!["pending_outcome", "implicit_signal"].includes(receipt.kind)) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored event receipt kind is invalid.");
  }
  assertToken(receipt.outcomeId, "event receipt outcome id", { nullable: true });
  return clone(receipt);
}

function validateAskReceipt(receipt) {
  assertOnlyKeys(
    receipt,
    ["id", "digest", "outcomeId", "feedbackPromptedAt"],
    "pending_outcome_store_corrupt"
  );
  assertToken(receipt.id, "ask receipt id");
  if (!DIGEST_PATTERN.test(receipt.digest || "")) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored ask digest is invalid.");
  }
  assertToken(receipt.outcomeId, "ask receipt outcome id", { nullable: true });
  if (receipt.outcomeId === null && receipt.feedbackPromptedAt !== null) {
    throw outcomeError("pending_outcome_store_corrupt", "Empty ask receipts cannot have a prompt timestamp.");
  }
  if (receipt.feedbackPromptedAt !== null) toIso(receipt.feedbackPromptedAt, "pending_outcome_store_corrupt");
  return clone(receipt);
}

function validateFeedbackReceipt(receipt) {
  assertOnlyKeys(
    receipt,
    ["id", "digest", "outcomeId", "resultState", "outcomeStatus", "failureReasonTokens"],
    "pending_outcome_store_corrupt"
  );
  assertToken(receipt.id, "feedback receipt id");
  assertToken(receipt.outcomeId, "feedback receipt outcome id");
  if (!DIGEST_PATTERN.test(receipt.digest || "")) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored feedback digest is invalid.");
  }
  if (!["reason_required", "completed", "not_completed"].includes(receipt.resultState)) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored feedback result is invalid.");
  }
  if (!["unknown", "succeeded", "failed"].includes(receipt.outcomeStatus)) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored feedback outcome status is invalid.");
  }
  if (!Array.isArray(receipt.failureReasonTokens)
    || receipt.failureReasonTokens.some((token) => !FAILURE_REASON_TOKENS.includes(token))) {
    throw outcomeError("pending_outcome_store_corrupt", "Stored feedback reasons are invalid.");
  }
  return clone(receipt);
}

function validateState(raw) {
  assertPrivacySafe(raw);
  assertOnlyKeys(
    raw,
    ["schemaVersion", "outcomes", "implicitSignals", "eventReceipts", "askReceipts", "feedbackReceipts"],
    "pending_outcome_store_corrupt"
  );
  if (raw.schemaVersion !== STORE_SCHEMA_VERSION) {
    throw outcomeError("pending_outcome_store_corrupt", "Pending outcome store version is unsupported.");
  }
  for (const key of ["outcomes", "implicitSignals", "eventReceipts", "askReceipts", "feedbackReceipts"]) {
    if (!Array.isArray(raw[key])) {
      throw outcomeError("pending_outcome_store_corrupt", `Stored ${key} must be an array.`);
    }
  }

  const state = {
    schemaVersion: STORE_SCHEMA_VERSION,
    outcomes: raw.outcomes.map(validateOutcomeEntry),
    implicitSignals: raw.implicitSignals.map((event) => {
      const canonical = assertContract(
        CONTRACTS.PROMPT_SESSION_EVENT,
        event,
        "pending_outcome_store_corrupt"
      );
      if (!IMPLICIT_SIGNAL_TYPES.includes(canonical.eventType)) {
        throw outcomeError("pending_outcome_store_corrupt", "Stored implicit signal type is invalid.");
      }
      return canonical;
    }),
    eventReceipts: raw.eventReceipts.map(validateEventReceipt),
    askReceipts: raw.askReceipts.map(validateAskReceipt),
    feedbackReceipts: raw.feedbackReceipts.map(validateFeedbackReceipt)
  };
  assertUnique(state.outcomes, (entry) => entry.outcome.outcomeId, "Stored outcomes");
  assertUnique(state.implicitSignals, (event) => event.eventId, "Stored implicit signals");
  assertUnique(state.eventReceipts, (receipt) => receipt.id, "Stored event receipts");
  assertUnique(state.askReceipts, (receipt) => receipt.id, "Stored ask receipts");
  assertUnique(state.feedbackReceipts, (receipt) => receipt.id, "Stored feedback receipts");
  return state;
}

function createPendingOutcomeStore(dataDir, options = {}) {
  if (typeof dataDir !== "string" || dataDir.trim() === "") {
    throw outcomeError("invalid_outcome_data_dir", "A data directory is required.");
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "pending-outcomes-v1.json");
  const clock = typeof options.now === "function" ? options.now : () => new Date();

  function clockIso() {
    return toIso(clock());
  }

  function writeState(state) {
    const validated = validateState(state);
    fs.writeFileSync(file, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    return validated;
  }

  function readState() {
    try {
      return validateState(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (error) {
      if (error?.code) throw error;
      throw outcomeError("pending_outcome_store_corrupt", "Pending outcome state could not be read.");
    }
  }

  function expireState(state, timestamp) {
    const nowMs = Date.parse(timestamp);
    const expired = [];
    for (const entry of state.outcomes) {
      if (entry.outcome.status !== "unknown" || nowMs < Date.parse(entry.outcome.expiresAt)) continue;
      entry.outcome = assertContract(CONTRACTS.PENDING_OUTCOME, {
        ...entry.outcome,
        status: "expired_unknown",
        failureReasonTokens: []
      }, "invalid_pending_outcome");
      entry.feedbackState = "expired";
      expired.push(entry.outcome.outcomeId);
    }
    return expired;
  }

  function readCurrentState() {
    const state = readState();
    const expired = expireState(state, clockIso());
    if (expired.length) writeState(state);
    return state;
  }

  function findOutcomeEntry(state, outcomeId) {
    return state.outcomes.find((entry) => entry.outcome.outcomeId === outcomeId) || null;
  }

  function eventResult(state, receipt, duplicate) {
    if (receipt.kind === "pending_outcome") {
      const entry = findOutcomeEntry(state, receipt.outcomeId);
      return {
        kind: "pending_outcome",
        created: false,
        duplicate,
        outcome: clone(entry?.outcome || null)
      };
    }
    const signal = state.implicitSignals.find((event) => event.eventId === receipt.id) || null;
    return {
      kind: "implicit_signal",
      recorded: false,
      duplicate,
      signal: clone(signal)
    };
  }

  function recordPromptSessionEvent(input) {
    const event = assertContract(
      CONTRACTS.PROMPT_SESSION_EVENT,
      input,
      "invalid_prompt_session_event"
    );
    if (event.eventType !== "verified_insert" && !IMPLICIT_SIGNAL_TYPES.includes(event.eventType)) {
      throw outcomeError("unsupported_outcome_event", "This event type is not handled by the pending outcome store.");
    }

    const state = readCurrentState();
    const eventDigest = digest(event);
    const priorReceipt = state.eventReceipts.find((receipt) => receipt.id === event.eventId);
    if (priorReceipt) {
      if (priorReceipt.digest !== eventDigest) {
        throw outcomeError("outcome_idempotency_conflict", "The event id was already used with different data.");
      }
      return eventResult(state, priorReceipt, true);
    }

    if (event.eventType === "verified_insert") {
      const pending = createPendingOutcome(event);
      const existing = findOutcomeEntry(state, pending.outcomeId);
      let created = false;
      if (existing) {
        const originalPending = {
          ...existing.outcome,
          status: "unknown",
          feedbackPromptedAt: null,
          failureReasonTokens: []
        };
        if (digest(originalPending) !== digest(pending)) {
          throw outcomeError("outcome_idempotency_conflict", "The outcome id was already used with different data.");
        }
      } else {
        state.outcomes.push({ outcome: pending, feedbackState: "unasked" });
        created = true;
      }
      state.eventReceipts.push({
        id: event.eventId,
        digest: eventDigest,
        kind: "pending_outcome",
        outcomeId: pending.outcomeId
      });
      writeState(state);
      return { kind: "pending_outcome", created, duplicate: false, outcome: clone(pending) };
    }

    state.implicitSignals.push(event);
    state.eventReceipts.push({
      id: event.eventId,
      digest: eventDigest,
      kind: "implicit_signal",
      outcomeId: event.outcomeId
    });
    writeState(state);
    return { kind: "implicit_signal", recorded: true, duplicate: false, signal: clone(event) };
  }

  function recordVerifiedInsert(event) {
    if (event?.eventType !== "verified_insert") {
      throw outcomeError("verified_insert_required", "Only a verified_insert event can create an outcome.");
    }
    return recordPromptSessionEvent(event);
  }

  function recordImplicitSignal(event) {
    if (!IMPLICIT_SIGNAL_TYPES.includes(event?.eventType)) {
      throw outcomeError("implicit_signal_required", "The event is not a supported implicit signal.");
    }
    return recordPromptSessionEvent(event);
  }

  function askResponseFromReceipt(state, receipt) {
    if (receipt.outcomeId === null) return { state: "none", outcome: null };
    const entry = findOutcomeEntry(state, receipt.outcomeId);
    if (!entry) {
      throw outcomeError("pending_outcome_store_corrupt", "An ask receipt references a missing outcome.");
    }
    return {
      state: "question",
      outcome: clone({
        ...entry.outcome,
        status: "unknown",
        feedbackPromptedAt: receipt.feedbackPromptedAt,
        failureReasonTokens: []
      })
    };
  }

  function claimNextFeedback(input = {}) {
    assertPrivacySafe(input);
    assertOnlyKeys(input, ["askId", "requestId", "eventId", "target", "projectScopeToken"]);
    const askId = resolveRequestId(input, ["askId", "requestId", "eventId"]);
    const target = assertToken(input.target, "target");
    const projectScopeToken = assertToken(input.projectScopeToken, "projectScopeToken");
    if (target !== "codex") {
      throw outcomeError("invalid_outcome_target", "Pending outcome feedback is limited to Codex.");
    }
    const requestDigest = digest({ target, projectScopeToken });
    const state = readCurrentState();
    const priorReceipt = state.askReceipts.find((receipt) => receipt.id === askId);
    if (priorReceipt) {
      if (priorReceipt.digest !== requestDigest) {
        throw outcomeError("outcome_idempotency_conflict", "The ask id was already used for another queue.");
      }
      return askResponseFromReceipt(state, priorReceipt);
    }

    const timestamp = clockIso();
    const nowMs = Date.parse(timestamp);
    const candidate = state.outcomes
      .filter((entry) => entry.outcome.target === target
        && entry.outcome.projectScopeToken === projectScopeToken
        && entry.outcome.status === "unknown"
        && entry.feedbackState === "unasked"
        && entry.outcome.feedbackPromptedAt === null
        && Date.parse(entry.outcome.eligibleAt) <= nowMs
        && nowMs < Date.parse(entry.outcome.expiresAt))
      .sort((left, right) => {
        const timeOrder = Date.parse(right.outcome.createdAt) - Date.parse(left.outcome.createdAt);
        return timeOrder || right.outcome.outcomeId.localeCompare(left.outcome.outcomeId);
      })[0] || null;

    if (candidate) {
      candidate.outcome = assertContract(CONTRACTS.PENDING_OUTCOME, {
        ...candidate.outcome,
        feedbackPromptedAt: timestamp
      }, "invalid_pending_outcome");
      candidate.feedbackState = "asked";
    }
    const receipt = {
      id: askId,
      digest: requestDigest,
      outcomeId: candidate?.outcome.outcomeId || null,
      feedbackPromptedAt: candidate?.outcome.feedbackPromptedAt || null
    };
    state.askReceipts.push(receipt);
    writeState(state);
    return askResponseFromReceipt(state, receipt);
  }

  function feedbackResponse(entry, resultState, outcomeOverride = null) {
    return {
      state: resultState,
      outcome: clone(outcomeOverride || entry.outcome),
      failureReasonTokens: resultState === "reason_required" ? [...FAILURE_REASON_TOKENS] : []
    };
  }

  function feedbackResponseFromReceipt(state, receipt) {
    const entry = findOutcomeEntry(state, receipt.outcomeId);
    if (!entry) {
      throw outcomeError("pending_outcome_store_corrupt", "A feedback receipt references a missing outcome.");
    }
    if (entry.outcome.status === "invalidated" || entry.feedbackState === "invalidated") {
      return feedbackResponse(entry, "invalidated");
    }
    const snapshot = {
      ...entry.outcome,
      status: receipt.outcomeStatus,
      failureReasonTokens: [...receipt.failureReasonTokens]
    };
    return feedbackResponse(entry, receipt.resultState, snapshot);
  }

  function submitOutcomeFeedback(input = {}) {
    assertPrivacySafe(input);
    assertOnlyKeys(input, [
      "feedbackId",
      "requestId",
      "eventId",
      "outcomeId",
      "taskOutcomeToken",
      "outcome",
      "reasonToken",
      "failureReasonToken"
    ]);
    const feedbackId = resolveRequestId(input, ["feedbackId", "requestId", "eventId"]);
    const outcomeId = assertToken(input.outcomeId, "outcomeId");
    const taskOutcomeToken = input.taskOutcomeToken ?? input.outcome;
    if (!["completed", "not_completed"].includes(taskOutcomeToken)) {
      throw outcomeError("invalid_task_outcome", "Feedback must be completed or not_completed.");
    }
    if (input.taskOutcomeToken !== undefined && input.outcome !== undefined
      && input.taskOutcomeToken !== input.outcome) {
      throw outcomeError("outcome_idempotency_conflict", "Conflicting outcome tokens were provided.");
    }
    const suppliedReasons = [input.reasonToken, input.failureReasonToken].filter((value) => value !== undefined);
    if (suppliedReasons.length > 1 && suppliedReasons.some((value) => value !== suppliedReasons[0])) {
      throw outcomeError("outcome_idempotency_conflict", "Conflicting failure reasons were provided.");
    }
    const reasonToken = suppliedReasons[0] ?? null;
    if (reasonToken !== null) assertToken(reasonToken, "reasonToken");

    const requestDigest = digest({ outcomeId, taskOutcomeToken, reasonToken });
    const state = readCurrentState();
    const priorReceipt = state.feedbackReceipts.find((receipt) => receipt.id === feedbackId);
    if (priorReceipt) {
      if (priorReceipt.digest !== requestDigest) {
        throw outcomeError("outcome_idempotency_conflict", "The feedback id was already used with different data.");
      }
      return feedbackResponseFromReceipt(state, priorReceipt);
    }

    const entry = findOutcomeEntry(state, outcomeId);
    if (!entry) throw outcomeError("pending_outcome_not_found", "Pending outcome was not found.");
    if (entry.outcome.status === "expired_unknown") {
      throw outcomeError("pending_outcome_expired", "Expired outcomes cannot accept feedback.");
    }
    if (entry.outcome.status !== "unknown") {
      const sameCompleted = taskOutcomeToken === "completed" && entry.outcome.status === "succeeded" && reasonToken === null;
      const sameFailed = taskOutcomeToken === "not_completed"
        && entry.outcome.status === "failed"
        && (reasonToken === null || entry.outcome.failureReasonTokens[0] === reasonToken);
      if (!sameCompleted && !sameFailed) {
        throw outcomeError("outcome_feedback_conflict", "Outcome feedback has already been finalized.");
      }
      const resultState = sameCompleted ? "completed" : "not_completed";
      const receipt = {
        id: feedbackId,
        digest: requestDigest,
        outcomeId,
        resultState,
        outcomeStatus: entry.outcome.status,
        failureReasonTokens: [...entry.outcome.failureReasonTokens]
      };
      state.feedbackReceipts.push(receipt);
      writeState(state);
      return feedbackResponseFromReceipt(state, receipt);
    }
    if (entry.feedbackState === "unasked" || entry.outcome.feedbackPromptedAt === null) {
      throw outcomeError("outcome_not_prompted", "Feedback is accepted only after the outcome question is claimed.");
    }

    let resultState;
    if (taskOutcomeToken === "completed") {
      if (reasonToken !== null) {
        throw outcomeError("unexpected_failure_reason", "Completed outcomes cannot include a failure reason.");
      }
      entry.outcome = assertContract(CONTRACTS.PENDING_OUTCOME, {
        ...entry.outcome,
        status: "succeeded",
        failureReasonTokens: []
      }, "invalid_pending_outcome");
      entry.feedbackState = "resolved";
      resultState = "completed";
    } else if (entry.feedbackState === "asked") {
      if (reasonToken !== null) {
        throw outcomeError("failure_reason_not_requested", "Choose not_completed before submitting a reason.");
      }
      entry.feedbackState = "reason_required";
      resultState = "reason_required";
    } else if (entry.feedbackState === "reason_required") {
      if (reasonToken === null) {
        resultState = "reason_required";
      } else {
        if (!FAILURE_REASON_TOKENS.includes(reasonToken)) {
          throw outcomeError("invalid_failure_reason", "Failure reason is not in the finite allowlist.");
        }
        entry.outcome = assertContract(CONTRACTS.PENDING_OUTCOME, {
          ...entry.outcome,
          status: "failed",
          failureReasonTokens: [reasonToken]
        }, "invalid_pending_outcome");
        entry.feedbackState = "resolved";
        resultState = "not_completed";
      }
    } else {
      throw outcomeError("outcome_feedback_conflict", "Outcome feedback cannot be changed from its current state.");
    }

    const receipt = {
      id: feedbackId,
      digest: requestDigest,
      outcomeId,
      resultState,
      outcomeStatus: entry.outcome.status,
      failureReasonTokens: [...entry.outcome.failureReasonTokens]
    };
    state.feedbackReceipts.push(receipt);
    writeState(state);
    return feedbackResponseFromReceipt(state, receipt);
  }

  function submitFailureReason(input = {}) {
    return submitOutcomeFeedback({ ...input, taskOutcomeToken: "not_completed" });
  }

  function expireDueOutcomes() {
    const state = readState();
    const expiredIds = expireState(state, clockIso());
    if (expiredIds.length) writeState(state);
    return expiredIds.map((outcomeId) => clone(findOutcomeEntry(state, outcomeId).outcome));
  }

  function getOutcome(outcomeId) {
    assertToken(outcomeId, "outcomeId");
    const entry = findOutcomeEntry(readCurrentState(), outcomeId);
    return clone(entry?.outcome || null);
  }

  function getFeedbackState(outcomeId) {
    assertToken(outcomeId, "outcomeId");
    const entry = findOutcomeEntry(readCurrentState(), outcomeId);
    return entry ? { state: entry.feedbackState, outcome: clone(entry.outcome) } : null;
  }

  function listOutcomes(options = {}) {
    assertPrivacySafe(options);
    assertOnlyKeys(options, ["target", "projectScopeToken", "status"]);
    if (options.target !== undefined) assertToken(options.target, "target");
    if (options.projectScopeToken !== undefined) assertToken(options.projectScopeToken, "projectScopeToken");
    if (options.status !== undefined && !ENUMS.pendingOutcomeStatus.includes(options.status)) {
      throw outcomeError("invalid_outcome_status", "Outcome status is not supported.");
    }
    return readCurrentState().outcomes
      .map((entry) => entry.outcome)
      .filter((outcome) => options.target === undefined || outcome.target === options.target)
      .filter((outcome) => options.projectScopeToken === undefined
        || outcome.projectScopeToken === options.projectScopeToken)
      .filter((outcome) => options.status === undefined || outcome.status === options.status)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || right.outcomeId.localeCompare(left.outcomeId))
      .map(clone);
  }

  function listPendingOutcomes(options = {}) {
    return listOutcomes({ ...options, status: "unknown" });
  }

  function listImplicitSignals(options = {}) {
    assertPrivacySafe(options);
    assertOnlyKeys(options, ["target", "projectScopeToken", "outcomeId"]);
    if (options.target !== undefined) assertToken(options.target, "target");
    if (options.projectScopeToken !== undefined) assertToken(options.projectScopeToken, "projectScopeToken");
    if (options.outcomeId !== undefined) assertToken(options.outcomeId, "outcomeId");
    return readCurrentState().implicitSignals
      .filter((event) => options.target === undefined || event.target === options.target)
      .filter((event) => options.projectScopeToken === undefined
        || event.projectScopeToken === options.projectScopeToken)
      .filter((event) => options.outcomeId === undefined || event.outcomeId === options.outcomeId)
      .map(clone);
  }

  function invalidateProject(projectScopeToken) {
    assertToken(projectScopeToken, "projectScopeToken");
    const state = readCurrentState();
    const invalidated = [];
    for (const entry of state.outcomes) {
      if (entry.outcome.projectScopeToken !== projectScopeToken
        || entry.outcome.status === "invalidated") continue;
      entry.outcome = assertContract(CONTRACTS.PENDING_OUTCOME, {
        ...entry.outcome,
        status: "invalidated",
        failureReasonTokens: []
      }, "invalid_pending_outcome");
      entry.feedbackState = "invalidated";
      invalidated.push(entry.outcome.outcomeId);
    }
    if (invalidated.length) writeState(state);
    return invalidated;
  }

  if (!fs.existsSync(file)) writeState(defaultState());
  else readCurrentState();

  return Object.freeze({
    file,
    recordPromptSessionEvent,
    recordEvent: recordPromptSessionEvent,
    recordVerifiedInsert,
    recordImplicitSignal,
    claimNextFeedback,
    askNext: claimNextFeedback,
    submitOutcomeFeedback,
    recordFeedback: submitOutcomeFeedback,
    submitFailureReason,
    expireDueOutcomes,
    getOutcome,
    getFeedbackState,
    listOutcomes,
    listPendingOutcomes,
    listImplicitSignals,
    invalidateProject
  });
}

module.exports = {
  STORE_SCHEMA_VERSION,
  FEEDBACK_DELAY_MS,
  OUTCOME_TTL_MS,
  IMPLICIT_SIGNAL_TYPES,
  FAILURE_REASON_TOKENS,
  createPendingOutcomeStore
};
