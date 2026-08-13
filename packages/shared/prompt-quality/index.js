const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PARTS = Object.freeze([
  "shared.js",
  "scoring.js",
  "feedback.js",
  "strategy-insights.js",
  "strategy-weight.js",
  "failure-reason.js",
  "self-improvement.js",
  "quality-lift.js",
  "quality-lift-segments.js",
  "strategy-plan.js",
  "task-outcome.js",
  "pilot.js",
  "experiment.js"
]);

function loadPromptQuality() {
  const sandbox = {
    console,
    module: { exports: {} },
    exports: {},
    require,
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const part of PARTS) {
    const filename = path.join(__dirname, part);
    const code = fs.readFileSync(filename, "utf8");
    vm.runInContext(code, context, { filename });
  }
  return context.module.exports;
}

module.exports = loadPromptQuality();
