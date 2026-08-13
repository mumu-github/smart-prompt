(function initSmartPromptSiteAdapters(root) {
  const WRITE_CONTRACT_VERSION = "chatgpt-stable-write@1";

  function loadSharedCore() {
    if (root.SmartPromptCore) return root.SmartPromptCore;
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try {
        return require("./smart-prompt-core.js");
      } catch {
        return require("../../../packages/shared/smart-prompt-core.js");
      }
    }
    return null;
  }

  const sharedCore = loadSharedCore();
  const SITE_ADAPTERS = Object.freeze((sharedCore?.SITE_ADAPTERS || []).map((adapter) => Object.freeze({
    ...adapter,
    hostnames: Object.freeze([...(adapter.hostnames || [])]),
    inputSelectors: Object.freeze([...(adapter.inputSelectors || [])])
  })));
  if (!SITE_ADAPTERS.length) {
    throw new Error("Smart Prompt shared core SITE_ADAPTERS must be loaded before site-adapters.js");
  }
  function detectSiteAdapter(hostname) {
    const host = String(hostname || "").toLowerCase();
    return SITE_ADAPTERS.find((adapter) => adapter.hostnames.some((name) => host === name || host.endsWith(`.${name}`))) || null;
  }

  function isChatgptComposerCandidate(element) {
    if (!element) return false;
    const id = String(element.id || "");
    const dataId = String(element.getAttribute?.("data-id") || "");
    const testId = String(element.getAttribute?.("data-testid") || "");
    return id === "prompt-textarea" || dataId === "prompt-textarea" || testId === "prompt-textarea";
  }

  function isWritableInputCandidate(element, adapter) {
    if (adapter?.id === "chatgpt") return isChatgptComposerCandidate(element);
    return Boolean(element);
  }

  function queryInputCandidates(documentRef, adapter) {
    const selectors = adapter?.inputSelectors?.length
      ? adapter.inputSelectors
      : ['textarea', 'input[type="text"]', 'input[type="search"]', '[contenteditable="true"]', '[role="textbox"]'];
    return [...new Set(selectors.flatMap((selector) => querySelectorAllDeep(documentRef, selector)))].filter((element) =>
      isWritableInputCandidate(element, adapter)
    );
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
    const normalizedValue = String(value ?? "").replace(/\r\n?/g, "\n");
    const ownerDocument = element.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (
      ownerDocument?.createElement
      && ownerDocument?.createTextNode
      && typeof element.replaceChildren === "function"
    ) {
      const paragraph = ownerDocument.createElement("p");
      normalizedValue.split("\n").forEach((line, index) => {
        if (index > 0) paragraph.appendChild(ownerDocument.createElement("br"));
        if (line) paragraph.appendChild(ownerDocument.createTextNode(line));
      });
      element.replaceChildren(paragraph);
    } else {
      element.textContent = normalizedValue;
    }
    const selection = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
    if (selection && typeof document !== "undefined" && document.createRange) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    dispatchInputEvents(element, normalizedValue, { replacement: true });
    return true;
  }

  function createEvent(type, value, { replacement = false } = {}) {
    if (type === "input" && typeof InputEvent !== "undefined") {
      return new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: replacement ? "insertReplacementText" : "insertText",
        data: replacement ? null : value
      });
    }
    if (typeof Event !== "undefined") {
      return new Event(type, { bubbles: true, composed: true });
    }
    return { type, bubbles: true, composed: true, inputType: type === "input" ? "insertText" : undefined, data: value };
  }

  function dispatchInputEvents(element, value, options) {
    element.dispatchEvent?.(createEvent("input", value, options));
    element.dispatchEvent?.(createEvent("change", value, options));
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
    const targetKind = adapter?.id === "chatgpt" ? "chatgpt-composer" : `${adapter?.id || "generic"}-input`;
    if (!isWritableInputCandidate(element, adapter)) {
      return {
        ok: false,
        verified: false,
        kind: "",
        strategy: adapter?.insertStrategy || "contenteditable-or-textarea",
        targetKind: "unknown",
        reason: adapter?.id === "chatgpt" ? "chatgpt_target_not_composer" : "unsupported_target"
      };
    }
    element?.focus?.();
    const strategy = adapter?.insertStrategy || "contenteditable-or-textarea";
    for (const kind of getWritePlan(adapter, element)) {
      const result = attemptWrite(kind, element, value);
      if (result.verified) return { ...result, strategy, targetKind };
    }
    return {
      ok: false,
      verified: false,
      kind: "",
      strategy,
      targetKind,
      reason: "no_supported_write_strategy",
      valueLength: String(value || "").length
    };
  }

  function verifyStableWrite(result, element, expectedValue) {
    if (!result?.verified) return result;
    const stableReadback = readInputValue(element) === String(expectedValue ?? "");
    return {
      ...result,
      ok: stableReadback,
      verified: stableReadback,
      stableReadback,
      reason: stableReadback ? "stable_readback_verified" : "stable_readback_mismatch"
    };
  }

  const api = {
    WRITE_CONTRACT_VERSION,
    SITE_ADAPTERS,
    detectSiteAdapter,
    isWritableInputCandidate,
    queryInputCandidates,
    querySelectorAllDeep,
    readInputValue,
    verifyStableWrite,
    writeInput
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptSiteAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
