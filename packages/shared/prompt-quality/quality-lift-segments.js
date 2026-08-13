function qualityLiftSegmentValue(event = {}, dimension = "") {
  if (dimension === "site") {
    return siteCohortToken(getEventField(event, "site") || getEventField(event, "host") || "");
  }
  if (dimension === "taskScenario") {
    return safeToken(getEventField(event, "taskScenario") || getEventField(event, "scenario") || "", "unknown", 80);
  }
  if (dimension === "mode") {
    return safeToken(getEventField(event, "mode") || "", "unknown", 40);
  }
  if (dimension === "tool") {
    return safeToken(getEventField(event, "tool") || "", "unknown", 80);
  }
  return safeToken(getEventField(event, dimension) || "", "unknown", 80);
}

function normalizeQualityLiftSegmentDimension(value = "") {
  const token = safeToken(value, "", 80);
  if (token === "taskscenario" || token === "task-scenario") return "taskScenario";
  return QUALITY_LIFT_SEGMENT_DIMENSIONS.includes(token) ? token : "";
}

function qualityLiftSegmentSortScore(segment = {}) {
  return round(
    Number(segment.successLift || 0)
    + Number(segment.avgOutcomeScoreLift || 0)
    - Math.max(0, Number(segment.retryUsageRateLift || 0))
    - Math.max(0, Number(segment.undoUsageRateLift || 0))
  );
}

function buildQualityLiftSegment(dimension, key, events = []) {
  const report = buildPromptQualityLiftReport({ events }, {});
  const readiness = report.readiness || {};
  const comparison = (report.comparisons || []).find((item) => item.name === "outcome_weighted_vs_baseline")
    || (report.comparisons || [])[0]
    || {};
  const deltas = comparison.deltas || {};
  const baselineCount = Number(readiness.baselineOutcomeCount || 0);
  const guidedCount = Number(readiness.strategyGuidedOutcomeCount || 0);
  const weightedCount = Number(readiness.outcomeWeightedOutcomeCount || 0);
  const neededOutcomeEvents = Math.max(
    0,
    Number(readiness.minOutcomeEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS) - Math.min(baselineCount, weightedCount)
  );
  const segment = {
    dimension,
    key: safeToken(key, "unknown", dimension === "site" ? 120 : 80),
    eventCount: Number(readiness.eventCount || events.length || 0),
    readinessStatus: readiness.status || "empty",
    comparable: Boolean(readiness.comparable),
    primaryDecision: readiness.primaryDecision || comparison.decision || "collecting",
    minOutcomeEvents: Number(readiness.minOutcomeEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS),
    baselineOutcomeCount: baselineCount,
    strategyGuidedOutcomeCount: guidedCount,
    outcomeWeightedOutcomeCount: weightedCount,
    neededOutcomeEvents,
    successLift: Number(deltas.outcomeSuccessRateLift || 0),
    avgOutcomeScoreLift: deltas.avgOutcomeScoreLift === null || deltas.avgOutcomeScoreLift === undefined ? null : Number(deltas.avgOutcomeScoreLift),
    insertSuccessRateLift: Number(deltas.insertSuccessRateLift || 0),
    saveRateLift: Number(deltas.saveRateLift || 0),
    retryUsageRateLift: Number(deltas.retryUsageRateLift || 0),
    undoUsageRateLift: Number(deltas.undoUsageRateLift || 0),
    recommendationKeys: (report.recommendations || []).slice(0, 3).map((item) => safeToken(item.key, "recommendation", 120))
  };
  segment.sortScore = qualityLiftSegmentSortScore(segment);
  return segment;
}

function sortQualityLiftSegments(left = {}, right = {}) {
  return Number(right.comparable) - Number(left.comparable)
    || Number(right.eventCount || 0) - Number(left.eventCount || 0)
    || String(left.key || "").localeCompare(String(right.key || ""));
}

function buildPromptQualityLiftSegmentsReport(metrics = {}, context = {}, options = {}) {
  const rawEvents = Array.isArray(metrics.events) ? metrics.events : [];
  const scopedEvents = rawEvents.filter((event) => qualityLiftContextMatches(event, context));
  const requestedDimensions = Array.isArray(options.dimensions) && options.dimensions.length
    ? options.dimensions
    : QUALITY_LIFT_SEGMENT_DIMENSIONS;
  const dimensions = requestedDimensions
    .map((dimension) => normalizeQualityLiftSegmentDimension(dimension))
    .filter((dimension) => QUALITY_LIFT_SEGMENT_DIMENSIONS.includes(dimension));
  const limit = clamp(Number(options.limit || 6), 1, 20);
  const segmentsByDimension = {};
  const allSegments = [];

  for (const dimension of dimensions) {
    const groups = new Map();
    for (const event of scopedEvents) {
      const key = qualityLiftSegmentValue(event, dimension);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    const rows = Array.from(groups.entries())
      .map(([key, events]) => buildQualityLiftSegment(dimension, key, events))
      .sort(sortQualityLiftSegments);
    segmentsByDimension[dimension] = rows;
    allSegments.push(...rows);
  }

  const improvingSegments = allSegments
    .filter((item) => item.comparable && item.primaryDecision === "quality_lift_positive")
    .sort((left, right) => Number(right.sortScore || 0) - Number(left.sortScore || 0) || sortQualityLiftSegments(left, right));
  const regressingSegments = allSegments
    .filter((item) => item.comparable && item.primaryDecision === "quality_lift_regression")
    .sort((left, right) => Number(left.sortScore || 0) - Number(right.sortScore || 0) || sortQualityLiftSegments(left, right));
  const collectingSegments = allSegments
    .filter((item) => !item.comparable || item.readinessStatus === "collecting" || item.readinessStatus === "empty")
    .sort((left, right) => Number(right.neededOutcomeEvents || 0) - Number(left.neededOutcomeEvents || 0) || sortQualityLiftSegments(left, right));
  const status = scopedEvents.length === 0
    ? "empty"
    : regressingSegments.length > 0
      ? "review"
      : improvingSegments.length > 0
        ? "ready"
        : "collecting";

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    reportVersion: PROMPT_QUALITY_LIFT_SEGMENTS_REPORT_VERSION,
    sourceReportVersion: PROMPT_QUALITY_LIFT_REPORT_VERSION,
    createdAt: new Date().toISOString(),
    readiness: {
      status,
      eventCount: scopedEvents.length,
      dimensionCount: dimensions.length,
      segmentCount: allSegments.length,
      readySegmentCount: allSegments.filter((item) => item.comparable).length,
      improvingSegmentCount: improvingSegments.length,
      regressingSegmentCount: regressingSegments.length,
      collectingSegmentCount: collectingSegments.length,
      minOutcomeEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS
    },
    cohort: {
      mode: safeToken(context.mode || "", "", 40),
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: siteCohortToken(context.site || context.host || context.origin || ""),
      taskScenario: taskScenarioFromContext(context, "")
    },
    dimensions,
    segmentsByDimension,
    topImproving: improvingSegments.slice(0, limit),
    topRegressing: regressingSegments.slice(0, limit),
    collectingSegments: collectingSegments.slice(0, limit),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      derivedFromAggregateQualityLiftMetrics: true,
      segmentMetadataOnly: true,
      aggregateOnly: true
    }
  };
}

function formatQualityLiftSegmentList(items = [], limit = 4) {
  return items.slice(0, limit).map((item) => {
    const avgLift = item.avgOutcomeScoreLift === null || item.avgOutcomeScoreLift === undefined ? "none" : item.avgOutcomeScoreLift;
    return `${item.dimension}/${item.key}:decision=${item.primaryDecision}:status=${item.readinessStatus}:successLift=${item.successLift}:avgLift=${avgLift}:retryLift=${item.retryUsageRateLift}:undoLift=${item.undoUsageRateLift}:weightedOutcomes=${item.outcomeWeightedOutcomeCount}`;
  }).join(" | ") || "none";
}

function formatPromptQualityLiftSegmentsReport(report = {}) {
  const readiness = report.readiness || {};
  const dimensions = (report.dimensions || [])
    .slice(0, 6)
    .map((dimension) => `${dimension}:${(report.segmentsByDimension?.[dimension] || []).length}`)
    .join(" | ") || "none";
  return [
    `qualityLiftSegments=${report.reportVersion || PROMPT_QUALITY_LIFT_SEGMENTS_REPORT_VERSION}`,
    `readiness=${readiness.status || "empty"} segments=${readiness.segmentCount || 0} ready=${readiness.readySegmentCount || 0} improving=${readiness.improvingSegmentCount || 0} regressing=${readiness.regressingSegmentCount || 0} collecting=${readiness.collectingSegmentCount || 0}`,
    `dimensions=${dimensions}`,
    `improving=${formatQualityLiftSegmentList(report.topImproving || [])}`,
    `regressing=${formatQualityLiftSegmentList(report.topRegressing || [])}`,
    `collecting=${formatQualityLiftSegmentList(report.collectingSegments || [])}`,
    "privacy=aggregate-only"
  ].join("; ");
}

function qualityLiftSegmentContextValue(context = {}, dimension = "") {
  if (dimension === "site") {
    return siteCohortToken(context.site || context.host || context.origin || "");
  }
  if (dimension === "taskScenario") {
    return taskScenarioFromContext(context, "");
  }
  if (dimension === "mode") {
    return safeToken(context.mode || "", "", 40);
  }
  if (dimension === "tool") {
    return safeToken(context.tool || "", "", 80);
  }
  return safeToken(context[dimension] || "", "", 80);
}

function normalizeQualityLiftSegmentMatch(segment = {}) {
  const avgLift = segment.avgOutcomeScoreLift === null || segment.avgOutcomeScoreLift === undefined
    ? null
    : Number(segment.avgOutcomeScoreLift);
  return {
    dimension: safeToken(segment.dimension || "", "", 40),
    key: safeToken(segment.key || "", "unknown", segment.dimension === "site" ? 120 : 80),
    readinessStatus: safeToken(segment.readinessStatus || "", "empty", 40),
    comparable: Boolean(segment.comparable),
    primaryDecision: safeToken(segment.primaryDecision || "", "collecting", 80),
    eventCount: Number(segment.eventCount || 0),
    baselineOutcomeCount: Number(segment.baselineOutcomeCount || 0),
    strategyGuidedOutcomeCount: Number(segment.strategyGuidedOutcomeCount || 0),
    outcomeWeightedOutcomeCount: Number(segment.outcomeWeightedOutcomeCount || 0),
    neededOutcomeEvents: Number(segment.neededOutcomeEvents || 0),
    successLift: Number(segment.successLift || 0),
    avgOutcomeScoreLift: Number.isFinite(avgLift) ? avgLift : null,
    retryUsageRateLift: Number(segment.retryUsageRateLift || 0),
    undoUsageRateLift: Number(segment.undoUsageRateLift || 0)
  };
}

function buildQualityLiftSegmentPolicy(segmentReport = {}, context = {}) {
  const dimensions = Array.isArray(segmentReport.dimensions) && segmentReport.dimensions.length
    ? segmentReport.dimensions
    : QUALITY_LIFT_SEGMENT_DIMENSIONS;
  const matchedSegments = [];
  const missingSegments = [];

  for (const rawDimension of dimensions) {
    const dimension = normalizeQualityLiftSegmentDimension(rawDimension);
    if (!dimension) continue;
    const expectedKey = qualityLiftSegmentContextValue(context, dimension);
    const candidates = segmentReport.segmentsByDimension?.[dimension] || [];
    const matched = expectedKey && expectedKey !== "unknown"
      ? candidates.find((item) => safeToken(item.key || "", "unknown", dimension === "site" ? 120 : 80) === expectedKey)
      : null;
    if (matched) {
      matchedSegments.push(normalizeQualityLiftSegmentMatch(matched));
    } else {
      missingSegments.push({
        dimension,
        expectedKey: expectedKey || "unknown",
        reason: expectedKey && expectedKey !== "unknown" ? "no_matching_segment" : "missing_context_value"
      });
    }
  }

  const regressingSegments = matchedSegments.filter((item) => item.comparable && item.primaryDecision === "quality_lift_regression");
  const improvingSegments = matchedSegments.filter((item) => item.comparable && item.primaryDecision === "quality_lift_positive");
  const collectingSegments = matchedSegments.filter((item) => !item.comparable || item.readinessStatus === "collecting" || item.readinessStatus === "empty");
  const directives = [];
  const addDirective = (key, strength, directive) => {
    if (directives.some((item) => item.key === key)) return;
    directives.push({
      key,
      strength: round(clamp(Number(strength || 0), 0, 1)),
      directive
    });
  };

  let decision = "no_segment_signal";
  let recommendationKey = "continue_global_quality_policy";
  let status = matchedSegments.length ? "matched" : "empty";
  let influence = "neutral";

  if (regressingSegments.length) {
    decision = "segment_regression_guardrail";
    recommendationKey = "review_regressing_segment";
    status = "review";
    influence = "reduce_outcome_weighting";
    addDirective("avoid_regressing_segment", 0.9, "Reduce outcome-weighted influence in matching quality-lift segments that are regressing until outcomes recover.");
  } else if (improvingSegments.length) {
    decision = "preserve_segment_winner";
    recommendationKey = "keep_segment_outcome_weighting";
    status = "ready";
    influence = "preserve_outcome_weighting";
    addDirective("preserve_improving_segment", 0.76, "Preserve outcome-weighted prompt structure in matching segments with positive quality lift.");
  } else if (collectingSegments.length) {
    decision = "collect_segment_samples";
    recommendationKey = "collect_comparable_segment_samples";
    status = "collecting";
    influence = "balanced_exploration";
    const needed = collectingSegments.reduce((sum, item) => sum + Number(item.neededOutcomeEvents || 0), 0);
    addDirective("collect_quality_lift_segment_samples", needed ? Math.min(0.75, 0.45 + needed / 20) : 0.45, "Keep balanced exploration and collect comparable outcomes for this tool/site/scenario/mode segment.");
  }

  if (matchedSegments.length) {
    addDirective("respect_quality_lift_segments", 0.5, "Use quality-lift segment evidence as aggregate guidance without exposing raw telemetry or prompt text.");
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    policyVersion: QUALITY_LIFT_SEGMENT_POLICY_VERSION,
    sourceReportVersion: segmentReport.reportVersion || PROMPT_QUALITY_LIFT_SEGMENTS_REPORT_VERSION,
    createdAt: new Date().toISOString(),
    cohort: {
      mode: safeToken(context.mode || "", "", 40),
      tool: safeToken(context.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || "", "", 80),
      site: siteCohortToken(context.site || context.host || context.origin || ""),
      taskScenario: taskScenarioFromContext(context, "")
    },
    readiness: {
      status,
      matchedSegmentCount: matchedSegments.length,
      regressingSegmentCount: regressingSegments.length,
      improvingSegmentCount: improvingSegments.length,
      collectingSegmentCount: collectingSegments.length,
      missingSegmentCount: missingSegments.length
    },
    decision,
    recommendationKey,
    influence,
    matchedSegments,
    regressingSegments,
    improvingSegments,
    collectingSegments,
    missingSegments,
    directives,
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      derivedFromAggregateQualityLiftSegments: true,
      segmentMetadataOnly: true,
      aggregateOnly: true
    }
  };
}

function formatQualityLiftSegmentPolicy(policy = {}) {
  const readiness = policy.readiness || {};
  const matches = (policy.matchedSegments || [])
    .slice(0, 4)
    .map((item) => `${item.dimension}/${item.key}:${item.primaryDecision}:status=${item.readinessStatus}:weightedOutcomes=${item.outcomeWeightedOutcomeCount}:successLift=${item.successLift}:avgLift=${item.avgOutcomeScoreLift ?? "none"}`)
    .join(" | ") || "none";
  const directives = (policy.directives || [])
    .slice(0, 4)
    .map((item) => `${item.key}:${item.directive}`)
    .join(" | ") || "none";
  return [
    `qualityLiftSegmentPolicy=${policy.policyVersion || QUALITY_LIFT_SEGMENT_POLICY_VERSION}`,
    `source=${policy.sourceReportVersion || PROMPT_QUALITY_LIFT_SEGMENTS_REPORT_VERSION}`,
    `decision=${policy.decision || "no_segment_signal"}`,
    `recommendation=${policy.recommendationKey || "continue_global_quality_policy"}`,
    `status=${readiness.status || "empty"} matched=${readiness.matchedSegmentCount || 0} improving=${readiness.improvingSegmentCount || 0} regressing=${readiness.regressingSegmentCount || 0} collecting=${readiness.collectingSegmentCount || 0}`,
    `matches=${matches}`,
    `directives=${directives}`,
    "privacy=aggregate-only"
  ].join("; ");
}
