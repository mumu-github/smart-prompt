(function initSmartPromptSiteAdapters(root) {
  const SITE_ADAPTERS = Object.freeze([
    {
      id: "chatgpt",
      tool: "ChatGPT",
      hostnames: ["chatgpt.com", "chat.openai.com"],
      inputSelectors: ['#prompt-textarea', 'textarea[data-id="prompt-textarea"]', '[contenteditable="true"][data-id]', '[contenteditable="true"][role="textbox"]', '[role="textbox"]'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "claude",
      tool: "Claude",
      hostnames: ["claude.ai"],
      inputSelectors: ['[data-testid="chat-input"] div[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "gemini",
      tool: "Gemini",
      hostnames: ["gemini.google.com"],
      inputSelectors: ['rich-textarea div[contenteditable="true"]', 'div[aria-label][contenteditable="true"]', 'div[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "contenteditable"
    },
    {
      id: "perplexity",
      tool: "Perplexity",
      hostnames: ["perplexity.ai", "www.perplexity.ai"],
      inputSelectors: ['textarea[placeholder*="Ask"]', 'textarea[aria-label*="Ask"]', '[data-testid*="composer"] textarea', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "lovable",
      tool: "Lovable",
      hostnames: ["lovable.dev"],
      inputSelectors: ['[role="textbox"][aria-label="Chat input"]', '[contenteditable="true"][aria-label="Chat input"]', '[data-testid*="chat"] [role="textbox"]', 'textarea[placeholder*="Build"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "textarea-first"
    },
    {
      id: "bolt",
      tool: "Bolt",
      hostnames: ["bolt.new"],
      inputSelectors: ['[role="textbox"][aria-label*="Type your idea"]', '[contenteditable="true"][aria-label*="Type your idea"]', 'textarea[placeholder*="Type your idea"]', '[data-testid*="chat"] [role="textbox"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "textarea-first"
    },
    {
      id: "v0",
      tool: "v0",
      hostnames: ["v0.dev", "v0.app"],
      inputSelectors: ['textarea[id^="prompt-textarea"]', 'textarea[placeholder*="v0"]', '[data-testid*="prompt"] textarea', 'textarea', '[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "textarea-first"
    },
    {
      id: "replit",
      tool: "Replit",
      hostnames: ["replit.com"],
      inputSelectors: [
        'textarea[placeholder*="Replit"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Describe"]',
        'textarea[placeholder*="Build"]',
        'textarea[aria-label*="Ask"]',
        'textarea[aria-label*="prompt"]',
        '[data-cy*="ai"] textarea',
        '[data-testid*="ai"] textarea',
        '[data-testid*="prompt"] textarea',
        '[aria-label*="prompt"][contenteditable="true"]',
        '[aria-label*="Ask"][contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        '[contenteditable="true"][role="textbox"]',
        '[role="textbox"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      insertStrategy: "textarea-first"
    }
  ]);

  function detectSiteAdapter(hostname) {
    const host = String(hostname || "").toLowerCase();
    return SITE_ADAPTERS.find((adapter) => adapter.hostnames.some((name) => host === name || host.endsWith(`.${name}`))) || null;
  }

  function queryInputCandidates(documentRef, adapter) {
    const selectors = adapter?.inputSelectors?.length
      ? adapter.inputSelectors
      : ['textarea', 'input[type="text"]', 'input[type="search"]', '[contenteditable="true"]', '[role="textbox"]'];
    return selectors.flatMap((selector) => querySelectorAllDeep(documentRef, selector));
  }

  function querySelectorAllDeep(root, selector, results = []) {
    if (!root?.querySelectorAll) return results;
    results.push(...Array.from(root.querySelectorAll(selector)));
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.shadowRoot) querySelectorAllDeep(element.shadowRoot, selector, results);
    }
    return results;
  }

  function setNativeValue(element, value) {
    if (!element || !("value" in element)) return false;
    const tag = element.tagName.toLowerCase();
    const prototype = tag === "textarea" && typeof HTMLTextAreaElement !== "undefined"
      ? HTMLTextAreaElement.prototype
      : typeof HTMLInputElement !== "undefined"
        ? HTMLInputElement.prototype
        : element.constructor?.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    dispatchInputEvents(element, value);
    return true;
  }

  function setContentEditableValue(element, value) {
    if (!isEditableElement(element)) return false;
    element.focus?.();
    element.textContent = value;
    const selection = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
    if (selection && typeof document !== "undefined" && document.createRange) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    dispatchInputEvents(element, value);
    return true;
  }

  function createEvent(type, value) {
    if (type === "input" && typeof InputEvent !== "undefined") {
      return new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value });
    }
    if (typeof Event !== "undefined") {
      return new Event(type, { bubbles: true, composed: true });
    }
    return { type, bubbles: true, composed: true, inputType: type === "input" ? "insertText" : undefined, data: value };
  }

  function dispatchInputEvents(element, value) {
    element.dispatchEvent?.(createEvent("input", value));
    element.dispatchEvent?.(createEvent("change", value));
  }

  function isEditableElement(element) {
    return Boolean(element && (element.isContentEditable || element.getAttribute?.("contenteditable") === "true"));
  }

  function readInputValue(element) {
    if (!element) return "";
    const tag = element.tagName?.toLowerCase?.() || "";
    if (isEditableElement(element) && tag !== "textarea" && tag !== "input") {
      return element.innerText || element.textContent || "";
    }
    if ("value" in element) return element.value || "";
    return element.innerText || element.textContent || "";
  }

  function attemptWrite(kind, element, value) {
    const wrote = kind === "native"
      ? setNativeValue(element, value)
      : setContentEditableValue(element, value);
    if (!wrote) return { ok: false, verified: false, kind, reason: "unsupported_target" };
    const actual = readInputValue(element);
    const verified = actual === String(value);
    return {
      ok: verified,
      verified,
      kind,
      reason: verified ? "after_write_verified" : "after_write_mismatch",
      valueLength: String(value).length
    };
  }

  function getWritePlan(adapter, element) {
    const strategy = adapter?.insertStrategy || "contenteditable-or-textarea";
    if (strategy === "contenteditable") return ["contenteditable", "native"];
    if (strategy === "textarea-first") return ["native", "contenteditable"];
    if (isEditableElement(element)) return ["contenteditable", "native"];
    return ["native", "contenteditable"];
  }

  function writeInput(element, value, adapter) {
    element?.focus?.();
    const strategy = adapter?.insertStrategy || "contenteditable-or-textarea";
    for (const kind of getWritePlan(adapter, element)) {
      const result = attemptWrite(kind, element, value);
      if (result.verified) return { ...result, strategy };
    }
    return {
      ok: false,
      verified: false,
      kind: "",
      strategy,
      reason: "no_supported_write_strategy",
      valueLength: String(value || "").length
    };
  }

  const api = {
    SITE_ADAPTERS,
    detectSiteAdapter,
    queryInputCandidates,
    querySelectorAllDeep,
    readInputValue,
    writeInput
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptSiteAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
