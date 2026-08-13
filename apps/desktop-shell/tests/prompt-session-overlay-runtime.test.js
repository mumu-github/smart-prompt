const assert = require("node:assert");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "../..");
const outputDir = path.join(repoRoot, "outputs", "assistant-card-phase2");
const playwrightChromePath = path.join(
  process.env.LOCALAPPDATA || "",
  "ms-playwright",
  "chromium_headless_shell-1223",
  "chrome-headless-shell-win64",
  "chrome-headless-shell.exe"
);
const chromePath = process.env.CHROME_PATH
  || (fs.existsSync(playwrightChromePath) ? playwrightChromePath : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const closeGuard = setTimeout(() => {}, 1000);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        resolve(port);
        setImmediate(() => clearTimeout(closeGuard));
      });
    });
  });
}

async function waitForTarget(port, expectedUrl) {
  const deadline = Date.now() + 10000;
  const normalizedExpectedUrl = decodeURIComponent(expectedUrl).replace(/\\/g, "/");
  let lastPageUrls = [];
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000)
      });
      const targets = await response.json();
      const pageTargets = targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
      lastPageUrls = pageTargets.map((item) => String(item.url || ""));
      const target = pageTargets.find((item) => {
        return decodeURIComponent(String(item.url || "")).replace(/\\/g, "/") === normalizedExpectedUrl;
      });
      if (target) return target;
    } catch {
      // Chrome is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Desktop overlay CDP target did not become available. Targets: ${JSON.stringify(lastPageUrls)}`);
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    const connectTimeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Desktop overlay CDP websocket timed out: ${url}`));
    }, 5000);
    socket.addEventListener("open", () => {
      clearTimeout(connectTimeout);
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((innerResolve, innerReject) => {
            const timeout = setTimeout(() => {
              pending.delete(id);
              innerReject(new Error(`Desktop overlay CDP command timed out: ${method}`));
            }, 5000);
            pending.set(id, { resolve: innerResolve, reject: innerReject, timeout });
          });
        },
        close() {
          for (const handlers of pending.values()) {
            clearTimeout(handlers.timeout);
            handlers.reject(new Error("Desktop overlay CDP client closed."));
          }
          pending.clear();
          socket.close();
        }
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(handlers.timeout);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result || {});
    });
    socket.addEventListener("error", (error) => {
      clearTimeout(connectTimeout);
      reject(error);
    });
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

async function waitFor(client, expression, predicate) {
  const deadline = Date.now() + 10000;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, expression);
    if (predicate(lastValue)) return lastValue;
    await sleep(100);
  }
  throw new Error(`Condition not met: ${expression}\nLast value: ${JSON.stringify(lastValue)}`);
}

async function renderProbe(client, payload) {
  return evaluate(client, `(() => {
    window.render(${JSON.stringify(payload)});
    const host = document.getElementById("smart-prompt-assistant-host");
    const root = host?.shadowRoot;
    const message = root?.querySelector("[data-assistant-title]");
    const hint = root?.querySelector("[data-assistant-description]");
    const primary = root?.querySelector("[data-assistant-primary]");
    return {
      sharedCard: Boolean(root?.querySelector("[data-assistant-card]")),
      state: document.documentElement.dataset.assistantState || "",
      reason: document.documentElement.dataset.assistantReason || "",
      verification: document.documentElement.dataset.assistantVerification || "",
      contractVersion: document.documentElement.dataset.assistantContractVersion || "",
      noAutoSubmit: document.documentElement.dataset.noAutoSubmit || "",
      message: message?.textContent || "",
      hint: hint?.textContent || "",
      primary: primary?.textContent || "",
      primaryAction: primary?.dataset.action || "",
      secondaryCount: root?.querySelectorAll("[data-assistant-secondary] button").length || 0,
      safety: root?.querySelector("[data-assistant-safety]")?.textContent || "",
      legacyExpandedVisible: getComputedStyle(document.getElementById("mascot-overlay-card")).display !== "none",
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      clipped: Boolean(message && (message.scrollWidth > message.clientWidth || message.scrollHeight > message.clientHeight))
    };
  })()`);
}

async function capture(client, name) {
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(screenshot.data, "base64"));
}

const testRunGuard = setInterval(() => {}, 1000);

(async () => {
  console.log(`prompt-session overlay runtime using ${chromePath}`);
  assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
  const remotePort = await getAvailablePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-overlay-session-"));
  const pageUrl = pathToFileURL(path.join(root, "overlay.html")).href;
  const runtimeEvidence = {};
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
    pageUrl
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeDiagnostics = "";
  chrome.stderr.on("data", (chunk) => {
    chromeDiagnostics = `${chromeDiagnostics}${chunk}`.slice(-12000);
  });

  let client;
  try {
    const target = await waitForTarget(remotePort, pageUrl);
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 }
    });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 360,
      deviceScaleFactor: 1,
      mobile: false
    });
    await waitFor(client, `typeof window.render === "function" && document.documentElement.dataset.assistantContractVersion`, Boolean);

    const readyTarget = {
      profile: "codex",
      candidateIndex: 8,
      candidateCount: 1,
      safeCandidateCount: 1,
      readinessReason: "ready",
      overlayReadinessReason: "ready",
      overlayReady: true,
      noAutoSubmit: true,
      overlayMode: "expanded",
      locale: "zh-CN"
    };

    const idle = await renderProbe(client, {
      ...readyTarget,
      state: "suggesting",
      promptReady: false,
      promptKind: "none",
      promptMode: "idea"
    });
    assert.deepEqual([idle.state, idle.message, idle.primary], ["idle", "需要我帮你整理吗", "生成提示词"]);

    const review = await renderProbe(client, {
      ...readyTarget,
      state: "suggesting",
      promptReady: true,
      promptKind: "generated",
      promptMode: "continue",
      promptText: "Synthetic desktop review prompt for contract verification."
    });
    assert.deepEqual([review.state, review.message, review.primary], ["review", "提示词已生成", "填入输入框"]);
    assert.equal(review.sharedCard, true);
    assert.equal(review.primaryAction, "insert");
    assert.ok(review.secondaryCount <= 2);
    assert.equal(review.safety, "只会填入，不会自动发送");
    assert.equal(review.legacyExpandedVisible, false);
    assert.equal(review.contractVersion, "prompt-session@2");
    assert.equal(review.noAutoSubmit, "true");
    assert.equal(review.overflow, false);
    assert.equal(review.clipped, false);
    runtimeEvidence.review = {
      state: review.state,
      primaryAction: review.primaryAction,
      secondaryCount: review.secondaryCount,
      safetyPresent: Boolean(review.safety),
      legacyExpandedVisible: review.legacyExpandedVisible,
      overflow: review.overflow,
      clipped: review.clipped
    };
    await capture(client, "desktop-review.png");

    const editedPrompt = "Edited desktop prompt routed through the existing fill guard.";
    const editedReview = await evaluate(client, `(() => {
      window.__smartPromptInvocations = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            window.__smartPromptInvocations.push({ command, args });
            return null;
          }
        }
      };
      const root = document.getElementById("smart-prompt-assistant-host")?.shadowRoot;
      const editor = root?.querySelector("[data-assistant-editor]");
      const primary = root?.querySelector("[data-assistant-primary]");
      editor.value = ${JSON.stringify(editedPrompt)};
      editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      const action = primary.dataset.action || "";
      primary.click();
      return { editorValue: editor.value, action };
    })()`);
    assert.deepEqual(editedReview, { editorValue: editedPrompt, action: "insert" });
    const fillInvocation = await waitFor(
      client,
      `window.__smartPromptInvocations.find((item) => item.command === "mascot_overlay_clicked") || null`,
      Boolean
    );
    assert.equal(fillInvocation.args.payload.overlayAction, "fill");
    assert.equal(fillInvocation.args.payload.promptText, editedPrompt);
    assert.equal(fillInvocation.args.payload.promptTextLength, editedPrompt.length);
    assert.equal(fillInvocation.args.payload.promptMode, "continue");
    assert.equal(fillInvocation.args.payload.noAutoSubmit, true);
    runtimeEvidence.fillRouting = {
      command: fillInvocation.command,
      overlayAction: fillInvocation.args.payload.overlayAction,
      promptTextLength: fillInvocation.args.payload.promptTextLength,
      promptMode: fillInvocation.args.payload.promptMode,
      noAutoSubmit: fillInvocation.args.payload.noAutoSubmit
    };

    const reviewPayload = {
      ...readyTarget,
      state: "suggesting",
      promptReady: true,
      promptKind: "generated",
      promptMode: "continue",
      promptText: editedPrompt
    };
    const plainEnter = await evaluate(client, `(() => {
      window.__smartPromptInvocations = [];
      window.render(${JSON.stringify(reviewPayload)});
      const root = document.getElementById("smart-prompt-assistant-host")?.shadowRoot;
      const editor = root?.querySelector("[data-assistant-editor]");
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      editor.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, invocationCount: window.__smartPromptInvocations.length };
    })()`);
    assert.deepEqual(plainEnter, { defaultPrevented: false, invocationCount: 0 });

    const regenerateAction = await evaluate(client, `(() => {
      window.__smartPromptInvocations = [];
      const root = document.getElementById("smart-prompt-assistant-host")?.shadowRoot;
      const button = root?.querySelector('button[data-action="regenerate"]');
      const action = button?.dataset.action || "";
      button?.click();
      return action;
    })()`);
    assert.equal(regenerateAction, "regenerate");
    const regenerateInvocation = await waitFor(
      client,
      `window.__smartPromptInvocations.find((item) => item.command === "mascot_overlay_clicked") || null`,
      Boolean
    );
    assert.equal(regenerateInvocation.args.payload.overlayAction, "generate");
    assert.equal(regenerateInvocation.args.payload.noAutoSubmit, true);
    assert.equal(regenerateInvocation.args.payload.promptText, editedPrompt);
    assert.equal(
      await evaluate(client, `window.__smartPromptInvocations.filter((item) => item.args?.payload?.overlayAction === "fill").length`),
      0
    );
    runtimeEvidence.regenerateRouting = {
      command: regenerateInvocation.command,
      overlayAction: regenerateInvocation.args.payload.overlayAction,
      promptTextLength: regenerateInvocation.args.payload.promptTextLength,
      noAutoSubmit: regenerateInvocation.args.payload.noAutoSubmit
    };

    const modeAction = await evaluate(client, `(() => {
      window.__smartPromptInvocations = [];
      window.render(${JSON.stringify(reviewPayload)});
      const root = document.getElementById("smart-prompt-assistant-host")?.shadowRoot;
      const button = root?.querySelector('button[data-mode="polish"]');
      button?.click();
      return button?.dataset.mode || "";
    })()`);
    assert.equal(modeAction, "polish");
    const modeInvocation = await waitFor(
      client,
      `window.__smartPromptInvocations.find((item) => item.command === "mascot_overlay_clicked") || null`,
      Boolean
    );
    assert.equal(modeInvocation.args.payload.overlayAction, "mode");
    assert.equal(modeInvocation.args.payload.promptMode, "polish");
    assert.equal(modeInvocation.args.payload.noAutoSubmit, true);
    runtimeEvidence.modeRouting = {
      command: modeInvocation.command,
      overlayAction: modeInvocation.args.payload.overlayAction,
      promptMode: modeInvocation.args.payload.promptMode,
      noAutoSubmit: modeInvocation.args.payload.noAutoSubmit
    };

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 384,
      height: 380,
      deviceScaleFactor: 1,
      mobile: false
    });
    const compact = await renderProbe(client, {
      ...readyTarget,
      state: "suggesting",
      overlayMode: "compact",
      promptReady: true,
      promptKind: "generated",
      promptText: editedPrompt
    });
    const compactLayout = await evaluate(client, `(() => {
      const host = document.getElementById("smart-prompt-assistant-host");
      const legacy = document.getElementById("mascot-overlay-card");
      const bounds = legacy.getBoundingClientRect();
      return {
        mode: document.documentElement.dataset.overlayMode,
        sharedHidden: getComputedStyle(host).display === "none",
        legacyVisible: getComputedStyle(legacy).display !== "none",
        htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        legacyBackground: getComputedStyle(legacy).backgroundColor,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      };
    })()`);
    assert.equal(compact.sharedCard, true);
    assert.deepEqual(compactLayout, {
      mode: "compact",
      sharedHidden: true,
      legacyVisible: true,
      htmlBackground: "rgba(0, 0, 0, 0)",
      bodyBackground: "rgba(0, 0, 0, 0)",
      legacyBackground: "rgba(0, 0, 0, 0)",
      width: 72,
      height: 72
    });
    runtimeEvidence.compact = compactLayout;
    await capture(client, "desktop-compact.png");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 360,
      deviceScaleFactor: 1,
      mobile: false
    });

    const drafting = await renderProbe(client, {
      ...readyTarget,
      state: "thinking",
      overlayAction: "generate",
      promptReady: true,
      promptKind: "draft",
      promptMode: "polish"
    });
    assert.deepEqual([drafting.state, drafting.message, drafting.primary], ["drafting", "正在整理你的需求", "取消"]);
    assert.equal(drafting.primaryAction, "cancel");

    const targetMissing = await renderProbe(client, {
      ...readyTarget,
      profile: "codex",
      state: "suggesting",
      candidateIndex: -1,
      candidateCount: 2,
      safeCandidateCount: 0,
      readinessReason: "no-safe-candidate",
      overlayReadinessReason: "no-safe-candidate",
      overlayReady: false,
      visualOnly: true,
      promptReady: true,
      promptKind: "generated",
      promptText: "Synthetic target-missing prompt."
    });
    assert.deepEqual(
      [targetMissing.state, targetMissing.reason, targetMissing.message, targetMissing.primary],
      ["target_missing", "target-not-focused", "请先点击目标输入框", "重新检测"]
    );
    assert.equal(targetMissing.primaryAction, "retry-target");
    runtimeEvidence.targetMissing = {
      state: targetMissing.state,
      reason: targetMissing.reason,
      primaryAction: targetMissing.primaryAction,
      secondaryCount: targetMissing.secondaryCount,
      noAutoSubmit: targetMissing.noAutoSubmit
    };
    await capture(client, "desktop-target-missing.png");

    const copyOnly = await renderProbe(client, {
      ...readyTarget,
      state: "suggesting",
      overlayReadinessReason: "unsupported-overlay-profile",
      overlayReady: false,
      promptReady: true,
      promptKind: "generated",
      promptText: "Synthetic copy-only prompt."
    });
    assert.deepEqual(
      [copyOnly.state, copyOnly.reason, copyOnly.message, copyOnly.primary, copyOnly.primaryAction],
      ["copy_only", "target-unsupported", "当前工具暂不支持自动填入", "复制提示词", "copy"]
    );

    const inserted = await renderProbe(client, {
      ...readyTarget,
      state: "success",
      promptReady: true,
      promptKind: "generated",
      promptText: "Synthetic inserted prompt.",
      fillVerified: true,
      verification: "machine",
      canUndo: true,
      collapseRequested: true
    });
    assert.deepEqual(
      [inserted.state, inserted.verification, inserted.message, inserted.primary, inserted.primaryAction],
      ["inserted", "machine", "已填入，未发送", "完成", "complete"]
    );

    const manual = await renderProbe(client, {
      ...readyTarget,
      profile: "workbuddy",
      state: "success",
      promptReady: true,
      promptKind: "generated",
      promptText: "Synthetic manual confirmation prompt."
    });
    assert.equal(manual.state, "copy_only");
    assert.equal(manual.verification, "none");
    assert.equal(manual.primaryAction, "copy");
    assert.equal(manual.hint.includes("确认后继续"), false);

    const blocked = await renderProbe(client, {
      ...readyTarget,
      state: "resting",
      guardReason: "payload_guard",
      promptReady: true,
      promptKind: "generated",
      promptText: "Synthetic blocked prompt."
    });
    assert.deepEqual(
      [blocked.state, blocked.reason, blocked.message, blocked.primary],
      ["blocked", "target-unsafe", "为避免填错，已暂停", "重新检测"]
    );
    assert.equal(blocked.noAutoSubmit, "true");

    const safetyBlocked = await renderProbe(client, {
      ...readyTarget,
      state: "suggesting",
      noAutoSubmit: false,
      promptReady: true,
      promptKind: "generated"
    });
    assert.equal(safetyBlocked.state, "blocked");
    assert.equal(safetyBlocked.reason, "safety-contract-violated");

    runtimeEvidence.canonicalStates = [
      idle.state,
      drafting.state,
      review.state,
      targetMissing.state,
      copyOnly.state,
      inserted.state,
      blocked.state,
      safetyBlocked.state
    ];
    runtimeEvidence.contractVersion = review.contractVersion;
    runtimeEvidence.screenshots = [
      "outputs/assistant-card-phase2/desktop-review.png",
      "outputs/assistant-card-phase2/desktop-target-missing.png",
      "outputs/assistant-card-phase2/desktop-compact.png"
    ];

    console.log(`SMART_PROMPT_VISUAL_EVIDENCE ${JSON.stringify(runtimeEvidence)}`);
    console.log(`prompt-session overlay runtime tests passed; profile retained at ${profileDir}`);
  } catch (error) {
    if (chromeDiagnostics.trim()) {
      console.error(`Chrome diagnostics:\n${chromeDiagnostics.trim()}`);
    }
    throw error;
  } finally {
    if (client) client.close();
    if (!chrome.killed) chrome.kill();
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  clearInterval(testRunGuard);
});
