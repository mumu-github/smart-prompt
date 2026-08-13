#!/usr/bin/env node
"use strict";

if (process.env.SMART_PROMPT_USE_LEGACY_P25_VISUAL !== "1") {
  require("./check-assistant-card-visual.js");
} else {

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "research", "p25-overlay-chat-visual.latest.json");
const overlayPath = path.join(root, "apps", "desktop-shell", "overlay.html");
const compactViewport = { width: 72, height: 72 };
const expandedViewport = { width: 320, height: 360 };
const whiteBlockRegressionViewport = { width: 384, height: 380 };

function repoRelative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function hashText(value) {
  const text = String(value || "");
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method || "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
    request.end();
  });
}

async function waitForDevTools(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError || new Error("Chrome DevTools did not become ready.");
}

function connectCdp(wsUrl) {
  if (typeof WebSocket !== "function") {
    throw new Error("This Node.js runtime does not expose WebSocket; use Node 22+.");
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const eventWaiters = new Map();

    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((sendResolve, sendReject) => {
            pending.set(id, { resolve: sendResolve, reject: sendReject });
          });
        },
        waitForEvent(method, timeoutMs = 5000) {
          return new Promise((eventResolve, eventReject) => {
            const timer = setTimeout(() => {
              eventReject(new Error(`Timed out waiting for ${method}`));
            }, timeoutMs);
            const waiters = eventWaiters.get(method) || [];
            waiters.push((payload) => {
              clearTimeout(timer);
              eventResolve(payload);
            });
            eventWaiters.set(method, waiters);
          });
        },
        close() {
          socket.close();
        }
      });
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result || {});
        return;
      }
      if (message.method && eventWaiters.has(message.method)) {
        const waiters = eventWaiters.get(message.method);
        eventWaiters.delete(message.method);
        for (const waiter of waiters) waiter(message.params || {});
      }
    });

    socket.addEventListener("error", (event) => {
      reject(new Error(event.message || "CDP WebSocket failed."));
    });
  });
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function getPngTransparencyStats(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Screenshot is not a PNG.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    const total = width * height;
    return { width, height, transparent: 0, translucent: 0, opaque: total, transparentRatio: 0, nonOpaqueRatio: 0, opaqueRatio: total ? 1 : 0, alphaChannel: false };
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let sourceOffset = 0;
  let transparent = 0;
  let translucent = 0;
  let opaque = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 0) current[x] = raw;
      else if (filter === 1) current[x] = (raw + left) & 0xff;
      else if (filter === 2) current[x] = (raw + above) & 0xff;
      else if (filter === 3) current[x] = (raw + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) current[x] = (raw + paethPredictor(left, above, upperLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}.`);
    }
    sourceOffset += stride;
    for (let x = 0; x < width; x += 1) {
      const alpha = colorType === 6 ? current[x * bytesPerPixel + 3] : 255;
      if (alpha === 0) transparent += 1;
      else if (alpha < 255) translucent += 1;
      else opaque += 1;
    }
    current.copy(previous);
  }
  const total = width * height;
  return {
    width,
    height,
    transparent,
    translucent,
    opaque,
    transparentRatio: total ? Number((transparent / total).toFixed(4)) : 0,
    nonOpaqueRatio: total ? Number(((transparent + translucent) / total).toFixed(4)) : 0,
    opaqueRatio: total ? Number((opaque / total).toFixed(4)) : 0,
    alphaChannel: colorType === 6
  };
}

function getCompactProbeExpression(renderPayload = null) {
  const renderStatement = renderPayload ? `window.render(${JSON.stringify(renderPayload)});` : "";
  return `JSON.stringify((() => {
    ${renderStatement}
    const htmlStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const card = document.getElementById("mascot-overlay-card");
    const button = document.getElementById("mascot-overlay-button");
    const image = document.getElementById("mascot-overlay-image");
    const badge = document.getElementById("mascot-overlay-badge");
    const moodStrip = document.getElementById("mascot-overlay-mood-strip");
    const chat = document.getElementById("mascot-overlay-chat");
    const cardStyle = getComputedStyle(card);
    const buttonStyle = getComputedStyle(button);
    const badgeStyle = getComputedStyle(badge);
    const moodStripStyle = getComputedStyle(moodStrip);
    const rectFor = (element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    return {
      overlayMode: document.documentElement.dataset.overlayMode || "",
      state: document.documentElement.dataset.state || "",
      htmlBackground: htmlStyle.backgroundColor,
      bodyBackground: bodyStyle.backgroundColor,
      cardBackground: cardStyle.backgroundColor,
      buttonBackground: buttonStyle.backgroundColor,
      cardBoxShadow: cardStyle.boxShadow,
      body: rectFor(document.body),
      card: rectFor(card),
      button: rectFor(button),
      image: rectFor(image),
      badge: {
        ...rectFor(badge),
        fontSize: badgeStyle.fontSize,
        text: badge.textContent || ""
      },
      moodStrip: {
        ...rectFor(moodStrip),
        display: moodStripStyle.display
      },
      chat: rectFor(chat)
    };
  })())`;
}

function buildCompactProbe(screenshotPath, viewport, metrics, screenshotTransparency) {
  return {
    screenshot: repoRelative(screenshotPath),
    viewport,
    overlayMode: metrics.overlayMode,
    state: metrics.state,
    body: metrics.body,
    card: metrics.card,
    button: metrics.button,
    image: metrics.image,
    badge: metrics.badge,
    moodStrip: metrics.moodStrip,
    chat: metrics.chat,
    backdrop: {
      htmlBackground: metrics.htmlBackground,
      bodyBackground: metrics.bodyBackground,
      cardBackground: metrics.cardBackground,
      buttonBackground: metrics.buttonBackground,
      cardBoxShadow: metrics.cardBoxShadow
    },
    screenshotTransparency,
    defaultCompact: metrics.overlayMode === "compact",
    compactBody: metrics.body.width === compactViewport.width
      && metrics.body.height === compactViewport.height,
    compactCard: metrics.card.width === compactViewport.width
      && metrics.card.height === compactViewport.height,
    compactButton: metrics.button.width === compactViewport.width
      && metrics.button.height === compactViewport.height,
    compactImage: metrics.image.width >= 72
      && metrics.image.width <= 82
      && metrics.image.height >= 72
      && metrics.image.height <= 82,
    compactMoodStripHidden: metrics.moodStrip.width === 0
      || metrics.moodStrip.height === 0
      || metrics.moodStrip.display === "none",
    compactBadgeDot: metrics.badge.width <= 12
      && metrics.badge.height <= 12
      && metrics.badge.fontSize === "0px",
    compactChatHidden: metrics.chat.width === 0
      && metrics.chat.height === 0,
    compactBackdropTransparent: metrics.htmlBackground === "rgba(0, 0, 0, 0)"
      && metrics.bodyBackground === "rgba(0, 0, 0, 0)"
      && metrics.cardBackground === "rgba(0, 0, 0, 0)"
      && metrics.buttonBackground === "rgba(0, 0, 0, 0)"
      && metrics.cardBoxShadow === "none",
    largeWhiteBlockAbsent: screenshotTransparency.alphaChannel === true
      && screenshotTransparency.opaqueRatio <= 0.08
  };
}

function compactProbePass(probe) {
  return probe.defaultCompact === true
    && probe.compactBody === true
    && probe.compactCard === true
    && probe.compactButton === true
    && probe.compactImage === true
    && probe.compactBadgeDot === true
    && probe.compactMoodStripHidden === true
    && probe.compactChatHidden === true
    && probe.compactBackdropTransparent === true
    && probe.largeWhiteBlockAbsent === true;
}

async function runVisualCheck() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error("Chrome or Edge executable not found. Set CHROME_PATH to run the visual check.");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-overlay-cdp-"));
  const port = await getFreePort();
  const browser = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: "ignore" });

  try {
    await waitForDevTools(port);
    const target = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const client = await connectCdp(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 }
    });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: expandedViewport.width,
      height: expandedViewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    const load = client.waitForEvent("Page.loadEventFired", 5000);
    await client.send("Page.navigate", { url: `file:///${overlayPath.replace(/\\/g, "/")}` });
    await load;
    const initialCompactEvaluated = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: getCompactProbeExpression()
    });
    if (!initialCompactEvaluated.result || typeof initialCompactEvaluated.result.value !== "string") {
      throw new Error(`Initial compact probe failed: ${JSON.stringify(initialCompactEvaluated.exceptionDetails || initialCompactEvaluated)}`);
    }
    const initialCompactMetrics = JSON.parse(initialCompactEvaluated.result.value);
    const initialScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const initialScreenshotPath = path.join(root, "research", "p25-overlay-chat-initial-compact.png");
    const initialScreenshotBuffer = Buffer.from(initialScreenshot.data, "base64");
    fs.writeFileSync(initialScreenshotPath, initialScreenshotBuffer);
    const initialScreenshotTransparency = getPngTransparencyStats(initialScreenshotBuffer);
    const initialCompactProbe = buildCompactProbe(
      initialScreenshotPath,
      expandedViewport,
      initialCompactMetrics,
      initialScreenshotTransparency
    );
    const defaultLocaleProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        const draft = document.getElementById("mascot-overlay-draft-input");
        const preview = document.getElementById("mascot-overlay-preview-input");
        const zh = document.getElementById("mascot-overlay-locale-zh");
        const en = document.getElementById("mascot-overlay-locale-en");
        return {
          lang: document.documentElement.lang,
          locale: document.documentElement.dataset.locale,
          inputLocale: document.documentElement.dataset.inputLocale,
          draftPlaceholder: draft.placeholder,
          draftLang: draft.lang,
          draftDir: draft.dir,
          previewPlaceholder: preview.placeholder,
          previewLang: preview.lang,
          previewDir: preview.dir,
          zhLabel: zh.textContent,
          enLabel: en.textContent,
          zhPressed: zh.getAttribute("aria-pressed"),
          enPressed: en.getAttribute("aria-pressed")
        };
      })())`
    });
    const defaultLocaleProbe = JSON.parse(defaultLocaleProbeResult.result.value);
    const zhVisibleProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        window.render({
          profile: "codex",
          state: "suggesting",
          candidateIndex: 185,
          candidateCount: 207,
          safeCandidateCount: 0,
          readinessReason: "no-safe-candidate",
          overlayReadinessReason: "no-safe-candidate",
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "draft",
          promptMode: "idea",
          overlayMode: "expanded",
          locale: "zh-CN",
          promptText: "保持中文显示，不暴露内部状态 token。"
        });
        const meta = document.getElementById("mascot-overlay-meta").textContent;
        const stateChip = document.getElementById("mascot-overlay-tool-chip").textContent;
        const actionChip = document.getElementById("mascot-overlay-prompt-chip").textContent;
        const policyChip = document.getElementById("mascot-overlay-submit-chip").textContent;
        const visibleStatus = [meta, stateChip, actionChip, policyChip].join(" ");
        return {
          meta,
          stateChip,
          actionChip,
          policyChip,
          evidenceStateToken: document.documentElement.dataset.evidenceState,
          evidenceActionToken: document.documentElement.dataset.evidenceAction,
          evidencePolicyToken: document.documentElement.dataset.evidencePolicy,
          visibleStatus,
          locale: document.documentElement.dataset.locale,
          inputLocale: document.documentElement.dataset.inputLocale
        };
      })())`
    });
    const zhVisibleProbe = JSON.parse(zhVisibleProbeResult.result.value);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: expandedViewport.width,
      height: expandedViewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    const zhWaitingProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        window.render({
          profile: "codex",
          state: "suggesting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: false,
          promptKind: "none",
          promptMode: "idea",
          overlayMode: "expanded",
          locale: "zh-CN"
        });
        const rectFor = (id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        };
        const evidence = document.querySelector(".mascot-overlay-thread");
        const evidenceRect = evidence ? evidence.getBoundingClientRect() : { width: 0, height: 0 };
        return {
          locale: document.documentElement.dataset.locale,
          inputLocale: document.documentElement.dataset.inputLocale,
          message: document.getElementById("mascot-overlay-message").textContent,
          hint: document.getElementById("mascot-overlay-hint").textContent,
          primary: document.getElementById("mascot-overlay-primary").textContent,
          placeholder: document.getElementById("mascot-overlay-draft-input").placeholder,
          modeLabels: [
            document.getElementById("mascot-overlay-mode-idea").textContent,
            document.getElementById("mascot-overlay-mode-continue").textContent,
            document.getElementById("mascot-overlay-mode-polish").textContent
          ],
          localeLabels: [
            document.getElementById("mascot-overlay-locale-zh").textContent,
            document.getElementById("mascot-overlay-locale-en").textContent
          ],
          replyRects: [
            rectFor("mascot-overlay-reply-short"),
            rectFor("mascot-overlay-reply-clear"),
            rectFor("mascot-overlay-reply-steps")
          ],
          evidenceVisible: evidenceRect.width > 0 || evidenceRect.height > 0
        };
      })())`
    });
    if (!zhWaitingProbeResult.result || typeof zhWaitingProbeResult.result.value !== "string") {
      throw new Error(`Chinese waiting probe failed: ${JSON.stringify(zhWaitingProbeResult.exceptionDetails || zhWaitingProbeResult)}`);
    }
    const zhWaitingProbe = JSON.parse(zhWaitingProbeResult.result.value);
    const zhWaitingScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const zhWaitingScreenshotPath = path.join(root, "research", "p25-overlay-chat-waiting-zh.png");
    fs.writeFileSync(zhWaitingScreenshotPath, Buffer.from(zhWaitingScreenshot.data, "base64"));
    zhWaitingProbe.screenshot = repoRelative(zhWaitingScreenshotPath);
    zhWaitingProbe.quickRepliesHidden = zhWaitingProbe.replyRects.every((rect) => rect.width === 0 && rect.height === 0);

    const compactThinkingPayload = {
      profile: "codex",
      state: "thinking",
      candidateIndex: 12,
      noAutoSubmit: true,
      promptReady: true,
      promptKind: "draft",
      promptMode: "polish",
      overlayMode: "compact"
    };
    const compactThinkingEvaluated = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: getCompactProbeExpression(compactThinkingPayload)
    });
    if (!compactThinkingEvaluated.result || typeof compactThinkingEvaluated.result.value !== "string") {
      throw new Error(`Compact thinking probe failed: ${JSON.stringify(compactThinkingEvaluated.exceptionDetails || compactThinkingEvaluated)}`);
    }
    const compactThinkingMetrics = JSON.parse(compactThinkingEvaluated.result.value);
    const compactThinkingScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const compactThinkingScreenshotPath = path.join(root, "research", "p25-overlay-chat-compact-thinking.png");
    const compactThinkingScreenshotBuffer = Buffer.from(compactThinkingScreenshot.data, "base64");
    fs.writeFileSync(compactThinkingScreenshotPath, compactThinkingScreenshotBuffer);
    const compactThinkingScreenshotTransparency = getPngTransparencyStats(compactThinkingScreenshotBuffer);
    const compactThinkingProbe = buildCompactProbe(
      compactThinkingScreenshotPath,
      expandedViewport,
      compactThinkingMetrics,
      compactThinkingScreenshotTransparency
    );

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: whiteBlockRegressionViewport.width,
      height: whiteBlockRegressionViewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    const whiteBlockRegressionEvaluated = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: getCompactProbeExpression(compactThinkingPayload)
    });
    if (!whiteBlockRegressionEvaluated.result || typeof whiteBlockRegressionEvaluated.result.value !== "string") {
      throw new Error(`White-block regression probe failed: ${JSON.stringify(whiteBlockRegressionEvaluated.exceptionDetails || whiteBlockRegressionEvaluated)}`);
    }
    const whiteBlockRegressionMetrics = JSON.parse(whiteBlockRegressionEvaluated.result.value);
    const whiteBlockRegressionScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    const whiteBlockRegressionScreenshotPath = path.join(root, "research", "p25-overlay-chat-white-block-regression.png");
    const whiteBlockRegressionScreenshotBuffer = Buffer.from(whiteBlockRegressionScreenshot.data, "base64");
    fs.writeFileSync(whiteBlockRegressionScreenshotPath, whiteBlockRegressionScreenshotBuffer);
    const whiteBlockRegressionScreenshotTransparency = getPngTransparencyStats(whiteBlockRegressionScreenshotBuffer);
    const whiteBlockRegressionProbe = buildCompactProbe(
      whiteBlockRegressionScreenshotPath,
      whiteBlockRegressionViewport,
      whiteBlockRegressionMetrics,
      whiteBlockRegressionScreenshotTransparency
    );
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: expandedViewport.width,
      height: expandedViewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });

    const states = [
      {
        name: "compact-ready",
        viewport: compactViewport,
        payload: {
          profile: "codex",
          state: "suggesting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "idea",
          overlayMode: "compact",
          promptText: "Refine this message to be concise and action-oriented."
        },
        expectedMessage: "Click to fill",
        expectedHint: "Ready: Fill or edit",
        expectedUserTurn: "You: prompt ready",
        expectedAssistantTurn: "Smart: fill safe",
        expectedPrimary: "Fill",
        expectedEvidenceState: "safe",
        expectedEvidenceAction: "fill",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Draft", "Retry", "Scan"],
        expectedReplies: ["Brief", "Angle", "Steps"],
        expectedMode: "compact",
        expectedPromptMode: "idea",
        expectedMascotMood: "ready"
      },
      {
        name: "waiting",
        viewport: expandedViewport,
      payload: { profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" },
        expectedMessage: "Add prompt",
        expectedHint: "Draft then Make",
        expectedUserTurn: "You: ask here",
        expectedAssistantTurn: "Smart: draft first",
        expectedPrimary: "Draft",
        expectedEvidenceState: "waiting",
        expectedEvidenceAction: "draft",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Draft", "Make", "Scan"],
        expectedReplies: ["Brief", "Angle", "Steps"],
        expectedRepliesVisible: false,
        expectedMode: "expanded",
        expectedPromptMode: "idea",
        expectedMascotMood: "idle"
      },
      {
        name: "draft-ready",
        viewport: expandedViewport,
        payload: {
          profile: "codex",
          state: "suggesting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "draft",
          promptMode: "idea",
          overlayMode: "expanded",
          promptText: "Draft: summarize current blockers and suggest the top three next steps."
        },
        expectedMessage: "Ready to make",
        expectedHint: "Make then Fill",
        expectedUserTurn: "You: draft ready",
        expectedAssistantTurn: "Smart: make next",
        expectedPrimary: "Make",
        expectedEvidenceState: "draft-ready",
        expectedEvidenceAction: "make",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Draft", "Make", "Scan"],
        expectedReplies: ["Brief", "Angle", "Steps"],
        expectedMode: "expanded",
        expectedPromptMode: "idea",
        expectedMascotMood: "ready"
      },
      {
        name: "ready",
        viewport: expandedViewport,
        payload: {
          profile: "codex",
          state: "suggesting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "continue",
          overlayMode: "expanded",
          promptText: "Draft a clear escalation plan with owners, timelines, and risks."
        },
        expectedMessage: "Click to fill",
        expectedHint: "Ready: Fill or edit",
        expectedUserTurn: "You: prompt ready",
        expectedAssistantTurn: "Smart: fill safe",
        expectedPrimary: "Fill",
        expectedEvidenceState: "safe",
        expectedEvidenceAction: "fill",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Draft", "Retry", "Scan"],
        expectedReplies: ["Next", "Match", "Close"],
        expectedMode: "expanded",
        expectedPromptMode: "continue",
        expectedMascotMood: "ready"
      },
      {
        name: "visual-only-ready",
        viewport: expandedViewport,
        payload: {
          profile: "codex",
          state: "suggesting",
          candidateIndex: -1,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "continue",
          overlayMode: "expanded",
          visualOnly: true,
          promptText: "Review target input and then craft a targeted follow-up prompt."
        },
        expectedMessage: "Check target",
        expectedHint: "Focus input, then Scan",
        expectedUserTurn: "You: prompt ready",
        expectedAssistantTurn: "Smart: need target",
        expectedPrimary: "Scan",
        expectedEvidenceState: "visual-only",
        expectedEvidenceAction: "scan",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Draft", "Retry", "Scan"],
        expectedReplies: ["Next", "Match", "Close"],
        expectedMode: "expanded",
        expectedPromptMode: "continue",
        expectedMascotMood: "scan"
      },
      {
        name: "visual-only-no-safe-candidate",
        viewport: expandedViewport,
        payload: {
          profile: "codex",
          state: "suggesting",
          candidateIndex: -1,
          candidateCount: 207,
          safeCandidateCount: 0,
          browserLikeComposerCandidateCount: 1,
          visualAnchorIndex: 146,
          visualAnchorReason: "bottom-container",
          readinessReason: "no-safe-candidate",
          overlayReadinessReason: "no-safe-candidate",
          overlayReady: false,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "continue",
          overlayMode: "expanded",
          visualOnly: true,
          promptText: "Review target input and then craft a targeted follow-up prompt."
        },
        expectedMessage: "Check target",
        expectedHint: "Focus input, then Scan",
        expectedUserTurn: "You: prompt ready",
        expectedAssistantTurn: "Smart: need target",
        expectedPrimary: "Scan",
        expectedEvidenceState: "visual-only",
        expectedEvidenceAction: "scan",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Draft", "Retry", "Scan"],
        expectedReplies: ["Next", "Match", "Close"],
        expectedMode: "expanded",
        expectedPromptMode: "continue",
        expectedMascotMood: "scan",
        expectedReadinessReason: "no-safe-candidate",
        expectedOverlayReadinessReason: "no-safe-candidate",
        expectedBrowserLikeComposerCandidateCount: "1",
        expectedVisualAnchorIndex: "146",
        expectedVisualAnchorReason: "bottom-container",
        expectedMetaIncludes: ["guard:0/207", "no-submit"]
      },
      {
        name: "thinking",
        viewport: expandedViewport,
        payload: {
          profile: "workbuddy",
          state: "thinking",
          candidateIndex: 3,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "draft",
          promptMode: "polish",
          overlayMode: "expanded",
          overlayAction: "refresh",
          promptText: "Draft a quick polish-ready reply for the selected context."
        },
        expectedMessage: "Checking",
        expectedHint: "Checking target",
        expectedUserTurn: "You: Scan",
        expectedAssistantTurn: "Smart: scanning target",
        expectedPrimary: "Checking",
        expectedEvidenceState: "draft-ready",
        expectedEvidenceAction: "checking",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Draft", "Make", "Scan"],
        expectedReplies: ["Short", "Tone", "Clear"],
        expectedMode: "expanded",
        expectedPromptMode: "polish",
        expectedMascotMood: "thinking"
      },
      {
        name: "success",
        viewport: expandedViewport,
        payload: {
          profile: "trae",
          state: "success",
          candidateIndex: 8,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "continue",
          overlayMode: "expanded",
          promptText: "Completed: highlight action items and proposed owners clearly."
        },
        expectedMessage: "Filled safely",
        expectedHint: "No auto-submit",
        expectedUserTurn: "You: filled",
        expectedAssistantTurn: "Smart: no submit",
        expectedPrimary: "Done",
        expectedEvidenceState: "filled",
        expectedEvidenceAction: "done",
        expectedEvidencePolicy: "no-submit",
        expectedActions: ["Good", "Fix", "Scan"],
        expectedReplies: ["Short", "Tone", "Missing"],
        expectedMode: "expanded",
        expectedPromptMode: "continue",
        expectedMascotMood: "success"
      },
      {
        name: "guarded",
        viewport: expandedViewport,
        payload: {
          profile: "codex",
          state: "resting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "polish",
          guardReason: "payload_guard",
          overlayMode: "expanded",
          promptText: "This prompt should be blocked and require user review."
        },
        expectedMessage: "Guarded",
        expectedHint: "No write. Check target",
        expectedUserTurn: "You: paused",
        expectedAssistantTurn: "Smart: check target",
        expectedPrimary: "Review",
        expectedEvidenceState: "guarded",
        expectedEvidenceAction: "review",
        expectedEvidencePolicy: "blocked",
        expectedActions: ["Draft", "Make", "Scan"],
        expectedReplies: ["Target", "Draft", "Safer"],
        expectedMode: "expanded",
        expectedPromptMode: "polish",
        expectedMascotMood: "guard"
      }
  ];

    const checks = [];
    for (const item of states) {
      const renderPayload = { locale: "en", ...item.payload };
      const itemViewport = item.viewport || expandedViewport;
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: itemViewport.width,
        height: itemViewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await client.send("Emulation.setDefaultBackgroundColorOverride", {
        color: { r: 0, g: 0, b: 0, a: 0 }
      });
      await client.send("Runtime.evaluate", {
        expression: `window.render(${JSON.stringify(renderPayload)})`,
        awaitPromise: true
      });
      const evaluated = await client.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `JSON.stringify((() => {
          const ids = [
            "mascot-overlay-card",
            "mascot-overlay-button",
            "mascot-overlay-image",
            "mascot-overlay-mood-strip",
            "mascot-overlay-chat",
            "mascot-overlay-message",
            "mascot-overlay-meta",
            "mascot-overlay-hint",
            "mascot-overlay-badge",
            "mascot-overlay-user-turn",
            "mascot-overlay-assistant-turn",
            "mascot-overlay-thread",
            "mascot-overlay-tool-chip",
            "mascot-overlay-prompt-chip",
            "mascot-overlay-submit-chip",
            "mascot-overlay-draft",
            "mascot-overlay-draft-form",
            "mascot-overlay-draft-input",
            "mascot-overlay-draft-send",
            "mascot-overlay-locale-zh",
            "mascot-overlay-locale-en",
            "mascot-overlay-preview-panel",
            "mascot-overlay-preview-input",
            "mascot-overlay-preview-copy",
            "mascot-overlay-preview-review",
            "mascot-overlay-preview-undo",
            "mascot-overlay-preview-clear",
            "mascot-overlay-generate",
            "mascot-overlay-refresh",
            "mascot-overlay-reply-short",
            "mascot-overlay-reply-clear",
            "mascot-overlay-reply-steps",
            "mascot-overlay-mode-idea",
            "mascot-overlay-mode-continue",
            "mascot-overlay-mode-polish",
            "mascot-overlay-primary"
          ];
          const getElementByIdOrClass = (id) => {
            if (id === "mascot-overlay-thread") return document.querySelector(".mascot-overlay-thread");
            return document.getElementById(id);
          };
          const rects = Object.fromEntries(ids.map((id) => {
            const element = getElementByIdOrClass(id);
            if (!element) {
              return [id, {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                width: 0,
                height: 0,
                text: "",
                scrollWidth: 0,
                clientWidth: 0,
                scrollHeight: 0,
                clientHeight: 0,
                maxLength: 0,
                valueLength: 0,
                tagName: "",
                disabled: false,
                fontSize: "0px"
              }];
            }
            const rect = element.getBoundingClientRect();
            return [id, {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
              text: element.textContent,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              maxLength: element.maxLength || 0,
              valueLength: element.value ? element.value.length : 0,
              tagName: element.tagName,
              disabled: Boolean(element.disabled),
              fontSize: getComputedStyle(element).fontSize
            }];
          }));
          const allowCompactMascotCrop = ${JSON.stringify(item.expectedMode === "compact")};
          const overflows = Object.entries(rects)
            .filter(([id]) => !(allowCompactMascotCrop && id === "mascot-overlay-image"))
            .filter(([, rect]) => rect.left < -0.5 || rect.top < -0.5 || rect.right > ${itemViewport.width + 0.5} || rect.bottom > ${itemViewport.height + 0.5})
            .map(([id]) => id);
          const textClipIds = new Set(ids.filter((id) => ![
            "mascot-overlay-card",
            "mascot-overlay-button",
            "mascot-overlay-chat",
            "mascot-overlay-draft-form",
            "mascot-overlay-preview-input",
            "mascot-overlay-preview-panel",
            "mascot-overlay-preview-panel"
          ].includes(id)));
          const clippedText = Object.entries(rects)
            .filter(([id]) => textClipIds.has(id))
            .filter(([, rect]) => rect.scrollWidth > rect.clientWidth + 1 || rect.scrollHeight > rect.clientHeight + 1)
            .map(([id]) => id);
          const htmlStyle = getComputedStyle(document.documentElement);
          const bodyStyle = getComputedStyle(document.body);
          const cardStyle = getComputedStyle(document.getElementById("mascot-overlay-card"));
          const buttonStyle = getComputedStyle(document.getElementById("mascot-overlay-button"));
          const bodyRect = document.body.getBoundingClientRect();
          return {
            rects,
            overflows,
            clippedText,
            dataset: { ...document.documentElement.dataset },
            backdrop: {
              htmlBackground: htmlStyle.backgroundColor,
              bodyBackground: bodyStyle.backgroundColor,
              cardBackground: cardStyle.backgroundColor,
              buttonBackground: buttonStyle.backgroundColor,
              cardBoxShadow: cardStyle.boxShadow,
              bodyWidth: bodyRect.width,
              bodyHeight: bodyRect.height
            }
          };
        })())`
      });
      if (!evaluated.result || typeof evaluated.result.value !== "string") {
        throw new Error(`Overlay metrics evaluation failed: ${JSON.stringify(evaluated.exceptionDetails || evaluated)}`);
      }
      const metrics = JSON.parse(evaluated.result.value);
      const expectedPromptText = String(item.payload.promptText || "");
      const expectedPromptTextLength = expectedPromptText.length;
      const expectedPromptTextHash = hashText(expectedPromptText);
      const expectedReviewText = item.payload.promptKind === "draft" ? "Edit" : "Review";
      const shouldShowPreviewPanel = item.expectedMode === "expanded" && item.payload.promptReady === true && item.payload.promptKind !== "none";
      const screenshot = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      });
      const screenshotPath = path.join(root, "research", `p25-overlay-chat-${item.name}.png`);
      const screenshotBuffer = Buffer.from(screenshot.data, "base64");
      fs.writeFileSync(screenshotPath, screenshotBuffer);
      const screenshotTransparency = getPngTransparencyStats(screenshotBuffer);
      const compactScreenshotTransparent = item.expectedMode !== "compact"
        || (screenshotTransparency.alphaChannel
          && screenshotTransparency.nonOpaqueRatio >= 0.2
          && screenshotTransparency.opaqueRatio <= 0.8);
      checks.push({
        name: item.name,
        screenshot: repoRelative(screenshotPath),
        message: metrics.rects["mascot-overlay-message"].text,
        meta: metrics.rects["mascot-overlay-meta"].text,
        hint: metrics.rects["mascot-overlay-hint"].text,
        readinessReason: metrics.dataset.readinessReason || "",
        overlayReadinessReason: metrics.dataset.overlayReadinessReason || "",
        browserLikeComposerCandidateCount: metrics.dataset.browserLikeComposerCandidateCount || "",
        visualAnchorIndex: metrics.dataset.visualAnchorIndex || "",
        visualAnchorReason: metrics.dataset.visualAnchorReason || "",
        userTurn: metrics.rects["mascot-overlay-user-turn"].text,
        assistantTurn: metrics.rects["mascot-overlay-assistant-turn"].text,
        primary: metrics.rects["mascot-overlay-primary"].text,
        draftAction: metrics.rects["mascot-overlay-draft"].text,
        quickDraftMaxLength: metrics.rects["mascot-overlay-draft-input"].maxLength,
        quickDraftValueLength: metrics.rects["mascot-overlay-draft-input"].valueLength,
        quickDraftControl: metrics.rects["mascot-overlay-draft-input"].tagName,
        quickDraftSend: metrics.rects["mascot-overlay-draft-send"].text,
        generateAction: metrics.rects["mascot-overlay-generate"].text,
        refreshAction: metrics.rects["mascot-overlay-refresh"].text,
        replyActions: [
          metrics.rects["mascot-overlay-reply-short"].text,
          metrics.rects["mascot-overlay-reply-clear"].text,
          metrics.rects["mascot-overlay-reply-steps"].text
        ],
        previewPanel: {
          width: metrics.rects["mascot-overlay-preview-panel"].width,
          height: metrics.rects["mascot-overlay-preview-panel"].height,
          shouldShow: shouldShowPreviewPanel
        },
        previewInputValueLength: metrics.rects["mascot-overlay-preview-input"].valueLength,
        previewInputMaxLength: metrics.rects["mascot-overlay-preview-input"].maxLength,
        previewActions: [
          metrics.rects["mascot-overlay-preview-copy"].text,
          metrics.rects["mascot-overlay-preview-review"].text,
          metrics.rects["mascot-overlay-preview-undo"].text,
          metrics.rects["mascot-overlay-preview-clear"].text
        ],
        previewTextLength: Number(metrics.dataset.previewTextLength || 0),
        previewTextHash: metrics.dataset.previewTextHash || "00000000",
        promptTextLength: Number(metrics.dataset.promptTextLength || 0),
        promptTextHash: metrics.dataset.promptTextHash || "00000000",
        expectedPromptTextLength,
        expectedPromptTextHash,
        shouldShowPreviewPanel,
        modeActions: [
          metrics.rects["mascot-overlay-mode-idea"].text,
          metrics.rects["mascot-overlay-mode-continue"].text,
          metrics.rects["mascot-overlay-mode-polish"].text
        ],
        evidenceState: metrics.rects["mascot-overlay-tool-chip"].text,
        evidenceAction: metrics.rects["mascot-overlay-prompt-chip"].text,
        evidencePolicy: metrics.rects["mascot-overlay-submit-chip"].text,
        evidenceRow: {
          width: metrics.rects["mascot-overlay-thread"].width,
          height: metrics.rects["mascot-overlay-thread"].height,
          top: metrics.rects["mascot-overlay-thread"].top,
          left: metrics.rects["mascot-overlay-thread"].left,
          right: metrics.rects["mascot-overlay-thread"].right,
          bottom: metrics.rects["mascot-overlay-thread"].bottom
        },
        evidenceStateMatchExpected: metrics.dataset.evidenceState === item.expectedEvidenceState,
        evidenceActionMatchExpected: metrics.dataset.evidenceAction === item.expectedEvidenceAction,
        evidencePolicyMatchExpected: metrics.dataset.evidencePolicy === item.expectedEvidencePolicy,
        evidenceRowVisible: metrics.rects["mascot-overlay-thread"].width > 0
          && metrics.rects["mascot-overlay-thread"].height > 0,
        moodStrip: {
          width: metrics.rects["mascot-overlay-mood-strip"].width,
          height: metrics.rects["mascot-overlay-mood-strip"].height,
          text: metrics.rects["mascot-overlay-mood-strip"].text
        },
        evidenceStateSanitized: /^[a-z0-9-]+$/.test(metrics.dataset.evidenceState || ""),
        evidenceActionSanitized: /^[a-z0-9-]+$/.test(metrics.dataset.evidenceAction || ""),
        evidencePolicySanitized: /^[a-z0-9-]+$/.test(metrics.dataset.evidencePolicy || ""),
        mascotMood: metrics.dataset.mascotMood,
        overlayMode: metrics.dataset.overlayMode,
        promptMode: metrics.dataset.promptMode,
        expectedMascotMood: item.expectedMascotMood,
        backdrop: metrics.backdrop,
        screenshotTransparency,
        viewport: itemViewport,
        overflows: metrics.overflows,
        clippedText: metrics.clippedText,
        messageMatches: metrics.rects["mascot-overlay-message"].text === item.expectedMessage,
        metaIncludesExpected: Array.isArray(item.expectedMetaIncludes)
          ? item.expectedMetaIncludes.every((token) => metrics.rects["mascot-overlay-meta"].text.includes(token))
          : true,
        hintMatches: metrics.rects["mascot-overlay-hint"].text === item.expectedHint,
        readinessReasonMatches: item.expectedReadinessReason === undefined
          ? true
          : metrics.dataset.readinessReason === item.expectedReadinessReason,
        overlayReadinessReasonMatches: item.expectedOverlayReadinessReason === undefined
          ? true
          : metrics.dataset.overlayReadinessReason === item.expectedOverlayReadinessReason,
        browserLikeComposerCandidateCountMatches: item.expectedBrowserLikeComposerCandidateCount === undefined
          ? true
          : metrics.dataset.browserLikeComposerCandidateCount === item.expectedBrowserLikeComposerCandidateCount,
        visualAnchorIndexMatches: item.expectedVisualAnchorIndex === undefined
          ? true
          : metrics.dataset.visualAnchorIndex === item.expectedVisualAnchorIndex,
        visualAnchorReasonMatches: item.expectedVisualAnchorReason === undefined
          ? true
          : metrics.dataset.visualAnchorReason === item.expectedVisualAnchorReason,
        userTurnMatches: metrics.rects["mascot-overlay-user-turn"].text === item.expectedUserTurn,
        assistantTurnMatches: metrics.rects["mascot-overlay-assistant-turn"].text === item.expectedAssistantTurn,
        primaryMatches: metrics.rects["mascot-overlay-primary"].text === item.expectedPrimary,
        primaryPresent: metrics.rects["mascot-overlay-primary"].text.length > 0,
        actionsPresent: metrics.rects["mascot-overlay-draft"].text.length > 0
          && metrics.rects["mascot-overlay-generate"].text.length > 0
          && metrics.rects["mascot-overlay-refresh"].text.length > 0,
        previewPanelMatches: shouldShowPreviewPanel
          ? metrics.rects["mascot-overlay-preview-panel"].width > 0
            && metrics.rects["mascot-overlay-preview-panel"].height > 0
          : metrics.rects["mascot-overlay-preview-panel"].width === 0
            && metrics.rects["mascot-overlay-preview-panel"].height === 0,
        previewInputMatches: shouldShowPreviewPanel
          ? metrics.rects["mascot-overlay-preview-input"].valueLength === expectedPromptTextLength
            && metrics.rects["mascot-overlay-preview-input"].maxLength === 8000
          : metrics.rects["mascot-overlay-preview-input"].tagName === "TEXTAREA",
        previewActionMatches: shouldShowPreviewPanel
          ? metrics.rects["mascot-overlay-preview-copy"].text === "Copy"
            && metrics.rects["mascot-overlay-preview-review"].text === expectedReviewText
            && metrics.rects["mascot-overlay-preview-undo"].text === "Undo"
            && metrics.rects["mascot-overlay-preview-clear"].text === "Clear"
          : true,
        previewLengthMatches: Number(metrics.dataset.previewTextLength || 0) === expectedPromptTextLength
            && metrics.dataset.previewTextHash === expectedPromptTextHash
            && Number(metrics.dataset.promptTextLength || 0) === expectedPromptTextLength
            && metrics.dataset.promptTextHash === expectedPromptTextHash,
        moodStripVisible: item.expectedMode === "expanded"
          ? (metrics.rects["mascot-overlay-mood-strip"].width > 0 && metrics.rects["mascot-overlay-mood-strip"].height > 0)
          : true,
        moodStripMatches: metrics.dataset.mascotMood === item.expectedMascotMood,
        actionMatches: metrics.rects["mascot-overlay-draft"].text === item.expectedActions[0]
          && metrics.rects["mascot-overlay-generate"].text === item.expectedActions[1]
          && metrics.rects["mascot-overlay-refresh"].text === item.expectedActions[2],
        quickDraftPresent: metrics.rects["mascot-overlay-draft-input"].tagName === "TEXTAREA"
          && metrics.rects["mascot-overlay-draft-input"].maxLength === 400
          && metrics.rects["mascot-overlay-draft-input"].valueLength === 0
          && metrics.rects["mascot-overlay-draft-send"].text === ">"
          && metrics.rects["mascot-overlay-draft-send"].disabled === true,
        quickRepliesPresent: metrics.rects["mascot-overlay-reply-short"].text === item.expectedReplies[0]
          && metrics.rects["mascot-overlay-reply-clear"].text === item.expectedReplies[1]
          && metrics.rects["mascot-overlay-reply-steps"].text === item.expectedReplies[2]
          && metrics.dataset.quickReplyCount === "3"
          && metrics.dataset.quickReplySelected === "",
        quickRepliesVisibleMatches: item.expectedRepliesVisible === true
          ? metrics.rects["mascot-overlay-reply-short"].width > 0
            && metrics.rects["mascot-overlay-reply-clear"].width > 0
            && metrics.rects["mascot-overlay-reply-steps"].width > 0
          : metrics.rects["mascot-overlay-reply-short"].width === 0
            && metrics.rects["mascot-overlay-reply-clear"].width === 0
            && metrics.rects["mascot-overlay-reply-steps"].width === 0,
        modesPresent: metrics.rects["mascot-overlay-mode-idea"].text === "Idea"
          && metrics.rects["mascot-overlay-mode-continue"].text === "Cont"
          && metrics.rects["mascot-overlay-mode-polish"].text === "Polish",
        compactBubblePresent: item.expectedMode !== "compact"
          || (metrics.rects["mascot-overlay-button"].width === compactViewport.width
            && metrics.rects["mascot-overlay-button"].height === compactViewport.height
            && metrics.rects["mascot-overlay-image"].width >= 52
            && metrics.rects["mascot-overlay-image"].height >= 52
            && metrics.rects["mascot-overlay-chat"].width === 0),
        compactBackdropTransparent: item.expectedMode !== "compact"
          || (metrics.backdrop.htmlBackground === "rgba(0, 0, 0, 0)"
            && metrics.backdrop.bodyBackground === "rgba(0, 0, 0, 0)"
            && metrics.backdrop.cardBackground === "rgba(0, 0, 0, 0)"
            && metrics.backdrop.buttonBackground === "rgba(0, 0, 0, 0)"
            && metrics.backdrop.cardBoxShadow === "none"
            && metrics.backdrop.bodyWidth === compactViewport.width
            && metrics.backdrop.bodyHeight === compactViewport.height),
        compactScreenshotTransparent,
        compactBadgeDot: item.expectedMode !== "compact"
          || (metrics.rects["mascot-overlay-badge"].width <= 12
            && metrics.rects["mascot-overlay-badge"].height <= 12
            && metrics.rects["mascot-overlay-badge"].fontSize === "0px"),
        evidenceMatches: metrics.dataset.evidenceState === item.expectedEvidenceState
          && metrics.dataset.evidenceAction === item.expectedEvidenceAction
          && metrics.dataset.evidencePolicy === item.expectedEvidencePolicy,
        evidenceVisibleMatches: metrics.rects["mascot-overlay-thread"].width === 0
          && metrics.rects["mascot-overlay-thread"].height === 0,
        evidenceSanitizedMatches: /^[a-z0-9-]+$/.test(metrics.dataset.evidenceState || "")
          && /^[a-z0-9-]+$/.test(metrics.dataset.evidenceAction || "")
          && /^[a-z0-9-]+$/.test(metrics.dataset.evidencePolicy || ""),
        overlayModeMatches: metrics.dataset.overlayMode === item.expectedMode,
        previewVisibleMatches: metrics.dataset.previewVisible === String(shouldShowPreviewPanel),
        promptModeMatches: metrics.dataset.promptMode === item.expectedPromptMode,
        noAutoSubmit: metrics.dataset.noAutoSubmit === "true",
        promptReadyMatches: metrics.dataset.promptReady === String(item.payload.promptReady),
        promptKindMatches: metrics.dataset.promptKind === item.payload.promptKind,
        localeMatches: metrics.dataset.locale === "en"
          && metrics.dataset.inputLocale === "en"
          && metrics.rects["mascot-overlay-locale-zh"].text === "中文"
          && metrics.rects["mascot-overlay-locale-en"].text === "EN"
          && (
            item.expectedMode !== "compact"
              ? metrics.rects["mascot-overlay-locale-zh"].width > 0
                && metrics.rects["mascot-overlay-locale-en"].width > 0
              : metrics.rects["mascot-overlay-locale-zh"].width === 0
                && metrics.rects["mascot-overlay-locale-en"].width === 0
          ),
        guardReasonMatches: metrics.dataset.guardReason === (item.payload.guardReason || ""),
        visualOnlyMatches: metrics.dataset.visualOnly === String(item.payload.visualOnly === true)
      });
    }
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: expandedViewport.width,
      height: expandedViewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    const quickReplyProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        document.getElementById("mascot-overlay-reply-short").click();
        const input = document.getElementById("mascot-overlay-draft-input");
        const primary = document.getElementById("mascot-overlay-primary");
        return {
          quickDraftValueLength: input.value.length,
          quickReplySelected: document.documentElement.dataset.quickReplySelected,
          message: document.getElementById("mascot-overlay-message").textContent,
          hint: document.getElementById("mascot-overlay-hint").textContent,
          badge: document.getElementById("mascot-overlay-badge").textContent,
          primary: primary.textContent,
          primaryAction: document.documentElement.dataset.primaryAction,
          userTurn: document.documentElement.dataset.userTurn,
          assistantTurn: document.documentElement.dataset.assistantTurn,
          quickReplySelectedLabel: document.documentElement.dataset.quickReplySelectedLabel,
          textNotStored: true
        };
      })())`
    });
    const quickReplyProbe = JSON.parse(quickReplyProbeResult.result.value);
    const sendButtonProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(async () => {
        const submitted = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              submitted.push({
                command,
                textLength: String(args?.text || "").length,
                overlayAction: args?.payload?.overlayAction || "",
                promptKind: args?.payload?.promptKind || "",
                promptReady: args?.payload?.promptReady === true
              });
              return Promise.resolve(true);
            }
          }
        };
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        const input = document.getElementById("mascot-overlay-draft-input");
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const send = document.getElementById("mascot-overlay-draft-send");
        const emptyDisabled = send.disabled;
        const emptyReady = document.documentElement.dataset.quickDraftSendReady;
        send.click();
        await Promise.resolve();
        const emptySubmittedCount = submitted.length;
        document.getElementById("mascot-overlay-reply-short").click();
        const filledDisabled = send.disabled;
        const filledReady = document.documentElement.dataset.quickDraftSendReady;
        send.click();
        await Promise.resolve();
        const draftSubmission = submitted.find((item) => item.command === "mascot_overlay_draft_submitted");
        return {
          sendGlyph: send.textContent,
          emptyDisabled,
          emptyReady,
          emptySubmittedCount,
          filledDisabled,
          filledReady,
          submittedCount: submitted.length,
          command: draftSubmission?.command || "",
          submittedTextLength: draftSubmission?.textLength || 0,
          overlayAction: draftSubmission?.overlayAction || "",
          promptKind: draftSubmission?.promptKind || "",
          promptReady: draftSubmission?.promptReady === true,
          inputValueLength: input.value.length,
          textNotStored: true
        };
      })()`,
      awaitPromise: true
    });
    const sendButtonProbe = sendButtonProbeResult.result.value;
    const pendingActionProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        const invoked = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              invoked.push({
                command,
                overlayAction: args?.payload?.overlayAction || "",
                hasText: Boolean(args?.text)
              });
              return Promise.resolve(true);
            }
          }
        };
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        document.getElementById("mascot-overlay-reply-short").click();
        const draft = document.getElementById("mascot-overlay-draft");
        const generate = document.getElementById("mascot-overlay-generate");
        const refresh = document.getElementById("mascot-overlay-refresh");
        const idea = document.getElementById("mascot-overlay-mode-idea");
        const cont = document.getElementById("mascot-overlay-mode-continue");
        const polish = document.getElementById("mascot-overlay-mode-polish");
        const replyShort = document.getElementById("mascot-overlay-reply-short");
        const replyClear = document.getElementById("mascot-overlay-reply-clear");
        const replySteps = document.getElementById("mascot-overlay-reply-steps");
        const valueBeforeLockedClicks = document.getElementById("mascot-overlay-draft-input").value.length;
        replyClear.click();
        replySteps.click();
        idea.click();
        cont.click();
        polish.click();
        draft.click();
        generate.click();
        refresh.click();
        return {
          quickDraftPending: document.documentElement.dataset.quickDraftPending,
          primary: document.getElementById("mascot-overlay-primary").textContent,
          primaryAction: document.documentElement.dataset.primaryAction,
          disabledActions: [draft.disabled, generate.disabled, refresh.disabled],
          disabledModes: [idea.disabled, cont.disabled, polish.disabled],
          disabledReplies: [replyShort.disabled, replyClear.disabled, replySteps.disabled],
          valueStableAfterLockedReplies: document.getElementById("mascot-overlay-draft-input").value.length === valueBeforeLockedClicks,
          invokedCount: invoked.length,
          submittedTextCount: invoked.filter((item) => item.hasText).length,
          fillCommandCount: invoked.filter((item) => item.command === "mascot_overlay_clicked" || item.command === "desktop_fill").length,
          textNotStored: true
        };
      })())`
    });
    const pendingActionProbe = JSON.parse(pendingActionProbeResult.result.value);
    const modeReplyProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        const invoked = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              invoked.push({
                command,
                overlayAction: args?.payload?.overlayAction || "",
                promptMode: args?.payload?.promptMode || "",
                hasText: Boolean(args?.text)
              });
              return Promise.resolve(true);
            }
          }
        };
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        const input = document.getElementById("mascot-overlay-draft-input");
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("mascot-overlay-mode-polish").click();
        return {
          promptMode: document.documentElement.dataset.promptMode,
          replyActions: [
            document.getElementById("mascot-overlay-reply-short").textContent,
            document.getElementById("mascot-overlay-reply-clear").textContent,
            document.getElementById("mascot-overlay-reply-steps").textContent
          ],
          primary: document.getElementById("mascot-overlay-primary").textContent,
          userTurn: document.documentElement.dataset.userTurn,
          assistantTurn: document.documentElement.dataset.assistantTurn,
          invokedCount: invoked.length,
          command: invoked[0]?.command || "",
          overlayAction: invoked[0]?.overlayAction || "",
          invokedPromptMode: invoked[0]?.promptMode || "",
          submittedTextCount: invoked.filter((item) => item.hasText).length,
          textNotStored: true
        };
      })())`
    });
    const modeReplyProbe = JSON.parse(modeReplyProbeResult.result.value);
    const contextualReplyProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        window.render({ profile: "trae", state: "success", candidateIndex: 8, noAutoSubmit: true, promptReady: true, promptKind: "generated", promptMode: "continue", overlayMode: "expanded" });
        document.getElementById("mascot-overlay-reply-clear").click();
        const input = document.getElementById("mascot-overlay-draft-input");
        const primary = document.getElementById("mascot-overlay-primary");
        return {
          quickDraftValueLength: input.value.length,
          quickReplySelected: document.documentElement.dataset.quickReplySelected,
          message: document.getElementById("mascot-overlay-message").textContent,
          hint: document.getElementById("mascot-overlay-hint").textContent,
          badge: document.getElementById("mascot-overlay-badge").textContent,
          primary: primary.textContent,
          primaryAction: document.documentElement.dataset.primaryAction,
          userTurn: document.documentElement.dataset.userTurn,
          assistantTurn: document.documentElement.dataset.assistantTurn,
          quickReplySelectedLabel: document.documentElement.dataset.quickReplySelectedLabel,
          textNotStored: true
        };
      })())`
    });
    const contextualReplyProbe = JSON.parse(contextualReplyProbeResult.result.value);
    const primarySendProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(async () => {
        const submitted = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              submitted.push({
                command,
                textLength: String(args?.text || "").length,
                overlayAction: args?.payload?.overlayAction || "",
                promptKind: args?.payload?.promptKind || "",
                promptReady: args?.payload?.promptReady === true
              });
              return Promise.resolve(true);
            }
          }
        };
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        document.getElementById("mascot-overlay-reply-short").click();
        document.getElementById("mascot-overlay-primary").click();
        await Promise.resolve();
        const input = document.getElementById("mascot-overlay-draft-input");
        return {
          submittedCount: submitted.length,
          command: submitted[0]?.command || "",
          submittedTextLength: submitted[0]?.textLength || 0,
          overlayAction: submitted[0]?.overlayAction || "",
          promptKind: submitted[0]?.promptKind || "",
          promptReady: submitted[0]?.promptReady === true,
          inputValueLength: input.value.length,
          userTurn: document.documentElement.dataset.userTurn,
          assistantTurn: document.documentElement.dataset.assistantTurn,
          textNotStored: true
        };
      })()`,
      awaitPromise: true
    });
    const primarySendProbe = primarySendProbeResult.result.value;
    const actionTurnProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify((() => {
        const invoked = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              invoked.push({
                command,
                overlayAction: args?.payload?.overlayAction || "",
                hasText: Boolean(args?.text)
              });
              return Promise.resolve(true);
            }
          }
        };
        const turnsFor = (setup, clickId) => {
          window.render(setup);
          document.getElementById(clickId).click();
          return {
            userTurn: document.documentElement.dataset.userTurn,
            assistantTurn: document.documentElement.dataset.assistantTurn,
            primary: document.getElementById("mascot-overlay-primary").textContent,
            overlayAction: invoked.at(-1)?.overlayAction || "",
            command: invoked.at(-1)?.command || ""
          };
        };
        const base = { profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" };
        const draft = turnsFor(base, "mascot-overlay-draft");
        const scan = turnsFor(base, "mascot-overlay-refresh");
        const fill = turnsFor({ ...base, promptReady: true, promptKind: "generated" }, "mascot-overlay-primary");
        window.render({ ...base, state: "thinking", promptReady: true, promptKind: "generated", overlayAction: "generate" });
        const retryThinking = {
          userTurn: document.documentElement.dataset.userTurn,
          assistantTurn: document.documentElement.dataset.assistantTurn,
          hint: document.getElementById("mascot-overlay-hint").textContent
        };
        return {
          draft,
          scan,
          fill,
          retryThinking,
          invokedCount: invoked.length,
          submittedTextCount: invoked.filter((item) => item.hasText).length,
          textNotStored: true
        };
      })())`
    });
    const actionTurnProbe = JSON.parse(actionTurnProbeResult.result.value);
    const expandFocusProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(async () => {
        const invoked = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              invoked.push({ command, hasText: Boolean(args?.text) });
              return Promise.resolve(true);
            }
          }
        };
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "compact" });
        document.getElementById("mascot-overlay-button").click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const input = document.getElementById("mascot-overlay-draft-input");
        return {
          overlayMode: document.documentElement.dataset.overlayMode,
          inputFocused: document.activeElement === input,
          quickDraftFocused: document.documentElement.dataset.quickDraftFocused,
          primary: document.getElementById("mascot-overlay-primary").textContent,
          invokedCommands: invoked.map((item) => item.command),
          submittedTextCount: invoked.filter((item) => item.hasText).length,
          textNotStored: true
        };
      })()`,
      awaitPromise: true
    });
    const expandFocusProbe = expandFocusProbeResult.result.value;
    const multilineInputProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(async () => {
        const submitted = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              submitted.push({
                command,
                textLength: String(args?.text || "").length,
                textLineCount: String(args?.text || "").split("\\n").length,
                overlayAction: args?.payload?.overlayAction || "",
                promptKind: args?.payload?.promptKind || ""
              });
              return Promise.resolve(true);
            }
          }
        };
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        const input = document.getElementById("mascot-overlay-draft-input");
        input.focus();
        input.value = "first line";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
        const submittedAfterShiftEnter = submitted.length;
        input.value = "first line\\nsecond line";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        const enterAllowed = input.dispatchEvent(enter);
        await Promise.resolve();
        return {
          control: input.tagName,
          rows: input.rows,
          maxLength: input.maxLength,
          shiftEnterSubmittedCount: submittedAfterShiftEnter,
          enterDefaultPrevented: enter.defaultPrevented || enterAllowed === false,
          submittedCount: submitted.length,
          command: submitted[0]?.command || "",
          submittedTextLength: submitted[0]?.textLength || 0,
          submittedTextLineCount: submitted[0]?.textLineCount || 0,
          overlayAction: submitted[0]?.overlayAction || "",
          promptKind: submitted[0]?.promptKind || "",
          inputValueLength: input.value.length,
          textNotStored: true
        };
      })()`,
      awaitPromise: true
    });
    const multilineInputProbe = multilineInputProbeResult.result.value;
    const keyboardShortcutProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(async () => {
        const submitted = [];
        const invoked = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              invoked.push({ command, hasText: Boolean(args?.text), overlayMode: args?.payload?.overlayMode || "" });
              submitted.push({
                command,
                textLength: String(args?.text || "").length,
                overlayAction: args?.payload?.overlayAction || "",
                promptKind: args?.payload?.promptKind || ""
              });
              return Promise.resolve(true);
            }
          }
        };
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        const input = document.getElementById("mascot-overlay-draft-input");
        input.focus();
        input.value = "keyboard send";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const ctrlEnter = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
        const ctrlEnterAllowed = input.dispatchEvent(ctrlEnter);
        await Promise.resolve();
        const actionAfterSend = document.documentElement.dataset.quickDraftKeyboardAction;
        window.render({ profile: "codex", state: "suggesting", candidateIndex: 12, noAutoSubmit: true, promptReady: false, promptKind: "none", promptMode: "idea", overlayMode: "expanded" });
        input.focus();
        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        const escapeAllowed = input.dispatchEvent(escape);
        await Promise.resolve();
        return {
          ctrlEnterDefaultPrevented: ctrlEnter.defaultPrevented || ctrlEnterAllowed === false,
          submittedCount: submitted.filter((item) => item.command === "mascot_overlay_draft_submitted").length,
          submittedTextLength: submitted.find((item) => item.command === "mascot_overlay_draft_submitted")?.textLength || 0,
          submittedOverlayAction: submitted.find((item) => item.command === "mascot_overlay_draft_submitted")?.overlayAction || "",
          submittedPromptKind: submitted.find((item) => item.command === "mascot_overlay_draft_submitted")?.promptKind || "",
          actionAfterSend,
          escapeDefaultPrevented: escape.defaultPrevented || escapeAllowed === false,
          actionAfterEscape: document.documentElement.dataset.quickDraftKeyboardAction,
          overlayModeAfterEscape: document.documentElement.dataset.overlayMode,
          collapseCommandSeen: invoked.some((item) => item.command === "set_mascot_overlay_state" && item.overlayMode === "compact"),
          fillCommandCount: invoked.filter((item) => item.command === "mascot_overlay_clicked" || item.command === "desktop_fill").length,
          textNotStored: true
        };
      })()`,
      awaitPromise: true
    });
    const keyboardShortcutProbe = keyboardShortcutProbeResult.result.value;
    const previewActionProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(async () => {
        const invoked = [];
        const copiedLengths = [];
        Object.defineProperty(window.navigator, "clipboard", {
          configurable: true,
          value: {
            writeText(text) {
              copiedLengths.push(String(text || "").length);
              return Promise.resolve();
            }
          }
        });
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              invoked.push({
                command,
                overlayAction: args?.payload?.overlayAction || "",
                promptTextLength: String(args?.payload?.promptText || "").length,
                hasSubmittedText: Boolean(args?.text)
              });
              return Promise.resolve(true);
            }
          }
        };
        const originalText = "Review the local preview, then keep the guarded fill path.";
        const editedText = "Edited local preview stays metadata-only in reports.";
        window.render({
          profile: "codex",
          state: "suggesting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "continue",
          overlayMode: "expanded",
          promptText: originalText
        });
        const input = document.getElementById("mascot-overlay-preview-input");
        const originalLength = input.value.length;
        input.value = editedText;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const editedLength = Number(document.documentElement.dataset.previewTextLength || 0);
        document.getElementById("mascot-overlay-preview-copy").click();
        await Promise.resolve();
        document.getElementById("mascot-overlay-preview-review").click();
        await Promise.resolve();
        const reviewInvoke = invoked.find((item) => item.overlayAction === "review");
        window.render({
          profile: "codex",
          state: "suggesting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "continue",
          overlayMode: "expanded",
          promptText: originalText
        });
        input.value = editedText;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("mascot-overlay-preview-undo").click();
        const afterUndoLength = Number(document.documentElement.dataset.previewTextLength || 0);
        document.getElementById("mascot-overlay-preview-clear").click();
        const afterClearLength = Number(document.documentElement.dataset.previewTextLength || 0);
        return {
          originalLength,
          editedLength,
          copiedLength: copiedLengths[0] || 0,
          reviewCommand: reviewInvoke?.command || "",
          reviewOverlayAction: reviewInvoke?.overlayAction || "",
          reviewPromptTextLength: reviewInvoke?.promptTextLength || 0,
          afterUndoLength,
          afterClearLength,
          fillCommandCount: invoked.filter((item) => item.overlayAction === "fill" || item.command === "desktop_fill").length,
          submittedTextCount: invoked.filter((item) => item.hasSubmittedText).length,
          textNotStored: true
        };
      })()`,
      awaitPromise: true
    });
    const previewActionProbe = previewActionProbeResult.result.value;
    const retryActionProbeResult = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(async () => {
        const invoked = [];
        window.__TAURI__ = {
          core: {
            invoke(command, args) {
              invoked.push({
                command,
                overlayAction: args?.payload?.overlayAction || "",
                promptKind: args?.payload?.promptKind || "",
                promptTextLength: String(args?.payload?.promptText || "").length,
                hasSubmittedText: Boolean(args?.text)
              });
              return Promise.resolve(true);
            }
          }
        };
        const originalText = "Generated preview ready for local retry.";
        const editedText = "Edited preview should retry generation locally.";
        window.render({
          profile: "codex",
          state: "suggesting",
          candidateIndex: 12,
          noAutoSubmit: true,
          promptReady: true,
          promptKind: "generated",
          promptMode: "continue",
          overlayMode: "expanded",
          promptText: originalText
        });
        const retryButton = document.getElementById("mascot-overlay-generate");
        const input = document.getElementById("mascot-overlay-preview-input");
        const actionLabel = retryButton.textContent;
        input.value = editedText;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const editedLength = Number(document.documentElement.dataset.previewTextLength || 0);
        retryButton.click();
        await Promise.resolve();
        const retryInvoke = invoked.find((item) => item.overlayAction === "generate");
        return {
          actionLabel,
          editedLength,
          command: retryInvoke?.command || "",
          overlayAction: retryInvoke?.overlayAction || "",
          promptKind: retryInvoke?.promptKind || "",
          promptTextLength: retryInvoke?.promptTextLength || 0,
          fillCommandCount: invoked.filter((item) => item.overlayAction === "fill" || item.command === "desktop_fill").length,
          submittedTextCount: invoked.filter((item) => item.hasSubmittedText).length,
          textNotStored: true
        };
      })()`,
      awaitPromise: true
    });
    const retryActionProbe = retryActionProbeResult.result.value;
    client.close();

    const initialCompactPass = compactProbePass(initialCompactProbe);
    const compactThinkingPass = compactProbePass(compactThinkingProbe)
      && compactThinkingProbe.state === "thinking";
    const whiteBlockRegressionPass = compactProbePass(whiteBlockRegressionProbe)
      && whiteBlockRegressionProbe.state === "thinking";
    const defaultLocalePass = defaultLocaleProbe.lang === "zh-CN"
      && defaultLocaleProbe.locale === "zh-CN"
      && defaultLocaleProbe.inputLocale === "zh-CN"
      && defaultLocaleProbe.draftPlaceholder === "写下要处理的内容"
      && defaultLocaleProbe.draftLang === "zh-CN"
      && defaultLocaleProbe.draftDir === "auto"
      && defaultLocaleProbe.previewPlaceholder === "可编辑后再填入"
      && defaultLocaleProbe.previewLang === "zh-CN"
      && defaultLocaleProbe.previewDir === "auto"
      && defaultLocaleProbe.zhLabel === "中文"
      && defaultLocaleProbe.enLabel === "英文"
      && defaultLocaleProbe.zhPressed === "true"
      && defaultLocaleProbe.enPressed === "false";
    const zhVisiblePass = zhVisibleProbe.locale === "zh-CN"
      && zhVisibleProbe.inputLocale === "zh-CN"
      && zhVisibleProbe.meta.includes("不提交")
      && zhVisibleProbe.meta.includes("守卫0/207")
      && zhVisibleProbe.stateChip === "草稿就绪"
      && zhVisibleProbe.actionChip === "生成"
      && zhVisibleProbe.policyChip === "不提交"
      && zhVisibleProbe.evidenceStateToken === "draft-ready"
      && zhVisibleProbe.evidenceActionToken === "make"
      && zhVisibleProbe.evidencePolicyToken === "no-submit"
      && !/(?:no-submit|draft-ready|waiting|visual-only|guard:|status:|s:)/i.test(zhVisibleProbe.visibleStatus);
    const zhWaitingPass = zhWaitingProbe.locale === "zh-CN"
      && zhWaitingProbe.inputLocale === "zh-CN"
      && zhWaitingProbe.message === "添加提示"
      && zhWaitingProbe.hint === "草稿后生成"
      && zhWaitingProbe.primary === "草稿"
      && zhWaitingProbe.placeholder === "写下要处理的内容"
      && zhWaitingProbe.modeLabels.join("|") === "想法|续写|润色"
      && zhWaitingProbe.localeLabels.join("|") === "中文|英文"
      && zhWaitingProbe.quickRepliesHidden === true
      && zhWaitingProbe.evidenceVisible === false;
    const pass = initialCompactPass && defaultLocalePass && zhVisiblePass && zhWaitingPass && compactThinkingPass && whiteBlockRegressionPass && checks.every((check) =>
      check.messageMatches
        && check.metaIncludesExpected
        && check.hintMatches
        && check.readinessReasonMatches
        && check.overlayReadinessReasonMatches
        && check.browserLikeComposerCandidateCountMatches
        && check.visualAnchorIndexMatches
        && check.visualAnchorReasonMatches
        && check.userTurnMatches
        && check.assistantTurnMatches
        && check.primaryMatches
        && check.primaryPresent
        && check.actionsPresent
        && check.previewPanelMatches
        && check.previewInputMatches
        && check.previewActionMatches
        && check.previewLengthMatches
        && check.actionMatches
        && check.quickDraftPresent
        && check.quickRepliesPresent
        && check.quickRepliesVisibleMatches
        && check.modesPresent
        && check.compactBubblePresent
        && check.compactBackdropTransparent
        && check.compactScreenshotTransparent
        && check.compactBadgeDot
      && check.moodStripVisible
      && check.moodStripMatches
      && check.evidenceMatches
      && check.evidenceVisibleMatches
      && check.evidenceSanitizedMatches
      && check.overlayModeMatches
        && check.previewVisibleMatches
        && check.promptModeMatches
        && check.noAutoSubmit
        && check.promptReadyMatches
        && check.promptKindMatches
        && check.localeMatches
        && check.guardReasonMatches
        && check.visualOnlyMatches
        && check.overflows.length === 0
        && check.clippedText.length === 0
    )
      && quickReplyProbe.quickDraftValueLength > 0
      && quickReplyProbe.quickReplySelected === "brief"
      && quickReplyProbe.message === "Drafting note"
      && quickReplyProbe.hint === "Ready to send"
      && quickReplyProbe.badge === "draft"
      && quickReplyProbe.primary === "Send"
      && quickReplyProbe.primaryAction === "send-draft"
      && quickReplyProbe.userTurn === "You: Brief"
      && quickReplyProbe.assistantTurn === "Smart: press Send"
      && quickReplyProbe.quickReplySelectedLabel === "Brief"
      && quickReplyProbe.textNotStored === true
      && sendButtonProbe.sendGlyph === ">"
      && sendButtonProbe.emptyDisabled === true
      && sendButtonProbe.emptyReady === "false"
      && sendButtonProbe.emptySubmittedCount === 0
      && sendButtonProbe.filledDisabled === false
      && sendButtonProbe.filledReady === "true"
      && sendButtonProbe.submittedCount === 1
      && sendButtonProbe.command === "mascot_overlay_draft_submitted"
      && sendButtonProbe.submittedTextLength > 0
      && sendButtonProbe.overlayAction === "quick-draft"
      && sendButtonProbe.promptKind === "draft"
      && sendButtonProbe.promptReady === true
      && sendButtonProbe.inputValueLength === 0
      && sendButtonProbe.textNotStored === true
      && pendingActionProbe.quickDraftPending === "true"
      && pendingActionProbe.primary === "Send"
      && pendingActionProbe.primaryAction === "send-draft"
      && pendingActionProbe.disabledActions.join("|") === "true|true|true"
      && pendingActionProbe.disabledModes.join("|") === "true|true|true"
      && pendingActionProbe.disabledReplies.join("|") === "true|true|true"
      && pendingActionProbe.valueStableAfterLockedReplies === true
      && pendingActionProbe.invokedCount === 0
      && pendingActionProbe.submittedTextCount === 0
      && pendingActionProbe.fillCommandCount === 0
      && pendingActionProbe.textNotStored === true
      && modeReplyProbe.promptMode === "polish"
      && modeReplyProbe.replyActions.join("|") === "Short|Tone|Clear"
      && modeReplyProbe.primary === "Draft"
      && modeReplyProbe.userTurn === "You: Polish"
      && modeReplyProbe.assistantTurn === "Smart: replies tuned"
      && modeReplyProbe.invokedCount === 1
      && modeReplyProbe.command === "mascot_overlay_clicked"
      && modeReplyProbe.overlayAction === "mode"
      && modeReplyProbe.invokedPromptMode === "polish"
      && modeReplyProbe.submittedTextCount === 0
      && modeReplyProbe.textNotStored === true
      && contextualReplyProbe.quickDraftValueLength > 0
      && contextualReplyProbe.quickReplySelected === "tone"
      && contextualReplyProbe.message === "Drafting note"
      && contextualReplyProbe.hint === "Ready to send"
      && contextualReplyProbe.badge === "draft"
      && contextualReplyProbe.primary === "Send"
      && contextualReplyProbe.primaryAction === "send-draft"
      && contextualReplyProbe.userTurn === "You: Tone"
      && contextualReplyProbe.assistantTurn === "Smart: press Send"
      && contextualReplyProbe.quickReplySelectedLabel === "Tone"
      && contextualReplyProbe.textNotStored === true
      && primarySendProbe.submittedCount === 1
      && primarySendProbe.command === "mascot_overlay_draft_submitted"
      && primarySendProbe.submittedTextLength > 0
      && primarySendProbe.overlayAction === "quick-draft"
      && primarySendProbe.promptKind === "draft"
      && primarySendProbe.promptReady === true
      && primarySendProbe.inputValueLength === 0
      && primarySendProbe.userTurn === "You: draft sent"
      && primarySendProbe.assistantTurn === "Smart: make next"
      && primarySendProbe.textNotStored === true
      && actionTurnProbe.draft.userTurn === "You: Draft"
      && actionTurnProbe.draft.assistantTurn === "Smart: opening draft"
      && actionTurnProbe.draft.overlayAction === "draft"
      && actionTurnProbe.scan.userTurn === "You: Scan"
      && actionTurnProbe.scan.assistantTurn === "Smart: scanning target"
      && actionTurnProbe.scan.overlayAction === "refresh"
      && actionTurnProbe.fill.userTurn === "You: Fill"
      && actionTurnProbe.fill.assistantTurn === "Smart: checking target"
      && actionTurnProbe.fill.overlayAction === "fill"
      && actionTurnProbe.retryThinking.userTurn === "You: Retry"
      && actionTurnProbe.retryThinking.assistantTurn === "Smart: retrying prompt"
      && actionTurnProbe.retryThinking.hint === "Retrying prompt"
      && actionTurnProbe.submittedTextCount === 0
      && actionTurnProbe.textNotStored === true
      && expandFocusProbe.overlayMode === "expanded"
      && expandFocusProbe.inputFocused === true
      && expandFocusProbe.quickDraftFocused === "true"
      && expandFocusProbe.primary === "Draft"
      && expandFocusProbe.invokedCommands.includes("set_mascot_overlay_state")
      && expandFocusProbe.submittedTextCount === 0
      && expandFocusProbe.textNotStored === true
      && multilineInputProbe.control === "TEXTAREA"
      && multilineInputProbe.rows === 2
      && multilineInputProbe.maxLength === 400
      && multilineInputProbe.shiftEnterSubmittedCount === 0
      && multilineInputProbe.enterDefaultPrevented === true
      && multilineInputProbe.submittedCount === 1
      && multilineInputProbe.command === "mascot_overlay_draft_submitted"
      && multilineInputProbe.submittedTextLength > 0
      && multilineInputProbe.submittedTextLineCount === 2
      && multilineInputProbe.overlayAction === "quick-draft"
      && multilineInputProbe.promptKind === "draft"
      && multilineInputProbe.inputValueLength === 0
      && multilineInputProbe.textNotStored === true
      && keyboardShortcutProbe.ctrlEnterDefaultPrevented === true
      && keyboardShortcutProbe.submittedCount === 1
      && keyboardShortcutProbe.submittedTextLength > 0
      && keyboardShortcutProbe.submittedOverlayAction === "quick-draft"
      && keyboardShortcutProbe.submittedPromptKind === "draft"
      && keyboardShortcutProbe.actionAfterSend === "accelerator-send"
      && keyboardShortcutProbe.escapeDefaultPrevented === true
      && keyboardShortcutProbe.actionAfterEscape === "escape-collapse"
      && keyboardShortcutProbe.overlayModeAfterEscape === "compact"
      && keyboardShortcutProbe.collapseCommandSeen === true
      && keyboardShortcutProbe.fillCommandCount === 0
      && keyboardShortcutProbe.textNotStored === true
      && previewActionProbe.originalLength > 0
      && previewActionProbe.editedLength > 0
      && previewActionProbe.copiedLength === previewActionProbe.editedLength
      && previewActionProbe.reviewCommand === "mascot_overlay_clicked"
      && previewActionProbe.reviewOverlayAction === "review"
      && previewActionProbe.reviewPromptTextLength === previewActionProbe.editedLength
      && previewActionProbe.afterUndoLength === previewActionProbe.originalLength
      && previewActionProbe.afterClearLength === 0
      && previewActionProbe.fillCommandCount === 0
      && previewActionProbe.submittedTextCount === 0
      && previewActionProbe.textNotStored === true
      && retryActionProbe.actionLabel === "Retry"
      && retryActionProbe.editedLength > 0
      && retryActionProbe.command === "mascot_overlay_clicked"
      && retryActionProbe.overlayAction === "generate"
      && retryActionProbe.promptKind === "generated"
      && retryActionProbe.promptTextLength === retryActionProbe.editedLength
      && retryActionProbe.fillCommandCount === 0
      && retryActionProbe.submittedTextCount === 0
      && retryActionProbe.textNotStored === true;
    return {
      schemaVersion: "p25-overlay-chat-visual@1",
      createdAt: new Date().toISOString(),
      pass,
      browserExecutable: path.basename(browserPath),
      overlayViewports: {
        compact: compactViewport,
        expanded: expandedViewport,
        whiteBlockRegression: whiteBlockRegressionViewport
      },
      initialCompactProbe,
      defaultLocaleProbe,
      zhVisiblePass,
      zhVisibleProbe,
      zhWaitingPass,
      zhWaitingProbe,
      compactThinkingProbe,
      whiteBlockRegressionProbe,
      checks,
      quickReplyProbe,
      sendButtonProbe,
      pendingActionProbe,
      modeReplyProbe,
      contextualReplyProbe,
      primarySendProbe,
      actionTurnProbe,
      expandFocusProbe,
      multilineInputProbe,
      keyboardShortcutProbe,
      previewActionProbe,
      retryActionProbe,
      privacy: {
        promptTextNotStored: true,
        quickDraftTextNotStored: true,
        targetInputsNotStored: true,
        targetTitlesRedacted: true,
        overlayUsesMetadataOnly: true,
        conversationTurnsUseMetadataOnly: true
      }
    };
  } finally {
    browser.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 800);
      browser.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    console.log(`Legacy visual profile retained at ${userDataDir}`);
  }
}

runVisualCheck()
  .then((report) => {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`P25 overlay chat visual report: ${reportPath}`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
  })
  .catch((error) => {
    const report = {
      schemaVersion: "p25-overlay-chat-visual@1",
      createdAt: new Date().toISOString(),
      pass: false,
      error: error.message,
      privacy: {
        promptTextNotStored: true,
        quickDraftTextNotStored: true,
        targetInputsNotStored: true,
        targetTitlesRedacted: true,
        overlayUsesMetadataOnly: true,
        conversationTurnsUseMetadataOnly: true
      }
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(error.message);
    process.exit(1);
  });
}
