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
  param([string]$ProcessName, [string]$WindowTitle)
  $haystack = "$ProcessName $WindowTitle"
  if ($haystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($haystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($haystack -match "(?i)\bhermes\b") { return "hermes" }
  return "unknown"
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

  $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
  $elements = @()
  if ($rootElement) {
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
        boundingRect = [pscustomobject]@{
          x = [int]$rect.X
          y = [int]$rect.Y
          width = [int]$rect.Width
          height = [int]$rect.Height
        }
      }
    }
  }

  $toolProfile = Get-ToolProfile -ProcessName $processName -WindowTitle $title
  $candidateCount = $elements.Count
  $toolProfileMatched = -not $ExpectedToolProfile -or $toolProfile -eq $ExpectedToolProfile
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
    }
    supportedToolProfiles = @("codex", "claude-code", "hermes")
    candidates = $elements
    summary = [pscustomobject]@{
      candidateCount = $candidateCount
      valuePatternCandidates = @($elements | Where-Object { $_.hasValuePattern }).Count
      textPatternCandidates = @($elements | Where-Object { $_.hasTextPattern }).Count
      focusableCandidates = @($elements | Where-Object { $_.isKeyboardFocusable }).Count
      detectedToolProfile = $toolProfile
    }
    privacy = [pscustomobject]@{
      titleRedacted = $true
      elementNamesHashed = $true
      elementValuesNotRead = $true
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
      promptTextNotRead = $true
    }
  }
} else {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32Native {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
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
