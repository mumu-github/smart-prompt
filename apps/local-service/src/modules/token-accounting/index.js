"use strict";

const TOKEN_SOURCES = new Set(["provider", "estimated", "unavailable"]);
const SUCCESS_OUTCOMES = new Set(["succeeded", "completed"]);

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function estimateTextTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  const latin = (value.match(/[\x00-\x7F]/g) || []).length;
  const nonLatin = value.length - latin;
  return Math.max(1, Math.ceil(latin / 4 + nonLatin / 1.5));
}

function normalizeTokenAccounting(input = {}) {
  const declaredSource = TOKEN_SOURCES.has(input.source || input.tokenAccountingSource)
    ? input.source || input.tokenAccountingSource
    : "unavailable";
  const includesEstimatedPrompt = input.insertedPromptTokens === undefined
    && finiteNonNegative(input.insertedPromptTokenEstimate) !== null;
  const source = declaredSource === "provider" && includesEstimatedPrompt
    ? "estimated"
    : declaredSource;
  const values = {
    smartPromptInputTokens: finiteNonNegative(input.smartPromptInputTokens ?? input.inputTokens),
    smartPromptOutputTokens: finiteNonNegative(input.smartPromptOutputTokens ?? input.outputTokens),
    insertedPromptTokens: finiteNonNegative(input.insertedPromptTokens ?? input.insertedPromptTokenEstimate),
    codexInputTokens: finiteNonNegative(input.codexInputTokens),
    codexOutputTokens: finiteNonNegative(input.codexOutputTokens),
    codexReasoningTokens: finiteNonNegative(input.codexReasoningTokens ?? input.reasoningTokens),
    codexCachedTokens: finiteNonNegative(input.codexCachedTokens ?? input.cachedTokens),
    retryTokens: finiteNonNegative(input.retryTokens),
    reworkTokens: finiteNonNegative(input.reworkTokens),
    costMicros: finiteNonNegative(input.costMicros)
  };
  if (source === "unavailable") {
    for (const key of Object.keys(values)) values[key] = null;
  }
  return { source, ...values };
}

function divideKnown(total, count) {
  return total === null || count <= 0 ? null : Math.round((total / count) * 1000) / 1000;
}

function metricValues(records, selector) {
  return records.map(selector).filter((value) => value !== null);
}

function metricSummary(records, selector) {
  const values = metricValues(records, selector);
  const total = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  return { count: values.length, average: divideKnown(total, values.length) };
}

function calculateSuccessfulOutcomeEfficiency(observations = []) {
  const succeeded = observations.filter((item) =>
    SUCCESS_OUTCOMES.has(String(item.taskOutcomeToken || item.outcomeStatus || ""))
      && item.qualityGatePassed !== false
      && item.safetyGatePassed !== false
  );
  const normalized = succeeded.map((item) => ({
    item,
    accounting: normalizeTokenAccounting(item.tokenAccounting || item)
  }));
  const tokenMetric = metricSummary(normalized, ({ accounting }) => {
    if (accounting.source === "unavailable") return null;
    const keys = [
      "smartPromptInputTokens",
      "smartPromptOutputTokens",
      "insertedPromptTokens",
      "codexInputTokens",
      "codexOutputTokens",
      "retryTokens",
      "reworkTokens"
    ];
    const known = keys.map((key) => accounting[key]).filter((value) => value !== null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
  });
  const costMetric = metricSummary(normalized, ({ accounting }) => accounting.costMicros);
  const timeMetric = metricSummary(succeeded, (item) => finiteNonNegative(item.durationMs));
  const retryMetric = metricSummary(succeeded, (item) => finiteNonNegative(item.retryCount));
  return {
    successfulOutcomeCount: succeeded.length,
    tokensPerSuccessfulOutcome: tokenMetric.average,
    costPerSuccessfulOutcomeMicros: costMetric.average,
    timePerSuccessfulOutcomeMs: timeMetric.average,
    retriesPerSuccessfulOutcome: retryMetric.average,
    tokenCoverageCount: tokenMetric.count,
    sampleCoverage: {
      successfulOutcomes: succeeded.length,
      tokens: tokenMetric.count,
      cost: costMetric.count,
      time: timeMetric.count,
      retries: retryMetric.count
    },
    sourceCoverage: {
      provider: normalized.filter(({ accounting }) => accounting.source === "provider").length,
      estimated: normalized.filter(({ accounting }) => accounting.source === "estimated").length,
      unavailable: normalized.filter(({ accounting }) => accounting.source === "unavailable").length
    }
  };
}

function relativeDelta(candidate, baseline) {
  const a = finiteNonNegative(candidate);
  const b = finiteNonNegative(baseline);
  if (a === null || b === null || b === 0) return null;
  return Math.round(((a - b) / b) * 100000) / 100000;
}

function compareOutcomeEfficiency(baseline, candidate) {
  return {
    tokenDeltaRatio: relativeDelta(candidate.tokensPerSuccessfulOutcome, baseline.tokensPerSuccessfulOutcome),
    costDeltaRatio: relativeDelta(candidate.costPerSuccessfulOutcomeMicros, baseline.costPerSuccessfulOutcomeMicros),
    timeDeltaRatio: relativeDelta(candidate.timePerSuccessfulOutcomeMs, baseline.timePerSuccessfulOutcomeMs),
    retryDeltaRatio: relativeDelta(candidate.retriesPerSuccessfulOutcome, baseline.retriesPerSuccessfulOutcome)
  };
}

module.exports = {
  TOKEN_SOURCES,
  calculateSuccessfulOutcomeEfficiency,
  compareOutcomeEfficiency,
  estimateTextTokens,
  normalizeTokenAccounting
};
