function qualityLiftContextMatches(event = {}, context = {}) {
  const pairs = [
    ["mode", safeToken(context.mode || "", "", 40), safeToken(getEventField(event, "mode") || "", "", 40)],
    ["tool", safeToken(context.tool || "", "", 80), safeToken(getEventField(event, "tool") || "", "", 80)],
    ["adapterId", safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80), safeToken(getEventField(event, "adapterId") || "", "", 80)],
    ["site", siteCohortToken(context.site || context.host || context.origin || ""), siteCohortToken(getEventField(event, "site") || getEventField(event, "host") || "")],
    ["taskScenario", taskScenarioFromContext(context, ""), safeToken(getEventField(event, "taskScenario") || getEventField(event, "scenario") || "", "", 80)]
  ];
  return pairs.every(([, expected, actual]) => !expected || expected === "unknown" || expected === actual);
}

function deriveQualityLiftCohort(event = {}) {
  const explicit = safeToken(getEventField(event, "qualityLiftCohort") || "", "", 80);
  if (explicit === "baseline" || explicit === "baseline-structure") return "baseline_structure";
  if (explicit === "strategy-guided") return "strategy_guided";
  if (explicit === "outcome-weighted") return "outcome_weighted";
  if (explicit) return explicit;
  const experimentArm = safeToken(getEventField(event, "experimentArm") || "", "", 80);
  const strategyWeightVersion = safeToken(getEventField(event, "strategyWeightVersion") || "", "", 80);
  const strategyWeightDecision = safeToken(getEventField(event, "strategyWeightDecision") || "", "", 80);
  const strategyWeightPromoted = safeToken(getEventField(event, "strategyWeightPromoted") || "", "", 180);
  const promptStrategyId = safeToken(getEventField(event, "promptStrategyId") || "", "", 80);
  if (experimentArm === "baseline_structure") return "baseline_structure";
  if (strategyWeightVersion && (
    strategyWeightDecision === "outcome_weight"
    || strategyWeightDecision === "outcome-weight"
    || (strategyWeightPromoted && promptStrategyId === "preserve_winning_strategy")
  )) {
    return "outcome_weighted";
  }
  if (experimentArm === "strategy_guided") return "strategy_guided";
  return experimentArm || (promptStrategyId ? "strategy_guided" : "unknown");
}

function summarizeQualityLiftCohort(events = [], cohort = "") {
  const cardReady = events.filter((event) => event.action === "card_ready").length;
  const insertEvents = events.filter((event) => event.action === "insert");
  const verifiedInserts = insertEvents.filter((event) => event.verified || event.adopted || event.ok).length;
  const saveEvents = events.filter((event) => event.action === "save");
  const retryEvents = events.filter((event) => event.action === "retry");
  const undoEvents = events.filter((event) => event.action === "undo");
  const outcomeEvents = events.filter(isTaskOutcomeMetric);
  const successfulOutcomes = outcomeEvents.filter(isSuccessfulTaskOutcome).length;
  const failedOutcomes = outcomeEvents.filter((event) => {
    const label = safeToken(getEventField(event, "outcomeLabel") || event.outcome || event.result || "", "", 80);
    return FAILED_OUTCOME_LABELS.has(label) || (event.ok === false && !isSuccessfulTaskOutcome(event));
  }).length;
  const outcomeScores = outcomeEvents
    .map((event) => outcomeScoreValue(event))
    .filter((score) => score !== null);
  const counts = {
    modes: {},
    tools: {},
    adapters: {},
    sites: {},
    taskScenarios: {},
    strategyIds: {},
    promptStrategyIds: {},
    experimentArms: {},
    strategyWeightVersions: {},
    strategyWeightStatuses: {},
    strategyWeightDecisions: {}
  };
  for (const event of events) {
    const bump = (field, key, dimension = field) => {
      const token = dimension === "site" ? siteCohortToken(key) : safeToken(key, "", dimension === "strategyId" ? 180 : 80);
      if (token) counts[field][token] = (counts[field][token] || 0) + 1;
    };
    bump("modes", getEventField(event, "mode"));
    bump("tools", getEventField(event, "tool"));
    bump("adapters", getEventField(event, "adapterId"));
    bump("sites", getEventField(event, "site") || getEventField(event, "host"), "site");
    bump("taskScenarios", getEventField(event, "taskScenario") || getEventField(event, "scenario"));
    bump("strategyIds", getEventField(event, "strategyId"), "strategyId");
    bump("promptStrategyIds", getEventField(event, "promptStrategyId"));
    bump("experimentArms", getEventField(event, "experimentArm"));
    bump("strategyWeightVersions", getEventField(event, "strategyWeightVersion"));
    bump("strategyWeightStatuses", getEventField(event, "strategyWeightStatus"));
    bump("strategyWeightDecisions", getEventField(event, "strategyWeightDecision"));
  }
  const outcomeCount = outcomeEvents.length;
  const status = !events.length ? "empty" : outcomeCount >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS ? "ready" : "collecting";
  return {
    cohort,
    status,
    minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
    events: events.length,
    cardReady,
    insertAttempts: insertEvents.length,
    verifiedInserts,
    saves: saveEvents.length,
    retries: retryEvents.length,
    undos: undoEvents.length,
    outcomeCount,
    successfulOutcomes,
    failedOutcomes,
    neededOutcomeEvents: Math.max(0, PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS - outcomeCount),
    insertSuccessRate: insertEvents.length ? round(verifiedInserts / insertEvents.length) : 0,
    saveRate: cardReady ? round(saveEvents.length / cardReady) : 0,
    retryUsageRate: cardReady ? round(retryEvents.length / cardReady) : 0,
    undoUsageRate: insertEvents.length ? round(undoEvents.length / insertEvents.length) : 0,
    outcomeSuccessRate: outcomeCount ? round(successfulOutcomes / outcomeCount) : 0,
    avgOutcomeScore: outcomeScores.length ? round(outcomeScores.reduce((sum, score) => sum + score, 0) / outcomeScores.length) : null,
    topModes: topCountEntries(counts.modes, 3),
    topTools: topCountEntries(counts.tools, 3),
    topSites: topCountEntries(counts.sites, 3),
    topTaskScenarios: topCountEntries(counts.taskScenarios, 3),
    topStrategies: topCountEntries(counts.strategyIds, 3),
    topPromptStrategies: topCountEntries(counts.promptStrategyIds, 3),
    topExperimentArms: topCountEntries(counts.experimentArms, 3),
    strategyWeightVersions: topCountEntries(counts.strategyWeightVersions, 3),
    strategyWeightStatuses: topCountEntries(counts.strategyWeightStatuses, 3),
    strategyWeightDecisions: topCountEntries(counts.strategyWeightDecisions, 3)
  };
}

function compareQualityLiftCohorts(baseline = {}, treatment = {}, name = "") {
  const comparable = Boolean(
    baseline.outcomeCount >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS
    && treatment.outcomeCount >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS
  );
  const avgOutcomeScoreLift = baseline.avgOutcomeScore === null || treatment.avgOutcomeScore === null
    ? null
    : round(treatment.avgOutcomeScore - baseline.avgOutcomeScore);
  const deltas = {
    outcomeSuccessRateLift: round(Number(treatment.outcomeSuccessRate || 0) - Number(baseline.outcomeSuccessRate || 0)),
    avgOutcomeScoreLift,
    insertSuccessRateLift: round(Number(treatment.insertSuccessRate || 0) - Number(baseline.insertSuccessRate || 0)),
    saveRateLift: round(Number(treatment.saveRate || 0) - Number(baseline.saveRate || 0)),
    retryUsageRateLift: round(Number(treatment.retryUsageRate || 0) - Number(baseline.retryUsageRate || 0)),
    undoUsageRateLift: round(Number(treatment.undoUsageRate || 0) - Number(baseline.undoUsageRate || 0))
  };
  let decision = "collecting";
  if (comparable) {
    if (
      deltas.outcomeSuccessRateLift >= 0.15
      && (deltas.avgOutcomeScoreLift === null || deltas.avgOutcomeScoreLift >= 0.05)
      && deltas.retryUsageRateLift <= 0.05
      && deltas.undoUsageRateLift <= 0.05
    ) {
      decision = "quality_lift_positive";
    } else if (
      deltas.outcomeSuccessRateLift <= -0.1
      || (deltas.avgOutcomeScoreLift !== null && deltas.avgOutcomeScoreLift <= -0.05)
      || deltas.retryUsageRateLift > 0.1
      || deltas.undoUsageRateLift > 0.1
    ) {
      decision = "quality_lift_regression";
    } else {
      decision = "quality_lift_inconclusive";
    }
  }
  return {
    name,
    status: comparable ? "ready" : "collecting",
    comparable,
    minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
    baselineCohort: baseline.cohort,
    treatmentCohort: treatment.cohort,
    baselineOutcomeCount: baseline.outcomeCount || 0,
    treatmentOutcomeCount: treatment.outcomeCount || 0,
    decision,
    deltas
  };
}

function buildPromptQualityLiftReport(metrics = {}, context = {}) {
  const rawEvents = Array.isArray(metrics.events) ? metrics.events : [];
  const scopedEvents = rawEvents.filter((event) => qualityLiftContextMatches(event, context));
  const cohorts = ["baseline_structure", "strategy_guided", "outcome_weighted"].map((cohort) => {
    return summarizeQualityLiftCohort(scopedEvents.filter((event) => deriveQualityLiftCohort(event) === cohort), cohort);
  });
  const byCohort = Object.fromEntries(cohorts.map((entry) => [entry.cohort, entry]));
  const baseline = byCohort.baseline_structure;
  const guided = byCohort.strategy_guided;
  const weighted = byCohort.outcome_weighted;
  const guidedComparison = compareQualityLiftCohorts(baseline, guided, "strategy_guided_vs_baseline");
  const weightedComparison = compareQualityLiftCohorts(baseline, weighted, "outcome_weighted_vs_baseline");
  const primary = weightedComparison;
  const hasAnyEvents = scopedEvents.length > 0;
  const status = !hasAnyEvents
    ? "empty"
    : primary.comparable
      ? primary.decision === "quality_lift_regression" ? "regression" : "ready"
      : "collecting";
  const recommendations = [];
  const addRecommendation = (key, priority, recommendation) => {
    if (!recommendations.some((item) => item.key === key)) recommendations.push({ key, priority, recommendation });
  };
  if (!hasAnyEvents) {
    addRecommendation("collect_quality_lift_samples", "high", "Record baseline, strategy-guided, and outcome-weighted feedback before judging prompt quality lift.");
  } else if (!primary.comparable) {
    addRecommendation("collect_comparable_quality_lift_samples", "high", "Collect comparable user-verified outcomes for baseline and outcome-weighted cohorts.");
  } else if (primary.decision === "quality_lift_positive") {
    addRecommendation("keep_outcome_weighting", "medium", "Outcome-weighted prompts are lifting user-verified success without increasing retry or undo.");
  } else if (primary.decision === "quality_lift_regression") {
    addRecommendation("review_outcome_weighting", "high", "Outcome-weighted prompts are regressing; reduce their influence until the strategy is reviewed.");
  } else {
    addRecommendation("continue_quality_lift_comparison", "medium", "Outcome-weighted prompts are comparable but not decisive; continue balanced sampling.");
  }
  if (guidedComparison.comparable && guidedComparison.decision === "quality_lift_positive" && !primary.comparable) {
    addRecommendation("verify_outcome_weighting_after_guided_lift", "medium", "Strategy-guided prompts lift quality; keep collecting outcome-weighted samples before promoting weights further.");
  }
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    reportVersion: PROMPT_QUALITY_LIFT_REPORT_VERSION,
    createdAt: new Date().toISOString(),
    readiness: {
      status,
      minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
      comparable: primary.comparable,
      eventCount: scopedEvents.length,
      baselineOutcomeCount: baseline.outcomeCount || 0,
      strategyGuidedOutcomeCount: guided.outcomeCount || 0,
      outcomeWeightedOutcomeCount: weighted.outcomeCount || 0,
      primaryDecision: primary.decision
    },
    cohort: {
      mode: safeToken(context.mode || "", "", 40),
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: siteCohortToken(context.site || context.host || context.origin || ""),
      taskScenario: taskScenarioFromContext(context, "")
    },
    cohorts,
    comparisons: [guidedComparison, weightedComparison],
    recommendations: recommendations.slice(0, 5),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      derivedFromAggregateQualityLiftMetrics: true,
      aggregateOnly: true
    }
  };
}

function formatPromptQualityLiftReport(report = {}) {
  const readiness = report.readiness || {};
  const cohorts = (report.cohorts || [])
    .slice(0, 3)
    .map((item) => `${item.cohort}:${item.status}:events=${item.events}:outcomes=${item.outcomeCount}:success=${item.outcomeSuccessRate}:avgOutcome=${item.avgOutcomeScore ?? "none"}:retry=${item.retryUsageRate}:undo=${item.undoUsageRate}`)
    .join(" | ") || "none";
  const comparisons = (report.comparisons || [])
    .slice(0, 2)
    .map((item) => {
      const deltas = item.deltas || {};
      return `${item.name}:status=${item.status}:decision=${item.decision}:successLift=${deltas.outcomeSuccessRateLift ?? 0}:avgLift=${deltas.avgOutcomeScoreLift ?? "none"}:retryLift=${deltas.retryUsageRateLift ?? 0}:undoLift=${deltas.undoUsageRateLift ?? 0}`;
    })
    .join(" | ") || "none";
  const recommendations = (report.recommendations || [])
    .slice(0, 4)
    .map((item) => `${item.key}:${item.priority}`)
    .join(" | ") || "none";
  return [
    `qualityLift=${report.reportVersion || PROMPT_QUALITY_LIFT_REPORT_VERSION}`,
    `readiness=${readiness.status || "empty"} comparable=${Boolean(readiness.comparable)} decision=${readiness.primaryDecision || "collecting"} events=${readiness.eventCount || 0}`,
    `cohorts=${cohorts}`,
    `comparisons=${comparisons}`,
    `recommendations=${recommendations}`,
    "privacy=aggregate-only"
  ].join("; ");
}
