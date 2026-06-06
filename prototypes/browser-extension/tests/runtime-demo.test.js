const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { startServer } = require("../../../apps/local-service/src/server");
const { createStore } = require("../../../apps/local-service/src/store");

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const remotePort = Number(process.env.SMART_PROMPT_CDP_PORT || 9227);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeDirWithRetry(dir) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
      return;
    } catch (error) {
      if (attempt === 7) throw error;
      await sleep(200);
    }
  }
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function waitForLocalService() {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const health = await getJson("http://127.0.0.1:17371/health");
      if (health.ok) return true;
    } catch {
      // Not ready yet.
    }
    await sleep(150);
  }
  return false;
}

function startServiceForTest(dataDir) {
  return new Promise((resolve, reject) => {
    const server = startServer({ port: 17371, store: createStore(dataDir) });
    server.once("listening", () => resolve({ server, external: false }));
    server.once("error", async (error) => {
      if (error.code === "EADDRINUSE" && await waitForLocalService()) {
        resolve({ server: null, external: true });
        return;
      }
      reject(error);
    });
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

async function waitForTarget() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${remotePort}/json/list`);
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error("Chrome CDP target did not become available.");
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
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return result.result.value;
}

async function waitFor(client, expression, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression);
    if (predicate(value)) return value;
    await sleep(250);
  }
  throw new Error(`Condition not met: ${expression}`);
}

(async () => {
  assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-service-"));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-chrome-"));
  const service = await startServiceForTest(dataDir);

  const demoPath = path.resolve(__dirname, "../demo/demo.html").replace(/\\/g, "/");
  const demoUrl = `file:///${demoPath}?open=1`;
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${remotePort}`,
    demoUrl
  ], { stdio: "ignore" });

  let client;
  try {
    const target = await waitForTarget();
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    const ready = await waitFor(client, `(() => ({
      mascot: Boolean(document.getElementById("smart-prompt-mascot")),
      card: Boolean(document.getElementById("smart-prompt-card")),
      context: document.querySelector(".spc-context")?.textContent || "",
      output: document.querySelector(".spc-output")?.value || ""
    }))()`, (value) => value.mascot && value.card && /template-fallback|llm/.test(value.context) && value.output.length > 80);

    assert.ok(ready.context.includes("ChatGPT"));
    assert.ok(/template-fallback|llm/.test(ready.context));

    const afterInsert = await evaluate(client, `(() => {
      const output = document.querySelector(".spc-output").value;
      document.querySelector('button[data-action="insert"]').click();
      const input = document.querySelector("textarea").value;
      return {
        output,
        input,
        submitCount: window.__demoSubmitCount,
        cardClosed: !document.getElementById("smart-prompt-card")
      };
    })()`);

    assert.equal(afterInsert.input, afterInsert.output);
    assert.equal(afterInsert.submitCount, 0);
    assert.equal(afterInsert.cardClosed, true);
  } finally {
    if (client) client.close();
    if (!chrome.killed) {
      chrome.kill();
    }
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      setTimeout(resolve, 1200);
    });
    await closeServer(service.server);
    await removeDirWithRetry(dataDir);
    await removeDirWithRetry(profileDir);
  }

  console.log("runtime-demo tests passed");
})();
