Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $Root

Push-Location apps/local-service
try {
  npm test
} finally {
  Pop-Location
}

Push-Location apps/local-service-sidecar
try {
  cargo fmt -- --check
  node --test tests/phase3-contract.test.js
} finally {
  Pop-Location
}

Push-Location prototypes/browser-extension
try {
  npm test
} finally {
  Pop-Location
}

Push-Location apps/desktop-shell
try {
  npm test
} finally {
  Pop-Location
}

$AcceptancePath = Join-Path $Root "research/phase3-activation-acceptance.latest.json"
$PrivacyPath = Join-Path $Root "research/phase3-privacy.latest.json"
$ReviewPath = Join-Path $Root "docs/reviews/phase3-activation-adversarial-review.md"

$Acceptance = Get-Content -Raw -Encoding UTF8 $AcceptancePath | ConvertFrom-Json
$Privacy = Get-Content -Raw -Encoding UTF8 $PrivacyPath | ConvertFrom-Json
$Review = Get-Content -Raw -Encoding UTF8 $ReviewPath

if ($Acceptance.schemaVersion -ne "phase3-activation-acceptance@1" -or $Acceptance.verdict -ne "pass") {
  throw "Phase 3 acceptance verdict is not pass."
}

$RequiredChecks = @(
  "activationContract",
  "provider",
  "migration",
  "privacy",
  "desktopStaticInteraction",
  "runtime",
  "browserDemo",
  "browserFailures",
  "visual",
  "realChatgpt",
  "activatedDesktopRestart",
  "timing"
)
foreach ($Check in $RequiredChecks) {
  if ($Acceptance.checks.$Check.status -ne "pass") {
    throw "Phase 3 acceptance check '$Check' is not pass."
  }
}

if (-not $Acceptance.checks.realChatgpt.noAutoSubmitVerified -or $Acceptance.checks.realChatgpt.sendClicked -or -not $Acceptance.checks.realChatgpt.completionVerified) {
  throw "Real ChatGPT no-auto-submit or verified completion evidence is incomplete."
}
if (-not $Acceptance.checks.activatedDesktopRestart.mainWindowStayedHidden) {
  throw "Activated desktop restart did not remain hidden."
}
if ([int]$Acceptance.checks.timing.sampleCount -lt 1 -or -not $Acceptance.checks.timing.underThreeMinutes -or $Acceptance.checks.timing.isMedian) {
  throw "Phase 3 timing evidence is incomplete or incorrectly labeled."
}
if ($Acceptance.review.verdict -ne "pass" -or [int]$Acceptance.review.p0 -ne 0 -or [int]$Acceptance.review.p1 -ne 0) {
  throw "Phase 3 adversarial review gate did not pass."
}

if (-not $Privacy.pass -or [int]$Privacy.counts.forbiddenArtifactKeys -ne 0 -or [int]$Privacy.counts.absoluteArtifactPaths -ne 0) {
  throw "Phase 3 privacy report did not pass."
}
if ($Review -notmatch "Verdict: \*\*pass\*\*" -or $Review -notmatch "P0=0, P1=0, P2=0") {
  throw "Phase 3 adversarial review document is incomplete."
}

$ContentSource = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "prototypes/browser-extension/src/content.js")
$EvidenceSource = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "prototypes/browser-extension/src/activation-evidence.js")
$NativeActivationSource = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "apps/local-service-sidecar/src/activation.rs")
$NativeMainSource = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "apps/local-service-sidecar/src/main.rs")
$ControlCenterSource = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "apps/desktop-shell/src/control-center-app.js")

foreach ($Source in @($ContentSource, $EvidenceSource, $NativeActivationSource)) {
  if ($Source -notmatch "phase3-extension-20260717-r5") {
    throw "Extension build identity is inconsistent."
  }
}
foreach ($Source in @($NativeMainSource, $ControlCenterSource)) {
  if ($Source -notmatch "phase3-native-sidecar-20260717-r6") {
    throw "Native build identity is inconsistent."
  }
}
if ($NativeMainSource -match '"dataDir"\s*:') {
  throw "Native diagnostics still expose dataDir."
}
if ($ControlCenterSource -notmatch 'open_chatgpt"[\s\S]{0,120}hide_main_window') {
  throw "Open ChatGPT does not immediately hide the main window."
}

Write-Output "PHASE3_ACTIVATION_CRITIC_PASS"
