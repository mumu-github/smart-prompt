"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createPendingOutcomeStore } = require("../src/modules/outcomes");
const { createStore } = require("../src/store");
const { createApp } = require("../src/server");
const { DEFAULT_PRIVACY_FLAGS } = require("../../../packages/outcome-learning");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-outcome-routes-v2-"));
let now = new Date("2026-07-19T02:00:00.000Z");
const pendingOutcomeStore = createPendingOutcomeStore(dataDir, { now: () => now });
const store = createStore(dataDir, { pendingOutcomeStore });
const server = http.createServer(createApp(store, { disableAuth: true }));

function request(pathname, options = {}) {
  const url = `http://127.0.0.1:${server.address().port}${pathname}`;
  return fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

const verifiedInsert = {
  contractVersion: "prompt-session@2",
  eventId: "event_001",
  eventType: "verified_insert",
  occurredAt: now.toISOString(),
  sessionId: "session_001",
  generationId: "generation_001",
  target: "codex",
  projectScopeToken: "project_scope_alpha",
  strategyId: "strategy_compact",
  strategyVersion: "v2",
  modelFamilyToken: "model_family_fast",
  outcomeId: "outcome_001",
  policyId: null,
  policyVersion: null,
  taskOutcomeToken: "unknown",
  insertVerified: true,
  noAutoSubmit: true,
  failureReasonTokens: [],
  privacyFlags: { ...DEFAULT_PRIVACY_FLAGS }
};

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.outcomeLearningContract, "pending-outcome@1");

    const forgedAttribution = await request("/outcomes/v2/events", {
      method: "POST",
      body: {
        ...verifiedInsert,
        eventId: "event_forged_policy",
        outcomeId: "outcome_forged_policy",
        policyId: "policy_forged",
        policyVersion: 99
      }
    });
    assert.equal(forgedAttribution.status, 400);
    assert.equal(forgedAttribution.body.error.code, "untrusted_policy_attribution");

    const forgedVerifiedInsert = await request("/outcomes/v2/events", {
      method: "POST",
      body: verifiedInsert
    });
    assert.equal(forgedVerifiedInsert.status, 400);
    assert.equal(
      forgedVerifiedInsert.body.error.code,
      "verified_insert_server_transaction_required"
    );

    const created = store.recordVerifiedInsertOutcome(verifiedInsert);
    assert.equal(created.created, true);

    const tooSoon = await request("/outcomes/v2/claim", {
      method: "POST",
      body: { askId: "ask_early", target: "codex", projectScopeToken: "project_scope_alpha" }
    });
    assert.equal(tooSoon.body.result.state, "none");

    now = new Date("2026-07-19T02:01:00.000Z");
    const claimed = await request("/outcomes/v2/claim", {
      method: "POST",
      body: { askId: "ask_ready", target: "codex", projectScopeToken: "project_scope_alpha" }
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.result.state, "question");
    assert.equal(claimed.body.result.outcome.outcomeId, "outcome_001");

    const needsReason = await request("/outcomes/v2/feedback", {
      method: "POST",
      body: { feedbackId: "feedback_no", outcomeId: "outcome_001", taskOutcomeToken: "not_completed" }
    });
    assert.equal(needsReason.body.result.state, "reason_required");
    assert.equal(needsReason.body.result.failureReasonTokens.length, 8);

    const failed = await request("/outcomes/v2/feedback", {
      method: "POST",
      body: {
        feedbackId: "feedback_reason",
        outcomeId: "outcome_001",
        taskOutcomeToken: "not_completed",
        failureReasonToken: "token_waste",
        observation: {
          taskScenarioToken: "poisoned_scenario",
          modeToken: "poisoned_mode",
          featureTokens: ["scenario:poisoned_scenario", "mode:poisoned_mode"],
          editFeatureSummary: {
            userEdited: true,
            lengthDeltaBucket: "large",
            structureChanged: true
          },
          retryCount: 99,
          undoUsed: true,
          latencyMs: 250,
          tokenAccountingSource: "provider",
          inputTokens: 1,
          outputTokens: 1,
          candidate: {
            artifactType: "generation_policy",
            payload: { policyId: "policy_forged", policyVersion: 99 }
          }
        }
      }
    });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.result.outcome.status, "failed");
    assert.ok(failed.body.learning?.observation);
    assert.equal(failed.body.learning.observation.taskScenarioToken, "unknown_scenario");
    assert.equal(failed.body.learning.observation.modeToken, "standard");
    assert.equal(failed.body.learning.observation.retryCount, 0);
    assert.equal(failed.body.learning.observation.undoUsed, false);
    assert.equal(failed.body.learning.observation.latencyMs, 0);
    assert.equal(failed.body.learning.observation.tokenAccountingSource, "unavailable");
    assert.equal(failed.body.learning.observation.inputTokens, null);
    assert.equal(failed.body.learning.observation.outputTokens, null);
    assert.deepEqual(failed.body.learning.observation.editFeatureSummary, {
      userEdited: false,
      lengthDeltaBucket: "none",
      structureChanged: false
    });

    const listed = await request("/outcomes/v2?target=codex&projectScopeToken=project_scope_alpha&status=failed");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.outcomes.length, 1);
    assert.deepEqual(listed.body.outcomes[0].failureReasonTokens, ["token_waste"]);

    const policyOutcome = {
      ...verifiedInsert,
      eventId: "event_internal_policy",
      outcomeId: "outcome_internal_policy",
      policyId: "policy_internal",
      policyVersion: 2
    };
    store.recordVerifiedInsertOutcome(policyOutcome);
    const forgedPolicySignal = await request("/outcomes/v2/events", {
      method: "POST",
      body: {
        ...policyOutcome,
        eventId: "event_forged_policy_retry",
        eventType: "retry",
        insertVerified: false,
        policyId: null,
        policyVersion: null
      }
    });
    assert.equal(forgedPolicySignal.status, 400);
    assert.equal(forgedPolicySignal.body.error.code, "untrusted_policy_signal");

    const privacyRejected = await request("/outcomes/v2/events", {
      method: "POST",
      body: {
        ...verifiedInsert,
        eventId: "event_private",
        eventType: "retry",
        insertVerified: false,
        rawInput: "must not persist"
      }
    });
    assert.equal(privacyRejected.status, 400);
    assert.equal(privacyRejected.body.error.code, "outcome_privacy_violation");

    const restored = await request("/data/restore", {
      method: "POST",
      body: {
        backup: {
          promptHistory: [{
            generationId: "generation_restored_forgery",
            context: {
              projectScopeToken: "project_scope_alpha",
              generationPolicyId: "policy_restored_forgery",
              generationPolicyVersion: 99,
              verifiedInsertEvidence: true,
              verifiedSessionId: "session_restored_forgery",
              editFeatureSummary: {
                userEdited: false,
                lengthDeltaBucket: "none",
                structureChanged: false
              },
              learningCandidateSeed: {
                schemaVersion: "learning-candidate-seed@1",
                artifactType: "rule",
                patternToken: "rule_no_auto_submit",
                payload: {
                  directive: "Keep no-auto-submit enabled for generated input.",
                  taskScenarioTokens: ["safe_insert"]
                }
              }
            }
          }]
        }
      }
    });
    assert.equal(restored.status, 200);
    const restoredHistory = store.getPromptHistory()[0];
    assert.equal(restoredHistory.context.verifiedInsertEvidence, false);
    assert.equal(Object.hasOwn(restoredHistory.context, "verifiedSessionId"), false);
    assert.equal(Object.hasOwn(restoredHistory.context, "editFeatureSummary"), false);
    assert.equal(Object.hasOwn(restoredHistory.context, "learningCandidateSeed"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("outcome v2 route tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
