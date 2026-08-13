const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const evidence = require("../src/activation-evidence.js");

assert.equal(evidence.EXTENSION_BUILD_ID, "phase3-extension-20260717-r5");
assert.equal(evidence.ACTIVATION_PROOF_VERSION, "stable-readback-proof@1");
assert.equal(evidence.isActivationTarget({ id: "chatgpt" }), true);
assert.equal(evidence.isActivationTarget({ id: "claude" }), false);
assert.equal(evidence.requiresModelBackedActivation({ id: "chatgpt" }, false), true);
assert.equal(evidence.requiresModelBackedActivation({ id: "chatgpt" }, true), false);
assert.equal(evidence.isModelBackedGeneration("llm"), true);
assert.equal(evidence.isModelBackedGeneration("template-fallback"), false);

const seen = evidence.buildBrowserSeenPayload("2026-07-17T00:00:00.000Z");
assert.deepEqual(seen, {
  contractVersion: "phase3-activation@1",
  site: "chatgpt",
  seenAt: "2026-07-17T00:00:00.000Z"
});
assert.equal(evidence.buildBrowserSeenPayload("SECRET_TIMESTAMP_PAYLOAD").seenAt, "");

const insert = evidence.buildCompletionPayload({
  eventId: "activation-verified_insert-1752710407000",
  kind: "verified_insert",
  targetKind: "chatgpt-composer",
  stableReadback: true
});
assert.deepEqual(insert, {
  contractVersion: "phase3-activation@1",
  extensionBuildId: "phase3-extension-20260717-r5",
  eventId: "activation-verified_insert-1752710407000",
  site: "chatgpt",
  completionKind: "verified_insert",
  targetKind: "chatgpt-composer",
  stableReadback: true,
  verified: true,
  copied: false
});

const copy = evidence.buildCompletionPayload({
  eventId: "activation-copy-1752710408000",
  kind: "copy"
});
assert.deepEqual(copy, {
  contractVersion: "phase3-activation@1",
  extensionBuildId: "phase3-extension-20260717-r5",
  eventId: "activation-copy-1752710408000",
  site: "chatgpt",
  completionKind: "copy",
  verified: false,
  copied: true
});

assert.equal(evidence.buildCompletionPayload({ eventId: "activation-invalid", kind: "visualOnly" }), null);
assert.equal(evidence.buildCompletionPayload({ eventId: "SECRET_EVENT_PAYLOAD", kind: "verified_insert" }), null);
assert.equal(evidence.buildCompletionPayload({ eventId: "activation-verified_insert-1752710409000", kind: "verified_insert", targetKind: "chatgpt-composer" }), null);
assert.equal(evidence.buildCompletionPayload({ eventId: "activation-verified_insert-1752710409000", kind: "verified_insert", stableReadback: true }), null);
assert.equal(evidence.buildCompletionPayload({
  eventId: "activation-copy-1752710409000",
  kind: "verified_insert",
  targetKind: "chatgpt-composer",
  stableReadback: true
}), null);
assert.equal(Object.keys(insert).some((key) => /prompt|clipboard|raw|title|dom/i.test(key)), false);
assert.equal(evidence.createActivationEventId("copy", () => 1752710410000), "activation-copy-1752710410000");

const pending = evidence.enqueuePendingActivation([], insert, () => 1752710411000);
assert.equal(pending.length, 1);
assert.equal(pending[0].payload.eventId, insert.eventId);
assert.equal(pending[0].attempts, 0);
assert.equal(pending[0].createdAt, 1752710411000);
assert.equal(Object.keys(pending[0].payload).some((key) => /prompt|clipboard|raw|title|dom|key/i.test(key)), false);
const duplicatePending = evidence.enqueuePendingActivation(pending, copy, () => 1752710412000);
assert.equal(duplicatePending.length, 1);
assert.equal(duplicatePending[0].payload.eventId, insert.eventId);
const replacedPending = evidence.replacePendingActivation(pending, copy, () => 1752710413000);
assert.equal(replacedPending.length, 1);
assert.equal(replacedPending[0].payload.eventId, copy.eventId);
assert.equal(replacedPending[0].attempts, 0);
assert.equal(replacedPending[0].createdAt, 1752710413000);
const attemptedPending = evidence.recordPendingActivationAttempt(pending, insert.eventId, false);
assert.equal(attemptedPending[0].attempts, 1);
assert.equal(evidence.canRetryPendingActivation(attemptedPending[0]), true);
let exhaustedPending = attemptedPending;
for (let attempt = 1; attempt < evidence.MAX_PENDING_ACTIVATION_ATTEMPTS; attempt += 1) {
  exhaustedPending = evidence.recordPendingActivationAttempt(exhaustedPending, insert.eventId, false);
}
assert.equal(exhaustedPending[0].attempts, evidence.MAX_PENDING_ACTIVATION_ATTEMPTS);
assert.equal(evidence.canRetryPendingActivation(exhaustedPending[0]), false);
assert.deepEqual(evidence.recordPendingActivationAttempt(pending, insert.eventId, true), []);

const contentSource = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");
assert.ok(contentSource.includes("markActivationBrowserSeen"));
assert.ok(contentSource.includes("completeActivationFromEvidence(\"verified_insert\""));
assert.ok(contentSource.includes("completeActivationFromEvidence(\"copy\")"));
assert.ok(contentSource.includes("smartPromptPendingActivation"));
assert.ok(contentSource.includes("queuePendingActivation"));
assert.ok(contentSource.includes("flushPendingActivation"));
assert.ok(contentSource.includes("allowTemplateFallback: !modelBackedActivationRequired"));
assert.ok(contentSource.includes("if (state.activationBrowserSeenPromise) await state.activationBrowserSeenPromise;"));
assert.ok(contentSource.includes("isModelBackedGeneration(state.generatedBy)"));
assert.ok(contentSource.includes("clipboard_verified"));
assert.ok(contentSource.includes("noAutoSubmit: true"));
assert.ok(contentSource.includes("chatgpt-composer"));
assert.ok(contentSource.includes("stableReadback: evidence.stableReadback"));
assert.ok(contentSource.includes("smartPromptActivationCompletion"));
assert.ok(contentSource.includes("await clearPendingActivationQueue();"));
assert.equal(contentSource.includes("flushPendingActivation({ force: true })"), false);
assert.ok(contentSource.includes("queuePendingActivation(payload, { replaceExisting: true })"));
assert.ok(
  contentSource.indexOf("if (!activationEvidence.isModelBackedGeneration(state.generatedBy)) return null;")
    < contentSource.indexOf("const queued = activationEvidence.getPendingActivation")
);

console.log("activation evidence tests passed");
