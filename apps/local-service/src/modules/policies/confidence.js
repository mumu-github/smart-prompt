"use strict";

const { DEFAULT_MINIMUMS, clamp, deepFreeze, isPlainObject } = require("./shared");
const { observationTokens } = require("./rollout");

function finiteMetric(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  if (options.positive === true && number <= 0) return null;
  return number;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleVariance(values, average = mean(values)) {
  if (values.length < 2 || average === null) return 0;
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
}

function normalCdf(value) {
  const z = Number(value);
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  if (!Number.isFinite(z)) return 0;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t)
    + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x ** 2)));
  return clamp(0.5 * (1 + erf), 0, 1);
}

function directionalConfidence(baseline, candidate, margin, direction) {
  if (!baseline.length || !candidate.length) return 0;
  const baselineMean = mean(baseline);
  const candidateMean = mean(candidate);
  const standardError = Math.sqrt(
    sampleVariance(baseline, baselineMean) / baseline.length
      + sampleVariance(candidate, candidateMean) / candidate.length
  );
  const signedMargin = direction === "higher"
    ? candidateMean - baselineMean + margin
    : baselineMean - candidateMean + margin;
  if (standardError === 0) return signedMargin >= 0 ? 1 : 0;
  return normalCdf(signedMargin / standardError);
}

function proportionalImprovementConfidence(baseline, candidate, effectRatio) {
  if (!baseline.length || !candidate.length) return 0;
  const baselineMean = mean(baseline);
  const candidateMean = mean(candidate);
  if (!(baselineMean > 0)) return 0;
  const retainedRatio = 1 - effectRatio;
  const standardError = Math.sqrt(
    ((retainedRatio ** 2) * sampleVariance(baseline, baselineMean)) / baseline.length
      + sampleVariance(candidate, candidateMean) / candidate.length
  );
  const margin = baselineMean * retainedRatio - candidateMean;
  if (standardError === 0) return margin >= 0 ? 1 : 0;
  return normalCdf(margin / standardError);
}

function outcomeSucceeded(item) {
  return ["completed", "succeeded", "success"].includes(String(
    item.taskOutcomeToken || item.outcomeStatus || item.status || ""
  ).toLowerCase()) ? 1 : 0;
}

function armSamples(observations, arm) {
  const items = observations.filter((item) => isPlainObject(item) && item.arm === arm);
  return {
    count: items.length,
    success: items.map(outcomeSucceeded),
    retry: items.map((item) => finiteMetric(item.retryCount) > 0 ? 1 : 0),
    undo: items.map((item) => item.undoUsed === true ? 1 : 0),
    tokens: items.map(observationTokens).filter((value) => value !== null),
    latency: items.map((item) => finiteMetric(item.latencyMs ?? item.durationMs, { positive: true }))
      .filter((value) => value !== null),
    rework: items.map((item) => finiteMetric(item.reworkCount ?? item.retryCount))
      .filter((value) => value !== null)
  };
}

function estimateRolloutConfidence(observations = [], minimums = {}) {
  const source = Array.isArray(observations) ? observations : [];
  const resolvedMinimums = {
    ...DEFAULT_MINIMUMS,
    ...(isPlainObject(minimums) ? minimums : {})
  };
  const baseline = armSamples(source, "baseline");
  const candidate = armSamples(source, "candidate");
  if (baseline.count < resolvedMinimums.perArmAttributableOutcomes
      || candidate.count < resolvedMinimums.perArmAttributableOutcomes) {
    return deepFreeze({ confidence: 0, enoughSamples: false, dimensions: {} });
  }
  const nonInferiorityMargin = clamp(resolvedMinimums.minimumEffectRatio, 0, 1);
  const tokenEffect = Math.max(
    clamp(resolvedMinimums.tokenImprovementRatio, 0, 1),
    nonInferiorityMargin
  );
  const dimensions = {
    taskQuality: directionalConfidence(baseline.success, candidate.success, nonInferiorityMargin, "higher"),
    retry: directionalConfidence(baseline.retry, candidate.retry, nonInferiorityMargin, "lower"),
    undo: directionalConfidence(baseline.undo, candidate.undo, nonInferiorityMargin, "lower"),
    tokens: proportionalImprovementConfidence(baseline.tokens, candidate.tokens, tokenEffect),
    latency: proportionalImprovementConfidence(baseline.latency, candidate.latency, nonInferiorityMargin),
    rework: proportionalImprovementConfidence(baseline.rework, candidate.rework, nonInferiorityMargin)
  };
  const efficiency = Math.max(dimensions.tokens, dimensions.latency, dimensions.rework);
  const confidence = Math.min(dimensions.taskQuality, dimensions.retry, dimensions.undo, efficiency);
  return deepFreeze({
    confidence: Math.round(clamp(confidence, 0, 1) * 1000000) / 1000000,
    enoughSamples: true,
    dimensions: deepFreeze({ ...dimensions, efficiency })
  });
}

module.exports = Object.freeze({
  estimateRolloutConfidence,
  normalCdf
});
