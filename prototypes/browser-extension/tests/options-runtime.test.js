const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const playwrightChromium = path.join(
  process.env.LOCALAPPDATA || "",
  "ms-playwright",
  "chromium-1223",
  "chrome-win64",
  "chrome.exe"
);
const chromePath = process.env.CHROME_PATH
  || (fs.existsSync(playwrightChromium) ? playwrightChromium : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extensionIdFromKey(key) {
  const digest = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest]
    .map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`)
    .join("");
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function waitForTarget(port, expectedUrl) {
  const deadline = Date.now() + 15000;
  let lastTargets = [];
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      lastTargets = targets;
      const target = targets.find((item) => item.type === "page" && item.url === expectedUrl && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Options target did not become available: ${expectedUrl}; targets=${JSON.stringify(lastTargets.map((item) => ({ type: item.type, url: item.url })))}`);
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
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
          return new Promise((innerResolve, innerReject) => pending.set(id, { resolve: innerResolve, reject: innerReject }));
        },
        close() {
          if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
          return new Promise((closeResolve) => {
            const timeout = setTimeout(closeResolve, 2000);
            socket.addEventListener("close", () => {
              clearTimeout(timeout);
              closeResolve();
            }, { once: true });
            socket.close();
          });
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result.value;
}

(async () => {
  assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
  const extensionId = extensionIdFromKey(manifest.key);
  const optionsUrl = `chrome-extension://${extensionId}/options/options.html`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-options-chrome-"));
  const remotePort = await getAvailablePort();
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${remotePort}`,
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    optionsUrl
  ], { stdio: "ignore" });

  let client;
  try {
    const target = await waitForTarget(remotePort, optionsUrl);
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    const deadline = Date.now() + 5000;
    let state = null;
    while (Date.now() < deadline) {
      state = await evaluate(client, `({
        readyState: document.readyState,
        hasCore: Boolean(globalThis.SmartPromptCore),
        hasEngine: Boolean(globalThis.SmartPromptEngine),
        sameApi: globalThis.SmartPromptCore === globalThis.SmartPromptEngine,
        title: document.title,
        bodyText: (document.body?.innerText || "").slice(0, 160),
        locationHref: location.href,
        skillCount: document.getElementById("skill-count")?.textContent || "",
        hasEmptyState: Boolean(document.querySelector("#skill-list .empty"))
      })`);
      if (state.readyState === "complete" && state.hasCore && state.hasEngine && state.hasEmptyState) break;
      await sleep(100);
    }
    const details = JSON.stringify(state);
    assert.equal(state.hasCore, true, details);
    assert.equal(state.hasEngine, true, details);
    assert.equal(state.sameApi, true, details);
    assert.equal(state.skillCount, "0 skills", details);
    assert.equal(state.hasEmptyState, true, details);
  } finally {
    try {
      await client?.send("Browser.close");
    } catch {
      // Closing the browser can close the CDP socket before the response arrives.
    }
    await client?.close();
    let exited = await waitForChildExit(chrome);
    if (!exited) {
      chrome.kill();
      exited = await waitForChildExit(chrome);
    }
    assert.equal(exited, true, "Chrome test process did not exit after Browser.close.");
  }

  console.log(`options runtime tests passed; profile retained at ${profileDir}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
