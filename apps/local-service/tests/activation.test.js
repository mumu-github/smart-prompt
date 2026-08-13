const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createActivationStore } = require("../src/modules/activation/activation-store");
const { createStore } = require("../src/store");
const { normalizeProviderError } = require("../src/server");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

const dataDir = tempDir("smart-prompt-activation-");
const activation = createActivationStore(dataDir, {
  now: () => "2026-07-17T00:00:00.000Z"
});

assert.equal(activation.getStatus().progress, "not_started");
assert.equal(activation.getStatus().runtimeHealth, "healthy");

assert.throws(
  () => activation.setProgress("activated"),
  (error) => error.code === "invalid_activation_transition"
);
assert.equal(activation.getStatus().nextAction, "configure_provider");

activation.setProgress("configuring", { provider: "openai-compatible" });
assert.throws(
  () => activation.markBrowserSeen({ site: "chatgpt", seenAt: "2026-07-17T00:00:00.500Z" }),
  (error) => error.code === "activation_not_ready_for_browser_seen"
);
activation.recordModelReady({ provider: "openai-compatible", model: "gpt-test" });
assert.equal(activation.getStatus().progress, "model_ready");
assert.equal(activation.getStatus().runtimeHealth, "healthy");
assert.equal(Object.hasOwn(activation.getStatus(), "model"), false);
assert.throws(
  () => activation.complete({ site: "chatgpt", completionKind: "verified_insert", targetKind: "chatgpt-composer", verified: true }),
  (error) => error.code === "activation_not_ready_for_completion"
);
assert.throws(
  () => activation.markBrowserSeen({ site: "chatgpt", seenAt: "SECRET_TIMESTAMP_PAYLOAD" }),
  (error) => error.code === "invalid_activation_timestamp"
);
activation.markBrowserSeen({ site: "chatgpt", seenAt: "2026-07-17T00:00:01.000Z" });
assert.equal(activation.getStatus().progress, "awaiting_first_loop");

assert.throws(
  () => activation.complete({
    eventId: "activation-verified_insert-1784246400000",
    site: "chatgpt",
    completionKind: "verified_insert",
    targetKind: "chatgpt-composer",
    verified: true,
    stableReadback: true,
    extensionBuildId: "phase3-extension-20260717-r5"
  }),
  (error) => error.code === "invalid_activation_event_id"
);

assert.throws(
  () => activation.complete({
    eventId: "activation-verified_insert-1784246399999",
    site: "chatgpt",
    completionKind: "verified_insert",
    targetKind: "chatgpt-composer",
    verified: true,
    stableReadback: true,
    extensionBuildId: "phase3-extension-20260717-r5"
  }),
  (error) => error.code === "invalid_activation_event_id"
);
assert.throws(
  () => activation.complete({
    eventId: "activation-copy-1784246401000",
    site: "chatgpt",
    completionKind: "verified_insert",
    targetKind: "chatgpt-composer",
    verified: true,
    stableReadback: true,
    extensionBuildId: "phase3-extension-20260717-r5"
  }),
  (error) => error.code === "invalid_activation_event_id"
);

assert.throws(
  () => activation.complete({
    eventId: "activation-verified_insert-1784246401000",
    site: "chatgpt",
    completionKind: "verified_insert",
    targetKind: "chatgpt-composer",
    verified: true,
    stableReadback: false,
    extensionBuildId: "phase3-extension-20260717-r5"
  }),
  (error) => error.code === "invalid_activation_completion_evidence"
);
assert.throws(
  () => activation.complete({
    eventId: "activation-verified_insert-1784246401000",
    site: "chatgpt",
    completionKind: "verified_insert",
    targetKind: "chatgpt-composer",
    verified: true,
    stableReadback: true,
    extensionBuildId: "phase3-extension-20260717-stale"
  }),
  (error) => error.code === "invalid_activation_completion_evidence"
);

const completed = activation.complete({
  eventId: "activation-verified_insert-1784246401000",
  site: "chatgpt",
  completionKind: "verified_insert",
  targetKind: "chatgpt-composer",
  verified: true,
  stableReadback: true,
  extensionBuildId: "phase3-extension-20260717-r5"
});
assert.equal(completed.progress, "activated");
assert.equal(completed.completionKind, "verified_insert");

activation.setRuntimeHealth("needs_repair", { errorCode: "network_unavailable" });
assert.equal(activation.getStatus().progress, "activated");
assert.equal(activation.getStatus().runtimeHealth, "needs_repair");

const repeated = activation.complete({
  eventId: "activation-verified_insert-1784246401000",
  site: "chatgpt",
  completionKind: "verified_insert",
  targetKind: "chatgpt-composer",
  verified: true,
  stableReadback: true,
  extensionBuildId: "phase3-extension-20260717-r5"
});
assert.deepEqual(repeated, activation.getStatus());

const copyActivation = createActivationStore(tempDir("smart-prompt-activation-copy-"), {
  now: () => "2026-07-17T00:00:00.000Z"
});
copyActivation.setProgress("configuring", { provider: "gemini" });
copyActivation.recordModelReady({ provider: "gemini", model: "gemini-test" });
copyActivation.setProgress("awaiting_first_loop");
const copyCompleted = copyActivation.complete({
  eventId: "activation-copy-1784246402000",
  site: "chatgpt",
  completionKind: "copy",
  extensionBuildId: "phase3-extension-20260717-r5",
  copied: true
});
assert.equal(copyCompleted.progress, "activated");
assert.equal(copyCompleted.completionKind, "copy");
assert.equal(copyCompleted.completionVerified, false);

const reset = activation.resetProgress();
assert.equal(reset.progress, "not_started");
assert.equal(reset.runtimeHealth, "healthy");
assert.equal(reset.provider, "openai-compatible");

const raw = fs.readFileSync(path.join(dataDir, "activation.json"), "utf8");
assert.ok(!raw.includes("Prompt"));
assert.ok(!raw.includes("clipboard"));
assert.ok(!raw.includes("raw"));
assert.equal(raw.includes("gpt-test"), false);

const pollutedDir = tempDir("smart-prompt-activation-polluted-");
fs.writeFileSync(path.join(pollutedDir, "activation.json"), JSON.stringify({
  progress: "not_started",
  prompt: "SECRET_PROMPT",
  clipboard: "SECRET_CLIPBOARD",
  rawTitle: "SECRET_TITLE"
}));
const sanitizedActivation = createActivationStore(pollutedDir);
sanitizedActivation.getStatus();
const sanitizedRaw = fs.readFileSync(path.join(pollutedDir, "activation.json"), "utf8");
assert.equal(sanitizedRaw.includes("SECRET_PROMPT"), false);
assert.equal(sanitizedRaw.includes("SECRET_CLIPBOARD"), false);
assert.equal(sanitizedRaw.includes("SECRET_TITLE"), false);

const serviceStore = createStore(tempDir("smart-prompt-activation-service-"));
assert.equal(serviceStore.getActivationStatus().progress, "not_started");
serviceStore.setActivationProgress("configuring", { provider: "anthropic" });
serviceStore.recordActivationModelReady({ provider: "anthropic", model: "claude-test" });
assert.equal(serviceStore.getActivationStatus().progress, "model_ready");

const privacyDir = tempDir("smart-prompt-activation-privacy-");
const privacyKey = "PHASE3_PRIVATE_KEY_SHOULD_NOT_LEAK";
fs.writeFileSync(path.join(privacyDir, "settings.json"), JSON.stringify({
  provider: "openai-compatible",
  model: "gpt-privacy-test"
}));
const privacyStore = createStore(privacyDir, {
  credentialVault: {
    loadProviderKeys: () => ({ "openai-compatible": privacyKey }),
    saveProviderKeys: () => {},
    getStorageSummary: () => ({ storage: "test" })
  }
});
const privacySurfaces = JSON.stringify({
  activation: privacyStore.getActivationStatus(),
  diagnostics: privacyStore.exportDiagnostics(),
  activationFile: fs.readFileSync(path.join(privacyDir, "activation.json"), "utf8")
});
assert.equal(privacySurfaces.includes(privacyKey), false);
assert.equal(privacyStore.getActivationStatus().privacy.apiKeyNotStored, true);

const legacyActivatedDir = tempDir("smart-prompt-activation-legacy-activated-");
fs.writeFileSync(path.join(legacyActivatedDir, "settings.json"), JSON.stringify({
  provider: "openai-compatible",
  model: "gpt-legacy"
}));
fs.writeFileSync(path.join(legacyActivatedDir, "metrics.json"), JSON.stringify([{
  id: "legacy-browser-insert-1",
  action: "insert",
  site: "chatgpt.com",
  source: "browser-extension",
  verified: true,
  adopted: true
}]));
const legacyVault = {
  loadProviderKeys: () => ({ "openai-compatible": "legacy-test-key" }),
  saveProviderKeys: () => {},
  getStorageSummary: () => ({ storage: "test" })
};
const legacyActivatedStore = createStore(legacyActivatedDir, { credentialVault: legacyVault });
assert.equal(legacyActivatedStore.getActivationStatus().progress, "activated");
assert.equal(legacyActivatedStore.getActivationStatus().completionKind, "verified_insert");

const legacyDesktopAttemptDir = tempDir("smart-prompt-activation-legacy-desktop-attempt-");
fs.writeFileSync(path.join(legacyDesktopAttemptDir, "settings.json"), JSON.stringify({
  provider: "openai-compatible",
  model: "gpt-desktop-legacy"
}));
fs.writeFileSync(path.join(legacyDesktopAttemptDir, "metrics.json"), JSON.stringify([{
  id: "legacy-desktop-attempt-1",
  action: "insert",
  site: "chatgpt.com",
  source: "desktop-shell",
  attempted: true,
  pass: true,
  verified: true,
  adopted: true
}]));
const legacyDesktopAttemptStore = createStore(legacyDesktopAttemptDir, {
  credentialVault: {
    loadProviderKeys: () => ({ "openai-compatible": "legacy-test-key" }),
    saveProviderKeys: () => {},
    getStorageSummary: () => ({ storage: "test" })
  }
});
assert.equal(legacyDesktopAttemptStore.getActivationStatus().progress, "awaiting_first_loop");
assert.equal(legacyDesktopAttemptStore.getActivationStatus().completionKind, "");

const legacyDesktopCopyDir = tempDir("smart-prompt-activation-legacy-desktop-copy-");
fs.writeFileSync(path.join(legacyDesktopCopyDir, "settings.json"), JSON.stringify({
  provider: "gemini",
  model: "gemini-desktop-legacy"
}));
fs.writeFileSync(path.join(legacyDesktopCopyDir, "metrics.json"), JSON.stringify([{
  id: "legacy-desktop-copy-1",
  action: "copy",
  site: "chatgpt.com",
  source: "desktop-shell",
  ok: true,
  verified: true
}]));
const legacyDesktopCopyStore = createStore(legacyDesktopCopyDir, {
  credentialVault: {
    loadProviderKeys: () => ({ gemini: "legacy-test-key" }),
    saveProviderKeys: () => {},
    getStorageSummary: () => ({ storage: "test" })
  }
});
assert.equal(legacyDesktopCopyStore.getActivationStatus().progress, "awaiting_first_loop");
assert.equal(legacyDesktopCopyStore.getActivationStatus().completionKind, "");

const legacyAwaitingDir = tempDir("smart-prompt-activation-legacy-awaiting-");
fs.writeFileSync(path.join(legacyAwaitingDir, "settings.json"), JSON.stringify({
  provider: "anthropic",
  model: "claude-legacy"
}));
const legacyAwaitingStore = createStore(legacyAwaitingDir, {
  credentialVault: {
    loadProviderKeys: () => ({ anthropic: "legacy-test-key" }),
    saveProviderKeys: () => {},
    getStorageSummary: () => ({ storage: "test" })
  }
});
assert.equal(legacyAwaitingStore.getActivationStatus().progress, "awaiting_first_loop");
assert.equal(legacyAwaitingStore.getActivationStatus().completionVerified, false);

const legacyConfiguringDir = tempDir("smart-prompt-activation-legacy-configuring-");
fs.writeFileSync(path.join(legacyConfiguringDir, "settings.json"), JSON.stringify({
  provider: "auto",
  model: "gpt-4o-mini"
}));
const legacyConfiguringStore = createStore(legacyConfiguringDir, {
  credentialVault: {
    loadProviderKeys: () => ({}),
    saveProviderKeys: () => {},
    getStorageSummary: () => ({ storage: "test" })
  }
});
assert.equal(legacyConfiguringStore.getActivationStatus().progress, "configuring");

const resetDir = tempDir("smart-prompt-activation-reset-");
const resetStore = createStore(resetDir);
resetStore.addPrompt({ title: "Reset me", body: "local-only" });
resetStore.setActivationProgress("configuring", { provider: "gemini" });
fs.writeFileSync(path.join(resetDir, "provider-keys-sidecar.json"), JSON.stringify({ encrypted: true }));
fs.mkdirSync(path.join(resetDir, "logs"), { recursive: true });
fs.writeFileSync(path.join(resetDir, "logs", "sidecar.log"), "retained reset marker\n");
const resetResult = resetStore.clearAllLocalData();
assert.equal(resetResult.clearAllLocalData, true);
assert.equal(resetResult.resetMode, "recoverable");
assert.ok(resetResult.recoveryId);
assert.ok(resetResult.moved.includes("prompts.json"));
assert.ok(resetResult.moved.includes("provider-keys-sidecar.json"));
assert.ok(resetResult.moved.includes("logs"));
assert.ok(fs.existsSync(resetResult.recoveryDirectory));
assert.equal(fs.existsSync(path.join(resetResult.recoveryDirectory, "prompts.json")), true);
assert.equal(fs.existsSync(path.join(resetResult.recoveryDirectory, "provider-keys-sidecar.json")), true);
assert.equal(fs.existsSync(path.join(resetResult.recoveryDirectory, "logs", "sidecar.log")), true);
assert.equal(resetStore.getPrompts().length, 0);
assert.equal(resetStore.getActivationStatus().progress, "not_started");

assert.equal(normalizeProviderError({ status: 401, message: "secret leaked" }).code, "credential_invalid");
assert.equal(normalizeProviderError({ status: 404, message: "model missing" }).code, "model_unavailable");
assert.equal(normalizeProviderError({ status: 404, message: "route not found" }).code, "provider_error");
const modelBodyError = normalizeProviderError({
  status: 400,
  message: "LLM request failed.",
  body: '{"error":{"message":"The model private-model-name does not exist"}}'
});
assert.equal(modelBodyError.code, "model_unavailable");
assert.equal(modelBodyError.message.includes("private-model-name"), false);
assert.equal(normalizeProviderError({
  status: 400,
  message: "LLM request failed.",
  body: '{"error":{"message":"invalid model"}}'
}).code, "model_unavailable");
assert.equal(normalizeProviderError({ code: "ETIMEDOUT", message: "provider timeout" }).code, "network_unavailable");
assert.equal(normalizeProviderError({ code: "unknown", message: "raw provider response" }).code, "provider_error");
assert.equal(normalizeProviderError({ code: "unknown", message: "raw provider response" }).message.includes("raw"), false);

console.log("activation contract tests passed");
