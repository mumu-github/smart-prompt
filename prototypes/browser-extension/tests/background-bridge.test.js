const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
const listeners = [];
const requests = [];

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

const sandbox = {
  URL,
  chrome: {
    runtime: {
      onMessage: {
        addListener(handler) {
          listeners.push(handler);
        }
      }
    }
  },
  fetch: async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/auth/bootstrap")) return response({ ok: true, auth: { token: "bridge-test-token" } });
    if (url.endsWith("/generate")) return response({ ok: true, generatedBy: "bridge" });
    if (url.endsWith("/activation/browser-seen")) return response({ ok: true, activation: { progress: "awaiting_first_loop" } });
    if (url.endsWith("/activation/complete")) return response({ ok: true, activation: { progress: "activated" } });
    throw new Error(`Unexpected bridge URL: ${url}`);
  }
};
vm.runInNewContext(source, sandbox, { filename: "background.js" });
assert.equal(listeners.length, 1);
const handleMessage = listeners[0];

function invoke(message, sender) {
  return new Promise((resolve) => {
    const keepChannelOpen = handleMessage(message, sender, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

(async () => {
  const generated = await invoke({
    type: "smart-prompt-service-request",
    method: "POST",
    path: "/generate",
    serviceUrl: "http://127.0.0.1:17372",
    body: { input: "synthetic bridge input" }
  }, { tab: { id: 1, url: "https://chatgpt.com/" } });
  assert.equal(generated.generatedBy, "bridge");
  assert.deepEqual(requests.map((request) => request.url), [
    "http://127.0.0.1:17371/auth/bootstrap",
    "http://127.0.0.1:17371/generate"
  ]);
  assert.equal(requests[1].options.headers.Authorization, "Bearer bridge-test-token");

  const authRoute = await invoke({
    type: "smart-prompt-service-request",
    method: "GET",
    path: "/auth/bootstrap",
    serviceUrl: "http://127.0.0.1:17371"
  }, { tab: { id: 1, url: "https://chatgpt.com/" } });
  assert.equal(authRoute.ok, false);
  assert.equal(authRoute.error.code, "service_route_not_allowed");

  const foreignActivation = await invoke({
    type: "smart-prompt-activation",
    action: "browser-seen",
    payload: { site: "chatgpt" }
  }, { tab: { id: 1, url: "https://example.com/" } });
  assert.equal(foreignActivation.ok, false);
  assert.equal(foreignActivation.error.code, "activation_sender_not_chatgpt");
  assert.equal(requests.length, 2);

  const activationComplete = await invoke({
    type: "smart-prompt-activation",
    action: "complete",
    payload: {
      eventId: "activation-verified_insert-1784246401000",
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      extensionBuildId: "phase3-extension-20260717-r5",
      stableReadback: true,
      verified: true
    }
  }, { tab: { id: 1, url: "https://chatgpt.com/" } });
  assert.equal(activationComplete.activation.progress, "activated");
  const activationRequest = requests.find((request) => request.url.endsWith("/activation/complete"));
  const activationBody = JSON.parse(activationRequest.options.body);
  assert.equal(activationBody.extensionBuildId, "phase3-extension-20260717-r5");
  assert.equal(activationBody.stableReadback, true);

  console.log("background bridge tests passed");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
