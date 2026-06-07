param(
  [string]$Report = "",
  [switch]$JsonOnly,
  [switch]$SelfTest,
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
    pass = $false
    reason = $Reason
    writeAttempted = $false
    verified = $false
    supportedToolProfiles = @("codex", "claude-code", "hermes")
    privacy = New-Privacy
  }
}

function Invoke-SelfTestFill {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmartPromptFillNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool SetWindowText(IntPtr hWnd, string lpString);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

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
      pass = [bool]$verified
      writeAttempted = $true
      verified = [bool]$verified
      strategy = $strategy
      uiaSetValueTried = [bool]$uiaSetValueTried
      target = [pscustomobject]@{
        controlType = $controlType
        classNameHash = Get-HashText $className
        hasValuePattern = [bool]$hasValuePattern
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

if ($env:OS -notlike "*Windows*") {
  $reportObject = New-UnsupportedReport -Reason "windows_fill_only"
} elseif (-not $SelfTest) {
  $reportObject = New-UnsupportedReport -Reason "foreground_fill_requires_explicit_self_test_or_confirmed_target"
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
