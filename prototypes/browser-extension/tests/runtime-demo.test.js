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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await sleep(500);
    }
  }
}

async function getJson(url, authToken = "") {
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
  });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function getServiceToken(serviceUrl = "http://127.0.0.1:17371") {
  const body = await getJson(`${serviceUrl}/auth/bootstrap`);
  assert.ok(body.auth?.token, "local service should provide a bootstrap auth token");
  return body.auth.token;
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

async function waitForPromptCount(count, authToken) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const prompts = await getJson("http://127.0.0.1:17371/prompts", authToken);
      if (prompts.ok && prompts.prompts.length >= count) return prompts;
    } catch {
      // Save is still crossing the extension-to-service bridge.
    }
    await sleep(150);
  }
  throw new Error(`Prompt library did not reach ${count} saved prompts.`);
}

function startServiceForTest(dataDir) {
  return new Promise((resolve, reject) => {
    const server = startServer({ port: 17371, store: createStore(dataDir), allowedOrigins: ["null", "file://"] });
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
  let lastValue;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression);
    lastValue = value;
    if (predicate(value)) return value;
    await sleep(250);
  }
  throw new Error(`Condition not met: ${expression}\nLast value: ${JSON.stringify(lastValue)}`);
}

(async () => {
  assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-service-"));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-chrome-"));
  const service = await startServiceForTest(dataDir);
  const serviceToken = await getServiceToken();

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
    assert.ok(await evaluate(client, `Boolean(document.querySelector(".spc-mode-selector"))`));
    assert.ok(await evaluate(client, `Boolean(document.querySelector('button[data-action="retry"]'))`));

    await evaluate(client, `(() => {
      const selector = document.querySelector(".spc-mode-selector");
      selector.value = "polish";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    const modeSwitch = await waitFor(client, `(() => ({
      mode: document.querySelector(".spc-mode-selector")?.value || "",
      labelClass: document.querySelector(".spc-mode")?.className || "",
      output: document.querySelector(".spc-output")?.value || "",
      status: document.getElementById("smart-prompt-card")?.dataset.status || ""
    }))()`, (value) => value.mode === "polish" && value.labelClass.includes("mode-polish") && value.output.includes("优化") && value.status !== "loading");
    assert.equal(modeSwitch.mode, "polish");

    await evaluate(client, `(() => {
      document.querySelector('button[data-action="retry"]').click();
      return true;
    })()`);
    const retryState = await waitFor(client, `(() => ({
      status: document.getElementById("smart-prompt-card")?.dataset.status || "",
      output: document.querySelector(".spc-output")?.value || "",
      source: document.querySelector(".spc-source-badge")?.dataset.generatedBy || ""
    }))()`, (value) => value.status === "ready" && value.output.length > 80 && /template-fallback|llm/.test(value.source));
    assert.ok(retryState.output.includes("优化"));

    if (!service.external) {
      const beforePrompts = await getJson("http://127.0.0.1:17371/prompts", serviceToken);
      await evaluate(client, `(() => {
        document.querySelector('button[data-action="favorite"]').click();
        return true;
      })()`);
      const savedPrompts = await waitForPromptCount(beforePrompts.prompts.length + 1, serviceToken);
      assert.equal(savedPrompts.prompts[0].source, "browser-extension");
      assert.ok(savedPrompts.prompts[0].body.length > 80);
      assert.equal(savedPrompts.prompts[0].context.tool, "ChatGPT");
      assert.equal(savedPrompts.prompts[0].context.inputKind, "textarea");
    }

    const insertOutput = await evaluate(client, `(() => {
      window.__smartPromptOriginalInput = document.querySelector("textarea:not(.spc-output)")?.value || "";
      const output = document.querySelector(".spc-output").value;
      window.__smartPromptLastOutput = output;
      document.querySelector('button[data-action="insert"]').click();
      return output;
    })()`);
    const afterInsert = await waitFor(client, `(() => {
      const output = window.__smartPromptLastOutput || "";
      const input = document.querySelector("textarea").value;
      return {
        output,
        input,
        submitCount: window.__demoSubmitCount,
        cardClosed: !document.getElementById("smart-prompt-card"),
        lastInsertResult: window.__smartPromptDebug?.lastInsertResult || null,
        insertDataset: {
          ok: document.documentElement.dataset.smartPromptInsertOk,
          verified: document.documentElement.dataset.smartPromptInsertVerified,
          valueLength: document.documentElement.dataset.smartPromptInsertValueLength
        },
        undoAvailable: document.documentElement.dataset.smartPromptUndoAvailable,
        undoVisible: Boolean(document.querySelector('#smart-prompt-undo button[data-action="undo"]')),
        feedback: window.__demoStorage?.smartPromptFeedback || []
      };
    })()`, (value) => value.cardClosed && value.input === insertOutput && value.undoVisible && value.feedback.length >= 1);

    assert.equal(afterInsert.input, afterInsert.output);
    assert.equal(afterInsert.submitCount, 0);
    assert.equal(afterInsert.cardClosed, true);
    assert.equal(afterInsert.lastInsertResult.verified, true);
    assert.equal(afterInsert.insertDataset.ok, "true");
    assert.equal(afterInsert.insertDataset.verified, "true");
    assert.equal(Number(afterInsert.insertDataset.valueLength), afterInsert.output.length);
    assert.equal(afterInsert.undoAvailable, "true");
    assert.equal(afterInsert.feedback[0].action, "insert");
    assert.equal(afterInsert.feedback[0].adopted, true);

    await evaluate(client, `(() => {
      document.querySelector('#smart-prompt-undo button[data-action="undo"]').click();
      return true;
    })()`);
    const afterUndo = await waitFor(client, `(() => {
      const input = document.querySelector("textarea").value;
      return {
        input,
        original: window.__smartPromptOriginalInput || "",
        undoAvailable: document.documentElement.dataset.smartPromptUndoAvailable,
        undoDataset: {
          ok: document.documentElement.dataset.smartPromptUndoOk,
          verified: document.documentElement.dataset.smartPromptUndoVerified,
          valueLength: document.documentElement.dataset.smartPromptUndoValueLength
        },
        feedback: window.__demoStorage?.smartPromptFeedback || []
      };
    })()`, (value) => value.input === value.original && value.undoDataset.ok === "true" && value.feedback[0]?.action === "undo");
    assert.equal(afterUndo.undoAvailable, "false");
    assert.equal(afterUndo.undoDataset.verified, "true");
    assert.equal(Number(afterUndo.undoDataset.valueLength), afterUndo.original.length);

    await client.send("Page.enable");
    const offlineServiceUrl = "http://127.0.0.1:65534";
    const offlineDemoUrl = `file:///${demoPath}?open=1&serviceUrl=${encodeURIComponent(offlineServiceUrl)}`;
    await client.send("Page.navigate", { url: offlineDemoUrl });
    await sleep(500);
    const offlineReady = await waitFor(client, `(() => ({
      mascot: Boolean(document.getElementById("smart-prompt-mascot")),
      card: Boolean(document.getElementById("smart-prompt-card")),
      context: document.querySelector(".spc-context")?.textContent || "",
      output: document.querySelector(".spc-output")?.value || "",
      serviceUrl: window.__demoStorage?.smartPromptSettings?.serviceUrl || ""
    }))()`, (value) => value.mascot && value.card && value.context.includes("service offline") && value.output.length > 80);

    assert.equal(offlineReady.serviceUrl, offlineServiceUrl);
    assert.ok(offlineReady.context.includes("service offline"));

    await evaluate(client, `(() => {
      document.querySelector('button[data-action="retry"]').click();
      return true;
    })()`);
    const offlineRetry = await waitFor(client, `(() => ({
      status: document.getElementById("smart-prompt-card")?.dataset.status || "",
      context: document.querySelector(".spc-context")?.textContent || "",
      feedback: window.__demoStorage?.smartPromptFeedback || []
    }))()`, (value) => value.status === "failed" && value.context.includes("service offline") && value.feedback[0]?.action === "retry");
    assert.equal(offlineRetry.status, "failed");

    await evaluate(client, `(() => {
      document.querySelector('button[data-action="favorite"]').click();
      return true;
    })()`);
    const offlineFavorite = await waitFor(client, `(() => ({
      favorites: window.__demoStorage?.smartPromptFavorites || [],
      mascotState: document.getElementById("smart-prompt-mascot")?.dataset.state || ""
    }))()`, (value) => value.favorites.length === 1 && value.mascotState === "clapping");

    assert.equal(offlineFavorite.favorites[0].source, "browser-extension");
    assert.ok(offlineFavorite.favorites[0].body.length > 80);
    assert.equal(offlineFavorite.favorites[0].context.tool, "ChatGPT");

    const offlineInsertOutput = await evaluate(client, `(() => {
      const output = document.querySelector(".spc-output").value;
      window.__smartPromptLastOutput = output;
      document.querySelector('button[data-action="insert"]').click();
      return output;
    })()`);
    const offlineInsert = await waitFor(client, `(() => {
      const output = window.__smartPromptLastOutput || "";
      const input = document.querySelector("textarea").value;
      return {
        output,
        input,
        submitCount: window.__demoSubmitCount,
        cardClosed: !document.getElementById("smart-prompt-card"),
        lastInsertResult: window.__smartPromptDebug?.lastInsertResult || null,
        feedback: window.__demoStorage?.smartPromptFeedback || []
      };
    })()`, (value) => value.cardClosed && value.input === offlineInsertOutput && value.feedback.length >= 2);

    assert.equal(offlineInsert.input, offlineInsert.output);
    assert.equal(offlineInsert.submitCount, 0);
    assert.equal(offlineInsert.cardClosed, true);
    assert.equal(offlineInsert.lastInsertResult.verified, true);
    assert.equal(offlineInsert.feedback[0].action, "insert");
    assert.equal(offlineInsert.feedback[0].adopted, true);
  } finally {
    if (client) client.close();
    if (!chrome.killed) {
      chrome.kill();
    }
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      setTimeout(resolve, 4000);
    });
    await sleep(500);
    await closeServer(service.server);
    await removeDirWithRetry(dataDir);
    await removeDirWithRetry(profileDir);
  }

  console.log("runtime-demo tests passed");
})();
