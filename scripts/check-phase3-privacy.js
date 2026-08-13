const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { normalizeLearningCandidateSeed } = require("../packages/outcome-learning");

const root = path.resolve(__dirname, "..");
const dataDir = process.env.SMART_PROMPT_PHASE3_ACCEPTANCE_DATA_DIR;
const servicePort = Number(process.env.SMART_PROMPT_PORT || 17371);
const reportPath = process.env.SMART_PROMPT_PHASE3_PRIVACY_REPORT
  || path.join(root, "research", "phase3-privacy.latest.json");

assert.ok(dataDir, "SMART_PROMPT_PHASE3_ACCEPTANCE_DATA_DIR is required");
assert.ok(fs.existsSync(dataDir), "Phase 3 acceptance data directory is unavailable");

const allowedActivationKeys = new Set([
  "browserSeenAt",
  "completedAt",
  "completionKind",
  "completionVerified",
  "lastErrorCode",
  "lastEventId",
  "migrationAppliedAt",
  "migrationSource",
  "modelTestedAt",
  "progress",
  "provider",
  "runtimeHealth",
  "schemaVersion",
  "updatedAt"
]);
const allowedMetricKeys = new Set([
  "action",
  "adapterId",
  "adopted",
  "created_at",
  "failureReason",
  "generatedBy",
  "id",
  "insertStrategy",
  "kind",
  "mode",
  "ok",
  "promptLength",
  "site",
  "source",
  "tool",
  "verified"
]);
const allowedHistoryKeys = new Set([
  "created_at",
  "editFeatureSummary",
  "generatedBy",
  "generationId",
  "id",
  "learningCandidateSeed",
  "mode",
  "modelFamilyToken",
  "policyId",
  "policyVersion",
  "projectScopeToken",
  "sessionId",
  "strategyId",
  "strategyVersion",
  "taskScenarioToken",
  "tool",
  "verifiedInsertEvidence"
]);
const allowedLogDetailKeys = new Set([
  "errorCode",
  "port",
  "portRecovery",
  "requestedPort"
]);
const forbiddenArtifactKeys = new Set([
  "apiKey",
  "clipboard",
  "clipboardText",
  "dataDir",
  "dom",
  "draft",
  "draftText",
  "input",
  "inputText",
  "pageBody",
  "prompt",
  "promptText",
  "providerKeys",
  "rawDom",
  "rawTitle",
  "rawUia",
  "targetInput",
  "targetInputText",
  "uiaText"
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hasOnlyKeys(value, allowed) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
    && Object.keys(value).every((key) => allowed.has(key));
}

function inspectArtifact(value, findings = { forbiddenKeys: 0, absolutePaths: 0 }) {
  if (Array.isArray(value)) {
    value.forEach((item) => inspectArtifact(item, findings));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenArtifactKeys.has(key)) findings.forbiddenKeys += 1;
      inspectArtifact(child, findings);
    }
    return findings;
  }
  if (typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value)) findings.absolutePaths += 1;
  return findings;
}

function isSafePromptHistoryEntry(entry) {
  if (!hasOnlyKeys(entry, allowedHistoryKeys)) return false;
  if (!Object.hasOwn(entry, "learningCandidateSeed")) return true;
  return entry.learningCandidateSeed === null
    || Boolean(normalizeLearningCandidateSeed(entry.learningCandidateSeed));
}

function isSafeLogEntry(entry) {
  if (!hasOnlyKeys(entry, new Set(["createdAt", "detail", "event"]))) return false;
  if (entry.detail && !hasOnlyKeys(entry.detail, allowedLogDetailKeys)) return false;
  const errorCode = entry.detail?.errorCode;
  return errorCode === undefined
    || (typeof errorCode === "string" && /^[a-z0-9_]{1,80}$/.test(errorCode));
}

function request(method, route, token = "") {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: servicePort,
      path: route,
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({
            status: response.statusCode,
            body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const activation = readJson(path.join(dataDir, "activation.json"));
  const settings = readJson(path.join(dataDir, "settings.json"));
  const vault = readJson(path.join(dataDir, "provider-keys-sidecar.json"));
  const metrics = readJson(path.join(dataDir, "metrics.json"));
  const history = readJson(path.join(dataDir, "prompt-history.json"));
  const logDir = path.join(dataDir, "logs");
  const logFiles = fs.existsSync(logDir)
    ? fs.readdirSync(logDir).filter((name) => name.endsWith(".log"))
    : [];
  const logEntries = logFiles.flatMap((name) => fs.readFileSync(path.join(logDir, name), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line)));

  const providerKeyValues = Object.values(settings.providerKeys || {});
  const encryptedValues = Object.values(vault.keys || {}).filter(Boolean).map(String);
  const localChecks = {
    activationMetadataOnly: hasOnlyKeys(activation, allowedActivationKeys),
    activationModelNotStored: !Object.hasOwn(activation, "model"),
    settingsSecretsEmpty: settings.apiKey === "" && providerKeyValues.every((value) => value === ""),
    noAutoSubmit: settings.autoSubmit === false,
    wholePageUploadDisabled: settings.uploadWholePage === false,
    providerKeysEncrypted: vault.storage === "windows-dpapi-current-user"
      && vault.schemaVersion === "provider-keys-dpapi@1"
      && encryptedValues.length >= 1
      && encryptedValues.every((value) => value.length >= 80 && /^[A-Za-z0-9+/=]+$/.test(value)),
    metricSchemaMetadataOnly: Array.isArray(metrics)
      && metrics.every((event) => hasOnlyKeys(event, allowedMetricKeys)),
    historySchemaMetadataOnly: Array.isArray(history)
      && history.every(isSafePromptHistoryEntry)
      && inspectArtifact(history).forbiddenKeys === 0
      && inspectArtifact(history).absolutePaths === 0,
    logsMetadataOnly: logEntries.every(isSafeLogEntry)
      && inspectArtifact(logEntries).forbiddenKeys === 0
      && inspectArtifact(logEntries).absolutePaths === 0
  };

  const bootstrap = await request("GET", "/auth/bootstrap");
  const token = bootstrap.body?.auth?.token || "";
  const settingsResponse = await request("GET", "/settings", token);
  const diagnosticsResponse = await request("GET", "/diagnostics/export", token);
  const apiSettings = settingsResponse.body?.settings || {};
  const apiDiagnostics = diagnosticsResponse.body?.diagnostics || {};
  const diagnosticsFindings = inspectArtifact(apiDiagnostics);
  const apiChecks = {
    bootstrapSucceeded: bootstrap.status === 200 && token.length >= 32,
    settingsOpaque: settingsResponse.status === 200
      && apiSettings.apiKey === ""
      && Object.values(apiSettings.providerKeys || {}).every((value) => value === "" || value === "configured"),
    diagnosticsPathRedacted: diagnosticsResponse.status === 200
      && !Object.hasOwn(apiDiagnostics, "dataDir")
      && apiDiagnostics.dataDirConfigured === true,
    diagnosticsMetadataOnly: diagnosticsFindings.forbiddenKeys === 0
      && diagnosticsFindings.absolutePaths === 0
  };

  const researchFiles = fs.readdirSync(path.join(root, "research"))
    .filter((name) => /^phase3-.*\.json$/i.test(name) && name !== path.basename(reportPath));
  const researchFindings = researchFiles.reduce((summary, name) => {
    const findings = inspectArtifact(readJson(path.join(root, "research", name)));
    summary.forbiddenKeys += findings.forbiddenKeys;
    summary.absolutePaths += findings.absolutePaths;
    return summary;
  }, { forbiddenKeys: 0, absolutePaths: 0 });
  const researchChecks = {
    metadataOnly: researchFindings.forbiddenKeys === 0,
    noAbsolutePaths: researchFindings.absolutePaths === 0
  };

  const checks = { local: localChecks, api: apiChecks, research: researchChecks };
  const pass = Object.values(checks).every((group) => Object.values(group).every(Boolean));
  const report = {
    schemaVersion: "phase3-privacy-scan@1",
    createdAt: new Date().toISOString(),
    pass,
    counts: {
      metricEvents: metrics.length,
      promptHistoryEntries: history.length,
      encryptedProviderKeys: encryptedValues.length,
      logEntries: logEntries.length,
      researchArtifacts: researchFiles.length,
      forbiddenArtifactKeys: researchFindings.forbiddenKeys,
      absoluteArtifactPaths: researchFindings.absolutePaths
    },
    checks
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  assert.equal(pass, true, "Phase 3 privacy scan failed");
})();
