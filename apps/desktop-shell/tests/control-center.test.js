const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const controlCenter = require("../src/control-center-app.js");

const learningFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "outcome-learning-ui.json"),
  "utf8"
));

assert.deepEqual(controlCenter.PROVIDERS, ["agnes", "openai-compatible", "anthropic", "gemini", "custom"]);
assert.deepEqual(controlCenter.CUSTOM_PROVIDER_PROTOCOLS, ["openai-compatible", "anthropic", "gemini"]);
assert.equal(controlCenter.CUSTOM_MODEL_VALUE, "__custom__");
assert.deepEqual(controlCenter.CONTROL_PAGES, ["overview", "model", "learning", "privacy", "diagnostics"]);
assert.deepEqual(controlCenter.CONTROL_LOCALES, ["zh-CN", "en"]);
assert.equal(controlCenter.normalizeControlLocale("zh-Hans"), "zh-CN");
assert.equal(controlCenter.normalizeControlLocale("en-US"), "en");
assert.equal(controlCenter.getControlCopy("en", "learningTitle"), "Learning management");
assert.deepEqual(controlCenter.PROVIDER_MODEL_PRESETS.agnes, ["agnes-2.0-flash"]);
assert.equal(controlCenter.normalizeProvider("auto"), "openai-compatible");
assert.equal(controlCenter.normalizeProvider("unknown"), "openai-compatible");

assert.deepEqual(controlCenter.getModelSelection("agnes", "agnes-2.0-flash"), {
  choice: "agnes-2.0-flash",
  customModel: "",
  isCustom: false,
  model: "agnes-2.0-flash"
});
assert.deepEqual(controlCenter.getModelSelection("openai-compatible", "openrouter/custom-model:free"), {
  choice: "__custom__",
  customModel: "openrouter/custom-model:free",
  isCustom: true,
  model: "openrouter/custom-model:free"
});
assert.deepEqual(controlCenter.getModelSelection("custom", "private/model-v2"), {
  choice: "__custom__",
  customModel: "private/model-v2",
  isCustom: true,
  model: "private/model-v2"
});
assert.equal(controlCenter.resolveModelValue({
  provider: "openai-compatible",
  choice: "__custom__",
  customModel: "  openrouter/custom-model:free  "
}), "openrouter/custom-model:free");
assert.equal(controlCenter.resolveModelValue({
  provider: "agnes",
  choice: "agnes-2.0-flash",
  customModel: "ignored-model"
}), "agnes-2.0-flash");
assert.throws(() => controlCenter.resolveModelValue({
  provider: "agnes",
  choice: "__custom__",
  customModel: ""
}), (error) => error.code === "model_invalid");
assert.throws(() => controlCenter.resolveModelValue({
  provider: "agnes",
  choice: "__custom__",
  customModel: "invalid model id"
}), (error) => error.code === "model_invalid");
assert.deepEqual(controlCenter.getProviderCredentialState("agnes", { agnes: "configured" }), {
  configured: true,
  label: "已保存，留空不会覆盖"
});
assert.deepEqual(controlCenter.getProviderCredentialState("agnes", {}), {
  configured: false,
  label: "尚未保存"
});

const expectedNativeHealth = {
  ok: true,
  service: "smart-prompt-local-service",
  sidecar: "native",
  version: "0.5.0-native",
  activationContract: "phase3-activation@1",
  runtimeContract: "phase3-native-runtime@1",
  buildId: "phase3-native-sidecar-20260719-r18"
};
assert.equal(controlCenter.isExpectedLocalServiceHealth(expectedNativeHealth), true);
assert.equal(controlCenter.isExpectedLocalServiceHealth({
  ...expectedNativeHealth,
  sidecar: "node"
}), false);
assert.equal(controlCenter.isExpectedLocalServiceHealth({
  ...expectedNativeHealth,
  version: "0.4.0-native"
}), false);
assert.equal(controlCenter.isExpectedLocalServiceHealth({
  ...expectedNativeHealth,
  runtimeContract: undefined
}), false);
assert.equal(controlCenter.isExpectedLocalServiceHealth({
  ...expectedNativeHealth,
  buildId: "stale-native-build"
}), false);

const settingsPayload = controlCenter.buildProviderSettingsPayload({
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  model: "claude-test",
  apiKey: "secret-value"
});
assert.deepEqual(settingsPayload, {
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  model: "claude-test",
  providerKeys: { anthropic: "secret-value" }
});
assert.equal(Object.keys(settingsPayload.providerKeys).length, 1);
assert.equal(JSON.stringify(settingsPayload).includes("prompt"), false);
const customProviderPayload = controlCenter.buildProviderSettingsPayload({
  provider: "custom",
  baseUrl: " https://gateway.example/v1/ ",
  model: " private/model-v2 ",
  apiKey: "custom-secret",
  customProviderName: " Team Gateway ",
  customProviderProtocol: "anthropic"
});
assert.deepEqual(customProviderPayload, {
  provider: "custom",
  baseUrl: "https://gateway.example/v1",
  model: "private/model-v2",
  customProvider: {
    name: "Team Gateway",
    protocol: "anthropic",
    baseUrl: "https://gateway.example/v1",
    model: "private/model-v2"
  },
  providerKeys: { custom: "custom-secret" }
});
assert.throws(() => controlCenter.buildProviderSettingsPayload({
  provider: "custom",
  baseUrl: "file:///tmp/provider",
  model: "private/model-v2",
  customProviderName: "Team Gateway",
  customProviderProtocol: "openai-compatible"
}), (error) => error.code === "custom_provider_base_url_invalid");
assert.throws(() => controlCenter.buildProviderSettingsPayload({
  provider: "custom",
  baseUrl: "https://gateway.example/v1",
  model: "private/model-v2",
  customProviderName: "",
  customProviderProtocol: "openai-compatible"
}), (error) => error.code === "custom_provider_name_invalid");
assert.deepEqual(controlCenter.buildProviderTestPayload(settingsPayload), {
  mode: "idea",
  settings: settingsPayload,
  persistOnSuccess: true
});
assert.equal(controlCenter.getProviderKeyPlaceholder("openai-compatible", { "openai-compatible": "configured" }), "已保存 Provider Key；留空继续使用");
assert.equal(controlCenter.getProviderKeyPlaceholder("anthropic", { "openai-compatible": "••••1234" }), "输入当前 Provider Key");
assert.equal(controlCenter.getProviderRecoveryField("credential_invalid"), "key");
assert.equal(controlCenter.getProviderRecoveryField("model_unavailable"), "model");
assert.equal(controlCenter.getProviderRecoveryField("model_invalid"), "model");
assert.equal(controlCenter.getProviderRecoveryField("custom_provider_name_invalid"), "custom-name");
assert.equal(controlCenter.getProviderRecoveryField("custom_provider_protocol_invalid"), "custom-protocol");
assert.equal(controlCenter.getProviderRecoveryField("custom_provider_base_url_invalid"), "custom-base-url");
assert.equal(controlCenter.getProviderRecoveryField("network_unavailable"), "base-url");
assert.equal(controlCenter.getProviderRecoveryField("provider_error"), "provider");
assert.equal(controlCenter.isProviderAdvancedField("model"), false);
assert.equal(controlCenter.isProviderAdvancedField("base-url"), true);
assert.equal(controlCenter.isProviderAdvancedField("key"), false);

assert.equal(controlCenter.getExtensionDetectionStatus({
  browserSeenAt: "2026-07-17T00:00:00.000Z",
  waitStartedAt: 1000,
  now: 20000
}), "connected");
assert.equal(controlCenter.getExtensionDetectionStatus({
  browserSeenAt: "",
  waitStartedAt: 1000,
  now: 12999,
  timeoutMs: 12000
}), "waiting");
assert.equal(controlCenter.getExtensionDetectionStatus({
  browserSeenAt: "",
  waitStartedAt: 1000,
  now: 13000,
  timeoutMs: 12000
}), "not-detected");
assert.equal(controlCenter.getExtensionDetectionStatus({
  browserSeenAt: "",
  waitStartedAt: 0,
  now: 13000,
  timeoutMs: 12000
}), "idle");

assert.deepEqual(controlCenter.getActivationView({ progress: "not_started" }), {
  kind: "wizard",
  step: "provider"
});
assert.deepEqual(controlCenter.getActivationView({ progress: "awaiting_codex_loop", modelTestedAt: "2026-07-19" }), {
  kind: "wizard",
  step: "codex"
});
assert.deepEqual(controlCenter.getActivationView({ progress: "model_ready", modelTestedAt: "2026-07-17" }), {
  kind: "wizard",
  step: "codex"
});
assert.deepEqual(controlCenter.getActivationView({ progress: "activated", codexVerified: true }), {
  kind: "control-center",
  step: "overview"
});
assert.deepEqual(controlCenter.getActivationView({ progress: "activated", codexVerified: false }), {
  kind: "wizard",
  step: "provider"
});
assert.equal(controlCenter.shouldShowMainWindow({ serviceHealthy: false, codexActivation: { progress: "activated", codexVerified: true } }), true);
assert.equal(controlCenter.shouldShowMainWindow({ serviceHealthy: true, codexActivation: { progress: "awaiting_codex_loop" } }), true);
assert.equal(controlCenter.shouldShowMainWindow({ serviceHealthy: true, codexActivation: { progress: "activated", codexVerified: true } }), false);

assert.equal(controlCenter.normalizeError({ code: "credential_invalid", message: "raw key" }), "凭证无效或权限不足");
assert.equal(controlCenter.normalizeError({ code: "network_unavailable", message: "raw URL" }), "无法连接 Provider");
assert.equal(controlCenter.normalizeError({ code: "unexpected", message: "SECRET" }), "Provider 暂时不可用");

const learning = controlCenter.normalizeLearningView(learningFixture);
assert.equal(learning.assets.length, 3);
assert.deepEqual(learning.assets.map((item) => item.type), ["memory", "rule", "skill"]);
assert.equal(learning.candidates.length, 2);
assert.deepEqual(learning.candidates.map((item) => item.type), ["rule", "policy"]);
assert.equal(learning.promotions.length, 1);
assert.equal(learning.policies.length, 2);
assert.equal(learning.policies[1].canaryPercent, 10);
assert.equal(Object.hasOwn(learning.candidates[0], "strategyScore"), false);
assert.equal(Object.hasOwn(learning.candidates[0], "projectScopeToken"), false);

const learningZh = controlCenter.renderLearningView(learningFixture, "zh-CN");
assert.ok(learningZh.includes("项目经验"));
assert.ok(learningZh.includes("待审核候选"));
assert.ok(learningZh.includes("全局使用提案"));
assert.ok(learningZh.includes("生成策略版本"));
assert.ok(learningZh.includes('data-learning-action="candidate-review"'));
assert.ok(learningZh.includes('data-learning-action="candidate-ignore"'));
assert.ok(learningZh.includes('data-learning-action="promotion-confirm"'));
assert.ok(learningZh.includes('data-learning-action="policy-start-canary"'));
assert.ok(learningZh.includes('data-learning-action="policy-rollback"'));
assert.ok(learningZh.includes('data-learning-action="policy-learning-pause"'));
assert.ok(!learningZh.includes('data-learning-action="asset-pause"'));
assert.ok(!learningZh.includes("evidenceTokenCount"));
assert.ok(!learningZh.includes("strategyScore"));
assert.ok(!learningZh.includes("must_not_render"));
assert.ok(!learningZh.includes("Pilot Outcomes"));
assert.ok(!learningZh.includes("Quality Segments"));

const learningEn = controlCenter.renderLearningView(learningFixture, "en");
assert.ok(learningEn.includes("Project experience"));
assert.ok(learningEn.includes("Candidates to review"));
assert.ok(learningEn.includes("Global-use proposals"));
assert.ok(learningEn.includes("Generation policy versions"));

const learningPaused = controlCenter.renderLearningView({ ...learningFixture, learningPaused: true }, "en");
assert.ok(learningPaused.includes("New rollouts and automatic promotions are paused"));
assert.ok(learningPaused.includes('data-learning-action="policy-learning-resume"'));

assert.deepEqual(controlCenter.createLearningActionPayload("policy-rollback", "policy_codex_structure"), {
  id: "policy-rollback",
  value: "policy_codex_structure"
});
assert.equal(controlCenter.createLearningActionPayload("raw-research-action", "policy_codex_structure"), null);

console.log("control center contract tests passed");
