(function initSmartPromptContent() {
  const CONTENT_BUILD_ID = "phase3-extension-20260717-r5";
  const WRITE_CONTRACT_VERSION = "chatgpt-stable-write@1";
  const ACTIVATION_PROOF_VERSION = "stable-readback-proof@1";
  const engine = globalThis.SmartPromptEngine;
  const promptSessionApi = globalThis.SmartPromptSession;
  const assistantUi = globalThis.SmartPromptAssistantUI;
  const siteAdapters = globalThis.SmartPromptSiteAdapters;
  const localService = globalThis.SmartPromptLocalService;
  const activationEvidence = globalThis.SmartPromptActivationEvidence;
  if (!engine || !promptSessionApi || !assistantUi || globalThis.__smartPromptCopilotLoaded) return;
  if (
    siteAdapters?.WRITE_CONTRACT_VERSION !== WRITE_CONTRACT_VERSION
    || activationEvidence?.EXTENSION_BUILD_ID !== CONTENT_BUILD_ID
    || activationEvidence?.ACTIVATION_PROOF_VERSION !== ACTIVATION_PROOF_VERSION
  ) {
    document.documentElement.dataset.smartPromptRuntimeState = "module_mismatch";
    return;
  }
  globalThis.__smartPromptCopilotLoaded = true;
  document.documentElement.dataset.smartPromptRuntimeBuild = CONTENT_BUILD_ID;
  document.documentElement.dataset.smartPromptRuntimeState = "ready";

  const STORAGE_KEYS = {
    skills: "smartPromptSkills",
    settings: "smartPromptSettings",
    favorites: "smartPromptFavorites",
    feedback: "smartPromptFeedback",
    pendingActivation: "smartPromptPendingActivation"
  };

  const state = {
    activeInput: null,
    card: null,
    assistantCard: null,
    editorValue: "",
    generatedBy: "template",
    mascot: null,
    importedSkills: [],
    variant: 0,
    manualMode: "",
    generationRequestId: 0,
    suppressInputRefresh: false,
    undoSnapshot: null,
    lastPrompt: "",
    lastInputText: "",
    lastContext: null,
    lastGenerationMeta: null,
    activationBrowserSeen: false,
    activationBrowserSeenPromise: null,
    activationCompleted: false,
    activationFlushPromise: null,
    activationRetryTimer: null,
    productSession: null,
    productView: null,
    settings: {
      enabled: true,
      quietUntilFocus: true,
      preferLocalService: true,
      serviceUrl: localService?.DEFAULT_SERVICE_URL || "http://127.0.0.1:17371"
    },
    observedShadowRoots: new WeakSet(),
    observedInputs: new WeakSet(),
    dynamicScanTimer: null,
    debug: {
      focusEvents: 0,
      inputBindings: 0,
      shadowBindings: 0,
      deepActiveChecks: 0,
      lastFocusTag: "",
      lastFocusHost: "",
      lastFocusKind: "",
      lastAdapterId: "",
      lastInsertResult: null
    }
  };

  const mascotMap = {
    normal: "assets/mascot-states/normal.png",
    resting: "assets/mascot-states/resting.png",
    thinking: "assets/mascot-states/thinking.png",
    suggesting: "assets/mascot-states/suggesting.png",
    success: "assets/mascot-states/success.png",
    clapping: "assets/mascot-states/clapping.png"
  };
  const STABLE_READBACK_DELAYS_MS = Object.freeze([120, 200]);

  function getCurrentSiteAdapter() {
    return siteAdapters?.detectSiteAdapter?.(location.hostname) || null;
  }

  async function retryActivationRequest(operation) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    return null;
  }

  async function readPendingActivationQueue() {
    if (!activationEvidence?.getPendingActivation) return [];
    const values = await storageGet([STORAGE_KEYS.pendingActivation]);
    const pending = activationEvidence.getPendingActivation(values[STORAGE_KEYS.pendingActivation]);
    return pending ? [pending] : [];
  }

  function schedulePendingActivationFlush(attempts = 0) {
    if (state.activationRetryTimer || state.activationCompleted) return;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(4, Number(attempts || 0))));
    state.activationRetryTimer = setTimeout(async () => {
      state.activationRetryTimer = null;
      await flushPendingActivation();
    }, delay);
  }

  async function writePendingActivationQueue(queue) {
    await storageSet({ [STORAGE_KEYS.pendingActivation]: queue });
  }

  async function queuePendingActivation(payload, { replaceExisting = false } = {}) {
    if (!activationEvidence?.enqueuePendingActivation) return null;
    const queue = await readPendingActivationQueue();
    const next = replaceExisting && activationEvidence.replacePendingActivation
      ? activationEvidence.replacePendingActivation(queue, payload)
      : activationEvidence.enqueuePendingActivation(queue, payload);
    await writePendingActivationQueue(next);
    const pending = activationEvidence.getPendingActivation(next);
    if (pending && activationEvidence.canRetryPendingActivation(pending)) {
      schedulePendingActivationFlush(pending.attempts);
    }
    return pending;
  }

  async function clearPendingActivationQueue() {
    if (state.activationRetryTimer) {
      clearTimeout(state.activationRetryTimer);
      state.activationRetryTimer = null;
    }
    await writePendingActivationQueue([]);
  }

  async function flushPendingActivation({ force = false } = {}) {
    if (state.activationCompleted || !localService?.completeActivation || !activationEvidence) return null;
    if (state.activationFlushPromise) return state.activationFlushPromise;
    state.activationFlushPromise = (async () => {
      const queue = await readPendingActivationQueue();
      const pending = activationEvidence.getPendingActivation(queue);
      if (!pending || (!force && !activationEvidence.canRetryPendingActivation(pending))) return null;

      if (!state.activationBrowserSeen) {
        const seen = await markActivationBrowserSeen({ flushPending: false });
        if (!seen) {
          const next = activationEvidence.recordPendingActivationAttempt(queue, pending.payload.eventId, false);
          await writePendingActivationQueue(next);
          const retry = activationEvidence.getPendingActivation(next);
          if (retry && activationEvidence.canRetryPendingActivation(retry)) schedulePendingActivationFlush(retry.attempts);
          return null;
        }
      }

      const result = await retryActivationRequest(() => localService.completeActivation(
        pending.payload,
        state.settings.serviceUrl
      ));
      const completed = result?.activation?.progress === "activated";
      const next = activationEvidence.recordPendingActivationAttempt(queue, pending.payload.eventId, completed);
      await writePendingActivationQueue(next);
      if (completed) {
        state.activationCompleted = true;
        if (state.activationRetryTimer) {
          clearTimeout(state.activationRetryTimer);
          state.activationRetryTimer = null;
        }
      } else {
        const retry = activationEvidence.getPendingActivation(next);
        if (retry && activationEvidence.canRetryPendingActivation(retry)) schedulePendingActivationFlush(retry.attempts);
      }
      return result;
    })();
    try {
      return await state.activationFlushPromise;
    } finally {
      state.activationFlushPromise = null;
    }
  }

  async function markActivationBrowserSeen({ flushPending = true } = {}) {
    if (state.activationBrowserSeen || !localService?.markActivationBrowserSeen || !activationEvidence) return null;
    if (!activationEvidence.isActivationTarget(getCurrentSiteAdapter())) return null;
    state.activationBrowserSeen = true;
    state.activationBrowserSeenPromise = retryActivationRequest(() => localService.markActivationBrowserSeen(
      activationEvidence.buildBrowserSeenPayload(),
      state.settings.serviceUrl
    ));
    const result = await state.activationBrowserSeenPromise;
    if (!result) state.activationBrowserSeen = false;
    if (result?.activation?.progress === "activated") {
      state.activationCompleted = true;
      await clearPendingActivationQueue();
    } else if (result && flushPending) {
      await flushPendingActivation();
    }
    return result;
  }

  async function completeActivationFromEvidence(kind, evidence = {}) {
    if (state.activationCompleted || !localService?.completeActivation || !activationEvidence) return null;
    if (!activationEvidence.isActivationTarget(getCurrentSiteAdapter())) return null;
    if (!activationEvidence.isModelBackedGeneration(state.generatedBy)) return null;
    const queued = activationEvidence.getPendingActivation(await readPendingActivationQueue());
    if (queued) {
      await clearPendingActivationQueue();
    }
    if (state.activationBrowserSeenPromise) await state.activationBrowserSeenPromise;
    if (!state.activationBrowserSeen) await markActivationBrowserSeen({ flushPending: false });
    const payload = activationEvidence.buildCompletionPayload({
      eventId: activationEvidence.createActivationEventId(kind),
      kind,
      targetKind: evidence.targetKind,
      stableReadback: evidence.stableReadback
    });
    if (!payload) {
      document.documentElement.dataset.smartPromptActivationCompletion = "evidence_rejected";
      return null;
    }
    const result = await retryActivationRequest(() => localService.completeActivation(payload, state.settings.serviceUrl));
    if (result?.activation?.progress === "activated") {
      state.activationCompleted = true;
      await clearPendingActivationQueue();
      document.documentElement.dataset.smartPromptActivationCompletion = "activated";
    } else {
      await queuePendingActivation(payload, { replaceExisting: true });
      document.documentElement.dataset.smartPromptActivationCompletion = "pending";
    }
    return result;
  }

  const UI_MESSAGES = Object.freeze({
    "zh-CN": {
      productName: "Smart Prompt 提示词助手",
      promptCard: "提示词卡片",
      title: "提示词助手",
      close: "关闭",
      mode: "模式",
      statusReady: "就绪",
      statusGenerating: "生成中",
      statusRetrying: "重试中",
      statusServiceOffline: "服务离线",
      statusCredentialInvalid: "API Key 未通过验证",
      statusModelUnavailable: "当前模型不可用",
      statusNetworkUnavailable: "模型服务连接失败",
      statusProviderError: "Provider 暂时不可用",
      statusInsertFailed: "填入失败",
      sourceTemplate: "模板",
      sourceTemplateFallback: "模板兜底",
      sourceService: "服务",
      basis: "依据",
      privacy: "隐私",
      source: "来源",
      none: "无",
      score: "分",
      path: "路径",
      unknown: "未知",
      noTitle: "无标题",
      noPageBody: "未读取页面正文",
      evidenceSummary: "依据和隐私摘要",
      recommendedSkills: "推荐 skill",
      refresh: "刷新",
      retry: "重试",
      edit: "编辑",
      copy: "复制",
      save: "保存",
      insert: "填入",
      inserted: "已填入",
      undo: "撤销",
      outcome: "\u7ed3\u679c",
      outcomeQuick: "\u5feb\u901f\u8bc4\u4ef7",
      outcomeSuccess: "\u6210\u529f",
      outcomeNeedsWork: "\u5f85\u6539",
      outcomeFailed: "\u65e0\u6548",
      failureReason: "\u539f\u56e0",
      failureReasonTooLong: "\u592a\u957f",
      failureReasonWrongFormat: "\u683c\u5f0f\u9519",
      failureReasonNotActionable: "\u4e0d\u53ef\u6267\u884c",
      failureReasonMissingContext: "\u7f3a\u4e0a\u4e0b\u6587",
      failureReasonInsertFailed: "\u63d2\u5165\u5931\u8d25",
      failureReasonLowQuality: "\u8d28\u91cf\u5dee",
      statusChooseReason: "\u9009\u62e9\u539f\u56e0",
      statusOutcomeSaved: "\u5df2\u8bb0\u5f55"
    },
    en: {
      productName: "Smart Prompt Copilot",
      promptCard: "Prompt card",
      title: "Prompt Copilot",
      close: "Close",
      mode: "Mode",
      statusReady: "ready",
      statusGenerating: "generating",
      statusRetrying: "retrying",
      statusServiceOffline: "service offline",
      statusCredentialInvalid: "API key rejected",
      statusModelUnavailable: "model unavailable",
      statusNetworkUnavailable: "model service unreachable",
      statusProviderError: "provider temporarily unavailable",
      statusInsertFailed: "insert failed",
      sourceTemplate: "template",
      sourceTemplateFallback: "template fallback",
      sourceService: "service",
      basis: "Basis",
      privacy: "Privacy",
      source: "Source",
      none: "none",
      score: "score",
      path: "path",
      unknown: "unknown",
      noTitle: "no title",
      noPageBody: "no page body",
      evidenceSummary: "Basis and privacy summary",
      recommendedSkills: "Recommended skills",
      refresh: "Refresh",
      retry: "Retry",
      edit: "Edit",
      copy: "Copy",
      save: "Save",
      insert: "Insert",
      inserted: "Inserted",
      undo: "Undo",
      outcome: "Outcome",
      outcomeQuick: "Quick outcome",
      outcomeSuccess: "Success",
      outcomeNeedsWork: "Revise",
      outcomeFailed: "Failed",
      failureReason: "Reason",
      failureReasonTooLong: "Too long",
      failureReasonWrongFormat: "Wrong format",
      failureReasonNotActionable: "Not actionable",
      failureReasonMissingContext: "Missing context",
      failureReasonInsertFailed: "Insert failed",
      failureReasonLowQuality: "Low quality",
      statusChooseReason: "choose reason",
      statusOutcomeSaved: "recorded"
    }
  });

  const OUTCOME_OPTIONS = Object.freeze({
    success: { labelKey: "outcomeSuccess", score: 1 },
    "needs-work": { labelKey: "outcomeNeedsWork", score: 0.45 },
    failed: { labelKey: "outcomeFailed", score: 0.05 }
  });
  const QUICK_OUTCOME_OPTIONS = Object.freeze([
    { label: "success", labelKey: "outcomeSuccess", icon: "&#128077;" },
    { label: "needs-work", labelKey: "outcomeNeedsWork", icon: "&#128078;" }
  ]);

  const FAILURE_REASON_OPTIONS = Object.freeze([
    { token: "too_long", labelKey: "failureReasonTooLong" },
    { token: "wrong_format", labelKey: "failureReasonWrongFormat" },
    { token: "not_actionable", labelKey: "failureReasonNotActionable" },
    { token: "missing_context", labelKey: "failureReasonMissingContext" },
    { token: "insert_failed", labelKey: "failureReasonInsertFailed" },
    { token: "low_quality", labelKey: "failureReasonLowQuality" }
  ]);
  const FAILURE_REASON_TOKENS = new Set(FAILURE_REASON_OPTIONS.map((item) => item.token));

  function normalizeUiLocale(value) {
    const normalized = engine.normalizeLocale
      ? engine.normalizeLocale(value, "")
      : (String(value || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en");
    return normalized === "zh-CN" ? "zh-CN" : "en";
  }

  function getAutoLocale() {
    const browserLocale = globalThis.chrome?.i18n?.getUILanguage?.();
    const pageLocale = document.documentElement?.lang;
    return normalizeUiLocale(browserLocale || pageLocale || navigator.language || "en");
  }

  function getUiLocale() {
    const setting = state.settings.uiLocale || "auto";
    return setting === "auto" ? getAutoLocale() : normalizeUiLocale(setting);
  }

  function t(key) {
    const locale = getUiLocale();
    return UI_MESSAGES[locale]?.[key] || UI_MESSAGES.en[key] || key;
  }

  function getGenerationFailureUi(error) {
    const reason = promptSessionApi.mapReason(error, promptSessionApi.REASONS.GENERATION_FAILED);
    if (reason === promptSessionApi.REASONS.CREDENTIAL_INVALID) {
      return { reason, statusKey: "statusCredentialInvalid", serviceState: "configuration-error" };
    }
    if (reason === promptSessionApi.REASONS.MODEL_UNAVAILABLE) {
      return { reason, statusKey: "statusModelUnavailable", serviceState: "configuration-error" };
    }
    if (reason === promptSessionApi.REASONS.NETWORK_UNAVAILABLE) {
      return { reason, statusKey: "statusNetworkUnavailable", serviceState: "offline" };
    }
    if (reason === promptSessionApi.REASONS.PROVIDER_ERROR) {
      return { reason, statusKey: "statusProviderError", serviceState: "degraded" };
    }
    return { reason, statusKey: "statusServiceOffline", serviceState: "offline" };
  }

  function getBrowserTargetCapability() {
    const adapter = getCurrentSiteAdapter();
    if (state.activeInput && isVisible(state.activeInput) && siteAdapters?.isWritableInputCandidate?.(state.activeInput, adapter)) {
      return {
        status: promptSessionApi.TARGET_STATUSES.READY,
        level: promptSessionApi.TARGET_CAPABILITIES.VERIFIED_WRITE,
        reason: promptSessionApi.REASONS.NONE,
        targetKind: adapter?.id === "chatgpt" ? "chatgpt-composer" : `${adapter?.id || "generic"}-input`
      };
    }
    return {
      status: promptSessionApi.TARGET_STATUSES.MISSING,
      level: promptSessionApi.TARGET_CAPABILITIES.COPY_ONLY,
      reason: promptSessionApi.REASONS.TARGET_MISSING,
      targetKind: "unknown"
    };
  }

  function applyProductView(viewModel) {
    state.productView = viewModel;
    document.documentElement.dataset.smartPromptAssistantState = viewModel.state;
    document.documentElement.dataset.smartPromptAssistantReason = viewModel.reason.code;
    document.documentElement.dataset.smartPromptAssistantVerification = viewModel.verification;
    document.documentElement.dataset.smartPromptNoAutoSubmit = String(viewModel.noAutoSubmit);
    document.documentElement.dataset.smartPromptContractVersion = viewModel.contractVersion;
    if (!state.card) return viewModel;

    state.card.dataset.assistantState = viewModel.state;
    state.card.dataset.assistantReason = viewModel.reason.code;
    state.card.dataset.noAutoSubmit = String(viewModel.noAutoSubmit);
    state.card.dataset.generatedBy = state.generatedBy;
    state.card.lang = viewModel.locale;
    state.assistantCard?.render(viewModel, {
      value: state.editorValue,
      mode: state.manualMode || viewModel.mode
    });
    return viewModel;
  }

  function ensureProductSession() {
    if (state.productSession) return state.productSession;
    state.productSession = promptSessionApi.createPromptSession({
      settings: { locale: getUiLocale() }
    });
    state.productSession.subscribe(applyProductView);
    return state.productSession;
  }

  function syncProductSession(type, detail = {}) {
    return ensureProductSession().dispatch({ type, ...detail });
  }

  function syncProductSnapshot(patch = {}) {
    const current = state.productView || promptSessionApi.createViewModel({ locale: getUiLocale() });
    return syncProductSession(promptSessionApi.COMMANDS.SYNC, {
      snapshot: {
        state: current.state,
        locale: getUiLocale(),
        draft: current.draft,
        prompt: current.prompt,
        mode: current.mode,
        reason: current.reason.code,
        targetCapability: current.target,
        verification: current.verification,
        manualConfirmationRequired: current.manualConfirmationRequired,
        noAutoSubmit: current.noAutoSubmit,
        canUndo: current.canUndo,
        ...patch
      }
    });
  }

  function modeLabel(mode) {
    if (engine.getModeMeta) return engine.getModeMeta(mode, getUiLocale()).label;
    return engine.MODE_META[mode]?.label || mode;
  }

  function sourceLabel(source) {
    const raw = String(source || "template");
    if (raw.includes("llm")) return "LLM";
    if (raw.includes("template-fallback")) return t("sourceTemplateFallback");
    if (raw === "service") return t("sourceService");
    if (raw === "template") return t("sourceTemplate");
    return raw;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set(values, resolve);
    });
  }

  function assetUrl(path) {
    return chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : path;
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 24 && rect.height > 18 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isInsideSmartPromptUi(element) {
    let current = element;
    while (current) {
      if (current.closest?.("#smart-prompt-card, #smart-prompt-mascot, #smart-prompt-undo")) return true;
      const root = current.getRootNode?.();
      current = root?.host || null;
    }
    return false;
  }

  function isTextInput(element) {
    if (!element || !(element instanceof Element)) return false;
    if (isInsideSmartPromptUi(element)) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "url", "email"].includes(type);
    }
    if (element.isContentEditable) return true;
    const contentEditable = (element.getAttribute("contenteditable") || "").toLowerCase();
    if (contentEditable && contentEditable !== "false") return true;
    return element.getAttribute("role") === "textbox";
  }

  function resolveTextInputTarget(element) {
    if (!element || !(element instanceof Element) || isInsideSmartPromptUi(element)) return null;
    if (isTextInput(element)) return element;
    const closest = element.closest?.('textarea, input[type="text"], input[type="search"], input[type="url"], input[type="email"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
    return isTextInput(closest) ? closest : null;
  }

  function queryInputs() {
    const adapter = siteAdapters?.detectSiteAdapter(location.hostname);
    const candidates = siteAdapters?.queryInputCandidates
      ? siteAdapters.queryInputCandidates(document, adapter)
      : Array.from(document.querySelectorAll('textarea, input[type="text"], input[type="search"], input[type="url"], input[type="email"], [contenteditable="true"], [role="textbox"]'));
    return [...new Set(candidates)].filter((element) => isTextInput(element) && isVisible(element));
  }

  function getInputText(element) {
    if (!element) return "";
    if ("value" in element) return element.value || "";
    return element.innerText || element.textContent || "";
  }

  function setInputText(element, value) {
    if (!element) return { ok: false, verified: false, reason: "missing_input" };
    const adapter = siteAdapters?.detectSiteAdapter(location.hostname);
    if (siteAdapters?.writeInput) return siteAdapters.writeInput(element, value, adapter);
    return { ok: false, verified: false, reason: "missing_adapter_writer" };
  }

  async function verifyStableInputWrite(element, value, result) {
    if (!result?.verified || !siteAdapters?.verifyStableWrite) return result;
    let stableResult = result;
    for (const delayMs of STABLE_READBACK_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      stableResult = siteAdapters.verifyStableWrite(stableResult, element, value);
      if (!stableResult?.verified) return stableResult;
    }
    return stableResult;
  }

  function getEventTarget(event) {
    return event.composedPath?.()[0] || event.target;
  }

  function getPathKind() {
    const segments = location.pathname.split("/").filter(Boolean).length;
    if (segments === 0) return "root";
    if (segments === 1) return "one-segment";
    return "multi-segment";
  }

  function getContext(element) {
    const adapter = siteAdapters?.detectSiteAdapter(location.hostname);
    return {
      host: location.hostname,
      origin: location.origin,
      tool: adapter?.tool || engine.detectTool(location.hostname, document.title),
      adapterId: adapter?.id || "generic",
      inputKind: element?.tagName?.toLowerCase() || (element?.isContentEditable ? "contenteditable" : "textbox"),
      pathKind: getPathKind(),
      locale: getUiLocale()
    };
  }

  function setMascotState(name) {
    if (!state.mascot) return;
    const img = state.mascot.querySelector("img");
    img.src = assetUrl(mascotMap[name] || mascotMap.normal);
    state.mascot.dataset.state = name;
  }

  function createMascot() {
    if (state.mascot) return state.mascot;
    const button = document.createElement("button");
    button.id = "smart-prompt-mascot";
    button.type = "button";
    button.dataset.state = "resting";
    button.setAttribute("aria-label", t("productName"));
    button.innerHTML = `<img alt="" src="${assetUrl(mascotMap.resting)}"><span class="spc-pulse"></span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPromptCard();
    });
    document.documentElement.appendChild(button);
    state.mascot = button;
    return button;
  }

  function placeMascot() {
    if (!state.activeInput || !state.mascot || !isVisible(state.activeInput)) return;
    const rect = state.activeInput.getBoundingClientRect();
    const size = 60;
    const left = Math.min(window.innerWidth - size - 12, Math.max(12, rect.right - size + 10));
    const top = Math.min(window.innerHeight - size - 12, Math.max(12, rect.bottom - size * 0.62));
    state.mascot.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function onFocus(event) {
    const target = resolveTextInputTarget(getEventTarget(event));
    if (!state.settings.enabled || !isTextInput(target) || !isVisible(target)) return;
    const adapter = siteAdapters?.detectSiteAdapter(location.hostname);
    if (!siteAdapters?.isWritableInputCandidate?.(target, adapter)) return;
    state.debug.focusEvents += 1;
    state.debug.lastFocusTag = target.tagName || "";
    state.debug.lastFocusHost = location.hostname;
    state.debug.lastFocusKind = target.isContentEditable ? "contenteditable" : target.tagName?.toLowerCase() || "";
    state.debug.lastAdapterId = adapter?.id || "generic";
    state.activeInput = target;
    createMascot();
    setMascotState(engine.detectMode(getInputText(target)) === engine.MODE.IDEA ? "normal" : "resting");
    state.mascot.classList.add("is-visible");
    placeMascot();
  }

  function onInput(event) {
    const target = resolveTextInputTarget(getEventTarget(event));
    if (!target || !isVisible(target)) return;
    if (target !== state.activeInput) {
      onFocus({ target });
    }
    if (target !== state.activeInput) return;
    setMascotState(engine.detectMode(getInputText(state.activeInput)) === engine.MODE.IDEA ? "normal" : "resting");
    if (state.suppressInputRefresh) return;
    if (state.card) refreshCardPreview(false);
  }

  function getDeepActiveElement(root = document) {
    let active = root.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  function refreshDeepActiveInput() {
    state.debug.deepActiveChecks += 1;
    const focused = getDeepActiveElement();
    if (focused && focused !== state.activeInput) {
      onFocus({ target: focused });
    }
  }

  function closeCard() {
    if (state.card) {
      state.assistantCard?.destroy();
      state.card.remove();
      state.card = null;
      state.assistantCard = null;
    }
  }

  function closeUndoToast() {
    document.getElementById("smart-prompt-undo")?.remove();
  }

  function modeClass(mode) {
    return `mode-${mode}`;
  }

  function renderSkillChips(skills) {
    return (skills || [])
      .map((skill) => `<span class="spc-chip" title="${escapeHtml(skill.description || "")}">${escapeHtml(skill.name)}</span>`)
      .join("");
  }

  function renderOutcomeControls(action = "outcome") {
    const reasonAction = action === "toast-outcome" ? "toast-failure-reason" : "failure-reason";
    const quickAction = action === "toast-outcome" ? "quick-toast-outcome" : "quick-outcome";
    const quickButtons = QUICK_OUTCOME_OPTIONS
      .map((option) => (
        `<button type="button" class="spc-outcome-quick-button" data-action="${escapeHtml(quickAction)}" data-outcome-label="${escapeHtml(option.label)}" data-outcome-quick="true" aria-pressed="false" title="${escapeHtml(t(option.labelKey))}">${option.icon}</button>`
      ))
      .join("");
    const buttons = Object.entries(OUTCOME_OPTIONS)
      .map(([label, option]) => (
        `<button type="button" data-action="${escapeHtml(action)}" data-outcome-label="${escapeHtml(label)}" aria-pressed="false" title="${escapeHtml(t(option.labelKey))}">${escapeHtml(t(option.labelKey))}</button>`
      ))
      .join("");
    const reasonButtons = FAILURE_REASON_OPTIONS
      .map((option) => (
        `<button type="button" data-action="${escapeHtml(reasonAction)}" data-failure-reason-token="${escapeHtml(option.token)}" aria-pressed="false" title="${escapeHtml(t(option.labelKey))}">${escapeHtml(t(option.labelKey))}</button>`
      ))
      .join("");
    return [
      `<div class="spc-outcome-head">`,
      `<span class="spc-outcome-label">${escapeHtml(t("outcome"))}</span>`,
      `<div class="spc-outcome-quick" aria-label="${escapeHtml(t("outcomeQuick"))}">${quickButtons}</div>`,
      `</div>`,
      `<div class="spc-outcome-actions">${buttons}</div>`,
      `<div class="spc-reason-row" hidden aria-hidden="true">`,
      `<span class="spc-reason-label">${escapeHtml(t("failureReason"))}</span>`,
      `<div class="spc-reason-actions">${reasonButtons}</div>`,
      `</div>`
    ].join("");
  }

  function isFailureOutcome(label) {
    return label === "needs-work" || label === "failed";
  }

  function normalizeFailureReasonToken(value, fallback = "low_quality") {
    const token = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (FAILURE_REASON_TOKENS.has(token)) return token;
    return FAILURE_REASON_TOKENS.has(fallback) ? fallback : "low_quality";
  }

  function setFailureReasonSelection(token, outcome = state.card?.querySelector(".spc-outcome")) {
    if (!outcome) return "";
    const normalized = normalizeFailureReasonToken(token);
    outcome.dataset.failureReasonToken = normalized;
    outcome.querySelectorAll("button[data-failure-reason-token]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.failureReasonToken === normalized ? "true" : "false");
    });
    return normalized;
  }

  function setOutcomeSelection(label, outcome = state.card?.querySelector(".spc-outcome"), options = {}) {
    if (!outcome) return;
    outcome.dataset.selected = label || "";
    outcome.querySelectorAll("button[data-outcome-label]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.outcomeLabel === label ? "true" : "false");
    });
    const reasonRow = outcome.querySelector(".spc-reason-row");
    const showReasons = isFailureOutcome(label) && options.showReasons !== false;
    if (reasonRow) {
      reasonRow.hidden = !showReasons;
      reasonRow.setAttribute("aria-hidden", showReasons ? "false" : "true");
    }
    if (showReasons) {
      setFailureReasonSelection(outcome.dataset.failureReasonToken || "low_quality", outcome);
    } else {
      outcome.dataset.failureReasonToken = "";
      outcome.querySelectorAll("button[data-failure-reason-token]").forEach((button) => {
        button.setAttribute("aria-pressed", "false");
      });
    }
  }

  async function recordManualOutcome(outcomeLabel, source, detail = {}) {
    const option = OUTCOME_OPTIONS[outcomeLabel];
    if (!option) return false;
    const success = outcomeLabel === "success";
    const failureReasonToken = success
      ? ""
      : detail.failureReasonToken ? normalizeFailureReasonToken(detail.failureReasonToken) : "";
    await recordFeedbackEvent("outcome", {
      ok: success,
      verified: success,
      reason: failureReasonToken ? `${source}_${failureReasonToken}` : `${source}_${outcomeLabel}`,
      failureReason: failureReasonToken,
      failureReasonToken,
      outcomeLabel,
      outcomeScore: option.score,
      outcomeVerified: true,
      outcomeSource: source
    });
    setMascotState(success ? "clapping" : "normal");
    return true;
  }

  function renderEvidence(card, context, generatedBy) {
    const skillReasons = (card.skills || [])
      .slice(0, 3)
      .map((skill) => {
        const tags = Array.isArray(skill.reason?.matchedTokens) && skill.reason.matchedTokens.length
          ? skill.reason.matchedTokens.slice(0, 3).join(",")
          : Array.isArray(skill.tags) ? skill.tags.slice(0, 3).join(",") : "";
        const score = Number.isFinite(skill.score) ? ` ${t("score")} ${skill.score.toFixed(1)}` : "";
        return `${skill.name}${score}${tags ? ` (${tags})` : ""}`;
      })
      .join(" · ") || t("none");
    const privacy = [
      context.origin || context.host,
      `${t("path")}:${context.pathKind || t("unknown")}`,
      t("noTitle"),
      t("noPageBody")
    ].filter(Boolean).join(" · ");
    return [
      `<div><strong>${escapeHtml(t("basis"))}</strong> ${escapeHtml(skillReasons)}</div>`,
      `<div><strong>${escapeHtml(t("privacy"))}</strong> ${escapeHtml(privacy)}</div>`,
      `<div><strong>${escapeHtml(t("source"))}</strong> ${escapeHtml(sourceLabel(generatedBy))}</div>`
    ].join("");
  }

  function renderCard(card, context, generatedBy) {
    if (!state.card) return;
    const displayMode = context?.mode || state.manualMode || card.mode;
    const displayContext = { ...(context || {}), mode: displayMode };
    const displayCard = { ...card, mode: displayMode };
    state.lastPrompt = displayCard.prompt;
    state.lastContext = displayContext;
    const source = generatedBy || displayCard.generatedBy || "template";
    const experiment = displayCard.qualityExperiment || {};
    const qualityScore = Number(displayCard.quality?.score ?? experiment.qualityScore);
    const baselineQualityScore = String(displayCard.prompt || "").length >= 160 ? 0.72 : null;
    const promptStrategyId = experiment.promptStrategyId || displayCard.promptStrategyPlan?.selectedStrategy?.id || `${source}:${displayMode}:client-structure`;
    const promptStrategyVersion = experiment.promptStrategyVersion || displayCard.promptStrategyPlan?.selectedStrategy?.version || "client-template";
    const experimentVersion = experiment.experimentVersion || displayCard.experimentAssignment?.experimentVersion || "client-template-experiment-1";
    const experimentArm = experiment.experimentArm || displayCard.experimentAssignment?.arm || "baseline_structure";
    const strategyWeightPolicy = displayCard.strategyWeightPolicy || displayCard.promptStrategyPlan?.strategyWeightPolicy || {};
    const promptStrategyDecision = displayCard.promptStrategyPlan?.selectedStrategy?.decision || "";
    const strategyWeightVersion = experiment.strategyWeightVersion || strategyWeightPolicy.weightPolicyVersion || displayCard.promptStrategyPlan?.strategyPolicy?.strategyWeightVersion || "";
    const strategyWeightPromoted = experiment.strategyWeightPromoted || strategyWeightPolicy.selectedPromotion?.strategyId || "";
    const qualityLiftCohort = experiment.qualityLiftCohort
      || (experimentArm === "baseline_structure"
        ? "baseline_structure"
        : strategyWeightVersion && (promptStrategyDecision === "outcome_weight" || (strategyWeightPromoted && promptStrategyId === "preserve_winning_strategy"))
          ? "outcome_weighted"
          : experimentArm === "strategy_guided" ? "strategy_guided" : experimentArm);
    const taskScenario = experiment.taskScenario
      || displayCard.taskScenario
      || displayCard.promptStrategyPlan?.cohort?.taskScenario
      || displayCard.strategyInsights?.cohort?.taskScenario
      || displayCard.experimentAssignment?.cohort?.taskScenario
      || displayContext.taskScenario
      || "general";
    state.lastGenerationMeta = {
      generationId: displayCard.generationId || experiment.generationId || `client-${state.generationRequestId}-${Date.now()}`,
      strategyId: displayCard.strategyId || experiment.strategyId || `${source}:${displayMode}:client`,
      taskScenario,
      qualityScore: Number.isFinite(qualityScore) ? qualityScore : baselineQualityScore,
      feedbackConfidence: displayCard.feedbackProfile?.confidence || experiment.feedbackConfidence || "",
      promptStrategyId,
      promptStrategyVersion,
      experimentVersion,
      experimentArm,
      experimentEligible: experiment.experimentEligible ?? displayCard.experimentAssignment?.eligible ?? null,
      experimentBucket: experiment.experimentBucket ?? displayCard.experimentAssignment?.bucket ?? null,
      experimentComparisonKey: experiment.experimentComparisonKey || displayCard.experimentAssignment?.comparisonKey || `${experimentVersion}:${displayMode}:${displayContext.adapterId || displayContext.host || "client"}:${promptStrategyId}`,
      strategyInsightsVersion: experiment.strategyInsightsVersion || displayCard.strategyInsights?.insightVersion || "client-local-insights-0",
      strategyReadiness: experiment.strategyReadiness || displayCard.strategyInsights?.readiness?.status || "none",
      strategyWeightVersion,
      strategyWeightStatus: experiment.strategyWeightStatus || strategyWeightPolicy.readiness?.status || "",
      strategyWeightPromoted,
      strategyWeightSuppressed: experiment.strategyWeightSuppressed || strategyWeightPolicy.selectedSuppression?.strategyId || "",
      strategyWeightDecision: experiment.strategyWeightDecision || promptStrategyDecision,
      qualityLiftCohort
    };
    state.editorValue = displayCard.prompt;
    state.generatedBy = source;
    state.card.dataset.generatedBy = source;
    state.card.dataset.serviceState = "";
    syncProductSession(promptSessionApi.COMMANDS.GENERATION_SUCCEEDED, {
      prompt: displayCard.prompt,
      mode: displayMode
    });
    setCardStatus(t("statusReady"), "ready");
  }

  function setCardStatus(text, status) {
    if (!state.card) return;
    const statusLine = state.card.querySelector(".spc-status");
    if (statusLine) statusLine.textContent = text;
    state.card.dataset.status = status || "";
  }

  function createFavoritePrompt(prompt) {
    const mode = state.lastContext?.mode || engine.detectMode(state.lastInputText);
    return {
      id: `prompt-${Date.now()}`,
      title: `${modeLabel(mode)} prompt`,
      body: prompt,
      mode,
      source: "browser-extension",
      created_at: new Date().toISOString(),
      context: state.lastContext
    };
  }

  async function saveFavoriteLocally(favorite) {
    const existing = await storageGet([STORAGE_KEYS.favorites]);
    const favorites = Array.isArray(existing[STORAGE_KEYS.favorites]) ? existing[STORAGE_KEYS.favorites] : [];
    favorites.unshift(favorite);
    await storageSet({ [STORAGE_KEYS.favorites]: favorites.slice(0, 50) });
    return favorite;
  }

  async function saveFavoritePrompt(prompt) {
    const favorite = createFavoritePrompt(prompt);
    if (state.settings.preferLocalService && localService?.savePrompt) {
      try {
        await localService.savePrompt(favorite, state.settings.serviceUrl);
        return favorite;
      } catch {
        // Fall back to the extension-local library when the desktop service is offline.
      }
    }
    return saveFavoriteLocally(favorite);
  }

  async function recordFeedbackEvent(action, detail) {
    const generationMeta = state.lastGenerationMeta || {};
    const event = {
      id: `feedback-${Date.now()}`,
      action,
      created_at: new Date().toISOString(),
      mode: state.lastContext?.mode || engine.detectMode(state.lastInputText),
      tool: state.lastContext?.tool || "",
      adapterId: state.lastContext?.adapterId || "",
      site: location.hostname,
      taskScenario: generationMeta.taskScenario || state.lastContext?.taskScenario || "",
      generatedBy: state.generatedBy || "",
      generationId: generationMeta.generationId || "",
      strategyId: generationMeta.strategyId || "",
      promptStrategyId: generationMeta.promptStrategyId || "",
      promptStrategyVersion: generationMeta.promptStrategyVersion || "",
      experimentVersion: generationMeta.experimentVersion || "",
      experimentArm: generationMeta.experimentArm || "",
      experimentEligible: generationMeta.experimentEligible === null ? null : Boolean(generationMeta.experimentEligible),
      experimentBucket: Number.isFinite(Number(generationMeta.experimentBucket)) ? Number(generationMeta.experimentBucket) : null,
      experimentComparisonKey: generationMeta.experimentComparisonKey || "",
      strategyInsightsVersion: generationMeta.strategyInsightsVersion || "",
      strategyReadiness: generationMeta.strategyReadiness || "",
      strategyWeightVersion: generationMeta.strategyWeightVersion || "",
      strategyWeightStatus: generationMeta.strategyWeightStatus || "",
      strategyWeightPromoted: generationMeta.strategyWeightPromoted || "",
      strategyWeightSuppressed: generationMeta.strategyWeightSuppressed || "",
      strategyWeightDecision: generationMeta.strategyWeightDecision || "",
      qualityLiftCohort: generationMeta.qualityLiftCohort || "",
      qualityScore: generationMeta.qualityScore,
      feedbackConfidence: generationMeta.feedbackConfidence || "",
      source: "browser-extension",
      ok: detail?.ok === true || detail?.verified === true || action === "card_ready" || action === "save",
      adopted: action === "insert" && detail?.verified === true,
      verified: Boolean(detail?.verified),
      insertStrategy: detail?.strategy || "",
      kind: detail?.kind || "",
      failureReason: detail?.failureReasonToken
        ? (detail?.failureReason || detail.failureReasonToken)
        : (action === "outcome" ? "" : (detail?.failureReason || detail?.reason || "")),
      failureReasonToken: detail?.failureReasonToken || "",
      outcomeLabel: detail?.outcomeLabel || detail?.outcome || "",
      outcomeScore: Number.isFinite(Number(detail?.outcomeScore)) ? Number(detail.outcomeScore) : null,
      outcomeVerified: Boolean(detail?.outcomeVerified),
      outcomeSource: detail?.outcomeSource || "",
      promptLength: String(state.lastPrompt || "").length,
      detail: {
        strategy: detail?.strategy || "",
        kind: detail?.kind || "",
        verified: Boolean(detail?.verified),
        reason: detail?.reason || "",
        failureReasonToken: detail?.failureReasonToken || "",
        outcomeLabel: detail?.outcomeLabel || detail?.outcome || "",
        outcomeVerified: Boolean(detail?.outcomeVerified)
      }
    };
    const existing = await storageGet([STORAGE_KEYS.feedback]);
    const events = Array.isArray(existing[STORAGE_KEYS.feedback]) ? existing[STORAGE_KEYS.feedback] : [];
    events.unshift(event);
    await storageSet({ [STORAGE_KEYS.feedback]: events.slice(0, 100) });
    if (state.settings.preferLocalService && localService?.recordMetric) {
      localService.recordMetric(event, state.settings.serviceUrl).catch(() => {
        // Local metrics are best-effort; extension-local feedback remains the fallback.
      });
    }
  }

  async function refreshCardPreview(advanceVariant) {
    if (!state.card || !state.activeInput) return;
    if (advanceVariant) state.variant += 1;
    const requestId = state.generationRequestId + 1;
    state.generationRequestId = requestId;
    syncProductSession(promptSessionApi.COMMANDS.GENERATION_STARTED);

    const inputText = getInputText(state.activeInput);
    const detectedMode = engine.detectMode(inputText);
    const context = {
      ...getContext(state.activeInput),
      mode: state.manualMode || detectedMode
    };
    const card = engine.buildCard(inputText, context, state.importedSkills, state.variant);
    state.lastInputText = inputText;
    renderCard(card, context, "template");
    await recordFeedbackEvent("card_ready", { verified: true, reason: "template_ready" });

    if (!state.settings.preferLocalService || !localService?.generate) return;

    try {
      syncProductSession(promptSessionApi.COMMANDS.GENERATION_STARTED);
      setCardStatus(t("statusGenerating"), "loading");
      setMascotState("thinking");
      if (state.activationBrowserSeenPromise) await state.activationBrowserSeenPromise;
      if (!state.activationBrowserSeen) await markActivationBrowserSeen({ flushPending: false });
      const modelBackedActivationRequired = activationEvidence?.requiresModelBackedActivation?.(
        getCurrentSiteAdapter(),
        state.activationCompleted
      ) === true;
      const result = await localService.generate({
        input: inputText,
        context,
        variantIndex: state.variant,
        allowTemplateFallback: !modelBackedActivationRequired
      }, state.settings.serviceUrl);
      if (requestId === state.generationRequestId && state.activeInput && getInputText(state.activeInput) === inputText) {
        renderCard(result.card, context, result.card.generatedBy || "service");
        setMascotState("suggesting");
      }
    } catch (error) {
      if (requestId !== state.generationRequestId || !state.card || !state.activeInput || getInputText(state.activeInput) !== inputText) {
        return;
      }
      const failure = getGenerationFailureUi(error);
      if (state.card) state.card.dataset.serviceState = failure.serviceState;
      syncProductSnapshot({ state: promptSessionApi.STATES.REVIEW, reason: failure.reason });
      setCardStatus(t(failure.statusKey), "failed");
      setMascotState("suggesting");
    }
  }

  function openPromptCard() {
    if (!state.activeInput || !isVisible(state.activeInput)) {
      const fallback = queryInputs()[0];
      if (!fallback) return;
      state.activeInput = fallback;
    }

    closeCard();
    closeUndoToast();
    markActivationBrowserSeen();
    state.manualMode = "";
    state.editorValue = getInputText(state.activeInput);
    setMascotState("thinking");
    const panel = document.createElement("section");
    panel.id = "smart-prompt-card";
    panel.lang = getUiLocale();
    panel.setAttribute("aria-label", t("promptCard"));
    document.documentElement.appendChild(panel);
    state.card = panel;
    state.assistantCard = assistantUi.mountAssistantCard(panel, {
      stylesheetUrl: assetUrl("src/assistant-card.css"),
      mascotUrl: assetUrl(mascotMap.suggesting),
      value: state.editorValue,
      mode: state.manualMode || engine.detectMode(state.editorValue),
      onAction: handleCardAction,
      onChange({ value }) {
        state.editorValue = value;
        state.lastPrompt = value;
      },
      onModeChange({ mode }) {
        state.manualMode = mode;
        setMascotState("thinking");
        refreshCardPreview(false);
      }
    });
    ensureProductSession().open({
      draft: getInputText(state.activeInput),
      mode: state.manualMode || engine.detectMode(getInputText(state.activeInput)),
      locale: getUiLocale(),
      targetCapability: getBrowserTargetCapability(),
      noAutoSubmit: true
    });
    placeCard();
    refreshCardPreview(false);
    setMascotState("suggesting");
  }

  async function insertPromptIntoActiveInput(prompt) {
    syncProductSnapshot({ prompt, targetCapability: getBrowserTargetCapability() });
    syncProductSession(promptSessionApi.COMMANDS.INSERT_STARTED);
    const previousValue = getInputText(state.activeInput);
    state.suppressInputRefresh = true;
    let result;
    try {
      result = await setInputText(state.activeInput, prompt);
      result = await verifyStableInputWrite(state.activeInput, prompt, result);
    } finally {
      state.suppressInputRefresh = false;
    }
    const activeAdapter = getCurrentSiteAdapter();
    const ok = Boolean(result?.ok && result?.verified && (
      activeAdapter?.id !== "chatgpt" || result?.targetKind === "chatgpt-composer"
    ));
    state.debug.lastInsertResult = result;
    publishInsertEvidence(result);
    await recordFeedbackEvent("insert", result);
    setMascotState(ok ? "success" : "resting");
    if (ok) {
      await completeActivationFromEvidence("verified_insert", result);
      state.undoSnapshot = {
        input: state.activeInput,
        previousValue,
        insertedValue: prompt,
        createdAt: Date.now()
      };
      document.documentElement.dataset.smartPromptUndoAvailable = "true";
      syncProductSession(promptSessionApi.COMMANDS.INSERT_SUCCEEDED, {
        result: {
          ...result,
          attempted: true,
          verified: true,
          verification: promptSessionApi.VERIFICATIONS.MACHINE,
          noAutoSubmit: true,
          reason: "inserted"
        }
      });
      setCardStatus(t("inserted"), "ready");
      return;
    }
    syncProductSession(promptSessionApi.COMMANDS.INSERT_FAILED, {
      reason: result?.reason || promptSessionApi.REASONS.INSERT_FAILED,
      noAutoSubmit: true
    });
    setCardStatus(t("statusInsertFailed"), "failed");
  }

  async function handleCardAction(event) {
    const button = event?.target?.closest?.("button[data-action]") || null;
    const action = event?.id || button?.dataset?.action || "";
    if (!action) return;
    const prompt = String(event?.value ?? state.assistantCard?.getValue() ?? state.lastPrompt ?? "");

    if (action === "cancel") {
      state.generationRequestId += 1;
      syncProductSession(promptSessionApi.COMMANDS.CANCEL);
      setMascotState("normal");
      return;
    }

    if (action === "generate" || action === "regenerate") {
      setMascotState("thinking");
      refreshCardPreview(action === "regenerate");
      return;
    }

    if (action === "retry-target") {
      const target = state.activeInput && isVisible(state.activeInput) ? state.activeInput : queryInputs()[0];
      if (target) state.activeInput = target;
      const capability = getBrowserTargetCapability();
      syncProductSession(promptSessionApi.COMMANDS.TARGET_UPDATED, { targetCapability: capability });
      if (capability.status === promptSessionApi.TARGET_STATUSES.READY && prompt) {
        syncProductSnapshot({
          state: promptSessionApi.STATES.REVIEW,
          prompt,
          reason: promptSessionApi.REASONS.NONE,
          targetCapability: capability
        });
      }
      return;
    }

    if (action === "complete") {
      closeCard();
      setMascotState("resting");
      return;
    }

    if (action === "close") {
      closeCard();
      setMascotState("resting");
      return;
    }

    if (action === "undo") {
      await handleUndoAction();
      return;
    }

    if (action === "view-reason") {
      state.card.dataset.reasonViewed = "true";
      return;
    }

    if (action === "diagnostics") {
      globalThis.chrome?.runtime?.openOptionsPage?.();
      return;
    }

    if (action === "outcome" || action === "quick-outcome") {
      const outcomeLabel = button.dataset.outcomeLabel || "";
      const isQuickOutcome = action === "quick-outcome" || button.dataset.outcomeQuick === "true";
      if (isFailureOutcome(outcomeLabel) && !isQuickOutcome) {
        setOutcomeSelection(outcomeLabel);
        setCardStatus(t("statusChooseReason"), "ready");
        return;
      }
      const recorded = await recordManualOutcome(outcomeLabel, "manual_card");
      if (!recorded) return;
      setOutcomeSelection(outcomeLabel, undefined, { showReasons: !isQuickOutcome });
      setCardStatus(t("statusOutcomeSaved"), "ready");
      return;
    }

    if (action === "failure-reason") {
      const outcome = button.closest(".spc-outcome");
      const outcomeLabel = outcome?.dataset.selected || "";
      if (!isFailureOutcome(outcomeLabel)) return;
      const failureReasonToken = setFailureReasonSelection(button.dataset.failureReasonToken, outcome);
      const recorded = await recordManualOutcome(outcomeLabel, "manual_card", { failureReasonToken });
      if (!recorded) return;
      setCardStatus(t("statusOutcomeSaved"), "ready");
      return;
    }

    if (action === "refresh") {
      setMascotState("thinking");
      refreshCardPreview(true);
      setTimeout(() => setMascotState("suggesting"), 160);
      return;
    }

    if (action === "retry") {
      if (state.productView?.reason.code === promptSessionApi.REASONS.INSERT_FAILED && prompt) {
        await insertPromptIntoActiveInput(prompt);
        return;
      }
      setMascotState("thinking");
      setCardStatus(t("statusRetrying"), "loading");
      await recordFeedbackEvent("retry", { verified: false, reason: "manual_retry" });
      refreshCardPreview(false);
      return;
    }

    if (action === "edit") {
      state.assistantCard?.focusEditor();
      setMascotState("normal");
      return;
    }

    if (action === "copy") {
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(prompt);
          copied = true;
        }
      } catch {
        copied = false;
      }
      await recordFeedbackEvent("copy", {
        verified: copied,
        reason: copied ? "clipboard_verified" : "clipboard_unavailable"
      });
      if (copied) await completeActivationFromEvidence("copy");
      setMascotState("clapping");
      return;
    }

    if (action === "favorite") {
      await saveFavoritePrompt(prompt);
      await recordFeedbackEvent("save", { verified: true, reason: "favorite_saved" });
      setMascotState("clapping");
      return;
    }

    if (action === "insert") {
      await insertPromptIntoActiveInput(prompt);
    }
  }

  function showUndoToast() {
    closeUndoToast();
    const toast = document.createElement("div");
    toast.id = "smart-prompt-undo";
    const insertedView = state.productView || promptSessionApi.createViewModel({
      state: promptSessionApi.STATES.INSERTED,
      locale: getUiLocale(),
      noAutoSubmit: true,
      canUndo: true
    });
    const undoAction = insertedView.secondaryActions.find((item) => item.id === "undo");
    toast.dataset.assistantState = insertedView.state;
    toast.innerHTML = `
      <div class="spu-main">
        <span>${escapeHtml(insertedView.title)}</span>
        <button type="button" data-action="undo">${escapeHtml(undoAction?.label || t("undo"))}</button>
      </div>
      <div class="spc-outcome" aria-label="${escapeHtml(t("outcome"))}">${renderOutcomeControls("toast-outcome")}</div>
    `;
    toast.querySelector('button[data-action="undo"]').addEventListener("click", handleUndoAction);
    toast.querySelectorAll('button[data-action="toast-outcome"]').forEach((button) => {
      button.addEventListener("click", handleToastOutcomeAction);
    });
    toast.querySelectorAll('button[data-action="quick-toast-outcome"]').forEach((button) => {
      button.addEventListener("click", handleToastOutcomeAction);
    });
    toast.querySelectorAll('button[data-action="toast-failure-reason"]').forEach((button) => {
      button.addEventListener("click", handleToastFailureReasonAction);
    });
    document.documentElement.dataset.smartPromptUndoAvailable = "true";
    document.documentElement.appendChild(toast);
    placeUndoToast();
  }

  async function handleToastOutcomeAction(event) {
    const button = event.currentTarget;
    const outcomeLabel = button?.dataset?.outcomeLabel || "";
    const outcome = button.closest(".spc-outcome");
    const isQuickOutcome = button.dataset.outcomeQuick === "true";
    if (isFailureOutcome(outcomeLabel) && !isQuickOutcome) {
      setOutcomeSelection(outcomeLabel, outcome);
      document.documentElement.dataset.smartPromptDelayedOutcome = outcomeLabel;
      document.documentElement.dataset.smartPromptDelayedOutcomeSource = "manual_toast_pending";
      return;
    }
    const recorded = await recordManualOutcome(outcomeLabel, "manual_toast");
    if (!recorded) return;
    setOutcomeSelection(outcomeLabel, outcome, { showReasons: !isQuickOutcome });
    document.documentElement.dataset.smartPromptDelayedOutcome = outcomeLabel;
    document.documentElement.dataset.smartPromptDelayedOutcomeSource = "manual_toast";
  }

  async function handleToastFailureReasonAction(event) {
    const button = event.currentTarget;
    const outcome = button.closest(".spc-outcome");
    const outcomeLabel = outcome?.dataset.selected || "";
    if (!isFailureOutcome(outcomeLabel)) return;
    const failureReasonToken = setFailureReasonSelection(button.dataset.failureReasonToken, outcome);
    const recorded = await recordManualOutcome(outcomeLabel, "manual_toast", { failureReasonToken });
    if (!recorded) return;
    document.documentElement.dataset.smartPromptDelayedOutcome = outcomeLabel;
    document.documentElement.dataset.smartPromptDelayedOutcomeSource = "manual_toast";
    document.documentElement.dataset.smartPromptDelayedOutcomeReason = failureReasonToken;
  }

  async function handleUndoAction() {
    if (!state.undoSnapshot?.input) return;
    state.suppressInputRefresh = true;
    let result;
    try {
      result = await setInputText(state.undoSnapshot.input, state.undoSnapshot.previousValue || "");
    } finally {
      state.suppressInputRefresh = false;
    }
    const evidence = {
      ok: Boolean(result?.ok && result?.verified),
      verified: Boolean(result?.verified),
      valueLength: String(state.undoSnapshot.previousValue || "").length,
      reason: result?.reason || "undo_requested",
      createdAt: Date.now()
    };
    for (const [key, value] of Object.entries(evidence)) {
      document.documentElement.dataset[`smartPromptUndo${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
    }
    document.documentElement.dataset.smartPromptUndoAvailable = "false";
    await recordFeedbackEvent("undo", result);
    syncProductSession(
      result?.ok && result?.verified
        ? promptSessionApi.COMMANDS.UNDO_SUCCEEDED
        : promptSessionApi.COMMANDS.UNDO_FAILED,
      result?.ok && result?.verified
        ? { result: { ...result, noAutoSubmit: true } }
        : { reason: result?.reason || promptSessionApi.REASONS.UNDO_FAILED, noAutoSubmit: true }
    );
    state.undoSnapshot = null;
    closeUndoToast();
    setMascotState(result?.ok && result?.verified ? "suggesting" : "normal");
  }

  function publishInsertEvidence(result) {
    const evidence = {
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      kind: result?.kind || "",
      strategy: result?.strategy || "",
      reason: result?.reason || "",
      valueLength: Number(result?.valueLength || 0),
      stableReadback: Boolean(result?.stableReadback),
      targetKind: result?.targetKind || "unknown",
      createdAt: Date.now()
    };
    for (const [key, value] of Object.entries(evidence)) {
      document.documentElement.dataset[`smartPromptInsert${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
    }
    document.documentElement.dispatchEvent(new CustomEvent("smartprompt:insert-result", { detail: evidence }));
  }

  function placeCard() {
    if (!state.card || !state.activeInput) return;
    const rect = state.activeInput.getBoundingClientRect();
    const width = Math.min(380, Math.max(300, window.innerWidth - 24));
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    const cardHeight = Math.min(430, window.innerHeight - 24);
    const above = rect.top > cardHeight + 24;
    const top = above ? Math.max(12, rect.top - cardHeight - 10) : Math.min(window.innerHeight - cardHeight - 12, rect.bottom + 10);
    state.card.style.width = `${width}px`;
    state.card.style.height = `${Math.max(320, cardHeight)}px`;
    state.card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function placeUndoToast() {
    const toast = document.getElementById("smart-prompt-undo");
    if (!toast || !state.activeInput) return;
    const rect = state.activeInput.getBoundingClientRect();
    const width = Math.min(240, Math.max(180, window.innerWidth - 24));
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    const top = Math.min(window.innerHeight - 52, Math.max(12, rect.bottom + 12));
    toast.style.width = `${width}px`;
    toast.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function loadSettings() {
    const values = await storageGet([STORAGE_KEYS.skills, STORAGE_KEYS.settings]);
    state.importedSkills = Array.isArray(values[STORAGE_KEYS.skills]) ? values[STORAGE_KEYS.skills] : [];
    state.settings = {
      ...state.settings,
      ...(values[STORAGE_KEYS.settings] || {})
    };
  }

  function bindEvents() {
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("input", onInput, true);
    refreshDynamicBindings();
    state.dynamicScanTimer = setInterval(refreshDynamicBindings, 1000);
    setTimeout(() => {
      if (state.dynamicScanTimer) clearInterval(state.dynamicScanTimer);
      state.dynamicScanTimer = null;
    }, 30000);
    const observer = new MutationObserver(refreshDynamicBindings);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", () => {
      placeMascot();
      placeCard();
      placeUndoToast();
    });
    window.addEventListener("scroll", () => {
      placeMascot();
      placeCard();
      placeUndoToast();
    }, true);

    chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[STORAGE_KEYS.skills]) {
        state.importedSkills = changes[STORAGE_KEYS.skills].newValue || [];
      }
      if (changes[STORAGE_KEYS.settings]) {
        state.settings = { ...state.settings, ...(changes[STORAGE_KEYS.settings].newValue || {}) };
      }
    });
  }

  function refreshDynamicBindings() {
    bindShadowRootEvents(document);
    bindInputElementEvents(document);
  }

  function bindShadowRootEvents(root) {
    if (!root?.querySelectorAll) return;
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (!element.shadowRoot || state.observedShadowRoots.has(element.shadowRoot)) continue;
      state.observedShadowRoots.add(element.shadowRoot);
      state.debug.shadowBindings += 1;
      element.shadowRoot.addEventListener("focusin", onFocus, true);
      element.shadowRoot.addEventListener("input", onInput, true);
      bindShadowRootEvents(element.shadowRoot);
      bindInputElementEvents(element.shadowRoot);
    }
  }

  function bindInputElementEvents(root) {
    if (!root?.querySelectorAll) return;
    const adapter = siteAdapters?.detectSiteAdapter(location.hostname);
    const candidates = siteAdapters?.queryInputCandidates
      ? siteAdapters.queryInputCandidates(root, adapter)
      : Array.from(root.querySelectorAll('textarea, input[type="text"], input[type="search"], input[type="url"], input[type="email"], [contenteditable="true"], [role="textbox"]'));
    for (const element of candidates) {
      if (!isTextInput(element) || state.observedInputs.has(element)) continue;
      state.observedInputs.add(element);
      state.debug.inputBindings += 1;
      element.addEventListener("focus", onFocus, true);
      element.addEventListener("focusin", onFocus, true);
      element.addEventListener("input", onInput, true);
    }
  }

  async function start() {
    await loadSettings();
    void flushPendingActivation().catch(() => {
      document.documentElement.dataset.smartPromptActivationQueue = "retry_pending";
    });
    bindEvents();
    globalThis.__smartPromptDebug = state.debug;
    const focused = document.activeElement;
    const focusedInput = resolveTextInputTarget(focused);
    if (focusedInput && isVisible(focusedInput)) {
      onFocus({ target: focusedInput });
    }
    refreshDeepActiveInput();
    setTimeout(refreshDeepActiveInput, 500);
    setTimeout(refreshDeepActiveInput, 1500);
    setTimeout(refreshDeepActiveInput, 3500);
    globalThis.__smartPromptCopilotReady = true;
  }

  start();
})();
