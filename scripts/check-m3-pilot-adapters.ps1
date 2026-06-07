param(
  [string]$Report = "",
  [string]$ProfileDir = "",
  [string[]]$SiteIds = @("workbuddy", "trae", "doubao", "deepseek"),
  [int]$LoginWaitSeconds = 30,
  [int]$CdpPort = 9235,
  [int]$NoAutoSendWaitMs = 1500,
  [switch]$AttachCdp,
  [switch]$Headless
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-pilot-adapters.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null

$previousReport = $env:SMART_PROMPT_LIVE_REPORT
$previousCdpPort = $env:SMART_PROMPT_LIVE_CDP_PORT
$previousAttach = $env:SMART_PROMPT_LIVE_ATTACH_CDP
$previousProfile = $env:SMART_PROMPT_LIVE_PROFILE_DIR
$previousSiteIds = $env:SMART_PROMPT_LIVE_SITE_IDS
$previousLoginWait = $env:SMART_PROMPT_LIVE_LOGIN_WAIT_MS
$previousFallback = $env:SMART_PROMPT_LIVE_INJECT_FALLBACK
$previousSchema = $env:SMART_PROMPT_LIVE_SCHEMA_VERSION
$previousNoAutoSendWait = $env:SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS
$previousHeadless = $env:SMART_PROMPT_LIVE_HEADLESS
$previousSettle = $env:SMART_PROMPT_LIVE_SETTLE_MS

try {
  $env:SMART_PROMPT_LIVE_REPORT = $Report
  $env:SMART_PROMPT_LIVE_CDP_PORT = [string]$CdpPort
  $env:SMART_PROMPT_LIVE_SITE_IDS = ($SiteIds -join ",")
  $env:SMART_PROMPT_LIVE_LOGIN_WAIT_MS = [string]($LoginWaitSeconds * 1000)
  $env:SMART_PROMPT_LIVE_INJECT_FALLBACK = "0"
  $env:SMART_PROMPT_LIVE_SCHEMA_VERSION = "m3-pilot-adapters@1"
  $env:SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS = [string]$NoAutoSendWaitMs
  $env:SMART_PROMPT_LIVE_SETTLE_MS = "6000"
  if ($AttachCdp) {
    $env:SMART_PROMPT_LIVE_ATTACH_CDP = "1"
  }
  if ($Headless) {
    $env:SMART_PROMPT_LIVE_HEADLESS = "1"
  }
  if ($ProfileDir) {
    if ([System.IO.Path]::IsPathRooted($ProfileDir)) {
      $resolvedProfile = $ProfileDir
    } else {
      $resolvedProfile = Join-Path $Root $ProfileDir
    }
    New-Item -ItemType Directory -Force -Path $resolvedProfile | Out-Null
    $env:SMART_PROMPT_LIVE_PROFILE_DIR = $resolvedProfile
  }

  Push-Location (Join-Path $Root "prototypes/browser-extension")
  try {
    node tests/live-site-probe.test.js
    if ($LASTEXITCODE -ne 0) {
      throw "M3 pilot adapter probe failed with exit code $LASTEXITCODE. Report: $Report"
    }
  } finally {
    Pop-Location
  }

  $json = Get-Content -Raw -Encoding UTF8 $Report | ConvertFrom-Json
  if ($json.schemaVersion -ne "m3-pilot-adapters@1") {
    throw "Unexpected schemaVersion in pilot report: $($json.schemaVersion)"
  }
  if (-not $json.pilot -or -not $json.pilot.sites -or $json.pilot.sites.Count -lt $SiteIds.Count) {
    throw "Pilot report is missing requested site records."
  }
  if ($json.summary.redactionLeaks.Count -gt 0) {
    throw "Pilot report contains redaction leaks."
  }

  Write-Host "M3 pilot adapter report: $Report"
  Write-Host ("Insert attempts: {0}; passes: {1}; success rate: {2}" -f $json.pilot.insertAttempts, $json.pilot.insertPasses, $json.pilot.insertSuccessRate)
  if ($json.pilot.failureReasons) {
    Write-Host "Failure reasons:"
    $json.pilot.failureReasons.PSObject.Properties | ForEach-Object {
      Write-Host ("- {0}: {1}" -f $_.Name, $_.Value)
    }
  }
} finally {
  if ($null -eq $previousReport) { Remove-Item Env:\SMART_PROMPT_LIVE_REPORT -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_REPORT = $previousReport }
  if ($null -eq $previousCdpPort) { Remove-Item Env:\SMART_PROMPT_LIVE_CDP_PORT -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_CDP_PORT = $previousCdpPort }
  if ($null -eq $previousAttach) { Remove-Item Env:\SMART_PROMPT_LIVE_ATTACH_CDP -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_ATTACH_CDP = $previousAttach }
  if ($null -eq $previousProfile) { Remove-Item Env:\SMART_PROMPT_LIVE_PROFILE_DIR -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_PROFILE_DIR = $previousProfile }
  if ($null -eq $previousSiteIds) { Remove-Item Env:\SMART_PROMPT_LIVE_SITE_IDS -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_SITE_IDS = $previousSiteIds }
  if ($null -eq $previousLoginWait) { Remove-Item Env:\SMART_PROMPT_LIVE_LOGIN_WAIT_MS -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_LOGIN_WAIT_MS = $previousLoginWait }
  if ($null -eq $previousFallback) { Remove-Item Env:\SMART_PROMPT_LIVE_INJECT_FALLBACK -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_INJECT_FALLBACK = $previousFallback }
  if ($null -eq $previousSchema) { Remove-Item Env:\SMART_PROMPT_LIVE_SCHEMA_VERSION -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_SCHEMA_VERSION = $previousSchema }
  if ($null -eq $previousNoAutoSendWait) { Remove-Item Env:\SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS = $previousNoAutoSendWait }
  if ($null -eq $previousHeadless) { Remove-Item Env:\SMART_PROMPT_LIVE_HEADLESS -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_HEADLESS = $previousHeadless }
  if ($null -eq $previousSettle) { Remove-Item Env:\SMART_PROMPT_LIVE_SETTLE_MS -ErrorAction SilentlyContinue } else { $env:SMART_PROMPT_LIVE_SETTLE_MS = $previousSettle }
}
