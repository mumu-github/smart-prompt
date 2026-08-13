"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function withoutLineBreaks(value) {
  return String(value || "").replace(/[\r\n]/g, "");
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

function lineBreakCount(value) {
  return (String(value || "").match(/\r\n|\r|\n/g) || []).length;
}

function characterCategory(character) {
  if (/\s/u.test(character)) return "whitespace";
  if (/[A-Za-z0-9]/u.test(character)) return "ascii_alnum";
  if (/[\u3400-\u9fff]/u.test(character)) return "cjk";
  if (/^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]$/u.test(character)) return "ascii_punctuation";
  return "unicode_other";
}

function diffSummary(expectedValue, actualValue) {
  const expected = Array.from(String(expectedValue || ""));
  const actual = Array.from(String(actualValue || ""));
  const rows = Array.from({ length: expected.length + 1 }, () => new Uint16Array(actual.length + 1));
  for (let left = 1; left <= expected.length; left += 1) {
    for (let right = 1; right <= actual.length; right += 1) {
      rows[left][right] = expected[left - 1] === actual[right - 1]
        ? rows[left - 1][right - 1] + 1
        : Math.max(rows[left - 1][right], rows[left][right - 1]);
    }
  }
  const deleted = [];
  const inserted = [];
  let left = expected.length;
  let right = actual.length;
  while (left > 0 || right > 0) {
    if (left > 0 && right > 0 && expected[left - 1] === actual[right - 1]) {
      left -= 1;
      right -= 1;
    } else if (right > 0 && (left === 0 || rows[left][right - 1] >= rows[left - 1][right])) {
      inserted.push({ character: actual[right - 1], index: right - 1 });
      right -= 1;
    } else {
      deleted.push({ character: expected[left - 1], index: left - 1 });
      left -= 1;
    }
  }
  const categories = (characters) => characters.reduce((result, item) => {
    const category = characterCategory(item.character);
    result[category] = (result[category] || 0) + 1;
    return result;
  }, {});
  const whitespaceSubtypes = deleted.reduce((result, item) => {
    if (!/\s/u.test(item.character)) return result;
    const subtype = item.character === " " ? "space"
      : item.character === "\t" ? "tab"
      : item.character === "\u00a0" ? "nbsp"
      : item.character === "\u3000" ? "fullwidth_space"
      : item.character === "\n" || item.character === "\r" ? "line_break"
      : "other_whitespace";
    result[subtype] = (result[subtype] || 0) + 1;
    return result;
  }, {});
  const deletedPositions = deleted.reduce((result, item) => {
    const before = expected[item.index - 1];
    const after = expected[item.index + 1];
    const position = item.index === 0 || before === "\n" || before === "\r" ? "line_start"
      : item.index === expected.length - 1 || after === "\n" || after === "\r" ? "line_end"
      : "line_interior";
    result[position] = (result[position] || 0) + 1;
    return result;
  }, {});
  const deletedAdjacentToSpace = deleted.filter((item) => (
    expected[item.index - 1] === " " || expected[item.index + 1] === " "
  )).length;
  const deletedInsideFencedCode = deleted.filter((item) => {
    const prefixLines = expected.slice(0, item.index).join("").split("\n");
    let inside = false;
    for (const line of prefixLines) {
      if (/^\s*(```|~~~)/u.test(line)) inside = !inside;
    }
    return inside;
  }).length;
  return {
    expectedCodePointLength: expected.length,
    actualCodePointLength: actual.length,
    lcsLength: rows[expected.length][actual.length],
    deletedCount: deleted.length,
    insertedCount: inserted.length,
    deletedCategories: categories(deleted),
    insertedCategories: categories(inserted),
    deletedWhitespaceSubtypes: whitespaceSubtypes,
    deletedPositions,
    deletedAdjacentToSpace,
    deletedInsideFencedCode,
    matchesAfterRemovingBackticks: String(expectedValue || "").replace(/`/g, "") === actualValue,
    matchesAfterRemovingZeroWidth: String(expectedValue || "").replace(/[\u200b-\u200d\u2060\ufeff\ufe0f]/g, "") === actualValue,
    nfcMatched: String(expectedValue || "").normalize("NFC") === String(actualValue || "").normalize("NFC"),
    nfkcMatched: String(expectedValue || "").normalize("NFKC") === String(actualValue || "").normalize("NFKC")
  };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cdp_http_${response.status}`);
  return response.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((innerResolve, innerReject) => {
          pending.set(id, { resolve: innerResolve, reject: innerReject });
        });
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) throw new Error("cdp_runtime_evaluation_failed");
  return response.result.value;
}

function runDriver(driverPath, command) {
  const startedAt = Date.now();
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-File",
    driverPath
  ], {
    input: JSON.stringify(command),
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("driver_timeout");
  if (result.status !== 0) throw new Error("driver_process_failed");
  const contracts = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => {
      try { return JSON.parse(line); } catch (_error) { return null; }
    })
    .filter((value) => value && value.schemaVersion === "codex-target-adapter-driver@1");
  if (!contracts.length) throw new Error("driver_contract_missing");
  return { contract: contracts.at(-1), elapsedMs: Date.now() - startedAt };
}

function expectedFrom(snapshot, draftText) {
  return {
    target: "codex",
    hwnd: snapshot.hwnd,
    pid: snapshot.pid,
    runtimeIdentityHash: snapshot.runtimeIdentityHash,
    focusIdentityHash: snapshot.composer.focusIdentityHash,
    candidateToken: snapshot.composer.candidateToken,
    draftHash: sha256(draftText)
  };
}

function inspect(driverPath) {
  return runDriver(driverPath, {
    kind: "inspect",
    target: "codex",
    foregroundSource: "GetForegroundWindow",
    focusedComposerOnly: true,
    requireExactRead: true,
    requireFullReplace: true
  });
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const driverPath = path.join(root, "scripts", "codex-target-adapter-driver.ps1");
  const reportPath = path.join(root, "research", "codex-outcome-learning-loop-v1-driver-atomic.latest.json");
  const targets = await getJson("http://127.0.0.1:9239/json/list");
  const target = targets.find((item) => item.type === "page" && item.url === "http://tauri.localhost/");
  assert.ok(target?.webSocketDebuggerUrl, "Smart Prompt WebView target missing");
  const client = await connect(target.webSocketDebuggerUrl);
  let report;
  try {
    await client.send("Runtime.enable");
    const payload = await evaluate(client, `(() => ({
      prompt: String(els.desktopGeneratedPrompt?.value || "").trim(),
      original: String(codexTargetState.openingDraftText || "")
    }))()`);
    assert.ok(payload.prompt && payload.original, "Generated prompt or opening draft missing");

    const initial = inspect(driverPath);
    assert.equal(initial.contract.driverOk, true, initial.contract.reasonToken);
    assert.equal(initial.contract.composer.draftText, payload.original, "Opening draft changed before probe");
    const issuedAtMs = Date.now();
    const inserted = runDriver(driverPath, {
      kind: "replace_all_atomic",
      operation: "insert",
      expected: expectedFrom(initial.contract, payload.original),
      text: payload.prompt,
      preferDirectSetValue: true,
      allowClipboardFallback: true,
      leaseFreshness: {
        leaseId: "diagnostic-real-generated",
        issuedAtMs,
        expiresAtMs: issuedAtMs + 60000,
        requireFreshAtCommit: true
      },
      replacementIntent: "full",
      noSubmit: true,
      prohibitedActions: ["enter", "submit", "send"]
    });
    const afterInsert = inspect(driverPath);
    assert.equal(afterInsert.contract.driverOk, true, afterInsert.contract.reasonToken);
    const current = afterInsert.contract.composer.draftText;
    const changed = sha256(current) !== sha256(payload.original);
    let undone = null;
    if (changed) {
      undone = runDriver(driverPath, {
        kind: "replace_all_atomic",
        operation: "undo",
        expected: expectedFrom(afterInsert.contract, current),
        text: payload.original,
        preferDirectSetValue: true,
        allowClipboardFallback: true,
        leaseFreshness: null,
        replacementIntent: "full",
        noSubmit: true,
        prohibitedActions: ["enter", "submit", "send"]
      });
    }
    const final = inspect(driverPath);
    assert.equal(final.contract.driverOk, true, final.contract.reasonToken);
    const restored = final.contract.composer.draftText === payload.original;
    report = {
      schemaVersion: "codex-driver-real-atomic@1",
      createdAt: new Date().toISOString(),
      pass: inserted.contract.driverOk === true
        && normalizeEditorReadback(inserted.contract.readbackText) === normalizeEditorReadback(payload.prompt)
        && inserted.contract.clipboardRestored === true
        && restored,
      promptLength: payload.prompt.length,
      promptHash: sha256(payload.prompt).slice(0, 8),
      promptLineBreakCount: lineBreakCount(payload.prompt),
      promptWithoutLineBreaksLength: withoutLineBreaks(payload.prompt).length,
      openingLength: payload.original.length,
      openingHash: sha256(payload.original).slice(0, 8),
      insert: {
        elapsedMs: inserted.elapsedMs,
        driverOk: inserted.contract.driverOk === true,
        reasonToken: String(inserted.contract.reasonToken || ""),
        attempted: inserted.contract.attempted === true,
        guardMatched: inserted.contract.guardMatched === true,
        leaseFreshAtCommit: inserted.contract.leaseFreshAtCommit === true,
        method: String(inserted.contract.method || ""),
        clipboardRestored: inserted.contract.clipboardRestored === true,
        readbackLength: typeof inserted.contract.readbackText === "string"
          ? inserted.contract.readbackText.length
          : -1,
        readbackMatched: inserted.contract.readbackText === payload.prompt,
        editorNormalizedReadbackMatched: normalizeEditorReadback(inserted.contract.readbackText)
          === normalizeEditorReadback(payload.prompt),
        readbackLineBreakCount: lineBreakCount(inserted.contract.readbackText),
        readbackWithoutLineBreaksLength: withoutLineBreaks(inserted.contract.readbackText).length,
        lineBreakInsensitiveMatched: withoutLineBreaks(inserted.contract.readbackText)
          === withoutLineBreaks(payload.prompt),
        lineBreakInsensitiveHash: sha256(withoutLineBreaks(inserted.contract.readbackText)).slice(0, 8),
        expectedLineBreakInsensitiveHash: sha256(withoutLineBreaks(payload.prompt)).slice(0, 8),
        difference: diffSummary(payload.prompt, inserted.contract.readbackText),
        submitCount: Number(inserted.contract.submitCount || 0)
      },
      undo: undone ? {
        elapsedMs: undone.elapsedMs,
        driverOk: undone.contract.driverOk === true,
        reasonToken: String(undone.contract.reasonToken || ""),
        clipboardRestored: undone.contract.clipboardRestored === true
      } : null,
      restored,
      finalLength: final.contract.composer.draftText.length,
      finalHash: sha256(final.contract.composer.draftText).slice(0, 8),
      privacy: {
        promptTextNotStored: true,
        draftTextNotStored: true,
        clipboardTextNotStored: true,
        onlyLengthsHashesAndStateTokens: true
      }
    };
  } finally {
    client.close();
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
})().catch((error) => {
  console.error(JSON.stringify({ pass: false, errorCode: String(error.message || "diagnostic_failed").slice(0, 120) }));
  process.exitCode = 1;
});
