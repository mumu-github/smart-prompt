"use strict";

const fs = require("node:fs");
const path = require("node:path");
const contracts = require("../../../../../packages/outcome-learning");
const {
  assertOpaqueToken,
  assertPrivacySafeInput,
  assertTokenArray,
  codedError,
  createProjectHmacKeys,
  createRandomBytesSource
} = require("./privacy");

const STORE_SCHEMA_VERSION = "learning-artifacts-store@1";
const ARCHIVE_SCHEMA_VERSION = "learning-project-archive@1";
const GLOBAL_PROMOTION_TYPES = new Set(["memory", "rule", "skill"]);
const ARTIFACT_TYPES = new Set(contracts.ENUMS.artifactType);
const DEFAULT_SKILL_GATES = Object.freeze({
  permission: false,
  isolation: false,
  static: false,
  adversarial: false
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function defaultState() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    observations: [],
    candidateEvidence: [],
    artifacts: [],
    promotionEvidence: [],
    proposals: [],
    invalidations: []
  };
}

function normalizeClockValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw codedError("invalid_learning_clock", "The injected learning clock returned an invalid value.");
  return date.toISOString();
}

function normalizeSkillGates(value, payload = {}) {
  if (value !== undefined && value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw codedError("invalid_skill_gates", "Skill gates must be an object of finite boolean decisions.");
  }
  const source = value || {};
  const allowed = new Set(Object.keys(DEFAULT_SKILL_GATES));
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    throw codedError("invalid_skill_gates", "Skill gates contain an unsupported decision.");
  }
  if (Object.values(source).some((item) => typeof item !== "boolean")) {
    throw codedError("invalid_skill_gates", "Skill gate decisions must be boolean.");
  }
  return {
    permission: typeof source.permission === "boolean" ? source.permission : payload.permissionCheckPassed === true,
    isolation: typeof source.isolation === "boolean" ? source.isolation : payload.isolationTestPassed === true,
    static: typeof source.static === "boolean" ? source.static : false,
    adversarial: typeof source.adversarial === "boolean" ? source.adversarial : payload.adversarialReviewPassed === true
  };
}

function allSkillGatesPassed(gates) {
  return Object.keys(DEFAULT_SKILL_GATES).every((key) => gates?.[key] === true);
}

function withSkillGates(payload, gates) {
  if (payload?.scriptsExecutable !== false) {
    throw codedError("skill_scripts_not_executable", "Generated Skill scripts must remain non-executable.");
  }
  return {
    ...clone(payload),
    scriptsExecutable: false,
    permissionCheckPassed: gates.permission,
    isolationTestPassed: gates.isolation,
    adversarialReviewPassed: gates.adversarial
  };
}

function permissionsForType(artifactType) {
  return {
    execution: artifactType === "skill" ? "review_required" : "none",
    scopeExpansion: "user_confirmation_required"
  };
}

function mapTaskOutcome(input) {
  if (input.taskOutcomeToken) return input.taskOutcomeToken;
  if (input.outcomeStatus === "succeeded") return "completed";
  if (input.outcomeStatus === "failed") return "not_completed";
  if (input.outcomeStatus === "expired_unknown") return "expired_unknown";
  if (input.outcomeStatus === "invalidated") return "invalidated";
  return "unknown";
}

function createLearningArtifactStore(dataDir, options = {}) {
  if (typeof dataDir !== "string" || dataDir.length === 0) throw new TypeError("dataDir is required.");
  fs.mkdirSync(dataDir, { recursive: true });

  const stateFile = path.join(dataDir, "learning-artifacts-v1.json");
  const archiveRoot = path.join(dataDir, "learning-archive");
  const randomBytes = createRandomBytesSource(options);
  const hmacKeys = createProjectHmacKeys(dataDir, randomBytes);
  const clock = typeof options.now === "function" ? options.now : () => new Date();
  let idSequence = 0;

  function now() {
    return normalizeClockValue(clock());
  }

  function createId(prefix) {
    idSequence += 1;
    return `${prefix}_${randomBytes(9).toString("hex")}_${idSequence}`;
  }

  function readState() {
    if (!fs.existsSync(stateFile)) return defaultState();
    let state;
    try {
      state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      throw codedError("invalid_learning_state", "The learning state file could not be parsed and was not replaced.");
    }
    if (!state || state.schemaVersion !== STORE_SCHEMA_VERSION) {
      throw codedError("invalid_learning_state", "The learning state version is unsupported and was not replaced.");
    }
    for (const field of ["observations", "candidateEvidence", "artifacts", "promotionEvidence", "proposals", "invalidations"]) {
      if (!Array.isArray(state[field])) {
        throw codedError("invalid_learning_state", `The learning state field ${field} is invalid and was not replaced.`);
      }
    }
    return state;
  }

  function persistState(state) {
    writeJson(stateFile, state);
  }

  function validateArtifactPayload(artifactType, payload, projectScopeToken, timestamp, skillGates) {
    if (!ARTIFACT_TYPES.has(artifactType)) {
      throw codedError("invalid_artifact_type", `Unsupported learning artifact type: ${artifactType}`);
    }
    let normalizedPayload = clone(payload);
    let normalizedGates = null;
    if (artifactType === "skill") {
      normalizedGates = normalizeSkillGates(skillGates, normalizedPayload);
      normalizedPayload = withSkillGates(normalizedPayload, normalizedGates);
    }
    const validationArtifact = {
      contractVersion: contracts.CONTRACT_VERSIONS[contracts.CONTRACTS.LEARNING_ARTIFACT],
      artifactId: "payload_validation",
      artifactType,
      status: "pending_review",
      scope: { kind: "project", projectScopeToken },
      payload: normalizedPayload,
      evidenceSummary: {
        sessionCount: 0,
        successfulOutcomeCount: 0,
        explicitNegativeFeedbackCount: 0,
        evidenceTokenCount: 0
      },
      permissions: permissionsForType(artifactType),
      review: { required: true, decision: "pending", ignoredCount: 0 },
      autoCreated: false,
      effective: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacyFlags: clone(contracts.DEFAULT_PRIVACY_FLAGS)
    };
    contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, validationArtifact);
    return { payload: normalizedPayload, skillGates: normalizedGates };
  }

  function buildObservation(input, fingerprintValueToken, timestamp) {
    const tokenFields = ["inputTokens", "outputTokens", "cachedTokens", "reasoningTokens", "insertedPromptTokenEstimate"];
    const observation = {
      contractVersion: contracts.CONTRACT_VERSIONS[contracts.CONTRACTS.LEARNING_OBSERVATION],
      observationId: input.observationId || createId("observation"),
      projectScopeToken: input.projectScopeToken,
      taskScenarioToken: input.taskScenarioToken || "unknown_scenario",
      modeToken: input.modeToken || "standard",
      strategyId: input.strategyId || "baseline",
      strategyVersion: input.strategyVersion || "v1",
      modelFamilyToken: input.modelFamilyToken || "unknown_model",
      contextSourceTokens: clone(input.contextSourceTokens || []),
      editFeatureSummary: {
        userEdited: input.editFeatureSummary?.userEdited === true,
        lengthDeltaBucket: input.editFeatureSummary?.lengthDeltaBucket || "none",
        structureChanged: input.editFeatureSummary?.structureChanged === true
      },
      insertVerified: input.insertVerified === true,
      retryCount: input.retryCount === undefined ? 0 : input.retryCount,
      undoUsed: input.undoUsed === true,
      taskOutcomeToken: mapTaskOutcome(input),
      failureReasonTokens: clone(input.failureReasonTokens || []),
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      insertedPromptTokenEstimate: null,
      latencyMs: input.latencyMs === undefined ? 0 : input.latencyMs,
      tokenAccountingSource: input.tokenAccountingSource || "unavailable",
      semanticFingerprint: {
        kind: "keyed_feature_hash",
        projectScoped: true,
        algorithm: "hmac_sha256",
        valueToken: fingerprintValueToken,
        encryptedAtRest: false,
        exportable: false,
        absoluteIrreversibilityClaimed: false,
        inversionRiskTested: false,
        membershipInferenceRiskTested: false,
        residualRisk: "unknown"
      },
      privacyFlags: clone(contracts.DEFAULT_PRIVACY_FLAGS),
      createdAt: timestamp
    };
    for (const field of tokenFields) {
      if (Object.prototype.hasOwnProperty.call(input, field)) observation[field] = input[field];
    }
    return clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_OBSERVATION, observation));
  }

  function candidatePatternGroup(state, evidence) {
    return state.candidateEvidence.filter((item) => (
      item.valid === true
      && item.projectScopeToken === evidence.projectScopeToken
      && item.fingerprintValueToken === evidence.fingerprintValueToken
      && item.artifactType === evidence.artifactType
    ));
  }

  function maybeCreateCandidate(state, evidence, timestamp) {
    const patternGroup = candidatePatternGroup(state, evidence);
    const payloadToken = canonicalJson(evidence.payload);
    const group = patternGroup.filter((item) => canonicalJson(item.payload) === payloadToken);
    const successes = group.filter((item) => item.taskOutcomeToken === "completed");
    const sessions = new Set(successes.map((item) => item.sessionId));
    const patternSuccesses = patternGroup.filter((item) => item.taskOutcomeToken === "completed");
    const patternSessions = new Set(patternSuccesses.map((item) => item.sessionId));
    const explicitNegatives = patternGroup.filter((item) => item.explicitNegativeFeedback === true);
    const existing = state.artifacts.find((record) => (
      record.originProjectScopeToken === evidence.projectScopeToken
      && record.fingerprintValueToken === evidence.fingerprintValueToken
      && record.sourceArtifactType === evidence.artifactType
    ));
    if (explicitNegatives.length > 0 && existing?.artifact.status === "pending_review") {
      existing.artifact.status = "archived";
      existing.artifact.autoCreated = false;
      existing.artifact.effective = false;
      existing.artifact.evidenceSummary = {
        sessionCount: patternSessions.size,
        successfulOutcomeCount: patternSuccesses.length,
        explicitNegativeFeedbackCount: explicitNegatives.length,
        evidenceTokenCount: patternGroup.length
      };
      existing.artifact.review.required = false;
      existing.artifact.review.decision = "rejected";
      existing.artifact.updatedAt = timestamp;
      existing.artifact = clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, existing.artifact));
      return null;
    }
    if (sessions.size < 2 || successes.length < 3 || explicitNegatives.length > 0) return null;
    if (existing) return null;

    const skillGates = evidence.artifactType === "skill"
      ? Object.fromEntries(Object.keys(DEFAULT_SKILL_GATES).map((key) => [key, successes.every((item) => item.skillGates?.[key] === true)]))
      : null;
    const payload = evidence.artifactType === "skill" ? withSkillGates(evidence.payload, skillGates) : clone(evidence.payload);
    const artifact = {
      contractVersion: contracts.CONTRACT_VERSIONS[contracts.CONTRACTS.LEARNING_ARTIFACT],
      artifactId: createId("artifact"),
      artifactType: evidence.artifactType,
      status: "pending_review",
      scope: { kind: "project", projectScopeToken: evidence.projectScopeToken },
      payload,
      evidenceSummary: {
        sessionCount: sessions.size,
        successfulOutcomeCount: successes.length,
        explicitNegativeFeedbackCount: 0,
        evidenceTokenCount: patternGroup.length
      },
      permissions: permissionsForType(evidence.artifactType),
      review: { required: true, decision: "pending", ignoredCount: 0 },
      autoCreated: true,
      effective: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacyFlags: clone(contracts.DEFAULT_PRIVACY_FLAGS)
    };
    const validated = clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, artifact));
    state.artifacts.push({
      artifact: validated,
      originProjectScopeToken: evidence.projectScopeToken,
      fingerprintValueToken: evidence.fingerprintValueToken,
      sourceArtifactType: evidence.artifactType,
      narrowScopeTokens: [],
      skillGates
    });
    return validated;
  }

  function recordObservation(input, recordOptions = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Learning observation input must be an object.");
    assertPrivacySafeInput(input);
    const projectScopeToken = assertOpaqueToken(input.projectScopeToken, "projectScopeToken");
    const sessionId = assertOpaqueToken(input.sessionId, "sessionId");
    const outcomeId = assertOpaqueToken(input.outcomeId, "outcomeId");
    assertTokenArray(input.featureTokens, "featureTokens", { minLength: 1, maxLength: 64 });

    const state = readState();
    const duplicate = state.observations.find((entry) => (
      entry.projectScopeToken === projectScopeToken && entry.outcomeId === outcomeId
    ));
    if (duplicate) {
      return { observation: clone(duplicate.observation), candidate: null, cardReminder: null, duplicate: true };
    }

    const timestamp = input.createdAt ? normalizeClockValue(input.createdAt) : now();
    const fingerprintValueToken = hmacKeys.fingerprint(projectScopeToken, input.featureTokens);
    const observation = buildObservation(input, fingerprintValueToken, timestamp);
    state.observations.push({
      observation,
      projectScopeToken,
      sessionId,
      outcomeId,
      rolloutEligible: input.rolloutEligible === true,
      valid: true
    });

    let candidate = null;
    if (input.candidate !== undefined && input.candidate !== null) {
      const artifactType = input.candidate.artifactType;
      const validatedPayload = validateArtifactPayload(
        artifactType,
        input.candidate.payload,
        projectScopeToken,
        timestamp,
        recordOptions?.skillGates || input.candidate.skillGates
      );
      const taskOutcomeToken = observation.taskOutcomeToken;
      const evidence = {
        evidenceId: createId("candidate_evidence"),
        observationId: observation.observationId,
        projectScopeToken,
        sessionId,
        outcomeId,
        fingerprintValueToken,
        artifactType,
        payload: validatedPayload.payload,
        skillGates: validatedPayload.skillGates,
        taskOutcomeToken,
        explicitNegativeFeedback: input.explicitNegativeFeedback === true || taskOutcomeToken === "not_completed",
        valid: true,
        createdAt: timestamp
      };
      state.candidateEvidence.push(evidence);
      candidate = maybeCreateCandidate(state, evidence, timestamp);
    }

    persistState(state);
    return { observation: clone(observation), candidate: clone(candidate), cardReminder: null, duplicate: false };
  }

  function listObservations(filter = {}) {
    return readState().observations
      .filter((entry) => !filter.projectScopeToken || entry.projectScopeToken === filter.projectScopeToken)
      .map((entry) => clone(entry.observation));
  }

  function listObservationRecords(filter = {}) {
    return readState().observations
      .filter((entry) => !filter.projectScopeToken || entry.projectScopeToken === filter.projectScopeToken)
      .map((entry) => ({
        projectScopeToken: entry.projectScopeToken,
        sessionId: entry.sessionId,
        outcomeId: entry.outcomeId,
        rolloutEligible: entry.rolloutEligible === true,
        observation: clone(entry.observation)
      }));
  }

  function listArtifacts(filter = {}) {
    const state = readState();
    const projectArtifacts = state.artifacts
      .filter((record) => !filter.projectScopeToken || record.originProjectScopeToken === filter.projectScopeToken)
      .map((record) => record.artifact);
    const globalArtifacts = filter.projectScopeToken
      ? []
      : state.proposals.filter((proposal) => proposal.status === "confirmed").map((proposal) => proposal.artifact);
    return [...projectArtifacts, ...globalArtifacts]
      .filter((artifact) => !filter.status || artifact.status === filter.status)
      .filter((artifact) => !filter.artifactType || artifact.artifactType === filter.artifactType)
      .map(clone);
  }

  function findArtifactRecord(state, artifactId) {
    assertOpaqueToken(artifactId, "artifactId");
    const record = state.artifacts.find((item) => item.artifact.artifactId === artifactId);
    if (!record) throw codedError("learning_artifact_not_found", "The learning artifact does not exist or is no longer active.");
    return record;
  }

  function detailForRecord(record) {
    return {
      artifact: clone(record.artifact),
      narrowScopeTokens: clone(record.narrowScopeTokens || []),
      skillGates: clone(record.skillGates),
      cardReminderEnabled: record.artifact.status === "pending_review" && record.artifact.review.ignoredCount < 3
    };
  }

  function getCandidateDetail(artifactId) {
    return detailForRecord(findArtifactRecord(readState(), artifactId));
  }

  function getCardReminder({ projectScopeToken, featureTokens } = {}) {
    assertOpaqueToken(projectScopeToken, "projectScopeToken");
    assertTokenArray(featureTokens, "featureTokens", { minLength: 1, maxLength: 64 });
    const fingerprintValueToken = hmacKeys.fingerprint(projectScopeToken, featureTokens, { create: false });
    if (!fingerprintValueToken) return null;
    const record = readState().artifacts.find((item) => (
      item.originProjectScopeToken === projectScopeToken
      && item.fingerprintValueToken === fingerprintValueToken
      && item.artifact.status === "pending_review"
      && item.artifact.review.ignoredCount < 3
    ));
    if (!record) return null;
    return {
      artifactId: record.artifact.artifactId,
      artifactType: record.artifact.artifactType,
      projectScopeToken,
      reminderToken: "reusable_experience_found"
    };
  }

  function ignoreCandidate(artifactId) {
    const state = readState();
    const record = findArtifactRecord(state, artifactId);
    if (record.artifact.status !== "pending_review") {
      throw codedError("candidate_not_pending", "Only pending candidates can receive reminder ignores.");
    }
    const timestamp = now();
    record.artifact.review.ignoredCount = Math.min(3, record.artifact.review.ignoredCount + 1);
    record.artifact.updatedAt = timestamp;
    record.artifact = clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, record.artifact));
    persistState(state);
    return clone(record.artifact);
  }

  function setSkillGates(artifactId, gates) {
    assertPrivacySafeInput(gates);
    const state = readState();
    const record = findArtifactRecord(state, artifactId);
    if (record.artifact.artifactType !== "skill") throw codedError("artifact_not_skill", "Skill gates only apply to Skill artifacts.");
    if (record.artifact.status !== "pending_review") throw codedError("candidate_not_pending", "Only pending Skill candidates can update gates.");
    const normalized = normalizeSkillGates(gates, record.artifact.payload);
    record.skillGates = normalized;
    record.artifact.payload = withSkillGates(record.artifact.payload, normalized);
    record.artifact.updatedAt = now();
    record.artifact = clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, record.artifact));
    persistState(state);
    return detailForRecord(record);
  }

  function reviewCandidate(artifactId, decision = {}) {
    assertPrivacySafeInput(decision);
    const state = readState();
    const record = findArtifactRecord(state, artifactId);
    if (record.artifact.status !== "pending_review") throw codedError("candidate_not_pending", "Only pending candidates can be reviewed.");
    const action = decision.action;
    const timestamp = now();

    if (action === "edit") {
      const validated = validateArtifactPayload(
        record.artifact.artifactType,
        decision.payload,
        record.originProjectScopeToken,
        timestamp,
        record.skillGates
      );
      record.artifact.payload = validated.payload;
      record.skillGates = validated.skillGates;
    } else if (action === "reclassify") {
      const validated = validateArtifactPayload(
        decision.artifactType,
        decision.payload,
        record.originProjectScopeToken,
        timestamp,
        decision.skillGates
      );
      record.artifact.artifactType = decision.artifactType;
      record.artifact.payload = validated.payload;
      record.artifact.permissions = permissionsForType(decision.artifactType);
      record.skillGates = validated.skillGates;
    } else if (action === "narrow_scope") {
      record.narrowScopeTokens = assertTokenArray(decision.scopeTokens, "scopeTokens", { minLength: 1, maxLength: 16 });
    } else if (action === "accept") {
      if (record.artifact.artifactType === "skill" && !allSkillGatesPassed(record.skillGates)) {
        throw codedError("skill_gates_required", "Skill acceptance requires permission, isolation, static, and adversarial gates.");
      }
      record.artifact.status = "active";
      record.artifact.autoCreated = false;
      record.artifact.effective = record.artifact.artifactType !== "generation_policy";
      record.artifact.review.required = false;
      record.artifact.review.decision = "accepted";
    } else if (action === "reject") {
      record.artifact.status = "rejected";
      record.artifact.autoCreated = false;
      record.artifact.effective = false;
      record.artifact.review.required = false;
      record.artifact.review.decision = "rejected";
    } else {
      throw codedError("invalid_review_action", "Review action must be accept, edit, reclassify, narrow_scope, or reject.");
    }

    record.artifact.updatedAt = timestamp;
    record.artifact = clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, record.artifact));
    persistState(state);
    return clone(record.artifact);
  }

  function promotionGroup(state, artifactType, promotionKeyToken) {
    return state.promotionEvidence.filter((item) => (
      item.valid === true
      && item.artifactType === artifactType
      && item.promotionKeyToken === promotionKeyToken
    ));
  }

  function summarizePromotion(state, artifactType, promotionKeyToken) {
    const evidence = promotionGroup(state, artifactType, promotionKeyToken);
    const successes = evidence.filter((item) => item.succeeded === true);
    const negatives = evidence.filter((item) => item.explicitNegativeFeedback === true);
    const projectScopeTokens = [...new Set(successes.map((item) => item.projectScopeToken))].sort();
    const sessionTokens = new Set(successes.map((item) => `${item.projectScopeToken}:${item.sessionId}`));
    const onePayload = new Set(successes.map((item) => canonicalJson(item.payload))).size <= 1;
    const skillGates = artifactType === "skill"
      ? Object.fromEntries(Object.keys(DEFAULT_SKILL_GATES).map((key) => [key, successes.length > 0 && successes.every((item) => item.skillGates?.[key] === true)]))
      : null;
    const qualifies = negatives.length === 0
      && onePayload
      && (
        (["memory", "rule"].includes(artifactType) && projectScopeTokens.length >= 3 && successes.length >= 5)
        || (artifactType === "skill" && projectScopeTokens.length >= 3 && allSkillGatesPassed(skillGates))
      );
    return {
      evidence,
      successes,
      negatives,
      projectScopeTokens,
      sessionCount: sessionTokens.size,
      skillGates,
      qualifies
    };
  }

  function archiveProposalArtifact(proposal, timestamp) {
    proposal.status = "invalidated";
    proposal.effective = false;
    proposal.invalidatedAt = timestamp;
    proposal.artifact.status = "archived";
    proposal.artifact.autoCreated = false;
    proposal.artifact.effective = false;
    proposal.artifact.updatedAt = timestamp;
    proposal.artifact = clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, proposal.artifact));
  }

  function reconcileProposal(state, artifactType, promotionKeyToken, timestamp) {
    const summary = summarizePromotion(state, artifactType, promotionKeyToken);
    const current = [...state.proposals].reverse().find((item) => (
      item.artifactType === artifactType
      && item.promotionKeyToken === promotionKeyToken
      && ["pending_final_confirmation", "confirmed"].includes(item.status)
    ));
    if (!summary.qualifies) {
      if (current && summary.negatives.length > 0) archiveProposalArtifact(current, timestamp);
      return null;
    }
    if (current) return current;

    const payload = artifactType === "skill"
      ? withSkillGates(summary.successes[0].payload, summary.skillGates)
      : clone(summary.successes[0].payload);
    const artifact = {
      contractVersion: contracts.CONTRACT_VERSIONS[contracts.CONTRACTS.LEARNING_ARTIFACT],
      artifactId: createId("global_proposal_artifact"),
      artifactType,
      status: "pending_review",
      scope: { kind: "global_proposal", projectScopeToken: promotionKeyToken },
      payload,
      evidenceSummary: {
        sessionCount: summary.sessionCount,
        successfulOutcomeCount: summary.successes.length,
        explicitNegativeFeedbackCount: 0,
        evidenceTokenCount: summary.evidence.length
      },
      permissions: permissionsForType(artifactType),
      review: { required: true, decision: "pending", ignoredCount: 0 },
      autoCreated: false,
      effective: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacyFlags: clone(contracts.DEFAULT_PRIVACY_FLAGS)
    };
    const proposal = {
      proposalId: createId("global_proposal"),
      promotionKeyToken,
      artifactType,
      artifact: clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, artifact)),
      evidenceIds: summary.evidence.map((item) => item.evidenceId),
      projectScopeTokens: summary.projectScopeTokens,
      successfulOutcomeCount: summary.successes.length,
      explicitNegativeFeedbackCount: 0,
      skillGates: clone(summary.skillGates),
      status: "pending_final_confirmation",
      systemCreated: true,
      finalConfirmationRequired: true,
      effective: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      confirmedAt: null,
      invalidatedAt: null
    };
    state.proposals.push(proposal);
    return proposal;
  }

  function recordPromotionEvidence(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Promotion evidence input must be an object.");
    assertPrivacySafeInput(input);
    const artifactType = input.artifactType;
    if (!GLOBAL_PROMOTION_TYPES.has(artifactType)) {
      throw codedError("global_promotion_not_supported", "Global v1 proposals are limited to Memory, Rule, and gated Skill artifacts.");
    }
    const promotionKeyToken = assertOpaqueToken(input.promotionKeyToken, "promotionKeyToken");
    const projectScopeToken = assertOpaqueToken(input.projectScopeToken, "projectScopeToken");
    const sessionId = assertOpaqueToken(input.sessionId, "sessionId");
    const outcomeId = assertOpaqueToken(input.outcomeId, "outcomeId");
    const timestamp = input.createdAt ? normalizeClockValue(input.createdAt) : now();
    const validated = validateArtifactPayload(
      artifactType,
      input.payload,
      projectScopeToken,
      timestamp,
      input.skillGates
    );
    const state = readState();
    const duplicate = state.promotionEvidence.find((item) => (
      item.artifactType === artifactType
      && item.promotionKeyToken === promotionKeyToken
      && item.projectScopeToken === projectScopeToken
      && item.outcomeId === outcomeId
    ));
    if (duplicate) {
      const proposal = reconcileProposal(state, artifactType, promotionKeyToken, timestamp);
      return { evidence: clone(duplicate), proposal: clone(proposal), duplicate: true };
    }

    const evidence = {
      evidenceId: createId("promotion_evidence"),
      promotionKeyToken,
      projectScopeToken,
      sessionId,
      outcomeId,
      artifactType,
      payload: validated.payload,
      skillGates: validated.skillGates,
      succeeded: input.succeeded === true,
      explicitNegativeFeedback: input.explicitNegativeFeedback === true,
      valid: true,
      createdAt: timestamp
    };
    state.promotionEvidence.push(evidence);
    const proposal = reconcileProposal(state, artifactType, promotionKeyToken, timestamp);
    persistState(state);
    return { evidence: clone(evidence), proposal: clone(proposal), duplicate: false };
  }

  function listGlobalProposals() {
    return readState().proposals.map(clone);
  }

  function confirmGlobalProposal(proposalId, { confirmed = false } = {}) {
    assertOpaqueToken(proposalId, "proposalId");
    if (confirmed !== true) throw codedError("final_confirmation_required", "A global artifact requires explicit final user confirmation.");
    const state = readState();
    const proposal = state.proposals.find((item) => item.proposalId === proposalId);
    if (!proposal) throw codedError("global_proposal_not_found", "The global proposal does not exist.");
    if (proposal.status !== "pending_final_confirmation") {
      throw codedError("global_proposal_not_pending", "Only a valid pending global proposal can be confirmed.");
    }
    const summary = summarizePromotion(state, proposal.artifactType, proposal.promotionKeyToken);
    if (!summary.qualifies) throw codedError("global_promotion_threshold_not_met", "The global proposal no longer has sufficient valid evidence.");
    if (proposal.artifactType === "skill" && !allSkillGatesPassed(summary.skillGates)) {
      throw codedError("skill_gates_required", "Global Skill confirmation requires permission, isolation, static, and adversarial gates.");
    }
    const timestamp = now();
    proposal.artifact.scope = { kind: "global", projectScopeToken: null };
    proposal.artifact.status = "active";
    proposal.artifact.autoCreated = false;
    proposal.artifact.effective = true;
    proposal.artifact.review = { ...proposal.artifact.review, required: false, decision: "accepted" };
    proposal.artifact.updatedAt = timestamp;
    proposal.artifact = clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, proposal.artifact));
    proposal.status = "confirmed";
    proposal.effective = true;
    proposal.confirmedAt = timestamp;
    proposal.updatedAt = timestamp;
    persistState(state);
    return clone(proposal.artifact);
  }

  function archivedObservation(entry, timestamp) {
    const observation = {
      ...clone(entry.observation),
      taskOutcomeToken: "invalidated",
      failureReasonTokens: []
    };
    return {
      ...clone(entry),
      observation: clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_OBSERVATION, observation)),
      valid: false,
      invalidated: true,
      invalidatedAt: timestamp
    };
  }

  function archivedArtifact(record, timestamp) {
    const artifact = {
      ...clone(record.artifact),
      status: "archived",
      autoCreated: false,
      effective: false,
      updatedAt: timestamp
    };
    return {
      ...clone(record),
      artifact: clone(contracts.assertValidContract(contracts.CONTRACTS.LEARNING_ARTIFACT, artifact)),
      invalidated: true,
      invalidatedAt: timestamp
    };
  }

  function clearProjectData(projectScopeToken) {
    assertOpaqueToken(projectScopeToken, "projectScopeToken");
    const state = readState();
    const timestamp = now();
    const archiveToken = createId("archive");
    const archiveDir = path.join(archiveRoot, archiveToken);
    const selectedObservations = state.observations.filter((item) => item.projectScopeToken === projectScopeToken);
    const selectedCandidateEvidence = state.candidateEvidence.filter((item) => item.projectScopeToken === projectScopeToken);
    const selectedArtifacts = state.artifacts.filter((item) => item.originProjectScopeToken === projectScopeToken);
    const selectedPromotionEvidence = state.promotionEvidence.filter((item) => item.projectScopeToken === projectScopeToken);
    const selectedPromotionIds = new Set(selectedPromotionEvidence.map((item) => item.evidenceId));
    const affectedProposals = state.proposals.filter((proposal) => (
      proposal.projectScopeTokens.includes(projectScopeToken)
      || proposal.evidenceIds.some((evidenceId) => selectedPromotionIds.has(evidenceId))
    ));
    const keyWasPresent = fs.existsSync(hmacKeys.keyFile(projectScopeToken));

    const archive = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      archiveToken,
      projectScopeToken,
      invalidatedAt: timestamp,
      keyArchived: keyWasPresent,
      observations: selectedObservations.map((item) => archivedObservation(item, timestamp)),
      candidateEvidence: selectedCandidateEvidence.map((item) => ({
        ...clone(item), valid: false, invalidated: true, invalidatedAt: timestamp
      })),
      artifacts: selectedArtifacts.map((item) => archivedArtifact(item, timestamp)),
      promotionEvidence: selectedPromotionEvidence.map((item) => ({
        ...clone(item), valid: false, invalidated: true, invalidatedAt: timestamp
      })),
      proposals: affectedProposals.map((item) => ({ ...clone(item), invalidated: true, invalidatedAt: timestamp }))
    };
    writeJson(path.join(archiveDir, "learning-data.json"), archive);
    hmacKeys.archiveKey(projectScopeToken, archiveDir);

    state.observations = state.observations.filter((item) => item.projectScopeToken !== projectScopeToken);
    state.candidateEvidence = state.candidateEvidence.filter((item) => item.projectScopeToken !== projectScopeToken);
    state.artifacts = state.artifacts.filter((item) => item.originProjectScopeToken !== projectScopeToken);
    state.promotionEvidence = state.promotionEvidence.filter((item) => item.projectScopeToken !== projectScopeToken);
    for (const proposal of affectedProposals) archiveProposalArtifact(proposal, timestamp);
    state.invalidations.push({
      invalidationId: createId("invalidation"),
      archiveToken,
      projectScopeToken,
      invalidatedAt: timestamp,
      observationCount: selectedObservations.length,
      artifactCount: selectedArtifacts.length,
      promotionEvidenceCount: selectedPromotionEvidence.length,
      proposalCount: affectedProposals.length
    });
    persistState(state);

    return {
      projectScopeToken,
      archiveToken,
      archiveDir,
      invalidatedAt: timestamp,
      keyArchived: keyWasPresent,
      counts: {
        observations: selectedObservations.length,
        candidateEvidence: selectedCandidateEvidence.length,
        artifacts: selectedArtifacts.length,
        promotionEvidence: selectedPromotionEvidence.length,
        proposals: affectedProposals.length
      }
    };
  }

  function getInvalidations() {
    return readState().invalidations.map(clone);
  }

  return {
    stateFile,
    projectKeyFile: hmacKeys.keyFile,
    recordObservation,
    createObservation: recordObservation,
    listObservations,
    listObservationRecords,
    listArtifacts,
    getCandidateDetail,
    getCardReminder,
    ignoreCandidate,
    reviewCandidate,
    setSkillGates,
    recordPromotionEvidence,
    listGlobalProposals,
    confirmGlobalProposal,
    clearProjectData,
    clearProject: clearProjectData,
    getInvalidations
  };
}

module.exports = {
  ARCHIVE_SCHEMA_VERSION,
  STORE_SCHEMA_VERSION,
  createLearningArtifactStore
};
