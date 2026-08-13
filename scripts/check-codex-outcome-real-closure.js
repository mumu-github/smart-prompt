"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cdp_http_${response.status}`);
  return response.json();
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId;
        nextId += 1;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((innerResolve, innerReject) => {
          pending.set(id, { resolve: innerResolve, reject: innerReject });
        });
      },
      close() {
        socket.close();
      }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "runtime_evaluation_failed");
  }
  return result.result.value;
}

async function findTarget(port, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
    const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl && predicate(item));
    if (target) return target;
    await sleep(300);
  }
  throw new Error("cdp_target_missing");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    result[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function safeError(error) {
  const value = String(error?.message || error || "unknown_error");
  if (/target_missing|focus_required|safety_|stale_|draft_|clipboard_|generation_|activation_|outcome_|cdp_/i.test(value)) {
    return value.slice(0, 160);
  }
  if (/failed to fetch|networkerror/i.test(value)) return "service_request_failed";
  if (/cannot read properties.*lease/i.test(value)) return "runtime_missing_inspect_lease";
  if (/is not a function|is not defined/i.test(value)) return "runtime_contract_error";
  return "real_closure_failed";
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const remotePort = Number(args["remote-port"] || 9239);
  const waitMs = Math.max(60000, Number(args["outcome-wait-ms"] || 62000));
  const resumeGenerated = args["resume-generated"] === "1" || args["resume-generated"] === "true";
  const recoverPending = args["recover-pending"] === "1" || args["recover-pending"] === "true";
  const reportPath = path.resolve(root, args.report || "research/codex-outcome-learning-loop-v1-real-closure.latest.json");
  const report = {
    schemaVersion: "codex-outcome-learning-loop-real-closure@1",
    createdAt: new Date().toISOString(),
    pass: false,
    installedRuntime: true,
    realProviderGeneration: true,
    resumedFromExistingGeneration: resumeGenerated,
    outcomeWaitMs: waitMs,
    checks: {},
    privacy: {
      promptTextNotStored: true,
      draftTextNotStored: true,
      clipboardTextNotStored: true,
      rawTitleNotStored: true,
      rawUiaTextNotStored: true,
      absoluteProjectPathNotStored: true,
      apiKeyNotStored: true,
      onlyLengthsHashesAndStateTokens: true
    }
  };

  let mainClient;
  let overlayClient;
  let stage = "cdp_connect";
  try {
    const mainTarget = await findTarget(remotePort, (item) => item.url === "http://tauri.localhost/");
    const overlayTarget = await findTarget(remotePort, (item) => item.url.endsWith("/overlay.html"));
    mainClient = await createCdpClient(mainTarget.webSocketDebuggerUrl);
    overlayClient = await createCdpClient(overlayTarget.webSocketDebuggerUrl);
    await Promise.all([mainClient.send("Runtime.enable"), overlayClient.send("Runtime.enable")]);
    report.checks.cdpTargetsReady = true;

    if (recoverPending) {
      stage = "recover_pending_insert";
      report.realProviderGeneration = false;
      report.outcomeWaitMs = 0;
      const recovery = await evaluate(mainClient, `(async () => {
        const opening = String(codexTargetState.undoOpeningDraftText || codexTargetState.openingDraftText || "");
        const transactionPresent = Boolean(codexTargetState.undoToken && codexTargetState.transactionId);
        let ok = false;
        if (transactionPresent) ok = await undoCodexTargetInsert();
        const inspected = await serviceRequest("/target/codex/inspect", {
          method: "POST",
          body: JSON.stringify({})
        });
        let read = null;
        if (inspected?.lease?.leaseId) {
          read = await serviceRequest("/target/codex/read", {
            method: "POST",
            body: JSON.stringify({ leaseId: inspected.lease.leaseId })
          });
        }
        const restored = String(read?.draftText || "");
        return {
          transactionPresent,
          ok,
          openingLength: opening.length,
          openingHash: hashText(opening),
          restoredLength: restored.length,
          restoredHash: hashText(restored),
          undoCleared: !codexTargetState.undoToken,
          transactionCleared: !codexTargetState.transactionId,
          pendingOutcomeCleared: codexTargetState.pendingOutcome === null
        };
      })()`);
      report.recovery = recovery;
      report.checks.pendingInsertRecovered = Boolean(
        recovery.transactionPresent && recovery.ok
          && recovery.openingLength === recovery.restoredLength
          && recovery.openingHash === recovery.restoredHash
          && recovery.undoCleared && recovery.transactionCleared && recovery.pendingOutcomeCleared
      );
      report.pass = Object.values(report.checks).every(Boolean);
    } else {
    let opened;
    if (resumeGenerated) {
      stage = "resume_existing_generation";
      opened = await evaluate(mainClient, `(() => {
        const draft = String(codexTargetState.openingDraftText || "");
        const payload = desktopOverlayState.lastPayload || {};
        return {
          ok: Boolean(codexTargetState.openingDraftHash && codexTargetState.openingTargetSignature),
          adapterReady: payload.codexAdapterReady === true,
          exactRead: payload.exactRead === true,
          fullReplace: payload.fullReplace === true,
          overlayVisible: desktopOverlayState.visible === true,
          overlayMode: String(payload.overlayMode || ""),
          draftLength: draft.length,
          draftHash: hashText(draft),
          leasePresent: Boolean(codexTargetState.lease?.leaseId),
          projectScopePresent: Boolean(codexTargetState.projectScopeToken),
          sessionPresent: Boolean(codexTargetState.sessionId),
          pendingOutcomePresent: Boolean(codexTargetState.pendingOutcome)
        };
      })()`);
    } else {
      stage = "open_exact_codex_draft";
      opened = await evaluate(mainClient, `(async () => {
      const preflightInspect = await serviceRequest("/target/codex/inspect", {
        method: "POST",
        body: JSON.stringify({})
      });
      let preflightRead = null;
      if (preflightInspect?.result?.status === "ready" && preflightInspect?.lease?.leaseId) {
        preflightRead = await serviceRequest("/target/codex/read", {
          method: "POST",
          body: JSON.stringify({ leaseId: preflightInspect.lease.leaseId })
        });
      }
      const ok = await openCodexPromptSession({ source: "real-closure", silent: true });
      const draft = String(codexTargetState.openingDraftText || "");
      const payload = desktopOverlayState.lastPayload || {};
      return {
        ok,
        adapterReady: payload.codexAdapterReady === true,
        exactRead: payload.exactRead === true,
        fullReplace: payload.fullReplace === true,
        overlayVisible: desktopOverlayState.visible === true,
        overlayMode: String(payload.overlayMode || ""),
        draftLength: draft.length,
        draftHash: hashText(draft),
        leasePresent: Boolean(codexTargetState.lease?.leaseId),
        projectScopePresent: Boolean(codexTargetState.projectScopeToken),
        sessionPresent: Boolean(codexTargetState.sessionId),
        pendingOutcomePresent: Boolean(codexTargetState.pendingOutcome)
        ,preflight: {
          inspectStatus: String(preflightInspect?.result?.status || ""),
          inspectReason: String(preflightInspect?.result?.reasonToken || ""),
          leasePresent: Boolean(preflightInspect?.lease?.leaseId),
          readStatus: String(preflightRead?.result?.status || ""),
          readReason: String(preflightRead?.result?.reasonToken || ""),
          readDraftLength: typeof preflightRead?.draftText === "string" ? preflightRead.draftText.length : -1,
          readDraftHash: typeof preflightRead?.draftText === "string" ? hashText(preflightRead.draftText) : ""
        }
      };
      })()`);
    }
    report.open = opened;
    report.checks.openedFromExactCodexDraft = Boolean(
      opened.ok && opened.adapterReady && opened.exactRead && opened.fullReplace
        && opened.leasePresent && opened.projectScopePresent && opened.sessionPresent
        && opened.draftLength > 0 && /^[a-f0-9]{8}$/.test(opened.draftHash)
    );
    report.checks.openDidNotClaimPrematureOutcome = opened.pendingOutcomePresent === false;
    if (!opened.ok) {
      throw new Error(`codex_open_${opened.preflight?.readReason || opened.preflight?.inspectReason || "failed"}`);
    }

    stage = resumeGenerated ? "read_existing_generation" : "generate_real_prompt";
    const generated = await evaluate(mainClient, `(async () => {
      if (!${resumeGenerated ? "true" : "false"}) await generateDesktopPrompt();
      const prompt = String(els.desktopGeneratedPrompt?.value || "").trim();
      return {
        promptLength: prompt.length,
        promptHash: hashText(prompt),
        generatedBy: String(els.desktopGeneratedPrompt?.dataset.generatedBy || ""),
        generationIdPresent: Boolean(codexTargetState.generationId),
        featureTokenCount: Array.isArray(codexTargetState.learningFeatureTokens)
          ? codexTargetState.learningFeatureTokens.length
          : 0,
        statusOk: els.status?.dataset?.tone === "success" || Boolean(prompt)
      };
    })()`);
    report.generation = generated;
    report.checks.realGenerationCompleted = Boolean(
      generated.promptLength > 0
        && /^[a-f0-9]{8}$/.test(generated.promptHash)
        && generated.generationIdPresent
        && generated.generatedBy === "llm"
    );

    stage = "machine_verified_insert";
    const inserted = await evaluate(mainClient, `(async () => {
      const captures = [];
      const originalFetch = window.fetch;
      window.fetch = async (...fetchArgs) => {
        const response = await originalFetch(...fetchArgs);
        const url = String(fetchArgs[0]?.url || fetchArgs[0] || "");
        if (url.includes("/target/codex/insert")) {
          const payload = await response.clone().json();
          captures.push({
            responseOk: response.ok,
            status: String(payload.result?.status || ""),
            reasonToken: String(payload.result?.reasonToken || payload.error?.code || ""),
            verified: payload.result?.verified === true,
            verification: String(payload.result?.verification || ""),
            readbackMatched: payload.result?.readbackMatched === true,
            noAutoSubmit: payload.result?.noAutoSubmit === true,
            attempted: payload.result?.attempted === true,
            method: String(payload.result?.method || ""),
            clipboardRestored: payload.result?.clipboardRestored === true,
            transactionPresent: Boolean(payload.transaction?.transactionId),
            target: String(payload.transaction?.target || ""),
            undoTokenPresent: Boolean(payload.undoToken),
            pendingOutcomePresent: Boolean(payload.pendingOutcome),
            pendingOutcomeStatus: String(payload.pendingOutcome?.status || payload.pendingOutcome?.outcome?.status || "")
          });
        }
        return response;
      };
      let ok = false;
      let fillErrorToken = "";
      try {
        ok = await fillCodexTargetInput();
      } catch (error) {
        const message = String(error?.message || "").toLowerCase();
        fillErrorToken = message.includes("stale") ? "stale_payload"
          : message.includes("focus") ? "focus_required"
          : message.includes("draft") ? "draft_changed"
          : message.includes("unavailable") ? "target_unavailable"
          : message.includes("fetch") || message.includes("network") ? "service_request_failed"
          : "insert_runtime_error";
      } finally {
        window.fetch = originalFetch;
      }
      const prompt = String(els.desktopGeneratedPrompt?.value || "").trim();
      const inspected = await serviceRequest("/target/codex/inspect", {
        method: "POST",
        body: JSON.stringify({})
      }).catch(() => null);
      const inspectReason = String(inspected?.result?.reasonToken || "");
      let read = null;
      if (inspected?.lease?.leaseId) {
        read = await serviceRequest("/target/codex/read", {
          method: "POST",
          body: JSON.stringify({ leaseId: inspected.lease.leaseId })
        }).catch(() => null);
      }
      const readback = String(read?.draftText || "");
      const overlay = desktopOverlayState.lastPayload || {};
      const activation = await getCodexActivationStatus();
      return {
        ok,
        fillErrorToken,
        inspectStatus: String(inspected?.result?.status || ""),
        inspectReason,
        guardReason: String(overlay.guardReason || ""),
        capture: captures[0] || null,
        generatedLength: prompt.length,
        generatedHash: hashText(prompt),
        readbackLength: readback.length,
        readbackHash: hashText(readback),
        textPatternReadbackMatched: readback === prompt,
        machineReadbackAuthoritative: captures[0]?.verified === true
          && captures[0]?.verification === "machine"
          && captures[0]?.readbackMatched === true,
        transactionPresent: Boolean(codexTargetState.transactionId),
        undoAvailable: Boolean(codexTargetState.undoToken),
        pendingOutcomePresent: Boolean(codexTargetState.pendingOutcome),
        overlayState: String(overlay.state || ""),
        overlayMode: String(overlay.overlayMode || ""),
        collapseRequested: overlay.collapseRequested === true,
        overlayVerified: overlay.verified === true,
        overlayNoAutoSubmit: overlay.noAutoSubmit === true,
        activationProgress: String(activation?.progress || "")
      };
    })()`);
    report.insert = inserted;
    report.checks.machineVerifiedInsert = Boolean(
      inserted.ok && inserted.capture?.responseOk && inserted.capture?.status === "ready"
        && inserted.capture?.verified && inserted.capture?.verification === "machine"
        && inserted.capture?.readbackMatched && inserted.capture?.noAutoSubmit
        && inserted.capture?.attempted && inserted.capture?.transactionPresent
        && inserted.capture?.target === "codex" && inserted.capture?.undoTokenPresent
        && inserted.machineReadbackAuthoritative
    );
    report.checks.clipboardRestored = inserted.capture?.method !== "controlled_clipboard"
      || inserted.capture?.clipboardRestored === true;
    report.checks.noAutoSubmit = Boolean(inserted.capture?.noAutoSubmit && inserted.overlayNoAutoSubmit);
    report.checks.pendingOutcomeCreated = Boolean(inserted.capture?.pendingOutcomePresent && inserted.pendingOutcomePresent);
    report.checks.activationCompleted = inserted.activationProgress === "activated";
    report.checks.expandedSuccessFeedbackShown = Boolean(
      inserted.overlayState === "success" && inserted.overlayMode === "expanded"
        && inserted.collapseRequested && inserted.overlayVerified
    );
    if (!report.checks.machineVerifiedInsert) {
      throw new Error(`insert_${inserted.fillErrorToken || inserted.capture?.reasonToken || inserted.guardReason || inserted.inspectReason || "failed"}`);
    }

    stage = "auto_collapse";
    await sleep(2600);
    const collapsed = await evaluate(mainClient, `(() => {
      const payload = desktopOverlayState.lastPayload || {};
      return {
        state: String(payload.state || ""),
        overlayMode: String(payload.overlayMode || ""),
        collapseRequested: payload.collapseRequested === true,
        verified: payload.verified === true,
        noAutoSubmit: payload.noAutoSubmit === true,
        canUndo: payload.canUndo === true
      };
    })()`);
    const overlayCollapsed = await evaluate(overlayClient, `(() => ({
      mode: String(document.documentElement.dataset.overlayMode || document.body.dataset.overlayMode || ""),
      state: String(document.documentElement.dataset.mascotState || document.body.dataset.mascotState || ""),
      visible: document.visibilityState !== "hidden",
      successVisible: Boolean(document.querySelector('[data-state="success"], .assistant-status-success, .success'))
    }))()`);
    report.collapse = { main: collapsed, overlay: overlayCollapsed };
    report.checks.autoCollapsedToCompact = Boolean(
      collapsed.state === "success" && collapsed.overlayMode === "compact"
        && !collapsed.collapseRequested && collapsed.verified && collapsed.noAutoSubmit && collapsed.canUndo
    );

    stage = "pending_outcome_wait";
    await sleep(waitMs);
    stage = "pending_outcome_feedback";
    const outcome = await evaluate(mainClient, `(async () => {
      const reopened = await openCodexPromptSession({ source: "real-closure-outcome", silent: true });
      const first = codexTargetState.pendingOutcome;
      const outcomeId = getCodexOutcomeId(first);
      const question = {
        reopened,
        present: Boolean(first),
        state: String(first?.state || ""),
        outcomeIdPresent: Boolean(outcomeId)
      };
      let notCompleted = false;
      let reasonRecorded = false;
      let reasonState = "";
      if (outcomeId) {
        notCompleted = await submitCodexOutcomeFeedback({
          overlayAction: "outcome-not-completed",
          outcomeId
        });
        reasonState = String(codexTargetState.pendingOutcome?.state || "");
        reasonRecorded = await submitCodexOutcomeFeedback({
          overlayAction: "outcome-reason",
          outcomeId: getCodexOutcomeId(),
          value: "not_actionable"
        });
      }
      const resolved = codexTargetState.pendingOutcome === null;
      const reopenedAgain = await openCodexPromptSession({ source: "real-closure-idempotency", silent: true });
      return {
        question,
        notCompleted,
        reasonState,
        reasonRecorded,
        resolved,
        reopenedAgain,
        repeatedQuestion: Boolean(codexTargetState.pendingOutcome)
      };
    })()`);
    report.outcome = outcome;
    report.checks.pendingOutcomeAskedOnce = Boolean(
      outcome.question?.reopened && outcome.question?.present
        && outcome.question?.state === "question" && outcome.question?.outcomeIdPresent
    );
    report.checks.pendingOutcomeResolvedNotActionable = Boolean(
      outcome.notCompleted && outcome.reasonState === "reason_required"
        && outcome.reasonRecorded && outcome.resolved
    );
    report.checks.resolvedOutcomeNotRepeated = Boolean(outcome.reopenedAgain && !outcome.repeatedQuestion);

    stage = "machine_verified_undo";
    const undone = await evaluate(mainClient, `(async () => {
      const captures = [];
      const originalFetch = window.fetch;
      window.fetch = async (...fetchArgs) => {
        const response = await originalFetch(...fetchArgs);
        const url = String(fetchArgs[0]?.url || fetchArgs[0] || "");
        if (url.includes("/target/codex/undo")) {
          const payload = await response.clone().json();
          captures.push({
            responseOk: response.ok,
            status: String(payload.result?.status || ""),
            verified: payload.result?.verified === true,
            verification: String(payload.result?.verification || ""),
            readbackMatched: payload.result?.readbackMatched === true,
            noAutoSubmit: payload.result?.noAutoSubmit === true,
            attempted: payload.result?.attempted === true,
            method: String(payload.result?.method || ""),
            clipboardRestored: payload.result?.clipboardRestored === true
          });
        }
        return response;
      };
      let ok = false;
      try {
        ok = await undoCodexTargetInsert();
      } finally {
        window.fetch = originalFetch;
      }
      const inspected = await inspectCodexTarget();
      const read = await serviceRequest("/target/codex/read", {
        method: "POST",
        body: JSON.stringify({ leaseId: inspected.lease.leaseId })
      });
      const restored = String(read.draftText || "");
      return {
        ok,
        capture: captures[0] || null,
        restoredLength: restored.length,
        restoredHash: hashText(restored),
        undoCleared: !codexTargetState.undoToken,
        pendingOutcomeCleared: codexTargetState.pendingOutcome === null
      };
    })()`);
    report.undo = undone;
    report.checks.machineVerifiedUndo = Boolean(
      undone.ok && undone.capture?.responseOk && undone.capture?.status === "ready"
        && undone.capture?.verified && undone.capture?.verification === "machine"
        && undone.capture?.readbackMatched && undone.capture?.noAutoSubmit
        && undone.capture?.attempted && undone.restoredLength === opened.draftLength
        && undone.restoredHash === opened.draftHash && undone.undoCleared
    );
    report.checks.undoClipboardRestored = undone.capture?.method !== "controlled_clipboard"
      || undone.capture?.clipboardRestored === true;

    report.pass = Object.values(report.checks).every(Boolean);
    }
  } catch (error) {
    report.failedStage = stage;
    report.errorCode = safeError(error);
  } finally {
    report.completedAt = new Date().toISOString();
    if (mainClient) mainClient.close();
    if (overlayClient) overlayClient.close();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    schemaVersion: report.schemaVersion,
    pass: report.pass,
    checks: report.checks,
    errorCode: report.errorCode || "",
    report: path.relative(root, reportPath).replace(/\\/g, "/")
  }, null, 2));
  if (!report.pass) process.exitCode = 1;
})();
