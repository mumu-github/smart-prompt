"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { buildCard } = require("../../../packages/shared/smart-prompt-core");
const { DEFAULT_PRIVACY_FLAGS } = require("../../../packages/outcome-learning");
const { createStore } = require("../src/store");
const { createApp } = require("../src/server");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-learning-loop-"));
let nowMs = Date.parse("2026-07-19T08:00:00.000Z");
let randomCall = 0;
const now = () => new Date(nowMs).toISOString();
const generatedContexts = [];
const store = createStore(dataDir, {
  pendingOutcomeOptions: { now },
  learningOptions: {
    now,
    randomBytes(size) {
      randomCall += 1;
      return Buffer.alloc(size, randomCall % 251 || 1);
    }
  },
  policyOptions: { now },
  policyCompilerOptions: { now }
});
const app = createApp(store, {
  disableAuth: true,
  async generateWithLlm({ input, context, skills, variantIndex }) {
    generatedContexts.push(context);
    return {
      ...buildCard(input, context, skills, variantIndex),
      prompt: `Implement the requested change ${generatedContexts.length}.`,
      generatedBy: "llm",
      provider: "fixture",
      model: "gpt-4o-mini",
      tokenUsage: {
        source: "provider",
        inputTokens: 100,
        outputTokens: 30,
        cachedTokens: 10,
        reasoningTokens: 5
      }
    };
  }
});
const server = http.createServer(app);

async function request(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

async function completeOutcome(index, sessionId, options = {}) {
  const projectScopeToken = options.projectScopeToken || "project_alpha";
  const input = options.input || "Fix the deterministic fixture bug.";
  const taskScenario = options.taskScenario || "bug_fix";
  const outcomePrefix = options.outcomePrefix || "outcome";
  const eventId = options.outcomePrefix ? `verified_insert_${outcomePrefix}_${index}` : `verified_insert_${index}`;
  const askId = options.outcomePrefix ? `ask_${outcomePrefix}_${index}` : `ask_${index}`;
  const feedbackId = options.outcomePrefix ? `feedback_${outcomePrefix}_${index}` : `feedback_${index}`;
  const generation = await request("/generate", {
    method: "POST",
    body: {
      input,
      target: "codex",
      projectScopeToken,
      context: { target: "codex", tool: "codex", taskScenario, mode: "continue" }
    }
  });
  assert.equal(generation.status, 200);
  const card = generation.body.card;
  assert.ok(card.generationPolicy?.policyId);
  assert.equal(card.generationPolicy.arm, "stable");
  assert.equal(card.selfImprovementReport, undefined);

  const outcomeId = `${outcomePrefix}_${index}`;
  const event = {
    contractVersion: "prompt-session@2",
    eventId,
    eventType: "verified_insert",
    occurredAt: now(),
    sessionId,
    generationId: card.generationId,
    target: "codex",
    projectScopeToken,
    strategyId: "baseline",
    strategyVersion: "v1",
    modelFamilyToken: "gpt-4o-mini",
    outcomeId,
    policyId: card.generationPolicy.policyId,
    policyVersion: card.generationPolicy.version,
    taskOutcomeToken: "unknown",
    insertVerified: true,
    noAutoSubmit: true,
    failureReasonTokens: [],
    privacyFlags: { ...DEFAULT_PRIVACY_FLAGS }
  };
  store.recordVerifiedGenerationEditSummary({
    generationId: card.generationId,
    projectScopeToken,
    sessionId,
    policyId: card.generationPolicy.policyId,
    policyVersion: card.generationPolicy.version,
    editFeatureSummary: {
      userEdited: false,
      lengthDeltaBucket: "none",
      structureChanged: false
    }
  });
  const inserted = store.recordVerifiedInsertOutcome(event);
  assert.equal(inserted.created, true);
  nowMs += 60_000;
  const claim = await request("/outcomes/v2/claim", {
    method: "POST",
    body: { askId, target: "codex", projectScopeToken }
  });
  assert.equal(claim.body.result.outcome.outcomeId, outcomeId);
  const feedback = await request("/outcomes/v2/feedback", {
    method: "POST",
    body: { feedbackId, outcomeId, taskOutcomeToken: "completed" }
  });
  assert.equal(feedback.status, 200);
  assert.equal(feedback.body.result.outcome.status, "succeeded");
  assert.ok(feedback.body.learning?.observation);
  return feedback.body.learning;
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const forgedPromotion = await request("/learning/v1/promotion-evidence", {
      method: "POST",
      body: {
        artifactId: "forged_artifact",
        projectScopeToken: "project_alpha",
        sessionId: "forged_session",
        outcomeId: "forged_outcome",
        succeeded: true,
        payload: { policyId: "forged_policy", policyVersion: 99 },
        skillGates: { compilePassed: true, privacyPassed: true, sandboxPassed: true }
      }
    });
    assert.equal(forgedPromotion.status, 400);
    assert.equal(
      forgedPromotion.body.error.code,
      "promotion_evidence_server_derivation_required"
    );
    const untouchedProposals = await request("/learning/v1/global-proposals");
    assert.deepEqual(untouchedProposals.body.proposals, []);

    await completeOutcome(1, "session_a");
    await completeOutcome(2, "session_a");
    const threshold = await completeOutcome(3, "session_b");
    assert.ok(threshold.candidate);
    assert.equal(threshold.candidate.artifactType, "generation_policy");
    assert.equal(threshold.candidate.status, "pending_review");
    assert.equal(threshold.candidate.effective, false);

    assert.equal(generatedContexts.length, 3);
    for (const context of generatedContexts) {
      assert.ok(context.generationPolicy);
      assert.equal(context.selfImprovementText, undefined);
      assert.equal(context.evolutionCandidateText, undefined);
    }

    const semanticCandidateCases = [
      {
        artifactType: "memory",
        projectScopeToken: "project_memory_seed",
        outcomePrefix: "memory_outcome",
        input: "This project uses Tauri for its desktop shell.",
        taskScenario: "feature_development",
        patternToken: "memory_tauri"
      },
      {
        artifactType: "rule",
        projectScopeToken: "project_rule_seed",
        outcomePrefix: "rule_outcome",
        input: "Preserve existing changes while implementing the request.",
        taskScenario: "feature_development",
        patternToken: "rule_preserve_existing_changes"
      },
      {
        artifactType: "skill",
        projectScopeToken: "project_skill_seed",
        outcomePrefix: "skill_outcome",
        input: "Create a reusable workflow for recurring bug fixes.",
        taskScenario: "bug_fix",
        patternToken: "skill_bug_fix"
      }
    ];
    for (const fixture of semanticCandidateCases) {
      await completeOutcome(1, `${fixture.outcomePrefix}_session_a`, fixture);
      await completeOutcome(2, `${fixture.outcomePrefix}_session_a`, fixture);
      const semanticThreshold = await completeOutcome(3, `${fixture.outcomePrefix}_session_b`, fixture);
      assert.equal(semanticThreshold.candidate?.artifactType, fixture.artifactType);
      assert.equal(semanticThreshold.candidate?.status, "pending_review");
      assert.equal(semanticThreshold.candidate?.effective, false);
      const semanticArtifacts = await request(
        `/learning/v1/artifacts?projectScopeToken=${encodeURIComponent(fixture.projectScopeToken)}`
      );
      assert.equal(semanticArtifacts.body.artifacts.length, 1);
      const resolvedReminder = await request("/learning/v1/reminder/resolve", {
        method: "POST",
        body: {
          projectScopeToken: fixture.projectScopeToken,
          input: fixture.input,
          taskScenarioToken: fixture.taskScenario,
          modeToken: "continue"
        }
      });
      assert.equal(resolvedReminder.status, 200);
      assert.equal(
        resolvedReminder.body.reminder?.artifactId,
        semanticArtifacts.body.artifacts[0].artifactId
      );
      assert.ok(resolvedReminder.body.featureTokens.includes(`learning:${fixture.patternToken}`));
      const semanticFeatureTokens = [
        `scenario:${fixture.taskScenario}`,
        "mode:continue",
        "model:gpt-4o-mini",
        "target:codex",
        `learning:${fixture.patternToken}`
      ];
      const semanticFeatureQuery = semanticFeatureTokens
        .map((token) => `featureToken=${encodeURIComponent(token)}`)
        .join("&");
      const semanticReminder = await request(
        `/learning/v1/reminder?projectScopeToken=${encodeURIComponent(fixture.projectScopeToken)}&${semanticFeatureQuery}`
      );
      assert.equal(
        semanticReminder.body.reminder?.artifactId,
        semanticArtifacts.body.artifacts[0].artifactId
      );
    }

    const inferredScenarioReminder = await request("/learning/v1/reminder/resolve", {
      method: "POST",
      body: {
        projectScopeToken: "project_inferred_scenario",
        input: "Use this standard process whenever a review repeats.",
        modeToken: "continue"
      }
    });
    assert.equal(inferredScenarioReminder.status, 200);
    assert.ok(inferredScenarioReminder.body.featureTokens.includes("scenario:code-review"));
    assert.ok(inferredScenarioReminder.body.featureTokens.includes("learning:skill_code_review"));

    const pathScopeRejected = await request("/generate", {
      method: "POST",
      body: {
        input: "Do not persist this path.",
        target: "codex",
        projectScopeToken: "C:\\Users\\private\\project",
        context: { target: "codex", tool: "codex", taskScenario: "bug_fix" }
      }
    });
    assert.equal(pathScopeRejected.status, 400);
    assert.equal(pathScopeRejected.body.error.code, "invalid_project_scope_token");

    const artifacts = await request("/learning/v1/artifacts?projectScopeToken=project_alpha");
    assert.equal(artifacts.status, 200);
    assert.equal(artifacts.body.artifacts.length, 1);
    const artifactId = artifacts.body.artifacts[0].artifactId;

    const featureQuery = [
      "scenario:bug_fix",
      "mode:continue",
      "model:gpt-4o-mini",
      "target:codex"
    ].map((token) => `featureToken=${encodeURIComponent(token)}`).join("&");
    const reminder = await request(`/learning/v1/reminder?projectScopeToken=project_alpha&${featureQuery}`);
    assert.equal(reminder.body.reminder.artifactId, artifactId);

    for (let index = 1; index <= 3; index += 1) {
      const ignored = await request("/learning/v1/candidates/ignore", {
        method: "POST",
        body: { artifactId }
      });
      assert.equal(ignored.status, 200);
      assert.equal(ignored.body.candidate.review.ignoredCount, index);
    }
    const hiddenReminder = await request(`/learning/v1/reminder?projectScopeToken=project_alpha&${featureQuery}`);
    assert.equal(hiddenReminder.body.reminder, null);
    const stillGoverned = await request(`/learning/v1/candidate?artifactId=${encodeURIComponent(artifactId)}`);
    assert.equal(stillGoverned.status, 200);

    const accepted = await request("/learning/v1/candidates/review", {
      method: "POST",
      body: { artifactId, decision: { action: "accept" } }
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.candidate.status, "active");
    assert.equal(accepted.body.candidate.effective, false, "accepted policy candidates remain ineffective before benchmark and canary");

    const policies = await request("/policies/v1?projectScopeToken=project_alpha");
    assert.equal(policies.status, 200);
    assert.equal(policies.body.policies.filter((policy) => policy.status === "stable").length, 1);
    assert.equal(policies.body.policies.filter((policy) => policy.status === "draft").length, 1);
    const baseline = policies.body.policies.find((policy) => policy.status === "stable");
    const candidatePolicy = policies.body.policies.find((policy) => policy.status === "draft");
    assert.equal(candidatePolicy.policyId, baseline.policyId);
    assert.equal(candidatePolicy.baselineVersion, baseline.version);
    assert.equal(candidatePolicy.version, baseline.version + 1);

    const publicObservations = await request("/learning/v1/observations?projectScopeToken=project_alpha");
    assert.equal(publicObservations.body.observations.length, 3);
    assert.ok(publicObservations.body.observations.every((observation) => (
      observation.semanticFingerprint.exportable === false
        && !Object.hasOwn(observation.semanticFingerprint, "valueToken")
        && !Object.hasOwn(observation.semanticFingerprint, "algorithm")
    )));

    const cleared = await request("/privacy/v1/projects/clear", {
      method: "POST",
      body: { projectScopeToken: "project_alpha" }
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.result.counts.observations, 3);
    assert.equal(cleared.body.result.counts.policies, 2);
    assert.equal(cleared.body.result.counts.promptHistory, 3);
    assert.ok(store.getPromptHistory().every((entry) => (
      entry.context?.projectScopeToken !== "project_alpha"
    )));
    assert.doesNotMatch(JSON.stringify(cleared.body), new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

    const afterClear = await request("/learning/v1/artifacts?projectScopeToken=project_alpha");
    assert.deepEqual(afterClear.body.artifacts, []);
    const replayedFeedback = await request("/outcomes/v2/feedback", {
      method: "POST",
      body: {
        feedbackId: "feedback_3",
        outcomeId: "outcome_3",
        taskOutcomeToken: "completed"
      }
    });
    assert.equal(replayedFeedback.status, 200);
    assert.equal(replayedFeedback.body.result.state, "invalidated");
    assert.equal(replayedFeedback.body.result.outcome.status, "invalidated");
    assert.equal(replayedFeedback.body.learning, null);

    const newFeedbackAfterClear = await request("/outcomes/v2/feedback", {
      method: "POST",
      body: {
        feedbackId: "feedback_3_after_clear",
        outcomeId: "outcome_3",
        taskOutcomeToken: "completed"
      }
    });
    assert.equal(newFeedbackAfterClear.status, 409);
    assert.equal(newFeedbackAfterClear.body.error.code, "outcome_feedback_conflict");
    const observationsAfterReplay = await request("/learning/v1/observations?projectScopeToken=project_alpha");
    assert.deepEqual(observationsAfterReplay.body.observations, []);
    const rolledBack = await request("/policies/v1?projectScopeToken=project_alpha");
    assert.ok(rolledBack.body.policies.every((policy) => policy.status === "rolled_back"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("learning loop integration tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
