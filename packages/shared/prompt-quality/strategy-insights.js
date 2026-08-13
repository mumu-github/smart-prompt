function strategyConfidence(events) {
  const count = Number(events || 0);
  if (count >= 20) return "high";
  if (count >= 6) return "medium";
  if (count > 0) return "low";
  return "none";
}

function topTokens(object = {}, limit = 3) {
  return topEntries(object, limit).map((item) => item.key);
}

function hasTokenCount(object = {}, token = "") {
  const key = safeToken(token, "", 80);
  if (!key) return false;
  return Number(object[key] || object[token] || 0) > 0;
}

function explorationRate(eventCount, reliableStrategyCount) {
  const count = Number(eventCount || 0);
  if (reliableStrategyCount <= 0) return count >= 10 ? 0.18 : 0.25;
  if (count < 30) return 0.12;
  return 0.05;
}

function topCountEntries(object = {}, limit = 5) {
  return topEntries(object, limit)
    .map((item) => ({
      key: safeToken(item.key, "unknown", 120),
      value: Number(item.value || 0)
    }))
    .filter((item) => item.key && item.value > 0);
}

function aggregateStrategyDimension(byStrategy = {}, dimension, limit = 5) {
  const counts = {};
  for (const entry of Object.values(byStrategy || {})) {
    for (const [key, value] of Object.entries(entry?.[dimension] || {})) {
      const token = safeToken(key, "", 120);
      if (token) counts[token] = (counts[token] || 0) + Number(value || 0);
    }
  }
  return topCountEntries(counts, limit);
}

function strategyMetricsForContext(metrics = {}, context = {}) {
  const taskScenario = taskScenarioFromContext(context, "");
  if (taskScenario && metrics.byScenarioStrategy && metrics.byScenarioStrategy[taskScenario]) {
    return metrics.byScenarioStrategy[taskScenario];
  }
  return metrics.byStrategy || {};
}

function experimentArmMetricsForContext(metrics = {}, context = {}) {
  const taskScenario = taskScenarioFromContext(context, "");
  if (taskScenario && metrics.byScenarioExperimentArm && metrics.byScenarioExperimentArm[taskScenario]) {
    return metrics.byScenarioExperimentArm[taskScenario];
  }
  return metrics.byExperimentArm || {};
}

function normalizeStrategyEntry(strategyId, entry = {}, context = {}) {
  const mode = safeToken(context.mode || "", "", 40);
  const tool = safeToken(context.tool || "", "", 80);
  const adapterId = safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80);
  const site = safeToken(context.site || context.host || context.origin || "", "", 120);
  const taskScenario = taskScenarioFromContext(context, "");
  const events = Number(entry.events || 0);
  const insertAttempts = Number(entry.insertAttempts || 0);
  const verifiedInserts = Number(entry.verifiedInserts || 0);
  const saves = Number(entry.saves || 0);
  const retries = Number(entry.retries || 0);
  const undos = Number(entry.undos || 0);
  const cardReady = Number(entry.cardReady || 0);
  const outcomes = Number(entry.outcomes || 0);
  const successfulOutcomes = Number(entry.successfulOutcomes || 0);
  const insertSuccessRate = Number.isFinite(Number(entry.insertSuccessRate))
    ? Number(entry.insertSuccessRate)
    : insertAttempts ? verifiedInserts / insertAttempts : 0;
  const saveRate = Number.isFinite(Number(entry.saveRate))
    ? Number(entry.saveRate)
    : cardReady ? saves / cardReady : 0;
  const retryUsageRate = Number.isFinite(Number(entry.retryUsageRate))
    ? Number(entry.retryUsageRate)
    : cardReady ? retries / cardReady : 0;
  const undoUsageRate = Number.isFinite(Number(entry.undoUsageRate))
    ? Number(entry.undoUsageRate)
    : insertAttempts ? undos / insertAttempts : 0;
  const avgQualityScore = Number.isFinite(Number(entry.avgQualityScore)) ? Number(entry.avgQualityScore) : 0;
  const outcomeSuccessRate = Number.isFinite(Number(entry.outcomeSuccessRate))
    ? Number(entry.outcomeSuccessRate)
    : outcomes ? successfulOutcomes / outcomes : 0;
  const avgOutcomeScore = Number.isFinite(Number(entry.avgOutcomeScore)) ? Number(entry.avgOutcomeScore) : null;
  const failures = Number(entry.failures || Math.max(insertAttempts - verifiedInserts, 0));
  const safeStrategyId = safeToken(strategyId, "unknown", 180);
  const modes = entry.modes || {};
  const tools = entry.tools || {};
  const adapters = entry.adapters || {};
  const sites = entry.sites || {};
  const scenarios = entry.scenarios || entry.taskScenarios || {};
  const matchesMode = mode ? safeStrategyId.includes(`:${mode}:`) || safeStrategyId.includes(`${mode}:`) || hasTokenCount(modes, mode) : true;
  const matchesTool = tool ? hasTokenCount(tools, tool) : true;
  const matchesAdapter = adapterId ? hasTokenCount(adapters, adapterId) : true;
  const matchesSite = site ? hasTokenCount(sites, site) : true;
  const matchesScenario = taskScenario ? safeStrategyId.includes(taskScenario) || hasTokenCount(scenarios, taskScenario) : true;
  const cohortBoost = (matchesMode ? 0.02 : 0)
    + (matchesTool ? 0.015 : 0)
    + (matchesAdapter ? 0.015 : 0)
    + (taskScenario && matchesScenario ? 0.025 : 0);
  const outcomeBoost = outcomes
    ? (outcomeSuccessRate * 0.08)
      + ((Number.isFinite(avgOutcomeScore) ? avgOutcomeScore : 0) * 0.08)
      + (Math.min(outcomes, 8) / 8 * 0.04)
    : 0;
  const score = round(
    (insertSuccessRate * 0.34)
    + (saveRate * 0.24)
    + (avgQualityScore * 0.18)
    + (Math.min(events, 20) / 20 * 0.08)
    + outcomeBoost
    - (retryUsageRate * 0.09)
    - (undoUsageRate * 0.07)
    - (failures ? Math.min(failures, 5) / 5 * 0.06 : 0)
    + cohortBoost
  );
  return {
    strategyId: safeStrategyId,
    score,
    events,
    confidence: strategyConfidence(events),
    reliable: events >= PROMPT_STRATEGY_MIN_RELIABLE_EVENTS,
    matchesMode,
    matchesTool,
    matchesAdapter,
    matchesSite,
    matchesScenario,
    insertSuccessRate: round(insertSuccessRate),
    saveRate: round(saveRate),
    retryUsageRate: round(retryUsageRate),
    undoUsageRate: round(undoUsageRate),
    avgQualityScore: round(avgQualityScore),
    outcomes,
    successfulOutcomes,
    outcomeSuccessRate: round(outcomeSuccessRate),
    avgOutcomeScore: Number.isFinite(avgOutcomeScore) ? round(avgOutcomeScore) : null,
    failures,
    modes: topTokens(modes),
    tools: topTokens(tools),
    adapters: topTokens(adapters),
    sites: topTokens(sites),
    scenarios: topTokens(scenarios)
  };
}

function strategyDecisionHint(entry = {}) {
  if (entry.outcomes >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS && entry.outcomeSuccessRate >= 0.7) return "task_outcome_winner";
  if (entry.outcomes >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS && entry.outcomeSuccessRate <= 0.35) return "task_outcome_risk";
  if (entry.reliable && entry.score >= 0.55) return "exploit_candidate";
  if (entry.events >= PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS && !entry.reliable && entry.score >= 0.55) return "explore_candidate";
  if (entry.events >= PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS && (entry.insertSuccessRate < 0.5 || entry.retryUsageRate >= 0.5 || entry.undoUsageRate >= 0.35 || entry.failures > 0)) {
    return "risk_watch";
  }
  if (entry.events > 0 && !entry.reliable) return "collect_samples";
  return "observe";
}

function buildStrategyInsights(metrics = {}, context = {}) {
  const taskScenario = taskScenarioFromContext(context, "");
  const strategySource = strategyMetricsForContext(metrics, context);
  const allStrategies = Object.entries(strategySource)
    .map(([strategyId, entry]) => normalizeStrategyEntry(strategyId, entry, context));
  const relevantStrategies = allStrategies.filter((entry) => entry.matchesMode && entry.matchesTool && entry.matchesAdapter && entry.matchesSite && entry.matchesScenario);
  const ranked = (relevantStrategies.length ? relevantStrategies : allStrategies)
    .sort((left, right) => right.score - left.score || right.events - left.events || left.strategyId.localeCompare(right.strategyId));
  const reliableStrategies = allStrategies.filter((entry) => entry.reliable);
  const lowSampleCandidates = ranked.filter((entry) => entry.events >= PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS && !entry.reliable && entry.score >= 0.55);
  const riskSignals = ranked.filter((entry) => entry.events >= PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS && (
    entry.insertSuccessRate < 0.5
    || entry.retryUsageRate >= 0.5
    || entry.undoUsageRate >= 0.35
    || entry.failures > 0
  ));
  const eventCount = Number(metrics.eventCount || 0);
  const readinessStatus = !eventCount
    ? "empty"
    : reliableStrategies.length ? "ready" : lowSampleCandidates.length ? "exploring" : "collecting";
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

  if (!eventCount) {
    addRecommendation("collect_baseline_samples", "high", "Collect card_ready, insert, save, retry, and undo events before trusting any prompt strategy.");
  } else if (reliableStrategies.length) {
    const winner = ranked.find((entry) => entry.reliable && entry.score >= 0.55) || reliableStrategies.sort((left, right) => right.score - left.score)[0];
    if (winner) {
      addRecommendation("preserve_reliable_winner", "medium", "Reuse the reliable high-scoring structure while continuing to watch retry and undo rates.", winner.strategyId);
    }
  } else {
    addRecommendation("collect_reliable_samples", "high", "Keep the default structured prompt and collect more samples before exploiting a winner.");
  }
  if (lowSampleCandidates.length) {
    addRecommendation("explore_promising_strategy", "medium", "A promising strategy is below the reliable sample threshold; explore it without making it the default.", lowSampleCandidates[0].strategyId);
  }
  if (riskSignals.length) {
    addRecommendation("avoid_risky_strategy", "high", "Avoid weak strategy shapes with insert failures, high retry, or high undo usage.", riskSignals[0].strategyId);
  }
  if (Number(metrics.retryUsageRate || 0) >= 0.3) {
    addRecommendation("reduce_retry", "medium", "Make generated prompts more complete up front with assumptions, missing information, and acceptance criteria.");
  }
  if (Number(metrics.adapterFailureRate || 0) >= 0.3) {
    addRecommendation("protect_insertability", "high", "Prefer compact plain text that is resilient in textarea and contenteditable insertion.");
  }
  if (allStrategies.length && !relevantStrategies.length) {
    addRecommendation("collect_cohort_samples", "medium", "No strategy samples match the current mode, tool, adapter, site, and task scenario; keep collecting cohort-specific feedback.");
  }
  if (!recommendations.length) {
    addRecommendation("steady_state", "low", "Maintain the current structured prompt while monitoring adoption and failure signals.");
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    insightVersion: "v6-strategy-insights@1",
    strategyPolicy: {
      version: PROMPT_STRATEGY_POLICY_VERSION,
      minCandidateEvents: PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS,
      minReliableEvents: PROMPT_STRATEGY_MIN_RELIABLE_EVENTS,
      explorationRate: explorationRate(eventCount, reliableStrategies.length)
    },
    cohort: {
      mode: safeToken(context.mode || "", "", 40),
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: safeToken(context.site || context.host || context.origin || "", "", 120),
      taskScenario
    },
    readiness: {
      status: readinessStatus,
      eventCount,
      strategyCount: allStrategies.length,
      relevantStrategyCount: relevantStrategies.length,
      reliableStrategyCount: reliableStrategies.length,
      lowSampleStrategyCount: allStrategies.filter((entry) => entry.events > 0 && !entry.reliable).length,
      sampleThresholdMet: reliableStrategies.length > 0
    },
    topStrategies: ranked.slice(0, 5).map((entry) => ({
      strategyId: entry.strategyId,
      score: entry.score,
      events: entry.events,
      confidence: entry.confidence,
      reliable: entry.reliable,
      decisionHint: strategyDecisionHint(entry),
      insertSuccessRate: entry.insertSuccessRate,
      saveRate: entry.saveRate,
      retryUsageRate: entry.retryUsageRate,
      undoUsageRate: entry.undoUsageRate,
      avgQualityScore: entry.avgQualityScore,
      outcomes: entry.outcomes,
      outcomeSuccessRate: entry.outcomeSuccessRate,
      avgOutcomeScore: entry.avgOutcomeScore,
      failures: entry.failures,
      cohort: {
        matchesMode: entry.matchesMode,
        matchesTool: entry.matchesTool,
        matchesAdapter: entry.matchesAdapter,
        matchesSite: entry.matchesSite,
        matchesScenario: entry.matchesScenario,
        modes: entry.modes,
        tools: entry.tools,
        adapters: entry.adapters,
        sites: entry.sites,
        scenarios: entry.scenarios
      }
    })),
    riskSignals: riskSignals.slice(0, 4).map((entry) => ({
      strategyId: entry.strategyId,
      events: entry.events,
      insertSuccessRate: entry.insertSuccessRate,
      retryUsageRate: entry.retryUsageRate,
      undoUsageRate: entry.undoUsageRate,
      outcomes: entry.outcomes,
      outcomeSuccessRate: entry.outcomeSuccessRate,
      failures: entry.failures
    })),
    lowSampleCandidates: lowSampleCandidates.slice(0, 4).map((entry) => ({
      strategyId: entry.strategyId,
      score: entry.score,
      events: entry.events,
      reliable: entry.reliable
    })),
    cohorts: {
      modes: aggregateStrategyDimension(metrics.byStrategy, "modes"),
      tools: aggregateStrategyDimension(metrics.byStrategy, "tools"),
      adapters: aggregateStrategyDimension(metrics.byStrategy, "adapters"),
      sites: aggregateStrategyDimension(metrics.byStrategy, "sites"),
      scenarios: aggregateStrategyDimension(metrics.byStrategy, "scenarios")
    },
    recommendations: recommendations.slice(0, 6),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      derivedFromAggregateStrategyMetrics: true,
      cohortOnly: true
    }
  };
}

function setSelectedStrategy(plan, id, confidence, reason, sourceStrategyId = "", decision = "exploit") {
  plan.selectedStrategy = {
    id,
    version: plan.strategyPolicy?.version || PROMPT_STRATEGY_POLICY_VERSION,
    confidence,
    reason,
    decision,
    sourceStrategyId: sourceStrategyId ? safeToken(sourceStrategyId, "", 180) : ""
  };
}
