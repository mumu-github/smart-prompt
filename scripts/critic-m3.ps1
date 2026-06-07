$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Command
  )
  Write-Host "== $Name =="
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Assert-Text {
  param(
    [string]$Path,
    [string]$Needle
  )
  $fullPath = Join-Path $Root $Path
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  if (-not $content.Contains($Needle)) {
    throw "$Path missing required text: $Needle"
  }
}

Invoke-Step "browser-extension tests" {
  Push-Location (Join-Path $Root "prototypes/browser-extension")
  try { npm test } finally { Pop-Location }
}

Invoke-Step "local-service tests" {
  Push-Location (Join-Path $Root "apps/local-service")
  try { npm test } finally { Pop-Location }
}

Invoke-Step "M3 Windows UIA self-test" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-input.ps1") -SelfTest -Report (Join-Path $Root "research/m3-desktop-input.latest.json")
}

Invoke-Step "M3 beta adapter pilot" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-pilot-adapters.ps1") -Headless -LoginWaitSeconds 1 -NoAutoSendWaitMs 500 -Report (Join-Path $Root "research/m3-pilot-adapters.latest.json")
}

$desktopReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-desktop-input.latest.json") | ConvertFrom-Json
if ($desktopReport.schemaVersion -ne "m3-windows-uia@1") { throw "desktop report schema mismatch" }
if (-not $desktopReport.pass) { throw "desktop report did not pass" }
if (-not ($desktopReport.supportedToolProfiles -contains "codex")) { throw "desktop report missing codex profile" }
if (-not ($desktopReport.supportedToolProfiles -contains "claude-code")) { throw "desktop report missing claude-code profile" }
if (-not ($desktopReport.supportedToolProfiles -contains "hermes")) { throw "desktop report missing hermes profile" }
if (-not $desktopReport.privacy.titleRedacted) { throw "desktop report title is not redacted" }
if (-not $desktopReport.privacy.elementValuesNotRead) { throw "desktop report may read element values" }
if (($desktopReport | ConvertTo-Json -Depth 8).Contains("M3 UIA self test input")) { throw "desktop report leaked self-test input text" }

$pilotReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-pilot-adapters.latest.json") | ConvertFrom-Json
if ($pilotReport.schemaVersion -ne "m3-pilot-adapters@1") { throw "pilot report schema mismatch" }
foreach ($site in @("workbuddy", "trae", "doubao", "deepseek")) {
  if (-not ($pilotReport.pilot.siteIds -contains $site)) { throw "pilot report missing site $site" }
}
if ($pilotReport.summary.redactionLeaks.Count -gt 0) { throw "pilot report has redaction leaks" }
if ($pilotReport.pilot.insertAttempts -lt 4) { throw "pilot report did not attempt all beta inserts" }

Assert-Text "docs/m3-desktop-input.md" "Windows UIA"
Assert-Text "docs/m3-desktop-input.md" "macOS AX"
Assert-Text "docs/m3-desktop-input.md" "workBuddy"
Assert-Text "packages/shared/desktop-tool-profiles.js" "claude-code"
Assert-Text "apps/local-service/src/server.js" "/desktop/input-snapshot"

Write-Host "PASS: M3 pilot and desktop input critic checks passed."
