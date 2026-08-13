function hashBucket(value, modulo = 100) {
  const text = normalizeText(value) || "default";
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % Math.max(1, Number(modulo) || 100);
}

function buildStrategyExperimentAssignment(context = {}, plan = {}, insights = {}, options = {}) {
  const selected = plan.selectedStrategy || {};
  const policy = plan.strategyPolicy || insights.strategyPolicy || {};
  const readiness = insights.readiness || {};
  const exploration = plan.exploration || {};
  const mode = safeToken(context.mode || selected.mode || "", "unknown", 40);
  const tool = safeToken(context.tool || "", "unknown", 80);
  const adapterId = safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "unknown", 80);
  const site = safeToken(context.site || context.host || context.origin || "", "unknown", 120);
  const taskScenario = taskScenarioFromContext(context, "general");
  const selectedStrategyId = safeToken(selected.id || options.promptStrategyId || "cold_start_structure", "cold_start_structure", 80);
  const selectedDecision = safeToken(selected.decision || "explore", "explore", 40);
  const promptStrategyVersion = safeToken(selected.version || policy.version || PROMPT_STRATEGY_POLICY_VERSION, "unknown", 80);
  const reliableAvailable = Boolean(readiness.sampleThresholdMet || Number(readiness.reliableStrategyCount || 0) > 0);
  const readinessStatus = safeToken(readiness.status || "unknown", "unknown", 40);
  const generationSeed = normalizeText(options.generationSeed || options.generationId || context.generationId || [
    mode,
    tool,
    adapterId,
    site,
    taskScenario,
    selectedStrategyId,
    promptStrategyVersion
  ].join(":"));
  const bucket = hashBucket(`${PROMPT_EXPERIMENT_VERSION}:${generationSeed}:${selectedStrategyId}`, 100);
  const explorationThreshold = Math.round(clamp(Number(exploration.rate ?? policy.explorationRate ?? 0.12), 0, 1) * 100);
  let arm = "";
  let assignedStrategyId = selectedStrategyId;
  let eligible = true;
  let reason = "";

  if (options.forceArm) {
    arm = safeToken(options.forceArm, "baseline_structure", 80);
    reason = "Experiment arm forced by caller for deterministic validation.";
  } else if (selectedDecision === "guardrail") {
    arm = "insert_safety_guardrail";
    eligible = false;
    reason = "A safety or insertability guardrail is active, so the generation is excluded from baseline-vs-strategy comparison.";
  } else if (!reliableAvailable || selectedStrategyId === "cold_start_structure") {
    const shouldExplore = Boolean(exploration.enabled) && bucket < explorationThreshold;
    arm = shouldExplore ? "explore_candidate" : "baseline_structure";
    assignedStrategyId = arm === "baseline_structure" ? "baseline_structure" : (exploration.candidateStrategyId || selectedStrategyId || "explore_candidate");
    reason = shouldExplore
      ? "Collect exploratory samples for a promising low-sample prompt strategy."
      : "Hold this generation in the default structured baseline while strategy evidence matures.";
  } else {
    arm = bucket < 50 ? "strategy_guided" : "baseline_structure";
    assignedStrategyId = arm === "baseline_structure" ? "baseline_structure" : selectedStrategyId;
    reason = arm === "strategy_guided"
      ? "Apply the locally selected prompt strategy for comparison against the baseline."
      : "Hold out local strategy guidance to create a comparable baseline sample.";
  }

  if (options.forceArm && arm === "baseline_structure") {
    assignedStrategyId = "baseline_structure";
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    experimentVersion: PROMPT_EXPERIMENT_VERSION,
    eligible,
    arm,
    bucket,
    comparisonKey: safeToken([
      PROMPT_EXPERIMENT_VERSION,
      mode,
      tool,
      adapterId,
      site,
      taskScenario,
      selectedStrategyId
    ].join(":"), "default-comparison", 220),
    selectedStrategyId,
    assignedStrategyId: safeToken(assignedStrategyId, "baseline_structure", 80),
    promptStrategyVersion,
    selectedDecision,
    readinessStatus,
    cohort: {
      mode,
      tool,
      adapterId,
      site,
      taskScenario
    },
    reason,
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      deterministicBucketOnly: true,
      derivedFromAggregateStrategyMetrics: true
    }
  };
}

function normalizeExperimentArmEntry(arm, entry = {}) {
  const events = Number(entry.events || 0);
  const cardReady = Number(entry.cardReady || 0);
  const insertAttempts = Number(entry.insertAttempts || 0);
  const verifiedInserts = Number(entry.verifiedInserts || 0);
  const saves = Number(entry.saves || 0);
  const retries = Number(entry.retries || 0);
  const undos = Number(entry.undos || 0);
  const failures = Number(entry.failures || Math.max(insertAttempts - verifiedInserts, 0));
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
  return {
    arm: safeToken(arm, "unknown", 80),
    events,
    cardReady,
    insertAttempts,
    verifiedInserts,
    saves,
    retries,
    undos,
    failures,
    insertSuccessRate: round(insertSuccessRate),
    saveRate: round(saveRate),
    retryUsageRate: round(retryUsageRate),
    undoUsageRate: round(undoUsageRate),
    avgQualityScore: Number.isFinite(Number(entry.avgQualityScore)) ? round(Number(entry.avgQualityScore)) : null,
    avgPromptLength: Number.isFinite(Number(entry.avgPromptLength)) ? round(Number(entry.avgPromptLength)) : 0,
    promptStrategyIds: topTokens(entry.promptStrategyIds || {}, 4),
    promptStrategyVersions: topTokens(entry.promptStrategyVersions || {}, 3),
    experimentVersions: topTokens(entry.experimentVersions || {}, 3),
    comparisonKeys: topTokens(entry.experimentComparisonKeys || {}, 3),
    strategyReadiness: topTokens(entry.strategyReadiness || {}, 3),
    scenarios: topTokens(entry.scenarios || entry.taskScenarios || {}, 3)
  };
}

function buildExperimentOutcomeReport(metrics = {}, context = {}) {
  const minComparableEvents = Number(context.minComparableEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS);
  const taskScenario = taskScenarioFromContext(context, "");
  const experimentArmSource = experimentArmMetricsForContext(metrics, context);
  const arms = Object.entries(experimentArmSource)
    .map(([arm, entry]) => normalizeExperimentArmEntry(arm, entry))
    .sort((left, right) => right.events - left.events || left.arm.localeCompare(right.arm));
  const byArm = Object.fromEntries(arms.map((entry) => [entry.arm, entry]));
  const baseline = byArm.baseline_structure;
  const guided = byArm.strategy_guided;
  const comparable = Boolean(baseline && guided && baseline.events >= minComparableEvents && guided.events >= minComparableEvents);
  const status = !arms.length ? "empty" : comparable ? "ready" : "collecting";
  const comparisons = [];
  if (baseline && guided) {
    comparisons.push({
      name: "strategy_guided_vs_baseline",
      status: comparable ? "ready" : "collecting",
      minComparableEvents,
      arms: {
        baseline: baseline.arm,
        treatment: guided.arm
      },
      deltas: {
        insertSuccessRate: round(guided.insertSuccessRate - baseline.insertSuccessRate),
        saveRate: round(guided.saveRate - baseline.saveRate),
        retryUsageRate: round(guided.retryUsageRate - baseline.retryUsageRate),
        undoUsageRate: round(guided.undoUsageRate - baseline.undoUsageRate),
        avgQualityScore: guided.avgQualityScore === null || baseline.avgQualityScore === null
          ? null
          : round(guided.avgQualityScore - baseline.avgQualityScore)
      }
    });
  }

  const recommendations = [];
  const addRecommendation = (key, priority, recommendation) => {
    if (recommendations.some((item) => item.key === key)) return;
    recommendations.push({ key, priority, recommendation });
  };
  if (!arms.length) {
    addRecommendation("collect_experiment_samples", "high", "Record card_ready, insert, save, retry, and undo events with experiment arm metadata.");
  } else if (!comparable) {
    addRecommendation("collect_more_comparable_samples", "high", "Keep both baseline_structure and strategy_guided arms running until each has enough samples.");
  } else {
    const comparison = comparisons[0];
    const deltas = comparison.deltas;
    if (deltas.insertSuccessRate >= 0.05 && deltas.saveRate >= 0 && deltas.retryUsageRate <= 0.05 && deltas.undoUsageRate <= 0.05) {
      addRecommendation("prefer_strategy_guided", "medium", "Strategy-guided prompts are outperforming the baseline on insert success without increasing retry or undo usage.");
    } else if (deltas.insertSuccessRate <= -0.05 || deltas.retryUsageRate > 0.1 || deltas.undoUsageRate > 0.1) {
      addRecommendation("prefer_baseline_until_reviewed", "high", "Baseline prompts are safer for now; review strategy guidance before increasing strategy-guided traffic.");
    } else {
      addRecommendation("continue_balanced_experiment", "medium", "The experiment is comparable but not decisive; continue balanced sampling.");
    }
  }
  if (byArm.insert_safety_guardrail && byArm.insert_safety_guardrail.failures > 0) {
    addRecommendation("watch_insert_guardrail", "high", "Guardrail samples still show insert failures; keep compact plain-text guidance active.");
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    experimentVersion: PROMPT_EXPERIMENT_VERSION,
    readiness: {
      status,
      minComparableEvents,
      armCount: arms.length,
      eventCount: arms.reduce((sum, entry) => sum + entry.events, 0),
      comparable
    },
    cohort: {
      mode: safeToken(context.mode || "", "", 40),
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: safeToken(context.site || context.host || context.origin || "", "", 120),
      taskScenario
    },
    arms,
    comparisons,
    recommendations: recommendations.slice(0, 5),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      derivedFromAggregateExperimentMetrics: true,
      aggregateOnly: true
    }
  };
}

function formatExperimentOutcomeReport(report = {}) {
  const readiness = report.readiness || {};
  const cohort = report.cohort || {};
  const arms = (report.arms || [])
    .slice(0, 4)
    .map((item) => `${item.arm} events=${item.events} insert=${item.insertSuccessRate} save=${item.saveRate} retry=${item.retryUsageRate} undo=${item.undoUsageRate}`)
    .join(" | ") || "none";
  const comparisons = (report.comparisons || [])
    .slice(0, 2)
    .map((item) => {
      const deltas = item.deltas || {};
      return `${item.name} status=${item.status} deltaInsert=${deltas.insertSuccessRate ?? 0} deltaSave=${deltas.saveRate ?? 0} deltaRetry=${deltas.retryUsageRate ?? 0} deltaUndo=${deltas.undoUsageRate ?? 0}`;
    })
    .join(" | ") || "none";
  const recommendations = (report.recommendations || [])
    .slice(0, 4)
    .map((item) => `${item.key}:${item.recommendation}`)
    .join(" | ") || "none";
  return [
    `experiment=${report.experimentVersion || PROMPT_EXPERIMENT_VERSION}`,
    `scenario=${cohort.taskScenario || "general"}`,
    `readiness=${readiness.status || "empty"} comparable=${Boolean(readiness.comparable)} arms=${readiness.armCount || 0} events=${readiness.eventCount || 0}`,
    `armMetrics=${arms}`,
    `comparisons=${comparisons}`,
    `recommendations=${recommendations}`,
    "privacy=aggregate-only"
  ].join("; ");
}

function buildQualityExperiment(card = {}, feedbackProfile = {}, options = {}) {
  const directiveKeys = [...new Set((feedbackProfile.directives || [])
    .map((item) => safeToken(item.key, "", 50))
    .filter(Boolean))]
    .slice(0, 6);
  const feedbackConfidence = safeToken(feedbackProfile.confidence || "none", "none", 24);
  const mode = safeToken(card.mode || options.mode || feedbackProfile.cohort?.mode || "", "unknown", 40);
  const generatedBy = safeToken(card.generatedBy || options.generatedBy || "", "unknown", 40);
  const taskScenario = safeToken(options.taskScenario || card.taskScenario || feedbackProfile.cohort?.taskScenario || card.promptStrategyPlan?.cohort?.taskScenario || "", "general", 80);
  const promptStrategyId = safeToken(options.promptStrategyId || card.promptStrategyPlan?.selectedStrategy?.id || "", "", 80);
  const promptStrategyVersion = safeToken(options.promptStrategyVersion || card.promptStrategyPlan?.selectedStrategy?.version || card.promptStrategyPlan?.strategyPolicy?.version || "", "", 80);
  const experimentAssignment = options.experimentAssignment || card.experimentAssignment || {};
  const experimentBucket = Number(experimentAssignment.bucket ?? options.experimentBucket);
  const strategyWeightPolicy = options.strategyWeightPolicy || card.strategyWeightPolicy || card.promptStrategyPlan?.strategyWeightPolicy || {};
  const strategyWeightVersion = safeToken(options.strategyWeightVersion || strategyWeightPolicy.weightPolicyVersion || card.promptStrategyPlan?.strategyPolicy?.strategyWeightVersion || "", "", 80);
  const strategyWeightStatus = safeToken(options.strategyWeightStatus || strategyWeightPolicy.readiness?.status || card.promptStrategyPlan?.telemetry?.strategyWeightStatus || "", "", 40);
  const strategyWeightPromoted = safeToken(options.strategyWeightPromoted || strategyWeightPolicy.selectedPromotion?.strategyId || "", "", 180);
  const strategyWeightSuppressed = safeToken(options.strategyWeightSuppressed || strategyWeightPolicy.selectedSuppression?.strategyId || "", "", 180);
  const strategyWeightDecision = safeToken(options.strategyWeightDecision || card.promptStrategyPlan?.selectedStrategy?.decision || "", "", 80);
  const experimentArm = safeToken(experimentAssignment.arm || options.experimentArm || "", "", 80);
  const qualityLiftCohort = deriveQualityLiftCohort({
    qualityLiftCohort: options.qualityLiftCohort,
    experimentArm,
    strategyWeightVersion,
    strategyWeightDecision,
    strategyWeightPromoted,
    promptStrategyId
  });
  const directivePart = promptStrategyId || (directiveKeys.length ? directiveKeys.join("+") : "steady");
  const versionPart = promptStrategyVersion ? `:${promptStrategyVersion}` : "";
  const strategyId = safeToken(options.strategyId || `${generatedBy}:${mode}:${feedbackConfidence}:${directivePart}${versionPart}`, "unknown", 180);
  const qualityScore = Number(card.quality?.score ?? options.qualityScore);
  const promptLength = Number(card.quality?.promptLength ?? options.promptLength ?? String(card.prompt || "").length);
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    generationId: safeToken(options.generationId || `generation-${Date.now()}`, "generation", 80),
    strategyId,
    mode,
    taskScenario,
    generatedBy,
    qualityScore: Number.isFinite(qualityScore) ? round(qualityScore) : null,
    feedbackConfidence,
    promptStrategyId,
    promptStrategyVersion,
    experimentVersion: safeToken(experimentAssignment.experimentVersion || options.experimentVersion || PROMPT_EXPERIMENT_VERSION, "v6-prompt-experiment-1", 80),
    experimentArm,
    experimentEligible: experimentAssignment.eligible === undefined ? Boolean(experimentAssignment.arm || options.experimentArm) : Boolean(experimentAssignment.eligible),
    experimentBucket: Number.isFinite(experimentBucket) ? experimentBucket : null,
    experimentComparisonKey: safeToken(experimentAssignment.comparisonKey || options.experimentComparisonKey || "", "", 220),
    strategyInsightsVersion: safeToken(options.strategyInsightsVersion || card.strategyInsights?.insightVersion || "", "", 80),
    strategyReadiness: safeToken(options.strategyReadiness || card.strategyInsights?.readiness?.status || "", "", 40),
    strategyWeightVersion,
    strategyWeightStatus,
    strategyWeightPromoted,
    strategyWeightSuppressed,
    strategyWeightDecision,
    qualityLiftCohort,
    directiveKeys,
    promptLength: Number.isFinite(promptLength) ? promptLength : 0,
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      derivedFromMetadata: true,
      experimentMetadataOnly: true,
      strategyWeightMetadataOnly: true
    }
  };
}

module.exports = {
  QUALITY_SCHEMA_VERSION,
  PROMPT_EXPERIMENT_VERSION,
  PROMPT_QUALITY_LIFT_REPORT_VERSION,
  PROMPT_QUALITY_LIFT_SEGMENTS_REPORT_VERSION,
  QUALITY_LIFT_SEGMENT_POLICY_VERSION,
  FAILURE_REASON_REPORT_VERSION,
  FAILURE_REASON_POLICY_VERSION,
  SELF_IMPROVEMENT_REPORT_VERSION,
  EVOLUTION_CANDIDATE_REPORT_VERSION,
  FAILURE_REASON_TOKENS,
  STRATEGY_WEIGHT_POLICY_VERSION,
  STRUCTURED_OUTPUT_KEYS,
  buildEvolutionCandidateReport,
  buildExperimentOutcomeReport,
  buildFeedbackProfile,
  buildFeedbackSummary,
  buildFailureReasonPolicy,
  buildFailureReasonReport,
  buildPromptStrategyPlan,
  buildPilotOutcomeReadinessReport,
  buildPromptQualityLiftReport,
  buildPromptQualityLiftSegmentsReport,
  buildQualityLiftSegmentPolicy,
  buildQualityExperiment,
  buildSelfImprovementReport,
  buildStrategyExperimentAssignment,
  buildStrategyInsights,
  buildStrategyWeightPolicy,
  buildTaskOutcomeReport,
  formatEvolutionCandidateReport,
  formatExperimentOutcomeReport,
  formatFailureReasonPolicy,
  formatFailureReasonReport,
  formatFeedbackProfile,
  formatFeedbackSummary,
  formatPilotOutcomeReadinessReport,
  formatPromptQualityLiftReport,
  formatPromptQualityLiftSegmentsReport,
  formatQualityLiftSegmentPolicy,
  formatPromptStrategyPlan,
  formatSelfImprovementReport,
  formatStrategyInsights,
  formatStrategyWeightPolicy,
  formatTaskOutcomeReport,
  inferTaskScenario,
  normalizeFailureReasonToken,
  parseStructuredLlmResponse,
  scorePromptQuality
};
