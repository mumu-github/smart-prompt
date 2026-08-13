const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const desktopOverlayLogicSource = fs.readFileSync(path.join(root, "src/desktop-overlay-logic.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src/app.js"), "utf8");

const elementIds = [
  "ui-locale",
  "service-status",
  "provider",
  "provider-status",
  "base-url",
  "model",
  "api-key",
  "agnes-api-key",
  "openai-api-key",
  "anthropic-api-key",
  "gemini-api-key",
  "start-service",
  "stop-service",
  "restart-service",
  "first-run-progress",
  "privacy-boundary",
  "test-provider",
  "provider-test-status",
  "refresh-pilot-outcomes",
  "pilot-outcome-status",
  "pilot-outcome-summary",
  "pilot-outcome-strategies",
  "pilot-outcome-targets",
  "refresh-quality-lift",
  "quality-lift-status",
  "quality-lift-summary",
  "quality-lift-cohorts",
  "quality-lift-comparisons",
  "quality-lift-recommendations",
  "refresh-quality-lift-segments",
  "quality-lift-segments-status",
  "quality-lift-segments-improving",
  "quality-lift-segments-regressing",
  "quality-lift-segments-collecting",
  "refresh-outcome-followups",
  "outcome-followup-status",
  "outcome-followup-list",
  "refresh-desktop-snapshot",
  "desktop-companion-status",
  "desktop-tool-summary",
  "desktop-signal-summary",
  "desktop-guard-summary",
  "desktop-supported-profiles",
  "desktop-mascot-image",
  "desktop-mascot-state",
  "desktop-fusion-console",
  "desktop-mascot-button",
  "desktop-fusion-mascot-image",
  "desktop-fusion-mascot-state",
  "desktop-input-surface",
  "desktop-draft-input",
  "desktop-generated-prompt",
  "desktop-prompt-handoff",
  "generate-desktop-prompt",
  "fill-foreground-input",
  "desktop-fusion-evidence",
  "desktop-fill-text",
  "run-desktop-self-test",
  "desktop-fill-result",
  "refresh-learning",
  "learning-status",
  "self-improvement-summary",
  "evolution-candidate-summary",
  "export-diagnostics",
  "clear-local-data",
  "diagnostics-output",
  "save-settings",
  "skill-folder",
  "import-folder",
  "skill-list",
  "prompt-title",
  "prompt-body",
  "save-prompt",
  "prompt-list",
  "shortcut",
  "save-shortcut"
];

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.placeholder = "";
    this.textContent = "";
    this.innerHTML = "";
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.listeners = {};
    this.classList = {
      values: new Set(),
      toggle: (name, force) => {
        if (force) this.classList.values.add(name);
        else this.classList.values.delete(name);
      },
      contains: (name) => this.classList.values.has(name)
    };
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  trigger(type, event = { target: this }) {
    assert.ok(this.listeners[type], `${this.id} missing ${type} listener`);
    return this.listeners[type](event);
  }

  focus() {
    this.dataset.focused = "true";
  }
}

function createDeleteButton(action, datasetKey, id) {
  return {
    dataset: {
      action,
      [datasetKey]: encodeURIComponent(id)
    },
    closest(selector) {
      return selector.includes(action) ? this : null;
    }
  };
}

function createOutcomeButton(id, outcomeLabel) {
  return {
    dataset: {
      action: "record-outcome-followup",
      generationId: encodeURIComponent(id),
      outcomeLabel
    },
    closest(selector) {
      return selector.includes("record-outcome-followup") ? this : null;
    }
  };
}

function createResponse(body, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    },
    async json() {
      return body;
    }
  };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function runLastScheduledTimeout(label) {
  const expectedDelay = label.includes("prompt-state")
    ? 180
    : label.includes("collapse")
      ? 900
      : 650;
  const entry = [...scheduledTimeouts].reverse().find((timeout) => (
    !timeout.cleared && timeout.delay === expectedDelay
  ));
  if (!entry && label === "missing fill action guard hide") return false;
  assert.ok(entry, `missing scheduled timeout for ${label}`);
  entry.cleared = true;
  await entry.handler();
  await Promise.resolve();
  return true;
}

const elements = Object.fromEntries(elementIds.map((id) => [id, new FakeElement(id)]));
elements["ui-locale"].value = "en";
elements.provider.value = "auto";
elements["base-url"].value = "https://api.openai.com/v1";
elements.model.value = "gpt-4o-mini";
elements.shortcut.value = "CmdOrCtrl+Shift+Space";

const serviceState = {
  settings: {
    provider: "auto",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
    providerKeys: {
      agnes: "",
      "openai-compatible": "",
      anthropic: "",
      gemini: ""
    }
  },
  skills: [],
  prompts: []
};
const pilotOutcomeReport = {
  reportVersion: "v6-pilot-outcome-readiness@1",
  readiness: {
    status: "ready",
    minOutcomeEvents: 3,
    totalOutcomeEvents: 7,
    readyTaskScenarioCohorts: 2,
    collectingTaskScenarioCohorts: 1,
    emptyTaskScenarioCohorts: 6,
    outcomeSuccessRate: 0.57,
    avgOutcomeScore: 0.56
  },
  winningStrategies: [
    {
      dimension: "strategyId",
      key: "llm:continue:medium:security-winner",
      status: "ready",
      minOutcomeEvents: 3,
      outcomeCount: 3,
      outcomeSuccessRate: 1,
      avgOutcomeScore: 0.91
    }
  ],
  riskStrategies: [
    {
      dimension: "strategyId",
      key: "llm:continue:medium:ui-risk",
      status: "ready",
      minOutcomeEvents: 3,
      outcomeCount: 3,
      outcomeSuccessRate: 0,
      avgOutcomeScore: 0.13
    }
  ],
  collectionTargets: [
    {
      dimension: "taskScenario",
      key: "data-analysis",
      status: "collecting",
      minOutcomeEvents: 3,
      outcomeCount: 1,
      neededOutcomeEvents: 2,
      outcomeSuccessRate: 1,
      avgOutcomeScore: 0.78
    },
    {
      dimension: "taskScenario",
      key: "general",
      status: "empty",
      minOutcomeEvents: 3,
      outcomeCount: 0,
      neededOutcomeEvents: 3,
      outcomeSuccessRate: 0,
      avgOutcomeScore: null
    }
  ],
  privacy: {
    aggregateOnly: true,
    promptTextNotStored: true,
    inputTextNotStored: true,
    pageBodyNotRequired: true,
    fullUrlNotStored: true
  }
};
const qualityLiftReport = {
  reportVersion: "v6-quality-lift@1",
  readiness: {
    status: "ready",
    minOutcomeEvents: 3,
    comparable: true,
    eventCount: 18,
    baselineOutcomeCount: 3,
    strategyGuidedOutcomeCount: 3,
    outcomeWeightedOutcomeCount: 3,
    primaryDecision: "quality_lift_positive"
  },
  cohorts: [
    {
      cohort: "baseline_structure",
      status: "ready",
      minOutcomeEvents: 3,
      events: 6,
      insertAttempts: 3,
      verifiedInserts: 2,
      retries: 1,
      undos: 1,
      outcomeCount: 3,
      outcomeSuccessRate: 0.33,
      avgOutcomeScore: 0.55,
      insertSuccessRate: 0.67,
      saveRate: 0.33,
      retryUsageRate: 0.33,
      undoUsageRate: 0.33
    },
    {
      cohort: "strategy_guided",
      status: "ready",
      minOutcomeEvents: 3,
      events: 6,
      insertAttempts: 3,
      verifiedInserts: 3,
      retries: 1,
      undos: 0,
      outcomeCount: 3,
      outcomeSuccessRate: 0.67,
      avgOutcomeScore: 0.72,
      insertSuccessRate: 1,
      saveRate: 0.67,
      retryUsageRate: 0.17,
      undoUsageRate: 0
    },
    {
      cohort: "outcome_weighted",
      status: "ready",
      minOutcomeEvents: 3,
      events: 6,
      insertAttempts: 3,
      verifiedInserts: 3,
      retries: 0,
      undos: 0,
      outcomeCount: 3,
      outcomeSuccessRate: 1,
      avgOutcomeScore: 0.88,
      insertSuccessRate: 1,
      saveRate: 0.67,
      retryUsageRate: 0,
      undoUsageRate: 0
    }
  ],
  comparisons: [
    {
      name: "strategy_guided_vs_baseline",
      status: "ready",
      comparable: true,
      minOutcomeEvents: 3,
      baselineCohort: "baseline_structure",
      treatmentCohort: "strategy_guided",
      baselineOutcomeCount: 3,
      treatmentOutcomeCount: 3,
      decision: "quality_lift_positive",
      deltas: {
        outcomeSuccessRateLift: 0.34,
        avgOutcomeScoreLift: 0.17,
        insertSuccessRateLift: 0.33,
        saveRateLift: 0.34,
        retryUsageRateLift: -0.16,
        undoUsageRateLift: -0.33
      }
    },
    {
      name: "outcome_weighted_vs_baseline",
      status: "ready",
      comparable: true,
      minOutcomeEvents: 3,
      baselineCohort: "baseline_structure",
      treatmentCohort: "outcome_weighted",
      baselineOutcomeCount: 3,
      treatmentOutcomeCount: 3,
      decision: "quality_lift_positive",
      deltas: {
        outcomeSuccessRateLift: 0.67,
        avgOutcomeScoreLift: 0.33,
        insertSuccessRateLift: 0.33,
        saveRateLift: 0.34,
        retryUsageRateLift: -0.33,
        undoUsageRateLift: -0.33
      }
    }
  ],
  recommendations: [
    {
      key: "keep_outcome_weighting",
      priority: "medium",
      recommendation: "Outcome-weighted prompts are lifting user-verified success without increasing retry or undo."
    }
  ],
  privacy: {
    aggregateOnly: true,
    promptTextNotStored: true,
    inputTextNotStored: true,
    pageBodyNotRequired: true,
    fullUrlNotStored: true,
    derivedFromAggregateQualityLiftMetrics: true
  }
};
const qualityLiftSegmentsReport = {
  reportVersion: "v6-quality-lift-segments@1",
  sourceReportVersion: "v6-quality-lift@1",
  readiness: {
    status: "review",
    eventCount: 42,
    dimensionCount: 4,
    segmentCount: 12,
    readySegmentCount: 8,
    improvingSegmentCount: 4,
    regressingSegmentCount: 4,
    collectingSegmentCount: 4,
    minOutcomeEvents: 3
  },
  dimensions: ["tool", "site", "taskScenario", "mode"],
  segmentsByDimension: {
    tool: [
      { dimension: "tool", key: "chatgpt", readinessStatus: "ready", primaryDecision: "quality_lift_positive", comparable: true },
      { dimension: "tool", key: "claude", readinessStatus: "regression", primaryDecision: "quality_lift_regression", comparable: true }
    ],
    site: [
      { dimension: "site", key: "chatgpt.com", readinessStatus: "ready", primaryDecision: "quality_lift_positive", comparable: true }
    ],
    taskScenario: [
      { dimension: "taskScenario", key: "security-review", readinessStatus: "ready", primaryDecision: "quality_lift_positive", comparable: true }
    ],
    mode: [
      { dimension: "mode", key: "continue", readinessStatus: "ready", primaryDecision: "quality_lift_positive", comparable: true }
    ]
  },
  topImproving: [
    {
      dimension: "tool",
      key: "chatgpt",
      readinessStatus: "ready",
      primaryDecision: "quality_lift_positive",
      minOutcomeEvents: 3,
      outcomeWeightedOutcomeCount: 3,
      successLift: 0.67,
      avgOutcomeScoreLift: 0.33,
      retryUsageRateLift: -0.33,
      undoUsageRateLift: -0.33
    }
  ],
  topRegressing: [
    {
      dimension: "tool",
      key: "claude",
      readinessStatus: "regression",
      primaryDecision: "quality_lift_regression",
      minOutcomeEvents: 3,
      outcomeWeightedOutcomeCount: 3,
      successLift: -0.67,
      avgOutcomeScoreLift: -0.2,
      retryUsageRateLift: 0.33,
      undoUsageRateLift: 0.33
    }
  ],
  collectingSegments: [
    {
      dimension: "taskScenario",
      key: "test-plan",
      readinessStatus: "collecting",
      primaryDecision: "collecting",
      minOutcomeEvents: 3,
      outcomeWeightedOutcomeCount: 1,
      neededOutcomeEvents: 2,
      successLift: 0,
      avgOutcomeScoreLift: null,
      retryUsageRateLift: 0,
      undoUsageRateLift: 0
    }
  ],
  privacy: {
    aggregateOnly: true,
    segmentMetadataOnly: true,
    promptTextNotStored: true,
    inputTextNotStored: true,
    pageBodyNotRequired: true,
    fullUrlNotStored: true
  }
};
const pendingOutcomeState = {
  pendingOutcomes: [
    {
      generationId: "generation-followup-1",
      created_at: "2026-06-08T10:00:00.000Z",
      source: "prompt_history",
      strategyId: "llm:continue:medium:reduce-retry",
      mode: "continue",
      tool: "ChatGPT",
      adapterId: "chatgpt",
      site: "chatgpt.com",
      taskScenario: "security-review",
      generatedBy: "llm",
      promptStrategyId: "insert_safe_compact",
      promptStrategyVersion: "v6-strategy-policy-3",
      experimentVersion: "v6-prompt-experiment-1",
      experimentArm: "strategy_guided",
      qualityLiftCohort: "strategy_guided",
      promptLength: 144,
      lastAction: "generated",
      privacy: {
        metadataOnly: true,
        promptTextNotStored: true,
        inputTextNotStored: true,
        pageBodyNotRequired: true,
        fullUrlNotStored: true
      }
    },
    {
      generationId: "generation-followup-2",
      created_at: "2026-06-08T09:59:00.000Z",
      source: "metric",
      strategyId: "template-fallback:continue:medium:baseline",
      mode: "continue",
      tool: "Claude",
      adapterId: "claude",
      site: "claude.ai",
      taskScenario: "general",
      generatedBy: "template-fallback",
      promptStrategyId: "baseline_structure",
      experimentVersion: "v6-prompt-experiment-1",
      experimentArm: "baseline_structure",
      qualityLiftCohort: "baseline_structure",
      promptLength: 96,
      lastAction: "insert",
      privacy: {
        metadataOnly: true,
        promptTextNotStored: true,
        inputTextNotStored: true,
        pageBodyNotRequired: true,
        fullUrlNotStored: true
      }
    }
  ]
};
const TEST_DESKTOP_OVERLAY_SIZE = { width: 320, height: 360 };
const TEST_DESKTOP_OVERLAY_COMPACT_SIZE = { width: 72, height: 72 };
const TEST_DESKTOP_OVERLAY_COMPACT_GAP = 12;
const TEST_DESKTOP_OVERLAY_SUBMIT_AVOIDANCE_WIDTH = 120;

function expectedDesktopOverlayPlacement(candidateOrRect) {
  const rect = candidateOrRect.boundingRect || candidateOrRect;
  const controlType = String(candidateOrRect.controlType || "");
  const x = Number(rect.x || 0);
  const y = Number(rect.y || 0);
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  return {
    x: Math.max(0, Math.round(x + width - TEST_DESKTOP_OVERLAY_SIZE.width)),
    y: Math.max(0, y > TEST_DESKTOP_OVERLAY_SIZE.height + 12
      ? Math.round(y - TEST_DESKTOP_OVERLAY_SIZE.height + 22)
      : Math.round(y + height + 8)),
    compactX: Math.max(0, Math.round(
      controlType.includes("Button")
        ? x - TEST_DESKTOP_OVERLAY_COMPACT_SIZE.width - TEST_DESKTOP_OVERLAY_COMPACT_GAP
        : x + width - TEST_DESKTOP_OVERLAY_COMPACT_SIZE.width - TEST_DESKTOP_OVERLAY_SUBMIT_AVOIDANCE_WIDTH
    )),
    compactY: Math.max(0, Math.round(
      controlType.includes("Button")
        ? y + (height - TEST_DESKTOP_OVERLAY_COMPACT_SIZE.height) / 2
        : y > TEST_DESKTOP_OVERLAY_COMPACT_SIZE.height + TEST_DESKTOP_OVERLAY_COMPACT_GAP
          ? y - TEST_DESKTOP_OVERLAY_COMPACT_SIZE.height - TEST_DESKTOP_OVERLAY_COMPACT_GAP
          : y + height + TEST_DESKTOP_OVERLAY_COMPACT_GAP
    ))
  };
}
const desktopSnapshotReport = {
  schemaVersion: "m3-windows-uia@1",
  createdAt: "2026-06-08T11:00:00.000Z",
  platform: "win32",
  selfTest: false,
  probeOk: true,
  pass: true,
  foreground: {
    processName: "workbuddy",
    pidPresent: true,
    titleLength: 24,
    titleHash: "desktop-title-hash",
    detectedToolProfile: "workbuddy",
    childProcessCount: 1,
    childToolProcessHintPresent: true
  },
  supportedToolProfiles: ["codex", "claude-code", "hermes", "workbuddy", "trae"],
  candidates: [
    {
      index: 0,
      controlType: "ControlType.Edit",
      nameHash: "name-hash",
      automationIdHash: "automation-hash",
      classNameHash: "class-hash",
      isKeyboardFocusable: true,
      isEnabled: true,
      hasValuePattern: true,
      hasTextPattern: false,
      boundingRect: { x: 12, y: 420, width: 560, height: 80 },
      inputSignals: {
        score: 150,
        hasKeyboardFocus: true,
        focusedElementMatch: true,
        caretWithinBounds: true,
        caretWindowMatch: true,
        nearWindowBottom: true,
        broadDocument: false
      }
    }
  ],
  summary: {
    candidateCount: 1,
    valuePatternCandidates: 1,
    textPatternCandidates: 0,
    focusableCandidates: 1,
    focusedCandidateCount: 1,
    caretCandidateCount: 1,
    bestCandidateIndex: 0,
    bestCandidateScore: 150,
    caretVisible: true,
    caretWindowPresent: true,
    detectedToolProfile: "workbuddy"
  },
  privacy: {
    titleRedacted: true,
    elementNamesHashed: true,
    elementValuesNotRead: true,
    caretTextNotRead: true,
    promptTextNotRead: true
  }
};
const transientMissDesktopSnapshotReport = {
  ...desktopSnapshotReport,
  probeOk: true,
  pass: false,
  foreground: {
    processName: "LockApp",
    pidPresent: true,
    titleLength: 8,
    titleHash: "lockapp-title-hash",
    detectedToolProfile: "unknown",
    childProcessCount: 0,
    childToolProcessHintPresent: false
  },
  candidates: [],
  summary: {
    candidateCount: 0,
    safeCandidateCount: 0,
    valuePatternCandidates: 0,
    textPatternCandidates: 0,
    focusableCandidates: 0,
    focusedCandidateCount: 0,
    caretCandidateCount: 0,
    semanticCandidateCount: 0,
    bestCandidateIndex: -1,
    bestCandidateScore: 0,
    caretVisible: false,
    caretWindowPresent: false,
    detectedToolProfile: "unknown"
  }
};
const fastForegroundState = {
  schemaVersion: "p25-foreground-window-state@1",
  createdAt: "1781490000000",
  platform: "win32",
  hwnd: "0x1234",
  processId: 1200,
  processName: "workbuddy",
  titleLength: 24,
  titleHash: "fast-title-hash",
  detectedToolProfile: "workbuddy",
  overlaySupportedProfile: true,
  isVisible: true,
  isMinimized: false,
  isCloaked: false,
  isUsable: true,
  boundingRect: { x: 0, y: 0, width: 900, height: 700 }
};
const minimizedFastForegroundState = {
  ...fastForegroundState,
  isMinimized: true,
  isUsable: false,
  boundingRect: { x: -32000, y: -32000, width: 160, height: 28 }
};
const unknownFastForegroundState = {
  ...fastForegroundState,
  hwnd: "0x9999",
  processId: 9000,
  processName: "chrome",
  detectedToolProfile: "unknown",
  overlaySupportedProfile: false,
  titleHash: "unknown-fast-title-hash"
};
const codexFastForegroundState = {
  ...fastForegroundState,
  hwnd: "0x7777",
  processId: 7777,
  processName: "Codex",
  detectedToolProfile: "codex",
  overlaySupportedProfile: true,
  titleHash: "codex-fast-title-hash",
  titleLength: 18
};
const supportedNoCandidateDesktopSnapshotReport = {
  ...desktopSnapshotReport,
  probeOk: true,
  pass: true,
  foreground: {
    ...desktopSnapshotReport.foreground,
    detectedToolProfile: "workbuddy",
    titleHash: "desktop-title-hash"
  },
  candidates: [],
  summary: {
    ...desktopSnapshotReport.summary,
    candidateCount: 0,
    safeCandidateCount: 0,
    valuePatternCandidates: 0,
    textPatternCandidates: 0,
    focusableCandidates: 0,
    focusedCandidateCount: 0,
    caretCandidateCount: 0,
    semanticCandidateCount: 0,
    bestCandidateIndex: -1,
    bestCandidateScore: 0,
    detectedToolProfile: "workbuddy"
  }
};
const minimizedDesktopSnapshotReport = {
  ...desktopSnapshotReport,
  foreground: {
    ...desktopSnapshotReport.foreground,
    isVisible: true,
    isMinimized: true,
    isCloaked: false,
    isUsable: false,
    boundingRect: { x: -32000, y: -32000, width: 160, height: 28 }
  }
};
const hermesDesktopSnapshotReport = {
  ...desktopSnapshotReport,
  foreground: {
    ...desktopSnapshotReport.foreground,
    processName: "Hermes Studio",
    titleHash: "hermes-title-hash",
    detectedToolProfile: "hermes",
    childToolProcessHintPresent: true
  },
  summary: {
    ...desktopSnapshotReport.summary,
    detectedToolProfile: "hermes"
  }
};
const shiftedDesktopSnapshotReport = {
  ...desktopSnapshotReport,
  candidates: [
    {
      ...desktopSnapshotReport.candidates[0],
      boundingRect: { x: 100, y: 500, width: 600, height: 80 }
    }
  ],
  summary: {
    ...desktopSnapshotReport.summary,
    bestCandidateScore: 150
  }
};
const multiCandidateDesktopSnapshotReport = {
  ...desktopSnapshotReport,
  candidates: [
    {
      ...desktopSnapshotReport.candidates[0],
      index: 0,
      boundingRect: { x: 12, y: 420, width: 560, height: 80 },
      inputSignals: {
        ...desktopSnapshotReport.candidates[0].inputSignals,
        score: 220,
        hasKeyboardFocus: true,
        focusedElementMatch: true,
        caretWithinBounds: true
      }
    },
    {
      ...desktopSnapshotReport.candidates[0],
      index: 1,
      boundingRect: { x: 200, y: 500, width: 400, height: 60 },
      inputSignals: {
        ...desktopSnapshotReport.candidates[0].inputSignals,
        score: 120,
        hasKeyboardFocus: false,
        focusedElementMatch: false,
        caretWithinBounds: false,
        nearWindowBottom: true
      }
    }
  ],
  summary: {
    ...desktopSnapshotReport.summary,
    candidateCount: 2,
    safeCandidateCount: 2,
    bestCandidateIndex: 1,
    bestCandidateScore: 120
  }
};
const codexGuardedDesktopSnapshotReport = {
  ...desktopSnapshotReport,
  foreground: {
    ...desktopSnapshotReport.foreground,
    processName: "Codex",
    titleHash: "codex-title-hash",
    detectedToolProfile: "codex",
    childToolProcessHintPresent: false
  },
  candidates: [
    {
      ...desktopSnapshotReport.candidates[0],
      index: 0,
      controlType: "ControlType.Document",
      hasValuePattern: false,
      boundingRect: { x: 0, y: 0, width: 1280, height: 720 },
      inputSignals: {
        score: 80,
        hasKeyboardFocus: false,
        focusedElementMatch: false,
        caretWithinBounds: false,
        caretWindowMatch: false,
        cursorWithinBounds: true,
        nearWindowBottom: true,
        broadDocument: true
      }
    },
    {
      ...desktopSnapshotReport.candidates[0],
      index: 1,
      controlType: "ControlType.Button",
      isKeyboardFocusable: false,
      hasValuePattern: false,
      hasTextPattern: false,
      boundingRect: { x: 900, y: 620, width: 320, height: 70 },
      inputSignals: {
        score: 15,
        hasKeyboardFocus: false,
        focusedElementMatch: false,
        caretWithinBounds: false,
        caretWindowMatch: false,
        nearWindowBottom: true,
        broadDocument: false,
        semanticComposerHint: false,
        profileComposerCandidate: false
      }
    }
  ],
  summary: {
    ...desktopSnapshotReport.summary,
    candidateCount: 2,
    safeCandidateCount: 0,
    valuePatternCandidates: 0,
    focusableCandidates: 0,
    focusedCandidateCount: 0,
    caretCandidateCount: 0,
    bestCandidateIndex: -1,
    bestCandidateScore: 0,
    detectedToolProfile: "codex"
  }
};
const codexDocumentOnlyGuardedDesktopSnapshotReport = {
  ...codexGuardedDesktopSnapshotReport,
  candidates: [
    {
      ...codexGuardedDesktopSnapshotReport.candidates[0],
      hasTextPattern: true,
      hasValuePattern: true
    }
  ],
  summary: {
    ...codexGuardedDesktopSnapshotReport.summary,
    candidateCount: 1,
    browserLikeComposerCandidateCount: 1
  }
};
const desktopFillReport = {
  schemaVersion: "m3-windows-fill@1",
  createdAt: "2026-06-08T11:01:00.000Z",
  platform: "win32",
  selfTest: true,
  confirmForeground: false,
  allowClipboardFallback: false,
  pass: true,
  writeAttempted: true,
  verified: true,
  strategy: "uia_value_pattern",
  uiaSetValueTried: true,
  clipboardFallbackTried: false,
  clipboardRestored: false,
  supportedToolProfiles: ["codex", "claude-code", "hermes", "workbuddy", "trae"],
  summary: {
    requestedTextLength: 42,
    requestedTextHash: "fill-text-hash",
    verifiedTextLength: 42,
    verifiedTextHash: "fill-text-hash",
    autoSubmit: false,
    submitSignalCount: 0
  },
  privacy: {
    titleRedacted: true,
    elementNamesHashed: true,
    elementValuesNotReadBeforeWrite: true,
    writtenTextNotStored: true,
    clipboardTextNotStored: true,
    fallbackRequiresExplicitAllow: true,
    verificationUsesLengthAndHash: true,
    promptTextNotRead: true,
    autoSubmit: false
  }
};
const selfImprovementReport = {
  reportVersion: "v6-self-improvement@1",
  readiness: {
    status: "ready",
    eventCount: 36,
    outcomeCount: 9,
    strategyCount: 4,
    reflectionCount: 3,
    positiveReflectionCount: 1,
    regressionReflectionCount: 1,
    collectingReflectionCount: 1,
    promotionGated: true
  },
  reflections: [
    {
      id: "positive-quality",
      type: "positive",
      severity: "medium",
      source: "quality_lift",
      strategyId: "outcome_weighted",
      summaryKey: "quality_lift_positive",
      nextAction: "Keep outcome-weighted guidance where aggregate lift is positive."
    },
    {
      id: "regression-segment",
      type: "regression",
      severity: "high",
      source: "quality_lift_segment",
      strategyId: "segment_guardrail",
      summaryKey: "segment_regression_guardrail",
      nextAction: "Guard matching segments from regressing prompt structures."
    },
    {
      id: "collecting-baseline",
      type: "collecting",
      severity: "medium",
      source: "strategy_insights",
      strategyId: "new_candidate",
      summaryKey: "low_sample_strategy",
      nextAction: "Collect more user-verified outcomes."
    }
  ],
  privacy: {
    aggregateOnly: true,
    noAutomaticMutation: true
  }
};
const evolutionCandidateReport = {
  candidateVersion: "v6-evolution-candidates@1",
  sourceReportVersion: "v6-self-improvement@1",
  promotionMode: "manual_review_required",
  mutationAllowed: false,
  automaticPromotion: false,
  requiresCritic: true,
  readiness: {
    status: "ready",
    candidateCount: 2,
    readyForReviewCount: 1,
    collectingCount: 1,
    promotionGated: true
  },
  candidates: [
    {
      id: "promote-outcome-weighted",
      action: "promote_prompt_strategy",
      status: "ready_for_review",
      priority: "medium",
      strategyId: "outcome_weighted",
      source: "quality_lift",
      mutationAllowed: false,
      automaticPromotion: false
    },
    {
      id: "collect-new-candidate",
      action: "collect_more_samples",
      status: "collecting",
      priority: "medium",
      strategyId: "new_candidate",
      source: "strategy_insights",
      mutationAllowed: false,
      automaticPromotion: false
    }
  ],
  privacy: {
    aggregateOnly: true,
    noAutomaticMutation: true
  }
};
const serviceRequests = [];
const tauriInvokes = [];
const scheduledIntervals = [];
const scheduledTimeouts = [];
const documentListeners = {};
const windowListeners = {};
const localStorageValues = {
  smartPromptDesktopLocale: "en"
};
const serviceAuthToken = "desktop-test-token";
let shortcutListener;
let overlayClickListener;
let overlayDraftListener;
let foregroundWindowStateListener;
let desktopSnapshotResponse = desktopSnapshotReport;
let fastForegroundResponse = fastForegroundState;
let desktopPromptStateLatest = null;
let codexInspectReady = true;
let codexDraftText = "Opening Codex composer draft";
let codexDraftHash = "a".repeat(64);
let codexLeaseSequence = 0;
let codexGenerationSequence = 0;
let codexUndoRecord = null;
let codexCandidateReminder = {
  artifactId: "artifact-codex-1",
  artifactType: "rule",
  reminderToken: "reusable_experience_found",
  ignoredCount: 0
};
let codexClaimOutcomeId = "outcome-prior-1";
let codexActivationProgress = "awaiting_codex_loop";
const codexOutcomeFeedbackStages = new Map();
const controlCenterGenerationPolicyCandidate = {
  artifactId: "artifact-generation-policy-1",
  artifactType: "generation_policy",
  status: "pending_review",
  payload: { policyId: "policy-shared", policyVersion: 3 }
};
const controlCenterPolicies = [
  { policyId: "policy-shared", version: 1, status: "stable", baselineVersion: 1 },
  { policyId: "policy-shared", version: 2, status: "benchmarked", baselineVersion: 1 }
];
const controlCenterRollouts = [
  { rolloutId: "rollout-policy-2", policyId: "policy-shared", policyVersion: 2, status: "planned" }
];
let controlCenterCanaryFails = false;
let controlCenterLearningPaused = false;

async function fakeFetch(url, options = {}) {
  const parsed = new URL(url);
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : null;
  const headers = options.headers || {};
  serviceRequests.push({ method, path: parsed.pathname, body, headers });

  if (method === "GET" && parsed.pathname === "/health") {
    return createResponse({ ok: true, service: "smart-prompt-local-service", authRequired: true });
  }
  if (method === "GET" && parsed.pathname === "/auth/bootstrap") {
    return createResponse({ ok: true, auth: { scheme: "Bearer", header: "Authorization", token: serviceAuthToken } });
  }
  if (headers.Authorization !== `Bearer ${serviceAuthToken}`) {
    return createResponse({ ok: false, error: { code: "auth_required", message: "Auth token required." } }, 401);
  }
  if (method === "GET" && parsed.pathname === "/settings") {
    return createResponse({ ok: true, settings: serviceState.settings });
  }
  if (method === "PUT" && parsed.pathname === "/settings") {
    serviceState.settings = {
      ...serviceState.settings,
      ...body,
      apiKey: "",
      providerKeys: {
        ...serviceState.settings.providerKeys,
        ...(body.providerKeys || {})
      },
      uploadWholePage: false,
      autoSubmit: false
    };
    return createResponse({ ok: true, settings: serviceState.settings });
  }
  if (method === "GET" && parsed.pathname === "/llm/providers") {
    return createResponse({
      ok: true,
      selected: serviceState.settings.provider,
      auto: { provider: "gemini" },
      providers: [
        { provider: "agnes", label: "Agnes", keyAvailable: Boolean(serviceState.settings.providerKeys.agnes) },
        { provider: "openai-compatible", label: "OpenAI-compatible", keyAvailable: Boolean(serviceState.settings.providerKeys["openai-compatible"]) },
        { provider: "anthropic", label: "Anthropic", keyAvailable: Boolean(serviceState.settings.providerKeys.anthropic) },
        { provider: "gemini", label: "Gemini", keyAvailable: Boolean(serviceState.settings.providerKeys.gemini) }
      ]
    });
  }
  if (method === "POST" && parsed.pathname === "/llm/test") {
    return createResponse({
      ok: true,
      provider: serviceState.settings.provider,
      model: serviceState.settings.model,
      mode: body.mode,
      generatedBy: "llm",
      promptLength: 72,
      skillCount: serviceState.skills.length,
      uploadWholePage: false,
      autoSubmit: false,
      testedAt: "2026-06-07T00:00:00.000Z"
    });
  }
  if (method === "GET" && parsed.pathname === "/skills") {
    return createResponse({ ok: true, skills: serviceState.skills });
  }
  if (method === "POST" && parsed.pathname === "/skills/import-folder") {
    serviceState.skills = [
      {
        id: "skill-imported",
        name: "imported-skill",
        description: `Imported from ${body.path}`
      }
    ];
    return createResponse({ ok: true, skills: serviceState.skills });
  }
  if (method === "DELETE" && parsed.pathname.startsWith("/skills/")) {
    const id = decodeURIComponent(parsed.pathname.slice("/skills/".length));
    serviceState.skills = serviceState.skills.filter((skill) => skill.id !== id);
    return createResponse({ ok: true, skills: serviceState.skills });
  }
  if (method === "GET" && parsed.pathname === "/prompts") {
    return createResponse({ ok: true, prompts: serviceState.prompts });
  }
  if (method === "POST" && parsed.pathname === "/prompts") {
    serviceState.prompts = [
      {
        id: "prompt-saved",
        title: body.title,
        body: body.body,
        source: body.source
      }
    ];
    return createResponse({ ok: true, prompts: serviceState.prompts });
  }
  if (method === "DELETE" && parsed.pathname.startsWith("/prompts/")) {
    const id = decodeURIComponent(parsed.pathname.slice("/prompts/".length));
    serviceState.prompts = serviceState.prompts.filter((prompt) => prompt.id !== id);
    return createResponse({ ok: true, prompts: serviceState.prompts });
  }
  if (method === "POST" && parsed.pathname === "/target/codex/inspect") {
    assert.deepEqual(body, {});
    if (!codexInspectReady) {
      return createResponse({
        ok: true,
        result: { status: "blocked", target: "codex", reasonToken: "foreground_not_codex" },
        lease: null
      });
    }
    codexLeaseSequence += 1;
    return createResponse({
      ok: true,
      result: {
        status: "ready",
        target: "codex",
        reasonToken: "ready",
        verification: "machine",
        noAutoSubmit: true
      },
      lease: {
        leaseId: `lease-codex-${codexLeaseSequence}`,
        target: "codex",
        hwnd: "0x7777",
        pid: 7777,
        runtimeIdentityHash: "runtime-codex",
        focused: true,
        focusIdentityHash: "focus-codex",
        draftHash: codexDraftHash,
        projectScopeToken: "project-scope-codex",
        projectScopeReliable: true,
        capabilities: {
          exactRead: true,
          fullReplace: true,
          directSetValue: true,
          controlledClipboard: true,
          projectScopeReliable: true
        }
      }
    });
  }
  if (method === "POST" && parsed.pathname === "/target/codex/read") {
    assert.match(body.leaseId, /^lease-codex-/);
    return createResponse({
      ok: true,
      result: {
        status: "ready",
        target: "codex",
        verified: true,
        verification: "machine",
        readbackMatched: true,
        noAutoSubmit: true
      },
      draftText: codexDraftText
    });
  }
  if (method === "POST" && parsed.pathname === "/target/codex/insert") {
    assert.deepEqual(Object.keys(body).sort(), [
      "allowClipboardFallback",
      "expectedDraftHash",
      "generationId",
      "leaseId",
      "text"
    ]);
    assert.equal(body.expectedDraftHash, codexDraftHash);
    assert.match(body.generationId, /^generation-codex-/);
    assert.equal(body.allowClipboardFallback, true);
    codexUndoRecord = {
      token: "undo-codex-1",
      draftText: codexDraftText,
      draftHash: codexDraftHash
    };
    codexDraftText = body.text;
    codexDraftHash = "b".repeat(64);
    return createResponse({
      ok: true,
      result: {
        status: "ready",
        target: "codex",
        verified: true,
        verification: "machine",
        readbackMatched: true,
        noAutoSubmit: true
      },
      undoToken: codexUndoRecord.token,
      transaction: {
        transactionId: "transaction-codex-1",
        target: "codex",
        projectScopeToken: "project-scope-codex"
      },
      pendingOutcome: {
        outcomeId: "outcome-current-1",
        status: "unknown",
        projectScopeToken: "project-scope-codex"
      }
    });
  }
  if (method === "POST" && parsed.pathname === "/target/codex/undo") {
    assert.deepEqual(Object.keys(body).sort(), ["allowClipboardFallback", "undoToken"]);
    assert.equal(body.undoToken, codexUndoRecord?.token);
    codexDraftText = codexUndoRecord.draftText;
    codexDraftHash = codexUndoRecord.draftHash;
    codexUndoRecord = null;
    return createResponse({
      ok: true,
      result: {
        operation: "undo",
        status: "ready",
        target: "codex",
        attempted: true,
        verified: false,
        verification: "machine",
        writeMethod: "direct",
        foregroundVerified: true,
        targetIdentityVerified: true,
        focusVerified: true,
        draftUnchanged: true,
        payloadFresh: true,
        readbackMatched: true,
        noAutoSubmit: true
      }
    });
  }
  if (method === "GET" && parsed.pathname === "/activation/codex/status") {
    return createResponse({ ok: true, activation: { progress: codexActivationProgress } });
  }
  if (method === "POST" && parsed.pathname === "/activation/codex/loop-start") {
    codexActivationProgress = "awaiting_codex_loop";
    return createResponse({ ok: true, activation: { progress: codexActivationProgress } });
  }
  if (method === "POST" && parsed.pathname === "/activation/codex/complete") {
    assert.deepEqual(body, {
      contractVersion: "codex-activation@2",
      transactionId: "transaction-codex-1"
    });
    codexActivationProgress = "activated";
    return createResponse({ ok: true, activation: { progress: codexActivationProgress } });
  }
  if (method === "POST" && parsed.pathname === "/outcomes/v2/claim") {
    assert.equal(body.target, "codex");
    assert.equal(body.projectScopeToken, "project-scope-codex");
    return createResponse({
      ok: true,
      result: {
        state: "question",
        outcome: { outcomeId: codexClaimOutcomeId, status: "unknown" }
      }
    });
  }
  if (method === "POST" && parsed.pathname === "/outcomes/v2/feedback") {
    const stage = codexOutcomeFeedbackStages.get(body.outcomeId) || "asked";
    if (body.taskOutcomeToken === "completed") {
      assert.equal(Object.hasOwn(body, "reasonToken"), false);
      codexOutcomeFeedbackStages.set(body.outcomeId, "completed");
      return createResponse({
        ok: true,
        result: {
          state: "completed",
          outcome: { outcomeId: body.outcomeId, status: "succeeded" }
        }
      });
    }
    if (stage === "asked") {
      assert.equal(Object.hasOwn(body, "reasonToken"), false);
      codexOutcomeFeedbackStages.set(body.outcomeId, "reason_required");
      return createResponse({
        ok: true,
        result: {
          state: "reason_required",
          outcome: { outcomeId: body.outcomeId, status: "unknown" },
          failureReasonTokens: ["tool_mismatch", "low_quality"]
        }
      });
    }
    assert.equal(stage, "reason_required");
    assert.equal(body.reasonToken, "tool_mismatch");
    codexOutcomeFeedbackStages.set(body.outcomeId, "not_completed");
    return createResponse({
      ok: true,
      result: {
        state: "not_completed",
        outcome: {
          outcomeId: body.outcomeId,
          status: "failed",
          failureReasonTokens: [body.reasonToken]
        }
      }
    });
  }
  if (method === "GET" && parsed.pathname === "/learning/v1/reminder") {
    assert.equal(parsed.searchParams.get("projectScopeToken"), "project-scope-codex");
    assert.deepEqual(parsed.searchParams.getAll("featureToken"), [
      "scenario:desktop-tool-input",
      `mode:${codexGenerationSequence === 1 ? "polish" : "idea"}`,
      "model:model-codex",
      "target:codex"
    ]);
    return createResponse({ ok: true, reminder: codexCandidateReminder });
  }
  if (method === "POST" && parsed.pathname === "/learning/v1/reminder/resolve") {
    assert.equal(body.projectScopeToken, "project-scope-codex");
    assert.equal(body.input, codexDraftText);
    const featureTokens = [
      `scenario:${body.taskScenarioToken}`,
      `mode:${body.modeToken}`,
      "model:model-codex",
      "target:codex"
    ];
    return createResponse({ ok: true, reminder: codexCandidateReminder, featureTokens });
  }
  if (method === "POST" && parsed.pathname === "/learning/v1/candidates/ignore") {
    assert.equal(body.artifactId, codexCandidateReminder?.artifactId || "artifact-codex-1");
    const candidate = {
      ...(codexCandidateReminder || { artifactId: body.artifactId }),
      review: { ignoredCount: 1 }
    };
    codexCandidateReminder = null;
    return createResponse({ ok: true, candidate });
  }
  if (method === "POST" && parsed.pathname === "/learning/v1/candidates/review") {
    assert.equal(body.decision.action, "accept");
    return createResponse({
      ok: true,
      candidate: { artifactId: body.artifactId, artifactType: "rule", status: "active", effective: true }
    });
  }
  if (method === "GET" && parsed.pathname === "/learning/v1/candidate") {
    return createResponse({
      ok: true,
      candidate: {
        artifactId: parsed.searchParams.get("artifactId"),
        artifactType: "rule",
        status: "pending_review",
        payload: { directive: "Keep acceptance criteria explicit" },
        review: { ignoredCount: 0 }
      }
    });
  }
  if (method === "GET" && parsed.pathname === "/learning/v1/artifacts") {
    return createResponse({
      ok: true,
      artifacts: [controlCenterGenerationPolicyCandidate, ...(codexCandidateReminder ? [codexCandidateReminder] : [])]
    });
  }
  if (method === "GET" && parsed.pathname === "/learning/v1/global-proposals") {
    return createResponse({ ok: true, proposals: [] });
  }
  if (method === "GET" && parsed.pathname === "/policies/v1") {
    return createResponse({ ok: true, learningPaused: controlCenterLearningPaused, policies: controlCenterPolicies });
  }
  if (method === "GET" && parsed.pathname === "/policies/v1/rollouts") {
    return createResponse({ ok: true, rollouts: controlCenterRollouts });
  }
  if (method === "POST" && parsed.pathname === "/policies/v1/canary") {
    assert.deepEqual(Object.keys(body).sort(), ["canaryShareBps", "policyId", "version"]);
    assert.deepEqual(body, { policyId: "policy-shared", version: 2, canaryShareBps: 1000 });
    if (controlCenterCanaryFails) {
      return createResponse({
        ok: false,
        error: { code: "verified_benchmark_plan_missing", message: "Verified benchmark plan is unavailable." }
      }, 409);
    }
    return createResponse({ ok: true, policy: { ...controlCenterPolicies[1], status: "canary" } });
  }
  if (method === "POST" && parsed.pathname === "/policies/v1/rollback") {
    assert.deepEqual(body, { policyId: "policy-shared", version: 1, reason: "manual" });
    return createResponse({ ok: true, policy: { ...controlCenterPolicies[0], status: "rolled_back" } });
  }
  if (method === "POST" && parsed.pathname === "/policies/v1/pause") {
    assert.deepEqual(body, { reason: "manual" });
    controlCenterLearningPaused = true;
    return createResponse({ ok: true, state: { paused: true } });
  }
  if (method === "POST" && parsed.pathname === "/policies/v1/resume") {
    assert.deepEqual(body, {});
    controlCenterLearningPaused = false;
    return createResponse({ ok: true, state: { paused: false } });
  }
  if (method === "POST" && parsed.pathname === "/generate") {
    if (body.target === "codex") {
      codexGenerationSequence += 1;
      assert.equal(body.projectScopeToken, "project-scope-codex");
      assert.match(body.sessionId, /^desktop-session-/);
      assert.equal(body.context.target, "codex");
      assert.equal(body.context.adapterId, "target-codex-v1");
      return createResponse({
        ok: true,
        card: {
          prompt: `Generated Codex prompt for ${body.input}`,
          mode: body.context.mode,
          generatedBy: "fixture",
          generationId: `generation-codex-${codexGenerationSequence}`,
          sessionId: body.sessionId,
          taskScenario: body.context.taskScenario,
          strategyId: "strategy-codex-v1",
          modelFamilyToken: "model-codex"
        }
      });
    }
    assert.equal(body.context.tool, "workbuddy");
    assert.equal(body.context.adapterId, "desktop-workbuddy");
    assert.equal(body.context.inputKind, "desktop-uia");
    assert.ok(["idea", "continue", "polish"].includes(body.context.mode));
    return createResponse({
      ok: true,
      card: {
        prompt: `Generated desktop prompt for ${body.input}`,
        mode: body.context.mode,
        generatedBy: "template-fallback",
        quality: { score: 0.82 }
      }
    });
  }
  if (method === "GET" && parsed.pathname === "/diagnostics/export") {
    return createResponse({
      ok: true,
      diagnostics: {
        diagnostics: true,
        portRecovery: { portRecovery: true },
        keyMigration: { migrateProviderKeys: true },
        metrics: { insertSuccessRate: 1 },
        pilotOutcomeReadinessReport: pilotOutcomeReport,
        pilotOutcomeReadinessText: "pilotOutcome=v6-pilot-outcome-readiness@1; privacy=aggregate-only",
        promptQualityLiftReport: qualityLiftReport,
        promptQualityLiftText: "qualityLift=v6-quality-lift@1; privacy=aggregate-only",
        promptQualityLiftSegmentsReport: qualityLiftSegmentsReport,
        promptQualityLiftSegmentsText: "qualityLiftSegments=v6-quality-lift-segments@1; privacy=aggregate-only",
        selfImprovementReport,
        selfImprovementText: "selfImprovement=v6-self-improvement@1; privacy=aggregate-only",
        evolutionCandidateReport,
        evolutionCandidateText: "evolutionCandidates=v6-evolution-candidates@1; privacy=aggregate-only"
      }
    });
  }
  if (method === "GET" && parsed.pathname === "/metrics/pilot-outcomes") {
    return createResponse({
      ok: true,
      pilotOutcomeReadinessReport: pilotOutcomeReport,
      pilotOutcomeReadinessText: "pilotOutcome=v6-pilot-outcome-readiness@1; privacy=aggregate-only"
    });
  }
  if (method === "GET" && parsed.pathname === "/metrics/prompt-quality-lift") {
    return createResponse({
      ok: true,
      promptQualityLiftReport: qualityLiftReport,
      promptQualityLiftText: "qualityLift=v6-quality-lift@1; privacy=aggregate-only"
    });
  }
  if (method === "GET" && parsed.pathname === "/metrics/prompt-quality-lift-segments") {
    return createResponse({
      ok: true,
      promptQualityLiftSegmentsReport: qualityLiftSegmentsReport,
      promptQualityLiftSegmentsText: "qualityLiftSegments=v6-quality-lift-segments@1; privacy=aggregate-only"
    });
  }
  if (method === "GET" && parsed.pathname === "/outcomes/pending") {
    return createResponse({
      ok: true,
      pendingOutcomeCount: pendingOutcomeState.pendingOutcomes.length,
      pendingOutcomes: pendingOutcomeState.pendingOutcomes,
      privacy: {
        metadataOnly: true,
        promptTextNotStored: true,
        inputTextNotStored: true,
        pageBodyNotRequired: true,
        fullUrlNotStored: true
      }
    });
  }
  if (method === "GET" && parsed.pathname === "/desktop/input-snapshot") {
    return createResponse({
      ok: true,
      snapshot: desktopSnapshotResponse
    });
  }
  if (method === "POST" && parsed.pathname === "/desktop/prompt-state") {
    const activeText = body.prompt || body.draft || "";
    desktopPromptStateLatest = {
      schemaVersion: "p25-desktop-prompt-state@1",
      recordedAt: "2026-06-09T00:00:00.000Z",
      source: "desktop-shell",
      prepared: Boolean(activeText.trim()),
      activeTextKind: body.prompt ? "generated" : body.draft ? "draft" : "none",
      activeTextLength: activeText.trim().length,
      activeTextHash: activeText.trim() ? "prompt-state-hash" : "",
      generatedBy: body.generatedBy || "unknown",
      readiness: {
        ...(body.readiness || {}),
        noAutoSubmit: body.noAutoSubmit !== false
      },
      privacy: {
        promptTextNotStored: true,
        draftTextNotStored: true,
        onlyLengthAndHash: true,
        targetInputsNotStored: true
      }
    };
    return createResponse({ ok: true, desktopPrompt: desktopPromptStateLatest });
  }
  if (method === "GET" && parsed.pathname === "/desktop/prompt-state") {
    return createResponse({ ok: true, desktopPrompt: desktopPromptStateLatest });
  }
  if (method === "POST" && parsed.pathname === "/desktop/fill") {
    if (body.confirmForeground) {
      assert.equal(body.allowClipboardFallback, true);
      assert.equal(body.allowTextPatternVerification, true);
      assert.equal(body.expectedTitleHash, "desktop-title-hash");
      assert.equal(body.expectedToolProfile, "workbuddy");
      assert.equal(body.candidateIndex, 0);
      assert.ok(body.text.includes("Generated desktop prompt"));
      return createResponse({
        ok: true,
        fill: {
          ...desktopFillReport,
          selfTest: false,
          confirmForeground: true,
          allowClipboardFallback: true,
          allowTextPatternVerification: true,
          foreground: {
            ...desktopFillReport.foreground,
            titleHash: "desktop-title-hash",
            detectedToolProfile: "workbuddy",
            expectedTitleHashMatched: true,
            expectedToolProfileMatched: true
          }
        }
      });
    }
    return createResponse({
      ok: true,
      fill: desktopFillReport
    });
  }
  if (method === "GET" && parsed.pathname === "/learning/reflections") {
    return createResponse({
      ok: true,
      selfImprovementReport,
      selfImprovementText: "selfImprovement=v6-self-improvement@1; privacy=aggregate-only"
    });
  }
  if (method === "GET" && parsed.pathname === "/learning/evolution-candidates") {
    return createResponse({
      ok: true,
      selfImprovementReport,
      selfImprovementText: "selfImprovement=v6-self-improvement@1; privacy=aggregate-only",
      evolutionCandidateReport,
      evolutionCandidateText: "evolutionCandidates=v6-evolution-candidates@1; privacy=aggregate-only"
    });
  }
  if (method === "POST" && parsed.pathname === "/outcomes/follow-up") {
    const target = pendingOutcomeState.pendingOutcomes.find((item) => item.generationId === body.generationId);
    pendingOutcomeState.pendingOutcomes = pendingOutcomeState.pendingOutcomes.filter((item) => item.generationId !== body.generationId);
    return createResponse({
      ok: true,
      outcome: {
        action: "outcome",
        generationId: body.generationId,
        strategyId: target?.strategyId || "",
        taskScenario: target?.taskScenario || "",
        outcomeLabel: body.outcomeLabel,
        outcomeScore: body.outcomeLabel === "success" ? 1 : body.outcomeLabel === "needs-work" ? 0.45 : 0,
        outcomeVerified: true,
        outcomeSource: "manual_followup"
      },
      pendingOutcomeCount: pendingOutcomeState.pendingOutcomes.length,
      pendingOutcomes: pendingOutcomeState.pendingOutcomes,
      privacy: {
        metadataOnly: true,
        promptTextNotStored: true,
        inputTextNotStored: true,
        pageBodyNotRequired: true,
        fullUrlNotStored: true
      }
    });
  }
  if (method === "DELETE" && parsed.pathname === "/data/all") {
    serviceState.skills = [];
    serviceState.prompts = [];
    serviceState.settings.providerKeys = {
      agnes: "",
      "openai-compatible": "",
      anthropic: "",
      gemini: ""
    };
    return createResponse({ ok: true, deleted: { clearAllLocalData: true } });
  }

  return createResponse({ ok: false, error: { message: `Unhandled ${method} ${parsed.pathname}` } }, 404);
}

const context = {
  URL,
  assert,
  console,
  fetch: fakeFetch,
  setInterval(handler, delay) {
    scheduledIntervals.push({ handler, delay });
    return scheduledIntervals.length;
  },
  setTimeout(handler, delay) {
    const entry = { handler, delay, cleared: false };
    scheduledTimeouts.push(entry);
    if (delay === 500 || delay === 100) scheduledIntervals.push(entry);
    return scheduledTimeouts.length;
  },
  clearTimeout(id) {
    if (scheduledTimeouts[id - 1]) scheduledTimeouts[id - 1].cleared = true;
  },
  document: {
    hidden: false,
    visibilityState: "visible",
    addEventListener(type, handler) {
      documentListeners[type] = handler;
    },
    documentElement: new FakeElement("html"),
    getElementById(id) {
      assert.ok(elements[id], `missing fake element ${id}`);
      return elements[id];
    }
  },
  localStorage: {
    getItem(key) {
      return localStorageValues[key] || "";
    },
    setItem(key, value) {
      localStorageValues[key] = String(value);
    },
    removeItem(key) {
      delete localStorageValues[key];
    }
  },
  window: {}
};
context.window = {
  addEventListener(type, handler) {
    windowListeners[type] = handler;
  },
  confirm() {
    return true;
  },
  __TAURI__: {
    core: {
      async invoke(command, payload) {
        tauriInvokes.push({ command, payload });
        if (command === "set_global_shortcut") return payload.shortcut;
        if (command === "start_local_service") return "started";
        if (command === "stop_local_service") return "stopped";
        if (command === "restart_local_service") return "started";
        if (command === "get_local_service_status") return "stopped";
        if (command === "get_foreground_window_state") return fastForegroundResponse;
        if (command === "show_main_window") return "shown-main";
        if (command === "show_mascot_overlay") return "shown";
        if (command === "hide_mascot_overlay") return "hidden";
        if (command === "set_mascot_overlay_state") return "state";
        if (command === "mascot_overlay_clicked") return "clicked";
        throw new Error(`Unhandled Tauri command ${command}`);
      }
    },
    event: {
      listen(eventName, handler) {
        if (eventName === "smart-prompt-shortcut") shortcutListener = handler;
        else if (eventName === "smart-prompt-overlay-click") overlayClickListener = handler;
        else if (eventName === "smart-prompt-overlay-draft") overlayDraftListener = handler;
        else if (eventName === "smart-prompt-foreground-window-state") foregroundWindowStateListener = handler;
        else assert.fail(`unexpected event listener ${eventName}`);
        return Promise.resolve(() => {});
      }
    }
  }
};

let interactionTestPhase = "boot";
const interactionTestRun = (async () => {
  vm.createContext(context);
  vm.runInContext(desktopOverlayLogicSource, context, { filename: "src/desktop-overlay-logic.js" });
  const verifiedUndoFixture = {
    operation: "undo",
    status: "ready",
    attempted: true,
    verified: false,
    verification: "machine",
    writeMethod: "direct",
    foregroundVerified: true,
    targetIdentityVerified: true,
    focusVerified: true,
    draftUnchanged: true,
    payloadFresh: true,
    readbackMatched: true,
    noAutoSubmit: true
  };
  assert.equal(context.SmartPromptDesktopOverlayLogic.isMachineVerifiedCodexUndo(verifiedUndoFixture), true);
  assert.equal(context.SmartPromptDesktopOverlayLogic.isMachineVerifiedCodexUndo({
    ...verifiedUndoFixture,
    readbackMatched: false
  }), false);
  assert.equal(context.SmartPromptDesktopOverlayLogic.isMachineVerifiedCodexUndo({
    ...verifiedUndoFixture,
    writeMethod: "controlled_clipboard",
    clipboardRestored: false
  }), false);
  vm.runInContext(appSource, context, { filename: "src/app.js" });

  await waitFor(() => elements["service-status"].textContent === "service online", "initial service load");
  interactionTestPhase = "initial-service-loaded";
  await waitFor(() => scheduledIntervals.length === 2, "desktop overlay auto intervals");
  await waitFor(
    () => tauriInvokes.some((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe === true),
    "desktop overlay fast auto show"
  );
  await waitFor(
    () => tauriInvokes.some((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe !== true),
    "desktop overlay auto show"
  );
  assert.equal(elements["ui-locale"].value, "en");
  assert.equal(context.window.__smartPromptOverlayAutoDetectReady, true);
  assert.equal(scheduledIntervals[0].delay, 500);
  assert.equal(scheduledIntervals[1].delay, 100);
  assert.ok(tauriInvokes.some((invoke) => invoke.command === "start_local_service"));
  assert.equal(typeof foregroundWindowStateListener, "function");
  const initialFastOverlayShow = tauriInvokes.find((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe === true);
  assert.equal(initialFastOverlayShow.payload.payload.profile, "workbuddy");
  assert.equal(initialFastOverlayShow.payload.payload.visualOnly, true);
  assert.equal(initialFastOverlayShow.payload.payload.candidateIndex, -1);
  assert.equal(initialFastOverlayShow.payload.payload.visualAnchorReason, "fast-window-probe");
  const initialAutoOverlayShow = tauriInvokes.find((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe !== true);
  assert.equal(initialAutoOverlayShow.payload.payload.profile, "workbuddy");
  assert.equal(initialAutoOverlayShow.payload.payload.overlayMode, "compact");
  assert.equal(initialAutoOverlayShow.payload.payload.promptMode, "idea");
  const initialOverlayPlacement = expectedDesktopOverlayPlacement(desktopSnapshotReport.candidates[0]);
  assert.equal(initialAutoOverlayShow.payload.payload.x, initialOverlayPlacement.x);
  assert.equal(initialAutoOverlayShow.payload.payload.y, initialOverlayPlacement.y);
  assert.equal(initialAutoOverlayShow.payload.payload.compactX, initialOverlayPlacement.compactX);
  assert.equal(initialAutoOverlayShow.payload.payload.compactY, initialOverlayPlacement.compactY);
  fastForegroundResponse = minimizedFastForegroundState;
  const overlayHideCountBeforeFastMinimize = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  scheduledIntervals[1].handler();
  await waitFor(
    () => tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length > overlayHideCountBeforeFastMinimize,
    "fast foreground minimized overlay hide"
  );
  assert.equal(context.document.documentElement.dataset.desktopFastToolSupported, "false");
  assert.equal(context.document.documentElement.dataset.desktopFastToolUsable, "false");
  const overlayShowCountBeforeStaleSnapshot = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length;
  const overlayHideCountBeforeStaleSnapshot = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  const snapshotRequestsBeforeStaleSnapshot = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  scheduledIntervals[0].handler();
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeStaleSnapshot,
    "stale slow snapshot blocked by fast minimized foreground"
  );
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length, overlayShowCountBeforeStaleSnapshot);
  assert.ok(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length > overlayHideCountBeforeStaleSnapshot);
  fastForegroundResponse = {
    ...fastForegroundState,
    hwnd: "0x5678",
    titleHash: "fast-title-hash-restored"
  };
  const fastOverlayShowCountBeforeRestore = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe === true).length;
  scheduledIntervals[1].handler();
  await waitFor(
    () => tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe === true).length > fastOverlayShowCountBeforeRestore,
    "fast foreground restored overlay show"
  );
  assert.equal(context.document.documentElement.dataset.desktopFastToolSupported, "true");
  assert.equal(context.document.documentElement.dataset.desktopFastToolUsable, "true");
  const fastOverlayShowCountAfterRestore = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe === true).length;
  scheduledIntervals[1].handler();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe === true).length,
    fastOverlayShowCountAfterRestore
  );
  const overlayHideCountBeforeNativeUnknown = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  await foregroundWindowStateListener({ payload: unknownFastForegroundState });
  await waitFor(
    () => tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length > overlayHideCountBeforeNativeUnknown,
    "native foreground unknown overlay hide"
  );
  assert.equal(context.document.documentElement.dataset.desktopFastToolProfile, "unknown");
  assert.equal(context.document.documentElement.dataset.desktopFastToolSupported, "false");
  const nativeCodexAdapterShowCountBeforeRestore = tauriInvokes.filter((invoke) => (
    invoke.command === "show_mascot_overlay" && invoke.payload.payload.codexAdapterReady === true
  )).length;
  await foregroundWindowStateListener({ payload: codexFastForegroundState });
  interactionTestPhase = "codex-adapter";
  await waitFor(
    () => tauriInvokes.filter((invoke) => (
      invoke.command === "show_mascot_overlay" && invoke.payload.payload.codexAdapterReady === true
    )).length > nativeCodexAdapterShowCountBeforeRestore,
    "native foreground codex adapter overlay show"
  );
  const nativeCodexAdapterShow = tauriInvokes.filter((invoke) => (
    invoke.command === "show_mascot_overlay" && invoke.payload.payload.codexAdapterReady === true
  )).at(-1);
  assert.equal(nativeCodexAdapterShow.payload.payload.visualOnly, false);
  assert.equal(nativeCodexAdapterShow.payload.payload.fastWindowProbe, false);
  assert.equal(nativeCodexAdapterShow.payload.payload.exactRead, true);
  assert.equal(nativeCodexAdapterShow.payload.payload.fullReplace, true);
  assert.equal(context.document.documentElement.dataset.desktopFastToolProfile, "codex");
  assert.equal(context.document.documentElement.dataset.desktopFastToolSupported, "true");
  fastForegroundResponse = fastForegroundState;
  assert.equal(typeof documentListeners.visibilitychange, "function");
  assert.equal(typeof windowListeners.pagehide, "function");
  const overlayHideCountBeforeShellHidden = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  context.document.hidden = true;
  context.document.visibilityState = "hidden";
  documentListeners.visibilitychange();
  await waitFor(
    () => tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length > overlayHideCountBeforeShellHidden,
    "desktop shell hidden overlay hide"
  );
  assert.equal(context.document.documentElement.dataset.desktopShellVisible, "false");
  const overlayShowCountBeforeShellVisible = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length;
  const snapshotRequestsBeforeShellVisible = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  context.document.hidden = false;
  context.document.visibilityState = "visible";
  documentListeners.visibilitychange();
  await waitFor(
    () => context.document.documentElement.dataset.desktopFastToolProfile === "workbuddy",
    "desktop shell visible fast refresh"
  );
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeShellVisible,
    "desktop shell visible snapshot refresh after fast gate"
  );
  await waitFor(
    () => tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length > overlayShowCountBeforeShellVisible,
    "desktop shell visible overlay recovery"
  );
  assert.equal(context.document.documentElement.dataset.desktopShellVisible, "true");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/auth/bootstrap"));
  assert.ok(serviceRequests.some((request) => request.path === "/settings" && request.headers.Authorization === `Bearer ${serviceAuthToken}`));
  assert.ok(elements["provider-status"].textContent.includes("Selected: auto"));
  assert.ok(elements["skill-list"].innerHTML.includes("No imported skills"));
  assert.ok(elements["prompt-list"].innerHTML.includes("No saved prompts"));
  assert.equal(elements["pilot-outcome-status"].dataset.pilotOutcomeStatus, "ready");
  assert.equal(elements["pilot-outcome-status"].dataset.totalOutcomeEvents, "7");
  assert.ok(elements["pilot-outcome-summary"].innerHTML.includes("Success"));
  assert.ok(elements["pilot-outcome-strategies"].innerHTML.includes("security-winner"));
  assert.ok(elements["pilot-outcome-strategies"].innerHTML.includes("ui-risk"));
  assert.ok(elements["pilot-outcome-targets"].innerHTML.includes("data-analysis"));
  assert.equal(elements["quality-lift-status"].dataset.qualityLiftStatus, "ready");
  assert.equal(elements["quality-lift-status"].dataset.primaryDecision, "quality_lift_positive");
  assert.equal(elements["quality-lift-status"].dataset.outcomeWeightedOutcomeCount, "3");
  assert.equal(elements["quality-lift-status"].dataset.comparable, "true");
  assert.ok(elements["quality-lift-summary"].innerHTML.includes("Success lift"));
  assert.ok(elements["quality-lift-summary"].innerHTML.includes("+67%"));
  assert.ok(elements["quality-lift-cohorts"].innerHTML.includes("outcome_weighted"));
  assert.ok(elements["quality-lift-comparisons"].innerHTML.includes("outcome_weighted_vs_baseline"));
  assert.ok(elements["quality-lift-recommendations"].innerHTML.includes("keep_outcome_weighting"));
  assert.equal(elements["quality-lift-segments-status"].dataset.qualityLiftSegmentsStatus, "review");
  assert.equal(elements["quality-lift-segments-status"].dataset.segmentCount, "12");
  assert.equal(elements["quality-lift-segments-status"].dataset.improvingSegmentCount, "4");
  assert.equal(elements["quality-lift-segments-status"].dataset.regressingSegmentCount, "4");
  assert.equal(elements["quality-lift-segments-status"].dataset.collectingSegmentCount, "4");
  assert.ok(elements["quality-lift-segments-improving"].innerHTML.includes("tool / chatgpt"));
  assert.ok(elements["quality-lift-segments-regressing"].innerHTML.includes("tool / claude"));
  assert.ok(elements["quality-lift-segments-collecting"].innerHTML.includes("taskScenario / test-plan"));
  assert.equal(elements["outcome-followup-status"].dataset.pendingOutcomeCount, "2");
  assert.equal(elements["outcome-followup-status"].dataset.metadataOnly, "true");
  assert.ok(elements["outcome-followup-list"].innerHTML.includes("generation-followup-1"));
  assert.ok(elements["outcome-followup-list"].innerHTML.includes("security-review"));
  assert.ok(elements["outcome-followup-list"].innerHTML.includes("Needs work"));
  assert.equal(elements["learning-status"].dataset.learningStatus, "ready");
  assert.equal(elements["learning-status"].dataset.reflectionCount, "3");
  assert.equal(elements["learning-status"].dataset.candidateCount, "2");
  assert.equal(elements["learning-status"].dataset.mutationAllowed, "false");
  assert.equal(elements["learning-status"].dataset.requiresCritic, "true");
  assert.ok(elements["self-improvement-summary"].innerHTML.includes("quality_lift"));
  assert.ok(elements["evolution-candidate-summary"].innerHTML.includes("promote_prompt_strategy"));
  assert.equal(elements["desktop-companion-status"].dataset.desktopSnapshotStatus, "ready");
  assert.equal(elements["desktop-companion-status"].dataset.detectedToolProfile, "workbuddy");
  assert.equal(elements["desktop-supported-profiles"].dataset.supportedProfileCount, "5");
  assert.equal(elements["desktop-mascot-state"].dataset.mascotState, "suggesting");
  assert.equal(elements["desktop-fusion-mascot-state"].dataset.mascotState, "suggesting");
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "ready");
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayReady, "true");
  assert.equal(elements["fill-foreground-input"].disabled, true);
  assert.equal(elements["first-run-progress"].dataset.firstRunReady, "false");
  assert.equal(elements["first-run-progress"].dataset.privacyVisible, "true");

  desktopSnapshotResponse = shiftedDesktopSnapshotReport;
  const autoSnapshotRequestsBeforeShift = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const autoOverlayShowCountBeforeShift = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length;
  scheduledIntervals[0].handler();
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > autoSnapshotRequestsBeforeShift, "desktop overlay auto poll");
  await waitFor(() => tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length > autoOverlayShowCountBeforeShift, "desktop overlay auto reposition");
  const shiftedAutoOverlayShow = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").at(-1);
  assert.equal(shiftedAutoOverlayShow.payload.payload.profile, "workbuddy");
  assert.equal(shiftedAutoOverlayShow.payload.payload.candidateIndex, 0);
  assert.equal(shiftedAutoOverlayShow.payload.payload.overlayMode, "compact");
  assert.equal(shiftedAutoOverlayShow.payload.payload.promptMode, "idea");
  const shiftedOverlayPlacement = expectedDesktopOverlayPlacement(shiftedDesktopSnapshotReport.candidates[0]);
  assert.equal(shiftedAutoOverlayShow.payload.payload.x, shiftedOverlayPlacement.x);
  assert.equal(shiftedAutoOverlayShow.payload.payload.y, shiftedOverlayPlacement.y);
  assert.equal(shiftedAutoOverlayShow.payload.payload.compactX, shiftedOverlayPlacement.compactX);
  assert.equal(shiftedAutoOverlayShow.payload.payload.compactY, shiftedOverlayPlacement.compactY);
  desktopSnapshotResponse = desktopSnapshotReport;

  desktopSnapshotResponse = multiCandidateDesktopSnapshotReport;
  const autoSnapshotRequestsBeforeMultiCandidate = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const autoOverlayShowCountBeforeMultiCandidate = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length;
  scheduledIntervals[0].handler();
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > autoSnapshotRequestsBeforeMultiCandidate, "desktop overlay multi-candidate poll");
  await waitFor(() => tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length > autoOverlayShowCountBeforeMultiCandidate, "desktop overlay multi-candidate reposition");
  const multiCandidateOverlayShow = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").at(-1);
  assert.equal(multiCandidateOverlayShow.payload.payload.candidateIndex, 1);
  const multiCandidateOverlayPlacement = expectedDesktopOverlayPlacement(multiCandidateDesktopSnapshotReport.candidates[1]);
  assert.equal(multiCandidateOverlayShow.payload.payload.x, multiCandidateOverlayPlacement.x);
  assert.equal(multiCandidateOverlayShow.payload.payload.y, multiCandidateOverlayPlacement.y);
  assert.equal(multiCandidateOverlayShow.payload.payload.compactX, multiCandidateOverlayPlacement.compactX);
  assert.equal(multiCandidateOverlayShow.payload.payload.compactY, multiCandidateOverlayPlacement.compactY);
  desktopSnapshotResponse = desktopSnapshotReport;

  elements.provider.value = "agnes";
  elements.provider.trigger("change");
  assert.equal(elements["base-url"].value, "https://apihub.agnes-ai.com/v1");
  assert.equal(elements.model.value, "agnes-2.0-flash");

  elements.provider.value = "gemini";
  elements.provider.trigger("change");
  assert.equal(elements["base-url"].value, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(elements.model.value, "gemini-2.5-flash");

  elements["agnes-api-key"].value = "sk-agnes-test";
  elements["openai-api-key"].value = "sk-openai-test";
  elements["anthropic-api-key"].value = "sk-ant-test";
  elements["gemini-api-key"].value = "sk-gemini-test";
  await elements["save-settings"].trigger("click");
  await waitFor(() => serviceState.settings.providerKeys.gemini === "sk-gemini-test", "settings save");
  const settingsRequest = serviceRequests.find((request) => request.method === "PUT" && request.path === "/settings");
  assert.equal(settingsRequest.body.provider, "gemini");
  assert.equal(settingsRequest.body.providerKeys.agnes, "sk-agnes-test");
  assert.equal(settingsRequest.body.providerKeys.anthropic, "sk-ant-test");
  assert.equal(elements["agnes-api-key"].value, "");
  assert.equal(elements["gemini-api-key"].value, "");
  assert.equal(localStorageValues.smartPromptProviderTestPass, "false");

  elements["skill-folder"].value = "C:\\Users\\you\\.codex\\skills";
  await elements["import-folder"].trigger("click");
  await waitFor(() => elements["skill-list"].innerHTML.includes("imported-skill"), "skill import");
  assert.ok(serviceRequests.some((request) => request.method === "POST" && request.path === "/skills/import-folder" && request.body.path.includes(".codex")));

  await elements["test-provider"].trigger("click");
  await waitFor(() => localStorageValues.smartPromptProviderTestPass === "true", "provider test");
  const providerTestRequest = serviceRequests.find((request) => request.method === "POST" && request.path === "/llm/test");
  assert.equal(providerTestRequest.headers.Authorization, `Bearer ${serviceAuthToken}`);
  assert.equal(providerTestRequest.body.mode, "idea");
  assert.ok(elements["provider-test-status"].textContent.includes("ready"));
  assert.equal(elements["provider-test-status"].dataset.providerTestPass, "true");
  assert.equal(elements["provider-test-status"].dataset.promptLength, "72");
  assert.equal(elements["first-run-progress"].dataset.firstRunReady, "true");

  await elements["skill-list"].trigger("click", {
    target: createDeleteButton("delete-skill", "skillId", "skill-imported")
  });
  await waitFor(() => elements["skill-list"].innerHTML.includes("No imported skills"), "skill delete");
  assert.ok(serviceRequests.some((request) => request.method === "DELETE" && request.path === "/skills/skill-imported"));
  assert.equal(elements["first-run-progress"].dataset.skillImported, "false");

  elements["prompt-title"].value = "Reusable V2 prompt";
  elements["prompt-body"].value = "Build a careful V2 prompt with acceptance criteria.";
  await elements["save-prompt"].trigger("click");
  await waitFor(() => elements["prompt-list"].innerHTML.includes("Reusable V2 prompt"), "prompt save");
  assert.ok(serviceRequests.some((request) => request.method === "POST" && request.path === "/prompts" && request.body.source === "desktop-shell"));

  await elements["prompt-list"].trigger("click", {
    target: createDeleteButton("delete-prompt", "promptId", "prompt-saved")
  });
  await waitFor(() => elements["prompt-list"].innerHTML.includes("No saved prompts"), "prompt delete");
  assert.ok(serviceRequests.some((request) => request.method === "DELETE" && request.path === "/prompts/prompt-saved"));

  elements.shortcut.value = "Ctrl+Alt+P";
  await elements["save-shortcut"].trigger("click");
  assert.equal(localStorageValues.smartPromptShortcut, "Ctrl+Alt+P");
  assert.ok(tauriInvokes.some((invoke) => invoke.command === "set_global_shortcut" && invoke.payload.shortcut === "Ctrl+Alt+P"));

  await elements["start-service"].trigger("click");
  assert.ok(tauriInvokes.some((invoke) => invoke.command === "start_local_service"));

  await elements["stop-service"].trigger("click");
  assert.ok(tauriInvokes.some((invoke) => invoke.command === "stop_local_service"));
  assert.equal(context.document.documentElement.dataset.localServiceStatus, "stopped");

  await elements["restart-service"].trigger("click");
  assert.ok(tauriInvokes.some((invoke) => invoke.command === "restart_local_service"));

  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(() => elements["desktop-companion-status"].dataset.desktopSnapshotStatus === "ready", "desktop snapshot");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/desktop/input-snapshot"));
  assert.equal(elements["desktop-companion-status"].dataset.detectedToolProfile, "workbuddy");
  assert.equal(elements["desktop-companion-status"].dataset.candidateCount, "1");
  assert.equal(elements["desktop-companion-status"].dataset.bestCandidateIndex, "0");
  assert.equal(elements["desktop-tool-summary"].innerHTML.includes("desktop-title-hash"), true);
  assert.equal(elements["desktop-guard-summary"].innerHTML.includes("No submit"), true);
  assert.equal(elements["desktop-mascot-state"].dataset.mascotState, "suggesting");
  assert.equal(elements["desktop-fusion-mascot-state"].dataset.mascotState, "suggesting");
  assert.equal(elements["desktop-input-surface"].dataset.fusionReady, "true");
  assert.equal(elements["desktop-input-surface"].dataset.detectedToolProfile, "workbuddy");
  assert.equal(elements["desktop-input-surface"].dataset.safeCandidateCount, "1");
  assert.equal(elements["desktop-input-surface"].dataset.readinessReason, "ready");
  assert.equal(elements["desktop-input-surface"].dataset.overlayEligible, "true");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReady, "true");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReadinessReason, "ready");
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "ready");
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayReady, "true");
  const overlayShow = tauriInvokes.find((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.fastWindowProbe !== true);
  assert.equal(overlayShow.payload.payload.profile, "workbuddy");
  assert.equal(overlayShow.payload.payload.titleHash, "desktop-title-hash");
  assert.equal(overlayShow.payload.payload.candidateIndex, 0);
  assert.equal(overlayShow.payload.payload.noAutoSubmit, true);
  assert.equal(overlayShow.payload.payload.promptReady, false);
  assert.equal(overlayShow.payload.payload.promptKind, "none");
  assert.equal(overlayShow.payload.payload.locale, "en");
  assert.equal(overlayShow.payload.payload.overlayMode, "compact");
  assert.equal(overlayShow.payload.payload.promptMode, "idea");
  const manualOverlayPlacement = expectedDesktopOverlayPlacement(desktopSnapshotReport.candidates[0]);
  assert.equal(overlayShow.payload.payload.x, manualOverlayPlacement.x);
  assert.equal(overlayShow.payload.payload.y, manualOverlayPlacement.y);
  assert.equal(overlayShow.payload.payload.compactX, manualOverlayPlacement.compactX);
  assert.equal(overlayShow.payload.payload.compactY, manualOverlayPlacement.compactY);

  desktopSnapshotResponse = transientMissDesktopSnapshotReport;
  const snapshotRequestsBeforeMiss = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const overlayHideCountBeforeMiss = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  const overlayStateCountBeforeMiss = tauriInvokes.length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeMiss, "transient desktop miss");
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length, overlayHideCountBeforeMiss + 1);
  assert.equal(tauriInvokes.slice(overlayStateCountBeforeMiss).at(-1).command, "hide_mascot_overlay");
  assert.equal(scheduledIntervals[0].delay, 500);

  desktopSnapshotResponse = desktopSnapshotReport;
  const snapshotRequestsBeforeRecovery = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeRecovery, "desktop snapshot recovery");
  assert.equal(elements["desktop-input-surface"].dataset.fusionReady, "true");

  desktopSnapshotResponse = supportedNoCandidateDesktopSnapshotReport;
  const snapshotRequestsBeforeSupportedNoCandidate = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const overlayHideCountBeforeSupportedNoCandidate = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  const overlayStateCountBeforeSupportedNoCandidate = tauriInvokes.length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeSupportedNoCandidate,
    "supported tool no-candidate overlay hide"
  );
  assert.equal(elements["desktop-input-surface"].dataset.overlayEligible, "true");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReady, "false");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReadinessReason, "no-candidates");
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length, overlayHideCountBeforeSupportedNoCandidate + 1);
  assert.equal(tauriInvokes.slice(overlayStateCountBeforeSupportedNoCandidate).at(-1).command, "hide_mascot_overlay");

  desktopSnapshotResponse = desktopSnapshotReport;
  const snapshotRequestsBeforeNoCandidateRecovery = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeNoCandidateRecovery,
    "supported no-candidate overlay recovery"
  );

  desktopSnapshotResponse = minimizedDesktopSnapshotReport;
  const snapshotRequestsBeforeMinimized = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const overlayHideCountBeforeMinimized = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  const overlayStateCountBeforeMinimized = tauriInvokes.length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeMinimized,
    "minimized foreground overlay hide"
  );
  assert.equal(elements["desktop-input-surface"].dataset.overlayEligible, "true");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReady, "false");
  assert.equal(elements["desktop-input-surface"].dataset.readinessReason, "foreground-window-hidden");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReadinessReason, "foreground-window-hidden");
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length, overlayHideCountBeforeMinimized + 1);
  assert.equal(tauriInvokes.slice(overlayStateCountBeforeMinimized).at(-1).command, "hide_mascot_overlay");

  desktopSnapshotResponse = desktopSnapshotReport;
  const snapshotRequestsBeforeMinimizedRecovery = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeMinimizedRecovery,
    "minimized overlay recovery"
  );

  desktopSnapshotResponse = hermesDesktopSnapshotReport;
  const snapshotRequestsBeforeHermes = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const overlayShowCountBeforeHermes = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length;
  const overlayHideCountBeforeHermes = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeHermes, "unsupported overlay profile");
  assert.equal(elements["desktop-input-surface"].dataset.fusionReady, "true");
  assert.equal(elements["desktop-input-surface"].dataset.detectedToolProfile, "hermes");
  assert.equal(elements["desktop-input-surface"].dataset.overlayEligible, "false");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReady, "false");
  assert.equal(elements["desktop-input-surface"].dataset.overlayReadinessReason, "unsupported-overlay-profile");
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length, overlayShowCountBeforeHermes);
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length, overlayHideCountBeforeHermes + 1);

  desktopSnapshotResponse = desktopSnapshotReport;
  const snapshotRequestsBeforeOverlayRecovery = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeOverlayRecovery, "supported overlay recovery");

  fastForegroundResponse = codexFastForegroundState;
  scheduledIntervals[1].handler();
  await waitFor(
    () => context.document.documentElement.dataset.desktopFastToolProfile === "codex",
    "fast foreground codex"
  );
  let codexOverlay = tauriInvokes.filter((invoke) => (
    invoke.command === "show_mascot_overlay" && invoke.payload.payload.codexAdapterReady === true
  )).at(-1).payload.payload;
  assert.equal(codexOverlay.profile, "codex");
  assert.equal(codexOverlay.overlayMode, "compact");
  assert.equal(codexOverlay.visualOnly, false);
  assert.equal(codexOverlay.exactRead, true);
  assert.equal(codexOverlay.fullReplace, true);

  codexInspectReady = false;
  const codexShowCountBeforeBlockedInspect = tauriInvokes.filter((invoke) => (
    invoke.command === "show_mascot_overlay" && invoke.payload.payload.codexAdapterReady === true
  )).length;
  await foregroundWindowStateListener({ payload: { ...codexFastForegroundState, hwnd: "0x7788" } });
  assert.equal(
    tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay" && invoke.payload.payload.codexAdapterReady === true).length,
    codexShowCountBeforeBlockedInspect,
    "blocked inspect must not show the Codex mascot"
  );
  codexInspectReady = true;
  await foregroundWindowStateListener({ payload: codexFastForegroundState });
  codexOverlay = tauriInvokes.filter((invoke) => (
    invoke.command === "show_mascot_overlay" && invoke.payload.payload.codexAdapterReady === true
  )).at(-1).payload.payload;

  const legacySnapshotsBeforeCodexCore = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const legacyFillsBeforeCodexCore = serviceRequests.filter((request) => request.path === "/desktop/fill").length;
  const generateRequestsBeforeCodexOpen = serviceRequests.filter((request) => request.path === "/generate").length;
  const readsBeforeCodexOpen = serviceRequests.filter((request) => request.path === "/target/codex/read").length;
  const remindersBeforeCodexOpen = serviceRequests.filter((request) => request.path === "/learning/v1/reminder").length;
  const reminderResolvesBeforeCodexOpen = serviceRequests.filter((request) => request.path === "/learning/v1/reminder/resolve").length;
  await overlayClickListener({ payload: { ...codexOverlay, overlayAction: "open" } });
  assert.equal(serviceRequests.filter((request) => request.path === "/generate").length, generateRequestsBeforeCodexOpen);
  assert.equal(serviceRequests.filter((request) => request.path === "/target/codex/read").length, readsBeforeCodexOpen + 1);
  assert.ok(serviceRequests.some((request) => request.path === "/outcomes/v2/claim"));
  assert.equal(serviceRequests.filter((request) => request.path === "/learning/v1/reminder").length, remindersBeforeCodexOpen);
  assert.equal(serviceRequests.filter((request) => request.path === "/learning/v1/reminder/resolve").length, reminderResolvesBeforeCodexOpen + 1);
  let codexExpanded = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state" && invoke.payload.payload.codexAdapterReady === true
  )).at(-1).payload.payload;
  assert.equal(codexExpanded.overlayMode, "expanded");
  assert.equal(codexExpanded.openingDraftHash, "a".repeat(64));
  assert.equal(codexExpanded.projectScopeToken, "project-scope-codex");
  assert.match(codexExpanded.sessionId, /^desktop-session-/);
  assert.equal(codexExpanded.pendingOutcome.outcome.outcomeId, "outcome-prior-1");
  assert.equal(codexExpanded.learningCandidate.artifactId, "artifact-codex-1");

  const feedbackBeforeCompleted = serviceRequests.filter((request) => request.path === "/outcomes/v2/feedback").length;
  await overlayClickListener({
    payload: {
      ...codexExpanded,
      overlayAction: "outcome-completed",
      outcomeId: "outcome-prior-1",
      value: "completed"
    }
  });
  assert.equal(serviceRequests.filter((request) => request.path === "/outcomes/v2/feedback").length, feedbackBeforeCompleted + 1);
  const completedFeedback = serviceRequests.filter((request) => request.path === "/outcomes/v2/feedback").at(-1);
  assert.equal(completedFeedback.body.taskOutcomeToken, "completed");
  assert.equal(Object.hasOwn(completedFeedback.body, "reasonToken"), false);

  await overlayClickListener({
    payload: {
      ...codexExpanded,
      overlayAction: "generate",
      promptReady: true,
      promptKind: "draft",
      promptText: codexDraftText,
      promptMode: "polish"
    }
  });
  const firstCodexGenerate = serviceRequests.filter((request) => request.path === "/generate" && request.body.target === "codex").at(-1);
  assert.equal(firstCodexGenerate.body.projectScopeToken, "project-scope-codex");
  assert.match(firstCodexGenerate.body.sessionId, /^desktop-session-/);
  assert.equal(serviceRequests.filter((request) => request.path === "/learning/v1/reminder").length, remindersBeforeCodexOpen + 1);
  const generatedAttention = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.learningCandidate?.artifactId === "artifact-codex-1"
  )).at(-1).payload.payload;
  assert.equal(generatedAttention.learningCandidate.artifactId, "artifact-codex-1");
  const firstGeneratedCodexPrompt = elements["desktop-generated-prompt"].value;
  assert.ok(firstGeneratedCodexPrompt.includes("Generated Codex prompt"));

  codexDraftText = "User changed the composer after opening";
  codexDraftHash = "c".repeat(64);
  const insertRequestsBeforeFreshGuard = serviceRequests.filter((request) => request.path === "/target/codex/insert").length;
  await overlayClickListener({
    payload: {
      ...codexExpanded,
      overlayAction: "fill",
      promptReady: true,
      promptKind: "generated",
      promptText: firstGeneratedCodexPrompt
    }
  });
  assert.equal(serviceRequests.filter((request) => request.path === "/target/codex/insert").length, insertRequestsBeforeFreshGuard);
  const guardedCodexPayload = tauriInvokes.filter((invoke) => invoke.command === "set_mascot_overlay_state").at(-1).payload.payload;
  assert.equal(guardedCodexPayload.guardReason, "target-unsafe");

  await overlayClickListener({ payload: { ...guardedCodexPayload, overlayAction: "open", profile: "codex", codexAdapterReady: true } });
  codexExpanded = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state" && invoke.payload.payload.openingDraftHash === "c".repeat(64)
  )).at(-1).payload.payload;
  await overlayClickListener({
    payload: {
      ...codexExpanded,
      overlayAction: "generate",
      promptReady: true,
      promptKind: "draft",
      promptText: codexDraftText,
      promptMode: "idea"
    }
  });
  const generatedCodexPrompt = elements["desktop-generated-prompt"].value;
  await overlayClickListener({
    payload: {
      ...codexExpanded,
      overlayAction: "fill",
      promptReady: true,
      promptKind: "generated",
      promptText: generatedCodexPrompt
    }
  });
  const codexInsert = serviceRequests.filter((request) => request.path === "/target/codex/insert").at(-1);
  assert.equal(codexInsert.body.expectedDraftHash, "c".repeat(64));
  assert.equal(codexInsert.body.text, generatedCodexPrompt);
  const activationComplete = serviceRequests.filter((request) => request.path === "/activation/codex/complete").at(-1);
  assert.deepEqual(activationComplete.body, {
    contractVersion: "codex-activation@2",
    transactionId: "transaction-codex-1"
  });
  let codexSuccess = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.transactionId === "transaction-codex-1"
  )).at(-1).payload.payload;
  assert.equal(codexSuccess.state, "success");
  assert.equal(codexSuccess.verification, "machine");
  assert.equal(codexSuccess.canUndo, true);
  assert.equal(codexSuccess.pendingOutcome.outcomeId, "outcome-current-1");
  assert.equal(codexSuccess.collapseRequested, true);
  assert.equal(codexSuccess.activationProgress, "activated");
  await runLastScheduledTimeout("codex verified auto collapse");
  codexSuccess = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.transactionId === "transaction-codex-1"
  )).at(-1).payload.payload;
  assert.equal(codexSuccess.overlayMode, "compact");

  interactionTestPhase = "codex-verified-transaction-survives-window-switch";
  fastForegroundResponse = fastForegroundState;
  scheduledIntervals[1].handler();
  await waitFor(
    () => context.document.documentElement.dataset.desktopFastToolProfile === "workbuddy",
    "switch away from Codex with a verified transaction"
  );
  fastForegroundResponse = codexFastForegroundState;
  scheduledIntervals[1].handler();
  await waitFor(
    () => context.document.documentElement.dataset.desktopFastToolProfile === "codex",
    "return to Codex with a verified transaction"
  );

  const feedbackBeforeReasonStage = serviceRequests.filter((request) => request.path === "/outcomes/v2/feedback").length;
  await overlayClickListener({
    payload: {
      ...codexSuccess,
      overlayAction: "outcome-not-completed",
      outcomeId: "outcome-current-1",
      value: "not_completed"
    }
  });
  assert.equal(serviceRequests.filter((request) => request.path === "/outcomes/v2/feedback").length, feedbackBeforeReasonStage + 1);
  const notCompletedFeedback = serviceRequests.filter((request) => request.path === "/outcomes/v2/feedback").at(-1);
  assert.equal(notCompletedFeedback.body.taskOutcomeToken, "not_completed");
  assert.equal(Object.hasOwn(notCompletedFeedback.body, "reasonToken"), false);
  const reasonRequiredPayload = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.pendingOutcome?.state === "reason_required"
  )).at(-1).payload.payload;
  assert.equal(reasonRequiredPayload.pendingOutcome.outcome.outcomeId, "outcome-current-1");
  await overlayClickListener({
    payload: {
      ...codexSuccess,
      overlayAction: "outcome-reason",
      outcomeId: "outcome-current-1",
      value: "tool_mismatch"
    }
  });
  const reasonFeedback = serviceRequests.filter((request) => request.path === "/outcomes/v2/feedback").at(-1);
  assert.equal(reasonFeedback.body.taskOutcomeToken, "not_completed");
  assert.equal(reasonFeedback.body.reasonToken, "tool_mismatch");
  assert.notEqual(reasonFeedback.body.feedbackId, notCompletedFeedback.body.feedbackId);
  const resolvedOutcomePayload = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.pendingOutcome === null
  )).at(-1).payload.payload;
  assert.equal(resolvedOutcomePayload.pendingOutcome, null);

  const ignoreRequestsBeforeCard = serviceRequests.filter((request) => request.path === "/learning/v1/candidates/ignore").length;
  await overlayClickListener({
    payload: {
      ...codexSuccess,
      overlayAction: "candidate-ignore",
      candidateId: "artifact-codex-1",
      value: "artifact-codex-1"
    }
  });
  assert.equal(serviceRequests.filter((request) => request.path === "/learning/v1/candidates/ignore").length, ignoreRequestsBeforeCard + 1);

  await overlayClickListener({ payload: { ...codexSuccess, overlayAction: "undo", canUndo: true } });
  const undoRequest = serviceRequests.filter((request) => request.path === "/target/codex/undo").at(-1);
  assert.equal(undoRequest.body.undoToken, "undo-codex-1");
  assert.equal(elements["desktop-draft-input"].value, "User changed the composer after opening");
  assert.equal(elements["desktop-generated-prompt"].value, "");
  const restoredCodex = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.promptText === "User changed the composer after opening"
  )).at(-1).payload.payload;
  assert.equal(restoredCodex.canUndo, false);
  assert.equal(restoredCodex.promptKind, "draft");

  codexCandidateReminder = {
    artifactId: "artifact-codex-2",
    artifactType: "rule",
    reminderToken: "reusable_experience_found",
    ignoredCount: 0
  };
  const remindersBeforeReopen = serviceRequests.filter((request) => request.path === "/learning/v1/reminder").length;
  const reminderResolvesBeforeReopen = serviceRequests.filter((request) => request.path === "/learning/v1/reminder/resolve").length;
  await overlayClickListener({ payload: { ...restoredCodex, overlayAction: "open", profile: "codex", codexAdapterReady: true } });
  assert.equal(serviceRequests.filter((request) => request.path === "/learning/v1/reminder").length, remindersBeforeReopen);
  assert.equal(serviceRequests.filter((request) => request.path === "/learning/v1/reminder/resolve").length, reminderResolvesBeforeReopen + 1);
  const reopenedDraft = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.openingDraftHash === "c".repeat(64)
  )).at(-1).payload.payload;
  assert.equal(reopenedDraft.learningCandidate.artifactId, "artifact-codex-2");
  await overlayClickListener({
    payload: {
      ...reopenedDraft,
      overlayAction: "generate",
      promptReady: true,
      promptKind: "draft",
      promptText: codexDraftText,
      promptMode: "idea"
    }
  });
  const reopenedCodex = tauriInvokes.filter((invoke) => (
    invoke.command === "set_mascot_overlay_state" && invoke.payload.payload.learningCandidate?.artifactId === "artifact-codex-2"
  )).at(-1).payload.payload;
  const showMainBeforeCandidateReview = tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length;
  await overlayClickListener({
    payload: {
      ...reopenedCodex,
      overlayAction: "candidate-review",
      candidateId: "artifact-codex-2",
      value: "artifact-codex-2"
    }
  });
  assert.ok(serviceRequests.some((request) => request.path === "/learning/v1/candidate"));
  assert.ok(serviceRequests.some((request) => request.path === "/learning/v1/artifacts"));
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length, showMainBeforeCandidateReview + 1);

  const policyRows = [1, 2].map(() => {
    const button = { dataset: { learningAction: "" } };
    return {
      dataset: {},
      button,
      querySelectorAll(selector) {
        return selector === 'button[data-learning-action^="policy-"]' ? [button] : [];
      }
    };
  });
  const visibleLearningStatus = new FakeElement("visible-learning-status");
  const learningDataEvents = [];
  context.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  context.window.dispatchEvent = (event) => {
    learningDataEvents.push(event);
    return true;
  };
  context.document.querySelectorAll = (selector) => (
    selector === '[data-learning-kind="policy"]' ? policyRows : []
  );
  context.document.querySelector = (selector) => (
    selector === '[data-control-page-view="learning"] #learning-status' ? visibleLearningStatus : null
  );
  const learningV1Paths = [
    "/learning/v1/artifacts",
    "/learning/v1/global-proposals",
    "/policies/v1",
    "/policies/v1/rollouts"
  ];
  const learningRequestsBeforeRefresh = Object.fromEntries(learningV1Paths.map((requestPath) => [
    requestPath,
    serviceRequests.filter((request) => request.path === requestPath).length
  ]));
  await context.refreshControlCenterLearningV1();
  learningV1Paths.forEach((requestPath) => {
    assert.equal(
      serviceRequests.filter((request) => request.path === requestPath).length,
      learningRequestsBeforeRefresh[requestPath] + 1
    );
  });
  const learningData = learningDataEvents.at(-1).detail;
  assert.ok(learningData.artifacts.some((artifact) => artifact.artifactType === "generation_policy"));
  assert.equal(learningData.policies.length, 2);
  assert.equal(learningData.rollouts[0].rolloutId, "rollout-policy-2");
  assert.equal(learningData.learningPaused, false);
  assert.equal(policyRows[0].dataset.policyVersion, "1");
  assert.equal(policyRows[1].dataset.policyVersion, "2");
  assert.notEqual(policyRows[0].button.dataset.learningValue, policyRows[1].button.dataset.learningValue);

  const canaryRequestsBeforeAmbiguousAction = serviceRequests.filter((request) => request.path === "/policies/v1/canary").length;
  const ambiguousPolicyAction = {
    detail: { id: "policy-start-canary", value: "policy-shared" },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
  await context.handleControlCenterLearningAction(ambiguousPolicyAction);
  assert.equal(ambiguousPolicyAction.defaultPrevented, false);
  assert.equal(serviceRequests.filter((request) => request.path === "/policies/v1/canary").length, canaryRequestsBeforeAmbiguousAction);

  const canaryPolicyAction = {
    detail: { id: "policy-start-canary", value: policyRows[1].button.dataset.learningValue },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
  await context.handleControlCenterLearningAction(canaryPolicyAction);
  assert.equal(canaryPolicyAction.defaultPrevented, true);
  const rollbackPolicyAction = {
    detail: { id: "policy-rollback", value: policyRows[0].button.dataset.learningValue },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
  await context.handleControlCenterLearningAction(rollbackPolicyAction);
  assert.equal(rollbackPolicyAction.defaultPrevented, true);

  const pauseLearningAction = {
    detail: { id: "policy-learning-pause", value: "global" },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
  await context.handleControlCenterLearningAction(pauseLearningAction);
  assert.equal(pauseLearningAction.defaultPrevented, true);
  assert.equal(controlCenterLearningPaused, true);
  assert.equal(learningDataEvents.at(-1).detail.learningPaused, true);

  const resumeLearningAction = {
    detail: { id: "policy-learning-resume", value: "global" },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
  await context.handleControlCenterLearningAction(resumeLearningAction);
  assert.equal(resumeLearningAction.defaultPrevented, true);
  assert.equal(controlCenterLearningPaused, false);
  assert.equal(learningDataEvents.at(-1).detail.learningPaused, false);

  controlCenterCanaryFails = true;
  const failedCanaryAction = {
    detail: { id: "policy-start-canary", value: policyRows[1].button.dataset.learningValue },
    preventDefault() {}
  };
  await context.handleControlCenterLearningAction(failedCanaryAction);
  assert.equal(visibleLearningStatus.textContent, "Action unavailable.");
  assert.equal(visibleLearningStatus.dataset.tone, "error");
  controlCenterCanaryFails = false;

  assert.equal(serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length, legacySnapshotsBeforeCodexCore);
  assert.equal(serviceRequests.filter((request) => request.path === "/desktop/fill").length, legacyFillsBeforeCodexCore);
  interactionTestPhase = "codex-and-learning-complete";

  const snapshotRequestsBeforeMascot = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  interactionTestPhase = "workbuddy-fast-restore";
  fastForegroundResponse = fastForegroundState;
  scheduledIntervals[1].handler();
  await waitFor(
    () => context.document.documentElement.dataset.desktopFastToolProfile === "workbuddy",
    "fast foreground workbuddy"
  );
  desktopSnapshotResponse = desktopSnapshotReport;
  interactionTestPhase = "workbuddy-mascot-click";
  await elements["desktop-mascot-button"].trigger("click");
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeMascot, "mascot foreground capture");
  assert.equal(elements["desktop-draft-input"].dataset.focused, "true");

  const fillRequestsBeforeNeedsDraftOverlayClick = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const snapshotRequestsBeforeNeedsDraftOverlayClick = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const showMainWindowCountBeforeNeedsDraftOverlayClick = tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length;
  const overlayHideCountBeforeNeedsDraftOverlayClick = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  interactionTestPhase = "workbuddy-needs-draft-click";
  await overlayClickListener({ payload: overlayShow.payload.payload });
  assert.equal(
    serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length,
    fillRequestsBeforeNeedsDraftOverlayClick
  );
  assert.equal(serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length, snapshotRequestsBeforeNeedsDraftOverlayClick);
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length, showMainWindowCountBeforeNeedsDraftOverlayClick + 1);
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length, overlayHideCountBeforeNeedsDraftOverlayClick + 1);
  assert.equal(elements["desktop-draft-input"].dataset.focused, "true");
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "needs-draft");
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayClickPrompt, "missing");
  assert.equal(elements["desktop-fusion-evidence"].dataset.noAutoSubmit, "true");
  assert.equal(elements["desktop-prompt-handoff"].dataset.handoffState, "needs-draft");
  assert.equal(elements["desktop-prompt-handoff"].dataset.handoffAction, "add-prompt");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptReady, "false");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptKind, "none");
  assert.equal(elements["desktop-prompt-handoff"].dataset.noAutoSubmit, "true");

  const snapshotRequestsBeforeDraftOverlayRecovery = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  interactionTestPhase = "workbuddy-refresh-recovery";
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeDraftOverlayRecovery,
    "overlay click needs draft recovery"
  );

  elements["desktop-draft-input"].value = "Make the WorkBuddy reply more actionable";
  const overlayStateCountBeforeDraft = tauriInvokes.length;
  elements["desktop-draft-input"].trigger("input");
  assert.equal(elements["generate-desktop-prompt"].disabled, false);
  const draftOverlayState = tauriInvokes.slice(overlayStateCountBeforeDraft)
    .find((invoke) => invoke.command === "set_mascot_overlay_state" && invoke.payload.payload.promptReady === true);
  assert.ok(draftOverlayState);
  assert.equal(draftOverlayState.payload.payload.promptKind, "draft");
  assert.equal(elements["desktop-prompt-handoff"].dataset.handoffState, "ready");
  assert.equal(elements["desktop-prompt-handoff"].dataset.handoffAction, "click-mascot");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptReady, "true");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptKind, "draft");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptMode, "idea");

  assert.equal(typeof overlayDraftListener, "function");
  elements["desktop-generated-prompt"].value = "Old generated prompt";
  elements["desktop-generated-prompt"].dataset.generatedBy = "template-fallback";
  const fillRequestsBeforeOverlayDraft = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const promptStateRequestsBeforeOverlayDraft = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/prompt-state").length;
  interactionTestPhase = "workbuddy-overlay-draft";
  await overlayDraftListener({
    payload: {
      text: "  tighten the answer and keep it short  ",
      payload: {
        ...overlayShow.payload.payload,
        overlayMode: "expanded",
        overlayAction: "quick-draft",
        promptMode: "continue"
      }
    }
  });
  assert.equal(elements["desktop-draft-input"].value, "tighten the answer and keep it short");
  assert.equal(elements["desktop-generated-prompt"].value, "");
  assert.equal(elements["desktop-generated-prompt"].dataset.generatedBy, undefined);
  assert.equal(context.document.documentElement.dataset.desktopPromptMode, "continue");
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "draft");
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayDraftSubmitted, "true");
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayDraftLength, "36");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptKind, "draft");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptMode, "continue");
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeOverlayDraft);
  interactionTestPhase = "workbuddy-draft-sync";
  await runLastScheduledTimeout("overlay draft prompt-state sync");
  assert.ok(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/prompt-state").length > promptStateRequestsBeforeOverlayDraft);
  const overlayDraftPromptStateRequest = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/prompt-state").at(-1);
  assert.equal(overlayDraftPromptStateRequest.body.promptMode, "continue");
  assert.equal(overlayDraftPromptStateRequest.body.prompt, "");
  assert.equal(desktopPromptStateLatest.activeTextKind, "draft");
  assert.equal(desktopPromptStateLatest.activeTextLength, 36);

  const fillRequestsBeforeModeOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const overlayStateCountBeforeModeOverlayAction = tauriInvokes.length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "mode",
      promptMode: "polish"
    }
  });
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeModeOverlayAction);
  assert.equal(context.document.documentElement.dataset.desktopPromptMode, "polish");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptMode, "polish");
  assert.ok(tauriInvokes.slice(overlayStateCountBeforeModeOverlayAction).some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.promptMode === "polish"
      && invoke.payload.payload.overlayMode === "expanded"
  ));

  const fillRequestsBeforeLocaleOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const overlayStateCountBeforeLocaleOverlayAction = tauriInvokes.length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "locale",
      locale: "zh-CN"
    }
  });
  assert.equal(localStorageValues.smartPromptDesktopLocale, "zh-CN");
  assert.equal(elements["ui-locale"].value, "zh-CN");
  assert.equal(context.document.documentElement.lang, "zh-CN");
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeLocaleOverlayAction);
  assert.ok(tauriInvokes.slice(overlayStateCountBeforeLocaleOverlayAction).some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.locale === "zh-CN"
      && invoke.payload.payload.overlayMode === "expanded"
  ));
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "locale",
      locale: "en"
    }
  });
  assert.equal(localStorageValues.smartPromptDesktopLocale, "en");
  assert.equal(elements["ui-locale"].value, "en");

  desktopSnapshotResponse = shiftedDesktopSnapshotReport;
  const snapshotRequestsBeforeExpandedAutoPoll = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const overlayShowCountBeforeExpandedAutoPoll = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length;
  scheduledIntervals[0].handler();
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeExpandedAutoPoll,
    "expanded overlay auto poll"
  );
  await waitFor(
    () => tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").length > overlayShowCountBeforeExpandedAutoPoll,
    "expanded overlay auto poll preserves mode"
  );
  const expandedAutoPollOverlayShow = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").at(-1);
  assert.equal(expandedAutoPollOverlayShow.payload.payload.overlayMode, "expanded");
  assert.equal(expandedAutoPollOverlayShow.payload.payload.promptMode, "polish");
  desktopSnapshotResponse = desktopSnapshotReport;

  const fillRequestsBeforeGenerateOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "generate",
      promptMode: "polish"
    }
  });
  await waitFor(() => elements["desktop-generated-prompt"].value.includes("Generated desktop prompt"), "desktop prompt generation");
  const desktopGenerateRequest = serviceRequests.find((request) => request.method === "POST" && request.path === "/generate");
  assert.ok(desktopGenerateRequest);
  assert.equal(desktopGenerateRequest.body.context.mode, "polish");
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeGenerateOverlayAction);
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "generated");
  assert.equal(elements["desktop-generated-prompt"].dataset.generatedBy, "template-fallback");
  assert.equal(elements["fill-foreground-input"].disabled, false);
  assert.ok(tauriInvokes.some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.promptReady === true
      && invoke.payload.payload.promptKind === "generated"
  ));
  assert.equal(elements["desktop-prompt-handoff"].dataset.handoffState, "ready");
  assert.equal(elements["desktop-prompt-handoff"].dataset.handoffAction, "click-mascot");
  assert.equal(elements["desktop-prompt-handoff"].dataset.promptKind, "generated");

  const showMainCountBeforeRetryOverlayAction = tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length;
  const fillRequestsBeforeRetryOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const generateRequestsBeforeRetryOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/generate").length;
  const overlayStateCountBeforeRetryOverlayAction = tauriInvokes.length;
  const retryPreviewText = "Retry the overlay preview without opening the main editor";
  elements["desktop-draft-input"].value = "";
  elements["desktop-draft-input"].trigger("input");
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "generate",
      promptMode: "polish",
      promptReady: true,
      promptKind: "generated",
      promptText: retryPreviewText
    }
  });
  await waitFor(
    () => serviceRequests.filter((request) => request.method === "POST" && request.path === "/generate").length > generateRequestsBeforeRetryOverlayAction,
    "overlay retry generation"
  );
  const retryGenerateRequest = serviceRequests.filter((request) => request.method === "POST" && request.path === "/generate").at(-1);
  assert.equal(retryGenerateRequest.body.input, retryPreviewText);
  assert.equal(retryGenerateRequest.body.context.mode, "polish");
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length, showMainCountBeforeRetryOverlayAction);
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeRetryOverlayAction);
  assert.ok(elements["desktop-generated-prompt"].value.includes(retryPreviewText));
  assert.ok(tauriInvokes.slice(overlayStateCountBeforeRetryOverlayAction).some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.overlayMode === "expanded"
      && invoke.payload.payload.promptReady === true
      && invoke.payload.payload.promptKind === "generated"
  ));

  const overlayLoopGeneratedPrompt = elements["desktop-generated-prompt"].value;
  const showMainCountBeforeOverlayLoopFill = tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length;
  const fillRequestsBeforeOverlayLoopFill = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "fill",
      promptReady: true,
      promptKind: "generated",
      promptText: overlayLoopGeneratedPrompt,
      promptMode: "polish"
    }
  });
  await waitFor(
    () => serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length > fillRequestsBeforeOverlayLoopFill,
    "overlay draft generate fill loop"
  );
  const overlayLoopFillRequest = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).at(-1);
  assert.equal(overlayLoopFillRequest.body.text, overlayLoopGeneratedPrompt);
  assert.equal(overlayLoopFillRequest.body.expectedToolProfile, "workbuddy");
  assert.equal(overlayLoopFillRequest.body.expectedTitleHash, "desktop-title-hash");
  assert.equal(overlayLoopFillRequest.body.candidateIndex, 0);
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length, showMainCountBeforeOverlayLoopFill);
  assert.equal(elements["desktop-fusion-evidence"].dataset.foregroundFill, "true");
  assert.equal(elements["desktop-fusion-evidence"].dataset.noAutoSubmit, "true");

  await elements["fill-foreground-input"].trigger("click");
  await waitFor(() => elements["desktop-fusion-evidence"].dataset.fusionState === "filled", "foreground fill");
  const promptStateRequest = serviceRequests.find((request) => request.method === "POST" && request.path === "/desktop/prompt-state" && request.body.prompt.includes("Generated desktop prompt"));
  assert.ok(promptStateRequest);
  assert.equal(promptStateRequest.body.source, "desktop-shell");
  assert.equal(promptStateRequest.body.noAutoSubmit, true);
  assert.equal(promptStateRequest.body.promptMode, "polish");
  assert.equal(promptStateRequest.body.readiness.profile, "workbuddy");
  assert.equal(promptStateRequest.body.readiness.titleHash, "desktop-title-hash");
  assert.equal(promptStateRequest.body.readiness.candidateIndex, 0);
  assert.equal(desktopPromptStateLatest.prepared, true);
  assert.equal(desktopPromptStateLatest.activeTextKind, "generated");
  assert.equal(desktopPromptStateLatest.privacy.promptTextNotStored, true);
  const foregroundFillRequest = serviceRequests.find((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground);
  assert.equal(foregroundFillRequest.body.allowClipboardFallback, true);
  assert.equal(foregroundFillRequest.body.allowTextPatternVerification, true);
  assert.equal(foregroundFillRequest.body.expectedTitleHash, "desktop-title-hash");
  assert.equal(foregroundFillRequest.body.expectedToolProfile, "workbuddy");
  assert.equal(foregroundFillRequest.body.candidateIndex, 0);
  assert.equal(elements["desktop-fusion-evidence"].dataset.foregroundFill, "true");
  assert.equal(elements["desktop-fusion-evidence"].dataset.noAutoSubmit, "true");
  assert.equal(elements["desktop-mascot-state"].dataset.mascotState, "success");
  assert.ok(tauriInvokes.some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.state === "success"
      && invoke.payload.payload.promptReady === true
      && invoke.payload.payload.promptKind === "generated"
  ));

  const fillRequestsBeforeOutcomeOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      state: "success",
      overlayAction: "outcome-good",
      promptReady: true,
      promptKind: "generated"
    }
  });
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeOutcomeOverlayAction);
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayOutcome, "success");
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayOutcomeSource, "mascot-overlay");
  assert.equal(elements["desktop-fusion-evidence"].dataset.noAutoSubmit, "true");
  assert.ok(elements["service-status"].textContent.includes("success"));

  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      state: "success",
      overlayAction: "outcome-fix",
      promptReady: true,
      promptKind: "generated"
    }
  });
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayOutcome, "needs-work");
  assert.equal(elements["desktop-fusion-evidence"].dataset.revisionRequested, "true");
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "draft");
  assert.equal(elements["desktop-generated-prompt"].value, "");
  assert.equal(elements["desktop-generated-prompt"].dataset.generatedBy, undefined);
  assert.equal(elements["fill-foreground-input"].disabled, false);
  assert.ok(tauriInvokes.some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.state === "suggesting"
      && invoke.payload.payload.promptKind === "draft"
      && invoke.payload.payload.promptReady === true
  ));
  await runLastScheduledTimeout("overlay fix prompt-state sync");
  assert.equal(desktopPromptStateLatest.activeTextKind, "draft");
  assert.ok(elements["service-status"].textContent.includes("needs-work"));

  assert.equal(typeof overlayClickListener, "function");
  const fillRequestsBeforeMissingOverlayPayload = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const overlayHideCountBeforeMissingOverlayPayload = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  const overlayStateCountBeforeMissingOverlayPayload = tauriInvokes.length;
  await overlayClickListener({ payload: null });
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeMissingOverlayPayload);
  assert.ok(tauriInvokes.slice(overlayStateCountBeforeMissingOverlayPayload).some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.state === "resting"
      && invoke.payload.payload.guardReason === "payload_guard"
      && invoke.payload.payload.noAutoSubmit === true
  ));
  await runLastScheduledTimeout("missing overlay payload guard hide");
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length, overlayHideCountBeforeMissingOverlayPayload + 1);
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "blocked");
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayClickGuard, "blocked");
  assert.equal(elements["desktop-fusion-evidence"].dataset.noAutoSubmit, "true");

  const fillRequestsBeforeStaleOverlayClick = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const overlayHideCountBeforeStaleOverlayClick = tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length;
  const overlayStateCountBeforeStaleOverlayClick = tauriInvokes.length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      titleHash: "stale-title-hash"
    }
  });
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeStaleOverlayClick);
  assert.ok(tauriInvokes.slice(overlayStateCountBeforeStaleOverlayClick).some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.state === "resting"
      && invoke.payload.payload.guardReason === "payload_guard"
      && invoke.payload.payload.noAutoSubmit === true
  ));
  await runLastScheduledTimeout("stale overlay click guard hide");
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "hide_mascot_overlay").length, overlayHideCountBeforeStaleOverlayClick + 1);
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "blocked");

  const fillRequestsBeforeDraftOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const showMainCountBeforeDraftOverlayAction = tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "draft"
    }
  });
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeDraftOverlayAction);
  assert.equal(tauriInvokes.filter((invoke) => invoke.command === "show_main_window").length, showMainCountBeforeDraftOverlayAction + 1);
  assert.equal(elements["desktop-fusion-evidence"].dataset.overlayClickPrompt, "edit");
  assert.equal(elements["desktop-fusion-evidence"].dataset.fusionState, "generated");

  const fillRequestsBeforeRefreshOverlayAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const snapshotRequestsBeforeRefreshOverlayAction = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "refresh"
    }
  });
  await waitFor(
    () => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeRefreshOverlayAction,
    "overlay refresh action"
  );
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeRefreshOverlayAction);
  const refreshOverlayShow = tauriInvokes.filter((invoke) => invoke.command === "show_mascot_overlay").at(-1);
  assert.equal(refreshOverlayShow.payload.payload.overlayMode, "expanded");

  desktopSnapshotResponse = desktopSnapshotReport;
  const snapshotRequestsBeforeValidOverlayRecovery = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  await elements["refresh-desktop-snapshot"].trigger("click");
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeValidOverlayRecovery, "valid overlay recovery");

  const fillRequestsBeforeMissingFillAction = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  const overlayStateCountBeforeMissingFillAction = tauriInvokes.length;
  await overlayClickListener({ payload: overlayShow.payload.payload });
  assert.equal(serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length, fillRequestsBeforeMissingFillAction);
  const missingFillActionInvokes = tauriInvokes.slice(overlayStateCountBeforeMissingFillAction);
  assert.ok(["blocked", "needs-draft"].includes(elements["desktop-fusion-evidence"].dataset.fusionState));
  assert.ok(
    elements["desktop-fusion-evidence"].dataset.overlayClickGuard === "blocked"
      || elements["desktop-fusion-evidence"].dataset.overlayClickPrompt === "missing"
  );
  assert.ok(missingFillActionInvokes.some((invoke) =>
    invoke.command === "set_mascot_overlay_state"
      && invoke.payload.payload.state === "resting"
      && invoke.payload.payload.guardReason === "payload_guard"
      && invoke.payload.payload.noAutoSubmit === true
  ) || missingFillActionInvokes.some((invoke) => invoke.command === "hide_mascot_overlay")
    || missingFillActionInvokes.some((invoke) => invoke.command === "show_main_window"));
  await runLastScheduledTimeout("missing fill action guard hide");

  elements["desktop-generated-prompt"].value = "Generated desktop prompt from overlay preview";
  elements["desktop-generated-prompt"].dataset.generatedBy = "overlay-preview";
  elements["desktop-generated-prompt"].trigger("input");

  const snapshotRequestsBeforeOverlayClick = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  const fillRequestsBeforeOverlayClick = serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length;
  await overlayClickListener({
    payload: {
      ...overlayShow.payload.payload,
      overlayAction: "fill",
      promptReady: true,
      promptKind: "generated",
      promptText: "Generated desktop prompt from overlay preview"
    }
  });
  await waitFor(
    () => serviceRequests.filter((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.confirmForeground).length > fillRequestsBeforeOverlayClick,
    "overlay click foreground fill"
  );
  assert.equal(serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length, snapshotRequestsBeforeOverlayClick);

  elements["desktop-fill-text"].value = "Desktop self-test prompt text";
  await elements["run-desktop-self-test"].trigger("click");
  await waitFor(() => elements["desktop-fill-result"].dataset.fillPass === "true", "desktop fill self-test");
  const desktopFillRequest = serviceRequests.find((request) => request.method === "POST" && request.path === "/desktop/fill" && request.body.text === "Desktop self-test prompt text");
  assert.equal(desktopFillRequest.body.text, "Desktop self-test prompt text");
  assert.equal(elements["desktop-fill-result"].dataset.writeAttempted, "true");
  assert.equal(elements["desktop-fill-result"].dataset.noAutoSubmit, "true");
  assert.equal(elements["desktop-mascot-state"].dataset.mascotState, "success");

  await elements["refresh-learning"].trigger("click");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/learning/reflections"));
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/learning/evolution-candidates"));
  assert.equal(elements["learning-status"].dataset.candidateCount, "2");

  await elements["export-diagnostics"].trigger("click");
  await waitFor(() => elements["diagnostics-output"].dataset.diagnostics === "exported", "diagnostics export");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/diagnostics/export"));
  assert.ok(elements["diagnostics-output"].textContent.includes("portRecovery"));
  assert.ok(elements["diagnostics-output"].textContent.includes("pilotOutcomeReadinessReport"));
  assert.ok(elements["diagnostics-output"].textContent.includes("promptQualityLiftReport"));
  assert.ok(elements["diagnostics-output"].textContent.includes("promptQualityLiftSegmentsReport"));
  assert.ok(elements["diagnostics-output"].textContent.includes("selfImprovementReport"));
  assert.ok(elements["diagnostics-output"].textContent.includes("evolutionCandidateReport"));
  assert.equal(elements["quality-lift-recommendations"].dataset.recommendationCount, "1");
  assert.equal(elements["quality-lift-segments-improving"].dataset.segmentCount, "1");

  await elements["refresh-pilot-outcomes"].trigger("click");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/metrics/pilot-outcomes"));
  assert.equal(elements["pilot-outcome-targets"].dataset.targetCount, "2");

  await elements["refresh-quality-lift"].trigger("click");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/metrics/prompt-quality-lift"));
  assert.equal(elements["quality-lift-cohorts"].dataset.cohortCount, "3");
  assert.equal(elements["quality-lift-comparisons"].dataset.primaryDecision, "quality_lift_positive");

  await elements["refresh-quality-lift-segments"].trigger("click");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/metrics/prompt-quality-lift-segments"));
  assert.equal(elements["quality-lift-segments-regressing"].dataset.segmentCount, "1");
  assert.ok(elements["quality-lift-segments-regressing"].innerHTML.includes("-67%"));

  await elements["refresh-outcome-followups"].trigger("click");
  assert.ok(serviceRequests.some((request) => request.method === "GET" && request.path === "/outcomes/pending"));
  assert.equal(elements["outcome-followup-status"].dataset.pendingOutcomeCount, "2");

  await elements["outcome-followup-list"].trigger("click", {
    target: createOutcomeButton("generation-followup-1", "needs-work")
  });
  await waitFor(() => elements["outcome-followup-status"].dataset.pendingOutcomeCount === "1", "outcome follow-up");
  const followupRequest = serviceRequests.find((request) => request.method === "POST" && request.path === "/outcomes/follow-up");
  assert.equal(followupRequest.body.generationId, "generation-followup-1");
  assert.equal(followupRequest.body.outcomeLabel, "needs-work");
  assert.ok(!elements["outcome-followup-list"].innerHTML.includes("generation-followup-1"));
  assert.ok(elements["service-status"].textContent.includes("outcome recorded"));

  await elements["clear-local-data"].trigger("click");
  interactionTestPhase = "legacy-actions-complete";
  await waitFor(() => elements["diagnostics-output"].dataset.clearAllLocalData === "true", "clear local data");
  assert.ok(serviceRequests.some((request) => request.method === "DELETE" && request.path === "/data/all"));
  assert.equal(localStorageValues.smartPromptProviderTestPass, undefined);

  assert.equal(context.window.__smartPromptEventsReady, true);
  assert.equal(typeof overlayClickListener, "function");
  const snapshotRequestsBeforeShortcut = serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length;
  shortcutListener({ payload: "Ctrl+Alt+P" });
  assert.equal(context.window.__smartPromptShortcutHits, 1);
  assert.equal(context.document.documentElement.dataset.lastShortcut, "Ctrl+Alt+P");
  await waitFor(() => serviceRequests.filter((request) => request.path === "/desktop/input-snapshot").length > snapshotRequestsBeforeShortcut, "shortcut desktop capture");
  assert.ok(elements["service-status"].textContent.includes("shortcut captured"));

  elements["ui-locale"].value = "zh-CN";
  await elements["ui-locale"].trigger("change");
  await waitFor(() => elements["provider-status"].textContent.includes("当前"), "locale switch zh-CN");
  assert.equal(localStorageValues.smartPromptDesktopLocale, "zh-CN");
  assert.ok(elements["skill-list"].innerHTML.includes("还没有"));
  assert.ok(elements["first-run-progress"].textContent.includes("就绪"));

  console.log("desktop-shell interaction tests passed");
})();

const interactionTestWatchdog = setTimeout(() => {
  console.error(`desktop-shell interaction tests timed out during ${interactionTestPhase}`);
  process.exitCode = 1;
}, 15000);

interactionTestRun.then(() => {
  clearTimeout(interactionTestWatchdog);
}).catch((error) => {
  clearTimeout(interactionTestWatchdog);
  console.error(error);
  process.exitCode = 1;
});
