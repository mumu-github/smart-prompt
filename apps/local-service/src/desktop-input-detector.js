const { execFile } = require("node:child_process");
const path = require("node:path");
const { detectDesktopTool, DESKTOP_TOOL_PROFILES } = require("../../../packages/shared/desktop-tool-profiles");

function rootDir() {
  return path.resolve(__dirname, "../../..");
}

function runPowerShellJson(args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = execFile("powershell", args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(String(stdout || "").replace(/^\uFEFF/, "").trim()));
      } catch (parseError) {
        parseError.stdout = stdout;
        reject(parseError);
      }
    });
    child.stdin?.end();
  });
}

function sanitizeSnapshot(snapshot = {}) {
  const foreground = snapshot.foreground || {};
  const detected = detectDesktopTool({
    processName: foreground.processName,
    windowTitle: foreground.windowTitle || foreground.title
  });
  return {
    schemaVersion: snapshot.schemaVersion || "m3-desktop-input@1",
    createdAt: snapshot.createdAt || new Date().toISOString(),
    platform: snapshot.platform || process.platform,
    selfTest: Boolean(snapshot.selfTest),
    probeOk: Boolean(snapshot.probeOk),
    pass: Boolean(snapshot.pass),
    foreground: {
      processName: String(foreground.processName || "").slice(0, 80),
      pidPresent: Boolean(foreground.pidPresent),
      titleLength: Number(foreground.titleLength || 0),
      titleHash: String(foreground.titleHash || "").slice(0, 64),
      detectedToolProfile: foreground.detectedToolProfile || detected?.id || "unknown"
    },
    supportedToolProfiles: DESKTOP_TOOL_PROFILES.map((profile) => profile.id),
    candidates: Array.isArray(snapshot.candidates) ? snapshot.candidates.slice(0, 50).map((candidate) => ({
      index: Number(candidate.index || 0),
      controlType: String(candidate.controlType || "").slice(0, 80),
      nameHash: String(candidate.nameHash || "").slice(0, 64),
      automationIdHash: String(candidate.automationIdHash || "").slice(0, 64),
      classNameHash: String(candidate.classNameHash || "").slice(0, 64),
      isKeyboardFocusable: Boolean(candidate.isKeyboardFocusable),
      isEnabled: Boolean(candidate.isEnabled),
      hasValuePattern: Boolean(candidate.hasValuePattern),
      hasTextPattern: Boolean(candidate.hasTextPattern),
      boundingRect: {
        x: Number(candidate.boundingRect?.x || 0),
        y: Number(candidate.boundingRect?.y || 0),
        width: Number(candidate.boundingRect?.width || 0),
        height: Number(candidate.boundingRect?.height || 0)
      }
    })) : [],
    summary: {
      candidateCount: Number(snapshot.summary?.candidateCount || snapshot.candidates?.length || 0),
      valuePatternCandidates: Number(snapshot.summary?.valuePatternCandidates || 0),
      textPatternCandidates: Number(snapshot.summary?.textPatternCandidates || 0),
      focusableCandidates: Number(snapshot.summary?.focusableCandidates || 0),
      detectedToolProfile: snapshot.summary?.detectedToolProfile || foreground.detectedToolProfile || detected?.id || "unknown"
    },
    privacy: {
      titleRedacted: true,
      elementNamesHashed: true,
      elementValuesNotRead: true,
      promptTextNotRead: true
    },
    reason: snapshot.reason || ""
  };
}

async function getDesktopInputSnapshot(options = {}) {
  if (options.snapshot) return sanitizeSnapshot(options.snapshot);
  if (process.platform !== "win32") {
    return sanitizeSnapshot({
      schemaVersion: "m3-desktop-input@1",
      platform: process.platform,
      probeOk: false,
      pass: false,
      reason: "macos_ax_pending_or_unsupported_platform",
      supportedToolProfiles: DESKTOP_TOOL_PROFILES.map((profile) => profile.id),
      candidates: []
    });
  }
  const script = path.join(rootDir(), "scripts", "check-m3-desktop-input.ps1");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-JsonOnly"];
  if (options.selfTest) args.push("-SelfTest");
  const raw = await runPowerShellJson(args, options.timeoutMs || 8000);
  return sanitizeSnapshot(raw);
}

module.exports = {
  DESKTOP_TOOL_PROFILES,
  detectDesktopTool,
  getDesktopInputSnapshot,
  sanitizeSnapshot
};
