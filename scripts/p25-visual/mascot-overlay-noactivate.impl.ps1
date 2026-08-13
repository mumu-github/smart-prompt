param(
  [string]$Report = "research/p25-mascot-overlay-noactivate.latest.json",
  [string]$ExePath = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe",
  [switch]$AttachOnly,
  [switch]$KeepRunning,
  [int]$TimeoutSeconds = 20,
  [switch]$AllowFailure
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

function Resolve-RepoPath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $PathValue))
}

function ConvertTo-RepoRelativePath {
  param([string]$PathValue)
  $full = [System.IO.Path]::GetFullPath($PathValue)
  $root = [System.IO.Path]::GetFullPath($RepoRoot)
  if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $root = "$root$([System.IO.Path]::DirectorySeparatorChar)"
  }
  if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($root.Length).Replace("\", "/")
  }
  return $full
}

function Get-TextHash {
  param([string]$Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()).Substring(0, 16)
  } finally {
    $sha.Dispose()
  }
}

$nativeDefinition = @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

public delegate bool SmartPromptEnumWindowsProc(IntPtr hWnd, IntPtr lParam);

public sealed class SmartPromptWindowInfo {
  public IntPtr Handle;
  public int ProcessId;
  public string Title;
  public long ExStyle;
  public bool Visible;
}

public static class SmartPromptOverlayNative {
  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_TOPMOST = 0x00000008L;
  public const long WS_EX_TOOLWINDOW = 0x00000080L;
  public const long WS_EX_NOACTIVATE = 0x08000000L;

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(SmartPromptEnumWindowsProc enumProc, IntPtr lParam);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int GetWindowTextLengthW(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)]
  public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)]
  public static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : GetWindowLongPtr32(hWnd, nIndex);
  }

  public static SmartPromptWindowInfo[] FindMascotWindows() {
    List<SmartPromptWindowInfo> windows = new List<SmartPromptWindowInfo>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      string title = GetTitle(hWnd);
      if (title == "Smart Prompt Mascot") {
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        windows.Add(new SmartPromptWindowInfo {
          Handle = hWnd,
          ProcessId = (int)processId,
          Title = title,
          ExStyle = GetWindowLongPtr(hWnd, GWL_EXSTYLE).ToInt64(),
          Visible = IsWindowVisible(hWnd)
        });
      }
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }

  private static string GetTitle(IntPtr hWnd) {
    int length = GetWindowTextLengthW(hWnd);
    if (length <= 0) {
      return "";
    }
    StringBuilder builder = new StringBuilder(length + 1);
    GetWindowTextW(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }
}
"@

if (-not ("SmartPromptOverlayNative" -as [type])) {
  Add-Type -TypeDefinition $nativeDefinition
}

function Get-WindowTitle {
  param([IntPtr]$WindowHandle)
  $length = [SmartPromptOverlayNative]::GetWindowTextLengthW($WindowHandle)
  if ($length -lt 0) {
    return ""
  }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][SmartPromptOverlayNative]::GetWindowTextW($WindowHandle, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-SmartPromptOverlayWindows {
  return @([SmartPromptOverlayNative]::FindMascotWindows())
}

function Stop-LaunchedProcess {
  param([System.Diagnostics.Process]$Process)
  if ($null -eq $Process -or $KeepRunning) {
    return
  }
  try {
    if (-not $Process.HasExited) {
      [void]$Process.CloseMainWindow()
      if (-not $Process.WaitForExit(3000)) {
        $Process.Kill()
        [void]$Process.WaitForExit(3000)
      }
    }
  } catch {
    Write-Warning "Unable to stop launched Smart Prompt process: $($_.Exception.Message)"
  }
}

$resolvedExe = Resolve-RepoPath $ExePath
$resolvedReport = Resolve-RepoPath $Report
$reportDir = Split-Path -Parent $resolvedReport
if (-not (Test-Path $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$startedProcess = $null
$startedProcessId = $null
$attachedExisting = $false
$startError = $null
$overlayWindow = $null
$releaseExePresent = Test-Path -LiteralPath $resolvedExe

try {
  if ($releaseExePresent) {
    $existingWindows = @(Get-SmartPromptOverlayWindows)
    if ($existingWindows.Count -gt 0) {
      $attachedExisting = $true
    } elseif ($AttachOnly) {
      $startError = "attach_only_no_existing_overlay_window"
    } else {
      $startedProcess = Start-Process -FilePath $resolvedExe -PassThru -WindowStyle Hidden
      $startedProcessId = $startedProcess.Id
    }

    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
    do {
      $windows = @(Get-SmartPromptOverlayWindows)
      if ($startedProcessId) {
        $overlayWindow = $windows | Where-Object { $_.ProcessId -eq $startedProcessId } | Select-Object -First 1
      }
      if ($null -eq $overlayWindow) {
        $overlayWindow = $windows | Select-Object -First 1
      }
      if ($null -ne $overlayWindow) {
        $hasNoActivateStyle = (($overlayWindow.ExStyle -band [SmartPromptOverlayNative]::WS_EX_NOACTIVATE) -ne 0)
        if ($hasNoActivateStyle) {
          break
        }
      }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
  }
} catch {
  $startError = $_.Exception.Message
} finally {
  Stop-LaunchedProcess -Process $startedProcess
}

$noActivate = $false
$topmost = $false
$toolWindow = $false
if ($null -ne $overlayWindow) {
  $noActivate = (($overlayWindow.ExStyle -band [SmartPromptOverlayNative]::WS_EX_NOACTIVATE) -ne 0)
  $topmost = (($overlayWindow.ExStyle -band [SmartPromptOverlayNative]::WS_EX_TOPMOST) -ne 0)
  $toolWindow = (($overlayWindow.ExStyle -band [SmartPromptOverlayNative]::WS_EX_TOOLWINDOW) -ne 0)
}

$pass = $releaseExePresent -and ($null -ne $overlayWindow) -and $noActivate

$reportObject = [ordered]@{
  schemaVersion = "p25-mascot-overlay-noactivate@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]$pass
  releaseExe = ConvertTo-RepoRelativePath $resolvedExe
  report = ConvertTo-RepoRelativePath $resolvedReport
  launchedProcessId = $startedProcessId
  attachedExisting = [bool]$attachedExisting
  attachOnly = [bool]$AttachOnly
  startError = $startError
  checks = [ordered]@{
    releaseExePresent = [bool]$releaseExePresent
    processStartedOrFound = [bool]($startedProcessId -or $attachedExisting -or $overlayWindow)
    overlayWindowFound = [bool]($null -ne $overlayWindow)
    overlayTitleMatches = [bool]($null -ne $overlayWindow -and $overlayWindow.Title -eq "Smart Prompt Mascot")
    noActivateStyle = [bool]$noActivate
  }
  overlayWindow = if ($null -ne $overlayWindow) {
    [ordered]@{
      hwnd = ("0x{0:x}" -f $overlayWindow.Handle.ToInt64())
      processId = $overlayWindow.ProcessId
      titleHash = Get-TextHash $overlayWindow.Title
      titleLength = $overlayWindow.Title.Length
      exStyleHex = ("0x{0:x}" -f $overlayWindow.ExStyle)
      noActivate = [bool]$noActivate
      topmost = [bool]$topmost
      toolWindow = [bool]$toolWindow
      visible = [bool]$overlayWindow.Visible
    }
  } else {
    $null
  }
  privacy = [ordered]@{
    ownOverlayTitleOnly = $true
    targetToolTitleRead = $false
    targetInputRead = $false
    promptTextRead = $false
  }
}

$json = $reportObject | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($resolvedReport, "$json`n", [System.Text.UTF8Encoding]::new($false))

if (-not $pass -and -not $AllowFailure) {
  throw "P25 mascot overlay no-activate check failed. See $(ConvertTo-RepoRelativePath $resolvedReport)"
}

if ($pass) {
  Write-Output "P25_MASCOT_OVERLAY_NOACTIVATE_PASS $(ConvertTo-RepoRelativePath $resolvedReport)"
} else {
  Write-Output "P25_MASCOT_OVERLAY_NOACTIVATE_INCOMPLETE $(ConvertTo-RepoRelativePath $resolvedReport)"
}
