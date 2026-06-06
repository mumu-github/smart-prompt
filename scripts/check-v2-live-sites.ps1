$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Report = Join-Path $Root "research/v2-live-site-probe.latest.json"

Push-Location (Join-Path $Root "prototypes/browser-extension")
try {
  $env:SMART_PROMPT_LIVE_REPORT = $Report
  node tests/live-site-probe.test.js
  if ($LASTEXITCODE -ne 0) {
    throw "Live-site probe failed with exit code $LASTEXITCODE. Report: $Report"
  }
} finally {
  Remove-Item Env:\SMART_PROMPT_LIVE_REPORT -ErrorAction SilentlyContinue
  Pop-Location
}
