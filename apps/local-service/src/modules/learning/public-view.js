"use strict";

function publicLearningObservation(observation = {}) {
  const fingerprint = observation.semanticFingerprint || {};
  return {
    ...observation,
    semanticFingerprint: {
      kind: fingerprint.kind || "keyed_feature_hash",
      projectScoped: fingerprint.projectScoped !== false,
      encryptedAtRest: fingerprint.encryptedAtRest === true,
      exportable: false,
      absoluteIrreversibilityClaimed: false,
      inversionRiskTested: fingerprint.inversionRiskTested === true,
      membershipInferenceRiskTested: fingerprint.membershipInferenceRiskTested === true,
      residualRisk: fingerprint.residualRisk || "unknown"
    }
  };
}

module.exports = Object.freeze({ publicLearningObservation });
