param(
  [string]$Report = "",
  [switch]$JsonOnly,
  [switch]$SelfTest,
  [ValidateSet("codex", "claude-code", "hermes")]
  [string]$SelfTestProfile = "codex"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-desktop-input.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
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

function Get-ToolProfile {
  param([string]$ProcessName, [string]$WindowTitle, [string[]]$ChildProcessNames = @())
  $haystack = "$ProcessName $WindowTitle " + (($ChildProcessNames | ForEach-Object { [string]$_ }) -join " ")
  if ($haystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($haystack -match "(?i)\bclaude\b") { return "claude-code" }
  if ($haystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($haystack -match "(?i)\bhermes\b") { return "hermes" }
  return "unknown"
}

function Get-ChildProcessNames {
  param([int]$ProcessId)
  $names = @()
  try {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      if ($child.Name) {
        $names += [System.IO.Path]::GetFileNameWithoutExtension([string]$child.Name)
      }
      $names += Get-ChildProcessNames -ProcessId ([int]$child.ProcessId)
    }
  } catch {}
  return @($names | Where-Object { $_ } | Select-Object -Unique)
}

function Get-SelfTestTitle {
  param([string]$Profile)
  switch ($Profile) {
    "claude-code" { return "Smart Prompt Claude Code UIA Self Test" }
    "hermes" { return "Smart Prompt Hermes UIA Self Test" }
    default { return "Smart Prompt Codex UIA Self Test" }
  }
}

function Get-WindowTextSafe {
  param([IntPtr]$Handle)
  $builder = New-Object System.Text.StringBuilder 512
  [void][Win32Native]::GetWindowText($Handle, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-RuntimeIdKey {
  param([System.Windows.Automation.AutomationElement]$Element)
  if (-not $Element) { return "" }
  try {
    return (($Element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join ".")
  } catch {
    return ""
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

function Get-CaretContext {
  $emptyRect = New-RectObject -X 0 -Y 0 -Width 0 -Height 0
  $result = [ordered]@{
    source = "win32_get_gui_thread_info"
    supported = $false
    visible = $false
    windowHandlePresent = $false
    rect = $emptyRect
    virtualCaretMayBeHidden = $true
  }
  try {
    $info = New-Object SmartPromptGuiThreadInfo
    $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][SmartPromptGuiThreadInfo])
    $ok = [Win32Native]::GetGUIThreadInfo(0, [ref]$info)
    $result.supported = [bool]$ok
    if (-not $ok) { return [pscustomobject]$result }

    $hwndCaret = [IntPtr]$info.hwndCaret
    $result.windowHandlePresent = [bool]($hwndCaret -ne [IntPtr]::Zero)
    $result.visible = [bool](($info.flags -band 1) -ne 0 -or $result.windowHandlePresent)
    if ($hwndCaret -ne [IntPtr]::Zero) {
      $topLeft = New-Object SmartPromptPoint
      $bottomRight = New-Object SmartPromptPoint
      $topLeft.X = [int]$info.rcCaret.Left
      $topLeft.Y = [int]$info.rcCaret.Top
      $bottomRight.X = [int]$info.rcCaret.Right
      $bottomRight.Y = [int]$info.rcCaret.Bottom
      [void][Win32Native]::ClientToScreen($hwndCaret, [ref]$topLeft)
      [void][Win32Native]::ClientToScreen($hwndCaret, [ref]$bottomRight)
      $result.rect = New-RectObject -X $topLeft.X -Y $topLeft.Y -Width ([Math]::Max(1, $bottomRight.X - $topLeft.X)) -Height ([Math]::Max(1, $bottomRight.Y - $topLeft.Y))
    }
  } catch {
    $result.supported = $false
    $result.visible = $false
  }
  return [pscustomobject]$result
}

function Get-InputSignals {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [object]$Rect,
    [object]$RootRect,
    [string]$FocusedRuntimeId,
    [object]$Caret,
    [string]$ControlType,
    [string]$ClassName,
    [bool]$HasValuePattern,
    [bool]$HasTextPattern,
    [IntPtr]$NativeWindowHandle
  )

  $runtimeId = Get-RuntimeIdKey $Element
  $hasKeyboardFocus = $false
  try { $hasKeyboardFocus = [bool]$Element.Current.HasKeyboardFocus } catch { $hasKeyboardFocus = $false }
  $focusedElementMatch = [bool]($runtimeId -and $FocusedRuntimeId -and $runtimeId -eq $FocusedRuntimeId)
  $caretWithinBounds = [bool]($Caret -and $Caret.rect -and (Test-RectIntersects -A $Rect -B $Caret.rect))
  $caretWindowMatch = [bool]($Caret -and $Caret.windowHandlePresent -and $NativeWindowHandle -ne [IntPtr]::Zero -and $Caret.rect.width -gt 0 -and $caretWithinBounds)
  $nearWindowBottom = $false
  if ($RootRect -and [int]$RootRect.height -gt 0) {
    $rootBottom = [int]$RootRect.y + [int]$RootRect.height
    $candidateBottom = [int]$Rect.y + [int]$Rect.height
    $nearWindowBottom = [bool]($candidateBottom -ge ($rootBottom - 360))
  }
  $broadDocument = [bool]($ControlType -eq "ControlType.Document" -and ([int]$Rect.width -gt 900 -or [int]$Rect.height -gt 500))
  $score = 0
  if ($ControlType -eq "ControlType.Edit") { $score += 45 }
  if ($HasValuePattern) { $score += 35 }
  if ($hasKeyboardFocus) { $score += 35 }
  if ($focusedElementMatch) { $score += 35 }
  if ($caretWithinBounds) { $score += 45 }
  if ($caretWindowMatch) { $score += 20 }
  if ($Element.Current.IsKeyboardFocusable) { $score += 15 }
  if ($HasTextPattern) { $score += 10 }
  if ($ClassName -match "(?i)edit|text") { $score += 10 }
  if ($nearWindowBottom) { $score += 5 }
  if ($broadDocument) { $score -= 40 }

  return [pscustomobject]@{
    score = [int]$score
    hasKeyboardFocus = [bool]$hasKeyboardFocus
    focusedElementMatch = [bool]$focusedElementMatch
    caretWithinBounds = [bool]$caretWithinBounds
    caretWindowMatch = [bool]$caretWindowMatch
    nearWindowBottom = [bool]$nearWindowBottom
    broadDocument = [bool]$broadDocument
  }
}

function Get-UiaSnapshot {
  param([IntPtr]$Handle, [bool]$IsSelfTest, [string]$ExpectedToolProfile = "")

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  $title = Get-WindowTextSafe -Handle $Handle
  $processId = 0
  [void][Win32Native]::GetWindowThreadProcessId($Handle, [ref]$processId)
  $processName = ""
  if ($processId -gt 0) {
    try {
      $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    } catch {
      $processName = ""
    }
  }
  $childProcessNames = if ($processId -gt 0) { @(Get-ChildProcessNames -ProcessId $processId) } else { @() }

  $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
  $elements = @()
  $caret = Get-CaretContext
  $focusedRuntimeId = ""
  try {
    $focusedRuntimeId = Get-RuntimeIdKey ([System.Windows.Automation.AutomationElement]::FocusedElement)
  } catch {
    $focusedRuntimeId = ""
  }
  if ($rootElement) {
    $rootBounds = $rootElement.Current.BoundingRectangle
    $rootRect = New-RectObject -X $rootBounds.X -Y $rootBounds.Y -Width $rootBounds.Width -Height $rootBounds.Height
    $toInspect = New-Object System.Collections.ArrayList
    [void]$toInspect.Add($rootElement)
    $all = $rootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($element in $all) {
      [void]$toInspect.Add($element)
    }
    $index = 0
    foreach ($element in $toInspect) {
      if ($index -ge 300) { break }
      $index += 1
      $controlType = $element.Current.ControlType.ProgrammaticName
      $className = $element.Current.ClassName
      $valuePattern = $null
      $textPattern = $null
      $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
      $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)
      $isTextInput = $controlType -in @("ControlType.Edit", "ControlType.Document") -or $hasValue -or $hasText -or $className -match "(?i)edit|text"
      if (-not $isTextInput) { continue }
      $rect = $element.Current.BoundingRectangle
      $rectObject = New-RectObject -X $rect.X -Y $rect.Y -Width $rect.Width -Height $rect.Height
      $nativeHandle = [IntPtr]$element.Current.NativeWindowHandle
      $signals = Get-InputSignals -Element $element -Rect $rectObject -RootRect $rootRect -FocusedRuntimeId $focusedRuntimeId -Caret $caret -ControlType $controlType -ClassName $className -HasValuePattern ([bool]$hasValue) -HasTextPattern ([bool]$hasText) -NativeWindowHandle $nativeHandle
      $elements += [pscustomobject]@{
        index = $elements.Count
        controlType = $controlType
        nameHash = ""
        automationIdHash = Get-HashText $element.Current.AutomationId
        classNameHash = Get-HashText $className
        isKeyboardFocusable = [bool]$element.Current.IsKeyboardFocusable
        isEnabled = [bool]$element.Current.IsEnabled
        hasValuePattern = [bool]$hasValue
        hasTextPattern = [bool]$hasText
        boundingRect = $rectObject
        inputSignals = $signals
      }
    }
  }

  $toolProfile = Get-ToolProfile -ProcessName $processName -WindowTitle $title -ChildProcessNames $childProcessNames
  $candidateCount = $elements.Count
  $toolProfileMatched = -not $ExpectedToolProfile -or $toolProfile -eq $ExpectedToolProfile
  $bestCandidate = @($elements | Sort-Object @{ Expression = { [int]$_.inputSignals.score }; Descending = $true }, @{ Expression = { [int]$_.index }; Ascending = $true } | Select-Object -First 1)
  return [pscustomobject]@{
    schemaVersion = "m3-windows-uia@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = "win32"
    selfTest = $IsSelfTest
    selfTestProfile = if ($IsSelfTest) { $ExpectedToolProfile } else { "" }
    probeOk = [bool]$rootElement
    pass = [bool]($rootElement -and (-not $IsSelfTest -or ($candidateCount -gt 0 -and $toolProfileMatched)))
    foreground = [pscustomobject]@{
      processName = $processName
      pidPresent = $processId -gt 0
      titleLength = $title.Length
      titleHash = Get-HashText $title
      detectedToolProfile = $toolProfile
      expectedToolProfile = $ExpectedToolProfile
      expectedToolProfileMatched = [bool]$toolProfileMatched
      childProcessCount = $childProcessNames.Count
      childToolProcessHintPresent = [bool](($childProcessNames -join " ") -match "(?i)\bcodex\b|\bclaude\b|\bhermes\b")
    }
    caret = $caret
    supportedToolProfiles = @("codex", "claude-code", "hermes")
    candidates = $elements
    summary = [pscustomobject]@{
      candidateCount = $candidateCount
      valuePatternCandidates = @($elements | Where-Object { $_.hasValuePattern }).Count
      textPatternCandidates = @($elements | Where-Object { $_.hasTextPattern }).Count
      focusableCandidates = @($elements | Where-Object { $_.isKeyboardFocusable }).Count
      focusedCandidateCount = @($elements | Where-Object { $_.inputSignals.hasKeyboardFocus -or $_.inputSignals.focusedElementMatch }).Count
      caretCandidateCount = @($elements | Where-Object { $_.inputSignals.caretWithinBounds -or $_.inputSignals.caretWindowMatch }).Count
      bestCandidateIndex = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].index } else { -1 }
      bestCandidateScore = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].inputSignals.score } else { 0 }
      caretVisible = [bool]$caret.visible
      caretWindowPresent = [bool]$caret.windowHandlePresent
      detectedToolProfile = $toolProfile
    }
    privacy = [pscustomobject]@{
      titleRedacted = $true
      elementNamesHashed = $true
      elementValuesNotRead = $true
      caretTextNotRead = $true
      promptTextNotRead = $true
    }
  }
}

if ($env:OS -notlike "*Windows*") {
  $reportObject = [pscustomobject]@{
    schemaVersion = "m3-windows-uia@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = $PSVersionTable.Platform
    selfTest = [bool]$SelfTest
    probeOk = $false
    pass = $false
    reason = "windows_uia_only"
    supportedToolProfiles = @("codex", "claude-code", "hermes")
    candidates = @()
    privacy = [pscustomobject]@{
      titleRedacted = $true
      elementNamesHashed = $true
      elementValuesNotRead = $true
      caretTextNotRead = $true
      promptTextNotRead = $true
    }
  }
} else {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public struct SmartPromptRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public struct SmartPromptPoint {
  public int X;
  public int Y;
}
public struct SmartPromptGuiThreadInfo {
  public int cbSize;
  public int flags;
  public IntPtr hwndActive;
  public IntPtr hwndFocus;
  public IntPtr hwndCapture;
  public IntPtr hwndMenuOwner;
  public IntPtr hwndMoveSize;
  public IntPtr hwndCaret;
  public SmartPromptRect rcCaret;
}
public static class Win32Native {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool GetGUIThreadInfo(uint idThread, ref SmartPromptGuiThreadInfo pgui);
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref SmartPromptPoint lpPoint);
}
"@

  $form = $null
  try {
    if ($SelfTest) {
      Add-Type -AssemblyName System.Windows.Forms
      $form = New-Object System.Windows.Forms.Form
      $form.Text = Get-SelfTestTitle -Profile $SelfTestProfile
      $form.Width = 520
      $form.Height = 160
      $textbox = New-Object System.Windows.Forms.TextBox
      $textbox.Multiline = $true
      $textbox.Left = 16
      $textbox.Top = 16
      $textbox.Width = 470
      $textbox.Height = 72
      $textbox.Text = "M3 UIA self test input"
      $form.Controls.Add($textbox)
      $form.Show()
      [void][System.Windows.Forms.Application]::DoEvents()
      [void]$form.Activate()
      [void]$textbox.Focus()
      Start-Sleep -Milliseconds 250
      [void][System.Windows.Forms.Application]::DoEvents()
      $handle = $form.Handle
      $reportObject = Get-UiaSnapshot -Handle $handle -IsSelfTest $true -ExpectedToolProfile $SelfTestProfile
    } else {
      $handle = [Win32Native]::GetForegroundWindow()
      $reportObject = Get-UiaSnapshot -Handle $handle -IsSelfTest $false
    }
  } finally {
    if ($form) {
      $form.Close()
      $form.Dispose()
    }
  }
}

$json = $reportObject | ConvertTo-Json -Depth 8
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 desktop input report: $Report"
}
Write-Output $json

if (-not $reportObject.pass) {
  exit 1
}
