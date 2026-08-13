const promptSessionApi = globalThis.SmartPromptSession || null;
const assistantUi = globalThis.SmartPromptAssistantUI || null;

const STATE_IMAGES = {
  normal: "src/assets/mascot-states/normal.png",
  resting: "src/assets/mascot-states/resting.png",
  thinking: "src/assets/mascot-states/thinking.png",
  suggesting: "src/assets/mascot-states/suggesting.png",
  success: "src/assets/mascot-states/success.png",
  clapping: "src/assets/mascot-states/clapping.png"
};

const STATE_LABEL_KEYS = {
  normal: "badgeReady",
  resting: "badgeReady",
  thinking: "badgeThinking",
  suggesting: "badgeReady",
  success: "badgeFilled",
  clapping: "badgeDone"
};

const SUPPORTED_LOCALES = new Set(["zh-CN", "en"]);
const OVERLAY_MESSAGES = {
  "zh-CN": {
    localeZh: "中文",
    localeEn: "英文",
    inputLanguage: "输入语言",
    promptMode: "提示模式",
    actions: "Smart Prompt 操作",
    quickReplies: "快捷建议",
    quickDraft: "快速草稿",
    sendDraft: "发送草稿",
    promptPreview: "提示预览",
    promptReviewActions: "提示审核操作",
    quickDraftPlaceholder: "写下要处理的内容",
    previewPlaceholder: "可编辑后再填入",
    badgeReady: "就绪",
    badgeThinking: "思考",
    badgeFilled: "已填",
    badgeDone: "完成",
    badgeDraft: "草稿",
    badgeGuard: "守卫",
    messageDraftingNote: "草稿中",
    messageGuarded: "已守卫",
    messageCheckTarget: "检查目标",
    messageChecking: "检查中",
    messageFilledSafely: "已安全填入",
    messageDone: "完成",
    messageReadyToMake: "可生成",
    messageClickToFill: "点击填入",
    messageAddPrompt: "添加提示",
    messageDraftReady: "草稿就绪",
    messageReadyNearby: "附近就绪",
    messageWatchingInput: "观察输入",
    messageWaitingForPrompt: "等待提示",
    hintReadyToSend: "可发送",
    hintNoWriteCheckTarget: "不写入，先检查",
    hintFocusInputThenScan: "聚焦输入框后扫描",
    hintNeedSaferTargetFirst: "需要更安全目标",
    hintSwitchToSupportedTool: "切到支持工具",
    hintWaitForSnapshot: "等待快照",
    hintRescanTarget: "重新扫描目标",
    hintRetryingPrompt: "重新生成",
    hintMakingPrompt: "生成提示",
    hintCheckingTarget: "检查目标",
    hintNoAutoSubmit: "不自动提交",
    hintMakeThenFill: "生成后填入",
    hintReadyFillOrEdit: "可填入或编辑",
    hintDraftThenMake: "草稿后生成",
    modeIdea: "想法",
    modeContinue: "续写",
    modePolish: "润色",
    modeIdeaShort: "想法",
    modeContinueShort: "续写",
    modePolishShort: "润色",
    turnYouBrief: "你：{label}",
    turnYouNoteReady: "你：草稿就绪",
    turnSmartPressSend: "Smart：点发送",
    turnYouPaused: "你：已暂停",
    turnSmartCheckTarget: "Smart：检查目标",
    turnYouPromptReady: "你：提示就绪",
    turnSmartNeedTarget: "Smart：需要目标",
    turnYouRetry: "你：重试",
    turnSmartRetryingPrompt: "Smart：重新生成",
    turnYouMake: "你：生成",
    turnSmartMakingPrompt: "Smart：生成中",
    turnYouFill: "你：填入",
    turnSmartCheckingTarget: "Smart：检查目标",
    turnYouDraft: "你：草稿",
    turnSmartOpeningDraft: "Smart：打开草稿",
    turnYouScan: "你：扫描",
    turnSmartScanningTarget: "Smart：扫描目标",
    turnYouReview: "你：审核",
    turnYouActionSent: "你：已发送",
    turnSmartChecking: "Smart：检查中",
    turnYouFilled: "你：已填入",
    turnSmartNoSubmit: "Smart：未提交",
    turnYouDraftSent: "你：草稿已发",
    turnSmartMakeNext: "Smart：下一步生成",
    turnYouMode: "你：{mode}",
    turnSmartRepliesTuned: "Smart：建议已调整",
    turnYouDraftReady: "你：草稿就绪",
    turnSmartFillSafe: "Smart：安全填入",
    turnYouAskHere: "你：在这写",
    turnSmartDraftFirst: "Smart：先写草稿",
    primarySend: "发送",
    primaryReview: "审核",
    primaryChecking: "检查",
    primaryDone: "完成",
    primaryMake: "生成",
    primaryScan: "扫描",
    primaryFill: "填入",
    primaryDraft: "草稿",
    actionGood: "好",
    actionFix: "修改",
    actionScan: "扫描",
    actionDraft: "草稿",
    actionMake: "生成",
    actionRetry: "重试",
    previewCopy: "复制",
    previewEdit: "编辑",
    previewReview: "审核",
    previewUndo: "撤销",
    previewClear: "清空",
    replyBrief: "简要",
    replyAngle: "角度",
    replySteps: "步骤",
    replyNext: "下一步",
    replyMatch: "匹配",
    replyClose: "收尾",
    replyShort: "精简",
    replyTone: "语气",
    replyClear: "清晰",
    replyMissing: "补缺",
    replyTarget: "目标",
    replyDraft: "草稿",
    replySafer: "更稳",
    draftSuccessShort: "把已填入的提示改得更短、更直接",
    draftSuccessTone: "调整语气，让它更适合目标输入框",
    draftSuccessMissing: "补上缺失背景和具体约束",
    draftGuardTarget: "重新检查目标输入框后再填入",
    draftGuardDraft: "先审核草稿再重试",
    draftGuardSafer: "让这个提示更稳，并保持不自动提交",
    draftContinueNext: "基于现有上下文继续写下一步",
    draftContinueMatch: "匹配当前语气和结构",
    draftContinueClose: "用明确下一步收尾",
    draftPolishShort: "把内容改得更短、更直接",
    draftPolishTone: "调整语气，让它更适合目标",
    draftPolishClear: "让内容更清楚、更容易执行",
    draftIdeaBrief: "整理成一段简洁的提示词 brief",
    draftIdeaAngle: "给它更明确的角度和约束",
    draftIdeaSteps: "拆成具体下一步"
  },
  en: {
    localeZh: "中文",
    localeEn: "EN",
    inputLanguage: "Input language",
    promptMode: "Prompt mode",
    actions: "Smart Prompt actions",
    quickReplies: "Quick replies",
    quickDraft: "Quick draft",
    sendDraft: "Send draft",
    promptPreview: "Prompt preview",
    promptReviewActions: "Prompt review actions",
    quickDraftPlaceholder: "Ask Smart Prompt",
    previewPlaceholder: "Edit before filling",
    badgeReady: "ready",
    badgeThinking: "thinking",
    badgeFilled: "filled",
    badgeDone: "done",
    badgeDraft: "draft",
    badgeGuard: "guard",
    messageDraftingNote: "Drafting note",
    messageGuarded: "Guarded",
    messageCheckTarget: "Check target",
    messageChecking: "Checking",
    messageFilledSafely: "Filled safely",
    messageDone: "Done",
    messageReadyToMake: "Ready to make",
    messageClickToFill: "Click to fill",
    messageAddPrompt: "Add prompt",
    messageDraftReady: "Draft ready",
    messageReadyNearby: "Ready nearby",
    messageWatchingInput: "Watching input",
    messageWaitingForPrompt: "Waiting for prompt",
    hintReadyToSend: "Ready to send",
    hintNoWriteCheckTarget: "No write. Check target",
    hintFocusInputThenScan: "Focus input, then Scan",
    hintNeedSaferTargetFirst: "Need safer target first",
    hintSwitchToSupportedTool: "Switch to supported tool",
    hintWaitForSnapshot: "Wait for snapshot",
    hintRescanTarget: "Re-scan target",
    hintRetryingPrompt: "Retrying prompt",
    hintMakingPrompt: "Making prompt",
    hintCheckingTarget: "Checking target",
    hintNoAutoSubmit: "No auto-submit",
    hintMakeThenFill: "Make then Fill",
    hintReadyFillOrEdit: "Ready: Fill or edit",
    hintDraftThenMake: "Draft then Make",
    modeIdea: "Idea",
    modeContinue: "Continue",
    modePolish: "Polish",
    modeIdeaShort: "Idea",
    modeContinueShort: "Cont",
    modePolishShort: "Polish",
    turnYouBrief: "You: {label}",
    turnYouNoteReady: "You: note ready",
    turnSmartPressSend: "Smart: press Send",
    turnYouPaused: "You: paused",
    turnSmartCheckTarget: "Smart: check target",
    turnYouPromptReady: "You: prompt ready",
    turnSmartNeedTarget: "Smart: need target",
    turnYouRetry: "You: Retry",
    turnSmartRetryingPrompt: "Smart: retrying prompt",
    turnYouMake: "You: Make",
    turnSmartMakingPrompt: "Smart: making prompt",
    turnYouFill: "You: Fill",
    turnSmartCheckingTarget: "Smart: checking target",
    turnYouDraft: "You: Draft",
    turnSmartOpeningDraft: "Smart: opening draft",
    turnYouScan: "You: Scan",
    turnSmartScanningTarget: "Smart: scanning target",
    turnYouReview: "You: Review",
    turnYouActionSent: "You: action sent",
    turnSmartChecking: "Smart: checking",
    turnYouFilled: "You: filled",
    turnSmartNoSubmit: "Smart: no submit",
    turnYouDraftSent: "You: draft sent",
    turnSmartMakeNext: "Smart: make next",
    turnYouMode: "You: {mode}",
    turnSmartRepliesTuned: "Smart: replies tuned",
    turnYouDraftReady: "You: draft ready",
    turnSmartFillSafe: "Smart: fill safe",
    turnYouAskHere: "You: ask here",
    turnSmartDraftFirst: "Smart: draft first",
    primarySend: "Send",
    primaryReview: "Review",
    primaryChecking: "Checking",
    primaryDone: "Done",
    primaryMake: "Make",
    primaryScan: "Scan",
    primaryFill: "Fill",
    primaryDraft: "Draft",
    actionGood: "Good",
    actionFix: "Fix",
    actionScan: "Scan",
    actionDraft: "Draft",
    actionMake: "Make",
    actionRetry: "Retry",
    previewCopy: "Copy",
    previewEdit: "Edit",
    previewReview: "Review",
    previewUndo: "Undo",
    previewClear: "Clear",
    replyBrief: "Brief",
    replyAngle: "Angle",
    replySteps: "Steps",
    replyNext: "Next",
    replyMatch: "Match",
    replyClose: "Close",
    replyShort: "Short",
    replyTone: "Tone",
    replyClear: "Clear",
    replyMissing: "Missing",
    replyTarget: "Target",
    replyDraft: "Draft",
    replySafer: "Safer",
    draftSuccessShort: "Make the filled prompt shorter and more direct",
    draftSuccessTone: "Adjust the tone so it fits the target better",
    draftSuccessMissing: "Add missing context and concrete constraints",
    draftGuardTarget: "Recheck the target input before filling",
    draftGuardDraft: "Review the draft before trying again",
    draftGuardSafer: "Make this safer and keep no auto-submit",
    draftContinueNext: "Continue from the existing context with the next useful step",
    draftContinueMatch: "Match the current voice and structure",
    draftContinueClose: "Close with a clear next action",
    draftPolishShort: "Make this shorter and more direct",
    draftPolishTone: "Adjust the tone so it fits the target better",
    draftPolishClear: "Make this clearer and easier to act on",
    draftIdeaBrief: "Turn this into a concise prompt brief",
    draftIdeaAngle: "Give this a sharper angle and concrete constraints",
    draftIdeaSteps: "Turn this into concrete next steps"
  }
};

const image = document.getElementById("mascot-overlay-image");
const badge = document.getElementById("mascot-overlay-badge");
const message = document.getElementById("mascot-overlay-message");
const meta = document.getElementById("mascot-overlay-meta");
const hint = document.getElementById("mascot-overlay-hint");
const button = document.getElementById("mascot-overlay-button");
const card = document.getElementById("mascot-overlay-card");
const closeButton = document.getElementById("mascot-overlay-close");
const primary = document.getElementById("mascot-overlay-primary");
const draftButton = document.getElementById("mascot-overlay-draft");
const generateButton = document.getElementById("mascot-overlay-generate");
const refreshButton = document.getElementById("mascot-overlay-refresh");
const moodStrip = document.getElementById("mascot-overlay-mood-strip");
const quickDraftForm = document.getElementById("mascot-overlay-draft-form");
const quickDraftInput = document.getElementById("mascot-overlay-draft-input");
const quickDraftSend = document.getElementById("mascot-overlay-draft-send");
const previewPanel = document.getElementById("mascot-overlay-preview-panel");
const previewInput = document.getElementById("mascot-overlay-preview-input");
const previewCopyButton = document.getElementById("mascot-overlay-preview-copy");
const previewReviewButton = document.getElementById("mascot-overlay-preview-review");
const previewUndoButton = document.getElementById("mascot-overlay-preview-undo");
const previewClearButton = document.getElementById("mascot-overlay-preview-clear");
const quickRepliesPanel = document.querySelector(".mascot-overlay-replies");
const quickReplyButtons = Array.from(document.querySelectorAll(".mascot-overlay-reply"));
const modeButtons = Array.from(document.querySelectorAll(".mascot-overlay-mode"));
const localeButtons = Array.from(document.querySelectorAll(".mascot-overlay-locale"));
const evidenceStateChip = document.getElementById("mascot-overlay-tool-chip");
const evidenceActionChip = document.getElementById("mascot-overlay-prompt-chip");
const evidencePolicyChip = document.getElementById("mascot-overlay-submit-chip");
const userTurn = document.getElementById("mascot-overlay-user-turn");
const assistantTurn = document.getElementById("mascot-overlay-assistant-turn");
const assistantHost = document.getElementById("smart-prompt-assistant-host");

function normalizeLocale(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("zh")) return "zh-CN";
  if (text.startsWith("en")) return "en";
  return "zh-CN";
}

function getInitialOverlayLocale() {
  try {
    const stored = window.localStorage?.getItem("smartPromptDesktopLocale") || "";
    if (SUPPORTED_LOCALES.has(stored)) return stored;
  } catch {
    // Keep the overlay usable when localStorage is unavailable.
  }
  return "zh-CN";
}

function tr(key, values = {}) {
  const template = OVERLAY_MESSAGES[currentLocale]?.[key] || OVERLAY_MESSAGES.en[key] || key;
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    return values[name] === undefined || values[name] === null ? "" : String(values[name]);
  });
}

function setOverlayLocale(locale, options = {}) {
  currentLocale = normalizeLocale(locale);
  currentPayload.locale = currentLocale;
  document.documentElement.lang = currentLocale;
  document.documentElement.dataset.locale = currentLocale;
  document.documentElement.dataset.inputLocale = currentLocale;
  for (const input of [quickDraftInput, previewInput]) {
    if (!input) continue;
    input.lang = currentLocale;
    input.dir = "auto";
  }
  for (const localeButton of localeButtons) {
    const selected = normalizeLocale(localeButton.dataset.locale) === currentLocale;
    localeButton.setAttribute("aria-pressed", String(selected));
    localeButton.textContent = localeButton.dataset.locale === "zh-CN" ? tr("localeZh") : tr("localeEn");
  }
  if (options.persist) {
    try {
      window.localStorage?.setItem("smartPromptDesktopLocale", currentLocale);
    } catch {
      // Ignore storage failures; payload still carries the locale.
    }
  }
}

let currentLocale = getInitialOverlayLocale();
let currentPayload = {
  x: 0,
  y: 0,
  profile: "unknown",
  state: "resting",
  titleHash: "",
  candidateIndex: -1,
  noAutoSubmit: true,
  promptReady: false,
  promptKind: "none",
  promptMode: "idea",
  locale: currentLocale,
  guardReason: "",
  visualOnly: false,
  browserLikeComposerCandidateCount: 0,
  visualAnchorIndex: -1,
  visualAnchorReason: "",
  overlayMode: "compact",
  overlayAction: ""
};
const productSession = promptSessionApi?.createPromptSession({
  settings: {
    locale: currentLocale,
    contractVersion: promptSessionApi?.CONTRACT_VERSIONS?.V2 || "prompt-session@2"
  }
}) || null;
let currentAssistantView = promptSessionApi?.createViewModel({
  contractVersion: promptSessionApi?.CONTRACT_VERSIONS?.V2 || "prompt-session@2",
  state: promptSessionApi.STATES.IDLE,
  locale: currentLocale,
  noAutoSubmit: true
}) || null;
let selectedQuickReply = "";
let focusQuickDraftOnNextRender = false;
let lastQuickDraftKeyboardAction = "";
let currentPromptSourceText = "";
let previewText = "";
let assistantEditorText = "";
let assistantEditorDirty = false;
let sharedAssistantCard = null;
let overlayTransitionTimeout = null;

function normalizePromptText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trimEnd();
}

function getPromptTextHash(value) {
  const text = normalizePromptText(value);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function getOverlayErrorMeta(error) {
  const message = String(error?.message || error || "");
  return {
    messageLength: message.length,
    messageHash: getPromptTextHash(message)
  };
}

function warnOverlayAsyncFailure(scope, error) {
  if (!window?.console || typeof window.console.warn !== "function") return;
  window.console.warn(`[smart-prompt-overlay] ${scope} failed`, getOverlayErrorMeta(error));
}

function shouldShowPromptPreview(payload) {
  const promptKind = cleanToken(payload?.promptKind, "none");
  return getOverlayMode(payload) === "expanded" && payload?.promptReady === true && promptKind !== "none";
}

function syncPromptPreviewFromPayload(payload) {
  const promptKind = cleanToken(payload?.promptKind, "none");
  const promptText = payload?.promptReady === true && promptKind !== "none"
    ? normalizePromptText(payload?.promptText || "")
    : "";
  if (promptText !== currentPromptSourceText) {
    currentPromptSourceText = promptText;
    previewText = promptText;
    assistantEditorText = promptText;
    assistantEditorDirty = false;
    if (previewInput) previewInput.value = promptText;
  }
}

function syncPromptPreviewState() {
  if (!previewInput) return;
  const normalized = normalizePromptText(previewInput.value);
  if (normalized !== previewText) previewText = normalized;
  currentPayload.promptText = previewText;
  currentPayload.promptTextLength = previewText.length;
  currentPayload.promptTextHash = getPromptTextHash(previewText);
  document.documentElement.dataset.promptTextLength = String(currentPromptSourceText.length);
  document.documentElement.dataset.promptTextHash = getPromptTextHash(currentPromptSourceText);
  document.documentElement.dataset.previewTextLength = String(previewText.length);
  document.documentElement.dataset.previewTextHash = getPromptTextHash(previewText);
  document.documentElement.dataset.previewDirty = String(previewText !== currentPromptSourceText);
  document.documentElement.dataset.previewFocused = String(document.activeElement === previewInput);
  if (previewCopyButton) previewCopyButton.disabled = !previewText.trim();
  if (previewUndoButton) previewUndoButton.disabled = previewText === currentPromptSourceText;
  if (previewClearButton) previewClearButton.disabled = !previewText;
}

function copyPromptPreview() {
  const text = normalizePromptText(previewText);
  try {
    if (window.navigator?.clipboard?.writeText) {
      window.navigator.clipboard.writeText(text).catch(() => {
        const fallback = document.createElement("textarea");
        fallback.value = text;
        fallback.setAttribute("readonly", "");
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.appendChild(fallback);
        fallback.select();
        document.execCommand("copy");
        document.body.removeChild(fallback);
      });
      return;
    }
  } catch {
    // fallback below
  }
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  fallback.select();
  document.execCommand("copy");
  document.body.removeChild(fallback);
}

function clearPromptPreview() {
  invalidateOverlayUndoOnGoalChange();
  previewText = "";
  if (previewInput) previewInput.value = "";
  syncPromptPreviewState();
  render(currentPayload);
}

function undoPromptPreview() {
  invalidateOverlayUndoOnGoalChange();
  previewText = currentPromptSourceText;
  if (previewInput) previewInput.value = previewText;
  syncPromptPreviewState();
  render(currentPayload);
}

function cleanToken(value, fallback = "tool") {
  return String(value || fallback).replace(/[^a-z0-9_-]/gi, "").slice(0, 18) || fallback;
}

function getOverlayTargetCapability(payload = {}) {
  if (!promptSessionApi) return null;
  const readinessReason = String(payload.overlayReadinessReason || payload.readinessReason || "");
  const rawReason = payload.guardReason || readinessReason || promptSessionApi.REASONS.NONE;
  if (payload.guardReason) {
    return {
      status: promptSessionApi.TARGET_STATUSES.BLOCKED,
      level: promptSessionApi.TARGET_CAPABILITIES.COPY_ONLY,
      reason: rawReason
    };
  }
  if (
    String(payload.profile || "").toLowerCase() === "codex"
    && payload.codexAdapterReady === true
    && payload.overlayReady === true
    && payload.visualOnly !== true
    && payload.exactRead === true
    && payload.fullReplace === true
  ) {
    return {
      status: promptSessionApi.TARGET_STATUSES.READY,
      level: promptSessionApi.TARGET_CAPABILITIES.VERIFIED_WRITE,
      reason: promptSessionApi.REASONS.NONE
    };
  }
  if (readinessReason === "unsupported-overlay-profile" || readinessReason === "unknown-profile") {
    return {
      status: promptSessionApi.TARGET_STATUSES.READY,
      level: promptSessionApi.TARGET_CAPABILITIES.UNSUPPORTED,
      reason: rawReason
    };
  }
  if (
    readinessReason === "foreground-window-hidden"
    || readinessReason === "snapshot-not-passing"
    || payload.noAutoSubmit === false
  ) {
    return {
      status: promptSessionApi.TARGET_STATUSES.BLOCKED,
      level: promptSessionApi.TARGET_CAPABILITIES.COPY_ONLY,
      reason: rawReason
    };
  }
  if (
    payload.visualOnly === true
    || ["missing-summary", "no-candidates", "no-safe-candidate", "no-best-candidate", "missing-title-hash"].includes(readinessReason)
  ) {
    return {
      status: promptSessionApi.TARGET_STATUSES.MISSING,
      level: promptSessionApi.TARGET_CAPABILITIES.COPY_ONLY,
      reason: payload.visualOnly ? promptSessionApi.REASONS.TARGET_NOT_FOCUSED : rawReason
    };
  }
  if (payload.overlayReady === true && Number(payload.candidateIndex ?? -1) >= 0) {
    return {
      status: promptSessionApi.TARGET_STATUSES.READY,
      level: String(payload.profile || "").toLowerCase() === "workbuddy"
        ? promptSessionApi.TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED
        : promptSessionApi.TARGET_CAPABILITIES.VERIFIED_WRITE,
      reason: String(payload.profile || "").toLowerCase() === "workbuddy"
        ? promptSessionApi.REASONS.READBACK_UNAVAILABLE
        : promptSessionApi.REASONS.NONE
    };
  }
  return {
    status: promptSessionApi.TARGET_STATUSES.UNKNOWN,
    level: promptSessionApi.TARGET_CAPABILITIES.COPY_ONLY,
    reason: rawReason || promptSessionApi.REASONS.TARGET_MISSING
  };
}

function getCanonicalOverlayState(payload, legacyState, targetCapability) {
  if (!promptSessionApi) return "";
  const promptReady = payload.promptReady === true;
  const promptKind = cleanToken(payload.promptKind, "none");
  const overlayAction = String(payload.overlayAction || "").toLowerCase();
  if (payload.noAutoSubmit === false || payload.guardReason || targetCapability?.status === promptSessionApi.TARGET_STATUSES.BLOCKED) {
    return promptSessionApi.STATES.BLOCKED;
  }
  if (legacyState === "thinking") {
    if (overlayAction === "generate") return promptSessionApi.STATES.DRAFTING;
    if (overlayAction === "fill") return promptSessionApi.STATES.INSERTING;
    return promptReady ? promptSessionApi.STATES.TARGET_MISSING : promptSessionApi.STATES.IDLE;
  }
  if (legacyState === "success" || legacyState === "clapping") return promptSessionApi.STATES.INSERTED;
  if (!promptReady || promptKind === "draft") return promptSessionApi.STATES.IDLE;
  if (targetCapability?.status === promptSessionApi.TARGET_STATUSES.MISSING) {
    return promptSessionApi.STATES.TARGET_MISSING;
  }
  if (
    targetCapability?.level === promptSessionApi.TARGET_CAPABILITIES.COPY_ONLY
    || targetCapability?.level === promptSessionApi.TARGET_CAPABILITIES.UNSUPPORTED
  ) {
    return promptSessionApi.STATES.COPY_ONLY;
  }
  return promptSessionApi.STATES.REVIEW;
}

function normalizeOverlayOutcome(value) {
  if (!value || typeof value !== "object") return null;
  const source = value.outcome && typeof value.outcome === "object" ? value.outcome : value;
  const id = String(source.outcomeId || source.id || source.generationId || "");
  if (!id) return null;
  return {
    id,
    status: String(source.status || "unknown"),
    question: String(value.question || source.question || "")
  };
}

function normalizeOverlayCandidate(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.artifactId || value.candidateId || value.id || "");
  if (!id) return null;
  return {
    id,
    type: String(value.artifactType || value.type || "rule"),
    message: String(value.message || value.reminderToken || ""),
    ignoredCount: Number(value.ignoredCount ?? value.review?.ignoredCount ?? 0) || 0
  };
}

function syncOverlayProductSession(payload, legacyState) {
  if (!productSession || !promptSessionApi) return null;
  const targetCapability = getOverlayTargetCapability(payload);
  let state = getCanonicalOverlayState(payload, legacyState, targetCapability);
  const machineVerified = payload.fillVerified === true
    || payload.verified === true
    || payload.verification === promptSessionApi.VERIFICATIONS.MACHINE;
  if (state === promptSessionApi.STATES.INSERTED && !machineVerified) {
    state = promptSessionApi.STATES.COPY_ONLY;
  }
  const inserted = state === promptSessionApi.STATES.INSERTED && machineVerified;
  const manualConfirmationRequired = inserted
    && targetCapability?.level === promptSessionApi.TARGET_CAPABILITIES.MANUAL_CONFIRMATION_REQUIRED;
  const reason = payload.guardReason
    || (state === promptSessionApi.STATES.TARGET_MISSING
      ? targetCapability?.reason || promptSessionApi.REASONS.TARGET_MISSING
      : state === promptSessionApi.STATES.COPY_ONLY || state === promptSessionApi.STATES.BLOCKED
        ? targetCapability?.reason || promptSessionApi.REASONS.TARGET_UNSAFE
        : manualConfirmationRequired ? promptSessionApi.REASONS.READBACK_UNAVAILABLE : promptSessionApi.REASONS.NONE);
  currentAssistantView = productSession.dispatch({
    type: promptSessionApi.COMMANDS.SYNC,
    snapshot: {
      state,
      locale: currentLocale,
      draft: getQuickDraftText(),
      prompt: previewText || payload.promptText || "",
      mode: getPromptMode(payload),
      reason,
      targetCapability,
      verification: inserted
        ? promptSessionApi.VERIFICATIONS.MACHINE
        : promptSessionApi.VERIFICATIONS.NONE,
      manualConfirmationRequired: false,
      noAutoSubmit: payload.noAutoSubmit !== false,
      canUndo: inserted && payload.canUndo === true,
      collapseRequested: inserted && payload.collapseRequested === true,
      outcome: normalizeOverlayOutcome(payload.pendingOutcome),
      candidateReminder: normalizeOverlayCandidate(payload.learningCandidate)
    }
  });
  return currentAssistantView;
}

function getOverlayCopy(payload, state, profile) {
  if (currentAssistantView) return currentAssistantView.title;
  const promptReady = payload.promptReady === true;
  const promptKind = cleanToken(payload.promptKind, "none");
  if (state !== "thinking" && hasQuickDraftText()) return tr("messageDraftingNote");
  if (payload.guardReason) return tr("messageGuarded");
  if (payload.visualOnly && promptReady && promptKind !== "draft") return tr("messageCheckTarget");
  if (state === "thinking") return tr("messageChecking");
  if (state === "success") return tr("messageFilledSafely");
  if (state === "clapping") return tr("messageDone");
  if (state === "suggesting" && promptReady && promptKind === "draft") return tr("messageReadyToMake");
  if (state === "suggesting" && promptReady) return tr("messageClickToFill");
  if (state === "suggesting") return tr("messageAddPrompt");
  if (promptReady && promptKind === "draft") return tr("messageDraftReady");
  if (promptReady) return tr("messageReadyNearby");
  return profile === "unknown" ? tr("messageWatchingInput") : tr("messageWaitingForPrompt");
}

function getOverlayMeta(payload, profile) {
  if (payload.guardReason) {
    return currentLocale === "zh-CN"
      ? `${getGuardReasonLabel(payload.guardReason)} ${getEvidencePolicyLabel("no-submit")}`
      : `${cleanToken(payload.guardReason, "guard")} no-submit`;
  }
  const parts = [getProfileLabel(profile)];
  const candidateIndex = Number(payload.candidateIndex);
  if (Number.isFinite(candidateIndex) && candidateIndex >= 0) {
    parts.push(currentLocale === "zh-CN" ? `输入#${candidateIndex}` : `#${candidateIndex}`);
  }
  if (payload.visualOnly) parts.push(currentLocale === "zh-CN" ? "仅定位" : "visual");
  if (payload.promptReady === true && payload.promptKind && payload.promptKind !== "none") {
    const promptKind = cleanToken(payload.promptKind, "prompt");
    parts.push(getPromptKindMetaLabel(promptKind));
  }
  const readinessSummary = getOverlayReadinessSummary(payload);
  if (readinessSummary) parts.push(readinessSummary);
  parts.push(getEvidencePolicyLabel(payload.noAutoSubmit === false ? "review" : "no-submit"));
  return parts.join(" ");
}

function getOverlayReadinessSummary(payload) {
  if (payload.safeCandidateCount === null
    || payload.safeCandidateCount === undefined
    || payload.candidateCount === null
    || payload.candidateCount === undefined) {
    return "";
  }
  const safeCandidateCount = Number(payload.safeCandidateCount);
  const candidateCount = Number(payload.candidateCount);
  const canShowCounts = Number.isFinite(safeCandidateCount) && Number.isFinite(candidateCount) && candidateCount >= 0;
  if (!canShowCounts) return "";
  const readiness = String(payload.overlayReadinessReason || payload.readinessReason || "ready");
  if (currentLocale === "zh-CN") {
    if (readiness === "ready") return `安全${safeCandidateCount}/${candidateCount}`;
    return `${readiness === "no-safe-candidate" ? "守卫" : "状态"}${safeCandidateCount}/${candidateCount}`;
  }
  if (readiness === "ready") return `s:${safeCandidateCount}/${candidateCount}`;
  return `${readiness === "no-safe-candidate" ? "guard" : "status"}:${safeCandidateCount}/${candidateCount}`;
}

function getProfileLabel(profile) {
  if (currentLocale !== "zh-CN") return profile;
  const labels = {
    codex: "Codex",
    workbuddy: "WorkBuddy",
    trae: "Trae",
    unknown: "未知工具",
    tool: "工具"
  };
  return labels[profile] || profile;
}

function getPromptKindMetaLabel(promptKind) {
  if (currentLocale !== "zh-CN") return promptKind === "generated" ? "gen" : promptKind;
  if (promptKind === "generated") return "生成稿";
  if (promptKind === "draft") return "草稿";
  return "提示";
}

function getGuardReasonLabel(reason) {
  if (currentLocale !== "zh-CN") return cleanToken(reason, "guard");
  return "守卫";
}

function getEvidenceStateLabel(token) {
  if (currentLocale !== "zh-CN") return token;
  const labels = {
    guarded: "守卫中",
    "visual-only": "仅定位",
    filled: "已填入",
    "draft-ready": "草稿就绪",
    safe: "可填入",
    waiting: "等待",
    queued: "待发送"
  };
  return labels[token] || token;
}

function getEvidenceActionLabel(token) {
  if (currentLocale !== "zh-CN") return token;
  const labels = {
    done: "完成",
    review: "审核",
    checking: "检查",
    scan: "扫描",
    make: "生成",
    fill: "填入",
    draft: "草稿"
  };
  return labels[token] || token;
}

function getEvidencePolicyLabel(token) {
  if (currentLocale !== "zh-CN") return token;
  const labels = {
    blocked: "已阻止",
    review: "需确认",
    "no-submit": "不提交"
  };
  return labels[token] || token;
}

function getOverlayHint(payload, state) {
  if (currentAssistantView) return currentAssistantView.description;
  const promptKind = cleanToken(payload.promptKind, "none");
  const browserLikeComposerCandidateCount = Number(payload.browserLikeComposerCandidateCount || 0);
  if (state !== "thinking" && hasQuickDraftText()) return tr("hintReadyToSend");
  if (payload.guardReason) return tr("hintNoWriteCheckTarget");
  if (payload.overlayReadinessReason === "no-safe-candidate" && state === "suggesting") {
    return browserLikeComposerCandidateCount > 0 ? tr("hintFocusInputThenScan") : tr("hintNeedSaferTargetFirst");
  }
  if (payload.overlayReadinessReason === "unsupported-overlay-profile" && state === "suggesting") {
    return tr("hintSwitchToSupportedTool");
  }
  if (payload.overlayReadinessReason && payload.overlayReadinessReason !== "ready" && state === "suggesting") {
    return payload.overlayReadinessReason === "missing-summary"
      ? tr("hintWaitForSnapshot")
      : tr("hintRescanTarget");
  }
  if (state === "thinking" && payload.overlayAction === "generate") {
    return promptKind === "generated" ? tr("hintRetryingPrompt") : tr("hintMakingPrompt");
  }
  if (state === "thinking") return tr("hintCheckingTarget");
  if (state === "success" || state === "clapping") return tr("hintNoAutoSubmit");
  if (payload.visualOnly && payload.promptReady === true && promptKind !== "draft") return tr("hintFocusInputThenScan");
  if (payload.promptReady === true && promptKind === "draft") return tr("hintMakeThenFill");
  if (payload.promptReady === true) return tr("hintReadyFillOrEdit");
  return tr("hintDraftThenMake");
}

function getModeLabel(payload) {
  const promptMode = getPromptMode(payload);
  if (promptMode === "continue") return tr("modeContinueShort");
  if (promptMode === "polish") return tr("modePolishShort");
  return tr("modeIdeaShort");
}

function getSelectedQuickReplyLabel(payload, state) {
  if (!selectedQuickReply) return "";
  const selected = getQuickReplies(payload, state)
    .find((reply) => cleanToken(reply.key, "reply") === selectedQuickReply);
  return selected ? String(selected.text || "").replace(/\s+/g, " ").trim().slice(0, 12) : "";
}

function getConversationTurns(payload, state) {
  const promptKind = cleanToken(payload.promptKind, "none");
  if (state !== "thinking" && hasQuickDraftText()) {
    const replyLabel = getSelectedQuickReplyLabel(payload, state);
    return {
      user: replyLabel ? tr("turnYouBrief", { label: replyLabel }) : tr("turnYouNoteReady"),
      assistant: tr("turnSmartPressSend")
    };
  }
  if (payload.guardReason) {
    return { user: tr("turnYouPaused"), assistant: tr("turnSmartCheckTarget") };
  }
  if (payload.visualOnly && payload.promptReady === true && promptKind !== "draft") {
    return { user: tr("turnYouPromptReady"), assistant: tr("turnSmartNeedTarget") };
  }
  if (state === "thinking") {
    if (payload.overlayAction === "generate") {
      return promptKind === "generated"
        ? { user: tr("turnYouRetry"), assistant: tr("turnSmartRetryingPrompt") }
        : { user: tr("turnYouMake"), assistant: tr("turnSmartMakingPrompt") };
    }
    if (payload.overlayAction === "fill") return { user: tr("turnYouFill"), assistant: tr("turnSmartCheckingTarget") };
    if (payload.overlayAction === "draft") return { user: tr("turnYouDraft"), assistant: tr("turnSmartOpeningDraft") };
    if (payload.overlayAction === "refresh") return { user: tr("turnYouScan"), assistant: tr("turnSmartScanningTarget") };
    if (payload.overlayAction === "review") return { user: tr("turnYouReview"), assistant: tr("turnSmartCheckTarget") };
    return { user: tr("turnYouActionSent"), assistant: tr("turnSmartChecking") };
  }
  if (state === "success" || state === "clapping") {
    return { user: tr("turnYouFilled"), assistant: tr("turnSmartNoSubmit") };
  }
  if (payload.overlayAction === "quick-draft") {
    return { user: tr("turnYouDraftSent"), assistant: tr("turnSmartMakeNext") };
  }
  if (payload.overlayAction === "mode") {
    return { user: tr("turnYouMode", { mode: getModeLabel(payload) }), assistant: tr("turnSmartRepliesTuned") };
  }
  if (payload.overlayAction === "locale") {
    return { user: tr("turnYouMode", { mode: currentLocale === "zh-CN" ? tr("localeZh") : tr("localeEn") }), assistant: tr("turnSmartRepliesTuned") };
  }
  if (payload.promptReady === true && promptKind === "draft") {
    return { user: tr("turnYouDraftReady"), assistant: tr("turnSmartMakeNext") };
  }
  if (payload.promptReady === true) {
    return { user: tr("turnYouPromptReady"), assistant: tr("turnSmartFillSafe") };
  }
  return { user: tr("turnYouAskHere"), assistant: tr("turnSmartDraftFirst") };
}

function getEvidenceState(payload, state) {
  const hasQuickDraft = hasQuickDraftText();
  const promptKind = cleanToken(payload.promptKind, "none");
  if (payload.guardReason) return "guarded";
  if (payload.visualOnly && payload.promptReady === true && promptKind !== "draft") return "visual-only";
  if (state === "success" || state === "clapping") return "filled";
  if (payload.promptReady === true && promptKind === "draft") return "draft-ready";
  if (payload.promptReady === true) return "safe";
  if (state === "thinking") return "waiting";
  if (hasQuickDraft) return "queued";
  return "waiting";
}

function getEvidenceAction(payload, state) {
  const promptKind = cleanToken(payload.promptKind, "none");
  if (state === "success" || state === "clapping") return "done";
  if (payload.guardReason) return "review";
  if (state === "thinking") return "checking";
  if (payload.visualOnly && payload.promptReady === true && promptKind !== "draft") return "scan";
  if (payload.promptReady === true && promptKind === "draft") return "make";
  if (payload.promptReady === true) return "fill";
  return "draft";
}

function getEvidencePolicy(payload) {
  if (payload.guardReason) return "blocked";
  return payload.noAutoSubmit === false ? "review" : "no-submit";
}

function getPrimaryCopy(payload, state) {
  if (currentAssistantView) return currentAssistantView.primaryAction.label;
  const promptKind = cleanToken(payload.promptKind, "none");
  if (state !== "thinking" && hasQuickDraftText()) return tr("primarySend");
  if (payload.guardReason) return tr("primaryReview");
  if (state === "thinking") return tr("primaryChecking");
  if (state === "success" || state === "clapping") return tr("primaryDone");
  if (payload.promptReady === true && promptKind === "draft") return tr("primaryMake");
  if (payload.visualOnly && payload.promptReady === true) return tr("primaryScan");
  if (payload.promptReady === true) return tr("primaryFill");
  return tr("primaryDraft");
}

function getPrimaryAction(payload, state) {
  if (state !== "thinking" && hasQuickDraftText()) return "send-draft";
  if (currentAssistantView) {
    const actionMap = {
      generate: "generate",
      insert: "fill",
      "retry-target": "refresh",
      copy: "copy",
      complete: "collapse",
      retry: payload.promptReady === true ? "refresh" : "generate",
      cancel: "",
      close: "collapse"
    };
    return actionMap[currentAssistantView.primaryAction.id] || "";
  }
  const promptKind = cleanToken(payload.promptKind, "none");
  if (payload.guardReason) return "review";
  if (state === "thinking") return "";
  if (state === "success" || state === "clapping") return "collapse";
  if (payload.promptReady === true && promptKind === "draft") return "generate";
  if (payload.visualOnly && payload.promptReady === true) return "refresh";
  if (payload.promptReady === true) return "fill";
  return "draft";
}

function getSecondaryActions(payload, state) {
  if (state === "success" || state === "clapping") {
    return [
      { element: draftButton, text: tr("actionGood"), action: "outcome-good" },
      { element: generateButton, text: tr("actionFix"), action: "outcome-fix" },
      { element: refreshButton, text: tr("actionScan"), action: "refresh" }
    ];
  }
  const promptKind = cleanToken(payload.promptKind, "none");
  const generateText = payload.guardReason || payload.promptReady !== true || promptKind !== "generated"
    ? tr("actionMake")
    : tr("actionRetry");
  return [
    { element: draftButton, text: tr("actionDraft"), action: "draft" },
    { element: generateButton, text: generateText, action: "generate" },
    { element: refreshButton, text: tr("actionScan"), action: "refresh" }
  ];
}

function getQuickReplies(payload, state) {
  if (state === "success" || state === "clapping") {
    return [
      { key: "short", text: tr("replyShort"), draft: tr("draftSuccessShort") },
      { key: "tone", text: tr("replyTone"), draft: tr("draftSuccessTone") },
      { key: "missing", text: tr("replyMissing"), draft: tr("draftSuccessMissing") }
    ];
  }
  if (payload.guardReason) {
    return [
      { key: "target", text: tr("replyTarget"), draft: tr("draftGuardTarget") },
      { key: "draft", text: tr("replyDraft"), draft: tr("draftGuardDraft") },
      { key: "safer", text: tr("replySafer"), draft: tr("draftGuardSafer") }
    ];
  }
  const promptMode = getPromptMode(payload);
  if (promptMode === "continue") {
    return [
      { key: "next", text: tr("replyNext"), draft: tr("draftContinueNext") },
      { key: "match", text: tr("replyMatch"), draft: tr("draftContinueMatch") },
      { key: "close", text: tr("replyClose"), draft: tr("draftContinueClose") }
    ];
  }
  if (promptMode === "polish") {
    return [
      { key: "short", text: tr("replyShort"), draft: tr("draftPolishShort") },
      { key: "tone", text: tr("replyTone"), draft: tr("draftPolishTone") },
      { key: "clear", text: tr("replyClear"), draft: tr("draftPolishClear") }
    ];
  }
  return [
    { key: "brief", text: tr("replyBrief"), draft: tr("draftIdeaBrief") },
    { key: "angle", text: tr("replyAngle"), draft: tr("draftIdeaAngle") },
    { key: "steps", text: tr("replySteps"), draft: tr("draftIdeaSteps") }
  ];
}

function getOverlayMode(payload) {
  return payload.overlayMode === "expanded" ? "expanded" : "compact";
}

function getPromptMode(payload) {
  return ["idea", "continue", "polish"].includes(payload.promptMode) ? payload.promptMode : "idea";
}

function getMascotMood(payload, state) {
  const promptKind = cleanToken(payload.promptKind, "none");
  if (payload.guardReason) return "guard";
  if (state === "thinking") return "thinking";
  if (state === "success" || state === "clapping") return "success";
  if (payload.visualOnly === true && payload.promptReady === true && promptKind !== "draft") return "scan";
  if (payload.promptReady === true) return "ready";
  return "idle";
}

function setAssistantEditorValue(value, options = {}) {
  assistantEditorText = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  assistantEditorDirty = options.dirty !== false;
  previewText = normalizePromptText(assistantEditorText);
  if (previewInput && previewInput.value !== assistantEditorText) previewInput.value = assistantEditorText;
  currentPayload.promptText = previewText;
  currentPayload.promptTextLength = previewText.length;
  currentPayload.promptTextHash = getPromptTextHash(previewText);
}

function invalidateOverlayUndoOnGoalChange() {
  if (currentPayload.canUndo !== true) return false;
  const payload = {
    ...currentPayload,
    canUndo: false,
    collapseRequested: false,
    overlayAction: "invalidate-undo"
  };
  currentPayload = payload;
  if (productSession && promptSessionApi) {
    currentAssistantView = productSession.dispatch({ type: promptSessionApi.COMMANDS.INVALIDATE_UNDO });
    renderSharedAssistant(currentAssistantView, getPromptMode(currentPayload));
  }
  invoke("mascot_overlay_clicked", payload)
    .catch((error) => warnOverlayAsyncFailure("invalidate-undo", error));
  return true;
}

function getAssistantEditorValue() {
  if (assistantEditorDirty) return assistantEditorText;
  return previewText || getQuickDraftText();
}

function ensureSharedAssistantCard() {
  if (sharedAssistantCard || !assistantUi || !assistantHost) return sharedAssistantCard;
  sharedAssistantCard = assistantUi.mountAssistantCard(assistantHost, {
    stylesheetUrl: "src/assistant-card.css",
    mascotUrl: STATE_IMAGES.suggesting,
    value: getAssistantEditorValue(),
    mode: getPromptMode(currentPayload),
    onAction: handleAssistantCardAction,
    onChange({ value }) {
      setAssistantEditorValue(value);
      invalidateOverlayUndoOnGoalChange();
    },
    onModeChange({ mode, value }) {
      setAssistantEditorValue(value);
      activateOverlay("mode", {
        promptMode: mode,
        promptText: previewText,
        promptTextLength: previewText.length,
        promptTextHash: getPromptTextHash(previewText)
      });
    }
  });
  return sharedAssistantCard;
}

function renderSharedAssistant(assistantView, promptMode) {
  const sharedCard = ensureSharedAssistantCard();
  if (!sharedCard || !assistantView) return;
  sharedCard.render({
    ...assistantView,
    pendingOutcome: currentPayload.pendingOutcome || assistantView.outcome || null,
    learningCandidate: currentPayload.learningCandidate || assistantView.candidateReminder || null
  }, {
    value: getAssistantEditorValue(),
    mode: promptMode
  });
}

function render(payload = {}) {
  const transientDefaults = {
    readinessReason: "",
    overlayReadinessReason: "",
    candidateCount: null,
    safeCandidateCount: null,
    browserLikeComposerCandidateCount: 0,
    visualAnchorIndex: -1,
    visualAnchorReason: "",
    overlayReady: false,
    fillVerified: false,
    verified: false,
    verification: "",
    canUndo: false,
    collapseRequested: false
  };
  currentPayload = { ...currentPayload, ...transientDefaults, ...payload };
  if (!Object.prototype.hasOwnProperty.call(payload, "guardReason")) {
    currentPayload.guardReason = "";
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "visualOnly")) {
    currentPayload.visualOnly = false;
  }
  currentPayload.locale = normalizeLocale(currentPayload.locale || currentLocale);
  setOverlayLocale(currentPayload.locale);
  syncPromptPreviewFromPayload(currentPayload);
  const state = STATE_IMAGES[currentPayload.state] ? currentPayload.state : "resting";
  const assistantView = syncOverlayProductSession(currentPayload, state);
  const overlayMode = getOverlayMode(currentPayload);
  const promptMode = getPromptMode(currentPayload);
  const profile = cleanToken(currentPayload.profile, "tool");
  const mascotMood = getMascotMood(currentPayload, state);
  const quickDraftPending = state !== "thinking" && hasQuickDraftText();
  image.src = STATE_IMAGES[state];
  badge.textContent = currentPayload.guardReason
    ? tr("badgeGuard")
    : quickDraftPending ? tr("badgeDraft")
    : state === "suggesting" ? profile : tr(STATE_LABEL_KEYS[state] || "badgeReady");
  message.textContent = getOverlayCopy(currentPayload, state, profile);
  meta.textContent = getOverlayMeta(currentPayload, profile);
  hint.textContent = getOverlayHint(currentPayload, state);
  const turns = getConversationTurns(currentPayload, state);
  userTurn.textContent = turns.user;
  assistantTurn.textContent = turns.assistant;
  const evidenceStateToken = getEvidenceState(currentPayload, state);
  const evidenceActionToken = getEvidenceAction(currentPayload, state);
  const evidencePolicyToken = getEvidencePolicy(currentPayload);
  evidenceStateChip.textContent = getEvidenceStateLabel(evidenceStateToken);
  evidenceActionChip.textContent = getEvidenceActionLabel(evidenceActionToken);
  evidencePolicyChip.textContent = getEvidencePolicyLabel(evidencePolicyToken);
  primary.textContent = getPrimaryCopy(currentPayload, state);
  primary.disabled = state === "thinking" || assistantView?.primaryAction.enabled === false;
  quickDraftInput.disabled = state === "thinking";
  quickDraftSend.disabled = !quickDraftPending;
  const showPromptPanel = shouldShowPromptPreview(currentPayload);
  if (previewPanel) previewPanel.hidden = !showPromptPanel;
  if (quickDraftForm) quickDraftForm.classList.toggle("mascot-overlay-draft-form-hidden", showPromptPanel);
  if (quickRepliesPanel) quickRepliesPanel.classList.toggle("mascot-overlay-replies-hidden", showPromptPanel);
  if (moodStrip) moodStrip.dataset.mood = mascotMood;
  quickDraftInput.placeholder = tr("quickDraftPlaceholder");
  quickDraftInput.setAttribute("aria-label", tr("quickDraft"));
  quickDraftSend.setAttribute("aria-label", tr("sendDraft"));
  if (previewInput) {
    previewInput.placeholder = tr("previewPlaceholder");
    previewInput.setAttribute("aria-label", tr("promptPreview"));
  }
  if (previewPanel) previewPanel.setAttribute("aria-label", tr("promptPreview"));
  document.querySelector(".mascot-overlay-modes")?.setAttribute("aria-label", tr("promptMode"));
  document.querySelector(".mascot-overlay-locales")?.setAttribute("aria-label", tr("inputLanguage"));
  document.querySelector(".mascot-overlay-actions")?.setAttribute("aria-label", tr("actions"));
  document.querySelector(".mascot-overlay-replies")?.setAttribute("aria-label", tr("quickReplies"));
  document.querySelector(".mascot-overlay-preview-actions")?.setAttribute("aria-label", tr("promptReviewActions"));
  for (const modeButton of modeButtons) {
    if (modeButton.dataset.promptMode === "continue") modeButton.textContent = tr("modeContinueShort");
    else if (modeButton.dataset.promptMode === "polish") modeButton.textContent = tr("modePolishShort");
    else modeButton.textContent = tr("modeIdeaShort");
  }
  if (previewCopyButton) {
    previewCopyButton.textContent = tr("previewCopy");
    previewCopyButton.setAttribute("aria-label", tr("previewCopy"));
    previewCopyButton.disabled = !previewText.trim();
  }
  if (previewReviewButton) {
    previewReviewButton.textContent = currentPayload.promptKind === "draft" ? tr("previewEdit") : tr("previewReview");
    previewReviewButton.setAttribute("aria-label", previewReviewButton.textContent);
  }
  if (previewUndoButton) {
    previewUndoButton.textContent = tr("previewUndo");
    previewUndoButton.setAttribute("aria-label", tr("previewUndo"));
    previewUndoButton.disabled = previewText === currentPromptSourceText;
  }
  if (previewClearButton) {
    previewClearButton.textContent = tr("previewClear");
    previewClearButton.setAttribute("aria-label", tr("previewClear"));
    previewClearButton.disabled = !previewText;
  }
  syncPromptPreviewState();
  renderSharedAssistant(assistantView, promptMode);
  const quickReplies = getQuickReplies(currentPayload, state);
  for (const [index, replyButton] of quickReplyButtons.entries()) {
    const quickReply = quickReplies[index] || { key: "", text: "", draft: "" };
    replyButton.textContent = quickReply.text;
    replyButton.dataset.reply = quickReply.key;
    replyButton.dataset.draft = quickReply.draft;
    const reply = cleanToken(quickReply.key, "reply");
    replyButton.disabled = state === "thinking" || quickDraftPending;
    replyButton.setAttribute("aria-pressed", String(reply === selectedQuickReply));
  }
  primary.dataset.overlayAction = getPrimaryAction(currentPayload, state);
  for (const item of getSecondaryActions(currentPayload, state)) {
    item.element.textContent = item.text;
    item.element.dataset.overlayAction = item.action;
    item.element.disabled = state === "thinking" || quickDraftPending;
  }
  for (const modeButton of modeButtons) {
    const selected = modeButton.dataset.promptMode === promptMode;
    modeButton.disabled = state === "thinking" || quickDraftPending;
    modeButton.setAttribute("aria-pressed", String(selected));
  }
  for (const localeButton of localeButtons) {
    localeButton.disabled = state === "thinking";
    localeButton.setAttribute("aria-pressed", String(normalizeLocale(localeButton.dataset.locale) === currentLocale));
  }
  button.setAttribute("aria-label", `Smart Prompt: ${message.textContent}`);
  card.setAttribute("aria-label", `Smart Prompt: ${message.textContent}`);
  document.documentElement.dataset.state = state;
  document.documentElement.dataset.assistantState = assistantView?.state || "";
  document.documentElement.dataset.assistantReason = assistantView?.reason.code || "";
  document.documentElement.dataset.assistantVerification = assistantView?.verification || "";
  document.documentElement.dataset.assistantContractVersion = assistantView?.contractVersion || "";
  document.documentElement.dataset.profile = profile;
  document.documentElement.dataset.candidateIndex = String(currentPayload.candidateIndex ?? -1);
  document.documentElement.dataset.candidateCount = String(currentPayload.candidateCount ?? "");
  document.documentElement.dataset.safeCandidateCount = String(currentPayload.safeCandidateCount ?? "");
  document.documentElement.dataset.browserLikeComposerCandidateCount = String(currentPayload.browserLikeComposerCandidateCount ?? 0);
  document.documentElement.dataset.visualAnchorIndex = String(currentPayload.visualAnchorIndex ?? -1);
  document.documentElement.dataset.visualAnchorReason = String(currentPayload.visualAnchorReason || "");
  document.documentElement.dataset.readinessReason = String(currentPayload.readinessReason || "");
  document.documentElement.dataset.overlayReadinessReason = String(currentPayload.overlayReadinessReason || "");
  document.documentElement.dataset.overlayReady = String(currentPayload.overlayReady === true);
  document.documentElement.dataset.noAutoSubmit = String(currentPayload.noAutoSubmit !== false);
  document.documentElement.dataset.promptReady = String(currentPayload.promptReady === true);
  document.documentElement.dataset.promptKind = currentPayload.promptKind || "none";
  document.documentElement.dataset.promptMode = promptMode;
  document.documentElement.dataset.locale = currentLocale;
  document.documentElement.dataset.inputLocale = currentLocale;
  document.documentElement.dataset.evidenceState = evidenceStateToken;
  document.documentElement.dataset.evidenceAction = evidenceActionToken;
  document.documentElement.dataset.evidencePolicy = evidencePolicyToken;
  document.documentElement.dataset.overlayAction = currentPayload.overlayAction || "";
  document.documentElement.dataset.guardReason = currentPayload.guardReason || "";
  document.documentElement.dataset.visualOnly = String(currentPayload.visualOnly === true);
  document.documentElement.dataset.overlayMode = overlayMode;
  document.documentElement.dataset.mascotMood = mascotMood;
  document.documentElement.dataset.previewVisible = String(showPromptPanel);
  document.documentElement.dataset.primaryAction = primary.dataset.overlayAction || primary.textContent.toLowerCase();
  document.documentElement.dataset.userTurn = userTurn.textContent;
  document.documentElement.dataset.assistantTurn = assistantTurn.textContent;
  document.documentElement.dataset.quickDraftFocused = String(document.activeElement === quickDraftInput);
  document.documentElement.dataset.quickReplyCount = String(quickReplyButtons.length);
  document.documentElement.dataset.quickReplySelected = selectedQuickReply;
  document.documentElement.dataset.quickReplySelectedLabel = getSelectedQuickReplyLabel(currentPayload, state);
  document.documentElement.dataset.quickDraftKeyboardAction = lastQuickDraftKeyboardAction;
  document.documentElement.dataset.quickDraftPending = String(quickDraftPending);
  document.documentElement.dataset.quickDraftSendReady = String(!quickDraftSend.disabled);
  document.documentElement.dataset.previewFocused = String(document.activeElement === previewInput);
  if (focusQuickDraftOnNextRender && overlayMode === "expanded" && state !== "thinking") {
    focusQuickDraftOnNextRender = false;
    requestAnimationFrame(() => {
      const sharedCard = ensureSharedAssistantCard();
      if (sharedCard?.focusEditor) sharedCard.focusEditor();
      else {
        const target = previewPanel?.hidden === false && previewInput ? previewInput : quickDraftInput;
        target?.focus({ preventScroll: true });
      }
      document.documentElement.dataset.quickDraftFocused = String(document.activeElement === quickDraftInput);
      document.documentElement.dataset.previewFocused = String(document.activeElement === previewInput);
      const sharedEditor = assistantHost?.shadowRoot?.querySelector("[data-assistant-editor]");
      document.documentElement.dataset.sharedEditorFocused = String(
        assistantHost?.shadowRoot?.activeElement === sharedEditor
      );
    });
  }
}

async function invoke(command, payload) {
  if (!window.__TAURI__?.core?.invoke) return;
  await window.__TAURI__.core.invoke(command, { payload });
}

async function invokeDraftSubmitted(text, payload) {
  if (!window.__TAURI__?.core?.invoke) return;
  await window.__TAURI__.core.invoke("mascot_overlay_draft_submitted", { text, payload });
}

function setOverlayMode(overlayMode) {
  const nextMode = overlayMode === "expanded" ? "expanded" : "compact";
  const previousMode = currentPayload.overlayMode;
  if (overlayTransitionTimeout) {
    clearTimeout(overlayTransitionTimeout);
    overlayTransitionTimeout = null;
  }
  const payload = { ...currentPayload, overlayMode: nextMode };
  if (previousMode !== nextMode) {
    document.documentElement.dataset.overlayTransition = nextMode === "expanded" ? "open" : "close";
    overlayTransitionTimeout = window.setTimeout(() => {
      if (document.documentElement.dataset.overlayTransition
        === (nextMode === "expanded" ? "open" : "close")) {
        document.documentElement.removeAttribute("data-overlay-transition");
      }
      overlayTransitionTimeout = null;
    }, 180);
  }
  render(payload);
  invoke("set_mascot_overlay_state", payload).catch((error) => warnOverlayAsyncFailure("set-overlay-mode", error));
}

function expandOverlay() {
  focusQuickDraftOnNextRender = true;
  setOverlayMode("expanded");
}

function collapseOverlay() {
  if (currentPayload.guardReason) return;
  if (productSession && promptSessionApi) {
    currentAssistantView = productSession.dispatch({ type: promptSessionApi.COMMANDS.COLLAPSE_ACK });
  }
  setOverlayMode("compact");
  requestAnimationFrame(() => button?.focus?.({ preventScroll: true }));
}

function activateOverlay(action = "fill", extraPayload = {}) {
  if (!action || action === "collapse") {
    collapseOverlay();
    return;
  }
  const nextState = action === "mode" || action === "locale" || action.startsWith("outcome-") || action.startsWith("candidate-")
    ? currentPayload.state || "suggesting"
    : "thinking";
  const nextPayload = { ...currentPayload, ...extraPayload, state: nextState, overlayMode: "expanded", overlayAction: action };
  render(nextPayload);
  invoke("mascot_overlay_clicked", nextPayload).catch(() => render({ state: "resting" }));
}

function getQuickDraftText() {
  return String(quickDraftInput.value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 400);
}

async function submitAssistantDraft(text, mode) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, 8000);
  if (!normalized) return false;
  setAssistantEditorValue(normalized);
  const draftPayload = {
    ...currentPayload,
    state: "suggesting",
    overlayMode: "expanded",
    overlayAction: "quick-draft",
    promptReady: true,
    promptKind: "draft",
    promptMode: mode,
    promptText: normalized,
    promptTextLength: normalized.length,
    promptTextHash: getPromptTextHash(normalized)
  };
  render(draftPayload);
  await invokeDraftSubmitted(normalized, draftPayload);
  return true;
}

async function handleAssistantCardAction(actionPayload = {}) {
  const { id, value, editorValue, mode, outcomeId, candidateId } = actionPayload;
  const action = String(id || "");
  const text = String(value || "");

  if (["outcome-completed", "outcome-not-completed", "outcome-reason"].includes(action)) {
    activateOverlay(action, {
      value: text,
      outcomeId: String(outcomeId || ""),
      promptMode: mode
    });
    return;
  }
  if (["candidate-review", "candidate-ignore"].includes(action)) {
    activateOverlay(action, {
      value: text,
      candidateId: String(candidateId || ""),
      promptMode: mode
    });
    return;
  }
  const editorText = String(editorValue ?? value ?? "");
  setAssistantEditorValue(editorText);

  if (action === "close" || action === "complete") {
    collapseOverlay();
    return;
  }
  if (action === "copy") {
    copyPromptPreview();
    return;
  }
  if (action === "retry-target") {
    activateOverlay("refresh", {
      promptText: previewText,
      promptTextLength: previewText.length,
      promptTextHash: getPromptTextHash(previewText)
    });
    return;
  }
  if (action === "view-reason") {
    document.documentElement.dataset.assistantReasonViewed = "true";
    return;
  }
  if (action === "diagnostics") {
    if (window.__TAURI__?.core?.invoke) {
      await window.__TAURI__.core.invoke("show_main_window");
    }
    return;
  }
  if (action === "cancel") {
    const nextPayload = { ...currentPayload, state: "resting", overlayAction: "", overlayMode: "expanded" };
    render(nextPayload);
    invoke("set_mascot_overlay_state", nextPayload).catch((error) => warnOverlayAsyncFailure("cancel", error));
    return;
  }
  if (action === "generate" || action === "regenerate" || action === "retry") {
    if (editorText.trim() && (currentPayload.promptReady !== true || currentPayload.promptKind === "draft")) {
      await submitAssistantDraft(editorText, mode);
    }
    activateOverlay("generate", {
      promptMode: mode,
      promptText: previewText,
      promptTextLength: previewText.length,
      promptTextHash: getPromptTextHash(previewText)
    });
    return;
  }
  if (action === "insert") {
    activateOverlay("fill", {
      promptMode: mode,
      promptText: previewText,
      promptTextLength: previewText.length,
      promptTextHash: getPromptTextHash(previewText)
    });
    return;
  }
  if (action === "undo") {
    activateOverlay("undo", {
      promptMode: mode,
      promptText: previewText,
      promptTextLength: previewText.length,
      promptTextHash: getPromptTextHash(previewText)
    });
    return;
  }
}

function hasQuickDraftText() {
  return getQuickDraftText().length > 0;
}

function handlePromptPreviewInput() {
  if (!previewInput) return;
  previewText = normalizePromptText(previewInput.value);
  invalidateOverlayUndoOnGoalChange();
  syncPromptPreviewState();
}

function applyQuickReply(replyButton) {
  if (!replyButton || quickDraftInput.disabled) return;
  const text = String(replyButton.dataset.draft || "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return;
  selectedQuickReply = cleanToken(replyButton.dataset.reply, "reply");
  quickDraftInput.value = text;
  invalidateOverlayUndoOnGoalChange();
  quickDraftInput.focus();
  render(currentPayload);
}

function submitQuickDraft(event) {
  event?.preventDefault?.();
  const text = getQuickDraftText();
  if (!text) {
    quickDraftInput.focus();
    return;
  }
  const nextPayload = {
    ...currentPayload,
    state: "suggesting",
    overlayMode: "expanded",
    overlayAction: "quick-draft",
    promptReady: true,
    promptKind: "draft"
  };
  quickDraftInput.value = "";
  selectedQuickReply = "";
  render(nextPayload);
  invokeDraftSubmitted(text, nextPayload).catch(() => render({ state: "resting" }));
}

function handleQuickDraftKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    lastQuickDraftKeyboardAction = "escape-collapse";
    render(currentPayload);
    collapseOverlay();
    return;
  }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  lastQuickDraftKeyboardAction = event.ctrlKey || event.metaKey ? "accelerator-send" : "enter-send";
  submitQuickDraft(event);
}

button.addEventListener("click", () => {
  if (getOverlayMode(currentPayload) === "compact") {
    activateOverlay("open");
    return;
  }
  expandOverlay();
});
closeButton.addEventListener("click", collapseOverlay);
if (previewCopyButton) previewCopyButton.addEventListener("click", copyPromptPreview);
if (previewReviewButton) previewReviewButton.addEventListener("click", () => {
  const hasPrompt = currentPayload.promptReady === true && currentPayload.promptKind !== "none";
  if (!hasPrompt) return;
  syncPromptPreviewState();
  activateOverlay("review", {
    promptText: previewText,
    promptTextLength: previewText.length,
    promptTextHash: getPromptTextHash(previewText)
  });
});
if (previewUndoButton) previewUndoButton.addEventListener("click", undoPromptPreview);
if (previewClearButton) previewClearButton.addEventListener("click", clearPromptPreview);
primary.addEventListener("click", (event) => {
  if (primary.dataset.overlayAction === "send-draft") {
    submitQuickDraft(event);
    return;
  }
  if (primary.dataset.overlayAction === "copy") {
    copyPromptPreview();
    return;
  }
  if (primary.dataset.overlayAction === "collapse") {
    collapseOverlay();
    return;
  }
  if (!primary.dataset.overlayAction) return;
  activateOverlay(primary.dataset.overlayAction);
});
draftButton.addEventListener("click", () => activateOverlay(draftButton.dataset.overlayAction || "draft"));
generateButton.addEventListener("click", () => activateOverlay(generateButton.dataset.overlayAction || "generate"));
refreshButton.addEventListener("click", () => activateOverlay(refreshButton.dataset.overlayAction || "refresh"));
quickDraftForm.addEventListener("submit", submitQuickDraft);
quickDraftInput.addEventListener("keydown", handleQuickDraftKeydown);
quickDraftInput.addEventListener("input", () => {
  selectedQuickReply = "";
  invalidateOverlayUndoOnGoalChange();
  render(currentPayload);
});
if (previewInput) previewInput.addEventListener("input", handlePromptPreviewInput);
for (const replyButton of quickReplyButtons) {
  replyButton.addEventListener("click", () => applyQuickReply(replyButton));
}
for (const modeButton of modeButtons) {
  modeButton.addEventListener("click", () => {
    activateOverlay("mode", { promptMode: modeButton.dataset.promptMode || "idea" });
  });
}
for (const localeButton of localeButtons) {
  localeButton.addEventListener("click", () => {
    const locale = normalizeLocale(localeButton.dataset.locale);
    setOverlayLocale(locale, { persist: true });
    activateOverlay("locale", { locale });
  });
}

if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen("smart-prompt-overlay-state", (event) => {
    render(event.payload || {});
  }).catch((error) => warnOverlayAsyncFailure("listen-overlay-state", error));
}

render(currentPayload);
