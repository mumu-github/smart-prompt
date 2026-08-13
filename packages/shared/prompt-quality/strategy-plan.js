function buildPromptStrategyPlan(metrics = {}, context = {}, feedbackProfile = {}, experimentOutcomeReport = null, taskOutcomeReportInput = null, strategyWeightPolicyInput = null, qualityLiftSegmentsReportInput = null, failureReasonReportInput = null) {
  const mode = safeToken(context.mode || feedbackProfile.cohort?.mode || "", "unknown", 40);
  const taskScenario = taskScenarioFromContext(context, feedbackProfile.cohort?.taskScenario || "");
  const strategySource = strategyMetricsForContext(metrics, { ...context, taskScenario });
  const allStrategies = Object.entries(strategySource)
    .map(([strategyId, entry]) => normalizeStrategyEntry(strategyId, entry, { ...context, mode }));
  const relevantStrategies = allStrategies.filter((entry) => entry.matchesMode && entry.matchesTool && entry.matchesAdapter && entry.matchesSite && entry.matchesScenario);
  const modeScenarioStrategies = allStrategies.filter((entry) => entry.matchesMode && entry.matchesScenario);
  const ranked = (relevantStrategies.length ? relevantStrategies : modeScenarioStrategies.length ? modeScenarioStrategies : allStrategies)
    .sort((left, right) => right.score - left.score || right.events - left.events || left.strategyId.localeCompare(right.strategyId));
  const reliableStrategies = ranked.filter((entry) => entry.reliable);
  const best = ranked.find((entry) => entry.reliable && entry.score >= 0.55);
  const lowSampleWinner = ranked.find((entry) => entry.events >= PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS && !entry.reliable && entry.score >= 0.55);
  const risky = ranked.find((entry) => entry.events >= PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS && (entry.insertSuccessRate < 0.5 || entry.retryUsageRate >= 0.5 || entry.undoUsageRate >= 0.35 || entry.failures > 0));
  const profileRates = feedbackProfile.rates || {};
  const exploreRate = explorationRate(metrics.eventCount, reliableStrategies.length);
  const outcomeReport = experimentOutcomeReport || buildExperimentOutcomeReport(metrics, context);
  const outcomePolicy = buildOutcomePolicy(outcomeReport);
  const taskOutcomeReport = taskOutcomeReportInput || buildTaskOutcomeReport(metrics, context);
  const taskOutcomePolicy = buildTaskOutcomePolicy(taskOutcomeReport);
  const strategyWeightPolicy = strategyWeightPolicyInput || buildStrategyWeightPolicy(metrics, context);
  const qualityLiftSegmentsReport = qualityLiftSegmentsReportInput || buildPromptQualityLiftSegmentsReport(metrics, { ...context, taskScenario });
  const qualityLiftSegmentPolicy = buildQualityLiftSegmentPolicy(qualityLiftSegmentsReport, { ...context, mode, taskScenario });
  const failureReasonReport = failureReasonReportInput || buildFailureReasonReport(metrics, { ...context, mode, taskScenario });
  const failureReasonPolicy = buildFailureReasonPolicy(failureReasonReport, { ...context, mode, taskScenario });
  const taskOutcomeWinner = taskOutcomePolicy.sourceStrategyId
    ? ranked.find((entry) => entry.strategyId === taskOutcomePolicy.sourceStrategyId)
    : null;
  const promotedWeight = strategyWeightPolicy.selectedPromotion || null;
  const suppressedWeight = strategyWeightPolicy.selectedSuppression || null;
  const promotedStrategy = promotedWeight?.strategyId
    ? ranked.find((entry) => entry.strategyId === promotedWeight.strategyId)
    : null;
  const suppressedStrategy = suppressedWeight?.strategyId
    ? ranked.find((entry) => entry.strategyId === suppressedWeight.strategyId)
    : null;
  const plan = {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    strategyPolicy: {
      version: PROMPT_STRATEGY_POLICY_VERSION,
      minCandidateEvents: PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS,
      minReliableEvents: PROMPT_STRATEGY_MIN_RELIABLE_EVENTS,
      explorationRate: exploreRate,
      experimentVersion: outcomeReport.experimentVersion || PROMPT_EXPERIMENT_VERSION,
      minComparableExperimentEvents: outcomePolicy.minComparableEvents,
      taskOutcomeVersion: taskOutcomeReport.reportVersion || "v6-task-outcome@1",
      strategyWeightVersion: strategyWeightPolicy.weightPolicyVersion || STRATEGY_WEIGHT_POLICY_VERSION,
      qualityLiftSegmentPolicyVersion: qualityLiftSegmentPolicy.policyVersion || QUALITY_LIFT_SEGMENT_POLICY_VERSION,
      failureReasonPolicyVersion: failureReasonPolicy.policyVersion || FAILURE_REASON_POLICY_VERSION
    },
    cohort: {
      mode,
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: safeToken(context.site || context.host || context.origin || "", "", 120),
      taskScenario
    },
    selectedStrategy: {
      id: "cold_start_structure",
      version: PROMPT_STRATEGY_POLICY_VERSION,
      confidence: feedbackProfile.confidence || strategyConfidence(metrics.eventCount),
      reason: "Use the default structured prompt shape until local strategy evidence is available.",
      decision: "explore",
      sourceStrategyId: ""
    },
    candidateStrategies: ranked.slice(0, 3).map((entry) => ({
      strategyId: entry.strategyId,
      score: entry.score,
      events: entry.events,
      confidence: entry.confidence,
      reliable: entry.reliable,
      insertSuccessRate: entry.insertSuccessRate,
      saveRate: entry.saveRate,
      retryUsageRate: entry.retryUsageRate,
      undoUsageRate: entry.undoUsageRate,
      avgQualityScore: entry.avgQualityScore,
      outcomes: entry.outcomes,
      outcomeSuccessRate: entry.outcomeSuccessRate,
      avgOutcomeScore: entry.avgOutcomeScore,
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
    outcomePolicy,
    taskOutcomePolicy,
    strategyWeightPolicy,
    qualityLiftSegmentPolicy,
    failureReasonPolicy,
    directives: [],
    exploration: {
      enabled: reliableStrategies.length === 0 || Boolean(lowSampleWinner),
      rate: exploreRate,
      reason: reliableStrategies.length === 0
        ? "No strategy has enough local samples for exploitation."
        : lowSampleWinner ? "A promising strategy needs more samples before it can become the default." : "Keep a small exploration lane to detect regressions.",
      candidateStrategyId: lowSampleWinner?.strategyId || ""
    },
    telemetry: {
      eventCount: Number(metrics.eventCount || 0),
      strategyCount: allStrategies.length,
      relevantStrategyCount: relevantStrategies.length,
      reliableStrategyCount: reliableStrategies.length,
      lowSampleStrategyCount: ranked.filter((entry) => entry.events > 0 && !entry.reliable).length,
      experimentOutcomeStatus: outcomePolicy.status,
      experimentComparable: outcomePolicy.comparable,
      taskOutcomeStatus: taskOutcomePolicy.status,
      taskOutcomeCount: taskOutcomePolicy.outcomeCount,
      strategyWeightStatus: strategyWeightPolicy.readiness?.status || "empty",
      promotedStrategyCount: strategyWeightPolicy.readiness?.promotedStrategyCount || 0,
      suppressedStrategyCount: strategyWeightPolicy.readiness?.suppressedStrategyCount || 0,
      qualityLiftSegmentDecision: qualityLiftSegmentPolicy.decision || "no_segment_signal",
      matchedQualityLiftSegmentCount: qualityLiftSegmentPolicy.readiness?.matchedSegmentCount || 0,
      regressingQualityLiftSegmentCount: qualityLiftSegmentPolicy.readiness?.regressingSegmentCount || 0,
      improvingQualityLiftSegmentCount: qualityLiftSegmentPolicy.readiness?.improvingSegmentCount || 0,
      failureReasonPolicyStatus: failureReasonPolicy.readiness?.status || "empty",
      failureReasonPolicyDecision: failureReasonPolicy.decision || "empty",
      failureReasonEventCount: failureReasonPolicy.readiness?.totalReasonEvents || 0,
      failureReasonTokenCount: failureReasonPolicy.readiness?.reasonTokenCount || 0,
      taskScenario
    },
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      derivedFromAggregateStrategyMetrics: true
    }
  };

  if (Number(profileRates.adapterFailureRate || 0) >= 0.3 || (feedbackProfile.commonFailureReasons || []).some((item) => item.key === "after_write_mismatch")) {
    setSelectedStrategy(plan, "insert_safe_compact", feedbackProfile.confidence || "low", "Recent feedback shows insertion risk; favor compact plain text that survives paste.", "", "guardrail");
    pushDirective(plan, "insert_safe_compact", 0.85, "Use compact plain text sections, avoid huge tables or fragile markup, and keep the prompt easy to copy manually.");
  } else if (Number(profileRates.retryUsageRate || 0) >= 0.3) {
    setSelectedStrategy(plan, "acceptance_heavy", feedbackProfile.confidence || "low", "Retry usage is high; make the first draft more complete and verifiable.", "", "guardrail");
    pushDirective(plan, "acceptance_heavy", 0.8, "Strengthen assumptions, missing information, output format, and acceptance criteria so the user is less likely to retry.");
  } else if (outcomePolicy.comparable && outcomePolicy.decision === "prefer_baseline") {
    setSelectedStrategy(plan, "baseline_structure", outcomePolicy.confidence, "Experiment outcomes favor the baseline until strategy guidance is reviewed.", best?.strategyId || outcomePolicy.sourceStrategyId, "outcome_guardrail");
    pushDirective(plan, "prefer_baseline_until_reviewed", 0.88, "Use the stable baseline prompt structure and reduce strategy-guided influence until aggregate outcomes recover.");
  } else if (outcomePolicy.comparable && outcomePolicy.decision === "prefer_strategy_guided" && best) {
    setSelectedStrategy(plan, "preserve_winning_strategy", best.confidence, "Comparable experiment outcomes favor strategy-guided prompts; preserve the locally winning structure.", best.strategyId);
    pushDirective(plan, "prefer_strategy_guided", 0.82, "Increase strategy-guided structure because aggregate outcomes show better insert/save behavior without extra retry or undo.");
    pushDirective(plan, "preserve_winning_strategy", best.score, "Keep the locally successful structure: clear goal, context, tasks, constraints, output format, and acceptance criteria.");
  } else if (promotedWeight && (!suppressedWeight || promotedWeight.strategyId !== suppressedWeight.strategyId)) {
    setSelectedStrategy(plan, "preserve_winning_strategy", promotedStrategy?.confidence || "medium", "Pilot outcome weights promote this user-verified prompt structure.", promotedWeight.strategyId, "outcome_weight");
    pushDirective(plan, "promote_outcome_winner", promotedWeight.weight || promotedWeight.outcomeSuccessRate || 0.75, "Favor prompt structures that have ready, high-success user-verified outcomes in matching pilot cohorts.");
    if (promotedStrategy) {
      pushDirective(plan, "preserve_winning_strategy", promotedStrategy.score, "Keep the locally successful structure: clear goal, context, tasks, constraints, output format, and acceptance criteria.");
    }
  } else if (suppressedWeight && (!best || best.strategyId === suppressedWeight.strategyId || (suppressedStrategy && ranked.length === 1))) {
    setSelectedStrategy(plan, "baseline_structure", "medium", "Pilot outcome weights suppress a low-success structure; fall back to the stable baseline.", suppressedWeight.strategyId, "outcome_weight_guardrail");
    pushDirective(plan, "suppress_outcome_risk", 1 - Number(suppressedWeight.outcomeSuccessRate || 0), "Avoid prompt structures with ready, low-success user-verified outcomes until reviewed.");
  } else if (taskOutcomePolicy.decision === "prefer_task_outcome_winner" && taskOutcomeWinner) {
    setSelectedStrategy(plan, "preserve_winning_strategy", taskOutcomePolicy.confidence, "User-verified task outcomes favor this scenario-specific prompt structure.", taskOutcomeWinner.strategyId, "task_outcome");
    pushDirective(plan, "prefer_task_outcome_winner", taskOutcomeWinner.outcomeSuccessRate, "Prioritize the prompt structure that has led to successful user-verified task outcomes in this scenario.");
    pushDirective(plan, "preserve_winning_strategy", taskOutcomeWinner.score, "Keep the locally successful structure: clear goal, context, tasks, constraints, output format, and acceptance criteria.");
  } else if (best) {
    setSelectedStrategy(plan, "preserve_winning_strategy", best.confidence, "A prior strategy has strong local adoption signals; preserve its structure without copying prompt text.", best.strategyId);
    pushDirective(plan, "preserve_winning_strategy", best.score, "Keep the locally successful structure: clear goal, context, tasks, constraints, output format, and acceptance criteria.");
  } else {
    pushDirective(plan, "cold_start_structure", 0.5, "Use the default high-quality structure and collect feedback for future strategy selection.");
  }

  if (outcomePolicy.decision === "collecting" || outcomePolicy.decision === "empty") {
    pushDirective(plan, "collect_experiment_samples", 0.45, "Keep recording experiment arm outcomes before treating a strategy as proven.");
  } else if (outcomePolicy.decision === "balanced") {
    pushDirective(plan, "continue_balanced_experiment", 0.55, "Keep baseline and strategy-guided sampling balanced because aggregate outcomes are comparable but not decisive.");
  }
  if (taskOutcomePolicy.decision === "collecting" || taskOutcomePolicy.decision === "empty") {
    pushDirective(plan, "collect_task_outcomes", 0.46, "Ask for lightweight task outcome feedback after use so prompt quality can be validated beyond insert and save behavior.");
  } else if (taskOutcomePolicy.decision === "review_low_outcome_strategy") {
    pushDirective(plan, "review_low_outcome_strategy", 0.86, "Avoid overusing strategy shapes with repeated user-verified task outcome failures.");
  }
  if (strategyWeightPolicy.readiness?.status === "collecting" || strategyWeightPolicy.readiness?.status === "empty") {
    pushDirective(plan, "collect_outcome_weights", 0.45, "Keep collecting outcome labels before changing prompt strategy weights.");
  }
  if (promotedWeight) {
    pushDirective(plan, "promote_outcome_winner", promotedWeight.weight || promotedWeight.outcomeSuccessRate || 0.75, "Favor prompt structures with ready, high-success user-verified outcomes.");
  }
  if (suppressedWeight) {
    pushDirective(plan, "suppress_outcome_risk", 1 - Number(suppressedWeight.outcomeSuccessRate || 0), "Reduce influence from prompt structures with ready, low-success user-verified outcomes.");
  }
  if ((strategyWeightPolicy.exploringStrategies || []).length) {
    const exploring = strategyWeightPolicy.exploringStrategies[0];
    pushDirective(plan, "continue_outcome_exploration", exploring.weight || 0.55, `Continue collecting outcome samples for ${exploring.strategyId} before promoting it.`);
    if (!plan.exploration.candidateStrategyId) {
      plan.exploration.candidateStrategyId = exploring.strategyId;
      plan.exploration.enabled = true;
    }
  }

  if (lowSampleWinner && !best) {
    pushDirective(plan, "collect_more_samples", lowSampleWinner.score, `Promising strategy ${lowSampleWinner.strategyId} is below the reliable sample threshold; explore it without making it the default.`);
  }
  if (risky) {
    pushDirective(plan, "avoid_risky_strategy", 1 - risky.score, `Avoid repeating weak strategy shape ${risky.strategyId}; reduce retry, undo, and insert failure risk.`);
  }
  if (Number(profileRates.saveRate || 0) >= 0.5) {
    pushDirective(plan, "reuse_friendly", profileRates.saveRate, "Make the prompt reusable with stable section headings and skill references.");
  }
  if (mode === "idea") {
    pushDirective(plan, "idea_decision_path", 0.65, "Offer multiple directions, then choose one recommended prompt with clear fit and missing details.");
  }
  if (qualityLiftSegmentPolicy.decision === "segment_regression_guardrail") {
    const currentDecision = plan.selectedStrategy?.decision || "";
    const currentIsHardGuardrail = currentDecision === "guardrail" || currentDecision === "outcome_guardrail";
    if (!currentIsHardGuardrail) {
      setSelectedStrategy(plan, "baseline_structure", "medium", "Quality-lift segment evidence shows outcome-weighted regression for this tool/site/scenario/mode; use baseline until reviewed.", plan.selectedStrategy?.sourceStrategyId || qualityLiftSegmentPolicy.regressingSegments?.[0]?.key || "", "segment_regression_guardrail");
    }
    pushDirective(plan, "avoid_regressing_segment", 0.9, "Reduce outcome-weighted influence in matching quality-lift segments that are regressing until outcomes recover.");
  } else if (qualityLiftSegmentPolicy.decision === "preserve_segment_winner") {
    pushDirective(plan, "preserve_improving_segment", 0.76, "Keep outcome-weighted guidance in matching segments where aggregate quality lift is positive.");
  } else if (qualityLiftSegmentPolicy.decision === "collect_segment_samples") {
    pushDirective(plan, "collect_quality_lift_segment_samples", 0.55, "Keep balanced exploration for this segment until comparable quality-lift outcomes exist.");
    plan.exploration.enabled = true;
  }
  const failureDirectiveKeys = new Set((failureReasonPolicy.directives || []).map((item) => item.key));
  if (failureDirectiveKeys.has("reduce_insert_fragility")) {
    const currentDecision = plan.selectedStrategy?.decision || "";
    const currentIsHardGuardrail = currentDecision === "guardrail" || currentDecision === "outcome_guardrail" || currentDecision === "segment_regression_guardrail";
    if (!currentIsHardGuardrail) {
      setSelectedStrategy(plan, "insert_safe_compact", failureReasonPolicy.readiness?.status === "ready" ? "medium" : "low", "Failure reason tokens show insert fragility; favor compact plain text that survives paste.", failureReasonPolicy.topReasons?.[0]?.key || "", "guardrail");
    }
  }
  for (const directive of failureReasonPolicy.directives || []) {
    pushDirective(plan, directive.key, directive.strength || 0.6, directive.directive);
  }
  return plan;
}

function formatPromptStrategyPlan(plan = {}) {
  const selected = plan.selectedStrategy || {};
  const policy = plan.strategyPolicy || {};
  const cohort = plan.cohort || {};
  const exploration = plan.exploration || {};
  const outcome = plan.outcomePolicy || {};
  const outcomeDeltas = outcome.deltas || {};
  const taskOutcome = plan.taskOutcomePolicy || {};
  const strategyWeight = plan.strategyWeightPolicy || {};
  const strategyWeightReadiness = strategyWeight.readiness || {};
  const segmentPolicy = plan.qualityLiftSegmentPolicy || {};
  const segmentReadiness = segmentPolicy.readiness || {};
  const failureReasonPolicy = plan.failureReasonPolicy || {};
  const failureReasonReadiness = failureReasonPolicy.readiness || {};
  const directives = (plan.directives || [])
    .slice(0, 4)
    .map((item) => `${item.key}:${item.directive}`)
    .join(" | ") || "none";
  const candidates = (plan.candidateStrategies || [])
    .slice(0, 2)
    .map((item) => `${item.strategyId} score=${item.score} events=${item.events} reliable=${Boolean(item.reliable)} save=${item.saveRate} insert=${item.insertSuccessRate} retry=${item.retryUsageRate}`)
    .join(" | ") || "none";
  return [
    `selected=${selected.id || "cold_start_structure"}`,
    `policy=${policy.version || selected.version || PROMPT_STRATEGY_POLICY_VERSION}`,
    `scenario=${cohort.taskScenario || "general"}`,
    `confidence=${selected.confidence || "none"}`,
    `decision=${selected.decision || "explore"}`,
    `reason=${selected.reason || "No strategy history yet."}`,
    `explore=${Boolean(exploration.enabled)} rate=${exploration.rate ?? 0}`,
    `outcome=${outcome.status || "empty"} comparable=${Boolean(outcome.comparable)} decision=${outcome.decision || "empty"} recommendation=${outcome.recommendationKey || "none"} deltaInsert=${outcomeDeltas.insertSuccessRate ?? 0} deltaSave=${outcomeDeltas.saveRate ?? 0} deltaRetry=${outcomeDeltas.retryUsageRate ?? 0} deltaUndo=${outcomeDeltas.undoUsageRate ?? 0}`,
    `taskOutcome=${taskOutcome.status || "empty"} decision=${taskOutcome.decision || "empty"} recommendation=${taskOutcome.recommendationKey || "none"} outcomes=${taskOutcome.outcomeCount || 0} success=${taskOutcome.outcomeSuccessRate || 0} avgOutcome=${taskOutcome.avgOutcomeScore ?? "none"}`,
    `strategyWeight=${strategyWeightReadiness.status || "empty"} promoted=${strategyWeightReadiness.promotedStrategyCount || 0} suppressed=${strategyWeightReadiness.suppressedStrategyCount || 0} exploring=${strategyWeightReadiness.exploringStrategyCount || 0}`,
    `qualityLiftSegmentPolicy=${segmentPolicy.decision || "no_segment_signal"} status=${segmentReadiness.status || "empty"} matched=${segmentReadiness.matchedSegmentCount || 0} recommendation=${segmentPolicy.recommendationKey || "none"}`,
    `failureReasonPolicy=${failureReasonPolicy.decision || "empty"} status=${failureReasonReadiness.status || "empty"} total=${failureReasonReadiness.totalReasonEvents || 0} recommendation=${failureReasonPolicy.recommendationKey || "none"}`,
    `directives=${directives}`,
    `topStrategies=${candidates}`
  ].join("; ");
}

function formatStrategyInsights(insights = {}) {
  const readiness = insights.readiness || {};
  const policy = insights.strategyPolicy || {};
  const cohort = insights.cohort || {};
  const topStrategies = (insights.topStrategies || [])
    .slice(0, 4)
    .map((item) => `${item.strategyId || item.key || "strategy"} score=${item.score ?? 0} events=${item.events || 0} reliable=${Boolean(item.reliable)} insert=${item.insertSuccessRate ?? 0} save=${item.saveRate ?? 0}`)
    .join(" | ") || "none";
  const risks = (insights.riskSignals || [])
    .slice(0, 3)
    .map((item) => `${item.key || item.strategyId || "risk"}:${item.reason || item.signal || item.recommendation || ""}`)
    .join(" | ") || "none";
  const lowSample = (insights.lowSampleCandidates || [])
    .slice(0, 3)
    .map((item) => `${item.strategyId || item.key || "candidate"} events=${item.events || 0}`)
    .join(" | ") || "none";
  const recommendations = (insights.recommendations || [])
    .slice(0, 4)
    .map((item) => `${item.key || item.recommendationKey || "recommendation"}:${item.recommendation || item.reason || ""}`)
    .join(" | ") || "none";
  return [
    `insight=${insights.insightVersion || policy.version || PROMPT_STRATEGY_POLICY_VERSION}`,
    `scenario=${cohort.taskScenario || "general"} scenario:${cohort.taskScenario || "general"}`,
    `readiness=${readiness.status || "empty"} reliable=${readiness.reliableStrategyCount || 0} events=${readiness.eventCount || 0}`,
    `topStrategies=${topStrategies}`,
    `risks=${risks}`,
    `lowSample=${lowSample}`,
    `recommendations=${recommendations}`,
    "privacy=aggregate-only"
  ].join("; ");
}
