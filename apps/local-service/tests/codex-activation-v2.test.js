const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CODEX_ACTIVATION_PROGRESS,
  CODEX_ACTIVATION_SCHEMA_VERSION,
  REQUIRED_NATIVE_BUILD_ID,
  RUNTIME_HEALTH,
  createCodexActivationStore
} = require("../src/modules/activation/codex-activation-store");

const retainedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-codex-activation-v2-"));

function dataDir(name) {
  const dir = path.join(retainedRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

function assertNoRawEvidence(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    "SECRET_PROMPT_BODY",
    "SECRET_API_KEY",
    "C:\\\\Users\\\\private\\\\project",
    "SECRET_WINDOW_TITLE",
    "rawEvidence",
    "lastEventId",
    "completionEventId",
    "completionSignature",
    "nativeBuildId"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public value leaked ${forbidden}`);
  }
}

assert.equal(CODEX_ACTIVATION_SCHEMA_VERSION, "codex-activation@2");
assert.deepEqual(CODEX_ACTIVATION_PROGRESS, [
  "not_started",
  "configuring",
  "model_ready",
  "awaiting_codex_loop",
  "activated"
]);
assert.deepEqual(RUNTIME_HEALTH, ["healthy", "repairing", "needs_repair"]);
assert.equal(REQUIRED_NATIVE_BUILD_ID, "phase3-native-sidecar-20260719-r18");

const newUserDir = dataDir("new-user");
const phase3Sentinel = `${JSON.stringify({ schemaVersion: "phase3-activation@1", marker: "untouched" }, null, 2)}\n`;
fs.writeFileSync(path.join(newUserDir, "activation.json"), phase3Sentinel, "utf8");
const newUser = createCodexActivationStore(newUserDir, {
  now: () => "2026-07-19T00:00:00.000Z"
});

assert.equal(newUser.file, path.join(newUserDir, "activation-v2.json"));
assert.equal(fs.existsSync(newUser.file), true);
assert.equal(fs.readFileSync(path.join(newUserDir, "activation.json"), "utf8"), phase3Sentinel);
assert.deepEqual(newUser.getStatus(), {
  schemaVersion: "codex-activation@2",
  progress: "not_started",
  runtimeHealth: "healthy",
  provider: "",
  modelTestedAt: "",
  legacyActivated: false,
  legacySummary: null,
  codexVerified: false,
  completedAt: "",
  reason: "codex_activation_not_started",
  nextAction: "configure_provider",
  privacy: {
    promptTextNotStored: true,
    draftTextNotStored: true,
    targetInputTextNotStored: true,
    clipboardTextNotStored: true,
    projectPathNotStored: true,
    rawTitleNotStored: true,
    apiKeyNotStored: true,
    evidencePayloadNotExposed: true,
    noAutoSubmitRequired: true
  }
});

newUser.setProgress("configuring", { provider: "agnes" });
expectCode(
  () => newUser.setProgress("model_ready"),
  "activation_model_test_required"
);
expectCode(
  () => newUser.recordModelReady({ provider: "agnes", testedAt: "not-a-timestamp" }),
  "invalid_activation_timestamp"
);
newUser.recordModelReady({ provider: "agnes", testedAt: "2026-07-19T00:00:00.000Z" });
assert.equal(newUser.getStatus().progress, "model_ready");
newUser.markCodexLoopStarted();
assert.equal(newUser.getStatus().progress, "awaiting_codex_loop");

const migratedDir = dataDir("legacy-activated");
fs.writeFileSync(path.join(migratedDir, "activation.json"), phase3Sentinel, "utf8");
let now = "2026-07-19T00:00:02.000Z";
const phase3Snapshot = {
  schemaVersion: "phase3-activation@1",
  progress: "activated",
  runtimeHealth: "healthy",
  provider: "custom-provider:tenant_7",
  modelTestedAt: "2026-07-19T00:00:00.000Z",
  completionKind: "verified_insert",
  completionVerified: true,
  completedAt: "2026-07-18T23:59:00.000Z",
  lastEventId: "activation-verified_insert-1784419140000",
  prompt: "SECRET_PROMPT_BODY",
  apiKey: "SECRET_API_KEY",
  projectPath: "C:\\Users\\private\\project",
  rawTitle: "SECRET_WINDOW_TITLE",
  rawEvidence: { text: "SECRET_PROMPT_BODY" }
};
const activation = createCodexActivationStore(migratedDir, {
  now: () => now,
  phase3Snapshot
});

const migrated = activation.getStatus();
assert.equal(migrated.schemaVersion, "codex-activation@2");
assert.equal(migrated.progress, "model_ready");
assert.equal(migrated.provider, "custom-provider:tenant_7");
assert.equal(migrated.modelTestedAt, "2026-07-19T00:00:00.000Z");
assert.equal(migrated.legacyActivated, true);
assert.equal(migrated.codexVerified, false);
assert.deepEqual(migrated.legacySummary, {
  schemaVersion: "phase3-activation@1",
  progress: "activated",
  runtimeHealth: "healthy",
  completionKind: "verified_insert",
  completionVerified: true,
  completedAt: "2026-07-18T23:59:00.000Z"
});
assert.equal(migrated.reason, "model_ready_codex_verification_required");
assert.equal(migrated.nextAction, "start_codex_loop");
assertNoRawEvidence(migrated);
assert.equal(fs.readFileSync(path.join(migratedDir, "activation.json"), "utf8"), phase3Sentinel);

const migratedRawBefore = fs.readFileSync(activation.file, "utf8");
now = "2026-07-19T00:01:00.000Z";
const repeatedMigration = activation.initializeFromPhase3({
  ...phase3Snapshot,
  provider: "openai-compatible",
  progress: "not_started"
});
assert.equal(repeatedMigration.provider, "custom-provider:tenant_7");
assert.equal(repeatedMigration.legacyActivated, true);
assert.equal(fs.readFileSync(activation.file, "utf8"), migratedRawBefore);

activation.setRuntimeHealth("needs_repair", { errorCode: "SECRET_PROVIDER_FAILURE" });
assert.equal(activation.getStatus().progress, "model_ready");
assert.equal(activation.getStatus().legacyActivated, true);
assert.equal(activation.getStatus().reason, "runtime_needs_repair");
assert.equal(activation.getStatus().nextAction, "repair_runtime");
assertNoRawEvidence(activation.getStatus());
activation.setRuntimeHealth("healthy");
activation.markCodexLoopStarted();

const validCompletion = {
  eventId: "activation-verified_insert-1784419201000",
  target: "codex",
  completionKind: "verified_insert",
  targetKind: "codex-composer",
  stableReadback: true,
  verified: true,
  noAutoSubmit: true,
  nativeBuildId: "phase3-native-sidecar-20260719-r18",
  prompt: "SECRET_PROMPT_BODY",
  apiKey: "SECRET_API_KEY",
  projectPath: "C:\\Users\\private\\project",
  rawTitle: "SECRET_WINDOW_TITLE",
  rawEvidence: { text: "SECRET_PROMPT_BODY" }
};

expectCode(
  () => activation.complete({
    ...validCompletion,
    eventId: "activation-verified_insert-1784419200000"
  }),
  "invalid_activation_event_id"
);
expectCode(
  () => activation.complete({
    ...validCompletion,
    eventId: "activation-copy-1784419201000"
  }),
  "invalid_activation_event_id"
);

for (const invalidCompletion of [
  { ...validCompletion, target: "chatgpt" },
  { ...validCompletion, site: "chatgpt" },
  { ...validCompletion, completionKind: "copy" },
  { ...validCompletion, completionKind: "manual_confirmation" },
  { ...validCompletion, targetKind: "chatgpt-composer" },
  { ...validCompletion, stableReadback: false },
  { ...validCompletion, verified: false },
  { ...validCompletion, noAutoSubmit: false },
  { ...validCompletion, nativeBuildId: "phase3-native-sidecar-stale" },
  { ...validCompletion, nativeBuildId: "", extensionBuildId: REQUIRED_NATIVE_BUILD_ID }
]) {
  expectCode(
    () => activation.complete(invalidCompletion),
    "invalid_codex_activation_evidence"
  );
}

const completed = activation.complete(validCompletion);
assert.equal(completed.progress, "activated");
assert.equal(completed.codexVerified, true);
assert.equal(completed.legacyActivated, true);
assert.equal(completed.reason, "codex_activation_complete");
assert.equal(completed.nextAction, "open_assistant");
assertNoRawEvidence(completed);

const persisted = fs.readFileSync(activation.file, "utf8");
for (const forbidden of [
  "SECRET_PROMPT_BODY",
  "SECRET_API_KEY",
  "C:\\\\Users\\\\private\\\\project",
  "SECRET_WINDOW_TITLE",
  "rawEvidence",
  "SECRET_PROVIDER_FAILURE"
]) {
  assert.equal(persisted.includes(forbidden), false, `persisted state leaked ${forbidden}`);
}

activation.setRuntimeHealth("needs_repair", { errorCode: "network_unavailable" });
assert.equal(activation.getStatus().progress, "activated");
assert.equal(activation.getStatus().codexVerified, true);
assert.equal(activation.getStatus().runtimeHealth, "needs_repair");
const repeatedCompletion = activation.complete(validCompletion);
assert.deepEqual(repeatedCompletion, activation.getStatus());
assert.equal(repeatedCompletion.runtimeHealth, "needs_repair");

expectCode(
  () => activation.complete({ ...validCompletion, noAutoSubmit: false }),
  "activation_completion_conflict"
);
expectCode(
  () => activation.complete({
    ...validCompletion,
    eventId: "activation-verified_insert-1784419202000"
  }),
  "activation_completion_conflict"
);

const restarted = createCodexActivationStore(migratedDir, {
  now: () => "2026-07-19T00:05:00.000Z",
  phase3Snapshot: { ...phase3Snapshot, provider: "gemini" }
});
assert.deepEqual(restarted.complete(validCompletion), activation.getStatus());
assert.equal(restarted.getStatus().provider, "custom-provider:tenant_7");

const reset = restarted.resetProgress();
assert.equal(reset.progress, "not_started");
assert.equal(reset.codexVerified, false);
assert.equal(reset.completedAt, "");
assert.equal(reset.modelTestedAt, "");
assert.equal(reset.provider, "custom-provider:tenant_7");
assert.equal(reset.legacyActivated, true);
assert.deepEqual(reset.legacySummary, migrated.legacySummary);
assert.equal(reset.runtimeHealth, "needs_repair");
assert.equal(reset.reason, "runtime_needs_repair");

const afterResetRestart = createCodexActivationStore(migratedDir, {
  now: () => "2026-07-19T00:06:00.000Z",
  phase3Snapshot
});
assert.equal(afterResetRestart.getStatus().progress, "not_started");
assert.equal(afterResetRestart.getStatus().provider, "custom-provider:tenant_7");
assert.equal(afterResetRestart.getStatus().legacyActivated, true);
assert.equal(fs.readFileSync(path.join(migratedDir, "activation.json"), "utf8"), phase3Sentinel);

const providerOnly = createCodexActivationStore(dataDir("provider-only"), {
  now: () => "2026-07-19T01:00:00.000Z"
});
providerOnly.initializeFromPhase3({
  schemaVersion: "phase3-activation@1",
  progress: "awaiting_first_loop",
  runtimeHealth: "repairing",
  provider: "openai-compatible"
});
assert.equal(providerOnly.getStatus().progress, "configuring");
assert.equal(providerOnly.getStatus().provider, "openai-compatible");
assert.equal(providerOnly.getStatus().legacyActivated, false);
assert.equal(providerOnly.getStatus().runtimeHealth, "repairing");
assert.equal(providerOnly.getStatus().reason, "runtime_repairing");
assert.equal(providerOnly.getStatus().nextAction, "wait_for_runtime");

const validReasons = new Set([
  "codex_activation_not_started",
  "provider_configuration_required",
  "model_ready_codex_verification_required",
  "codex_verification_required",
  "codex_activation_complete",
  "runtime_repairing",
  "runtime_needs_repair"
]);
const validActions = new Set([
  "configure_provider",
  "test_model",
  "start_codex_loop",
  "complete_codex_loop",
  "open_assistant",
  "wait_for_runtime",
  "repair_runtime"
]);
for (const status of [newUser.getStatus(), migrated, completed, reset, providerOnly.getStatus()]) {
  assert.equal(validReasons.has(status.reason), true);
  assert.equal(validActions.has(status.nextAction), true);
  assertNoRawEvidence(status);
}

console.log(`codex activation v2 tests passed; retained temp root: ${retainedRoot}`);
