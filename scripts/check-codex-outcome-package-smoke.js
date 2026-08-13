"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

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
const rawSentinel = "PACKAGE_SMOKE_RAW_INPUT_MUST_NOT_PERSIST_91d7";

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
  throw new Error(`Packaged sidecar did not become healthy on ${port}.`);
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

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  });
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

async function main() {
  assert.equal(fs.existsSync(executable), true, `Missing packaged sidecar: ${executable}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-r10-package-smoke-"));
  const port = await freePort();
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      SMART_PROMPT_DATA_DIR: dataDir,
      SMART_PROMPT_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  try {
    const health = await waitForHealth(port);
    assert.equal(health.buildId, expectedBuildId);
    assert.equal(health.sidecar, "native");
    const bootstrap = await requestJson(port, "", "GET", "/auth/bootstrap");
    assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.body));
    const token = bootstrap.body.auth?.token;
    assert.match(token, /^[a-f0-9]{64}$/);
    const security = JSON.parse(fs.readFileSync(path.join(dataDir, "security.json"), "utf8"));
    assert.equal(security.authToken, token);

    const reminder = await requestJson(port, token, "POST", "/learning/v1/reminder/resolve", {
      projectScopeToken: "project_package_smoke",
      input: `Preserve existing changes while implementing the request. ${rawSentinel}`,
      taskScenarioToken: "feature_development",
      modeToken: "continue"
    });
    assert.equal(reminder.status, 200, JSON.stringify(reminder.body));
    assert.equal(reminder.body.reminder, null);
    assert.ok(reminder.body.featureTokens.includes("learning:rule_preserve_existing_changes"));

    const forgedVerifiedInsert = await requestJson(
      port,
      token,
      "POST",
      "/outcomes/v2/events",
      { eventType: "verified_insert" }
    );
    assert.equal(forgedVerifiedInsert.status, 400);
    assert.equal(forgedVerifiedInsert.body.error.code, "verified_insert_server_transaction_required");

    const forgedPromotion = await requestJson(
      port,
      token,
      "POST",
      "/learning/v1/promotion-evidence",
      { succeeded: true }
    );
    assert.equal(forgedPromotion.status, 400);
    assert.equal(forgedPromotion.body.error.code, "promotion_evidence_server_derivation_required");

    const persisted = allFiles(dataDir)
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    assert.equal(persisted.includes(rawSentinel), false);
    process.stdout.write(`${JSON.stringify({
      pass: true,
      buildId: health.buildId,
      sidecar: health.sidecar,
      reminderResolvedWithoutModel: true,
      rawInputPersisted: false,
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
