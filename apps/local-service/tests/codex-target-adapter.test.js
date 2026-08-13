"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const outcomeLearning = require("../../../packages/outcome-learning");
const {
  ADAPTER_VERSION,
  LEASE_VERSION,
  createCodexTargetAdapter,
  normalizeEditorReadback
} = require("../src/modules/codex-target-adapter");

assert.equal(normalizeEditorReadback("alpha  \r\nbeta\t\ngamma  "), "alpha\nbeta\ngamma");
assert.equal(
  normalizeEditorReadback("alpha  beta\n  indented  prose\n```txt\nx  y\n```"),
  "alpha beta\n  indented prose\n```txt\nx  y\n```"
);
assert.notEqual(normalizeEditorReadback("alpha beta"), normalizeEditorReadback("alphabeta"));

const fixturePath = path.resolve(
  __dirname,
  "../src/modules/codex-target-adapter/contract-fixtures.json"
);
const fixtureSet = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function deepMerge(base, patch) {
  if (patch === undefined) return structuredClone(base);
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return structuredClone(patch);
  }
  const source = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const result = structuredClone(source);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(source[key], value)
      : structuredClone(value);
  }
  return result;
}

class FixtureProbeRunner {
  constructor(fixture, scenario) {
    this.fixture = fixture;
    this.queue = [...scenario.probes];
    this.calls = [];
    this.commands = [];
    this.replies = [];
  }

  run(command) {
    const probe = this.queue.shift();
    assert.ok(probe, `unexpected probe call ${command.kind}`);
    assert.equal(command.kind, probe.command, `expected ${probe.command}, got ${command.kind}`);
    this.calls.push(command.kind);
    this.commands.push(command);

    if (command.kind === "inspect" || command.kind === "read_exact") {
      return deepMerge(this.fixture.baseSnapshot, probe.snapshotPatch || {});
    }

    assert.equal(command.kind, "replace_all_atomic");
    const reply = deepMerge(this.fixture.baseAtomicReply, probe.replyPatch || {});
    reply.before = deepMerge(this.fixture.baseSnapshot, probe.beforePatch || {});
    this.replies.push(reply);
    return reply;
  }
}

function assertAdapterResult(result, operation) {
  const validation = outcomeLearning.validateCodexTargetAdapterResult(result);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(result.contractVersion, "codex-target-adapter-result@1");
  assert.equal(result.operation, operation);
  assert.equal(result.target, "codex");
  assert.equal(result.noAutoSubmit, true);
  assert.deepEqual(result.privacyFlags, outcomeLearning.DEFAULT_PRIVACY_FLAGS);
  assert.deepEqual(outcomeLearning.findPrivacyViolations(result), []);

  const expectedKeys = [
    "adapterResultId",
    "attempted",
    "clipboardRestored",
    "contractVersion",
    "draftUnchanged",
    "focusVerified",
    "foregroundVerified",
    "noAutoSubmit",
    "occurredAt",
    "operation",
    "payloadFresh",
    "privacyFlags",
    "publicReason",
    "readbackMatched",
    "reasonToken",
    "status",
    "target",
    "targetIdentityVerified",
    "verification",
    "verified",
    "writeMethod"
  ];
  assert.deepEqual(Object.keys(result).sort(), expectedKeys.sort());
}

function assertLease(lease) {
  assert.equal(lease.leaseVersion, LEASE_VERSION);
  assert.equal(lease.target, "codex");
  assert.equal(typeof lease.hwnd, "string");
  assert.equal(Number.isInteger(lease.pid), true);
  assert.match(lease.runtimeIdentityHash, /^[a-f0-9]{64}$/);
  assert.equal(lease.focused, true);
  assert.match(lease.focusIdentityHash, /^[a-f0-9]{64}$/);
  assert.match(lease.draftHash, /^[a-f0-9]{64}$/);
  assert.equal(Number.isNaN(Date.parse(lease.issuedAt)), false);
  assert.equal(Number.isNaN(Date.parse(lease.expiresAt)), false);
  assert.deepEqual(Object.keys(lease.capabilities).sort(), [
    "controlledClipboard",
    "directSetValue",
    "exactRead",
    "fullReplace",
    "projectScopeReliable"
  ]);
  assert.match(lease.projectScopeToken, /^project_scope(?:_session)?_[a-f0-9]{32}$/);
  assert.ok(["reliable_hash", "session_opaque"].includes(lease.projectScopeKind));
  assert.equal(lease.projectScopeReliable, lease.capabilities.projectScopeReliable);
  assert.ok([
    "project_scope_reliable",
    "project_scope_window_runtime_session_only"
  ].includes(lease.projectScopeReason));
  for (const forbidden of ["title", "windowTitle", "draft", "draftText", "candidateToken", "nearbyText"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(lease, forbidden), false);
  }
}

function assertTransaction(transaction) {
  assert.equal(transaction.transactionVersion, "codex-verified-insert-transaction@1");
  assert.match(transaction.transactionId, /^transaction_[a-f0-9]{32}$/);
  assert.equal(transaction.target, "codex");
  assert.match(transaction.projectScopeToken, /^project_scope(?:_session)?_[a-f0-9]{32}$/);
  assert.ok(["reliable_hash", "session_opaque"].includes(transaction.projectScopeKind));
  assert.equal(Number.isNaN(Date.parse(transaction.issuedAt)), false);
  assert.equal(Number.isNaN(Date.parse(transaction.expiresAt)), false);
}

function assertExpected(response, expected, operation) {
  if (operation === "claim") {
    assert.equal(response.status, expected.status);
    assert.equal(response.reasonToken, expected.reasonToken);
    assert.equal(Boolean(response.receipt), expected.receipt);
    if (response.receipt) {
      assert.equal(response.receipt.claimVersion, "codex-verified-insert-claim@1");
      assert.equal(response.receipt.binding, expected.binding);
      assert.equal(response.receipt.target, "codex");
      assert.equal(response.receipt.verification, "machine");
      assert.equal(response.receipt.insertVerified, true);
      assert.equal(response.receipt.noAutoSubmit, true);
    }
    return;
  }
  const result = response.result;
  assertAdapterResult(result, operation);
  for (const key of [
    "status",
    "reasonToken",
    "publicReason",
    "verified",
    "writeMethod",
    "readbackMatched",
    "clipboardRestored"
  ]) {
    if (Object.prototype.hasOwnProperty.call(expected, key)) {
      assert.deepEqual(result[key], expected[key], `${operation}.${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(expected, "lease")) {
    assert.equal(Boolean(response.lease), expected.lease);
    if (response.lease) assertLease(response.lease);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "undo")) {
    assert.equal(Boolean(response.undoToken), expected.undo);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "draftText")) {
    assert.equal(response.draftText, expected.draftText);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "transaction")) {
    assert.equal(Boolean(response.transaction), expected.transaction);
    if (response.transaction) assertTransaction(response.transaction);
  }
  const scope = response.lease || response.transaction;
  if (scope && Object.prototype.hasOwnProperty.call(expected, "projectScopeKind")) {
    assert.equal(scope.projectScopeKind, expected.projectScopeKind);
  }
  if (scope && Object.prototype.hasOwnProperty.call(expected, "projectScopeReliable")) {
    assert.equal(scope.projectScopeReliable, expected.projectScopeReliable);
  }
}

function publicSurface(response) {
  return {
    result: response.result,
    lease: response.lease || null,
    undoToken: response.undoToken || null,
    transaction: response.transaction || null,
    claim: response.receipt || null
  };
}

assert.equal(fixtureSet.fixtureSetVersion, "codex-target-adapter-fixtures@1");
assert.equal(ADAPTER_VERSION, "codex-windows-target-adapter@1");
assert.ok(fixtureSet.cases.length >= 15);
const sessionScopeTokenOwners = new Map();

for (const scenario of fixtureSet.cases) {
  let clockMs = scenario.actions[0].atMs;
  const runner = new FixtureProbeRunner(fixtureSet, scenario);
  const adapter = createCodexTargetAdapter({
    probeRunner: runner,
    now: () => clockMs,
    leaseTtlMs: fixtureSet.leaseTtlMs
  });
  assert.equal(adapter.adapterVersion, ADAPTER_VERSION);
  assert.equal(adapter.leaseTtlMs, fixtureSet.leaseTtlMs);

  let latestLease = null;
  let latestUndoToken = null;
  let latestTransaction = null;
  let previousProjectScopeToken = null;
  for (let index = 0; index < scenario.actions.length; index += 1) {
    const action = scenario.actions[index];
    const expected = scenario.expected[index];
    clockMs = action.atMs;
    let response;

    if (action.operation === "inspect") {
      response = adapter.inspect();
      if (response.lease) {
        latestLease = response.lease;
        if (response.lease.projectScopeKind === "session_opaque") {
          const owner = sessionScopeTokenOwners.get(response.lease.projectScopeToken);
          if (owner === undefined) {
            sessionScopeTokenOwners.set(response.lease.projectScopeToken, scenario.id);
          } else {
            assert.equal(owner, scenario.id, "session scope token crossed adapter instances");
          }
        }
      }
    } else if (action.operation === "read") {
      response = adapter.readDraft({ leaseId: latestLease?.leaseId });
    } else if (action.operation === "insert") {
      response = adapter.insert({
        leaseId: latestLease?.leaseId,
        text: action.text,
        allowClipboardFallback: action.allowClipboardFallback === true
      });
      if (response.undoToken) latestUndoToken = response.undoToken;
      if (response.transaction) {
        assert.equal(response.transaction.projectScopeToken, latestLease.projectScopeToken);
        latestTransaction = response.transaction;
      }
    } else if (action.operation === "undo") {
      response = adapter.undo({
        undoToken: latestUndoToken,
        allowClipboardFallback: action.allowClipboardFallback === true
      });
    } else if (action.operation === "claim") {
      response = adapter.claimVerifiedTransaction({
        transactionId: action.transactionId || latestTransaction?.transactionId,
        binding: action.binding
      });
      if (response.receipt && latestTransaction) {
        assert.equal(response.receipt.projectScopeToken, latestTransaction.projectScopeToken);
      }
    } else {
      assert.fail(`unknown fixture action ${action.operation}`);
    }

    assertExpected(response, expected, action.operation);
    const currentScope = response.lease || response.transaction;
    if (currentScope && Object.prototype.hasOwnProperty.call(expected, "projectScopeChanged")) {
      assert.equal(
        currentScope.projectScopeToken !== previousProjectScopeToken,
        expected.projectScopeChanged
      );
    }
    if (currentScope) previousProjectScopeToken = currentScope.projectScopeToken;
    const serializedPublic = JSON.stringify(publicSurface(response));
    for (const sentinel of fixtureSet.privacySentinels) {
      assert.equal(
        serializedPublic.includes(sentinel),
        false,
        `${scenario.id} leaked ${sentinel} through its public surface`
      );
    }
  }

  if (latestTransaction && scenario.id === "direct-full-replace-and-undo") {
    const selfReported = adapter.claimVerifiedTransaction({
      transactionId: latestTransaction.transactionId,
      binding: "activation",
      verified: true,
      noAutoSubmit: true
    });
    assert.deepEqual(selfReported, {
      status: "blocked",
      reasonToken: "transaction_claim_invalid",
      receipt: null
    });
    const idempotent = adapter.claimVerifiedTransaction({
      transactionId: latestTransaction.transactionId,
      binding: "activation"
    });
    assert.equal(idempotent.status, "ready");
    assert.equal(idempotent.receipt.transactionId, latestTransaction.transactionId);
  }

  assert.deepEqual(runner.calls, scenario.expectedProbeCalls, scenario.id);
  assert.equal(runner.queue.length, 0, `${scenario.id} did not consume every fake probe`);
  for (const command of runner.commands) {
    assert.notEqual(command.kind, "submit");
    assert.notEqual(command.kind, "send_key");
    if (command.kind === "read_exact") {
      assert.equal(command.scope, "same_focused_composer");
      assert.deepEqual(command.forbidScopes, ["nearby", "root", "chat"]);
    }
    if (command.kind === "replace_all_atomic") {
      assert.equal(command.replacementIntent, "full");
      assert.equal(command.preferDirectSetValue, true);
      assert.equal(command.noSubmit, true);
      assert.deepEqual(command.prohibitedActions, ["enter", "submit", "send"]);
      if (command.operation === "insert") {
        assert.equal(command.leaseFreshness.requireFreshAtCommit, true);
        assert.match(command.leaseFreshness.leaseId, /^lease_[a-f0-9]{32}$/);
        assert.equal(Number.isInteger(command.leaseFreshness.issuedAtMs), true);
        assert.equal(Number.isInteger(command.leaseFreshness.expiresAtMs), true);
        assert.ok(command.leaseFreshness.expiresAtMs > command.leaseFreshness.issuedAtMs);
      } else {
        assert.equal(command.leaseFreshness, null);
      }
    }
  }
}

{
  let clock = 1784419200000;
  const adapter = createCodexTargetAdapter({
    probeRunner: {
      run: () => {
        clock += 7000;
        return structuredClone(fixtureSet.baseSnapshot);
      }
    },
    now: () => clock,
    leaseTtlMs: fixtureSet.leaseTtlMs
  });
  const inspected = adapter.inspect();
  assert.equal(Date.parse(inspected.lease.issuedAt), 1784419207000);
  assert.equal(Date.parse(inspected.lease.expiresAt), 1784419237000);
}

{
  const adapter = createCodexTargetAdapter({
    probeRunner: { run: () => null },
    now: () => 1784419200000
  });
  const response = adapter.inspect();
  assertAdapterResult(response.result, "inspect");
  assert.equal(response.result.status, "blocked");
  assert.equal(response.result.reasonToken, "target_missing");
  assert.equal(response.lease, null);
}

{
  let probeIndex = 0;
  const adapter = createCodexTargetAdapter({
    probeRunner: {
      run: () => (probeIndex++ === 0 ? structuredClone(fixtureSet.baseSnapshot) : null)
    },
    now: () => 1784419200000
  });
  const inspected = adapter.inspect();
  const response = adapter.readDraft({ leaseId: inspected.lease.leaseId });
  assertAdapterResult(response.result, "read");
  assert.equal(response.result.status, "failed");
  assert.equal(response.result.reasonToken, "readback_unavailable");
  assert.equal(response.draftText, null);
}

{
  let probeIndex = 0;
  const adapter = createCodexTargetAdapter({
    probeRunner: {
      run: () => (probeIndex++ === 0
        ? structuredClone(fixtureSet.baseSnapshot)
        : { before: null })
    },
    now: () => 1784419200000
  });
  const inspected = adapter.inspect();
  const response = adapter.insert({
    leaseId: inspected.lease.leaseId,
    text: "FULL_REPLACEMENT_TEXT",
    allowClipboardFallback: false
  });
  assertAdapterResult(response.result, "insert");
  assert.equal(response.result.status, "failed");
  assert.equal(response.result.reasonToken, "safety_atomic_revalidation_required");
  assert.equal(response.undoToken, null);
  assert.equal(response.transaction, null);
}

{
  let probeCalls = 0;
  const adapter = createCodexTargetAdapter({
    probeRunner: {
      run: () => {
        probeCalls += 1;
        return structuredClone(fixtureSet.baseSnapshot);
      }
    },
    now: () => 1784419200000
  });
  const inspected = adapter.inspect();
  const response = adapter.insert({
    leaseId: inspected.lease.leaseId,
    text: "FULL_REPLACEMENT_TEXT",
    expectedDraftHash: "f".repeat(64),
    allowClipboardFallback: false
  });
  assertAdapterResult(response.result, "insert");
  assert.equal(response.result.status, "blocked");
  assert.equal(response.result.reasonToken, "draft_changed");
  assert.equal(probeCalls, 1, "opening-draft mismatch must block before the write probe");
}

console.log(JSON.stringify({
  schemaVersion: "codex-target-adapter-node-test@1",
  pass: true,
  fakeOnly: true,
  fixtureSetVersion: fixtureSet.fixtureSetVersion,
  caseCount: fixtureSet.cases.length,
  realGuiTouched: false,
  realClipboardTouched: false,
  submitCount: 0
}));
