"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const outcomeLearning = require(path.resolve(
  __dirname,
  "../../../../../packages/outcome-learning"
));

const ADAPTER_VERSION = "codex-windows-target-adapter@1";
const LEASE_VERSION = "codex-target-lease@1";
const DEFAULT_LEASE_TTL_MS = 30000;
const MAX_LEASE_TTL_MS = 45000;
const VERIFIED_TRANSACTION_TTL_MS = 5 * 60 * 1000;
const TRANSACTION_VERSION = "codex-verified-insert-transaction@1";
const TRANSACTION_CLAIM_VERSION = "codex-verified-insert-claim@1";
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const HWND_PATTERN = /^0x[0-9a-f]{1,16}$/i;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeEditorReadback(value) {
  const lines = String(value || "").replace(/\r\n|\r/g, "\n").split("\n");
  let fenceMarker = "";

  return lines
    .map((line) => {
      const trimmedStart = line.replace(/^[ \t]+/, "");
      const marker = trimmedStart.startsWith("```")
        ? "```"
        : trimmedStart.startsWith("~~~")
          ? "~~~"
          : "";

      if (!fenceMarker && marker) {
        fenceMarker = marker;
        return line.replace(/[ \t]+$/g, "");
      }
      if (fenceMarker) {
        if (marker === fenceMarker) {
          fenceMarker = "";
          return line.replace(/[ \t]+$/g, "");
        }
        return line;
      }

      const leading = line.match(/^[ \t]*/)?.[0] || "";
      const body = line
        .slice(leading.length)
        .replace(/[ \t]+$/g, "")
        .replace(/ {2,}/g, " ");
      return `${leading}${body}`;
    })
    .join("\n");
}

function frozen(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) frozen(child);
  return Object.freeze(value);
}

function opaqueToken(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidHwnd(value) {
  return typeof value === "string" && HWND_PATTERN.test(value);
}

function normalizeHwnd(value) {
  return String(value || "").toLowerCase();
}

function snapshotChecks(snapshot) {
  const safeSnapshot = isObject(snapshot) ? snapshot : {};
  const composer = isObject(safeSnapshot.composer) ? safeSnapshot.composer : {};
  const foregroundVerified = isValidHwnd(safeSnapshot.hwnd)
    && normalizeHwnd(safeSnapshot.foregroundHwnd) === normalizeHwnd(safeSnapshot.hwnd)
    && safeSnapshot.isVisible === true
    && safeSnapshot.isMinimized === false
    && safeSnapshot.isCloaked === false;
  const targetIdentityVerified = safeSnapshot.target === "codex"
    && safeSnapshot.isMainWindow === true
    && Number.isInteger(safeSnapshot.pid)
    && safeSnapshot.pid > 0
    && HEX_64_PATTERN.test(String(safeSnapshot.runtimeIdentityHash || ""))
    && normalizeHwnd(composer.ownerHwnd) === normalizeHwnd(safeSnapshot.hwnd)
    && typeof composer.candidateToken === "string"
    && composer.candidateToken.length > 0;
  const focusVerified = composer.focused === true
    && HEX_64_PATTERN.test(String(composer.focusIdentityHash || ""));
  return { foregroundVerified, targetIdentityVerified, focusVerified };
}

function validateSnapshot(snapshot) {
  const checks = snapshotChecks(snapshot);
  const composer = isObject(snapshot?.composer) ? snapshot.composer : {};

  if (!isObject(snapshot)) return { ok: false, reasonToken: "target_missing", checks };
  if (snapshot.target !== "codex") return { ok: false, reasonToken: "unsupported_target", checks };
  if (!isValidHwnd(snapshot.hwnd) || !isValidHwnd(snapshot.foregroundHwnd)) {
    return { ok: false, reasonToken: "target_missing", checks };
  }
  if (normalizeHwnd(snapshot.foregroundHwnd) !== normalizeHwnd(snapshot.hwnd)) {
    return { ok: false, reasonToken: "not_foreground", checks };
  }
  if (snapshot.isMainWindow !== true) {
    return { ok: false, reasonToken: "unsupported_target_main_window", checks };
  }
  if (snapshot.isVisible !== true || snapshot.isMinimized !== false || snapshot.isCloaked !== false) {
    return { ok: false, reasonToken: "target_missing_hidden", checks };
  }
  if (!Number.isInteger(snapshot.pid) || snapshot.pid <= 0) {
    return { ok: false, reasonToken: "target_missing_pid", checks };
  }
  if (!HEX_64_PATTERN.test(String(snapshot.runtimeIdentityHash || ""))) {
    return { ok: false, reasonToken: "safety_runtime_identity_required", checks };
  }
  if (!isObject(snapshot.composer)
      || normalizeHwnd(composer.ownerHwnd) !== normalizeHwnd(snapshot.hwnd)) {
    return { ok: false, reasonToken: "target_changed_composer_owner", checks };
  }
  if (typeof composer.candidateToken !== "string" || composer.candidateToken.length === 0) {
    return { ok: false, reasonToken: "safety_focused_composer_identity_required", checks };
  }
  if (composer.focused !== true
      || !HEX_64_PATTERN.test(String(composer.focusIdentityHash || ""))) {
    return { ok: false, reasonToken: "focus_required", checks };
  }
  if (composer.canReadExact !== true || typeof composer.draftText !== "string") {
    return { ok: false, reasonToken: "safety_exact_read_required", checks };
  }
  if (composer.canReplaceAll !== true
      || (composer.canSetValue !== true && composer.canControlledClipboard !== true)) {
    return { ok: false, reasonToken: "safety_full_replace_required", checks };
  }
  return { ok: true, reasonToken: "ready", checks };
}

function targetRecord(snapshot, issuedAtMs, ttlMs, projectScope) {
  return {
    leaseId: opaqueToken("lease"),
    target: "codex",
    hwnd: snapshot.hwnd,
    pid: snapshot.pid,
    runtimeIdentityHash: snapshot.runtimeIdentityHash,
    focusIdentityHash: snapshot.composer.focusIdentityHash,
    candidateToken: snapshot.composer.candidateToken,
    draftHash: sha256(snapshot.composer.draftText),
    originalDraft: snapshot.composer.draftText,
    issuedAtMs,
    expiresAtMs: issuedAtMs + ttlMs,
    projectScope,
    capabilities: {
      exactRead: true,
      fullReplace: true,
      directSetValue: snapshot.composer.canSetValue === true,
      controlledClipboard: snapshot.composer.canControlledClipboard === true,
      projectScopeReliable: projectScope.reliable
    }
  };
}

function publicLease(record) {
  return frozen({
    leaseVersion: LEASE_VERSION,
    leaseId: record.leaseId,
    target: "codex",
    hwnd: record.hwnd,
    pid: record.pid,
    runtimeIdentityHash: record.runtimeIdentityHash,
    focused: true,
    focusIdentityHash: record.focusIdentityHash,
    draftHash: record.draftHash,
    projectScopeToken: record.projectScope.token,
    projectScopeKind: record.projectScope.kind,
    projectScopeReliable: record.projectScope.reliable,
    projectScopeReason: record.projectScope.reason,
    issuedAt: new Date(record.issuedAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    capabilities: { ...record.capabilities }
  });
}

function expectedTarget(record, draftHash) {
  return frozen({
    target: "codex",
    hwnd: record.hwnd,
    pid: record.pid,
    runtimeIdentityHash: record.runtimeIdentityHash,
    focusIdentityHash: record.focusIdentityHash,
    candidateToken: record.candidateToken,
    draftHash
  });
}

function compareSnapshot(record, snapshot, expectedDraftHash, options = {}) {
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) return validation;
  const checks = validation.checks;

  if (normalizeHwnd(snapshot.hwnd) !== normalizeHwnd(record.hwnd)) {
    return { ok: false, reasonToken: "window_changed", checks };
  }
  if (snapshot.pid !== record.pid) {
    return { ok: false, reasonToken: "target_changed_pid", checks };
  }
  if (snapshot.runtimeIdentityHash !== record.runtimeIdentityHash) {
    return { ok: false, reasonToken: "target_changed_runtime_identity", checks };
  }
  if (snapshot.composer.candidateToken !== record.candidateToken) {
    return { ok: false, reasonToken: "target_changed_candidate", checks };
  }
  if (snapshot.composer.focusIdentityHash !== record.focusIdentityHash) {
    return { ok: false, reasonToken: "focus_changed", checks };
  }
  if (sha256(snapshot.composer.draftText) !== expectedDraftHash) {
    return {
      ok: false,
      reasonToken: options.draftReason || "draft_changed",
      checks
    };
  }
  return { ok: true, reasonToken: "ready", checks };
}

function isFresh(record, atMs) {
  return Number.isFinite(atMs)
    && atMs >= record.issuedAtMs
    && atMs <= record.expiresAtMs;
}

function createCodexTargetAdapter(options = {}) {
  const probeRunner = options.probeRunner;
  if (!probeRunner || typeof probeRunner.run !== "function") {
    throw new TypeError("Codex target adapter requires an injected probeRunner.run(command).");
  }

  const now = typeof options.now === "function" ? options.now : Date.now;
  const requestedTtl = Number(options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS);
  const leaseTtlMs = Number.isFinite(requestedTtl)
    ? Math.max(1, Math.min(MAX_LEASE_TTL_MS, Math.trunc(requestedTtl)))
    : DEFAULT_LEASE_TTL_MS;
  const leases = new Map();
  const undoRecords = new Map();
  const reliableProjectScopes = new Map();
  const sessionProjectScopes = new Map();
  const verifiedTransactions = new Map();
  let resultSequence = 0;

  function currentTimeMs() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError("Adapter clock must return epoch milliseconds.");
    return Math.trunc(value);
  }

  function result(operation, atMs, overrides = {}) {
    resultSequence += 1;
    const reasonToken = overrides.reasonToken || "unknown";
    const normalized = outcomeLearning.normalizeCodexTargetAdapterResult({
      contractVersion: outcomeLearning.CONTRACT_VERSIONS[
        outcomeLearning.CONTRACTS.CODEX_TARGET_ADAPTER_RESULT
      ],
      adapterResultId: `adapter_result_${process.pid}_${resultSequence}`,
      operation,
      status: overrides.status || "failed",
      target: "codex",
      attempted: overrides.attempted === true,
      verified: overrides.verified === true,
      verification: overrides.verification || "none",
      writeMethod: overrides.writeMethod || "none",
      reasonToken,
      publicReason: outcomeLearning.mapPublicReason(reasonToken),
      foregroundVerified: overrides.foregroundVerified === true,
      targetIdentityVerified: overrides.targetIdentityVerified === true,
      focusVerified: overrides.focusVerified === true,
      draftUnchanged: overrides.draftUnchanged === true,
      payloadFresh: overrides.payloadFresh === true,
      readbackMatched: overrides.readbackMatched === true,
      clipboardRestored: Object.prototype.hasOwnProperty.call(overrides, "clipboardRestored")
        ? overrides.clipboardRestored
        : null,
      noAutoSubmit: true,
      occurredAt: new Date(atMs).toISOString(),
      privacyFlags: { ...outcomeLearning.DEFAULT_PRIVACY_FLAGS }
    });
    return outcomeLearning.assertValidContract(
      outcomeLearning.CONTRACTS.CODEX_TARGET_ADAPTER_RESULT,
      normalized
    );
  }

  function flagsFrom(comparison = {}) {
    return {
      foregroundVerified: comparison.checks?.foregroundVerified === true,
      targetIdentityVerified: comparison.checks?.targetIdentityVerified === true,
      focusVerified: comparison.checks?.focusVerified === true
    };
  }

  function resolveProjectScope(snapshot) {
    if (snapshot.projectIdentityReliable === true
        && HEX_64_PATTERN.test(String(snapshot.projectIdentityHash || ""))) {
      let token = reliableProjectScopes.get(snapshot.projectIdentityHash);
      if (!token) {
        token = opaqueToken("project_scope");
        reliableProjectScopes.set(snapshot.projectIdentityHash, token);
      }
      return frozen({
        token,
        kind: "reliable_hash",
        reliable: true,
        reason: "project_scope_reliable"
      });
    }
    const windowRuntimeKey = sha256([
      normalizeHwnd(snapshot.hwnd),
      String(snapshot.pid),
      snapshot.runtimeIdentityHash
    ].join("\n"));
    let token = sessionProjectScopes.get(windowRuntimeKey);
    if (!token) {
      token = opaqueToken("project_scope_session");
      sessionProjectScopes.set(windowRuntimeKey, token);
    }
    return frozen({
      token,
      kind: "session_opaque",
      reliable: false,
      reason: "project_scope_window_runtime_session_only"
    });
  }

  function transactionHandle(transaction) {
    return frozen({
      transactionVersion: TRANSACTION_VERSION,
      transactionId: transaction.transactionId,
      target: "codex",
      projectScopeToken: transaction.projectScope.token,
      projectScopeKind: transaction.projectScope.kind,
      projectScopeReliable: transaction.projectScope.reliable,
      projectScopeReason: transaction.projectScope.reason,
      issuedAt: new Date(transaction.issuedAtMs).toISOString(),
      expiresAt: new Date(transaction.expiresAtMs).toISOString()
    });
  }

  function createVerifiedTransaction(record, adapterResult, atMs) {
    const transaction = {
      transactionId: opaqueToken("transaction"),
      adapterResultId: adapterResult.adapterResultId,
      projectScope: record.projectScope,
      issuedAtMs: atMs,
      expiresAtMs: atMs + VERIFIED_TRANSACTION_TTL_MS,
      claims: new Map()
    };
    verifiedTransactions.set(transaction.transactionId, transaction);
    return transactionHandle(transaction);
  }

  function staleResult(operation, atMs) {
    return result(operation, atMs, {
      status: "blocked",
      reasonToken: "stale_payload"
    });
  }

  function inspect() {
    let snapshot;
    try {
      snapshot = probeRunner.run(frozen({
        kind: "inspect",
        target: "codex",
        foregroundSource: "GetForegroundWindow",
        focusedComposerOnly: true,
        requireExactRead: true,
        requireFullReplace: true
      }));
    } catch (_error) {
      const atMs = currentTimeMs();
      return { result: result("inspect", atMs, { status: "failed", reasonToken: "probe_failed" }), lease: null };
    }
    const atMs = currentTimeMs();

    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      return {
        result: result("inspect", atMs, {
          status: "blocked",
          reasonToken: validation.reasonToken,
          ...flagsFrom(validation)
        }),
        lease: null
      };
    }

    const record = targetRecord(
      snapshot,
      atMs,
      leaseTtlMs,
      resolveProjectScope(snapshot)
    );
    leases.set(record.leaseId, record);
    return {
      result: result("inspect", atMs, {
        status: "ready",
        reasonToken: "ready",
        verification: "machine",
        ...flagsFrom(validation),
        draftUnchanged: true,
        payloadFresh: true,
        readbackMatched: true
      }),
      lease: publicLease(record)
    };
  }

  function readDraft(input = {}) {
    const atMs = currentTimeMs();
    const leaseId = typeof input === "string"
      ? input
      : (isObject(input) ? input.leaseId : undefined);
    const record = leases.get(leaseId);
    if (!record || !isFresh(record, atMs)) {
      if (record) leases.delete(record.leaseId);
      return { result: staleResult("read", atMs), draftText: null };
    }

    let snapshot;
    try {
      snapshot = probeRunner.run(frozen({
        kind: "read_exact",
        expected: expectedTarget(record, record.draftHash),
        scope: "same_focused_composer",
        forbidScopes: ["nearby", "root", "chat"]
      }));
    } catch (_error) {
      leases.delete(record.leaseId);
      return {
        result: result("read", atMs, { status: "failed", reasonToken: "readback_unavailable" }),
        draftText: null
      };
    }

    if (!isObject(snapshot)) {
      leases.delete(record.leaseId);
      return {
        result: result("read", atMs, { status: "failed", reasonToken: "readback_unavailable" }),
        draftText: null
      };
    }

    const comparison = compareSnapshot(record, snapshot, record.draftHash);
    if (!comparison.ok) {
      leases.delete(record.leaseId);
      return {
        result: result("read", atMs, {
          status: "blocked",
          reasonToken: comparison.reasonToken,
          ...flagsFrom(comparison),
          payloadFresh: true
        }),
        draftText: null
      };
    }

    return {
      result: result("read", atMs, {
        status: "ready",
        reasonToken: "ready",
        attempted: true,
        verification: "machine",
        ...flagsFrom(comparison),
        draftUnchanged: true,
        payloadFresh: true,
        readbackMatched: true
      }),
      draftText: snapshot.composer.draftText
    };
  }

  function atomicReplace({
    operation,
    record,
    expectedDraftHash,
    desiredText,
    allowClipboardFallback,
    atMs,
    draftReason
  }) {
    if (record.capabilities.directSetValue !== true && allowClipboardFallback !== true) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "copy_only",
          reasonToken: "permission_required_clipboard_fallback",
          payloadFresh: true
        })
      };
    }

    let reply;
    try {
      reply = probeRunner.run(frozen({
        kind: "replace_all_atomic",
        operation,
        expected: expectedTarget(record, expectedDraftHash),
        text: desiredText,
        preferDirectSetValue: true,
        allowClipboardFallback: allowClipboardFallback === true,
        leaseFreshness: operation === "insert" ? {
          leaseId: record.leaseId,
          issuedAtMs: record.issuedAtMs,
          expiresAtMs: record.expiresAtMs,
          requireFreshAtCommit: true
        } : null,
        replacementIntent: "full",
        noSubmit: true,
        prohibitedActions: ["enter", "submit", "send"]
      }));
    } catch (_error) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "write_failed_probe",
          payloadFresh: true
        })
      };
    }

    if (!isObject(reply) || !isObject(reply.before)) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "safety_atomic_revalidation_required",
          payloadFresh: true
        })
      };
    }

    const comparison = compareSnapshot(record, reply?.before, expectedDraftHash, { draftReason });
    const flags = flagsFrom(comparison);
    if (!comparison.ok) {
      const guardBypassed = reply?.attempted === true;
      return {
        success: false,
        result: result(operation, atMs, {
          status: guardBypassed ? "failed" : "blocked",
          reasonToken: guardBypassed ? "safety_atomic_guard_bypassed" : comparison.reasonToken,
          attempted: guardBypassed,
          ...flags,
          payloadFresh: true
        })
      };
    }
    if (operation === "insert" && reply.leaseFreshAtCommit !== true) {
      const guardBypassed = reply.attempted === true;
      return {
        success: false,
        result: result(operation, atMs, {
          status: guardBypassed ? "failed" : "blocked",
          reasonToken: guardBypassed ? "safety_atomic_guard_bypassed" : "stale_payload",
          attempted: guardBypassed,
          ...flags,
          payloadFresh: false
        })
      };
    }
    if (reply.guardMatched !== true) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "safety_atomic_revalidation_required",
          attempted: reply.attempted === true,
          ...flags,
          draftUnchanged: true,
          payloadFresh: true
        })
      };
    }
    if (reply.candidateRemapped === true) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "safety_candidate_remap",
          attempted: reply.attempted === true,
          ...flags,
          draftUnchanged: true,
          payloadFresh: true
        })
      };
    }
    if (reply.attempted !== true) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "write_failed_not_attempted",
          ...flags,
          draftUnchanged: true,
          payloadFresh: true
        })
      };
    }
    if (reply.submitCount !== 0) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "safety_auto_submit_signal",
          attempted: true,
          ...flags,
          draftUnchanged: true,
          payloadFresh: true
        })
      };
    }

    let writeMethod = "none";
    let clipboardRestored = null;
    if (reply.method === "direct") {
      if (reply.before.composer.canSetValue !== true || reply.replacementMode !== "set_value") {
        return {
          success: false,
          result: result(operation, atMs, {
            status: "failed",
            reasonToken: "safety_full_replace_required",
            attempted: true,
            ...flags,
            draftUnchanged: true,
            payloadFresh: true
          })
        };
      }
      writeMethod = "direct";
    } else if (reply.method === "controlled_clipboard") {
      if (allowClipboardFallback !== true) {
        return {
          success: false,
          result: result(operation, atMs, {
            status: "blocked",
            reasonToken: "permission_required_clipboard_fallback",
            attempted: true,
            ...flags,
            draftUnchanged: true,
            payloadFresh: true
          })
        };
      }
      if (reply.before.composer.canSetValue === true) {
        return {
          success: false,
          result: result(operation, atMs, {
            status: "failed",
            reasonToken: "safety_direct_write_bypassed",
            attempted: true,
            ...flags,
            draftUnchanged: true,
            payloadFresh: true
          })
        };
      }
      if (reply.before.composer.canControlledClipboard !== true
          || reply.replacementMode !== "ctrl_a_paste"
          || reply.focusConfirmed !== true
          || reply.selectAllApplied !== true
          || reply.pasteApplied !== true) {
        return {
          success: false,
          result: result(operation, atMs, {
            status: "failed",
            reasonToken: "safety_full_replace_required",
            attempted: true,
            ...flags,
            draftUnchanged: true,
            payloadFresh: true
          })
        };
      }
      if (reply.clipboardRestored !== true) {
        return {
          success: false,
          result: result(operation, atMs, {
            status: "failed",
            reasonToken: "write_failed_clipboard_restore",
            attempted: true,
            writeMethod: "none",
            clipboardRestored: false,
            ...flags,
            draftUnchanged: true,
            payloadFresh: true,
            readbackMatched: typeof reply.readbackText === "string"
              && normalizeEditorReadback(reply.readbackText) === normalizeEditorReadback(desiredText)
          })
        };
      }
      writeMethod = "controlled_clipboard";
      clipboardRestored = true;
    } else {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "write_failed_method",
          attempted: true,
          ...flags,
          draftUnchanged: true,
          payloadFresh: true
        })
      };
    }

    const readbackMatched = typeof reply.readbackText === "string"
      && normalizeEditorReadback(reply.readbackText) === normalizeEditorReadback(desiredText);
    if (!readbackMatched) {
      return {
        success: false,
        result: result(operation, atMs, {
          status: "failed",
          reasonToken: "after_write_mismatch",
          attempted: true,
          writeMethod,
          clipboardRestored,
          verification: "none",
          ...flags,
          draftUnchanged: true,
          payloadFresh: true,
          readbackMatched: false
        })
      };
    }

    return {
      success: true,
      method: writeMethod,
      result: result(operation, atMs, {
        status: "ready",
        reasonToken: operation === "insert" ? "inserted" : "succeeded",
        attempted: true,
        verified: operation === "insert",
        verification: "machine",
        writeMethod,
        clipboardRestored,
        ...flags,
        draftUnchanged: true,
        payloadFresh: true,
        readbackMatched: true
      })
    };
  }

  function insert(input = {}) {
    const atMs = currentTimeMs();
    const safeInput = isObject(input) ? input : {};
    const leaseId = safeInput.leaseId;
    const record = leases.get(leaseId);
    if (!record || !isFresh(record, atMs)) {
      if (record) leases.delete(record.leaseId);
      return { result: staleResult("insert", atMs), undoToken: null, transaction: null };
    }
    if (typeof safeInput.text !== "string") {
      leases.delete(record.leaseId);
      return {
        result: result("insert", atMs, {
          status: "failed",
          reasonToken: "write_failed_invalid_text",
          payloadFresh: true
        }),
        undoToken: null,
        transaction: null
      };
    }
    if (safeInput.expectedDraftHash !== undefined
        && safeInput.expectedDraftHash !== record.draftHash) {
      leases.delete(record.leaseId);
      return {
        result: result("insert", atMs, {
          status: "blocked",
          reasonToken: "draft_changed",
          payloadFresh: true
        }),
        undoToken: null,
        transaction: null
      };
    }

    const replacement = atomicReplace({
      operation: "insert",
      record,
      expectedDraftHash: record.draftHash,
      desiredText: safeInput.text,
      allowClipboardFallback: safeInput.allowClipboardFallback === true,
      atMs,
      draftReason: "draft_changed"
    });
    if (!replacement.success) {
      if (replacement.result.status !== "copy_only") leases.delete(record.leaseId);
      return { result: replacement.result, undoToken: null, transaction: null };
    }

    leases.delete(record.leaseId);
    undoRecords.clear();
    const undoToken = opaqueToken("undo");
    undoRecords.set(undoToken, {
      target: record,
      originalDraft: record.originalDraft,
      writtenText: safeInput.text
    });
    return {
      result: replacement.result,
      undoToken,
      transaction: createVerifiedTransaction(record, replacement.result, atMs)
    };
  }

  function undo(input = {}) {
    const atMs = currentTimeMs();
    const undoToken = typeof input === "string"
      ? input
      : (isObject(input) ? input.undoToken : undefined);
    const undoRecord = undoRecords.get(undoToken);
    if (!undoRecord) return { result: staleResult("undo", atMs) };

    const replacement = atomicReplace({
      operation: "undo",
      record: undoRecord.target,
      expectedDraftHash: sha256(undoRecord.writtenText),
      desiredText: undoRecord.originalDraft,
      allowClipboardFallback: isObject(input) && input.allowClipboardFallback === true,
      atMs,
      draftReason: "target_changed_written_draft"
    });
    if (replacement.result.status !== "copy_only") undoRecords.delete(undoToken);
    return { result: replacement.result };
  }

  function claimVerifiedTransaction(input = {}) {
    const atMs = currentTimeMs();
    const allowedFields = new Set(["transactionId", "binding"]);
    if (!isObject(input)
        || Object.keys(input).some((key) => !allowedFields.has(key))) {
      return frozen({ status: "blocked", reasonToken: "transaction_claim_invalid", receipt: null });
    }
    if (!["activation", "pending_outcome"].includes(input.binding)) {
      return frozen({ status: "blocked", reasonToken: "transaction_binding_invalid", receipt: null });
    }
    const transaction = verifiedTransactions.get(input.transactionId);
    if (!transaction || atMs < transaction.issuedAtMs || atMs > transaction.expiresAtMs) {
      if (transaction) verifiedTransactions.delete(transaction.transactionId);
      return frozen({ status: "blocked", reasonToken: "verified_transaction_missing", receipt: null });
    }
    const existing = transaction.claims.get(input.binding);
    if (existing) {
      return frozen({ status: "ready", reasonToken: "ready", receipt: existing });
    }
    const receipt = frozen({
      claimVersion: TRANSACTION_CLAIM_VERSION,
      transactionId: transaction.transactionId,
      binding: input.binding,
      target: "codex",
      adapterResultId: transaction.adapterResultId,
      projectScopeToken: transaction.projectScope.token,
      projectScopeKind: transaction.projectScope.kind,
      projectScopeReliable: transaction.projectScope.reliable,
      projectScopeReason: transaction.projectScope.reason,
      verification: "machine",
      insertVerified: true,
      noAutoSubmit: true,
      issuedAt: new Date(transaction.issuedAtMs).toISOString(),
      claimedAt: new Date(atMs).toISOString()
    });
    transaction.claims.set(input.binding, receipt);
    return frozen({ status: "ready", reasonToken: "ready", receipt });
  }

  function invalidateUndo() {
    undoRecords.clear();
  }

  return frozen({
    adapterVersion: ADAPTER_VERSION,
    leaseVersion: LEASE_VERSION,
    leaseTtlMs,
    inspect,
    readDraft,
    insert,
    undo,
    invalidateUndo,
    claimVerifiedTransaction
  });
}

module.exports = frozen({
  ADAPTER_VERSION,
  LEASE_VERSION,
  DEFAULT_LEASE_TTL_MS,
  MAX_LEASE_TTL_MS,
  VERIFIED_TRANSACTION_TTL_MS,
  TRANSACTION_VERSION,
  TRANSACTION_CLAIM_VERSION,
  createCodexTargetAdapter,
  normalizeEditorReadback,
  sha256
});
