(function initSmartPromptSession(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SmartPromptSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPromptSessionApi() {
  "use strict";

  const CONTRACT_VERSIONS = Object.freeze({
    V1: "prompt-session@1",
    V2: "prompt-session@2"
  });

  const STATES = Object.freeze({
    IDLE: "idle",
    DRAFTING: "drafting",
    CLARIFICATION: "clarification",
    REVIEW: "review",
    TARGET_MISSING: "target_missing",
    COPY_ONLY: "copy_only",
    INSERTING: "inserting",
    INSERTED: "inserted",
    BLOCKED: "blocked",
    ERROR: "error"
  });

  const COMMANDS = Object.freeze({
    OPEN: "OPEN",
    SET_DRAFT: "SET_DRAFT",
    GENERATE: "GENERATE",
    REGENERATE: "REGENERATE",
    GENERATION_STARTED: "GENERATION_STARTED",
    GENERATION_SUCCEEDED: "GENERATION_SUCCEEDED",
    GENERATION_FAILED: "GENERATION_FAILED",
    CLARIFICATION_REQUIRED: "CLARIFICATION_REQUIRED",
    INSERT: "INSERT",
    INSERT_STARTED: "INSERT_STARTED",
    INSERT_SUCCEEDED: "INSERT_SUCCEEDED",
    INSERT_FAILED: "INSERT_FAILED",
    TARGET_UPDATED: "TARGET_UPDATED",
    INVALIDATE_UNDO: "INVALIDATE_UNDO",
    COLLAPSE_ACK: "COLLAPSE_ACK",
    OUTCOME_AVAILABLE: "OUTCOME_AVAILABLE",
    OUTCOME_RESOLVED: "OUTCOME_RESOLVED",
    CANDIDATE_REMINDER: "CANDIDATE_REMINDER",
    CANDIDATE_REMINDER_CLEARED: "CANDIDATE_REMINDER_CLEARED",
    COPY: "COPY",
    UNDO: "UNDO",
    UNDO_SUCCEEDED: "UNDO_SUCCEEDED",
    UNDO_FAILED: "UNDO_FAILED",
    RETRY: "RETRY",
    CANCEL: "CANCEL",
    RESET: "RESET",
    SYNC: "SYNC"
  });

  const TARGET_CAPABILITIES = Object.freeze({
    VERIFIED_WRITE: "verified-write",
    MANUAL_CONFIRMATION_REQUIRED: "manual-confirmation-required",
    COPY_ONLY: "copy-only",
    UNSUPPORTED: "unsupported"
  });

  const TARGET_STATUSES = Object.freeze({
    READY: "ready",
    MISSING: "missing",
    BLOCKED: "blocked",
    UNKNOWN: "unknown"
  });

  const VERIFICATIONS = Object.freeze({
    MACHINE: "machine",
    MANUAL_REQUIRED: "manual-required",
    NONE: "none"
  });

  const REASONS = Object.freeze({
    NONE: "none",
    CLARIFICATION_REQUIRED: "clarification-required",
    TARGET_MISSING: "target-missing",
    TARGET_NOT_FOCUSED: "target-not-focused",
    TARGET_HIDDEN: "target-hidden",
    TARGET_UNSAFE: "target-unsafe",
    TARGET_UNSUPPORTED: "target-unsupported",
    READBACK_UNAVAILABLE: "readback-unavailable",
    CREDENTIAL_INVALID: "credential-invalid",
    MODEL_UNAVAILABLE: "model-unavailable",
    NETWORK_UNAVAILABLE: "network-unavailable",
    PROVIDER_ERROR: "provider-error",
    PROVIDER_UNAVAILABLE: "provider-unavailable",
    GENERATION_FAILED: "generation-failed",
    INSERT_FAILED: "insert-failed",
    UNDO_FAILED: "undo-failed",
    SAFETY_CONTRACT_VIOLATED: "safety-contract-violated",
    UNKNOWN: "unknown"
  });

  const STATE_VALUES = new Set(Object.values(STATES));
  const TARGET_LEVEL_VALUES = new Set(Object.values(TARGET_CAPABILITIES));
  const TARGET_STATUS_VALUES = new Set(Object.values(TARGET_STATUSES));
  const VERIFICATION_VALUES = new Set(Object.values(VERIFICATIONS));
  const REASON_VALUES = new Set(Object.values(REASONS));

  const STATE_COPY = Object.freeze({
    "zh-CN": Object.freeze({
      [STATES.IDLE]: {
        title: "需要我帮你整理吗",
        description: "写下目标或保留当前草稿，生成后由你确认。",
        primary: ["generate", "生成提示词"],
        secondary: [["close", "关闭"]]
      },
      [STATES.DRAFTING]: {
        title: "正在整理你的需求",
        description: "生成完成后会先展示给你，不会自动填入。",
        primary: ["cancel", "取消"],
        secondary: []
      },
      [STATES.CLARIFICATION]: {
        title: "需要确认一个关键点",
        description: "补充这一点后再继续，避免改错项目或扩大风险。",
        primary: ["generate", "继续生成"],
        secondary: [["close", "关闭"]]
      },
      [STATES.REVIEW]: {
        title: "提示词已生成",
        description: "可先编辑；填入后也不会自动发送。",
        primary: ["insert", "填入输入框"],
        secondary: [["regenerate", "重新生成"], ["copy", "复制"]]
      },
      [STATES.TARGET_MISSING]: {
        title: "请先点击目标输入框",
        description: "聚焦目标输入框后重新检测，也可以直接复制。",
        primary: ["retry-target", "重新检测"],
        secondary: [["copy", "复制"]]
      },
      [STATES.COPY_ONLY]: {
        title: "当前工具暂不支持自动填入",
        description: "提示词仍可使用，请复制后手动粘贴。",
        primary: ["copy", "复制提示词"],
        secondary: [["view-reason", "查看原因"]]
      },
      [STATES.INSERTING]: {
        title: "正在填入",
        description: "只填入当前已确认的输入框，不会自动发送。",
        primary: ["cancel", "取消"],
        secondary: []
      },
      [STATES.INSERTED]: {
        title: "已填入，未发送",
        description: "请检查输入框内容，再由你决定是否发送。",
        primary: ["complete", "完成"],
        secondary: [["undo", "撤销"]]
      },
      [STATES.BLOCKED]: {
        title: "为避免填错，已暂停",
        description: "确认目标输入框安全并处于前台后，再重新检测。",
        primary: ["retry-target", "重新检测"],
        secondary: [["copy", "复制"]]
      },
      [STATES.ERROR]: {
        title: "本次没有完成",
        description: "你可以重试；若仍失败，再打开诊断查看原因。",
        primary: ["retry", "重试"],
        secondary: [["diagnostics", "打开诊断"]]
      }
    }),
    en: Object.freeze({
      [STATES.IDLE]: {
        title: "Want help shaping this?",
        description: "Keep the current draft or write a goal. You review the result first.",
        primary: ["generate", "Generate prompt"],
        secondary: [["close", "Close"]]
      },
      [STATES.DRAFTING]: {
        title: "Shaping your request",
        description: "The result will be shown for review and will not be inserted automatically.",
        primary: ["cancel", "Cancel"],
        secondary: []
      },
      [STATES.CLARIFICATION]: {
        title: "One key detail is needed",
        description: "Add this detail before continuing so the wrong project or scope is not changed.",
        primary: ["generate", "Continue"],
        secondary: [["close", "Close"]]
      },
      [STATES.REVIEW]: {
        title: "Prompt ready",
        description: "Edit it first if needed. Inserting never sends it.",
        primary: ["insert", "Insert into input"],
        secondary: [["regenerate", "Regenerate"], ["copy", "Copy"]]
      },
      [STATES.TARGET_MISSING]: {
        title: "Select the target input first",
        description: "Focus the target and detect again, or copy the prompt.",
        primary: ["retry-target", "Detect again"],
        secondary: [["copy", "Copy"]]
      },
      [STATES.COPY_ONLY]: {
        title: "Automatic insert is not supported here",
        description: "The prompt is still usable. Copy and paste it manually.",
        primary: ["copy", "Copy prompt"],
        secondary: [["view-reason", "View reason"]]
      },
      [STATES.INSERTING]: {
        title: "Inserting",
        description: "Only the confirmed input is changed. Nothing is sent.",
        primary: ["cancel", "Cancel"],
        secondary: []
      },
      [STATES.INSERTED]: {
        title: "Inserted, not sent",
        description: "Check the input, then decide whether to send it.",
        primary: ["complete", "Done"],
        secondary: [["undo", "Undo"]]
      },
      [STATES.BLOCKED]: {
        title: "Paused to avoid inserting in the wrong place",
        description: "Confirm the target is safe and in the foreground, then detect again.",
        primary: ["retry-target", "Detect again"],
        secondary: [["copy", "Copy"]]
      },
      [STATES.ERROR]: {
        title: "This action did not finish",
        description: "Retry first. Open diagnostics if it keeps failing.",
        primary: ["retry", "Retry"],
        secondary: [["diagnostics", "Open diagnostics"]]
      }
    })
  });

  const REASON_COPY = Object.freeze({
    "zh-CN": Object.freeze({
      [REASONS.NONE]: ["", ""],
      [REASONS.CLARIFICATION_REQUIRED]: ["需要关键澄清", "请先确认一个可能影响项目、范围或数据安全的关键信息。"],
      [REASONS.TARGET_MISSING]: ["未找到目标输入框", "请先点击要填入的输入框。"],
      [REASONS.TARGET_NOT_FOCUSED]: ["目标未聚焦", "请点击目标输入框后重新检测。"],
      [REASONS.TARGET_HIDDEN]: ["目标当前不可见", "请恢复并前置目标窗口后重新检测。"],
      [REASONS.TARGET_UNSAFE]: ["目标暂不安全", "当前无法确认写入位置，为避免填错已停止。"],
      [REASONS.TARGET_UNSUPPORTED]: ["当前工具未支持自动填入", "请复制提示词后手动粘贴。"],
      [REASONS.READBACK_UNAVAILABLE]: ["无法机器回读", "填入后需要你确认目标输入框中是否可见。"],
      [REASONS.CREDENTIAL_INVALID]: ["模型凭证未通过验证", "请在 Smart Prompt 控制中心更新 API Key 并重新测试。"],
      [REASONS.MODEL_UNAVAILABLE]: ["当前模型不可用", "请选择推荐模型，或填写 Provider 支持的自定义模型 ID。"],
      [REASONS.NETWORK_UNAVAILABLE]: ["模型服务连接失败", "请检查网络和 Base URL 后重试。"],
      [REASONS.PROVIDER_ERROR]: ["Provider 暂时不可用", "服务端返回异常，请稍后重试；持续失败时再打开诊断。"],
      [REASONS.PROVIDER_UNAVAILABLE]: ["模型暂不可用", "请检查模型配置或连接后重试。"],
      [REASONS.GENERATION_FAILED]: ["生成失败", "请重试；若仍失败，再检查模型配置。"],
      [REASONS.INSERT_FAILED]: ["填入失败", "目标内容没有得到确认，请重新检测或复制。"],
      [REASONS.UNDO_FAILED]: ["撤销失败", "请直接检查并修正目标输入框内容。"],
      [REASONS.SAFETY_CONTRACT_VIOLATED]: ["安全承诺未满足", "检测到可能自动提交，写入已停止。"],
      [REASONS.UNKNOWN]: ["原因尚未识别", "请重试；若仍失败，再打开诊断。"]
    }),
    en: Object.freeze({
      [REASONS.NONE]: ["", ""],
      [REASONS.CLARIFICATION_REQUIRED]: ["Key clarification required", "Confirm one detail that could affect the project, scope, or data safety."],
      [REASONS.TARGET_MISSING]: ["Target input not found", "Select the input you want to use first."],
      [REASONS.TARGET_NOT_FOCUSED]: ["Target is not focused", "Focus the target input and detect again."],
      [REASONS.TARGET_HIDDEN]: ["Target is not visible", "Restore and foreground the target window, then detect again."],
      [REASONS.TARGET_UNSAFE]: ["Target is not safe yet", "The insert location cannot be confirmed, so the action was stopped."],
      [REASONS.TARGET_UNSUPPORTED]: ["Automatic insert is not supported", "Copy the prompt and paste it manually."],
      [REASONS.READBACK_UNAVAILABLE]: ["Machine readback is unavailable", "Confirm that the text is visible after insertion."],
      [REASONS.CREDENTIAL_INVALID]: ["Model credentials were rejected", "Update the API key in the Smart Prompt control center and test again."],
      [REASONS.MODEL_UNAVAILABLE]: ["The selected model is unavailable", "Choose the recommended model or enter a custom model ID supported by the provider."],
      [REASONS.NETWORK_UNAVAILABLE]: ["Could not connect to the model service", "Check the network and base URL, then retry."],
      [REASONS.PROVIDER_ERROR]: ["Provider temporarily unavailable", "The provider returned an unexpected response. Retry, then open diagnostics if it continues."],
      [REASONS.PROVIDER_UNAVAILABLE]: ["Model unavailable", "Check the model configuration or connection and retry."],
      [REASONS.GENERATION_FAILED]: ["Generation failed", "Retry, then check the model configuration if it still fails."],
      [REASONS.INSERT_FAILED]: ["Insert failed", "The target content was not confirmed. Detect again or copy instead."],
      [REASONS.UNDO_FAILED]: ["Undo failed", "Inspect and correct the target input directly."],
      [REASONS.SAFETY_CONTRACT_VIOLATED]: ["Safety contract not met", "A possible automatic submit was detected, so insertion stopped."],
      [REASONS.UNKNOWN]: ["Reason not recognized", "Retry, then open diagnostics if the problem continues."]
    })
  });

  function normalizeLocale(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized.startsWith("zh") ? "zh-CN" : "en";
  }

  function normalizeContractVersion(value) {
    return value === CONTRACT_VERSIONS.V2 ? CONTRACT_VERSIONS.V2 : CONTRACT_VERSIONS.V1;
  }

  function normalizeReasonToken(value) {
    if (value && typeof value === "object") {
      return [value.code, value.reason, value.name, value.message]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/[_\s]+/g, "-");
    }
    return String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  }

  function mapReason(value, fallback = REASONS.UNKNOWN) {
    const token = normalizeReasonToken(value);
    if (!token || token === "none" || token === "inserted" || token.includes("succeeded")) return REASONS.NONE;
    if (REASON_VALUES.has(token)) return token;

    if (/(clarification|high-risk-ambiguity|project-ambiguity|destructive-ambiguity)/.test(token)) {
      return REASONS.CLARIFICATION_REQUIRED;
    }

    if (/(readback|read-back|unverified-after-write|manual-confirmation)/.test(token)) {
      return REASONS.READBACK_UNAVAILABLE;
    }
    if (/(hidden|minimized|cloaked|not-visible|window-unusable)/.test(token)) {
      return REASONS.TARGET_HIDDEN;
    }
    if (/(not-foreground|not-focused|manual-composer-focus|focus-required)/.test(token)) {
      return REASONS.TARGET_NOT_FOCUSED;
    }
    if (/(missing-input|target-missing|no-candidates|missing-summary|no-target)/.test(token)) {
      return REASONS.TARGET_MISSING;
    }
    if (/(no-safe-candidate|requires-safe-candidate|unsafe|payload-guard|title-hash-mismatch|profile-mismatch|wrong-target)/.test(token)) {
      return REASONS.TARGET_UNSAFE;
    }
    if (/(unsupported|missing-adapter-writer|requires-windows-uia|unknown-profile)/.test(token)) {
      return REASONS.TARGET_UNSUPPORTED;
    }
    if (/(credential-invalid|invalid-api-key|missing-api-key|authentication-failed|unauthorized)/.test(token)) {
      return REASONS.CREDENTIAL_INVALID;
    }
    if (/(model-unavailable|model-not-found|invalid-model|unsupported-model)/.test(token)) {
      return REASONS.MODEL_UNAVAILABLE;
    }
    if (/(network-unavailable|connection-refused|connection-reset|dns|timed?-out|timeout|fetch-failed|failed-to-fetch|networkerror|local-service-(?:bridge-)?(?:failed|error|unavailable)|bridge-unavailable)/.test(token)) {
      return REASONS.NETWORK_UNAVAILABLE;
    }
    if (/(provider-error|provider-failed|provider-response|upstream-error)/.test(token)) {
      return REASONS.PROVIDER_ERROR;
    }
    if (/(provider-offline|service-offline|llm-unavailable)/.test(token)) {
      return REASONS.PROVIDER_UNAVAILABLE;
    }
    if (/(auto-submit|submit-signal)/.test(token)) return REASONS.SAFETY_CONTRACT_VIOLATED;
    if (/(generation|generate)/.test(token)) return REASONS.GENERATION_FAILED;
    if (/(undo|restore)/.test(token)) return REASONS.UNDO_FAILED;
    if (/(insert|fill|write|paste)/.test(token)) return REASONS.INSERT_FAILED;
    return REASON_VALUES.has(fallback) ? fallback : REASONS.UNKNOWN;
  }

  function normalizeTargetCapability(value = {}) {
    const input = typeof value === "string" ? { level: value } : (value || {});
    const status = TARGET_STATUS_VALUES.has(input.status) ? input.status : TARGET_STATUSES.UNKNOWN;
    let level = TARGET_LEVEL_VALUES.has(input.level) ? input.level : TARGET_CAPABILITIES.COPY_ONLY;
    if (input.canInsert === true && input.manualConfirmationRequired === true) {
      level = TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED;
    } else if (input.canInsert === true && input.verifiedReadback !== false) {
      level = TARGET_CAPABILITIES.VERIFIED_WRITE;
    } else if (input.supported === false) {
      level = TARGET_CAPABILITIES.UNSUPPORTED;
    }
    const reason = mapReason(input.reason, REASONS.NONE);
    return Object.freeze({
      status,
      level,
      canInsert: status === TARGET_STATUSES.READY
        && (level === TARGET_CAPABILITIES.VERIFIED_WRITE
          || level === TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED),
      manualConfirmationRequired: level === TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED,
      reason
    });
  }

  function sanitizeClarification(value) {
    if (!value || typeof value !== "object" || value.required !== true) {
      return Object.freeze({ required: false, question: "" });
    }
    return Object.freeze({
      required: true,
      question: String(value.question || "").trim().slice(0, 240)
    });
  }

  function sanitizeOutcome(value) {
    if (!value || typeof value !== "object") return null;
    const rawStatus = String(value.status || "");
    const status = rawStatus === "completed"
      ? "succeeded"
      : ["pending", "asked", "succeeded", "failed", "unknown", "expired_unknown", "invalidated"].includes(rawStatus)
        ? rawStatus
        : "pending";
    const id = String(value.id || "").replace(/[^a-z0-9_.:+-]/gi, "-").slice(0, 120);
    if (!id) return null;
    return Object.freeze({
      id,
      status,
      question: String(value.question || "").trim().slice(0, 160)
    });
  }

  function sanitizeCandidateReminder(value) {
    if (!value || typeof value !== "object") return null;
    const type = ["memory", "rule", "skill", "generation_policy"].includes(value.type)
      ? value.type
      : "rule";
    const id = String(value.id || "").replace(/[^a-z0-9_.:+-]/gi, "-").slice(0, 120);
    if (!id) return null;
    return Object.freeze({
      id,
      type,
      message: String(value.message || "").trim().slice(0, 160),
      ignoredCount: Math.max(0, Math.min(3, Number(value.ignoredCount || 0)))
    });
  }

  function getDefaultSnapshot(locale = "zh-CN", contractVersion = CONTRACT_VERSIONS.V1) {
    return {
      contractVersion: normalizeContractVersion(contractVersion),
      state: STATES.IDLE,
      locale: normalizeLocale(locale),
      draft: "",
      prompt: "",
      mode: "auto",
      reason: REASONS.NONE,
      targetCapability: normalizeTargetCapability(),
      verification: VERIFICATIONS.NONE,
      manualConfirmationRequired: false,
      noAutoSubmit: true,
      canUndo: false,
      collapseRequested: false,
      clarification: sanitizeClarification(),
      outcome: null,
      candidateReminder: null
    };
  }

  function sanitizeSnapshot(input = {}, previous = getDefaultSnapshot(input.locale, input.contractVersion)) {
    const targetCapability = normalizeTargetCapability(
      Object.prototype.hasOwnProperty.call(input, "targetCapability")
        ? input.targetCapability
        : previous.targetCapability
    );
    const verification = VERIFICATION_VALUES.has(input.verification)
      ? input.verification
      : previous.verification;
    let state = STATE_VALUES.has(input.state) ? input.state : previous.state;
    let reason = mapReason(
      Object.prototype.hasOwnProperty.call(input, "reason") ? input.reason : previous.reason,
      REASONS.UNKNOWN
    );
    const noAutoSubmit = Object.prototype.hasOwnProperty.call(input, "noAutoSubmit")
      ? input.noAutoSubmit !== false
      : previous.noAutoSubmit !== false;
    if (!noAutoSubmit) {
      state = STATES.BLOCKED;
      reason = REASONS.SAFETY_CONTRACT_VIOLATED;
    }
    return {
      contractVersion: normalizeContractVersion(input.contractVersion || previous.contractVersion),
      state,
      locale: normalizeLocale(input.locale || previous.locale),
      draft: String(Object.prototype.hasOwnProperty.call(input, "draft") ? input.draft || "" : previous.draft || ""),
      prompt: String(Object.prototype.hasOwnProperty.call(input, "prompt") ? input.prompt || "" : previous.prompt || ""),
      mode: String(Object.prototype.hasOwnProperty.call(input, "mode") ? input.mode || "auto" : previous.mode || "auto"),
      reason,
      targetCapability,
      verification,
      manualConfirmationRequired: Object.prototype.hasOwnProperty.call(input, "manualConfirmationRequired")
        ? Boolean(input.manualConfirmationRequired)
        : Boolean(previous.manualConfirmationRequired),
      noAutoSubmit,
      canUndo: Object.prototype.hasOwnProperty.call(input, "canUndo")
        ? Boolean(input.canUndo)
        : Boolean(previous.canUndo),
      collapseRequested: Object.prototype.hasOwnProperty.call(input, "collapseRequested")
        ? Boolean(input.collapseRequested)
        : Boolean(previous.collapseRequested),
      clarification: Object.prototype.hasOwnProperty.call(input, "clarification")
        ? sanitizeClarification(input.clarification)
        : previous.clarification,
      outcome: Object.prototype.hasOwnProperty.call(input, "outcome")
        ? sanitizeOutcome(input.outcome)
        : previous.outcome,
      candidateReminder: Object.prototype.hasOwnProperty.call(input, "candidateReminder")
        ? sanitizeCandidateReminder(input.candidateReminder)
        : previous.candidateReminder
    };
  }

  function actionFromTuple(tuple, enabled = true) {
    return Object.freeze({ id: tuple[0], label: tuple[1], enabled: Boolean(enabled) });
  }

  function createViewModel(input = {}) {
    const snapshot = sanitizeSnapshot(input, getDefaultSnapshot(input.locale, input.contractVersion));
    const locale = snapshot.locale;
    const stateCopy = STATE_COPY[locale][snapshot.state] || STATE_COPY[locale][STATES.IDLE];
    const reasonCopy = REASON_COPY[locale][snapshot.reason] || REASON_COPY[locale][REASONS.UNKNOWN];
    const busy = snapshot.state === STATES.DRAFTING || snapshot.state === STATES.INSERTING;
    const manualConfirmationRequired = snapshot.state === STATES.INSERTED
      && (
        snapshot.manualConfirmationRequired
        || snapshot.verification === VERIFICATIONS.MANUAL_REQUIRED
      );
    let description = stateCopy.description;
    if (snapshot.state === STATES.INSERTED && manualConfirmationRequired) {
      description = locale === "zh-CN"
        ? "已尝试填入，请确认目标输入框中是否可见；不会自动发送。"
        : "Insertion was attempted. Confirm that the text is visible; nothing was sent.";
    } else if (
      snapshot.reason !== REASONS.NONE
      && [STATES.TARGET_MISSING, STATES.COPY_ONLY, STATES.BLOCKED, STATES.ERROR].includes(snapshot.state)
    ) {
      description = reasonCopy[1] || stateCopy.description;
    }
    const canUsePrimary = !busy || stateCopy.primary[0] === "cancel";
    const secondaryActions = stateCopy.secondary
      .filter(([id]) => id !== "undo" || snapshot.canUndo)
      .map((tuple) => actionFromTuple(tuple, !busy));
    return Object.freeze({
      contractVersion: snapshot.contractVersion,
      state: snapshot.state,
      locale,
      title: stateCopy.title,
      description,
      primaryAction: actionFromTuple(stateCopy.primary, canUsePrimary),
      secondaryActions: Object.freeze(secondaryActions),
      busy,
      draft: snapshot.draft,
      prompt: snapshot.prompt,
      mode: snapshot.mode,
      reason: Object.freeze({
        code: snapshot.reason,
        label: reasonCopy[0],
        message: reasonCopy[1]
      }),
      target: snapshot.targetCapability,
      verification: snapshot.verification,
      manualConfirmationRequired,
      noAutoSubmit: snapshot.noAutoSubmit,
      canUndo: snapshot.canUndo,
      collapseRequested: snapshot.collapseRequested,
      clarification: snapshot.clarification,
      outcome: snapshot.outcome,
      candidateReminder: snapshot.candidateReminder
    });
  }

  function resultPrompt(result) {
    return String(result?.prompt ?? result?.card?.prompt ?? result?.promptCard?.prompt ?? "");
  }

  function resultMode(result, fallback) {
    return String(result?.mode ?? result?.card?.mode ?? result?.promptCard?.mode ?? fallback ?? "auto");
  }

  function resultClarification(result) {
    if (result?.requiresClarification !== true) return null;
    const question = String(result.clarificationQuestion || result.question || "").trim().slice(0, 240);
    return question ? { required: true, question } : null;
  }

  function failureState(reason) {
    if (reason === REASONS.TARGET_MISSING || reason === REASONS.TARGET_NOT_FOCUSED) {
      return STATES.TARGET_MISSING;
    }
    if (reason === REASONS.TARGET_UNSUPPORTED || reason === REASONS.READBACK_UNAVAILABLE) {
      return STATES.COPY_ONLY;
    }
    if (
      reason === REASONS.TARGET_UNSAFE
      || reason === REASONS.TARGET_HIDDEN
      || reason === REASONS.SAFETY_CONTRACT_VIOLATED
    ) {
      return STATES.BLOCKED;
    }
    return STATES.ERROR;
  }

  function createPromptSession(options = {}) {
    const settings = options.settings || {};
    const contractVersion = normalizeContractVersion(settings.contractVersion);
    const generator = options.generator || null;
    const target = options.target || null;
    const evidence = options.evidence || null;
    const subscribers = new Set();
    let snapshot = getDefaultSnapshot(settings.locale || "zh-CN", contractVersion);
    let operationId = 0;
    let failedCommand = "";

    function view() {
      return createViewModel(snapshot);
    }

    function emit() {
      const viewModel = view();
      for (const subscriber of subscribers) subscriber(viewModel);
      return viewModel;
    }

    function commit(patch) {
      snapshot = sanitizeSnapshot(patch, snapshot);
      return emit();
    }

    function record(type, viewModel) {
      if (!evidence || typeof evidence.record !== "function") return;
      Promise.resolve(evidence.record({
        type,
        state: viewModel.state,
        reason: viewModel.reason.code,
        verification: viewModel.verification,
        noAutoSubmit: viewModel.noAutoSubmit
      })).catch(() => {
        // Evidence is observational and must never change the product transition.
      });
    }

    function open(payload = {}) {
      operationId += 1;
      failedCommand = "";
      const prompt = String(payload.prompt || "");
      snapshot = sanitizeSnapshot({
        ...getDefaultSnapshot(
          payload.locale || settings.locale || snapshot.locale,
          payload.contractVersion || contractVersion
        ),
        state: prompt ? STATES.REVIEW : STATES.IDLE,
        draft: payload.draft || "",
        prompt,
        mode: payload.mode || "auto",
        targetCapability: payload.targetCapability,
        noAutoSubmit: payload.noAutoSubmit !== false
      });
      return emit();
    }

    function generationStarted() {
      failedCommand = "";
      return commit({
        state: STATES.DRAFTING,
        reason: REASONS.NONE,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: false,
        canUndo: false,
        collapseRequested: false,
        clarification: null
      });
    }

    function generationSucceeded(command = {}) {
      const clarification = resultClarification(command.result || command);
      if (clarification && snapshot.contractVersion === CONTRACT_VERSIONS.V2) {
        failedCommand = COMMANDS.GENERATE;
        const viewModel = commit({
          state: STATES.CLARIFICATION,
          reason: REASONS.CLARIFICATION_REQUIRED,
          clarification,
          verification: VERIFICATIONS.NONE,
          manualConfirmationRequired: false,
          canUndo: false,
          collapseRequested: false,
          noAutoSubmit: true
        });
        record("clarification-required", viewModel);
        return viewModel;
      }
      const prompt = resultPrompt(command.result || command) || snapshot.prompt;
      failedCommand = "";
      const viewModel = commit({
        state: STATES.REVIEW,
        prompt,
        mode: resultMode(command.result || command, snapshot.mode),
        reason: REASONS.NONE,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: false,
        canUndo: false,
        collapseRequested: false,
        clarification: null,
        noAutoSubmit: true
      });
      record("generation-succeeded", viewModel);
      return viewModel;
    }

    function generationFailed(command = {}) {
      failedCommand = COMMANDS.GENERATE;
      const reason = mapReason(command.error || command.reason, REASONS.GENERATION_FAILED);
      const viewModel = commit({
        state: STATES.ERROR,
        reason: reason === REASONS.UNKNOWN ? REASONS.GENERATION_FAILED : reason,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: false,
        canUndo: false
      });
      record("generation-failed", viewModel);
      return viewModel;
    }

    async function generate() {
      const currentOperation = operationId + 1;
      operationId = currentOperation;
      generationStarted();
      if (!generator || typeof generator.generate !== "function") {
        return generationFailed({ reason: REASONS.GENERATION_FAILED });
      }
      try {
        const result = await generator.generate({
          draft: snapshot.draft,
          prompt: snapshot.prompt,
          mode: snapshot.mode
        });
        if (currentOperation !== operationId) return view();
        if (!resultPrompt(result) && !resultClarification(result)) {
          return generationFailed({ reason: REASONS.GENERATION_FAILED });
        }
        return generationSucceeded({ result });
      } catch (error) {
        if (currentOperation !== operationId) return view();
        return generationFailed({ error });
      }
    }

    function insertStarted() {
      failedCommand = "";
      return commit({
        state: STATES.INSERTING,
        reason: REASONS.NONE,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: false
      });
    }

    function insertSucceeded(command = {}) {
      const result = command.result || command;
      const noAutoSubmit = result.noAutoSubmit !== false;
      const verification = VERIFICATION_VALUES.has(result.verification)
        ? result.verification
        : result.verified === true ? VERIFICATIONS.MACHINE : VERIFICATIONS.NONE;
      const reason = mapReason(result.reason, REASONS.NONE);
      const manualConfirmationRequired = result.verified !== true
        && result.attempted === true
        && (
          verification === VERIFICATIONS.MANUAL_REQUIRED
          || snapshot.targetCapability.manualConfirmationRequired
          || reason === REASONS.READBACK_UNAVAILABLE
        );
      if (!noAutoSubmit) {
        return insertFailed({ reason: REASONS.SAFETY_CONTRACT_VIOLATED, noAutoSubmit: false });
      }
      if (snapshot.contractVersion === CONTRACT_VERSIONS.V2 && result.verified !== true) {
        return insertFailed({
          reason: result.attempted === true
            ? REASONS.READBACK_UNAVAILABLE
            : reason === REASONS.NONE ? REASONS.INSERT_FAILED : reason,
          noAutoSubmit: true
        });
      }
      if (result.verified !== true && !manualConfirmationRequired) {
        return insertFailed({ reason: reason === REASONS.NONE ? REASONS.INSERT_FAILED : reason });
      }
      failedCommand = "";
      const viewModel = commit({
        state: STATES.INSERTED,
        reason: manualConfirmationRequired ? REASONS.READBACK_UNAVAILABLE : REASONS.NONE,
        verification: manualConfirmationRequired
          ? VERIFICATIONS.MANUAL_REQUIRED
          : result.verified === true ? VERIFICATIONS.MACHINE : verification,
        manualConfirmationRequired,
        noAutoSubmit: true,
        canUndo: true,
        collapseRequested: snapshot.contractVersion === CONTRACT_VERSIONS.V2
      });
      record("insert-succeeded", viewModel);
      return viewModel;
    }

    function insertFailed(command = {}) {
      failedCommand = COMMANDS.INSERT;
      const reason = mapReason(command.error || command.reason, REASONS.INSERT_FAILED);
      const normalizedReason = reason === REASONS.NONE || reason === REASONS.UNKNOWN
        ? REASONS.INSERT_FAILED
        : reason;
      const viewModel = commit({
        state: failureState(normalizedReason),
        reason: normalizedReason,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: false,
        noAutoSubmit: command.noAutoSubmit !== false,
        canUndo: false,
        collapseRequested: false
      });
      record("insert-failed", viewModel);
      return viewModel;
    }

    function targetUpdated(command = {}) {
      const capability = normalizeTargetCapability(command.targetCapability || command.capability || command.result);
      let state = snapshot.prompt ? STATES.REVIEW : STATES.IDLE;
      if (capability.status === TARGET_STATUSES.MISSING) state = STATES.TARGET_MISSING;
      else if (capability.status === TARGET_STATUSES.BLOCKED) state = STATES.BLOCKED;
      else if (
        capability.level === TARGET_CAPABILITIES.COPY_ONLY
        || capability.level === TARGET_CAPABILITIES.UNSUPPORTED
      ) state = STATES.COPY_ONLY;
      return commit({
        state,
        targetCapability: capability,
        reason: capability.reason,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: snapshot.contractVersion === CONTRACT_VERSIONS.V2
          ? false
          : capability.manualConfirmationRequired,
        canUndo: snapshot.canUndo && command.undoStillValid === true,
        collapseRequested: false
      });
    }

    async function insert() {
      if (!snapshot.prompt) return insertFailed({ reason: REASONS.INSERT_FAILED });
      const currentOperation = operationId + 1;
      operationId = currentOperation;
      insertStarted();
      try {
        const inspected = target && typeof target.inspect === "function"
          ? await target.inspect()
          : snapshot.targetCapability;
        if (currentOperation !== operationId) return view();
        const capability = normalizeTargetCapability(inspected);
        snapshot = sanitizeSnapshot({ targetCapability: capability }, snapshot);
        if (capability.status === TARGET_STATUSES.MISSING) {
          return insertFailed({ reason: capability.reason || REASONS.TARGET_MISSING });
        }
        if (capability.status === TARGET_STATUSES.BLOCKED) {
          return insertFailed({ reason: capability.reason || REASONS.TARGET_UNSAFE });
        }
        if (
          snapshot.contractVersion === CONTRACT_VERSIONS.V2
          && capability.level !== TARGET_CAPABILITIES.VERIFIED_WRITE
        ) {
          return insertFailed({
            reason: capability.reason === REASONS.NONE
              ? REASONS.READBACK_UNAVAILABLE
              : capability.reason
          });
        }
        if (!capability.canInsert || !target || typeof target.insert !== "function") {
          return insertFailed({ reason: capability.reason || REASONS.TARGET_UNSUPPORTED });
        }
        const result = await target.insert(snapshot.prompt);
        if (currentOperation !== operationId) return view();
        return insertSucceeded({ result });
      } catch (error) {
        if (currentOperation !== operationId) return view();
        return insertFailed({ error });
      }
    }

    function undoSucceeded(command = {}) {
      const result = command.result || command;
      if (result.noAutoSubmit === false) {
        return undoFailed({ reason: REASONS.SAFETY_CONTRACT_VIOLATED, noAutoSubmit: false });
      }
      failedCommand = "";
      const viewModel = commit({
        state: STATES.REVIEW,
        reason: REASONS.NONE,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: false,
        noAutoSubmit: true,
        canUndo: false,
        collapseRequested: false
      });
      record("undo-succeeded", viewModel);
      return viewModel;
    }

    function undoFailed(command = {}) {
      failedCommand = COMMANDS.UNDO;
      const reason = mapReason(command.error || command.reason, REASONS.UNDO_FAILED);
      const viewModel = commit({
        state: STATES.ERROR,
        reason: reason === REASONS.UNKNOWN ? REASONS.UNDO_FAILED : reason,
        verification: VERIFICATIONS.NONE,
        manualConfirmationRequired: false,
        noAutoSubmit: command.noAutoSubmit !== false,
        canUndo: false,
        collapseRequested: false
      });
      record("undo-failed", viewModel);
      return viewModel;
    }

    async function undo() {
      if (!snapshot.canUndo || !target || typeof target.undo !== "function") {
        return undoFailed({ reason: REASONS.UNDO_FAILED });
      }
      const currentOperation = operationId + 1;
      operationId = currentOperation;
      try {
        const result = await target.undo();
        if (currentOperation !== operationId) return view();
        if (result?.verified !== true && result?.ok !== true) return undoFailed({ result, reason: result?.reason });
        return undoSucceeded({ result });
      } catch (error) {
        if (currentOperation !== operationId) return view();
        return undoFailed({ error });
      }
    }

    function sync(command = {}) {
      operationId += 1;
      const next = command.snapshot || command.view || {};
      snapshot = sanitizeSnapshot(next, snapshot);
      failedCommand = snapshot.state === STATES.ERROR ? failedCommand : "";
      return emit();
    }

    function outcomeAvailable(command = {}) {
      return commit({ outcome: command.outcome || command.result || null });
    }

    function candidateReminder(command = {}) {
      return commit({ candidateReminder: command.candidate || command.result || null });
    }

    function dispatch(command = {}) {
      const type = String(command.type || "").toUpperCase();
      switch (type) {
        case COMMANDS.OPEN: return open(command);
        case COMMANDS.SET_DRAFT: return commit({ draft: command.draft ?? command.value ?? "" });
        case COMMANDS.GENERATE:
        case COMMANDS.REGENERATE: return generate();
        case COMMANDS.GENERATION_STARTED:
          operationId += 1;
          return generationStarted();
        case COMMANDS.GENERATION_SUCCEEDED: return generationSucceeded(command);
        case COMMANDS.GENERATION_FAILED: return generationFailed(command);
        case COMMANDS.CLARIFICATION_REQUIRED:
          return generationSucceeded({
            requiresClarification: true,
            clarificationQuestion: command.question || command.clarificationQuestion
          });
        case COMMANDS.INSERT: return insert();
        case COMMANDS.INSERT_STARTED:
          operationId += 1;
          return insertStarted();
        case COMMANDS.INSERT_SUCCEEDED: return insertSucceeded(command);
        case COMMANDS.INSERT_FAILED: return insertFailed(command);
        case COMMANDS.TARGET_UPDATED: return targetUpdated(command);
        case COMMANDS.INVALIDATE_UNDO:
          return commit({ canUndo: false, collapseRequested: false });
        case COMMANDS.COLLAPSE_ACK:
          return commit({ collapseRequested: false });
        case COMMANDS.OUTCOME_AVAILABLE: return outcomeAvailable(command);
        case COMMANDS.OUTCOME_RESOLVED: return commit({ outcome: null });
        case COMMANDS.CANDIDATE_REMINDER: return candidateReminder(command);
        case COMMANDS.CANDIDATE_REMINDER_CLEARED: return commit({ candidateReminder: null });
        case COMMANDS.COPY:
          record("copy", view());
          return view();
        case COMMANDS.UNDO: return undo();
        case COMMANDS.UNDO_SUCCEEDED: return undoSucceeded(command);
        case COMMANDS.UNDO_FAILED: return undoFailed(command);
        case COMMANDS.RETRY:
          return failedCommand === COMMANDS.INSERT && snapshot.prompt ? insert() : generate();
        case COMMANDS.CANCEL:
          operationId += 1;
          return commit({
            state: snapshot.prompt ? STATES.REVIEW : STATES.IDLE,
            reason: REASONS.NONE,
            verification: VERIFICATIONS.NONE,
            manualConfirmationRequired: false,
            collapseRequested: false
          });
        case COMMANDS.RESET: return open({ locale: snapshot.locale, contractVersion: snapshot.contractVersion });
        case COMMANDS.SYNC: return sync(command);
        default: throw new Error(`Unsupported Prompt Session command: ${type || "<empty>"}`);
      }
    }

    function subscribe(subscriber) {
      if (typeof subscriber !== "function") throw new TypeError("Prompt Session subscriber must be a function");
      subscribers.add(subscriber);
      subscriber(view());
      return () => subscribers.delete(subscriber);
    }

    return Object.freeze({
      open,
      dispatch,
      subscribe,
      getViewModel: view
    });
  }

  return Object.freeze({
    COMMANDS,
    CONTRACT_VERSIONS,
    REASONS,
    STATES,
    TARGET_CAPABILITIES,
    TARGET_STATUSES,
    VERIFICATIONS,
    createPromptSession,
    createViewModel,
    mapReason,
    normalizeContractVersion,
    normalizeLocale,
    normalizeTargetCapability
  });
});
