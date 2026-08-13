Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $Root

node scripts/check-v6-prompt-quality.js
node scripts/check-v6-pilot-outcomes.js

Push-Location apps/local-service
try {
  npm test
} finally {
  Pop-Location
}

Push-Location prototypes/browser-extension
try {
  npm test
} finally {
  Pop-Location
}

Push-Location apps/desktop-shell
try {
  npm test
} finally {
  Pop-Location
}

$Report = Get-Content -Raw -Path (Join-Path $Root "research/v6-prompt-quality.latest.json") | ConvertFrom-Json
if (-not $Report.pass) {
  throw "V6 prompt quality report did not pass."
}
if ($Report.fixtureCount -lt 30) {
  throw "V6 prompt quality fixture count is below 30."
}
if (-not $Report.structuredProbe.structured -or -not $Report.structuredProbe.keysPresent) {
  throw "V6 structured output probe did not pass."
}
if (-not $Report.feedbackProfileProbe.hasAdaptiveDirectives -or -not $Report.feedbackProfileProbe.promptIncludesGuidance -or -not $Report.feedbackProfileProbe.profileTextRedacted) {
  throw "V6 feedback profile probe did not pass."
}
if (-not $Report.qualityExperimentProbe.hasGenerationId -or -not $Report.qualityExperimentProbe.hasStrategyId -or -not $Report.qualityExperimentProbe.carriesQualityScore -or -not $Report.qualityExperimentProbe.linksFeedbackDirectives -or -not $Report.qualityExperimentProbe.experimentTextRedacted) {
  throw "V6 quality experiment probe did not pass."
}
if ($Report.promptStrategyProbe.policyVersion -ne "v6-strategy-policy@3" -or $Report.promptStrategyProbe.selectedStrategy -ne "preserve_winning_strategy" -or $Report.promptStrategyProbe.selectedDecision -ne "exploit" -or -not $Report.promptStrategyProbe.hasWinningCandidate -or -not $Report.promptStrategyProbe.winningCandidateReliable -or -not $Report.promptStrategyProbe.winningCandidateCohortMatched -or -not $Report.promptStrategyProbe.hasAvoidRiskDirective -or -not $Report.promptStrategyProbe.promptIncludesStrategyPlan -or -not $Report.promptStrategyProbe.experimentUsesStrategy -or -not $Report.promptStrategyProbe.strategyTextRedacted) {
  throw "V6 prompt strategy probe did not pass."
}
if ($Report.strategyExplorationProbe.policyVersion -ne "v6-strategy-policy@3" -or $Report.strategyExplorationProbe.selectedStrategy -ne "cold_start_structure" -or $Report.strategyExplorationProbe.selectedDecision -ne "explore" -or -not $Report.strategyExplorationProbe.lowSampleCandidate -or -not $Report.strategyExplorationProbe.lowSampleNotReliable -or -not $Report.strategyExplorationProbe.explorationEnabled -or -not $Report.strategyExplorationProbe.explorationCandidate -or -not $Report.strategyExplorationProbe.hasSampleGuardDirective -or -not $Report.strategyExplorationProbe.promptIncludesExplorationPolicy -or -not $Report.strategyExplorationProbe.experimentCarriesVersion -or -not $Report.strategyExplorationProbe.strategyTextRedacted) {
  throw "V6 strategy exploration probe did not pass."
}
if ($Report.strategyInsightsProbe.insightVersion -ne "v6-strategy-insights@1" -or $Report.strategyInsightsProbe.policyVersion -ne "v6-strategy-policy@3" -or $Report.strategyInsightsProbe.readinessStatus -ne "ready" -or -not $Report.strategyInsightsProbe.hasReliableWinner -or -not $Report.strategyInsightsProbe.hasLowSampleCandidate -or -not $Report.strategyInsightsProbe.hasRiskSignal -or -not $Report.strategyInsightsProbe.hasModeToolAdapterSiteCohorts -or -not $Report.strategyInsightsProbe.hasRecommendations -or -not $Report.strategyInsightsProbe.promptIncludesStrategyInsights -or -not $Report.strategyInsightsProbe.insightTextMentionsSamples -or -not $Report.strategyInsightsProbe.insightsTextRedacted -or -not $Report.strategyInsightsProbe.privacyAggregateOnly) {
  throw "V6 strategy insights probe did not pass."
}
if ($Report.experimentOutcomeProbe.assignmentVersion -ne "v6-prompt-experiment@1" -or $Report.experimentOutcomeProbe.assignmentArm -ne "strategy_guided" -or -not $Report.experimentOutcomeProbe.assignmentEligible -or -not $Report.experimentOutcomeProbe.assignmentHasBucket -or -not $Report.experimentOutcomeProbe.assignmentHasComparisonKey -or $Report.experimentOutcomeProbe.experimentVersion -ne "v6-prompt-experiment-1" -or $Report.experimentOutcomeProbe.experimentArm -ne "strategy_guided" -or -not $Report.experimentOutcomeProbe.experimentCarriesComparisonKey -or -not $Report.experimentOutcomeProbe.experimentCarriesStrategyInsights -or $Report.experimentOutcomeProbe.outcomeVersion -ne "v6-prompt-experiment@1" -or $Report.experimentOutcomeProbe.outcomeReadiness -ne "ready" -or -not $Report.experimentOutcomeProbe.outcomeComparable -or -not $Report.experimentOutcomeProbe.hasBaselineArm -or -not $Report.experimentOutcomeProbe.hasStrategyGuidedArm -or -not $Report.experimentOutcomeProbe.comparisonReady -or -not $Report.experimentOutcomeProbe.comparisonShowsGuidedLift -or -not $Report.experimentOutcomeProbe.hasOutcomeRecommendation -or -not $Report.experimentOutcomeProbe.outcomeTextRedacted -or -not $Report.experimentOutcomeProbe.privacyAggregateOnly) {
  throw "V6 experiment outcome probe did not pass."
}
if ($Report.outcomeFeedbackProbe.winningPolicyVersion -ne "v6-strategy-policy@3" -or -not $Report.outcomeFeedbackProbe.winningOutcomeReady -or $Report.outcomeFeedbackProbe.winningDecision -ne "prefer_strategy_guided" -or $Report.outcomeFeedbackProbe.winningRecommendation -ne "prefer_strategy_guided" -or -not $Report.outcomeFeedbackProbe.winningSelectsStrategy -or -not $Report.outcomeFeedbackProbe.winningHasOutcomeDirective -or -not $Report.outcomeFeedbackProbe.winningTextMentionsOutcome -or -not $Report.outcomeFeedbackProbe.promptIncludesExperimentOutcomes -or -not $Report.outcomeFeedbackProbe.losingOutcomeReady -or $Report.outcomeFeedbackProbe.losingDecision -ne "prefer_baseline" -or $Report.outcomeFeedbackProbe.losingRecommendation -ne "prefer_baseline_until_reviewed" -or -not $Report.outcomeFeedbackProbe.losingSelectsBaseline -or -not $Report.outcomeFeedbackProbe.losingHasBaselineDirective -or -not $Report.outcomeFeedbackProbe.losingTextMentionsOutcome -or -not $Report.outcomeFeedbackProbe.outcomeFeedbackRedacted -or -not $Report.outcomeFeedbackProbe.privacyAggregateOnly) {
  throw "V6 outcome feedback probe did not pass."
}
if ($Report.scenarioLearningProbe.inferredScenario -ne "security-review" -or $Report.scenarioLearningProbe.feedbackCohortScenario -ne "security-review" -or $Report.scenarioLearningProbe.insightsCohortScenario -ne "security-review" -or $Report.scenarioLearningProbe.outcomeCohortScenario -ne "security-review" -or $Report.scenarioLearningProbe.assignmentCohortScenario -ne "security-review" -or $Report.scenarioLearningProbe.experimentTaskScenario -ne "security-review" -or -not $Report.scenarioLearningProbe.hasScenarioCohorts -or -not $Report.scenarioLearningProbe.scenarioWinnerSelected -or -not $Report.scenarioLearningProbe.scenarioCandidateMatched -or -not $Report.scenarioLearningProbe.uiStrategyExcludedFromScenarioSource -or -not $Report.scenarioLearningProbe.comparisonKeyIncludesScenario -or -not $Report.scenarioLearningProbe.outcomeUsesScenarioArms -or -not $Report.scenarioLearningProbe.promptIncludesScenario -or -not $Report.scenarioLearningProbe.llmContextScenarioReady -or -not $Report.scenarioLearningProbe.scenarioTextRedacted) {
  throw "V6 scenario learning probe did not pass."
}
if ($Report.taskOutcomeProbe.reportVersion -ne "v6-task-outcome@1" -or $Report.taskOutcomeProbe.readinessStatus -ne "ready" -or $Report.taskOutcomeProbe.outcomeCount -lt 9 -or -not $Report.taskOutcomeProbe.hasOutcomeWinner -or -not $Report.taskOutcomeProbe.hasOutcomeRisk -or $Report.taskOutcomeProbe.recommendation -ne "prefer_task_outcome_winner" -or $Report.taskOutcomeProbe.planPolicyDecision -ne "prefer_task_outcome_winner" -or -not $Report.taskOutcomeProbe.planSelectsOutcomeWinner -or -not $Report.taskOutcomeProbe.hasOutcomeDirective -or -not $Report.taskOutcomeProbe.promptIncludesTaskOutcomes -or -not $Report.taskOutcomeProbe.taskOutcomeTextReady -or -not $Report.taskOutcomeProbe.taskOutcomeRedacted -or -not $Report.taskOutcomeProbe.privacyAggregateOnly) {
  throw "V6 task outcome probe did not pass."
}
if ($Report.strategyWeightProbe.weightVersion -ne "v6-strategy-weighting@1" -or $Report.strategyWeightProbe.pilotVersion -ne "v6-pilot-outcome-readiness@1" -or $Report.strategyWeightProbe.readinessStatus -ne "ready" -or [int]$Report.strategyWeightProbe.totalOutcomeEvents -lt 7 -or [int]$Report.strategyWeightProbe.promotedCount -lt 1 -or [int]$Report.strategyWeightProbe.suppressedCount -lt 1 -or [int]$Report.strategyWeightProbe.exploringCount -lt 1 -or $Report.strategyWeightProbe.selectedPromotion -ne "llm:continue:medium:security-weight-winner" -or $Report.strategyWeightProbe.selectedSuppression -ne "llm:continue:medium:security-weight-risk" -or $Report.strategyWeightProbe.planPolicyWeightVersion -ne "v6-strategy-weighting@1" -or $Report.strategyWeightProbe.planDecision -ne "outcome_weight" -or -not $Report.strategyWeightProbe.planSelectsWeightedWinner -or -not $Report.strategyWeightProbe.hasPromotionDirective -or -not $Report.strategyWeightProbe.hasSuppressionDirective -or -not $Report.strategyWeightProbe.hasExplorationDirective -or -not $Report.strategyWeightProbe.promptIncludesStrategyWeights -or -not $Report.strategyWeightProbe.llmIncludesStrategyWeights -or -not $Report.strategyWeightProbe.weightTextReady -or -not $Report.strategyWeightProbe.strategyWeightRedacted -or -not $Report.strategyWeightProbe.privacyAggregateOnly) {
  throw "V6 strategy weight probe did not pass."
}
if ($Report.qualityLiftProbe.reportVersion -ne "v6-quality-lift@1" -or $Report.qualityLiftProbe.readinessStatus -ne "ready" -or -not $Report.qualityLiftProbe.comparable -or $Report.qualityLiftProbe.primaryDecision -ne "quality_lift_positive" -or [int]$Report.qualityLiftProbe.baselineOutcomeCount -lt 3 -or [int]$Report.qualityLiftProbe.strategyGuidedOutcomeCount -lt 3 -or [int]$Report.qualityLiftProbe.outcomeWeightedOutcomeCount -lt 3 -or -not $Report.qualityLiftProbe.hasAllCohorts -or -not $Report.qualityLiftProbe.positiveSuccessLift -or -not $Report.qualityLiftProbe.positiveAvgLift -or -not $Report.qualityLiftProbe.reducedRetryUndo -or -not $Report.qualityLiftProbe.hasKeepRecommendation -or $Report.qualityLiftProbe.regressionStatus -ne "regression" -or $Report.qualityLiftProbe.regressionDecision -ne "quality_lift_regression" -or $Report.qualityLiftProbe.regressionComparisonDecision -ne "quality_lift_regression" -or -not $Report.qualityLiftProbe.hasRegressionRecommendation -or $Report.qualityLiftProbe.collectingStatus -ne "collecting" -or $Report.qualityLiftProbe.collectingComparable -ne $false -or -not $Report.qualityLiftProbe.promptIncludesQualityLift -or -not $Report.qualityLiftProbe.llmIncludesQualityLift -or -not $Report.qualityLiftProbe.qualityLiftTextReady -or -not $Report.qualityLiftProbe.qualityLiftRedacted -or -not $Report.qualityLiftProbe.privacyAggregateOnly) {
  throw "V6 quality lift probe did not pass."
}
if ($Report.qualityLiftSegmentsProbe.reportVersion -ne "v6-quality-lift-segments@1" -or $Report.qualityLiftSegmentsProbe.sourceReportVersion -ne "v6-quality-lift@1" -or $Report.qualityLiftSegmentsProbe.readinessStatus -ne "review" -or [int]$Report.qualityLiftSegmentsProbe.segmentCount -lt 12 -or [int]$Report.qualityLiftSegmentsProbe.readySegmentCount -lt 8 -or [int]$Report.qualityLiftSegmentsProbe.improvingSegmentCount -lt 4 -or [int]$Report.qualityLiftSegmentsProbe.regressingSegmentCount -lt 4 -or [int]$Report.qualityLiftSegmentsProbe.collectingSegmentCount -lt 4 -or -not $Report.qualityLiftSegmentsProbe.hasToolDimension -or -not $Report.qualityLiftSegmentsProbe.hasSiteDimension -or -not $Report.qualityLiftSegmentsProbe.hasScenarioDimension -or -not $Report.qualityLiftSegmentsProbe.hasModeDimension -or $Report.qualityLiftSegmentsProbe.topImprovingKey -ne "chatgpt" -or $Report.qualityLiftSegmentsProbe.topRegressingKey -ne "claude" -or -not $Report.qualityLiftSegmentsProbe.hasCollectingSegment -or -not $Report.qualityLiftSegmentsProbe.segmentTextReady -or -not $Report.qualityLiftSegmentsProbe.segmentsRedacted -or -not $Report.qualityLiftSegmentsProbe.privacyAggregateOnly) {
  throw "V6 quality lift segments probe did not pass."
}
if ($Report.qualityLiftSegmentPolicyProbe.policyVersion -ne "v6-quality-lift-segment-policy@1" -or $Report.qualityLiftSegmentPolicyProbe.sourceReportVersion -ne "v6-quality-lift-segments@1" -or $Report.qualityLiftSegmentPolicyProbe.positiveDecision -ne "preserve_segment_winner" -or [int]$Report.qualityLiftSegmentPolicyProbe.positiveMatchedSegments -lt 1 -or $Report.qualityLiftSegmentPolicyProbe.positivePlanDecision -ne "outcome_weight" -or -not $Report.qualityLiftSegmentPolicyProbe.positivePreservesOutcomeWeight -or $Report.qualityLiftSegmentPolicyProbe.regressionDecision -ne "segment_regression_guardrail" -or [int]$Report.qualityLiftSegmentPolicyProbe.regressionMatchedSegments -lt 1 -or -not $Report.qualityLiftSegmentPolicyProbe.regressionSuppressesOutcomeWeight -or -not $Report.qualityLiftSegmentPolicyProbe.regressionHasAvoidDirective -or $Report.qualityLiftSegmentPolicyProbe.collectingDecision -ne "collect_segment_samples" -or [int]$Report.qualityLiftSegmentPolicyProbe.collectingMatchedSegments -lt 1 -or -not $Report.qualityLiftSegmentPolicyProbe.collectingKeepsExploration -or $Report.qualityLiftSegmentPolicyProbe.planPolicyVersion -ne "v6-quality-lift-segment-policy@1" -or -not $Report.qualityLiftSegmentPolicyProbe.planTextMentionsPolicy -or -not $Report.qualityLiftSegmentPolicyProbe.promptIncludesSegmentPolicy -or -not $Report.qualityLiftSegmentPolicyProbe.llmIncludesSegmentPolicy -or -not $Report.qualityLiftSegmentPolicyProbe.policyTextReady -or -not $Report.qualityLiftSegmentPolicyProbe.policyRedacted -or -not $Report.qualityLiftSegmentPolicyProbe.privacyAggregateOnly) {
  throw "V6 quality lift segment policy probe did not pass."
}
if ($Report.failureReasonPolicyProbe.reportVersion -ne "v6-failure-reasons@1" -or $Report.failureReasonPolicyProbe.policyVersion -ne "v6-failure-reason-policy@1" -or -not $Report.failureReasonPolicyProbe.normalizedWrongFormat -or -not $Report.failureReasonPolicyProbe.normalizedInsertFailure -or -not $Report.failureReasonPolicyProbe.normalizedNeedsWork -or $Report.failureReasonPolicyProbe.readinessStatus -ne "ready" -or $Report.failureReasonPolicyProbe.topReason -ne "wrong_format" -or $Report.failureReasonPolicyProbe.policyDecision -ne "strengthen_output_format" -or -not $Report.failureReasonPolicyProbe.hasFormatDirective -or $Report.failureReasonPolicyProbe.planPolicyVersion -ne "v6-failure-reason-policy@1" -or -not $Report.failureReasonPolicyProbe.planHasFormatDirective -or -not $Report.failureReasonPolicyProbe.planTextMentionsPolicy -or -not $Report.failureReasonPolicyProbe.promptIncludesFailurePolicy -or -not $Report.failureReasonPolicyProbe.llmIncludesFailurePolicy -or -not $Report.failureReasonPolicyProbe.policyTextReady -or $Report.failureReasonPolicyProbe.insertDecision -ne "reduce_insert_fragility" -or -not $Report.failureReasonPolicyProbe.insertPlanSelectsGuardrail -or -not $Report.failureReasonPolicyProbe.reportRedacted -or -not $Report.failureReasonPolicyProbe.privacyAggregateOnly) {
  throw "V6 failure reason policy probe did not pass."
}
if ($Report.selfImprovementProbe.reportVersion -ne "v6-self-improvement@1" -or $Report.selfImprovementProbe.candidateVersion -ne "v6-evolution-candidates@1" -or $Report.selfImprovementProbe.readinessStatus -ne "ready" -or [int]$Report.selfImprovementProbe.outcomeCount -lt 3 -or -not $Report.selfImprovementProbe.hasPositiveReflection -or -not $Report.selfImprovementProbe.hasRegressionReflection -or -not $Report.selfImprovementProbe.hasCollectingReflection -or -not $Report.selfImprovementProbe.hasPromoteCandidate -or -not $Report.selfImprovementProbe.hasSuppressCandidate -or -not $Report.selfImprovementProbe.hasFailureRepairCandidate -or -not $Report.selfImprovementProbe.hasCollectCandidate -or -not $Report.selfImprovementProbe.mutationGated -or -not $Report.selfImprovementProbe.promptIncludesSelfImprovement -or -not $Report.selfImprovementProbe.promptIncludesEvolutionCandidates -or -not $Report.selfImprovementProbe.llmIncludesSelfImprovement -or -not $Report.selfImprovementProbe.llmIncludesEvolutionCandidates -or -not $Report.selfImprovementProbe.textReady -or -not $Report.selfImprovementProbe.redacted -or -not $Report.selfImprovementProbe.privacyAggregateOnly) {
  throw "V6 self-improvement loop probe did not pass."
}

$Pilot = Get-Content -Raw -Path (Join-Path $Root "research/v6-pilot-outcome-readiness.latest.json") | ConvertFrom-Json
if (-not $Pilot.pass -or $Pilot.report.reportVersion -ne "v6-pilot-outcome-readiness@1" -or $Pilot.report.readiness.status -ne "ready" -or [int]$Pilot.report.readiness.totalOutcomeEvents -lt 7) {
  throw "V6 pilot outcome readiness report did not pass."
}
$PilotSecurityWinner = @($Pilot.report.byTaskScenario | Where-Object { $_.key -eq "security-review" -and $_.status -eq "ready" -and [double]$_.outcomeSuccessRate -ge 0.99 })
$PilotUiRisk = @($Pilot.report.byTaskScenario | Where-Object { $_.key -eq "ui-ux" -and $_.status -eq "ready" -and [double]$_.outcomeSuccessRate -eq 0 })
$PilotDataCollecting = @($Pilot.report.byTaskScenario | Where-Object { $_.key -eq "data-analysis" -and $_.status -eq "collecting" -and [int]$_.neededOutcomeEvents -ge 1 })
$PilotGeneralEmpty = @($Pilot.report.byTaskScenario | Where-Object { $_.key -eq "general" -and $_.status -eq "empty" })
$PilotWinningStrategy = @($Pilot.report.winningStrategies | Where-Object { $_.key -eq "llm:continue:medium:security-winner" })
$PilotRiskStrategy = @($Pilot.report.riskStrategies | Where-Object { $_.key -eq "llm:continue:medium:ui-risk" })
$PilotCollectionTarget = @($Pilot.report.collectionTargets | Where-Object { $_.dimension -eq "taskScenario" -and $_.key -eq "data-analysis" })
$PilotChatGptTool = @($Pilot.report.byTool | Where-Object { $_.key -eq "chatgpt" -and [int]$_.outcomeCount -eq 3 })
$PilotChatGptSite = @($Pilot.report.bySite | Where-Object { $_.key -eq "chatgpt.com" -and [int]$_.outcomeCount -eq 3 })
$PilotStrategyArm = @($Pilot.report.byExperimentArm | Where-Object { $_.key -eq "strategy_guided" -and [int]$_.outcomeCount -eq 6 })
if ($PilotSecurityWinner.Count -lt 1 -or $PilotUiRisk.Count -lt 1 -or $PilotDataCollecting.Count -lt 1 -or $PilotGeneralEmpty.Count -lt 1 -or $PilotWinningStrategy.Count -lt 1 -or $PilotRiskStrategy.Count -lt 1 -or $PilotCollectionTarget.Count -lt 1 -or $PilotChatGptTool.Count -lt 1 -or $PilotChatGptSite.Count -lt 1 -or $PilotStrategyArm.Count -lt 1) {
  throw "V6 pilot outcome readiness cohorts did not pass."
}
if (-not $Pilot.report.privacy.aggregateOnly -or -not ($Pilot.text -match "privacy=aggregate-only")) {
  throw "V6 pilot outcome readiness privacy flags did not pass."
}
$PilotJson = $Pilot | ConvertTo-Json -Depth 30
if ($PilotJson -match "SECRET_PROMPT_TEXT|SECRET_INPUT_TEXT|SECRET_PAGE_BODY|private/path|project/private") {
  throw "V6 pilot outcome readiness report leaked sensitive source text."
}

Write-Output "V6_PROMPT_QUALITY_PASS"
