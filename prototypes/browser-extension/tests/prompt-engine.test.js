const assert = require("node:assert");
const engine = require("../src/prompt-engine.js");

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

const card = engine.buildCard("重构登录模块，注意权限和测试", {
  host: "chatgpt.com",
  title: "ChatGPT",
  inputKind: "textarea"
}, [imported], 0);

assert.equal(card.tool, "ChatGPT");
assert.equal(card.mode, engine.MODE.CONTINUE);
assert.ok(card.skills.some((skill) => skill.name === "security-review"));
assert.ok(card.prompt.includes("验收标准"));
assert.ok(card.prompt.includes("不要自动执行第三方脚本"));

const polished = engine.buildCard("目标：修复支付页\n背景：Next.js 项目\n约束：不改 API\n输出：补丁和验证命令\n验收：单测通过", {
  host: "claude.ai",
  title: "Claude"
}, [], 1);

assert.equal(polished.mode, engine.MODE.POLISH);
assert.ok(polished.prompt.includes("请只输出优化后的 prompt"));

console.log("prompt-engine tests passed");
