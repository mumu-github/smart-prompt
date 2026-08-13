const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const modulePath = path.resolve(__dirname, "../assistant-card.js");
const stylesheetPath = path.resolve(__dirname, "../assistant-card.css");
assert.ok(fs.existsSync(modulePath), "shared Assistant Card module is missing");
assert.ok(fs.existsSync(stylesheetPath), "shared Assistant Card stylesheet is missing");

const AssistantUI = require(modulePath);

function viewModel(overrides = {}) {
  return {
    contractVersion: "prompt-session@1",
    state: "review",
    locale: "zh-CN",
    title: "提示词已生成",
    description: "可先编辑；填入后也不会自动发送。",
    primaryAction: { id: "insert", label: "填入输入框", enabled: true },
    secondaryActions: [
      { id: "regenerate", label: "重新生成", enabled: true },
      { id: "copy", label: "复制", enabled: true },
      { id: "diagnostics", label: "打开诊断", enabled: true },
      { id: "close", label: "关闭", enabled: true }
    ],
    busy: false,
    draft: "",
    prompt: "为 CRM 后台生成可执行需求说明。",
    mode: "idea",
    reason: { code: "none", label: "", message: "" },
    noAutoSubmit: true,
    ...overrides
  };
}

const zh = AssistantUI.createAssistantCardModel(viewModel());
assert.equal(zh.contractVersion, "assistant-card@1");
assert.equal(zh.primaryAction.id, "insert");
assert.deepEqual(zh.secondaryActions.map((action) => action.id), ["regenerate", "copy"]);
assert.ok(!zh.secondaryActions.some((action) => action.id === "close"));
assert.equal(zh.editor.value, "为 CRM 后台生成可执行需求说明。");
assert.equal(zh.editor.label, "提示词");
assert.equal(zh.options.label, "选项");
assert.deepEqual(zh.options.choices.map((choice) => choice.label), ["构思", "续写", "润色"]);
assert.equal(zh.safetyText, "只会填入，不会自动发送");
assert.equal(zh.closeAction.label, "收起");
assert.equal(zh.reason.visible, false);

const en = AssistantUI.createAssistantCardModel(viewModel({
  locale: "en",
  title: "Prompt ready",
  description: "Edit it first if needed. Inserting never sends it.",
  primaryAction: { id: "insert", label: "Insert into input", enabled: true },
  secondaryActions: [{ id: "copy", label: "Copy", enabled: true }],
  prompt: "Create an implementation-ready CRM brief.",
  mode: "polish",
  reason: {
    code: "target-unsafe",
    label: "Target is not safe yet",
    message: "The insert location cannot be confirmed."
  }
}));
assert.equal(en.editor.label, "Prompt");
assert.equal(en.options.label, "Options");
assert.deepEqual(en.options.choices.map((choice) => choice.label), ["Idea", "Continue", "Polish"]);
assert.equal(en.options.choices.find((choice) => choice.selected).id, "polish");
assert.equal(en.safetyText, "Inserts only. Never sends automatically.");
assert.equal(en.closeAction.label, "Collapse");
assert.equal(en.reason.visible, true);
assert.equal(en.reason.label, "Target is not safe yet");

const idle = AssistantUI.createAssistantCardModel(viewModel({
  state: "idle",
  prompt: "",
  draft: "",
  primaryAction: { id: "generate", label: "生成提示词", enabled: true },
  secondaryActions: [{ id: "close", label: "关闭", enabled: true }]
}), { value: "写一个发布计划", mode: "continue" });
assert.equal(idle.editor.value, "写一个发布计划");
assert.equal(idle.options.choices.find((choice) => choice.selected).id, "continue");
assert.equal(idle.secondaryActions.length, 0);
assert.equal(idle.editor.placeholder, "写下你的目标或当前草稿");

assert.deepEqual(AssistantUI.OUTCOME_FAILURE_REASONS, [
  "missing_context",
  "wrong_format",
  "not_actionable",
  "too_long",
  "token_waste",
  "tool_mismatch",
  "low_quality",
  "insert_failed"
]);

const pendingOutcome = {
  state: "question",
  outcome: { outcomeId: "outcome_001", status: "unknown" }
};
const outcomeFirst = AssistantUI.createAssistantCardModel(viewModel({
  pendingOutcome,
  learningCandidate: { artifactId: "artifact_001", ignoredCount: 0 }
}));
assert.equal(outcomeFirst.attention.type, "outcome", "pending outcome must win over a learning candidate");
assert.equal(outcomeFirst.attention.stage, "question");
assert.equal(outcomeFirst.attention.title, "上次是否帮助你完成任务？");
assert.deepEqual(outcomeFirst.attention.actions.map((action) => action.id), [
  "outcome-completed",
  "outcome-not-completed"
]);
assert.deepEqual(outcomeFirst.attention.actions.map((action) => action.value), ["completed", "not_completed"]);
assert.equal(outcomeFirst.primaryAction.id, "insert", "outcome feedback must not replace the normal prompt action");

const outcomeReasons = AssistantUI.createAssistantCardModel(viewModel({ pendingOutcome }), { outcomeStage: "reason" });
assert.equal(outcomeReasons.attention.type, "outcome");
assert.equal(outcomeReasons.attention.stage, "reason");
assert.equal(outcomeReasons.attention.actions.length, 8);
assert.ok(outcomeReasons.attention.actions.every((action) => action.id === "outcome-reason"));
assert.deepEqual(
  outcomeReasons.attention.actions.map((action) => action.value),
  AssistantUI.OUTCOME_FAILURE_REASONS
);

const reasonPayload = AssistantUI.createActionPayload(
  outcomeReasons.attention.actions.find((action) => action.value === "tool_mismatch"),
  "editor text must stay separate",
  "polish"
);
assert.deepEqual(reasonPayload, {
  id: "outcome-reason",
  value: "tool_mismatch",
  editorValue: "editor text must stay separate",
  mode: "polish",
  outcomeId: "outcome_001"
});

const completedPayload = AssistantUI.createActionPayload(outcomeFirst.attention.actions[0], "draft", "idea");
assert.deepEqual(completedPayload, {
  id: "outcome-completed",
  value: "completed",
  editorValue: "draft",
  mode: "idea",
  outcomeId: "outcome_001"
});

const notCompletedPayload = AssistantUI.createActionPayload(outcomeFirst.attention.actions[1], "draft", "idea");
assert.deepEqual(notCompletedPayload, {
  id: "outcome-not-completed",
  value: "not_completed",
  editorValue: "draft",
  mode: "idea",
  outcomeId: "outcome_001"
});

const candidate = AssistantUI.createAssistantCardModel(viewModel({
  pendingOutcome: null,
  learningCandidate: { artifactId: "artifact_001", ignoredCount: 2 }
}));
assert.equal(candidate.attention.type, "candidate");
assert.equal(candidate.attention.title, "发现一条可复用经验");
assert.equal(candidate.attention.message, "");
assert.deepEqual(candidate.attention.actions.map((action) => action.id), ["candidate-review", "candidate-ignore"]);
assert.deepEqual(
  AssistantUI.createActionPayload(candidate.attention.actions[0], "draft", "continue"),
  {
    id: "candidate-review",
    value: "artifact_001",
    editorValue: "draft",
    mode: "continue",
    candidateId: "artifact_001"
  }
);
assert.deepEqual(
  AssistantUI.createActionPayload(candidate.attention.actions[1], "draft", "continue"),
  {
    id: "candidate-ignore",
    value: "artifact_001",
    editorValue: "draft",
    mode: "continue",
    candidateId: "artifact_001"
  }
);

const hiddenCandidate = AssistantUI.createAssistantCardModel(viewModel({
  learningCandidate: { artifactId: "artifact_001", ignoredCount: 3 }
}));
assert.equal(hiddenCandidate.attention.visible, false);

const modelFailure = AssistantUI.createAssistantCardModel(viewModel({
  // 生产语义：生成失败进入 error 态（无可用提示词），模型错误才抢占主操作；
  // review 态（如离线模板回退）必须保留“填入输入框”。
  state: "error",
  reason: {
    code: "provider-error",
    label: "Provider agnes score=0.12",
    message: "evidenceToken=private apiKey=do-not-show"
  }
}));
assert.equal(modelFailure.attention.type, "model-error");
assert.equal(modelFailure.attention.title, "模型服务暂时不可用");
assert.equal(modelFailure.attention.message, "");
assert.equal(modelFailure.primaryAction.id, "diagnostics");
assert.equal(modelFailure.primaryAction.label, "打开模型设置");
assert.equal(modelFailure.secondaryActions.length, 0);
assert.equal(modelFailure.reason.label, "模型服务暂时不可用");
assert.equal(modelFailure.reason.message, "");

assert.equal(typeof AssistantUI.mountAssistantCard, "function");
assert.ok(
  fs.readFileSync(stylesheetPath, "utf8").includes('.sp-assistant-attention[data-type="candidate"]'),
  "candidate reminders should use the single attention region"
);
assert.equal((fs.readFileSync(modulePath, "utf8").match(/class="sp-assistant-primary"/g) || []).length, 1);

console.log("assistant-card contract tests passed");
