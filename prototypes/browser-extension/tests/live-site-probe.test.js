const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { startServer } = require("../../../apps/local-service/src/server");
const { createStore } = require("../../../apps/local-service/src/store");

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const remotePort = Number(process.env.SMART_PROMPT_LIVE_CDP_PORT || 9232);
const headless = process.env.SMART_PROMPT_LIVE_HEADLESS === "1";
const extensionDir = path.resolve(__dirname, "..");
const reportPath = process.env.SMART_PROMPT_LIVE_REPORT || "";
const injectFallback = process.env.SMART_PROMPT_LIVE_INJECT_FALLBACK !== "0";
const sourceFiles = [
  "src/site-adapters.js",
  "src/local-service-client.js",
  "src/prompt-engine.js",
  "src/content.js"
];
const inputSelector = 'textarea,input[type="text"],input[type="search"],input[type="url"],input:not([type]),[contenteditable="true"],[role="textbox"]';
const collectInputsSource = `
function smartPromptProbeInputs(root = document, out = []) {
  if (!root.querySelectorAll) return out;
  for (const element of root.querySelectorAll('${inputSelector}')) {
    out.push(element);
  }
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) smartPromptProbeInputs(element.shadowRoot, out);
  }
  return out;
}
`;

const sites = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", requireInsert: true },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", requireInsert: true },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", requireInsert: true },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/", requireInsert: false },
  { id: "bolt", name: "Bolt", url: "https://bolt.new/", requireInsert: false },
  { id: "v0", name: "v0", url: "https://v0.dev/chat", requireInsert: false },
  { id: "lovable", name: "Lovable", url: "https://lovable.dev/", requireInsert: false },
  { id: "replit", name: "Replit", url: "https://replit.com/ai", requireInsert: false }
];

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
      await sleep(250);
    }
  }
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

function startServiceForProbe(dataDir) {
  return new Promise((resolve, reject) => {
    const server = startServer({ port: 17371, store: createStore(dataDir) });
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

async function waitForTarget() {
  const deadline = Date.now() + 15000;
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
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return result.result.value;
}

async function waitFor(client, expression, predicate, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression);
    lastValue = value;
    if (predicate(value)) return value;
    await sleep(350);
  }
  throw new Error(`Condition not met: ${expression}\nLast value: ${JSON.stringify(lastValue)}`);
}

async function probeSite(client, site) {
  await client.send("Page.navigate", { url: site.url });
  await client.send("Page.loadEventFired").catch(() => {});
  await sleep(Number(process.env.SMART_PROMPT_LIVE_SETTLE_MS || 8000));
  let injectedProbe = false;
  if (injectFallback) {
    injectedProbe = await injectProbeRuntime(client);
    if (injectedProbe) {
      await waitFor(client, "Boolean(window.__smartPromptCopilotReady)", (value) => value, 3000).catch(() => {});
    }
    await sleep(500);
  }

  const initial = await evaluate(client, `(() => {
    ${collectInputsSource}
    const candidates = smartPromptProbeInputs()
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          index,
          tag: element.tagName,
          id: element.id || "",
          role: element.getAttribute("role") || "",
          contentEditable: element.isContentEditable,
          placeholder: element.getAttribute("placeholder") || element.getAttribute("aria-label") || "",
          visible: rect.width > 24 && rect.height > 18 && style.visibility !== "hidden" && style.display !== "none",
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      });
    return {
      url: location.href,
      title: document.title,
      injectedProbe: Boolean(window.__smartPromptProbeInjected),
      mascot: Boolean(document.getElementById("smart-prompt-mascot")),
      card: Boolean(document.getElementById("smart-prompt-card")),
      candidates
    };
  })()`);

  const focusResult = await evaluate(client, `(() => {
    ${collectInputsSource}
    const candidates = smartPromptProbeInputs()
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 24 && rect.height > 18 && style.visibility !== "hidden" && style.display !== "none";
      });
    const target = candidates[0];
    if (!target) return { ok: false, reason: "no visible input candidate" };
    target.scrollIntoView({ block: "center", inline: "center" });
    target.focus();
    target.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    return {
      ok: true,
      tag: target.tagName,
      id: target.id || "",
      role: target.getAttribute("role") || "",
      contentEditable: target.isContentEditable,
      beforeValue: ("value" in target ? target.value : target.textContent || "").slice(0, 80)
    };
  })()`);

  if (!focusResult.ok) {
    return { ...site, injectedProbe, passedDisplay: false, passedInsert: false, initial, focusResult };
  }

  let display;
  try {
    display = await waitFor(client, `(() => {
      const mascot = document.getElementById("smart-prompt-mascot");
      const rect = mascot?.getBoundingClientRect();
      return {
        mascot: Boolean(mascot),
        visible: Boolean(mascot && rect && rect.width > 20 && rect.height > 20),
        state: mascot?.dataset?.state || "",
        transform: mascot?.style?.transform || ""
      };
    })()`, (value) => value.mascot && value.visible, 10000);
  } catch (error) {
    return { ...site, injectedProbe, passedDisplay: false, passedInsert: false, initial, focusResult, displayError: error.message };
  }

  if (!site.requireInsert) {
    return { ...site, injectedProbe, passedDisplay: true, passedInsert: null, initial, focusResult, display };
  }

  let insert;
  try {
    insert = await waitFor(client, `(() => {
      const mascot = document.getElementById("smart-prompt-mascot");
      if (!mascot) return { ready: false, reason: "missing mascot" };
      mascot.click();
      return { ready: true };
    })()`, (value) => value.ready, 2000);

    const card = await waitFor(client, `(() => {
      const output = document.querySelector("#smart-prompt-card .spc-output")?.value || "";
      return {
        card: Boolean(document.getElementById("smart-prompt-card")),
        outputLength: output.length,
        context: document.querySelector("#smart-prompt-card .spc-context")?.textContent || ""
      };
    })()`, (value) => value.card && value.outputLength > 80, 12000);

    const afterInsert = await evaluate(client, `(() => {
      const output = document.querySelector("#smart-prompt-card .spc-output")?.value || "";
      document.querySelector('#smart-prompt-card button[data-action="insert"]')?.click();
      const active = document.activeElement;
      ${collectInputsSource}
      const inputs = smartPromptProbeInputs()
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 24 && rect.height > 18 && style.visibility !== "hidden" && style.display !== "none";
        });
      const target = active && inputs.includes(active) ? active : inputs[0];
      const value = target ? ("value" in target ? target.value : target.textContent || "") : "";
      return {
        output,
        value,
        outputLength: output.length,
        valueLength: value.length,
        cardClosed: !document.getElementById("smart-prompt-card"),
        url: location.href
      };
    })()`);

    insert = {
      opened: true,
      card,
      afterInsert,
      ok: afterInsert.cardClosed && afterInsert.outputLength > 80 && afterInsert.value.includes(afterInsert.output.slice(0, 40))
    };
  } catch (error) {
    insert = { opened: false, ok: false, error: error.message };
  }

  return { ...site, injectedProbe, passedDisplay: true, passedInsert: Boolean(insert.ok), initial, focusResult, display, insert };
}

async function injectProbeRuntime(client) {
  const alreadyInjected = await evaluate(client, "Boolean(window.__smartPromptProbeInjected)");
  if (alreadyInjected) return false;

  const css = fs.readFileSync(path.join(extensionDir, "src/content.css"), "utf8");
  await evaluate(client, `(() => {
    const style = document.createElement("style");
    style.id = "smart-prompt-probe-css";
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
  })()`);

  for (const file of sourceFiles) {
    const code = fs.readFileSync(path.join(extensionDir, file), "utf8");
    await client.send("Runtime.evaluate", {
      expression: `${code}\n//# sourceURL=smart-prompt-probe/${file}`,
      awaitPromise: true,
      returnByValue: true
    });
  }

  await evaluate(client, "window.__smartPromptProbeInjected = true");
  return true;
}

(async () => {
  assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-live-service-"));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-live-chrome-"));
  const extensionWorkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-live-ext-"));
  const extensionWorkDir = path.join(extensionWorkRoot, "extension");
  fs.cpSync(extensionDir, extensionWorkDir, { recursive: true });
  const service = await startServiceForProbe(dataDir);
  const args = [
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${remotePort}`,
    `--disable-extensions-except=${extensionWorkDir}`,
    `--load-extension=${extensionWorkDir}`,
    "about:blank"
  ];
  if (headless) args.unshift("--headless=new");

  const chrome = spawn(chromePath, args, { stdio: "ignore" });
  const results = [];
  let client;
  try {
    const target = await waitForTarget();
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    for (const site of sites) {
      try {
        results.push(await probeSite(client, site));
      } catch (error) {
        results.push({ ...site, passedDisplay: false, passedInsert: false, error: error.message });
      }
    }
  } finally {
    if (client) client.close();
    if (!chrome.killed) chrome.kill();
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      setTimeout(resolve, 2000);
    });
    await closeServer(service);
    await removeDirWithRetry(dataDir);
    await removeDirWithRetry(profileDir);
    await removeDirWithRetry(extensionWorkRoot);
  }

  const displayPasses = results.filter((item) => item.passedDisplay).length;
  const insertPasses = results.filter((item) => item.requireInsert && item.passedInsert).map((item) => item.id);
  const report = {
    createdAt: new Date().toISOString(),
    headless,
    injectFallback,
    displayPasses,
    insertPasses,
    results
  };
  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));

  const requiredInsertIds = ["chatgpt", "claude", "gemini"];
  const missingInsert = requiredInsertIds.filter((id) => !insertPasses.includes(id));
  if (displayPasses < 5 || missingInsert.length > 0) {
    process.exitCode = 1;
  }
})();
