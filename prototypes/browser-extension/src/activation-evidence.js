(function initSmartPromptActivationEvidence(root) {
  const ACTIVATION_CONTRACT_VERSION = "phase3-activation@1";
  const EXTENSION_BUILD_ID = "phase3-extension-20260717-r5";
  const ACTIVATION_PROOF_VERSION = "stable-readback-proof@1";
  const ACTIVATION_EVENT_ID_PATTERN = /^activation-(?:verified_insert|copy)-\d{10,16}$/;
  const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const MAX_PENDING_ACTIVATION_ATTEMPTS = 5;

  function safeToken(value, fallback = "event") {
    const token = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return token || fallback;
  }

  function isActivationTarget(adapter) {
    return adapter?.id === "chatgpt";
  }

  function requiresModelBackedActivation(adapter, activationCompleted = false) {
    return isActivationTarget(adapter) && activationCompleted !== true;
  }

  function isModelBackedGeneration(generatedBy) {
    return String(generatedBy || "") === "llm";
  }

  function createActivationEventId(kind, now = Date.now) {
    const timestamp = typeof now === "function" ? now() : Date.now();
    return `activation-${safeToken(kind)}-${timestamp}`;
  }

  function buildBrowserSeenPayload(seenAt = new Date().toISOString()) {
    const timestamp = String(seenAt || "").trim();
    return {
      contractVersion: ACTIVATION_CONTRACT_VERSION,
      site: "chatgpt",
      seenAt: ISO_TIMESTAMP_PATTERN.test(timestamp) && !Number.isNaN(Date.parse(timestamp)) ? timestamp : ""
    };
  }

  function buildCompletionPayload({ eventId, kind, targetKind = "", stableReadback = false } = {}) {
    const normalizedEventId = safeToken(eventId, "", 120);
    if (!ACTIVATION_EVENT_ID_PATTERN.test(normalizedEventId)) return null;
    if (kind === "verified_insert") {
      if (!normalizedEventId.startsWith("activation-verified_insert-")) return null;
      if (targetKind !== "chatgpt-composer" || stableReadback !== true) return null;
      return {
        contractVersion: ACTIVATION_CONTRACT_VERSION,
        extensionBuildId: EXTENSION_BUILD_ID,
        eventId: normalizedEventId,
        site: "chatgpt",
        completionKind: "verified_insert",
        targetKind: "chatgpt-composer",
        stableReadback: true,
        verified: true,
        copied: false
      };
    }
    if (kind === "copy") {
      if (!normalizedEventId.startsWith("activation-copy-")) return null;
      return {
        contractVersion: ACTIVATION_CONTRACT_VERSION,
        extensionBuildId: EXTENSION_BUILD_ID,
        eventId: normalizedEventId,
        site: "chatgpt",
        completionKind: "copy",
        verified: false,
        copied: true
      };
    }
    return null;
  }

  function normalizePendingActivation(entry) {
    const source = entry?.payload || entry || {};
    const payload = buildCompletionPayload({
      eventId: source.eventId,
      kind: source.completionKind,
      targetKind: source.targetKind,
      stableReadback: source.stableReadback
    });
    if (!payload) return null;
    const attempts = Math.max(0, Math.min(MAX_PENDING_ACTIVATION_ATTEMPTS, Number(entry?.attempts || 0)));
    const createdAt = Number.isFinite(Number(entry?.createdAt)) ? Number(entry.createdAt) : 0;
    return { payload, attempts, createdAt };
  }

  function getPendingActivation(queue) {
    if (!Array.isArray(queue)) return null;
    for (const entry of queue) {
      const normalized = normalizePendingActivation(entry);
      if (normalized) return normalized;
    }
    return null;
  }

  function enqueuePendingActivation(queue, payload, now = Date.now) {
    const existing = getPendingActivation(queue);
    if (existing) return [existing];
    const normalized = normalizePendingActivation({
      payload,
      attempts: 0,
      createdAt: typeof now === "function" ? now() : Date.now()
    });
    return normalized ? [normalized] : [];
  }

  function replacePendingActivation(queue, payload, now = Date.now) {
    void queue;
    const normalized = normalizePendingActivation({
      payload,
      attempts: 0,
      createdAt: typeof now === "function" ? now() : Date.now()
    });
    return normalized ? [normalized] : [];
  }

  function recordPendingActivationAttempt(queue, eventId, completed = false) {
    const pending = getPendingActivation(queue);
    if (!pending || pending.payload.eventId !== eventId) return pending ? [pending] : [];
    if (completed) return [];
    return [{
      ...pending,
      attempts: Math.min(MAX_PENDING_ACTIVATION_ATTEMPTS, pending.attempts + 1)
    }];
  }

  function canRetryPendingActivation(entry) {
    const pending = normalizePendingActivation(entry);
    return Boolean(pending && pending.attempts < MAX_PENDING_ACTIVATION_ATTEMPTS);
  }

  const api = Object.freeze({
    buildBrowserSeenPayload,
    buildCompletionPayload,
    canRetryPendingActivation,
    createActivationEventId,
    enqueuePendingActivation,
    getPendingActivation,
    isActivationTarget,
    isModelBackedGeneration,
    normalizePendingActivation,
    replacePendingActivation,
    recordPendingActivationAttempt,
    requiresModelBackedActivation,
    MAX_PENDING_ACTIVATION_ATTEMPTS,
    ACTIVATION_CONTRACT_VERSION,
    EXTENSION_BUILD_ID,
    ACTIVATION_PROOF_VERSION
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptActivationEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
