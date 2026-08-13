"use strict";

const compiler = require("./compiler");
const confidence = require("./confidence");
const incidents = require("./incidents");
const registry = require("./registry");
const rollout = require("./rollout");
const selector = require("./selector");
const shared = require("./shared");

module.exports = Object.freeze({
  GENERATION_POLICY_COMPILER_VERSION: "generation-policy-compiler@1",
  GENERATION_POLICY_REGISTRY_VERSION: shared.REGISTRY_SCHEMA_VERSION,
  POLICY_ROLLOUT_ENGINE_VERSION: "generation-policy-rollout@1",
  DEFAULT_CANARY_SHARE_BPS: shared.DEFAULT_CANARY_SHARE_BPS,
  DEFAULT_ROLLOUT_MINIMUMS: shared.DEFAULT_MINIMUMS,
  CONTEXT_BUDGET_LIMITS: shared.CONTEXT_BUDGET_LIMITS,
  GenerationPolicyError: shared.GenerationPolicyError,
  ...confidence,
  ...incidents,
  ...compiler,
  ...registry,
  ...rollout,
  ...selector
});
