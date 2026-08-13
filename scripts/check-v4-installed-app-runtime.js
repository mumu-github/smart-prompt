const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${summarizeHttpError(text)}`);
  return JSON.parse(text);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${url} failed: ${response.status} ${summarizeHttpError(text)}`);
  return JSON.parse(text);
}

function summarizeHttpError(text = "") {
  const raw = String(text || "");
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    message = parsed?.error?.message || parsed?.error?.code || raw;
  } catch {
    // Non-JSON error bodies are summarized below.
  }
  return message
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, "REDACTED_PATH")
    .replace(/\\\\\?\\[A-Za-z]:\\[^\s"'`]+/g, "REDACTED_PATH")
    .slice(0, 500);
}

async function waitForTarget(remotePort) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${remotePort}/json/list`);
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // WebView2 debug endpoint is still starting.
    }
    await sleep(500);
  }
  throw new Error("Installed app WebView2 CDP target did not become available.");
}

async function waitForService(servicePort) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const health = await getJson(`http://127.0.0.1:${servicePort}/health`);
      if (health.ok) return health;
    } catch {
      // Local service is still starting.
    }
    await sleep(300);
  }
  throw new Error(`Installed app did not start local service on ${servicePort}.`);
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((innerResolve, innerReject) => {
            pending.set(id, { resolve: innerResolve, reject: innerReject });
          });
        },
        close() {
          socket.close();
        }
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return result.result.value;
}

async function waitFor(client, expression, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression);
    lastValue = value;
    if (predicate(value)) return value;
    await sleep(300);
  }
  throw new Error(`Condition not met: ${expression}\nLast value: ${JSON.stringify(lastValue)}`);
}

function findRelativeFile(root, predicate) {
  if (!root || !fs.existsSync(root)) return "";
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (predicate(full)) {
        return path.relative(root, full).replace(/\\/g, "/");
      }
    }
  }
  return "";
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const remotePort = Number(args["remote-port"] || process.env.SMART_PROMPT_WEBVIEW_CDP_PORT || 9239);
  const servicePort = Number(args["service-port"] || process.env.SMART_PROMPT_RUNTIME_SERVICE_PORT || 17371);
  const installDir = args["install-dir"] ? path.resolve(args["install-dir"]) : "";
  const report = {
    createdAt: new Date().toISOString(),
    pass: false,
    remotePort,
    servicePort,
    bundledSidecarExecutable: findRelativeFile(
      installDir,
      (file) => /smart-prompt-sidecar\/bin\/local-service-sidecar(\.exe)?$/i.test(file.replace(/\\/g, "/"))
    ),
    bundledDesktopInputProbe: findRelativeFile(
      installDir,
      (file) => /smart-prompt-sidecar\/scripts\/check-m3-desktop-input\.ps1$/i.test(file.replace(/\\/g, "/"))
    ),
    bundledDesktopFillProbe: findRelativeFile(
      installDir,
      (file) => /smart-prompt-sidecar\/scripts\/check-m3-desktop-fill\.ps1$/i.test(file.replace(/\\/g, "/"))
    ),
    checks: {
      bundledSidecarResource: false,
      bundledNativeSidecar: false,
      bundledDesktopInputProbe: false,
      bundledDesktopFillProbe: false,
      webviewTarget: false,
      tauriApi: false,
      sourceCommandBundled: false,
      localServiceStartedFromInstalledApp: false,
      serviceHealthFromInstalledApp: false,
      desktopSnapshotFromInstalledSidecar: false,
      desktopSnapshotSelfTestPass: false,
      desktopSnapshotPrivacyRedacted: false,
      desktopSnapshotToolProfiles: false,
      desktopFillFromInstalledSidecar: false,
      desktopFillSelfTestPass: false,
      desktopFillPrivacyRedacted: false,
      desktopFillToolProfiles: false,
      localServiceStoppedFromInstalledApp: false
    }
  };

  let client;
  try {
    report.checks.bundledSidecarResource = Boolean(report.bundledSidecarExecutable);
    report.checks.bundledNativeSidecar = Boolean(report.bundledSidecarExecutable);
    report.checks.bundledDesktopInputProbe = Boolean(report.bundledDesktopInputProbe);
    report.checks.bundledDesktopFillProbe = Boolean(report.bundledDesktopFillProbe);

    const target = await waitForTarget(remotePort);
    report.checks.webviewTarget = true;
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");

    await waitFor(client, `(() => ({
      hasInvoke: Boolean(window.__TAURI__?.core?.invoke),
      title: document.title
    }))()`, (value) => value.hasInvoke);
    report.checks.tauriApi = true;

    const source = await evaluate(client, `window.__TAURI__.core.invoke("get_local_service_source")`);
    report.localServiceSource = String(source).replace(/binary=.*/, "binary=REDACTED_PATH");
    report.checks.sourceCommandBundled = source.includes("local-service-sidecar=bundled");

    const serviceResult = await evaluate(client, `window.__TAURI__.core.invoke("start_local_service")`);
    assert.ok(["started", "running"].includes(serviceResult), `unexpected start result: ${serviceResult}`);
    report.startResult = serviceResult;
    report.checks.localServiceStartedFromInstalledApp = true;

    const health = await waitForService(servicePort);
    assert.equal(health.service, "smart-prompt-local-service");
    report.service = {
      ok: Boolean(health.ok),
      service: health.service
    };
    report.checks.serviceHealthFromInstalledApp = true;

    const auth = await getJson(`http://127.0.0.1:${servicePort}/auth/bootstrap`);
    const snapshotResponse = await getJson(
      `http://127.0.0.1:${servicePort}/desktop/input-snapshot?selfTest=1`,
      { Authorization: `Bearer ${auth.auth.token}` }
    );
    const snapshot = snapshotResponse.snapshot || {};
    const profiles = Array.isArray(snapshot.supportedToolProfiles) ? snapshot.supportedToolProfiles : [];
    const candidateCount = Number(snapshot.summary?.candidateCount || 0);
    report.desktopInputSnapshot = {
      ok: Boolean(snapshotResponse.ok),
      schemaVersion: snapshot.schemaVersion || "",
      selfTest: Boolean(snapshot.selfTest),
      pass: Boolean(snapshot.pass),
      candidateCount,
      supportedToolProfiles: profiles,
      privacy: snapshot.privacy || {}
    };
    report.checks.desktopSnapshotFromInstalledSidecar = Boolean(snapshotResponse.ok);
    report.checks.desktopSnapshotSelfTestPass = Boolean(snapshot.pass) && candidateCount > 0;
    report.checks.desktopSnapshotPrivacyRedacted = Boolean(snapshot.privacy?.titleRedacted)
      && Boolean(snapshot.privacy?.elementValuesNotRead)
      && JSON.stringify(snapshot).includes("M3 UIA self test input") === false;
    report.checks.desktopSnapshotToolProfiles = profiles.includes("codex")
      && profiles.includes("claude-code")
      && profiles.includes("hermes");

    const fillText = "M3 installed desktop fill self-test";
    const fillResponse = await postJson(
      `http://127.0.0.1:${servicePort}/desktop/fill?selfTest=1`,
      { text: fillText },
      { Authorization: `Bearer ${auth.auth.token}` }
    );
    const fill = fillResponse.fill || {};
    const fillProfiles = Array.isArray(fill.supportedToolProfiles) ? fill.supportedToolProfiles : [];
    report.desktopFill = {
      ok: Boolean(fillResponse.ok),
      schemaVersion: fill.schemaVersion || "",
      selfTest: Boolean(fill.selfTest),
      pass: Boolean(fill.pass),
      writeAttempted: Boolean(fill.writeAttempted),
      verified: Boolean(fill.verified),
      strategy: fill.strategy || "",
      requestedTextLength: Number(fill.summary?.requestedTextLength || 0),
      verifiedTextLength: Number(fill.summary?.verifiedTextLength || 0),
      supportedToolProfiles: fillProfiles,
      privacy: fill.privacy || {}
    };
    report.checks.desktopFillFromInstalledSidecar = Boolean(fillResponse.ok);
    report.checks.desktopFillSelfTestPass = Boolean(fill.pass)
      && Boolean(fill.writeAttempted)
      && Boolean(fill.verified);
    report.checks.desktopFillPrivacyRedacted = Boolean(fill.privacy?.writtenTextNotStored)
      && Boolean(fill.privacy?.verificationUsesLengthAndHash)
      && Boolean(fill.privacy?.autoSubmit) === false
      && JSON.stringify(fill).includes(fillText) === false;
    report.checks.desktopFillToolProfiles = fillProfiles.includes("codex")
      && fillProfiles.includes("claude-code")
      && fillProfiles.includes("hermes");

    const runningStatus = await evaluate(client, `window.__TAURI__.core.invoke("get_local_service_status")`);
    assert.equal(runningStatus, "running");
    report.runningStatus = runningStatus;

    const stopResult = await evaluate(client, `window.__TAURI__.core.invoke("stop_local_service")`);
    assert.equal(stopResult, "stopped");
    report.stopResult = stopResult;
    report.checks.localServiceStoppedFromInstalledApp = true;
    report.pass = Object.values(report.checks).every(Boolean);
  } finally {
    if (client) client.close();
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
