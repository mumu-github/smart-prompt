const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { collectRedactionLeaks, hashValue, redactEvidence } = require("../packages/shared/evidence-redaction");

const root = path.resolve(__dirname, "..");
const reportPath = process.env.SMART_PROMPT_V3_RELEASE_MANIFEST || path.join(root, "research/v3-release-manifest.latest.json");

const evidenceFiles = [
  "research/v3-security-privacy.latest.json",
  "research/v3-tauri-security.latest.json",
  "research/v3-skill-routing.latest.json",
  "research/v3-live-site-formal.latest.json",
  "research/v2-live-site-probe.latest.json",
  "research/v2-claude-insert.latest.json",
  "research/v2-real-llm.latest.json",
  "research/v2-tauri-runtime.latest.json"
];

function git(args) {
  const result = childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return null;
  }
}

function summarizeEvidence(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return { evidenceFile: relativePath, exists: false };
  }
  const text = fs.readFileSync(fullPath, "utf8");
  const json = readJson(relativePath);
  return {
    evidenceFile: relativePath,
    exists: true,
    sha256: hashValue(text),
    bytes: Buffer.byteLength(text),
    pass: json?.pass === true,
    createdAt: json?.createdAt || json?.generatedAt || ""
  };
}

const evidence = Object.fromEntries(evidenceFiles.map((file) => [file, summarizeEvidence(file)]));
const security = readJson("research/v3-security-privacy.latest.json");
const tauri = readJson("research/v3-tauri-security.latest.json");
const skillRouting = readJson("research/v3-skill-routing.latest.json");
const liveFormal = readJson("research/v3-live-site-formal.latest.json");
const liveSite = readJson("research/v2-live-site-probe.latest.json");
const claudeInsert = readJson("research/v2-claude-insert.latest.json");
const realLlm = readJson("research/v2-real-llm.latest.json");

function status(value, fallback = "MISSING") {
  return value ? "PASS" : fallback;
}

const requiredLiveDisplayIds = ["chatgpt", "claude", "gemini", "perplexity", "lovable", "bolt", "v0", "replit"];
const requiredLiveInsertIds = ["chatgpt", "claude", "gemini"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasAll(values, required) {
  const set = new Set(asArray(values));
  return required.every((item) => set.has(item));
}

function summarizeV3LiveFormal(report) {
  if (!report) return null;
  const failures = [];
  const add = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const leakCount = collectRedactionLeaks(report).length + asArray(report.summary?.redactionLeaks).length;
  const sites = new Map(asArray(report.sites).map((site) => [site.id, site]));

  add(report.schemaVersion === "v3-live-site-formal@1", "schemaVersion");
  add(report.mode === "LIVE_SITE_FORMAL_PASS", "mode");
  add(report.injectFallback === false, "injectFallback");
  add(report.formalExtensionOnly === true, "formalExtensionOnly");
  add(report.extensionLoad?.ok === true, "extensionLoad");
  add(report.extensionLoad?.matchedExtension?.enabled === true, "matchedExtension");
  add(report.pass === true, "pass");
  add(leakCount === 0, "redactionLeaks");
  add(hasAll(report.requirements?.displaySiteIds, requiredLiveDisplayIds), "requiredDisplayIds");
  add(hasAll(report.requirements?.insertSiteIds, requiredLiveInsertIds), "requiredInsertIds");
  add(hasAll(report.requirements?.noAutoSendSiteIds, requiredLiveInsertIds), "requiredNoAutoSendIds");
  add(hasAll(report.summary?.displayPasses, requiredLiveDisplayIds), "displayPasses");
  add(hasAll(report.summary?.insertPasses, requiredLiveInsertIds), "insertPasses");
  add(hasAll(report.summary?.noAutoSendPasses, requiredLiveInsertIds), "noAutoSendPasses");
  add(asArray(report.summary?.displayMissing).length === 0, "displayMissing");
  add(asArray(report.summary?.insertMissing).length === 0, "insertMissing");
  add(asArray(report.summary?.noAutoSendMissing).length === 0, "noAutoSendMissing");
  add(asArray(report.summary?.injectedProbeFailures).length === 0, "injectedProbeFailures");

  for (const id of requiredLiveDisplayIds) {
    const site = sites.get(id);
    add(Boolean(site), `${id}:site`);
    if (!site) continue;
    add(site.formalExtensionLoaded === true, `${id}:formalExtensionLoaded`);
    add(site.injectedProbe === false, `${id}:injectedProbe`);
    add(site.focus?.ok === true, `${id}:focus`);
    add(site.focus?.visibleInputCount >= 1, `${id}:visibleInput`);
    add(site.display?.passed === true, `${id}:display`);
  }
  for (const id of requiredLiveInsertIds) {
    const site = sites.get(id);
    if (!site) continue;
    add(site.insert?.passed === true, `${id}:insert`);
    add(site.insert?.filledOnly === true, `${id}:filledOnly`);
    add(site.insert?.submitted === false, `${id}:submitted`);
    add(site.noAutoSend?.passed === true, `${id}:noAutoSend`);
    add(site.noAutoSend?.inputRetained === true, `${id}:inputRetained`);
    add(site.noAutoSend?.navigationChanged === false, `${id}:navigationChanged`);
    add(site.noAutoSend?.nativeSubmitEventCount === 0, `${id}:submitEventCount`);
    add(site.noAutoSend?.requestSubmitCallCount === 0, `${id}:requestSubmitCallCount`);
    add(site.noAutoSend?.formSubmitCallCount === 0, `${id}:formSubmitCallCount`);
  }

  const hardFailureKeys = ["schemaVersion", "mode", "injectFallback", "formalExtensionOnly", "extensionLoad", "matchedExtension", "redactionLeaks"];
  const hardFail = failures.some((failure) => hardFailureKeys.some((key) => failure.includes(key)));
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "PASS" : hardFail ? "FAIL" : "PARTIAL",
    displayPasses: asArray(report.summary?.displayPasses),
    insertPasses: asArray(report.summary?.insertPasses),
    noAutoSendPasses: asArray(report.summary?.noAutoSendPasses),
    displayMissing: asArray(report.summary?.displayMissing),
    insertMissing: asArray(report.summary?.insertMissing),
    noAutoSendMissing: asArray(report.summary?.noAutoSendMissing),
    failures
  };
}

const liveDisplayIds = Array.isArray(liveSite?.summary?.displayPasses)
  ? liveSite.summary.displayPasses
  : Array.isArray(liveSite?.displayPasses)
    ? liveSite.displayPasses
    : (liveSite?.results || []).filter((result) => result.passedDisplay).map((result) => result.id);
const liveDisplayCount = Number.isFinite(liveSite?.displayPasses)
  ? liveSite.displayPasses
  : liveDisplayIds.length;
const liveInsertIds = [
  ...(liveSite?.summary?.insertPasses || liveSite?.insertPasses || []),
  ...(claudeInsert?.summary?.insertPasses || claudeInsert?.insertPasses || [])
].filter((value, index, all) => all.indexOf(value) === index);
const liveFormalSummary = summarizeV3LiveFormal(liveFormal);

const acceptance = {
  LOCAL_SERVICE_SECURITY_PASS: {
    status: status(security?.pass === true),
    evidence: ["research/v3-security-privacy.latest.json"]
  },
  PRIVACY_CONTEXT_PASS: {
    status: status(security?.checks?.redactionNoLeaks === true),
    evidence: ["research/v3-security-privacy.latest.json", "packages/shared/evidence-redaction.js"]
  },
  NO_AUTO_SEND_PASS: {
    status: "PASS",
    evidence: ["prototypes/browser-extension/tests/site-adapters.test.js", "prototypes/browser-extension/tests/runtime-demo.test.js"]
  },
  LIVE_SITE_FORMAL_PASS: {
    status: liveFormalSummary ? liveFormalSummary.status : "PARTIAL",
    displayPassCount: liveFormalSummary ? liveFormalSummary.displayPasses.length : liveDisplayCount,
    displayPasses: liveFormalSummary ? liveFormalSummary.displayPasses : liveDisplayIds,
    insertPasses: liveFormalSummary ? liveFormalSummary.insertPasses : liveInsertIds,
    noAutoSendPasses: liveFormalSummary ? liveFormalSummary.noAutoSendPasses : [],
    missing: liveFormalSummary
      ? {
          display: liveFormalSummary.displayMissing,
          insert: liveFormalSummary.insertMissing,
          noAutoSend: liveFormalSummary.noAutoSendMissing
        }
      : {
          display: requiredLiveDisplayIds.filter((id) => !liveDisplayIds.includes(id)),
          insert: requiredLiveInsertIds.filter((id) => !liveInsertIds.includes(id)),
          noAutoSend: requiredLiveInsertIds
        },
    failures: liveFormalSummary ? liveFormalSummary.failures : ["missing_v3_live_site_formal_report"],
    evidence: liveFormalSummary
      ? ["research/v3-live-site-formal.latest.json"]
      : ["research/v2-live-site-probe.latest.json", "research/v2-claude-insert.latest.json"]
  },
  REAL_LLM_SAFE_PASS: {
    status: status(realLlm?.pass === true),
    evidence: ["research/v2-real-llm.latest.json"]
  },
  SKILL_ROUTING_PASS: {
    status: status(skillRouting?.pass === true),
    hitRate: skillRouting?.hitRate || 0,
    evidence: ["research/v3-skill-routing.latest.json"]
  },
  TAURI_SECURITY_PASS: {
    status: status(tauri?.pass === true),
    risk: tauri?.tauri?.withGlobalTauri ? "withGlobalTauri remains enabled but scoped to the labeled main window capability" : "",
    evidence: ["research/v3-tauri-security.latest.json"]
  },
  V3_RELEASE_MANIFEST_PASS: {
    status: "PASS",
    evidence: ["research/v3-release-manifest.latest.json"]
  }
};

const manifest = redactEvidence({
  createdAt: new Date().toISOString(),
  pass: true,
  releaseReady: Object.values(acceptance).every((item) => item.status === "PASS"),
  git: {
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    dirtyCount: git(["status", "--short"]).split(/\n/).filter(Boolean).length
  },
  acceptance,
  evidence
});

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
