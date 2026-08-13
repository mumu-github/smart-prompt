const QUALITY_SCHEMA_VERSION = "v6-prompt-quality@1";
const PROMPT_STRATEGY_POLICY_VERSION = "v6-strategy-policy@3";
const STRATEGY_WEIGHT_POLICY_VERSION = "v6-strategy-weighting@1";
const PROMPT_QUALITY_LIFT_REPORT_VERSION = "v6-quality-lift@1";
const PROMPT_QUALITY_LIFT_SEGMENTS_REPORT_VERSION = "v6-quality-lift-segments@1";
const QUALITY_LIFT_SEGMENT_POLICY_VERSION = "v6-quality-lift-segment-policy@1";
const FAILURE_REASON_REPORT_VERSION = "v6-failure-reasons@1";
const FAILURE_REASON_POLICY_VERSION = "v6-failure-reason-policy@1";
const SELF_IMPROVEMENT_REPORT_VERSION = "v6-self-improvement@1";
const EVOLUTION_CANDIDATE_REPORT_VERSION = "v6-evolution-candidates@1";
const PROMPT_EXPERIMENT_VERSION = "v6-prompt-experiment@1";
const PROMPT_STRATEGY_MIN_CANDIDATE_EVENTS = 3;
const PROMPT_STRATEGY_MIN_RELIABLE_EVENTS = 8;
const PROMPT_EXPERIMENT_MIN_COMPARABLE_EVENTS = 3;
const PILOT_OUTCOME_REPORT_VERSION = "v6-pilot-outcome-readiness@1";
const SUCCESSFUL_OUTCOME_LABELS = new Set(["success", "accepted", "completed", "pass", "resolved", "saved", "useful"]);
const FAILED_OUTCOME_LABELS = new Set(["failed", "failure", "rejected", "needs-work", "bad", "blocked", "not-useful"]);
const QUALITY_LIFT_SEGMENT_DIMENSIONS = Object.freeze(["tool", "site", "taskScenario", "mode"]);
const FAILURE_REASON_TOKENS = Object.freeze([
  "too_long",
  "wrong_format",
  "not_actionable",
  "missing_context",
  "too_vague",
  "unsafe_or_privacy",
  "insert_failed",
  "tool_mismatch",
  "token_waste",
  "low_quality",
  "other"
]);
const FAILURE_REASON_TOKEN_SET = new Set(FAILURE_REASON_TOKENS);
const FAILURE_REASON_DIRECTIVES = Object.freeze({
  too_long: {
    key: "shorten_prompt",
    directive: "Shorten the next prompt: keep sections compact, remove repetitive prose, and prefer concise bullets."
  },
  wrong_format: {
    key: "strengthen_output_format",
    directive: "Strengthen the output format: state the required structure, fields, and response shape explicitly."
  },
  not_actionable: {
    key: "make_prompt_actionable",
    directive: "Make the prompt more actionable: include concrete steps, deliverables, and acceptance criteria."
  },
  missing_context: {
    key: "add_missing_context_questions",
    directive: "Ask for the smallest missing context first, then provide a usable prompt with clear assumptions."
  },
  too_vague: {
    key: "clarify_goal_scope",
    directive: "Clarify the goal and scope before expanding the prompt; avoid broad or ambiguous instructions."
  },
  unsafe_or_privacy: {
    key: "tighten_privacy_boundary",
    directive: "Tighten privacy and safety boundaries: avoid page-body assumptions, secrets, credentials, and auto-submit instructions."
  },
  insert_failed: {
    key: "reduce_insert_fragility",
    directive: "Reduce insert fragility: use plain text, compact sections, no huge tables, and no fragile markup."
  },
  tool_mismatch: {
    key: "adapt_to_tool",
    directive: "Adapt to the current tool: keep tool-specific constraints explicit and avoid assumptions from other AI sites."
  },
  token_waste: {
    key: "reduce_token_waste",
    directive: "Reduce token waste: remove repeated context, keep only decision-relevant details, and preserve clear acceptance criteria."
  },
  low_quality: {
    key: "raise_acceptance_criteria",
    directive: "Raise prompt quality criteria: make the result testable, reviewable, and easy to judge after insertion."
  },
  other: {
    key: "review_failure_pattern",
    directive: "Review repeated failure patterns and keep the next prompt conservative, concise, and verifiable."
  }
});

const STRUCTURED_OUTPUT_KEYS = Object.freeze([
  "finalPrompt",
  "whyThisWorks",
  "suggestedSkills",
  "missingInfo",
  "privacyNotes"
]);

const TASK_SCENARIO_RULES = Object.freeze([
  {
    id: "security-review",
    patterns: [
      /\b(security|privacy|auth|authentication|authorization|permission|injection|xss|csrf|secret|token|credential|threat)\b/i,
      /\u5b89\u5168|\u9690\u79c1|\u6743\u9650|\u6ce8\u5165|\u5bc6\u94a5|\u51ed\u636e/u
    ]
  },
  {
    id: "test-plan",
    patterns: [
      /\b(test|qa|acceptance|regression|coverage|e2e|unit|integration|flaky)\b/i,
      /\u6d4b\u8bd5|\u9a8c\u6536|\u56de\u5f52|\u8986\u76d6/u
    ]
  },
  {
    id: "code-review",
    patterns: [
      /\b(code|review|refactor|bug|patch|diff|api|endpoint|module|repo|pull request|pr)\b/i,
      /\u4ee3\u7801|\u91cd\u6784|\u4fee\u590d|\u63a5\u53e3|\u4ed3\u5e93/u
    ]
  },
  {
    id: "ui-ux",
    patterns: [
      /\b(ui|ux|design|layout|component|responsive|frontend|screen|interaction|visual)\b/i,
      /\u754c\u9762|\u8bbe\u8ba1|\u5e03\u5c40|\u4ea4\u4e92|\u89c6\u89c9/u
    ]
  },
  {
    id: "release-ops",
    patterns: [
      /\b(release|deploy|installer|checksum|beta|tag|publish|sidecar|diagnostic|crash|port)\b/i,
      /\u53d1\u5e03|\u5b89\u88c5|\u6253\u5305|\u8bca\u65ad|\u5d29\u6e83/u
    ]
  },
  {
    id: "data-analysis",
    patterns: [
      /\b(metric|analytics|dashboard|report|kpi|cohort|funnel|dataset|sql)\b/i,
      /\u6307\u6807|\u6570\u636e|\u62a5\u8868|\u4eea\u8868|\u5206\u6790/u
    ]
  },
  {
    id: "prompt-engineering",
    patterns: [
      /\b(prompt|skill|adapter|llm|model|agent|copilot|extension)\b/i,
      /\u63d0\u793a\u8bcd|\u6a21\u578b|\u63d2\u4ef6|\u6269\u5c55/u
    ]
  },
  {
    id: "product-idea",
    patterns: [
      /\b(prd|product|idea|roadmap|user story|prototype|mvp|feature)\b/i,
      /\u4ea7\u54c1|\u9700\u6c42|\u539f\u578b|\u529f\u80fd|\u7528\u6237/u
    ]
  }
]);

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function safeToken(value, fallback = "unknown", limit = 80) {
  const token = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:+-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, limit);
  return token || fallback;
}

function taskScenarioFromContext(context = {}, fallback = "") {
  return safeToken(context.taskScenario || context.task_scenario || context.scenario || "", fallback, 80);
}

function isTaskOutcomeMetric(event = {}) {
  return event.action === "outcome" || event.action === "task_outcome";
}

function isSuccessfulTaskOutcome(event = {}) {
  if (!isTaskOutcomeMetric(event)) return false;
  const label = safeToken(event.outcomeLabel || event.outcome_label || event.outcome || event.result || "", "", 80);
  if (FAILED_OUTCOME_LABELS.has(label)) return false;
  if (SUCCESSFUL_OUTCOME_LABELS.has(label)) return true;
  return Boolean(event.ok || event.adopted || event.outcomeVerified || event.outcome_verified);
}

function inferTaskScenario(input = "", context = {}) {
  const explicit = taskScenarioFromContext(context, "");
  if (explicit) return explicit;
  const contextSkills = Array.isArray(context.skills)
    ? context.skills.map((skill) => `${skill.name || skill} ${(skill.tags || []).join(" ")}`).join(" ")
    : "";
  const text = normalizeText([
    input,
    context.intent,
    context.mode,
    context.tool,
    context.host,
    context.inputKind,
    context.adapterId || context.adapter_id || context.siteAdapterId,
    contextSkills
  ].filter(Boolean).join(" ")).toLowerCase();
  const matched = TASK_SCENARIO_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)));
  return matched ? matched.id : "general";
}

function toArray(value, limit = 5) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).slice(0, limit);
  }
  const text = normalizeText(value);
  return text ? [text].slice(0, limit) : [];
}

function stripJsonFence(value) {
  const text = normalizeText(value);
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function parseJsonObject(value) {
  const text = stripJsonFence(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function fallbackSkillNames(card = {}) {
  return (card.skills || []).map((skill) => skill.name).filter(Boolean).slice(0, 3);
}

function parseStructuredLlmResponse(raw, card = {}) {
  const text = normalizeText(raw);
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return {
      schemaVersion: QUALITY_SCHEMA_VERSION,
      structured: false,
      rawFormat: "text",
      finalPrompt: text,
      whyThisWorks: [],
      suggestedSkills: fallbackSkillNames(card),
      missingInfo: [],
      privacyNotes: ["No full page body was required for this generation."]
    };
  }

  const finalPrompt = normalizeText(parsed.finalPrompt || parsed.prompt || parsed.final_prompt || text);
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    structured: true,
    rawFormat: "json",
    finalPrompt,
    whyThisWorks: toArray(parsed.whyThisWorks || parsed.why || parsed.rationale, 5),
    suggestedSkills: toArray(parsed.suggestedSkills || parsed.skills || fallbackSkillNames(card), 3),
    missingInfo: toArray(parsed.missingInfo || parsed.missing_info || parsed.questions, 5),
    privacyNotes: toArray(parsed.privacyNotes || parsed.privacy_notes || parsed.privacy, 5)
  };
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

const COMMON_PATTERNS = Object.freeze({
  goal: [/\bgoal\b/i, /\bobjective\b/i, /\btarget\b/i, /目标/u],
  context: [/\bcontext\b/i, /\bbackground\b/i, /\bknown information\b/i, /背景|上下文|已知/u],
  tasks: [/\btasks?\b/i, /\bsteps?\b/i, /\bdo\b/i, /\bdeliverables?\b/i, /任务|步骤|交付/u],
  constraints: [/\bconstraints?\b/i, /\bdo not\b/i, /\bmust not\b/i, /\bout of scope\b/i, /约束|不要|不得/u],
  outputFormat: [/\boutput format\b/i, /\bformat\b/i, /\breturn\b/i, /\brespond with\b/i, /输出格式|格式/u],
  acceptance: [/\bacceptance criteria\b/i, /\bverification\b/i, /\btests? pass\b/i, /\bsuccess criteria\b/i, /验收|验证|通过/u],
  options: [/\b3\b.*\b(option|direction|approach|alternative)s?\b/i, /\bthree\b.*\b(direction|option|approach)s?\b/i, /3 .*方向/u],
  recommended: [/\brecommend/i, /\bbest\b/i, /推荐/u],
  missingInfo: [/\bmissing\b/i, /\bneed from\b/i, /\bquestions?\b/i, /\bclarif/i, /补充|确认|问题/u],
  privacy: [/\bprivacy\b/i, /\bno full page\b/i, /\bdo not upload\b/i, /\bauto-submit\b/i, /隐私|不上传|不自动/u]
});
