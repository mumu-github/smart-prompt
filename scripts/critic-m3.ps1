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

Invoke-Step "M3 Windows tool profile self-tests" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-tool-profiles.ps1") -Report (Join-Path $Root "research/m3-desktop-tool-profiles.latest.json")
}

Invoke-Step "M3 Windows real foreground desktop tool audit" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-real-desktop-tools.ps1") -Report (Join-Path $Root "research/m3-real-desktop-tools.latest.json")
}

Invoke-Step "M3 Windows desktop fill self-test" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-fill.ps1") -SelfTest -Report (Join-Path $Root "research/m3-desktop-fill.latest.json")
}

Invoke-Step "M3 Windows desktop clipboard fallback self-test" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-fill.ps1") -SelfTest -AllowClipboardFallback -Report (Join-Path $Root "research/m3-desktop-fill-clipboard.latest.json")
}

Invoke-Step "M3 Windows foreground fill guard" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-fill.ps1") -ConfirmForeground -ExpectedTitleHash "not-a-real-title-hash" -ExpectedToolProfile "codex" -Text "M3 foreground guard raw text" -Report (Join-Path $Root "research/m3-desktop-fill-guard.latest.json")
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

$toolProfileReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-desktop-tool-profiles.latest.json") | ConvertFrom-Json
if ($toolProfileReport.schemaVersion -ne "m3-desktop-tool-profiles@1") { throw "tool profile report schema mismatch" }
if (-not $toolProfileReport.pass) { throw "tool profile report did not pass" }
foreach ($profile in @("codex", "claude-code", "hermes")) {
  if (-not ($toolProfileReport.requiredProfiles -contains $profile)) { throw "tool profile report missing required profile $profile" }
  $profileResult = @($toolProfileReport.profiles | Where-Object { $_.id -eq $profile })[0]
  if (-not $profileResult) { throw "tool profile report missing result for $profile" }
  if (-not $profileResult.ok) { throw "tool profile self-test failed for $profile" }
  if ($profileResult.detectedToolProfile -ne $profile) { throw "tool profile detection mismatch for $profile" }
  if (-not $profileResult.expectedToolProfileMatched) { throw "tool profile expected match missing for $profile" }
  if ([int]$profileResult.candidateCount -le 0) { throw "tool profile self-test has no UIA candidates for $profile" }
  if (-not $profileResult.privacy.titleRedacted) { throw "tool profile title is not redacted for $profile" }
  if (-not $profileResult.privacy.elementValuesNotRead) { throw "tool profile may read element values for $profile" }
  if ($profileResult.privacy.rawTitleLeak) { throw "tool profile leaked raw title for $profile" }
}
if (-not $toolProfileReport.privacy.rawTitlesNotStored) { throw "tool profile report stores raw titles" }
if (($toolProfileReport | ConvertTo-Json -Depth 10).Contains("Smart Prompt Claude Code UIA Self Test")) { throw "tool profile report leaked Claude Code raw title" }
if (($toolProfileReport | ConvertTo-Json -Depth 10).Contains("Smart Prompt Hermes UIA Self Test")) { throw "tool profile report leaked Hermes raw title" }

$realDesktopReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-real-desktop-tools.latest.json") | ConvertFrom-Json
if ($realDesktopReport.schemaVersion -ne "m3-real-desktop-tools@1") { throw "real desktop tools report schema mismatch" }
if (-not $realDesktopReport.pass) { throw "real desktop tools report did not pass" }
if (-not $realDesktopReport.snapshot.probeOk) { throw "real desktop tools snapshot did not probe foreground" }
if (-not $realDesktopReport.checks.snapshotOk) { throw "real desktop tools report missing snapshot ok" }
if (-not $realDesktopReport.checks.foregroundClassified) { throw "real desktop tools report did not classify foreground" }
if (-not $realDesktopReport.checks.privacyRedacted) { throw "real desktop tools report privacy redaction missing" }
if ($realDesktopReport.checks.rawTitleStored) { throw "real desktop tools report stored raw title" }
if ($realDesktopReport.checks.rawElementNamesStored) { throw "real desktop tools report stored raw element names" }
if ($realDesktopReport.checks.rawInputValuesStored) { throw "real desktop tools report stored raw input values" }
if ($realDesktopReport.checks.rawPromptTextStored) { throw "real desktop tools report stored raw prompt text" }
if (-not $realDesktopReport.checks.noAutoSubmit) { throw "real desktop tools report allows auto submit" }
if ($realDesktopReport.write.attempted) { throw "real desktop tools default audit attempted write" }
if ($realDesktopReport.write.reason -ne "real_write_requires_allow_foreground_write") { throw "real desktop tools default audit did not keep write guarded" }
foreach ($profile in @("codex", "claude-code", "hermes")) {
  if (-not ($realDesktopReport.supportedToolProfiles -contains $profile)) { throw "real desktop tools report missing supported profile $profile" }
  if (-not ($realDesktopReport.requestedProfiles -contains $profile)) { throw "real desktop tools report missing requested profile $profile" }
  $coverage = @($realDesktopReport.coverage | Where-Object { $_.id -eq $profile })[0]
  if (-not $coverage) { throw "real desktop tools report missing coverage row for $profile" }
}
if (($realDesktopReport | ConvertTo-Json -Depth 10).Contains("Smart Prompt M3 real foreground desktop fill probe")) { throw "real desktop tools report leaked raw write probe text" }

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

$desktopClipboardFillReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-desktop-fill-clipboard.latest.json") | ConvertFrom-Json
if ($desktopClipboardFillReport.schemaVersion -ne "m3-windows-fill@1") { throw "desktop clipboard fill report schema mismatch" }
if (-not $desktopClipboardFillReport.allowClipboardFallback) { throw "desktop clipboard fill did not enable fallback" }
if (-not $desktopClipboardFillReport.pass) { throw "desktop clipboard fill report did not pass" }
if (-not $desktopClipboardFillReport.writeAttempted) { throw "desktop clipboard fill report did not attempt write" }
if (-not $desktopClipboardFillReport.verified) { throw "desktop clipboard fill report did not verify write" }
if ($desktopClipboardFillReport.strategy -ne "clipboard_paste_fallback") { throw "desktop clipboard fill did not use clipboard strategy" }
if (-not $desktopClipboardFillReport.clipboardFallbackTried) { throw "desktop clipboard fill did not try clipboard fallback" }
if (-not $desktopClipboardFillReport.clipboardRestored) { throw "desktop clipboard fill did not restore clipboard" }
if (-not $desktopClipboardFillReport.privacy.clipboardTextNotStored) { throw "desktop clipboard fill may store clipboard text" }
if (-not $desktopClipboardFillReport.privacy.fallbackRequiresExplicitAllow) { throw "desktop clipboard fill fallback is not explicitly gated" }
if ($desktopClipboardFillReport.summary.autoSubmit) { throw "desktop clipboard fill summary indicates auto submit" }
if ([int]$desktopClipboardFillReport.summary.submitSignalCount -ne 0) { throw "desktop clipboard fill emitted submit signals" }
if (($desktopClipboardFillReport | ConvertTo-Json -Depth 10).Contains("Smart Prompt M3 desktop fill self-test")) { throw "desktop clipboard fill report leaked self-test text" }

$desktopFillGuardReport = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/m3-desktop-fill-guard.latest.json") | ConvertFrom-Json
if ($desktopFillGuardReport.schemaVersion -ne "m3-windows-fill@1") { throw "desktop fill guard report schema mismatch" }
if (-not $desktopFillGuardReport.confirmForeground) { throw "desktop fill guard did not run confirmForeground path" }
if ($desktopFillGuardReport.pass) { throw "desktop fill guard unexpectedly passed" }
if ($desktopFillGuardReport.writeAttempted) { throw "desktop fill guard attempted write before target match" }
if ($desktopFillGuardReport.reason -ne "foreground_title_hash_mismatch") { throw "desktop fill guard did not stop on title hash mismatch" }
if (-not $desktopFillGuardReport.privacy.writtenTextNotStored) { throw "desktop fill guard stores written text" }
if (($desktopFillGuardReport | ConvertTo-Json -Depth 10).Contains("M3 foreground guard raw text")) { throw "desktop fill guard leaked raw text" }

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
  if (-not $pilotSite.routeMatrix) { throw "pilot report missing routeMatrix for $site" }
  if ([int]$pilotSite.routeMatrix.attemptCount -lt 3) { throw "pilot routeMatrix has too few attempts for $site" }
  if (-not $pilotSite.routeMatrix.attempts -or $pilotSite.routeMatrix.attempts.Count -lt 3) { throw "pilot routeMatrix missing attempts for $site" }
  foreach ($attempt in $pilotSite.routeMatrix.attempts) {
    if (-not $attempt.requestedUrl.redacted) { throw "pilot routeMatrix missing redacted requestedUrl for $site" }
    if ($null -eq $attempt.titleLength) { throw "pilot routeMatrix missing titleLength for $site" }
    if (-not $attempt.pageClassification) { throw "pilot routeMatrix missing pageClassification for $site" }
    if ($null -eq $attempt.totalInputCandidateCount) { throw "pilot routeMatrix missing input count for $site" }
  }
}
if ($pilotReport.summary.redactionLeaks.Count -gt 0) { throw "pilot report has redaction leaks" }
if ($pilotReport.pilot.insertAttempts -lt 4) { throw "pilot report did not attempt all beta inserts" }
if ($pilotReport.pilot.failureReasons.PSObject.Properties.Name.Count -eq 1 -and $pilotReport.pilot.failureReasons.PSObject.Properties.Name[0] -eq "no visible input candidate") {
  throw "pilot report failure reasons are too coarse for beta adapter triage"
}
if (-not ($pilotReport.pilot.failureReasons.PSObject.Properties.Name -contains "login_or_auth_gate_no_visible_composer")) {
  throw "pilot report does not distinguish login/auth gate failures"
}
if (($pilotReport | ConvertTo-Json -Depth 20).Contains("function smartPromptProbeInputs")) {
  throw "pilot report leaked raw probe source in failure reasons"
}

Assert-Text "docs/m3-desktop-input.md" "Windows UIA"
Assert-Text "docs/m3-desktop-input.md" "workBuddy"
Assert-Text "packages/shared/desktop-tool-profiles.js" "claude-code"
Assert-Text "scripts/check-m3-real-desktop-tools.ps1" "m3-real-desktop-tools@1"
Assert-Text "scripts/check-m3-real-desktop-tools.ps1" "real_write_requires_allow_foreground_write"
Assert-Text "scripts/check-m3-desktop-tool-profiles.ps1" "m3-desktop-tool-profiles@1"
Assert-Text "scripts/check-m3-desktop-tool-profiles.ps1" "claude-code"
Assert-Text "scripts/check-m3-desktop-tool-profiles.ps1" "hermes"
Assert-Text "apps/local-service/src/server.js" "/desktop/input-snapshot"
Assert-Text "apps/local-service/src/server.js" "/desktop/fill"
Assert-Text "apps/local-service/src/server.js" "confirmForeground"
Assert-Text "apps/local-service/src/server.js" "allowClipboardFallback"
Assert-Text "apps/local-service-sidecar/src/main.rs" "/desktop/input-snapshot"
Assert-Text "apps/local-service-sidecar/src/main.rs" "/desktop/fill"
Assert-Text "apps/local-service-sidecar/src/main.rs" "ConfirmForeground"
Assert-Text "apps/local-service-sidecar/src/main.rs" "AllowClipboardFallback"
Assert-Text "scripts/check-m3-desktop-fill.ps1" "m3-windows-fill@1"
Assert-Text "scripts/check-m3-desktop-fill.ps1" "ExpectedTitleHash"
Assert-Text "scripts/check-m3-desktop-fill.ps1" "AllowClipboardFallback"
Assert-Text "scripts/check-m3-desktop-fill.ps1" "clipboard_paste_fallback"
Assert-Text "scripts/check-m3-desktop-fill.ps1" "foreground_title_hash_mismatch"
Assert-Text "scripts/check-m3-sidecar-desktop-input.ps1" "m3-sidecar-desktop-input@1"
Assert-Text "scripts/check-m3-sidecar-desktop-fill.ps1" "m3-sidecar-desktop-fill@1"
Assert-Text "scripts/check-m3-installed-sidecar-desktop-input.ps1" "m3-installed-sidecar-desktop-input@1"
Assert-Text "apps/desktop-shell/scripts/prepare-sidecar.js" "check-m3-desktop-input.ps1"
Assert-Text "apps/desktop-shell/scripts/prepare-sidecar.js" "check-m3-desktop-fill.ps1"
Assert-Text "scripts/check-v4-installed-app-runtime.js" "desktopSnapshotFromInstalledSidecar"
Assert-Text "scripts/check-v4-installed-app-runtime.js" "desktopFillFromInstalledSidecar"
Assert-Text "prototypes/browser-extension/tests/live-site-probe.test.js" "pageClassification"
Assert-Text "prototypes/browser-extension/tests/live-site-probe.test.js" "routeDiagnostics"
Assert-Text "prototypes/browser-extension/tests/live-site-probe.test.js" "routeMatrix"
Assert-Text "prototypes/browser-extension/tests/live-site-probe.test.js" "login_or_auth_gate_no_visible_composer"

Write-Host "PASS: M3 pilot and desktop input critic checks passed."
