const { execFile } = require("node:child_process");
const path = require("node:path");
const { detectDesktopTool, DESKTOP_TOOL_PROFILES } = require("../../../packages/shared/desktop-tool-profiles");

const UNSUPPORTED_DESKTOP_INPUT_REASON = "desktop_input_requires_windows_uia";
const PENDING_DESKTOP_INPUT_BACKENDS = ["macos_axuielement", "linux_atspi"];

function rootDir() {
  return path.resolve(__dirname, "../../..");
}

function buildDesktopInputCapability(platform = process.platform, capability = {}) {
  const normalizedPlatform = String(platform || process.platform);
  const isWindows = normalizedPlatform === "win32";
  const pendingBackends = Array.isArray(capability.pendingBackends)
    ? capability.pendingBackends
    : PENDING_DESKTOP_INPUT_BACKENDS;
  return {
    supported: Object.prototype.hasOwnProperty.call(capability, "supported")
      ? Boolean(capability.supported)
      : isWindows,
    snapshotBackend: String(capability.snapshotBackend || (isWindows ? "windows_uia" : "none")).slice(0, 80),
    fillBackend: String(capability.fillBackend || (isWindows ? "windows_uia_or_clipboard_fallback" : "none")).slice(0, 80),
    requiredPlatform: "win32",
    unsupportedReason: String(capability.unsupportedReason || capability.reason || (isWindows ? "" : UNSUPPORTED_DESKTOP_INPUT_REASON)).slice(0, 120),
    pendingBackends: pendingBackends.map((backend) => String(backend).slice(0, 80)).slice(0, 8)
  };
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

function isCodexBrowserLikeComposerCandidate(profileId = "unknown", candidate = {}, signals = {}) {
  if (profileId !== "codex") return false;
  if (String(candidate.controlType || "") !== "ControlType.Document") return false;
  if (!Boolean(candidate.isEnabled) || !Boolean(candidate.isKeyboardFocusable)) return false;
  if (!Boolean(signals.broadDocument)) return false;
  if (!Boolean(signals.nearWindowBottom)) return false;
  return Boolean(
    signals.hasKeyboardFocus ||
      signals.focusedElementMatch ||
      signals.caretWithinBounds ||
      signals.caretWindowMatch ||
      signals.cursorWithinBounds
  );
}

function sanitizeSnapshot(snapshot = {}) {
  const foreground = snapshot.foreground || {};
  const platform = String(snapshot.platform || process.platform);
  const detected = detectDesktopTool({
    processName: foreground.processName,
    windowTitle: foreground.windowTitle || foreground.title
  });
  const detectedProfile = snapshot.summary?.detectedToolProfile || foreground.detectedToolProfile || detected?.id || "unknown";
  const sanitizeSignals = (signals = {}) => ({
    score: Number(signals.score || 0),
    hasKeyboardFocus: Boolean(signals.hasKeyboardFocus),
    focusedElementMatch: Boolean(signals.focusedElementMatch),
    caretWithinBounds: Boolean(signals.caretWithinBounds),
    caretWindowMatch: Boolean(signals.caretWindowMatch),
    cursorWithinBounds: Boolean(signals.cursorWithinBounds),
    nearWindowBottom: Boolean(signals.nearWindowBottom),
    broadDocument: Boolean(signals.broadDocument),
    semanticComposerHint: Boolean(signals.semanticComposerHint),
    visualFallback: Boolean(signals.visualFallback),
    profileComposerCandidate: Boolean(signals.profileComposerCandidate)
  });
  const bestCandidateIndex = Number(snapshot.summary?.bestCandidateIndex ?? -1);
  const rawCandidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
  const browserLikeComposerCandidateCount = rawCandidates.reduce((count, candidate) => {
    return count + Number(isCodexBrowserLikeComposerCandidate(detectedProfile, candidate, candidate?.inputSignals || {}));
  }, 0);
  const candidatesToExpose = rawCandidates.slice(0, 50);
  const bestCandidate = rawCandidates.find((candidate) => Number(candidate.index) === bestCandidateIndex);
  if (bestCandidate && !candidatesToExpose.some((candidate) => Number(candidate.index) === bestCandidateIndex)) {
    candidatesToExpose.push(bestCandidate);
  }
  const sanitizeCandidate = (candidate) => ({
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
    },
    inputSignals: sanitizeSignals(candidate.inputSignals),
    isBrowserLikeComposerCandidate: isCodexBrowserLikeComposerCandidate(
      detectedProfile,
      candidate,
      candidate?.inputSignals || {}
    )
  });
  return {
    schemaVersion: snapshot.schemaVersion || "m3-desktop-input@1",
    createdAt: snapshot.createdAt || new Date().toISOString(),
    platform,
    selfTest: Boolean(snapshot.selfTest),
    probeOk: Boolean(snapshot.probeOk),
    pass: Boolean(snapshot.pass),
    foreground: {
      processName: String(foreground.processName || "").slice(0, 80),
      pidPresent: Boolean(foreground.pidPresent),
      isVisible: Object.prototype.hasOwnProperty.call(foreground, "isVisible") ? Boolean(foreground.isVisible) : true,
      isMinimized: Boolean(foreground.isMinimized),
      isCloaked: Boolean(foreground.isCloaked),
      isUsable: Object.prototype.hasOwnProperty.call(foreground, "isUsable") ? Boolean(foreground.isUsable) : true,
      boundingRect: {
        x: Number(foreground.boundingRect?.x || 0),
        y: Number(foreground.boundingRect?.y || 0),
        width: Number(foreground.boundingRect?.width || 0),
        height: Number(foreground.boundingRect?.height || 0)
      },
      titleLength: Number(foreground.titleLength || 0),
      titleHash: String(foreground.titleHash || "").slice(0, 64),
      detectedToolProfile: foreground.detectedToolProfile || detected?.id || "unknown",
      childProcessCount: Number(foreground.childProcessCount || 0),
      childToolProcessHintPresent: Boolean(foreground.childToolProcessHintPresent)
    },
    caret: {
      source: String(snapshot.caret?.source || "win32_get_gui_thread_info").slice(0, 80),
      supported: Boolean(snapshot.caret?.supported),
      visible: Boolean(snapshot.caret?.visible),
      windowHandlePresent: Boolean(snapshot.caret?.windowHandlePresent),
      rect: {
        x: Number(snapshot.caret?.rect?.x || 0),
        y: Number(snapshot.caret?.rect?.y || 0),
        width: Number(snapshot.caret?.rect?.width || 0),
        height: Number(snapshot.caret?.rect?.height || 0)
      },
      virtualCaretMayBeHidden: true
    },
    supportedToolProfiles: DESKTOP_TOOL_PROFILES.map((profile) => profile.id),
    capability: buildDesktopInputCapability(platform, snapshot.capability),
    candidates: candidatesToExpose.map(sanitizeCandidate),
    summary: {
      candidateCount: Number(snapshot.summary?.candidateCount || snapshot.candidates?.length || 0),
      safeCandidateCount: Number(snapshot.summary?.safeCandidateCount ?? snapshot.summary?.candidateCount ?? snapshot.candidates?.length ?? 0),
      valuePatternCandidates: Number(snapshot.summary?.valuePatternCandidates || 0),
      textPatternCandidates: Number(snapshot.summary?.textPatternCandidates || 0),
      focusableCandidates: Number(snapshot.summary?.focusableCandidates || 0),
      focusedCandidateCount: Number(snapshot.summary?.focusedCandidateCount || 0),
      caretCandidateCount: Number(snapshot.summary?.caretCandidateCount || 0),
      semanticCandidateCount: Number(snapshot.summary?.semanticCandidateCount || 0),
      bestCandidateIndex: Number(snapshot.summary?.bestCandidateIndex ?? -1),
      bestCandidateScore: Number(snapshot.summary?.bestCandidateScore || 0),
      caretVisible: Boolean(snapshot.summary?.caretVisible),
      caretWindowPresent: Boolean(snapshot.summary?.caretWindowPresent),
      detectedToolProfile: detectedProfile,
      browserLikeComposerCandidateCount
    },
    privacy: {
      titleRedacted: true,
      elementNamesHashed: true,
      elementValuesNotRead: true,
      caretTextNotRead: true,
      promptTextNotRead: true
    },
    reason: snapshot.reason || ""
  };
}

function sanitizeFillReport(report = {}) {
  const platform = String(report.platform || process.platform);
  const sanitizeSignals = (signals = {}) => ({
    score: Number(signals.score || 0),
    hasKeyboardFocus: Boolean(signals.hasKeyboardFocus),
    focusedElementMatch: Boolean(signals.focusedElementMatch),
    caretWithinBounds: Boolean(signals.caretWithinBounds),
    caretWindowMatch: Boolean(signals.caretWindowMatch),
    cursorWithinBounds: Boolean(signals.cursorWithinBounds),
    nearWindowBottom: Boolean(signals.nearWindowBottom),
    broadDocument: Boolean(signals.broadDocument),
    semanticComposerHint: Boolean(signals.semanticComposerHint),
    visualFallback: Boolean(signals.visualFallback),
    profileComposerCandidate: Boolean(signals.profileComposerCandidate)
  });
  return {
    schemaVersion: report.schemaVersion || "m3-windows-fill@1",
    createdAt: report.createdAt || new Date().toISOString(),
    platform,
    selfTest: Boolean(report.selfTest),
    confirmForeground: Boolean(report.confirmForeground),
    allowClipboardFallback: Boolean(report.allowClipboardFallback),
    allowTextPatternVerification: Boolean(report.allowTextPatternVerification),
    pass: Boolean(report.pass),
    writeAttempted: Boolean(report.writeAttempted),
    verified: Boolean(report.verified),
    strategy: String(report.strategy || "").slice(0, 80),
    uiaSetValueTried: Boolean(report.uiaSetValueTried),
    clipboardFallbackTried: Boolean(report.clipboardFallbackTried),
    clipboardRestored: Boolean(report.clipboardRestored),
    textPatternVerificationTried: Boolean(report.textPatternVerificationTried),
    textPatternVerificationMatched: Boolean(report.textPatternVerificationMatched),
    valuePatternVerificationTried: Boolean(report.valuePatternVerificationTried),
    valuePatternVerificationMatched: Boolean(report.valuePatternVerificationMatched),
    nearbyTextVerificationTried: Boolean(report.nearbyTextVerificationTried),
    nearbyTextVerificationMatched: Boolean(report.nearbyTextVerificationMatched),
    target: {
      controlType: String(report.target?.controlType || "").slice(0, 80),
      classNameHash: String(report.target?.classNameHash || "").slice(0, 64),
      hasValuePattern: Boolean(report.target?.hasValuePattern),
      hasTextPattern: Boolean(report.target?.hasTextPattern),
      hasNativeWindowHandle: Boolean(report.target?.hasNativeWindowHandle),
      directWriteBlocked: Boolean(report.target?.directWriteBlocked),
      index: Number(report.target?.index || 0),
      titleLength: Number(report.target?.titleLength || 0),
      titleHash: String(report.target?.titleHash || "").slice(0, 64),
      boundingRect: {
        x: Number(report.target?.boundingRect?.x || 0),
        y: Number(report.target?.boundingRect?.y || 0),
        width: Number(report.target?.boundingRect?.width || 0),
        height: Number(report.target?.boundingRect?.height || 0)
      },
      inputSignals: sanitizeSignals(report.target?.inputSignals)
    },
    foreground: {
      processName: String(report.foreground?.processName || "").slice(0, 80),
      pidPresent: Boolean(report.foreground?.pidPresent),
      titleLength: Number(report.foreground?.titleLength || 0),
      titleHash: String(report.foreground?.titleHash || "").slice(0, 64),
      detectedToolProfile: String(report.foreground?.detectedToolProfile || "unknown").slice(0, 80),
      childProcessCount: Number(report.foreground?.childProcessCount || 0),
      childToolProcessHintPresent: Boolean(report.foreground?.childToolProcessHintPresent),
      expectedTitleHashMatched: Boolean(report.foreground?.expectedTitleHashMatched),
      expectedToolProfileMatched: Boolean(report.foreground?.expectedToolProfileMatched)
    },
    summary: {
      candidateCount: Number(report.summary?.candidateCount || 0),
      safeCandidateCount: Number(report.summary?.safeCandidateCount ?? report.summary?.candidateCount ?? 0),
      focusedCandidateCount: Number(report.summary?.focusedCandidateCount || 0),
      caretCandidateCount: Number(report.summary?.caretCandidateCount || 0),
      semanticCandidateCount: Number(report.summary?.semanticCandidateCount || 0),
      bestCandidateIndex: Number(report.summary?.bestCandidateIndex ?? -1),
      bestCandidateScore: Number(report.summary?.bestCandidateScore || 0),
      requestedTextLength: Number(report.summary?.requestedTextLength || 0),
      requestedTextHash: String(report.summary?.requestedTextHash || "").slice(0, 64),
      verifiedTextLength: Number(report.summary?.verifiedTextLength || 0),
      verifiedTextHash: String(report.summary?.verifiedTextHash || "").slice(0, 64),
      textPatternVerificationReadLength: Number(report.summary?.textPatternVerificationReadLength || 0),
      textPatternVerificationTextHash: String(report.summary?.textPatternVerificationTextHash || "").slice(0, 64),
      valuePatternVerificationReadLength: Number(report.summary?.valuePatternVerificationReadLength || 0),
      valuePatternVerificationTextHash: String(report.summary?.valuePatternVerificationTextHash || "").slice(0, 64),
      nearbyTextVerificationInspectedElementCount: Number(report.summary?.nearbyTextVerificationInspectedElementCount || 0),
      nearbyTextVerificationReadableElementCount: Number(report.summary?.nearbyTextVerificationReadableElementCount || 0),
      nearbyTextVerificationReadLength: Number(report.summary?.nearbyTextVerificationReadLength || 0),
      nearbyTextVerificationTextHash: String(report.summary?.nearbyTextVerificationTextHash || "").slice(0, 64),
      nearbyTextVerificationSource: String(report.summary?.nearbyTextVerificationSource || "").slice(0, 80),
      autoSubmit: Boolean(report.summary?.autoSubmit),
      submitSignalCount: Number(report.summary?.submitSignalCount || 0)
    },
    supportedToolProfiles: DESKTOP_TOOL_PROFILES.map((profile) => profile.id),
    capability: buildDesktopInputCapability(platform, report.capability),
    privacy: {
      titleRedacted: true,
      elementNamesHashed: true,
      elementValuesNotReadBeforeWrite: true,
      writtenTextNotStored: true,
      clipboardTextNotStored: true,
      fallbackRequiresExplicitAllow: true,
      textPatternVerificationRequiresExplicitAllow: true,
      verificationTextNotStored: true,
      verificationUsesLengthAndHash: true,
      caretTextNotRead: true,
      promptTextNotRead: true,
      autoSubmit: false
    },
    reason: report.reason || ""
  };
}

function createUnsupportedDesktopInputSnapshot(platform = process.platform) {
  return sanitizeSnapshot({
    schemaVersion: "m3-desktop-input@1",
    platform,
    probeOk: false,
    pass: false,
    reason: UNSUPPORTED_DESKTOP_INPUT_REASON,
    supportedToolProfiles: DESKTOP_TOOL_PROFILES.map((profile) => profile.id),
    capability: buildDesktopInputCapability(platform, {
      supported: false,
      snapshotBackend: "none",
      fillBackend: "none",
      unsupportedReason: UNSUPPORTED_DESKTOP_INPUT_REASON
    }),
    candidates: [],
    summary: {
      candidateCount: 0,
      safeCandidateCount: 0,
      bestCandidateIndex: -1,
      bestCandidateScore: 0
    }
  });
}

function createUnsupportedDesktopFillReport(options = {}) {
  const platform = options.platform || process.platform;
  return sanitizeFillReport({
    schemaVersion: "m3-windows-fill@1",
    platform,
    selfTest: Boolean(options.selfTest),
    pass: false,
    writeAttempted: false,
    verified: false,
    reason: UNSUPPORTED_DESKTOP_INPUT_REASON,
    capability: buildDesktopInputCapability(platform, {
      supported: false,
      snapshotBackend: "none",
      fillBackend: "none",
      unsupportedReason: UNSUPPORTED_DESKTOP_INPUT_REASON
    }),
    summary: {
      autoSubmit: false,
      submitSignalCount: 0
    }
  });
}

async function getDesktopInputSnapshot(options = {}) {
  if (options.snapshot) return sanitizeSnapshot(options.snapshot);
  if (process.platform !== "win32") {
    return createUnsupportedDesktopInputSnapshot(process.platform);
  }
  const script = path.join(rootDir(), "scripts", "check-m3-desktop-input.ps1");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-JsonOnly"];
  if (options.selfTest) args.push("-SelfTest");
  const raw = await runPowerShellJson(args, options.timeoutMs || 8000);
  return sanitizeSnapshot(raw);
}

async function fillDesktopInput(options = {}) {
  if (options.report) return sanitizeFillReport(options.report);
  if (process.platform !== "win32") {
    return createUnsupportedDesktopFillReport({
      platform: process.platform,
      selfTest: Boolean(options.selfTest)
    });
  }
  const script = path.join(rootDir(), "scripts", "check-m3-desktop-fill.ps1");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-JsonOnly"];
  if (options.selfTest) args.push("-SelfTest");
  if (options.confirmForeground) args.push("-ConfirmForeground");
  if (options.allowClipboardFallback) args.push("-AllowClipboardFallback");
  if (options.allowTextPatternVerification) args.push("-AllowTextPatternVerification");
  if (options.expectedTitleHash) args.push("-ExpectedTitleHash", String(options.expectedTitleHash));
  if (options.expectedToolProfile) args.push("-ExpectedToolProfile", String(options.expectedToolProfile));
  if (Number.isFinite(Number(options.candidateIndex))) args.push("-CandidateIndex", String(Number(options.candidateIndex)));
  if (options.text) args.push("-Text", String(options.text));
  const raw = await runPowerShellJson(args, options.timeoutMs || 10000);
  return sanitizeFillReport(raw);
}

module.exports = {
  DESKTOP_TOOL_PROFILES,
  UNSUPPORTED_DESKTOP_INPUT_REASON,
  buildDesktopInputCapability,
  createUnsupportedDesktopFillReport,
  createUnsupportedDesktopInputSnapshot,
  detectDesktopTool,
  fillDesktopInput,
  getDesktopInputSnapshot,
  sanitizeFillReport,
  sanitizeSnapshot
};
