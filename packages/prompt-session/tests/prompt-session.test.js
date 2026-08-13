const assert = require("node:assert");

const {
  COMMANDS,
  CONTRACT_VERSIONS,
  REASONS,
  STATES,
  TARGET_CAPABILITIES,
  VERIFICATIONS,
  createPromptSession,
  createViewModel,
  mapReason
} = require("../index.js");

function createTarget(overrides = {}) {
  return {
    async inspect() {
      return {
        status: "ready",
        level: TARGET_CAPABILITIES.VERIFIED_WRITE,
        reason: "",
        ...overrides.capability
      };
    },
    async insert(text) {
      return {
        attempted: true,
        verified: true,
        verification: VERIFICATIONS.MACHINE,
        noAutoSubmit: true,
        reason: "inserted",
        insertedTextLength: text.length,
        ...overrides.insertResult
      };
    },
    async undo() {
      return {
        attempted: true,
        verified: true,
        noAutoSubmit: true,
        reason: "undo-succeeded",
        ...overrides.undoResult
      };
    }
  };
}

function createGenerator(results) {
  const queue = Array.isArray(results) ? [...results] : [results];
  return {
    async generate({ draft, mode }) {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next({ draft, mode });
      return next || { prompt: `Generated: ${draft}`, mode };
    }
  };
}

function assertNoInternalTokens(viewModel) {
  const serialized = JSON.stringify(viewModel);
  for (const token of [
    "payload_guard",
    "visualOnly",
    "safeCandidate",
    "evidenceAction",
    "foreground_fill_requires_safe_candidate"
  ]) {
    assert.equal(serialized.includes(token), false, `View Model leaked internal token: ${token}`);
  }
}

async function testNormalGenerateInsertAndUndo() {
  const observedStates = [];
  const session = createPromptSession({
    generator: createGenerator({ prompt: "A structured prompt", mode: "idea" }),
    target: createTarget(),
    settings: { locale: "zh-CN" }
  });
  session.subscribe((viewModel) => observedStates.push(viewModel.state));

  const opened = session.open({
    draft: "做一个 CRM",
    mode: "idea",
    targetCapability: {
      status: "ready",
      level: TARGET_CAPABILITIES.VERIFIED_WRITE
    }
  });
  assert.equal(opened.state, STATES.IDLE);
  assert.equal(opened.primaryAction.id, "generate");

  const reviewed = await session.dispatch({ type: COMMANDS.GENERATE });
  assert.equal(reviewed.state, STATES.REVIEW);
  assert.equal(reviewed.prompt, "A structured prompt");
  assert.equal(reviewed.primaryAction.id, "insert");
  assert.ok(observedStates.includes(STATES.DRAFTING));

  const inserted = await session.dispatch({ type: COMMANDS.INSERT });
  assert.equal(inserted.state, STATES.INSERTED);
  assert.equal(inserted.title, "已填入，未发送");
  assert.equal(inserted.verification, VERIFICATIONS.MACHINE);
  assert.equal(inserted.noAutoSubmit, true);
  assert.equal(inserted.canUndo, true);

  const undone = await session.dispatch({ type: COMMANDS.UNDO });
  assert.equal(undone.state, STATES.REVIEW);
  assert.equal(undone.canUndo, false);
  assert.equal(undone.prompt, "A structured prompt");
}

async function testTargetMissingAndCopyOnly() {
  const missingSession = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target: createTarget({
      capability: {
        status: "missing",
        level: TARGET_CAPABILITIES.COPY_ONLY,
        reason: "missing_input"
      }
    })
  });
  missingSession.open({ draft: "Draft" });
  await missingSession.dispatch({ type: COMMANDS.GENERATE });
  const missing = await missingSession.dispatch({ type: COMMANDS.INSERT });
  assert.equal(missing.state, STATES.TARGET_MISSING);
  assert.equal(missing.reason.code, REASONS.TARGET_MISSING);
  assert.equal(missing.primaryAction.id, "retry-target");
  assert.ok(missing.secondaryActions.some((action) => action.id === "copy"));

  const copyOnlySession = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target: createTarget({
      capability: {
        status: "ready",
        level: TARGET_CAPABILITIES.COPY_ONLY,
        reason: "missing_adapter_writer"
      }
    })
  });
  copyOnlySession.open({ draft: "Draft" });
  await copyOnlySession.dispatch({ type: COMMANDS.GENERATE });
  const copyOnly = await copyOnlySession.dispatch({ type: COMMANDS.INSERT });
  assert.equal(copyOnly.state, STATES.COPY_ONLY);
  assert.equal(copyOnly.reason.code, REASONS.TARGET_UNSUPPORTED);
  assert.equal(copyOnly.primaryAction.id, "copy");
}

async function testManualConfirmationAndBlockedTarget() {
  const manualSession = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target: createTarget({
      capability: {
        status: "ready",
        level: TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED,
        reason: "readback_unavailable"
      },
      insertResult: {
        verified: false,
        verification: VERIFICATIONS.MANUAL_REQUIRED,
        reason: "readback_unavailable"
      }
    })
  });
  manualSession.open({ draft: "Draft" });
  await manualSession.dispatch({ type: COMMANDS.GENERATE });
  const manual = await manualSession.dispatch({ type: COMMANDS.INSERT });
  assert.equal(manual.state, STATES.INSERTED);
  assert.equal(manual.verification, VERIFICATIONS.MANUAL_REQUIRED);
  assert.equal(manual.manualConfirmationRequired, true);
  assert.ok(manual.description.includes("确认"));
  assert.equal(manual.noAutoSubmit, true);

  const notAttemptedSession = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target: createTarget({
      capability: {
        status: "ready",
        level: TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED,
        reason: "readback_unavailable"
      },
      insertResult: {
        attempted: false,
        verified: false,
        verification: VERIFICATIONS.MANUAL_REQUIRED,
        reason: "insert_failed"
      }
    })
  });
  notAttemptedSession.open({ draft: "Draft" });
  await notAttemptedSession.dispatch({ type: COMMANDS.GENERATE });
  const notAttempted = await notAttemptedSession.dispatch({ type: COMMANDS.INSERT });
  assert.equal(notAttempted.state, STATES.ERROR);
  assert.equal(notAttempted.reason.code, REASONS.INSERT_FAILED);
  assert.equal(notAttempted.manualConfirmationRequired, false);

  const blockedSession = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target: createTarget({
      capability: {
        status: "blocked",
        level: TARGET_CAPABILITIES.COPY_ONLY,
        reason: "foreground-window-hidden"
      }
    })
  });
  blockedSession.open({ draft: "Draft" });
  await blockedSession.dispatch({ type: COMMANDS.GENERATE });
  const blocked = await blockedSession.dispatch({ type: COMMANDS.INSERT });
  assert.equal(blocked.state, STATES.BLOCKED);
  assert.equal(blocked.reason.code, REASONS.TARGET_HIDDEN);
  assert.equal(blocked.noAutoSubmit, true);
  assertNoInternalTokens(blocked);
}

async function testProviderFailureAndRecovery() {
  const providerError = new Error("service offline");
  providerError.code = "provider_offline";
  const session = createPromptSession({
    generator: createGenerator([
      providerError,
      { prompt: "Recovered prompt", mode: "polish" }
    ]),
    target: createTarget()
  });
  session.open({ draft: "Draft", mode: "polish" });

  const failed = await session.dispatch({ type: COMMANDS.GENERATE });
  assert.equal(failed.state, STATES.ERROR);
  assert.equal(failed.reason.code, REASONS.PROVIDER_UNAVAILABLE);
  assert.equal(failed.primaryAction.id, "retry");

  const recovered = await session.dispatch({ type: COMMANDS.RETRY });
  assert.equal(recovered.state, STATES.REVIEW);
  assert.equal(recovered.prompt, "Recovered prompt");
  assert.equal(recovered.reason.code, REASONS.NONE);
}

async function testInsertFailureAndRecovery() {
  let insertAttempt = 0;
  const target = createTarget();
  target.insert = async () => {
    insertAttempt += 1;
    if (insertAttempt === 1) {
      return {
        attempted: true,
        verified: false,
        verification: VERIFICATIONS.NONE,
        noAutoSubmit: true,
        reason: "write_failed"
      };
    }
    return {
      attempted: true,
      verified: true,
      verification: VERIFICATIONS.MACHINE,
      noAutoSubmit: true,
      reason: "inserted"
    };
  };
  const session = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target
  });
  session.open({ draft: "Draft" });
  await session.dispatch({ type: COMMANDS.GENERATE });
  const failed = await session.dispatch({ type: COMMANDS.INSERT });
  assert.equal(failed.state, STATES.ERROR);
  assert.equal(failed.reason.code, REASONS.INSERT_FAILED);
  const recovered = await session.dispatch({ type: COMMANDS.RETRY });
  assert.equal(recovered.state, STATES.INSERTED);
  assert.equal(recovered.verification, VERIFICATIONS.MACHINE);
  assert.equal(insertAttempt, 2);
}

function testFiniteReasonMapping() {
  const cases = new Map([
    ["missing_input", REASONS.TARGET_MISSING],
    ["target_tool_not_foreground", REASONS.TARGET_NOT_FOCUSED],
    ["foreground-window-hidden", REASONS.TARGET_HIDDEN],
    ["foreground_fill_requires_safe_candidate", REASONS.TARGET_UNSAFE],
    ["payload_guard", REASONS.TARGET_UNSAFE],
    ["missing_adapter_writer", REASONS.TARGET_UNSUPPORTED],
    ["readback_unavailable", REASONS.READBACK_UNAVAILABLE],
    ["credential_invalid", REASONS.CREDENTIAL_INVALID],
    ["model_unavailable", REASONS.MODEL_UNAVAILABLE],
    ["network_unavailable", REASONS.NETWORK_UNAVAILABLE],
    ["local_service_bridge_failed", REASONS.NETWORK_UNAVAILABLE],
    ["local_service_error", REASONS.NETWORK_UNAVAILABLE],
    [new TypeError("fetch failed"), REASONS.NETWORK_UNAVAILABLE],
    [new TypeError("Failed to fetch"), REASONS.NETWORK_UNAVAILABLE],
    [{ code: "credential_invalid", message: "Provider credentials were rejected." }, REASONS.CREDENTIAL_INVALID],
    [{ code: "provider_error", message: "The provider returned an unexpected error." }, REASONS.PROVIDER_ERROR],
    ["provider_error", REASONS.PROVIDER_ERROR],
    ["provider_offline", REASONS.PROVIDER_UNAVAILABLE],
    ["totally_new_internal_token", REASONS.UNKNOWN]
  ]);
  for (const [raw, expected] of cases) assert.equal(mapReason(raw), expected, raw);

  const credentialView = createViewModel({
    state: STATES.REVIEW,
    locale: "zh-CN",
    reason: REASONS.CREDENTIAL_INVALID,
    prompt: "保留现有可编辑草稿"
  });
  assert.equal(credentialView.reason.label, "模型凭证未通过验证");
  assert.ok(credentialView.reason.message.includes("API Key"));

  const modelView = createViewModel({
    state: STATES.REVIEW,
    locale: "zh-CN",
    reason: REASONS.MODEL_UNAVAILABLE,
    prompt: "保留现有可编辑草稿"
  });
  assert.equal(modelView.reason.label, "当前模型不可用");

  const networkView = createViewModel({
    state: STATES.REVIEW,
    locale: "zh-CN",
    reason: REASONS.NETWORK_UNAVAILABLE,
    prompt: "保留现有可编辑草稿"
  });
  assert.equal(networkView.reason.label, "模型服务连接失败");

  const providerView = createViewModel({
    state: STATES.REVIEW,
    locale: "zh-CN",
    reason: REASONS.PROVIDER_ERROR,
    prompt: "保留现有可编辑草稿"
  });
  assert.equal(providerView.reason.label, "Provider 暂时不可用");
}

function testStateCopyContract() {
  const expected = {
    [STATES.IDLE]: ["需要我帮你整理吗", "生成提示词"],
    [STATES.DRAFTING]: ["正在整理你的需求", "取消"],
    [STATES.REVIEW]: ["提示词已生成", "填入输入框"],
    [STATES.TARGET_MISSING]: ["请先点击目标输入框", "重新检测"],
    [STATES.COPY_ONLY]: ["当前工具暂不支持自动填入", "复制提示词"],
    [STATES.INSERTING]: ["正在填入", "取消"],
    [STATES.INSERTED]: ["已填入，未发送", "完成"],
    [STATES.BLOCKED]: ["为避免填错，已暂停", "重新检测"],
    [STATES.ERROR]: ["本次没有完成", "重试"]
  };
  for (const [state, [title, primaryLabel]] of Object.entries(expected)) {
    const viewModel = createViewModel({ state, locale: "zh-CN", noAutoSubmit: true });
    assert.equal(viewModel.title, title, state);
    assert.equal(viewModel.primaryAction.label, primaryLabel, state);
    assert.equal(viewModel.noAutoSubmit, true, state);
  }
}

function testSameEventsProduceSameViewModel() {
  const browser = createPromptSession({ settings: { locale: "zh-CN" } });
  const desktop = createPromptSession({ settings: { locale: "zh-CN" } });
  const snapshot = {
    state: STATES.REVIEW,
    draft: "同一个草稿",
    prompt: "同一个提示词",
    mode: "continue",
    targetCapability: {
      status: "ready",
      level: TARGET_CAPABILITIES.VERIFIED_WRITE
    },
    noAutoSubmit: true
  };
  const browserView = browser.dispatch({
    type: COMMANDS.SYNC,
    snapshot: { ...snapshot, platformDebug: { adapter: "dom" } }
  });
  const desktopView = desktop.dispatch({
    type: COMMANDS.SYNC,
    snapshot: { ...snapshot, platformDebug: { adapter: "uia" } }
  });
  assert.deepEqual(browserView, desktopView);

  const guarded = desktop.dispatch({
    type: COMMANDS.SYNC,
    snapshot: {
      ...snapshot,
      state: STATES.BLOCKED,
      reason: "foreground_fill_requires_safe_candidate"
    }
  });
  assert.equal(guarded.reason.code, REASONS.TARGET_UNSAFE);
  assertNoInternalTokens(guarded);
}

async function testV2RequiresMachineReadback() {
  const manualSession = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target: createTarget({
      capability: {
        status: "ready",
        level: TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED,
        reason: "readback_unavailable"
      },
      insertResult: {
        attempted: true,
        verified: false,
        verification: VERIFICATIONS.MANUAL_REQUIRED,
        reason: "readback_unavailable"
      }
    }),
    settings: { contractVersion: CONTRACT_VERSIONS.V2 }
  });
  manualSession.open({ draft: "Draft" });
  await manualSession.dispatch({ type: COMMANDS.GENERATE });
  const manual = await manualSession.dispatch({ type: COMMANDS.INSERT });
  assert.equal(manual.contractVersion, CONTRACT_VERSIONS.V2);
  assert.equal(manual.state, STATES.COPY_ONLY);
  assert.equal(manual.reason.code, REASONS.READBACK_UNAVAILABLE);
  assert.equal(manual.verification, VERIFICATIONS.NONE);
  assert.equal(manual.manualConfirmationRequired, false);
  assert.equal(manual.canUndo, false);

  const unverifiedSession = createPromptSession({
    generator: createGenerator({ prompt: "Prompt" }),
    target: createTarget({
      insertResult: {
        attempted: true,
        verified: false,
        verification: VERIFICATIONS.MANUAL_REQUIRED,
        reason: "readback_unavailable"
      }
    }),
    settings: { contractVersion: CONTRACT_VERSIONS.V2 }
  });
  unverifiedSession.open({ draft: "Draft" });
  await unverifiedSession.dispatch({ type: COMMANDS.GENERATE });
  const unverified = await unverifiedSession.dispatch({ type: COMMANDS.INSERT });
  assert.equal(unverified.state, STATES.COPY_ONLY);
  assert.equal(unverified.canUndo, false);
}

async function testV2ClarificationOutcomeAndCollapse() {
  const session = createPromptSession({
    generator: createGenerator([
      {
        requiresClarification: true,
        clarificationQuestion: "要修改哪个项目？",
        reason: "high-risk-project-ambiguity"
      },
      { prompt: "Verified prompt", mode: "idea" }
    ]),
    target: createTarget(),
    settings: { contractVersion: CONTRACT_VERSIONS.V2, locale: "zh-CN" }
  });
  session.open({ draft: "帮我改一下项目", mode: "idea" });
  const clarification = await session.dispatch({ type: COMMANDS.GENERATE });
  assert.equal(clarification.state, STATES.CLARIFICATION);
  assert.equal(clarification.clarification.question, "要修改哪个项目？");
  assert.equal(clarification.primaryAction.id, "generate");
  assert.equal(clarification.noAutoSubmit, true);

  session.dispatch({ type: COMMANDS.SET_DRAFT, draft: "修改 Smart Prompt 项目" });
  const reviewed = await session.dispatch({ type: COMMANDS.GENERATE });
  assert.equal(reviewed.state, STATES.REVIEW);
  assert.equal(reviewed.clarification.required, false);

  const inserted = await session.dispatch({ type: COMMANDS.INSERT });
  assert.equal(inserted.state, STATES.INSERTED);
  assert.equal(inserted.collapseRequested, true);
  assert.equal(inserted.canUndo, true);

  const withOutcome = session.dispatch({
    type: COMMANDS.OUTCOME_AVAILABLE,
    outcome: { id: "outcome-1", status: "asked", question: "上次是否帮助你完成任务？" }
  });
  assert.deepEqual(withOutcome.outcome, {
    id: "outcome-1",
    status: "asked",
    question: "上次是否帮助你完成任务？"
  });

  const migratedOutcome = session.dispatch({
    type: COMMANDS.OUTCOME_AVAILABLE,
    outcome: { id: "legacy-outcome", status: "completed" }
  });
  assert.equal(migratedOutcome.outcome.status, "succeeded");

  const withCandidate = session.dispatch({
    type: COMMANDS.CANDIDATE_REMINDER,
    candidate: { id: "candidate-1", type: "rule", message: "发现一条可复用规则", ignoredCount: 1 }
  });
  assert.deepEqual(withCandidate.candidateReminder, {
    id: "candidate-1",
    type: "rule",
    message: "发现一条可复用规则",
    ignoredCount: 1
  });

  const invalidated = session.dispatch({ type: COMMANDS.INVALIDATE_UNDO });
  assert.equal(invalidated.canUndo, false);
  assert.equal(invalidated.collapseRequested, false);

  const resolved = session.dispatch({ type: COMMANDS.OUTCOME_RESOLVED });
  assert.equal(resolved.outcome, null);
}

(async () => {
  await testNormalGenerateInsertAndUndo();
  await testTargetMissingAndCopyOnly();
  await testManualConfirmationAndBlockedTarget();
  await testProviderFailureAndRecovery();
  await testInsertFailureAndRecovery();
  testFiniteReasonMapping();
  testStateCopyContract();
  testSameEventsProduceSameViewModel();
  await testV2RequiresMachineReadback();
  await testV2ClarificationOutcomeAndCollapse();
  console.log("prompt-session contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
