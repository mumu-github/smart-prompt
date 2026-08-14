"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");

const DRIVER_SCHEMA_VERSION = "codex-target-adapter-driver@1";
// UIA 遍历在 Codex/ChatGPT 桌面应用（OpenAI.Codex 包）实测可达 89 秒，
// 30 秒会导致真实闭环的 inspect 恒超时；默认 90 秒、硬上限 120 秒，
// 超时仍会中止并拒绝写入（安全守卫不变）。
const DEFAULT_TIMEOUT_MS = 90000;
const MAX_TIMEOUT_MS = 120000;
const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const ALLOWED_KINDS = new Set(["inspect", "read_exact", "replace_all_atomic"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createProbeError(code) {
  const error = new Error(code);
  error.name = "CodexTargetProbeError";
  error.code = code;
  error.stack = `${error.name}: ${code}`;
  return error;
}

function collectJsonObjectsFromLine(line, baseOffset) {
  const stack = [];
  const objects = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      stack.push(index);
      continue;
    }
    if (character !== "}" || stack.length === 0) continue;

    const start = stack.pop();
    try {
      const value = JSON.parse(line.slice(start, index + 1));
      if (isObject(value)) {
        objects.push({ offset: baseOffset + start, value });
      }
    } catch (_error) {
      // Warnings may contain braces. Only complete JSON objects are candidates.
    }
  }
  return objects;
}

function extractLastDriverContract(stdout, expectedKind) {
  if (!ALLOWED_KINDS.has(expectedKind)) return null;
  const text = String(stdout || "").replace(/^\uFEFF/, "");
  let offset = 0;
  let selected = null;

  for (const line of text.split(/\r?\n/)) {
    for (const candidate of collectJsonObjectsFromLine(line, offset)) {
      const value = candidate.value;
      if (value.schemaVersion !== DRIVER_SCHEMA_VERSION
          || value.kind !== expectedKind
          || typeof value.driverOk !== "boolean"
          || typeof value.reasonToken !== "string") {
        continue;
      }
      if (!selected || candidate.offset > selected.offset) selected = candidate;
    }
    offset += line.length + 1;
  }
  return selected ? selected.value : null;
}

function normalizeTimeout(value) {
  const number = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(number)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.trunc(number)));
}

function defaultDriverPath() {
  return path.resolve(
    __dirname,
    "../../../../../scripts/codex-target-adapter-driver.ps1"
  );
}

function createPowerShellProbeRunner(options = {}) {
  const platform = options.platform || process.platform;
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const executable = options.powershellExecutable || "powershell.exe";
  const scriptPath = options.scriptPath || defaultDriverPath();
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  function run(command) {
    if (platform !== "win32") throw createProbeError("codex_probe_windows_only");
    if (!isObject(command) || !ALLOWED_KINDS.has(command.kind)) {
      throw createProbeError("codex_probe_invalid_command");
    }

    let input;
    try {
      input = JSON.stringify(command);
    } catch (_error) {
      throw createProbeError("codex_probe_invalid_command");
    }
    if (!input || Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
      throw createProbeError("codex_probe_invalid_command");
    }

    let execution;
    try {
      execution = spawnSync(executable, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-STA",
        "-File",
        scriptPath
      ], {
        input,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (_error) {
      throw createProbeError("codex_probe_process_failed");
    }

    if (execution?.error?.code === "ETIMEDOUT") {
      throw createProbeError("codex_probe_timeout");
    }
    if (execution?.error?.code === "ENOBUFS") {
      throw createProbeError("codex_probe_output_too_large");
    }
    if (!execution || execution.error || execution.status !== 0) {
      throw createProbeError("codex_probe_process_failed");
    }

    const contract = extractLastDriverContract(execution.stdout, command.kind);
    if (!contract) throw createProbeError("codex_probe_invalid_output");
    return contract;
  }

  return Object.freeze({ run });
}

module.exports = Object.freeze({
  DRIVER_SCHEMA_VERSION,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  createPowerShellProbeRunner,
  extractLastDriverContract
});
