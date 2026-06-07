const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createStore, defaultDataDir } = require("../src/store");
const { importSkillFolder } = require("../src/skill-library");
const { startServer } = require("../src/server");
const {
  PROVIDERS,
  createAnthropicMessagesRequest,
  createGeminiGenerateContentRequest,
  createOpenAIChatRequest,
  chooseConfiguredProvider,
  generateWithAgnes,
  generateWithConfiguredProvider,
  generateWithOpenAICompatible,
  getConfiguredProviderOrder,
  getProviderStatuses,
  getStoredApiKey
} = require("../../../packages/shared/llm-gateway");
const { MODE, buildCard } = require("../../../packages/shared/smart-prompt-core");

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

async function rawRequest(port, method, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method
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
    req.end();
  });
}

(async () => {
  const previousDataDir = process.env.SMART_PROMPT_DATA_DIR;
  delete process.env.SMART_PROMPT_DATA_DIR;
  assert.equal(defaultDataDir(), path.resolve(__dirname, "..", ".smart-prompt-data"));
  if (previousDataDir) process.env.SMART_PROMPT_DATA_DIR = previousDataDir;

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
  assert.equal(settings.apiKey, "");
  assert.equal(settings.providerKeys[PROVIDERS.AGNES], "");
  assert.equal(settings.providerKeys[PROVIDERS.OPENAI_COMPATIBLE], "sk-test-secret");
  assert.equal(store.saveSettings({ provider: "not-real" }).provider, PROVIDERS.AUTO);

  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO }, { AGNES_API_KEY: "agnes", ANTHROPIC_API_KEY: "ant" }), PROVIDERS.AGNES);
  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO }, { ANTHROPIC_API_KEY: "ant" }), PROVIDERS.ANTHROPIC);
  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO }, { GEMINI_API_KEY: "gem" }), PROVIDERS.GEMINI);
  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO }, { OPENAI_API_KEY: "openai" }), PROVIDERS.OPENAI_COMPATIBLE);
  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO, apiKey: "stored-openai" }, {}), PROVIDERS.OPENAI_COMPATIBLE);
  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO, providerKeys: { agnes: "stored-agnes" } }, {}), PROVIDERS.AGNES);
  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO, providerKeys: { anthropic: "stored-ant" } }, {}), PROVIDERS.ANTHROPIC);
  assert.equal(chooseConfiguredProvider({ provider: PROVIDERS.AUTO, providerKeys: { gemini: "stored-gem" } }, {}), PROVIDERS.GEMINI);
  assert.deepEqual(
    getConfiguredProviderOrder({ provider: PROVIDERS.AUTO, providerKeys: { agnes: "stored-agnes", anthropic: "stored-ant", gemini: "stored-gem" } }, {}),
    [PROVIDERS.AGNES, PROVIDERS.ANTHROPIC, PROVIDERS.GEMINI]
  );
  assert.equal(getStoredApiKey(PROVIDERS.AGNES, { provider: PROVIDERS.AUTO, providerKeys: { agnes: "stored-agnes" } }), "stored-agnes");
  assert.equal(getStoredApiKey(PROVIDERS.ANTHROPIC, { provider: PROVIDERS.AUTO, providerKeys: { anthropic: "stored-ant" } }), "stored-ant");
  const providerStatus = getProviderStatuses({ provider: PROVIDERS.AUTO }, { AGNES_API_KEY: "agnes", ANTHROPIC_API_KEY: "ant" });
  assert.equal(providerStatus.selected, PROVIDERS.AUTO);
  assert.equal(providerStatus.auto.provider, PROVIDERS.AGNES);
  assert.ok(providerStatus.providers.some((provider) => provider.provider === PROVIDERS.AGNES && provider.keyAvailable));
  assert.ok(providerStatus.providers.some((provider) => provider.provider === PROVIDERS.ANTHROPIC && provider.keyAvailable));
  const storedStatus = getProviderStatuses({ provider: PROVIDERS.AUTO, providerKeys: { gemini: "stored-gem" } }, {});
  assert.equal(storedStatus.auto.provider, PROVIDERS.GEMINI);
  assert.ok(storedStatus.providers.some((provider) => provider.provider === PROVIDERS.GEMINI && provider.usesStoredKey));

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

  const agnesGenerated = await generateWithAgnes({
    input: "帮我生成一个验收提示词",
    context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea" },
    skills: imported,
    settings: { provider: PROVIDERS.AGNES, providerKeys: { agnes: "sk-agnes-test" }, model: "agnes-2.0-flash" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://apihub.agnes-ai.com/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer sk-agnes-test");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "agnes-2.0-flash");
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "Agnes generated prompt" } }] };
        }
      };
    }
  });
  assert.equal(agnesGenerated.provider, PROVIDERS.AGNES);
  assert.equal(agnesGenerated.prompt, "Agnes generated prompt");

  const anthropicShape = createAnthropicMessagesRequest({
    input: "Build a privacy review prompt",
    context: { host: "claude.ai", tool: "Claude", inputKind: "contenteditable" },
    skills: imported,
    settings: { provider: PROVIDERS.ANTHROPIC, apiKey: "sk-ant-test", model: "claude-test" }
  });
  assert.ok(anthropicShape.endpoint.endsWith("/messages"));
  assert.equal(anthropicShape.body.model, "claude-test");
  assert.equal(anthropicShape.body.messages[0].role, "user");
  assert.ok(anthropicShape.body.max_tokens > 0);

  const geminiShape = createGeminiGenerateContentRequest({
    input: "Build a product spec prompt",
    context: { host: "gemini.google.com", tool: "Gemini", inputKind: "contenteditable" },
    skills: imported,
    settings: { provider: PROVIDERS.GEMINI, apiKey: "gemini-test", model: "gemini-test" }
  });
  assert.ok(geminiShape.endpoint.includes("/models/gemini-test:generateContent"));
  assert.ok(geminiShape.body.contents[0].parts[0].text.includes("Smart Prompt Copilot"));

  const anthropicGenerated = await generateWithConfiguredProvider({
    input: "Build a privacy review prompt",
    context: { host: "claude.ai", tool: "Claude", inputKind: "contenteditable" },
    skills: imported,
    settings: { provider: PROVIDERS.ANTHROPIC, apiKey: "sk-ant-test", model: "claude-test" },
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith("/messages"));
      assert.equal(options.headers["x-api-key"], "sk-ant-test");
      assert.ok(options.headers["anthropic-version"]);
      return {
        ok: true,
        async json() {
          return { content: [{ type: "text", text: "Anthropic generated prompt" }] };
        }
      };
    }
  });
  assert.equal(anthropicGenerated.provider, PROVIDERS.ANTHROPIC);
  assert.equal(anthropicGenerated.prompt, "Anthropic generated prompt");

  const geminiGenerated = await generateWithConfiguredProvider({
    input: "Build a product spec prompt",
    context: { host: "gemini.google.com", tool: "Gemini", inputKind: "contenteditable" },
    skills: imported,
    settings: { provider: PROVIDERS.GEMINI, apiKey: "gemini-test", model: "gemini-test" },
    fetchImpl: async (url, options) => {
      assert.ok(url.includes(":generateContent"));
      assert.equal(options.headers["x-goog-api-key"], "gemini-test");
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: "Gemini generated prompt" }] } }] };
        }
      };
    }
  });
  assert.equal(geminiGenerated.provider, PROVIDERS.GEMINI);
  assert.equal(geminiGenerated.prompt, "Gemini generated prompt");

  const autoFallbackCalls = [];
  const autoFallbackGenerated = await generateWithConfiguredProvider({
    input: "Build a privacy-safe product spec prompt",
    context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea" },
    skills: imported,
    settings: {
      provider: PROVIDERS.AUTO,
      model: "gpt-test-should-not-leak-to-auto-providers",
      providerKeys: { anthropic: "stored-ant", gemini: "stored-gem" }
    },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      autoFallbackCalls.push({ url, body, headers: options.headers });
      if (url.endsWith("/messages")) {
        return {
          ok: false,
          status: 429,
          async text() {
            return "anthropic quota reached";
          }
        };
      }
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: "Auto fallback Gemini prompt" }] } }] };
        }
      };
    }
  });
  assert.equal(autoFallbackGenerated.provider, PROVIDERS.GEMINI);
  assert.equal(autoFallbackGenerated.prompt, "Auto fallback Gemini prompt");
  assert.equal(autoFallbackCalls.length, 2);
  assert.equal(autoFallbackCalls[0].body.model, "claude-sonnet-4-20250514");
  assert.ok(autoFallbackCalls[1].url.includes("/models/gemini-2.5-flash:generateContent"));

  const gatewayCalls = [];
  store.saveSettings({ provider: PROVIDERS.GEMINI, apiKey: "provider-secret", model: "gemini-test" });
  const server = startServer({
    port: 0,
    store,
    generateWithLlm: async ({ input, context, skills, variantIndex, settings }) => {
      gatewayCalls.push({
        input,
        mode: context.mode,
        skillCount: skills.length,
        provider: settings.provider,
        model: settings.model,
        hasApiKey: Boolean(settings.apiKey || settings.providerKeys?.[settings.provider])
      });
      return {
        ...buildCard(input, context, skills, variantIndex),
        prompt: `LLM test double prompt for ${context.mode}`,
        generatedBy: "llm",
        model: settings.model
      };
    }
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const health = await request(port, "GET", "/health");
    assert.equal(health.status, 200);

    const options = await rawRequest(port, "OPTIONS", "/skills");
    assert.equal(options.status, 200);
    assert.ok(options.headers["access-control-allow-methods"].includes("DELETE"));

    const providers = await request(port, "GET", "/llm/providers");
    assert.equal(providers.status, 200);
    assert.ok(providers.body.providers.length >= 4);
    assert.ok(providers.body.providers.some((provider) => provider.provider === PROVIDERS.GEMINI && provider.usesStoredKey));

    const rec = await request(port, "POST", "/skills/recommend", {
      input: "登录权限和隐私检查",
      context: { tool: "ChatGPT", host: "chatgpt.com" }
    });
    assert.equal(rec.status, 200);
    assert.ok(rec.body.skills.length >= 1 && rec.body.skills.length <= 3);

    const deletedSkill = await request(port, "DELETE", `/skills/${encodeURIComponent(imported[0].id)}`);
    assert.equal(deletedSkill.status, 200);
    assert.ok(!deletedSkill.body.skills.some((skill) => skill.id === imported[0].id));

    const missingSkill = await request(port, "DELETE", "/skills/not-found");
    assert.equal(missingSkill.status, 404);
    assert.equal(missingSkill.body.error.code, "skill_not_found");

    const emptyPrompt = await request(port, "POST", "/prompts", {
      title: "Empty",
      body: ""
    });
    assert.equal(emptyPrompt.status, 400);
    assert.equal(emptyPrompt.body.error.code, "empty_prompt");

    const savedPrompt = await request(port, "POST", "/prompts", {
      title: "CRM prompt",
      body: "Build a CRM prompt with acceptance criteria.",
      mode: MODE.CONTINUE,
      tags: ["crm", "acceptance"],
      context: { tool: "ChatGPT" }
    });
    assert.equal(savedPrompt.status, 200);
    assert.equal(savedPrompt.body.prompt.title, "CRM prompt");
    assert.equal(savedPrompt.body.prompt.mode, MODE.CONTINUE);

    const promptList = await request(port, "GET", "/prompts");
    assert.equal(promptList.status, 200);
    assert.equal(promptList.body.prompts.length, 1);
    assert.equal(promptList.body.prompts[0].body, "Build a CRM prompt with acceptance criteria.");

    const deletedPrompt = await request(port, "DELETE", `/prompts/${encodeURIComponent(savedPrompt.body.prompt.id)}`);
    assert.equal(deletedPrompt.status, 200);
    assert.equal(deletedPrompt.body.prompts.length, 0);

    const modeSamples = [
      { mode: MODE.IDEA, input: "" },
      { mode: MODE.CONTINUE, input: "Build a CRM with customer list and follow-up notes." },
      { mode: MODE.POLISH, input: "Goal: refactor login\nContext: Next.js app\nConstraints: keep API unchanged\nOutput: patch and tests\nAcceptance: tests pass" }
    ];

    for (const sample of modeSamples) {
      const generatedResponse = await request(port, "POST", "/generate", {
        input: sample.input,
        mode: sample.mode,
        context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" },
        allowTemplateFallback: false
      });
      assert.equal(generatedResponse.status, 200);
      assert.equal(generatedResponse.body.card.generatedBy, "llm");
      assert.equal(generatedResponse.body.card.mode, sample.mode);
      assert.ok(generatedResponse.body.card.prompt.includes(sample.mode));
    }
    assert.deepEqual(gatewayCalls.map((call) => call.mode), [MODE.IDEA, MODE.CONTINUE, MODE.POLISH]);
    assert.ok(gatewayCalls.every((call) => call.provider === PROVIDERS.GEMINI && call.model === "gemini-test" && call.hasApiKey));
  } finally {
    server.close();
  }

  console.log("local-service tests passed");
})();
