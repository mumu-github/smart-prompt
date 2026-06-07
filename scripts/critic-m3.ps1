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

Invoke-Step "M3 Windows desktop fill self-test" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-fill.ps1") -SelfTest -Report (Join-Path $Root "research/m3-desktop-fill.latest.json")
}

Invoke-Step "M3 native sidecar desktop input self-test" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-sidecar-desktop-input.ps1") -Report (Join-Path $Root "research/m3-sidecar-desktop-input.latest.json")
}

Invoke-Step "M3 native sidecar desktop fill self-test" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-sidecar-desktop-fill.ps1") -Report (Join-Path $Root "research/m3-sidecar-desktop-fill.latest.json")
}

Invoke-Step "M3 installed sidecar desktop input smoke" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-installed-sidecar-desktop-input.ps1") -Report (Join-Path $Root "research/m3-installed-sidecar-desktop-input.latest.json")
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

$desktopFillReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-desktop-fill.latest.json") | ConvertFrom-Json
if ($desktopFillReport.schemaVersion -ne "m3-windows-fill@1") { throw "desktop fill report schema mismatch" }
if (-not $desktopFillReport.pass) { throw "desktop fill report did not pass" }
if (-not $desktopFillReport.writeAttempted) { throw "desktop fill report did not attempt write" }
if (-not $desktopFillReport.verified) { throw "desktop fill report did not verify write" }
if (-not ($desktopFillReport.supportedToolProfiles -contains "codex")) { throw "desktop fill report missing codex profile" }
if (-not ($desktopFillReport.supportedToolProfiles -contains "claude-code")) { throw "desktop fill report missing claude-code profile" }
if (-not ($desktopFillReport.supportedToolProfiles -contains "hermes")) { throw "desktop fill report missing hermes profile" }
if (-not $desktopFillReport.privacy.writtenTextNotStored) { throw "desktop fill report stores written text" }
if (-not $desktopFillReport.privacy.verificationUsesLengthAndHash) { throw "desktop fill report lacks hash-only verification" }
if ($desktopFillReport.privacy.autoSubmit) { throw "desktop fill report allows auto submit" }
if ($desktopFillReport.summary.autoSubmit) { throw "desktop fill summary indicates auto submit" }
if ([int]$desktopFillReport.summary.submitSignalCount -ne 0) { throw "desktop fill report emitted submit signals" }
if (($desktopFillReport | ConvertTo-Json -Depth 10).Contains("Smart Prompt M3 desktop fill self-test")) { throw "desktop fill report leaked self-test text" }

$sidecarReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-sidecar-desktop-input.latest.json") | ConvertFrom-Json
if ($sidecarReport.schemaVersion -ne "m3-sidecar-desktop-input@1") { throw "sidecar desktop report schema mismatch" }
if (-not $sidecarReport.pass) { throw "sidecar desktop report did not pass" }
if (-not $sidecarReport.checks.sidecarHealthy) { throw "sidecar desktop report did not prove sidecar health" }
if (-not $sidecarReport.checks.snapshotOk) { throw "sidecar desktop report missing snapshot ok" }
if (-not $sidecarReport.checks.codexProfile) { throw "sidecar desktop report missing codex profile" }
if (-not $sidecarReport.checks.claudeCodeProfile) { throw "sidecar desktop report missing claude-code profile" }
if (-not $sidecarReport.checks.hermesProfile) { throw "sidecar desktop report missing hermes profile" }
if (-not $sidecarReport.checks.privacyTitleRedacted) { throw "sidecar desktop report title is not redacted" }
if (-not $sidecarReport.checks.privacyValuesNotRead) { throw "sidecar desktop report may read element values" }
if (($sidecarReport | ConvertTo-Json -Depth 10).Contains("M3 UIA self test input")) { throw "sidecar desktop report leaked self-test input text" }
if (($sidecarReport | ConvertTo-Json -Depth 10).Contains("AppData\\Local\\Temp\\smart-prompt-m3-sidecar")) { throw "sidecar desktop report leaked temp data dir" }

$sidecarFillReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-sidecar-desktop-fill.latest.json") | ConvertFrom-Json
if ($sidecarFillReport.schemaVersion -ne "m3-sidecar-desktop-fill@1") { throw "sidecar fill report schema mismatch" }
if (-not $sidecarFillReport.pass) { throw "sidecar fill report did not pass" }
if (-not $sidecarFillReport.checks.sidecarHealthy) { throw "sidecar fill report did not prove sidecar health" }
if (-not $sidecarFillReport.checks.fillOk) { throw "sidecar fill report missing fill ok" }
if (-not $sidecarFillReport.checks.writeAttempted) { throw "sidecar fill report did not attempt write" }
if (-not $sidecarFillReport.checks.verified) { throw "sidecar fill report did not verify write" }
if (-not $sidecarFillReport.checks.codexProfile) { throw "sidecar fill report missing codex profile" }
if (-not $sidecarFillReport.checks.claudeCodeProfile) { throw "sidecar fill report missing claude-code profile" }
if (-not $sidecarFillReport.checks.hermesProfile) { throw "sidecar fill report missing hermes profile" }
if (-not $sidecarFillReport.checks.privacyWrittenTextNotStored) { throw "sidecar fill report stores written text" }
if (-not $sidecarFillReport.checks.privacyVerificationUsesHash) { throw "sidecar fill report lacks hash-only verification" }
if (-not $sidecarFillReport.checks.privacyNoAutoSubmit) { throw "sidecar fill report allows auto submit" }
if ($sidecarFillReport.checks.rawTextLeak) { throw "sidecar fill report leaked raw text" }
if (($sidecarFillReport | ConvertTo-Json -Depth 10).Contains("M3 sidecar desktop fill self-test")) { throw "sidecar fill report leaked self-test text" }
if (($sidecarFillReport | ConvertTo-Json -Depth 10).Contains("AppData\\Local\\Temp\\smart-prompt-m3-sidecar-fill")) { throw "sidecar fill report leaked temp data dir" }

$installedReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-installed-sidecar-desktop-input.latest.json") | ConvertFrom-Json
if ($installedReport.schemaVersion -ne "m3-installed-sidecar-desktop-input@1") { throw "installed sidecar desktop report schema mismatch" }
if (-not $installedReport.pass) { throw "installed sidecar desktop report did not pass" }
if (-not $installedReport.checks.bundledNativeSidecar) { throw "installed sidecar report did not prove bundled native sidecar" }
if (-not $installedReport.checks.bundledDesktopInputProbe) { throw "installed sidecar report did not prove bundled desktop input probe" }
if (-not $installedReport.checks.bundledDesktopFillProbe) { throw "installed sidecar report did not prove bundled desktop fill probe" }
if (-not $installedReport.checks.installedAppStartedSidecar) { throw "installed sidecar report did not start sidecar from installed app" }
if (-not $installedReport.checks.installedServiceHealth) { throw "installed sidecar report did not prove service health" }
if (-not $installedReport.checks.desktopSnapshotFromInstalledSidecar) { throw "installed sidecar report did not call desktop snapshot" }
if (-not $installedReport.checks.desktopSnapshotSelfTestPass) { throw "installed sidecar desktop snapshot did not pass self-test" }
if (-not $installedReport.checks.desktopSnapshotToolProfiles) { throw "installed sidecar desktop snapshot missing tool profiles" }
if (-not $installedReport.checks.desktopSnapshotPrivacyRedacted) { throw "installed sidecar desktop snapshot privacy redaction missing" }
if (-not $installedReport.checks.desktopFillFromInstalledSidecar) { throw "installed sidecar report did not call desktop fill" }
if (-not $installedReport.checks.desktopFillSelfTestPass) { throw "installed sidecar desktop fill did not pass self-test" }
if (-not $installedReport.checks.desktopFillToolProfiles) { throw "installed sidecar desktop fill missing tool profiles" }
if (-not $installedReport.checks.desktopFillPrivacyRedacted) { throw "installed sidecar desktop fill privacy redaction missing" }
if (($installedReport | ConvertTo-Json -Depth 10).Contains("M3 UIA self test input")) { throw "installed sidecar report leaked self-test input text" }
if (($installedReport | ConvertTo-Json -Depth 10).Contains("M3 installed desktop fill self-test")) { throw "installed sidecar report leaked fill self-test text" }

$pilotReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-pilot-adapters.latest.json") | ConvertFrom-Json
if ($pilotReport.schemaVersion -ne "m3-pilot-adapters@1") { throw "pilot report schema mismatch" }
foreach ($site in @("workbuddy", "trae", "doubao", "deepseek")) {
  if (-not ($pilotReport.pilot.siteIds -contains $site)) { throw "pilot report missing site $site" }
  $pilotSite = @($pilotReport.pilot.sites | Where-Object { $_.id -eq $site })[0]
  if (-not $pilotSite) { throw "pilot report missing site diagnostic record $site" }
  if (-not $pilotSite.pageClassification) { throw "pilot report missing pageClassification for $site" }
  if (-not $pilotSite.routeDiagnostics) { throw "pilot report missing routeDiagnostics for $site" }
  if ($null -eq $pilotSite.routeDiagnostics.totalInputCandidateCount) { throw "pilot report missing totalInputCandidateCount for $site" }
}
if ($pilotReport.summary.redactionLeaks.Count -gt 0) { throw "pilot report has redaction leaks" }
if ($pilotReport.pilot.insertAttempts -lt 4) { throw "pilot report did not attempt all beta inserts" }
if ($pilotReport.pilot.failureReasons.PSObject.Properties.Name.Count -eq 1 -and $pilotReport.pilot.failureReasons.PSObject.Properties.Name[0] -eq "no visible input candidate") {
  throw "pilot report failure reasons are too coarse for beta adapter triage"
}

Assert-Text "docs/m3-desktop-input.md" "Windows UIA"
Assert-Text "docs/m3-desktop-input.md" "macOS AX"
Assert-Text "docs/m3-desktop-input.md" "workBuddy"
Assert-Text "packages/shared/desktop-tool-profiles.js" "claude-code"
Assert-Text "apps/local-service/src/server.js" "/desktop/input-snapshot"
Assert-Text "apps/local-service/src/server.js" "/desktop/fill"
Assert-Text "apps/local-service-sidecar/src/main.rs" "/desktop/input-snapshot"
Assert-Text "apps/local-service-sidecar/src/main.rs" "/desktop/fill"
Assert-Text "scripts/check-m3-desktop-fill.ps1" "m3-windows-fill@1"
Assert-Text "scripts/check-m3-sidecar-desktop-input.ps1" "m3-sidecar-desktop-input@1"
Assert-Text "scripts/check-m3-sidecar-desktop-fill.ps1" "m3-sidecar-desktop-fill@1"
Assert-Text "scripts/check-m3-installed-sidecar-desktop-input.ps1" "m3-installed-sidecar-desktop-input@1"
Assert-Text "apps/desktop-shell/scripts/prepare-sidecar.js" "check-m3-desktop-input.ps1"
Assert-Text "apps/desktop-shell/scripts/prepare-sidecar.js" "check-m3-desktop-fill.ps1"
Assert-Text "scripts/check-v4-installed-app-runtime.js" "desktopSnapshotFromInstalledSidecar"
Assert-Text "scripts/check-v4-installed-app-runtime.js" "desktopFillFromInstalledSidecar"
Assert-Text "prototypes/browser-extension/tests/live-site-probe.test.js" "pageClassification"
Assert-Text "prototypes/browser-extension/tests/live-site-probe.test.js" "routeDiagnostics"

Write-Host "PASS: M3 pilot and desktop input critic checks passed."
