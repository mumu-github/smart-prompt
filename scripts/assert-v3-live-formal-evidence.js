const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { collectRedactionLeaks } = require("../packages/shared/evidence-redaction");

const reportPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "../research/v3-live-site-formal.latest.json");

const requiredDisplayIds = ["chatgpt", "claude", "gemini", "perplexity", "lovable", "bolt", "v0", "replit"];
const requiredInsertIds = ["chatgpt", "claude", "gemini"];
const failures = [];

function addFailure(message) {
  failures.push(message);
}

function requireValue(condition, message) {
  if (!condition) addFailure(message);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesAll(values, required) {
  const set = new Set(asArray(values));
  return required.every((item) => set.has(item));
}

function readReport() {
  if (!fs.existsSync(reportPath)) {
    addFailure(`Missing report: ${reportPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    addFailure(`Invalid JSON: ${error.message}`);
    return null;
  }
}

const report = readReport();

if (report) {
  const leakPaths = collectRedactionLeaks(report).map((leak) => `${leak.path} ${leak.pattern}`);
  requireValue(leakPaths.length === 0, `Redaction leaks found: ${leakPaths.join("; ")}`);
  requireValue(asArray(report.summary?.redactionLeaks).length === 0, "Report summary contains redaction leaks.");

  requireValue(report.schemaVersion === "v3-live-site-formal@1", "schemaVersion must be v3-live-site-formal@1.");
  requireValue(report.mode === "LIVE_SITE_FORMAL_PASS", "mode must be LIVE_SITE_FORMAL_PASS.");
  requireValue(report.injectFallback === false, "injectFallback must be false.");
  requireValue(report.formalExtensionOnly === true, "formalExtensionOnly must be true.");
  requireValue(report.extensionLoad?.ok === true, "extensionLoad.ok must be true.");
  requireValue(report.extensionLoad?.matchedExtension?.enabled === true, "matched extension must be enabled.");
  requireValue(report.pass === true, "report.pass must be true.");

  requireValue(includesAll(report.requirements?.displaySiteIds, requiredDisplayIds), "requirements.displaySiteIds must include all 8 V3 sites.");
  requireValue(includesAll(report.requirements?.insertSiteIds, requiredInsertIds), "requirements.insertSiteIds must include ChatGPT, Claude, and Gemini.");
  requireValue(includesAll(report.requirements?.noAutoSendSiteIds, requiredInsertIds), "requirements.noAutoSendSiteIds must include ChatGPT, Claude, and Gemini.");
  requireValue(report.requirements?.requireFormalExtension === true, "requirements.requireFormalExtension must be true.");
  requireValue(report.requirements?.requireInjectedProbeFalse === true, "requirements.requireInjectedProbeFalse must be true.");
  requireValue(report.requirements?.insertMustNotSubmit === true, "requirements.insertMustNotSubmit must be true.");
  requireValue(report.requirements?.redactionRequired === true, "requirements.redactionRequired must be true.");

  requireValue(includesAll(report.summary?.displayPasses, requiredDisplayIds), "summary.displayPasses must include all 8 V3 sites.");
  requireValue(includesAll(report.summary?.insertPasses, requiredInsertIds), "summary.insertPasses must include ChatGPT, Claude, and Gemini.");
  requireValue(includesAll(report.summary?.noAutoSendPasses, requiredInsertIds), "summary.noAutoSendPasses must include ChatGPT, Claude, and Gemini.");
  requireValue(asArray(report.summary?.displayMissing).length === 0, "summary.displayMissing must be empty.");
  requireValue(asArray(report.summary?.insertMissing).length === 0, "summary.insertMissing must be empty.");
  requireValue(asArray(report.summary?.noAutoSendMissing).length === 0, "summary.noAutoSendMissing must be empty.");
  requireValue(asArray(report.summary?.injectedProbeFailures).length === 0, "summary.injectedProbeFailures must be empty.");
  requireValue(report.summary?.anyInjectedProbe === false, "summary.anyInjectedProbe must be false.");

  const siteMap = new Map(asArray(report.sites).map((site) => [site.id, site]));
  for (const id of requiredDisplayIds) {
    const site = siteMap.get(id);
    requireValue(Boolean(site), `Missing site entry: ${id}`);
    if (!site) continue;
    requireValue(site.required?.display === true || site.requiredDisplay === true, `${id}: display must be required.`);
    requireValue(site.formalExtensionLoaded === true, `${id}: formalExtensionLoaded must be true.`);
    requireValue(site.injectedProbe === false, `${id}: injectedProbe must be false.`);
    requireValue(site.focus?.ok === true, `${id}: focus.ok must be true.`);
    requireValue(site.focus?.visibleInputCount >= 1, `${id}: visible input count must be at least 1.`);
    requireValue(site.display?.passed === true, `${id}: display.passed must be true.`);
    requireValue(site.display?.mascot === true, `${id}: mascot must exist.`);
    requireValue(site.display?.visible === true, `${id}: mascot must be visible.`);
    requireValue(site.display?.rect?.width > 20 && site.display?.rect?.height > 20, `${id}: mascot rect must be measurable.`);
  }

  for (const id of requiredInsertIds) {
    const site = siteMap.get(id);
    if (!site) continue;
    requireValue(site.required?.insert === true || site.requiredInsert === true, `${id}: insert must be required.`);
    requireValue(site.insert?.passed === true, `${id}: insert.passed must be true.`);
    requireValue(site.insert?.opened === true, `${id}: insert.opened must be true.`);
    requireValue(site.insert?.cardOpened === true, `${id}: insert.cardOpened must be true.`);
    requireValue(site.insert?.outputLength > 80, `${id}: insert outputLength must be greater than 80.`);
    requireValue(site.insert?.afterValueLength >= site.insert?.outputLength, `${id}: afterValueLength must cover the output.`);
    requireValue(site.insert?.cardClosed === true, `${id}: card must close after verified insert.`);
    requireValue(site.insert?.afterWriteVerified === true, `${id}: afterWriteVerified must be true.`);
    requireValue(
      site.insert?.outputPrefixContained === true || ["content-debug", "dom-evidence"].includes(site.insert?.verifiedBy),
      `${id}: insert must expose a verification basis.`
    );
    requireValue(site.insert?.filledOnly === true, `${id}: filledOnly must be true.`);
    requireValue(site.insert?.submitted === false, `${id}: insert must not submit.`);

    requireValue(site.noAutoSend?.passed === true, `${id}: noAutoSend.passed must be true.`);
    requireValue(site.noAutoSend?.waitMs >= 1000, `${id}: noAutoSend wait window must be at least 1000ms.`);
    requireValue(site.noAutoSend?.inputRetained === true, `${id}: input must remain after wait.`);
    requireValue(["external-prefix", "dom-evidence-length"].includes(site.noAutoSend?.retainedBy), `${id}: noAutoSend must expose a retention basis.`);
    requireValue(site.noAutoSend?.navigationChanged === false, `${id}: navigation must not change.`);
    requireValue(site.noAutoSend?.messageCountChanged === false, `${id}: message count must not change.`);
    requireValue(site.noAutoSend?.assistantGenerationStarted === false, `${id}: assistant generation must not start.`);
    requireValue(site.noAutoSend?.nativeSubmitEventCount === 0, `${id}: native submit event count must be 0.`);
    requireValue(site.noAutoSend?.requestSubmitCallCount === 0, `${id}: requestSubmit call count must be 0.`);
    requireValue(site.noAutoSend?.formSubmitCallCount === 0, `${id}: form submit call count must be 0.`);
    requireValue(site.noAutoSend?.submitted === false, `${id}: noAutoSend submitted must be false.`);
  }
}

if (failures.length > 0) {
  console.error(`V3 live-site formal evidence failed:\n - ${failures.join("\n - ")}`);
  process.exit(1);
}

assert.ok(report);
console.log("PASS: V3 live-site formal evidence passed.");
