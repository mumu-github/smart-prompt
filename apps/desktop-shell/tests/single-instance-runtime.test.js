const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const executable = path.resolve(
  process.env.SMART_PROMPT_SINGLE_INSTANCE_EXE
    || path.join(root, "src-tauri", "target", "release", "smart-prompt-desktop.exe")
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(script, env = {}) {
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout).trim();
}

function stopProcessTree(process) {
  if (!process || process.exitCode !== null) return;
  spawnSync("taskkill", ["/PID", String(process.pid), "/T", "/F"], { stdio: "ignore" });
}

function countMatchingProcesses() {
  const output = runPowerShell(
    "$target=[IO.Path]::GetFullPath($env:SMART_PROMPT_RUNTIME_EXE); @((Get-CimInstance Win32_Process -Filter \"Name='smart-prompt-desktop.exe'\") | Where-Object { $_.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath([string]$_.ExecutablePath),$target,[StringComparison]::OrdinalIgnoreCase) }).Count",
    { SMART_PROMPT_RUNTIME_EXE: executable }
  );
  return Number(output || 0);
}

function countAllSmartPromptProcesses() {
  const output = runPowerShell(
    "@((Get-CimInstance Win32_Process -Filter \"Name='smart-prompt-desktop.exe'\")).Count"
  );
  return Number(output || 0);
}

function getMainWindowState(pid) {
  const output = runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmartPromptWindowState {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

  public static IntPtr FindMainWindow(uint targetProcessId) {
    IntPtr match = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (processId != targetProcessId) return true;
      var title = new StringBuilder(256);
      GetWindowText(hWnd, title, title.Capacity);
      if (title.ToString() != "Smart Prompt") return true;
      match = hWnd;
      return false;
    }, IntPtr.Zero);
    return match;
  }
}
"@
$processId = [uint32]$env:SMART_PROMPT_RUNTIME_PID
$handle = [SmartPromptWindowState]::FindMainWindow($processId)
[pscustomobject]@{
  handle = $handle.ToInt64()
  title = if ($handle -eq [IntPtr]::Zero) { "" } else { "Smart Prompt" }
  visible = $handle -ne [IntPtr]::Zero -and [SmartPromptWindowState]::IsWindowVisible($handle)
  minimized = $handle -ne [IntPtr]::Zero -and [SmartPromptWindowState]::IsIconic($handle)
  foreground = $handle -ne [IntPtr]::Zero -and [SmartPromptWindowState]::GetForegroundWindow() -eq $handle
} | ConvertTo-Json -Compress
`, { SMART_PROMPT_RUNTIME_PID: String(pid) });
  return JSON.parse(output);
}

function minimizeMainWindow(pid) {
  const output = runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmartPromptWindowControl {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  public static IntPtr FindMainWindow(uint targetProcessId) {
    IntPtr match = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (processId != targetProcessId) return true;
      var title = new StringBuilder(256);
      GetWindowText(hWnd, title, title.Capacity);
      if (title.ToString() != "Smart Prompt") return true;
      match = hWnd;
      return false;
    }, IntPtr.Zero);
    return match;
  }
}
"@
$processId = [uint32]$env:SMART_PROMPT_RUNTIME_PID
$handle = [SmartPromptWindowControl]::FindMainWindow($processId)
if ($handle -eq [IntPtr]::Zero) { throw "Smart Prompt main window was not found" }
[void][SmartPromptWindowControl]::ShowWindow($handle, 6)
`, { SMART_PROMPT_RUNTIME_PID: String(pid) });
  assert.equal(output, "");
}

async function waitForWindowState(pid, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = getMainWindowState(pid);
    if (predicate(state)) return state;
    await sleep(250);
  }
  throw new Error(`Smart Prompt window state timed out: ${JSON.stringify(state)}`);
}

function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null) return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => process.once("exit", () => resolve(true))),
    sleep(timeoutMs).then(() => false)
  ]);
}

(async () => {
  assert.equal(process.platform, "win32", "single-instance runtime test currently targets Windows");
  assert.ok(fs.existsSync(executable), `release executable not found: ${executable}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-prompt-single-instance-"));
  const env = { ...process.env, SMART_PROMPT_DATA_DIR: dataDir };
  let first;
  let second;
  let third;

  try {
    await sleep(2000);
    assert.equal(
      countAllSmartPromptProcesses(),
      0,
      "single-instance runtime test requires no existing Smart Prompt desktop process"
    );
    first = spawn(executable, [], { env, stdio: "ignore" });
    const initialState = await waitForWindowState(
      first.pid,
      (state) => state.handle !== 0,
      30000
    );
    assert.equal(first.exitCode, null, "first instance exited unexpectedly");
    assert.equal(initialState.visible, false, JSON.stringify(initialState));

    second = spawn(executable, [], { env, stdio: "ignore" });
    const secondExited = await waitForExit(second, 10000);
    const shownState = await waitForWindowState(
      first.pid,
      (state) => state.visible && !state.minimized && state.foreground
    );

    assert.equal(secondExited, true, "second instance did not exit through the single-instance plugin");
    assert.equal(first.exitCode, null, "first instance stopped when the second instance launched");
    assert.equal(shownState.title, "Smart Prompt", JSON.stringify(shownState));

    minimizeMainWindow(first.pid);
    await waitForWindowState(first.pid, (state) => state.minimized);
    third = spawn(executable, [], { env, stdio: "ignore" });
    const thirdExited = await waitForExit(third, 10000);
    const restoredState = await waitForWindowState(
      first.pid,
      (state) => state.visible && !state.minimized
    );

    assert.equal(thirdExited, true, "third instance did not exit through the single-instance plugin");
    assert.equal(restoredState.title, "Smart Prompt", JSON.stringify(restoredState));
    assert.equal(countMatchingProcesses(), 1, "more than one process remained for the same release executable");
  } finally {
    stopProcessTree(third);
    stopProcessTree(second);
    stopProcessTree(first);
  }

  console.log(`single-instance runtime tests passed; data retained at ${dataDir}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
