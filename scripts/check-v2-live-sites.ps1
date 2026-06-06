param(
  [string]$ProfileDir = "",
  [string[]]$SiteIds = @(),
  [int]$LoginWaitSeconds = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Report = Join-Path $Root "research/v2-live-site-probe.latest.json"

Push-Location (Join-Path $Root "prototypes/browser-extension")
try {
  $env:SMART_PROMPT_LIVE_REPORT = $Report
  if ($ProfileDir) {
    if ([System.IO.Path]::IsPathRooted($ProfileDir)) {
      $resolvedProfile = $ProfileDir
    } else {
      $resolvedProfile = Join-Path $Root $ProfileDir
    }
    New-Item -ItemType Directory -Force -Path $resolvedProfile | Out-Null
    $env:SMART_PROMPT_LIVE_PROFILE_DIR = $resolvedProfile
  }
  if ($SiteIds.Count -gt 0) {
    $env:SMART_PROMPT_LIVE_SITE_IDS = ($SiteIds -join ",")
  }
  if ($LoginWaitSeconds -gt 0) {
    $env:SMART_PROMPT_LIVE_LOGIN_WAIT_MS = [string]($LoginWaitSeconds * 1000)
  }
  node tests/live-site-probe.test.js
  if ($LASTEXITCODE -ne 0) {
    throw "Live-site probe failed with exit code $LASTEXITCODE. Report: $Report"
  }
} finally {
  Remove-Item Env:\SMART_PROMPT_LIVE_REPORT -ErrorAction SilentlyContinue
  Remove-Item Env:\SMART_PROMPT_LIVE_PROFILE_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\SMART_PROMPT_LIVE_SITE_IDS -ErrorAction SilentlyContinue
  Remove-Item Env:\SMART_PROMPT_LIVE_LOGIN_WAIT_MS -ErrorAction SilentlyContinue
  Pop-Location
}
