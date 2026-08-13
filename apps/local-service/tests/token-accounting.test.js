const assert = require("node:assert/strict");
const {
  calculateSuccessfulOutcomeEfficiency,
  compareOutcomeEfficiency,
  estimateTextTokens,
  normalizeTokenAccounting
} = require("../src/modules/token-accounting");
const {
  estimateTextTokenCount,
  normalizeProviderTokenUsage
} = require("../../../packages/shared/llm-gateway");
const { buildLlmMessages } = require("../../../packages/shared/smart-prompt-core");

assert.deepEqual(normalizeProviderTokenUsage({
  usage: {
    prompt_tokens: 100,
    completion_tokens: 40,
    prompt_tokens_details: { cached_tokens: 20 },
    completion_tokens_details: { reasoning_tokens: 8 }
  }
}), {
  inputTokens: 100,
  outputTokens: 40,
  cachedTokens: 20,
  reasoningTokens: 8,
  source: "provider"
});
assert.deepEqual(normalizeProviderTokenUsage({ usage: { input_tokens: 90, output_tokens: 30 } }), {
  inputTokens: 90,
  outputTokens: 30,
  cachedTokens: null,
  reasoningTokens: null,
  source: "provider"
});
assert.equal(normalizeProviderTokenUsage({}).source, "unavailable");
assert.ok(estimateTextTokenCount("Estimate this request") > 0);
assert.equal(estimateTextTokens(""), 0);
assert.ok(estimateTextTokens("请修复这个 bug") > 0);
assert.deepEqual(normalizeTokenAccounting({ source: "unavailable", inputTokens: 99 }), {
  source: "unavailable",
  smartPromptInputTokens: null,
  smartPromptOutputTokens: null,
  insertedPromptTokens: null,
  codexInputTokens: null,
  codexOutputTokens: null,
  codexReasoningTokens: null,
  codexCachedTokens: null,
  retryTokens: null,
  reworkTokens: null,
  costMicros: null
});

const baseline = calculateSuccessfulOutcomeEfficiency([
  {
    taskOutcomeToken: "completed",
    qualityGatePassed: true,
    safetyGatePassed: true,
    durationMs: 1000,
    retryCount: 1,
    tokenAccounting: {
      source: "provider",
      smartPromptInputTokens: 100,
      smartPromptOutputTokens: 50,
      insertedPromptTokens: 120,
      codexInputTokens: 700,
      codexOutputTokens: 300,
      costMicros: 2000
    }
  },
  { taskOutcomeToken: "not_completed", inputTokens: 9999 },
  { taskOutcomeToken: "completed", qualityGatePassed: false, inputTokens: 9999 }
]);
assert.equal(baseline.successfulOutcomeCount, 1);
assert.equal(baseline.tokensPerSuccessfulOutcome, 1270);
assert.equal(baseline.costPerSuccessfulOutcomeMicros, 2000);
assert.equal(baseline.timePerSuccessfulOutcomeMs, 1000);
assert.equal(baseline.retriesPerSuccessfulOutcome, 1);
assert.deepEqual(baseline.sampleCoverage, {
  successfulOutcomes: 1,
  tokens: 1,
  cost: 1,
  time: 1,
  retries: 1
});

const mixedCoverage = calculateSuccessfulOutcomeEfficiency([
  {
    taskOutcomeToken: "completed",
    tokenAccounting: {
      source: "provider",
      inputTokens: 100,
      outputTokens: 40,
      reasoningTokens: 8,
      insertedPromptTokenEstimate: 10,
      costMicros: null
    }
  },
  {
    taskOutcomeToken: "completed",
    tokenAccounting: { source: "unavailable" }
  }
]);
assert.equal(mixedCoverage.tokensPerSuccessfulOutcome, 150, "reasoning is a breakdown of output, not an extra charge");
assert.equal(mixedCoverage.costPerSuccessfulOutcomeMicros, null, "missing cost must not be coerced to zero");
assert.equal(mixedCoverage.tokenCoverageCount, 1);
assert.deepEqual(mixedCoverage.sampleCoverage, {
  successfulOutcomes: 2,
  tokens: 1,
  cost: 0,
  time: 0,
  retries: 0
});
assert.deepEqual(mixedCoverage.sourceCoverage, { provider: 0, estimated: 1, unavailable: 1 });
assert.equal(normalizeTokenAccounting({
  source: "provider",
  inputTokens: 100,
  outputTokens: 40,
  insertedPromptTokenEstimate: 10
}).source, "estimated", "an aggregate containing an estimated component cannot be labeled provider-exact");

const candidate = { ...baseline, tokensPerSuccessfulOutcome: 1200, timePerSuccessfulOutcomeMs: 900 };
const comparison = compareOutcomeEfficiency(baseline, candidate);
assert.ok(comparison.tokenDeltaRatio < 0);
assert.ok(comparison.timeDeltaRatio < 0);
assert.equal(comparison.costDeltaRatio, 0);

const compactMessages = buildLlmMessages("Fix the failing test", {
  taskScenario: "bug_fix",
  generationPolicy: {
    contractVersion: "generation-policy@1",
    policyId: "policy_compact",
    version: 2,
    selectedStrategy: "compact",
    directives: [{ directiveId: "directive_1", kind: "verbosity", valueToken: "concise", priority: 1 }],
    contextBudget: { maxInputTokens: 1200, maxContextSourceTokens: 0 }
  },
  selfImprovementText: "MUST_NOT_ENTER_MODEL_CONTEXT",
  evolutionCandidateText: "MUST_NOT_ENTER_MODEL_CONTEXT"
}, [], 0);
const compactRequestText = compactMessages.messages.map((message) => message.content).join("\n");
assert.match(compactRequestText, /Local generation policy:/);
assert.doesNotMatch(compactRequestText, /MUST_NOT_ENTER_MODEL_CONTEXT/);
assert.equal((compactRequestText.match(/Local generation policy:/g) || []).length, 1);

console.log("token accounting tests passed");
