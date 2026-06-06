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
      inputSelectors: ['textarea[placeholder*="Replit"]', 'textarea[placeholder*="Ask"]', 'textarea[aria-label*="Ask"]', '[data-cy*="ai"] textarea', '[data-testid*="ai"] textarea', '[contenteditable="true"][role="textbox"]', '[role="textbox"]', 'textarea'],
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
    const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setContentEditableValue(element, value) {
    if (!element || !element.isContentEditable) return false;
    element.focus();
    element.textContent = value;
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function writeInput(element, value) {
    element?.focus();
    if (setNativeValue(element, value)) return true;
    if (setContentEditableValue(element, value)) return true;
    return false;
  }

  const api = {
    SITE_ADAPTERS,
    detectSiteAdapter,
    queryInputCandidates,
    querySelectorAllDeep,
    writeInput
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptSiteAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
