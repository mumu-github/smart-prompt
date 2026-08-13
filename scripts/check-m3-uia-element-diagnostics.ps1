[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Report = "research/m3-uia-element-diagnostics.latest.json",
  [switch]$JsonOnly,
  [int]$MaxElements = 200,
  [int]$TimeoutMs = 3500
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
. (Join-Path $ScriptDir "desktop-tool-profile-config.ps1")

if (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

function Get-HashText {
  param([string]$Text)
  if (-not $Text) { return "" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash) -replace "-", "").Substring(0, 16).ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function New-RectObject {
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

function Test-RectIntersects {
  param([object]$A, [object]$B)
  if (-not $A -or -not $B) { return $false }
  if ([int]$A.width -le 0 -or [int]$A.height -le 0 -or [int]$B.width -le 0 -or [int]$B.height -le 0) { return $false }
  $aRight = [int]$A.x + [int]$A.width
  $aBottom = [int]$A.y + [int]$A.height
  $bRight = [int]$B.x + [int]$B.width
  $bBottom = [int]$B.y + [int]$B.height
  return [bool](([int]$A.x -lt $bRight) -and ($aRight -gt [int]$B.x) -and ([int]$A.y -lt $bBottom) -and ($aBottom -gt [int]$B.y))
}

function Get-ToolProfile {
  param([string]$ProcessName, [string]$WindowTitle)
  $haystack = "$ProcessName $WindowTitle"
  if ($haystack -match "(?i)claude[\s-]*code|\bclaude\b") { return "claude-code" }
  if ($haystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($haystack -match "(?i)\bhermes\b") { return "hermes" }
  if ($haystack -match "(?i)\bwork[\s-]*buddy\b|\bworkbuddy\b") { return "workbuddy" }
  if ($haystack -match "(?i)\btrae\b") { return "trae" }
  return "unknown"
}

function Get-BoundedUiaElements {
  param(
    [System.Windows.Automation.AutomationElement]$RootElement,
    [int]$MaxCount,
    [int]$MaxMilliseconds
  )
  $items = New-Object System.Collections.ArrayList
  if (-not $RootElement) { return @($items) }
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue([pscustomobject]@{ element = $RootElement; depth = 0 })
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  while ($queue.Count -gt 0 -and $items.Count -lt $MaxCount -and $timer.ElapsedMilliseconds -lt $MaxMilliseconds) {
    $entry = $queue.Dequeue()
    [void]$items.Add($entry)
    try {
      $child = $walker.GetFirstChild($entry.element)
      while ($child -and ($items.Count + $queue.Count) -lt $MaxCount -and $timer.ElapsedMilliseconds -lt $MaxMilliseconds) {
        $queue.Enqueue([pscustomobject]@{ element = $child; depth = ([int]$entry.depth + 1) })
        try {
          $child = $walker.GetNextSibling($child)
        } catch {
          $child = $null
        }
      }
    } catch {
      # Some WebView subtrees are inaccessible; keep diagnostics best effort and metadata-only.
    }
  }
  $script:SmartPromptUiaDiagnosticsTimedOut = [bool]($timer.ElapsedMilliseconds -ge $MaxMilliseconds)
  return @($items)
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ([System.Management.Automation.PSTypeName]"SmartPromptUiaDiagnosticsNative").Type) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public struct SmartPromptUiaDiagnosticsRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public struct SmartPromptUiaDiagnosticsPoint {
  public int X;
  public int Y;
}
public static class SmartPromptUiaDiagnosticsNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out SmartPromptUiaDiagnosticsPoint lpPoint);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out SmartPromptUiaDiagnosticsRect lpRect);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
}
"@
}

$handle = [SmartPromptUiaDiagnosticsNative]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][SmartPromptUiaDiagnosticsNative]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
$title = $titleBuilder.ToString()
$processId = 0
[void][SmartPromptUiaDiagnosticsNative]::GetWindowThreadProcessId($handle, [ref]$processId)
$processName = ""
if ($processId -gt 0) {
  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { $processName = "" }
}
$rect = New-Object SmartPromptUiaDiagnosticsRect
$hasWindowRect = [SmartPromptUiaDiagnosticsNative]::GetWindowRect($handle, [ref]$rect)
$windowRect = if ($hasWindowRect) {
  New-RectObject -X $rect.Left -Y $rect.Top -Width ([int]$rect.Right - [int]$rect.Left) -Height ([int]$rect.Bottom - [int]$rect.Top)
} else {
  New-RectObject -X 0 -Y 0 -Width 0 -Height 0
}
$cloaked = 0
$dwmResult = [SmartPromptUiaDiagnosticsNative]::DwmGetWindowAttribute($handle, 14, [ref]$cloaked, 4)
$cursorPoint = New-Object SmartPromptUiaDiagnosticsPoint
$cursorOk = [SmartPromptUiaDiagnosticsNative]::GetCursorPos([ref]$cursorPoint)
$cursorRect = if ($cursorOk) { New-RectObject -X $cursorPoint.X -Y $cursorPoint.Y -Width 1 -Height 1 } else { New-RectObject -X 0 -Y 0 -Width 0 -Height 0 }

$rootElement = $null
try {
  $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
} catch {
  $rootElement = $null
}
$rootRect = $windowRect
if ($rootElement) {
  try {
    $rootBounds = $rootElement.Current.BoundingRectangle
    $rootRect = New-RectObject -X $rootBounds.X -Y $rootBounds.Y -Width $rootBounds.Width -Height $rootBounds.Height
  } catch {
    $rootRect = $windowRect
  }
}

$focusedRuntimeId = ""
try {
  $focusedRuntimeId = (([System.Windows.Automation.AutomationElement]::FocusedElement.GetRuntimeId() | ForEach-Object { [string]$_ }) -join ".")
} catch {
  $focusedRuntimeId = ""
}

$script:SmartPromptUiaDiagnosticsTimedOut = $false
$entries = @(Get-BoundedUiaElements -RootElement $rootElement -MaxCount ([Math]::Max(1, $MaxElements)) -MaxMilliseconds ([Math]::Max(500, $TimeoutMs)))
$elements = @()
$controlTypeCounts = [ordered]@{}
$nearBottomCount = 0
$composerGeometryCount = 0
$strongSignalCount = 0
foreach ($entry in $entries) {
  $element = $entry.element
  $controlType = ""
  $className = ""
  $automationId = ""
  $name = ""
  $isEnabled = $false
  $isKeyboardFocusable = $false
  $hasKeyboardFocus = $false
  $hasValuePattern = $false
  $hasTextPattern = $false
  $rectObject = New-RectObject -X 0 -Y 0 -Width 0 -Height 0
  $runtimeId = ""
  try { $controlType = [string]$element.Current.ControlType.ProgrammaticName } catch { $controlType = "" }
  try { $className = [string]$element.Current.ClassName } catch { $className = "" }
  try { $automationId = [string]$element.Current.AutomationId } catch { $automationId = "" }
  try { $name = [string]$element.Current.Name } catch { $name = "" }
  try { $isEnabled = [bool]$element.Current.IsEnabled } catch { $isEnabled = $false }
  try { $isKeyboardFocusable = [bool]$element.Current.IsKeyboardFocusable } catch { $isKeyboardFocusable = $false }
  try { $hasKeyboardFocus = [bool]$element.Current.HasKeyboardFocus } catch { $hasKeyboardFocus = $false }
  try { $hasValuePattern = [bool]$element.GetSupportedPatterns().Id.Contains([System.Windows.Automation.ValuePattern]::Pattern.Id) } catch { $hasValuePattern = $false }
  try { $hasTextPattern = [bool]$element.GetSupportedPatterns().Id.Contains([System.Windows.Automation.TextPattern]::Pattern.Id) } catch { $hasTextPattern = $false }
  try {
    $bounds = $element.Current.BoundingRectangle
    $rectObject = New-RectObject -X $bounds.X -Y $bounds.Y -Width $bounds.Width -Height $bounds.Height
  } catch {
    $rectObject = New-RectObject -X 0 -Y 0 -Width 0 -Height 0
  }
  try {
    $runtimeId = (($element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join ".")
  } catch {
    $runtimeId = ""
  }

  if (-not $controlTypeCounts.Contains($controlType)) { $controlTypeCounts[$controlType] = 0 }
  $controlTypeCounts[$controlType] = [int]$controlTypeCounts[$controlType] + 1

  $rootBottom = [int]$rootRect.y + [int]$rootRect.height
  $candidateBottom = [int]$rectObject.y + [int]$rectObject.height
  $nearWindowBottom = [bool]($rootRect.height -gt 0 -and $candidateBottom -ge ($rootBottom - 360))
  $cursorWithinBounds = [bool](Test-RectIntersects -A $rectObject -B $cursorRect)
  $focusedElementMatch = [bool]($runtimeId -and $focusedRuntimeId -and $runtimeId -eq $focusedRuntimeId)
  $broadDocument = [bool]($controlType -eq "ControlType.Document" -and ([int]$rectObject.width -gt 900 -or [int]$rectObject.height -gt 500))
  $composerGeometry = [bool](
    $nearWindowBottom -and
    [int]$rectObject.width -ge 140 -and
    [int]$rectObject.height -ge 28 -and
    [int]$rectObject.height -le 280 -and
    -not $broadDocument
  )
  $strongSignal = [bool]($hasKeyboardFocus -or $focusedElementMatch -or $cursorWithinBounds)
  if ($nearWindowBottom) { $nearBottomCount += 1 }
  if ($composerGeometry) { $composerGeometryCount += 1 }
  if ($strongSignal) { $strongSignalCount += 1 }

  $elements += [pscustomobject]@{
    index = [int]$elements.Count
    depth = [int]$entry.depth
    controlType = $controlType
    isEnabled = [bool]$isEnabled
    isKeyboardFocusable = [bool]$isKeyboardFocusable
    hasKeyboardFocus = [bool]$hasKeyboardFocus
    focusedElementMatch = [bool]$focusedElementMatch
    hasValuePattern = [bool]$hasValuePattern
    hasTextPattern = [bool]$hasTextPattern
    cursorWithinBounds = [bool]$cursorWithinBounds
    nearWindowBottom = [bool]$nearWindowBottom
    broadDocument = [bool]$broadDocument
    composerGeometry = [bool]$composerGeometry
    boundingRect = $rectObject
    hashes = [pscustomobject]@{
      nameHash = Get-HashText $name
      automationIdHash = Get-HashText $automationId
      classNameHash = Get-HashText $className
      runtimeIdHash = Get-HashText $runtimeId
    }
  }
}

$topElements = @(
  $elements |
    Sort-Object `
      @{ Expression = { if ($_.composerGeometry) { 0 } else { 1 } } }, `
      @{ Expression = { if ($_.cursorWithinBounds -or $_.hasKeyboardFocus -or $_.focusedElementMatch) { 0 } else { 1 } } }, `
      @{ Expression = { if ($_.nearWindowBottom) { 0 } else { 1 } } }, `
      @{ Expression = { [int]$_.boundingRect.y }; Descending = $true } |
    Select-Object -First ([Math]::Min(40, [Math]::Max(1, $MaxElements)))
)

$reportObject = [pscustomobject]@{
  schemaVersion = "m3-uia-element-diagnostics@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  platform = "win32"
  pass = [bool]($rootElement -ne $null)
  foreground = [pscustomobject]@{
    processName = $processName
    pidPresent = [bool]($processId -gt 0)
    titleLength = $title.Length
    titleHash = Get-HashText $title
    detectedToolProfile = Get-ToolProfile -ProcessName $processName -WindowTitle $title
    isVisible = [bool][SmartPromptUiaDiagnosticsNative]::IsWindowVisible($handle)
    isMinimized = [bool][SmartPromptUiaDiagnosticsNative]::IsIconic($handle)
    isCloaked = [bool]($dwmResult -eq 0 -and $cloaked -ne 0)
    boundingRect = $windowRect
  }
  summary = [pscustomobject]@{
    rootAvailable = [bool]($rootElement -ne $null)
    inspectedElementCount = [int]$elements.Count
    traversalTimedOut = [bool]$script:SmartPromptUiaDiagnosticsTimedOut
    controlTypeCounts = $controlTypeCounts
    nearBottomCount = [int]$nearBottomCount
    composerGeometryCount = [int]$composerGeometryCount
    strongSignalCount = [int]$strongSignalCount
    cursorSupported = [bool]$cursorOk
  }
  elements = $topElements
  privacy = [pscustomobject]@{
    titleRedacted = $true
    elementNamesHashed = $true
    elementValuesNotRead = $true
    promptTextNotRead = $true
    rawTextNotStored = $true
    geometryAndBooleansOnly = $true
  }
}

$json = $reportObject | ConvertTo-Json -Depth 12
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 UIA element diagnostics report: $Report"
}
Write-Output $json

if (-not $reportObject.pass) {
  exit 1
}
