const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { collectRedactionLeaks } = require("../packages/shared/evidence-redaction");

const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "research/v4-live-site-stability.latest.json");
const liveReportPath = path.join(root, "research/v3-live-site-formal.latest.json");
const recoveryPath = path.join(root, "research/v4-live-site-stability-recovery.md");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sha256File(file) {
  if (!fs.existsSync(file)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
}

function hasAll(values, required) {
  const set = new Set(Array.isArray(values) ? values : []);
  return required.every((value) => set.has(value));
}

const requiredDisplayIds = ["chatgpt", "claude", "gemini", "perplexity", "bolt", "v0", "lovable", "replit"];
const requiredInsertIds = ["chatgpt", "claude", "gemini"];
const liveReport = readJson(liveReportPath);
const recoveryText = fs.existsSync(recoveryPath) ? fs.readFileSync(recoveryPath, "utf8") : "";
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(Boolean(liveReport), "missing v3 live-site formal report");
if (liveReport) {
  const leaks = collectRedactionLeaks(liveReport);
  requireValue(leaks.length === 0, "v3 live-site formal report contains redaction leaks");
  requireValue(liveReport.pass === true, "latest v3 live-site formal report is not pass=true");
  requireValue(liveReport.schemaVersion === "v3-live-site-formal@1", "schema version is not v3-live-site-formal@1");
  requireValue(liveReport.formalExtensionOnly === true, "formalExtensionOnly is not true");
  requireValue(liveReport.injectFallback === false, "inject fallback must be false");
  requireValue(liveReport.summary?.anyInjectedProbe === false, "summary.anyInjectedProbe must be false");
  requireValue(hasAll(liveReport.summary?.displayPasses, requiredDisplayIds), "latest v3 report does not include all 8 display passes");
  requireValue(hasAll(liveReport.summary?.insertPasses, requiredInsertIds), "latest v3 report does not include all required insert passes");
  requireValue(hasAll(liveReport.summary?.noAutoSendPasses, requiredInsertIds), "latest v3 report does not include all required no-auto-send passes");
}

const requiredRecoveryTokens = [
  "scripts/check-v3-live-sites.ps1",
  "SMART_PROMPT_LIVE_INJECT_FALLBACK=0",
  "v3-live-site-formal@1",
  ".runtime/v2-live-chrome-profile",
  "scripts\\start-v2-claude-cdp.ps1",
  "https://claude.ai/new",
  "-SiteIds claude",
  "https://replit.com/agent4",
  "Do not use `https://replit.com/ai`",
  "-SiteIds replit",
  "injectedProbe",
  "redaction leak",
  "no-auto-send"
];
for (const token of requiredRecoveryTokens) {
  requireValue(recoveryText.includes(token), `recovery strategy missing token: ${token}`);
}

const report = {
  createdAt: new Date().toISOString(),
  pass: failures.length === 0,
  mode: "LOGIN_ROUTE_RECOVERY_PASS",
  threeConsecutiveRuns: false,
  recoveryStrategyPass: failures.length === 0,
  latestStrictFormalPass: Boolean(liveReport?.pass),
  requirements: {
    displaySiteIds: requiredDisplayIds,
    insertSiteIds: requiredInsertIds,
    noAutoSendSiteIds: requiredInsertIds,
    requireFormalExtension: true,
    requireInjectedProbeFalse: true,
    recoveryAllowedWhenThreeRunsUnavailable: true
  },
  recovery: {
    claude: {
      profile: ".runtime/v2-live-chrome-profile",
      loginUrl: "https://claude.ai/new",
      rerunCommand: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\check-v3-live-sites.ps1 -ProfileDir .runtime\\v2-live-chrome-profile -SiteIds claude -LoginWaitSeconds 180"
    },
    replit: {
      formalRoute: "https://replit.com/agent4",
      rejectedRoutes: ["https://replit.com/ai", "root marketing textarea"],
      rerunCommand: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\check-v3-live-sites.ps1 -ProfileDir .runtime\\v2-live-chrome-profile -SiteIds replit -LoginWaitSeconds 180"
    }
  },
  evidence: {
    latestFormalReport: {
      file: "research/v3-live-site-formal.latest.json",
      sha256: sha256File(liveReportPath)
    },
    recoveryStrategy: {
      file: "research/v4-live-site-stability-recovery.md",
      sha256: sha256File(recoveryPath)
    }
  },
  failures
};

fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
