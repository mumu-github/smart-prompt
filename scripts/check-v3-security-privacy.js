const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { collectRedactionLeaks, hashValue, redactEvidence } = require("../packages/shared/evidence-redaction");
const { startServer } = require("../apps/local-service/src/server");
const { createStore } = require("../apps/local-service/src/store");

const root = path.resolve(__dirname, "..");
const reportPath = process.env.SMART_PROMPT_V3_SECURITY_REPORT || path.join(root, "research/v3-security-privacy.latest.json");
const trustedOrigin = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";
const evilOrigin = "https://evil.example";

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

async function request(port, method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function hasNoWildcardCors(response) {
  return response.headers["access-control-allow-origin"] !== "*";
}

(async () => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const dataDir = tempDir("smart-prompt-v3-security-");
  const server = startServer({ port: 0, store: createStore(dataDir) });
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const checks = {
    healthPublic: false,
    unauthSettingsBlocked: false,
    evilOriginBlocked: false,
    trustedBootstrap: false,
    protectedBearerAccepted: false,
    protectedTokenHeaderAccepted: false,
    corsNoWildcard: false,
    redactionNoLeaks: false
  };
  const observations = {};
  try {
    const health = await request(port, "GET", "/health");
    checks.healthPublic = health.status === 200 && health.body.authRequired === true;
    observations.health = { status: health.status, authRequired: health.body.authRequired };

    const unauthSettings = await request(port, "GET", "/settings");
    checks.unauthSettingsBlocked = unauthSettings.status === 401 && unauthSettings.body.error.code === "auth_required";
    observations.unauthSettings = { status: unauthSettings.status, code: unauthSettings.body.error.code };

    const evilOptions = await request(port, "OPTIONS", "/settings", null, { Origin: evilOrigin });
    const evilSettings = await request(port, "GET", "/settings", null, { Origin: evilOrigin, Authorization: "Bearer not-real" });
    checks.evilOriginBlocked = evilOptions.status === 403 && evilSettings.status === 403;
    observations.evilOrigin = {
      optionsStatus: evilOptions.status,
      settingsStatus: evilSettings.status,
      allowOrigin: evilSettings.headers["access-control-allow-origin"] || ""
    };

    const bootstrap = await request(port, "GET", "/auth/bootstrap", null, { Origin: trustedOrigin });
    const token = bootstrap.body?.auth?.token || "";
    checks.trustedBootstrap = bootstrap.status === 200 && /^[a-f0-9]{64}$/.test(token);
    observations.bootstrap = {
      status: bootstrap.status,
      allowOrigin: bootstrap.headers["access-control-allow-origin"] || "",
      auth: token ? { length: token.length, sha256: hashValue(token) } : null
    };

    const bearerSettings = await request(port, "GET", "/settings", null, {
      Origin: trustedOrigin,
      Authorization: `Bearer ${token}`
    });
    checks.protectedBearerAccepted = bearerSettings.status === 200 && bearerSettings.body.ok === true;

    const tokenHeaderSettings = await request(port, "GET", "/settings", null, {
      Origin: trustedOrigin,
      "X-Smart-Prompt-Token": token
    });
    checks.protectedTokenHeaderAccepted = tokenHeaderSettings.status === 200 && tokenHeaderSettings.body.ok === true;
    checks.corsNoWildcard = [
      health,
      unauthSettings,
      evilOptions,
      evilSettings,
      bootstrap,
      bearerSettings,
      tokenHeaderSettings
    ].every(hasNoWildcardCors);

    const redactionFixture = redactEvidence({
      apiKey: "sk-v3-security-test-key",
      authToken: token,
      url: "https://chatgpt.com/c/private?secret=1",
      title: "Private chat title",
      prompt: "Do not keep this generated prompt in evidence.",
      profileDir: "C:\\Users\\lhy10\\Documents\\Smart Prompt\\.runtime\\profile"
    });
    const leaks = collectRedactionLeaks(redactionFixture);
    checks.redactionNoLeaks = leaks.length === 0;
    observations.redaction = { leaks };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const report = redactEvidence({
    createdAt: new Date().toISOString(),
    pass: Object.values(checks).every(Boolean),
    trustedOrigin,
    evilOrigin,
    checks,
    observations
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  assert.equal(report.pass, true, `V3 security privacy check failed: ${JSON.stringify(checks)}`);
})();
