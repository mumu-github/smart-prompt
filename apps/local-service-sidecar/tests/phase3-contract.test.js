const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const sidecarRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(sidecarRoot, "Cargo.toml");
const testTargetDir = path.join(os.tmpdir(), "smart-prompt-native-phase3-test-target");
const binaryPath = path.join(
  testTargetDir,
  "debug",
  process.platform === "win32" ? "local-service-sidecar.exe" : "local-service-sidecar"
);
const trustedExtensionOrigin = "chrome-extension://fnpfpobenlbgdkjadiaeopdpnodeegpj";
const trustedTauriOrigin = "http://tauri.localhost";
const activationContract = "phase3-activation@1";
const runtimeContract = "phase3-native-runtime@1";
const nativeBuildId = "phase3-native-sidecar-20260719-r18";

function retainedTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function buildSidecar() {
  const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
  const result = spawnSync(cargo, ["build", "--manifest-path", manifestPath, "--target-dir", testTargetDir], {
    cwd: sidecarRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `sidecar build failed\n${result.stderr || result.stdout}`);
}

buildSidecar();

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startSidecar({ dataDir, port }) {
  return spawn(binaryPath, [], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      SMART_PROMPT_DATA_DIR: dataDir,
      SMART_PROMPT_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}

async function stopExactChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 1500))
  ]);
  if (!exited && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

async function waitForHealth(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // The native sidecar is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`native sidecar did not become healthy on ${port}`);
}

async function requestJson(port, method, pathname, { body, origin, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    allowOrigin: response.headers.get("access-control-allow-origin")
  };
}

async function startSyntheticProvider() {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: "Synthetic provider connectivity response." } }]
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startProviderErrorFixture(rawSentinel) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const authorization = String(request.headers.authorization || "");
      if (authorization.includes("invalid-key")) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: `${rawSentinel}: invalid api key` } }));
        return;
      }
      if (text.includes('"model":"missing-model"')) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: `${rawSentinel}: model not found` } }));
        return;
      }
      if (request.url.includes("/non-json/")) {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end(`${rawSentinel}: upstream returned html`);
        return;
      }
      if (request.url.includes("/fallback/")) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: `${rawSentinel}: temporarily unavailable` } }));
        return;
      }
      if (request.url.endsWith("/messages")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ content: [{ text: "Synthetic Anthropic response." }] }));
        return;
      }
      if (request.url.includes(":generateContent")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Synthetic Gemini response." }] } }]
        }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: "Synthetic provider connectivity response." } }]
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function bootstrapToken(port) {
  const bootstrap = await requestJson(port, "GET", "/auth/bootstrap", {
    origin: trustedTauriOrigin
  });
  assert.equal(bootstrap.status, 200);
  const token = bootstrap.body.auth?.token;
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 32);
  return token;
}

test("native sidecar enforces the phase 3 production contract", async (t) => {
  const dataDir = retainedTempDir("smart-prompt-native-phase3-");
  const port = await getFreePort();
  const provider = await startSyntheticProvider();
  const child = startSidecar({ dataDir, port });
  t.after(async () => {
    await stopExactChild(child);
    await provider.close();
  });

  const health = await waitForHealth(port);
  assert.equal(health.service, "smart-prompt-local-service");
  assert.equal(health.sidecar, "native");
  assert.equal(health.version, "0.5.0-native");
  assert.equal(health.activationContract, activationContract);
  assert.equal(health.runtimeContract, runtimeContract);
  assert.equal(health.buildId, nativeBuildId);

  const rejectedBootstrap = await requestJson(port, "GET", "/auth/bootstrap", {
    origin: "https://untrusted.example"
  });
  assert.equal(rejectedBootstrap.status, 403);
  assert.equal(rejectedBootstrap.body.error.code, "origin_not_allowed");
  assert.equal(rejectedBootstrap.allowOrigin, null);

  const localhostBootstrap = await requestJson(port, "GET", "/auth/bootstrap", {
    origin: "http://localhost:4444"
  });
  assert.equal(localhostBootstrap.status, 403);
  assert.equal(localhostBootstrap.body.error.code, "bootstrap_origin_not_allowed");
  assert.equal(localhostBootstrap.allowOrigin, null);

  const localhostBootstrapPreflight = await requestJson(port, "OPTIONS", "/auth/bootstrap", {
    origin: "http://127.0.0.1:4444"
  });
  assert.equal(localhostBootstrapPreflight.status, 403);
  assert.equal(localhostBootstrapPreflight.body.error.code, "bootstrap_origin_not_allowed");
  assert.equal(localhostBootstrapPreflight.allowOrigin, null);

  const bootstrap = await requestJson(port, "GET", "/auth/bootstrap", { origin: trustedTauriOrigin });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.allowOrigin, trustedTauriOrigin);
  const token = bootstrap.body.auth?.token;

  const earlyBrowserSeen = await requestJson(port, "POST", "/activation/browser-seen", {
    token,
    origin: trustedExtensionOrigin,
    body: { contractVersion: activationContract, site: "chatgpt" }
  });
  assert.equal(earlyBrowserSeen.status, 400);
  assert.equal(earlyBrowserSeen.body.error.code, "activation_not_ready_for_browser_seen");
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 32);

  const initial = await requestJson(port, "GET", "/activation/status", { token });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.activation.schemaVersion, activationContract);
  assert.equal(initial.body.activation.progress, "not_started");
  assert.equal(initial.body.activation.runtimeHealth, "healthy");

  const syntheticSecret = "PHASE3_NATIVE_DPAPI_SECRET_DO_NOT_LOG";
  const settings = await requestJson(port, "PUT", "/settings", {
    token,
    body: {
      settings: {
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        model: "synthetic-phase3-model",
        providerKeys: { "openai-compatible": syntheticSecret },
        uploadWholePage: true,
        autoSubmit: true
      }
    }
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.settings.uploadWholePage, false);
  assert.equal(settings.body.settings.autoSubmit, false);
  assert.equal(settings.body.settings.credentialStorage.encrypted, true);
  assert.equal(settings.body.settings.credentialStorage.storage, "windows-dpapi-current-user");
  assert.equal(settings.body.settings.providerKeys["openai-compatible"], "configured");
  assert.equal(JSON.stringify(settings.body).includes(syntheticSecret), false);

  const encryptedFile = path.join(dataDir, "provider-keys-sidecar.json");
  const encryptedText = fs.readFileSync(encryptedFile, "utf8");
  assert.equal(encryptedText.includes(syntheticSecret), false, "credential file contains plaintext");
  const encryptedDocument = JSON.parse(encryptedText);
  assert.equal(encryptedDocument.schemaVersion, "provider-keys-dpapi@1");
  assert.equal(encryptedDocument.storage, "windows-dpapi-current-user");

  const configured = await requestJson(port, "GET", "/activation/status", { token });
  assert.equal(configured.body.activation.progress, "configuring");

  const modelTest = await requestJson(port, "POST", "/llm/test", {
    token,
    body: { mode: "idea" }
  });
  assert.equal(modelTest.status, 200);
  assert.equal(modelTest.body.generatedBy, "llm");
  assert.equal(modelTest.body.autoSubmit, false);

  const modelReady = await requestJson(port, "GET", "/activation/status", { token });
  assert.equal(modelReady.body.activation.progress, "model_ready");
  const modelTestedAtMs = Date.parse(modelReady.body.activation.modelTestedAt);
  const currentActivationEventId = `activation-verified_insert-${Math.max(Date.now(), modelTestedAtMs + 1)}`;
  const equalActivationEventId = `activation-verified_insert-${modelTestedAtMs}`;
  const staleActivationEventId = `activation-verified_insert-${modelTestedAtMs - 1}`;

  const metric = await requestJson(port, "POST", "/metrics", {
    token,
    body: {
      event: {
        source: "browser-extension",
        site: "chatgpt",
        action: "card_ready",
        verified: true,
        promptLength: 42
      }
    }
  });
  assert.equal(metric.status, 200);
  const diagnostics = await requestJson(port, "GET", "/diagnostics/export", { token });
  assert.equal(diagnostics.status, 200);
  assert.equal(Object.hasOwn(diagnostics.body.diagnostics, "dataDir"), false);
  assert.equal(diagnostics.body.diagnostics.dataDirConfigured, true);
  assert.equal(diagnostics.body.diagnostics.counts.metrics, 1);
  assert.equal(
    diagnostics.body.diagnostics.counts.metrics,
    diagnostics.body.diagnostics.metrics.eventCount
  );

  const noOriginBrowserSeen = await requestJson(port, "POST", "/activation/browser-seen", {
    token,
    body: { contractVersion: activationContract, site: "chatgpt" }
  });
  assert.equal(noOriginBrowserSeen.status, 403);
  assert.equal(noOriginBrowserSeen.body.error.code, "activation_extension_origin_required");

  const browserSeen = await requestJson(port, "POST", "/activation/browser-seen", {
    token,
    origin: trustedExtensionOrigin,
    body: { contractVersion: activationContract, site: "chatgpt" }
  });
  assert.equal(browserSeen.status, 200);

  const equalActivationComplete = await requestJson(port, "POST", "/activation/complete", {
    token,
    origin: trustedExtensionOrigin,
    body: {
      contractVersion: activationContract,
      eventId: equalActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }
  });
  assert.equal(equalActivationComplete.status, 400);
  assert.equal(equalActivationComplete.body.error.code, "invalid_activation_event_id");
  assert.equal(browserSeen.body.activation.progress, "awaiting_first_loop");

  const staleComplete = await requestJson(port, "POST", "/activation/complete", {
    token,
    origin: trustedExtensionOrigin,
    body: {
      contractVersion: activationContract,
      eventId: staleActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }
  });
  assert.equal(staleComplete.status, 400);
  assert.equal(staleComplete.body.error.code, "invalid_activation_event_id");

  const mismatchedKindComplete = await requestJson(port, "POST", "/activation/complete", {
    token,
    origin: trustedExtensionOrigin,
    body: {
      contractVersion: activationContract,
      eventId: currentActivationEventId.replace("verified_insert", "copy"),
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }
  });
  assert.equal(mismatchedKindComplete.status, 400);
  assert.equal(mismatchedKindComplete.body.error.code, "invalid_activation_event_id");

  const invalidComplete = await requestJson(port, "POST", "/activation/complete", {
    token,
    origin: trustedExtensionOrigin,
    body: {
      contractVersion: activationContract,
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: false,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: false
    }
  });
  assert.equal(invalidComplete.status, 400);
  assert.equal(invalidComplete.body.error.code, "invalid_activation_completion_evidence");

  const staleExtensionComplete = await requestJson(port, "POST", "/activation/complete", {
    token,
    origin: trustedExtensionOrigin,
    body: {
      contractVersion: activationContract,
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-stale",
      verified: true
    }
  });
  assert.equal(staleExtensionComplete.status, 400);
  assert.equal(staleExtensionComplete.body.error.code, "invalid_activation_completion_evidence");

  const completed = await requestJson(port, "POST", "/activation/complete", {
    token,
    origin: trustedExtensionOrigin,
    body: {
      contractVersion: activationContract,
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.activation.progress, "activated");
  assert.equal(completed.body.activation.completionVerified, true);

  const repeated = await requestJson(port, "POST", "/activation/complete", {
    token,
    origin: trustedExtensionOrigin,
    body: {
      contractVersion: activationContract,
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body.activation, completed.body.activation);

  const repair = await requestJson(port, "POST", "/activation/runtime-health", {
    token,
    body: { runtimeHealth: "needs_repair", errorCode: "network_unavailable" }
  });
  assert.equal(repair.status, 200);
  assert.equal(repair.body.activation.progress, "activated");
  assert.equal(repair.body.activation.runtimeHealth, "needs_repair");

  const reset = await requestJson(port, "POST", "/activation/reset", { token, body: {} });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.activation.progress, "not_started");
  const providersAfterReset = await requestJson(port, "GET", "/llm/providers", { token });
  assert.ok(providersAfterReset.body.providers.some((item) =>
    item.provider === "openai-compatible" && item.keyAvailable === true
  ));
});

test("native sidecar normalizes provider failures and reports actual fallback provenance", async (t) => {
  const dataDir = retainedTempDir("smart-prompt-native-provider-errors-");
  const port = await getFreePort();
  const rawSentinel = "RAW_PROVIDER_SECRET_MUST_NOT_SURFACE";
  const provider = await startProviderErrorFixture(rawSentinel);
  const child = startSidecar({ dataDir, port });
  t.after(async () => {
    await stopExactChild(child);
    await provider.close();
  });
  await waitForHealth(port);
  const token = await bootstrapToken(port);

  const missingKey = await requestJson(port, "POST", "/llm/test", {
    token,
    body: { mode: "idea" }
  });
  assert.equal(missingKey.status, 502);
  assert.equal(missingKey.body.error.code, "credential_invalid");

  async function configure({ baseUrl, model, key }) {
    const response = await requestJson(port, "PUT", "/settings", {
      token,
      body: {
        settings: {
          provider: "openai-compatible",
          baseUrl,
          model,
          providerKeys: { "openai-compatible": key }
        }
      }
    });
    assert.equal(response.status, 200);
  }

  const invalidModelSettings = await requestJson(port, "PUT", "/settings", {
    token,
    body: {
      settings: {
        provider: "openai-compatible",
        baseUrl: `${provider.origin}/v1`,
        model: "invalid model id",
        providerKeys: { "openai-compatible": "valid-key" }
      }
    }
  });
  assert.equal(invalidModelSettings.status, 400);
  assert.equal(invalidModelSettings.body.error.code, "model_invalid");

  await configure({ baseUrl: `${provider.origin}/v1`, model: "stable-model", key: "valid-key" });
  const multiKeySettings = await requestJson(port, "PUT", "/settings", {
    token,
    body: {
      settings: {
        provider: "openai-compatible",
        baseUrl: `${provider.origin}/v1`,
        model: "stable-model",
        providerKeys: {
          "openai-compatible": "valid-key",
          anthropic: "anthropic-key"
        }
      }
    }
  });
  assert.equal(multiKeySettings.status, 200);
  const multiKeyProviderStatus = await requestJson(port, "GET", "/llm/providers", { token });
  assert.equal(multiKeyProviderStatus.status, 200);
  assert.equal(multiKeyProviderStatus.body.auto.provider, "anthropic");

  const rejectedCandidate = await requestJson(port, "POST", "/llm/test", {
    token,
    body: {
      mode: "idea",
      persistOnSuccess: true,
      settings: {
        provider: "openai-compatible",
        baseUrl: `${provider.origin}/v1`,
        model: "rejected-model",
        providerKeys: { "openai-compatible": "invalid-key" }
      }
    }
  });
  assert.equal(rejectedCandidate.status, 502);
  assert.equal(rejectedCandidate.body.error.code, "credential_invalid");
  const afterRejectedCandidate = await requestJson(port, "GET", "/settings", { token });
  assert.equal(afterRejectedCandidate.body.settings.model, "stable-model");
  assert.equal(afterRejectedCandidate.body.settings.providerKeys["openai-compatible"], "configured");
  const retainedCredentialTest = await requestJson(port, "POST", "/llm/test", {
    token,
    body: { mode: "idea" }
  });
  assert.equal(retainedCredentialTest.status, 200);

  const acceptedCandidate = await requestJson(port, "POST", "/llm/test", {
    token,
    body: {
      mode: "idea",
      persistOnSuccess: true,
      settings: {
        provider: "openai-compatible",
        baseUrl: `${provider.origin}/v1`,
        model: "accepted-model",
        providerKeys: { "openai-compatible": "accepted-key" }
      }
    }
  });
  assert.equal(acceptedCandidate.status, 200);
  assert.equal(acceptedCandidate.body.settingsPersisted, true);
  const afterAcceptedCandidate = await requestJson(port, "GET", "/settings", { token });
  assert.equal(afterAcceptedCandidate.body.settings.model, "accepted-model");

  await configure({ baseUrl: `${provider.origin}/v1`, model: "valid-model", key: "invalid-key" });
  const invalidCredential = await requestJson(port, "POST", "/llm/test", { token, body: { mode: "idea" } });
  assert.equal(invalidCredential.status, 502);
  assert.equal(invalidCredential.body.error.code, "credential_invalid");
  assert.equal(JSON.stringify(invalidCredential.body).includes(rawSentinel), false);

  await configure({ baseUrl: `${provider.origin}/v1`, model: "missing-model", key: "valid-key" });
  const missingModel = await requestJson(port, "POST", "/llm/test", { token, body: { mode: "idea" } });
  assert.equal(missingModel.status, 502);
  assert.equal(missingModel.body.error.code, "model_unavailable");
  assert.equal(JSON.stringify(missingModel.body).includes(rawSentinel), false);

  const customModelId = "vendor/custom-model:2026-07";
  await configure({ baseUrl: `${provider.origin}/v1`, model: customModelId, key: "valid-key" });
  const customModelTest = await requestJson(port, "POST", "/llm/test", { token, body: { mode: "idea" } });
  assert.equal(customModelTest.status, 200);
  assert.equal(customModelTest.body.model, customModelId);
  const customModelGeneration = await requestJson(port, "POST", "/generate", {
    token,
    body: {
      input: "Synthetic custom model check.",
      mode: "idea",
      allowTemplateFallback: false
    }
  });
  assert.equal(customModelGeneration.status, 200);
  assert.equal(customModelGeneration.body.card.model, customModelId);
  assert.equal(customModelGeneration.body.card.generatedBy, "llm");

  const customProviderCandidate = await requestJson(port, "POST", "/llm/test", {
    token,
    body: {
      mode: "idea",
      persistOnSuccess: true,
      settings: {
        provider: "custom",
        baseUrl: `${provider.origin}/v1`,
        model: "private/model-v2",
        customProvider: {
          name: "Team Gateway",
          protocol: "openai-compatible",
          baseUrl: `${provider.origin}/v1`,
          model: "private/model-v2"
        },
        providerKeys: { custom: "custom-provider-key" }
      }
    }
  });
  assert.equal(customProviderCandidate.status, 200);
  assert.equal(customProviderCandidate.body.provider, "custom");
  assert.equal(customProviderCandidate.body.model, "private/model-v2");
  assert.equal(customProviderCandidate.body.settingsPersisted, true);
  const customProviderSettings = await requestJson(port, "GET", "/settings", { token });
  assert.deepEqual(customProviderSettings.body.settings.customProvider, {
    name: "Team Gateway",
    protocol: "openai-compatible",
    baseUrl: `${provider.origin}/v1`,
    model: "private/model-v2"
  });
  assert.equal(customProviderSettings.body.settings.providerKeys.custom, "configured");
  const customProviderStatus = await requestJson(port, "GET", "/llm/providers", { token });
  assert.ok(customProviderStatus.body.providers.some((item) =>
    item.provider === "custom"
      && item.label === "Team Gateway"
      && item.keyAvailable === true
      && item.selected === true
  ));
  const customProviderGeneration = await requestJson(port, "POST", "/generate", {
    token,
    body: {
      input: "Synthetic custom provider check.",
      mode: "idea",
      allowTemplateFallback: false
    }
  });
  assert.equal(customProviderGeneration.status, 200);
  assert.equal(customProviderGeneration.body.card.provider, "custom");
  assert.equal(customProviderGeneration.body.card.model, "private/model-v2");

  for (const protocol of ["anthropic", "gemini"]) {
    const protocolCandidate = await requestJson(port, "POST", "/llm/test", {
      token,
      body: {
        mode: "idea",
        persistOnSuccess: false,
        settings: {
          provider: "custom",
          customProvider: {
            name: "Team Gateway",
            protocol,
            baseUrl: `${provider.origin}/v1`,
            model: "private-model-v2"
          }
        }
      }
    });
    assert.equal(protocolCandidate.status, 200);
    assert.equal(protocolCandidate.body.provider, "custom");
    assert.equal(protocolCandidate.body.model, "private-model-v2");
    assert.equal(protocolCandidate.body.settingsPersisted, false);
  }

  const invalidCustomProtocol = await requestJson(port, "POST", "/llm/test", {
    token,
    body: {
      mode: "idea",
      persistOnSuccess: true,
      settings: {
        provider: "custom",
        customProvider: {
          name: "Rejected Gateway",
          protocol: "unsupported-protocol",
          baseUrl: `${provider.origin}/v1`,
          model: "rejected-model"
        },
        providerKeys: { custom: "rejected-custom-key" }
      }
    }
  });
  assert.equal(invalidCustomProtocol.status, 400);
  assert.equal(invalidCustomProtocol.body.error.code, "custom_provider_protocol_invalid");
  const invalidCustomBaseUrl = await requestJson(port, "PUT", "/settings", {
    token,
    body: {
      settings: {
        provider: "custom",
        customProvider: {
          name: "Rejected Gateway",
          protocol: "openai-compatible",
          baseUrl: "file:///not-allowed",
          model: "rejected-model"
        }
      }
    }
  });
  assert.equal(invalidCustomBaseUrl.status, 400);
  assert.equal(invalidCustomBaseUrl.body.error.code, "custom_provider_base_url_invalid");
  const afterInvalidCustomProtocol = await requestJson(port, "GET", "/settings", { token });
  assert.equal(afterInvalidCustomProtocol.body.settings.customProvider.name, "Team Gateway");
  assert.equal(afterInvalidCustomProtocol.body.settings.providerKeys.custom, "configured");

  const unavailablePort = await getFreePort();
  await configure({ baseUrl: `http://127.0.0.1:${unavailablePort}/v1`, model: "valid-model", key: "valid-key" });
  const networkUnavailable = await requestJson(port, "POST", "/llm/test", { token, body: { mode: "idea" } });
  assert.equal(networkUnavailable.status, 502);
  assert.equal(networkUnavailable.body.error.code, "network_unavailable");

  await configure({ baseUrl: `${provider.origin}/non-json/v1`, model: "valid-model", key: "valid-key" });
  const invalidProviderBody = await requestJson(port, "POST", "/llm/test", { token, body: { mode: "idea" } });
  assert.equal(invalidProviderBody.status, 502);
  assert.equal(invalidProviderBody.body.error.code, "provider_error");
  assert.equal(JSON.stringify(invalidProviderBody.body).includes(rawSentinel), false);

  await configure({ baseUrl: `${provider.origin}/fallback/v1`, model: "valid-model", key: "valid-key" });
  const fallback = await requestJson(port, "POST", "/generate", {
    token,
    body: {
      input: "Synthetic activation fallback check.",
      mode: "idea",
      allowTemplateFallback: true
    }
  });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.card.generatedBy, "template-fallback");
  assert.equal(JSON.stringify(fallback.body).includes(rawSentinel), false);
  const logText = fs.readFileSync(path.join(dataDir, "logs", "sidecar.log"), "utf8");
  assert.equal(logText.includes(rawSentinel), false);
});

test("native sidecar resets local data by moving it into recoverable storage", async (t) => {
  const dataDir = retainedTempDir("smart-prompt-native-recoverable-reset-");
  const port = await getFreePort();
  const child = startSidecar({ dataDir, port });
  t.after(async () => {
    await stopExactChild(child);
  });
  await waitForHealth(port);
  const token = await bootstrapToken(port);

  const markerName = "reset-recovery-marker.json";
  const markerValue = { retained: true, schemaVersion: 1 };
  fs.writeFileSync(path.join(dataDir, markerName), JSON.stringify(markerValue), "utf8");
  const securityBefore = fs.readFileSync(path.join(dataDir, "security.json"), "utf8");

  const reset = await requestJson(port, "DELETE", "/data/all", { token });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.clearAllLocalData, true);
  assert.equal(reset.body.reset.resetMode, "recoverable");
  assert.equal(typeof reset.body.reset.recoveryId, "string");
  assert.ok(reset.body.reset.recoveryId.length > 0);
  assert.equal(typeof reset.body.reset.recoveryDirectory, "string");

  const recoveryDirectory = path.resolve(reset.body.reset.recoveryDirectory);
  const expectedRecoveryRoot = path.resolve(dataDir, ".recovery");
  assert.equal(path.dirname(recoveryDirectory), expectedRecoveryRoot);
  assert.equal(fs.existsSync(recoveryDirectory), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(recoveryDirectory, markerName), "utf8")),
    markerValue
  );
  assert.equal(fs.readFileSync(path.join(recoveryDirectory, "security.json"), "utf8"), securityBefore);
  assert.equal(fs.existsSync(path.join(dataDir, markerName)), false);

  const securityAfter = fs.readFileSync(path.join(dataDir, "security.json"), "utf8");
  assert.notEqual(securityAfter, securityBefore);
  const newToken = await bootstrapToken(port);
  assert.notEqual(newToken, token);
  const freshStatus = await requestJson(port, "GET", "/activation/status", { token: newToken });
  assert.equal(freshStatus.status, 200);
  assert.equal(freshStatus.body.activation.progress, "not_started");
});

test("native sidecar fails closed when its requested fixed port is occupied", async (t) => {
  const dataDir = retainedTempDir("smart-prompt-native-port-");
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const address = blocker.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const child = startSidecar({ dataDir, port });
  t.after(async () => {
    await stopExactChild(child);
    await new Promise((resolve) => blocker.close(resolve));
  });

  const exitCode = await Promise.race([
    new Promise((resolve) => child.once("exit", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve("still-running"), 2000))
  ]);
  assert.notEqual(exitCode, "still-running", "sidecar drifted to an adjacent port");
  assert.notEqual(exitCode, 0);
  assert.equal(fs.existsSync(path.join(dataDir, "sidecar-port.json")), false);
});

test("native sidecar migrates the three legacy activation paths without trusting desktop attempts", async (t) => {
  const children = [];
  t.after(async () => {
    for (const child of children) await stopExactChild(child);
  });

  const noProviderDir = retainedTempDir("smart-prompt-native-legacy-empty-");
  fs.writeFileSync(path.join(noProviderDir, "settings.json"), JSON.stringify({
    provider: "auto",
    model: "legacy-model",
    uploadWholePage: false,
    autoSubmit: false
  }), "utf8");
  const noProviderPort = await getFreePort();
  const noProviderChild = startSidecar({ dataDir: noProviderDir, port: noProviderPort });
  children.push(noProviderChild);
  await waitForHealth(noProviderPort);
  const noProviderToken = await bootstrapToken(noProviderPort);
  const noProviderStatus = await requestJson(noProviderPort, "GET", "/activation/status", {
    token: noProviderToken
  });
  assert.equal(noProviderStatus.body.activation.progress, "configuring");
  assert.equal(noProviderStatus.body.activation.completionKind, "");
  await stopExactChild(noProviderChild);

  const desktopAttemptDir = retainedTempDir("smart-prompt-native-legacy-desktop-");
  const desktopSyntheticSecret = "PHASE3_LEGACY_DESKTOP_SECRET_DO_NOT_LOG";
  fs.writeFileSync(path.join(desktopAttemptDir, "settings.json"), JSON.stringify({
    provider: "openai-compatible",
    model: "legacy-desktop-model"
  }), "utf8");
  fs.writeFileSync(path.join(desktopAttemptDir, "provider-keys-sidecar.json"), JSON.stringify({
    "openai-compatible": desktopSyntheticSecret
  }), "utf8");
  fs.writeFileSync(path.join(desktopAttemptDir, "metrics.json"), JSON.stringify([{
    source: "desktop-shell",
    site: "chatgpt",
    action: "insert",
    attempted: true,
    verified: true,
    pass: true
  }]), "utf8");
  const desktopAttemptPort = await getFreePort();
  const desktopAttemptChild = startSidecar({ dataDir: desktopAttemptDir, port: desktopAttemptPort });
  children.push(desktopAttemptChild);
  await waitForHealth(desktopAttemptPort);
  const desktopAttemptToken = await bootstrapToken(desktopAttemptPort);
  const desktopAttemptStatus = await requestJson(desktopAttemptPort, "GET", "/activation/status", {
    token: desktopAttemptToken
  });
  assert.equal(desktopAttemptStatus.body.activation.progress, "awaiting_first_loop");
  assert.equal(desktopAttemptStatus.body.activation.completionKind, "");
  const migratedCredentialText = fs.readFileSync(
    path.join(desktopAttemptDir, "provider-keys-sidecar.json"),
    "utf8"
  );
  assert.equal(migratedCredentialText.includes(desktopSyntheticSecret), false);
  assert.equal(JSON.parse(migratedCredentialText).schemaVersion, "provider-keys-dpapi@1");
  const recoveryText = fs.readFileSync(
    path.join(desktopAttemptDir, "provider-keys-sidecar.encrypted-recovery.json"),
    "utf8"
  );
  assert.equal(recoveryText.includes(desktopSyntheticSecret), false);
  assert.equal(JSON.parse(recoveryText).schemaVersion, "provider-keys-dpapi@1");
  await stopExactChild(desktopAttemptChild);

  const settingsCredentialDir = retainedTempDir("smart-prompt-native-legacy-settings-key-");
  const settingsSyntheticSecret = "PHASE3_LEGACY_SETTINGS_SECRET_DO_NOT_LOG";
  fs.writeFileSync(path.join(settingsCredentialDir, "settings.json"), JSON.stringify({
    provider: "anthropic",
    model: "legacy-settings-model",
    apiKey: settingsSyntheticSecret,
    providerKeys: { anthropic: settingsSyntheticSecret },
    uploadWholePage: true,
    autoSubmit: true
  }), "utf8");
  const settingsCredentialPort = await getFreePort();
  const settingsCredentialChild = startSidecar({
    dataDir: settingsCredentialDir,
    port: settingsCredentialPort
  });
  children.push(settingsCredentialChild);
  await waitForHealth(settingsCredentialPort);
  const settingsCredentialToken = await bootstrapToken(settingsCredentialPort);
  const settingsCredentialStatus = await requestJson(
    settingsCredentialPort,
    "GET",
    "/activation/status",
    { token: settingsCredentialToken }
  );
  assert.equal(settingsCredentialStatus.body.activation.progress, "awaiting_first_loop");
  const scrubbedSettingsText = fs.readFileSync(
    path.join(settingsCredentialDir, "settings.json"),
    "utf8"
  );
  assert.equal(scrubbedSettingsText.includes(settingsSyntheticSecret), false);
  const settingsCredentialText = fs.readFileSync(
    path.join(settingsCredentialDir, "provider-keys-sidecar.json"),
    "utf8"
  );
  assert.equal(settingsCredentialText.includes(settingsSyntheticSecret), false);
  assert.equal(JSON.parse(settingsCredentialText).schemaVersion, "provider-keys-dpapi@1");
  const settingsCredentialProviders = await requestJson(
    settingsCredentialPort,
    "GET",
    "/llm/providers",
    { token: settingsCredentialToken }
  );
  assert.ok(settingsCredentialProviders.body.providers.some((item) =>
    item.provider === "anthropic" && item.keyAvailable === true
  ));
  await stopExactChild(settingsCredentialChild);

  const browserVerifiedDir = retainedTempDir("smart-prompt-native-legacy-browser-");
  const browserSyntheticSecret = "PHASE3_LEGACY_BROWSER_SECRET_DO_NOT_LOG";
  fs.writeFileSync(path.join(browserVerifiedDir, "settings.json"), JSON.stringify({
    provider: "gemini",
    model: "legacy-browser-model"
  }), "utf8");
  fs.writeFileSync(path.join(browserVerifiedDir, "provider-keys-sidecar.json"), JSON.stringify({
    gemini: browserSyntheticSecret
  }), "utf8");
  fs.writeFileSync(path.join(browserVerifiedDir, "metrics.json"), JSON.stringify([{
    source: "browser-extension",
    site: "chatgpt",
    action: "insert",
    verified: true,
    createdAt: "2026-07-17T00:00:00.000Z"
  }]), "utf8");
  const browserVerifiedPort = await getFreePort();
  const browserVerifiedChild = startSidecar({ dataDir: browserVerifiedDir, port: browserVerifiedPort });
  children.push(browserVerifiedChild);
  await waitForHealth(browserVerifiedPort);
  const browserVerifiedToken = await bootstrapToken(browserVerifiedPort);
  const browserVerifiedStatus = await requestJson(browserVerifiedPort, "GET", "/activation/status", {
    token: browserVerifiedToken
  });
  assert.equal(browserVerifiedStatus.body.activation.progress, "activated");
  assert.equal(browserVerifiedStatus.body.activation.completionKind, "verified_insert");
  assert.equal(browserVerifiedStatus.body.activation.completionVerified, true);
  assert.equal(browserVerifiedStatus.body.activation.completedAt, "2026-07-17T00:00:00.000Z");
  const browserCredentialText = fs.readFileSync(
    path.join(browserVerifiedDir, "provider-keys-sidecar.json"),
    "utf8"
  );
  assert.equal(browserCredentialText.includes(browserSyntheticSecret), false);
});
