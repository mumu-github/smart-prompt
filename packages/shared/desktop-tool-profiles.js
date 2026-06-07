(function initSmartPromptDesktopToolProfiles(root) {
  const DESKTOP_TOOL_PROFILES = Object.freeze([
    {
      id: "codex",
      label: "Codex",
      kind: "desktop-cli",
      processHints: ["codex"],
      titlePatterns: ["codex", "openai codex"],
      inputKinds: ["terminal", "textarea", "edit"]
    },
    {
      id: "claude-code",
      label: "Claude Code",
      kind: "desktop-cli",
      processHints: ["claude"],
      titlePatterns: ["claude code", "claude-code"],
      inputKinds: ["terminal", "textarea", "edit"]
    },
    {
      id: "hermes",
      label: "Hermes",
      kind: "desktop-cli",
      processHints: ["hermes"],
      titlePatterns: ["hermes"],
      inputKinds: ["terminal", "textarea", "edit"]
    }
  ]);

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function detectDesktopTool(metadata = {}) {
    const processName = normalize(metadata.processName || metadata.appName || "");
    const title = normalize(metadata.windowTitle || metadata.title || "");
    const haystack = `${processName} ${title}`;
    const profile = DESKTOP_TOOL_PROFILES.find((item) => {
      const titleMatched = item.titlePatterns.some((pattern) => haystack.includes(normalize(pattern)));
      if (titleMatched) return true;
      return item.processHints.some((hint) => processName === normalize(hint));
    });
    return profile || null;
  }

  const api = {
    DESKTOP_TOOL_PROFILES,
    detectDesktopTool,
    normalize
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptDesktopToolProfiles = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
