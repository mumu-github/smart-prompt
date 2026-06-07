(function initSmartPromptContent() {
  const engine = globalThis.SmartPromptEngine;
  const siteAdapters = globalThis.SmartPromptSiteAdapters;
  const localService = globalThis.SmartPromptLocalService;
  if (!engine || globalThis.__smartPromptCopilotLoaded) return;
  globalThis.__smartPromptCopilotLoaded = true;

  const STORAGE_KEYS = {
    skills: "smartPromptSkills",
    settings: "smartPromptSettings",
    favorites: "smartPromptFavorites",
    feedback: "smartPromptFeedback"
  };

  const state = {
    activeInput: null,
    card: null,
    mascot: null,
    importedSkills: [],
    variant: 0,
    manualMode: "",
    generationRequestId: 0,
    undoSnapshot: null,
    lastPrompt: "",
    lastInputText: "",
    lastContext: null,
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

  function isTextInput(element) {
    if (!element || !(element instanceof Element)) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "url", "email"].includes(type);
    }
    if (element.isContentEditable) return true;
    return element.getAttribute("role") === "textbox";
  }

  function queryInputs() {
    const adapter = siteAdapters?.detectSiteAdapter(location.hostname);
    const candidates = siteAdapters?.queryInputCandidates
      ? siteAdapters.queryInputCandidates(document, adapter)
      : Array.from(document.querySelectorAll('textarea, input[type="text"], input[type="search"], input[type="url"], input[type="email"], [contenteditable="true"], [role="textbox"]'));
    return candidates.filter((element) => isTextInput(element) && isVisible(element));
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
      pathKind: getPathKind()
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
    button.setAttribute("aria-label", "Smart Prompt Copilot");
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
    const size = 74;
    const left = Math.min(window.innerWidth - size - 12, Math.max(12, rect.right - size + 10));
    const top = Math.min(window.innerHeight - size - 12, Math.max(12, rect.bottom - size * 0.62));
    state.mascot.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function onFocus(event) {
    const target = getEventTarget(event);
    if (!state.settings.enabled || !isTextInput(target) || !isVisible(target)) return;
    const adapter = siteAdapters?.detectSiteAdapter(location.hostname);
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
    if (getEventTarget(event) !== state.activeInput) return;
    setMascotState(engine.detectMode(getInputText(state.activeInput)) === engine.MODE.IDEA ? "normal" : "resting");
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
      state.card.remove();
      state.card = null;
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

  function renderEvidence(card, context, generatedBy) {
    const skillReasons = (card.skills || [])
      .slice(0, 3)
      .map((skill) => {
        const tags = Array.isArray(skill.reason?.matchedTokens) && skill.reason.matchedTokens.length
          ? skill.reason.matchedTokens.slice(0, 3).join(",")
          : Array.isArray(skill.tags) ? skill.tags.slice(0, 3).join(",") : "";
        const score = Number.isFinite(skill.score) ? ` score ${skill.score.toFixed(1)}` : "";
        return `${skill.name}${score}${tags ? ` (${tags})` : ""}`;
      })
      .join(" · ") || "none";
    const privacy = [
      context.origin || context.host,
      `path:${context.pathKind || "unknown"}`,
      "no title",
      "no page body"
    ].filter(Boolean).join(" · ");
    return [
      `<div><strong>Basis</strong> ${escapeHtml(skillReasons)}</div>`,
      `<div><strong>Privacy</strong> ${escapeHtml(privacy)}</div>`,
      `<div><strong>Source</strong> ${escapeHtml(generatedBy || "template")}</div>`
    ].join("");
  }

  function renderCard(card, context, generatedBy) {
    if (!state.card) return;
    state.lastPrompt = card.prompt;
    state.lastContext = context;
    const label = state.card.querySelector(".spc-mode");
    const selector = state.card.querySelector(".spc-mode-selector");
    const textarea = state.card.querySelector(".spc-output");
    const skills = state.card.querySelector(".spc-skills");
    const contextLine = state.card.querySelector(".spc-context");
    const evidence = state.card.querySelector(".spc-evidence");
    const sourceBadge = state.card.querySelector(".spc-source-badge");
    label.textContent = card.modeLabel;
    label.className = `spc-mode ${modeClass(card.mode)}`;
    if (selector) selector.value = card.mode;
    textarea.value = card.prompt;
    skills.innerHTML = renderSkillChips(card.skills);
    evidence.innerHTML = renderEvidence(card, context, generatedBy);
    if (sourceBadge) {
      const source = generatedBy || "template";
      sourceBadge.textContent = source.includes("llm") ? "LLM" : source;
      sourceBadge.dataset.generatedBy = source;
    }
    contextLine.textContent = [card.tool, context.host, context.inputKind, generatedBy].filter(Boolean).join(" / ");
    setCardStatus("ready", "ready");
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
      title: `${engine.MODE_META[mode].label} prompt`,
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
    const existing = await storageGet([STORAGE_KEYS.feedback]);
    const events = Array.isArray(existing[STORAGE_KEYS.feedback]) ? existing[STORAGE_KEYS.feedback] : [];
    events.unshift({
      id: `feedback-${Date.now()}`,
      action,
      created_at: new Date().toISOString(),
      mode: state.lastContext?.mode || engine.detectMode(state.lastInputText),
      tool: state.lastContext?.tool || "",
      adapterId: state.lastContext?.adapterId || "",
      generatedBy: state.card?.querySelector(".spc-source-badge")?.dataset.generatedBy || "",
      adopted: action === "insert" && detail?.verified === true,
      detail: {
        strategy: detail?.strategy || "",
        kind: detail?.kind || "",
        verified: Boolean(detail?.verified),
        reason: detail?.reason || ""
      }
    });
    await storageSet({ [STORAGE_KEYS.feedback]: events.slice(0, 100) });
  }

  async function refreshCardPreview(advanceVariant) {
    if (!state.card || !state.activeInput) return;
    if (advanceVariant) state.variant += 1;
    const requestId = state.generationRequestId + 1;
    state.generationRequestId = requestId;

    const inputText = getInputText(state.activeInput);
    const detectedMode = engine.detectMode(inputText);
    const context = {
      ...getContext(state.activeInput),
      mode: state.manualMode || detectedMode
    };
    const card = engine.buildCard(inputText, context, state.importedSkills, state.variant);
    state.lastInputText = inputText;
    renderCard(card, context, "template");

    if (!state.settings.preferLocalService || !localService?.generate) return;

    try {
      setCardStatus("generating", "loading");
      setMascotState("thinking");
      const result = await localService.generate({
        input: inputText,
        context,
        variantIndex: state.variant,
        allowTemplateFallback: true
      }, state.settings.serviceUrl);
      if (requestId === state.generationRequestId && state.activeInput && getInputText(state.activeInput) === inputText) {
        renderCard(result.card, context, result.card.generatedBy || "service");
        setMascotState("suggesting");
      }
    } catch (error) {
      const contextLine = state.card?.querySelector(".spc-context");
      if (contextLine) contextLine.textContent = `${contextLine.textContent} / service offline`;
      setCardStatus("service offline", "failed");
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
    state.manualMode = "";
    setMascotState("thinking");
    const panel = document.createElement("section");
    panel.id = "smart-prompt-card";
    panel.setAttribute("aria-label", "Prompt card");
    panel.innerHTML = `
      <header class="spc-header">
        <div>
          <div class="spc-title">Prompt Copilot</div>
          <div class="spc-context"></div>
        </div>
        <div class="spc-header-actions">
          <span class="spc-mode"></span>
          <span class="spc-source-badge" data-generated-by="template">template</span>
          <button type="button" class="spc-icon-button" data-action="close" aria-label="Close">×</button>
        </div>
      </header>
      <div class="spc-controls">
        <select class="spc-mode-selector" aria-label="Mode">
          <option value="${engine.MODE.IDEA}">${escapeHtml(engine.MODE_META[engine.MODE.IDEA].label)}</option>
          <option value="${engine.MODE.CONTINUE}">${escapeHtml(engine.MODE_META[engine.MODE.CONTINUE].label)}</option>
          <option value="${engine.MODE.POLISH}">${escapeHtml(engine.MODE_META[engine.MODE.POLISH].label)}</option>
        </select>
        <span class="spc-status">ready</span>
      </div>
      <textarea class="spc-output" spellcheck="false"></textarea>
      <div class="spc-evidence" aria-label="Basis and privacy summary"></div>
      <div class="spc-skills" aria-label="Recommended skills"></div>
      <footer class="spc-actions">
        <button type="button" data-action="refresh">Refresh</button>
        <button type="button" data-action="retry">Retry</button>
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="favorite">Save</button>
        <button type="button" data-action="insert" class="spc-primary">Insert</button>
      </footer>
    `;
    panel.addEventListener("click", handleCardAction);
    panel.addEventListener("change", handleCardChange);
    document.documentElement.appendChild(panel);
    state.card = panel;
    placeCard();
    refreshCardPreview(false);
    setMascotState("suggesting");
  }

  function handleCardChange(event) {
    const selector = event.target.closest?.(".spc-mode-selector");
    if (!selector) return;
    state.manualMode = selector.value;
    setMascotState("thinking");
    refreshCardPreview(false);
  }

  async function handleCardAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const output = state.card?.querySelector(".spc-output");
    const prompt = output?.value || state.lastPrompt;

    if (action === "close") {
      closeCard();
      setMascotState("resting");
      return;
    }

    if (action === "refresh") {
      setMascotState("thinking");
      refreshCardPreview(true);
      setTimeout(() => setMascotState("suggesting"), 160);
      return;
    }

    if (action === "retry") {
      setMascotState("thinking");
      setCardStatus("retrying", "loading");
      await recordFeedbackEvent("retry", { verified: false, reason: "manual_retry" });
      refreshCardPreview(false);
      return;
    }

    if (action === "edit") {
      output?.focus();
      output?.setSelectionRange(output.value.length, output.value.length);
      setMascotState("normal");
      return;
    }

    if (action === "copy") {
      await navigator.clipboard?.writeText(prompt);
      await recordFeedbackEvent("copy", { verified: true, reason: "clipboard_requested" });
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
      const previousValue = getInputText(state.activeInput);
      const result = await setInputText(state.activeInput, prompt);
      const ok = Boolean(result?.ok && result?.verified);
      state.debug.lastInsertResult = result;
      publishInsertEvidence(result);
      await recordFeedbackEvent("insert", result);
      setMascotState(ok ? "success" : "resting");
      if (ok) {
        state.undoSnapshot = {
          input: state.activeInput,
          previousValue,
          insertedValue: prompt,
          createdAt: Date.now()
        };
        closeCard();
        showUndoToast();
      } else {
        setCardStatus("insert failed", "failed");
      }
    }
  }

  function showUndoToast() {
    closeUndoToast();
    const toast = document.createElement("div");
    toast.id = "smart-prompt-undo";
    toast.innerHTML = `
      <span>Inserted</span>
      <button type="button" data-action="undo">Undo</button>
    `;
    toast.querySelector('button[data-action="undo"]').addEventListener("click", handleUndoAction);
    document.documentElement.dataset.smartPromptUndoAvailable = "true";
    document.documentElement.appendChild(toast);
    placeUndoToast();
  }

  async function handleUndoAction() {
    if (!state.undoSnapshot?.input) return;
    const result = setInputText(state.undoSnapshot.input, state.undoSnapshot.previousValue || "");
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
    state.undoSnapshot = null;
    closeUndoToast();
    setMascotState("normal");
  }

  function publishInsertEvidence(result) {
    const evidence = {
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      kind: result?.kind || "",
      strategy: result?.strategy || "",
      reason: result?.reason || "",
      valueLength: Number(result?.valueLength || 0),
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
    const width = Math.min(460, Math.max(320, window.innerWidth - 24));
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    const above = rect.top > 430;
    const top = above ? Math.max(12, rect.top - 390) : Math.min(window.innerHeight - 390, rect.bottom + 14);
    state.card.style.width = `${width}px`;
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
    bindEvents();
    globalThis.__smartPromptDebug = state.debug;
    const focused = document.activeElement;
    if (isTextInput(focused) && isVisible(focused)) {
      onFocus({ target: focused });
    }
    refreshDeepActiveInput();
    setTimeout(refreshDeepActiveInput, 500);
    setTimeout(refreshDeepActiveInput, 1500);
    setTimeout(refreshDeepActiveInput, 3500);
    globalThis.__smartPromptCopilotReady = true;
  }

  start();
})();
