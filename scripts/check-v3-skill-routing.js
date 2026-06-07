const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { hashValue, redactEvidence } = require("../packages/shared/evidence-redaction");
const { rankSkills } = require("../packages/shared/smart-prompt-core");

const root = path.resolve(__dirname, "..");
const reportPath = process.env.SMART_PROMPT_V3_SKILL_ROUTING_REPORT || path.join(root, "research/v3-skill-routing.latest.json");
const targetHitRate = 0.7;

const fixtures = [
  ["ui ux dashboard empty states layout", "skill-ui-ux"],
  ["review auth code for bugs regressions", "skill-code-review"],
  ["write acceptance criteria and edge cases", "skill-test-plan"],
  ["privacy api key permission injection risks", "skill-security-review"],
  ["frontend interaction visual hierarchy responsive UI", "skill-ui-ux"],
  ["find race condition and missing tests in refactor", "skill-code-review"],
  ["qa plan boundary conditions verification commands", "skill-test-plan"],
  ["local service auth token CORS origin threat", "skill-security-review"],
  ["card layout button states accessibility UX", "skill-ui-ux"],
  ["bug risk behavioral regression code review", "skill-code-review"],
  ["test matrix smoke regression expected results", "skill-test-plan"],
  ["secret storage encryption provider key privacy", "skill-security-review"],
  ["ui ux onboarding flow screens visual states", "skill-ui-ux"],
  ["inspect pull request for security bug", "skill-code-review"],
  ["define pass fail rubric fixtures coverage", "skill-test-plan"],
  ["permissions data leak prompt injection safety", "skill-security-review"],
  ["prototype prompt card feedback UX copy", "skill-ui-ux"],
  ["review javascript module error handling", "skill-code-review"],
  ["create verification checklist commands evidence", "skill-test-plan"],
  ["CORS wildcard local API abuse privacy", "skill-security-review"]
];

const results = fixtures.map(([input, expectedSkillId], index) => {
  const top3 = rankSkills(input, { tool: "ChatGPT", host: "chatgpt.com" }, [], 3)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      score: skill.score,
      reason: skill.reason || {}
    }));
  const hit = top3.some((skill) => skill.id === expectedSkillId);
  return {
    index,
    inputHash: hashValue(input),
    inputLength: input.length,
    expectedSkillId,
    hit,
    top3
  };
});

const hitCount = results.filter((result) => result.hit).length;
const hitRate = hitCount / fixtures.length;
const report = redactEvidence({
  createdAt: new Date().toISOString(),
  pass: hitRate >= targetHitRate,
  targetHitRate,
  fixtureCount: fixtures.length,
  hitCount,
  hitRate,
  results
});

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
assert.ok(report.pass, `Skill routing hit rate ${hitRate} is below target ${targetHitRate}.`);
