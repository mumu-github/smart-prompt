const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createStore } = require("../src/store");
const { importSkillFolder } = require("../src/skill-library");
const { startServer } = require("../src/server");
const { createOpenAIChatRequest, generateWithOpenAICompatible } = require("../../../packages/shared/llm-gateway");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

async function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      headers: {
        "Content-Type": "application/json"
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const skillDir = tempDir("smart-prompt-skills-");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---
name: security-review
description: Check auth, privacy, injection, and permission risks.
---

# Security Review

Use for login, auth, and privacy-sensitive flows.
`, "utf8");
  fs.writeFileSync(path.join(skillDir, "AGENTS.md"), "# Project Rules\n\nPrefer tests and explicit acceptance criteria.", "utf8");

  const imported = importSkillFolder(skillDir);
  assert.equal(imported.length, 2);
  assert.ok(imported.some((skill) => skill.name === "security-review"));

  const store = createStore(tempDir("smart-prompt-store-"));
  store.addSkills(imported);
  const settings = store.saveSettings({ apiKey: "sk-test-secret", model: "gpt-test" });
  assert.equal(settings.uploadWholePage, false);
  assert.equal(settings.autoSubmit, false);

  const requestShape = createOpenAIChatRequest({
    input: "帮我重构登录模块，需要注意权限、隐私、测试和回归风险",
    context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea" },
    skills: imported,
    settings: { apiKey: "sk-test-secret", model: "gpt-test" }
  });
  assert.equal(requestShape.body.model, "gpt-test");
  assert.ok(requestShape.body.messages[1].content.includes("mode=continue"));

  const generated = await generateWithOpenAICompatible({
    input: "帮我重构登录模块，需要注意权限、隐私、测试和回归风险",
    context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea" },
    skills: imported,
    settings: { apiKey: "sk-test-secret", model: "gpt-test" },
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith("/chat/completions"));
      assert.ok(options.headers.Authorization.includes("sk-test-secret"));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              { message: { content: "LLM generated prompt" } }
            ]
          };
        }
      };
    }
  });
  assert.equal(generated.generatedBy, "llm");
  assert.equal(generated.prompt, "LLM generated prompt");

  const server = startServer({ port: 0, store });
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const health = await request(port, "GET", "/health");
    assert.equal(health.status, 200);

    const rec = await request(port, "POST", "/skills/recommend", {
      input: "登录权限和隐私检查",
      context: { tool: "ChatGPT", host: "chatgpt.com" }
    });
    assert.equal(rec.status, 200);
    assert.ok(rec.body.skills.length >= 1 && rec.body.skills.length <= 3);

    const fallback = await request(port, "POST", "/generate", {
      input: "做一个 CRM",
      context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" },
      allowTemplateFallback: true
    });
    assert.equal(fallback.status, 200);
    assert.ok(["llm", "template-fallback"].includes(fallback.body.card.generatedBy));
  } finally {
    server.close();
  }

  console.log("local-service tests passed");
})();
