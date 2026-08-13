const assert = require("node:assert");
const localService = require("../src/local-service-client");

const calls = [];
const previousFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (url.endsWith("/auth/bootstrap")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, auth: { token: "activation-test-token" } });
      }
    };
  }
  if (url.endsWith("/activation/status")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, activation: { progress: "model_ready" } });
      }
    };
  }
  if (url.endsWith("/activation/browser-seen")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, activation: { progress: "awaiting_first_loop" } });
      }
    };
  }
  if (url.endsWith("/activation/complete")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, activation: { progress: "activated" } });
      }
    };
  }
  throw new Error(`unexpected URL: ${url}`);
};

(async () => {
  try {
    const serviceUrl = "http://127.0.0.1:17372";
    const status = await localService.getActivationStatus(serviceUrl);
    assert.equal(status.activation.progress, "model_ready");
    const seen = await localService.markActivationBrowserSeen({ site: "chatgpt" }, serviceUrl);
    assert.equal(seen.activation.progress, "awaiting_first_loop");
    const complete = await localService.completeActivation({
      eventId: "activation-verified_insert-1752710406000",
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }, serviceUrl);
    assert.equal(complete.activation.progress, "activated");
    assert.ok(calls.some((call) => call.url.endsWith("/activation/browser-seen")));
    assert.ok(calls.some((call) => call.url.endsWith("/activation/complete")));
    const completeCall = calls.find((call) => call.url.endsWith("/activation/complete"));
    const completeBody = JSON.parse(completeCall.options.body);
    assert.equal(completeBody.extensionBuildId, "phase3-extension-20260717-r5");
    assert.equal(completeBody.stableReadback, true);
    assert.ok(!String(completeCall.options.body).includes("Prompt"));

    const previousChrome = global.chrome;
    const bridgeCalls = [];
    global.chrome = {
      runtime: {
        id: "fnpfpobenlbgdkjadiaeopdpnodeegpj",
        lastError: null,
        sendMessage(message, callback) {
          bridgeCalls.push(message);
          callback({ ok: true, generatedBy: "bridge" });
        }
      }
    };
    await assert.rejects(
      () => localService.auth(serviceUrl),
      (error) => error.code === "local_service_auth_internal"
    );
    const fetchCountBeforeBridge = calls.length;
    const bridgeResult = await localService.generate({ input: "bridge-only synthetic input" }, serviceUrl);
    assert.equal(bridgeResult.generatedBy, "bridge");
    assert.equal(calls.length, fetchCountBeforeBridge);
    assert.equal(bridgeCalls[0].type, "smart-prompt-service-request");
    assert.equal(bridgeCalls[0].path, "/generate");
    assert.equal(bridgeCalls[0].body.input, "bridge-only synthetic input");
    global.chrome = previousChrome;
    console.log("activation client tests passed");
  } finally {
    global.fetch = previousFetch;
  }
})();
