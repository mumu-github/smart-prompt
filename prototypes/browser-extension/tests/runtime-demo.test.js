const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { startServer } = require("../../../apps/local-service/src/server");
const { createStore } = require("../../../apps/local-service/src/store");

const playwrightChromePath = path.join(
  process.env.LOCALAPPDATA || "",
  "ms-playwright",
  "chromium_headless_shell-1223",
  "chrome-headless-shell-win64",
  "chrome-headless-shell.exe"
);
const chromePath = process.env.CHROME_PATH
  || (fs.existsSync(playwrightChromePath) ? playwrightChromePath : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
let remotePort = Number(process.env.SMART_PROMPT_CDP_PORT || 0);
const visualOutputDir = path.resolve(__dirname, "../../../outputs/assistant-card-phase2");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 9227;
      server.close(() => resolve(port));
    });
  });
}

async function getJson(url, authToken = "") {
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
  });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function getServiceToken(serviceUrl) {
  const body = await getJson(`${serviceUrl}/auth/bootstrap`);
  assert.ok(body.auth?.token, "local service should provide a bootstrap auth token");
  return body.auth.token;
}

async function waitForPromptCount(count, authToken, serviceUrl) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const prompts = await getJson(`${serviceUrl}/prompts`, authToken);
      if (prompts.ok && prompts.prompts.length >= count) return prompts;
    } catch {
      // Save is still crossing the extension-to-service bridge.
    }
    await sleep(150);
  }
  throw new Error(`Prompt library did not reach ${count} saved prompts.`);
}

async function waitForOutcomeMetric(authToken, serviceUrl, predicate = () => true) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const metrics = await getJson(`${serviceUrl}/metrics`, authToken);
      const event = (metrics.metrics?.events || []).find((item) => item.action === "outcome" && predicate(item));
      if (event) return { metrics, event };
    } catch {
      // Metric recording is best-effort and may arrive slightly after the UI click.
    }
    await sleep(150);
  }
  throw new Error("Outcome metric was not recorded.");
}

function startServiceForTest(dataDir) {
  return new Promise((resolve, reject) => {
    const server = startServer({ port: 0, store: createStore(dataDir), allowedOrigins: ["null", "file://"] });
    server.once("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 17371;
      resolve({ server, serviceUrl: `http://127.0.0.1:${port}` });
    });
    server.once("error", reject);
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

function startAssistantCardStyleHarness() {
  const assistantCardSource = fs.readFileSync(path.resolve(__dirname, "../src/assistant-card.js"));
  const assistantCardStyles = fs.readFileSync(path.resolve(__dirname, "../src/assistant-card.css"));
  const mascot = fs.readFileSync(path.resolve(__dirname, "../assets/mascot-states/suggesting.png"));
  const html = Buffer.from(`<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>Assistant Card style readiness</title></head>
  <body>
    <section id="assistant-host" style="position:fixed;inset:20px auto auto 20px;width:380px;height:430px"></section>
    <script src="/assistant-card.js"></script>
    <script>
      const host = document.getElementById("assistant-host");
      const startedAt = performance.now();
      const samples = [];
      SmartPromptAssistantUI.mountAssistantCard(host, {
        stylesheetUrl: "/assistant-card.css",
        mascotUrl: "/mascot.png",
        value: "synthetic",
        viewModel: {
          state: "review",
          title: "Ready",
          description: "Synthetic style readiness check",
          prompt: "synthetic",
          primaryAction: { id: "insert", label: "Insert", enabled: true },
          secondaryActions: [],
          noAutoSubmit: true
        }
      });

      function sample() {
        const root = host.shadowRoot;
        const article = root?.querySelector("[data-assistant-card]");
        const brand = root?.querySelector("[data-assistant-mascot]");
        const articleRect = article?.getBoundingClientRect();
        const brandRect = brand?.getBoundingClientRect();
        samples.push({
          t: Math.round(performance.now() - startedAt),
          styleState: host.dataset.assistantStyleState || "",
          hostVisibility: getComputedStyle(host).visibility,
          articleDisplay: article ? getComputedStyle(article).display : "",
          articleWidth: Math.round(articleRect?.width || 0),
          articleHeight: Math.round(articleRect?.height || 0),
          brandWidth: Math.round(brandRect?.width || 0),
          brandHeight: Math.round(brandRect?.height || 0)
        });
        if (performance.now() - startedAt < 800) {
          requestAnimationFrame(sample);
        } else {
          const beforeReady = samples.filter((entry) => entry.styleState !== "ready");
          const visibleBeforeReady = beforeReady.filter((entry) => entry.hostVisibility !== "hidden");
          const oversizedBeforeReady = visibleBeforeReady.filter((entry) => entry.brandWidth > 64 || entry.brandHeight > 64);
          const firstReady = samples.find((entry) => entry.styleState === "ready") || null;
          window.__assistantStyleProbe = {
            sampleCount: samples.length,
            loadingFrames: samples.filter((entry) => entry.styleState === "loading").length,
            visibleBeforeReady: visibleBeforeReady.length,
            oversizedBeforeReady: oversizedBeforeReady.length,
            firstReady
          };
        }
      }
      requestAnimationFrame(sample);
    </script>
  </body>
</html>`);

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.url === "/assistant-card.js") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        response.end(assistantCardSource);
        return;
      }
      if (request.url === "/assistant-card.css") {
        setTimeout(() => {
          response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
          response.end(assistantCardStyles);
        }, 420);
        return;
      }
      if (request.url === "/mascot.png") {
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(mascot);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 17371;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function waitForTarget(expectedUrl = "") {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${remotePort}/json/list`);
      const pageTargets = targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
      const target = expectedUrl
        ? pageTargets.find((item) => {
          const url = String(item.url || "");
          return url.includes("/demo/demo.html") && url.includes("serviceUrl=");
        })
        : pageTargets[0];
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
  const styleHarness = await startAssistantCardStyleHarness();
  if (!remotePort) remotePort = await getAvailablePort();

  const demoPath = path.resolve(__dirname, "../demo/demo.html").replace(/\\/g, "/");
  const demoUrl = `file:///${demoPath}?open=1&serviceUrl=${encodeURIComponent(service.serviceUrl)}`;
  const isHeadlessShell = path.basename(chromePath).toLowerCase().includes("headless-shell");
  const chrome = spawn(chromePath, [
    isHeadlessShell ? "--headless" : "--headless=new",
    "--hide-scrollbars",
    ...(isHeadlessShell ? ["--no-sandbox"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${remotePort}`,
    demoUrl
  ], { stdio: "ignore" });

  let client;
  try {
    const target = await waitForTarget(demoUrl);
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");

    await client.send("Page.navigate", { url: styleHarness.url });
    const styleProbe = await waitFor(
      client,
      `window.__assistantStyleProbe || null`,
      (value) => Boolean(value),
      5000
    );
    assert.ok(styleProbe.loadingFrames > 0, "the Assistant Card should expose a loading style state");
    assert.equal(styleProbe.visibleBeforeReady, 0, "the Assistant Card must stay hidden until its stylesheet is ready");
    assert.equal(styleProbe.oversizedBeforeReady, 0, "the mascot must never paint at its natural size");
    assert.equal(styleProbe.firstReady.hostVisibility, "visible");
    assert.equal(styleProbe.firstReady.articleDisplay, "flex");
    assert.equal(styleProbe.firstReady.brandWidth, 32);
    assert.equal(styleProbe.firstReady.brandHeight, 32);

    await client.send("Page.navigate", { url: demoUrl });
    await sleep(300);
    const ready = await waitFor(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host?.shadowRoot;
      const primary = root?.querySelector("[data-assistant-primary]");
      const output = root?.querySelector("[data-assistant-editor]");
      return {
        mascot: Boolean(document.getElementById("smart-prompt-mascot")),
        card: Boolean(host),
        sharedCard: Boolean(root?.querySelector("[data-assistant-card]")),
        assistantState: host?.dataset.assistantState || "",
        assistantTitle: root?.querySelector("[data-assistant-title]")?.textContent || "",
        primaryAction: primary?.dataset.action || "",
        primaryLabel: primary?.textContent || "",
        primaryTextLines: (() => {
          if (!primary) return 0;
          const range = document.createRange();
          range.selectNodeContents(primary);
          return range.getClientRects().length;
        })(),
        contractVersion: document.documentElement.dataset.smartPromptContractVersion || "",
        noAutoSubmit: document.documentElement.dataset.smartPromptNoAutoSubmit || "",
        source: host?.dataset.generatedBy || "",
        safety: root?.querySelector("[data-assistant-safety]")?.textContent || "",
        secondaryCount: root?.querySelectorAll("[data-assistant-secondary] button").length || 0,
        primaryCount: root?.querySelectorAll("[data-assistant-primary]").length || 0,
        legacyControlCount: document.querySelectorAll(".spc-outcome, .spc-evidence, .spc-skills").length,
        stylesheet: root?.querySelector("[data-assistant-styles]")?.getAttribute("href") || "",
        rect: (() => {
          const box = host?.getBoundingClientRect();
          return box ? { width: Math.round(box.width), height: Math.round(box.height) } : null;
        })(),
        editorHeight: Math.round(output?.getBoundingClientRect().height || 0),
        output: output?.value || ""
      };
    })()`, (value) => value.mascot
      && value.card
      && value.sharedCard
      && value.assistantState === "review"
      && /template-fallback|llm/.test(value.source)
      && value.output.length > 80);

    assert.equal(ready.assistantTitle, "提示词已生成");
    assert.equal(ready.primaryAction, "insert");
    assert.equal(ready.primaryLabel, "填入输入框");
    assert.equal(ready.primaryTextLines, 1);
    assert.equal(ready.primaryCount, 1);
    assert.ok(ready.secondaryCount <= 2);
    assert.equal(ready.contractVersion, "prompt-session@1");
    assert.equal(ready.noAutoSubmit, "true");
    assert.equal(ready.safety, "只会填入，不会自动发送");
    assert.equal(ready.legacyControlCount, 0);
    assert.ok(ready.stylesheet.includes("assistant-card.css"));
    assert.ok(ready.rect.width <= 390, `card width should be compact, got ${ready.rect.width}`);
    assert.ok(ready.rect.height <= 430, `card height should fit the viewport, got ${ready.rect.height}`);
    assert.ok(ready.editorHeight >= 130, `editor should use available card height, got ${ready.editorHeight}`);

    const multilineComposerProbe = await evaluate(client, `(() => {
      const frame = document.createElement("iframe");
      frame.style.position = "fixed";
      frame.style.left = "-10000px";
      frame.style.width = "400px";
      frame.style.height = "200px";
      document.body.appendChild(frame);
      const frameDocument = frame.contentDocument;
      const composer = frameDocument.createElement("div");
      composer.id = "prompt-textarea";
      composer.contentEditable = "true";
      composer.style.whiteSpace = "pre-wrap";
      frameDocument.body.appendChild(composer);
      const value = "First line\\nSecond line\\n\\nFourth line";
      const adapter = window.SmartPromptSiteAdapters.detectSiteAdapter("chatgpt.com");
      const initial = window.SmartPromptSiteAdapters.writeInput(composer, value, adapter);
      const stable = window.SmartPromptSiteAdapters.verifyStableWrite(initial, composer, value);
      const result = {
        initialOk: initial.ok,
        initialVerified: initial.verified,
        targetKind: initial.targetKind,
        stableOk: stable.ok,
        stableVerified: stable.verified,
        stableReadback: stable.stableReadback,
        exactReadback: window.SmartPromptSiteAdapters.readInputValue(composer) === value,
        paragraphCount: composer.querySelectorAll(":scope > p").length,
        breakCount: composer.querySelectorAll("br").length
      };
      frame.remove();
      return result;
    })()`);
    assert.equal(multilineComposerProbe.initialOk, true);
    assert.equal(multilineComposerProbe.initialVerified, true);
    assert.equal(multilineComposerProbe.targetKind, "chatgpt-composer");
    assert.equal(multilineComposerProbe.stableOk, true);
    assert.equal(multilineComposerProbe.stableVerified, true);
    assert.equal(multilineComposerProbe.stableReadback, true);
    assert.equal(multilineComposerProbe.exactReadback, true);
    assert.equal(multilineComposerProbe.paragraphCount, 1);
    assert.equal(multilineComposerProbe.breakCount, 3);

    fs.mkdirSync(visualOutputDir, { recursive: true });
    const browserReviewScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    fs.writeFileSync(
      path.join(visualOutputDir, "browser-review.png"),
      Buffer.from(browserReviewScreenshot.data, "base64")
    );

    await evaluate(client, `(() => {
      const root = document.getElementById("smart-prompt-card").shadowRoot;
      root.querySelector('[data-mode="polish"]').click();
      return true;
    })()`);
    const modeSwitch = await waitFor(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host?.shadowRoot;
      return {
        selected: root?.querySelector('[data-mode="polish"]')?.getAttribute("aria-pressed") || "",
        output: root?.querySelector("[data-assistant-editor]")?.value || "",
        state: host?.dataset.assistantState || "",
        status: host?.dataset.status || "",
        source: host?.dataset.generatedBy || ""
      };
    })()`, (value) => value.selected === "true"
      && value.state === "review"
      && value.status === "ready"
      && /template-fallback|llm/.test(value.source)
      && /优化|polish/i.test(value.output));
    assert.equal(modeSwitch.selected, "true");

    await evaluate(client, `(() => {
      const root = document.getElementById("smart-prompt-card").shadowRoot;
      root.querySelector('[data-action="regenerate"]').click();
      return true;
    })()`);
    const regenerated = await waitFor(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host?.shadowRoot;
      return {
        state: host?.dataset.assistantState || "",
        output: root?.querySelector("[data-assistant-editor]")?.value || "",
        status: host?.dataset.status || "",
        source: host?.dataset.generatedBy || ""
      };
    })()`, (value) => value.state === "review"
      && value.status === "ready"
      && /template-fallback|llm/.test(value.source)
      && value.output.length > 80);
    assert.ok(/优化|polish/i.test(regenerated.output));

    const editedPrompt = await evaluate(client, `(() => {
      const root = document.getElementById("smart-prompt-card").shadowRoot;
      const editor = root.querySelector("[data-assistant-editor]");
      editor.value += "\\n\\n补充：输出必须包含可执行验收清单。";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return editor.value;
    })()`);
    assert.ok(editedPrompt.includes("可执行验收清单"), JSON.stringify(editedPrompt));
    assert.equal(await evaluate(client, `window.__demoSubmitCount`), 0);
    assert.equal(await evaluate(client, `document.getElementById("smart-prompt-card")?.dataset.assistantState`), "review");

    const insertOutput = await evaluate(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host.shadowRoot;
      const input = document.querySelector(".composer textarea");
      window.__smartPromptOriginalInput = input.value;
      window.__smartPromptLastOutput = root.querySelector("[data-assistant-editor]").value;
      root.querySelector("[data-assistant-primary]").click();
      return window.__smartPromptLastOutput;
    })()`);
    const afterInsert = await waitFor(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host?.shadowRoot;
      return {
        input: document.querySelector(".composer textarea")?.value || "",
        submitCount: window.__demoSubmitCount,
        cardStillOpen: Boolean(host),
        assistantState: host?.dataset.assistantState || "",
        assistantVerification: document.documentElement.dataset.smartPromptAssistantVerification || "",
        noAutoSubmit: document.documentElement.dataset.smartPromptNoAutoSubmit || "",
        primaryAction: root?.querySelector("[data-assistant-primary]")?.dataset.action || "",
        secondaryActions: Array.from(root?.querySelectorAll("[data-assistant-secondary] button") || []).map((button) => button.dataset.action),
        undoAvailable: document.documentElement.dataset.smartPromptUndoAvailable || "",
        lastInsertResult: window.__smartPromptDebug?.lastInsertResult || null,
        feedback: window.__demoStorage?.smartPromptFeedback || []
      };
    })()`, (value) => value.cardStillOpen
      && value.input === insertOutput
      && value.assistantState === "inserted"
      && value.primaryAction === "complete"
      && value.secondaryActions.includes("undo"));

    assert.equal(afterInsert.submitCount, 0);
    assert.equal(afterInsert.assistantVerification, "machine");
    assert.equal(afterInsert.noAutoSubmit, "true");
    assert.equal(afterInsert.undoAvailable, "true");
    assert.equal(afterInsert.lastInsertResult.verified, true);
    assert.equal(afterInsert.feedback[0].action, "insert");
    assert.equal(afterInsert.feedback[0].adopted, true);

    const browserInsertedScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    fs.writeFileSync(
      path.join(visualOutputDir, "browser-inserted.png"),
      Buffer.from(browserInsertedScreenshot.data, "base64")
    );

    await evaluate(client, `(() => {
      const root = document.getElementById("smart-prompt-card").shadowRoot;
      root.querySelector('[data-action="undo"]').click();
      return true;
    })()`);
    const afterUndo = await waitFor(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host?.shadowRoot;
      return {
        input: document.querySelector(".composer textarea")?.value || "",
        original: window.__smartPromptOriginalInput || "",
        submitCount: window.__demoSubmitCount,
        assistantState: host?.dataset.assistantState || "",
        primaryAction: root?.querySelector("[data-assistant-primary]")?.dataset.action || "",
        undoAvailable: document.documentElement.dataset.smartPromptUndoAvailable || ""
      };
    })()`, (value) => value.input === value.original
      && value.assistantState === "review"
      && value.primaryAction === "insert"
      && value.undoAvailable === "false");
    assert.equal(afterUndo.submitCount, 0);

    const offlinePort = await getAvailablePort();
    const offlineServiceUrl = `http://127.0.0.1:${offlinePort}`;
    const offlineDemoUrl = `file:///${demoPath}?open=1&preferLocalService=true&uiLocale=zh-CN&serviceUrl=${encodeURIComponent(offlineServiceUrl)}`;
    await client.send("Page.navigate", { url: offlineDemoUrl });
    await sleep(500);

    const offlineReady = await waitFor(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host?.shadowRoot;
      return {
        mascot: Boolean(document.getElementById("smart-prompt-mascot")),
        sharedCard: Boolean(root?.querySelector("[data-assistant-card]")),
        state: host?.dataset.assistantState || "",
        reason: host?.dataset.assistantReason || "",
        serviceState: host?.dataset.serviceState || "",
        output: root?.querySelector("[data-assistant-editor]")?.value || "",
        reasonVisible: !root?.querySelector("[data-assistant-reason]")?.hidden,
        serviceUrl: window.__demoStorage?.smartPromptSettings?.serviceUrl || ""
      };
    })()`, (value) => value.mascot
      && value.sharedCard
      && value.state === "review"
      && value.reason === "network-unavailable"
      && value.serviceState === "offline"
      && value.output.length > 80);

    assert.equal(offlineReady.serviceUrl, offlineServiceUrl);
    assert.equal(offlineReady.reasonVisible, true);

    const offlineInsertOutput = await evaluate(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host.shadowRoot;
      window.__smartPromptLastOutput = root.querySelector("[data-assistant-editor]").value;
      root.querySelector("[data-assistant-primary]").click();
      return window.__smartPromptLastOutput;
    })()`);
    const offlineInsert = await waitFor(client, `(() => {
      const host = document.getElementById("smart-prompt-card");
      const root = host?.shadowRoot;
      return {
        input: document.querySelector(".composer textarea")?.value || "",
        submitCount: window.__demoSubmitCount,
        cardStillOpen: Boolean(host),
        assistantState: host?.dataset.assistantState || "",
        assistantVerification: document.documentElement.dataset.smartPromptAssistantVerification || "",
        noAutoSubmit: document.documentElement.dataset.smartPromptNoAutoSubmit || "",
        primaryAction: root?.querySelector("[data-assistant-primary]")?.dataset.action || "",
        lastInsertResult: window.__smartPromptDebug?.lastInsertResult || null,
        feedback: window.__demoStorage?.smartPromptFeedback || []
      };
    })()`, (value) => value.cardStillOpen
      && value.input === offlineInsertOutput
      && value.assistantState === "inserted"
      && value.primaryAction === "complete");

    assert.equal(offlineInsert.submitCount, 0);
    assert.equal(offlineInsert.assistantVerification, "machine");
    assert.equal(offlineInsert.noAutoSubmit, "true");
    assert.equal(offlineInsert.lastInsertResult.verified, true);
    assert.equal(offlineInsert.feedback[0].action, "insert");
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
    await closeServer(styleHarness.server);
  }

  console.log(`runtime-demo tests passed; artifacts retained at ${dataDir} and ${profileDir}`);
})();
