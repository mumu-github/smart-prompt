"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CONTRACTS,
  DEFAULT_PRIVACY_FLAGS,
  validateContract
} = require("../../../packages/outcome-learning");
const {
  STORE_SCHEMA_VERSION,
  FEEDBACK_DELAY_MS,
  OUTCOME_TTL_MS,
  IMPLICIT_SIGNAL_TYPES,
  FAILURE_REASON_TOKENS,
  createPendingOutcomeStore
} = require("../src/modules/outcomes");

const retainedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-pending-outcomes-v2-"));

function dataDir(name) {
  const dir = path.join(retainedRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

function promptSessionEvent(overrides = {}) {
  const eventType = overrides.eventType || "verified_insert";
  const verifiedInsert = eventType === "verified_insert";
  return {
    contractVersion: "prompt-session@2",
    eventId: "event-insert-1",
    eventType,
    occurredAt: "2026-07-19T00:00:00.000Z",
    sessionId: "session-1",
    generationId: "generation-1",
    target: "codex",
    projectScopeToken: "project-a",
    strategyId: "strategy-a",
    strategyVersion: "v1",
    modelFamilyToken: "model-a",
    outcomeId: verifiedInsert ? "outcome-1" : null,
    policyId: null,
    policyVersion: null,
    taskOutcomeToken: "unknown",
    insertVerified: verifiedInsert,
    noAutoSubmit: true,
    failureReasonTokens: [],
    privacyFlags: { ...DEFAULT_PRIVACY_FLAGS },
    ...overrides
  };
}

function assertValidOutcome(outcome) {
  const validation = validateContract(CONTRACTS.PENDING_OUTCOME, outcome);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
}

assert.equal(STORE_SCHEMA_VERSION, "pending-outcome-store@1");
assert.equal(FEEDBACK_DELAY_MS, 60_000);
assert.equal(OUTCOME_TTL_MS, 86_400_000);
assert.deepEqual(IMPLICIT_SIGNAL_TYPES, ["retry", "undo", "regenerated", "insert_failed"]);
assert.deepEqual(FAILURE_REASON_TOKENS, [
  "missing_context",
  "wrong_format",
  "not_actionable",
  "too_long",
  "token_waste",
  "tool_mismatch",
  "low_quality",
  "insert_failed"
]);

let now = "2026-07-19T00:00:00.000Z";
const queueDir = dataDir("queue");
const queue = createPendingOutcomeStore(queueDir, { now: () => now });

const firstInsert = promptSessionEvent();
const created = queue.recordVerifiedInsert(firstInsert);
assert.equal(created.kind, "pending_outcome");
assert.equal(created.created, true);
assert.equal(created.duplicate, false);
assert.equal(created.outcome.createdAt, "2026-07-19T00:00:00.000Z");
assert.equal(created.outcome.eligibleAt, "2026-07-19T00:01:00.000Z");
assert.equal(created.outcome.expiresAt, "2026-07-20T00:00:00.000Z");
assert.equal(created.outcome.status, "unknown");
assert.equal(created.outcome.insertVerified, true);
assertValidOutcome(created.outcome);

const duplicateInsert = queue.recordEvent(firstInsert);
assert.equal(duplicateInsert.duplicate, true);
assert.equal(queue.listOutcomes().length, 1);
expectCode(
  () => queue.recordEvent({ ...firstInsert, generationId: "generation-conflict" }),
  "outcome_idempotency_conflict"
);
expectCode(
  () => queue.recordVerifiedInsert(promptSessionEvent({
    eventId: "event-not-verified",
    eventType: "retry",
    insertVerified: false,
    outcomeId: "outcome-1"
  })),
  "verified_insert_required"
);
expectCode(
  () => queue.recordEvent(promptSessionEvent({
    eventId: "event-invalid-insert",
    insertVerified: false
  })),
  "invalid_prompt_session_event"
);
expectCode(
  () => queue.recordEvent(promptSessionEvent({
    eventId: "event-wrong-target",
    target: "chatgpt"
  })),
  "invalid_prompt_session_event"
);

for (const unsafeEvent of [
  { eventId: "event-raw-prompt", prompt: "RAW_PROMPT_SENTINEL" },
  { eventId: "event-project-path", projectScopeToken: "C:\\Users\\private\\project" },
  { eventId: "event-window-title", windowTitle: "RAW_TITLE_SENTINEL" },
  { eventId: "event-credential", modelFamilyToken: "sk-1234567890abcdef" }
]) {
  expectCode(
    () => queue.recordEvent(promptSessionEvent(unsafeEvent)),
    "outcome_privacy_violation"
  );
}
expectCode(
  () => queue.recordEvent(promptSessionEvent({
    eventId: "event-raw-text",
    generationId: "raw prompt body with spaces"
  })),
  "invalid_prompt_session_event"
);
assert.equal(queue.listOutcomes().length, 1);

for (const [suffix, seconds, scope] of [
  ["older", 10, "project-a"],
  ["latest-eligible", 20, "project-a"],
  ["other-scope", 30, "project-b"],
  ["newer-not-eligible", 60, "project-a"]
]) {
  const occurredAt = new Date(Date.parse("2026-07-19T00:00:00.000Z") + seconds * 1000).toISOString();
  queue.recordEvent(promptSessionEvent({
    eventId: `event-${suffix}`,
    occurredAt,
    sessionId: `session-${suffix}`,
    generationId: `generation-${suffix}`,
    projectScopeToken: scope,
    outcomeId: `outcome-${suffix}`
  }));
}
assert.equal(queue.listOutcomes().length, 5);

now = "2026-07-19T00:01:35.000Z";
const firstAsk = queue.askNext({
  askId: "ask-project-a-1",
  target: "codex",
  projectScopeToken: "project-a"
});
assert.equal(firstAsk.state, "question");
assert.equal(firstAsk.outcome.outcomeId, "outcome-latest-eligible");
assert.equal(firstAsk.outcome.feedbackPromptedAt, now);

const repeatedAsk = queue.claimNextFeedback({
  requestId: "ask-project-a-1",
  target: "codex",
  projectScopeToken: "project-a"
});
assert.deepEqual(repeatedAsk, firstAsk);
assert.equal(queue.getFeedbackState("outcome-latest-eligible").state, "asked");
const replayedOutcomeInsert = queue.recordEvent({
  ...promptSessionEvent(),
  eventId: "event-insert-1-ipc-retry"
});
assert.equal(replayedOutcomeInsert.created, false);
assert.equal(replayedOutcomeInsert.duplicate, false);
assert.equal(queue.listOutcomes().length, 5);

const secondAsk = queue.askNext({
  eventId: "ask-project-a-2",
  target: "codex",
  projectScopeToken: "project-a"
});
assert.equal(secondAsk.outcome.outcomeId, "outcome-older");
assert.notEqual(secondAsk.outcome.outcomeId, firstAsk.outcome.outcomeId);

const crossScopeAsk = queue.askNext({
  askId: "ask-project-b-1",
  target: "codex",
  projectScopeToken: "project-b"
});
assert.equal(crossScopeAsk.outcome.outcomeId, "outcome-other-scope");
expectCode(
  () => queue.askNext({
    askId: "ask-project-b-1",
    target: "codex",
    projectScopeToken: "project-a"
  }),
  "outcome_idempotency_conflict"
);
expectCode(
  () => queue.askNext({ askId: "ask-no-scope", target: "codex", projectScopeToken: "C:\\private" }),
  "outcome_privacy_violation"
);

const completed = queue.submitOutcomeFeedback({
  feedbackId: "feedback-completed-1",
  outcomeId: "outcome-latest-eligible",
  taskOutcomeToken: "completed"
});
assert.equal(completed.state, "completed");
assert.equal(completed.outcome.status, "succeeded");
assert.deepEqual(completed.outcome.failureReasonTokens, []);
assert.deepEqual(queue.recordFeedback({
  requestId: "feedback-completed-1",
  outcomeId: "outcome-latest-eligible",
  taskOutcomeToken: "completed"
}), completed);
expectCode(
  () => queue.recordFeedback({
    requestId: "feedback-completed-1",
    outcomeId: "outcome-latest-eligible",
    taskOutcomeToken: "not_completed"
  }),
  "outcome_idempotency_conflict"
);

const reasonRequired = queue.submitOutcomeFeedback({
  eventId: "feedback-not-completed-1",
  outcomeId: "outcome-older",
  taskOutcomeToken: "not_completed"
});
assert.equal(reasonRequired.state, "reason_required");
assert.equal(reasonRequired.outcome.status, "unknown");
assert.deepEqual(reasonRequired.failureReasonTokens, FAILURE_REASON_TOKENS);
assert.deepEqual(queue.submitOutcomeFeedback({
  eventId: "feedback-not-completed-1",
  outcomeId: "outcome-older",
  taskOutcomeToken: "not_completed"
}), reasonRequired);
expectCode(
  () => queue.submitFailureReason({
    feedbackId: "feedback-invalid-reason",
    outcomeId: "outcome-older",
    reasonToken: "other"
  }),
  "invalid_failure_reason"
);
const failed = queue.submitFailureReason({
  feedbackId: "feedback-reason-1",
  outcomeId: "outcome-older",
  reasonToken: "low_quality"
});
assert.equal(failed.state, "not_completed");
assert.equal(failed.outcome.status, "failed");
assert.deepEqual(failed.outcome.failureReasonTokens, ["low_quality"]);

expectCode(
  () => queue.submitOutcomeFeedback({
    feedbackId: "feedback-unasked",
    outcomeId: "outcome-newer-not-eligible",
    taskOutcomeToken: "completed"
  }),
  "outcome_not_prompted"
);

for (const [index, reasonToken] of FAILURE_REASON_TOKENS.entries()) {
  let reasonNow = "2026-07-19T04:00:00.000Z";
  const reasonStore = createPendingOutcomeStore(dataDir(`reason-${index}`), { now: () => reasonNow });
  const outcomeId = `outcome-reason-${index}`;
  reasonStore.recordEvent(promptSessionEvent({
    eventId: `event-reason-${index}`,
    occurredAt: reasonNow,
    sessionId: `session-reason-${index}`,
    generationId: `generation-reason-${index}`,
    outcomeId
  }));
  reasonNow = "2026-07-19T04:01:00.000Z";
  assert.equal(reasonStore.askNext({
    askId: `ask-reason-${index}`,
    target: "codex",
    projectScopeToken: "project-a"
  }).outcome.outcomeId, outcomeId);
  assert.equal(reasonStore.recordFeedback({
    feedbackId: `feedback-choice-${index}`,
    outcomeId,
    taskOutcomeToken: "not_completed"
  }).state, "reason_required");
  const accepted = reasonStore.submitFailureReason({
    feedbackId: `feedback-reason-${index}`,
    outcomeId,
    reasonToken
  });
  assert.equal(accepted.outcome.status, "failed");
  assert.deepEqual(accepted.outcome.failureReasonTokens, [reasonToken]);
}

let signalNow = "2026-07-19T05:00:00.000Z";
const signalDir = dataDir("signals");
const signalStore = createPendingOutcomeStore(signalDir, { now: () => signalNow });
signalStore.recordEvent(promptSessionEvent({
  eventId: "event-signal-source",
  occurredAt: signalNow,
  outcomeId: "outcome-signal-source"
}));
for (const [index, eventType] of IMPLICIT_SIGNAL_TYPES.entries()) {
  const signal = promptSessionEvent({
    eventId: `event-signal-${index}`,
    eventType,
    occurredAt: new Date(Date.parse(signalNow) + (index + 1) * 1000).toISOString(),
    outcomeId: "outcome-signal-source",
    insertVerified: false,
    failureReasonTokens: eventType === "insert_failed" ? ["insert_failed"] : []
  });
  const recorded = signalStore.recordImplicitSignal(signal);
  assert.equal(recorded.kind, "implicit_signal");
  assert.equal(recorded.recorded, true);
  assert.equal(signalStore.recordEvent(signal).duplicate, true);
}
assert.equal(signalStore.listImplicitSignals().length, 4);
assert.equal(signalStore.listOutcomes().length, 1);
assert.equal(signalStore.getOutcome("outcome-signal-source").status, "unknown");
expectCode(
  () => signalStore.recordEvent(promptSessionEvent({
    eventId: "event-signal-0",
    eventType: "undo",
    outcomeId: "outcome-signal-source",
    insertVerified: false
  })),
  "outcome_idempotency_conflict"
);

let expiryNow = "2026-07-19T06:00:00.000Z";
const expiryDir = dataDir("expiry");
const expiryStore = createPendingOutcomeStore(expiryDir, { now: () => expiryNow });
for (const suffix of ["unanswered", "reason-required", "unasked"]) {
  expiryStore.recordEvent(promptSessionEvent({
    eventId: `event-expiry-${suffix}`,
    occurredAt: expiryNow,
    sessionId: `session-expiry-${suffix}`,
    generationId: `generation-expiry-${suffix}`,
    outcomeId: `outcome-expiry-${suffix}`,
    projectScopeToken: `project-${suffix}`
  }));
}
expiryNow = "2026-07-19T06:01:00.000Z";
expiryStore.askNext({
  askId: "ask-expiry-unanswered",
  target: "codex",
  projectScopeToken: "project-unanswered"
});
expiryStore.askNext({
  askId: "ask-expiry-reason-required",
  target: "codex",
  projectScopeToken: "project-reason-required"
});
expiryStore.recordFeedback({
  feedbackId: "feedback-expiry-reason-required",
  outcomeId: "outcome-expiry-reason-required",
  taskOutcomeToken: "not_completed"
});
expiryNow = "2026-07-20T05:59:59.999Z";
assert.equal(expiryStore.getOutcome("outcome-expiry-unanswered").status, "unknown");
assert.equal(expiryStore.getOutcome("outcome-expiry-reason-required").status, "unknown");
expiryNow = "2026-07-20T06:00:00.000Z";
const expired = expiryStore.expireDueOutcomes();
assert.equal(expired.length, 3);
assert.ok(expired.every((outcome) => outcome.status === "expired_unknown"));
assert.equal(expiryStore.expireDueOutcomes().length, 0);
assert.equal(expiryStore.askNext({
  askId: "ask-after-expiry",
  target: "codex",
  projectScopeToken: "project-unasked"
}).state, "none");
expectCode(
  () => expiryStore.recordFeedback({
    feedbackId: "feedback-after-expiry",
    outcomeId: "outcome-expiry-unanswered",
    taskOutcomeToken: "completed"
  }),
  "pending_outcome_expired"
);

now = "2026-07-19T00:01:35.000Z";
const restartedQueue = createPendingOutcomeStore(queueDir, { now: () => now });
assert.equal(restartedQueue.listOutcomes().length, 5);
assert.equal(restartedQueue.getOutcome("outcome-latest-eligible").status, "succeeded");
assert.equal(restartedQueue.getOutcome("outcome-older").status, "failed");
assert.deepEqual(restartedQueue.askNext({
  askId: "ask-project-a-1",
  target: "codex",
  projectScopeToken: "project-a"
}), firstAsk);
assert.equal(restartedQueue.recordEvent(firstInsert).duplicate, true);

const persisted = fs.readFileSync(restartedQueue.file, "utf8");
const parsed = JSON.parse(persisted);
assert.equal(parsed.schemaVersion, STORE_SCHEMA_VERSION);
for (const forbidden of [
  "RAW_PROMPT_SENTINEL",
  "RAW_TITLE_SENTINEL",
  "C:\\\\Users\\\\private\\\\project",
  "sk-1234567890abcdef",
  "raw prompt body with spaces"
]) {
  assert.equal(persisted.includes(forbidden), false, `persisted state leaked ${forbidden}`);
}
for (const outcome of restartedQueue.listOutcomes()) assertValidOutcome(outcome);

console.log(`pending outcomes v2 tests passed; retained temp root: ${retainedRoot}`);
