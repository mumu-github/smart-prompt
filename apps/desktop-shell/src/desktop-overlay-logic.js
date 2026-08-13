(function initDesktopOverlayLogic(root) {
  const DEFAULT_OVERLAY_SIZE = Object.freeze({ width: 320, height: 360 });
  const DEFAULT_COMPACT_SIZE = Object.freeze({ width: 72, height: 72 });
  const DEFAULT_COMPACT_GAP = 12;
  const DEFAULT_SUBMIT_AVOIDANCE_WIDTH = 120;

  function isMachineVerifiedCodexUndo(result = {}) {
    const writeMethod = String(result.writeMethod || "");
    const clipboardSafe = writeMethod !== "controlled_clipboard"
      || result.clipboardRestored === true;
    return result.operation === "undo"
      && result.status === "ready"
      && result.attempted === true
      && result.verified === false
      && result.verification === "machine"
      && ["direct", "controlled_clipboard"].includes(writeMethod)
      && result.foregroundVerified === true
      && result.targetIdentityVerified === true
      && result.focusVerified === true
      && result.draftUnchanged === true
      && result.payloadFresh === true
      && result.readbackMatched === true
      && result.noAutoSubmit === true
      && clipboardSafe;
  }

  function normalizeOverlayProfiles(value) {
    if (value && typeof value.has === "function") return value;
    return new Set(Array.isArray(value) ? value : []);
  }

  function isCodexBrowserLikeComposerCandidate(profile, candidate) {
    if (profile !== "codex") return false;
    const signals = candidate?.inputSignals || {};
    return Boolean(
      String(candidate?.controlType || "") === "ControlType.Document"
        && candidate?.isEnabled
        && candidate?.isKeyboardFocusable
        && signals.broadDocument
        && signals.nearWindowBottom
        && (
          signals.hasKeyboardFocus
          || signals.focusedElementMatch
          || signals.caretWithinBounds
          || signals.caretWindowMatch
          || signals.cursorWithinBounds
        )
    );
  }

  function getDesktopSnapshotReadiness(snapshot = {}, options = {}) {
    const overlayProfiles = normalizeOverlayProfiles(options.overlayProfiles);
    const foreground = snapshot?.foreground || {};
    const summary = snapshot?.summary || {};
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
    const profile = summary.detectedToolProfile || foreground.detectedToolProfile || "unknown";
    const candidateCount = Number(summary.candidateCount || snapshot?.candidates?.length || 0);
    const safeCandidateCount = Number(summary.safeCandidateCount ?? candidateCount);
    const bestCandidateIndex = Number(summary.bestCandidateIndex ?? -1);
    const bestCandidateScore = Number(summary.bestCandidateScore || 0);
    const browserLikeComposerCandidateCount = Number(summary.browserLikeComposerCandidateCount
      ?? candidates.filter((candidate) => isCodexBrowserLikeComposerCandidate(profile, candidate)).length
      ?? 0);
    const titleHash = foreground.titleHash || "";
    const foregroundWindowHidden = foreground.isUsable === false
      || foreground.isVisible === false
      || foreground.isMinimized === true
      || foreground.isCloaked === true;
    let readinessReason = "ready";
    if (!snapshot?.summary) readinessReason = "missing-summary";
    else if (!snapshot.pass) readinessReason = "snapshot-not-passing";
    else if (profile === "unknown") readinessReason = "unknown-profile";
    else if (foregroundWindowHidden) readinessReason = "foreground-window-hidden";
    else if (candidateCount <= 0) readinessReason = "no-candidates";
    else if (safeCandidateCount <= 0) readinessReason = "no-safe-candidate";
    else if (bestCandidateIndex < 0) readinessReason = "no-best-candidate";
    else if (!titleHash) readinessReason = "missing-title-hash";

    const ready = readinessReason === "ready";
    const overlayEligible = overlayProfiles.has(profile);
    const overlayReady = ready && overlayEligible;
    const overlayReadinessReason = ready && !overlayEligible
      ? "unsupported-overlay-profile"
      : readinessReason;
    return {
      foreground,
      summary,
      profile,
      candidateCount,
      safeCandidateCount,
      browserLikeComposerCandidateCount,
      bestCandidateIndex,
      bestCandidateScore,
      titleHash,
      foregroundWindowHidden,
      ready,
      readinessReason,
      overlayEligible,
      overlayReady,
      overlayReadinessReason
    };
  }

  function isDesktopOverlayCandidate(candidate) {
    const rect = candidate?.boundingRect || {};
    const signals = candidate?.inputSignals || {};
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    const x = Number(rect.x || 0);
    const y = Number(rect.y || 0);
    const controlType = String(candidate?.controlType || "");
    if (width < 140 || height < 32 || height > 260) return false;
    if (x < -4 || y < -4) return false;
    if (signals.broadDocument) return false;
    if (controlType.includes("Button")) return false;
    return Boolean(
      controlType.includes("Edit")
        || candidate?.hasValuePattern
        || signals.hasKeyboardFocus
        || signals.focusedElementMatch
        || signals.caretWithinBounds
        || signals.semanticComposerHint
        || signals.profileComposerCandidate
        || signals.nearWindowBottom
    );
  }

  function isDesktopOverlayVisualAnchorCandidate(candidate, profile = "unknown") {
    const rect = candidate?.boundingRect || {};
    const signals = candidate?.inputSignals || {};
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    const x = Number(rect.x || 0);
    const y = Number(rect.y || 0);
    const controlType = String(candidate?.controlType || "");
    if (isDesktopOverlayCandidate(candidate)) return true;
    if (isCodexBrowserLikeComposerCandidate(profile, candidate)) return true;
    if (width < 280 || height < 36 || height > 180) return false;
    if (x < -4 || y < -4) return false;
    if (!candidate?.isEnabled) return false;
    if (signals.broadDocument) return false;
    if (controlType.includes("Document") || controlType.includes("Hyperlink")) return false;
    if (controlType.includes("Text") || controlType.includes("Image") || controlType.includes("List")) return false;
    if (controlType.includes("Button")) {
      return Boolean(signals.nearWindowBottom && width >= 240 && height <= 96);
    }
    if (!(controlType.includes("Group") || controlType.includes("Pane") || controlType.includes("Custom"))) return false;
    return Boolean(signals.nearWindowBottom || signals.semanticComposerHint || signals.profileComposerCandidate);
  }

  function getBestDesktopCandidate(snapshot = {}) {
    const readiness = getDesktopSnapshotReadiness(snapshot);
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
    return candidates.find((candidate) => Number(candidate.index) === readiness.bestCandidateIndex)
      || candidates.find((candidate) => Number(candidate.inputSignals?.score || 0) === readiness.bestCandidateScore)
      || candidates[0]
      || null;
  }

  function getDesktopOverlayCandidate(snapshot = {}, readiness = getDesktopSnapshotReadiness(snapshot)) {
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
    const bestCandidateIndex = Number(readiness?.bestCandidateIndex ?? -1);
    if (bestCandidateIndex >= 0) {
      const bestCandidate = candidates.find((candidate) => Number(candidate.index) === bestCandidateIndex);
      return bestCandidate && isDesktopOverlayCandidate(bestCandidate) ? bestCandidate : null;
    }
    return candidates
      .filter(isDesktopOverlayCandidate)
      .sort((left, right) => {
        const leftSignals = left.inputSignals || {};
        const rightSignals = right.inputSignals || {};
        const rightPriority = Number(rightSignals.semanticComposerHint || rightSignals.profileComposerCandidate || rightSignals.caretWithinBounds || rightSignals.focusedElementMatch || rightSignals.hasKeyboardFocus || 0);
        const leftPriority = Number(leftSignals.semanticComposerHint || leftSignals.profileComposerCandidate || leftSignals.caretWithinBounds || leftSignals.focusedElementMatch || leftSignals.hasKeyboardFocus || 0);
        if (rightPriority !== leftPriority) return rightPriority - leftPriority;
        const rightScore = Number(rightSignals.score || 0);
        const leftScore = Number(leftSignals.score || 0);
        if (rightScore !== leftScore) return rightScore - leftScore;
        return Number(right.boundingRect?.y || 0) - Number(left.boundingRect?.y || 0);
      })[0] || null;
  }

  function getDesktopOverlayVisualAnchorPriority(candidate) {
    const signals = candidate?.inputSignals || {};
    const controlType = String(candidate?.controlType || "");
    const strongSignal = Boolean(
      signals.semanticComposerHint
        || signals.profileComposerCandidate
        || signals.caretWithinBounds
        || signals.caretWindowMatch
        || signals.focusedElementMatch
        || signals.hasKeyboardFocus
        || signals.cursorWithinBounds
    );
    const containerLike = controlType.includes("Group") || controlType.includes("Pane") || controlType.includes("Custom");
    const buttonLike = controlType.includes("Button");
    return Number(strongSignal) * 16
      + Number(containerLike) * 8
      + Number(!buttonLike) * 4
      + Number(signals.nearWindowBottom) * 2
      + Number(candidate?.hasValuePattern || candidate?.hasTextPattern);
  }

  function getDesktopOverlayVisualAnchor(snapshot = {}, profile = "unknown") {
    const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
    const sortAnchors = (items) => items.sort((left, right) => {
      const rightPriority = getDesktopOverlayVisualAnchorPriority(right);
      const leftPriority = getDesktopOverlayVisualAnchorPriority(left);
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;
      const rightWidth = Number(right.boundingRect?.width || 0);
      const leftWidth = Number(left.boundingRect?.width || 0);
      if (rightWidth !== leftWidth) return rightWidth - leftWidth;
      return Number(right.boundingRect?.y || 0) - Number(left.boundingRect?.y || 0);
    });
    const preferredAnchors = candidates.filter((candidate) =>
      isDesktopOverlayVisualAnchorCandidate(candidate, profile)
        && !isCodexBrowserLikeComposerCandidate(profile, candidate)
    );
    const browserDocumentFallbacks = candidates.filter((candidate) =>
      isCodexBrowserLikeComposerCandidate(profile, candidate)
    );
    return sortAnchors(preferredAnchors)[0] || sortAnchors(browserDocumentFallbacks)[0] || null;
  }

  function getDesktopOverlayVisualAnchorReason(candidate, visualOnly = false) {
    const signals = candidate?.inputSignals || {};
    const controlType = String(candidate?.controlType || "");
    if (!candidate) return "missing";
    if (!visualOnly) return "safe-candidate";
    if (isCodexBrowserLikeComposerCandidate("codex", candidate)) return "browser-document";
    if (signals.caretWithinBounds || signals.caretWindowMatch) return "caret-nearby";
    if (signals.focusedElementMatch || signals.hasKeyboardFocus) return "focus-nearby";
    if (signals.cursorWithinBounds) return "cursor-nearby";
    if (signals.semanticComposerHint || signals.profileComposerCandidate) return "semantic-nearby";
    if (controlType.includes("Group") || controlType.includes("Pane") || controlType.includes("Custom")) return "bottom-container";
    if (controlType.includes("Button")) return "bottom-button";
    return "bottom-region";
  }

  function getDesktopOverlayVisualAnchorMeta(candidate, visualOnly = false) {
    const rect = candidate?.boundingRect || {};
    return {
      index: candidate ? Number(candidate.index ?? -1) : -1,
      controlType: String(candidate?.controlType || ""),
      reason: getDesktopOverlayVisualAnchorReason(candidate, visualOnly),
      visualOnly: Boolean(visualOnly),
      bounds: {
        x: Number(rect.x || 0),
        y: Number(rect.y || 0),
        width: Number(rect.width || 0),
        height: Number(rect.height || 0)
      }
    };
  }

  function getDesktopOverlayPlacement(candidate, options = {}) {
    const overlaySize = options.overlaySize || DEFAULT_OVERLAY_SIZE;
    const compactSize = options.compactSize || DEFAULT_COMPACT_SIZE;
    const compactGap = Number(options.compactGap ?? DEFAULT_COMPACT_GAP);
    const submitAvoidanceWidth = Number(options.submitAvoidanceWidth ?? DEFAULT_SUBMIT_AVOIDANCE_WIDTH);
    const rect = candidate?.boundingRect || {};
    const controlType = String(candidate?.controlType || "");
    const x = Number(rect.x || 0);
    const y = Number(rect.y || 0);
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    if (width <= 0 || height <= 0) return null;
    const preferredX = Math.max(0, Math.round(x + width - overlaySize.width));
    const preferredY = y > overlaySize.height + 12
      ? Math.round(y - overlaySize.height + 22)
      : Math.round(y + height + 8);
    const compactX = Math.max(0, Math.round(
      controlType.includes("Button")
        ? x - compactSize.width - compactGap
        : x + width - compactSize.width - submitAvoidanceWidth
    ));
    const compactY = Math.max(0, Math.round(
      controlType.includes("Button")
        ? y + (height - compactSize.height) / 2
        : y > compactSize.height + compactGap
          ? y - compactSize.height - compactGap
          : y + height + compactGap
    ));
    return {
      x: preferredX,
      y: Math.max(0, preferredY),
      compactX,
      compactY
    };
  }

  function isFastForegroundSupported(state = {}, options = {}) {
    const overlayProfiles = normalizeOverlayProfiles(options.overlayProfiles);
    const profile = String(state.detectedToolProfile || "unknown");
    return Boolean(
      overlayProfiles.has(profile)
        && state.overlaySupportedProfile !== false
        && state.isUsable !== false
        && state.isVisible !== false
        && state.isMinimized !== true
        && state.isCloaked !== true
    );
  }

  function getFastForegroundSignature(state = {}) {
    const rect = state.boundingRect || {};
    return [
      state.hwnd || "",
      state.processId || "",
      state.detectedToolProfile || "unknown",
      state.titleHash || "",
      state.titleLength || 0,
      Math.round(Number(rect.x || 0)),
      Math.round(Number(rect.y || 0)),
      Math.round(Number(rect.width || 0)),
      Math.round(Number(rect.height || 0)),
      Boolean(state.isUsable)
    ].join(":");
  }

  function getFastForegroundAnchorRect(state = {}) {
    const rect = state.boundingRect || {};
    const profile = String(state.detectedToolProfile || "unknown");
    const rootX = Number(rect.x || 0);
    const rootY = Number(rect.y || 0);
    const rootWidth = Number(rect.width || 0);
    const rootHeight = Number(rect.height || 0);
    if (rootWidth <= 0 || rootHeight <= 0) return null;
    let xRatio = 0.28;
    let yRatio = 0.72;
    let wRatio = 0.69;
    let hRatio = 0.17;
    if (profile === "trae") {
      xRatio = 0.15;
      yRatio = 0.78;
      wRatio = 0.44;
      hRatio = 0.13;
    }
    return {
      x: Math.round(rootX + rootWidth * xRatio),
      y: Math.round(rootY + rootHeight * yRatio),
      width: Math.max(80, Math.round(rootWidth * wRatio)),
      height: Math.max(48, Math.round(rootHeight * hRatio))
    };
  }

  root.SmartPromptDesktopOverlayLogic = Object.freeze({
    getBestDesktopCandidate,
    getDesktopOverlayCandidate,
    getDesktopOverlayPlacement,
    getDesktopOverlayVisualAnchor,
    getDesktopOverlayVisualAnchorMeta,
    getDesktopOverlayVisualAnchorPriority,
    getDesktopOverlayVisualAnchorReason,
    getDesktopSnapshotReadiness,
    getFastForegroundAnchorRect,
    getFastForegroundSignature,
    isCodexBrowserLikeComposerCandidate,
    isMachineVerifiedCodexUndo,
    isDesktopOverlayCandidate,
    isDesktopOverlayVisualAnchorCandidate,
    isFastForegroundSupported
  });
})(globalThis);
