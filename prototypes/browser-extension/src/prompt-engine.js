(function initSmartPromptEngine(root) {
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

  const api = loadSharedCore();
  if (!api) {
    throw new Error("Smart Prompt shared core must be loaded before prompt-engine.js");
  }

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
