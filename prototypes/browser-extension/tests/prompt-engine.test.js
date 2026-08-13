const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../src/prompt-engine.js");
const sharedCore = require("../../../packages/shared/smart-prompt-core.js");

const sharedCoreSource = fs.readFileSync(path.join(__dirname, "../../../packages/shared/smart-prompt-core.js"), "utf8");
const extensionCoreSource = fs.readFileSync(path.join(__dirname, "../src/smart-prompt-core.js"), "utf8");
assert.equal(extensionCoreSource, sharedCoreSource, "extension smart-prompt-core.js drifted from packages/shared");
assert.deepEqual(engine.SITE_ADAPTERS.map((adapter) => adapter.id), sharedCore.SITE_ADAPTERS.map((adapter) => adapter.id));

assert.equal(engine.detectMode(""), engine.MODE.IDEA);
assert.equal(engine.detectMode("做一个 CRM"), engine.MODE.IDEA);
assert.equal(engine.detectMode("帮我做一个 CRM 后台，要有客户列表和跟进记录"), engine.MODE.CONTINUE);
assert.equal(
  engine.detectMode("目标：实现登录模块\n背景：已有 React 项目\n约束：不要改动后端接口\n输出：代码和测试\n验收：npm test 通过"),
  engine.MODE.POLISH
);

const imported = engine.parseSkillText(`---
name: security-review
description: Check auth, privacy, injection, and permissions.
---

# Security Review

Review sensitive flows.`);

assert.equal(imported.name, "security-review");
assert.ok(imported.description.includes("privacy"));
assert.equal(imported.sourceType, "imported");
assert.equal(imported.riskLevel, "text-only");
assert.equal(Object.prototype.hasOwnProperty.call(imported, "source_type"), false);
assert.equal(engine.detectTool("", "Codex desktop"), "Codex");
assert.equal(engine.detectTool("", "workBuddy composer"), "workBuddy");

const card = engine.buildCard("重构登录模块，注意权限和测试", {
  host: "chatgpt.com",
  title: "ChatGPT",
  inputKind: "textarea"
}, [imported], 0);

assert.equal(card.tool, "ChatGPT");
assert.equal(card.mode, engine.MODE.CONTINUE);
assert.ok(card.skills.some((skill) => skill.name === "security-review"));
assert.ok(card.skills.every((skill) => skill.sourceType));
assert.equal(card.skills.find((skill) => skill.name === "security-review").reason.sourceBoost, 0.8);
assert.ok(card.prompt.includes("验收标准"));
assert.ok(card.prompt.includes("不要自动执行第三方脚本"));

const legacySkill = {
  id: "legacy-skill",
  name: "legacy",
  description: "Legacy snake_case imported skill",
  tags: ["legacy"],
  source_type: "folder-import",
  risk_level: "text-only"
};
const legacyRanked = engine.rankSkills("legacy", { tool: "ChatGPT" }, [legacySkill], 1)[0];
assert.equal(legacyRanked.sourceType, "folder-import");
assert.equal(legacyRanked.riskLevel, "text-only");
assert.equal(legacyRanked.reason.sourceBoost, 0.8);

const polished = engine.buildCard("目标：修复支付页\n背景：Next.js 项目\n约束：不改 API\n输出：补丁和验证命令\n验收：单测通过", {
  host: "claude.ai",
  title: "Claude"
}, [], 1);

assert.equal(polished.mode, engine.MODE.POLISH);
assert.ok(polished.prompt.includes("请只输出优化后的 prompt"));

const englishCard = engine.buildCard("Build a CRM dashboard with customers and follow-ups", {
  host: "chatgpt.com",
  title: "ChatGPT",
  inputKind: "textarea",
  locale: "en"
}, [], 0);

assert.equal(englishCard.modeLabel, "Continue");
assert.ok(englishCard.prompt.includes("Acceptance criteria"));
assert.ok(englishCard.prompt.includes("Do not execute third-party scripts automatically"));

console.log("prompt-engine tests passed");
