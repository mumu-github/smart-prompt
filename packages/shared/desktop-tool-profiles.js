(function initSmartPromptDesktopToolProfiles(root) {
  const DEFAULT_PROFILE_CONFIG = Object.freeze({
    schemaVersion: "smart-prompt-desktop-tool-profiles@1",
    supportedProfiles: ["codex", "claude-code", "hermes", "workbuddy", "trae"],
    trustedOverlayClickProfiles: ["codex", "workbuddy", "trae"],
    profiles: [
      {
        id: "codex",
        label: "Codex",
        kind: "desktop-cli",
        processHints: ["codex", "openaicodex", "codex desktop"],
        titlePatterns: ["codex", "openai codex", "openai-codex"],
        trustedExecutablePathPatterns: ["^[A-Za-z]:\\\\(?:Program Files\\\\)?WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+__2p2nqsd0c76g0\\\\app\\\\ChatGPT\\.exe$"],
        inputKinds: ["terminal", "webview", "textarea", "edit"]
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
      },
      {
        id: "workbuddy",
        label: "workBuddy",
        kind: "desktop-app",
        processHints: ["workbuddy", "work-buddy"],
        titlePatterns: ["workbuddy", "work buddy", "work-buddy"],
        inputKinds: ["webview", "textarea", "edit"]
      },
      {
        id: "trae",
        label: "Trae",
        kind: "desktop-app",
        processHints: ["trae"],
        titlePatterns: ["trae"],
        inputKinds: ["webview", "textarea", "edit"]
      }
    ],
    policies: {
      workbuddy: { composerGuard: { allowWeakSignalClipboardFallback: false } },
      trae: { composerGuard: { allowWeakSignalClipboardFallback: true } }
    }
  });

  function loadProfileConfig() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try {
        return require("./desktop-tool-profiles.json");
      } catch {
        return DEFAULT_PROFILE_CONFIG;
      }
    }
    return DEFAULT_PROFILE_CONFIG;
  }

  const DESKTOP_TOOL_PROFILE_CONFIG = Object.freeze(loadProfileConfig());
  const DESKTOP_TOOL_PROFILES = Object.freeze([...(DESKTOP_TOOL_PROFILE_CONFIG.profiles || [])]);

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function detectDesktopTool(metadata = {}) {
    const processName = normalize(metadata.processName || metadata.appName || "");
    const title = normalize(metadata.windowTitle || metadata.title || "");
    const executablePath = String(metadata.executablePath || metadata.processPath || "");
    const haystack = `${processName} ${title}`;
    const profile = DESKTOP_TOOL_PROFILES.find((item) => {
      const titleMatched = item.titlePatterns.some((pattern) => haystack.includes(normalize(pattern)));
      if (titleMatched) return true;
      const executableMatched = (item.trustedExecutablePathPatterns || []).some((pattern) => {
        try {
          return new RegExp(pattern, "i").test(executablePath);
        } catch {
          return false;
        }
      });
      if (executableMatched) return true;
      return item.processHints.some((hint) => processName === normalize(hint));
    });
    return profile || null;
  }

  const api = {
    DESKTOP_TOOL_PROFILES,
    DESKTOP_TOOL_PROFILE_CONFIG,
    detectDesktopTool,
    normalize
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptDesktopToolProfiles = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
