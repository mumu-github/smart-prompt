[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Report = "research/p25-real-overlay-click-fill.latest.json",
  [string]$TargetsReport = "research/p25-real-desktop-targets.latest.json",
  [string]$OverlayNoActivateReport = "research/p25-mascot-overlay-noactivate.latest.json",
  [string]$ComposerDiagnosticsReport = "research/p25-composer-candidate-diagnostics.latest.json",
  [ValidateSet("codex", "workbuddy", "trae")]
  [string[]]$Profiles = @("codex", "workbuddy", "trae"),
  [switch]$RefreshTargets,
  [switch]$AllowRealOverlayClick,
  [switch]$DesktopPromptPrepared,
  [int]$ServicePort = 17371,
  [int]$TimeoutSeconds = 10
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

function Resolve-RepoPath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $Root $PathValue))
}

function ConvertTo-RepoRelativePath {
  param([string]$PathValue)
  $full = [System.IO.Path]::GetFullPath($PathValue)
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = "$rootFull$([System.IO.Path]::DirectorySeparatorChar)"
  }
  if ($full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($rootFull.Length).Replace("\", "/")
  }
  return $full
}

function Read-JsonFile {
  param([string]$PathValue)
  $path = Resolve-RepoPath $PathValue
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-UniqueProfiles {
  return @($Profiles | Select-Object -Unique)
}

function Get-TargetRows {
  param([object]$Targets)
  $wanted = @(Get-UniqueProfiles)
  if (-not $Targets -or -not $Targets.targets) { return @() }
  return @($Targets.targets | Where-Object { $wanted -contains $_.id })
}

function Test-AllRows {
  param([object[]]$Rows, [scriptblock]$Predicate)
  $wantedCount = @(Get-UniqueProfiles).Count
  if ($Rows.Count -ne $wantedCount -or $Rows.Count -eq 0) { return $false }
  foreach ($row in $Rows) {
    if (-not (& $Predicate $row)) { return $false }
  }
  return $true
}

function Get-ServiceToken {
  param([int]$Port)
  try {
    $bootstrap = Invoke-RestMethod -UseBasicParsing -Method GET -Uri "http://127.0.0.1:$Port/auth/bootstrap" -TimeoutSec 3
    return [string]$bootstrap.auth.token
  } catch {
    return ""
  }
}

function Get-LatestDesktopFill {
  param([int]$Port, [string]$Token)
  if (-not $Token) { return $null }
  try {
    return Invoke-RestMethod -UseBasicParsing -Method GET -Uri "http://127.0.0.1:$Port/desktop/fill/latest" -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 3
  } catch {
    return $null
  }
}

function Get-DesktopPromptState {
  param([int]$Port, [string]$Token)
  if (-not $Token) { return $null }
  try {
    return Invoke-RestMethod -UseBasicParsing -Method GET -Uri "http://127.0.0.1:$Port/desktop/prompt-state" -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 3
  } catch {
    return $null
  }
}

function Test-DesktopPromptStateReady {
  param([object]$PromptState)
  $desktopPrompt = $PromptState.desktopPrompt
  if (-not $desktopPrompt) { return $false }
  $privacy = $desktopPrompt.privacy
  $readiness = $desktopPrompt.readiness
  return [bool](
    $desktopPrompt.schemaVersion -eq "p25-desktop-prompt-state@1" -and
    $desktopPrompt.prepared -and
    [int]$desktopPrompt.activeTextLength -gt 0 -and
    [string]$desktopPrompt.activeTextHash -ne "" -and
    $readiness.noAutoSubmit -and
    $privacy.promptTextNotStored -and
    $privacy.draftTextNotStored -and
    $privacy.onlyLengthAndHash -and
    $privacy.targetInputsNotStored
  )
}

function Ensure-OverlayClickNativeTypes {
  if ("SmartPromptOverlayClickNative" -as [type]) { return }
  Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public delegate bool SmartPromptOverlayClickEnumProc(IntPtr hWnd, IntPtr lParam);

public struct SmartPromptOverlayClickRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public sealed class SmartPromptOverlayClickWindow {
  public IntPtr Handle;
  public int ProcessId;
  public string Title;
  public long ExStyle;
  public bool Visible;
  public SmartPromptOverlayClickRect Rect;
}

public static class SmartPromptOverlayClickNative {
  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_NOACTIVATE = 0x08000000L;
  public const long WS_EX_TOPMOST = 0x00000008L;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(SmartPromptOverlayClickEnumProc enumProc, IntPtr lParam);

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

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out SmartPromptOverlayClickRect rect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : GetWindowLongPtr32(hWnd, nIndex);
  }

  public static SmartPromptOverlayClickWindow[] FindMascotWindows() {
    List<SmartPromptOverlayClickWindow> windows = new List<SmartPromptOverlayClickWindow>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      string title = GetTitle(hWnd);
      if (title == "Smart Prompt Mascot") {
        uint processId;
        SmartPromptOverlayClickRect rect;
        GetWindowThreadProcessId(hWnd, out processId);
        GetWindowRect(hWnd, out rect);
        windows.Add(new SmartPromptOverlayClickWindow {
          Handle = hWnd,
          ProcessId = (int)processId,
          Title = title,
          ExStyle = GetWindowLongPtr(hWnd, GWL_EXSTYLE).ToInt64(),
          Visible = IsWindowVisible(hWnd),
          Rect = rect
        });
      }
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }

  private static string GetTitle(IntPtr hWnd) {
    int length = GetWindowTextLengthW(hWnd);
    if (length <= 0) return "";
    StringBuilder builder = new StringBuilder(length + 1);
    GetWindowTextW(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }
}
"@
}

function Get-MascotOverlayWindow {
  Ensure-OverlayClickNativeTypes
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
  do {
    $windows = @([SmartPromptOverlayClickNative]::FindMascotWindows())
    $visible = @($windows | Where-Object { $_.Visible } | Select-Object -First 1)
    if ($visible.Count -gt 0) { return $visible[0] }
    if ($windows.Count -gt 0) { $last = $windows[0] }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  if ($last) { return $last }
  return $null
}

function Send-MascotOverlayClick {
  param([object]$Window)
  if (-not $Window -or -not $Window.Visible) {
    return [pscustomobject]@{ sent = $false; reason = "overlay_window_not_visible" }
  }
  $rect = $Window.Rect
  $width = [Math]::Max(1, [int]$rect.Right - [int]$rect.Left)
  $height = [Math]::Max(1, [int]$rect.Bottom - [int]$rect.Top)
  $x = [int]($rect.Left + [Math]::Min($width - 10, [Math]::Max(10, $width / 2)))
  $y = [int]($rect.Top + [Math]::Min($height - 10, [Math]::Max(10, $height / 2)))
  $cursorSet = [SmartPromptOverlayClickNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 80
  [SmartPromptOverlayClickNative]::mouse_event([SmartPromptOverlayClickNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [SmartPromptOverlayClickNative]::mouse_event([SmartPromptOverlayClickNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  return [pscustomobject]@{
    sent = [bool]$cursorSet
    reason = if ($cursorSet) { "click_sent" } else { "cursor_set_failed" }
    x = $x
    y = $y
    width = $width
    height = $height
  }
}

function Send-MascotOverlayPrimaryClick {
  param([object]$Window)
  if (-not $Window -or -not $Window.Visible) {
    return [pscustomobject]@{ sent = $false; reason = "overlay_window_not_visible" }
  }
  $rect = $Window.Rect
  $width = [Math]::Max(1, [int]$rect.Right - [int]$rect.Left)
  $height = [Math]::Max(1, [int]$rect.Bottom - [int]$rect.Top)
  $x = [int]($rect.Left + [Math]::Min($width - 10, [Math]::Max(10, $width / 2)))
  $y = [int]($rect.Bottom - [Math]::Min(28, [Math]::Max(14, $height / 7)))
  $cursorSet = [SmartPromptOverlayClickNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 80
  [SmartPromptOverlayClickNative]::mouse_event([SmartPromptOverlayClickNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [SmartPromptOverlayClickNative]::mouse_event([SmartPromptOverlayClickNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  return [pscustomobject]@{
    sent = [bool]$cursorSet
    reason = if ($cursorSet) { "primary_click_sent" } else { "cursor_set_failed" }
    x = $x
    y = $y
    width = $width
    height = $height
  }
}

function Invoke-MascotOverlayClick {
  param([object]$Window)
  if (-not $Window -or -not $Window.Visible) {
    return [pscustomobject]@{ attempted = $false; sent = $false; reason = "overlay_window_not_visible"; clicks = @() }
  }
  $rect = $Window.Rect
  $width = [Math]::Max(1, [int]$rect.Right - [int]$rect.Left)
  $height = [Math]::Max(1, [int]$rect.Bottom - [int]$rect.Top)
  $clicks = @()
  if ($width -le 110 -and $height -le 110) {
    $expandClick = Send-MascotOverlayClick -Window $Window
    $clicks += $expandClick
    if (-not $expandClick.sent) {
      return [pscustomobject]@{ attempted = $true; sent = $false; reason = $expandClick.reason; clicks = $clicks }
    }
    Start-Sleep -Milliseconds 360
    $expandedWindow = Get-MascotOverlayWindow
    $primaryClick = Send-MascotOverlayPrimaryClick -Window $expandedWindow
    $clicks += $primaryClick
    return [pscustomobject]@{
      attempted = $true
      sent = [bool]$primaryClick.sent
      reason = if ($primaryClick.sent) { "compact_expand_then_primary_click_sent" } else { $primaryClick.reason }
      clicks = $clicks
    }
  }
  $primaryOnlyClick = Send-MascotOverlayPrimaryClick -Window $Window
  $clicks += $primaryOnlyClick
  return [pscustomobject]@{
    attempted = $true
    sent = [bool]$primaryOnlyClick.sent
    reason = if ($primaryOnlyClick.sent) { "primary_click_sent" } else { $primaryOnlyClick.reason }
    clicks = $clicks
  }
}

function Test-FillVerified {
  param([object]$Latest, [string]$BeforeRecordedAt)
  $fillEnvelope = $Latest.desktopFill
  if (-not $fillEnvelope -or -not $fillEnvelope.fill) { return $false }
  if ($BeforeRecordedAt -and [string]$fillEnvelope.recordedAt -eq $BeforeRecordedAt) { return $false }
  $fill = $fillEnvelope.fill
  $summary = $fill.summary
  $foreground = $fill.foreground
  return [bool](
    $fill.pass -and
    $fill.writeAttempted -and
    $fill.verified -and
    $fill.confirmForeground -and
    -not $fill.selfTest -and
    $foreground.expectedTitleHashMatched -and
    $foreground.expectedToolProfileMatched -and
    $summary.safeCandidateCount -gt 0 -and
    $summary.bestCandidateIndex -ge 0 -and
    -not $summary.autoSubmit -and
    [int]$summary.submitSignalCount -eq 0
  )
}

if ($RefreshTargets) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-p25-real-desktop-targets.ps1") -Report (Resolve-RepoPath $TargetsReport) | Out-Null
}

$reportPath = Resolve-RepoPath $Report
$reportDir = Split-Path -Parent $reportPath
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$targets = Read-JsonFile $TargetsReport
$overlayNoActivate = Read-JsonFile $OverlayNoActivateReport
$composerDiagnostics = Read-JsonFile $ComposerDiagnosticsReport
$composerDiagnosticsSummary = if ($composerDiagnostics -and $composerDiagnostics.summary) { $composerDiagnostics.summary } else { $null }
$diagnosticSafeCandidateCount = if ($composerDiagnosticsSummary -and $null -ne $composerDiagnosticsSummary.safeCandidateCount) { [int]$composerDiagnosticsSummary.safeCandidateCount } else { 0 }
$diagnosticBrowserLikeComposerCandidateCount = if ($composerDiagnosticsSummary -and $null -ne $composerDiagnosticsSummary.browserLikeComposerCandidateCount) { [int]$composerDiagnosticsSummary.browserLikeComposerCandidateCount } else { 0 }
$diagnosticFocusedCandidateCount = if ($composerDiagnosticsSummary -and $null -ne $composerDiagnosticsSummary.focusedCandidateCount) { [int]$composerDiagnosticsSummary.focusedCandidateCount } else { 0 }
$diagnosticCaretCandidateCount = if ($composerDiagnosticsSummary -and $null -ne $composerDiagnosticsSummary.caretCandidateCount) { [int]$composerDiagnosticsSummary.caretCandidateCount } else { 0 }
$diagnosticSemanticCandidateCount = if ($composerDiagnosticsSummary -and $null -ne $composerDiagnosticsSummary.semanticCandidateCount) { [int]$composerDiagnosticsSummary.semanticCandidateCount } else { 0 }
$diagnosticBestCandidateIndex = if ($composerDiagnosticsSummary -and $null -ne $composerDiagnosticsSummary.bestCandidateIndex) { [int]$composerDiagnosticsSummary.bestCandidateIndex } else { -1 }
$diagnosticBrowserLikeDeficitSummary = if ($composerDiagnosticsSummary -and $composerDiagnosticsSummary.browserLikeDeficitSummary) { $composerDiagnosticsSummary.browserLikeDeficitSummary } else { $null }
$browserLikeComposerBlocked = [bool]($diagnosticBrowserLikeComposerCandidateCount -gt 0 -and $diagnosticSafeCandidateCount -eq 0)
$composerDiagnosticsPrivacyOk = [bool](
  -not $composerDiagnostics -or (
    $composerDiagnostics.privacy -and
    $composerDiagnostics.privacy.targetInputsNotStored -and
    $composerDiagnostics.privacy.onlyHashesGeometryAndBooleans
  )
)
$rows = @(Get-TargetRows -Targets $targets)
$strictForegroundReady = Test-AllRows -Rows $rows -Predicate { param($row) [bool]$row.strictForegroundDetected }
$safeCandidatesReady = Test-AllRows -Rows $rows -Predicate { param($row) [int]$row.targetSafeCandidateCount -gt 0 -and [int]$row.targetBestCandidateIndex -ge 0 }
$targetPrivacyOk = [bool]($targets -and $targets.summary -and $targets.summary.privacyOk -and $targets.summary.noAutoSubmit)
$overlayNoActivateReady = [bool]($overlayNoActivate -and $overlayNoActivate.pass -and $overlayNoActivate.checks.noActivateStyle)
$serviceToken = Get-ServiceToken -Port $ServicePort
$serviceReachable = [bool]$serviceToken
$desktopPromptState = if ($serviceToken) { Get-DesktopPromptState -Port $ServicePort -Token $serviceToken } else { $null }
$desktopPromptStateReady = Test-DesktopPromptStateReady -PromptState $desktopPromptState
$desktopPromptPrivacyOk = [bool](
  -not $desktopPromptState -or
  -not $desktopPromptState.desktopPrompt -or (
    $desktopPromptState.desktopPrompt -and
    $desktopPromptState.desktopPrompt.privacy.promptTextNotStored -and
    $desktopPromptState.desktopPrompt.privacy.draftTextNotStored -and
    $desktopPromptState.desktopPrompt.privacy.onlyLengthAndHash -and
    $desktopPromptState.desktopPrompt.privacy.targetInputsNotStored
  )
)
$clickPreconditionsReady = [bool](
  $targetPrivacyOk -and
  $overlayNoActivateReady -and
  $strictForegroundReady -and
  $safeCandidatesReady -and
  $desktopPromptStateReady -and
  $AllowRealOverlayClick
)

$latestBefore = $null
$beforeRecordedAt = ""
$overlayWindow = $null
$overlayNoActivateStyle = $false
$overlayTopmost = $false
$clickResult = [pscustomobject]@{ attempted = $false; sent = $false; reason = "preconditions_not_ready" }
$latestAfter = $null
$fillVerified = $false

if ($clickPreconditionsReady) {
  if ($serviceToken) {
    $latestBefore = Get-LatestDesktopFill -Port $ServicePort -Token $serviceToken
    if ($latestBefore -and $latestBefore.desktopFill) {
      $beforeRecordedAt = [string]$latestBefore.desktopFill.recordedAt
    }
  }
  $overlayWindow = Get-MascotOverlayWindow
  if ($overlayWindow) {
    $overlayNoActivateStyle = [bool](($overlayWindow.ExStyle -band [SmartPromptOverlayClickNative]::WS_EX_NOACTIVATE) -ne 0)
    $overlayTopmost = [bool](($overlayWindow.ExStyle -band [SmartPromptOverlayClickNative]::WS_EX_TOPMOST) -ne 0)
  }
  if ($overlayWindow -and $overlayWindow.Visible -and $overlayNoActivateStyle) {
    $clickResult = Invoke-MascotOverlayClick -Window $overlayWindow
    if ($clickResult.sent -and $serviceToken) {
      $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
      do {
        Start-Sleep -Milliseconds 350
        $latestAfter = Get-LatestDesktopFill -Port $ServicePort -Token $serviceToken
        $fillVerified = Test-FillVerified -Latest $latestAfter -BeforeRecordedAt $beforeRecordedAt
        if ($fillVerified) { break }
      } while ((Get-Date) -lt $deadline)
    }
  } else {
    $clickResult = [pscustomobject]@{
      attempted = $false
      sent = $false
      reason = if (-not $overlayWindow) { "overlay_window_missing" } elseif (-not $overlayWindow.Visible) { "overlay_window_hidden" } else { "overlay_window_can_activate" }
    }
  }
}

$completionReady = [bool]($clickPreconditionsReady -and $clickResult.sent -and $fillVerified)
$completionImpact = if ($completionReady) {
  "real_overlay_click_fill_verified"
} elseif (-not $targets) {
  "target_report_missing"
} elseif (-not $targetPrivacyOk) {
  "target_privacy_or_no_submit_missing"
} elseif (-not $strictForegroundReady) {
  "strict_target_foreground_missing"
} elseif (-not $safeCandidatesReady) {
  "safe_composer_candidate_missing"
} elseif (-not $overlayNoActivateReady) {
  "overlay_noactivate_missing"
} elseif (-not $desktopPromptStateReady) {
  "desktop_prompt_state_missing"
} elseif (-not $AllowRealOverlayClick) {
  "real_overlay_click_requires_explicit_allow"
} elseif (-not $serviceReachable) {
  "local_service_unreachable"
} elseif (-not $clickResult.sent) {
  $clickResult.reason
} else {
  "real_overlay_click_sent_but_fill_unverified"
}

$privacyOk = [bool](
  $targetPrivacyOk -and
  $composerDiagnosticsPrivacyOk -and
  $desktopPromptPrivacyOk -and
  (-not $latestAfter -or -not (($latestAfter | ConvertTo-Json -Depth 16).Contains("Smart Prompt P25 real desktop fill probe")))
)

$reportObject = [ordered]@{
  schemaVersion = "p25-real-overlay-click-fill@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]($privacyOk -and (-not $clickResult.attempted -or $AllowRealOverlayClick))
  completionReady = [bool]$completionReady
  completionImpact = $completionImpact
  requestedProfiles = @(Get-UniqueProfiles)
  allowRealOverlayClick = [bool]$AllowRealOverlayClick
  desktopPromptPrepared = [bool]$desktopPromptStateReady
  manualDesktopPromptPrepared = [bool]$DesktopPromptPrepared
  refreshedTargets = [bool]$RefreshTargets
  reports = [ordered]@{
    targetsReport = ConvertTo-RepoRelativePath (Resolve-RepoPath $TargetsReport)
    overlayNoActivateReport = ConvertTo-RepoRelativePath (Resolve-RepoPath $OverlayNoActivateReport)
    composerDiagnosticsReport = ConvertTo-RepoRelativePath (Resolve-RepoPath $ComposerDiagnosticsReport)
    outputReport = ConvertTo-RepoRelativePath $reportPath
  }
  prerequisites = [ordered]@{
    targetsReportPresent = [bool]($targets -ne $null)
    targetRowsPresent = [bool]($rows.Count -eq @(Get-UniqueProfiles).Count)
    targetPrivacyOk = [bool]$targetPrivacyOk
    strictForegroundReady = [bool]$strictForegroundReady
    safeCandidatesReady = [bool]$safeCandidatesReady
    composerDiagnosticsReportPresent = [bool]($composerDiagnostics -ne $null)
    browserLikeComposerBlocked = [bool]$browserLikeComposerBlocked
    overlayNoActivateReportPresent = [bool]($overlayNoActivate -ne $null)
    overlayNoActivateReady = [bool]$overlayNoActivateReady
    desktopPromptStatePresent = [bool]($desktopPromptState -and $desktopPromptState.desktopPrompt)
    desktopPromptStateReady = [bool]$desktopPromptStateReady
    manualDesktopPromptPrepared = [bool]$DesktopPromptPrepared
    explicitClickAllowed = [bool]$AllowRealOverlayClick
    clickPreconditionsReady = [bool]$clickPreconditionsReady
  }
  safeCandidateDiagnostics = [ordered]@{
    reportPresent = [bool]($composerDiagnostics -ne $null)
    completionImpact = if ($composerDiagnostics) { [string]$composerDiagnostics.completionImpact } else { "" }
    completionReady = if ($composerDiagnostics) { [bool]$composerDiagnostics.completionReady } else { $false }
    safeCandidateCount = [int]$diagnosticSafeCandidateCount
    browserLikeComposerCandidateCount = [int]$diagnosticBrowserLikeComposerCandidateCount
    focusedCandidateCount = [int]$diagnosticFocusedCandidateCount
    caretCandidateCount = [int]$diagnosticCaretCandidateCount
    semanticCandidateCount = [int]$diagnosticSemanticCandidateCount
    bestCandidateIndex = [int]$diagnosticBestCandidateIndex
    topReasonCounts = if ($composerDiagnosticsSummary -and $composerDiagnosticsSummary.topReasonCounts) { $composerDiagnosticsSummary.topReasonCounts } else { $null }
    browserLikeComposerBlocked = [bool]$browserLikeComposerBlocked
    browserLikeDeficitSummary = $diagnosticBrowserLikeDeficitSummary
    broadDocumentNotPromoted = [bool]$browserLikeComposerBlocked
    privacyOk = [bool]$composerDiagnosticsPrivacyOk
  }
  desktopPromptState = if ($desktopPromptState -and $desktopPromptState.desktopPrompt) {
    [ordered]@{
      schemaVersion = [string]$desktopPromptState.desktopPrompt.schemaVersion
      recordedAtPresent = [bool]$desktopPromptState.desktopPrompt.recordedAt
      source = [string]$desktopPromptState.desktopPrompt.source
      prepared = [bool]$desktopPromptState.desktopPrompt.prepared
      activeTextKind = [string]$desktopPromptState.desktopPrompt.activeTextKind
      activeTextLength = [int]$desktopPromptState.desktopPrompt.activeTextLength
      activeTextHashPresent = [bool]$desktopPromptState.desktopPrompt.activeTextHash
      generatedBy = [string]$desktopPromptState.desktopPrompt.generatedBy
      readiness = $desktopPromptState.desktopPrompt.readiness
    }
  } else {
    $null
  }
  overlayWindow = if ($overlayWindow) {
    [ordered]@{
      hwnd = ("0x{0:x}" -f $overlayWindow.Handle.ToInt64())
      processId = [int]$overlayWindow.ProcessId
      titleLength = [int]$overlayWindow.Title.Length
      visible = [bool]$overlayWindow.Visible
      noActivate = [bool]$overlayNoActivateStyle
      topmost = [bool]$overlayTopmost
    }
  } else {
    $null
  }
  click = [ordered]@{
    attempted = [bool]$clickResult.attempted
    sent = [bool]$clickResult.sent
    reason = [string]$clickResult.reason
  }
  verification = [ordered]@{
    servicePort = [int]$ServicePort
    serviceReachable = [bool]$serviceReachable
    desktopPromptStateReady = [bool]$desktopPromptStateReady
    beforeFillRecordedAtPresent = [bool]$beforeRecordedAt
    latestFillObserved = [bool]($latestAfter -and $latestAfter.desktopFill -and $latestAfter.desktopFill.fill)
    fillVerified = [bool]$fillVerified
    noAutoSubmit = [bool](
      $latestAfter -and
      $latestAfter.desktopFill -and
      $latestAfter.desktopFill.fill -and
      -not $latestAfter.desktopFill.fill.summary.autoSubmit -and
      [int]$latestAfter.desktopFill.fill.summary.submitSignalCount -eq 0
    )
    confirmForeground = [bool](
      $latestAfter -and
      $latestAfter.desktopFill -and
      $latestAfter.desktopFill.fill -and
      $latestAfter.desktopFill.fill.confirmForeground
    )
    expectedTitleHashMatched = [bool](
      $latestAfter -and
      $latestAfter.desktopFill -and
      $latestAfter.desktopFill.fill -and
      $latestAfter.desktopFill.fill.foreground.expectedTitleHashMatched
    )
    expectedToolProfileMatched = [bool](
      $latestAfter -and
      $latestAfter.desktopFill -and
      $latestAfter.desktopFill.fill -and
      $latestAfter.desktopFill.fill.foreground.expectedToolProfileMatched
    )
  }
  targetSummary = if ($targets -and $targets.summary) { $targets.summary } else { $null }
  privacy = [ordered]@{
    targetTitlesRedacted = $true
    targetInputsNotStored = $true
    promptTextNotStored = $true
    composerDiagnosticsIsSanitized = [bool]$composerDiagnosticsPrivacyOk
    desktopPromptStateIsSanitized = [bool]$desktopPromptPrivacyOk
    clipboardTextNotStored = $true
    latestFillIsSanitized = $true
    verificationUsesLengthAndHash = $true
    noAutoSubmitRequired = $true
  }
}

$reportObject | ConvertTo-Json -Depth 16 | Set-Content -Encoding UTF8 -LiteralPath $reportPath
Write-Host "P25 real overlay click fill report: $reportPath"
Write-Host ($reportObject | ConvertTo-Json -Depth 16)

if (-not $reportObject.pass) {
  exit 1
}
