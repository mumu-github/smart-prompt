param(
  [string]$Report = "",
  [string]$ProfileDir = "",
  [string[]]$SiteIds = @("chatgpt", "claude", "gemini", "perplexity", "lovable", "bolt", "v0", "replit"),
  [int]$LoginWaitSeconds = 180,
  [int]$CdpPort = 9232,
  [int]$NoAutoSendWaitMs = 2000,
  [switch]$AttachCdp
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

if (-not $Report) {
  $Report = Join-Path $Root "research/v3-live-site-formal.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

$previousFallback = $env:SMART_PROMPT_LIVE_INJECT_FALLBACK
$previousSchema = $env:SMART_PROMPT_LIVE_SCHEMA_VERSION
$previousNoAutoSendWait = $env:SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS

try {
  $env:SMART_PROMPT_LIVE_INJECT_FALLBACK = "0"
  $env:SMART_PROMPT_LIVE_SCHEMA_VERSION = "v3-live-site-formal@1"
  $env:SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS = [string]$NoAutoSendWaitMs

  $invokeArgs = @{
    Report = $Report
    SiteIds = $SiteIds
    LoginWaitSeconds = $LoginWaitSeconds
    CdpPort = $CdpPort
  }
  if ($ProfileDir) {
    $invokeArgs.ProfileDir = $ProfileDir
  }
  if ($AttachCdp) {
    $invokeArgs.AttachCdp = $true
  }

  & (Join-Path $ScriptDir "check-v2-live-sites.ps1") @invokeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "V3 live-site formal probe failed with exit code $LASTEXITCODE. Report: $Report"
  }

  node (Join-Path $ScriptDir "assert-v3-live-formal-evidence.js") $Report
  if ($LASTEXITCODE -ne 0) {
    throw "V3 live-site formal evidence assertion failed. Report: $Report"
  }
} finally {
  if ($null -eq $previousFallback) {
    Remove-Item Env:\SMART_PROMPT_LIVE_INJECT_FALLBACK -ErrorAction SilentlyContinue
  } else {
    $env:SMART_PROMPT_LIVE_INJECT_FALLBACK = $previousFallback
  }
  if ($null -eq $previousSchema) {
    Remove-Item Env:\SMART_PROMPT_LIVE_SCHEMA_VERSION -ErrorAction SilentlyContinue
  } else {
    $env:SMART_PROMPT_LIVE_SCHEMA_VERSION = $previousSchema
  }
  if ($null -eq $previousNoAutoSendWait) {
    Remove-Item Env:\SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS -ErrorAction SilentlyContinue
  } else {
    $env:SMART_PROMPT_LIVE_NO_AUTO_SEND_WAIT_MS = $previousNoAutoSendWait
  }
}
