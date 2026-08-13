"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { deriveLearningCandidateSeed } = require("../packages/outcome-learning");

const root = path.resolve(__dirname, "..");
const executable = path.join(
  root,
  "apps",
  "desktop-shell",
  "src-tauri",
  "resources",
  "smart-prompt-sidecar",
  "bin",
  process.platform === "win32" ? "local-service-sidecar.exe" : "local-service-sidecar"
);
const expectedBuildId = "phase3-native-sidecar-20260719-r18";
const trustedOrigin = "http://tauri.localhost";
const rawSentinel = "PRIVACY_LIVE_RAW_INPUT_MUST_NOT_PERSIST_7391";
const syntheticKey = "PRIVACY_LIVE_SYNTHETIC_KEY_DO_NOT_LOG";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // Cold start is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Native sidecar did not become healthy on ${port}.`);
}

async function requestJson(port, token, method, pathname, body) {
  const headers = {
    Origin: trustedOrigin,
    ...(body === undefined ? {} : { "Content-Type": "application/json" })
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 1500))
  ]);
  if (!exited && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  });
}

async function main() {
  assert.equal(fs.existsSync(executable), true, `Missing packaged sidecar: ${executable}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-r10-privacy-live-"));
  const servicePort = await freePort();
  const unavailableProviderPort = await freePort();
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      SMART_PROMPT_DATA_DIR: dataDir,
      SMART_PROMPT_PORT: String(servicePort)
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  try {
    const health = await waitForHealth(servicePort);
    assert.equal(health.buildId, expectedBuildId);
    assert.equal(health.sidecar, "native");

    const bootstrap = await requestJson(servicePort, "", "GET", "/auth/bootstrap");
    assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.body));
    const token = bootstrap.body.auth?.token;
    assert.match(token, /^[a-f0-9]{64}$/);

    const settings = await requestJson(servicePort, token, "PUT", "/settings", {
      settings: {
        provider: "openai-compatible",
        baseUrl: `http://127.0.0.1:${unavailableProviderPort}/v1`,
        model: "synthetic-privacy-model",
        providerKeys: { "openai-compatible": syntheticKey },
        uploadWholePage: false,
        autoSubmit: false
      }
    });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.body.settings.providerKeys["openai-compatible"], "configured");

    const metric = await requestJson(servicePort, token, "POST", "/metrics", {
      event: {
        source: "desktop-shell",
        site: "codex",
        action: "card_ready",
        verified: true,
        promptLength: 42
      }
    });
    assert.equal(metric.status, 200, JSON.stringify(metric.body));

    const generated = await requestJson(servicePort, token, "POST", "/generate", {
      input: `Preserve existing changes while implementing the request. ${rawSentinel}`,
      mode: "continue",
      target: "privacy-scan",
      allowTemplateFallback: true,
      context: {
        taskScenario: "feature_development",
        projectScopeToken: "project_privacy_live"
      }
    });
    assert.equal(generated.status, 200, JSON.stringify(generated.body));
    assert.equal(generated.body.card.generatedBy, "template-fallback");
    assert.equal(generated.body.card.learningPatternToken, null);

    const historyPath = path.join(dataDir, "prompt-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    assert.equal(history.length, 1);
    // Exercise the scanner's non-null seed branch without requiring a foreground Codex lease.
    history[0].learningCandidateSeed = deriveLearningCandidateSeed(
      "Preserve existing changes while implementing the request.",
      { taskScenarioToken: "feature_development" }
    );
    fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    assert.equal(history[0].learningCandidateSeed?.schemaVersion, "learning-candidate-seed@1");

    const persisted = allFiles(dataDir)
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    assert.equal(persisted.includes(rawSentinel), false);
    assert.equal(persisted.includes(syntheticKey), false);

    const scan = spawnSync(process.execPath, [path.join(root, "scripts", "check-phase3-privacy.js")], {
      cwd: root,
      env: {
        ...process.env,
        SMART_PROMPT_PHASE3_ACCEPTANCE_DATA_DIR: dataDir,
        SMART_PROMPT_PORT: String(servicePort)
      },
      encoding: "utf8"
    });
    process.stdout.write(scan.stdout || "");
    process.stderr.write(scan.stderr || "");
    assert.equal(scan.status, 0, "Phase 3 live privacy scan failed.");
    process.stdout.write(`${JSON.stringify({
      pass: true,
      buildId: health.buildId,
      promptHistoryEntries: history.length,
      learningCandidateSeedValidated: true,
      rawInputPersisted: false,
      plaintextCredentialPersisted: false,
      retainedDataDir: dataDir
    })}\n`);
  } finally {
    await stopChild(child);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
