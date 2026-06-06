(function initSmartPromptContent() {
  const engine = globalThis.SmartPromptEngine;
  const siteAdapters = globalThis.SmartPromptSiteAdapters;
  const localService = globalThis.SmartPromptLocalService;
  if (!engine || globalThis.__smartPromptCopilotLoaded) return;
  globalThis.__smartPromptCopilotLoaded = true;

  const STORAGE_KEYS = {
    skills: "smartPromptSkills",
    settings: "smartPromptSettings",
    favorites: "smartPromptFavorites"
  };

  const state = {
    activeInput: null,
    card: null,
    mascot: null,
    importedSkills: [],
    variant: 0,
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
      lastFocusKind: ""
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
    if (!element) return false;
    if (siteAdapters?.writeInput) return siteAdapters.writeInput(element, value);
    return false;
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
    state.debug.focusEvents += 1;
    state.debug.lastFocusTag = target.tagName || "";
    state.debug.lastFocusHost = location.hostname;
    state.debug.lastFocusKind = target.isContentEditable ? "contenteditable" : target.tagName?.toLowerCase() || "";
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

  function modeClass(mode) {
    return `mode-${mode}`;
  }

  function renderSkillChips(skills) {
    return (skills || [])
      .map((skill) => `<span class="spc-chip" title="${escapeHtml(skill.description || "")}">${escapeHtml(skill.name)}</span>`)
      .join("");
  }

  function renderCard(card, context, generatedBy) {
    if (!state.card) return;
    state.lastPrompt = card.prompt;
    state.lastContext = context;
    const label = state.card.querySelector(".spc-mode");
    const textarea = state.card.querySelector(".spc-output");
    const skills = state.card.querySelector(".spc-skills");
    const contextLine = state.card.querySelector(".spc-context");
    label.textContent = card.modeLabel;
    label.className = `spc-mode ${modeClass(card.mode)}`;
    textarea.value = card.prompt;
    skills.innerHTML = renderSkillChips(card.skills);
    contextLine.textContent = [card.tool, context.host, context.inputKind, generatedBy].filter(Boolean).join(" / ");
  }

  async function refreshCardPreview(advanceVariant) {
    if (!state.card || !state.activeInput) return;
    if (advanceVariant) state.variant += 1;

    const inputText = getInputText(state.activeInput);
    const context = getContext(state.activeInput);
    const card = engine.buildCard(inputText, context, state.importedSkills, state.variant);
    state.lastInputText = inputText;
    renderCard(card, context, "template");

    if (!state.settings.preferLocalService || !localService?.generate) return;

    try {
      const result = await localService.generate({
        input: inputText,
        context,
        variantIndex: state.variant,
        allowTemplateFallback: true
      }, state.settings.serviceUrl);
      if (state.activeInput && getInputText(state.activeInput) === inputText) {
        renderCard(result.card, context, result.card.generatedBy || "service");
      }
    } catch (error) {
      const contextLine = state.card?.querySelector(".spc-context");
      if (contextLine) contextLine.textContent = `${contextLine.textContent} / service offline`;
    }
  }

  function openPromptCard() {
    if (!state.activeInput || !isVisible(state.activeInput)) {
      const fallback = queryInputs()[0];
      if (!fallback) return;
      state.activeInput = fallback;
    }

    closeCard();
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
          <button type="button" class="spc-icon-button" data-action="close" aria-label="Close">×</button>
        </div>
      </header>
      <textarea class="spc-output" spellcheck="false"></textarea>
      <div class="spc-skills" aria-label="Recommended skills"></div>
      <footer class="spc-actions">
        <button type="button" data-action="refresh">Refresh</button>
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="favorite">Save</button>
        <button type="button" data-action="insert" class="spc-primary">Insert</button>
      </footer>
    `;
    panel.addEventListener("click", handleCardAction);
    document.documentElement.appendChild(panel);
    state.card = panel;
    placeCard();
    refreshCardPreview(false);
    setMascotState("suggesting");
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

    if (action === "edit") {
      output?.focus();
      output?.setSelectionRange(output.value.length, output.value.length);
      setMascotState("normal");
      return;
    }

    if (action === "copy") {
      await navigator.clipboard?.writeText(prompt);
      setMascotState("clapping");
      return;
    }

    if (action === "favorite") {
      const existing = await storageGet([STORAGE_KEYS.favorites]);
      const favorites = Array.isArray(existing[STORAGE_KEYS.favorites]) ? existing[STORAGE_KEYS.favorites] : [];
      favorites.unshift({
        id: `prompt-${Date.now()}`,
        title: `${engine.MODE_META[engine.detectMode(state.lastInputText)].label} prompt`,
        body: prompt,
        mode: engine.detectMode(state.lastInputText),
        source: "browser-extension",
        created_at: new Date().toISOString(),
        context: state.lastContext
      });
      await storageSet({ [STORAGE_KEYS.favorites]: favorites.slice(0, 50) });
      setMascotState("clapping");
      return;
    }

    if (action === "insert") {
      const ok = setInputText(state.activeInput, prompt);
      setMascotState(ok ? "success" : "resting");
      if (ok) closeCard();
    }
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
    });
    window.addEventListener("scroll", () => {
      placeMascot();
      placeCard();
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
