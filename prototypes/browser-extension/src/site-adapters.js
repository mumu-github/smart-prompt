(function initSmartPromptSiteAdapters(root) {
  const SITE_ADAPTERS = Object.freeze([
    {
      id: "chatgpt",
      tool: "ChatGPT",
      hostnames: ["chatgpt.com", "chat.openai.com"],
      inputSelectors: ['#prompt-textarea', 'textarea', '[contenteditable="true"][data-id]', '[role="textbox"]'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "claude",
      tool: "Claude",
      hostnames: ["claude.ai"],
      inputSelectors: ['div[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "gemini",
      tool: "Gemini",
      hostnames: ["gemini.google.com"],
      inputSelectors: ['rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "contenteditable"
    },
    {
      id: "perplexity",
      tool: "Perplexity",
      hostnames: ["perplexity.ai", "www.perplexity.ai"],
      inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "lovable",
      tool: "Lovable",
      hostnames: ["lovable.dev"],
      inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "textarea-first"
    },
    {
      id: "bolt",
      tool: "Bolt",
      hostnames: ["bolt.new"],
      inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "textarea-first"
    },
    {
      id: "v0",
      tool: "v0",
      hostnames: ["v0.dev"],
      inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "textarea-first"
    },
    {
      id: "replit",
      tool: "Replit",
      hostnames: ["replit.com"],
      inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
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
    return selectors.flatMap((selector) => Array.from(documentRef.querySelectorAll(selector)));
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
    writeInput
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptSiteAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
