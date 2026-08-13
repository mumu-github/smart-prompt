"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_TIMEOUT_MS,
  DRIVER_SCHEMA_VERSION,
  createPowerShellProbeRunner,
  extractLastDriverContract
} = require("../src/modules/codex-target-adapter/powershell-probe-runner");

const repoRoot = path.resolve(__dirname, "../../..");
const driverPath = path.join(repoRoot, "scripts", "codex-target-adapter-driver.ps1");
const nativeAdapterPath = path.join(
  repoRoot,
  "apps",
  "local-service-sidecar",
  "src",
  "target_adapter.rs"
);

function driverContract(kind, marker) {
  return {
    schemaVersion: DRIVER_SCHEMA_VERSION,
    kind,
    driverOk: true,
    reasonToken: "ready",
    marker
  };
}

function expectSafeError(action, code, sentinels = []) {
  assert.throws(action, (error) => {
    assert.equal(error?.code, code);
    const serialized = `${String(error)}\n${String(error?.stack || "")}\n${JSON.stringify(error)}`;
    assert.equal(serialized.includes(repoRoot), false, "error leaked a workspace path");
    for (const sentinel of sentinels) {
      assert.equal(serialized.includes(sentinel), false, `error leaked ${sentinel}`);
    }
    return true;
  });
}

assert.equal(DRIVER_SCHEMA_VERSION, "codex-target-adapter-driver@1");
assert.equal(DEFAULT_TIMEOUT_MS, 30000);

{
  const first = JSON.stringify(driverContract("inspect", "first"));
  const unrelated = JSON.stringify(driverContract("read_exact", "wrong-kind"));
  const wrongSchema = JSON.stringify({
    schemaVersion: "other-driver@1",
    kind: "inspect",
    driverOk: true,
    marker: "wrong-schema"
  });
  const last = JSON.stringify(driverContract("inspect", "last"));
  const stdout = [
    "WARNING: provider emitted {not-json noise}",
    wrongSchema,
    first,
    unrelated,
    last,
    "trailing diagnostic {"
  ].join("\r\n");

  assert.equal(extractLastDriverContract(stdout, "inspect").marker, "last");
}

{
  const calls = [];
  const stdout = [
    "warning before JSON",
    JSON.stringify(driverContract("inspect", "older")),
    JSON.stringify(driverContract("inspect", "selected")),
    "trailing warning"
  ].join("\n");
  const runner = createPowerShellProbeRunner({
    platform: "win32",
    timeoutMs: 4321,
    spawnSync(executable, args, options) {
      calls.push({ executable, args, options });
      return {
        status: 0,
        signal: null,
        error: undefined,
        stdout,
        stderr: "SECRET_STDERR_IGNORED_ON_SUCCESS"
      };
    }
  });
  const command = {
    kind: "inspect",
    target: "codex",
    foregroundSource: "GetForegroundWindow",
    focusedComposerOnly: true,
    requireExactRead: true,
    requireFullReplace: true
  };

  const reply = runner.run(command);
  assert.equal(reply.marker, "selected");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "powershell.exe");
  assert.deepEqual(calls[0].args, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-File",
    driverPath
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.input), command);
  assert.equal(calls[0].options.encoding, "utf8");
  assert.equal(calls[0].options.timeout, 4321);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, ["pipe", "pipe", "pipe"]);
  assert.ok(calls[0].options.maxBuffer >= 64 * 1024);
}

{
  let called = false;
  const runner = createPowerShellProbeRunner({
    platform: "linux",
    scriptPath: driverPath,
    spawnSync() {
      called = true;
      return null;
    }
  });
  expectSafeError(
    () => runner.run({ kind: "inspect" }),
    "codex_probe_windows_only"
  );
  assert.equal(called, false);
}

{
  let called = false;
  const runner = createPowerShellProbeRunner({
    platform: "win32",
    scriptPath: driverPath,
    spawnSync() {
      called = true;
      return null;
    }
  });
  expectSafeError(
    () => runner.run({ kind: "submit", text: "SECRET_COMMAND_TEXT" }),
    "codex_probe_invalid_command",
    ["SECRET_COMMAND_TEXT"]
  );
  assert.equal(called, false);
}

{
  const runner = createPowerShellProbeRunner({
    platform: "win32",
    scriptPath: driverPath,
    spawnSync() {
      return {
        status: 7,
        signal: null,
        error: undefined,
        stdout: "SECRET_STDOUT_FAILURE",
        stderr: "SECRET_STDERR_FAILURE"
      };
    }
  });
  expectSafeError(
    () => runner.run({ kind: "inspect" }),
    "codex_probe_process_failed",
    ["SECRET_STDOUT_FAILURE", "SECRET_STDERR_FAILURE"]
  );
}

{
  const timeoutError = Object.assign(new Error("SECRET_TIMEOUT_DETAIL"), {
    code: "ETIMEDOUT"
  });
  const runner = createPowerShellProbeRunner({
    platform: "win32",
    scriptPath: driverPath,
    spawnSync() {
      return {
        status: null,
        signal: "SIGTERM",
        error: timeoutError,
        stdout: "SECRET_TIMEOUT_STDOUT",
        stderr: "SECRET_TIMEOUT_STDERR"
      };
    }
  });
  expectSafeError(
    () => runner.run({ kind: "read_exact" }),
    "codex_probe_timeout",
    ["SECRET_TIMEOUT_DETAIL", "SECRET_TIMEOUT_STDOUT", "SECRET_TIMEOUT_STDERR"]
  );
}

{
  const runner = createPowerShellProbeRunner({
    platform: "win32",
    scriptPath: driverPath,
    spawnSync() {
      return {
        status: 0,
        signal: null,
        error: undefined,
        stdout: "warning SECRET_NO_CONTRACT {not-json}",
        stderr: "SECRET_PARSE_STDERR"
      };
    }
  });
  expectSafeError(
    () => runner.run({ kind: "replace_all_atomic" }),
    "codex_probe_invalid_output",
    ["SECRET_NO_CONTRACT", "SECRET_PARSE_STDERR"]
  );
}

assert.equal(fs.existsSync(driverPath), true, "PowerShell driver is missing");
const driverSource = fs.readFileSync(driverPath, "utf8");
const nativeAdapterSource = fs.readFileSync(nativeAdapterPath, "utf8");
assert.match(
  nativeAdapterSource,
  /DEFAULT_DRIVER_TIMEOUT_MS:\s*u64\s*=\s*30_000/,
  "native atomic UIA replacement must retain the production 30 second timeout"
);

for (const required of [
  "[Console]::In.ReadToEnd()",
  "[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)",
  "ConvertFrom-Json",
  "ConvertTo-Json -Depth 8 -Compress",
  "Add-Type -AssemblyName UIAutomationClient",
  "Add-Type -AssemblyName UIAutomationTypes",
  "[System.Windows.Automation.AutomationElement]::FocusedElement",
  "Get-FocusedComposerDescendantFallback",
  "[System.Windows.Automation.TreeWalker]::ControlViewWalker",
  "$node.Current.HasKeyboardFocus",
  "$focused.Current.IsOffscreen",
  "$focused.Current.IsPassword",
  '"ControlType.Group"',
  "$expandedGroupGeometryMatched",
  "$bounds.X -ge ($root.X + ($root.Width * 0.25))",
  "$bounds.Y -ge ($root.Y + ($root.Height * 0.55))",
  "$candidateBottom -gt ($rootBottom + 2)",
  "Normalize-TextPatternDraft",
  "GetFirstChild($Metadata.Element)",
  "GetNextSibling($secondChild)",
  "[System.Windows.Automation.ValuePattern]::Pattern",
  "[System.Windows.Automation.TextPattern]::Pattern",
  ".Current.Value",
  ".DocumentRange.GetText(-1)",
  ".SetValue($Text)",
  "GetDataObject()",
  "SetDataObject($SavedDataObject, $true)",
  "GetClipboardSequenceNumber()",
  "GetApartmentState()",
  "keybd_event",
  "Send-ControlChord -VirtualKey 0x41",
  "Send-ControlChord -VirtualKey 0x56",
  "Send-ControlChord -VirtualKey 0x43",
  '"clipboard_readback_failed"',
  "leaseFreshAtCommit",
  "draftHash",
  "candidateToken",
  "focusIdentityHash",
  "runtimeIdentityHash"
]) {
  assert.equal(driverSource.includes(required), true, `driver is missing ${required}`);
}

assert.equal(
  driverSource.includes("Test-SmartPromptTrustedExecutableProfile"),
  true,
  "driver must recognize the signed OpenAI Codex package identity without trusting generic ChatGPT.exe"
);

for (const forbidden of [
  /\$pid\s*=/i,
  /AutomationElement\]::RootElement/,
  /\.Current\.Name\b/,
  /\.Find(?:All|First)\s*\(/,
  /TreeScope\]::(?:Subtree|Descendants)/,
  /\bwindowTitle\b/i,
  /\bnearbyText\b/i,
  /\brawTitle\b/i,
  /\buiaName\b/i,
  /\bprocessPath\b/i,
  /Reflection\.Assembly\]::Load\(\"UIAutomation(?:Client|Types)\"\)/,
  /SendKeys\]::SendWait/i,
  /SendWait\([^\r\n]*(?:ENTER|\{ENTER\}|~)/i
]) {
  assert.doesNotMatch(driverSource, forbidden);
}

function sourceBetween(startMarker, endMarker) {
  const start = driverSource.indexOf(startMarker);
  const end = driverSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source block ${startMarker}`);
  return driverSource.slice(start, end);
}

const directReplacement = sourceBetween(
  "function Invoke-DirectReplacement",
  "function Invoke-ControlledClipboardReplacement"
);
const directGuardIndex = directReplacement.indexOf(
  "$commitGuard = Get-GuardedSnapshot -Expected $Command.expected"
);
const directLeaseIndex = directReplacement.indexOf(
  "$leaseFreshAtCommit = Test-LeaseFreshAtCommit -Command $Command"
);
const directSetValueIndex = directReplacement.indexOf(".SetValue($Text)");
assert.ok(directGuardIndex >= 0, "direct write must recapture the guarded snapshot");
assert.ok(directLeaseIndex > directGuardIndex, "direct lease check must follow identity revalidation");
assert.ok(directSetValueIndex > directLeaseIndex, "SetValue must follow the final lease check");

const clipboardReplacement = sourceBetween(
  "function Invoke-ControlledClipboardReplacement",
  "function Invoke-InspectOperation"
);
const clipboardMayChangeIndex = clipboardReplacement.indexOf("$clipboardMayHaveChanged = $true");
const clipboardSetIndex = clipboardReplacement.indexOf(
  "[System.Windows.Forms.Clipboard]::SetDataObject($replacementData, $true)"
);
const clipboardRestoreIndex = clipboardReplacement.indexOf("Restore-ClipboardDataObject");
const clipboardPayloadIndex = clipboardReplacement.indexOf(
  "[System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)"
);
const clipboardCommitGuardIndex = clipboardReplacement.indexOf(
  "$commitGuard = Get-GuardedSnapshot -Expected $Command.expected"
);
const clipboardSequenceCheckIndex = clipboardReplacement.lastIndexOf(
  "[SmartPromptCodexTargetNative]::GetClipboardSequenceNumber()",
  clipboardReplacement.indexOf("Send-ControlChord -VirtualKey 0x41")
);
const clipboardSendIndex = clipboardReplacement.indexOf("Send-ControlChord -VirtualKey 0x41");
const clipboardPasteIndex = clipboardReplacement.indexOf("Send-ControlChord -VirtualKey 0x56");
const clipboardReadbackCopyIndex = clipboardReplacement.indexOf("Send-ControlChord -VirtualKey 0x43");
assert.ok(clipboardMayChangeIndex >= 0, "clipboard mutation must be marked before it can happen");
assert.ok(clipboardSetIndex > clipboardMayChangeIndex, "clipboard mark must precede SetDataObject");
assert.ok(clipboardPayloadIndex > clipboardSetIndex, "clipboard payload must be checked after SetDataObject");
assert.ok(clipboardCommitGuardIndex > clipboardPayloadIndex, "target revalidation must follow payload verification");
assert.ok(clipboardSequenceCheckIndex > clipboardCommitGuardIndex, "clipboard ownership must be rechecked at commit");
assert.ok(clipboardSendIndex > clipboardSequenceCheckIndex, "Ctrl+A must follow clipboard ownership recheck");
assert.ok(clipboardPasteIndex > clipboardSendIndex, "Ctrl+V must follow Ctrl+A");
assert.ok(clipboardReadbackCopyIndex > clipboardPasteIndex, "controlled readback copy must follow paste");
assert.ok(clipboardRestoreIndex > clipboardSetIndex, "clipboard restore must remain in the guarded path");
assert.ok(clipboardRestoreIndex > clipboardReadbackCopyIndex, "clipboard restore must follow controlled readback");

if (process.platform === "win32") {
  const escapedDriverPath = driverPath.replace(/'/g, "''");
  const parseOnly = [
    "$tokens = $null",
    "$errors = $null",
    `[void][System.Management.Automation.Language.Parser]::ParseFile('${escapedDriverPath}', [ref]$tokens, [ref]$errors)`,
    "if ($errors.Count -gt 0) { exit 1 }"
  ].join("; ");
  const parsed = childProcess.spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    parseOnly
  ], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(parsed.status, 0, "PowerShell AST parser rejected the driver");

  const typeLoadOnly = childProcess.spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-Command",
    [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName UIAutomationClient",
      "Add-Type -AssemblyName UIAutomationTypes",
      "Add-Type -AssemblyName System.Windows.Forms",
      "if (-not ('System.Windows.Automation.AutomationElement' -as [type])) { exit 2 }",
      "if (-not ('System.Windows.Forms.Clipboard' -as [type])) { exit 3 }"
    ].join("; ")
  ], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(typeLoadOnly.status, 0, "PowerShell UIA/Forms types failed to load");

  const nativeSourceMatch = driverSource.match(/Add-Type @"\r?\n([\s\S]*?)\r?\n"@/);
  assert.ok(nativeSourceMatch, "native Add-Type source is missing");
  const nativeSourceBase64 = Buffer.from(nativeSourceMatch[1], "utf8").toString("base64");
  const compileNativeOnly = [
    "$ErrorActionPreference = 'Stop'",
    `$source = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${nativeSourceBase64}'))`,
    "Add-Type -TypeDefinition $source"
  ].join("; ");
  const nativeCompiled = childProcess.spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    compileNativeOnly
  ], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(nativeCompiled.status, 0, "native interop source failed to compile");

  const invalidKindSentinel = "SECRET_INVALID_KIND_MUST_NOT_ECHO";
  const invalidInputSentinel = "SECRET_INVALID_INPUT_MUST_NOT_ECHO";
  const invalidRun = childProcess.spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-File",
    driverPath
  ], {
    input: JSON.stringify({ kind: invalidKindSentinel, text: invalidInputSentinel }),
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  assert.equal(invalidRun.status, 0, "isolated invalid-command run failed");
  const invalidReply = JSON.parse(String(invalidRun.stdout || "").trim());
  assert.equal(invalidReply.schemaVersion, DRIVER_SCHEMA_VERSION);
  assert.equal(invalidReply.kind, "invalid");
  assert.equal(invalidReply.driverOk, false);
  assert.equal(invalidReply.reasonToken, "invalid_command");
  assert.equal(JSON.stringify(invalidReply).includes(invalidKindSentinel), false);
  assert.equal(JSON.stringify(invalidReply).includes(invalidInputSentinel), false);
}

console.log(JSON.stringify({
  schemaVersion: "codex-target-adapter-windows-driver-test@1",
  pass: true,
  fakeOnly: true,
  realGuiTouched: false,
  realClipboardTouched: false,
  submitCount: 0
}));
