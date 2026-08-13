const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    args[value.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashPromptText(value) {
  if (!value) return "";
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => {
      resolve({
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
      });
    });
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
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return result.result.value;
}

async function findDesktopShellTarget(remotePort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${remotePort}/json/list`);
      for (const target of targets) {
        if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
        let client;
        try {
          client = await createCdpClient(target.webSocketDebuggerUrl);
          await client.send("Runtime.enable");
          const probe = await evaluate(client, `(() => ({
            title: document.title || "",
            hasDraftInput: Boolean(document.getElementById("desktop-draft-input")),
            hasGeneratedPrompt: Boolean(document.getElementById("desktop-generated-prompt")),
            hasTauri: Boolean(window.__TAURI__?.core?.invoke)
          }))()`);
          if (probe.hasDraftInput && probe.hasTauri) {
            return { target, client, probe };
          }
        } catch {
          if (client) client.close();
        }
        if (client) client.close();
      }
    } catch {
      // WebView2 debug endpoint may not be ready yet.
    }
    await sleep(350);
  }
  throw new Error(`Smart Prompt desktop shell CDP target not found on port ${remotePort}.`);
}

async function readDesktopPromptState(servicePort) {
  const bootstrap = await getJson(`http://127.0.0.1:${servicePort}/auth/bootstrap`);
  const token = bootstrap?.auth?.token || "";
  if (!token) throw new Error("Service auth token missing.");
  return getJson(`http://127.0.0.1:${servicePort}/desktop/prompt-state`, {
    Authorization: `Bearer ${token}`
  });
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const args = parseArgs(process.argv.slice(2));
  const remotePort = Number(args["remote-port"] || process.env.SMART_PROMPT_WEBVIEW_CDP_PORT || 9228);
  const servicePort = Number(args["service-port"] || process.env.SMART_PROMPT_PORT || 17371);
  const reportPath = path.resolve(root, args.report || "research/p25-desktop-shell-draft-cdp.latest.json");
  const draftText = String(process.env.SMART_PROMPT_P25_DRAFT_TEXT || args.text || "P25 desktop prompt ready for guarded overlay fill.");
  const expectedHash = hashPromptText(draftText.trim());
  const report = {
    schemaVersion: "p25-desktop-shell-draft-cdp@1",
    createdAt: new Date().toISOString(),
    pass: false,
    remotePort,
    servicePort,
    draftPrepared: false,
    promptStateReady: false,
    checks: {
      cdpTargetFound: false,
      desktopShellDomFound: false,
      draftInputUpdated: false,
      generatedPromptCleared: false,
      inputEventDispatched: false,
      shellSyncFunctionUsed: false,
      servicePromptStateReady: false,
      servicePromptStateMatchesDraft: false,
      privacyOk: false
    },
    privacy: {
      draftTextNotStored: true,
      promptTextNotStored: true,
      onlyLengthAndHash: true,
      targetInputsNotStored: true
    }
  };

  let client;
  try {
    const found = await findDesktopShellTarget(remotePort, 12000);
    client = found.client;
    report.checks.cdpTargetFound = true;
    report.checks.desktopShellDomFound = Boolean(found.probe.hasDraftInput && found.probe.hasTauri);
    report.target = {
      titleLength: String(found.probe.title || "").length,
      hasGeneratedPrompt: Boolean(found.probe.hasGeneratedPrompt),
      hasTauri: Boolean(found.probe.hasTauri)
    };

    const prepared = await evaluate(client, `(async () => {
      const draftText = ${JSON.stringify(draftText)};
      const draft = document.getElementById("desktop-draft-input");
      const prompt = document.getElementById("desktop-generated-prompt");
      if (!draft) return { ok: false, reason: "draft-input-missing" };
      draft.value = draftText;
      draft.dispatchEvent(new Event("input", { bubbles: true }));
      if (prompt) {
        prompt.value = "";
        delete prompt.dataset.generatedBy;
        prompt.dispatchEvent(new Event("input", { bubbles: true }));
      }
      draft.focus();
      if (typeof updateDesktopFusionControls === "function") updateDesktopFusionControls();
      const usedSync = typeof syncDesktopPromptState === "function";
      if (usedSync) await syncDesktopPromptState({ silent: true, force: true });
      await new Promise((resolve) => setTimeout(resolve, 450));
      return {
        ok: true,
        activeElementIsDraft: document.activeElement === draft,
        draftLength: draft.value.trim().length,
        generatedPromptLength: prompt ? prompt.value.trim().length : 0,
        inputEventDispatched: true,
        usedSync,
        handoffState: document.getElementById("desktop-prompt-handoff")?.dataset?.handoffState || "",
        handoffAction: document.getElementById("desktop-prompt-handoff")?.dataset?.handoffAction || ""
      };
    })()`);

    report.dom = {
      activeElementIsDraft: Boolean(prepared.activeElementIsDraft),
      draftLength: Number(prepared.draftLength || 0),
      draftHashPresent: Boolean(expectedHash),
      generatedPromptLength: Number(prepared.generatedPromptLength || 0),
      handoffState: String(prepared.handoffState || ""),
      handoffAction: String(prepared.handoffAction || "")
    };
    report.checks.draftInputUpdated = Boolean(prepared.ok && prepared.draftLength > 0);
    report.checks.generatedPromptCleared = Number(prepared.generatedPromptLength || 0) === 0;
    report.checks.inputEventDispatched = Boolean(prepared.inputEventDispatched);
    report.checks.shellSyncFunctionUsed = Boolean(prepared.usedSync);
    report.draftPrepared = report.checks.draftInputUpdated;

    const state = await readDesktopPromptState(servicePort);
    const desktopPrompt = state.desktopPrompt || {};
    report.promptState = {
      schemaVersion: String(desktopPrompt.schemaVersion || ""),
      recordedAtPresent: Boolean(desktopPrompt.recordedAt),
      source: String(desktopPrompt.source || ""),
      prepared: Boolean(desktopPrompt.prepared),
      activeTextKind: String(desktopPrompt.activeTextKind || ""),
      activeTextLength: Number(desktopPrompt.activeTextLength || 0),
      activeTextHashPresent: Boolean(desktopPrompt.activeTextHash),
      readiness: desktopPrompt.readiness || null
    };
    report.checks.servicePromptStateReady = Boolean(
      desktopPrompt.schemaVersion === "p25-desktop-prompt-state@1"
        && desktopPrompt.prepared
        && Number(desktopPrompt.activeTextLength || 0) === draftText.trim().length
        && desktopPrompt.activeTextKind === "draft"
    );
    report.checks.servicePromptStateMatchesDraft = Boolean(desktopPrompt.activeTextHash === expectedHash);
    report.checks.privacyOk = Boolean(
      desktopPrompt.privacy?.promptTextNotStored
        && desktopPrompt.privacy?.draftTextNotStored
        && desktopPrompt.privacy?.onlyLengthAndHash
        && desktopPrompt.privacy?.targetInputsNotStored
    );
    report.promptStateReady = report.checks.servicePromptStateReady && report.checks.servicePromptStateMatchesDraft;
    report.pass = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.errorCode = String(error.message || error).replace(/".*?"/g, "\"<redacted>\"");
  } finally {
    if (client) client.close();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(`P25 desktop shell draft CDP report: ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
})();
