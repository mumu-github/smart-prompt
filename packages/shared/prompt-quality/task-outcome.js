function buildTaskOutcomeReport(metrics = {}, context = {}) {
  const taskScenario = taskScenarioFromContext(context, "");
  const strategySource = strategyMetricsForContext(metrics, context);
  const allStrategies = Object.entries(strategySource)
    .map(([strategyId, entry]) => normalizeStrategyEntry(strategyId, entry, context));
  const relevantStrategies = allStrategies.filter((entry) => entry.matchesMode && entry.matchesTool && entry.matchesAdapter && entry.matchesSite && entry.matchesScenario);
  const ranked = (relevantStrategies.length ? relevantStrategies : allStrategies)
    .filter((entry) => entry.outcomes > 0)
    .sort((left, right) => {
      return right.outcomeSuccessRate - left.outcomeSuccessRate
        || Number(right.avgOutcomeScore || 0) - Number(left.avgOutcomeScore || 0)
        || right.outcomes - left.outcomes
        || right.score - left.score
        || left.strategyId.localeCompare(right.strategyId);
    });
  const outcomeCount = ranked.reduce((sum, entry) => sum + entry.outcomes, 0);
  const successfulOutcomeCount = ranked.reduce((sum, entry) => sum + entry.successfulOutcomes, 0);
  const weightedOutcomeScoreTotal = ranked.reduce((sum, entry) => {
    if (!Number.isFinite(Number(entry.avgOutcomeScore))) return sum;
    return sum + (Number(entry.avgOutcomeScore) * entry.outcomes);
  }, 0);
  const outcomeScoreCount = ranked.reduce((sum, entry) => {
    return Number.isFinite(Number(entry.avgOutcomeScore)) ? sum + entry.outcomes : sum;
  }, 0);
  const status = !outcomeCount ? "empty" : outcomeCount >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS ? "ready" : "collecting";
  const recommendations = [];
  const addRecommendation = (key, priority, recommendation, strategyId = "") => {
    if (recommendations.some((item) => item.key === key && item.strategyId === safeToken(strategyId, "", 180))) return;
    recommendations.push({
      key,
      priority,
      strategyId: strategyId ? safeToken(strategyId, "", 180) : "",
      recommendation
    });
  };
  const winner = ranked.find((entry) => entry.outcomes >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS && entry.outcomeSuccessRate >= 0.7);
  const risk = ranked.find((entry) => entry.outcomes >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS && entry.outcomeSuccessRate <= 0.35);
  if (!outcomeCount) {
    addRecommendation("collect_task_outcomes", "high", "Record user-verified task outcomes after prompt insertion so quality can be validated beyond usage signals.");
  } else if (winner) {
    addRecommendation("prefer_task_outcome_winner", "medium", "Prioritize prompt structures that repeatedly lead to successful user-verified task outcomes.", winner.strategyId);
  } else if (risk) {
    addRecommendation("review_low_outcome_strategy", "high", "Avoid strategy shapes with repeated task outcome failures until they are reviewed.", risk.strategyId);
  } else {
    addRecommendation("collect_more_task_outcomes", "medium", "Keep collecting task outcomes until a scenario-specific strategy winner is reliable.");
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    reportVersion: "v6-task-outcome@1",
    cohort: {
      mode: safeToken(context.mode || "", "", 40),
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: safeToken(context.site || context.host || context.origin || "", "", 120),
      taskScenario
    },
    readiness: {
      status,
      minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
      outcomeCount,
      successfulOutcomeCount,
      outcomeSuccessRate: outcomeCount ? round(successfulOutcomeCount / outcomeCount) : 0,
      avgOutcomeScore: outcomeScoreCount ? round(weightedOutcomeScoreTotal / outcomeScoreCount) : null,
      strategyCount: allStrategies.length,
      outcomeStrategyCount: ranked.length
    },
    topOutcomeStrategies: ranked.slice(0, 5).map((entry) => ({
      strategyId: entry.strategyId,
      score: entry.score,
      events: entry.events,
      outcomes: entry.outcomes,
      successfulOutcomes: entry.successfulOutcomes,
      outcomeSuccessRate: entry.outcomeSuccessRate,
      avgOutcomeScore: entry.avgOutcomeScore,
      insertSuccessRate: entry.insertSuccessRate,
      saveRate: entry.saveRate,
      retryUsageRate: entry.retryUsageRate,
      undoUsageRate: entry.undoUsageRate,
      reliable: entry.outcomes >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
      cohort: {
        matchesMode: entry.matchesMode,
        matchesTool: entry.matchesTool,
        matchesAdapter: entry.matchesAdapter,
        matchesSite: entry.matchesSite,
        matchesScenario: entry.matchesScenario,
        scenarios: entry.scenarios
      }
    })),
    recommendations: recommendations.slice(0, 5),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      derivedFromAggregateTaskOutcomes: true,
      aggregateOnly: true
    }
  };
}

function buildTaskOutcomePolicy(taskOutcomeReport = {}) {
  const readiness = taskOutcomeReport.readiness || {};
  const recommendation = (taskOutcomeReport.recommendations || [])[0] || {};
  const winner = (taskOutcomeReport.topOutcomeStrategies || [])[0] || {};
  const status = safeToken(readiness.status || "empty", "empty", 40);
  const recommendationKey = safeToken(recommendation.key || "", "", 80);
  let decision = status;
  let confidence = status === "ready" ? "medium" : status === "collecting" ? "low" : "none";
  let reason = recommendation.recommendation || "Task outcome samples are not available yet.";
  if (status === "ready" && recommendationKey === "prefer_task_outcome_winner") {
    decision = "prefer_task_outcome_winner";
    confidence = "medium";
  } else if (status === "ready" && recommendationKey === "review_low_outcome_strategy") {
    decision = "review_low_outcome_strategy";
    confidence = "medium";
  } else if (status === "collecting") {
    decision = "collecting";
  } else if (status === "empty") {
    decision = "empty";
  }
  return {
    status,
    decision,
    confidence,
    recommendationKey,
    reason,
    outcomeCount: Number(readiness.outcomeCount || 0),
    outcomeSuccessRate: Number.isFinite(Number(readiness.outcomeSuccessRate)) ? round(Number(readiness.outcomeSuccessRate)) : 0,
    avgOutcomeScore: Number.isFinite(Number(readiness.avgOutcomeScore)) ? round(Number(readiness.avgOutcomeScore)) : null,
    sourceStrategyId: safeToken(recommendation.strategyId || winner.strategyId || "", "", 180),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      derivedFromAggregateTaskOutcomes: true,
      aggregateOnly: true
    }
  };
}

function formatTaskOutcomeReport(report = {}) {
  const readiness = report.readiness || {};
  const cohort = report.cohort || {};
  const topStrategies = (report.topOutcomeStrategies || [])
    .slice(0, 3)
    .map((item) => `${item.strategyId} outcomes=${item.outcomes} success=${item.outcomeSuccessRate} avgOutcome=${item.avgOutcomeScore ?? "none"} insert=${item.insertSuccessRate} retry=${item.retryUsageRate}`)
    .join(" | ") || "none";
  const recommendations = (report.recommendations || [])
    .slice(0, 4)
    .map((item) => `${item.key}:${item.recommendation}`)
    .join(" | ") || "none";
  return [
    `taskOutcome=${report.reportVersion || "v6-task-outcome@1"}`,
    `scenario=${cohort.taskScenario || "general"}`,
    `readiness=${readiness.status || "empty"} outcomes=${readiness.outcomeCount || 0} success=${readiness.outcomeSuccessRate || 0} avgOutcome=${readiness.avgOutcomeScore ?? "none"}`,
    `topOutcomeStrategies=${topStrategies}`,
    `recommendations=${recommendations}`,
    "privacy=aggregate-only"
  ].join("; ");
}
