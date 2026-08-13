const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  DEFAULT_SKILLS,
  buildCard,
  buildLlmMessages
} = require("../packages/shared/smart-prompt-core");
const {
  QUALITY_SCHEMA_VERSION,
  STRUCTURED_OUTPUT_KEYS,
  buildEvolutionCandidateReport,
  buildFailureReasonPolicy,
  buildFailureReasonReport,
  buildExperimentOutcomeReport,
  buildFeedbackProfile,
  buildFeedbackSummary,
  buildPilotOutcomeReadinessReport,
  buildPromptQualityLiftReport,
  buildPromptQualityLiftSegmentsReport,
  buildPromptStrategyPlan,
  buildQualityExperiment,
  buildQualityLiftSegmentPolicy,
  buildSelfImprovementReport,
  buildStrategyExperimentAssignment,
  buildStrategyInsights,
  buildStrategyWeightPolicy,
  buildTaskOutcomeReport,
  formatExperimentOutcomeReport,
  formatEvolutionCandidateReport,
  formatFailureReasonPolicy,
  formatFailureReasonReport,
  formatFeedbackProfile,
  formatFeedbackSummary,
  formatPromptQualityLiftReport,
  formatPromptQualityLiftSegmentsReport,
  formatQualityLiftSegmentPolicy,
  formatSelfImprovementReport,
  formatPromptStrategyPlan,
  formatStrategyInsights,
  formatStrategyWeightPolicy,
  formatTaskOutcomeReport,
  inferTaskScenario,
  normalizeFailureReasonToken,
  parseStructuredLlmResponse,
  scorePromptQuality
} = require("../packages/shared/prompt-quality");

const root = path.resolve(__dirname, "..");
const fixturesPath = path.join(root, "research", "v6-prompt-quality-fixtures.json");
const reportPath = process.env.SMART_PROMPT_V6_REPORT || path.join(root, "research", "v6-prompt-quality.latest.json");

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function loadFixtures() {
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
  if (!Array.isArray(fixtures) || fixtures.length < 30) {
    throw new Error("V6 prompt quality fixture set must contain at least 30 cases.");
  }
  return fixtures;
}

function createMetrics(adapterId) {
  return {
    eventCount: 9,
    insertSuccessRate: 0.66,
    saveRate: 0.44,
    retryUsageRate: 0.33,
    undoUsageRate: 0.11,
    adapterFailureRate: 0.34,
    failureReasons: {
      after_write_mismatch: 2,
      user_retry_requested: 1
    },
    byAdapter: {
      [adapterId || "unknown"]: {
        events: 4,
        insertAttempts: 3,
        verifiedInserts: 2,
        failures: 1
      }
    }
  };
}

function createStrategyMetrics(adapterId) {
  const metrics = createMetrics(adapterId);
  metrics.eventCount = 18;
  metrics.insertSuccessRate = 0.9;
  metrics.saveRate = 0.55;
  metrics.retryUsageRate = 0.05;
  metrics.undoUsageRate = 0.02;
  metrics.adapterFailureRate = 0.05;
  metrics.failureReasons = {};
  metrics.byStrategy = {
    "llm:continue:medium:reuse-friendly": {
      events: 12,
      cardReady: 4,
      insertAttempts: 4,
      verifiedInserts: 4,
      saves: 3,
      retries: 0,
      undos: 0,
      failures: 0,
      avgQualityScore: 0.91,
      insertSuccessRate: 1,
      saveRate: 0.75,
      retryUsageRate: 0,
      undoUsageRate: 0,
      modes: { continue: 12 },
      tools: { chatgpt: 12 },
      adapters: { chatgpt: 12 },
      sites: { "chatgpt.com": 12 },
      scenarios: { general: 12 }
    },
    "template-fallback:continue:medium:adapter-risk": {
      events: 6,
      cardReady: 3,
      insertAttempts: 3,
      verifiedInserts: 1,
      saves: 0,
      retries: 2,
      undos: 1,
      failures: 2,
      avgQualityScore: 0.72,
      insertSuccessRate: 0.33,
      saveRate: 0,
      retryUsageRate: 0.67,
      undoUsageRate: 0.33,
      modes: { continue: 6 },
      tools: { chatgpt: 6 },
      adapters: { chatgpt: 6 },
      sites: { "chatgpt.com": 6 },
      scenarios: { general: 6 }
    }
  };
  return metrics;
}

function createLowSampleStrategyMetrics(adapterId) {
  const metrics = createMetrics(adapterId);
  metrics.eventCount = 5;
  metrics.insertSuccessRate = 1;
  metrics.saveRate = 0.75;
  metrics.retryUsageRate = 0;
  metrics.undoUsageRate = 0;
  metrics.adapterFailureRate = 0;
  metrics.failureReasons = {};
  metrics.byStrategy = {
    "llm:continue:medium:too-early-winner": {
      events: 4,
      cardReady: 2,
      insertAttempts: 2,
      verifiedInserts: 2,
      saves: 2,
      retries: 0,
      undos: 0,
      failures: 0,
      avgQualityScore: 0.95,
      insertSuccessRate: 1,
      saveRate: 1,
      retryUsageRate: 0,
      undoUsageRate: 0,
      modes: { continue: 4 },
      tools: { claude: 4 },
      adapters: { claude: 4 },
      sites: { "claude.ai": 4 }
    }
  };
  return metrics;
}

function hasExpectedSkill(card, expectedSkills) {
  if (!Array.isArray(expectedSkills) || expectedSkills.length === 0) return true;
  const names = new Set((card.skills || []).map((skill) => skill.name));
  return expectedSkills.some((name) => names.has(name));
}

function runStructuredResponseProbe() {
  const sample = {
    finalPrompt: [
      "Goal: Review the local service prompt-generation path.",
      "Context: Smart Prompt needs structured JSON output and quality scoring.",
      "Tasks: inspect parsing, fallback, metrics, and tests.",
      "Constraints: do not upload full page content and do not auto-submit.",
      "Output format: findings, patch summary, and verification commands.",
      "Acceptance criteria: tests pass and malformed JSON falls back safely."
    ].join("\n"),
    whyThisWorks: ["It separates execution instructions from acceptance checks."],
    suggestedSkills: ["code-review", "test-plan"],
    missingInfo: ["Which provider should be used in production?"],
    privacyNotes: ["No full page body is required."]
  };
  const parsed = parseStructuredLlmResponse(JSON.stringify(sample), {
    mode: "continue",
    skills: DEFAULT_SKILLS
  });
  const quality = scorePromptQuality(parsed.finalPrompt, {
    mode: "continue",
    skills: DEFAULT_SKILLS,
    minScore: 0.72
  });
  return {
    structured: parsed.structured === true,
    keysPresent: STRUCTURED_OUTPUT_KEYS.every((key) => Object.hasOwn(parsed, key)),
    qualityPass: quality.pass,
    qualityScore: quality.score,
    promptLength: parsed.finalPrompt.length
  };
}

function runFeedbackProfileProbe() {
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt"
  };
  const metrics = createMetrics("chatgpt");
  metrics.eventCount = 12;
  metrics.saveRate = 0.08;
  metrics.retryUsageRate = 0.75;
  metrics.undoUsageRate = 0.3;
  metrics.adapterFailureRate = 0.5;
  const summary = buildFeedbackSummary(metrics, context);
  const profile = buildFeedbackProfile(metrics, context);
  const profileText = formatFeedbackProfile(profile);
  const card = buildCard("Build a CRM with customer list and follow-up notes.", {
    ...context,
    feedbackSummary: summary,
    feedbackSummaryText: formatFeedbackSummary(summary),
    feedbackProfile: profile,
    feedbackProfileText: profileText
  }, [], 0);
  const directiveKeys = new Set(profile.directives.map((item) => item.key));
  return {
    schemaVersion: profile.schemaVersion,
    confidence: profile.confidence,
    hasAdaptiveDirectives: directiveKeys.has("reduce_retry") && directiveKeys.has("reduce_undo") && directiveKeys.has("after_write_mismatch"),
    promptIncludesGuidance: /Local feedback guidance/.test(card.prompt) && /reduce_retry/.test(card.prompt),
    profileTextRedacted: !profileText.includes("Build a CRM") && !profileText.includes("customer list"),
    directiveCount: profile.directives.length
  };
}

function runQualityExperimentProbe() {
  const context = {
    mode: "continue",
    tool: "Claude",
    host: "claude.ai",
    inputKind: "contenteditable",
    adapterId: "claude"
  };
  const metrics = createMetrics("claude");
  metrics.eventCount = 10;
  metrics.retryUsageRate = 0.5;
  metrics.failureReasons.after_write_mismatch = 1;
  const profile = buildFeedbackProfile(metrics, context);
  const profileText = formatFeedbackProfile(profile);
  const card = buildCard("Build a CRM with customer list and follow-up notes.", {
    ...context,
    feedbackProfile: profile,
    feedbackProfileText: profileText
  }, [], 0);
  card.generatedBy = "llm";
  card.quality = scorePromptQuality(card.prompt, {
    mode: card.mode,
    skills: card.skills
  });
  const experiment = buildQualityExperiment(card, profile, {
    generationId: "generation-fixture-1"
  });
  const serialized = JSON.stringify(experiment);
  return {
    schemaVersion: experiment.schemaVersion,
    hasGenerationId: experiment.generationId === "generation-fixture-1",
    hasStrategyId: /llm:continue:medium/.test(experiment.strategyId),
    carriesQualityScore: experiment.qualityScore === card.quality.score,
    linksFeedbackDirectives: experiment.directiveKeys.includes("reduce_retry") && experiment.directiveKeys.includes("after_write_mismatch"),
    experimentTextRedacted: !serialized.includes("Build a CRM") && !serialized.includes("customer list")
  };
}

function runPromptStrategyProbe() {
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt"
  };
  const metrics = createStrategyMetrics("chatgpt");
  const profile = buildFeedbackProfile(metrics, context);
  const plan = buildPromptStrategyPlan(metrics, context, profile);
  const planText = formatPromptStrategyPlan(plan);
  const card = buildCard("Build a CRM with customer list and follow-up notes.", {
    ...context,
    feedbackProfile: profile,
    feedbackProfileText: formatFeedbackProfile(profile),
    promptStrategyPlan: plan,
    promptStrategyText: planText
  }, [], 0);
  card.generatedBy = "llm";
  card.promptStrategyPlan = plan;
  card.quality = scorePromptQuality(card.prompt, {
    mode: card.mode,
    skills: card.skills
  });
  const experiment = buildQualityExperiment(card, profile, {
    generationId: "generation-strategy-1",
    promptStrategyId: plan.selectedStrategy.id
  });
  return {
    schemaVersion: plan.schemaVersion,
    policyVersion: plan.strategyPolicy.version,
    selectedStrategy: plan.selectedStrategy.id,
    selectedStrategyVersion: plan.selectedStrategy.version,
    selectedDecision: plan.selectedStrategy.decision,
    hasWinningCandidate: plan.candidateStrategies[0]?.strategyId === "llm:continue:medium:reuse-friendly",
    winningCandidateReliable: plan.candidateStrategies[0]?.reliable === true,
    winningCandidateCohortMatched: plan.candidateStrategies[0]?.cohort?.matchesMode === true
      && plan.candidateStrategies[0]?.cohort?.matchesTool === true
      && plan.candidateStrategies[0]?.cohort?.matchesAdapter === true,
    hasAvoidRiskDirective: plan.directives.some((item) => item.key === "avoid_risky_strategy"),
    promptIncludesStrategyPlan: /Local strategy plan/.test(card.prompt) && /preserve_winning_strategy/.test(card.prompt),
    experimentUsesStrategy: experiment.promptStrategyId === "preserve_winning_strategy"
      && experiment.promptStrategyVersion === "v6-strategy-policy-3"
      && /preserve_winning_strategy/.test(experiment.strategyId),
    strategyTextRedacted: !planText.includes("Build a CRM") && !planText.includes("customer list")
  };
}

function runStrategyExplorationProbe() {
  const context = {
    mode: "continue",
    tool: "Claude",
    host: "claude.ai",
    inputKind: "contenteditable",
    adapterId: "claude"
  };
  const metrics = createLowSampleStrategyMetrics("claude");
  const profile = buildFeedbackProfile(metrics, context);
  const plan = buildPromptStrategyPlan(metrics, context, profile);
  const planText = formatPromptStrategyPlan(plan);
  const candidate = plan.candidateStrategies[0] || {};
  const card = buildCard("Build a CRM with customer list and follow-up notes.", {
    ...context,
    promptStrategyPlan: plan,
    promptStrategyText: planText
  }, [], 0);
  card.generatedBy = "llm";
  card.promptStrategyPlan = plan;
  card.quality = scorePromptQuality(card.prompt, {
    mode: card.mode,
    skills: card.skills
  });
  const experiment = buildQualityExperiment(card, profile, {
    generationId: "generation-explore-1",
    promptStrategyId: plan.selectedStrategy.id,
    promptStrategyVersion: plan.selectedStrategy.version
  });
  return {
    policyVersion: plan.strategyPolicy.version,
    selectedStrategy: plan.selectedStrategy.id,
    selectedDecision: plan.selectedStrategy.decision,
    lowSampleCandidate: candidate.strategyId === "llm:continue:medium:too-early-winner",
    lowSampleNotReliable: candidate.reliable === false,
    explorationEnabled: plan.exploration.enabled === true,
    explorationCandidate: plan.exploration.candidateStrategyId === "llm:continue:medium:too-early-winner",
    hasSampleGuardDirective: plan.directives.some((item) => item.key === "collect_more_samples"),
    promptIncludesExplorationPolicy: /Local strategy plan/.test(card.prompt) && /explore=true/.test(card.prompt),
    experimentCarriesVersion: experiment.promptStrategyVersion === "v6-strategy-policy-3",
    strategyTextRedacted: !planText.includes("Build a CRM") && !planText.includes("customer list")
  };
}

function runStrategyInsightsProbe() {
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt"
  };
  const metrics = createStrategyMetrics("chatgpt");
  metrics.eventCount = 22;
  metrics.byStrategy["llm:continue:medium:promising-new-shape"] = {
    events: 4,
    cardReady: 2,
    insertAttempts: 2,
    verifiedInserts: 2,
    saves: 2,
    retries: 0,
    undos: 0,
    failures: 0,
    avgQualityScore: 0.96,
    insertSuccessRate: 1,
    saveRate: 1,
    retryUsageRate: 0,
    undoUsageRate: 0,
    modes: { continue: 4 },
    tools: { chatgpt: 4 },
    adapters: { chatgpt: 4 },
    sites: { "chatgpt.com": 4 }
  };
  const insights = buildStrategyInsights(metrics, context);
  const insightsText = formatStrategyInsights(insights);
  const card = buildCard("Build a CRM with customer list and follow-up notes.", {
    ...context,
    strategyInsights: insights,
    strategyInsightsText: insightsText
  }, [], 0);
  return {
    schemaVersion: insights.schemaVersion,
    insightVersion: insights.insightVersion,
    policyVersion: insights.strategyPolicy.version,
    readinessStatus: insights.readiness.status,
    hasReliableWinner: insights.topStrategies.some((item) => item.strategyId === "llm:continue:medium:reuse-friendly" && item.reliable === true),
    hasLowSampleCandidate: insights.lowSampleCandidates.some((item) => item.strategyId === "llm:continue:medium:promising-new-shape" && item.reliable === false),
    hasRiskSignal: insights.riskSignals.some((item) => item.strategyId === "template-fallback:continue:medium:adapter-risk"),
    hasModeToolAdapterSiteCohorts: insights.cohorts.modes.some((item) => item.key === "continue")
      && insights.cohorts.tools.some((item) => item.key === "chatgpt")
      && insights.cohorts.adapters.some((item) => item.key === "chatgpt")
      && insights.cohorts.sites.some((item) => item.key === "chatgpt.com"),
    hasRecommendations: insights.recommendations.some((item) => item.key === "preserve_reliable_winner")
      && insights.recommendations.some((item) => item.key === "explore_promising_strategy")
      && insights.recommendations.some((item) => item.key === "avoid_risky_strategy"),
    promptIncludesStrategyInsights: /Local strategy insights/.test(card.prompt) && /v6-strategy-insights/.test(JSON.stringify(insights)),
    insightTextMentionsSamples: /reliable=/.test(insightsText) && /Samples=|sample/i.test(insightsText),
    insightsTextRedacted: !insightsText.includes("Build a CRM") && !insightsText.includes("customer list"),
    privacyAggregateOnly: insights.privacy.derivedFromAggregateStrategyMetrics === true && insights.privacy.inputTextNotStored === true
  };
}

function runExperimentOutcomeProbe() {
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt"
  };
  const metrics = createStrategyMetrics("chatgpt");
  const profile = buildFeedbackProfile(metrics, context);
  const plan = buildPromptStrategyPlan(metrics, context, profile);
  const insights = buildStrategyInsights(metrics, context);
  const assignment = buildStrategyExperimentAssignment(context, plan, insights, {
    generationId: "generation-experiment-1",
    forceArm: "strategy_guided"
  });
  const card = buildCard("Build a CRM with customer list and follow-up notes.", {
    ...context,
    promptStrategyPlan: plan,
    promptStrategyText: formatPromptStrategyPlan(plan),
    strategyInsights: insights,
    strategyInsightsText: formatStrategyInsights(insights)
  }, [], 0);
  card.generatedBy = "llm";
  card.promptStrategyPlan = plan;
  card.strategyInsights = insights;
  card.experimentAssignment = assignment;
  card.quality = scorePromptQuality(card.prompt, {
    mode: card.mode,
    skills: card.skills
  });
  const experiment = buildQualityExperiment(card, profile, {
    generationId: "generation-experiment-1",
    promptStrategyId: assignment.assignedStrategyId,
    promptStrategyVersion: plan.selectedStrategy.version,
    experimentAssignment: assignment,
    strategyInsightsVersion: insights.insightVersion,
    strategyReadiness: insights.readiness.status
  });
  const outcomeMetrics = {
    eventCount: 12,
    byExperimentArm: {
      baseline_structure: {
        events: 6,
        cardReady: 3,
        insertAttempts: 3,
        verifiedInserts: 2,
        saves: 1,
        retries: 1,
        undos: 1,
        failures: 1,
        avgQualityScore: 0.78,
        avgPromptLength: 820,
        insertSuccessRate: 0.667,
        saveRate: 0.333,
        retryUsageRate: 0.333,
        undoUsageRate: 0.333,
        promptStrategyIds: { baseline_structure: 6 },
        promptStrategyVersions: { "v6-strategy-policy-3": 6 },
        experimentVersions: { "v6-prompt-experiment-1": 6 },
        experimentComparisonKeys: { "v6-prompt-experiment-1-continue-chatgpt": 6 },
        strategyReadiness: { ready: 6 }
      },
      strategy_guided: {
        events: 6,
        cardReady: 3,
        insertAttempts: 3,
        verifiedInserts: 3,
        saves: 2,
        retries: 0,
        undos: 0,
        failures: 0,
        avgQualityScore: 0.91,
        avgPromptLength: 930,
        insertSuccessRate: 1,
        saveRate: 0.667,
        retryUsageRate: 0,
        undoUsageRate: 0,
        promptStrategyIds: { preserve_winning_strategy: 6 },
        promptStrategyVersions: { "v6-strategy-policy-3": 6 },
        experimentVersions: { "v6-prompt-experiment-1": 6 },
        experimentComparisonKeys: { "v6-prompt-experiment-1-continue-chatgpt": 6 },
        strategyReadiness: { ready: 6 }
      }
    }
  };
  const outcomeReport = buildExperimentOutcomeReport(outcomeMetrics, context);
  const outcomeText = formatExperimentOutcomeReport(outcomeReport);
  const serialized = JSON.stringify({ assignment, experiment, outcomeReport, outcomeText });
  const comparison = outcomeReport.comparisons[0] || {};
  return {
    assignmentVersion: assignment.experimentVersion,
    assignmentArm: assignment.arm,
    assignmentEligible: assignment.eligible,
    assignmentHasBucket: Number.isFinite(assignment.bucket),
    assignmentHasComparisonKey: Boolean(assignment.comparisonKey),
    experimentVersion: experiment.experimentVersion,
    experimentArm: experiment.experimentArm,
    experimentCarriesComparisonKey: Boolean(experiment.experimentComparisonKey),
    experimentCarriesStrategyInsights: experiment.strategyInsightsVersion === "v6-strategy-insights-1",
    outcomeVersion: outcomeReport.experimentVersion,
    outcomeReadiness: outcomeReport.readiness.status,
    outcomeComparable: outcomeReport.readiness.comparable,
    hasBaselineArm: outcomeReport.arms.some((item) => item.arm === "baseline_structure"),
    hasStrategyGuidedArm: outcomeReport.arms.some((item) => item.arm === "strategy_guided"),
    comparisonReady: comparison.status === "ready",
    comparisonShowsGuidedLift: Number(comparison.deltas?.insertSuccessRate || 0) > 0
      && Number(comparison.deltas?.saveRate || 0) > 0
      && Number(comparison.deltas?.retryUsageRate || 0) < 0,
    hasOutcomeRecommendation: outcomeReport.recommendations.some((item) => item.key === "prefer_strategy_guided"),
    outcomeTextRedacted: !serialized.includes("Build a CRM") && !serialized.includes("customer list"),
    privacyAggregateOnly: outcomeReport.privacy.derivedFromAggregateExperimentMetrics === true && outcomeReport.privacy.aggregateOnly === true
  };
}

function buildOutcomeMetrics(strategyGuidedWins = true) {
  return {
    ...createStrategyMetrics("chatgpt"),
    eventCount: 24,
    byExperimentArm: {
      baseline_structure: {
        events: 8,
        cardReady: 4,
        insertAttempts: 4,
        verifiedInserts: strategyGuidedWins ? 3 : 4,
        saves: strategyGuidedWins ? 1 : 3,
        retries: strategyGuidedWins ? 1 : 0,
        undos: strategyGuidedWins ? 1 : 0,
        failures: strategyGuidedWins ? 1 : 0,
        avgQualityScore: strategyGuidedWins ? 0.78 : 0.9,
        avgPromptLength: 820,
        promptStrategyIds: { baseline_structure: 8 },
        promptStrategyVersions: { "v6-strategy-policy-3": 8 },
        experimentVersions: { "v6-prompt-experiment-1": 8 },
        experimentComparisonKeys: { "v6-prompt-experiment-1-continue-chatgpt": 8 },
        strategyReadiness: { ready: 8 }
      },
      strategy_guided: {
        events: 8,
        cardReady: 4,
        insertAttempts: 4,
        verifiedInserts: strategyGuidedWins ? 4 : 2,
        saves: strategyGuidedWins ? 3 : 1,
        retries: strategyGuidedWins ? 0 : 2,
        undos: strategyGuidedWins ? 0 : 1,
        failures: strategyGuidedWins ? 0 : 2,
        avgQualityScore: strategyGuidedWins ? 0.92 : 0.72,
        avgPromptLength: 930,
        promptStrategyIds: { preserve_winning_strategy: 8 },
        promptStrategyVersions: { "v6-strategy-policy-3": 8 },
        experimentVersions: { "v6-prompt-experiment-1": 8 },
        experimentComparisonKeys: { "v6-prompt-experiment-1-continue-chatgpt": 8 },
        strategyReadiness: { ready: 8 }
      }
    }
  };
}

function createScenarioLearningMetrics() {
  const securityStrategy = {
    events: 12,
    cardReady: 6,
    insertAttempts: 6,
    verifiedInserts: 6,
    saves: 5,
    retries: 0,
    undos: 0,
    failures: 0,
    avgQualityScore: 0.94,
    avgPromptLength: 980,
    insertSuccessRate: 1,
    saveRate: 0.833,
    retryUsageRate: 0,
    undoUsageRate: 0,
    modes: { continue: 12 },
    tools: { chatgpt: 12 },
    adapters: { chatgpt: 12 },
    sites: { "chatgpt.com": 12 },
    scenarios: { "security-review": 12 }
  };
  const uiStrategy = {
    events: 14,
    cardReady: 7,
    insertAttempts: 7,
    verifiedInserts: 7,
    saves: 7,
    retries: 0,
    undos: 0,
    failures: 0,
    avgQualityScore: 0.96,
    avgPromptLength: 900,
    insertSuccessRate: 1,
    saveRate: 1,
    retryUsageRate: 0,
    undoUsageRate: 0,
    modes: { continue: 14 },
    tools: { chatgpt: 14 },
    adapters: { chatgpt: 14 },
    sites: { "chatgpt.com": 14 },
    scenarios: { "ui-ux": 14 }
  };
  return {
    eventCount: 34,
    insertSuccessRate: 0.92,
    saveRate: 0.7,
    retryUsageRate: 0.05,
    undoUsageRate: 0,
    adapterFailureRate: 0.05,
    failureReasons: {},
    byAdapter: {
      chatgpt: {
        events: 20,
        insertAttempts: 10,
        verifiedInserts: 9,
        failures: 1
      }
    },
    byScenario: {
      "security-review": {
        events: 20,
        cardReady: 10,
        insertAttempts: 10,
        verifiedInserts: 9,
        saves: 7,
        retries: 1,
        undos: 0,
        failures: 1,
        avgQualityScore: 0.91,
        avgPromptLength: 960,
        insertSuccessRate: 0.9,
        saveRate: 0.7,
        retryUsageRate: 0.1,
        undoUsageRate: 0,
        scenarios: { "security-review": 20 }
      }
    },
    byStrategy: {
      "llm:continue:medium:security-review-structure": securityStrategy,
      "llm:continue:medium:ui-ux-structure": uiStrategy
    },
    byScenarioStrategy: {
      "security-review": {
        "llm:continue:medium:security-review-structure": securityStrategy
      }
    },
    byExperimentArm: {},
    byScenarioExperimentArm: {
      "security-review": {
        baseline_structure: {
          events: 6,
          cardReady: 3,
          insertAttempts: 3,
          verifiedInserts: 2,
          saves: 1,
          retries: 1,
          undos: 0,
          failures: 1,
          avgQualityScore: 0.79,
          avgPromptLength: 820,
          promptStrategyIds: { baseline_structure: 6 },
          promptStrategyVersions: { "v6-strategy-policy-3": 6 },
          experimentVersions: { "v6-prompt-experiment-1": 6 },
          experimentComparisonKeys: { "v6-prompt-experiment-1-continue-chatgpt-security-review": 6 },
          strategyReadiness: { ready: 6 },
          scenarios: { "security-review": 6 }
        },
        strategy_guided: {
          events: 6,
          cardReady: 3,
          insertAttempts: 3,
          verifiedInserts: 3,
          saves: 3,
          retries: 0,
          undos: 0,
          failures: 0,
          avgQualityScore: 0.94,
          avgPromptLength: 980,
          promptStrategyIds: { preserve_winning_strategy: 6 },
          promptStrategyVersions: { "v6-strategy-policy-3": 6 },
          experimentVersions: { "v6-prompt-experiment-1": 6 },
          experimentComparisonKeys: { "v6-prompt-experiment-1-continue-chatgpt-security-review": 6 },
          strategyReadiness: { ready: 6 },
          scenarios: { "security-review": 6 }
        }
      }
    }
  };
}

function runScenarioLearningProbe() {
  const input = "Review auth privacy and permission changes for injection risks.";
  const baseContext = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt"
  };
  const taskScenario = inferTaskScenario(input, baseContext);
  const context = { ...baseContext, taskScenario };
  const metrics = createScenarioLearningMetrics();
  const profile = buildFeedbackProfile(metrics, context);
  const insights = buildStrategyInsights(metrics, context);
  const outcome = buildExperimentOutcomeReport(metrics, context);
  const plan = buildPromptStrategyPlan(metrics, context, profile, outcome);
  const assignment = buildStrategyExperimentAssignment(context, plan, insights, {
    generationId: "generation-scenario-1",
    forceArm: "strategy_guided"
  });
  const planText = formatPromptStrategyPlan(plan);
  const insightsText = formatStrategyInsights(insights);
  const outcomeText = formatExperimentOutcomeReport(outcome);
  const card = buildCard(input, {
    ...context,
    feedbackProfile: profile,
    feedbackProfileText: formatFeedbackProfile(profile),
    promptStrategyPlan: plan,
    promptStrategyText: planText,
    strategyInsights: insights,
    strategyInsightsText: insightsText,
    experimentOutcomeReport: outcome,
    experimentOutcomeText: outcomeText
  }, [], 0);
  card.generatedBy = "llm";
  card.promptStrategyPlan = plan;
  card.strategyInsights = insights;
  card.experimentAssignment = assignment;
  card.quality = scorePromptQuality(card.prompt, {
    mode: card.mode,
    skills: card.skills
  });
  const experiment = buildQualityExperiment(card, profile, {
    generationId: "generation-scenario-1",
    taskScenario,
    promptStrategyId: assignment.assignedStrategyId,
    promptStrategyVersion: plan.selectedStrategy.version,
    experimentAssignment: assignment,
    strategyInsightsVersion: insights.insightVersion,
    strategyReadiness: insights.readiness.status
  });
  const serialized = JSON.stringify({ profile, insights, outcome, plan, assignment, experiment, planText, insightsText, outcomeText });
  return {
    inferredScenario: taskScenario,
    feedbackCohortScenario: profile.cohort.taskScenario,
    insightsCohortScenario: insights.cohort.taskScenario,
    outcomeCohortScenario: outcome.cohort.taskScenario,
    assignmentCohortScenario: assignment.cohort.taskScenario,
    experimentTaskScenario: experiment.taskScenario,
    hasScenarioCohorts: insights.cohorts.scenarios.some((item) => item.key === "security-review"),
    scenarioWinnerSelected: plan.selectedStrategy.id === "preserve_winning_strategy"
      && plan.selectedStrategy.sourceStrategyId === "llm:continue:medium:security-review-structure",
    scenarioCandidateMatched: plan.candidateStrategies[0]?.cohort?.matchesScenario === true
      && plan.candidateStrategies[0]?.cohort?.scenarios?.includes("security-review"),
    uiStrategyExcludedFromScenarioSource: !plan.candidateStrategies.some((item) => item.strategyId === "llm:continue:medium:ui-ux-structure"),
    comparisonKeyIncludesScenario: /security-review/.test(assignment.comparisonKey),
    outcomeUsesScenarioArms: outcome.arms.every((item) => item.scenarios.includes("security-review")),
    promptIncludesScenario: /Local task scenario: security-review/.test(card.prompt),
    llmContextScenarioReady: /scenario=security-review/.test(planText)
      && /scenario:security-review/.test(insightsText)
      && /scenario=security-review/.test(outcomeText),
    scenarioTextRedacted: !serialized.includes(input)
      && !serialized.includes("Review auth privacy")
      && !serialized.includes("permission changes")
  };
}

function createTaskOutcomeMetrics() {
  const winner = {
    events: 14,
    cardReady: 6,
    insertAttempts: 6,
    verifiedInserts: 6,
    saves: 5,
    retries: 0,
    undos: 0,
    failures: 0,
    outcomes: 5,
    successfulOutcomes: 5,
    failedOutcomes: 0,
    outcomeSuccessRate: 1,
    avgOutcomeScore: 0.94,
    avgQualityScore: 0.92,
    avgPromptLength: 980,
    insertSuccessRate: 1,
    saveRate: 0.833,
    retryUsageRate: 0,
    undoUsageRate: 0,
    outcomeLabels: { success: 5 },
    modes: { continue: 14 },
    tools: { chatgpt: 14 },
    adapters: { chatgpt: 14 },
    sites: { "chatgpt.com": 14 },
    scenarios: { "security-review": 14 }
  };
  const risk = {
    events: 8,
    cardReady: 4,
    insertAttempts: 4,
    verifiedInserts: 4,
    saves: 1,
    retries: 1,
    undos: 1,
    failures: 0,
    outcomes: 4,
    successfulOutcomes: 1,
    failedOutcomes: 3,
    outcomeSuccessRate: 0.25,
    avgOutcomeScore: 0.36,
    avgQualityScore: 0.82,
    avgPromptLength: 900,
    insertSuccessRate: 1,
    saveRate: 0.25,
    retryUsageRate: 0.25,
    undoUsageRate: 0.25,
    outcomeLabels: { success: 1, "needs-work": 3 },
    modes: { continue: 8 },
    tools: { chatgpt: 8 },
    adapters: { chatgpt: 8 },
    sites: { "chatgpt.com": 8 },
    scenarios: { "security-review": 8 }
  };
  return {
    eventCount: 22,
    insertSuccessRate: 1,
    saveRate: 0.6,
    retryUsageRate: 0.08,
    undoUsageRate: 0.08,
    adapterFailureRate: 0,
    outcomeSuccessRate: 0.667,
    avgOutcomeScore: 0.76,
    failureReasons: {},
    byAdapter: {
      chatgpt: {
        events: 22,
        insertAttempts: 10,
        verifiedInserts: 10,
        failures: 0
      }
    },
    byStrategy: {
      "llm:continue:medium:security-outcome-winner": winner,
      "llm:continue:medium:security-outcome-risk": risk
    },
    byScenario: {
      "security-review": {
        events: 22,
        cardReady: 10,
        insertAttempts: 10,
        verifiedInserts: 10,
        saves: 6,
        retries: 1,
        undos: 1,
        failures: 0,
        outcomes: 9,
        successfulOutcomes: 6,
        failedOutcomes: 3,
        outcomeSuccessRate: 0.667,
        avgOutcomeScore: 0.76,
        avgQualityScore: 0.88,
        avgPromptLength: 940,
        scenarios: { "security-review": 22 }
      }
    },
    byScenarioStrategy: {
      "security-review": {
        "llm:continue:medium:security-outcome-winner": winner,
        "llm:continue:medium:security-outcome-risk": risk
      }
    },
    byExperimentArm: {},
    byScenarioExperimentArm: {}
  };
}

function runTaskOutcomeProbe() {
  const input = "Review auth privacy and permission changes for injection risks.";
  const baseContext = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt"
  };
  const taskScenario = inferTaskScenario(input, baseContext);
  const context = { ...baseContext, taskScenario };
  const metrics = createTaskOutcomeMetrics();
  const profile = buildFeedbackProfile(metrics, context);
  const taskOutcomeReport = buildTaskOutcomeReport(metrics, context);
  const taskOutcomeText = formatTaskOutcomeReport(taskOutcomeReport);
  const plan = buildPromptStrategyPlan(metrics, context, profile, null, taskOutcomeReport);
  const planText = formatPromptStrategyPlan(plan);
  const card = buildCard(input, {
    ...context,
    feedbackProfile: profile,
    feedbackProfileText: formatFeedbackProfile(profile),
    promptStrategyPlan: plan,
    promptStrategyText: planText,
    taskOutcomeReport,
    taskOutcomeText
  }, [], 0);
  const serialized = JSON.stringify({ taskOutcomeReport, plan, planText, taskOutcomeText });
  return {
    reportVersion: taskOutcomeReport.reportVersion,
    readinessStatus: taskOutcomeReport.readiness.status,
    outcomeCount: taskOutcomeReport.readiness.outcomeCount,
    hasOutcomeWinner: taskOutcomeReport.topOutcomeStrategies[0]?.strategyId === "llm:continue:medium:security-outcome-winner",
    hasOutcomeRisk: taskOutcomeReport.topOutcomeStrategies.some((item) => item.strategyId === "llm:continue:medium:security-outcome-risk" && item.outcomeSuccessRate <= 0.35),
    recommendation: taskOutcomeReport.recommendations[0]?.key,
    planPolicyDecision: plan.taskOutcomePolicy.decision,
    planSelectsOutcomeWinner: plan.selectedStrategy.id === "preserve_winning_strategy"
      && plan.selectedStrategy.decision === "task_outcome"
      && plan.selectedStrategy.sourceStrategyId === "llm:continue:medium:security-outcome-winner",
    hasOutcomeDirective: plan.directives.some((item) => item.key === "prefer_task_outcome_winner"),
    promptIncludesTaskOutcomes: /Local task outcomes/.test(card.prompt) && /prefer_task_outcome_winner/.test(planText),
    taskOutcomeTextReady: /taskOutcome=v6-task-outcome@1/.test(taskOutcomeText)
      && /scenario=security-review/.test(taskOutcomeText)
      && /outcomes=9/.test(taskOutcomeText),
    taskOutcomeRedacted: !serialized.includes(input)
      && !serialized.includes("Review auth privacy")
      && !serialized.includes("permission changes"),
    privacyAggregateOnly: taskOutcomeReport.privacy.derivedFromAggregateTaskOutcomes === true
      && taskOutcomeReport.privacy.aggregateOnly === true
  };
}

function createStrategyWeightMetrics() {
  const winnerId = "llm:continue:medium:security-weight-winner";
  const riskId = "llm:continue:medium:security-weight-risk";
  const collectingId = "llm:continue:medium:security-weight-collecting";
  const winner = {
    events: 12,
    cardReady: 4,
    insertAttempts: 4,
    verifiedInserts: 4,
    saves: 4,
    retries: 0,
    undos: 0,
    failures: 0,
    outcomes: 3,
    successfulOutcomes: 3,
    failedOutcomes: 0,
    outcomeSuccessRate: 1,
    avgOutcomeScore: 0.94,
    avgQualityScore: 0.92,
    avgPromptLength: 980,
    insertSuccessRate: 1,
    saveRate: 1,
    retryUsageRate: 0,
    undoUsageRate: 0,
    outcomeLabels: { success: 3 },
    modes: { continue: 12 },
    tools: { chatgpt: 12 },
    adapters: { chatgpt: 12 },
    sites: { "chatgpt.com": 12 },
    scenarios: { "security-review": 12 }
  };
  const risk = {
    events: 9,
    cardReady: 3,
    insertAttempts: 3,
    verifiedInserts: 3,
    saves: 0,
    retries: 2,
    undos: 1,
    failures: 0,
    outcomes: 3,
    successfulOutcomes: 0,
    failedOutcomes: 3,
    outcomeSuccessRate: 0,
    avgOutcomeScore: 0.18,
    avgQualityScore: 0.76,
    avgPromptLength: 1120,
    insertSuccessRate: 1,
    saveRate: 0,
    retryUsageRate: 0.667,
    undoUsageRate: 0.333,
    outcomeLabels: { failed: 2, "needs-work": 1 },
    modes: { continue: 9 },
    tools: { chatgpt: 9 },
    adapters: { chatgpt: 9 },
    sites: { "chatgpt.com": 9 },
    scenarios: { "security-review": 9 }
  };
  const collecting = {
    events: 4,
    cardReady: 2,
    insertAttempts: 1,
    verifiedInserts: 1,
    saves: 1,
    retries: 0,
    undos: 0,
    failures: 0,
    outcomes: 1,
    successfulOutcomes: 1,
    failedOutcomes: 0,
    outcomeSuccessRate: 1,
    avgOutcomeScore: 0.8,
    avgQualityScore: 0.86,
    avgPromptLength: 900,
    insertSuccessRate: 1,
    saveRate: 1,
    retryUsageRate: 0,
    undoUsageRate: 0,
    outcomeLabels: { success: 1 },
    modes: { continue: 4 },
    tools: { chatgpt: 4 },
    adapters: { chatgpt: 4 },
    sites: { "chatgpt.com": 4 },
    scenarios: { "security-review": 4 }
  };
  const eventBase = {
    action: "outcome",
    mode: "continue",
    tool: "ChatGPT",
    adapterId: "chatgpt",
    site: "https://chatgpt.com/private/path?token=SECRET_URL_TOKEN",
    host: "chatgpt.com",
    taskScenario: "security-review",
    experimentArm: "strategy_guided",
    prompt: "SECRET_PROMPT_TEXT",
    input: "SECRET_INPUT_TEXT",
    pageBody: "SECRET_PAGE_BODY"
  };
  const events = [
    ...[0, 1, 2].map((index) => ({ ...eventBase, generationId: `weight-winner-${index}`, strategyId: winnerId, outcomeLabel: "success", outcomeScore: 0.94, outcomeVerified: true, ok: true })),
    ...[0, 1, 2].map((index) => ({ ...eventBase, generationId: `weight-risk-${index}`, strategyId: riskId, outcomeLabel: index === 0 ? "needs-work" : "failed", outcomeScore: 0.18, outcomeVerified: true, ok: false })),
    { ...eventBase, generationId: "weight-collecting-0", strategyId: collectingId, outcomeLabel: "success", outcomeScore: 0.8, outcomeVerified: true, ok: true }
  ];
  return {
    eventCount: 25,
    insertSuccessRate: 1,
    saveRate: 0.7,
    retryUsageRate: 0.08,
    undoUsageRate: 0.04,
    adapterFailureRate: 0,
    outcomeSuccessRate: 0.571,
    avgOutcomeScore: 0.672,
    failureReasons: {},
    events,
    byStrategy: {
      [winnerId]: winner,
      [riskId]: risk,
      [collectingId]: collecting
    },
    byScenarioStrategy: {
      "security-review": {
        [winnerId]: winner,
        [riskId]: risk,
        [collectingId]: collecting
      }
    },
    byExperimentArm: {},
    byScenarioExperimentArm: {}
  };
}

function runStrategyWeightProbe() {
  const input = "Review auth privacy and permission changes for injection risks.";
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    site: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt",
    taskScenario: "security-review"
  };
  const metrics = createStrategyWeightMetrics();
  const profile = buildFeedbackProfile(metrics, context);
  const pilotReport = buildPilotOutcomeReadinessReport(metrics);
  const weightPolicy = buildStrategyWeightPolicy(metrics, context, pilotReport);
  const weightText = formatStrategyWeightPolicy(weightPolicy);
  const emptyTaskOutcome = {
    reportVersion: "v6-task-outcome@1",
    readiness: { status: "collecting", outcomeCount: 0, outcomeSuccessRate: 0, avgOutcomeScore: null },
    recommendations: [],
    topOutcomeStrategies: [],
    privacy: { aggregateOnly: true, derivedFromAggregateTaskOutcomes: true }
  };
  const plan = buildPromptStrategyPlan(metrics, context, profile, null, emptyTaskOutcome, weightPolicy);
  const planText = formatPromptStrategyPlan(plan);
  const cardContext = {
    ...context,
    feedbackProfile: profile,
    feedbackProfileText: formatFeedbackProfile(profile),
    promptStrategyPlan: plan,
    promptStrategyText: planText,
    strategyWeightPolicy: weightPolicy,
    strategyWeightText: weightText
  };
  const card = buildCard(input, cardContext, [], 0);
  const llm = buildLlmMessages(input, cardContext, [], 0);
  const serialized = JSON.stringify({ pilotReport, weightPolicy, weightText, plan, planText, cardPrompt: card.prompt, llmMessages: llm.messages });
  return {
    weightVersion: weightPolicy.weightPolicyVersion,
    pilotVersion: weightPolicy.pilotOutcomeVersion,
    readinessStatus: weightPolicy.readiness.status,
    totalOutcomeEvents: weightPolicy.readiness.totalOutcomeEvents,
    promotedCount: weightPolicy.readiness.promotedStrategyCount,
    suppressedCount: weightPolicy.readiness.suppressedStrategyCount,
    exploringCount: weightPolicy.readiness.exploringStrategyCount,
    selectedPromotion: weightPolicy.selectedPromotion?.strategyId,
    selectedSuppression: weightPolicy.selectedSuppression?.strategyId,
    planPolicyWeightVersion: plan.strategyPolicy.strategyWeightVersion,
    planDecision: plan.selectedStrategy.decision,
    planSelectsWeightedWinner: plan.selectedStrategy.id === "preserve_winning_strategy"
      && plan.selectedStrategy.decision === "outcome_weight"
      && plan.selectedStrategy.sourceStrategyId === "llm:continue:medium:security-weight-winner",
    hasPromotionDirective: plan.directives.some((item) => item.key === "promote_outcome_winner"),
    hasSuppressionDirective: plan.directives.some((item) => item.key === "suppress_outcome_risk"),
    hasExplorationDirective: plan.directives.some((item) => item.key === "continue_outcome_exploration"),
    promptIncludesStrategyWeights: /Local strategy weights/.test(card.prompt) && /promote_outcome_winner/.test(card.prompt),
    llmIncludesStrategyWeights: llm.messages.some((message) => /Local strategy weights/.test(message.content) && /suppress_outcome_risk/.test(message.content)),
    weightTextReady: /strategyWeight=v6-strategy-weighting@1/.test(weightText)
      && /promoted=llm:continue:medium:security-weight-winner/.test(weightText)
      && /suppressed=llm:continue:medium:security-weight-risk/.test(weightText),
    strategyWeightRedacted: !serialized.includes("SECRET_PROMPT_TEXT")
      && !serialized.includes("SECRET_INPUT_TEXT")
      && !serialized.includes("SECRET_PAGE_BODY")
      && !serialized.includes("SECRET_URL_TOKEN")
      && !serialized.includes("private/path"),
    privacyAggregateOnly: weightPolicy.privacy.aggregateOnly === true
      && weightPolicy.privacy.derivedFromAggregatePilotOutcomes === true
  };
}

function createQualityLiftMetrics({ regression = false, collecting = false } = {}) {
  const events = [];
  const eventBase = {
    mode: "continue",
    tool: "ChatGPT",
    adapterId: "chatgpt",
    site: "https://chatgpt.com/private/path?token=SECRET_URL_TOKEN",
    host: "chatgpt.com",
    taskScenario: "security-review",
    prompt: "SECRET_PROMPT_TEXT",
    input: "SECRET_INPUT_TEXT",
    pageBody: "SECRET_PAGE_BODY"
  };
  const addEvent = (cohort, index, action, extra = {}) => {
    const isBaseline = cohort === "baseline_structure";
    const isWeighted = cohort === "outcome_weighted";
    events.push({
      ...eventBase,
      id: `quality-lift-${cohort}-${action}-${index}`,
      action,
      generationId: `quality-lift-${cohort}-${index}`,
      strategyId: isBaseline
        ? "baseline:continue:security-review"
        : isWeighted ? "llm:continue:medium:security-weight-winner" : "llm:continue:medium:strategy-guided",
      promptStrategyId: isBaseline ? "baseline_structure" : "preserve_winning_strategy",
      promptStrategyVersion: "v6-strategy-policy-3",
      experimentVersion: "v6-prompt-experiment-1",
      experimentArm: isBaseline ? "baseline_structure" : "strategy_guided",
      strategyWeightVersion: isWeighted ? "v6-strategy-weighting-1" : "",
      strategyWeightStatus: isWeighted ? "ready" : "",
      strategyWeightPromoted: isWeighted ? "llm:continue:medium:security-weight-winner" : "",
      strategyWeightDecision: isWeighted ? "outcome_weight" : "",
      qualityLiftCohort: cohort,
      qualityScore: isBaseline ? 0.72 : 0.91,
      feedbackConfidence: "medium",
      ...extra
    });
  };
  const addCohort = (cohort, outcomes) => {
    const sampleCount = collecting ? Math.min(1, outcomes.length) : outcomes.length;
    for (let index = 0; index < sampleCount; index += 1) {
      addEvent(cohort, index, "card_ready", { ok: true, verified: true });
      addEvent(cohort, index, "insert", { ok: true, verified: true, adopted: true });
      if (cohort === "baseline_structure" && !regression && index < 2) addEvent(cohort, index, "retry", { ok: false });
      if (cohort === "baseline_structure" && !regression && index === 0) addEvent(cohort, index, "undo", { ok: true, verified: true });
      if (cohort === "outcome_weighted" && regression) addEvent(cohort, index, "retry", { ok: false });
      if (cohort === "outcome_weighted" && regression && index < 2) addEvent(cohort, index, "undo", { ok: true, verified: true });
      if (cohort === "outcome_weighted" && !regression && index < 2) addEvent(cohort, index, "save", { ok: true, verified: true });
      const outcome = outcomes[index];
      addEvent(cohort, index, "outcome", {
        ok: outcome.success,
        outcomeLabel: outcome.success ? "success" : "failed",
        outcomeScore: outcome.score,
        outcomeVerified: true,
        outcomeSource: "manual_card"
      });
    }
  };
  const baselineOutcomes = regression
    ? [{ success: true, score: 0.92 }, { success: true, score: 0.9 }, { success: true, score: 0.88 }]
    : [{ success: true, score: 0.62 }, { success: false, score: 0.25 }, { success: false, score: 0.22 }];
  const guidedOutcomes = [{ success: true, score: 0.8 }, { success: true, score: 0.82 }, { success: false, score: 0.5 }];
  const weightedOutcomes = regression
    ? [{ success: false, score: 0.35 }, { success: false, score: 0.38 }, { success: true, score: 0.62 }]
    : [{ success: true, score: 0.94 }, { success: true, score: 0.95 }, { success: true, score: 0.92 }];
  addCohort("baseline_structure", baselineOutcomes);
  addCohort("strategy_guided", guidedOutcomes);
  addCohort("outcome_weighted", weightedOutcomes);
  return {
    eventCount: events.length,
    events
  };
}

function runQualityLiftProbe() {
  const input = "Review auth privacy and permission changes for injection risks.";
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    site: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt",
    taskScenario: "security-review"
  };
  const report = buildPromptQualityLiftReport(createQualityLiftMetrics(), context);
  const reportText = formatPromptQualityLiftReport(report);
  const regressionReport = buildPromptQualityLiftReport(createQualityLiftMetrics({ regression: true }), context);
  const collectingReport = buildPromptQualityLiftReport(createQualityLiftMetrics({ collecting: true }), context);
  const cardContext = {
    ...context,
    promptQualityLiftReport: report,
    promptQualityLiftText: reportText
  };
  const card = buildCard(input, cardContext, [], 0);
  const llm = buildLlmMessages(input, cardContext, [], 0);
  const baseline = report.cohorts.find((item) => item.cohort === "baseline_structure") || {};
  const guided = report.cohorts.find((item) => item.cohort === "strategy_guided") || {};
  const weighted = report.cohorts.find((item) => item.cohort === "outcome_weighted") || {};
  const weightedComparison = report.comparisons.find((item) => item.name === "outcome_weighted_vs_baseline") || {};
  const regressionComparison = regressionReport.comparisons.find((item) => item.name === "outcome_weighted_vs_baseline") || {};
  const serialized = JSON.stringify({ report, reportText, regressionReport, collectingReport, cardPrompt: card.prompt, llmMessages: llm.messages });
  return {
    reportVersion: report.reportVersion,
    readinessStatus: report.readiness.status,
    comparable: report.readiness.comparable,
    primaryDecision: report.readiness.primaryDecision,
    baselineOutcomeCount: baseline.outcomeCount,
    strategyGuidedOutcomeCount: guided.outcomeCount,
    outcomeWeightedOutcomeCount: weighted.outcomeCount,
    hasAllCohorts: Boolean(baseline.cohort && guided.cohort && weighted.cohort),
    positiveSuccessLift: Number(weightedComparison.deltas?.outcomeSuccessRateLift || 0) > 0.5,
    positiveAvgLift: Number(weightedComparison.deltas?.avgOutcomeScoreLift || 0) > 0.3,
    reducedRetryUndo: Number(weightedComparison.deltas?.retryUsageRateLift || 0) < 0
      && Number(weightedComparison.deltas?.undoUsageRateLift || 0) < 0,
    hasKeepRecommendation: report.recommendations.some((item) => item.key === "keep_outcome_weighting"),
    regressionStatus: regressionReport.readiness.status,
    regressionDecision: regressionReport.readiness.primaryDecision,
    regressionComparisonDecision: regressionComparison.decision,
    hasRegressionRecommendation: regressionReport.recommendations.some((item) => item.key === "review_outcome_weighting"),
    collectingStatus: collectingReport.readiness.status,
    collectingComparable: collectingReport.readiness.comparable,
    promptIncludesQualityLift: /Local quality lift/.test(card.prompt) && /keep_outcome_weighting/.test(card.prompt),
    llmIncludesQualityLift: llm.messages.some((message) => /Local quality lift/.test(message.content) && /quality_lift_positive/.test(message.content)),
    qualityLiftTextReady: /qualityLift=v6-quality-lift@1/.test(reportText)
      && /outcome_weighted_vs_baseline/.test(reportText)
      && /privacy=aggregate-only/.test(reportText),
    qualityLiftRedacted: !serialized.includes("SECRET_PROMPT_TEXT")
      && !serialized.includes("SECRET_INPUT_TEXT")
      && !serialized.includes("SECRET_PAGE_BODY")
      && !serialized.includes("SECRET_URL_TOKEN")
      && !serialized.includes("private/path"),
    privacyAggregateOnly: report.privacy.aggregateOnly === true
      && report.privacy.derivedFromAggregateQualityLiftMetrics === true
  };
}

function retargetQualityLiftMetrics(metrics, suffix, overrides = {}) {
  return {
    eventCount: metrics.events.length,
    events: metrics.events.map((event) => ({
      ...event,
      ...overrides,
      id: `${event.id}-${suffix}`,
      generationId: `${event.generationId}-${suffix}`,
      strategyId: `${event.strategyId}-${suffix}`,
      promptStrategyId: event.promptStrategyId,
      prompt: "SECRET_PROMPT_TEXT",
      input: "SECRET_INPUT_TEXT",
      pageBody: "SECRET_PAGE_BODY"
    }))
  };
}

function createQualityLiftSegmentsMetrics() {
  const positiveMetrics = retargetQualityLiftMetrics(createQualityLiftMetrics(), "positive", {
    mode: "continue",
    tool: "ChatGPT",
    adapterId: "chatgpt",
    site: "https://chatgpt.com/private/path?token=SECRET_URL_TOKEN",
    host: "chatgpt.com",
    taskScenario: "security-review"
  });
  const regressionMetrics = retargetQualityLiftMetrics(createQualityLiftMetrics({ regression: true }), "regression", {
    mode: "polish",
    tool: "Claude",
    adapterId: "claude",
    site: "https://claude.ai/private/path?token=SECRET_URL_TOKEN",
    host: "claude.ai",
    taskScenario: "ui-ux"
  });
  const collectingMetrics = retargetQualityLiftMetrics(createQualityLiftMetrics({ collecting: true }), "collecting", {
    mode: "idea",
    tool: "Doubao",
    adapterId: "doubao",
    site: "https://www.doubao.com/private/path?token=SECRET_URL_TOKEN",
    host: "www.doubao.com",
    taskScenario: "test-plan"
  });
  const metrics = {
    eventCount: positiveMetrics.eventCount + regressionMetrics.eventCount + collectingMetrics.eventCount,
    events: [
      ...positiveMetrics.events,
      ...regressionMetrics.events,
      ...collectingMetrics.events
    ]
  };
  return metrics;
}

function runQualityLiftSegmentsProbe() {
  const metrics = createQualityLiftSegmentsMetrics();
  const report = buildPromptQualityLiftSegmentsReport(metrics);
  const text = formatPromptQualityLiftSegmentsReport(report);
  const toolSegments = report.segmentsByDimension.tool || [];
  const siteSegments = report.segmentsByDimension.site || [];
  const scenarioSegments = report.segmentsByDimension.taskScenario || [];
  const modeSegments = report.segmentsByDimension.mode || [];
  const serialized = JSON.stringify({ report, text });
  return {
    reportVersion: report.reportVersion,
    sourceReportVersion: report.sourceReportVersion,
    readinessStatus: report.readiness.status,
    segmentCount: report.readiness.segmentCount,
    readySegmentCount: report.readiness.readySegmentCount,
    improvingSegmentCount: report.readiness.improvingSegmentCount,
    regressingSegmentCount: report.readiness.regressingSegmentCount,
    collectingSegmentCount: report.readiness.collectingSegmentCount,
    hasToolDimension: report.dimensions.includes("tool") && toolSegments.some((item) => item.key === "chatgpt" && item.primaryDecision === "quality_lift_positive"),
    hasSiteDimension: report.dimensions.includes("site") && siteSegments.some((item) => item.key === "claude.ai" && item.primaryDecision === "quality_lift_regression"),
    hasScenarioDimension: report.dimensions.includes("taskScenario") && scenarioSegments.some((item) => item.key === "test-plan" && item.readinessStatus === "collecting"),
    hasModeDimension: report.dimensions.includes("mode") && modeSegments.some((item) => item.key === "continue" && item.primaryDecision === "quality_lift_positive"),
    topImprovingKey: report.topImproving[0]?.key,
    topRegressingKey: report.topRegressing[0]?.key,
    hasCollectingSegment: report.collectingSegments.some((item) => item.key === "doubao" || item.key === "test-plan" || item.key === "idea"),
    segmentTextReady: /qualityLiftSegments=v6-quality-lift-segments@1/.test(text)
      && /tool\/chatgpt/.test(text)
      && /site\/claude.ai/.test(text)
      && /privacy=aggregate-only/.test(text),
    segmentsRedacted: !serialized.includes("SECRET_PROMPT_TEXT")
      && !serialized.includes("SECRET_INPUT_TEXT")
      && !serialized.includes("SECRET_PAGE_BODY")
      && !serialized.includes("SECRET_URL_TOKEN")
      && !serialized.includes("private/path"),
    privacyAggregateOnly: report.privacy.aggregateOnly === true
      && report.privacy.segmentMetadataOnly === true
      && report.privacy.derivedFromAggregateQualityLiftMetrics === true
  };
}

function segmentPolicyMetrics() {
  const segmentMetrics = createQualityLiftSegmentsMetrics();
  return {
    ...segmentMetrics,
    insertSuccessRate: 0.9,
    saveRate: 0.55,
    retryUsageRate: 0.05,
    undoUsageRate: 0.02,
    adapterFailureRate: 0,
    failureReasons: {}
  };
}

function fakePromotedWeightPolicy(strategyId) {
  return {
    weightPolicyVersion: "v6-strategy-weighting@1",
    pilotOutcomeVersion: "v6-pilot-outcome-readiness@1",
    readiness: {
      status: "ready",
      totalOutcomeEvents: 6,
      promotedStrategyCount: 1,
      suppressedStrategyCount: 0,
      exploringStrategyCount: 0
    },
    selectedPromotion: {
      strategyId,
      weight: 0.9,
      outcomeSuccessRate: 0.92,
      outcomeCount: 3
    },
    selectedSuppression: null,
    promotedStrategies: [],
    suppressedStrategies: [],
    exploringStrategies: [],
    privacy: {
      promptTextNotStored: true,
      inputTextNotStored: true,
      derivedFromAggregatePilotOutcomes: true,
      aggregateOnly: true
    }
  };
}

function emptyTaskOutcomeReport() {
  return {
    reportVersion: "v6-task-outcome@1",
    readiness: { status: "collecting", outcomeCount: 0, outcomeSuccessRate: 0, avgOutcomeScore: null },
    recommendations: [],
    topOutcomeStrategies: [],
    privacy: { aggregateOnly: true, derivedFromAggregateTaskOutcomes: true }
  };
}

function runQualityLiftSegmentPolicyProbe() {
  const input = "Improve this prompt for a privacy-safe product review workflow.";
  const metrics = segmentPolicyMetrics();
  const segmentReport = buildPromptQualityLiftSegmentsReport(metrics);
  const positiveContext = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    site: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt",
    taskScenario: "security-review"
  };
  const regressionContext = {
    mode: "polish",
    tool: "Claude",
    host: "claude.ai",
    site: "claude.ai",
    inputKind: "contenteditable",
    adapterId: "claude",
    taskScenario: "ui-ux"
  };
  const collectingContext = {
    mode: "idea",
    tool: "Doubao",
    host: "www.doubao.com",
    site: "www.doubao.com",
    inputKind: "textarea",
    adapterId: "doubao",
    taskScenario: "test-plan"
  };
  const positivePolicy = buildQualityLiftSegmentPolicy(segmentReport, positiveContext);
  const regressionPolicy = buildQualityLiftSegmentPolicy(segmentReport, regressionContext);
  const collectingPolicy = buildQualityLiftSegmentPolicy(segmentReport, collectingContext);
  const positivePolicyText = formatQualityLiftSegmentPolicy(positivePolicy);
  const regressionPolicyText = formatQualityLiftSegmentPolicy(regressionPolicy);
  const collectingPolicyText = formatQualityLiftSegmentPolicy(collectingPolicy);
  const positiveProfile = buildFeedbackProfile(metrics, positiveContext);
  const regressionProfile = buildFeedbackProfile(metrics, regressionContext);
  const collectingProfile = buildFeedbackProfile(metrics, collectingContext);
  const positiveWeight = fakePromotedWeightPolicy("llm:continue:medium:security-weight-winner");
  const regressionWeight = fakePromotedWeightPolicy("llm:polish:medium:claude-weight-winner");
  const positivePlan = buildPromptStrategyPlan(metrics, positiveContext, positiveProfile, null, emptyTaskOutcomeReport(), positiveWeight, segmentReport);
  const regressionPlan = buildPromptStrategyPlan(metrics, regressionContext, regressionProfile, null, emptyTaskOutcomeReport(), regressionWeight, segmentReport);
  const collectingPlan = buildPromptStrategyPlan(metrics, collectingContext, collectingProfile, null, emptyTaskOutcomeReport(), null, segmentReport);
  const positivePlanText = formatPromptStrategyPlan(positivePlan);
  const regressionPlanText = formatPromptStrategyPlan(regressionPlan);
  const cardContext = {
    ...positiveContext,
    promptStrategyPlan: positivePlan,
    promptStrategyText: positivePlanText,
    qualityLiftSegmentPolicy: positivePolicy,
    qualityLiftSegmentText: positivePolicyText
  };
  const card = buildCard(input, cardContext, [], 0);
  const llm = buildLlmMessages(input, cardContext, [], 0);
  const serialized = JSON.stringify({
    segmentReport,
    positivePolicy,
    regressionPolicy,
    collectingPolicy,
    positivePolicyText,
    regressionPolicyText,
    collectingPolicyText,
    positivePlan,
    regressionPlan,
    collectingPlan,
    positivePlanText,
    regressionPlanText,
    cardPrompt: card.prompt,
    llmMessages: llm.messages
  });
  return {
    policyVersion: positivePolicy.policyVersion,
    sourceReportVersion: positivePolicy.sourceReportVersion,
    positiveDecision: positivePolicy.decision,
    positiveMatchedSegments: positivePolicy.readiness.matchedSegmentCount,
    positivePlanDecision: positivePlan.selectedStrategy.decision,
    positivePreservesOutcomeWeight: positivePlan.selectedStrategy.id === "preserve_winning_strategy"
      && positivePlan.selectedStrategy.decision === "outcome_weight"
      && positivePlan.directives.some((item) => item.key === "preserve_improving_segment"),
    regressionDecision: regressionPolicy.decision,
    regressionMatchedSegments: regressionPolicy.readiness.matchedSegmentCount,
    regressionSuppressesOutcomeWeight: regressionPlan.selectedStrategy.id === "baseline_structure"
      && regressionPlan.selectedStrategy.decision === "segment_regression_guardrail",
    regressionHasAvoidDirective: regressionPlan.directives.some((item) => item.key === "avoid_regressing_segment"),
    collectingDecision: collectingPolicy.decision,
    collectingMatchedSegments: collectingPolicy.readiness.matchedSegmentCount,
    collectingKeepsExploration: collectingPlan.exploration.enabled === true
      && collectingPlan.directives.some((item) => item.key === "collect_quality_lift_segment_samples"),
    planPolicyVersion: positivePlan.strategyPolicy.qualityLiftSegmentPolicyVersion,
    planTextMentionsPolicy: /qualityLiftSegmentPolicy=preserve_segment_winner/.test(positivePlanText)
      && /qualityLiftSegmentPolicy=segment_regression_guardrail/.test(regressionPlanText),
    promptIncludesSegmentPolicy: /Local quality lift segment policy/.test(card.prompt)
      && /preserve_segment_winner/.test(card.prompt),
    llmIncludesSegmentPolicy: llm.messages.some((message) => /Local quality lift segment policy/.test(message.content) && /preserve_segment_winner/.test(message.content)),
    policyTextReady: /qualityLiftSegmentPolicy=v6-quality-lift-segment-policy@1/.test(positivePolicyText)
      && /avoid_regressing_segment/.test(regressionPolicyText)
      && /collect_quality_lift_segment_samples/.test(collectingPolicyText)
      && /privacy=aggregate-only/.test(positivePolicyText),
    policyRedacted: !serialized.includes("SECRET_PROMPT_TEXT")
      && !serialized.includes("SECRET_INPUT_TEXT")
      && !serialized.includes("SECRET_PAGE_BODY")
      && !serialized.includes("SECRET_URL_TOKEN")
      && !serialized.includes("private/path"),
    privacyAggregateOnly: positivePolicy.privacy.aggregateOnly === true
      && regressionPolicy.privacy.aggregateOnly === true
      && collectingPolicy.privacy.aggregateOnly === true
  };
}

function createFailureReasonMetrics(primaryReason = "wrong_format") {
  const base = {
    action: "outcome",
    mode: "continue",
    tool: "ChatGPT",
    adapterId: "chatgpt",
    site: "https://chatgpt.com/private/path?token=SECRET_URL_TOKEN",
    taskScenario: "security-review",
    generatedBy: "llm",
    strategyId: "llm:continue:medium:failure-reason",
    promptStrategyId: "preserve_winning_strategy",
    promptStrategyVersion: "v6-strategy-policy@3",
    outcomeVerified: true,
    outcomeSource: "manual"
  };
  const formatEvents = [
    { ...base, generationId: "format-0", outcomeLabel: "failed", ok: false, outcomeScore: 0.1, failureReason: "SECRET_PROMPT_TEXT produced the wrong JSON format and schema." },
    { ...base, generationId: "format-1", outcomeLabel: "needs-work", ok: false, outcomeScore: 0.3, outcomeReason: "Output format was wrong; missing markdown sections." },
    { ...base, generationId: "format-2", outcomeLabel: "failed", ok: false, outcomeScore: 0.2, failureReasonToken: "wrong_format" }
  ];
  const insertEvents = [
    { ...base, action: "insert", generationId: "insert-0", ok: false, verified: false, adopted: false, failureReason: "after_write_mismatch SECRET_INPUT_TEXT" },
    { ...base, action: "insert", generationId: "insert-1", ok: false, verified: false, adopted: false, failureReason: "paste failed in contenteditable" },
    { ...base, action: "insert", generationId: "insert-2", ok: false, verified: false, adopted: false, failureReasonToken: "insert_failed" }
  ];
  const events = primaryReason === "insert_failed" ? insertEvents : formatEvents;
  return {
    eventCount: events.length,
    insertSuccessRate: primaryReason === "insert_failed" ? 0 : 1,
    saveRate: 0,
    retryUsageRate: 0,
    undoUsageRate: 0,
    adapterFailureRate: primaryReason === "insert_failed" ? 1 : 0,
    failureReasons: {},
    failureReasonTokens: {},
    byAdapter: {},
    byStrategy: {},
    byScenario: {},
    events
  };
}

function runFailureReasonPolicyProbe() {
  const input = "Improve the prompt so model output is structured and easy to verify.";
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    site: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt",
    taskScenario: "security-review"
  };
  const formatMetrics = createFailureReasonMetrics("wrong_format");
  const formatReport = buildFailureReasonReport(formatMetrics, context);
  const formatPolicy = buildFailureReasonPolicy(formatReport, context);
  const formatReportText = formatFailureReasonReport(formatReport);
  const formatPolicyText = formatFailureReasonPolicy(formatPolicy);
  const formatProfile = buildFeedbackProfile(formatMetrics, context);
  const formatPlan = buildPromptStrategyPlan(formatMetrics, context, formatProfile, null, emptyTaskOutcomeReport(), null, null, formatReport);
  const formatPlanText = formatPromptStrategyPlan(formatPlan);
  const cardContext = {
    ...context,
    failureReasonReport: formatReport,
    failureReasonReportText: formatReportText,
    failureReasonPolicy: formatPolicy,
    failureReasonText: formatPolicyText,
    promptStrategyPlan: formatPlan,
    promptStrategyText: formatPlanText
  };
  const card = buildCard(input, cardContext, [], 0);
  const llm = buildLlmMessages(input, cardContext, [], 0);

  const insertMetrics = createFailureReasonMetrics("insert_failed");
  const insertReport = buildFailureReasonReport(insertMetrics, context);
  const insertPolicy = buildFailureReasonPolicy(insertReport, context);
  const insertProfile = buildFeedbackProfile(insertMetrics, context);
  const insertPlan = buildPromptStrategyPlan(insertMetrics, context, insertProfile, null, emptyTaskOutcomeReport(), null, null, insertReport);
  const serialized = JSON.stringify({
    formatReport,
    formatPolicy,
    formatReportText,
    formatPolicyText,
    formatPlan,
    formatPlanText,
    insertReport,
    insertPolicy,
    insertPlan,
    cardPrompt: card.prompt,
    llmMessages: llm.messages
  });
  return {
    reportVersion: formatReport.reportVersion,
    policyVersion: formatPolicy.policyVersion,
    normalizedWrongFormat: normalizeFailureReasonToken("SECRET_PROMPT_TEXT wrong JSON format") === "wrong_format",
    normalizedInsertFailure: normalizeFailureReasonToken("after_write_mismatch") === "insert_failed",
    normalizedNeedsWork: normalizeFailureReasonToken("manual_card_needs-work") === "low_quality",
    readinessStatus: formatReport.readiness.status,
    topReason: formatReport.topReasons[0]?.key,
    policyDecision: formatPolicy.decision,
    hasFormatDirective: formatPolicy.directives.some((item) => item.key === "strengthen_output_format"),
    planPolicyVersion: formatPlan.strategyPolicy.failureReasonPolicyVersion,
    planHasFormatDirective: formatPlan.directives.some((item) => item.key === "strengthen_output_format"),
    planTextMentionsPolicy: /failureReasonPolicy=strengthen_output_format/.test(formatPlanText),
    promptIncludesFailurePolicy: /Local failure reason policy/.test(card.prompt)
      && /strengthen_output_format/.test(card.prompt),
    llmIncludesFailurePolicy: llm.messages.some((message) => /Local failure reason policy/.test(message.content) && /strengthen_output_format/.test(message.content)),
    policyTextReady: /failureReasonPolicy=v6-failure-reason-policy@1/.test(formatPolicyText)
      && /failureReasons=v6-failure-reasons@1/.test(formatReportText)
      && /raw-reason-not-stored/.test(formatPolicyText),
    insertDecision: insertPolicy.decision,
    insertPlanSelectsGuardrail: insertPlan.selectedStrategy.id === "insert_safe_compact"
      && insertPlan.selectedStrategy.decision === "guardrail"
      && insertPlan.directives.some((item) => item.key === "reduce_insert_fragility"),
    reportRedacted: !serialized.includes("SECRET_PROMPT_TEXT")
      && !serialized.includes("SECRET_INPUT_TEXT")
      && !serialized.includes("SECRET_PAGE_BODY")
      && !serialized.includes("SECRET_URL_TOKEN")
      && !serialized.includes("private/path"),
    privacyAggregateOnly: formatReport.privacy.aggregateOnly === true
      && formatReport.privacy.rawFailureReasonNotStored === true
      && formatPolicy.privacy.aggregateOnly === true
      && insertPolicy.privacy.rawFailureReasonNotStored === true
  };
}

function createSelfImprovementMetrics() {
  const strategyMetrics = createStrategyWeightMetrics();
  const qualityMetrics = createQualityLiftMetrics();
  const failureMetrics = createFailureReasonMetrics("wrong_format");
  const lowSampleId = "llm:continue:medium:security-low-sample-evolution";
  return {
    ...strategyMetrics,
    eventCount: Number(strategyMetrics.eventCount || 0) + Number(qualityMetrics.eventCount || 0) + Number(failureMetrics.eventCount || 0),
    events: [
      ...(qualityMetrics.events || []),
      ...(failureMetrics.events || [])
    ],
    byStrategy: {
      ...(strategyMetrics.byStrategy || {}),
      [lowSampleId]: {
        events: 4,
        cardReady: 2,
        insertAttempts: 2,
        verifiedInserts: 2,
        saves: 2,
        retries: 0,
        undos: 0,
        failures: 0,
        outcomes: 1,
        successfulOutcomes: 1,
        failedOutcomes: 0,
        outcomeSuccessRate: 1,
        avgOutcomeScore: 0.9,
        avgQualityScore: 0.94,
        insertSuccessRate: 1,
        saveRate: 1,
        retryUsageRate: 0,
        undoUsageRate: 0,
        modes: { continue: 4 },
        tools: { chatgpt: 4 },
        adapters: { chatgpt: 4 },
        sites: { "chatgpt.com": 4 },
        scenarios: { "security-review": 4 }
      }
    },
    byScenarioStrategy: {
      "security-review": {
        ...(strategyMetrics.byStrategy || {}),
        [lowSampleId]: {
          events: 4,
          cardReady: 2,
          insertAttempts: 2,
          verifiedInserts: 2,
          saves: 2,
          retries: 0,
          undos: 0,
          failures: 0,
          outcomes: 1,
          successfulOutcomes: 1,
          failedOutcomes: 0,
          outcomeSuccessRate: 1,
          avgOutcomeScore: 0.9,
          avgQualityScore: 0.94,
          insertSuccessRate: 1,
          saveRate: 1,
          retryUsageRate: 0,
          undoUsageRate: 0,
          modes: { continue: 4 },
          tools: { chatgpt: 4 },
          adapters: { chatgpt: 4 },
          sites: { "chatgpt.com": 4 },
          scenarios: { "security-review": 4 }
        }
      }
    }
  };
}

function runSelfImprovementProbe() {
  const input = "Review auth privacy and output format regressions.";
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    site: "https://chatgpt.com/private/path?token=SECRET_URL_TOKEN",
    inputKind: "textarea",
    adapterId: "chatgpt",
    taskScenario: "security-review"
  };
  const metrics = createSelfImprovementMetrics();
  const report = buildSelfImprovementReport(metrics, context);
  const text = formatSelfImprovementReport(report);
  const candidates = buildEvolutionCandidateReport(report, context);
  const candidateText = formatEvolutionCandidateReport(candidates);
  const cardContext = {
    ...context,
    selfImprovementReport: report,
    selfImprovementText: text,
    evolutionCandidateReport: candidates,
    evolutionCandidateText: candidateText
  };
  const card = buildCard(input, cardContext, [], 0);
  const llm = buildLlmMessages(input, cardContext, [], 0);
  const serialized = JSON.stringify({ report, text, candidates, candidateText, cardPrompt: card.prompt, llmMessages: llm.messages });
  return {
    reportVersion: report.reportVersion,
    candidateVersion: candidates.candidateVersion,
    readinessStatus: report.readiness.status,
    outcomeCount: report.readiness.outcomeCount,
    hasPositiveReflection: report.reflections.some((item) => item.type === "positive"),
    hasRegressionReflection: report.reflections.some((item) => item.type === "regression"),
    hasCollectingReflection: report.reflections.some((item) => item.type === "collecting"),
    hasPromoteCandidate: candidates.candidates.some((item) => item.action === "promote_prompt_strategy" && item.mutationAllowed === false),
    hasSuppressCandidate: candidates.candidates.some((item) => item.action === "suppress_or_repair_strategy" && item.priority === "high"),
    hasFailureRepairCandidate: candidates.candidates.some((item) => item.action === "strengthen_output_format" && item.reasonToken === "wrong_format"),
    hasCollectCandidate: candidates.candidates.some((item) => item.action === "collect_more_samples" && item.status === "collecting"),
    mutationGated: candidates.mutationAllowed === false
      && candidates.automaticPromotion === false
      && candidates.requiresCritic === true
      && candidates.promotionMode === "manual_review_required"
      && candidates.readiness.promotionGated === true,
    promptIncludesSelfImprovement: /Local self-improvement reflection/.test(card.prompt)
      && /promotion=manual-review-required/.test(card.prompt),
    promptIncludesEvolutionCandidates: /Local evolution candidates/.test(card.prompt)
      && /mutationAllowed=false/.test(card.prompt),
    llmIncludesSelfImprovement: llm.messages.some((message) => /Local self-improvement reflection/.test(message.content) && /v6-self-improvement@1/.test(message.content)),
    llmIncludesEvolutionCandidates: llm.messages.some((message) => /Local evolution candidates/.test(message.content) && /v6-evolution-candidates@1/.test(message.content)),
    textReady: /selfImprovement=v6-self-improvement@1/.test(text)
      && /evolutionCandidates=v6-evolution-candidates@1/.test(candidateText)
      && /no-automatic-mutation/.test(text)
      && /raw-text-not-stored/.test(candidateText),
    redacted: !serialized.includes("SECRET_PROMPT_TEXT")
      && !serialized.includes("SECRET_INPUT_TEXT")
      && !serialized.includes("SECRET_PAGE_BODY")
      && !serialized.includes("SECRET_URL_TOKEN")
      && !serialized.includes("private/path"),
    privacyAggregateOnly: report.privacy.aggregateOnly === true
      && report.privacy.noAutomaticMutation === true
      && candidates.privacy.aggregateOnly === true
      && candidates.privacy.noAutomaticMutation === true
  };
}

function runOutcomeFeedbackProbe() {
  const context = {
    mode: "continue",
    tool: "ChatGPT",
    host: "chatgpt.com",
    inputKind: "textarea",
    adapterId: "chatgpt"
  };
  const winningMetrics = buildOutcomeMetrics(true);
  const winningProfile = buildFeedbackProfile(winningMetrics, context);
  const winningOutcome = buildExperimentOutcomeReport(winningMetrics, context);
  const winningPlan = buildPromptStrategyPlan(winningMetrics, context, winningProfile, winningOutcome);
  const winningPlanText = formatPromptStrategyPlan(winningPlan);
  const winningOutcomeText = formatExperimentOutcomeReport(winningOutcome);
  const card = buildCard("Build a CRM with customer list and follow-up notes.", {
    ...context,
    promptStrategyPlan: winningPlan,
    promptStrategyText: winningPlanText,
    experimentOutcomeReport: winningOutcome,
    experimentOutcomeText: winningOutcomeText
  }, [], 0);

  const losingMetrics = buildOutcomeMetrics(false);
  const losingProfile = buildFeedbackProfile(losingMetrics, context);
  const losingOutcome = buildExperimentOutcomeReport(losingMetrics, context);
  const losingPlan = buildPromptStrategyPlan(losingMetrics, context, losingProfile, losingOutcome);
  const losingPlanText = formatPromptStrategyPlan(losingPlan);
  const serialized = JSON.stringify({ winningOutcome, winningPlan, losingOutcome, losingPlan, winningPlanText, losingPlanText, winningOutcomeText });

  return {
    winningPolicyVersion: winningPlan.strategyPolicy.version,
    winningOutcomeReady: winningPlan.outcomePolicy.status === "ready" && winningPlan.outcomePolicy.comparable,
    winningDecision: winningPlan.outcomePolicy.decision,
    winningRecommendation: winningPlan.outcomePolicy.recommendationKey,
    winningSelectsStrategy: winningPlan.selectedStrategy.id === "preserve_winning_strategy",
    winningHasOutcomeDirective: winningPlan.directives.some((item) => item.key === "prefer_strategy_guided"),
    winningTextMentionsOutcome: /outcome=ready/.test(winningPlanText) && /prefer_strategy_guided/.test(winningPlanText),
    promptIncludesExperimentOutcomes: /Local experiment outcomes/.test(card.prompt) && /prefer_strategy_guided/.test(card.prompt),
    losingOutcomeReady: losingPlan.outcomePolicy.status === "ready" && losingPlan.outcomePolicy.comparable,
    losingDecision: losingPlan.outcomePolicy.decision,
    losingRecommendation: losingPlan.outcomePolicy.recommendationKey,
    losingSelectsBaseline: losingPlan.selectedStrategy.id === "baseline_structure" && losingPlan.selectedStrategy.decision === "outcome_guardrail",
    losingHasBaselineDirective: losingPlan.directives.some((item) => item.key === "prefer_baseline_until_reviewed"),
    losingTextMentionsOutcome: /outcome=ready/.test(losingPlanText) && /prefer_baseline_until_reviewed/.test(losingPlanText),
    outcomeFeedbackRedacted: !serialized.includes("Build a CRM") && !serialized.includes("customer list"),
    privacyAggregateOnly: winningPlan.outcomePolicy.privacy.aggregateOnly === true && losingPlan.outcomePolicy.privacy.aggregateOnly === true
  };
}

function main() {
  const fixtures = loadFixtures();
  const results = fixtures.map((fixture) => {
    const feedbackSummary = buildFeedbackSummary(createMetrics(fixture.context.adapterId), fixture.context);
    const context = {
      ...fixture.context,
      mode: fixture.mode,
      feedbackSummary,
      feedbackSummaryText: formatFeedbackSummary(feedbackSummary)
    };
    const card = buildCard(fixture.input, context, [], fixture.variantIndex || 0);
    const quality = scorePromptQuality(card.prompt, {
      mode: fixture.mode,
      skills: card.skills,
      minScore: fixture.minScore
    });
    const expectedSkillMatched = hasExpectedSkill(card, fixture.expectedSkills);
    const ok = quality.pass && expectedSkillMatched && card.mode === fixture.mode;
    return {
      id: fixture.id,
      ok,
      mode: fixture.mode,
      tool: fixture.context.tool,
      inputLength: fixture.input.length,
      inputHash: hashText(fixture.input),
      promptLength: card.prompt.length,
      promptHash: hashText(card.prompt),
      score: quality.score,
      failedChecks: quality.failedChecks,
      expectedSkillMatched,
      selectedSkills: card.skills.map((skill) => ({
        name: skill.name,
        score: Number.isFinite(skill.score) ? Math.round(skill.score * 100) / 100 : null
      }))
    };
  });

  const byMode = {};
  for (const result of results) {
    byMode[result.mode] = byMode[result.mode] || { total: 0, pass: 0 };
    byMode[result.mode].total += 1;
    if (result.ok) byMode[result.mode].pass += 1;
  }
  const structuredProbe = runStructuredResponseProbe();
  const feedbackProfileProbe = runFeedbackProfileProbe();
  const qualityExperimentProbe = runQualityExperimentProbe();
  const promptStrategyProbe = runPromptStrategyProbe();
  const strategyExplorationProbe = runStrategyExplorationProbe();
  const strategyInsightsProbe = runStrategyInsightsProbe();
  const experimentOutcomeProbe = runExperimentOutcomeProbe();
  const outcomeFeedbackProbe = runOutcomeFeedbackProbe();
  const scenarioLearningProbe = runScenarioLearningProbe();
  const taskOutcomeProbe = runTaskOutcomeProbe();
  const strategyWeightProbe = runStrategyWeightProbe();
  const qualityLiftProbe = runQualityLiftProbe();
  const qualityLiftSegmentsProbe = runQualityLiftSegmentsProbe();
  const qualityLiftSegmentPolicyProbe = runQualityLiftSegmentPolicyProbe();
  const failureReasonPolicyProbe = runFailureReasonPolicyProbe();
  const selfImprovementProbe = runSelfImprovementProbe();
  const averageScore = results.reduce((sum, result) => sum + result.score, 0) / results.length;
  const pass = results.every((result) => result.ok)
    && structuredProbe.structured
    && structuredProbe.keysPresent
    && structuredProbe.qualityPass
    && feedbackProfileProbe.hasAdaptiveDirectives
    && feedbackProfileProbe.promptIncludesGuidance
    && feedbackProfileProbe.profileTextRedacted
    && qualityExperimentProbe.hasGenerationId
    && qualityExperimentProbe.hasStrategyId
    && qualityExperimentProbe.carriesQualityScore
    && qualityExperimentProbe.linksFeedbackDirectives
    && qualityExperimentProbe.experimentTextRedacted
    && promptStrategyProbe.selectedStrategy === "preserve_winning_strategy"
    && promptStrategyProbe.policyVersion === "v6-strategy-policy@3"
    && promptStrategyProbe.selectedStrategyVersion === "v6-strategy-policy@3"
    && promptStrategyProbe.selectedDecision === "exploit"
    && promptStrategyProbe.hasWinningCandidate
    && promptStrategyProbe.winningCandidateReliable
    && promptStrategyProbe.winningCandidateCohortMatched
    && promptStrategyProbe.hasAvoidRiskDirective
    && promptStrategyProbe.promptIncludesStrategyPlan
    && promptStrategyProbe.experimentUsesStrategy
    && promptStrategyProbe.strategyTextRedacted
    && strategyExplorationProbe.policyVersion === "v6-strategy-policy@3"
    && strategyExplorationProbe.selectedStrategy === "cold_start_structure"
    && strategyExplorationProbe.selectedDecision === "explore"
    && strategyExplorationProbe.lowSampleCandidate
    && strategyExplorationProbe.lowSampleNotReliable
    && strategyExplorationProbe.explorationEnabled
    && strategyExplorationProbe.explorationCandidate
    && strategyExplorationProbe.hasSampleGuardDirective
    && strategyExplorationProbe.promptIncludesExplorationPolicy
    && strategyExplorationProbe.experimentCarriesVersion
    && strategyExplorationProbe.strategyTextRedacted
    && strategyInsightsProbe.insightVersion === "v6-strategy-insights@1"
    && strategyInsightsProbe.policyVersion === "v6-strategy-policy@3"
    && strategyInsightsProbe.readinessStatus === "ready"
    && strategyInsightsProbe.hasReliableWinner
    && strategyInsightsProbe.hasLowSampleCandidate
    && strategyInsightsProbe.hasRiskSignal
    && strategyInsightsProbe.hasModeToolAdapterSiteCohorts
    && strategyInsightsProbe.hasRecommendations
    && strategyInsightsProbe.promptIncludesStrategyInsights
    && strategyInsightsProbe.insightTextMentionsSamples
    && strategyInsightsProbe.insightsTextRedacted
    && strategyInsightsProbe.privacyAggregateOnly
    && experimentOutcomeProbe.assignmentVersion === "v6-prompt-experiment@1"
    && experimentOutcomeProbe.assignmentArm === "strategy_guided"
    && experimentOutcomeProbe.assignmentEligible
    && experimentOutcomeProbe.assignmentHasBucket
    && experimentOutcomeProbe.assignmentHasComparisonKey
    && experimentOutcomeProbe.experimentVersion === "v6-prompt-experiment-1"
    && experimentOutcomeProbe.experimentArm === "strategy_guided"
    && experimentOutcomeProbe.experimentCarriesComparisonKey
    && experimentOutcomeProbe.experimentCarriesStrategyInsights
    && experimentOutcomeProbe.outcomeVersion === "v6-prompt-experiment@1"
    && experimentOutcomeProbe.outcomeReadiness === "ready"
    && experimentOutcomeProbe.outcomeComparable
    && experimentOutcomeProbe.hasBaselineArm
    && experimentOutcomeProbe.hasStrategyGuidedArm
    && experimentOutcomeProbe.comparisonReady
    && experimentOutcomeProbe.comparisonShowsGuidedLift
    && experimentOutcomeProbe.hasOutcomeRecommendation
    && experimentOutcomeProbe.outcomeTextRedacted
    && experimentOutcomeProbe.privacyAggregateOnly
    && outcomeFeedbackProbe.winningPolicyVersion === "v6-strategy-policy@3"
    && outcomeFeedbackProbe.winningOutcomeReady
    && outcomeFeedbackProbe.winningDecision === "prefer_strategy_guided"
    && outcomeFeedbackProbe.winningRecommendation === "prefer_strategy_guided"
    && outcomeFeedbackProbe.winningSelectsStrategy
    && outcomeFeedbackProbe.winningHasOutcomeDirective
    && outcomeFeedbackProbe.winningTextMentionsOutcome
    && outcomeFeedbackProbe.promptIncludesExperimentOutcomes
    && outcomeFeedbackProbe.losingOutcomeReady
    && outcomeFeedbackProbe.losingDecision === "prefer_baseline"
    && outcomeFeedbackProbe.losingRecommendation === "prefer_baseline_until_reviewed"
    && outcomeFeedbackProbe.losingSelectsBaseline
    && outcomeFeedbackProbe.losingHasBaselineDirective
    && outcomeFeedbackProbe.losingTextMentionsOutcome
    && outcomeFeedbackProbe.outcomeFeedbackRedacted
    && outcomeFeedbackProbe.privacyAggregateOnly
    && scenarioLearningProbe.inferredScenario === "security-review"
    && scenarioLearningProbe.feedbackCohortScenario === "security-review"
    && scenarioLearningProbe.insightsCohortScenario === "security-review"
    && scenarioLearningProbe.outcomeCohortScenario === "security-review"
    && scenarioLearningProbe.assignmentCohortScenario === "security-review"
    && scenarioLearningProbe.experimentTaskScenario === "security-review"
    && scenarioLearningProbe.hasScenarioCohorts
    && scenarioLearningProbe.scenarioWinnerSelected
    && scenarioLearningProbe.scenarioCandidateMatched
    && scenarioLearningProbe.uiStrategyExcludedFromScenarioSource
    && scenarioLearningProbe.comparisonKeyIncludesScenario
    && scenarioLearningProbe.outcomeUsesScenarioArms
    && scenarioLearningProbe.promptIncludesScenario
    && scenarioLearningProbe.llmContextScenarioReady
    && scenarioLearningProbe.scenarioTextRedacted
    && taskOutcomeProbe.reportVersion === "v6-task-outcome@1"
    && taskOutcomeProbe.readinessStatus === "ready"
    && taskOutcomeProbe.outcomeCount >= 9
    && taskOutcomeProbe.hasOutcomeWinner
    && taskOutcomeProbe.hasOutcomeRisk
    && taskOutcomeProbe.recommendation === "prefer_task_outcome_winner"
    && taskOutcomeProbe.planPolicyDecision === "prefer_task_outcome_winner"
    && taskOutcomeProbe.planSelectsOutcomeWinner
    && taskOutcomeProbe.hasOutcomeDirective
    && taskOutcomeProbe.promptIncludesTaskOutcomes
    && taskOutcomeProbe.taskOutcomeTextReady
    && taskOutcomeProbe.taskOutcomeRedacted
    && taskOutcomeProbe.privacyAggregateOnly
    && strategyWeightProbe.weightVersion === "v6-strategy-weighting@1"
    && strategyWeightProbe.pilotVersion === "v6-pilot-outcome-readiness@1"
    && strategyWeightProbe.readinessStatus === "ready"
    && strategyWeightProbe.totalOutcomeEvents >= 7
    && strategyWeightProbe.promotedCount >= 1
    && strategyWeightProbe.suppressedCount >= 1
    && strategyWeightProbe.exploringCount >= 1
    && strategyWeightProbe.selectedPromotion === "llm:continue:medium:security-weight-winner"
    && strategyWeightProbe.selectedSuppression === "llm:continue:medium:security-weight-risk"
    && strategyWeightProbe.planPolicyWeightVersion === "v6-strategy-weighting@1"
    && strategyWeightProbe.planDecision === "outcome_weight"
    && strategyWeightProbe.planSelectsWeightedWinner
    && strategyWeightProbe.hasPromotionDirective
    && strategyWeightProbe.hasSuppressionDirective
    && strategyWeightProbe.hasExplorationDirective
    && strategyWeightProbe.promptIncludesStrategyWeights
    && strategyWeightProbe.llmIncludesStrategyWeights
    && strategyWeightProbe.weightTextReady
    && strategyWeightProbe.strategyWeightRedacted
    && strategyWeightProbe.privacyAggregateOnly
    && qualityLiftProbe.reportVersion === "v6-quality-lift@1"
    && qualityLiftProbe.readinessStatus === "ready"
    && qualityLiftProbe.comparable
    && qualityLiftProbe.primaryDecision === "quality_lift_positive"
    && qualityLiftProbe.baselineOutcomeCount >= 3
    && qualityLiftProbe.strategyGuidedOutcomeCount >= 3
    && qualityLiftProbe.outcomeWeightedOutcomeCount >= 3
    && qualityLiftProbe.hasAllCohorts
    && qualityLiftProbe.positiveSuccessLift
    && qualityLiftProbe.positiveAvgLift
    && qualityLiftProbe.reducedRetryUndo
    && qualityLiftProbe.hasKeepRecommendation
    && qualityLiftProbe.regressionStatus === "regression"
    && qualityLiftProbe.regressionDecision === "quality_lift_regression"
    && qualityLiftProbe.regressionComparisonDecision === "quality_lift_regression"
    && qualityLiftProbe.hasRegressionRecommendation
    && qualityLiftProbe.collectingStatus === "collecting"
    && qualityLiftProbe.collectingComparable === false
    && qualityLiftProbe.promptIncludesQualityLift
    && qualityLiftProbe.llmIncludesQualityLift
    && qualityLiftProbe.qualityLiftTextReady
    && qualityLiftProbe.qualityLiftRedacted
    && qualityLiftProbe.privacyAggregateOnly
    && qualityLiftSegmentsProbe.reportVersion === "v6-quality-lift-segments@1"
    && qualityLiftSegmentsProbe.sourceReportVersion === "v6-quality-lift@1"
    && qualityLiftSegmentsProbe.readinessStatus === "review"
    && qualityLiftSegmentsProbe.segmentCount >= 12
    && qualityLiftSegmentsProbe.readySegmentCount >= 8
    && qualityLiftSegmentsProbe.improvingSegmentCount >= 4
    && qualityLiftSegmentsProbe.regressingSegmentCount >= 4
    && qualityLiftSegmentsProbe.collectingSegmentCount >= 4
    && qualityLiftSegmentsProbe.hasToolDimension
    && qualityLiftSegmentsProbe.hasSiteDimension
    && qualityLiftSegmentsProbe.hasScenarioDimension
    && qualityLiftSegmentsProbe.hasModeDimension
    && qualityLiftSegmentsProbe.topImprovingKey === "chatgpt"
    && qualityLiftSegmentsProbe.topRegressingKey === "claude"
    && qualityLiftSegmentsProbe.hasCollectingSegment
    && qualityLiftSegmentsProbe.segmentTextReady
    && qualityLiftSegmentsProbe.segmentsRedacted
    && qualityLiftSegmentsProbe.privacyAggregateOnly
    && qualityLiftSegmentPolicyProbe.policyVersion === "v6-quality-lift-segment-policy@1"
    && qualityLiftSegmentPolicyProbe.sourceReportVersion === "v6-quality-lift-segments@1"
    && qualityLiftSegmentPolicyProbe.positiveDecision === "preserve_segment_winner"
    && qualityLiftSegmentPolicyProbe.positiveMatchedSegments >= 1
    && qualityLiftSegmentPolicyProbe.positivePlanDecision === "outcome_weight"
    && qualityLiftSegmentPolicyProbe.positivePreservesOutcomeWeight
    && qualityLiftSegmentPolicyProbe.regressionDecision === "segment_regression_guardrail"
    && qualityLiftSegmentPolicyProbe.regressionMatchedSegments >= 1
    && qualityLiftSegmentPolicyProbe.regressionSuppressesOutcomeWeight
    && qualityLiftSegmentPolicyProbe.regressionHasAvoidDirective
    && qualityLiftSegmentPolicyProbe.collectingDecision === "collect_segment_samples"
    && qualityLiftSegmentPolicyProbe.collectingMatchedSegments >= 1
    && qualityLiftSegmentPolicyProbe.collectingKeepsExploration
    && qualityLiftSegmentPolicyProbe.planPolicyVersion === "v6-quality-lift-segment-policy@1"
    && qualityLiftSegmentPolicyProbe.planTextMentionsPolicy
    && qualityLiftSegmentPolicyProbe.promptIncludesSegmentPolicy
    && qualityLiftSegmentPolicyProbe.llmIncludesSegmentPolicy
    && qualityLiftSegmentPolicyProbe.policyTextReady
    && qualityLiftSegmentPolicyProbe.policyRedacted
    && qualityLiftSegmentPolicyProbe.privacyAggregateOnly
    && failureReasonPolicyProbe.reportVersion === "v6-failure-reasons@1"
    && failureReasonPolicyProbe.policyVersion === "v6-failure-reason-policy@1"
    && failureReasonPolicyProbe.normalizedWrongFormat
    && failureReasonPolicyProbe.normalizedInsertFailure
    && failureReasonPolicyProbe.normalizedNeedsWork
    && failureReasonPolicyProbe.readinessStatus === "ready"
    && failureReasonPolicyProbe.topReason === "wrong_format"
    && failureReasonPolicyProbe.policyDecision === "strengthen_output_format"
    && failureReasonPolicyProbe.hasFormatDirective
    && failureReasonPolicyProbe.planPolicyVersion === "v6-failure-reason-policy@1"
    && failureReasonPolicyProbe.planHasFormatDirective
    && failureReasonPolicyProbe.planTextMentionsPolicy
    && failureReasonPolicyProbe.promptIncludesFailurePolicy
    && failureReasonPolicyProbe.llmIncludesFailurePolicy
    && failureReasonPolicyProbe.policyTextReady
    && failureReasonPolicyProbe.insertDecision === "reduce_insert_fragility"
    && failureReasonPolicyProbe.insertPlanSelectsGuardrail
    && failureReasonPolicyProbe.reportRedacted
    && failureReasonPolicyProbe.privacyAggregateOnly
    && selfImprovementProbe.reportVersion === "v6-self-improvement@1"
    && selfImprovementProbe.candidateVersion === "v6-evolution-candidates@1"
    && selfImprovementProbe.readinessStatus === "ready"
    && selfImprovementProbe.outcomeCount >= 3
    && selfImprovementProbe.hasPositiveReflection
    && selfImprovementProbe.hasRegressionReflection
    && selfImprovementProbe.hasCollectingReflection
    && selfImprovementProbe.hasPromoteCandidate
    && selfImprovementProbe.hasSuppressCandidate
    && selfImprovementProbe.hasFailureRepairCandidate
    && selfImprovementProbe.hasCollectCandidate
    && selfImprovementProbe.mutationGated
    && selfImprovementProbe.promptIncludesSelfImprovement
    && selfImprovementProbe.promptIncludesEvolutionCandidates
    && selfImprovementProbe.llmIncludesSelfImprovement
    && selfImprovementProbe.llmIncludesEvolutionCandidates
    && selfImprovementProbe.textReady
    && selfImprovementProbe.redacted
    && selfImprovementProbe.privacyAggregateOnly;
  const report = {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    pass,
    fixtureCount: results.length,
    averageScore: Math.round(averageScore * 1000) / 1000,
    byMode,
    structuredProbe,
    feedbackProfileProbe,
    qualityExperimentProbe,
    promptStrategyProbe,
    strategyExplorationProbe,
    strategyInsightsProbe,
    experimentOutcomeProbe,
    outcomeFeedbackProbe,
    scenarioLearningProbe,
    taskOutcomeProbe,
    strategyWeightProbe,
    qualityLiftProbe,
    qualityLiftSegmentsProbe,
    qualityLiftSegmentPolicyProbe,
    failureReasonPolicyProbe,
    selfImprovementProbe,
    privacy: {
      promptTextRedacted: true,
      inputTextRedacted: true,
      onlyHashesAndLengthsStored: true
    },
    results
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!pass) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main();
