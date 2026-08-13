function buildOutcomePolicy(experimentOutcomeReport = {}) {
  const readiness = experimentOutcomeReport.readiness || {};
  const comparison = (experimentOutcomeReport.comparisons || [])
    .find((item) => item.name === "strategy_guided_vs_baseline") || {};
  const recommendation = (experimentOutcomeReport.recommendations || [])[0] || {};
  const guidedArm = (experimentOutcomeReport.arms || []).find((item) => item.arm === "strategy_guided") || {};
  const baselineArm = (experimentOutcomeReport.arms || []).find((item) => item.arm === "baseline_structure") || {};
  const deltas = comparison.deltas || {};
  const status = safeToken(readiness.status || "empty", "empty", 40);
  const recommendationKey = safeToken(recommendation.key || "", "", 80);
  let decision = status === "ready" ? "balanced" : status;
  let confidence = status === "ready" ? "medium" : "low";
  let reason = recommendation.recommendation || "Experiment outcome samples are not comparable yet.";

  if (status === "ready" && recommendationKey === "prefer_strategy_guided") {
    decision = "prefer_strategy_guided";
    confidence = "medium";
  } else if (status === "ready" && recommendationKey === "prefer_baseline_until_reviewed") {
    decision = "prefer_baseline";
    confidence = "medium";
  } else if (status === "ready" && recommendationKey === "continue_balanced_experiment") {
    decision = "balanced";
    confidence = "low";
  } else if (status === "collecting") {
    decision = "collecting";
    confidence = "low";
  } else if (status === "empty") {
    decision = "empty";
    confidence = "none";
  }

  return {
    status,
    comparable: Boolean(readiness.comparable),
    minComparableEvents: Number(readiness.minComparableEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS),
    decision,
    confidence,
    recommendationKey,
    reason,
    sourceStrategyId: safeToken((guidedArm.promptStrategyIds || [])[0] || "", "", 120),
    deltas: {
      insertSuccessRate: Number.isFinite(Number(deltas.insertSuccessRate)) ? round(Number(deltas.insertSuccessRate)) : 0,
      saveRate: Number.isFinite(Number(deltas.saveRate)) ? round(Number(deltas.saveRate)) : 0,
      retryUsageRate: Number.isFinite(Number(deltas.retryUsageRate)) ? round(Number(deltas.retryUsageRate)) : 0,
      undoUsageRate: Number.isFinite(Number(deltas.undoUsageRate)) ? round(Number(deltas.undoUsageRate)) : 0,
      avgQualityScore: Number.isFinite(Number(deltas.avgQualityScore)) ? round(Number(deltas.avgQualityScore)) : null
    },
    arms: {
      baselineEvents: Number(baselineArm.events || 0),
      strategyGuidedEvents: Number(guidedArm.events || 0),
      baselineInsertSuccessRate: Number(baselineArm.insertSuccessRate || 0),
      strategyGuidedInsertSuccessRate: Number(guidedArm.insertSuccessRate || 0)
    },
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      derivedFromAggregateExperimentMetrics: true,
      aggregateOnly: true
    }
  };
}

function strategyWeightMatchScore(item = {}, context = {}) {
  const mode = safeToken(context.mode || "", "", 40);
  const tool = safeToken(context.tool || "", "", 80);
  const site = siteCohortToken(context.site || context.host || context.origin || "");
  const taskScenario = taskScenarioFromContext(context, "");
  const hasContext = Boolean(mode || tool || site || taskScenario);
  if (!hasContext) return 1;
  const topKeys = (field) => (item[field] || []).map((entry) => safeToken(entry.key || entry, "", 180)).filter(Boolean);
  let score = 0;
  if (mode && topKeys("topModes").includes(mode)) score += 1;
  if (tool && topKeys("topTools").includes(tool)) score += 1;
  if (site && topKeys("topSites").includes(site)) score += 1;
  if (taskScenario && topKeys("topTaskScenarios").includes(taskScenario)) score += 1;
  return score;
}

function buildWeightedStrategy(item = {}, status = "exploring", context = {}) {
  const outcomeCount = Number(item.outcomeCount || 0);
  const outcomeSuccessRate = Number(item.outcomeSuccessRate || 0);
  const avgOutcomeScore = Number.isFinite(Number(item.avgOutcomeScore)) ? Number(item.avgOutcomeScore) : null;
  const sampleWeight = Math.min(0.35, outcomeCount / 20);
  const scoreWeight = avgOutcomeScore === null ? 0 : avgOutcomeScore * 0.35;
  const successWeight = outcomeSuccessRate * 0.65;
  const weight = status === "suppressed"
    ? round(Math.max(0.1, 1 - ((1 - outcomeSuccessRate) * 0.85) - sampleWeight))
    : status === "promoted"
      ? round(1 + successWeight + scoreWeight + sampleWeight)
      : round(0.75 + sampleWeight);
  return {
    strategyId: safeToken(item.key || item.strategyId || "", "unknown", 180),
    status,
    outcomeCount,
    outcomeSuccessRate: round(outcomeSuccessRate),
    avgOutcomeScore: avgOutcomeScore === null ? null : round(avgOutcomeScore),
    weight,
    matchScore: strategyWeightMatchScore(item, context),
    topModes: item.topModes || [],
    topTools: item.topTools || [],
    topSites: item.topSites || [],
    topTaskScenarios: item.topTaskScenarios || []
  };
}

function sortWeightedStrategies(left, right) {
  return right.matchScore - left.matchScore
    || right.outcomeCount - left.outcomeCount
    || right.outcomeSuccessRate - left.outcomeSuccessRate
    || left.strategyId.localeCompare(right.strategyId);
}

function buildStrategyWeightPolicy(metrics = {}, context = {}, pilotOutcomeReportInput = null) {
  const pilotOutcomeReport = pilotOutcomeReportInput || buildPilotOutcomeReadinessReport(metrics);
  const strategies = Array.isArray(pilotOutcomeReport.byStrategy) ? pilotOutcomeReport.byStrategy : [];
  const promotedStrategies = strategies
    .filter((item) => item.status === "ready" && Number(item.outcomeSuccessRate || 0) >= 0.7)
    .map((item) => buildWeightedStrategy(item, "promoted", context))
    .sort(sortWeightedStrategies)
    .slice(0, 5);
  const suppressedStrategies = strategies
    .filter((item) => item.status === "ready" && Number(item.outcomeSuccessRate || 0) <= 0.35)
    .map((item) => buildWeightedStrategy(item, "suppressed", context))
    .sort(sortWeightedStrategies)
    .slice(0, 5);
  const exploringStrategies = strategies
    .filter((item) => item.status === "collecting")
    .map((item) => buildWeightedStrategy(item, "exploring", context))
    .sort(sortWeightedStrategies)
    .slice(0, 5);
  const readiness = pilotOutcomeReport.readiness || {};
  const recommendations = [];
  if (promotedStrategies.length) {
    recommendations.push({
      key: "promote_outcome_winner",
      priority: "high",
      strategyId: promotedStrategies[0].strategyId,
      recommendation: "Increase this prompt structure's influence because user-verified outcomes are ready and successful."
    });
  }
  if (suppressedStrategies.length) {
    recommendations.push({
      key: "suppress_outcome_risk",
      priority: "high",
      strategyId: suppressedStrategies[0].strategyId,
      recommendation: "Reduce this prompt structure's influence because user-verified outcomes show repeated failure."
    });
  }
  if (exploringStrategies.length) {
    recommendations.push({
      key: "continue_outcome_exploration",
      priority: "medium",
      strategyId: exploringStrategies[0].strategyId,
      recommendation: "Keep collecting outcomes for promising or uncertain strategies before changing defaults."
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      key: "collect_outcome_weights",
      priority: readiness.totalOutcomeEvents ? "medium" : "high",
      strategyId: "",
      recommendation: "Collect user-verified outcomes before changing strategy weights."
    });
  }
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    weightPolicyVersion: STRATEGY_WEIGHT_POLICY_VERSION,
    pilotOutcomeVersion: pilotOutcomeReport.reportVersion || PILOT_OUTCOME_REPORT_VERSION,
    readiness: {
      status: readiness.status || "empty",
      minOutcomeEvents: readiness.minOutcomeEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
      totalOutcomeEvents: Number(readiness.totalOutcomeEvents || 0),
      outcomeSuccessRate: Number(readiness.outcomeSuccessRate || 0),
      avgOutcomeScore: readiness.avgOutcomeScore ?? null,
      promotedStrategyCount: promotedStrategies.length,
      suppressedStrategyCount: suppressedStrategies.length,
      exploringStrategyCount: exploringStrategies.length
    },
    promotedStrategies,
    suppressedStrategies,
    exploringStrategies,
    selectedPromotion: promotedStrategies[0] || null,
    selectedSuppression: suppressedStrategies[0] || null,
    recommendations: recommendations.slice(0, 5),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      derivedFromAggregatePilotOutcomes: true,
      aggregateOnly: true
    }
  };
}

function formatStrategyWeightPolicy(policy = {}) {
  const readiness = policy.readiness || {};
  const promoted = (policy.promotedStrategies || [])
    .slice(0, 3)
    .map((item) => `${item.strategyId}:weight=${item.weight}:outcomes=${item.outcomeCount}:success=${item.outcomeSuccessRate}`)
    .join(" | ") || "none";
  const suppressed = (policy.suppressedStrategies || [])
    .slice(0, 3)
    .map((item) => `${item.strategyId}:weight=${item.weight}:outcomes=${item.outcomeCount}:success=${item.outcomeSuccessRate}`)
    .join(" | ") || "none";
  const exploring = (policy.exploringStrategies || [])
    .slice(0, 3)
    .map((item) => `${item.strategyId}:outcomes=${item.outcomeCount}:need=${Math.max(0, (readiness.minOutcomeEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS) - item.outcomeCount)}`)
    .join(" | ") || "none";
  const recommendations = (policy.recommendations || [])
    .slice(0, 4)
    .map((item) => `${item.key}:${item.strategyId || "all"}`)
    .join(" | ") || "none";
  return [
    `strategyWeight=${policy.weightPolicyVersion || STRATEGY_WEIGHT_POLICY_VERSION}`,
    `readiness=${readiness.status || "empty"} total=${readiness.totalOutcomeEvents || 0}`,
    `promoted=${promoted}`,
    `suppressed=${suppressed}`,
    `exploring=${exploring}`,
    `recommendations=${recommendations}`,
    "privacy=aggregate-only"
  ].join("; ");
}
