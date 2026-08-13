[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Report = "",
  [switch]$JsonOnly,
  [ValidateSet("codex", "claude-code", "hermes", "workbuddy", "trae")]
  [string[]]$Profiles = @("codex", "claude-code", "hermes"),
  [switch]$AttachExistingWindow,
  [ValidateSet("", "codex", "claude-code", "hermes", "workbuddy", "trae")]
  [string]$AttachProfile = "",
  [switch]$AllowForegroundWrite,
  [switch]$AllowClipboardFallback,
  [switch]$AllowTextPatternVerification,
  [string]$ExpectedTitleHash = "",
  [string]$ExpectedToolProfile = "",
  [int]$CandidateIndex = -1,
  [string]$Text = "Smart Prompt M3 real foreground desktop fill probe"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
. (Join-Path $ScriptDir "desktop-tool-profile-config.ps1")

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-real-desktop-tools.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

$SupportedProfiles = Get-SmartPromptSupportedToolProfiles
$RequestedProfiles = @($Profiles | Select-Object -Unique)
if ($RequestedProfiles.Count -eq 0) {
  $RequestedProfiles = $SupportedProfiles
}
if (-not $AttachProfile -and $AttachExistingWindow -and $RequestedProfiles.Count -eq 1) {
  $AttachProfile = $RequestedProfiles[0]
}

function Get-HashText {
  param([string]$Value)
  if (-not $Value) { return "" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash) -replace "-", "").Substring(0, 16).ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Ensure-NativeTypes {
  if (-not ([System.Management.Automation.PSTypeName]"SmartPromptRealDesktopNative").Type) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct SmartPromptRealDesktopRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public struct SmartPromptRealDesktopPoint {
  public int X;
  public int Y;
}
public static class SmartPromptRealDesktopNative {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")]
  public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("kernel32.dll")]
  public static extern int GetLastError();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out SmartPromptRealDesktopRect lpRect);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out SmartPromptRealDesktopPoint lpPoint);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
}
"@
  }
}

function Test-IsForegroundWindow {
  param([IntPtr]$Handle)
  try {
    return [bool]([SmartPromptRealDesktopNative]::GetForegroundWindow().Equals($Handle))
  } catch {
    return $false
  }
}

function Invoke-AltForegroundUnlock {
  try {
    [SmartPromptRealDesktopNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [SmartPromptRealDesktopNative]::keybd_event(0x12, 0, 0x0002, [UIntPtr]::Zero)
    return $true
  } catch {
    return $false
  }
}

function Set-ToolWindowForeground {
  param([IntPtr]$Handle)
  Ensure-NativeTypes

  $activation = [ordered]@{
    initialSetForeground = $false
    initialForeground = $false
    attachAttempted = $false
    attachCurrentToForeground = $false
    attachCurrentToTarget = $false
    attachBringToTop = $false
    attachSetForeground = $false
    attachForeground = $false
    altUnlockAttempted = $false
    altUnlockSent = $false
    altSetForeground = $false
    altForeground = $false
    switchAttempted = $false
    switchForeground = $false
    isForeground = $false
  }

  try {
    $activation.initialSetForeground = [bool][SmartPromptRealDesktopNative]::SetForegroundWindow($Handle)
    Start-Sleep -Milliseconds 150
    $activation.initialForeground = Test-IsForegroundWindow -Handle $Handle
    if ($activation.initialForeground) {
      $activation.isForeground = $true
      return [pscustomobject]$activation
    }

    $activation.attachAttempted = $true
    $foregroundHandle = [SmartPromptRealDesktopNative]::GetForegroundWindow()
    $foregroundPid = [uint32]0
    $targetPid = [uint32]0
    $foregroundThread = [SmartPromptRealDesktopNative]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundPid)
    $targetThread = [SmartPromptRealDesktopNative]::GetWindowThreadProcessId($Handle, [ref]$targetPid)
    $currentThread = [SmartPromptRealDesktopNative]::GetCurrentThreadId()

    try {
      if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
        $activation.attachCurrentToForeground = [bool][SmartPromptRealDesktopNative]::AttachThreadInput($currentThread, $foregroundThread, $true)
      }
      if ($targetThread -ne 0 -and $targetThread -ne $currentThread) {
        $activation.attachCurrentToTarget = [bool][SmartPromptRealDesktopNative]::AttachThreadInput($currentThread, $targetThread, $true)
      }
      $activation.attachBringToTop = [bool][SmartPromptRealDesktopNative]::BringWindowToTop($Handle)
      [void][SmartPromptRealDesktopNative]::SetActiveWindow($Handle)
      [void][SmartPromptRealDesktopNative]::SetFocus($Handle)
      $activation.attachSetForeground = [bool][SmartPromptRealDesktopNative]::SetForegroundWindow($Handle)
      Start-Sleep -Milliseconds 250
      $activation.attachForeground = Test-IsForegroundWindow -Handle $Handle
    } finally {
      if ($activation.attachCurrentToTarget) {
        [void][SmartPromptRealDesktopNative]::AttachThreadInput($currentThread, $targetThread, $false)
      }
      if ($activation.attachCurrentToForeground) {
        [void][SmartPromptRealDesktopNative]::AttachThreadInput($currentThread, $foregroundThread, $false)
      }
    }
    if ($activation.attachForeground) {
      $activation.isForeground = $true
      return [pscustomobject]$activation
    }

    $activation.altUnlockAttempted = $true
    $activation.altUnlockSent = Invoke-AltForegroundUnlock
    $activation.altSetForeground = [bool][SmartPromptRealDesktopNative]::SetForegroundWindow($Handle)
    [void][SmartPromptRealDesktopNative]::BringWindowToTop($Handle)
    Start-Sleep -Milliseconds 350
    $activation.altForeground = Test-IsForegroundWindow -Handle $Handle
    if ($activation.altForeground) {
      $activation.isForeground = $true
      return [pscustomobject]$activation
    }

    $activation.switchAttempted = $true
    [SmartPromptRealDesktopNative]::SwitchToThisWindow($Handle, $true)
    Start-Sleep -Milliseconds 350
    $activation.switchForeground = Test-IsForegroundWindow -Handle $Handle
    $activation.isForeground = [bool]$activation.switchForeground
    return [pscustomobject]$activation
  } catch {
    $activation.isForeground = Test-IsForegroundWindow -Handle $Handle
    return [pscustomobject]$activation
  }
}

function Restore-ToolWindow {
  param([IntPtr]$Handle)
  try {
    return [bool][SmartPromptRealDesktopNative]::ShowWindowAsync($Handle, 9)
  } catch {
    return $false
  }
}

function New-WindowRectObject {
  param([object]$X, [object]$Y, [object]$Width, [object]$Height)
  function ConvertTo-SafeInt {
    param([object]$Value)
    try {
      $number = [double]$Value
      if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return 0 }
      if ($number -gt [int]::MaxValue) { return [int]::MaxValue }
      if ($number -lt [int]::MinValue) { return [int]::MinValue }
      return [int]$number
    } catch {
      return 0
    }
  }
  return [pscustomobject]@{
    x = ConvertTo-SafeInt $X
    y = ConvertTo-SafeInt $Y
    width = ConvertTo-SafeInt $Width
    height = ConvertTo-SafeInt $Height
  }
}

function Test-ToolWindowCloaked {
  param([IntPtr]$Handle)
  try {
    $cloaked = 0
    $result = [SmartPromptRealDesktopNative]::DwmGetWindowAttribute($Handle, 14, [ref]$cloaked, 4)
    return [bool]($result -eq 0 -and $cloaked -ne 0)
  } catch {
    return $false
  }
}

function Get-ToolWindowVisibilityContext {
  param([IntPtr]$Handle)
  Ensure-NativeTypes
  $emptyRect = New-WindowRectObject -X 0 -Y 0 -Width 0 -Height 0
  $result = [ordered]@{
    isVisible = $false
    isMinimized = $false
    isCloaked = $false
    isUsable = $false
    boundingRect = $emptyRect
  }
  if ($Handle -eq [IntPtr]::Zero) { return [pscustomobject]$result }
  try {
    $rect = New-Object SmartPromptRealDesktopRect
    $hasRect = [SmartPromptRealDesktopNative]::GetWindowRect($Handle, [ref]$rect)
    $width = if ($hasRect) { [int]$rect.Right - [int]$rect.Left } else { 0 }
    $height = if ($hasRect) { [int]$rect.Bottom - [int]$rect.Top } else { 0 }
    $isVisible = [SmartPromptRealDesktopNative]::IsWindowVisible($Handle)
    $isMinimized = [SmartPromptRealDesktopNative]::IsIconic($Handle)
    $isCloaked = Test-ToolWindowCloaked -Handle $Handle
    $result.isVisible = [bool]$isVisible
    $result.isMinimized = [bool]$isMinimized
    $result.isCloaked = [bool]$isCloaked
    $result.boundingRect = if ($hasRect) {
      New-WindowRectObject -X $rect.Left -Y $rect.Top -Width $width -Height $height
    } else {
      $emptyRect
    }
    $result.isUsable = [bool]($isVisible -and -not $isMinimized -and -not $isCloaked -and $width -gt 0 -and $height -gt 0)
  } catch {
    $result.isVisible = $false
    $result.isUsable = $false
  }
  return [pscustomobject]$result
}

function New-CursorPlacementResult {
  param([string]$Strategy = "", [string]$ToolProfile = "")
  return [pscustomobject]@{
    attempted = $false
    strategy = $Strategy
    toolProfile = $ToolProfile
    setCursor = $false
    cursorSupported = $false
    cursorWithinCandidate = $false
    ok = $false
    targetPoint = [pscustomobject]@{ x = 0; y = 0 }
    cursorPoint = [pscustomobject]@{ x = 0; y = 0 }
  }
}

function Set-CursorInsideWindow {
  param([IntPtr]$Handle)
  try {
    $rect = New-Object SmartPromptRealDesktopRect
    $ok = [SmartPromptRealDesktopNative]::GetWindowRect($Handle, [ref]$rect)
    if (-not $ok) { return $false }
    $point = New-Object SmartPromptRealDesktopPoint
    $hasCursor = [SmartPromptRealDesktopNative]::GetCursorPos([ref]$point)
    if (
      $hasCursor -and
      [int]$point.X -ge [int]$rect.Left -and
      [int]$point.X -lt [int]$rect.Right -and
      [int]$point.Y -ge [int]$rect.Top -and
      [int]$point.Y -lt [int]$rect.Bottom
    ) {
      return $true
    }
    $width = [Math]::Max(1, [int]$rect.Right - [int]$rect.Left)
    $height = [Math]::Max(1, [int]$rect.Bottom - [int]$rect.Top)
    $x = [int]([int]$rect.Left + [Math]::Min($width - 1, [Math]::Max(1, $width / 2)))
    $y = [int]([int]$rect.Top + [Math]::Min($height - 1, [Math]::Max(1, $height / 2)))
    return [bool][SmartPromptRealDesktopNative]::SetCursorPos($x, $y)
  } catch {
    return $false
  }
}

function Set-CursorInsideToolComposerRegion {
  param([IntPtr]$Handle, [string]$ToolProfile, [object]$Bounds = $null)
  $placement = New-CursorPlacementResult -Strategy "tool_composer_region" -ToolProfile $ToolProfile
  $placement.attempted = $true
  try {
    $left = 0
    $top = 0
    $width = 0
    $height = 0
    if ($Bounds -and [int]$Bounds.width -gt 0 -and [int]$Bounds.height -gt 0) {
      $left = [int]$Bounds.x
      $top = [int]$Bounds.y
      $width = [int]$Bounds.width
      $height = [int]$Bounds.height
    } else {
      $rect = New-Object SmartPromptRealDesktopRect
      $ok = [SmartPromptRealDesktopNative]::GetWindowRect($Handle, [ref]$rect)
      if (-not $ok) { return $placement }
      $left = [int]$rect.Left
      $top = [int]$rect.Top
      $width = [int]$rect.Right - [int]$rect.Left
      $height = [int]$rect.Bottom - [int]$rect.Top
    }
    $width = [Math]::Max(1, $width)
    $height = [Math]::Max(1, $height)
    $xRatio = 0.625
    $yRatio = 0.805
    $candidateLeftRatio = 0.28
    $candidateTopRatio = 0.72
    $candidateWidthRatio = 0.69
    $candidateHeightRatio = 0.17
    if ($ToolProfile -eq "trae") {
      $xRatio = 0.37
      $yRatio = 0.845
      $candidateLeftRatio = 0.15
      $candidateTopRatio = 0.78
      $candidateWidthRatio = 0.44
      $candidateHeightRatio = 0.13
    }
    $x = [int]($left + [Math]::Min($width - 1, [Math]::Max(1, $width * $xRatio)))
    $y = [int]($top + [Math]::Min($height - 1, [Math]::Max(1, $height * $yRatio)))
    $placement.targetPoint = [pscustomobject]@{ x = $x; y = $y }
    $candidateLeft = [int]($left + [Math]::Max(0, $width * $candidateLeftRatio))
    $candidateTop = [int]($top + [Math]::Max(0, $height * $candidateTopRatio))
    $candidateRight = [int]($candidateLeft + [Math]::Max(80, $width * $candidateWidthRatio))
    $candidateBottom = [int]($candidateTop + [Math]::Max(48, $height * $candidateHeightRatio))
    for ($attempt = 0; $attempt -lt 5; $attempt += 1) {
      $set = [bool][SmartPromptRealDesktopNative]::SetCursorPos($x, $y)
      if (-not $set) {
        try {
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
          $set = $true
        } catch {
          $set = $false
        }
      }
      $placement.setCursor = [bool]($placement.setCursor -or $set)
      Start-Sleep -Milliseconds 140
      $point = New-Object SmartPromptRealDesktopPoint
      $hasCursor = [SmartPromptRealDesktopNative]::GetCursorPos([ref]$point)
      $placement.cursorSupported = [bool]($placement.cursorSupported -or $hasCursor)
      if (-not $hasCursor) { continue }
      $placement.cursorPoint = [pscustomobject]@{ x = [int]$point.X; y = [int]$point.Y }
      $placement.cursorWithinCandidate = [bool](
        [int]$point.X -ge $candidateLeft -and
        [int]$point.X -lt $candidateRight -and
        [int]$point.Y -ge $candidateTop -and
        [int]$point.Y -lt $candidateBottom
      )
      if ($placement.cursorWithinCandidate) { break }
    }
    $placement.ok = [bool]$placement.cursorWithinCandidate
    return $placement
  } catch {
    return $placement
  }
}

function Get-ChildProcessNames {
  param(
    [int]$ProcessId,
    [int]$Depth = 0,
    [hashtable]$Seen = $null
  )
  if (-not $Seen) { $Seen = @{} }
  if ($Depth -gt 4 -or $Seen.ContainsKey($ProcessId)) { return @() }
  $Seen[$ProcessId] = $true
  $names = @()
  try {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      if ($child.Name) {
        $names += [System.IO.Path]::GetFileNameWithoutExtension([string]$child.Name)
      }
      if ($names.Count -ge 80) { break }
      $names += Get-ChildProcessNames -ProcessId ([int]$child.ProcessId) -Depth ($Depth + 1) -Seen $Seen
      if ($names.Count -ge 80) { break }
    }
  } catch {
    # Best-effort process lineage only; inaccessible CIM rows should not fail orchestration.
  }
  return @($names | Where-Object { $_ } | Select-Object -Unique)
}

function Test-DirectToolProfileMatch {
  param([string]$Profile, [string]$ProcessName, [string]$WindowTitle, [string]$ExecutablePath = "")
  return [bool]((Get-ToolProfile -ProcessName $ProcessName -WindowTitle $WindowTitle -ChildProcessNames @() -ExecutablePath $ExecutablePath) -eq $Profile)
}

function Test-ShouldInspectChildProcesses {
  param([string]$Profile, [string]$ProcessName, [string]$WindowTitle)
  if ($Profile -notin @("codex", "claude-code", "hermes")) { return $false }
  if (-not (Test-ShouldUseRelatedToolProfile -ProcessName $ProcessName -WindowTitle $WindowTitle)) { return $false }
  return $true
}

function Test-ShouldUseRelatedToolProfile {
  param([string]$ProcessName, [string]$WindowTitle)
  $process = ([string]$ProcessName).Trim()
  if ($process -match "(?i)^(explorer|lockapp|shellexperiencehost|searchhost|startmenuexperiencehost|applicationframehost|textinputhost|dwm|runtimebroker|widgets|systemsettings|taskmgr)$") {
    return $false
  }
  $haystack = "$ProcessName $WindowTitle"
  return [bool]($haystack -match "(?i)terminal|powershell|cmd|pwsh|code|cursor|electron|local|claude|codex|hermes")
}

function Test-RelatedToolProcessHintPresent {
  param([string]$ProcessName, [string]$WindowTitle, [string[]]$RelatedProcessNames = @())
  if (-not (Test-ShouldUseRelatedToolProfile -ProcessName $ProcessName -WindowTitle $WindowTitle)) {
    return $false
  }
  return [bool](($RelatedProcessNames -join " ") -match "(?i)\bcodex\b|\bclaude\b|\bhermes\b|\bwork[\s-]*buddy\b|\bworkbuddy\b|\btrae\b")
}

function Get-ToolProfile {
  param(
    [string]$ProcessName,
    [string]$WindowTitle,
    [string[]]$ChildProcessNames = @(),
    [string]$ExecutablePath = ""
  )
  if (Test-SmartPromptTrustedExecutableProfile -ToolProfile "codex" -ExecutablePath $ExecutablePath) { return "codex" }
  $directHaystack = "$ProcessName $WindowTitle"
  if ($directHaystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($directHaystack -match "(?i)\bclaude\b") { return "claude-code" }
  if ($directHaystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($directHaystack -match "(?i)\bhermes\b") { return "hermes" }
  if ($directHaystack -match "(?i)\bwork[\s-]*buddy\b|\bworkbuddy\b") { return "workbuddy" }
  if ($directHaystack -match "(?i)\btrae\b") { return "trae" }
  if (-not (Test-ShouldUseRelatedToolProfile -ProcessName $ProcessName -WindowTitle $WindowTitle)) { return "unknown" }
  $relatedHaystack = (($ChildProcessNames | ForEach-Object { [string]$_ }) -join " ")
  if ($relatedHaystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($relatedHaystack -match "(?i)\bclaude\b") { return "claude-code" }
  if ($relatedHaystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($relatedHaystack -match "(?i)\bhermes\b") { return "hermes" }
  if ($relatedHaystack -match "(?i)\bwork[\s-]*buddy\b|\bworkbuddy\b") { return "workbuddy" }
  if ($relatedHaystack -match "(?i)\btrae\b") { return "trae" }
  return "unknown"
}

function Set-ExistingToolForeground {
  param([string]$Profile)
  Ensure-NativeTypes
  $windows = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  $matches = @()
  foreach ($window in $windows) {
    $children = @()
    $executablePath = try { [string]$window.Path } catch { "" }
    $detected = Get-ToolProfile -ProcessName $window.ProcessName -WindowTitle $window.MainWindowTitle -ChildProcessNames $children -ExecutablePath $executablePath
    if ($detected -ne $Profile) {
      $directProfileMatch = Test-DirectToolProfileMatch -Profile $Profile -ProcessName $window.ProcessName -WindowTitle $window.MainWindowTitle -ExecutablePath $executablePath
      $shouldInspectChildren = Test-ShouldInspectChildProcesses -Profile $Profile -ProcessName $window.ProcessName -WindowTitle $window.MainWindowTitle
      if (-not $directProfileMatch -and $shouldInspectChildren) {
        $children = @(Get-ChildProcessNames -ProcessId ([int]$window.Id))
        $detected = Get-ToolProfile -ProcessName $window.ProcessName -WindowTitle $window.MainWindowTitle -ChildProcessNames $children -ExecutablePath $executablePath
      }
    }
    if ($detected -eq $Profile) {
      $visibility = Get-ToolWindowVisibilityContext -Handle ([IntPtr]$window.MainWindowHandle)
      $matches += [pscustomobject]@{
        processName = $window.ProcessName
        handle = [IntPtr]$window.MainWindowHandle
        titleLength = ([string]$window.MainWindowTitle).Length
        titleHash = Get-HashText ([string]$window.MainWindowTitle)
        detectedToolProfile = $detected
        isVisible = [bool]$visibility.isVisible
        isMinimized = [bool]$visibility.isMinimized
        isCloaked = [bool]$visibility.isCloaked
        isUsable = [bool]$visibility.isUsable
        boundingRect = $visibility.boundingRect
        childProcessCount = $children.Count
        childToolProcessHintPresent = Test-RelatedToolProcessHintPresent -ProcessName $window.ProcessName -WindowTitle $window.MainWindowTitle -RelatedProcessNames $children
      }
    }
  }
  $selected = @($matches | Sort-Object @{ Expression = { if ($_.isUsable) { 0 } else { 1 } } }, @{ Expression = { if ($_.processName -match "(?i)^$Profile") { 0 } else { 1 } } }, @{ Expression = { $_.titleLength }; Descending = $true } | Select-Object -First 1)
  if ($selected.Count -eq 0) {
    return [pscustomobject]@{
      requested = $Profile
      attempted = $true
      windowFound = $false
      setForeground = $false
      foregroundActivation = [pscustomobject]@{
        initialSetForeground = $false
        initialForeground = $false
        attachAttempted = $false
        attachCurrentToForeground = $false
        attachCurrentToTarget = $false
        attachBringToTop = $false
        attachSetForeground = $false
        attachForeground = $false
        altUnlockAttempted = $false
        altUnlockSent = $false
        altSetForeground = $false
        altForeground = $false
        switchAttempted = $false
        switchForeground = $false
        isForeground = $false
      }
      processName = ""
      titleLength = 0
      titleHash = ""
      detectedToolProfile = "unknown"
      cursorPlacement = New-CursorPlacementResult -Strategy "none" -ToolProfile "unknown"
      isVisible = $false
      isMinimized = $false
      isCloaked = $false
      isUsable = $false
      boundingRect = (New-WindowRectObject -X 0 -Y 0 -Width 0 -Height 0)
      childProcessCount = 0
      childToolProcessHintPresent = $false
    }
  }
  $target = $selected[0]
  $restored = Restore-ToolWindow -Handle $target.handle
  Start-Sleep -Milliseconds 250
  $activation = Set-ToolWindowForeground -Handle $target.handle
  Start-Sleep -Milliseconds 800
  $visibilityAfterActivation = Get-ToolWindowVisibilityContext -Handle $target.handle
  $cursorPlacement = New-CursorPlacementResult -Strategy "none" -ToolProfile ([string]$target.detectedToolProfile)
  $cursorToolProfile = [string]$target.detectedToolProfile
  $cursorSet = if ($visibilityAfterActivation.isUsable -and ($cursorToolProfile -in @("workbuddy", "trae"))) {
    $cursorPlacement = Set-CursorInsideToolComposerRegion -Handle $target.handle -ToolProfile $cursorToolProfile -Bounds $visibilityAfterActivation.boundingRect
    [bool]$cursorPlacement.ok
  } elseif ($visibilityAfterActivation.isUsable) {
    $cursorSetResult = Set-CursorInsideWindow -Handle $target.handle
    $cursorPlacement = New-CursorPlacementResult -Strategy "window_center" -ToolProfile $cursorToolProfile
    $cursorPlacement.attempted = $true
    $cursorPlacement.ok = [bool]$cursorSetResult
    $cursorPlacement.setCursor = [bool]$cursorSetResult
    [bool]$cursorSetResult
  } else {
    $false
  }
  return [pscustomobject]@{
    requested = $Profile
    attempted = $true
    windowFound = $true
    restoreWindow = [bool]$restored
    setForeground = [bool]$activation.isForeground
    foregroundActivation = $activation
    cursorInsideTargetWindow = [bool]$cursorSet
    cursorPlacement = $cursorPlacement
    processName = $target.processName
    titleLength = $target.titleLength
    titleHash = $target.titleHash
    detectedToolProfile = $target.detectedToolProfile
    isVisible = [bool]$visibilityAfterActivation.isVisible
    isMinimized = [bool]$visibilityAfterActivation.isMinimized
    isCloaked = [bool]$visibilityAfterActivation.isCloaked
    isUsable = [bool]$visibilityAfterActivation.isUsable
    boundingRect = $visibilityAfterActivation.boundingRect
    childProcessCount = $target.childProcessCount
    childToolProcessHintPresent = [bool]$target.childToolProcessHintPresent
  }
}

function Invoke-JsonProbe {
  param(
    [string]$Path,
    [string[]]$Arguments
  )

  $commandArgs = @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $Path)
  $commandArgs += $Arguments
  $output = & powershell @commandArgs
  $exitCode = $LASTEXITCODE
  $jsonText = ($output | Where-Object { $null -ne $_ }) -join "`n"
  $json = $null
  $parseOk = $false
  $parseError = ""
  try {
    if ($jsonText.Trim().Length -gt 0) {
      $json = $jsonText | ConvertFrom-Json
      $parseOk = $true
    }
  } catch {
    $parseError = $_.Exception.Message
  }

  return [pscustomobject]@{
    exitCode = $exitCode
    parseOk = [bool]$parseOk
    parseError = $parseError
    json = $json
  }
}

function New-CoverageRow {
  param(
    [string]$Profile,
    [string]$DetectedProfile,
    [int]$CandidateCount,
    [bool]$WriteValidated
  )

  return [pscustomobject]@{
    id = $Profile
    status = if ($DetectedProfile -eq $Profile) { "foreground_detected" } else { "not_foreground" }
    foregroundDetected = [bool]($DetectedProfile -eq $Profile)
    snapshotCandidateCount = if ($DetectedProfile -eq $Profile) { $CandidateCount } else { 0 }
    realWindowWriteValidated = [bool]$WriteValidated
  }
}

$attach = [pscustomobject]@{
  requested = $AttachProfile
  attempted = [bool]$AttachExistingWindow
  windowFound = $false
  restoreWindow = $false
  setForeground = $false
  foregroundActivation = [pscustomobject]@{
    initialSetForeground = $false
    initialForeground = $false
    attachAttempted = $false
    attachCurrentToForeground = $false
    attachCurrentToTarget = $false
    attachBringToTop = $false
    attachSetForeground = $false
    attachForeground = $false
    altUnlockAttempted = $false
    altUnlockSent = $false
    altSetForeground = $false
    altForeground = $false
    switchAttempted = $false
    switchForeground = $false
    isForeground = $false
  }
  cursorInsideTargetWindow = $false
  cursorPlacement = New-CursorPlacementResult -Strategy "none" -ToolProfile "unknown"
  processName = ""
  titleLength = 0
  titleHash = ""
  detectedToolProfile = "unknown"
  isVisible = $false
  isMinimized = $false
  isCloaked = $false
  isUsable = $false
  boundingRect = (New-WindowRectObject -X 0 -Y 0 -Width 0 -Height 0)
  childProcessCount = 0
  childToolProcessHintPresent = $false
}
if ($AttachExistingWindow -and $AttachProfile) {
  $attach = Set-ExistingToolForeground -Profile $AttachProfile
}

$inputProbe = Invoke-JsonProbe -Path (Join-Path $ScriptDir "check-m3-desktop-input.ps1") -Arguments @("-JsonOnly")
$snapshot = $inputProbe.json
$snapshotOk = [bool]($inputProbe.parseOk -and $snapshot -and $snapshot.schemaVersion -eq "m3-windows-uia@1" -and $snapshot.probeOk)
$detectedToolProfile = "unknown"
$candidateCount = 0
$safeCandidateCount = 0
$foreground = [pscustomobject]@{
  processName = ""
  pidPresent = $false
  titleLength = 0
  titleHash = ""
  detectedToolProfile = "unknown"
  hasTargetForeground = $false
  isVisible = $false
  isMinimized = $false
  isCloaked = $false
  isUsable = $false
  boundingRect = (New-WindowRectObject -X 0 -Y 0 -Width 0 -Height 0)
}

if ($snapshot -and $snapshot.foreground) {
  $detectedToolProfile = if ($snapshot.foreground.detectedToolProfile) { $snapshot.foreground.detectedToolProfile } else { "unknown" }
  if ($snapshot.summary -and $null -ne $snapshot.summary.candidateCount) {
    $candidateCount = [int]$snapshot.summary.candidateCount
  } elseif ($snapshot.candidates) {
    $candidateCount = @($snapshot.candidates).Count
  }
  if ($snapshot.summary -and $null -ne $snapshot.summary.safeCandidateCount) {
    $safeCandidateCount = [int]$snapshot.summary.safeCandidateCount
  } else {
    $safeCandidateCount = $candidateCount
  }
  $foreground = [pscustomobject]@{
    processName = $snapshot.foreground.processName
    pidPresent = [bool]$snapshot.foreground.pidPresent
    titleLength = [int]$snapshot.foreground.titleLength
    titleHash = $snapshot.foreground.titleHash
    detectedToolProfile = $detectedToolProfile
    selectionSource = if ($snapshot.selection -and $snapshot.selection.source) { $snapshot.selection.source } else { "foreground_window" }
    hasTargetForeground = [bool]($RequestedProfiles -contains $detectedToolProfile)
    isVisible = [bool]$snapshot.foreground.isVisible
    isMinimized = [bool]$snapshot.foreground.isMinimized
    isCloaked = [bool]$snapshot.foreground.isCloaked
    isUsable = [bool]$snapshot.foreground.isUsable
    boundingRect = if ($snapshot.foreground.boundingRect) { $snapshot.foreground.boundingRect } else { (New-WindowRectObject -X 0 -Y 0 -Width 0 -Height 0) }
  }
}

$effectiveExpectedTitleHash = $ExpectedTitleHash
$effectiveExpectedToolProfile = $ExpectedToolProfile
$effectiveCandidateIndex = $CandidateIndex
if (
  $AllowForegroundWrite -and
  $AttachExistingWindow -and
  $AttachProfile -and
  $foreground.hasTargetForeground -and
  $detectedToolProfile -eq $AttachProfile
) {
  if (-not $effectiveExpectedTitleHash) { $effectiveExpectedTitleHash = $foreground.titleHash }
  if (-not $effectiveExpectedToolProfile) { $effectiveExpectedToolProfile = $detectedToolProfile }
}
if ($effectiveCandidateIndex -lt 0 -and $snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.bestCandidateIndex) {
  $effectiveCandidateIndex = [int]$snapshot.summary.bestCandidateIndex
}

$write = [pscustomobject]@{
  allowed = [bool]$AllowForegroundWrite
  attempted = $false
  pass = $false
  verified = $false
  strategy = ""
  clipboardFallbackAllowed = [bool]$AllowClipboardFallback
  clipboardFallbackTried = $false
  clipboardRestored = $false
  textPatternVerificationAllowed = [bool]$AllowTextPatternVerification
  textPatternVerificationTried = $false
  textPatternVerificationMatched = $false
  valuePatternVerificationTried = $false
  valuePatternVerificationMatched = $false
  nearbyTextVerificationTried = $false
  nearbyTextVerificationMatched = $false
  reason = "real_write_requires_allow_foreground_write"
  expectedTitleHashMatched = $false
  expectedToolProfileMatched = $false
  candidateIndex = $effectiveCandidateIndex
  exitCode = $null
  summary = [pscustomobject]@{
    safeCandidateCount = 0
    requestedTextLength = 0
    requestedTextHash = ""
    verifiedTextLength = 0
    verifiedTextHash = ""
    textPatternVerificationReadLength = 0
    textPatternVerificationTextHash = ""
    valuePatternVerificationReadLength = 0
    valuePatternVerificationTextHash = ""
    nearbyTextVerificationInspectedElementCount = 0
    nearbyTextVerificationReadableElementCount = 0
    nearbyTextVerificationReadLength = 0
    nearbyTextVerificationTextHash = ""
    nearbyTextVerificationSource = ""
    autoSubmit = $false
    submitSignalCount = 0
  }
}

$weakSignalClipboardFallbackAllowed = [bool]($AllowClipboardFallback -and (Test-SmartPromptWeakSignalClipboardFallback -ToolProfile $effectiveExpectedToolProfile))
$foregroundUsableForWrite = [bool](
  $foreground.isVisible -and
  (-not $foreground.isMinimized) -and
  (-not $foreground.isCloaked) -and
  $foreground.isUsable
)
$toolComposerCursorPlacementFailed = [bool](
  ($effectiveExpectedToolProfile -in @("workbuddy", "trae")) -and
  $AttachExistingWindow -and
  $attach -and
  $attach.cursorPlacement -and
  [bool]$attach.cursorPlacement.attempted -and
  -not [bool]$attach.cursorPlacement.ok
)

if ($AllowForegroundWrite -and (-not $effectiveExpectedTitleHash -or -not $effectiveExpectedToolProfile)) {
  $write.reason = "foreground_fill_requires_valid_snapshot_before_write"
} elseif ($AllowForegroundWrite -and -not $foregroundUsableForWrite) {
  $write.reason = "foreground_window_not_usable_for_real_write"
} elseif ($AllowForegroundWrite -and $effectiveCandidateIndex -lt 0 -and $toolComposerCursorPlacementFailed) {
  $write.reason = "foreground_fill_requires_manual_composer_focus"
} elseif ($AllowForegroundWrite -and $effectiveCandidateIndex -lt 0 -and -not $weakSignalClipboardFallbackAllowed) {
  $write.reason = "foreground_fill_requires_safe_candidate"
} elseif ($AllowForegroundWrite) {
  $fillArgs = @(
    "-JsonOnly",
    "-ConfirmForeground",
    "-ExpectedTitleHash", $effectiveExpectedTitleHash,
    "-ExpectedToolProfile", $effectiveExpectedToolProfile,
    "-CandidateIndex", ([string]$effectiveCandidateIndex),
    "-Text", $Text
  )
  if ($AllowClipboardFallback) {
    $fillArgs += "-AllowClipboardFallback"
  }
  if ($AllowTextPatternVerification) {
    $fillArgs += "-AllowTextPatternVerification"
  }
  $fillProbe = Invoke-JsonProbe -Path (Join-Path $ScriptDir "check-m3-desktop-fill.ps1") -Arguments $fillArgs
  $fill = $fillProbe.json
  if ($fillProbe.parseOk -and $fill) {
    $write = [pscustomobject]@{
      allowed = $true
      attempted = [bool]$fill.writeAttempted
      pass = [bool]$fill.pass
      verified = [bool]$fill.verified
      strategy = if ($fill.strategy) { $fill.strategy } else { "" }
      clipboardFallbackAllowed = [bool]$AllowClipboardFallback
      clipboardFallbackTried = [bool]$fill.clipboardFallbackTried
      clipboardRestored = [bool]$fill.clipboardRestored
      textPatternVerificationAllowed = [bool]$AllowTextPatternVerification
      textPatternVerificationTried = [bool]$fill.textPatternVerificationTried
      textPatternVerificationMatched = [bool]$fill.textPatternVerificationMatched
      valuePatternVerificationTried = [bool]$fill.valuePatternVerificationTried
      valuePatternVerificationMatched = [bool]$fill.valuePatternVerificationMatched
      nearbyTextVerificationTried = [bool]$fill.nearbyTextVerificationTried
      nearbyTextVerificationMatched = [bool]$fill.nearbyTextVerificationMatched
      reason = if ($fill.reason) { $fill.reason } else { "" }
      expectedTitleHashMatched = [bool]$fill.foreground.expectedTitleHashMatched
      expectedToolProfileMatched = [bool]$fill.foreground.expectedToolProfileMatched
      candidateIndex = $effectiveCandidateIndex
      exitCode = $fillProbe.exitCode
      summary = [pscustomobject]@{
        safeCandidateCount = if ($fill.summary -and $null -ne $fill.summary.safeCandidateCount) { [int]$fill.summary.safeCandidateCount } else { 0 }
        requestedTextLength = if ($fill.summary) { [int]$fill.summary.requestedTextLength } else { 0 }
        requestedTextHash = if ($fill.summary) { $fill.summary.requestedTextHash } else { "" }
        verifiedTextLength = if ($fill.summary) { [int]$fill.summary.verifiedTextLength } else { 0 }
        verifiedTextHash = if ($fill.summary) { $fill.summary.verifiedTextHash } else { "" }
        textPatternVerificationReadLength = if ($fill.summary -and $null -ne $fill.summary.textPatternVerificationReadLength) { [int]$fill.summary.textPatternVerificationReadLength } else { 0 }
        textPatternVerificationTextHash = if ($fill.summary) { $fill.summary.textPatternVerificationTextHash } else { "" }
        valuePatternVerificationReadLength = if ($fill.summary -and $null -ne $fill.summary.valuePatternVerificationReadLength) { [int]$fill.summary.valuePatternVerificationReadLength } else { 0 }
        valuePatternVerificationTextHash = if ($fill.summary) { $fill.summary.valuePatternVerificationTextHash } else { "" }
        nearbyTextVerificationInspectedElementCount = if ($fill.summary -and $null -ne $fill.summary.nearbyTextVerificationInspectedElementCount) { [int]$fill.summary.nearbyTextVerificationInspectedElementCount } else { 0 }
        nearbyTextVerificationReadableElementCount = if ($fill.summary -and $null -ne $fill.summary.nearbyTextVerificationReadableElementCount) { [int]$fill.summary.nearbyTextVerificationReadableElementCount } else { 0 }
        nearbyTextVerificationReadLength = if ($fill.summary -and $null -ne $fill.summary.nearbyTextVerificationReadLength) { [int]$fill.summary.nearbyTextVerificationReadLength } else { 0 }
        nearbyTextVerificationTextHash = if ($fill.summary) { $fill.summary.nearbyTextVerificationTextHash } else { "" }
        nearbyTextVerificationSource = if ($fill.summary) { $fill.summary.nearbyTextVerificationSource } else { "" }
        autoSubmit = if ($fill.summary) { [bool]$fill.summary.autoSubmit } else { $false }
        submitSignalCount = if ($fill.summary) { [int]$fill.summary.submitSignalCount } else { 0 }
      }
    }
  } else {
    $write = [pscustomobject]@{
      allowed = $true
      attempted = $false
      pass = $false
      verified = $false
      strategy = ""
      clipboardFallbackAllowed = [bool]$AllowClipboardFallback
      clipboardFallbackTried = $false
      clipboardRestored = $false
      textPatternVerificationAllowed = [bool]$AllowTextPatternVerification
      textPatternVerificationTried = $false
      textPatternVerificationMatched = $false
      valuePatternVerificationTried = $false
      valuePatternVerificationMatched = $false
      nearbyTextVerificationTried = $false
      nearbyTextVerificationMatched = $false
      reason = "foreground_fill_probe_json_parse_failed"
      expectedTitleHashMatched = $false
      expectedToolProfileMatched = $false
      candidateIndex = $effectiveCandidateIndex
      exitCode = $fillProbe.exitCode
      summary = [pscustomobject]@{
        safeCandidateCount = 0
        requestedTextLength = 0
        requestedTextHash = ""
        verifiedTextLength = 0
        verifiedTextHash = ""
        textPatternVerificationReadLength = 0
        textPatternVerificationTextHash = ""
        valuePatternVerificationReadLength = 0
        valuePatternVerificationTextHash = ""
        nearbyTextVerificationInspectedElementCount = 0
        nearbyTextVerificationReadableElementCount = 0
        nearbyTextVerificationReadLength = 0
        nearbyTextVerificationTextHash = ""
        nearbyTextVerificationSource = ""
        autoSubmit = $false
        submitSignalCount = 0
      }
    }
  }
}

$coverage = @()
foreach ($profile in $RequestedProfiles) {
  $writeValidated = [bool]($write.pass -and $write.verified -and $effectiveExpectedToolProfile -eq $profile)
  $coverage += New-CoverageRow -Profile $profile -DetectedProfile $detectedToolProfile -CandidateCount $candidateCount -WriteValidated $writeValidated
}

$privacyOk = [bool](
  $snapshot -and
  $snapshot.privacy -and
  $snapshot.privacy.titleRedacted -and
  $snapshot.privacy.elementNamesHashed -and
  $snapshot.privacy.elementValuesNotRead -and
  $snapshot.privacy.promptTextNotRead -and
  (-not $write.summary.autoSubmit) -and
  ([int]$write.summary.submitSignalCount -eq 0)
)

$validatedWrites = @($coverage | Where-Object { $_.realWindowWriteValidated }).Count
$realWriteOk = [bool](
  (-not $AllowForegroundWrite) -or
  ($RequestedProfiles.Count -gt 0 -and $validatedWrites -eq $RequestedProfiles.Count)
)
$completionImpact = "real_tool_write_still_pending"
if ($validatedWrites -gt 0 -and $validatedWrites -lt $RequestedProfiles.Count) {
  $completionImpact = "partial_real_tool_write_validated"
} elseif ($validatedWrites -eq $RequestedProfiles.Count -and $RequestedProfiles.Count -gt 0) {
  $completionImpact = "all_requested_real_tool_writes_validated"
} elseif (-not $foreground.hasTargetForeground) {
  $completionImpact = "target_tool_not_foreground"
}

$reportObject = [pscustomobject]@{
  schemaVersion = "m3-real-desktop-tools@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  platform = if ($env:OS -like "*Windows*") { "win32" } else { $PSVersionTable.Platform }
  pass = [bool]($snapshotOk -and $privacyOk -and $realWriteOk)
  requestedProfiles = $RequestedProfiles
  supportedToolProfiles = $SupportedProfiles
  attach = $attach
  foreground = $foreground
  snapshot = [pscustomobject]@{
    exitCode = $inputProbe.exitCode
    parseOk = [bool]$inputProbe.parseOk
    parseError = $inputProbe.parseError
    probeOk = [bool]$snapshotOk
    candidateCount = $candidateCount
    safeCandidateCount = $safeCandidateCount
    valuePatternCandidates = if ($snapshot.summary) { [int]$snapshot.summary.valuePatternCandidates } else { 0 }
    textPatternCandidates = if ($snapshot.summary) { [int]$snapshot.summary.textPatternCandidates } else { 0 }
    focusableCandidates = if ($snapshot.summary) { [int]$snapshot.summary.focusableCandidates } else { 0 }
    focusedCandidateCount = if ($snapshot.summary) { [int]$snapshot.summary.focusedCandidateCount } else { 0 }
    caretCandidateCount = if ($snapshot.summary) { [int]$snapshot.summary.caretCandidateCount } else { 0 }
    bestCandidateIndex = if ($snapshot.summary) { [int]$snapshot.summary.bestCandidateIndex } else { -1 }
    bestCandidateScore = if ($snapshot.summary) { [int]$snapshot.summary.bestCandidateScore } else { 0 }
    caretVisible = if ($snapshot.summary) { [bool]$snapshot.summary.caretVisible } else { $false }
    caretWindowPresent = if ($snapshot.summary) { [bool]$snapshot.summary.caretWindowPresent } else { $false }
    selectionSource = if ($snapshot.selection -and $snapshot.selection.source) { $snapshot.selection.source } else { "foreground_window" }
  }
  write = $write
  coverage = $coverage
  checks = [pscustomobject]@{
    snapshotOk = [bool]$snapshotOk
    supportedProfilesPresent = [bool]($SupportedProfiles.Count -ge 5)
    foregroundClassified = [bool]($detectedToolProfile.Length -gt 0)
    hasTargetForeground = [bool]$foreground.hasTargetForeground
    foregroundUsableForWrite = [bool]$foregroundUsableForWrite
    writeAttempted = [bool]$write.attempted
    writeValidated = [bool]$realWriteOk
    privacyRedacted = [bool]$privacyOk
    rawTitleStored = $false
    rawElementNamesStored = $false
    rawInputValuesStored = $false
    rawPromptTextStored = $false
    noAutoSubmit = [bool]((-not $write.summary.autoSubmit) -and ([int]$write.summary.submitSignalCount -eq 0))
  }
  privacy = [pscustomobject]@{
    titleRedacted = $true
    elementNamesHashed = $true
    elementValuesNotRead = $true
    caretTextNotRead = $true
    promptTextNotRead = $true
    writtenTextNotStored = $true
    clipboardTextNotStored = $true
    fallbackRequiresExplicitAllow = $true
    textPatternVerificationRequiresExplicitAllow = $true
    valuePatternVerificationRequiresExplicitAllow = $true
    nearbyTextVerificationRequiresExplicitAllow = $true
    verificationTextNotStored = $true
    verificationUsesLengthAndHash = $true
    autoSubmit = $false
  }
  completionImpact = $completionImpact
}

$json = $reportObject | ConvertTo-Json -Depth 10
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 real desktop tools report: $Report"
}
Write-Output $json

if (-not $reportObject.pass) {
  exit 1
}
