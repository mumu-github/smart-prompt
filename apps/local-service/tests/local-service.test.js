const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { DATA_SCHEMA_VERSION, createStore, defaultDataDir } = require("../src/store");
const { importSkillFolder } = require("../src/skill-library");
const { buildGenerationContext, buildLlmTestResponse, createAppRoutes, findAppRoute, findReportRoute, isTrustedExtensionOrigin, startServer } = require("../src/server");
const {
  PROVIDERS,
  createAnthropicMessagesRequest,
  createGeminiGenerateContentRequest,
  createOpenAIChatRequest,
  chooseConfiguredProvider,
  generateWithAgnes,
  generateWithConfiguredProvider,
  generateWithCustomProvider,
  generateWithOpenAICompatible,
  getConfiguredProviderOrder,
  getProviderStatuses,
  getStoredApiKey,
  normalizeModelId,
  redactKey
} = require("../../../packages/shared/llm-gateway");
const { MODE, buildCard } = require("../../../packages/shared/smart-prompt-core");
const { detectDesktopTool } = require("../../../packages/shared/desktop-tool-profiles");
const {
  UNSUPPORTED_DESKTOP_INPUT_REASON,
  createUnsupportedDesktopFillReport,
  createUnsupportedDesktopInputSnapshot
} = require("../src/desktop-input-detector");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

const TRUSTED_EXTENSION_ORIGIN = "chrome-extension://fnpfpobenlbgdkjadiaeopdpnodeegpj";
const TRUSTED_CHATGPT_ORIGIN = "https://chatgpt.com";

assert.equal(redactKey("synthetic-provider-secret"), "configured");
assert.equal(redactKey(""), "");
assert.equal(normalizeModelId(" vendor/custom-model:2026-07 "), "vendor/custom-model:2026-07");
assert.throws(() => normalizeModelId("invalid model id"), (error) => error.code === "model_invalid");
assert.throws(() => normalizeModelId("x".repeat(201)), (error) => error.code === "model_invalid");
const EVIL_ORIGIN = "https://evil.example";
assert.equal(isTrustedExtensionOrigin(TRUSTED_EXTENSION_ORIGIN), true);
assert.equal(isTrustedExtensionOrigin("chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"), false);
assert.equal(isTrustedExtensionOrigin("moz-extension://12345678-1234-1234-1234-123456789abc"), false);

async function request(port, method, route, body, token = "", extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders
      }
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function rawRequest(port, method, route, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      headers: extraHeaders
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
assert.equal(store.schemaVersion, DATA_SCHEMA_VERSION);
assert.equal(store.getMetadata().schemaVersion, DATA_SCHEMA_VERSION);
store.addSkills(imported);
const strategyInsightsRoute = findReportRoute({ method: "GET" }, new URL("http://127.0.0.1/metrics/strategy-insights?mode=continue"));
assert.equal(strategyInsightsRoute.pathname, "/metrics/strategy-insights");
const localServiceRoutes = createAppRoutes({ store });
assert.equal(findAppRoute(localServiceRoutes, { method: "GET" }, new URL("http://127.0.0.1/settings")).pathname, "/settings");
assert.equal(findAppRoute(localServiceRoutes, { method: "DELETE" }, new URL("http://127.0.0.1/prompts/example")).prefix, "/prompts/");
assert.equal(findAppRoute(localServiceRoutes, { method: "GET" }, new URL("http://127.0.0.1/metrics/strategy-insights")).name, "report-routes");
const generationContext = buildGenerationContext({
  input: "Build a security review checklist with clear acceptance criteria.",
  context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea" }
}, store.getMetrics());
assert.ok(/^generation-/.test(generationContext.generationId));
assert.ok(generationContext.context.taskScenario);
assert.equal(generationContext.enrichedContext.promptStrategyPlan.schemaVersion, "v6-prompt-quality@1");
assert.equal(generationContext.enrichedContext.taskScenario, generationContext.context.taskScenario);
const settings = store.saveSettings({ apiKey: "sk-test-secret", model: "gpt-test" });
assert.equal(settings.uploadWholePage, false);
assert.equal(settings.autoSubmit, false);
assert.equal(settings.apiKey, "");
assert.equal(settings.providerKeys[PROVIDERS.AGNES], "");
assert.equal(settings.providerKeys[PROVIDERS.CUSTOM], "");
assert.equal(settings.providerKeys[PROVIDERS.OPENAI_COMPATIBLE], "sk-test-secret");
assert.ok(settings.credentialStorage.encrypted);
const settingsText = fs.readFileSync(path.join(store.dataDir, "settings.json"), "utf8");
const vaultText = fs.readFileSync(path.join(store.dataDir, "provider-keys.json"), "utf8");
assert.ok(!settingsText.includes("sk-test-secret"));
assert.ok(!vaultText.includes("sk-test-secret"));
assert.equal(store.saveSettings({ provider: "not-real" }).provider, PROVIDERS.AUTO);

const customModelStore = createStore(tempDir("smart-prompt-custom-model-store-"));
assert.equal(customModelStore.saveSettings({
  provider: PROVIDERS.OPENAI_COMPATIBLE,
  model: "vendor/custom-model:2026-07"
}).model, "vendor/custom-model:2026-07");
assert.throws(
  () => customModelStore.saveSettings({ model: "invalid model id" }),
  (error) => error.code === "model_invalid"
);
assert.equal(customModelStore.getSettings().model, "vendor/custom-model:2026-07");

const customProviderStore = createStore(tempDir("smart-prompt-custom-provider-store-"));
const savedCustomProvider = customProviderStore.saveSettings({
  provider: PROVIDERS.CUSTOM,
  baseUrl: "https://gateway.example/v1/",
  model: "private/model-v2",
  customProvider: {
    name: "Team Gateway",
    protocol: PROVIDERS.ANTHROPIC,
    baseUrl: "https://gateway.example/v1/",
    model: "private/model-v2"
  },
  providerKeys: { [PROVIDERS.CUSTOM]: "custom-provider-key" }
});
assert.equal(savedCustomProvider.provider, PROVIDERS.CUSTOM);
assert.deepEqual(savedCustomProvider.customProvider, {
  name: "Team Gateway",
  protocol: PROVIDERS.ANTHROPIC,
  baseUrl: "https://gateway.example/v1",
  model: "private/model-v2"
});
assert.equal(savedCustomProvider.baseUrl, "https://gateway.example/v1");
assert.equal(savedCustomProvider.providerKeys[PROVIDERS.CUSTOM], "custom-provider-key");
customProviderStore.saveSettings({
  provider: PROVIDERS.AGNES,
  baseUrl: "https://apihub.agnes-ai.com/v1",
  model: "agnes-2.0-flash"
});
assert.equal(customProviderStore.getSettings().customProvider.name, "Team Gateway");
assert.equal(customProviderStore.getSettings().providerKeys[PROVIDERS.CUSTOM], "custom-provider-key");
assert.equal(customProviderStore.saveSettings({ provider: PROVIDERS.CUSTOM }).model, "private/model-v2");
assert.throws(() => customProviderStore.previewSettings({
  provider: PROVIDERS.CUSTOM,
  customProvider: {
    name: "Team Gateway",
    protocol: PROVIDERS.OPENAI_COMPATIBLE,
    baseUrl: "file:///not-allowed",
    model: "private/model-v2"
  }
}), (error) => error.code === "custom_provider_base_url_invalid");
assert.equal(customProviderStore.getSettings().customProvider.baseUrl, "https://gateway.example/v1");
const previewedSettings = customModelStore.previewSettings({
  provider: PROVIDERS.OPENAI_COMPATIBLE,
  model: "vendor/candidate-model:2026-07",
  providerKeys: { [PROVIDERS.OPENAI_COMPATIBLE]: "candidate-key" }
});
assert.equal(previewedSettings.model, "vendor/candidate-model:2026-07");
assert.equal(previewedSettings.providerKeys[PROVIDERS.OPENAI_COMPATIBLE], "candidate-key");
assert.equal(customModelStore.getSettings().model, "vendor/custom-model:2026-07");

const transactionalStore = createStore(tempDir("smart-prompt-transactional-model-store-"));
transactionalStore.saveSettings({
  provider: PROVIDERS.OPENAI_COMPATIBLE,
  baseUrl: "https://provider.example/v1",
  model: "stable-model",
  providerKeys: { [PROVIDERS.OPENAI_COMPATIBLE]: "stable-key" }
});
const transactionalGenerate = async ({ settings: candidate }) => {
  if (candidate.providerKeys[PROVIDERS.OPENAI_COMPATIBLE] === "rejected-key") {
    throw Object.assign(new Error("Credential rejected."), { status: 401 });
  }
  return {
    prompt: "Transactional provider test response.",
    generatedBy: "llm",
    provider: candidate.provider,
    model: candidate.model,
    mode: "idea"
  };
};
const rejectedCandidate = await buildLlmTestResponse({
  body: {
    mode: "idea",
    persistOnSuccess: true,
    settings: {
      provider: PROVIDERS.OPENAI_COMPATIBLE,
      model: "rejected-model",
      providerKeys: { [PROVIDERS.OPENAI_COMPATIBLE]: "rejected-key" }
    }
  },
  store: transactionalStore,
  generateWithLlm: transactionalGenerate
});
assert.equal(rejectedCandidate.status, 502);
assert.equal(rejectedCandidate.payload.error.code, "credential_invalid");
assert.equal(transactionalStore.getSettings().model, "stable-model");
assert.equal(transactionalStore.getSettings().providerKeys[PROVIDERS.OPENAI_COMPATIBLE], "stable-key");
const acceptedCandidate = await buildLlmTestResponse({
  body: {
    mode: "idea",
    persistOnSuccess: true,
    settings: {
      provider: PROVIDERS.OPENAI_COMPATIBLE,
      model: "accepted-model",
      providerKeys: { [PROVIDERS.OPENAI_COMPATIBLE]: "accepted-key" }
    }
  },
  store: transactionalStore,
  generateWithLlm: transactionalGenerate
});
assert.equal(acceptedCandidate.status, 200);
assert.equal(acceptedCandidate.payload.settingsPersisted, true);
assert.equal(transactionalStore.getSettings().model, "accepted-model");
assert.equal(transactionalStore.getSettings().providerKeys[PROVIDERS.OPENAI_COMPATIBLE], "accepted-key");

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
  assert.equal(
    chooseConfiguredProvider({ provider: PROVIDERS.AUTO, providerKeys: { custom: "stored-custom" } }, {}),
    PROVIDERS.OPENAI_COMPATIBLE
  );
  assert.deepEqual(
    getConfiguredProviderOrder({ provider: PROVIDERS.AUTO, providerKeys: { custom: "stored-custom" } }, {}),
    [PROVIDERS.OPENAI_COMPATIBLE]
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
  const customStatus = getProviderStatuses({
    provider: PROVIDERS.CUSTOM,
    customProvider: {
      name: "Team Gateway",
      protocol: PROVIDERS.OPENAI_COMPATIBLE,
      baseUrl: "https://gateway.example/v1",
      model: "private/model-v2"
    },
    providerKeys: { custom: "stored-custom" }
  }, {});
  assert.ok(customStatus.providers.some((provider) =>
    provider.provider === PROVIDERS.CUSTOM
      && provider.label === "Team Gateway"
      && provider.keyAvailable
      && provider.selected
  ));

  const requestShape = createOpenAIChatRequest({
    input: "帮我重构登录模块，需要注意权限、隐私、测试和回归风险",
    context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea" },
    skills: imported,
    settings: { apiKey: "sk-test-secret", model: "gpt-test" }
  });
  assert.equal(requestShape.body.model, "gpt-test");
  assert.ok(requestShape.body.messages[1].content.includes("mode=continue"));
  assert.ok(requestShape.body.messages[0].content.includes("finalPrompt"));
  assert.ok(requestShape.body.messages[0].content.includes("acceptance criteria"));

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
  assert.equal(generated.structuredOutput.structured, false);
  assert.ok(Number.isFinite(generated.quality.score));

  const structuredPrompt = [
    "Goal: Review auth and privacy changes.",
    "Context: A local service stores provider keys.",
    "Tasks: inspect request handling, storage, and tests.",
    "Constraints: do not upload full page content and do not auto-submit.",
    "Output format: findings, patch summary, and verification commands.",
    "Acceptance criteria: auth and redaction tests pass."
  ].join("\n");
  const structuredGenerated = await generateWithOpenAICompatible({
    input: "Review auth and privacy changes",
    context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea", mode: MODE.CONTINUE },
    skills: imported,
    settings: { apiKey: "sk-test-secret", model: "gpt-test" },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  finalPrompt: structuredPrompt,
                  whyThisWorks: ["It makes the goal and acceptance criteria explicit."],
                  suggestedSkills: ["security-review", "test-plan"],
                  missingInfo: ["Which endpoints changed?"],
                  privacyNotes: ["No full page body is needed."]
                })
              }
            }
          ]
        };
      }
    })
  });
  assert.equal(structuredGenerated.structuredOutput.structured, true);
  assert.equal(structuredGenerated.prompt, structuredPrompt);
  assert.ok(structuredGenerated.quality.pass);

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

  async function generateWithSyntheticCustomProvider(protocol) {
    return generateWithCustomProvider({
      input: "Build a custom provider prompt",
      context: { host: "chatgpt.com", tool: "ChatGPT", inputKind: "textarea" },
      skills: imported,
      settings: {
        provider: PROVIDERS.CUSTOM,
        customProvider: {
          name: "Team Gateway",
          protocol,
          baseUrl: "https://gateway.example/v1",
          model: "private/model-v2"
        },
        providerKeys: { custom: "custom-provider-key" }
      },
      fetchImpl: async (url, options) => {
        if (protocol === PROVIDERS.ANTHROPIC) {
          assert.equal(url, "https://gateway.example/v1/messages");
          assert.equal(options.headers["x-api-key"], "custom-provider-key");
          return { ok: true, async json() { return { content: [{ text: "Custom Anthropic prompt" }] }; } };
        }
        if (protocol === PROVIDERS.GEMINI) {
          assert.equal(url, "https://gateway.example/v1/models/private/model-v2:generateContent");
          assert.equal(options.headers["x-goog-api-key"], "custom-provider-key");
          return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: "Custom Gemini prompt" }] } }] }; } };
        }
        assert.equal(url, "https://gateway.example/v1/chat/completions");
        assert.equal(options.headers.Authorization, "Bearer custom-provider-key");
        return { ok: true, async json() { return { choices: [{ message: { content: "Custom OpenAI prompt" } }] }; } };
      }
    });
  }

  for (const protocol of [PROVIDERS.OPENAI_COMPATIBLE, PROVIDERS.ANTHROPIC, PROVIDERS.GEMINI]) {
    const customGenerated = await generateWithSyntheticCustomProvider(protocol);
    assert.equal(customGenerated.provider, PROVIDERS.CUSTOM);
    assert.equal(customGenerated.model, "private/model-v2");
    assert.equal(customGenerated.generatedBy, "llm");
  }

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
        host: context.host,
        inputKind: context.inputKind,
        skillCount: skills.length,
        provider: settings.provider,
        model: settings.model,
        hasApiKey: Boolean(settings.apiKey || settings.providerKeys?.[settings.provider]),
        feedbackSummary: context.feedbackSummary,
        feedbackProfile: context.feedbackProfile,
        feedbackProfileText: context.feedbackProfileText,
        promptStrategyPlan: context.promptStrategyPlan,
        promptStrategyText: context.promptStrategyText,
        strategyInsights: context.strategyInsights,
        strategyInsightsText: context.strategyInsightsText,
        strategyWeightPolicy: context.strategyWeightPolicy,
        strategyWeightText: context.strategyWeightText,
        promptQualityLiftReport: context.promptQualityLiftReport,
        promptQualityLiftText: context.promptQualityLiftText,
        promptQualityLiftSegmentsReport: context.promptQualityLiftSegmentsReport,
        promptQualityLiftSegmentsText: context.promptQualityLiftSegmentsText,
        qualityLiftSegmentPolicy: context.qualityLiftSegmentPolicy,
        qualityLiftSegmentText: context.qualityLiftSegmentText,
        failureReasonReport: context.failureReasonReport,
        failureReasonReportText: context.failureReasonReportText,
        failureReasonPolicy: context.failureReasonPolicy,
        failureReasonText: context.failureReasonText,
        selfImprovementReport: context.selfImprovementReport,
        selfImprovementText: context.selfImprovementText,
        evolutionCandidateReport: context.evolutionCandidateReport,
        evolutionCandidateText: context.evolutionCandidateText,
        experimentOutcomeReport: context.experimentOutcomeReport,
        experimentOutcomeText: context.experimentOutcomeText,
        taskOutcomeReport: context.taskOutcomeReport,
        taskOutcomeText: context.taskOutcomeText,
        taskScenario: context.taskScenario
      });
      return {
        ...buildCard(input, context, skills, variantIndex),
        prompt: `LLM test double prompt for ${context.mode}`,
        generatedBy: "llm",
        model: settings.model
      };
    },
    getDesktopInputSnapshot: async ({ selfTest }) => {
      assert.equal(selfTest, true);
      return {
        schemaVersion: "m3-windows-uia@1",
        createdAt: new Date().toISOString(),
        platform: "win32",
        selfTest,
        probeOk: true,
        pass: true,
        foreground: {
          processName: "WindowsTerminal",
          pidPresent: true,
          isVisible: true,
          isMinimized: false,
          isCloaked: false,
          isUsable: true,
          boundingRect: { x: 10, y: 20, width: 900, height: 700 },
          titleLength: 32,
          titleHash: "abc123",
          detectedToolProfile: "codex"
        },
        supportedToolProfiles: ["codex", "claude-code", "hermes", "workbuddy", "trae"],
        candidates: [{
          index: 0,
          controlType: "ControlType.Edit",
          nameHash: "name-hash",
          automationIdHash: "automation-hash",
          classNameHash: "class-hash",
          isKeyboardFocusable: true,
          isEnabled: true,
          hasValuePattern: true,
          hasTextPattern: false,
          boundingRect: { x: 1, y: 2, width: 320, height: 80 },
          inputSignals: {
            score: 145,
            hasKeyboardFocus: true,
            focusedElementMatch: true,
            caretWithinBounds: true,
            caretWindowMatch: true,
            cursorWithinBounds: true,
            nearWindowBottom: true,
            broadDocument: false,
            semanticComposerHint: true,
            profileComposerCandidate: true
          }
        }],
        summary: {
          candidateCount: 1,
          safeCandidateCount: 1,
          valuePatternCandidates: 1,
          textPatternCandidates: 0,
          focusableCandidates: 1,
          focusedCandidateCount: 1,
          caretCandidateCount: 1,
          semanticCandidateCount: 1,
          bestCandidateIndex: 0,
          bestCandidateScore: 145,
          caretVisible: true,
          caretWindowPresent: true,
          detectedToolProfile: "codex"
        },
        privacy: {
          titleRedacted: true,
          elementNamesHashed: true,
          elementValuesNotRead: true,
          caretTextNotRead: true,
          promptTextNotRead: true
        }
      };
    },
    fillDesktopInput: async ({ selfTest, confirmForeground, allowClipboardFallback, allowTextPatternVerification, expectedTitleHash, expectedToolProfile, candidateIndex, text }) => {
      if (!selfTest && !confirmForeground) {
        assert.equal(allowClipboardFallback, false);
        assert.equal(allowTextPatternVerification, false);
        assert.equal(text, "M3 Guard Raw Text");
        return {
          schemaVersion: "m3-windows-fill@1",
          createdAt: new Date().toISOString(),
          platform: "win32",
          selfTest: false,
          confirmForeground: false,
          allowClipboardFallback: false,
          allowTextPatternVerification: false,
          pass: false,
          reason: "foreground_fill_requires_confirm_foreground",
          writeAttempted: false,
          verified: false,
          clipboardFallbackTried: false,
          clipboardRestored: false,
          supportedToolProfiles: ["codex", "claude-code", "hermes", "workbuddy", "trae"],
          privacy: {
            titleRedacted: true,
            elementNamesHashed: true,
            elementValuesNotReadBeforeWrite: true,
            writtenTextNotStored: true,
            clipboardTextNotStored: true,
            fallbackRequiresExplicitAllow: true,
            verificationUsesLengthAndHash: true,
            promptTextNotRead: true,
            autoSubmit: false
          }
        };
      }
      if (confirmForeground) {
        assert.equal(selfTest, false);
        assert.equal(allowClipboardFallback, true);
        assert.equal(allowTextPatternVerification, true);
        assert.equal(expectedTitleHash, "abc123");
        assert.equal(expectedToolProfile, "codex");
        assert.equal(candidateIndex, 0);
        assert.equal(text, "M3 Real Target Raw Text");
        return {
          schemaVersion: "m3-windows-fill@1",
          createdAt: new Date().toISOString(),
          platform: "win32",
          selfTest: false,
          confirmForeground: true,
          allowClipboardFallback: true,
          allowTextPatternVerification: true,
          pass: true,
          writeAttempted: true,
          verified: true,
          strategy: "clipboard_paste_fallback",
          uiaSetValueTried: false,
          clipboardFallbackTried: true,
          clipboardRestored: true,
          foreground: {
            processName: "WindowsTerminal",
            pidPresent: true,
            titleLength: 32,
            titleHash: "abc123",
            detectedToolProfile: "codex",
            expectedTitleHashMatched: true,
            expectedToolProfileMatched: true
          },
          target: {
            index: 0,
            controlType: "ControlType.Edit",
            classNameHash: "class-hash",
            hasValuePattern: true,
            hasTextPattern: false,
            hasNativeWindowHandle: true,
            titleLength: 32,
            titleHash: "abc123",
            boundingRect: { x: 1, y: 2, width: 320, height: 80 },
            inputSignals: {
              score: 145,
              hasKeyboardFocus: true,
              focusedElementMatch: true,
              caretWithinBounds: true,
              caretWindowMatch: true,
              cursorWithinBounds: true,
              nearWindowBottom: true,
              broadDocument: false,
              semanticComposerHint: true,
              profileComposerCandidate: true
            }
          },
          summary: {
            candidateCount: 1,
            safeCandidateCount: 1,
            focusedCandidateCount: 1,
            caretCandidateCount: 1,
            semanticCandidateCount: 1,
            bestCandidateIndex: 0,
            bestCandidateScore: 145,
            requestedTextLength: text.length,
            requestedTextHash: "real-request-hash",
            verifiedTextLength: text.length,
            verifiedTextHash: "real-request-hash",
            autoSubmit: false,
            submitSignalCount: 0
          },
          supportedToolProfiles: ["codex", "claude-code", "hermes", "workbuddy", "trae"],
          privacy: {
            titleRedacted: true,
            elementNamesHashed: true,
            elementValuesNotReadBeforeWrite: true,
            writtenTextNotStored: true,
            clipboardTextNotStored: true,
            fallbackRequiresExplicitAllow: true,
            verificationUsesLengthAndHash: true,
            promptTextNotRead: true,
            autoSubmit: false
          }
        };
      }
      assert.equal(selfTest, true);
      assert.equal(allowClipboardFallback, false);
      assert.equal(allowTextPatternVerification, false);
      assert.equal(text, "M3 Fill Raw Test Text");
      return {
        schemaVersion: "m3-windows-fill@1",
        createdAt: new Date().toISOString(),
        platform: "win32",
        selfTest,
        confirmForeground: false,
        allowClipboardFallback: false,
        allowTextPatternVerification: false,
        pass: true,
        writeAttempted: true,
        verified: true,
        strategy: "uia_value_pattern",
        uiaSetValueTried: true,
        clipboardFallbackTried: false,
        clipboardRestored: false,
        target: {
          controlType: "ControlType.Edit",
          classNameHash: "class-hash",
          hasValuePattern: true,
          titleLength: 34,
          titleHash: "title-hash"
        },
        summary: {
          requestedTextLength: text.length,
          requestedTextHash: "request-hash",
          verifiedTextLength: text.length,
          verifiedTextHash: "request-hash",
          autoSubmit: false,
          submitSignalCount: 0
        },
        supportedToolProfiles: ["codex", "claude-code", "hermes", "workbuddy", "trae"],
        privacy: {
          titleRedacted: true,
          elementNamesHashed: true,
          elementValuesNotReadBeforeWrite: true,
          writtenTextNotStored: true,
          clipboardTextNotStored: true,
          fallbackRequiresExplicitAllow: true,
          verificationUsesLengthAndHash: true,
          promptTextNotRead: true,
          autoSubmit: false
        }
      };
    }
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const health = await request(port, "GET", "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.authRequired, true);

    const unauthSettings = await request(port, "GET", "/settings");
    assert.equal(unauthSettings.status, 401);
    assert.equal(unauthSettings.body.error.code, "auth_required");

    const evilOptions = await rawRequest(port, "OPTIONS", "/settings", { Origin: EVIL_ORIGIN });
    assert.equal(evilOptions.status, 403);
    assert.notEqual(evilOptions.headers["access-control-allow-origin"], "*");

    const chatgptOptions = await rawRequest(port, "OPTIONS", "/generate", { Origin: TRUSTED_CHATGPT_ORIGIN });
    assert.equal(chatgptOptions.status, 403);
    assert.notEqual(chatgptOptions.headers["access-control-allow-origin"], TRUSTED_CHATGPT_ORIGIN);

    const chatgptBootstrap = await request(port, "GET", "/auth/bootstrap", null, "", { Origin: TRUSTED_CHATGPT_ORIGIN });
    assert.equal(chatgptBootstrap.status, 403);

    const localhostBootstrap = await request(port, "GET", "/auth/bootstrap", null, "", { Origin: "http://localhost:4444" });
    assert.equal(localhostBootstrap.status, 403);
    assert.equal(localhostBootstrap.body.error.code, "bootstrap_origin_not_allowed");
    assert.notEqual(localhostBootstrap.headers?.["access-control-allow-origin"], "http://localhost:4444");

    const localhostBootstrapPreflight = await rawRequest(port, "OPTIONS", "/auth/bootstrap", { Origin: "http://127.0.0.1:4444" });
    assert.equal(localhostBootstrapPreflight.status, 403);
    assert.notEqual(localhostBootstrapPreflight.headers["access-control-allow-origin"], "http://127.0.0.1:4444");

    const evilSettings = await request(port, "GET", "/settings", null, "bad-token", { Origin: EVIL_ORIGIN });
    assert.equal(evilSettings.status, 403);
    assert.notEqual(evilSettings.headers?.["access-control-allow-origin"], "*");

    const bootstrap = await request(port, "GET", "/auth/bootstrap", null, "", { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(bootstrap.status, 200);
    assert.ok(/^[a-f0-9]{64}$/.test(bootstrap.body.auth.token));
    assert.equal(bootstrap.body.auth.header, "Authorization");
    const authToken = bootstrap.body.auth.token;

    const options = await rawRequest(port, "OPTIONS", "/skills", { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(options.status, 200);
    assert.ok(options.headers["access-control-allow-methods"].includes("DELETE"));
    assert.ok(options.headers["access-control-allow-headers"].includes("Authorization"));
    assert.ok(options.headers["access-control-allow-headers"].includes("X-Smart-Prompt-Token"));
    assert.equal(options.headers["access-control-allow-origin"], TRUSTED_EXTENSION_ORIGIN);
    assert.notEqual(options.headers["access-control-allow-origin"], "*");

    const authed = (method, route, body, extraHeaders = {}) => request(port, method, route, body, authToken, extraHeaders);

    const publicSettingsResponse = await authed("GET", "/settings");
    assert.equal(publicSettingsResponse.status, 200);
    assert.ok(Object.values(publicSettingsResponse.body.settings.providerKeys).filter(Boolean).every((value) => value === "configured"));
    assert.equal(JSON.stringify(publicSettingsResponse.body).includes("sk-test-secret"), false);

    const invalidModelSettings = await authed("PUT", "/settings", {
      provider: "openai-compatible",
      model: "invalid model id"
    });
    assert.equal(invalidModelSettings.status, 400);
    assert.equal(invalidModelSettings.body.error.code, "model_invalid");
    const invalidCustomProviderSettings = await authed("PUT", "/settings", {
      provider: "custom",
      customProvider: {
        name: "Team Gateway",
        protocol: "unsupported",
        baseUrl: "https://gateway.example/v1",
        model: "private-model-v2"
      }
    });
    assert.equal(invalidCustomProviderSettings.status, 400);
    assert.equal(invalidCustomProviderSettings.body.error.code, "custom_provider_protocol_invalid");

    assert.equal(detectDesktopTool({ processName: "WindowsTerminal", windowTitle: "codex Smart Prompt" }).id, "codex");
    assert.equal(detectDesktopTool({ processName: "Code", windowTitle: "Claude Code" }).id, "claude-code");
    assert.equal(detectDesktopTool({ processName: "powershell", windowTitle: "Hermes console" }).id, "hermes");
    assert.equal(detectDesktopTool({ processName: "workbuddy", windowTitle: "workBuddy" }).id, "workbuddy");
    assert.equal(detectDesktopTool({ processName: "Trae", windowTitle: "Trae" }).id, "trae");
    assert.equal(detectDesktopTool({
      processName: "ChatGPT",
      windowTitle: "ChatGPT",
      executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.715.4045.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe"
    }).id, "codex");
    assert.equal(detectDesktopTool({
      processName: "ChatGPT",
      windowTitle: "ChatGPT",
      executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_26.715.4045.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe"
    }), null);
    assert.equal(detectDesktopTool({
      processName: "ChatGPT",
      windowTitle: "ChatGPT",
      executablePath: "C:\\tmp\\OpenAI.Codex_fake__2p2nqsd0c76g0\\app\\ChatGPT.exe"
    }), null);
    assert.equal(detectDesktopTool({ processName: "Code", windowTitle: "Plain workspace" }), null);

    const unsupportedMacSnapshot = createUnsupportedDesktopInputSnapshot("darwin");
    assert.equal(unsupportedMacSnapshot.platform, "darwin");
    assert.equal(unsupportedMacSnapshot.pass, false);
    assert.equal(unsupportedMacSnapshot.probeOk, false);
    assert.equal(unsupportedMacSnapshot.reason, UNSUPPORTED_DESKTOP_INPUT_REASON);
    assert.equal(unsupportedMacSnapshot.capability.supported, false);
    assert.equal(unsupportedMacSnapshot.capability.snapshotBackend, "none");
    assert.equal(unsupportedMacSnapshot.capability.fillBackend, "none");
    assert.equal(unsupportedMacSnapshot.capability.requiredPlatform, "win32");
    assert.equal(unsupportedMacSnapshot.capability.unsupportedReason, UNSUPPORTED_DESKTOP_INPUT_REASON);
    assert.ok(unsupportedMacSnapshot.capability.pendingBackends.includes("macos_axuielement"));
    assert.equal(unsupportedMacSnapshot.summary.candidateCount, 0);

    const unsupportedLinuxFill = createUnsupportedDesktopFillReport({ platform: "linux", selfTest: true });
    assert.equal(unsupportedLinuxFill.platform, "linux");
    assert.equal(unsupportedLinuxFill.selfTest, true);
    assert.equal(unsupportedLinuxFill.pass, false);
    assert.equal(unsupportedLinuxFill.writeAttempted, false);
    assert.equal(unsupportedLinuxFill.verified, false);
    assert.equal(unsupportedLinuxFill.reason, UNSUPPORTED_DESKTOP_INPUT_REASON);
    assert.equal(unsupportedLinuxFill.capability.supported, false);
    assert.equal(unsupportedLinuxFill.capability.snapshotBackend, "none");
    assert.equal(unsupportedLinuxFill.capability.fillBackend, "none");
    assert.equal(unsupportedLinuxFill.privacy.autoSubmit, false);

    const unauthDesktopSnapshot = await request(port, "GET", "/desktop/input-snapshot?selfTest=1");
    assert.equal(unauthDesktopSnapshot.status, 401);
    const desktopSnapshot = await authed("GET", "/desktop/input-snapshot?selfTest=1");
    assert.equal(desktopSnapshot.status, 200);
    assert.equal(desktopSnapshot.body.snapshot.schemaVersion, "m3-windows-uia@1");
    assert.equal(desktopSnapshot.body.snapshot.foreground.detectedToolProfile, "codex");
    assert.equal(desktopSnapshot.body.snapshot.foreground.isVisible, true);
    assert.equal(desktopSnapshot.body.snapshot.foreground.isMinimized, false);
    assert.equal(desktopSnapshot.body.snapshot.foreground.isCloaked, false);
    assert.equal(desktopSnapshot.body.snapshot.foreground.isUsable, true);
    assert.equal(desktopSnapshot.body.snapshot.foreground.boundingRect.width, 900);
    assert.deepEqual(desktopSnapshot.body.snapshot.supportedToolProfiles, ["codex", "claude-code", "hermes", "workbuddy", "trae"]);
    assert.equal(desktopSnapshot.body.snapshot.summary.candidateCount, 1);
    assert.equal(desktopSnapshot.body.snapshot.summary.safeCandidateCount, 1);
    assert.equal(desktopSnapshot.body.snapshot.summary.focusedCandidateCount, 1);
    assert.equal(desktopSnapshot.body.snapshot.summary.caretCandidateCount, 1);
    assert.equal(desktopSnapshot.body.snapshot.summary.semanticCandidateCount, 1);
    assert.equal(desktopSnapshot.body.snapshot.summary.bestCandidateIndex, 0);
    assert.equal(desktopSnapshot.body.snapshot.candidates[0].inputSignals.caretWithinBounds, true);
    assert.equal(desktopSnapshot.body.snapshot.candidates[0].inputSignals.cursorWithinBounds, true);
    assert.equal(desktopSnapshot.body.snapshot.candidates[0].inputSignals.focusedElementMatch, true);
    assert.equal(desktopSnapshot.body.snapshot.candidates[0].inputSignals.semanticComposerHint, true);
    assert.equal(desktopSnapshot.body.snapshot.candidates[0].inputSignals.profileComposerCandidate, true);
    assert.equal(desktopSnapshot.body.snapshot.privacy.titleRedacted, true);
    assert.equal(desktopSnapshot.body.snapshot.privacy.elementValuesNotRead, true);
    assert.equal(desktopSnapshot.body.snapshot.privacy.caretTextNotRead, true);
    assert.ok(!JSON.stringify(desktopSnapshot.body.snapshot).includes("codex Smart Prompt"));
    assert.ok(!JSON.stringify(desktopSnapshot.body.snapshot).includes("M3 UIA self test input"));

    const unauthDesktopFill = await request(port, "POST", "/desktop/fill?selfTest=1", { text: "M3 Fill Raw Test Text" });
    assert.equal(unauthDesktopFill.status, 401);
    const desktopFill = await authed("POST", "/desktop/fill?selfTest=1", { text: "M3 Fill Raw Test Text" });
    assert.equal(desktopFill.status, 200);
    assert.equal(desktopFill.body.fill.schemaVersion, "m3-windows-fill@1");
    assert.equal(desktopFill.body.fill.allowClipboardFallback, false);
    assert.equal(desktopFill.body.fill.pass, true);
    assert.equal(desktopFill.body.fill.writeAttempted, true);
    assert.equal(desktopFill.body.fill.verified, true);
    assert.equal(desktopFill.body.fill.summary.autoSubmit, false);
    assert.equal(desktopFill.body.fill.summary.submitSignalCount, 0);
    assert.deepEqual(desktopFill.body.fill.supportedToolProfiles, ["codex", "claude-code", "hermes", "workbuddy", "trae"]);
    assert.equal(desktopFill.body.fill.privacy.writtenTextNotStored, true);
    assert.equal(desktopFill.body.fill.privacy.clipboardTextNotStored, true);
    assert.equal(desktopFill.body.fill.privacy.fallbackRequiresExplicitAllow, true);
    assert.equal(desktopFill.body.fill.privacy.verificationUsesLengthAndHash, true);
    assert.equal(desktopFill.body.fill.privacy.autoSubmit, false);
    assert.ok(!JSON.stringify(desktopFill.body.fill).includes("M3 Fill Raw Test Text"));

    const unauthLatestDesktopFill = await request(port, "GET", "/desktop/fill/latest");
    assert.equal(unauthLatestDesktopFill.status, 401);
    const latestSelfTestFill = await authed("GET", "/desktop/fill/latest");
    assert.equal(latestSelfTestFill.status, 200);
    assert.equal(latestSelfTestFill.body.desktopFill.schemaVersion, "m3-desktop-fill-latest@1");
    assert.equal(latestSelfTestFill.body.desktopFill.fill.pass, true);
    assert.equal(latestSelfTestFill.body.desktopFill.fill.selfTest, true);
    assert.equal(latestSelfTestFill.body.desktopFill.fill.summary.requestedTextLength, "M3 Fill Raw Test Text".length);
    assert.equal(latestSelfTestFill.body.desktopFill.fill.summary.autoSubmit, false);
    assert.equal(latestSelfTestFill.body.desktopFill.fill.summary.submitSignalCount, 0);
    assert.ok(!JSON.stringify(latestSelfTestFill.body.desktopFill).includes("M3 Fill Raw Test Text"));

    const unauthDesktopPromptState = await request(port, "GET", "/desktop/prompt-state");
    assert.equal(unauthDesktopPromptState.status, 401);
    const desktopPromptState = await authed("POST", "/desktop/prompt-state", {
      source: "desktop-shell",
      draft: "M3 Desktop Draft Raw Text",
      prompt: "M3 Desktop Generated Raw Prompt",
      generatedBy: "template-fallback",
      noAutoSubmit: true,
      readiness: {
        profile: "workbuddy",
        titleHash: "desktop-title-hash",
        candidateIndex: 0,
        ready: true,
        overlayReady: true,
        readinessReason: "ready",
        overlayReadinessReason: "ready"
      }
    });
    assert.equal(desktopPromptState.status, 200);
    assert.equal(desktopPromptState.body.desktopPrompt.schemaVersion, "p25-desktop-prompt-state@1");
    assert.equal(desktopPromptState.body.desktopPrompt.prepared, true);
    assert.equal(desktopPromptState.body.desktopPrompt.activeTextKind, "generated");
    assert.equal(desktopPromptState.body.desktopPrompt.activeTextLength, "M3 Desktop Generated Raw Prompt".length);
    assert.ok(desktopPromptState.body.desktopPrompt.activeTextHash);
    assert.equal(desktopPromptState.body.desktopPrompt.readiness.profile, "workbuddy");
    assert.equal(desktopPromptState.body.desktopPrompt.readiness.noAutoSubmit, true);
    assert.equal(desktopPromptState.body.desktopPrompt.privacy.promptTextNotStored, true);
    assert.equal(desktopPromptState.body.desktopPrompt.privacy.onlyLengthAndHash, true);
    assert.ok(!JSON.stringify(desktopPromptState.body.desktopPrompt).includes("M3 Desktop Draft Raw Text"));
    assert.ok(!JSON.stringify(desktopPromptState.body.desktopPrompt).includes("M3 Desktop Generated Raw Prompt"));
    const latestDesktopPromptState = await authed("GET", "/desktop/prompt-state");
    assert.equal(latestDesktopPromptState.status, 200);
    assert.equal(latestDesktopPromptState.body.desktopPrompt.schemaVersion, "p25-desktop-prompt-state@1");
    assert.equal(latestDesktopPromptState.body.desktopPrompt.prepared, true);
    assert.equal(latestDesktopPromptState.body.desktopPrompt.activeTextHash, desktopPromptState.body.desktopPrompt.activeTextHash);
    assert.ok(!JSON.stringify(latestDesktopPromptState.body.desktopPrompt).includes("M3 Desktop Generated Raw Prompt"));

    const guardedFill = await authed("POST", "/desktop/fill", { text: "M3 Guard Raw Text" });
    assert.equal(guardedFill.status, 200);
    assert.equal(guardedFill.body.fill.pass, false);
    assert.equal(guardedFill.body.fill.writeAttempted, false);
    assert.equal(guardedFill.body.fill.reason, "foreground_fill_requires_confirm_foreground");
    assert.ok(!JSON.stringify(guardedFill.body.fill).includes("M3 Guard Raw Text"));

    const confirmedFill = await authed("POST", "/desktop/fill", {
      confirmForeground: true,
      expectedTitleHash: "abc123",
      expectedToolProfile: "codex",
      candidateIndex: 0,
      allowClipboardFallback: true,
      allowTextPatternVerification: true,
      text: "M3 Real Target Raw Text"
    });
    assert.equal(confirmedFill.status, 200);
    assert.equal(confirmedFill.body.fill.selfTest, false);
    assert.equal(confirmedFill.body.fill.confirmForeground, true);
    assert.equal(confirmedFill.body.fill.allowClipboardFallback, true);
    assert.equal(confirmedFill.body.fill.allowTextPatternVerification, true);
    assert.equal(confirmedFill.body.fill.pass, true);
    assert.equal(confirmedFill.body.fill.writeAttempted, true);
    assert.equal(confirmedFill.body.fill.strategy, "clipboard_paste_fallback");
    assert.equal(confirmedFill.body.fill.clipboardFallbackTried, true);
    assert.equal(confirmedFill.body.fill.clipboardRestored, true);
    assert.equal(confirmedFill.body.fill.foreground.expectedTitleHashMatched, true);
    assert.equal(confirmedFill.body.fill.foreground.expectedToolProfileMatched, true);
    assert.equal(confirmedFill.body.fill.target.index, 0);
    assert.equal(confirmedFill.body.fill.target.hasNativeWindowHandle, true);
    assert.equal(confirmedFill.body.fill.target.inputSignals.caretWithinBounds, true);
    assert.equal(confirmedFill.body.fill.target.inputSignals.cursorWithinBounds, true);
    assert.equal(confirmedFill.body.fill.target.inputSignals.focusedElementMatch, true);
    assert.equal(confirmedFill.body.fill.target.inputSignals.semanticComposerHint, true);
    assert.equal(confirmedFill.body.fill.target.inputSignals.profileComposerCandidate, true);
    assert.equal(confirmedFill.body.fill.summary.safeCandidateCount, 1);
    assert.equal(confirmedFill.body.fill.summary.semanticCandidateCount, 1);
    assert.equal(confirmedFill.body.fill.summary.bestCandidateIndex, 0);
    assert.equal(confirmedFill.body.fill.summary.autoSubmit, false);
    assert.equal(confirmedFill.body.fill.summary.submitSignalCount, 0);
    assert.ok(!JSON.stringify(confirmedFill.body.fill).includes("M3 Real Target Raw Text"));
    const latestConfirmedFill = await authed("GET", "/desktop/fill/latest");
    assert.equal(latestConfirmedFill.status, 200);
    assert.equal(latestConfirmedFill.body.desktopFill.fill.confirmForeground, true);
    assert.equal(latestConfirmedFill.body.desktopFill.fill.foreground.expectedTitleHashMatched, true);
    assert.equal(latestConfirmedFill.body.desktopFill.fill.foreground.expectedToolProfileMatched, true);
    assert.equal(latestConfirmedFill.body.desktopFill.fill.target.index, 0);
    assert.equal(latestConfirmedFill.body.desktopFill.fill.target.inputSignals.profileComposerCandidate, true);
    assert.equal(latestConfirmedFill.body.desktopFill.fill.summary.safeCandidateCount, 1);
    assert.equal(latestConfirmedFill.body.desktopFill.fill.summary.requestedTextHash, "real-request-hash");
    assert.equal(latestConfirmedFill.body.desktopFill.fill.privacy.writtenTextNotStored, true);
    assert.ok(!JSON.stringify(latestConfirmedFill.body.desktopFill).includes("M3 Real Target Raw Text"));

    const providers = await authed("GET", "/llm/providers");
    assert.equal(providers.status, 200);
    assert.ok(providers.body.providers.length >= 4);
    assert.ok(providers.body.providers.some((provider) => provider.provider === PROVIDERS.GEMINI && provider.usesStoredKey));

    const providerTest = await authed("POST", "/llm/test", { mode: MODE.IDEA });
    assert.equal(providerTest.status, 200);
    assert.equal(providerTest.body.generatedBy, "llm");
    assert.equal(providerTest.body.provider, PROVIDERS.GEMINI);
    assert.equal(providerTest.body.model, "gemini-test");
    assert.equal(providerTest.body.mode, MODE.IDEA);
    assert.ok(providerTest.body.promptLength > 0);
    assert.equal(providerTest.body.uploadWholePage, false);
    assert.equal(providerTest.body.autoSubmit, false);
    assert.ok(!Object.hasOwn(providerTest.body, "prompt"));
    assert.ok(!Object.hasOwn(providerTest.body, "card"));
    assert.equal(gatewayCalls[0].host, "local");
    assert.equal(gatewayCalls[0].inputKind, "first-run-provider-test");

    const activationAfterModelTest = await authed("GET", "/activation/status");
    assert.equal(activationAfterModelTest.status, 200);
    assert.equal(activationAfterModelTest.body.activation.progress, "model_ready");
    assert.equal(activationAfterModelTest.body.activation.runtimeHealth, "healthy");
    assert.equal(activationAfterModelTest.body.activation.nextAction, "open_chatgpt");
    const modelTestedAtMs = Date.parse(activationAfterModelTest.body.activation.modelTestedAt);
    const currentActivationEventId = `activation-verified_insert-${Math.max(Date.now(), modelTestedAtMs + 1)}`;
    const staleActivationEventId = `activation-verified_insert-${modelTestedAtMs - 1}`;

    const pageBrowserSeen = await authed("POST", "/activation/browser-seen", {
      contractVersion: "phase3-activation@1",
      site: "chatgpt"
    }, { Origin: TRUSTED_CHATGPT_ORIGIN });
    assert.equal(pageBrowserSeen.status, 403);
    assert.equal(pageBrowserSeen.body.error.code, "origin_not_allowed");

    const noOriginBrowserSeen = await authed("POST", "/activation/browser-seen", {
      contractVersion: "phase3-activation@1",
      site: "chatgpt"
    });
    assert.equal(noOriginBrowserSeen.status, 403);
    assert.equal(noOriginBrowserSeen.body.error.code, "activation_extension_origin_required");

    const browserSeen = await authed("POST", "/activation/browser-seen", {
      contractVersion: "phase3-activation@1",
      site: "chatgpt"
    }, { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(browserSeen.status, 200);
    assert.equal(browserSeen.body.activation.progress, "awaiting_first_loop");

    const staleActivationComplete = await authed("POST", "/activation/complete", {
      contractVersion: "phase3-activation@1",
      eventId: staleActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }, { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(staleActivationComplete.status, 400);
    assert.equal(staleActivationComplete.body.error.code, "invalid_activation_event_id");

    const invalidActivationComplete = await authed("POST", "/activation/complete", {
      contractVersion: "phase3-activation@1",
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: false
    }, { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(invalidActivationComplete.status, 400);
    assert.equal(invalidActivationComplete.body.error.code, "invalid_activation_completion_evidence");

    const missingTargetActivationComplete = await authed("POST", "/activation/complete", {
      contractVersion: "phase3-activation@1",
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      verified: true
    }, { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(missingTargetActivationComplete.status, 400);
    assert.equal(missingTargetActivationComplete.body.error.code, "invalid_activation_completion_evidence");

    const staleExtensionActivationComplete = await authed("POST", "/activation/complete", {
      contractVersion: "phase3-activation@1",
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-stale",
      verified: true
    }, { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(staleExtensionActivationComplete.status, 400);
    assert.equal(staleExtensionActivationComplete.body.error.code, "invalid_activation_completion_evidence");

    const activationComplete = await authed("POST", "/activation/complete", {
      contractVersion: "phase3-activation@1",
      eventId: currentActivationEventId,
      site: "chatgpt",
      completionKind: "verified_insert",
      targetKind: "chatgpt-composer",
      stableReadback: true,
      extensionBuildId: "phase3-extension-20260717-r5",
      verified: true
    }, { Origin: TRUSTED_EXTENSION_ORIGIN });
    assert.equal(activationComplete.status, 200);
    assert.equal(activationComplete.body.activation.progress, "activated");
    assert.equal(activationComplete.body.activation.completionVerified, true);

    const runtimeRepair = await authed("POST", "/activation/runtime-health", {
      runtimeHealth: "needs_repair",
      errorCode: "network_unavailable"
    });
    assert.equal(runtimeRepair.status, 200);
    assert.equal(runtimeRepair.body.activation.progress, "activated");
    assert.equal(runtimeRepair.body.activation.runtimeHealth, "needs_repair");
    assert.equal(runtimeRepair.body.activation.lastErrorCode, "network_unavailable");

    const runtimeHealthy = await authed("POST", "/activation/runtime-health", {
      runtimeHealth: "healthy"
    });
    assert.equal(runtimeHealthy.status, 200);
    assert.equal(runtimeHealthy.body.activation.progress, "activated");
    assert.equal(runtimeHealthy.body.activation.runtimeHealth, "healthy");

    const activationReset = await authed("POST", "/activation/reset", {});
    assert.equal(activationReset.status, 200);
    assert.equal(activationReset.body.activation.progress, "not_started");
    const providersAfterActivationReset = await authed("GET", "/llm/providers");
    assert.equal(providersAfterActivationReset.status, 200);
    assert.ok(providersAfterActivationReset.body.providers.some((provider) =>
      provider.provider === PROVIDERS.GEMINI && provider.usesStoredKey
    ));

    const rec = await authed("POST", "/skills/recommend", {
      input: "登录权限和隐私检查",
      context: { tool: "ChatGPT", host: "chatgpt.com" }
    });
    assert.equal(rec.status, 200);
    assert.ok(rec.body.skills.length >= 1 && rec.body.skills.length <= 3);

    const searchSkills = await authed("GET", "/search?kind=skills&q=privacy");
    assert.equal(searchSkills.status, 200);
    assert.equal(searchSkills.body.prompts.length, 0);
    assert.ok(searchSkills.body.skills.some((skill) => skill.name === "security-review"));

    const deletedSkill = await authed("DELETE", `/skills/${encodeURIComponent(imported[0].id)}`);
    assert.equal(deletedSkill.status, 200);
    assert.ok(!deletedSkill.body.skills.some((skill) => skill.id === imported[0].id));

    const missingSkill = await authed("DELETE", "/skills/not-found");
    assert.equal(missingSkill.status, 404);
    assert.equal(missingSkill.body.error.code, "skill_not_found");

    const emptyPrompt = await authed("POST", "/prompts", {
      title: "Empty",
      body: ""
    });
    assert.equal(emptyPrompt.status, 400);
    assert.equal(emptyPrompt.body.error.code, "empty_prompt");

    const savedPrompt = await authed("POST", "/prompts", {
      title: "CRM prompt",
      body: "Build a CRM prompt with acceptance criteria.",
      mode: MODE.CONTINUE,
      tags: ["crm", "acceptance"],
      context: { tool: "ChatGPT" }
    });
    assert.equal(savedPrompt.status, 200);
    assert.equal(savedPrompt.body.prompt.title, "CRM prompt");
    assert.equal(savedPrompt.body.prompt.mode, MODE.CONTINUE);
    assert.ok(savedPrompt.body.prompt.bodyHash);

    const duplicatePrompt = await authed("POST", "/prompts", {
      title: "CRM prompt duplicate",
      body: "Build a CRM prompt with acceptance criteria.",
      mode: MODE.CONTINUE
    });
    assert.equal(duplicatePrompt.status, 200);
    assert.equal(duplicatePrompt.body.prompts.length, 1);
    assert.equal(duplicatePrompt.body.prompt.id, savedPrompt.body.prompt.id);

    const promptList = await authed("GET", "/prompts");
    assert.equal(promptList.status, 200);
    assert.equal(promptList.body.prompts.length, 1);
    assert.equal(promptList.body.prompts[0].body, "Build a CRM prompt with acceptance criteria.");

    const searchAll = await authed("GET", "/search?q=crm");
    assert.equal(searchAll.status, 200);
    assert.equal(searchAll.body.prompts.length, 1);
    assert.ok(Array.isArray(searchAll.body.skills));

    const searchPromptsOnly = await authed("GET", "/search?kind=prompts&q=acceptance");
    assert.equal(searchPromptsOnly.body.prompts.length, 1);
    assert.equal(searchPromptsOnly.body.skills.length, 0);

    const qualityGeneration = {
      generationId: "generation-test-chatgpt-1",
      strategyId: "llm:continue:medium:reduce-retry",
      generatedBy: "llm",
      qualityScore: 0.82,
      feedbackConfidence: "medium",
      promptStrategyId: "reduce_retry",
      promptStrategyVersion: "v6-strategy-policy-3",
      experimentVersion: "v6-prompt-experiment-1",
      experimentArm: "strategy_guided",
      experimentEligible: true,
      experimentBucket: 17,
      experimentComparisonKey: "v6-prompt-experiment-1-continue-chatgpt-security-review",
      strategyInsightsVersion: "v6-strategy-insights-1",
      strategyReadiness: "exploring",
      strategyWeightVersion: "v6-strategy-weighting-1",
      strategyWeightStatus: "collecting",
      strategyWeightPromoted: "",
      strategyWeightSuppressed: "",
      strategyWeightDecision: "guardrail",
      qualityLiftCohort: "strategy_guided",
      taskScenario: "security-review",
      promptLength: 42
    };
    const metric = await authed("POST", "/metrics", {
      action: "insert",
      mode: MODE.CONTINUE,
      tool: "ChatGPT",
      adapterId: "chatgpt",
      site: "chatgpt.com",
      ...qualityGeneration,
      insertStrategy: "contenteditable-or-textarea",
      kind: "contenteditable",
      verified: true,
      ok: true,
      adopted: true,
      prompt: "should not be persisted"
    });
    assert.equal(metric.status, 200);
    assert.equal(metric.body.metric.action, "insert");
    assert.equal(metric.body.metric.adapterId, "chatgpt");
    assert.equal(metric.body.metric.site, "chatgpt.com");
    assert.equal(metric.body.metric.taskScenario, "security-review");
    assert.equal(metric.body.metric.experimentArm, "strategy_guided");
    assert.equal(metric.body.metric.experimentComparisonKey, "v6-prompt-experiment-1-continue-chatgpt-security-review");
    assert.equal(metric.body.metric.strategyWeightVersion, "v6-strategy-weighting-1");
    assert.equal(metric.body.metric.qualityLiftCohort, "strategy_guided");
    assert.equal(metric.body.metrics.insertSuccessRate, 1);
    assert.ok(!JSON.stringify(metric.body.metrics).includes("should not be persisted"));

    await authed("POST", "/metrics", {
      action: "card_ready",
      mode: MODE.CONTINUE,
      tool: "ChatGPT",
      adapterId: "chatgpt",
      site: "chatgpt.com",
      ...qualityGeneration,
      ok: true,
      verified: true
    });
    await authed("POST", "/metrics", {
      action: "insert",
      mode: MODE.CONTINUE,
      tool: "DeepSeek",
      adapterId: "deepseek",
      site: "chat.deepseek.com",
      generationId: "generation-test-deepseek-1",
      strategyId: "template-fallback:continue:medium:adapter-insert-risk",
      generatedBy: "template-fallback",
      qualityScore: 0.76,
      feedbackConfidence: "medium",
      promptStrategyId: "baseline_structure",
      promptStrategyVersion: "v6-strategy-policy-3",
      experimentVersion: "v6-prompt-experiment-1",
      experimentArm: "baseline_structure",
      experimentEligible: true,
      experimentBucket: 71,
      experimentComparisonKey: "v6-prompt-experiment-1-continue-chatgpt-security-review",
      strategyInsightsVersion: "v6-strategy-insights-1",
      strategyReadiness: "collecting",
      taskScenario: "security-review",
      promptLength: 64,
      insertStrategy: "textarea-first",
      ok: false,
      adopted: false,
      verified: false,
      failureReason: "after_write_mismatch"
    });
    await authed("POST", "/metrics", { action: "save", mode: MODE.CONTINUE, tool: "ChatGPT", adapterId: "chatgpt", site: "chatgpt.com", ...qualityGeneration, ok: true });
    await authed("POST", "/metrics", { action: "retry", mode: MODE.CONTINUE, tool: "ChatGPT", adapterId: "chatgpt", site: "chatgpt.com", ...qualityGeneration, ok: false });
    await authed("POST", "/metrics", { action: "undo", mode: MODE.CONTINUE, tool: "ChatGPT", adapterId: "chatgpt", site: "chatgpt.com", ...qualityGeneration, ok: true, verified: true });
    await authed("POST", "/metrics", { action: "outcome", mode: MODE.CONTINUE, tool: "ChatGPT", adapterId: "chatgpt", site: "chatgpt.com", ...qualityGeneration, ok: true, outcomeLabel: "success", outcomeScore: 0.92, outcomeVerified: true, outcomeSource: "manual" });

    const metrics = await authed("GET", "/metrics");
    assert.equal(metrics.body.metrics.insertSuccessRate, 0.5);
    assert.equal(metrics.body.metrics.adapterFailureRate, 0.5);
    assert.equal(metrics.body.metrics.saveRate, 1);
    assert.equal(metrics.body.metrics.retryUsageRate, 1);
    assert.equal(metrics.body.metrics.undoUsageRate, 0.5);
    assert.equal(metrics.body.metrics.outcomeSuccessRate, 1);
    assert.equal(metrics.body.metrics.avgOutcomeScore, 0.92);
    assert.equal(metrics.body.metrics.byAdapter.chatgpt.verifiedInserts, 1);
    assert.equal(metrics.body.metrics.byAdapter.deepseek.failures, 1);
    assert.equal(metrics.body.metrics.failureReasons.after_write_mismatch, 1);
    assert.equal(metrics.body.metrics.failureReasonTokens.insert_failed, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].events, 6);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].verifiedInserts, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].insertSuccessRate, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].saveRate, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].retryUsageRate, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].undoUsageRate, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].avgQualityScore, 0.82);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].outcomes, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].successfulOutcomes, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].outcomeSuccessRate, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].avgOutcomeScore, 0.92);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].outcomeLabels.success, 1);
    assert.equal(metrics.body.metrics.byStrategy[qualityGeneration.strategyId].scenarios["security-review"], 6);
    assert.equal(metrics.body.metrics.byStrategy["template-fallback:continue:medium:adapter-insert-risk"].failures, 1);
    assert.equal(metrics.body.metrics.byStrategy["template-fallback:continue:medium:adapter-insert-risk"].failureReasonTokens.insert_failed, 1);
    assert.equal(metrics.body.metrics.byExperimentArm.strategy_guided.events, 6);
    assert.equal(metrics.body.metrics.byExperimentArm.strategy_guided.verifiedInserts, 1);
    assert.equal(metrics.body.metrics.byExperimentArm.strategy_guided.insertSuccessRate, 1);
    assert.equal(metrics.body.metrics.byExperimentArm.strategy_guided.saveRate, 1);
    assert.equal(metrics.body.metrics.byExperimentArm.strategy_guided.promptStrategyIds.reduce_retry, 6);
    assert.equal(metrics.body.metrics.byExperimentArm.baseline_structure.failures, 1);
    assert.equal(metrics.body.metrics.byQualityLiftCohort.strategy_guided.events, 6);
    assert.equal(metrics.body.metrics.byQualityLiftCohort.strategy_guided.strategyWeightVersions["v6-strategy-weighting-1"], 6);
    assert.equal(metrics.body.metrics.byQualityLiftCohort.baseline_structure.failures, 1);
    assert.equal(metrics.body.metrics.byScenario["security-review"].events, 7);
    assert.equal(metrics.body.metrics.byScenario["security-review"].insertAttempts, 2);
    assert.equal(metrics.body.metrics.byScenario["security-review"].verifiedInserts, 1);
    assert.equal(metrics.body.metrics.byScenario["security-review"].outcomes, 1);
    assert.equal(metrics.body.metrics.byScenario["security-review"].outcomeSuccessRate, 1);
    assert.equal(metrics.body.metrics.byScenarioStrategy["security-review"][qualityGeneration.strategyId].events, 6);
    assert.equal(metrics.body.metrics.byScenarioStrategy["security-review"][qualityGeneration.strategyId].outcomes, 1);
    assert.equal(metrics.body.metrics.byScenarioExperimentArm["security-review"].strategy_guided.events, 6);
    assert.equal(metrics.body.metrics.byScenarioExperimentArm["security-review"].baseline_structure.failures, 1);
    assert.ok(!JSON.stringify(metrics.body.metrics).includes("should not be persisted"));

    const strategyInsights = await authed("GET", "/metrics/strategy-insights?mode=continue&tool=ChatGPT&adapterId=chatgpt&site=chatgpt.com&taskScenario=security-review");
    assert.equal(strategyInsights.status, 200);
    assert.equal(strategyInsights.body.strategyInsights.schemaVersion, "v6-prompt-quality@1");
    assert.equal(strategyInsights.body.strategyInsights.insightVersion, "v6-strategy-insights@1");
    assert.equal(strategyInsights.body.strategyInsights.strategyPolicy.version, "v6-strategy-policy@3");
    assert.equal(strategyInsights.body.strategyInsights.cohort.taskScenario, "security-review");
    assert.equal(strategyInsights.body.strategyInsights.readiness.status, "exploring");
    assert.equal(strategyInsights.body.strategyInsights.readiness.sampleThresholdMet, false);
    assert.ok(strategyInsights.body.strategyInsights.topStrategies.some((item) => item.strategyId === qualityGeneration.strategyId && item.decisionHint === "explore_candidate"));
    assert.ok(strategyInsights.body.strategyInsights.riskSignals.some((item) => item.strategyId === qualityGeneration.strategyId));
    assert.ok(strategyInsights.body.strategyInsights.recommendations.some((item) => item.key === "explore_promising_strategy"));
    assert.ok(strategyInsights.body.strategyInsights.recommendations.some((item) => item.key === "avoid_risky_strategy"));
    assert.ok(strategyInsights.body.strategyInsights.cohorts.sites.some((item) => item.key === "chatgpt.com"));
    assert.ok(strategyInsights.body.strategyInsights.cohorts.scenarios.some((item) => item.key === "security-review"));
    assert.equal(strategyInsights.body.strategyInsights.privacy.derivedFromAggregateStrategyMetrics, true);
    assert.ok(/readiness=exploring/.test(strategyInsights.body.strategyInsightsText));
    assert.ok(/scenario:security-review/.test(strategyInsights.body.strategyInsightsText));
    assert.ok(!JSON.stringify(strategyInsights.body).includes("should not be persisted"));

    const experimentOutcomes = await authed("GET", "/metrics/experiment-outcomes?mode=continue&tool=ChatGPT&adapterId=chatgpt&site=chatgpt.com&taskScenario=security-review");
    assert.equal(experimentOutcomes.status, 200);
    assert.equal(experimentOutcomes.body.experimentOutcomeReport.schemaVersion, "v6-prompt-quality@1");
    assert.equal(experimentOutcomes.body.experimentOutcomeReport.experimentVersion, "v6-prompt-experiment@1");
    assert.equal(experimentOutcomes.body.experimentOutcomeReport.cohort.taskScenario, "security-review");
    assert.equal(experimentOutcomes.body.experimentOutcomeReport.readiness.status, "collecting");
    assert.ok(experimentOutcomes.body.experimentOutcomeReport.arms.some((item) => item.arm === "strategy_guided"));
    assert.ok(experimentOutcomes.body.experimentOutcomeReport.arms.some((item) => item.arm === "baseline_structure"));
    assert.equal(experimentOutcomes.body.experimentOutcomeReport.privacy.derivedFromAggregateExperimentMetrics, true);
    assert.ok(/privacy=aggregate-only/.test(experimentOutcomes.body.experimentOutcomeText));
    assert.ok(/scenario=security-review/.test(experimentOutcomes.body.experimentOutcomeText));
    assert.ok(!JSON.stringify(experimentOutcomes.body).includes("should not be persisted"));

    const taskOutcomes = await authed("GET", "/metrics/task-outcomes?mode=continue&tool=ChatGPT&adapterId=chatgpt&site=chatgpt.com&taskScenario=security-review");
    assert.equal(taskOutcomes.status, 200);
    assert.equal(taskOutcomes.body.taskOutcomeReport.reportVersion, "v6-task-outcome@1");
    assert.equal(taskOutcomes.body.taskOutcomeReport.cohort.taskScenario, "security-review");
    assert.equal(taskOutcomes.body.taskOutcomeReport.readiness.status, "collecting");
    assert.equal(taskOutcomes.body.taskOutcomeReport.readiness.outcomeCount, 1);
    assert.ok(taskOutcomes.body.taskOutcomeReport.topOutcomeStrategies.some((item) => item.strategyId === qualityGeneration.strategyId && item.outcomeSuccessRate === 1));
    assert.equal(taskOutcomes.body.taskOutcomeReport.privacy.derivedFromAggregateTaskOutcomes, true);
    assert.ok(/taskOutcome=v6-task-outcome@1/.test(taskOutcomes.body.taskOutcomeText));
    assert.ok(/scenario=security-review/.test(taskOutcomes.body.taskOutcomeText));
    assert.ok(/privacy=aggregate-only/.test(taskOutcomes.body.taskOutcomeText));
    assert.ok(!JSON.stringify(taskOutcomes.body).includes("should not be persisted"));

    const pilotOutcomes = await authed("GET", "/metrics/pilot-outcomes");
    assert.equal(pilotOutcomes.status, 200);
    assert.equal(pilotOutcomes.body.pilotOutcomeReadinessReport.reportVersion, "v6-pilot-outcome-readiness@1");
    assert.equal(pilotOutcomes.body.pilotOutcomeReadinessReport.readiness.status, "collecting");
    assert.equal(pilotOutcomes.body.pilotOutcomeReadinessReport.readiness.totalOutcomeEvents, 1);
    assert.ok(pilotOutcomes.body.pilotOutcomeReadinessReport.byTaskScenario.some((item) => item.key === "security-review" && item.status === "collecting" && item.outcomeCount === 1));
    assert.ok(pilotOutcomes.body.pilotOutcomeReadinessReport.byTool.some((item) => item.key === "chatgpt" && item.outcomeCount === 1));
    assert.ok(pilotOutcomes.body.pilotOutcomeReadinessReport.bySite.some((item) => item.key === "chatgpt.com" && item.outcomeCount === 1));
    assert.ok(pilotOutcomes.body.pilotOutcomeReadinessReport.byMode.some((item) => item.key === "continue" && item.outcomeCount === 1));
    assert.ok(pilotOutcomes.body.pilotOutcomeReadinessReport.byStrategy.some((item) => item.key === qualityGeneration.strategyId && item.outcomeCount === 1));
    assert.ok(pilotOutcomes.body.pilotOutcomeReadinessReport.collectionTargets.some((item) => item.dimension === "taskScenario" && item.key === "security-review" && item.neededOutcomeEvents === 2));
    assert.equal(pilotOutcomes.body.pilotOutcomeReadinessReport.privacy.aggregateOnly, true);
    assert.ok(/pilotOutcome=v6-pilot-outcome-readiness@1/.test(pilotOutcomes.body.pilotOutcomeReadinessText));
    assert.ok(/privacy=aggregate-only/.test(pilotOutcomes.body.pilotOutcomeReadinessText));
    assert.ok(!JSON.stringify(pilotOutcomes.body).includes("should not be persisted"));

    const strategyWeights = await authed("GET", "/metrics/strategy-weights?mode=continue&tool=ChatGPT&adapterId=chatgpt&site=chatgpt.com&taskScenario=security-review");
    assert.equal(strategyWeights.status, 200);
    assert.equal(strategyWeights.body.strategyWeightPolicy.weightPolicyVersion, "v6-strategy-weighting@1");
    assert.equal(strategyWeights.body.strategyWeightPolicy.pilotOutcomeVersion, "v6-pilot-outcome-readiness@1");
    assert.equal(strategyWeights.body.strategyWeightPolicy.readiness.status, "collecting");
    assert.equal(strategyWeights.body.strategyWeightPolicy.readiness.totalOutcomeEvents, 1);
    assert.ok(strategyWeights.body.strategyWeightPolicy.exploringStrategies.some((item) => item.strategyId === qualityGeneration.strategyId && item.outcomeCount === 1));
    assert.equal(strategyWeights.body.strategyWeightPolicy.privacy.aggregateOnly, true);
    assert.ok(/strategyWeight=v6-strategy-weighting@1/.test(strategyWeights.body.strategyWeightText));
    assert.ok(/privacy=aggregate-only/.test(strategyWeights.body.strategyWeightText));
    assert.ok(!JSON.stringify(strategyWeights.body).includes("should not be persisted"));

    const promptQualityLift = await authed("GET", "/metrics/prompt-quality-lift?mode=continue&tool=ChatGPT&adapterId=chatgpt&site=chatgpt.com&taskScenario=security-review");
    assert.equal(promptQualityLift.status, 200);
    assert.equal(promptQualityLift.body.promptQualityLiftReport.reportVersion, "v6-quality-lift@1");
    assert.equal(promptQualityLift.body.promptQualityLiftReport.readiness.status, "collecting");
    assert.equal(promptQualityLift.body.promptQualityLiftReport.readiness.strategyGuidedOutcomeCount, 1);
    assert.ok(promptQualityLift.body.promptQualityLiftReport.cohorts.some((item) => item.cohort === "strategy_guided" && item.outcomeCount === 1));
    assert.ok(promptQualityLift.body.promptQualityLiftReport.cohorts.some((item) => item.cohort === "baseline_structure"));
    assert.equal(promptQualityLift.body.promptQualityLiftReport.privacy.aggregateOnly, true);
    assert.ok(/qualityLift=v6-quality-lift@1/.test(promptQualityLift.body.promptQualityLiftText));
    assert.ok(/privacy=aggregate-only/.test(promptQualityLift.body.promptQualityLiftText));
    assert.ok(!JSON.stringify(promptQualityLift.body).includes("should not be persisted"));

    const promptQualityLiftSegments = await authed("GET", "/metrics/prompt-quality-lift-segments?taskScenario=security-review");
    assert.equal(promptQualityLiftSegments.status, 200);
    assert.equal(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.reportVersion, "v6-quality-lift-segments@1");
    assert.ok(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.dimensions.includes("tool"));
    assert.ok(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.dimensions.includes("site"));
    assert.ok(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.dimensions.includes("taskScenario"));
    assert.ok(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.dimensions.includes("mode"));
    assert.ok(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.segmentsByDimension.tool.some((item) => item.key === "chatgpt" && item.readinessStatus === "collecting"));
    assert.ok(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.segmentsByDimension.site.some((item) => item.key === "chatgpt.com"));
    assert.ok(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.segmentsByDimension.taskScenario.some((item) => item.key === "security-review"));
    assert.equal(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.privacy.aggregateOnly, true);
    assert.equal(promptQualityLiftSegments.body.promptQualityLiftSegmentsReport.privacy.segmentMetadataOnly, true);
    assert.ok(/qualityLiftSegments=v6-quality-lift-segments@1/.test(promptQualityLiftSegments.body.promptQualityLiftSegmentsText));
    assert.ok(/privacy=aggregate-only/.test(promptQualityLiftSegments.body.promptQualityLiftSegmentsText));
    assert.ok(!JSON.stringify(promptQualityLiftSegments.body).includes("should not be persisted"));

    const selfImprovement = await authed("GET", "/learning/reflections?mode=continue&tool=ChatGPT&adapterId=chatgpt&site=chatgpt.com&taskScenario=security-review");
    assert.equal(selfImprovement.status, 200);
    assert.equal(selfImprovement.body.selfImprovementReport.reportVersion, "v6-self-improvement@1");
    assert.equal(selfImprovement.body.selfImprovementReport.privacy.aggregateOnly, true);
    assert.equal(selfImprovement.body.selfImprovementReport.privacy.noAutomaticMutation, true);
    assert.ok(selfImprovement.body.selfImprovementReport.readiness.reflectionCount >= 1);
    assert.ok(selfImprovement.body.selfImprovementReport.reflections.some((item) => item.type === "collecting"));
    assert.ok(/selfImprovement=v6-self-improvement@1/.test(selfImprovement.body.selfImprovementText));
    assert.ok(/manual-review-required/.test(selfImprovement.body.selfImprovementText));
    assert.ok(!JSON.stringify(selfImprovement.body).includes("should not be persisted"));

    const evolutionCandidates = await authed("GET", "/learning/evolution-candidates?mode=continue&tool=ChatGPT&adapterId=chatgpt&site=chatgpt.com&taskScenario=security-review");
    assert.equal(evolutionCandidates.status, 200);
    assert.equal(evolutionCandidates.body.evolutionCandidateReport.candidateVersion, "v6-evolution-candidates@1");
    assert.equal(evolutionCandidates.body.evolutionCandidateReport.sourceReportVersion, "v6-self-improvement@1");
    assert.equal(evolutionCandidates.body.evolutionCandidateReport.mutationAllowed, false);
    assert.equal(evolutionCandidates.body.evolutionCandidateReport.automaticPromotion, false);
    assert.equal(evolutionCandidates.body.evolutionCandidateReport.requiresCritic, true);
    assert.equal(evolutionCandidates.body.evolutionCandidateReport.promotionMode, "manual_review_required");
    assert.ok(evolutionCandidates.body.evolutionCandidateReport.candidates.some((item) => item.action === "collect_more_samples"));
    assert.ok(/evolutionCandidates=v6-evolution-candidates@1/.test(evolutionCandidates.body.evolutionCandidateText));
    assert.ok(/mutationAllowed=false/.test(evolutionCandidates.body.evolutionCandidateText));
    assert.ok(!JSON.stringify(evolutionCandidates.body).includes("should not be persisted"));

    const backup = await authed("GET", "/data/backup");
    assert.equal(backup.status, 200);
    assert.equal(backup.body.backup.schemaVersion, DATA_SCHEMA_VERSION);
    assert.equal(backup.body.backup.prompts.length, 1);
    assert.equal(backup.body.backup.metrics.length, 7);
    assert.ok(!JSON.stringify(backup.body.backup.settings).includes("provider-secret"));

    const diagnostics = await authed("GET", "/diagnostics/export");
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.diagnostics.diagnostics, true);
    assert.equal(Object.hasOwn(diagnostics.body.diagnostics, "dataDir"), false);
    assert.equal(diagnostics.body.diagnostics.dataDirConfigured, true);
    assert.equal(diagnostics.body.diagnostics.portRecovery.portRecovery, true);
    assert.ok(Object.hasOwn(diagnostics.body.diagnostics.keyMigration, "migrateProviderKeys"));
    assert.equal(diagnostics.body.diagnostics.counts.prompts, 1);
    assert.equal(diagnostics.body.diagnostics.metrics.insertSuccessRate, 0.5);
    assert.equal(diagnostics.body.diagnostics.strategyInsights.insightVersion, "v6-strategy-insights@1");
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.strategyInsightsText));
    assert.equal(diagnostics.body.diagnostics.experimentOutcomeReport.experimentVersion, "v6-prompt-experiment@1");
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.experimentOutcomeText));
    assert.equal(diagnostics.body.diagnostics.taskOutcomeReport.reportVersion, "v6-task-outcome@1");
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.taskOutcomeText));
    assert.equal(diagnostics.body.diagnostics.pilotOutcomeReadinessReport.reportVersion, "v6-pilot-outcome-readiness@1");
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.pilotOutcomeReadinessText));
    assert.equal(diagnostics.body.diagnostics.strategyWeightPolicy.weightPolicyVersion, "v6-strategy-weighting@1");
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.strategyWeightText));
    assert.equal(diagnostics.body.diagnostics.promptQualityLiftReport.reportVersion, "v6-quality-lift@1");
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.promptQualityLiftText));
    assert.equal(diagnostics.body.diagnostics.promptQualityLiftSegmentsReport.reportVersion, "v6-quality-lift-segments@1");
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.promptQualityLiftSegmentsText));
    assert.equal(diagnostics.body.diagnostics.qualityLiftSegmentPolicy.policyVersion, "v6-quality-lift-segment-policy@1");
    assert.ok(/qualityLiftSegmentPolicy=v6-quality-lift-segment-policy@1/.test(diagnostics.body.diagnostics.qualityLiftSegmentText));
    assert.ok(/aggregate-only/.test(diagnostics.body.diagnostics.qualityLiftSegmentText));
    assert.equal(diagnostics.body.diagnostics.failureReasonReport.reportVersion, "v6-failure-reasons@1");
    assert.ok(/failureReasons=v6-failure-reasons@1/.test(diagnostics.body.diagnostics.failureReasonText));
    assert.equal(diagnostics.body.diagnostics.failureReasonPolicy.policyVersion, "v6-failure-reason-policy@1");
    assert.ok(/failureReasonPolicy=v6-failure-reason-policy@1/.test(diagnostics.body.diagnostics.failureReasonPolicyText));
    assert.ok(/raw-reason-not-stored/.test(diagnostics.body.diagnostics.failureReasonPolicyText));
    assert.equal(diagnostics.body.diagnostics.selfImprovementReport.reportVersion, "v6-self-improvement@1");
    assert.ok(/selfImprovement=v6-self-improvement@1/.test(diagnostics.body.diagnostics.selfImprovementText));
    assert.equal(diagnostics.body.diagnostics.selfImprovementReport.privacy.noAutomaticMutation, true);
    assert.equal(diagnostics.body.diagnostics.evolutionCandidateReport.candidateVersion, "v6-evolution-candidates@1");
    assert.ok(/evolutionCandidates=v6-evolution-candidates@1/.test(diagnostics.body.diagnostics.evolutionCandidateText));
    assert.equal(diagnostics.body.diagnostics.evolutionCandidateReport.mutationAllowed, false);
    assert.equal(diagnostics.body.diagnostics.evolutionCandidateReport.requiresCritic, true);
    assert.ok(!JSON.stringify(diagnostics.body.diagnostics.strategyInsights).includes("should not be persisted"));

    const deletedPrompt = await authed("DELETE", `/prompts/${encodeURIComponent(savedPrompt.body.prompt.id)}`);
    assert.equal(deletedPrompt.status, 200);
    assert.equal(deletedPrompt.body.prompts.length, 0);

    const restored = await authed("POST", "/data/restore", { backup: backup.body.backup });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.restored.schemaVersion, DATA_SCHEMA_VERSION);
    assert.equal(restored.body.restored.prompts, 1);

    const restoredPromptList = await authed("GET", "/prompts");
    assert.equal(restoredPromptList.body.prompts.length, 1);
    assert.equal(restoredPromptList.body.prompts[0].bodyHash, savedPrompt.body.prompt.bodyHash);

    const modeSamples = [
      { mode: MODE.IDEA, input: "" },
      { mode: MODE.CONTINUE, input: "Build a CRM with customer list and follow-up notes." },
      { mode: MODE.POLISH, input: "Goal: refactor login\nContext: Next.js app\nConstraints: keep API unchanged\nOutput: patch and tests\nAcceptance: tests pass" }
    ];

    for (const sample of modeSamples) {
      const generatedResponse = await authed("POST", "/generate", {
        input: sample.input,
        mode: sample.mode,
        context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" },
        allowTemplateFallback: false
      });
      assert.equal(generatedResponse.status, 200);
      assert.equal(generatedResponse.body.card.generatedBy, "llm");
      assert.equal(generatedResponse.body.card.mode, sample.mode);
      assert.ok(generatedResponse.body.card.prompt.includes(sample.mode));
      assert.equal(generatedResponse.body.card.quality.schemaVersion, "v6-prompt-quality@1");
      assert.equal(generatedResponse.body.card.feedbackSummary.schemaVersion, "v6-prompt-quality@1");
      assert.equal(generatedResponse.body.card.feedbackProfile.schemaVersion, "v6-prompt-quality@1");
      assert.equal(generatedResponse.body.card.promptStrategyPlan.schemaVersion, "v6-prompt-quality@1");
      assert.equal(generatedResponse.body.card.promptStrategyPlan.selectedStrategy.id, "insert_safe_compact");
      assert.equal(generatedResponse.body.card.promptStrategyPlan.selectedStrategy.version, "v6-strategy-policy@3");
      assert.equal(generatedResponse.body.card.promptStrategyPlan.selectedStrategy.decision, "guardrail");
      assert.equal(generatedResponse.body.card.promptStrategyPlan.outcomePolicy.privacy.aggregateOnly, true);
      assert.equal(generatedResponse.body.card.promptStrategyPlan.strategyWeightPolicy.privacy.aggregateOnly, true);
      assert.equal(generatedResponse.body.card.strategyInsights.insightVersion, "v6-strategy-insights@1");
      assert.equal(generatedResponse.body.card.strategyInsights.privacy.derivedFromAggregateStrategyMetrics, true);
      assert.equal(generatedResponse.body.card.strategyWeightPolicy.weightPolicyVersion, "v6-strategy-weighting@1");
      assert.equal(generatedResponse.body.card.strategyWeightPolicy.privacy.derivedFromAggregatePilotOutcomes, true);
      assert.equal(generatedResponse.body.card.promptQualityLiftReport.reportVersion, "v6-quality-lift@1");
      assert.equal(generatedResponse.body.card.promptQualityLiftReport.privacy.derivedFromAggregateQualityLiftMetrics, true);
      assert.equal(generatedResponse.body.card.promptQualityLiftSegmentsReport.reportVersion, "v6-quality-lift-segments@1");
      assert.equal(generatedResponse.body.card.promptQualityLiftSegmentsReport.privacy.segmentMetadataOnly, true);
      assert.equal(generatedResponse.body.card.qualityLiftSegmentPolicy.policyVersion, "v6-quality-lift-segment-policy@1");
      assert.equal(generatedResponse.body.card.qualityLiftSegmentPolicy.privacy.aggregateOnly, true);
      assert.equal(generatedResponse.body.card.promptStrategyPlan.qualityLiftSegmentPolicy.policyVersion, "v6-quality-lift-segment-policy@1");
      assert.equal(generatedResponse.body.card.failureReasonReport.reportVersion, "v6-failure-reasons@1");
      assert.equal(generatedResponse.body.card.failureReasonReport.privacy.rawFailureReasonNotStored, true);
      assert.equal(generatedResponse.body.card.failureReasonPolicy.policyVersion, "v6-failure-reason-policy@1");
      assert.equal(generatedResponse.body.card.failureReasonPolicy.privacy.aggregateOnly, true);
      assert.equal(generatedResponse.body.card.promptStrategyPlan.failureReasonPolicy.policyVersion, "v6-failure-reason-policy@1");
      assert.equal(generatedResponse.body.card.selfImprovementReport.reportVersion, "v6-self-improvement@1");
      assert.equal(generatedResponse.body.card.selfImprovementReport.privacy.aggregateOnly, true);
      assert.equal(generatedResponse.body.card.selfImprovementReport.privacy.noAutomaticMutation, true);
      assert.equal(generatedResponse.body.card.evolutionCandidateReport.candidateVersion, "v6-evolution-candidates@1");
      assert.equal(generatedResponse.body.card.evolutionCandidateReport.mutationAllowed, false);
      assert.equal(generatedResponse.body.card.evolutionCandidateReport.requiresCritic, true);
      assert.equal(generatedResponse.body.card.experimentOutcomeReport.experimentVersion, "v6-prompt-experiment@1");
      assert.equal(generatedResponse.body.card.experimentOutcomeReport.privacy.derivedFromAggregateExperimentMetrics, true);
      assert.equal(generatedResponse.body.card.taskOutcomeReport.reportVersion, "v6-task-outcome@1");
      assert.equal(generatedResponse.body.card.taskOutcomeReport.privacy.derivedFromAggregateTaskOutcomes, true);
      assert.equal(generatedResponse.body.card.promptStrategyPlan.taskOutcomePolicy.privacy.aggregateOnly, true);
      assert.ok(generatedResponse.body.card.taskScenario);
      assert.equal(generatedResponse.body.card.experimentAssignment.arm, "insert_safety_guardrail");
      assert.equal(generatedResponse.body.card.experimentAssignment.eligible, false);
      assert.equal(generatedResponse.body.card.experimentAssignment.cohort.taskScenario, generatedResponse.body.card.taskScenario);
      assert.equal(generatedResponse.body.card.qualityExperiment.schemaVersion, "v6-prompt-quality@1");
      assert.equal(generatedResponse.body.card.qualityExperiment.taskScenario, generatedResponse.body.card.taskScenario);
      assert.ok(/^generation-/.test(generatedResponse.body.card.generationId));
      assert.ok(generatedResponse.body.card.qualityExperiment.strategyId.includes(sample.mode));
      assert.equal(generatedResponse.body.card.qualityExperiment.promptStrategyId, "insert_safe_compact");
      assert.equal(generatedResponse.body.card.qualityExperiment.promptStrategyVersion, "v6-strategy-policy-3");
      assert.equal(generatedResponse.body.card.qualityExperiment.experimentVersion, "v6-prompt-experiment-1");
      assert.equal(generatedResponse.body.card.qualityExperiment.experimentArm, "insert_safety_guardrail");
      assert.equal(generatedResponse.body.card.qualityExperiment.experimentEligible, false);
      assert.ok(generatedResponse.body.card.qualityExperiment.experimentComparisonKey);
      assert.ok(generatedResponse.body.card.qualityExperiment.experimentComparisonKey.includes(generatedResponse.body.card.taskScenario));
      assert.equal(generatedResponse.body.card.qualityExperiment.strategyInsightsVersion, "v6-strategy-insights-1");
      assert.equal(generatedResponse.body.card.qualityExperiment.strategyReadiness, "exploring");
      assert.equal(generatedResponse.body.card.qualityExperiment.strategyWeightVersion, "v6-strategy-weighting-1");
      assert.equal(generatedResponse.body.card.qualityExperiment.strategyWeightStatus, "collecting");
      assert.equal(generatedResponse.body.card.qualityExperiment.strategyWeightDecision, "guardrail");
      assert.equal(generatedResponse.body.card.qualityExperiment.qualityLiftCohort, "insert_safety_guardrail");
      assert.equal(generatedResponse.body.card.qualityExperiment.generationId, generatedResponse.body.card.generationId);
      assert.equal(generatedResponse.body.card.qualityExperiment.qualityScore, generatedResponse.body.card.quality.score);
      assert.ok(Array.isArray(generatedResponse.body.card.feedbackProfile.directives));
      assert.ok(generatedResponse.body.card.feedbackProfile.directives.some((item) => item.key === "reduce_retry"));
      assert.ok(generatedResponse.body.card.feedbackProfile.directives.some((item) => item.key === "after_write_mismatch"));
    }
    assert.deepEqual(gatewayCalls.slice(1).map((call) => call.mode), [MODE.IDEA, MODE.CONTINUE, MODE.POLISH]);
    assert.ok(gatewayCalls.every((call) => call.provider === PROVIDERS.GEMINI && call.model === "gemini-test" && call.hasApiKey));
    assert.ok(gatewayCalls.slice(1).every((call) => call.feedbackSummary?.schemaVersion === "v6-prompt-quality@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => call.feedbackProfile?.schemaVersion === "v6-prompt-quality@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /reduce_retry/.test(call.feedbackProfileText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.promptStrategyPlan?.schemaVersion === "v6-prompt-quality@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => call.promptStrategyPlan?.selectedStrategy?.id === "insert_safe_compact"));
    assert.ok(gatewayCalls.slice(1).every((call) => call.promptStrategyPlan?.selectedStrategy?.version === "v6-strategy-policy@3"));
    assert.ok(gatewayCalls.slice(1).every((call) => /insert_safe_compact/.test(call.promptStrategyText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.strategyInsights?.insightVersion === "v6-strategy-insights@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /aggregate-only/.test(call.strategyInsightsText)));
    assert.ok(gatewayCalls.slice(1).every((call) => /reduce_retry/.test(call.strategyInsightsText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.strategyWeightPolicy?.weightPolicyVersion === "v6-strategy-weighting@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /aggregate-only/.test(call.strategyWeightText)));
    assert.ok(gatewayCalls.slice(1).every((call) => /strategyWeight=v6-strategy-weighting@1/.test(call.strategyWeightText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.promptQualityLiftReport?.reportVersion === "v6-quality-lift@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /qualityLift=v6-quality-lift@1/.test(call.promptQualityLiftText)));
    assert.ok(gatewayCalls.slice(1).every((call) => /aggregate-only/.test(call.promptQualityLiftText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.promptQualityLiftSegmentsReport?.reportVersion === "v6-quality-lift-segments@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /qualityLiftSegments=v6-quality-lift-segments@1/.test(call.promptQualityLiftSegmentsText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.qualityLiftSegmentPolicy?.policyVersion === "v6-quality-lift-segment-policy@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /qualityLiftSegmentPolicy=v6-quality-lift-segment-policy@1|baseline_structure/.test(call.qualityLiftSegmentText)));
    assert.ok(gatewayCalls.slice(1).every((call) => /aggregate-only/.test(call.qualityLiftSegmentText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.failureReasonReport?.reportVersion === "v6-failure-reasons@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /failureReasons=v6-failure-reasons@1/.test(call.failureReasonReportText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.failureReasonPolicy?.policyVersion === "v6-failure-reason-policy@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /failureReasonPolicy=v6-failure-reason-policy@1|baseline_structure/.test(call.failureReasonText)));
    assert.ok(gatewayCalls.slice(1).every((call) => /raw-reason-not-stored|baseline_structure/.test(call.failureReasonText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.selfImprovementReport?.reportVersion === "v6-self-improvement@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /selfImprovement=v6-self-improvement@1|baseline_structure/.test(call.selfImprovementText)));
    assert.ok(gatewayCalls.slice(1).every((call) => /no-automatic-mutation/.test(call.selfImprovementText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.evolutionCandidateReport?.candidateVersion === "v6-evolution-candidates@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /evolutionCandidates=v6-evolution-candidates@1|baseline_structure/.test(call.evolutionCandidateText)));
    assert.ok(gatewayCalls.slice(1).every((call) => /mutationAllowed=false|baseline_structure/.test(call.evolutionCandidateText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.experimentOutcomeReport?.experimentVersion === "v6-prompt-experiment@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /aggregate-only/.test(call.experimentOutcomeText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.taskOutcomeReport?.reportVersion === "v6-task-outcome@1"));
    assert.ok(gatewayCalls.slice(1).every((call) => /aggregate-only/.test(call.taskOutcomeText)));
    assert.ok(gatewayCalls.slice(1).every((call) => call.taskScenario));
    assert.ok(store.getPromptHistory().some((entry) => Number.isFinite(entry.qualityScore)));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.feedbackConfidence === "medium"));
    assert.ok(store.getPromptHistory().some((entry) => entry.generationId && entry.strategyId));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.promptStrategyId === "insert_safe_compact"));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.promptStrategyVersion === "v6-strategy-policy@3"));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.experimentArm === "insert_safety_guardrail"));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.experimentVersion === "v6-prompt-experiment-1"));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.experimentOutcomeDecision));
    assert.ok(store.getPromptHistory().some((entry) => Object.hasOwn(entry.context || {}, "taskOutcomeDecision")));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.strategyWeightVersion === "v6-strategy-weighting@1"));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.strategyWeightStatus));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.qualityLiftCohort));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.promptQualityLiftStatus));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.qualityLiftSegmentPolicyVersion === "v6-quality-lift-segment-policy@1"));
    assert.ok(store.getPromptHistory().some((entry) => Object.hasOwn(entry.context || {}, "qualityLiftSegmentDecision")));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.failureReasonPolicyVersion === "v6-failure-reason-policy@1"));
    assert.ok(store.getPromptHistory().some((entry) => Object.hasOwn(entry.context || {}, "failureReasonPolicyDecision")));
    assert.ok(store.getPromptHistory().some((entry) => Object.hasOwn(entry.context || {}, "failureReasonEventCount")));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.selfImprovementVersion === "v6-self-improvement@1"));
    assert.ok(store.getPromptHistory().some((entry) => Object.hasOwn(entry.context || {}, "selfImprovementReflectionCount")));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.evolutionCandidateVersion === "v6-evolution-candidates@1"));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.evolutionPromotionMode === "manual_review_required"));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.evolutionMutationAllowed === false));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.strategyInsightsReadiness));
    assert.ok(store.getPromptHistory().some((entry) => entry.context?.taskScenario));

    const pendingOutcomes = await authed("GET", "/outcomes/pending?limit=10");
    assert.equal(pendingOutcomes.status, 200);
    assert.ok(pendingOutcomes.body.pendingOutcomeCount >= 3);
    assert.ok(pendingOutcomes.body.pendingOutcomes.some((item) => item.source.includes("prompt_history") && item.generationId));
    assert.ok(pendingOutcomes.body.pendingOutcomes.some((item) => item.generationId === "generation-test-deepseek-1" && item.source.includes("metric")));
    assert.equal(pendingOutcomes.body.privacy.metadataOnly, true);
    assert.ok(pendingOutcomes.body.pendingOutcomes.every((item) => item.privacy.metadataOnly === true));
    assert.ok(!JSON.stringify(pendingOutcomes.body).includes("should not be persisted"));

    const followupTarget = pendingOutcomes.body.pendingOutcomes.find((item) => item.source.includes("prompt_history"));
    const followupOutcome = await authed("POST", "/outcomes/follow-up", {
      generationId: followupTarget.generationId,
      outcomeLabel: "needs-work",
      failureReason: "SECRET_PROMPT_TEXT wrong JSON output format"
    });
    assert.equal(followupOutcome.status, 200);
    assert.equal(followupOutcome.body.outcome.action, "outcome");
    assert.equal(followupOutcome.body.outcome.generationId, followupTarget.generationId);
    assert.equal(followupOutcome.body.outcome.strategyId, followupTarget.strategyId);
    assert.equal(followupOutcome.body.outcome.taskScenario, followupTarget.taskScenario);
    assert.equal(followupOutcome.body.outcome.outcomeLabel, "needs-work");
    assert.equal(followupOutcome.body.outcome.outcomeScore, 0.45);
    assert.equal(followupOutcome.body.outcome.outcomeVerified, true);
    assert.equal(followupOutcome.body.outcome.outcomeSource, "manual_followup");
    assert.equal(followupOutcome.body.outcome.failureReason, "wrong_format");
    assert.equal(followupOutcome.body.outcome.failureReasonToken, "wrong_format");
    assert.equal(followupOutcome.body.outcome.ok, false);
    assert.ok(!followupOutcome.body.pendingOutcomes.some((item) => item.generationId === followupTarget.generationId));
    assert.ok(!JSON.stringify(followupOutcome.body).includes("should not be persisted"));
    assert.ok(!JSON.stringify(followupOutcome.body).includes("SECRET_PROMPT_TEXT"));

    const invalidFollowup = await authed("POST", "/outcomes/follow-up", {
      generationId: "generation-test-deepseek-1",
      outcomeLabel: "maybe"
    });
    assert.equal(invalidFollowup.status, 400);
    assert.equal(invalidFollowup.body.error.code, "invalid_outcome_label");

    const missingFollowup = await authed("POST", "/outcomes/follow-up", {
      generationId: "generation-missing",
      outcomeLabel: "success"
    });
    assert.equal(missingFollowup.status, 404);
    assert.equal(missingFollowup.body.error.code, "outcome_candidate_not_found");

    const cleared = await authed("DELETE", "/data/all");
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.clearAllLocalData, true);
    assert.equal(cleared.body.reset.resetMode, "recoverable");
    assert.ok(cleared.body.reset.recoveryId);
    assert.ok(cleared.body.reset.moved.includes("metrics.json"));
    assert.equal(store.getPrompts().length, 0);
    assert.equal(store.getSkills().length, 0);
    store.recordMetric({
      action: "outcome",
      mode: MODE.CONTINUE,
      strategyId: "manual:continue:needs-work",
      taskScenario: "general",
      outcomeLabel: "needs-work",
      outcomeScore: 0.2,
      outcomeVerified: true,
      outcomeSource: "manual_card",
      ok: false
    });
    const failedOutcomeMetrics = store.getMetrics();
    assert.equal(failedOutcomeMetrics.outcomeSuccessRate, 0);
    assert.equal(failedOutcomeMetrics.avgOutcomeScore, 0.2);
    assert.equal(failedOutcomeMetrics.failureReasonTokens.low_quality, 1);
    assert.equal(failedOutcomeMetrics.byStrategy["manual:continue:needs-work"].failedOutcomes, 1);
    assert.equal(failedOutcomeMetrics.byStrategy["manual:continue:needs-work"].successfulOutcomes, 0);
  } finally {
    server.close();
  }

  console.log("local-service tests passed");
})();
