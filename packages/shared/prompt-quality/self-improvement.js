function buildSelfImprovementReport(metrics = {}, context = {}) {
  const taskScenario = taskScenarioFromContext(context, "");
  const strategyInsights = context.strategyInsights || buildStrategyInsights(metrics, context);
  const taskOutcomeReport = context.taskOutcomeReport || buildTaskOutcomeReport(metrics, context);
  const pilotOutcomeReadinessReport = context.pilotOutcomeReadinessReport || buildPilotOutcomeReadinessReport(metrics);
  const strategyWeightPolicy = context.strategyWeightPolicy || buildStrategyWeightPolicy(metrics, context, pilotOutcomeReadinessReport);
  const promptQualityLiftReport = context.promptQualityLiftReport || buildPromptQualityLiftReport(metrics, context);
  const promptQualityLiftSegmentsReport = context.promptQualityLiftSegmentsReport || buildPromptQualityLiftSegmentsReport(metrics, context);
  const qualityLiftSegmentPolicy = context.qualityLiftSegmentPolicy || buildQualityLiftSegmentPolicy(promptQualityLiftSegmentsReport, context);
  const failureReasonReport = context.failureReasonReport || buildFailureReasonReport(metrics, context);
  const failureReasonPolicy = context.failureReasonPolicy || buildFailureReasonPolicy(failureReasonReport, context);
  const taskReadiness = taskOutcomeReport.readiness || {};
  const weightReadiness = strategyWeightPolicy.readiness || {};
  const insightReadiness = strategyInsights.readiness || {};
  const qualityReadiness = promptQualityLiftReport.readiness || {};
  const segmentReadiness = qualityLiftSegmentPolicy.readiness || {};
  const failureReadiness = failureReasonPolicy.readiness || {};
  const totalOutcomeEvents = Math.max(
    Number(taskReadiness.outcomeCount || 0),
    Number(weightReadiness.totalOutcomeEvents || 0),
    Number(qualityReadiness.outcomeCount || 0),
    Number(pilotOutcomeReadinessReport.readiness?.totalOutcomeEvents || 0)
  );
  const strategyCount = Math.max(
    Number(insightReadiness.strategyCount || 0),
    Object.keys(strategyMetricsForContext(metrics, context)).length
  );
  const status = !Number(metrics.eventCount || 0) && !totalOutcomeEvents
    ? "empty"
    : totalOutcomeEvents >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS
      || insightReadiness.status === "ready"
      || qualityReadiness.status === "ready"
      || failureReadiness.status === "ready"
        ? "ready"
        : "collecting";
  const reflections = [];
  const addReflection = (reflection) => {
    const source = safeToken(reflection.source || "unknown", "unknown", 80);
    const type = safeToken(reflection.type || "collecting", "collecting", 40);
    const strategyId = safeToken(reflection.strategyId || "", "", 180);
    const key = safeToken(reflection.key || reflection.reasonToken || strategyId || source, "unknown", 180);
    const id = safeToken(`${type}-${source}-${key}`, "reflection", 220);
    if (reflections.some((item) => item.id === id)) return;
    reflections.push({
      id,
      type,
      severity: safeToken(reflection.severity || "medium", "medium", 40),
      source,
      strategyId,
      key,
      reasonToken: safeToken(reflection.reasonToken || "", "", 80),
      summaryKey: safeToken(reflection.summaryKey || key, "unknown", 120),
      evidence: reflection.evidence || {},
      nextAction: normalizeText(reflection.nextAction || "Review aggregate evidence before changing prompt strategy.").slice(0, 240)
    });
  };

  const promoted = strategyWeightPolicy.selectedPromotion || null;
  if (promoted?.strategyId) {
    addReflection({
      type: "positive",
      severity: "medium",
      source: "strategy_weight",
      strategyId: promoted.strategyId,
      summaryKey: "promoted_outcome_weight",
      evidence: {
        outcomeCount: Number(promoted.outcomeCount || 0),
        outcomeSuccessRate: Number.isFinite(Number(promoted.outcomeSuccessRate)) ? round(Number(promoted.outcomeSuccessRate)) : 0,
        weight: Number.isFinite(Number(promoted.weight)) ? round(Number(promoted.weight)) : null
      },
      nextAction: "Preserve this strategy shape in matching cohorts, but require review before promoting it as a default."
    });
  }

  const suppressed = strategyWeightPolicy.selectedSuppression || null;
  if (suppressed?.strategyId) {
    addReflection({
      type: "regression",
      severity: "high",
      source: "strategy_weight",
      strategyId: suppressed.strategyId,
      summaryKey: "suppressed_outcome_weight",
      evidence: {
        outcomeCount: Number(suppressed.outcomeCount || 0),
        outcomeSuccessRate: Number.isFinite(Number(suppressed.outcomeSuccessRate)) ? round(Number(suppressed.outcomeSuccessRate)) : 0,
        weight: Number.isFinite(Number(suppressed.weight)) ? round(Number(suppressed.weight)) : null
      },
      nextAction: "Suppress or repair this strategy shape until fresh user-verified outcomes recover."
    });
  }

  const taskWinner = (taskOutcomeReport.topOutcomeStrategies || []).find((item) => item.reliable && Number(item.outcomeSuccessRate || 0) >= 0.7);
  if (taskWinner) {
    addReflection({
      type: "positive",
      severity: "medium",
      source: "task_outcome",
      strategyId: taskWinner.strategyId,
      summaryKey: "task_outcome_winner",
      evidence: {
        outcomes: Number(taskWinner.outcomes || 0),
        outcomeSuccessRate: Number.isFinite(Number(taskWinner.outcomeSuccessRate)) ? round(Number(taskWinner.outcomeSuccessRate)) : 0,
        avgOutcomeScore: Number.isFinite(Number(taskWinner.avgOutcomeScore)) ? round(Number(taskWinner.avgOutcomeScore)) : null
      },
      nextAction: "Favor this structure for the same task scenario while continuing to monitor retry and undo."
    });
  }

  const taskRisk = (taskOutcomeReport.topOutcomeStrategies || []).find((item) => item.reliable && Number(item.outcomeSuccessRate || 0) <= 0.35);
  if (taskRisk) {
    addReflection({
      type: "regression",
      severity: "high",
      source: "task_outcome",
      strategyId: taskRisk.strategyId,
      summaryKey: "task_outcome_risk",
      evidence: {
        outcomes: Number(taskRisk.outcomes || 0),
        outcomeSuccessRate: Number.isFinite(Number(taskRisk.outcomeSuccessRate)) ? round(Number(taskRisk.outcomeSuccessRate)) : 0,
        avgOutcomeScore: Number.isFinite(Number(taskRisk.avgOutcomeScore)) ? round(Number(taskRisk.avgOutcomeScore)) : null
      },
      nextAction: "Review this prompt shape and avoid using it as a winner until the aggregate outcome rate improves."
    });
  }

  if (qualityReadiness.primaryDecision === "quality_lift_positive") {
    addReflection({
      type: "positive",
      severity: "medium",
      source: "quality_lift",
      summaryKey: "quality_lift_positive",
      evidence: {
        comparable: Boolean(qualityReadiness.comparable),
        eventCount: Number(qualityReadiness.eventCount || 0),
        baselineOutcomeCount: Number(qualityReadiness.baselineOutcomeCount || 0),
        outcomeWeightedOutcomeCount: Number(qualityReadiness.outcomeWeightedOutcomeCount || 0)
      },
      nextAction: "Keep outcome-weighted guidance where aggregate lift is positive and segments are not regressing."
    });
  } else if (qualityReadiness.primaryDecision === "quality_lift_regression") {
    addReflection({
      type: "regression",
      severity: "high",
      source: "quality_lift",
      summaryKey: "quality_lift_regression",
      evidence: {
        comparable: Boolean(qualityReadiness.comparable),
        eventCount: Number(qualityReadiness.eventCount || 0),
        baselineOutcomeCount: Number(qualityReadiness.baselineOutcomeCount || 0),
        outcomeWeightedOutcomeCount: Number(qualityReadiness.outcomeWeightedOutcomeCount || 0)
      },
      nextAction: "Reduce outcome-weighted influence and collect fresh comparable outcomes before re-promoting."
    });
  }

  if (qualityLiftSegmentPolicy.decision === "segment_regression_guardrail") {
    addReflection({
      type: "regression",
      severity: "high",
      source: "quality_lift_segment",
      summaryKey: "segment_regression_guardrail",
      evidence: {
        status: segmentReadiness.status || "empty",
        matchedSegmentCount: Number(segmentReadiness.matchedSegmentCount || 0),
        regressingSegmentCount: Number(segmentReadiness.regressingSegmentCount || 0)
      },
      nextAction: "Guard matching tool/site/scenario/mode segments from adopting regressing prompt structures."
    });
  } else if (qualityLiftSegmentPolicy.decision === "collect_segment_samples") {
    addReflection({
      type: "collecting",
      severity: "medium",
      source: "quality_lift_segment",
      summaryKey: "collect_segment_samples",
      evidence: {
        status: segmentReadiness.status || "empty",
        matchedSegmentCount: Number(segmentReadiness.matchedSegmentCount || 0),
        collectingSegmentCount: Number(segmentReadiness.collectingSegmentCount || 0)
      },
      nextAction: "Keep balanced exploration until this segment has comparable outcome samples."
    });
  }

  const topFailure = (failureReasonReport.topReasons || [])[0] || null;
  if (topFailure?.key) {
    addReflection({
      type: failureReadiness.status === "ready" ? "regression" : "collecting",
      severity: failureReadiness.status === "ready" ? "high" : "medium",
      source: "failure_reason",
      reasonToken: topFailure.key,
      summaryKey: `failure_${topFailure.key}`,
      evidence: {
        totalReasonEvents: Number(failureReadiness.totalReasonEvents || 0),
        reasonToken: safeToken(topFailure.key, "other", 80),
        count: Number(topFailure.value || 0),
        policyDecision: failureReasonPolicy.decision || "empty"
      },
      nextAction: "Repair the next generated prompt with the matching failure-reason directive, without storing raw reasons."
    });
  }

  for (const item of (strategyInsights.lowSampleCandidates || []).slice(0, 2)) {
    addReflection({
      type: "collecting",
      severity: "medium",
      source: "strategy_insights",
      strategyId: item.strategyId,
      summaryKey: "low_sample_strategy",
      evidence: {
        events: Number(item.events || 0),
        score: Number.isFinite(Number(item.score)) ? round(Number(item.score)) : 0,
        reliable: Boolean(item.reliable)
      },
      nextAction: "Explore this candidate only in a low-risk lane until it reaches the reliable sample threshold."
    });
  }

  if (!reflections.length) {
    addReflection({
      type: status === "empty" ? "collecting" : status,
      severity: "medium",
      source: "baseline",
      summaryKey: "collect_baseline_samples",
      evidence: {
        eventCount: Number(metrics.eventCount || 0),
        outcomeCount: totalOutcomeEvents,
        strategyCount
      },
      nextAction: "Collect card, insert, save, retry, undo, and outcome events before treating a prompt shape as proven."
    });
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    reportVersion: SELF_IMPROVEMENT_REPORT_VERSION,
    createdAt: new Date().toISOString(),
    cohort: {
      mode: safeToken(context.mode || "", "", 40),
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: siteCohortToken(context.site || context.host || context.origin || ""),
      taskScenario
    },
    readiness: {
      status,
      eventCount: Number(metrics.eventCount || 0),
      outcomeCount: totalOutcomeEvents,
      strategyCount,
      reflectionCount: reflections.length,
      positiveReflectionCount: reflections.filter((item) => item.type === "positive").length,
      regressionReflectionCount: reflections.filter((item) => item.type === "regression").length,
      collectingReflectionCount: reflections.filter((item) => item.type === "collecting").length,
      minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS,
      promotionGated: true
    },
    learningSignals: {
      promotedStrategies: [
        ...(promoted?.strategyId ? [{
          strategyId: safeToken(promoted.strategyId, "unknown", 180),
          outcomeCount: Number(promoted.outcomeCount || 0),
          outcomeSuccessRate: Number.isFinite(Number(promoted.outcomeSuccessRate)) ? round(Number(promoted.outcomeSuccessRate)) : 0
        }] : []),
        ...(strategyWeightPolicy.promotedStrategies || []).slice(0, 3).map((item) => ({
          strategyId: safeToken(item.strategyId || item.key || "", "unknown", 180),
          outcomeCount: Number(item.outcomeCount || item.outcomes || 0),
          outcomeSuccessRate: Number.isFinite(Number(item.outcomeSuccessRate)) ? round(Number(item.outcomeSuccessRate)) : 0
        }))
      ].slice(0, 4),
      suppressedStrategies: [
        ...(suppressed?.strategyId ? [{
          strategyId: safeToken(suppressed.strategyId, "unknown", 180),
          outcomeCount: Number(suppressed.outcomeCount || 0),
          outcomeSuccessRate: Number.isFinite(Number(suppressed.outcomeSuccessRate)) ? round(Number(suppressed.outcomeSuccessRate)) : 0
        }] : []),
        ...(strategyWeightPolicy.suppressedStrategies || []).slice(0, 3).map((item) => ({
          strategyId: safeToken(item.strategyId || item.key || "", "unknown", 180),
          outcomeCount: Number(item.outcomeCount || item.outcomes || 0),
          outcomeSuccessRate: Number.isFinite(Number(item.outcomeSuccessRate)) ? round(Number(item.outcomeSuccessRate)) : 0
        }))
      ].slice(0, 4),
      topFailureReasons: (failureReasonReport.topReasons || []).slice(0, 5).map((item) => ({
        reasonToken: safeToken(item.key, "other", 80),
        count: Number(item.value || 0)
      })),
      qualityLiftDecision: qualityReadiness.primaryDecision || "empty",
      qualityLiftSegmentDecision: qualityLiftSegmentPolicy.decision || "no_segment_signal",
      failureReasonDecision: failureReasonPolicy.decision || "empty",
      collectionTargets: [
        ...((pilotOutcomeReadinessReport.collectionTargets || []).slice(0, 3).map((item) => `${item.dimension || "unknown"}/${item.key || "unknown"}`)),
        ...((strategyInsights.lowSampleCandidates || []).slice(0, 2).map((item) => `strategy/${item.strategyId}`))
      ].map((item) => safeToken(item, "unknown", 180))
    },
    reflections: reflections.slice(0, 12),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      rawFailureReasonNotStored: true,
      aggregateOnly: true,
      noAutomaticMutation: true
    }
  };
}

function formatSelfImprovementReport(report = {}) {
  const readiness = report.readiness || {};
  const topReflections = (report.reflections || [])
    .slice(0, 5)
    .map((item) => `${item.type}/${item.source}:${item.strategyId || item.reasonToken || item.summaryKey}`)
    .join(" | ") || "none";
  const failures = (report.learningSignals?.topFailureReasons || [])
    .slice(0, 4)
    .map((item) => `${item.reasonToken}:${item.count}`)
    .join(", ") || "none";
  return [
    `selfImprovement=${report.reportVersion || SELF_IMPROVEMENT_REPORT_VERSION}`,
    `readiness=${readiness.status || "empty"} events=${readiness.eventCount || 0} outcomes=${readiness.outcomeCount || 0} strategies=${readiness.strategyCount || 0}`,
    `reflections=${readiness.reflectionCount || 0} positive=${readiness.positiveReflectionCount || 0} regression=${readiness.regressionReflectionCount || 0} collecting=${readiness.collectingReflectionCount || 0}`,
    `signals=${topReflections}`,
    `failures=${failures}`,
    "promotion=manual-review-required",
    "privacy=aggregate-only raw-text-not-stored no-automatic-mutation"
  ].join("; ");
}

function buildEvolutionCandidateReport(selfImprovementReport = {}, context = {}) {
  const readiness = selfImprovementReport.readiness || {};
  const signals = selfImprovementReport.learningSignals || {};
  const candidates = [];
  const addCandidate = (candidate) => {
    const action = safeToken(candidate.action || "collect_more_samples", "collect_more_samples", 80);
    const strategyId = safeToken(candidate.strategyId || "", "", 180);
    const key = safeToken(candidate.key || strategyId || candidate.reasonToken || action, "unknown", 180);
    const id = safeToken(`${action}-${key}`, "candidate", 220);
    if (candidates.some((item) => item.id === id)) return;
    candidates.push({
      id,
      action,
      status: safeToken(candidate.status || "review", "review", 40),
      priority: safeToken(candidate.priority || "medium", "medium", 40),
      strategyId,
      reasonToken: safeToken(candidate.reasonToken || "", "", 80),
      source: safeToken(candidate.source || "self_improvement", "self_improvement", 80),
      evidence: candidate.evidence || {},
      reviewGate: normalizeText(candidate.reviewGate || "Require human review plus passing critic evidence before promotion.").slice(0, 240),
      mutationAllowed: false,
      automaticPromotion: false
    });
  };

  for (const reflection of selfImprovementReport.reflections || []) {
    if (reflection.type === "positive" && reflection.strategyId) {
      addCandidate({
        action: "promote_prompt_strategy",
        priority: "medium",
        status: readiness.status === "ready" ? "ready_for_review" : "collecting",
        strategyId: reflection.strategyId,
        source: reflection.source,
        evidence: reflection.evidence,
        reviewGate: "Promote only after min-sample readiness, no matching segment regression, and a passing prompt-quality critic."
      });
    }
    if (reflection.type === "regression" && reflection.strategyId) {
      addCandidate({
        action: "suppress_or_repair_strategy",
        priority: "high",
        status: "ready_for_review",
        strategyId: reflection.strategyId,
        source: reflection.source,
        evidence: reflection.evidence,
        reviewGate: "Suppress or repair only after verifying the regression is aggregate and not a single user correction."
      });
    }
    if (reflection.type === "regression" && reflection.reasonToken) {
      const directive = FAILURE_REASON_DIRECTIVES[reflection.reasonToken] || FAILURE_REASON_DIRECTIVES.other;
      addCandidate({
        action: directive.key,
        priority: "high",
        status: "ready_for_review",
        reasonToken: reflection.reasonToken,
        source: "failure_reason",
        evidence: reflection.evidence,
        reviewGate: "Apply as generation guidance only; do not store raw failure reasons or mutate code from user text."
      });
    }
    if (reflection.type === "collecting") {
      addCandidate({
        action: "collect_more_samples",
        priority: "medium",
        status: "collecting",
        strategyId: reflection.strategyId,
        source: reflection.source,
        evidence: reflection.evidence,
        reviewGate: "Collect more user-verified outcomes before changing strategy weights."
      });
    }
  }

  for (const failure of signals.topFailureReasons || []) {
    if (!failure.reasonToken) continue;
    const directive = FAILURE_REASON_DIRECTIVES[failure.reasonToken] || FAILURE_REASON_DIRECTIVES.other;
    addCandidate({
      action: directive.key,
      priority: Number(failure.count || 0) >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS ? "high" : "medium",
      status: Number(failure.count || 0) >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS ? "ready_for_review" : "collecting",
      reasonToken: failure.reasonToken,
      source: "failure_reason",
      evidence: {
        count: Number(failure.count || 0),
        minReasonEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS
      },
      reviewGate: "Keep this as a prompt-generation repair directive; never convert raw reasons into persistent memory."
    });
  }

  if (!candidates.length) {
    addCandidate({
      action: "collect_baseline_samples",
      priority: "medium",
      status: "collecting",
      source: "baseline",
      evidence: {
        eventCount: Number(readiness.eventCount || 0),
        outcomeCount: Number(readiness.outcomeCount || 0),
        minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS
      },
      reviewGate: "Do not evolve strategy until baseline, insert, save, retry, undo, and outcome samples are available."
    });
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    candidateVersion: EVOLUTION_CANDIDATE_REPORT_VERSION,
    sourceReportVersion: selfImprovementReport.reportVersion || SELF_IMPROVEMENT_REPORT_VERSION,
    createdAt: new Date().toISOString(),
    cohort: {
      mode: safeToken(context.mode || selfImprovementReport.cohort?.mode || "", "", 40),
      tool: safeToken(context.tool || selfImprovementReport.cohort?.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || selfImprovementReport.cohort?.adapterId || "", "", 80),
      site: siteCohortToken(context.site || context.host || context.origin || selfImprovementReport.cohort?.site || ""),
      taskScenario: taskScenarioFromContext(context, selfImprovementReport.cohort?.taskScenario || "")
    },
    readiness: {
      status: readiness.status || "empty",
      candidateCount: candidates.length,
      readyForReviewCount: candidates.filter((item) => item.status === "ready_for_review").length,
      collectingCount: candidates.filter((item) => item.status === "collecting").length,
      minOutcomeEvents: Number(readiness.minOutcomeEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS),
      promotionGated: true
    },
    promotionMode: "manual_review_required",
    mutationAllowed: false,
    automaticPromotion: false,
    requiresCritic: true,
    candidates: candidates.slice(0, 12),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      rawFailureReasonNotStored: true,
      aggregateOnly: true,
      noAutomaticMutation: true
    }
  };
}

function formatEvolutionCandidateReport(report = {}) {
  const readiness = report.readiness || {};
  const candidates = (report.candidates || [])
    .slice(0, 6)
    .map((item) => `${item.action}:${item.strategyId || item.reasonToken || item.source} status=${item.status}`)
    .join(" | ") || "none";
  return [
    `evolutionCandidates=${report.candidateVersion || EVOLUTION_CANDIDATE_REPORT_VERSION}`,
    `source=${report.sourceReportVersion || SELF_IMPROVEMENT_REPORT_VERSION}`,
    `readiness=${readiness.status || "empty"} candidates=${readiness.candidateCount || 0} readyForReview=${readiness.readyForReviewCount || 0} collecting=${readiness.collectingCount || 0}`,
    `promotion=${report.promotionMode || "manual_review_required"} mutationAllowed=${Boolean(report.mutationAllowed)}`,
    `actions=${candidates}`,
    "privacy=aggregate-only raw-text-not-stored no-automatic-mutation"
  ].join("; ");
}
