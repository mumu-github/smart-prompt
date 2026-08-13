const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..", "..");
const SERVICE_PORT = Number(process.env.SMART_PROMPT_VISUAL_SERVICE_PORT || 17371);
const PREVIEW_PORT = Number(process.env.SMART_PROMPT_VISUAL_PREVIEW_PORT || 17372);
const nativeSidecarPath = process.env.SMART_PROMPT_PHASE3_SIDECAR
  || path.join(root, "src-tauri", "resources", "smart-prompt-sidecar", "bin", process.platform === "win32" ? "local-service-sidecar.exe" : "local-service-sidecar");
const chromePath = process.env.CHROME_PATH
  || path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1223", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
const outputDir = path.join(repoRoot, "outputs", "phase3-activation");
const learningFixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "outcome-learning-ui.json"), "utf8"));
const screenshotPaths = {
  provider: path.join(outputDir, "desktop-control-center-provider.png"),
  customProvider: path.join(outputDir, "desktop-control-center-custom-provider.png"),
  mobileProvider: path.join(outputDir, "desktop-control-center-mobile-provider.png"),
  browser: path.join(outputDir, "desktop-control-center-codex-verification.png"),
  activated: path.join(outputDir, "desktop-control-center-activated.png"),
  model: path.join(outputDir, "desktop-control-center-model.png"),
  learning: path.join(outputDir, "desktop-control-center-learning.png"),
  privacy: path.join(outputDir, "desktop-control-center-privacy.png"),
  diagnostics: path.join(outputDir, "desktop-control-center-diagnostics.png"),
  mobileControlCenter: path.join(outputDir, "desktop-control-center-mobile-model.png")
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 9229;
      server.close(() => resolve(port));
    });
  });
}

function assertPortAvailable(port, label) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`${label} port ${port} is already in use; visual test refused to attach to an unknown process.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function waitForHttp(url, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local preview is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForTarget(port, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // Chrome is still starting.
    }
    await sleep(150);
  }
  throw new Error("Timed out waiting for Chrome target.");
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((innerResolve, innerReject) => pending.set(id, { resolve: innerResolve, reject: innerReject }));
      },
      close() {
        socket.close();
      }
    }));
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
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Visual probe evaluation failed");
  return result.result.value;
}

async function capture(client, filePath) {
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(filePath, Buffer.from(screenshot.data, "base64"));
}

async function reload(client) {
  await client.send("Page.navigate", { url: `http://127.0.0.1:${PREVIEW_PORT}/index.html` });
  await sleep(850);
}

(async () => {
  assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
  assert.ok(fs.existsSync(nativeSidecarPath), `Native sidecar not found: ${nativeSidecarPath}`);
  await assertPortAvailable(SERVICE_PORT, "Local service");
  await assertPortAvailable(PREVIEW_PORT, "Desktop preview");
  fs.mkdirSync(outputDir, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-phase3-service-"));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-phase3-chrome-"));
  const cdpPort = await getAvailablePort();
  const preview = spawn(process.execPath, [path.join(root, "tests", "static-preview.js")], {
    cwd: root,
    env: { ...process.env, SMART_PROMPT_PREVIEW_PORT: String(PREVIEW_PORT) },
    stdio: "ignore"
  });
  const service = spawn(nativeSidecarPath, [], {
    cwd: path.dirname(nativeSidecarPath),
    env: {
      ...process.env,
      SMART_PROMPT_DATA_DIR: dataDir,
      SMART_PROMPT_PORT: String(SERVICE_PORT),
      SMART_PROMPT_ALLOW_DEV_BOOTSTRAP: "1"
    },
    stdio: "ignore"
  });
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1120,760",
    `http://127.0.0.1:${PREVIEW_PORT}/index.html`
  ], { stdio: "ignore" });

  let client;
  try {
    await waitForHttp(`http://127.0.0.1:${PREVIEW_PORT}/index.html`);
    await waitForHttp(`http://127.0.0.1:${SERVICE_PORT}/health`);
    const target = await waitForTarget(cdpPort);
    client = await createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `globalThis.__SMART_PROMPT_SERVICE_URL__ = "http://127.0.0.1:${SERVICE_PORT}";`
    });
    await reload(client);
    await sleep(500);
    const providerProbe = await evaluate(client, `(() => {
      const wizard = document.getElementById("activation-wizard");
      const legacy = document.querySelector(".legacy-shell");
      const rect = wizard?.getBoundingClientRect();
      return {
        title: document.title,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        phaseBackground: getComputedStyle(document.getElementById("phase3-control-center")).backgroundColor,
        wizardVisible: Boolean(wizard && !wizard.hidden && rect && rect.width > 0 && rect.height > 0),
        providerStepVisible: Boolean(document.getElementById("wizard-provider-step")?.getBoundingClientRect().height),
        browserStepVisible: !document.getElementById("wizard-browser-step")?.hidden,
        controlCenterVisible: !document.getElementById("control-center")?.hidden,
        legacyHidden: getComputedStyle(legacy).display === "none",
        controlCenterPresent: Boolean(document.getElementById("control-center")),
        advancedOpen: document.querySelector('[data-provider-form="wizard"] details')?.open === true,
        advancedFieldVisible: document.getElementById("wizard-base-url")?.getBoundingClientRect().height > 0,
        modelChoiceVisible: document.getElementById("wizard-model-choice")?.getBoundingClientRect().height > 0,
        customModelVisible: document.getElementById("wizard-model")?.getBoundingClientRect().height > 0,
        keyState: document.querySelector('[data-provider-form="wizard"] [data-provider-key-state]')?.textContent || "",
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        phase3: document.body.dataset.phase3ControlCenter === "true"
      };
    })()`);
    assert.equal(providerProbe.wizardVisible, true);
    assert.equal(providerProbe.providerStepVisible, true);
    assert.equal(providerProbe.browserStepVisible, false);
    assert.equal(providerProbe.controlCenterVisible, false);
    assert.equal(providerProbe.legacyHidden, true);
    assert.equal(providerProbe.controlCenterPresent, true);
    assert.equal(providerProbe.advancedOpen, false);
    assert.equal(providerProbe.advancedFieldVisible, false);
    assert.equal(providerProbe.modelChoiceVisible, true);
    assert.equal(providerProbe.customModelVisible, false);
    assert.equal(providerProbe.keyState, "尚未保存");
    assert.equal(providerProbe.horizontalOverflow, false);
    assert.equal(providerProbe.phase3, true);
    await capture(client, screenshotPaths.provider);
    const advancedProbe = await evaluate(client, `(() => {
      const details = document.querySelector('[data-provider-form="wizard"] details');
      details.open = true;
      const result = {
        baseUrlVisible: document.getElementById("wizard-base-url")?.getBoundingClientRect().height > 0,
        modelChoiceVisible: document.getElementById("wizard-model-choice")?.getBoundingClientRect().height > 0,
        customModelVisible: document.getElementById("wizard-model")?.getBoundingClientRect().height > 0,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
      details.open = false;
      return result;
    })()`);
    assert.equal(advancedProbe.baseUrlVisible, true);
    assert.equal(advancedProbe.modelChoiceVisible, true);
    assert.equal(advancedProbe.customModelVisible, false);
    assert.equal(advancedProbe.horizontalOverflow, false);

    const customModelProbe = await evaluate(client, `(() => {
      const choice = document.getElementById("wizard-model-choice");
      choice.value = "__custom__";
      choice.dispatchEvent(new Event("change", { bubbles: true }));
      const custom = document.getElementById("wizard-model");
      custom.value = "vendor/custom-model:2026-07";
      return {
        choice: choice.value,
        customVisible: custom.getBoundingClientRect().height > 0,
        customValue: custom.value,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    })()`);
    assert.equal(customModelProbe.choice, "__custom__");
    assert.equal(customModelProbe.customVisible, true);
    assert.equal(customModelProbe.customValue, "vendor/custom-model:2026-07");
    assert.equal(customModelProbe.horizontalOverflow, false);

    await evaluate(client, `(() => {
      document.getElementById("wizard-key").value = "typing-must-survive-poll";
      return true;
    })()`);
    await sleep(1600);
    const pollRetentionProbe = await evaluate(client, `(() => ({
      keyValue: document.getElementById("wizard-key")?.value || "",
      modelChoice: document.getElementById("wizard-model-choice")?.value || "",
      customModel: document.getElementById("wizard-model")?.value || "",
      customVisible: document.getElementById("wizard-model")?.getBoundingClientRect().height > 0
    }))()`);
    assert.equal(pollRetentionProbe.keyValue, "typing-must-survive-poll");
    assert.equal(pollRetentionProbe.modelChoice, "__custom__");
    assert.equal(pollRetentionProbe.customModel, "vendor/custom-model:2026-07");
    assert.equal(pollRetentionProbe.customVisible, true);

    const customProviderProbe = await evaluate(client, `(() => {
      const provider = document.getElementById("wizard-provider");
      provider.value = "custom";
      provider.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("wizard-custom-name").value = "Team Gateway";
      document.getElementById("wizard-custom-protocol").value = "anthropic";
      document.getElementById("wizard-custom-base-url").value = "https://gateway.example/v1";
      document.getElementById("wizard-model").value = "private/model-v2";
      document.getElementById("wizard-key").value = "custom-key-must-survive-poll";
      return {
        provider: provider.value,
        nameVisible: document.getElementById("wizard-custom-name")?.getBoundingClientRect().height > 0,
        protocolVisible: document.getElementById("wizard-custom-protocol")?.getBoundingClientRect().height > 0,
        baseUrlVisible: document.getElementById("wizard-custom-base-url")?.getBoundingClientRect().height > 0,
        customModelVisible: document.getElementById("wizard-model")?.getBoundingClientRect().height > 0,
        modelChoiceVisible: document.getElementById("wizard-model-choice")?.getBoundingClientRect().height > 0,
        fixedAdvancedHidden: document.querySelector('[data-provider-form="wizard"] [data-fixed-provider-advanced]')?.hidden === true,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    })()`);
    assert.equal(customProviderProbe.provider, "custom");
    assert.equal(customProviderProbe.nameVisible, true);
    assert.equal(customProviderProbe.protocolVisible, true);
    assert.equal(customProviderProbe.baseUrlVisible, true);
    assert.equal(customProviderProbe.customModelVisible, true);
    assert.equal(customProviderProbe.modelChoiceVisible, false);
    assert.equal(customProviderProbe.fixedAdvancedHidden, true);
    assert.equal(customProviderProbe.horizontalOverflow, false);
    await capture(client, screenshotPaths.customProvider);

    await sleep(1600);
    const customProviderRetention = await evaluate(client, `(() => ({
      provider: document.getElementById("wizard-provider")?.value || "",
      name: document.getElementById("wizard-custom-name")?.value || "",
      protocol: document.getElementById("wizard-custom-protocol")?.value || "",
      baseUrl: document.getElementById("wizard-custom-base-url")?.value || "",
      model: document.getElementById("wizard-model")?.value || "",
      key: document.getElementById("wizard-key")?.value || ""
    }))()`);
    assert.deepEqual(customProviderRetention, {
      provider: "custom",
      name: "Team Gateway",
      protocol: "anthropic",
      baseUrl: "https://gateway.example/v1",
      model: "private/model-v2",
      key: "custom-key-must-survive-poll"
    });

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await sleep(200);
    const mobileProbe = await evaluate(client, `(() => ({
      wizardVisible: !document.getElementById("activation-wizard")?.hidden,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      providerColumns: getComputedStyle(document.querySelector('[data-provider-form="wizard"]')).gridTemplateColumns
    }))()`);
    assert.equal(mobileProbe.wizardVisible, true);
    assert.equal(mobileProbe.horizontalOverflow, false);
    assert.equal(mobileProbe.providerColumns.includes(" "), false);
    await capture(client, screenshotPaths.mobileProvider);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1120,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false
    });
    await reload(client);

    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test"
    }));

    fs.writeFileSync(path.join(dataDir, "activation-v2.json"), JSON.stringify({
      schemaVersion: "codex-activation@2",
      progress: "model_ready",
      runtimeHealth: "healthy",
      provider: "openai-compatible",
      modelTestedAt: "2026-07-17T00:00:00.000Z",
      legacyActivated: false,
      legacySummary: null,
      codexVerified: false,
      completedAt: "",
      completionEventId: "",
      completionSignature: "",
      migrationAppliedAt: "",
      migrationSource: "",
      updatedAt: "2026-07-17T00:00:00.000Z"
    }));
    await reload(client);
    await evaluate(client, `(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 13000;
      return true;
    })()`);
    await sleep(1400);
    const browserProbe = await evaluate(client, `(() => ({
      wizardVisible: !document.getElementById("activation-wizard")?.hidden,
      browserStepVisible: !document.getElementById("wizard-browser-step")?.hidden,
      providerStepVisible: !document.getElementById("wizard-provider-step")?.hidden,
      controlCenterVisible: !document.getElementById("control-center")?.hidden,
      statusText: document.getElementById("wizard-browser-status")?.textContent || "",
      statusTone: document.getElementById("wizard-browser-status")?.dataset.tone || "",
      actionText: document.getElementById("open-wizard-codex")?.textContent || "",
      containsLegacyTarget: /ChatGPT/.test(document.getElementById("activation-wizard")?.textContent || ""),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyHeight: document.body.getBoundingClientRect().height,
      documentHeight: document.documentElement.scrollHeight,
      wizardBottom: document.getElementById("activation-wizard")?.getBoundingClientRect().bottom,
      controlDisplay: getComputedStyle(document.getElementById("control-center")).display
    }))()`);
    assert.equal(browserProbe.wizardVisible, true);
    assert.equal(browserProbe.browserStepVisible, true);
    assert.equal(browserProbe.providerStepVisible, false);
    assert.equal(browserProbe.controlCenterVisible, false);
    assert.equal(browserProbe.statusText, "模型已就绪，下一步在 Codex 完成一次安全写回");
    assert.equal(browserProbe.statusTone, "success");
    assert.equal(browserProbe.actionText, "收起并去 Codex 验证");
    assert.equal(browserProbe.containsLegacyTarget, false);
    await capture(client, screenshotPaths.browser);

    fs.writeFileSync(path.join(dataDir, "activation-v2.json"), JSON.stringify({
      schemaVersion: "codex-activation@2",
      progress: "activated",
      runtimeHealth: "healthy",
      provider: "openai-compatible",
      modelTestedAt: "2026-07-17T00:00:00.000Z",
      legacyActivated: false,
      legacySummary: null,
      codexVerified: true,
      completedAt: "2026-07-17T00:00:12.000Z",
      completionEventId: "activation-verified_insert-1784246412000",
      completionSignature: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      migrationAppliedAt: "",
      migrationSource: "",
      updatedAt: "2026-07-17T00:00:12.000Z"
    }));
    await reload(client);
    const activatedProbe = await evaluate(client, `(() => ({
      wizardVisible: !document.getElementById("activation-wizard")?.hidden,
      controlCenterVisible: !document.getElementById("control-center")?.hidden,
      overviewVisible: !document.querySelector('[data-control-page-view="overview"]')?.hidden,
      pageCount: document.querySelectorAll("[data-control-page-view]").length,
      badge: document.getElementById("activation-badge")?.textContent || ""
    }))()`);
    assert.equal(activatedProbe.wizardVisible, false);
    assert.equal(activatedProbe.controlCenterVisible, true);
    assert.equal(activatedProbe.overviewVisible, true);
    assert.equal(activatedProbe.pageCount, 5);
    assert.equal(activatedProbe.badge, "已激活");
    await capture(client, screenshotPaths.activated);

    await evaluate(client, `(() => {
      window.dispatchEvent(new CustomEvent("smart-prompt-learning-data", {
        detail: ${JSON.stringify(learningFixture)}
      }));
      return true;
    })()`);

    for (const page of ["model", "learning", "privacy", "diagnostics"]) {
      await evaluate(client, `document.querySelector('[data-control-page="${page}"]').click()`);
      await sleep(page === "diagnostics" ? 450 : 180);
      if (page === "learning") {
        await evaluate(client, `(() => {
          window.dispatchEvent(new CustomEvent("smart-prompt-learning-data", {
            detail: ${JSON.stringify(learningFixture)}
          }));
          return true;
        })()`);
        await sleep(120);
      }
      const pageProbe = await evaluate(client, `(() => {
        const view = document.querySelector('[data-control-page-view="${page}"]');
        const rect = view?.getBoundingClientRect();
        return {
          visible: Boolean(view && !view.hidden && rect && rect.width > 0 && rect.height > 0),
          activeNav: document.querySelector('[data-control-page="${page}"]')?.getAttribute("aria-current"),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          withinViewport: Boolean(rect && rect.left >= -1 && rect.right <= window.innerWidth + 1)
        };
      })()`);
      assert.equal(pageProbe.visible, true);
      assert.equal(pageProbe.activeNav, "page");
      assert.equal(pageProbe.horizontalOverflow, false);
      assert.equal(pageProbe.withinViewport, true);
      if (page === "learning") {
        const learningProbe = await evaluate(client, `(() => ({
          sections: document.querySelectorAll(".learning-section").length,
          rows: document.querySelectorAll(".learning-row").length,
          hasCandidateReview: Boolean(document.querySelector('[data-learning-action="candidate-review"]')),
          hasCanary: Boolean(document.querySelector('[data-learning-action="policy-start-canary"]')),
          hasRollback: Boolean(document.querySelector('[data-learning-action="policy-rollback"]')),
          hasPauseLearning: Boolean(document.querySelector('[data-learning-action="policy-learning-pause"]')),
          hasAssetPause: Boolean(document.querySelector('[data-learning-action="asset-pause"]')),
          forbiddenResearchText: /Pilot Outcomes|Quality Lift|Quality Segments|evidenceToken|strategyScore/.test(document.getElementById("learning-content")?.textContent || "")
        }))()`);
        assert.equal(learningProbe.sections, 4);
        assert.ok(learningProbe.rows >= 7);
        assert.equal(learningProbe.hasCandidateReview, true);
        assert.equal(learningProbe.hasCanary, true);
        assert.equal(learningProbe.hasRollback, true);
        assert.equal(learningProbe.hasPauseLearning, true);
        assert.equal(learningProbe.hasAssetPause, false);
        assert.equal(learningProbe.forbiddenResearchText, false);
      }
      await capture(client, screenshotPaths[page]);
    }

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    for (const page of ["overview", "model", "learning", "privacy", "diagnostics"]) {
      await evaluate(client, `document.querySelector('[data-control-page="${page}"]').click()`);
      await sleep(120);
      const mobilePageProbe = await evaluate(client, `(() => {
        const view = document.querySelector('[data-control-page-view="${page}"]');
        const rect = view?.getBoundingClientRect();
        return {
          visible: Boolean(view && !view.hidden && rect && rect.width > 0 && rect.height > 0),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          withinViewport: Boolean(rect && rect.left >= -1 && rect.right <= window.innerWidth + 1)
        };
      })()`);
      assert.equal(mobilePageProbe.visible, true);
      assert.equal(mobilePageProbe.horizontalOverflow, false);
      assert.equal(mobilePageProbe.withinViewport, true);
      if (page === "model") await capture(client, screenshotPaths.mobileControlCenter);
    }
    const mobileNavigationProbe = await evaluate(client, `(() => {
      const nav = document.querySelector(".control-nav");
      const navRect = nav?.getBoundingClientRect();
      const buttons = [...document.querySelectorAll(".control-nav button")];
      return {
        count: buttons.length,
        allVisible: buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return Boolean(navRect && rect.width > 0 && rect.left >= navRect.left - 1 && rect.right <= navRect.right + 1);
        }),
        scrollFree: Boolean(nav && nav.scrollWidth <= nav.clientWidth + 1)
      };
    })()`);
    assert.equal(mobileNavigationProbe.count, 5);
    assert.equal(mobileNavigationProbe.allVisible, true);
    assert.equal(mobileNavigationProbe.scrollFree, true);
    console.log(`phase3 control center visual test passed; screenshots=${Object.values(screenshotPaths).join(",")}`);
  } finally {
    client?.close();
    chrome.kill();
    service.kill();
    preview.kill();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
