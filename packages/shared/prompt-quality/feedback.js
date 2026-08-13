function buildFeedbackSummary(metrics = {}, context = {}) {
  const adapterId = context.adapterId || context.adapter_id || context.siteAdapterId || "";
  const taskScenario = taskScenarioFromContext(context, "");
  const scenarioAggregate = taskScenario && metrics.byScenario ? metrics.byScenario[taskScenario] : null;
  const metricSource = scenarioAggregate || metrics;
  const adapter = adapterId && metrics.byAdapter ? metrics.byAdapter[adapterId] : null;
  const sourceInsertAttempts = Number(metricSource.insertAttempts || 0);
  const sourceFailures = Number(metricSource.failures || 0);
  const sourceAdapterFailureRate = Number.isFinite(Number(metricSource.adapterFailureRate))
    ? Number(metricSource.adapterFailureRate)
    : sourceInsertAttempts ? sourceFailures / sourceInsertAttempts : 0;
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    eventCount: Number(metricSource.eventCount || metricSource.events || 0),
    insertSuccessRate: round(Number(metricSource.insertSuccessRate || 0)),
    saveRate: round(Number(metricSource.saveRate || 0)),
    retryUsageRate: round(Number(metricSource.retryUsageRate || 0)),
    undoUsageRate: round(Number(metricSource.undoUsageRate || 0)),
    adapterFailureRate: round(sourceAdapterFailureRate),
    commonFailureReasons: topEntries(metrics.failureReasons, 3),
    taskScenario,
    scenario: scenarioAggregate ? {
      id: taskScenario,
      events: Number(scenarioAggregate.events || 0),
      insertAttempts: Number(scenarioAggregate.insertAttempts || 0),
      verifiedInserts: Number(scenarioAggregate.verifiedInserts || 0),
      failures: Number(scenarioAggregate.failures || 0)
    } : null,
    adapter: adapter ? {
      id: adapterId,
      events: Number(adapter.events || 0),
      insertAttempts: Number(adapter.insertAttempts || 0),
      verifiedInserts: Number(adapter.verifiedInserts || 0),
      failures: Number(adapter.failures || 0)
    } : null
  };
}

function pushDirective(profile, key, strength, directive) {
  if (profile.directives.some((item) => item.key === key)) return;
  profile.directives.push({
    key,
    strength: round(clamp(strength, 0, 1)),
    directive
  });
}

function buildFeedbackProfile(metrics = {}, context = {}) {
  const summary = buildFeedbackSummary(metrics, context);
  const adapterId = context.adapterId || context.adapter_id || context.siteAdapterId || "";
  const adapterAttempts = Number(summary.adapter?.insertAttempts || 0);
  const adapterVerified = Number(summary.adapter?.verifiedInserts || 0);
  const adapterFailures = Number(summary.adapter?.failures || 0);
  const adapterInsertSuccessRate = adapterAttempts ? adapterVerified / adapterAttempts : null;
  const eventCount = Number(summary.eventCount || 0);
  const confidence = eventCount >= 20 ? "high" : eventCount >= 6 ? "medium" : eventCount > 0 ? "low" : "none";
  const profile = {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    confidence,
    cohort: {
      mode: context.mode || "",
      tool: context.tool || "",
      adapterId,
      taskScenario: summary.taskScenario || taskScenarioFromContext(context, "")
    },
    rates: {
      insertSuccessRate: summary.insertSuccessRate,
      saveRate: summary.saveRate,
      retryUsageRate: summary.retryUsageRate,
      undoUsageRate: summary.undoUsageRate,
      adapterFailureRate: summary.adapterFailureRate,
      adapterInsertSuccessRate: adapterInsertSuccessRate === null ? null : round(adapterInsertSuccessRate)
    },
    directives: [],
    commonFailureReasons: summary.commonFailureReasons,
    privacy: {
      promptTextNotStored: true,
      pageBodyNotRequired: true,
      derivedFromAggregateMetrics: true
    }
  };

  if (!eventCount) {
    pushDirective(profile, "cold_start_structure", 0.5, "Use the default high-quality structure with goal, context, tasks, constraints, output format, and acceptance criteria.");
    return profile;
  }

  if (summary.retryUsageRate >= 0.3) {
    pushDirective(profile, "reduce_retry", summary.retryUsageRate, "Make the first prompt more complete: include assumptions, missing information, and explicit acceptance criteria.");
  }
  if (summary.undoUsageRate >= 0.25) {
    pushDirective(profile, "reduce_undo", summary.undoUsageRate, "Keep the prompt reviewable and bounded; avoid instructions that could cause accidental submission or broad changes.");
  }
  if (summary.saveRate >= 0.5) {
    pushDirective(profile, "preserve_reusable_shape", summary.saveRate, "Preserve reusable section headings and selected skill references because saved prompts are common.");
  } else if (eventCount >= 6 && summary.saveRate <= 0.15) {
    pushDirective(profile, "improve_reusability", 1 - summary.saveRate, "Make the prompt easier to reuse by separating goal, constraints, output format, and acceptance criteria.");
  }
  if (summary.adapterFailureRate >= 0.3 || adapterFailures > 0) {
    pushDirective(profile, "adapter_insert_risk", Math.max(summary.adapterFailureRate, adapterFailures / Math.max(adapterAttempts, 1)), "Use plain text sections and avoid fragile formatting that may fail when inserted into the current tool.");
  }
  const failureKeys = new Set((summary.commonFailureReasons || []).map((item) => item.key));
  if (failureKeys.has("after_write_mismatch")) {
    pushDirective(profile, "after_write_mismatch", 0.85, "Avoid huge tables or complex markup; prefer compact plain text that can survive textarea/contenteditable paste.");
  }
  if (failureKeys.has("insert_failed") || failureKeys.has("no_visible_input_candidate")) {
    pushDirective(profile, "insert_failure", 0.8, "Keep generated text easy to copy manually and include no auto-submit instructions.");
  }
  if (failureKeys.has("user_retry_requested")) {
    pushDirective(profile, "user_retry_requested", 0.7, "Offer a stronger first draft with fewer open-ended choices and clearer next actions.");
  }
  if (profile.directives.length === 0) {
    pushDirective(profile, "steady_state", 0.4, "Maintain the current structure while keeping the prompt concise and verifiable.");
  }
  return profile;
}

function formatFeedbackSummary(summary = {}) {
  if (!summary.eventCount) return "No local feedback yet.";
  const failures = (summary.commonFailureReasons || [])
    .map((item) => `${item.key}:${item.value}`)
    .join(", ") || "none";
  const adapter = summary.adapter
    ? ` adapter=${summary.adapter.id} verified=${summary.adapter.verifiedInserts}/${summary.adapter.insertAttempts}`
    : "";
  return [
    `events=${summary.eventCount}`,
    `insertSuccessRate=${summary.insertSuccessRate}`,
    `saveRate=${summary.saveRate}`,
    `retryUsageRate=${summary.retryUsageRate}`,
    `undoUsageRate=${summary.undoUsageRate}`,
    `adapterFailureRate=${summary.adapterFailureRate}`,
    `failures=${failures}${adapter}`
  ].join("; ");
}

function formatFeedbackProfile(profile = {}) {
  const directives = (profile.directives || [])
    .slice(0, 4)
    .map((item) => `${item.key}:${item.directive}`)
    .join(" | ");
  if (!directives) return "No feedback profile directives yet.";
  const rates = profile.rates || {};
  return [
    `confidence=${profile.confidence || "none"}`,
    `insertSuccessRate=${rates.insertSuccessRate ?? 0}`,
    `saveRate=${rates.saveRate ?? 0}`,
    `retryUsageRate=${rates.retryUsageRate ?? 0}`,
    `undoUsageRate=${rates.undoUsageRate ?? 0}`,
    `directives=${directives}`
  ].join("; ");
}
