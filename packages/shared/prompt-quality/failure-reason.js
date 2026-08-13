function getEventField(event = {}, camelName = "") {
  const snakeName = camelName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return event[camelName] ?? event[snakeName];
}

function normalizeFailureReasonToken(value, fallback = "") {
  const raw = normalizeText(value);
  const fallbackToken = normalizeText(fallback);
  const text = raw || fallbackToken;
  if (!text) return "";
  const lower = text.toLowerCase();
  const compact = safeToken(lower, "", 140).replace(/[.+-]+/g, "_");
  const aliasMap = {
    too_long: "too_long",
    toolong: "too_long",
    verbose: "too_long",
    long_prompt: "too_long",
    wrong_format: "wrong_format",
    bad_format: "wrong_format",
    format_error: "wrong_format",
    invalid_format: "wrong_format",
    not_actionable: "not_actionable",
    unactionable: "not_actionable",
    missing_context: "missing_context",
    missing_info: "missing_context",
    incomplete_context: "missing_context",
    too_vague: "too_vague",
    vague: "too_vague",
    unsafe_or_privacy: "unsafe_or_privacy",
    privacy: "unsafe_or_privacy",
    unsafe: "unsafe_or_privacy",
    insert_failed: "insert_failed",
    after_write_mismatch: "insert_failed",
    no_visible_input_candidate: "insert_failed",
    paste_failed: "insert_failed",
    write_failed: "insert_failed",
    tool_mismatch: "tool_mismatch",
    adapter_mismatch: "tool_mismatch",
    token_waste: "token_waste",
    token_overuse: "token_waste",
    excessive_tokens: "token_waste",
    low_quality: "low_quality",
    needs_work: "low_quality",
    manual_card_needs_work: "low_quality",
    manual_toast_needs_work: "low_quality",
    not_useful: "low_quality",
    failed: "low_quality",
    failure: "low_quality",
    bad: "low_quality",
    user_retry_requested: "low_quality",
    other: "other",
    unknown: "other"
  };
  if (FAILURE_REASON_TOKEN_SET.has(compact)) return compact;
  if (aliasMap[compact]) return aliasMap[compact];
  if (/\b(too\s*long|long\s*prompt|verbose|wordy|overlong|length)\b/i.test(lower) || /太长|冗长|啰嗦/u.test(lower)) return "too_long";
  if (/\b(format|schema|json|markdown|table|structure|field|wrong\s*shape|invalid\s*shape)\b/i.test(lower) || /格式|结构|字段|表格/u.test(lower)) return "wrong_format";
  if (/\b(not\s*actionable|unactionable|no\s*steps?|missing\s*steps?|unclear\s*next|cannot\s*execute)\b/i.test(lower) || /不可执行|没步骤|没有步骤|不落地/u.test(lower)) return "not_actionable";
  if (/\b(missing\s*(context|info|information|requirement)|need\s*more|insufficient\s*context|assumption)\b/i.test(lower) || /缺少|信息不足|上下文不足|需要补充/u.test(lower)) return "missing_context";
  if (/\b(vague|unclear|ambiguous|too\s*broad|broad)\b/i.test(lower) || /模糊|不清楚|太泛|范围不清/u.test(lower)) return "too_vague";
  if (/\b(privacy|private|secret|credential|api\s*key|token|unsafe|safety|permission|sensitive)\b/i.test(lower) || /隐私|密钥|凭据|敏感|不安全/u.test(lower)) return "unsafe_or_privacy";
  if (/\b(insert|paste|write|textarea|contenteditable|input\s*candidate|adapter|after[_\s-]?write|fill)\b/i.test(lower) || /插入|粘贴|输入框|写入/u.test(lower)) return "insert_failed";
  if (/\b(tool|site|adapter|provider|model)\s*(mismatch|wrong|unsupported|incompatible)\b/i.test(lower) || /工具不匹配|站点不匹配/u.test(lower)) return "tool_mismatch";
  if (/\b(token|context)\s*(waste|overuse|excess|bloat)\b/i.test(lower) || /token\s*浪费|上下文冗余|令牌浪费/iu.test(lower)) return "token_waste";
  if (/\b(low\s*quality|bad|failed|failure|not[-_\s]?useful|retry|redo|weak)\b/i.test(lower) || /needs[-_\s]?work/i.test(lower) || /质量差|不好用|失败|重试/u.test(lower)) return "low_quality";
  return "other";
}

function failureReasonFromOutcome(event = {}) {
  const label = safeToken(getEventField(event, "outcomeLabel") || event.outcome || event.result || "", "", 80);
  if (FAILED_OUTCOME_LABELS.has(label)) return "low_quality";
  const action = safeToken(event.action || "", "", 40);
  if (action === "retry" || action === "undo") return "low_quality";
  if (action === "insert" && !(event.verified || event.adopted || event.ok)) return "insert_failed";
  return "";
}

function extractFailureReasonToken(event = {}) {
  const explicit = getEventField(event, "failureReasonToken");
  const raw = explicit
    || getEventField(event, "failureReason")
    || getEventField(event, "outcomeReason")
    || getEventField(event, "outcomeFailureReason")
    || getEventField(event, "reason")
    || "";
  return normalizeFailureReasonToken(raw, failureReasonFromOutcome(event));
}

function failureReasonContextMatches(event = {}, context = {}) {
  return qualityLiftContextMatches(event, context);
}

function buildFailureReasonReport(metrics = {}, context = {}) {
  const rawEvents = Array.isArray(metrics.events) ? metrics.events : [];
  const reasonCounts = {};
  const byAction = {};
  const byStrategy = {};
  const byTool = {};
  const bySite = {};
  const byMode = {};
  const byTaskScenario = {};
  const matchedEvents = [];
  for (const event of rawEvents) {
    if (!failureReasonContextMatches(event, context)) continue;
    const reasonToken = extractFailureReasonToken(event);
    if (!reasonToken) continue;
    matchedEvents.push(event);
    reasonCounts[reasonToken] = (reasonCounts[reasonToken] || 0) + 1;
    const action = safeToken(event.action || "unknown", "unknown", 40);
    byAction[action] = byAction[action] || {};
    byAction[action][reasonToken] = (byAction[action][reasonToken] || 0) + 1;
    const strategyId = safeToken(getEventField(event, "strategyId") || "unknown", "unknown", 180);
    byStrategy[strategyId] = byStrategy[strategyId] || {};
    byStrategy[strategyId][reasonToken] = (byStrategy[strategyId][reasonToken] || 0) + 1;
    const tool = safeToken(getEventField(event, "tool") || "unknown", "unknown", 80);
    byTool[tool] = byTool[tool] || {};
    byTool[tool][reasonToken] = (byTool[tool][reasonToken] || 0) + 1;
    const site = siteCohortToken(getEventField(event, "site") || getEventField(event, "host") || "unknown");
    bySite[site] = bySite[site] || {};
    bySite[site][reasonToken] = (bySite[site][reasonToken] || 0) + 1;
    const mode = safeToken(getEventField(event, "mode") || "unknown", "unknown", 40);
    byMode[mode] = byMode[mode] || {};
    byMode[mode][reasonToken] = (byMode[mode][reasonToken] || 0) + 1;
    const scenario = safeToken(getEventField(event, "taskScenario") || getEventField(event, "scenario") || "general", "general", 80);
    byTaskScenario[scenario] = byTaskScenario[scenario] || {};
    byTaskScenario[scenario][reasonToken] = (byTaskScenario[scenario][reasonToken] || 0) + 1;
  }

  const totalReasonEvents = Object.values(reasonCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const status = !totalReasonEvents ? "empty" : totalReasonEvents >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS ? "ready" : "collecting";
  const topReasons = topEntries(reasonCounts, 8);
  const recommendations = topReasons.length
    ? topReasons.map((item) => {
      const directive = FAILURE_REASON_DIRECTIVES[item.key] || FAILURE_REASON_DIRECTIVES.other;
      return {
        key: directive.key,
        reasonToken: item.key,
        count: Number(item.value || 0),
        priority: item.value >= PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS ? "high" : "medium",
        recommendation: directive.directive
      };
    })
    : [{
      key: "collect_failure_reason_tokens",
      reasonToken: "",
      count: 0,
      priority: "medium",
      recommendation: "Collect privacy-safe failure reason tokens from failed, needs-work, retry, undo, and insert-failed events."
    }];

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    reportVersion: FAILURE_REASON_REPORT_VERSION,
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
      totalReasonEvents,
      matchedEventCount: matchedEvents.length,
      reasonTokenCount: topReasons.length,
      minReasonEvents: PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS
    },
    allowedReasonTokens: FAILURE_REASON_TOKENS,
    topReasons,
    byReason: reasonCounts,
    byAction,
    byStrategy,
    byTool,
    bySite,
    byMode,
    byTaskScenario,
    recommendations: recommendations.slice(0, 8),
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      rawFailureReasonNotStored: true,
      derivedFromAggregateFailureReasonTokens: true,
      aggregateOnly: true
    }
  };
}

function buildFailureReasonPolicy(report = {}, context = {}) {
  const readiness = report.readiness || {};
  const topReasons = (report.topReasons || []).slice(0, 5);
  const status = safeToken(readiness.status || "empty", "empty", 40);
  const directives = [];
  const addDirective = (reasonToken, count) => {
    const directive = FAILURE_REASON_DIRECTIVES[reasonToken] || FAILURE_REASON_DIRECTIVES.other;
    if (directives.some((item) => item.key === directive.key)) return;
    directives.push({
      key: directive.key,
      reasonToken,
      count: Number(count || 0),
      strength: round(clamp(Number(count || 0) / Math.max(PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS, 1), 0.35, 1)),
      directive: directive.directive
    });
  };
  for (const item of topReasons) addDirective(item.key, item.value);
  if (!directives.length && status !== "empty") addDirective("other", 1);

  const topToken = topReasons[0]?.key || "";
  const topDirective = directives[0] || null;
  let decision = status === "empty" ? "empty" : status === "collecting" ? "collecting" : "apply_failure_reason_policy";
  let recommendationKey = topDirective?.key || "collect_failure_reason_tokens";
  let influence = topDirective ? "repair_prompt_structure" : "collect_reason_tokens";
  if (topToken === "insert_failed") {
    decision = "reduce_insert_fragility";
    recommendationKey = "reduce_insert_fragility";
    influence = "insert_safety_guardrail";
  } else if (topToken === "wrong_format") {
    decision = "strengthen_output_format";
  } else if (topToken === "missing_context") {
    decision = "add_missing_context_questions";
  } else if (topToken === "too_long") {
    decision = "shorten_prompt";
  } else if (topToken === "not_actionable") {
    decision = "make_prompt_actionable";
  }

  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    policyVersion: FAILURE_REASON_POLICY_VERSION,
    sourceReportVersion: report.reportVersion || FAILURE_REASON_REPORT_VERSION,
    createdAt: new Date().toISOString(),
    cohort: {
      mode: safeToken(context.mode || report.cohort?.mode || "", "", 40),
      tool: safeToken(context.tool || report.cohort?.tool || "", "", 80),
      adapterId: safeToken(context.adapterId || context.adapter_id || context.siteAdapterId || report.cohort?.adapterId || "", "", 80),
      site: siteCohortToken(context.site || context.host || context.origin || report.cohort?.site || ""),
      taskScenario: taskScenarioFromContext(context, report.cohort?.taskScenario || "")
    },
    readiness: {
      status,
      totalReasonEvents: Number(readiness.totalReasonEvents || 0),
      minReasonEvents: Number(readiness.minReasonEvents || PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS),
      reasonTokenCount: Number(readiness.reasonTokenCount || topReasons.length)
    },
    decision,
    recommendationKey,
    influence,
    topReasons,
    directives,
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      pageBodyNotRequired: true,
      fullUrlNotStored: true,
      rawFailureReasonNotStored: true,
      derivedFromAggregateFailureReasonTokens: true,
      aggregateOnly: true
    }
  };
}

function formatFailureReasonReport(report = {}) {
  const readiness = report.readiness || {};
  const topReasons = (report.topReasons || [])
    .slice(0, 5)
    .map((item) => `${item.key}:${item.value}`)
    .join(", ") || "none";
  const recommendations = (report.recommendations || [])
    .slice(0, 5)
    .map((item) => `${item.key}:${item.reasonToken || "all"}`)
    .join(" | ") || "none";
  return [
    `failureReasons=${report.reportVersion || FAILURE_REASON_REPORT_VERSION}`,
    `readiness=${readiness.status || "empty"} total=${readiness.totalReasonEvents || 0} tokens=${readiness.reasonTokenCount || 0}`,
    `top=${topReasons}`,
    `recommendations=${recommendations}`,
    "privacy=aggregate-only raw-reason-not-stored"
  ].join("; ");
}

function formatFailureReasonPolicy(policy = {}) {
  const readiness = policy.readiness || {};
  const topReasons = (policy.topReasons || [])
    .slice(0, 5)
    .map((item) => `${item.key}:${item.value}`)
    .join(", ") || "none";
  const directives = (policy.directives || [])
    .slice(0, 5)
    .map((item) => `${item.key}:${item.directive}`)
    .join(" | ") || "none";
  return [
    `failureReasonPolicy=${policy.policyVersion || FAILURE_REASON_POLICY_VERSION}`,
    `source=${policy.sourceReportVersion || FAILURE_REASON_REPORT_VERSION}`,
    `decision=${policy.decision || "empty"}`,
    `recommendation=${policy.recommendationKey || "collect_failure_reason_tokens"}`,
    `status=${readiness.status || "empty"} total=${readiness.totalReasonEvents || 0} tokens=${readiness.reasonTokenCount || 0}`,
    `top=${topReasons}`,
    `directives=${directives}`,
    "privacy=aggregate-only raw-reason-not-stored"
  ].join("; ");
}
