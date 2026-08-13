const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPilotOutcomeReadinessReport,
  formatPilotOutcomeReadinessReport
} = require("../packages/shared/prompt-quality");

const root = path.resolve(__dirname, "..");
const reportPath = process.env.SMART_PROMPT_V6_PILOT_OUTCOME_REPORT
  || path.join(root, "research", "v6-pilot-outcome-readiness.latest.json");

function metric(overrides) {
  return {
    action: "outcome",
    mode: "continue",
    tool: "ChatGPT",
    site: "https://chatgpt.com/private/path?needle=SECRET_INPUT_TEXT",
    taskScenario: "security-review",
    strategyId: "llm:continue:medium:security-winner",
    experimentArm: "strategy_guided",
    outcomeLabel: "success",
    outcomeScore: 0.9,
    outcomeVerified: true,
    outcomeSource: "manual_card",
    prompt: "SECRET_PROMPT_TEXT",
    input: "SECRET_INPUT_TEXT",
    pageBody: "SECRET_PAGE_BODY",
    ...overrides
  };
}

const metrics = {
  schemaVersion: 1,
  events: [
    metric({ outcomeScore: 0.95 }),
    metric({ outcomeScore: 0.88 }),
    metric({ outcomeScore: 0.91 }),
    metric({
      tool: "Lovable",
      site: "https://lovable.dev/project/private/SECRET_PAGE_BODY",
      taskScenario: "ui-ux",
      strategyId: "llm:continue:medium:ui-risk",
      experimentArm: "strategy_guided",
      outcomeLabel: "needs-work",
      outcomeScore: 0.25,
      outcomeVerified: true,
      ok: false
    }),
    metric({
      tool: "Lovable",
      site: "https://lovable.dev/project/private/SECRET_PAGE_BODY",
      taskScenario: "ui-ux",
      strategyId: "llm:continue:medium:ui-risk",
      experimentArm: "strategy_guided",
      outcomeLabel: "failed",
      outcomeScore: 0.05,
      outcomeVerified: true,
      ok: false
    }),
    metric({
      tool: "Lovable",
      site: "https://lovable.dev/project/private/SECRET_PAGE_BODY",
      taskScenario: "ui-ux",
      strategyId: "llm:continue:medium:ui-risk",
      experimentArm: "strategy_guided",
      outcomeLabel: "failed",
      outcomeScore: 0.1,
      outcomeVerified: true,
      ok: false
    }),
    metric({
      tool: "Gemini",
      site: "https://gemini.google.com/app/SECRET_INPUT_TEXT",
      taskScenario: "data-analysis",
      strategyId: "llm:continue:medium:data-collecting",
      experimentArm: "baseline_structure",
      outcomeLabel: "success",
      outcomeScore: 0.78
    })
  ]
};

const report = buildPilotOutcomeReadinessReport(metrics);
const text = formatPilotOutcomeReadinessReport(report);
const serialized = JSON.stringify({ report, text });

assert.equal(report.schemaVersion, "v6-prompt-quality@1");
assert.equal(report.reportVersion, "v6-pilot-outcome-readiness@1");
assert.equal(report.readiness.status, "ready");
assert.equal(report.readiness.totalOutcomeEvents, 7);
assert.ok(report.byTaskScenario.some((item) => item.key === "security-review" && item.status === "ready" && item.outcomeSuccessRate === 1));
assert.ok(report.byTaskScenario.some((item) => item.key === "ui-ux" && item.status === "ready" && item.outcomeSuccessRate === 0));
assert.ok(report.byTaskScenario.some((item) => item.key === "data-analysis" && item.status === "collecting" && item.neededOutcomeEvents === 2));
assert.ok(report.byTaskScenario.some((item) => item.key === "general" && item.status === "empty"));
assert.ok(report.byTool.some((item) => item.key === "chatgpt" && item.outcomeCount === 3));
assert.ok(report.bySite.some((item) => item.key === "chatgpt.com" && item.outcomeCount === 3));
assert.ok(report.byMode.some((item) => item.key === "continue" && item.outcomeCount === 7));
assert.ok(report.byExperimentArm.some((item) => item.key === "strategy_guided" && item.outcomeCount === 6));
assert.ok(report.winningStrategies.some((item) => item.key === "llm:continue:medium:security-winner"));
assert.ok(report.riskStrategies.some((item) => item.key === "llm:continue:medium:ui-risk"));
assert.ok(report.collectionTargets.some((item) => item.dimension === "taskScenario" && item.key === "data-analysis"));
assert.ok(report.collectionTargets.some((item) => item.dimension === "taskScenario" && item.key === "general"));
assert.equal(report.privacy.aggregateOnly, true);
assert.ok(/pilotOutcome=v6-pilot-outcome-readiness@1/.test(text));
assert.ok(/privacy=aggregate-only/.test(text));

for (const needle of ["SECRET_PROMPT_TEXT", "SECRET_INPUT_TEXT", "SECRET_PAGE_BODY", "private/path", "project/private"]) {
  assert.ok(!serialized.includes(needle), `pilot outcome report leaked ${needle}`);
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  pass: true,
  report,
  text
}, null, 2));

console.log(`V6_PILOT_OUTCOME_READINESS_PASS ${reportPath}`);
