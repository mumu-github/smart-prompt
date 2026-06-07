param(
  [string]$Report = "",
  [switch]$JsonOnly,
  [switch]$SelfTest,
  [switch]$ConfirmForeground,
  [string]$ExpectedTitleHash = "",
  [string]$ExpectedToolProfile = "",
  [int]$CandidateIndex = 0,
  [string]$Text = "Smart Prompt M3 desktop fill self-test"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-desktop-fill.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
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

function New-Privacy {
  return [pscustomobject]@{
    titleRedacted = $true
    elementNamesHashed = $true
    elementValuesNotReadBeforeWrite = $true
    writtenTextNotStored = $true
    verificationUsesLengthAndHash = $true
    promptTextNotRead = $true
    autoSubmit = $false
  }
}

function New-UnsupportedReport {
  param([string]$Reason)
  return [pscustomobject]@{
    schemaVersion = "m3-windows-fill@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = if ($env:OS -like "*Windows*") { "win32" } else { $PSVersionTable.Platform }
    selfTest = [bool]$SelfTest
    confirmForeground = [bool]$ConfirmForeground
    pass = $false
    reason = $Reason
    writeAttempted = $false
    verified = $false
    supportedToolProfiles = @("codex", "claude-code", "hermes")
    privacy = New-Privacy
  }
}

function Get-ToolProfile {
  param([string]$ProcessName, [string]$WindowTitle)
  $haystack = "$ProcessName $WindowTitle"
  if ($haystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($haystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($haystack -match "(?i)\bhermes\b") { return "hermes" }
  return "unknown"
}

function Ensure-FillTypes {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if (-not ([System.Management.Automation.PSTypeName]"SmartPromptFillNative").Type) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmartPromptFillNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool SetWindowText(IntPtr hWnd, string lpString);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
  }
}

function Get-WindowTextSafe {
  param([IntPtr]$Handle)
  $builder = New-Object System.Text.StringBuilder 512
  [void][SmartPromptFillNative]::GetWindowText($Handle, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-ForegroundContext {
  $handle = [SmartPromptFillNative]::GetForegroundWindow()
  $title = Get-WindowTextSafe -Handle $handle
  $processId = 0
  [void][SmartPromptFillNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  $processName = ""
  if ($processId -gt 0) {
    try {
      $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    } catch {
      $processName = ""
    }
  }
  return [pscustomobject]@{
    handle = $handle
    title = $title
    processName = $processName
    processIdPresent = $processId -gt 0
    titleHash = Get-HashText $title
    titleLength = $title.Length
    detectedToolProfile = Get-ToolProfile -ProcessName $processName -WindowTitle $title
  }
}

function Get-InputCandidates {
  param([System.Windows.Automation.AutomationElement]$RootElement)

  $items = @()
  if (-not $RootElement) { return $items }
  $toInspect = New-Object System.Collections.ArrayList
  [void]$toInspect.Add($RootElement)
  $all = $RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $all) {
    [void]$toInspect.Add($element)
  }
  $inspected = 0
  foreach ($element in $toInspect) {
    if ($inspected -ge 400) { break }
    $inspected += 1
    $controlType = $element.Current.ControlType.ProgrammaticName
    $className = $element.Current.ClassName
    $valuePattern = $null
    $textPattern = $null
    $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
    $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)
    $nativeHandle = [IntPtr]$element.Current.NativeWindowHandle
    $isTextInput = $controlType -in @("ControlType.Edit", "ControlType.Document") -or $hasValue -or $hasText -or $className -match "(?i)edit|text"
    if (-not $isTextInput) { continue }
    $rect = $element.Current.BoundingRectangle
    $items += [pscustomobject]@{
      element = $element
      valuePattern = $valuePattern
      index = $items.Count
      controlType = $controlType
      className = $className
      classNameHash = Get-HashText $className
      isEnabled = [bool]$element.Current.IsEnabled
      isKeyboardFocusable = [bool]$element.Current.IsKeyboardFocusable
      hasValuePattern = [bool]$hasValue
      hasTextPattern = [bool]$hasText
      hasNativeWindowHandle = $nativeHandle -ne [IntPtr]::Zero
      nativeWindowHandle = $nativeHandle
      boundingRect = [pscustomobject]@{
        x = [int]$rect.X
        y = [int]$rect.Y
        width = [int]$rect.Width
        height = [int]$rect.Height
      }
    }
  }
  return $items
}

function Invoke-SelfTestFill {
  Ensure-FillTypes
  Add-Type -AssemblyName System.Windows.Forms

  $form = $null
  try {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Smart Prompt Codex Fill Self Test"
    $form.Width = 560
    $form.Height = 180
    $textbox = New-Object System.Windows.Forms.TextBox
    $textbox.Multiline = $true
    $textbox.Left = 16
    $textbox.Top = 16
    $textbox.Width = 500
    $textbox.Height = 86
    $textbox.Text = ""
    $form.Controls.Add($textbox)
    $form.Show()
    [void][System.Windows.Forms.Application]::DoEvents()
    [void]$form.Activate()
    [void]$textbox.Focus()
    Start-Sleep -Milliseconds 250
    [void][System.Windows.Forms.Application]::DoEvents()

    $element = [System.Windows.Automation.AutomationElement]::FromHandle($textbox.Handle)
    $controlType = if ($element) { $element.Current.ControlType.ProgrammaticName } else { "" }
    $className = if ($element) { $element.Current.ClassName } else { "" }
    $valuePattern = $null
    $hasValuePattern = $false
    if ($element) {
      $hasValuePattern = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
    }

    $strategy = ""
    $uiaSetValueTried = $false
    if ($hasValuePattern -and $valuePattern) {
      try {
        $uiaSetValueTried = $true
        $valuePattern.SetValue($Text)
        [void][System.Windows.Forms.Application]::DoEvents()
        if ($textbox.Text -eq $Text) {
          $strategy = "uia_value_pattern"
        }
      } catch {
        $strategy = ""
      }
    }

    if (-not $strategy) {
      [void][SmartPromptFillNative]::SetWindowText($textbox.Handle, $Text)
      [void][System.Windows.Forms.Application]::DoEvents()
      $strategy = "win32_set_window_text_fallback"
    }

    $builder = New-Object System.Text.StringBuilder 1024
    [void][SmartPromptFillNative]::GetWindowText($textbox.Handle, $builder, $builder.Capacity)
    $verifiedText = $builder.ToString()
    $verified = $verifiedText -eq $Text

    return [pscustomobject]@{
      schemaVersion = "m3-windows-fill@1"
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
      platform = "win32"
      selfTest = $true
      confirmForeground = $false
      pass = [bool]$verified
      writeAttempted = $true
      verified = [bool]$verified
      strategy = $strategy
      uiaSetValueTried = [bool]$uiaSetValueTried
      target = [pscustomobject]@{
        index = 0
        controlType = $controlType
        classNameHash = Get-HashText $className
        hasValuePattern = [bool]$hasValuePattern
        hasNativeWindowHandle = $true
        titleLength = $form.Text.Length
        titleHash = Get-HashText $form.Text
      }
      summary = [pscustomobject]@{
        requestedTextLength = $Text.Length
        requestedTextHash = Get-HashText $Text
        verifiedTextLength = $verifiedText.Length
        verifiedTextHash = Get-HashText $verifiedText
        autoSubmit = $false
        submitSignalCount = 0
      }
      supportedToolProfiles = @("codex", "claude-code", "hermes")
      privacy = New-Privacy
    }
  } finally {
    if ($form) {
      $form.Close()
      $form.Dispose()
    }
  }
}

function Invoke-ConfirmedForegroundFill {
  Ensure-FillTypes
  $context = Get-ForegroundContext
  $foreground = [pscustomobject]@{
    processName = $context.processName
    pidPresent = [bool]$context.processIdPresent
    titleLength = $context.titleLength
    titleHash = $context.titleHash
    detectedToolProfile = $context.detectedToolProfile
    expectedTitleHashMatched = $false
    expectedToolProfileMatched = $false
  }
  $base = [ordered]@{
    schemaVersion = "m3-windows-fill@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = "win32"
    selfTest = $false
    confirmForeground = [bool]$ConfirmForeground
    pass = $false
    writeAttempted = $false
    verified = $false
    strategy = ""
    uiaSetValueTried = $false
    foreground = $foreground
    supportedToolProfiles = @("codex", "claude-code", "hermes")
    privacy = New-Privacy
  }

  if (-not $ConfirmForeground) {
    $base.reason = "foreground_fill_requires_confirm_foreground"
    return [pscustomobject]$base
  }
  if (-not $ExpectedTitleHash -or -not $ExpectedToolProfile) {
    $base.reason = "foreground_fill_requires_expected_title_hash_and_tool_profile"
    return [pscustomobject]$base
  }
  $foreground.expectedTitleHashMatched = $context.titleHash -eq $ExpectedTitleHash
  $foreground.expectedToolProfileMatched = $context.detectedToolProfile -eq $ExpectedToolProfile
  if (-not $foreground.expectedTitleHashMatched) {
    $base.reason = "foreground_title_hash_mismatch"
    return [pscustomobject]$base
  }
  if (-not $foreground.expectedToolProfileMatched) {
    $base.reason = "foreground_tool_profile_mismatch"
    return [pscustomobject]$base
  }
  if (-not (@("codex", "claude-code", "hermes") -contains $ExpectedToolProfile)) {
    $base.reason = "foreground_tool_profile_not_supported"
    return [pscustomobject]$base
  }

  $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($context.handle)
  $candidates = @(Get-InputCandidates -RootElement $rootElement | Where-Object { $_.isEnabled })
  $base.summary = [pscustomobject]@{
    candidateCount = $candidates.Count
    requestedTextLength = $Text.Length
    requestedTextHash = Get-HashText $Text
    verifiedTextLength = 0
    verifiedTextHash = ""
    autoSubmit = $false
    submitSignalCount = 0
  }
  if ($candidates.Count -eq 0) {
    $base.reason = "foreground_no_input_candidates"
    return [pscustomobject]$base
  }
  if ($CandidateIndex -lt 0 -or $CandidateIndex -ge $candidates.Count) {
    $base.reason = "foreground_candidate_index_out_of_range"
    return [pscustomobject]$base
  }

  $candidate = $candidates[$CandidateIndex]
  $base.target = [pscustomobject]@{
    index = $candidate.index
    controlType = $candidate.controlType
    classNameHash = $candidate.classNameHash
    hasValuePattern = [bool]$candidate.hasValuePattern
    hasTextPattern = [bool]$candidate.hasTextPattern
    hasNativeWindowHandle = [bool]$candidate.hasNativeWindowHandle
    titleLength = $context.titleLength
    titleHash = $context.titleHash
    boundingRect = $candidate.boundingRect
  }

  $strategy = ""
  $uiaSetValueTried = $false
  if ($candidate.hasValuePattern -and $candidate.valuePattern) {
    try {
      $uiaSetValueTried = $true
      $candidate.valuePattern.SetValue($Text)
      $strategy = "uia_value_pattern"
    } catch {
      $strategy = ""
    }
  }
  if (-not $strategy -and $candidate.hasNativeWindowHandle) {
    [void][SmartPromptFillNative]::SetWindowText($candidate.nativeWindowHandle, $Text)
    $strategy = "win32_set_window_text_fallback"
  }
  if (-not $strategy) {
    $base.reason = "foreground_candidate_has_no_write_strategy"
    $base.uiaSetValueTried = [bool]$uiaSetValueTried
    return [pscustomobject]$base
  }

  $verifiedText = ""
  if ($candidate.hasNativeWindowHandle) {
    $verifiedText = Get-WindowTextSafe -Handle $candidate.nativeWindowHandle
  }
  $verified = $verifiedText -eq $Text
  $base.pass = [bool]$verified
  $base.writeAttempted = $true
  $base.verified = [bool]$verified
  $base.strategy = $strategy
  $base.uiaSetValueTried = [bool]$uiaSetValueTried
  $base.summary.verifiedTextLength = $verifiedText.Length
  $base.summary.verifiedTextHash = Get-HashText $verifiedText
  if (-not $verified) {
    $base.reason = "foreground_after_write_verification_failed"
  }
  return [pscustomobject]$base
}

if ($env:OS -notlike "*Windows*") {
  $reportObject = New-UnsupportedReport -Reason "windows_fill_only"
} elseif (-not $SelfTest) {
  $reportObject = Invoke-ConfirmedForegroundFill
} else {
  $reportObject = Invoke-SelfTestFill
}

$json = $reportObject | ConvertTo-Json -Depth 8
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 desktop fill report: $Report"
}
Write-Output $json

if (-not $reportObject.pass -and $SelfTest) {
  exit 1
}
