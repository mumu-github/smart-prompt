const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const remotePort = Number(process.env.SMART_PROMPT_WEBVIEW_CDP_PORT || 9228);
const servicePort = 17371;
const activationContract = "phase3-activation@1";
const nativeServiceVersion = "0.5.0-native";
const nativeRuntimeContract = "phase3-native-runtime@1";
const nativeBuildId = "phase3-native-sidecar-20260719-r18";
const sidecarRoot = path.resolve(root, "..", "local-service-sidecar");
const sidecarTargetRoot = path.join(sidecarRoot, "target");

function buildNativeSidecar() {
  const cargo = process.platform === "win32"
    ? path.join(os.homedir(), ".cargo", "bin", "cargo.exe")
    : "cargo";
  const result = spawnSync(cargo, [
    "build",
    "--manifest-path",
    path.join(sidecarRoot, "Cargo.toml"),
    "--target-dir",
    sidecarTargetRoot
  ], {
    cwd: sidecarRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `native sidecar build failed\n${result.stderr || result.stdout}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function waitForTarget() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${remotePort}/json/list`);
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // WebView2 debug endpoint is not ready yet.
    }
    await sleep(500);
  }
  throw new Error("Tauri WebView2 CDP target did not become available.");
}

async function waitForService() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const health = await getJson(`http://127.0.0.1:${servicePort}/health`);
      if (
        health.ok
        && health.service === "smart-prompt-local-service"
        && health.sidecar === "native"
        && health.version === nativeServiceVersion
        && health.activationContract === activationContract
        && health.runtimeContract === nativeRuntimeContract
        && health.buildId === nativeBuildId
      ) return health;
    } catch {
      // Service is still starting.
    }
    await sleep(300);
  }
  throw new Error(`Local service did not start on ${servicePort}.`);
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
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

function sendShortcut() {
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `
Add-Type -Namespace Win32 -Name Keyboard -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
$up = 0x2
$ctrl = 0x11
$alt = 0x12
$p = 0x50
[Win32.Keyboard]::keybd_event($ctrl, 0, 0, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event($alt, 0, 0, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event($p, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
[Win32.Keyboard]::keybd_event($p, 0, $up, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event($alt, 0, $up, [UIntPtr]::Zero)
[Win32.Keyboard]::keybd_event($ctrl, 0, $up, [UIntPtr]::Zero)
`
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`SendKeys failed: ${result.stderr || result.stdout}`);
  }
}

function findPidOnPort(port) {
  if (process.platform !== "win32") return null;
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `$connection = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($connection) { $connection.OwningProcess }`
  ], { encoding: "utf8" });
  const value = result.stdout.trim();
  return value ? Number(value) : null;
}

function taskkillTree(processId) {
  if (!processId) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(processId), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(processId, "SIGTERM");
  } catch {
    // Process already stopped.
  }
}

(async () => {
  buildNativeSidecar();
  const occupiedPid = findPidOnPort(servicePort);
  assert.equal(
    occupiedPid,
    null,
    `runtime test refused to attach to the existing listener on fixed service port ${servicePort}`
  );
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-tauri-phase3-"));
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  const env = {
    ...process.env,
    PATH: `${cargoBin}${path.delimiter}${process.env.PATH || ""}`,
    SMART_PROMPT_PORT: String(servicePort),
    SMART_PROMPT_DATA_DIR: dataDir,
    SMART_PROMPT_ALLOW_DEV_BOOTSTRAP: "1",
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${remotePort}`
  };
  const executable = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run dev"] : ["run", "dev"];
  const dev = spawn(executable, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const report = {
    createdAt: new Date().toISOString(),
    pass: false,
    remotePort,
    servicePort,
    dataDirConfigured: true,
    checks: {
      webviewTarget: false,
      tauriApi: false,
      phase3ControlCenter: false,
      controlCenterHealthy: false,
      shortcutRegistered: false,
      sidecarSource: false,
      localServiceStarted: false,
      localServiceIdentity: false,
      activationContract: false,
      isolatedDataDir: false,
      localServiceStopped: false,
      globalShortcutTriggered: false
    }
  };
  let output = "";
  let servicePid = null;
  dev.stdout.on("data", (chunk) => { output += chunk.toString(); });
  dev.stderr.on("data", (chunk) => { output += chunk.toString(); });

  let client;
  try {
    const target = await waitForTarget();
    report.checks.webviewTarget = true;
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    const tauriState = await waitFor(client, `(() => ({
      hasTauri: Boolean(window.__TAURI__?.core?.invoke),
      hasEvents: Boolean(window.__TAURI__?.event?.listen),
      status: document.getElementById("service-status")?.textContent || "",
      title: document.title
    }))()`, (value) => value.hasTauri && value.hasEvents && value.status.length > 0);
    report.checks.tauriApi = Boolean(tauriState.hasTauri && tauriState.hasEvents);

    const phase3Ui = await waitFor(client, `(() => ({
      phase3: document.body?.dataset?.phase3ControlCenter === "true",
      wizard: Boolean(document.getElementById("activation-wizard")),
      controlPages: document.querySelectorAll("[data-control-page-view]").length,
      legacyHidden: getComputedStyle(document.querySelector(".legacy-shell"))?.display === "none"
    }))()`, (value) => value.phase3 && value.wizard && value.controlPages === 4 && value.legacyHidden);
    report.phase3Ui = phase3Ui;
    report.checks.phase3ControlCenter = true;

    const sidecarSource = await evaluate(client, `window.__TAURI__.core.invoke("get_local_service_source")`);
    assert.match(sidecarSource, /local-service-sidecar=source/);
    assert.match(sidecarSource, /target[\\/]debug[\\/]local-service-sidecar/);
    report.sidecar = { source: "source", binaryConfigured: true };
    report.checks.sidecarSource = true;

    const registered = await evaluate(client, `window.__TAURI__.core.invoke("set_global_shortcut", { shortcut: "Ctrl+Alt+P" })`);
    assert.equal(registered, "Ctrl+Alt+P");
    report.shortcut = registered;
    report.checks.shortcutRegistered = true;

    const serviceResult = await evaluate(client, `window.__TAURI__.core.invoke("start_local_service")`);
    assert.ok(["started", "running"].includes(serviceResult));
    const health = await waitForService();
    servicePid = findPidOnPort(servicePort);
    assert.equal(health.service, "smart-prompt-local-service");
    assert.equal(health.sidecar, "native");
    assert.equal(health.version, nativeServiceVersion);
    assert.equal(health.activationContract, activationContract);
    assert.equal(health.runtimeContract, nativeRuntimeContract);
    assert.equal(health.buildId, nativeBuildId);
    report.service = health;
    report.checks.localServiceStarted = true;
    report.checks.localServiceIdentity = true;
    report.checks.activationContract = true;

    const controlCenter = await waitFor(client, `(() => ({
      status: document.getElementById("runtime-status")?.textContent || "",
      tone: document.getElementById("runtime-status")?.dataset?.tone || "",
      repairHidden: document.getElementById("runtime-repair")?.hidden === true,
      wizardVisible: document.getElementById("activation-wizard")?.hidden === false
    }))()`, (value) => value.tone === "success" && value.repairHidden && value.wizardVisible, 20000);
    report.controlCenter = controlCenter;
    report.checks.controlCenterHealthy = true;

    const bootstrap = await getJson(`http://127.0.0.1:${servicePort}/auth/bootstrap`, {
      headers: { Origin: "http://tauri.localhost" }
    });
    const token = bootstrap.auth?.token;
    assert.equal(typeof token, "string");
    assert.ok(token.length >= 32);
    const activation = await getJson(`http://127.0.0.1:${servicePort}/activation/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(activation.activation?.schemaVersion, activationContract);
    assert.equal(activation.activation?.progress, "not_started");
    report.activation = {
      schemaVersion: activation.activation.schemaVersion,
      progress: activation.activation.progress,
      runtimeHealth: activation.activation.runtimeHealth
    };
    assert.ok(fs.existsSync(path.join(dataDir, "activation.json")));
    assert.ok(fs.existsSync(path.join(dataDir, "security.json")));
    report.checks.isolatedDataDir = true;

    const runningStatus = await evaluate(client, `window.__TAURI__.core.invoke("get_local_service_status")`);
    assert.equal(runningStatus, "running");
    report.serviceStatus = runningStatus;

    sendShortcut();
    const hits = await waitFor(client, `window.__TAURI__.core.invoke("get_shortcut_hits")`, (value) => value > 0, 12000);
    assert.ok(hits > 0);
    report.shortcutHits = hits;
    report.checks.globalShortcutTriggered = true;

    const stoppedStatus = await evaluate(client, `window.__TAURI__.core.invoke("stop_local_service")`);
    assert.equal(stoppedStatus, "stopped");
    servicePid = null;
    report.serviceStopStatus = stoppedStatus;
    report.checks.localServiceStopped = true;
    report.pass = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.error = "runtime_test_failed";
    error.message = `${error.message}\n--- tauri dev output ---\n${output.slice(-4000)}`;
    throw error;
  } finally {
    if (client) client.close();
    if (servicePid) taskkillTree(servicePid);
    taskkillTree(dev.pid);
    if (process.env.SMART_PROMPT_TAURI_RUNTIME_REPORT) {
      fs.writeFileSync(process.env.SMART_PROMPT_TAURI_RUNTIME_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
  }

  console.log(JSON.stringify(report, null, 2));
})();
