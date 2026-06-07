const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { startServer } = require("../../../apps/local-service/src/server");
const { createStore } = require("../../../apps/local-service/src/store");
const { collectRedactionLeaks, redactEvidence } = require("../../../packages/shared/evidence-redaction");
const siteAdapters = require("../src/site-adapters.js");

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const remotePort = Number(process.env.SMART_PROMPT_LIVE_CDP_PORT || 9232);
const attachCdp = process.env.SMART_PROMPT_LIVE_ATTACH_CDP === "1";
const headless = process.env.SMART_PROMPT_LIVE_HEADLESS === "1";
const extensionDir = path.resolve(__dirname, "..");
const reportPath = process.env.SMART_PROMPT_LIVE_REPORT || "";
const injectFallback = process.env.SMART_PROMPT_LIVE_INJECT_FALLBACK !== "0";
const schemaVersion = process.env.SMART_PROMPT_LIVE_SCHEMA_VERSION || "v2-live-site-probe@1";
const formalMode = schemaVersion === "v3-live-site-formal@1";
const pilotMode = schemaVersion === "m3-pilot-adapters@1";
const noAutoSendWaitMs = Number(process.env.SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS || 2000);
const profileDirOverride = process.env.SMART_PROMPT_LIVE_PROFILE_DIR
  ? path.resolve(process.env.SMART_PROMPT_LIVE_PROFILE_DIR)
  : "";
const loginWaitMs = Number(process.env.SMART_PROMPT_LIVE_LOGIN_WAIT_MS || 0);
const siteFilter = new Set(
  String(process.env.SMART_PROMPT_LIVE_SITE_IDS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const sourceFiles = [
  "src/site-adapters.js",
  "src/local-service-client.js",
  "src/prompt-engine.js",
  "src/content.js"
];
const genericInputSelectors = [
  "textarea",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="url"]',
  "input:not([type])",
  '[contenteditable="true"]',
  '[role="textbox"]'
];
function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getProbeSelectors(site) {
  const adapter = siteAdapters.SITE_ADAPTERS.find((item) => item.id === site.id);
  return unique([...(adapter?.inputSelectors || []), ...genericInputSelectors]);
}

function createCollectInputsSource(site) {
  const selectors = JSON.stringify(getProbeSelectors(site));
  return `
function smartPromptProbeInputs(root = document, out = [], seen = new Set()) {
  if (!root.querySelectorAll) return out;
  const selectors = ${selectors};
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (!seen.has(element)) {
        seen.add(element);
        out.push(element);
      }
    }
  }
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) smartPromptProbeInputs(element.shadowRoot, out, seen);
  }
  return out;
}
`;
}

const sites = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", requireInsert: true },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", requireInsert: true },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", requireInsert: true },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/", requireInsert: false },
  { id: "bolt", name: "Bolt", url: "https://bolt.new/", requireInsert: false },
  { id: "v0", name: "v0", url: "https://v0.dev/chat", requireInsert: false },
  { id: "lovable", name: "Lovable", url: "https://lovable.dev/", requireInsert: false },
  { id: "replit", name: "Replit", url: "https://replit.com/agent4", requireInsert: false },
  { id: "workbuddy", name: "workBuddy", url: "https://work-buddy.ai/", requireInsert: true, betaPilot: true },
  { id: "trae", name: "Trae", url: "https://www.trae.ai/solo", requireInsert: true, betaPilot: true },
  { id: "doubao", name: "Doubao", url: "https://www.doubao.com/chat/", requireInsert: true, betaPilot: true },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/", requireInsert: true, betaPilot: true }
];
const defaultSiteIds = ["chatgpt", "claude", "gemini", "perplexity", "lovable", "bolt", "v0", "replit"];
const activeSites = siteFilter.size
  ? sites.filter((site) => siteFilter.has(site.id))
  : sites.filter((site) => defaultSiteIds.includes(site.id));
const missingSiteFilters = Array.from(siteFilter).filter((id) => !sites.some((site) => site.id === id));

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

async function waitForTarget(targetId = "") {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${remotePort}/json/list`);
      const target = targets.find((item) => {
        if (item.type !== "page" || !item.webSocketDebuggerUrl) return false;
        return targetId ? item.id === targetId : true;
      });
      if (target) return target;
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error("Chrome CDP target did not become available.");
}

async function waitForBrowserEndpoint() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const version = await getJson(`http://127.0.0.1:${remotePort}/json/version`);
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error("Chrome browser CDP endpoint did not become available.");
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

function createNoAutoSendSource() {
  return `
function smartPromptProbeMessageCount() {
  const selectors = [
    "[data-message-author-role]",
    "[data-testid*='conversation-turn']",
    "[data-testid*='message']",
    "article",
    "[class*='message']"
  ];
  const seen = new Set();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) seen.add(element);
  }
  return seen.size;
}
function smartPromptProbeGenerationStarted() {
  const selectors = [
    "button[aria-label*='Stop']",
    "button[aria-label*='stop']",
    "button[aria-label*='停止']",
    "[data-testid*='stop']",
    "[data-testid*='Stop']"
  ];
  return selectors.some((selector) => document.querySelector(selector));
}
function smartPromptProbeVisibleInputTarget() {
  const inputs = smartPromptProbeInputs()
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const insideExtensionUi = Boolean(element.closest?.("#smart-prompt-card, #smart-prompt-mascot"));
      return !insideExtensionUi && rect.width > 24 && rect.height > 18 && style.visibility !== "hidden" && style.display !== "none";
    });
  const active = document.activeElement;
  if (window.__smartPromptDebugProbeFocus && inputs.includes(window.__smartPromptDebugProbeFocus)) {
    return window.__smartPromptDebugProbeFocus;
  }
  if (active && inputs.includes(active)) return active;
  return inputs[0] || null;
}
function smartPromptProbeInputValue(element) {
  if (!element) return "";
  return "value" in element ? element.value || "" : element.innerText || element.textContent || "";
}
function smartPromptProbeInsertEvidence() {
  const data = document.documentElement.dataset || {};
  return {
    ok: data.smartPromptInsertOk === "true",
    verified: data.smartPromptInsertVerified === "true",
    kind: data.smartPromptInsertKind || "",
    strategy: data.smartPromptInsertStrategy || "",
    reason: data.smartPromptInsertReason || "",
    valueLength: Number(data.smartPromptInsertValueLength || 0),
    createdAt: Number(data.smartPromptInsertCreatedAt || 0)
  };
}
`;
}

async function performInsertProbe(client, collectInputsSource) {
  await waitFor(client, `(() => {
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

  const started = await evaluate(client, `(() => {
    ${collectInputsSource}
    ${createNoAutoSendSource()}
    const output = document.querySelector("#smart-prompt-card .spc-output")?.value || "";
    const target = smartPromptProbeVisibleInputTarget();
    const probe = {
      submitEvents: 0,
      requestSubmitCalls: 0,
      formSubmitCalls: 0,
      beforeUrl: location.href,
      beforeMessageCount: smartPromptProbeMessageCount(),
      beforeInputLength: smartPromptProbeInputValue(target).length
    };
    window.__smartPromptNoAutoSendProbe = probe;
    window.__smartPromptNoAutoSendOutputPrefix = output.slice(0, 40);
    window.__smartPromptNoAutoSendOutputLength = output.length;
    if (!window.__smartPromptNoAutoSendSubmitListener) {
      document.addEventListener("submit", () => {
        if (window.__smartPromptNoAutoSendProbe) window.__smartPromptNoAutoSendProbe.submitEvents += 1;
      }, true);
      window.__smartPromptNoAutoSendSubmitListener = true;
    }
    if (!window.__smartPromptNoAutoSendPatched && typeof HTMLFormElement !== "undefined") {
      const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
      const originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.requestSubmit = function smartPromptObservedRequestSubmit(...args) {
        if (window.__smartPromptNoAutoSendProbe) window.__smartPromptNoAutoSendProbe.requestSubmitCalls += 1;
        return originalRequestSubmit.apply(this, args);
      };
      HTMLFormElement.prototype.submit = function smartPromptObservedSubmit(...args) {
        if (window.__smartPromptNoAutoSendProbe) window.__smartPromptNoAutoSendProbe.formSubmitCalls += 1;
        return originalSubmit.apply(this, args);
      };
      window.__smartPromptNoAutoSendPatched = true;
    }
    document.querySelector('#smart-prompt-card button[data-action="insert"]')?.click();
    const insertEvidence = smartPromptProbeInsertEvidence();
    return {
      opened: true,
      cardOpened: Boolean(document.getElementById("smart-prompt-card")),
      outputLength: output.length,
      beforeMessageCount: probe.beforeMessageCount,
      beforeInputLength: probe.beforeInputLength,
      insertEvidence,
      url: location.href
    };
  })()`);

  const afterInsert = await waitFor(client, `(() => {
    ${collectInputsSource}
    ${createNoAutoSendSource()}
    const target = smartPromptProbeVisibleInputTarget();
    const value = smartPromptProbeInputValue(target);
    const writerResult = window.__smartPromptDebug?.lastInsertResult || null;
    const outputLength = window.__smartPromptNoAutoSendOutputLength || 0;
    const outputPrefix = window.__smartPromptNoAutoSendOutputPrefix || "";
    const outputPrefixContained = Boolean(outputPrefix && value.includes(outputPrefix));
    const cardClosed = !document.getElementById("smart-prompt-card");
    const insertEvidence = smartPromptProbeInsertEvidence();
    const afterWriteVerified = Boolean(writerResult?.verified || insertEvidence.verified);
    return {
      outputLength,
      valueLength: value.length,
      outputPrefixContained,
      cardClosed,
      afterWriteVerified,
      verifiedBy: writerResult?.verified ? "content-debug" : insertEvidence.verified ? "dom-evidence" : "",
      writerResult,
      insertEvidence,
      url: location.href
    };
  })()`, (value) => value.cardClosed || value.afterWriteVerified || value.outputPrefixContained, 5000);

  await sleep(noAutoSendWaitMs);

  const noAutoSend = await evaluate(client, `(() => {
    ${collectInputsSource}
    ${createNoAutoSendSource()}
    const probe = window.__smartPromptNoAutoSendProbe || {};
    const target = smartPromptProbeVisibleInputTarget();
    const value = smartPromptProbeInputValue(target);
    const outputPrefix = window.__smartPromptNoAutoSendOutputPrefix || "";
    const outputLength = window.__smartPromptNoAutoSendOutputLength || 0;
    const cardClosed = !document.getElementById("smart-prompt-card");
    const outputPrefixContained = Boolean(outputPrefix && value.includes(outputPrefix));
    const insertEvidence = smartPromptProbeInsertEvidence();
    const verifiedWriteRetained = Boolean(insertEvidence.verified && insertEvidence.valueLength > 0 && value.length >= insertEvidence.valueLength);
    const inputRetained = outputPrefixContained || verifiedWriteRetained;
    const navigationChanged = location.href !== probe.beforeUrl;
    const messageCount = smartPromptProbeMessageCount();
    const messageCountChanged = Number.isFinite(probe.beforeMessageCount) && messageCount !== probe.beforeMessageCount;
    const nativeSubmitEventCount = probe.submitEvents || 0;
    const requestSubmitCallCount = probe.requestSubmitCalls || 0;
    const formSubmitCallCount = probe.formSubmitCalls || 0;
    const assistantGenerationStarted = smartPromptProbeGenerationStarted();
    const submitted = nativeSubmitEventCount > 0 || requestSubmitCallCount > 0 || formSubmitCallCount > 0;
    return {
      waitMs: ${JSON.stringify(noAutoSendWaitMs)},
      outputLength,
      valueLength: value.length,
      outputPrefixContained,
      insertEvidence,
      cardClosed,
      inputRetained,
      retainedBy: outputPrefixContained ? "external-prefix" : verifiedWriteRetained ? "dom-evidence-length" : "",
      navigationChanged,
      messageCountChanged,
      assistantGenerationStarted,
      nativeSubmitEventCount,
      requestSubmitCallCount,
      formSubmitCallCount,
      submitted,
      passed: inputRetained && !navigationChanged && !messageCountChanged && !assistantGenerationStarted && !submitted
    };
  })()`);

  return {
    opened: true,
    card,
    started,
    afterInsert,
    noAutoSend,
    filledOnly: Boolean(afterInsert.afterWriteVerified && noAutoSend.inputRetained && !noAutoSend.submitted),
    ok: Boolean(
      (afterInsert.cardClosed || noAutoSend.cardClosed)
        && afterInsert.outputLength > 80
        && afterInsert.afterWriteVerified
        && noAutoSend.passed
    )
  };
}

async function probeSite(client, site) {
  await client.send("Page.navigate", { url: site.url });
  await client.send("Page.loadEventFired").catch(() => {});
  await sleep(Number(process.env.SMART_PROMPT_LIVE_SETTLE_MS || 8000));
  let injectedProbe = false;
  const probeSelectors = getProbeSelectors(site);
  const collectInputsSource = createCollectInputsSource(site);

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
      inputSelectors: ${JSON.stringify(probeSelectors)},
      candidates
    };
  })()`);

  const focusExpression = `(() => {
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
    target.click?.();
    target.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    globalThis.__smartPromptDebugProbeFocus = target;
    return {
      ok: true,
      tag: target.tagName,
      id: target.id || "",
      role: target.getAttribute("role") || "",
      contentEditable: target.isContentEditable,
      beforeValue: ("value" in target ? target.value : target.textContent || "").slice(0, 80)
    };
  })()`;
  let focusResult = await evaluate(client, focusExpression);

  if (!focusResult.ok && loginWaitMs > 0) {
    await sleep(loginWaitMs);
    focusResult = await evaluate(client, focusExpression);
  }

  if (!focusResult.ok) {
    if (injectFallback && await injectProbeRuntime(client)) {
      injectedProbe = true;
      await sleep(500);
      return probeSiteAfterInjection(client, site, initial, focusResult);
    }
    return { ...site, injectedProbe, passedDisplay: false, passedInsert: false, initial, focusResult };
  }
  await evaluate(client, `(() => {
    const target = window.__smartPromptDebugProbeFocus;
    if (target) {
      target.focus();
      target.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    }
    return window.__smartPromptDebug || null;
  })()`).catch(() => null);

  let display;
  try {
    display = await waitFor(client, `(() => {
      const mascot = document.getElementById("smart-prompt-mascot");
      const rect = mascot?.getBoundingClientRect();
      return {
        mascot: Boolean(mascot),
        visible: Boolean(mascot && rect && rect.width > 20 && rect.height > 20),
        rect: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        state: mascot?.dataset?.state || "",
        transform: mascot?.style?.transform || "",
        debug: window.__smartPromptDebug || null
      };
    })()`, (value) => value.mascot && value.visible, 10000);
  } catch (error) {
    if (!injectedProbe && injectFallback && await injectProbeRuntime(client)) {
      injectedProbe = true;
      await sleep(500);
      return probeSiteAfterInjection(client, site, initial, focusResult);
    }
    return { ...site, injectedProbe, passedDisplay: false, passedInsert: false, initial, focusResult, displayError: error.message };
  }

  if (!site.requireInsert) {
    return { ...site, injectedProbe, passedDisplay: true, passedInsert: null, initial, focusResult, display };
  }

  let insert;
  try {
    insert = await performInsertProbe(client, collectInputsSource);
  } catch (error) {
    insert = { opened: false, ok: false, error: error.message };
  }

  return {
    ...site,
    injectedProbe,
    passedDisplay: true,
    passedInsert: Boolean(insert.ok),
    initial,
    focusResult,
    display,
    insert,
    noAutoSend: insert.noAutoSend || null
  };
}

async function probeSiteAfterInjection(client, site, initialBeforeInjection, focusBeforeInjection) {
  await waitFor(client, "Boolean(window.__smartPromptCopilotReady)", (value) => value, 3000).catch(() => {});
  const probeSelectors = getProbeSelectors(site);
  const collectInputsSource = createCollectInputsSource(site);
  const refocused = await evaluate(client, `(() => {
    ${collectInputsSource}
    const candidates = smartPromptProbeInputs()
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 24 && rect.height > 18 && style.visibility !== "hidden" && style.display !== "none";
      });
    const target = candidates[0];
    if (!target) return { ok: false, reason: "no visible input candidate after injection" };
    target.scrollIntoView({ block: "center", inline: "center" });
    target.focus();
    target.click?.();
    target.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    globalThis.__smartPromptDebugProbeFocus = target;
    return {
      ok: true,
      tag: target.tagName,
      id: target.id || "",
      role: target.getAttribute("role") || "",
      contentEditable: target.isContentEditable,
      beforeValue: ("value" in target ? target.value : target.textContent || "").slice(0, 80)
    };
  })()`);
  if (!refocused.ok) {
    return {
      ...site,
      injectedProbe: true,
      passedDisplay: false,
      passedInsert: false,
      initial: initialBeforeInjection,
      focusResult: focusBeforeInjection,
      injectedFocusResult: refocused
    };
  }

  let display;
  try {
    display = await waitFor(client, `(() => {
      const mascot = document.getElementById("smart-prompt-mascot");
      const rect = mascot?.getBoundingClientRect();
      return {
        mascot: Boolean(mascot),
        visible: Boolean(mascot && rect && rect.width > 20 && rect.height > 20),
        rect: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        state: mascot?.dataset?.state || "",
        transform: mascot?.style?.transform || "",
        debug: window.__smartPromptDebug || null
      };
    })()`, (value) => value.mascot && value.visible, 10000);
  } catch (error) {
    return {
      ...site,
      injectedProbe: true,
      passedDisplay: false,
      passedInsert: false,
      initial: initialBeforeInjection,
      focusResult: focusBeforeInjection,
      injectedFocusResult: refocused,
      displayError: error.message
    };
  }

  if (!site.requireInsert) {
    return {
      ...site,
      injectedProbe: true,
      passedDisplay: true,
      passedInsert: null,
      initial: initialBeforeInjection,
      focusResult: focusBeforeInjection,
      injectedFocusResult: refocused,
      display
    };
  }

  let insert;
  try {
    insert = await performInsertProbe(client, collectInputsSource);
  } catch (error) {
    insert = { opened: false, ok: false, error: error.message };
  }

  return {
    ...site,
    injectedProbe: true,
    passedDisplay: true,
    passedInsert: Boolean(insert.ok),
    initial: initialBeforeInjection,
    focusResult: focusBeforeInjection,
    injectedFocusResult: refocused,
    display,
    insert,
    noAutoSend: insert.noAutoSend || null
  };
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

function getVisibleInputCount(result) {
  return (result.initial?.candidates || []).filter((candidate) => candidate.visible).length;
}

function getFocusResult(result) {
  return result.focusResult?.ok ? result.focusResult : result.injectedFocusResult || result.focusResult || {};
}

function getInputKind(focus) {
  if (focus.contentEditable) return "contenteditable";
  const tag = String(focus.tag || "").toLowerCase();
  return tag || "unknown";
}

function toFormalSite(result, extensionLoad) {
  const focus = getFocusResult(result);
  const insert = result.insert || {};
  const afterInsert = insert.afterInsert || {};
  const noAutoSend = result.noAutoSend || insert.noAutoSend || null;
  const requiredInsert = Boolean(result.requireInsert);
  const formalExtensionLoaded = Boolean(extensionLoad.ok && !result.injectedProbe);
  const displayPassed = Boolean(result.passedDisplay && formalExtensionLoaded);
  const insertPassed = Boolean(requiredInsert && result.passedInsert && formalExtensionLoaded && insert.ok);

  return {
    id: result.id,
    required: {
      display: true,
      insert: requiredInsert,
      noAutoSend: requiredInsert
    },
    requiredDisplay: true,
    requiredInsert,
    formalExtensionLoaded,
    injectedProbe: Boolean(result.injectedProbe),
    focus: {
      ok: Boolean(focus.ok),
      visibleInputCount: getVisibleInputCount(result),
      inputKind: getInputKind(focus)
    },
    display: {
      passed: displayPassed,
      mascot: Boolean(result.display?.mascot),
      visible: Boolean(result.display?.visible),
      rect: result.display?.rect || null,
      adapterIdMatched: !result.display?.debug?.lastAdapterId || result.display.debug.lastAdapterId === result.id
    },
    insert: requiredInsert
      ? {
          required: true,
          passed: insertPassed,
          opened: Boolean(insert.opened),
          cardOpened: Boolean(insert.card?.card || insert.started?.cardOpened),
          outputLength: afterInsert.outputLength || insert.started?.outputLength || insert.card?.outputLength || 0,
          afterValueLength: afterInsert.valueLength || 0,
          outputPrefixContained: Boolean(afterInsert.outputPrefixContained),
          cardClosed: Boolean(afterInsert.cardClosed || noAutoSend?.cardClosed),
          afterWriteVerified: Boolean(afterInsert.afterWriteVerified),
          verifiedBy: afterInsert.verifiedBy || "",
          strategy: afterInsert.insertEvidence?.strategy || afterInsert.writerResult?.strategy || "",
          kind: afterInsert.insertEvidence?.kind || afterInsert.writerResult?.kind || "",
          reason: afterInsert.insertEvidence?.reason || afterInsert.writerResult?.reason || "",
          filledOnly: Boolean(insert.filledOnly),
          submitted: Boolean(noAutoSend?.submitted)
        }
      : {
          required: false,
          passed: null
        },
    noAutoSend: requiredInsert
      ? {
          required: true,
          passed: Boolean(noAutoSend?.passed),
          waitMs: noAutoSend?.waitMs || 0,
          outputLength: noAutoSend?.outputLength || 0,
          valueLength: noAutoSend?.valueLength || 0,
          outputPrefixContained: Boolean(noAutoSend?.outputPrefixContained),
          inputRetained: Boolean(noAutoSend?.inputRetained),
          retainedBy: noAutoSend?.retainedBy || "",
          navigationChanged: Boolean(noAutoSend?.navigationChanged),
          messageCountChanged: Boolean(noAutoSend?.messageCountChanged),
          assistantGenerationStarted: Boolean(noAutoSend?.assistantGenerationStarted),
          nativeSubmitEventCount: noAutoSend?.nativeSubmitEventCount || 0,
          requestSubmitCallCount: noAutoSend?.requestSubmitCallCount || 0,
          formSubmitCallCount: noAutoSend?.formSubmitCallCount || 0,
          submitted: Boolean(noAutoSend?.submitted)
        }
      : {
          required: false,
          passed: null
        },
    privacy: {
      urlRedacted: true,
      profilePathRedacted: true,
      promptTextRedacted: true,
      tokenRedacted: true
    },
    evidence: {
      sourceReport: reportPath ? path.basename(reportPath) : "stdout",
      createdAt: result.createdAt || ""
    }
  };
}

function getPilotFailureReason(result, formalSite) {
  if (!formalSite.formalExtensionLoaded) return "extension_not_loaded";
  if (!formalSite.focus.ok) return result.focusResult?.reason || result.injectedFocusResult?.reason || "no_visible_input_candidate";
  if (!formalSite.display.passed) return result.displayError || "mascot_not_visible";
  if (formalSite.required.insert && !formalSite.insert.passed) {
    return formalSite.insert.reason || result.insert?.error || "insert_not_verified";
  }
  if (formalSite.required.noAutoSend && !formalSite.noAutoSend.passed) return "no_auto_send_failed";
  return "";
}

function toPilotSite(result, formalSite) {
  const insertAttempted = Boolean(formalSite.required.insert);
  const failureReason = getPilotFailureReason(result, formalSite);
  return {
    id: result.id,
    name: result.name,
    betaPilot: Boolean(result.betaPilot),
    urlHost: new URL(result.url).hostname,
    formalExtensionLoaded: formalSite.formalExtensionLoaded,
    visibleInputCount: formalSite.focus.visibleInputCount,
    focusOk: formalSite.focus.ok,
    displayPassed: formalSite.display.passed,
    insertAttempted,
    insertPassed: insertAttempted ? Boolean(formalSite.insert.passed) : null,
    noAutoSendPassed: insertAttempted ? Boolean(formalSite.noAutoSend.passed) : null,
    insertStrategy: formalSite.insert.strategy || "",
    insertKind: formalSite.insert.kind || "",
    failureReason,
    privacy: formalSite.privacy
  };
}

(async () => {
  if (!attachCdp) assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
  assert.equal(missingSiteFilters.length, 0, `Unknown SMART_PROMPT_LIVE_SITE_IDS: ${missingSiteFilters.join(", ")}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-live-service-"));
  const profileDir = profileDirOverride || (attachCdp ? "" : fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-live-chrome-")));
  if (profileDirOverride) fs.mkdirSync(profileDir, { recursive: true });
  const service = await startServiceForProbe(dataDir);
  const args = [
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${remotePort}`,
    "about:blank"
  ];
  if (headless) args.unshift("--headless=new");

  const chrome = attachCdp ? null : spawn(chromePath, args, { stdio: "ignore" });
  const results = [];
  let extensionLoad = { ok: false };
  let browserClient;
  let client;
  let probeTargetId = "";
  try {
    const browserEndpoint = await waitForBrowserEndpoint();
    browserClient = await createCdpClient(browserEndpoint);
    try {
      const loaded = await browserClient.send("Extensions.loadUnpacked", { path: extensionDir });
      const extensions = await browserClient.send("Extensions.getExtensions");
      extensionLoad = {
        ok: true,
        id: loaded.id,
        matchedExtension: extensions.extensions.find((extension) => extension.id === loaded.id) || null
      };
    } catch (error) {
      extensionLoad = { ok: false, error: error.message };
    }

    if (attachCdp) {
      const created = await browserClient.send("Target.createTarget", { url: "about:blank" });
      probeTargetId = created.targetId || "";
    }
    const target = await waitForTarget(probeTargetId);
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    for (const site of activeSites) {
      try {
        results.push(await probeSite(client, site));
      } catch (error) {
        results.push({ ...site, passedDisplay: false, passedInsert: false, error: error.message });
      }
    }
  } finally {
    if (client) client.close();
    if (probeTargetId && browserClient) {
      await browserClient.send("Target.closeTarget", { targetId: probeTargetId }).catch(() => {});
    }
    if (browserClient) browserClient.close();
    if (chrome) {
      if (!chrome.killed) chrome.kill();
      await new Promise((resolve) => {
        chrome.once("exit", resolve);
        setTimeout(resolve, 2000);
      });
    }
    await closeServer(service);
    await removeDirWithRetry(dataDir);
    if (!profileDirOverride && profileDir) await removeDirWithRetry(profileDir);
  }

  const displayPasses = results.filter((item) => item.passedDisplay).length;
  const insertPasses = results.filter((item) => item.requireInsert && item.passedInsert).map((item) => item.id);
  const displayRequired = siteFilter.size ? activeSites.length : 5;
  const requiredInsertIds = activeSites.filter((site) => site.requireInsert).map((site) => site.id);
  const requiredDisplayIds = activeSites.map((site) => site.id);
  const formalSites = results.map((result) => toFormalSite(result, extensionLoad));
  const formalDisplayPasses = formalSites.filter((site) => site.display.passed).map((site) => site.id);
  const formalInsertPasses = formalSites.filter((site) => site.required.insert && site.insert.passed).map((site) => site.id);
  const noAutoSendPasses = formalSites.filter((site) => site.required.noAutoSend && site.noAutoSend.passed).map((site) => site.id);
  const displayMissing = requiredDisplayIds.filter((id) => !formalDisplayPasses.includes(id));
  const insertMissing = requiredInsertIds.filter((id) => !formalInsertPasses.includes(id));
  const noAutoSendMissing = requiredInsertIds.filter((id) => !noAutoSendPasses.includes(id));
  const injectedProbeFailures = formalSites.filter((site) => site.injectedProbe).map((site) => site.id);
  const formalPass = Boolean(
    extensionLoad.ok
      && displayMissing.length === 0
      && insertMissing.length === 0
      && noAutoSendMissing.length === 0
      && injectedProbeFailures.length === 0
  );
  const pilotSites = results.map((result, index) => toPilotSite(result, formalSites[index]));
  const pilotInsertAttempts = pilotSites.filter((site) => site.insertAttempted).length;
  const pilotInsertPasses = pilotSites.filter((site) => site.insertPassed).length;
  const pilotFailureReasons = {};
  for (const site of pilotSites) {
    if (site.failureReason) pilotFailureReasons[site.failureReason] = (pilotFailureReasons[site.failureReason] || 0) + 1;
  }
  const pilotPass = Boolean(extensionLoad.ok && pilotSites.length === activeSites.length);
  const report = {
    schemaVersion,
    createdAt: new Date().toISOString(),
    mode: formalMode ? "LIVE_SITE_FORMAL_PASS" : pilotMode ? "M3_PILOT_ADAPTERS" : "LIVE_SITE_PROBE",
    pass: formalMode
      ? formalPass
      : pilotMode
        ? pilotPass
        : displayPasses >= displayRequired && requiredInsertIds.every((id) => insertPasses.includes(id)),
    formalExtensionOnly: formalMode,
    attachCdp,
    remotePort,
    headless,
    injectFallback,
    loginWaitMs,
    noAutoSendWaitMs,
    siteFilter: Array.from(siteFilter),
    profilePersistent: Boolean(profileDirOverride),
    profileDir: profileDirOverride || "",
    extensionLoad,
    displayPasses,
    displayRequired,
    requiredInsertIds,
    insertPasses,
    requirements: {
      displaySiteIds: requiredDisplayIds,
      insertSiteIds: requiredInsertIds,
      noAutoSendSiteIds: requiredInsertIds,
      requireFormalExtension: formalMode,
      requireInjectedProbeFalse: formalMode,
      insertMustNotSubmit: true,
      redactionRequired: true
    },
    summary: {
      displayPasses: formalDisplayPasses,
      insertPasses: formalInsertPasses,
      noAutoSendPasses,
      displayMissing,
      insertMissing,
      noAutoSendMissing,
      injectedProbeFailures,
      anyInjectedProbe: injectedProbeFailures.length > 0,
      redactionLeaks: []
    },
    pilot: pilotMode
      ? {
          siteIds: activeSites.map((site) => site.id),
          insertAttempts: pilotInsertAttempts,
          insertPasses: pilotInsertPasses,
          insertSuccessRate: pilotInsertAttempts ? pilotInsertPasses / pilotInsertAttempts : 0,
          failureReasons: pilotFailureReasons,
          sites: pilotSites
        }
      : null,
    sites: formalSites,
    results
  };
  const safeReport = redactEvidence(report);
  const redactionLeaks = collectRedactionLeaks(safeReport);
  safeReport.summary.redactionLeaks = redactionLeaks;
  safeReport.pass = Boolean(safeReport.pass && redactionLeaks.length === 0);
  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(safeReport, null, 2));
  }
  console.log(JSON.stringify(safeReport, null, 2));

  const missingInsert = requiredInsertIds.filter((id) => !insertPasses.includes(id));
  if ((formalMode && !safeReport.pass) || (!formalMode && !pilotMode && (displayPasses < displayRequired || missingInsert.length > 0))) {
    process.exitCode = 1;
  }
})();
