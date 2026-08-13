"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { buildCard } = require("../../../packages/shared/smart-prompt-core");
const { createCodexTargetAdapter } = require("../src/modules/codex-target-adapter");
const { classifyCodexInsertPolicyIncident } = require("../src/modules/policies");
const { createStore } = require("../src/store");
const { createApp } = require("../src/server");

const originalDraft = "SYNTHETIC_OPENING_DRAFT";
const generatedPrompt = "Implement the synthetic fixture and run its acceptance test.";
const insertedPrompt = `${generatedPrompt}\n- Verify the edited writeback path.`;
const runtimeHash = "1".repeat(64);
const focusHash = "2".repeat(64);
const projectHash = "3".repeat(64);
// 假时钟锚定真实当前时间：服务端内存 lease 清理用真实 Date.now()，
// 冻结历史日期会导致 targetLeases 被当作过期剪除（时间炸弹）。
let nowMs = Date.now();
const calls = [];
const policyIncidentCalls = [];
let forceInsertMismatch = false;

function snapshot(draftText = originalDraft) {
  return {
    target: "codex",
    foregroundHwnd: "0x1001",
    hwnd: "0x1001",
    pid: 4101,
    isMainWindow: true,
    isVisible: true,
    isMinimized: false,
    isCloaked: false,
    runtimeIdentityHash: runtimeHash,
    projectIdentityHash: projectHash,
    projectIdentityReliable: true,
    composer: {
      ownerHwnd: "0x1001",
      candidateToken: "focused-composer-fixture",
      focused: true,
      focusIdentityHash: focusHash,
      canReadExact: true,
      canReplaceAll: true,
      canSetValue: true,
      canControlledClipboard: true,
      draftText
    }
  };
}

const probeRunner = {
  run(command) {
    calls.push(command.kind);
    if (command.kind === "inspect" || command.kind === "read_exact") return snapshot();
    assert.equal(command.kind, "replace_all_atomic");
    const beforeDraft = command.operation === "undo" ? insertedPrompt : originalDraft;
    return {
      attempted: true,
      guardMatched: true,
      leaseFreshAtCommit: command.operation === "insert",
      candidateRemapped: false,
      method: "direct",
      replacementMode: "set_value",
      readbackText: forceInsertMismatch ? "SYNTHETIC_MISMATCH" : command.text,
      clipboardRestored: null,
      focusConfirmed: true,
      selectAllApplied: false,
      pasteApplied: false,
      submitCount: 0,
      before: snapshot(beforeDraft)
    };
  }
};

const adapter = createCodexTargetAdapter({ probeRunner, now: () => nowMs });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-target-routes-"));
const store = createStore(dataDir, {
  pendingOutcomeOptions: { now: () => new Date(nowMs).toISOString() }
});
const recordCodexTargetPolicyIncident = store.recordCodexTargetPolicyIncident;
store.recordCodexTargetPolicyIncident = (binding, inserted) => {
  const incidentType = classifyCodexInsertPolicyIncident(inserted);
  if (incidentType) {
    policyIncidentCalls.push({
      policyId: binding.policyId,
      policyVersion: binding.policyVersion,
      projectScopeToken: binding.projectScopeToken,
      incidentType
    });
  }
  return recordCodexTargetPolicyIncident(binding, inserted);
};
store.setCodexActivationProgress("configuring");
store.recordCodexActivationModelReady({
  provider: "fixture",
  testedAt: new Date(nowMs - 10_000).toISOString()
});
store.markCodexActivationLoopStarted();

const server = http.createServer(createApp(store, {
  disableAuth: true,
  codexTargetAdapter: adapter,
  async generateWithLlm({ input, context, skills, variantIndex }) {
    return {
      ...buildCard(input, context, skills, variantIndex),
      prompt: generatedPrompt,
      generatedBy: "llm",
      model: "fixture-model",
      tokenUsage: { source: "provider", inputTokens: 10, outputTokens: 8 }
    };
  }
}));

async function request(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const opened = await request("/target/codex/inspect", { method: "POST", body: {} });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.result.status, "ready");
    assert.equal(opened.body.lease.projectScopeReliable, true);

    const read = await request("/target/codex/read", {
      method: "POST",
      body: { leaseId: opened.body.lease.leaseId }
    });
    assert.equal(read.body.result.status, "ready");
    assert.equal(read.body.draftText, originalDraft);

    const generated = await request("/generate", {
      method: "POST",
      body: {
        input: originalDraft,
        target: "codex",
        projectScopeToken: opened.body.lease.projectScopeToken,
        sessionId: "session_fixture_a",
        context: { target: "codex", tool: "codex", taskScenario: "bug_fix", mode: "continue" }
      }
    });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.card.sessionId, "session_fixture_a");
    assert.ok(generated.body.card.generationId);

    nowMs += 200;
    const fresh = await request("/target/codex/inspect", { method: "POST", body: {} });
    assert.equal(fresh.body.lease.projectScopeToken, opened.body.lease.projectScopeToken);

    const changedDraft = await request("/target/codex/insert", {
      method: "POST",
      body: {
        leaseId: fresh.body.lease.leaseId,
        text: insertedPrompt,
        expectedDraftHash: "f".repeat(64),
        generationId: generated.body.card.generationId,
        requestId: "insert_fixture_wrong_hash"
      }
    });
    assert.equal(changedDraft.status, 409);
    assert.equal(changedDraft.body.error.code, "draft_changed");
    assert.equal(calls.filter((kind) => kind === "replace_all_atomic").length, 0);

    const inserted = await request("/target/codex/insert", {
      method: "POST",
      body: {
        leaseId: fresh.body.lease.leaseId,
        text: insertedPrompt,
        expectedDraftHash: opened.body.lease.draftHash,
        generationId: generated.body.card.generationId,
        requestId: "insert_fixture_success",
        allowClipboardFallback: false
      }
    });
    assert.equal(inserted.status, 200);
    assert.equal(inserted.body.result.verified, true);
    assert.equal(inserted.body.result.noAutoSubmit, true);
    assert.equal(inserted.body.pendingOutcome.status, "unknown");
    assert.equal(inserted.body.pendingOutcome.projectScopeToken, opened.body.lease.projectScopeToken);
    assert.ok(inserted.body.undoToken);
    assert.ok(inserted.body.transaction.transactionId);
    assert.doesNotMatch(JSON.stringify(inserted.body), new RegExp(originalDraft));

    const replay = await request("/target/codex/insert", {
      method: "POST",
      body: {
        leaseId: fresh.body.lease.leaseId,
        text: insertedPrompt,
        expectedDraftHash: opened.body.lease.draftHash,
        generationId: generated.body.card.generationId,
        requestId: "insert_fixture_success",
        allowClipboardFallback: false
      }
    });
    assert.deepEqual(replay.body, inserted.body);
    assert.equal(calls.filter((kind) => kind === "replace_all_atomic").length, 1);

    const selfReported = await request("/activation/codex/complete", {
      method: "POST",
      body: {
        contractVersion: "codex-activation@2",
        transactionId: inserted.body.transaction.transactionId,
        verified: true
      }
    });
    assert.equal(selfReported.status, 400);
    assert.equal(selfReported.body.error.code, "activation_self_reported_evidence_rejected");

    const activated = await request("/activation/codex/complete", {
      method: "POST",
      body: {
        contractVersion: "codex-activation@2",
        transactionId: inserted.body.transaction.transactionId
      }
    });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.activation.progress, "activated");
    assert.equal(activated.body.activation.codexVerified, true);
    assert.equal(activated.body.claim.verification, "machine");

    nowMs += 200;
    const undone = await request("/target/codex/undo", {
      method: "POST",
      body: { undoToken: inserted.body.undoToken, allowClipboardFallback: false }
    });
    assert.equal(undone.status, 200);
    assert.equal(undone.body.result.status, "ready");
    assert.equal(undone.body.result.noAutoSubmit, true);

    const signals = await request(`/outcomes/v2/signals?outcomeId=${encodeURIComponent(inserted.body.pendingOutcome.outcomeId)}`);
    assert.equal(signals.status, 200);
    assert.equal(signals.body.signals.length, 1);
    assert.equal(signals.body.signals[0].eventType, "undo");
    assert.equal(calls.includes("send_key"), false);

    const verifiedHistory = store.getPromptHistory().find((entry) => (
      entry.generationId === generated.body.card.generationId
    ));
    assert.equal(verifiedHistory.context.verifiedInsertEvidence, true);
    assert.deepEqual(verifiedHistory.context.editFeatureSummary, {
      userEdited: true,
      lengthDeltaBucket: "large",
      structureChanged: true
    });

    nowMs += 60_000;
    const claimed = await request("/outcomes/v2/claim", {
      method: "POST",
      body: {
        askId: "ask_fixture_edited_insert",
        target: "codex",
        projectScopeToken: opened.body.lease.projectScopeToken
      }
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.result.outcome.outcomeId, inserted.body.pendingOutcome.outcomeId);
    const feedback = await request("/outcomes/v2/feedback", {
      method: "POST",
      body: {
        feedbackId: "feedback_fixture_edited_insert",
        outcomeId: inserted.body.pendingOutcome.outcomeId,
        taskOutcomeToken: "completed"
      }
    });
    assert.equal(feedback.status, 200);
    assert.equal(feedback.body.learning.observation.undoUsed, true);
    assert.deepEqual(feedback.body.learning.observation.editFeatureSummary, {
      userEdited: true,
      lengthDeltaBucket: "large",
      structureChanged: true
    });

    nowMs += 200;
    const incidentLease = await request("/target/codex/inspect", { method: "POST", body: {} });
    const incidentGeneration = await request("/generate", {
      method: "POST",
      body: {
        input: originalDraft,
        target: "codex",
        projectScopeToken: incidentLease.body.lease.projectScopeToken,
        sessionId: "session_fixture_incident",
        context: { target: "codex", tool: "codex", taskScenario: "bug_fix", mode: "continue" }
      }
    });
    forceInsertMismatch = true;
    const incidentInsert = await request("/target/codex/insert", {
      method: "POST",
      body: {
        leaseId: incidentLease.body.lease.leaseId,
        text: insertedPrompt,
        expectedDraftHash: incidentLease.body.lease.draftHash,
        generationId: incidentGeneration.body.card.generationId,
        requestId: "insert_fixture_miswrite_incident",
        allowClipboardFallback: false
      }
    });
    forceInsertMismatch = false;
    assert.equal(incidentInsert.status, 200);
    assert.equal(incidentInsert.body.result.reasonToken, "after_write_mismatch");
    assert.equal(incidentInsert.body.pendingOutcome, null);
    assert.equal(policyIncidentCalls.length, 1);
    assert.equal(policyIncidentCalls[0].incidentType, "miswrite_incident");
    assert.equal(policyIncidentCalls[0].policyId, incidentGeneration.body.card.generationPolicy.policyId);
    assert.equal(policyIncidentCalls[0].policyVersion, incidentGeneration.body.card.generationPolicy.version);
    assert.equal(policyIncidentCalls[0].projectScopeToken, incidentLease.body.lease.projectScopeToken);

    const cleared = await request("/privacy/v1/projects/clear", {
      method: "POST",
      body: { projectScopeToken: opened.body.lease.projectScopeToken }
    });
    assert.equal(cleared.status, 200);
    assert.ok(cleared.body.result.counts.targetTransactions >= 1);
    assert.ok(cleared.body.result.counts.promptHistory >= 1);
    assert.ok(store.getPromptHistory().every((entry) => (
      entry.context?.projectScopeToken !== opened.body.lease.projectScopeToken
    )));

    const writesBeforeReplayAfterClear = calls.filter((kind) => kind === "replace_all_atomic").length;
    const replayAfterClear = await request("/target/codex/insert", {
      method: "POST",
      body: {
        leaseId: fresh.body.lease.leaseId,
        text: insertedPrompt,
        expectedDraftHash: opened.body.lease.draftHash,
        generationId: generated.body.card.generationId,
        requestId: "insert_fixture_success",
        allowClipboardFallback: false
      }
    });
    assert.equal(replayAfterClear.status, 409);
    assert.equal(replayAfterClear.body.error.code, "target_transaction_binding_missing");
    assert.equal(calls.filter((kind) => kind === "replace_all_atomic").length, writesBeforeReplayAfterClear);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("codex target route v1 tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
