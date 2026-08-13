function siteCohortToken(value = "") {
  const text = normalizeText(value);
  if (!text) return "unknown";
  try {
    return safeToken(new URL(text).hostname, "unknown", 120);
  } catch {
    return safeToken(text.split(/[/?#]/)[0], "unknown", 120);
  }
}

function pilotCohortToken(value = "", dimension = "") {
  if (dimension === "site") return siteCohortToken(value);
  const limit = dimension === "strategyId" ? 180 : 80;
  return safeToken(value, "unknown", limit);
}

function outcomeScoreValue(event = {}) {
  const value = event.outcomeScore ?? event.outcome_score;
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? clamp(Number(value), 0, 1)
    : null;
}

function summarizeOutcomeEvents(events = {}, dimension = "", key = "") {
  const outcomeEvents = Array.isArray(events) ? events : [];
  const outcomeCount = outcomeEvents.length;
  const successfulOutcomeCount = outcomeEvents.filter(isSuccessfulTaskOutcome).length;
  const failedOutcomeCount = outcomeEvents.filter((event) => {
    const label = safeToken(event.outcomeLabel || event.outcome_label || event.outcome || event.result || "", "", 80);
    return FAILED_OUTCOME_LABELS.has(label) || (isTaskOutcomeMetric(event) && event.ok === false && !isSuccessfulTaskOutcome(event));
  }).length;
  const labelCounts = {};
  const strategyCounts = {};
  const toolCounts = {};
  const siteCounts = {};
  const modeCounts = {};
  const scenarioCounts = {};
  const experimentArmCounts = {};
  const scores = [];
  for (const event of outcomeEvents) {
    const label = safeToken(event.outcomeLabel || event.outcome_label || event.outcome || event.result || "", "", 80);
    if (label) labelCounts[label] = (labelCounts[label] || 0) + 1;
    const strategyId = pilotCohortToken(event.strategyId || event.strategy_id || "unknown", "strategyId");
    strategyCounts[strategyId] = (strategyCounts[strategyId] || 0) + 1;
    const tool = pilotCohortToken(event.tool || "unknown", "tool");
    toolCounts[tool] = (toolCounts[tool] || 0) + 1;
    const site = pilotCohortToken(event.site || event.host || "unknown", "site");
    siteCounts[site] = (siteCounts[site] || 0) + 1;
    const mode = pilotCohortToken(event.mode || "unknown", "mode");
    modeCounts[mode] = (modeCounts[mode] || 0) + 1;
    const scenario = pilotCohortToken(event.taskScenario || event.task_scenario || event.scenario || "general", "taskScenario");
    scenarioCounts[scenario] = (scenarioCounts[scenario] || 0) + 1;
    const experimentArm = pilotCohortToken(event.experimentArm || event.experiment_arm || "none", "experimentArm");
    experimentArmCounts[experimentArm] = (experimentArmCounts[experimentArm] || 0) + 1;
    const score = outcomeScoreValue(event);
    if (score !== null) scores.push(score);
  }
  const status = !outcomeCount ? "empty" : outcomeCount >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS ? "ready" : "collecting";
  return {
    dimension,
    key: pilotCohortToken(key || "unknown", dimension),
    status,
    minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
    outcomeCount,
    successfulOutcomeCount,
    failedOutcomeCount,
    neededOutcomeEvents: Math.max(0, PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS - outcomeCount),
    outcomeSuccessRate: outcomeCount ? round(successfulOutcomeCount / outcomeCount) : 0,
    avgOutcomeScore: scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    outcomeLabels: topEntries(labelCounts, 5),
    topStrategies: topEntries(strategyCounts, 3),
    topTools: topEntries(toolCounts, 3),
    topSites: topEntries(siteCounts, 3),
    topModes: topEntries(modeCounts, 3),
    topTaskScenarios: topEntries(scenarioCounts, 3),
    topExperimentArms: topEntries(experimentArmCounts, 3)
  };
}

function groupOutcomeEvents(outcomeEvents = [], dimension = "", expectedKeys = []) {
  const groups = {};
  for (const expectedKey of expectedKeys) {
    groups[pilotCohortToken(expectedKey, dimension)] = [];
  }
  for (const event of outcomeEvents) {
    const value = dimension === "taskScenario"
      ? event.taskScenario || event.task_scenario || event.scenario || "general"
      : dimension === "site"
        ? event.site || event.host || "unknown"
        : event[dimension] || event[dimension.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] || "unknown";
    const key = pilotCohortToken(value, dimension);
    groups[key] = groups[key] || [];
    groups[key].push(event);
  }
  return Object.entries(groups)
    .map(([key, events]) => summarizeOutcomeEvents(events, dimension, key))
    .sort((left, right) => {
      const statusRank = { ready: 0, collecting: 1, empty: 2 };
      return (statusRank[left.status] ?? 3) - (statusRank[right.status] ?? 3)
        || right.outcomeCount - left.outcomeCount
        || left.key.localeCompare(right.key);
    });
}

function buildPilotOutcomeReadinessReport(metrics = {}, options = {}) {
  const rawEvents = Array.isArray(metrics.events) ? metrics.events : [];
  const outcomeEvents = rawEvents.filter(isTaskOutcomeMetric);
  const expectedTaskScenarios = Array.from(new Set([
    ...(Array.isArray(options.expectedTaskScenarios) ? options.expectedTaskScenarios : []),
    ...TASK_SCENARIO_RULES.map((rule) => rule.id),
    "general"
  ])).map((item) => pilotCohortToken(item, "taskScenario"));
  const byTaskScenario = groupOutcomeEvents(outcomeEvents, "taskScenario", expectedTaskScenarios);
  const byTool = groupOutcomeEvents(outcomeEvents, "tool");
  const bySite = groupOutcomeEvents(outcomeEvents, "site");
  const byMode = groupOutcomeEvents(outcomeEvents, "mode");
  const byStrategy = groupOutcomeEvents(outcomeEvents, "strategyId");
  const byExperimentArm = groupOutcomeEvents(outcomeEvents, "experimentArm");
  const overall = summarizeOutcomeEvents(outcomeEvents, "overall", "all");
  const readyCohorts = byTaskScenario.filter((item) => item.status === "ready").length;
  const collectingCohorts = byTaskScenario.filter((item) => item.status === "collecting").length;
  const emptyCohorts = byTaskScenario.filter((item) => item.status === "empty").length;
  const winningStrategies = byStrategy
    .filter((item) => item.status === "ready" && item.outcomeSuccessRate >= 0.7)
    .slice(0, 5);
  const riskStrategies = byStrategy
    .filter((item) => item.status === "ready" && item.outcomeSuccessRate <= 0.35)
    .slice(0, 5);
  const collectionTargets = [
    ...byTaskScenario.filter((item) => item.status !== "ready"),
    ...byTool.filter((item) => item.status === "collecting"),
    ...bySite.filter((item) => item.status === "collecting"),
    ...byMode.filter((item) => item.status === "collecting")
  ].slice(0, 8).map((item) => ({
    dimension: item.dimension,
    key: item.key,
    status: item.status,
    outcomeCount: item.outcomeCount,
    neededOutcomeEvents: item.neededOutcomeEvents,
    recommendation: item.status === "empty"
      ? "Collect first user-verified outcomes for this cohort."
      : "Collect more user-verified outcomes until the cohort reaches the comparable threshold."
  }));
  const status = !overall.outcomeCount ? "empty" : readyCohorts ? "ready" : "collecting";
  const recommendations = [];
  if (!overall.outcomeCount) {
    recommendations.push({ key: "start_pilot_collection", priority: "high", recommendation: "Record success/needs-work/failed outcomes on real prompt cards." });
  } else if (!readyCohorts) {
    recommendations.push({ key: "collect_more_outcomes", priority: "high", recommendation: "Continue pilot collection until at least one task scenario reaches the comparable threshold." });
  } else {
    recommendations.push({ key: "review_ready_cohorts", priority: "medium", recommendation: "Review ready task scenarios and compare winning/risk prompt strategies before changing defaults." });
  }
  if (riskStrategies.length) {
    recommendations.push({ key: "review_risk_strategies", priority: "high", recommendation: "Inspect low-success strategies and avoid expanding them until fixed." });
  }
  if (collectionTargets.length) {
    recommendations.push({ key: "fill_collection_gaps", priority: "medium", recommendation: "Collect outcomes for empty or collecting cohorts before claiming global quality improvement." });
  }
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    reportVersion: PILOT_OUTCOME_REPORT_VERSION,
    createdAt: new Date().toISOString(),
    readiness: {
      status,
      minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
      totalOutcomeEvents: overall.outcomeCount,
      readyTaskScenarioCohorts: readyCohorts,
      collectingTaskScenarioCohorts: collectingCohorts,
      emptyTaskScenarioCohorts: emptyCohorts,
      outcomeSuccessRate: overall.outcomeSuccessRate,
      avgOutcomeScore: overall.avgOutcomeScore
    },
    byTaskScenario,
    byTool,
    bySite,
    byMode,
    byStrategy,
    byExperimentArm,
    winningStrategies,
    riskStrategies,
    collectionTargets,
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

function formatPilotOutcomeReadinessReport(report = {}) {
  const readiness = report.readiness || {};
  const scenarioSummary = (report.byTaskScenario || [])
    .slice(0, 5)
    .map((item) => `${item.key}:${item.status}:${item.outcomeCount}/${item.minOutcomeEvents}:success=${item.outcomeSuccessRate}`)
    .join(" | ") || "none";
  const winners = (report.winningStrategies || [])
    .slice(0, 3)
    .map((item) => `${item.key}:outcomes=${item.outcomeCount}:success=${item.outcomeSuccessRate}`)
    .join(" | ") || "none";
  const risks = (report.riskStrategies || [])
    .slice(0, 3)
    .map((item) => `${item.key}:outcomes=${item.outcomeCount}:success=${item.outcomeSuccessRate}`)
    .join(" | ") || "none";
  const targets = (report.collectionTargets || [])
    .slice(0, 5)
    .map((item) => `${item.dimension}:${item.key}:need=${item.neededOutcomeEvents}`)
    .join(" | ") || "none";
  return [
    `pilotOutcome=${report.reportVersion || PILOT_OUTCOME_REPORT_VERSION}`,
    `readiness=${readiness.status || "empty"} total=${readiness.totalOutcomeEvents || 0} readyScenarios=${readiness.readyTaskScenarioCohorts || 0} collectingScenarios=${readiness.collectingTaskScenarioCohorts || 0} emptyScenarios=${readiness.emptyTaskScenarioCohorts || 0}`,
    `scenarios=${scenarioSummary}`,
    `winners=${winners}`,
    `risks=${risks}`,
    `collectionTargets=${targets}`,
    "privacy=aggregate-only"
  ].join("; ");
}
