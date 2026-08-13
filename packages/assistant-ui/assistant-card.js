(function initSmartPromptAssistantUI(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SmartPromptAssistantUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAssistantUIApi() {
  "use strict";

  const MODES = Object.freeze(["idea", "continue", "polish"]);
  const OUTCOME_FAILURE_REASONS = Object.freeze([
    "missing_context",
    "wrong_format",
    "not_actionable",
    "too_long",
    "token_waste",
    "tool_mismatch",
    "low_quality",
    "insert_failed"
  ]);
  const MODEL_ERROR_CODES = new Set([
    "credential_invalid",
    "model_unavailable",
    "model_invalid",
    "network_unavailable",
    "provider_error"
  ]);
  const COPY = Object.freeze({
    "zh-CN": Object.freeze({
      editorLabel: "提示词",
      idlePlaceholder: "写下你的目标或当前草稿",
      promptPlaceholder: "在填入前检查并编辑提示词",
      optionsLabel: "选项",
      closeLabel: "收起",
      safetyText: "只会填入，不会自动发送",
      safetyUnknown: "自动发送保护尚未确认",
      attentionLabel: "需要注意",
      outcomeQuestion: "上次是否帮助你完成任务？",
      outcomeCompleted: "完成了",
      outcomeNotCompleted: "还没有",
      outcomeReasonPrompt: "主要卡在哪里？",
      outcomeReasons: Object.freeze({
        missing_context: "缺少上下文",
        wrong_format: "格式不对",
        not_actionable: "无法直接执行",
        too_long: "太长",
        token_waste: "浪费 Token",
        tool_mismatch: "工具不匹配",
        low_quality: "质量不够",
        insert_failed: "填入失败"
      }),
      candidatePrompt: "发现一条可复用经验",
      candidateReview: "查看",
      candidateIgnore: "忽略",
      modelSettings: "打开模型设置",
      modelErrors: Object.freeze({
        credential_invalid: "模型凭证需要更新",
        model_unavailable: "当前模型不可用",
        model_invalid: "当前模型设置无效",
        network_unavailable: "暂时无法连接模型服务",
        provider_error: "模型服务暂时不可用"
      }),
      modes: Object.freeze({ idea: "构思", continue: "续写", polish: "润色" })
    }),
    en: Object.freeze({
      editorLabel: "Prompt",
      idlePlaceholder: "Describe your goal or keep the current draft",
      promptPlaceholder: "Review and edit the prompt before inserting",
      optionsLabel: "Options",
      closeLabel: "Collapse",
      safetyText: "Inserts only. Never sends automatically.",
      safetyUnknown: "Auto-submit protection is not confirmed.",
      attentionLabel: "Needs attention",
      outcomeQuestion: "Did the last prompt help you finish the task?",
      outcomeCompleted: "Completed",
      outcomeNotCompleted: "Not yet",
      outcomeReasonPrompt: "What was the main blocker?",
      outcomeReasons: Object.freeze({
        missing_context: "Missing context",
        wrong_format: "Wrong format",
        not_actionable: "Not actionable",
        too_long: "Too long",
        token_waste: "Wasted tokens",
        tool_mismatch: "Wrong tool",
        low_quality: "Low quality",
        insert_failed: "Insert failed"
      }),
      candidatePrompt: "Reusable experience found",
      candidateReview: "Review",
      candidateIgnore: "Ignore",
      modelSettings: "Open model settings",
      modelErrors: Object.freeze({
        credential_invalid: "Model credentials need attention",
        model_unavailable: "The selected model is unavailable",
        model_invalid: "The model setting is invalid",
        network_unavailable: "The model service cannot be reached",
        provider_error: "The model service is temporarily unavailable"
      }),
      modes: Object.freeze({ idea: "Idea", continue: "Continue", polish: "Polish" })
    })
  });

  function normalizeLocale(locale) {
    return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  }

  function normalizeMode(mode) {
    const token = String(mode || "").toLowerCase();
    return MODES.includes(token) ? token : "idea";
  }

  function normalizeAction(action, fallback) {
    const source = action && typeof action === "object" ? action : fallback;
    const normalized = {
      id: String(source?.id || ""),
      label: String(source?.label || ""),
      enabled: source?.enabled !== false
    };
    for (const key of ["value", "outcomeId", "candidateId"]) {
      if (source && Object.prototype.hasOwnProperty.call(source, key)) {
        normalized[key] = String(source[key] ?? "");
      }
    }
    return Object.freeze(normalized);
  }

  function normalizeReasonCode(value) {
    return String(value || "none").trim().toLowerCase().replace(/-/g, "_");
  }

  function createActionPayload(action = {}, editorValue = "", mode = "idea") {
    const hasActionValue = Object.prototype.hasOwnProperty.call(action, "value");
    const payload = {
      id: String(action.id || ""),
      value: hasActionValue ? String(action.value ?? "") : String(editorValue || ""),
      editorValue: String(editorValue || ""),
      mode: normalizeMode(mode)
    };
    if (Object.prototype.hasOwnProperty.call(action, "outcomeId")) payload.outcomeId = String(action.outcomeId || "");
    if (Object.prototype.hasOwnProperty.call(action, "candidateId")) payload.candidateId = String(action.candidateId || "");
    return Object.freeze(payload);
  }

  function getPendingOutcome(viewModel = {}) {
    const source = viewModel.pendingOutcome || viewModel.outcomeFeedback || viewModel.attention?.pendingOutcome;
    if (!source || typeof source !== "object" || source.visible === false || source.state === "none") return null;
    const outcome = source.outcome && typeof source.outcome === "object" ? source.outcome : source;
    const outcomeId = String(outcome.outcomeId || outcome.id || outcome.generationId || "").trim();
    const status = String(outcome.status || "unknown").toLowerCase();
    if (!outcomeId || !["unknown", "pending"].includes(status)) return null;
    return {
      outcomeId,
      stage: ["reason", "reason_required"].includes(String(source.state || outcome.feedbackState || "").toLowerCase())
        ? "reason"
        : "question"
    };
  }

  function getLearningCandidate(viewModel = {}) {
    const source = viewModel.learningCandidate || viewModel.candidateReminder || viewModel.attention?.learningCandidate;
    if (!source || typeof source !== "object" || source.visible === false) return null;
    const candidateId = String(source.candidateId || source.artifactId || source.id || "").trim();
    const ignoredCount = Number(source.ignoredCount ?? source.review?.ignoredCount ?? 0);
    if (!candidateId || (Number.isFinite(ignoredCount) && ignoredCount >= 3)) return null;
    return { candidateId, ignoredCount: Number.isFinite(ignoredCount) ? ignoredCount : 0 };
  }

  function createAttentionModel(viewModel, options, locale, reason) {
    const copy = COPY[locale];
    const reasonCode = normalizeReasonCode(reason.code);
    if (MODEL_ERROR_CODES.has(reasonCode)) {
      return Object.freeze({
        type: "model-error",
        visible: true,
        label: copy.attentionLabel,
        title: copy.modelErrors[reasonCode],
        message: "",
        actions: Object.freeze([])
      });
    }

    if (reason.visible) {
      return Object.freeze({
        type: "reason",
        visible: true,
        label: copy.attentionLabel,
        title: reason.label,
        message: reason.message,
        actions: Object.freeze([])
      });
    }

    const pendingOutcome = getPendingOutcome(viewModel);
    if (pendingOutcome && pendingOutcome.outcomeId !== String(options.resolvedOutcomeId || "")) {
      const stage = options.outcomeStage || pendingOutcome.stage;
      const actions = stage === "reason"
        ? OUTCOME_FAILURE_REASONS.map((value) => normalizeAction({
          id: "outcome-reason",
          value,
          outcomeId: pendingOutcome.outcomeId,
          label: copy.outcomeReasons[value]
        }))
        : [
          normalizeAction({
            id: "outcome-completed",
            value: "completed",
            outcomeId: pendingOutcome.outcomeId,
            label: copy.outcomeCompleted
          }),
          normalizeAction({
            id: "outcome-not-completed",
            value: "not_completed",
            outcomeId: pendingOutcome.outcomeId,
            label: copy.outcomeNotCompleted
          })
        ];
      return Object.freeze({
        type: "outcome",
        stage,
        visible: true,
        label: copy.attentionLabel,
        title: stage === "reason" ? copy.outcomeReasonPrompt : copy.outcomeQuestion,
        message: "",
        outcomeId: pendingOutcome.outcomeId,
        actions: Object.freeze(actions)
      });
    }

    const candidate = getLearningCandidate(viewModel);
    if (candidate && candidate.candidateId !== String(options.dismissedCandidateId || "")) {
      return Object.freeze({
        type: "candidate",
        visible: true,
        label: copy.attentionLabel,
        title: copy.candidatePrompt,
        message: "",
        candidateId: candidate.candidateId,
        actions: Object.freeze([
          normalizeAction({
            id: "candidate-review",
            value: candidate.candidateId,
            candidateId: candidate.candidateId,
            label: copy.candidateReview
          }),
          normalizeAction({
            id: "candidate-ignore",
            value: candidate.candidateId,
            candidateId: candidate.candidateId,
            label: copy.candidateIgnore
          })
        ])
      });
    }

    return Object.freeze({
      type: "none",
      visible: false,
      label: copy.attentionLabel,
      title: "",
      message: "",
      actions: Object.freeze([])
    });
  }

  function createAssistantCardModel(viewModel = {}, options = {}) {
    const locale = normalizeLocale(viewModel.locale);
    const copy = COPY[locale];
    const state = String(viewModel.state || "idle");
    const mode = normalizeMode(options.mode || viewModel.mode);
    const hasExplicitValue = Object.prototype.hasOwnProperty.call(options, "value");
    const value = String(hasExplicitValue ? options.value || "" : viewModel.prompt || viewModel.draft || "");
    const primaryAction = normalizeAction(viewModel.primaryAction, {
      id: "generate",
      label: locale === "zh-CN" ? "生成提示词" : "Generate prompt",
      enabled: true
    });
    const secondaryActions = (Array.isArray(viewModel.secondaryActions) ? viewModel.secondaryActions : [])
      .filter((action) => action && action.id !== "close")
      .slice(0, 2)
      .map((action) => normalizeAction(action));
    const reasonCode = String(viewModel.reason?.code || "none");
    const reasonLabel = String(viewModel.reason?.label || "");
    const reasonMessage = String(viewModel.reason?.message || "");
    const noAutoSubmit = viewModel.noAutoSubmit !== false;
    const reason = Object.freeze({
      code: reasonCode,
      label: reasonLabel,
      message: reasonMessage,
      visible: reasonCode !== "none" && Boolean(reasonLabel || reasonMessage)
    });
    const attention = createAttentionModel(viewModel, options, locale, reason);
    const modelError = attention.type === "model-error";
    const publicReason = modelError
      ? Object.freeze({ code: reasonCode, label: attention.title, message: "", visible: true })
      : reason;

    return Object.freeze({
      contractVersion: "assistant-card@1",
      state,
      locale,
      title: String(viewModel.title || "Smart Prompt"),
      description: String(viewModel.description || ""),
      busy: Boolean(viewModel.busy),
      editor: Object.freeze({
        label: copy.editorLabel,
        placeholder: state === "idle" ? copy.idlePlaceholder : copy.promptPlaceholder,
        value
      }),
      options: Object.freeze({
        label: copy.optionsLabel,
        choices: Object.freeze(MODES.map((id) => Object.freeze({
          id,
          label: copy.modes[id],
          selected: id === mode
        })))
      }),
      reason: publicReason,
      attention,
      // 模型错误只在没有可用提示词时抢占主操作；review 态（如离线模板回退）
      // 保留“填入输入框”，错误只作为 attention 展示。
      primaryAction: modelError && state !== "review"
        ? normalizeAction({ id: "diagnostics", label: copy.modelSettings, enabled: true })
        : primaryAction,
      secondaryActions: Object.freeze(modelError && state !== "review" ? [] : secondaryActions),
      closeAction: Object.freeze({ id: "close", label: copy.closeLabel, enabled: true }),
      noAutoSubmit,
      safetyText: noAutoSubmit ? copy.safetyText : copy.safetyUnknown
    });
  }

  function mountAssistantCard(host, options = {}) {
    if (!host || typeof host.attachShadow !== "function") {
      throw new TypeError("Assistant Card host must support Shadow DOM");
    }

    const previousVisibility = host.style.getPropertyValue("visibility");
    const previousVisibilityPriority = host.style.getPropertyPriority("visibility");
    const previousAriaHidden = host.getAttribute("aria-hidden");
    host.dataset.assistantStyleState = "loading";
    host.style.setProperty("visibility", "hidden", "important");
    host.setAttribute("aria-hidden", "true");

    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <link data-assistant-styles rel="stylesheet">
      <article class="sp-assistant-card" data-assistant-card tabindex="-1">
        <header class="sp-assistant-header">
          <span class="sp-assistant-brand" aria-hidden="true">
            <img data-assistant-mascot alt="">
            <span data-assistant-brand-fallback>S</span>
          </span>
          <span class="sp-assistant-heading">
            <strong data-assistant-title></strong>
            <span data-assistant-description></span>
          </span>
          <button class="sp-assistant-icon-button" data-action="close" type="button">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <section class="sp-assistant-attention" data-assistant-attention role="region" aria-live="polite" aria-atomic="true" hidden>
          <div class="sp-assistant-attention-copy">
            <strong data-assistant-attention-title></strong>
            <span data-assistant-attention-message></span>
          </div>
          <div class="sp-assistant-attention-actions" data-assistant-attention-actions role="group"></div>
        </section>
        <label class="sp-assistant-editor">
          <span class="sp-assistant-visually-hidden" data-assistant-editor-label></span>
          <textarea data-assistant-editor spellcheck="false"></textarea>
        </label>
        <details class="sp-assistant-options" data-assistant-options>
          <summary data-assistant-options-label></summary>
          <div class="sp-assistant-segments" role="group" data-assistant-modes></div>
        </details>
        <div class="sp-assistant-secondary-actions" data-assistant-secondary></div>
        <button class="sp-assistant-primary" data-assistant-primary type="button"></button>
        <footer class="sp-assistant-safety">
          <span class="sp-assistant-safety-mark" aria-hidden="true">✓</span>
          <span data-assistant-safety></span>
        </footer>
      </article>`;

    const refs = {
      root: shadow.querySelector("[data-assistant-card]"),
      styles: shadow.querySelector("[data-assistant-styles]"),
      mascot: shadow.querySelector("[data-assistant-mascot]"),
      mascotFallback: shadow.querySelector("[data-assistant-brand-fallback]"),
      title: shadow.querySelector("[data-assistant-title]"),
      description: shadow.querySelector("[data-assistant-description]"),
      attention: shadow.querySelector("[data-assistant-attention]"),
      attentionTitle: shadow.querySelector("[data-assistant-attention-title]"),
      attentionMessage: shadow.querySelector("[data-assistant-attention-message]"),
      attentionActions: shadow.querySelector("[data-assistant-attention-actions]"),
      editorLabel: shadow.querySelector("[data-assistant-editor-label]"),
      editor: shadow.querySelector("[data-assistant-editor]"),
      optionsLabel: shadow.querySelector("[data-assistant-options-label]"),
      modes: shadow.querySelector("[data-assistant-modes]"),
      secondary: shadow.querySelector("[data-assistant-secondary]"),
      primary: shadow.querySelector("[data-assistant-primary]"),
      safety: shadow.querySelector("[data-assistant-safety]")
    };
    const ownerDocument = shadow.ownerDocument || host.ownerDocument || document;
    const ownerWindow = ownerDocument.defaultView;
    let currentModel = createAssistantCardModel();
    let currentViewModel = {};
    let currentRenderOptions = {};
    let localOutcomeId = "";
    let localOutcomeStage = "";
    let resolvedOutcomeId = "";
    let dismissedCandidateId = "";
    let styleState = "loading";
    let revealFrame = 0;
    let focusFrame = 0;

    function restoreHostVisibility() {
      if (previousVisibility) {
        host.style.setProperty("visibility", previousVisibility, previousVisibilityPriority);
      } else {
        host.style.removeProperty("visibility");
      }
      if (previousAriaHidden === null) host.removeAttribute("aria-hidden");
      else host.setAttribute("aria-hidden", previousAriaHidden);
    }

    function revealStyledCard() {
      if (styleState !== "loading") return;
      styleState = "ready";
      host.dataset.assistantStyleState = styleState;
      restoreHostVisibility();
    }

    function handleStylesheetLoad() {
      if (styleState !== "loading") return;
      if (ownerWindow?.requestAnimationFrame) {
        revealFrame = ownerWindow.requestAnimationFrame(revealStyledCard);
      } else {
        revealStyledCard();
      }
    }

    function handleStylesheetError() {
      if (styleState !== "loading") return;
      styleState = "failed";
      host.dataset.assistantStyleState = styleState;
      callHandler("stylesheet", options.onStylesheetError, {
        href: refs.styles.getAttribute("href") || ""
      });
    }

    refs.styles.addEventListener("load", handleStylesheetLoad, { once: true });
    refs.styles.addEventListener("error", handleStylesheetError, { once: true });
    refs.styles.href = String(options.stylesheetUrl || "assistant-card.css");
    if (options.mascotUrl) {
      refs.mascot.src = String(options.mascotUrl);
      refs.mascot.hidden = false;
      refs.mascotFallback.hidden = true;
    } else {
      refs.mascot.hidden = true;
      refs.mascotFallback.hidden = false;
    }

    function reportCallbackError(kind, error) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn(`Assistant Card ${kind} callback failed`, error);
      }
    }

    function callHandler(kind, handler, payload) {
      if (typeof handler !== "function") return;
      try {
        const result = handler(payload);
        if (result && typeof result.catch === "function") {
          result.catch((error) => reportCallbackError(kind, error));
        }
      } catch (error) {
        reportCallbackError(kind, error);
      }
    }

    function emitAction(action) {
      if (!action || action.enabled === false) return;
      const payload = createActionPayload(
        action,
        refs.editor.value,
        currentModel.options.choices.find((choice) => choice.selected)?.id || "idea"
      );
      callHandler("action", options.onAction, payload);
    }

    function createActionButton(action, className) {
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.className = className;
      button.dataset.action = action.id;
      if (Object.prototype.hasOwnProperty.call(action, "value")) button.dataset.actionValue = action.value;
      button.textContent = action.label;
      button.disabled = action.enabled === false;
      return button;
    }

    function queueFocus(selector) {
      const focusTarget = () => shadow.querySelector(selector)?.focus();
      if (ownerWindow?.requestAnimationFrame) {
        if (focusFrame) ownerWindow.cancelAnimationFrame(focusFrame);
        focusFrame = ownerWindow.requestAnimationFrame(focusTarget);
      } else {
        focusTarget();
      }
    }

    function render(viewModel = currentViewModel, overrides = {}) {
      currentViewModel = viewModel || {};
      currentRenderOptions = overrides;
      const pendingOutcome = getPendingOutcome(currentViewModel);
      if (pendingOutcome?.outcomeId !== localOutcomeId) {
        localOutcomeId = pendingOutcome?.outcomeId || "";
        localOutcomeStage = "";
      }
      currentModel = createAssistantCardModel(currentViewModel, {
        ...overrides,
        outcomeStage: overrides.outcomeStage || localOutcomeStage,
        resolvedOutcomeId: overrides.resolvedOutcomeId || resolvedOutcomeId,
        dismissedCandidateId: overrides.dismissedCandidateId || dismissedCandidateId
      });
      refs.root.dataset.state = currentModel.state;
      refs.root.dataset.locale = currentModel.locale;
      refs.root.dataset.attentionType = currentModel.attention.type;
      refs.root.dataset.attentionStage = currentModel.attention.stage || "none";
      refs.root.setAttribute("aria-busy", String(currentModel.busy));
      refs.title.textContent = currentModel.title;
      refs.description.textContent = currentModel.description;
      refs.attention.hidden = !currentModel.attention.visible;
      refs.attention.dataset.type = currentModel.attention.type;
      refs.attention.dataset.stage = currentModel.attention.stage || "none";
      refs.attention.setAttribute("aria-label", currentModel.attention.label);
      refs.attentionTitle.textContent = currentModel.attention.title;
      refs.attentionMessage.textContent = currentModel.attention.message;
      refs.attentionMessage.hidden = !currentModel.attention.message;
      refs.attentionActions.replaceChildren(...currentModel.attention.actions.map((action) => {
        const button = createActionButton(action, "sp-assistant-attention-action");
        button.dataset.attentionAction = "true";
        return button;
      }));
      refs.attentionActions.hidden = currentModel.attention.actions.length === 0;
      refs.attentionActions.setAttribute("aria-label", currentModel.attention.title || currentModel.attention.label);
      refs.editorLabel.textContent = currentModel.editor.label;
      refs.editor.setAttribute("aria-label", currentModel.editor.label);
      refs.editor.placeholder = currentModel.editor.placeholder;
      if (refs.editor.value !== currentModel.editor.value) refs.editor.value = currentModel.editor.value;
      refs.editor.disabled = currentModel.busy;
      refs.optionsLabel.textContent = currentModel.options.label;
      refs.modes.replaceChildren(...currentModel.options.choices.map((choice) => {
        const button = createActionButton({ id: `mode:${choice.id}`, label: choice.label, enabled: !currentModel.busy }, "sp-assistant-segment");
        button.dataset.mode = choice.id;
        button.setAttribute("aria-pressed", String(choice.selected));
        return button;
      }));
      refs.secondary.replaceChildren(...currentModel.secondaryActions.map((action) => createActionButton(action, "sp-assistant-secondary")));
      refs.secondary.hidden = currentModel.secondaryActions.length === 0;
      refs.primary.dataset.action = currentModel.primaryAction.id;
      refs.primary.textContent = currentModel.primaryAction.label;
      refs.primary.disabled = currentModel.primaryAction.enabled === false;
      refs.safety.textContent = currentModel.safetyText;
      const closeButton = shadow.querySelector('[data-action="close"]');
      closeButton.setAttribute("aria-label", currentModel.closeAction.label);
      closeButton.title = currentModel.closeAction.label;
      return currentModel;
    }

    function handleClick(event) {
      const button = event.target.closest?.("button[data-action]");
      if (!button || button.disabled) return;
      const mode = button.dataset.mode;
      if (mode) {
        const nextModel = render(currentViewModel, { value: refs.editor.value, mode });
        callHandler("mode", options.onModeChange, { mode, value: refs.editor.value, model: nextModel });
        return;
      }
      if (button.dataset.action === "close") {
        emitAction(currentModel.closeAction);
        return;
      }
      if (button === refs.primary) {
        emitAction(currentModel.primaryAction);
        return;
      }
      if (button.dataset.attentionAction === "true") {
        const attentionAction = currentModel.attention.actions.find((action) => (
          action.id === button.dataset.action
          && String(action.value || "") === String(button.dataset.actionValue || "")
        ));
        if (!attentionAction) return;
        emitAction(attentionAction);
        if (attentionAction.id === "outcome-not-completed") {
          localOutcomeStage = "reason";
          render(currentViewModel, {
            ...currentRenderOptions,
            value: refs.editor.value,
            outcomeStage: "reason"
          });
          queueFocus('[data-action="outcome-reason"]');
          return;
        }
        if (attentionAction.id === "outcome-completed" || attentionAction.id === "outcome-reason") {
          resolvedOutcomeId = attentionAction.outcomeId || currentModel.attention.outcomeId || "";
          localOutcomeStage = "";
          render(currentViewModel, { ...currentRenderOptions, value: refs.editor.value });
          queueFocus("[data-assistant-primary]");
          return;
        }
        if (attentionAction.id === "candidate-ignore") {
          dismissedCandidateId = attentionAction.candidateId || currentModel.attention.candidateId || "";
          render(currentViewModel, { ...currentRenderOptions, value: refs.editor.value });
          queueFocus("[data-assistant-primary]");
        }
        return;
      }
      const secondary = currentModel.secondaryActions.find((action) => action.id === button.dataset.action);
      emitAction(secondary);
    }

    function handleInput() {
      callHandler("change", options.onChange, {
        value: refs.editor.value,
        mode: currentModel.options.choices.find((choice) => choice.selected)?.id || "idea"
      });
    }

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        emitAction(currentModel.closeAction);
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        if (currentModel.attention.type === "outcome" && currentModel.attention.stage === "reason") return;
        event.preventDefault();
        emitAction(currentModel.primaryAction);
      }
    }

    shadow.addEventListener("click", handleClick);
    refs.editor.addEventListener("input", handleInput);
    shadow.addEventListener("keydown", handleKeydown);
    render(options.viewModel || {}, {
      ...(Object.prototype.hasOwnProperty.call(options, "value") ? { value: options.value } : {}),
      ...(options.mode ? { mode: options.mode } : {})
    });

    return Object.freeze({
      render,
      getModel: () => currentModel,
      getRoot: () => shadow,
      getValue: () => refs.editor.value,
      setValue(value) {
        refs.editor.value = String(value || "");
        handleInput();
      },
      focusEditor() {
        refs.editor.focus();
      },
      destroy() {
        styleState = "destroyed";
        host.dataset.assistantStyleState = styleState;
        if (revealFrame && ownerWindow?.cancelAnimationFrame) ownerWindow.cancelAnimationFrame(revealFrame);
        if (focusFrame && ownerWindow?.cancelAnimationFrame) ownerWindow.cancelAnimationFrame(focusFrame);
        refs.styles.removeEventListener("load", handleStylesheetLoad);
        refs.styles.removeEventListener("error", handleStylesheetError);
        restoreHostVisibility();
        shadow.removeEventListener("click", handleClick);
        refs.editor.removeEventListener("input", handleInput);
        shadow.removeEventListener("keydown", handleKeydown);
        shadow.replaceChildren();
      }
    });
  }

  return Object.freeze({
    MODES,
    OUTCOME_FAILURE_REASONS,
    createActionPayload,
    createAssistantCardModel,
    mountAssistantCard,
    normalizeLocale,
    normalizeMode
  });
});
